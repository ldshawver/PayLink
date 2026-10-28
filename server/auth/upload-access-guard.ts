/**
 * Uploaded-File Access Guard — server/auth/upload-access-guard.ts
 *
 * Pure (DB-free) decisions for GET /uploads/*. Until this guard existed,
 * server/index.ts served the uploads directory with express.static before the
 * session middleware, so W-9s, signed contracts, worker documents, receipts and
 * every other stored file was readable by anyone holding the URL.
 *
 * Invariants:
 *  - knowing a file URL is never authorization;
 *  - a file is reachable only through a database record that references it
 *    (an unreferenced file on disk is never served);
 *  - only DB-referenced branding images (company / contractor / enterprise /
 *    invoice-template logos) are public — they are embedded in outbound email;
 *  - a file referenced by any non-branding record is private, even if a logo
 *    column also points at it;
 *  - when several private records reference one file, the actor must be
 *    allowed by EVERY one of them (most restrictive wins);
 *  - non-staff actors (employees, contractors, vendors) reach only records they
 *    are the subject or uploader of;
 *  - "platform" means a platform org-admin role only (super admin / admin /
 *    owner); support, sales, billing, auditor and implementation roles get no
 *    file reach beyond their own uploads;
 *  - denials to an authenticated actor are 404 so a file's existence in another
 *    tenant is not disclosed; unauthenticated callers get 401 for everything
 *    that is not public branding, whether or not the file exists.
 *
 * Design mirrors stored-resource-guard.ts: the route resolves DB facts (owner
 * records, canAccessStoredCompany results) and passes plain values in.
 */
import path from "path";

/**
 * branding   — public logo; served to anyone.
 * global     — platform-wide document (system_documents); any signed-in user.
 * staff      — company admin / manager / supervisor, or the record's subject.
 * restricted — company admin / manager only, or the record's subject
 *              (tax forms, worker files, contracts, bank signatures, vendor files).
 */
export type UploadOwnerTier = "branding" | "global" | "staff" | "restricted";

export interface UploadOwner {
  kind: string;
  tier: UploadOwnerTier;
  companyId: string | null;
  subjectWorkerIds: string[];
  subjectUserIds: string[];
  subjectVendorId: string | null;
}

/** manager = company admin or manager (any alias); supervisor = supervisor only. */
export type StaffLevel = "manager" | "supervisor" | "none";

export interface UploadActor {
  userId: string;
  workerId: string | null;
  vendorId: string | null;
  isPlatform: boolean;
  staffLevel: StaffLevel;
}

export type UploadAccessDecision =
  | { allowed: true; isPublic: boolean; owner: UploadOwner }
  | { allowed: false; status: 401 | 404 };

/** Role → staff level using the guard-alias expansion (expandRoleForGuard). */
export function staffLevelFromRoles(effectiveRoles: readonly string[]): StaffLevel {
  if (effectiveRoles.includes("admin") || effectiveRoles.includes("manager")) return "manager";
  if (effectiveRoles.includes("supervisor")) return "supervisor";
  return "none";
}

function ownerAllows(
  owner: UploadOwner,
  actor: UploadActor,
  companyAccessible: (companyId: string | null) => boolean,
): boolean {
  if (owner.tier === "branding" || owner.tier === "global") return true;
  if (!companyAccessible(owner.companyId)) return false;
  if (actor.isPlatform) return true;
  if (actor.workerId && owner.subjectWorkerIds.includes(actor.workerId)) return true;
  if (owner.subjectUserIds.includes(actor.userId)) return true;
  if (actor.vendorId && owner.subjectVendorId === actor.vendorId) return true;
  if (owner.tier === "restricted") return actor.staffLevel === "manager";
  return actor.staffLevel === "manager" || actor.staffLevel === "supervisor";
}

/**
 * @param companyAccessible canAccessStoredCompany(actor, companyId) results,
 *   pre-resolved by the caller for every owner's companyId.
 */
