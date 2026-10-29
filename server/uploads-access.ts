/**
 * GET /uploads/* access control (P0).
 *
 * Replaces the anonymous `express.static(uploadsDir)` mount, which served every
 * stored file (W-9s, HR documents, signed contracts, bank signature images,
 * invoices, receipts) to anyone with the URL.
 *
 * A file is served only when database records reference it (UPLOAD_SOURCES):
 *   - unreferenced file                      → 404 (unknown ownership fails closed)
 *   - referenced only by logo columns, image → public (emails, public pay pages)
 *   - otherwise                              → signed-in user who can access the
 *                                              owning company of EVERY record that
 *                                              references the file
 * "Every" matters: some routes accept a client-supplied file path, so creating
 * your own record that points at another company's file must not unlock it.
 *
 * Adding a column that stores "/uploads/..." values requires adding it here,
 * otherwise those files are not served (fail closed, never public).
 */
import fs from "fs";
import path from "path";
import { sql, type SQL } from "drizzle-orm";
import type { Request, Response } from "express";

type Tier = "logo" | "signed_in" | "company";

interface UploadSource {
  tier: Tier;
  from: string;
  cols: string[];
  /** SQL expression for the owning company id. */
  company: string;
}

export const UPLOAD_SOURCES: readonly UploadSource[] = [
  // Public branding — only honoured for image files.
  { tier: "logo", from: "enterprises", cols: ["logo_url"], company: "NULL" },
  { tier: "logo", from: "companies", cols: ["logo_url", "icon_url"], company: "id" },
  { tier: "logo", from: "company_branding", cols: ["logo_path", "logo_url"], company: "company_id" },
  { tier: "logo", from: "invoice_templates", cols: ["logo_url"], company: "company_id" },
  { tier: "logo", from: "contractor_branding cb LEFT JOIN workers w ON w.id = cb.worker_id", cols: ["cb.logo_path", "cb.logo_url"], company: "w.company_id" },
  // Platform-wide documents.
  { tier: "signed_in", from: "system_documents", cols: ["file_url"], company: "NULL" },
  // Company-owned files.
  { tier: "company", from: "contractor_documents", cols: ["file_url"], company: "company_id" },
  { tier: "company", from: "worker_documents wd LEFT JOIN workers w ON w.id = wd.worker_id", cols: ["wd.file_url"], company: "w.company_id" },
  { tier: "company", from: "worker_onboarding_documents", cols: ["file_url"], company: "company_id" },
  { tier: "company", from: "remittance_sources", cols: ["signature_url"], company: "company_id" },
  { tier: "company", from: "contractor_contracts", cols: ["signed_pdf_path"], company: "company_id" },
  { tier: "company", from: "contract_versions cv LEFT JOIN contractor_contracts c ON c.id = cv.contract_id", cols: ["cv.pdf_path"], company: "c.company_id" },
  { tier: "company", from: "dam_documents", cols: ["file_path"], company: "company_id" },
  { tier: "company", from: "documents", cols: ["file_url", "documenso_completed_pdf_url"], company: "company_id" },
  { tier: "company", from: "document_versions dv LEFT JOIN documents d ON d.id = dv.document_id", cols: ["dv.file_url"], company: "d.company_id" },
  { tier: "company", from: "document_signature_requests", cols: ["documenso_completed_pdf_url"], company: "company_id" },
  { tier: "company", from: "biz_document_attachments a LEFT JOIN biz_documents b ON b.id = a.document_id", cols: ["a.file_path"], company: "b.company_id" },
  { tier: "company", from: "proposal_attachments a LEFT JOIN contractor_proposals p ON p.id = a.proposal_id", cols: ["a.file_path"], company: "p.company_id" },
  { tier: "company", from: "invoice_attachments a LEFT JOIN contractor_invoices i ON i.id = a.invoice_id", cols: ["a.file_path"], company: "i.company_id" },
  { tier: "company", from: "contractor_invoice_attachments a LEFT JOIN contractor_invoices i ON i.id = a.invoice_id", cols: ["a.file_path"], company: "i.company_id" },
  { tier: "company", from: "receipts", cols: ["receipt_image_path"], company: "company_id" },
  { tier: "company", from: "expense_attachments a LEFT JOIN expenses e ON e.id = a.expense_id", cols: ["a.file_path"], company: "e.company_id" },
  { tier: "company", from: "trade_attachments a LEFT JOIN trade_transactions t ON t.id = a.trade_transaction_id", cols: ["a.file_url"], company: "t.company_id" },
  { tier: "company", from: "vendor_documents", cols: ["file_url"], company: "company_id" },
  { tier: "company", from: "vendor_invoices", cols: ["file_url"], company: "company_id" },
  { tier: "company", from: "feedback_tickets", cols: ["screenshot_path"], company: "company_id" },
  { tier: "company", from: "feedback_tickets f, unnest(COALESCE(f.screenshot_paths, ARRAY[]::text[])) AS sp(p)", cols: ["sp.p"], company: "f.company_id" },
];

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico)$/i;

