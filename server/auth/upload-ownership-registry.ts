/**
 * Uploaded-File Ownership Registry — server/auth/upload-ownership-registry.ts
 *
 * Maps a stored "/uploads/<rel>" reference to every database record that
 * points at it, as UploadOwner facts for decideUploadAccess()
 * (upload-access-guard.ts). This list IS the authorization boundary for
 * GET /uploads/*: a file referenced by no source below is never served.
 *
 * Adding an upload sink (a new column that stores an "/uploads/..." value)
 * requires adding a source here — otherwise its files are unreachable through
 * /uploads (fail closed), never accidentally public.
 *
 * Matching: values are stored as "/uploads/<rel>" (what every writer
 * produces), with legacy "uploads/<rel>" and absolute "https://host/uploads/<rel>"
 * forms also present for some logo columns. All three forms, minus any query
 * string, match. Every source is matched in every form so a private record that
 * stores an absolute URL still makes the file private.
 *
 * Branding sources only count for raster/SVG image paths: a logo column
 * pointed at a PDF never makes that PDF public.
 */
import path from "path";
import { sql, type SQL } from "drizzle-orm";
import type { NormalizedUploadPath, UploadOwner, UploadOwnerTier } from "./upload-access-guard";

export type SqlExecutor = (query: SQL) => Promise<{ rows: unknown[] }>;

interface OwnerRow {
  company_id: string | null;
  worker_ids: (string | null)[] | null;
  user_ids: (string | null)[] | null;
  vendor_id: string | null;
}

export interface UploadOwnerSource {
  kind: string;
  tier: UploadOwnerTier;
  /** Tables the query reads — used by the coverage test and for schema-drift diagnostics. */
  tables: string[];
  /**
   * SELECT company_id, worker_ids text[], user_ids text[], vendor_id
   * for every row whose file column matches. `m(col)` renders the match predicate.
   */
  query: (m: (col: string) => SQL) => SQL;
}

const BRANDING_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"]);

export function isBrandingImagePath(rel: string): boolean {
  return BRANDING_IMAGE_EXTENSIONS.has(path.extname(rel).toLowerCase());
}

const branding = (kind: string, table: string, cols: string[], companyExpr: string, from?: string): UploadOwnerSource => ({
  kind,
  tier: "branding",
  tables: [table],
  query: (m) => sql`
    SELECT ${sql.raw(companyExpr)} AS company_id, NULL::text[] AS worker_ids, NULL::text[] AS user_ids, NULL::text AS vendor_id
    FROM ${sql.raw(from ?? table)}
    WHERE ${sql.join(cols.map((c) => m(c)), sql` OR `)}`,
});

/**
 * Every DB column that stores an uploaded-file reference.
 * Tier semantics are documented on UploadOwnerTier.
 */