export function decideUploadAccess(input: {
  actor: UploadActor | null;
  owners: UploadOwner[];
  companyAccessible: (companyId: string | null) => boolean;
}): UploadAccessDecision {
  const { actor, owners } = input;
  const publicOnly = owners.length > 0 && owners.every((o) => o.tier === "branding");
  if (publicOnly) return { allowed: true, isPublic: true, owner: owners[0] };
  if (!actor) return { allowed: false, status: 401 };

  // Branding owners never grant access to a file that a private record also
  // references. Every private owner must allow: several write paths accept a
  // client-supplied file reference, so a record the actor created themselves
  // must never unlock a file that another record (e.g. a W-9) also owns.
  const candidates = owners.filter((o) => o.tier !== "branding");
  if (candidates.length === 0) return { allowed: false, status: 404 };
  if (candidates.every((o) => ownerAllows(o, actor, input.companyAccessible))) {
    return { allowed: true, isPublic: false, owner: candidates[0] };
  }
  return { allowed: false, status: 404 };
}

export interface NormalizedUploadPath {
  /** Path relative to the uploads root, "/"-separated, e.g. "signed/<co>/x.pdf". */
  rel: string;
  /** The reference form stored in the database: "/uploads/<rel>". */
  canonical: string;
}

const MAX_UPLOAD_PATH_LENGTH = 512;

/**
 * Validates the raw (still percent-encoded) path after the /uploads mount
 * point. Decodes exactly once; rejects NUL/control characters, backslashes,
 * colons, a second encoding layer, empty / "." / ".." segments and absolute
 * forms. Returns null for anything that is not a plain relative file path.
 */
export function normalizeUploadRequestPath(rawPath: string): NormalizedUploadPath | null {
  if (typeof rawPath !== "string" || rawPath.length === 0 || rawPath.length > MAX_UPLOAD_PATH_LENGTH) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (decoded.startsWith("/")) decoded = decoded.slice(1);
  if (!decoded) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\:%]/.test(decoded)) return null;
  const segments = decoded.split("/");
  if (segments.some((s) => s === "" || s === "." || s === ".." || s.startsWith("."))) return null;
  const rel = segments.join("/");
  return { rel, canonical: `/uploads/${rel}` };
}

/**
 * Resolves `rel` beneath `root` and returns the absolute path only when the
 * real (symlink-resolved) location is exactly that path inside the real root
 * and is a regular file. Any symlink along the way — including one that stays
 * inside the root — is refused.
 */
export async function resolveUploadFileStrict(
  root: string,
  rel: string,
  fsApi: { realpath(p: string): Promise<string>; stat(p: string): Promise<{ isFile(): boolean }> },
): Promise<string | null> {
  const absRoot = path.resolve(root);
  const abs = path.resolve(absRoot, rel);
  if (!abs.startsWith(absRoot + path.sep)) return null;
  let realRoot: string;
  let real: string;
  try {
    realRoot = await fsApi.realpath(absRoot);
    real = await fsApi.realpath(abs);
  } catch {
    return null;
  }
  if (!real.startsWith(realRoot + path.sep)) return null;
  if (path.relative(realRoot, real) !== path.relative(absRoot, abs)) return null;
  try {
    const st = await fsApi.stat(real);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  return real;
}

const INLINE_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

/**
 * Response headers for a served upload. PDFs and raster images render inline;
 * SVG renders inline only under a script-free sandbox CSP; everything else is
 * forced to download as an opaque binary. Private files are never cached.
 */
export function uploadResponseHeaders(rel: string, isPublic: boolean): Record<string, string> {
  const ext = path.extname(rel).toLowerCase();
  const base = path.basename(rel).replace(/[^A-Za-z0-9._-]/g, "_");
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": isPublic ? "public, max-age=3600" : "private, no-store, max-age=0",
  };
  if (!isPublic) {
    headers["Pragma"] = "no-cache";
    headers["Cross-Origin-Resource-Policy"] = "same-origin";
    headers["X-Robots-Tag"] = "noindex, nofollow";
  }
  if (INLINE_TYPES[ext]) {
    headers["Content-Type"] = INLINE_TYPES[ext];
    headers["Content-Disposition"] = `inline; filename="${base}"`;
  } else if (ext === ".svg") {
    headers["Content-Type"] = "image/svg+xml";
    headers["Content-Disposition"] = `inline; filename="${base}"`;
    headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  } else {
    headers["Content-Type"] = "application/octet-stream";
    headers["Content-Disposition"] = `attachment; filename="${base}"`;
    headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
  }
  return headers;
}
