/**
 * Authenticated GET /uploads/* handler — server/auth/upload-route.ts
 *
 * Replaces `app.use("/uploads", express.static(uploadsDir))`, which served
 * every stored file to anyone holding its URL. Mounted after the session
 * middleware. Flow:
 *
 *   raw path → normalizeUploadRequestPath (single decode, no traversal)
 *            → [no session and not an image path → 401, no DB work]
 *            → resolveOwners (every DB record referencing the file)
 *            → public branding only? serve : load actor (session → live user)
 *            → decideUploadAccess (tenant, company, document-level ownership)
 *            → resolveUploadFileStrict (real path inside the root, no symlinks)
 *            → stream with uploadResponseHeaders
 *
 * Dependencies are injected so the whole handler is exercised over real HTTP
 * in tests without a database (tests/private-uploads-http.test.ts).
 */
import fs from "fs";
import type { Request, Response, NextFunction } from "express";
import {
  decideUploadAccess,
  normalizeUploadRequestPath,
  resolveUploadFileStrict,
  staffLevelFromRoles,
  uploadResponseHeaders,
  type NormalizedUploadPath,
  type UploadActor,
  type UploadOwner,
} from "./upload-access-guard";
import { isBrandingImagePath } from "./upload-ownership-registry";

export interface LoadedUploadActor {
  actor: UploadActor;
  /** canAccessStoredCompany(user, companyId). */
  canAccessCompany(companyId: string | null): Promise<boolean>;
}

export interface UploadRouteDeps {
  uploadsDir: string;
  resolveOwners(ref: NormalizedUploadPath): Promise<UploadOwner[]>;
  /**
   * The live actor behind the request's session, or null when there is no
   * usable session: none, expired (the store no longer returns it), destroyed
   * at logout, MFA enrollment still pending, user deleted or deactivated.
   */
  loadActor(req: Request): Promise<LoadedUploadActor | null>;
  fsApi?: {
    realpath(p: string): Promise<string>;
    stat(p: string): Promise<{ isFile(): boolean; size: number }>;
  };
  onError?(err: unknown): void;
}

const DENY_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Content-Type": "text/plain; charset=utf-8",
};

const DENY_MESSAGES: Record<number, string> = {
  401: "Authentication required",
  405: "Method not allowed",
  503: "Temporarily unavailable",
};

function deny(res: Response, status: number): void {
  res.status(status).set(DENY_HEADERS);
  if (status === 401) res.set("WWW-Authenticate", 'Session realm="uploads"');
  res.send(DENY_MESSAGES[status] ?? "Not found");
}

interface SessionUser {
  id: string;
  role?: string | null;
  workerId?: string | null;
  isActive?: boolean | null;
}

/**
 * The production session → actor mapping. A session is usable only while the
 * store still returns it (express-session drops expired / destroyed sessions),
 * MFA enrollment is complete, and the user row still exists and is active —
 * so deactivating a user revokes file access on their next request.
 */
export function createSessionActorLoader(deps: {
  getUser(id: string): Promise<SessionUser | undefined | null>;
  /** Active identity_links vendor binding (resolveVendorForUser). */
  resolveVendorId(userId: string): Promise<string | null>;
  canAccessStoredCompany(user: SessionUser, companyId: string | null): Promise<boolean>;
  expandRoleForGuard(role: string): string[];
  isPlatformOrgAdminRole(role: string | null | undefined): boolean;
}): (req: Request) => Promise<LoadedUploadActor | null> {
  return async (req) => {
    const session = (req as any).session;
    if (!session?.userId || session.mfaEnrollmentRequired) return null;
    const user = await deps.getUser(session.userId);
    if (!user || user.isActive === false) return null;
    const vendorId = user.role === "vendor" ? await deps.resolveVendorId(user.id) : null;
    return {
      actor: {
        userId: user.id,
        workerId: user.workerId ?? null,
        vendorId,
        isPlatform: deps.isPlatformOrgAdminRole(user.role),
        staffLevel: staffLevelFromRoles(deps.expandRoleForGuard(user.role || "")),
      },
      canAccessCompany: (companyId) => deps.canAccessStoredCompany(user, companyId),
    };
  };
}

export function createUploadsHandler(deps: UploadRouteDeps) {
  const fsApi = deps.fsApi ?? fs.promises;

  return async function uploadsHandler(req: Request, res: Response, _next: NextFunction): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.set("Allow", "GET, HEAD");
      return deny(res, 405);
    }
    // req.path is relative to the /uploads mount and still percent-encoded.
    const ref = normalizeUploadRequestPath(req.path);
    if (!ref) return deny(res, 404);

    const hasSession = !!(req as any).session?.userId;
    // Only image paths can ever be public branding: anything else needs a
    // session, and an anonymous probe costs no database work.
    if (!hasSession && !isBrandingImagePath(ref.rel)) return deny(res, 401);

    try {
      const owners = await deps.resolveOwners(ref);
      const publicOnly = owners.length > 0 && owners.every((o) => o.tier === "branding");

      let loaded: LoadedUploadActor | null = null;
      const accessible = new Map<string | null, boolean>();
      if (!publicOnly) {
        loaded = hasSession ? await deps.loadActor(req) : null;
        if (loaded) {
          for (const o of owners) {
            if (o.tier === "branding" || accessible.has(o.companyId)) continue;
            accessible.set(o.companyId, await loaded.canAccessCompany(o.companyId));
          }
        }
      }

      const decision = decideUploadAccess({
        actor: loaded?.actor ?? null,
        owners,
        companyAccessible: (id) => accessible.get(id) === true,
      });
      if (!decision.allowed) return deny(res, decision.status);

      const abs = await resolveUploadFileStrict(deps.uploadsDir, ref.rel, fsApi);
      if (!abs) return deny(res, 404);
      const st = await fsApi.stat(abs);

      res.status(200).set(uploadResponseHeaders(ref.rel, decision.isPublic));
      res.set("Content-Length", String(st.size));
      if (req.method === "HEAD") { res.end(); return; }

      const stream = fs.createReadStream(abs);
      stream.on("error", (err) => {
        deps.onError?.(err);
        if (!res.headersSent) deny(res, 404);
        else res.destroy();
      });
      stream.pipe(res);
    } catch (err) {
      deps.onError?.(err);
      if (!res.headersSent) deny(res, 503);
    }
  };
}