export const UPLOAD_OWNER_SOURCES: readonly UploadOwnerSource[] = [
  // ── Public branding (embedded in outbound email / public pay & proposal pages) ──
  branding("enterprise_logo", "enterprises", ["logo_url"], "NULL::text"),
  branding("company_logo", "companies", ["logo_url", "icon_url"], "id"),
  branding("company_branding_logo", "company_branding", ["logo_path", "logo_url"], "company_id"),
  branding("invoice_template_logo", "invoice_templates", ["logo_url"], "company_id"),
  branding("contractor_branding_logo", "contractor_branding", ["cb.logo_path", "cb.logo_url"], "w.company_id",
    "contractor_branding cb LEFT JOIN workers w ON w.id = cb.worker_id"),

  // ── Platform-wide documents ──
  {
    kind: "system_document", tier: "global", tables: ["system_documents"],
    query: (m) => sql`SELECT NULL::text AS company_id, NULL::text[] AS worker_ids, NULL::text[] AS user_ids, NULL::text AS vendor_id
      FROM system_documents WHERE ${m("file_url")}`,
  },

  // ── Contractor / worker tax & HR files ──
  {
    kind: "contractor_document", tier: "restricted", tables: ["contractor_documents"],
    query: (m) => sql`SELECT company_id, ARRAY[worker_id]::text[] AS worker_ids, ARRAY[uploaded_by]::text[] AS user_ids, NULL::text AS vendor_id
      FROM contractor_documents WHERE ${m("file_url")}`,
  },
  {
    kind: "worker_document", tier: "restricted", tables: ["worker_documents", "workers"],
    query: (m) => sql`SELECT w.company_id, ARRAY[wd.worker_id]::text[] AS worker_ids, NULL::text[] AS user_ids, NULL::text AS vendor_id
      FROM worker_documents wd LEFT JOIN workers w ON w.id = wd.worker_id WHERE ${m("wd.file_url")}`,
  },
  {
    kind: "worker_onboarding_document", tier: "restricted", tables: ["worker_onboarding_documents"],
    query: (m) => sql`SELECT company_id, ARRAY[worker_id]::text[] AS worker_ids, NULL::text[] AS user_ids, NULL::text AS vendor_id
      FROM worker_onboarding_documents WHERE ${m("file_url")}`,
  },
  {
    kind: "remittance_signature", tier: "restricted", tables: ["remittance_sources"],
    query: (m) => sql`SELECT company_id, NULL::text[] AS worker_ids, NULL::text[] AS user_ids, NULL::text AS vendor_id
      FROM remittance_sources WHERE ${m("signature_url")}`,
  },

  // ── Contracts & signed agreements ──
  {
    kind: "contract_signed_pdf", tier: "restricted", tables: ["contractor_contracts"],
    query: (m) => sql`SELECT company_id, ARRAY[contractor_id]::text[] AS worker_ids, NULL::text[] AS user_ids, NULL::text AS vendor_id
      FROM contractor_contracts WHERE ${m("signed_pdf_path")}`,
  },
  {
    kind: "contract_version_pdf", tier: "restricted", tables: ["contract_versions", "contractor_contracts"],
    query: (m) => sql`SELECT c.company_id, ARRAY[c.contractor_id]::text[] AS worker_ids, NULL::text[] AS user_ids, NULL::text AS vendor_id
      FROM contract_versions cv LEFT JOIN contractor_contracts c ON c.id = cv.contract_id WHERE ${m("cv.pdf_path")}`,
  },

  // ── Document management ──
  {
    kind: "dam_document", tier: "restricted", tables: ["dam_documents"],
    query: (m) => sql`SELECT company_id,
        ARRAY[worker_id, related_employee_id, related_contractor_id]::text[] AS worker_ids,
        ARRAY[uploaded_by_user_id]::text[] AS user_ids,
        related_vendor_id AS vendor_id
      FROM dam_documents WHERE ${m("file_path")}`,
  },
  {
    kind: "company_document", tier: "staff", tables: ["documents"],
    query: (m) => sql`SELECT company_id, ARRAY[assigned_to_worker_id]::text[] AS worker_ids, ARRAY[created_by]::text[] AS user_ids, NULL::text AS vendor_id
      FROM documents WHERE ${m("file_url")} OR ${m("documenso_completed_pdf_url")}`,
  },
  {
    kind: "company_document_version", tier: "staff", tables: ["document_versions", "documents"],
    query: (m) => sql`SELECT d.company_id, ARRAY[d.assigned_to_worker_id]::text[] AS worker_ids, ARRAY[dv.uploaded_by]::text[] AS user_ids, NULL::text AS vendor_id
      FROM document_versions dv LEFT JOIN documents d ON d.id = dv.document_id WHERE ${m("dv.file_url")}`,
  },
  {
    kind: "document_signature_completed_pdf", tier: "restricted", tables: ["document_signature_requests", "documents"],
    query: (m) => sql`SELECT r.company_id, ARRAY[d.assigned_to_worker_id]::text[] AS worker_ids, NULL::text[] AS user_ids, NULL::text AS vendor_id
      FROM document_signature_requests r LEFT JOIN documents d ON d.id = r.document_id WHERE ${m("r.documenso_completed_pdf_url")}`,
  },
  {
    kind: "biz_document_attachment", tier: "restricted", tables: ["biz_document_attachments", "biz_documents"],
    query: (m) => sql`SELECT b.company_id, ARRAY[b.owner_entity_id]::text[] AS worker_ids,
        ARRAY[a.uploaded_by_user_id, b.created_by_user_id, b.submitted_by_user_id]::text[] AS user_ids, NULL::text AS vendor_id
      FROM biz_document_attachments a LEFT JOIN biz_documents b ON b.id = a.document_id WHERE ${m("a.file_path")}`,
  },

  // ── Proposals & invoices ──
  {
    kind: "proposal_attachment", tier: "restricted", tables: ["proposal_attachments", "contractor_proposals"],
    query: (m) => sql`SELECT p.company_id, ARRAY[p.contractor_id, a.uploaded_by_worker_id]::text[] AS worker_ids, NULL::text[] AS user_ids, NULL::text AS vendor_id
      FROM proposal_attachments a LEFT JOIN contractor_proposals p ON p.id = a.proposal_id WHERE ${m("a.file_path")}`,
  },
  {
    kind: "invoice_attachment", tier: "restricted", tables: ["invoice_attachments", "contractor_invoices"],
    query: (m) => sql`SELECT i.company_id, ARRAY[i.contractor_id, a.uploaded_by_worker_id]::text[] AS worker_ids, NULL::text[] AS user_ids, NULL::text AS vendor_id
      FROM invoice_attachments a LEFT JOIN contractor_invoices i ON i.id = a.invoice_id WHERE ${m("a.file_path")}`,
  },
  {
    kind: "contractor_invoice_attachment", tier: "restricted", tables: ["contractor_invoice_attachments", "contractor_invoices"],
    query: (m) => sql`SELECT i.company_id, ARRAY[i.contractor_id]::text[] AS worker_ids, NULL::text[] AS user_ids, NULL::text AS vendor_id
      FROM contractor_invoice_attachments a LEFT JOIN contractor_invoices i ON i.id = a.invoice_id WHERE ${m("a.file_path")}`,
  },

  // ── Expenses, receipts, trades ──
  {
    kind: "receipt_image", tier: "restricted", tables: ["receipts"],
    query: (m) => sql`SELECT company_id, ARRAY[worker_id]::text[] AS worker_ids, NULL::text[] AS user_ids, NULL::text AS vendor_id
      FROM receipts WHERE ${m("receipt_image_path")}`,
  },
  {
    kind: "expense_attachment", tier: "restricted", tables: ["expense_attachments", "expenses"],
    query: (m) => sql`SELECT e.company_id, NULL::text[] AS worker_ids, ARRAY[e.paid_by_user_id]::text[] AS user_ids, NULL::text AS vendor_id
      FROM expense_attachments a LEFT JOIN expenses e ON e.id = a.expense_id WHERE ${m("a.file_path")}`,
  },
  {
    kind: "trade_attachment", tier: "restricted", tables: ["trade_attachments", "trade_transactions"],
    query: (m) => sql`SELECT t.company_id, NULL::text[] AS worker_ids, ARRAY[a.uploaded_by]::text[] AS user_ids, NULL::text AS vendor_id
      FROM trade_attachments a LEFT JOIN trade_transactions t ON t.id = a.trade_transaction_id WHERE ${m("a.file_url")}`,
  },

  // ── Vendor portal ──
  {
    kind: "vendor_document", tier: "restricted", tables: ["vendor_documents"],
    query: (m) => sql`SELECT company_id, NULL::text[] AS worker_ids, ARRAY[uploaded_by_user_id]::text[] AS user_ids, vendor_id
      FROM vendor_documents WHERE ${m("file_url")}`,
  },
  {
    kind: "vendor_invoice", tier: "restricted", tables: ["vendor_invoices"],
    query: (m) => sql`SELECT company_id, NULL::text[] AS worker_ids, ARRAY[submitted_by_user_id]::text[] AS user_ids, vendor_id
      FROM vendor_invoices WHERE ${m("file_url")}`,
  },

  // ── Feedback screenshots (may include HR feedback) ──
  {
    kind: "feedback_screenshot", tier: "restricted", tables: ["feedback_tickets"],
    query: (m) => sql`SELECT company_id, NULL::text[] AS worker_ids, ARRAY[submitter_user_id]::text[] AS user_ids, NULL::text AS vendor_id
      FROM feedback_tickets
      WHERE ${m("screenshot_path")}
         OR EXISTS (SELECT 1 FROM unnest(COALESCE(screenshot_paths, ARRAY[]::text[])) AS sp(p) WHERE ${m("sp.p")})`,
  },
];