export interface UploadOwner { tier: Tier; companyId: string | null }

/** Postgres undefined table/column: that source cannot reference anything in this schema. */
const SCHEMA_DRIFT = new Set(["42P01", "42703"]);

/**
 * Every record referencing `/uploads/<rel>`. Stored values are "/uploads/<rel>",
 * legacy "uploads/<rel>", or an absolute URL (some logo columns), optionally with
 * a query string. Any lookup error other than schema drift propagates — the
 * caller must deny, since a missed private owner could leave a file public.
 */
export async function findUploadOwners(
  exec: (q: SQL) => Promise<{ rows: unknown[] }>,
  rel: string,
): Promise<UploadOwner[]> {
  const canonical = `/uploads/${rel}`;
  const bare = `uploads/${rel}`;
  const base = path.posix.basename(rel);
  const match = (col: string) => {
    const c = sql.raw(col);
    return sql`(strpos(${c}, ${base}) > 0 AND regexp_replace(split_part(${c}, '?', 1), '^https?://[^/]+', '') IN (${canonical}, ${bare}))`;
  };
  const sources = UPLOAD_SOURCES.filter((s) => s.tier !== "logo" || IMAGE_EXT.test(rel));
  const results = await Promise.all(sources.map(async (s) => {
    try {
      const { rows } = await exec(sql`SELECT ${sql.raw(s.company)}::text AS company_id FROM ${sql.raw(s.from)} WHERE ${sql.join(s.cols.map(match), sql` OR `)}`);
      return (rows as { company_id: string | null }[]).map((r) => ({ tier: s.tier, companyId: r.company_id ?? null }));
    } catch (err: any) {
      if (SCHEMA_DRIFT.has(err?.code ?? err?.cause?.code)) return [];
      throw err;
    }
  }));
  return results.flat();
}

/**
 * Decode the path under /uploads once and resolve it inside the uploads root.
 * Returns null for traversal, encoded separators, NUL, dot-segments, or a target
 * whose real path (after symlinks) is outside the root or is not a regular file.
 */
export function resolveUploadRequest(uploadsDir: string, rawSubPath: string): { rel: string; abs: string } | null {
  let decoded: string;
  try { decoded = decodeURIComponent(rawSubPath); } catch { return null; }
  if (/[\0\\]/.test(decoded) || /%/.test(decoded)) return null;
  const segments = decoded.replace(/^\/+/, "").split("/");
  if (segments.some((s) => s === "" || s === "." || s === ".." || s.startsWith("."))) return null;
  const rel = segments.join("/");
  try {
    const root = fs.realpathSync(uploadsDir);
    const abs = fs.realpathSync(path.join(root, rel));
    if (!abs.startsWith(root + path.sep) || !fs.statSync(abs).isFile()) return null;
    return { rel, abs };
  } catch {
    return null;
  }
}

export interface UploadsRouteDeps {
  uploadsDir: string;
  findOwners: (rel: string) => Promise<UploadOwner[]>;
  /** The signed-in actor, or null when there is no usable session. */
  loadActor: (req: Request) => Promise<unknown | null>;
  canAccessCompany: (actor: unknown, companyId: string | null) => Promise<boolean>;
}

export function createUploadsHandler(deps: UploadsRouteDeps) {
  return async (req: Request, res: Response) => {
    if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).end();
    const deny = (status: number, body: string) => {
      res.setHeader("Cache-Control", "no-store");
      return res.status(status).type("text/plain").send(body);
    };
    const target = resolveUploadRequest(deps.uploadsDir, req.path);
    if (!target) return deny(404, "Not found");
    // Only image logos are ever anonymous; skip the lookups for anything else.
    const isImage = IMAGE_EXT.test(target.rel);
    const actor = await deps.loadActor(req);
    if (!actor && !isImage) return deny(401, "Not authenticated");

    let owners: UploadOwner[];
    try {
      owners = await deps.findOwners(target.rel);
    } catch (err) {
      console.error("[uploads] ownership lookup failed:", (err as Error)?.message);
      return deny(503, "Unavailable");
    }
    if (owners.length === 0) return deny(404, "Not found");

    const isPublic = isImage && owners.every((o) => o.tier === "logo");
    if (!isPublic) {
      if (!actor) return deny(401, "Not authenticated");
      for (const o of owners) {
        if (o.tier === "company" && !(await deps.canAccessCompany(actor, o.companyId))) return deny(404, "Not found");
      }
    }

    const headers: Record<string, string> = {
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": isPublic ? "public, max-age=3600" : "private, no-store",
    };
    if (/\.svg$/i.test(target.rel)) headers["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
    res.sendFile(target.abs, { headers, dotfiles: "deny" }, (err) => {
      if (err && !res.headersSent) deny(404, "Not found");
    });
  };
}