/** Postgres "relation/column does not exist": that source cannot reference anything in this schema. */
const SCHEMA_DRIFT_CODES = new Set(["42P01", "42703"]);

export class UploadOwnershipLookupError extends Error {
  constructor(public readonly sourceKind: string, cause: unknown) {
    super(`upload ownership lookup failed for source ${sourceKind}`);
    this.cause = cause;
  }
}

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code ?? e?.cause?.code;
}

function matchPredicate(ref: NormalizedUploadPath): (col: string) => SQL {
  const base = path.posix.basename(ref.rel);
  const bare = `uploads/${ref.rel}`;
  return (col: string) => {
    const c = sql.raw(col);
    return sql`(strpos(${c}, ${base}) > 0 AND regexp_replace(split_part(${c}, '?', 1), '^https?://[^/]+', '') IN (${ref.canonical}, ${bare}))`;
  };
}

const compact = (xs: (string | null)[] | null | undefined): string[] =>
  (xs ?? []).filter((x): x is string => typeof x === "string" && x.length > 0);

/**
 * Every owner record of the file. Throws UploadOwnershipLookupError when any
 * source fails for a reason other than schema drift — the caller must deny,
 * because a missed private owner could otherwise leave a branding owner alone
 * and make a private file public.
 */
export async function resolveUploadOwners(
  exec: SqlExecutor,
  ref: NormalizedUploadPath,
  sources: readonly UploadOwnerSource[] = UPLOAD_OWNER_SOURCES,
): Promise<UploadOwner[]> {
  const m = matchPredicate(ref);
  const brandingEligible = isBrandingImagePath(ref.rel);
  const active = sources.filter((s) => s.tier !== "branding" || brandingEligible);
  const results = await Promise.all(active.map(async (source) => {
    let rows: OwnerRow[];
    try {
      rows = (await exec(source.query(m))).rows as OwnerRow[];
    } catch (err) {
      if (SCHEMA_DRIFT_CODES.has(pgCode(err) ?? "")) return [];
      throw new UploadOwnershipLookupError(source.kind, err);
    }
    return rows.map((r): UploadOwner => ({
      kind: source.kind,
      tier: source.tier,
      companyId: r.company_id ?? null,
      subjectWorkerIds: compact(r.worker_ids),
      subjectUserIds: compact(r.user_ids),
      subjectVendorId: r.vendor_id ?? null,
    }));
  }));
  return results.flat();
}
