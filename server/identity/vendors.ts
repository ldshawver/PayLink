/**
 * Vendor portal — PR 3 of the SaaS identity/onboarding cleanup.
 *
 * Vendors are a FIRST-CLASS entity (AP payees / service providers) — deliberately
 * NOT modelled as `customers` (customers are SaaS tenants / AR). An admin/manager
 * creates a vendor, edits its contact details, and invites a vendor user; the
 * invite reuses the PR 1 `account_invites` + `identity_links` primitives with
 * `relationship_kind = 'vendor'` / `subject_type = 'vendor'`. A logged-in vendor
 * user sees ONLY their own vendor + company records, can view/update their
 * profile, and can submit invoices / documents. An admin reviews those
 * submissions (approve / reject / status) — a review in PR 3 sets a status and
 * NOTHING else: no expense, no expense_payment, no check, no ledger row.
 *
 * Split: pure validation (`normalizeVendor*Input`) is dependency-free and
 * unit-tested; everything else is company/tenant-scoped DB work.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { createOrRefreshInvite } from "./identity-db";
import { normalizeEmail } from "./identity-resolver";

function firstRow<T = any>(res: any): T | undefined {
  return (res?.rows?.[0] as T | undefined) ?? undefined;
}

// ── Pure input validation / sanitisation ────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim, collapse whitespace, cap length, strip control chars. Empty becomes null. */
function clean(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return s.length ? s : null;
}

export interface CleanVendor {
  businessName: string;
  contactName: string | null;
  email: string | null; // lower-cased
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  taxId: string | null;
  serviceType: string | null;
  notes: string | null;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function normalizeVendorInput(raw: any): ValidationResult<CleanVendor> {
  const businessName = clean(raw?.businessName, 160);
  if (!businessName) return { ok: false, message: "A business name is required." };
  const emailRaw = clean(raw?.email, 254);
  if (emailRaw && !EMAIL_RE.test(emailRaw)) return { ok: false, message: "Enter a valid email address." };
  return {
    ok: true,
    value: {
      businessName,
      contactName: clean(raw?.contactName, 120),
      email: emailRaw ? normalizeEmail(emailRaw) : null,
      phone: clean(raw?.phone, 40),
      address: clean(raw?.address, 240),
      city: clean(raw?.city, 120),
      state: clean(raw?.state, 60),
      zip: clean(raw?.zip, 20),
      taxId: clean(raw?.taxId, 40),
      serviceType: clean(raw?.serviceType, 120),
      notes: clean(raw?.notes, 2000),
    },
  };
}

/** Contact-detail-only patch (business identity / tax id are edit-restricted to the create path). */
export interface CleanVendorPatch {
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  serviceType?: string | null;
  notes?: string | null;
  businessName?: string;
}

export function normalizeVendorPatch(raw: any): ValidationResult<CleanVendorPatch> {
  const out: CleanVendorPatch = {};
  if (raw?.businessName !== undefined) {
    const bn = clean(raw.businessName, 160);
    if (!bn) return { ok: false, message: "A business name cannot be empty." };
    out.businessName = bn;
  }
  if (raw?.email !== undefined) {
    const e = clean(raw.email, 254);
    if (e && !EMAIL_RE.test(e)) return { ok: false, message: "Enter a valid email address." };
    out.email = e ? normalizeEmail(e) : null;
  }
  if (raw?.contactName !== undefined) out.contactName = clean(raw.contactName, 120);
  if (raw?.phone !== undefined) out.phone = clean(raw.phone, 40);
  if (raw?.address !== undefined) out.address = clean(raw.address, 240);
  if (raw?.city !== undefined) out.city = clean(raw.city, 120);
  if (raw?.state !== undefined) out.state = clean(raw.state, 60);
  if (raw?.zip !== undefined) out.zip = clean(raw.zip, 20);
  if (raw?.serviceType !== undefined) out.serviceType = clean(raw.serviceType, 120);
  if (raw?.notes !== undefined) out.notes = clean(raw.notes, 2000);
  if (Object.keys(out).length === 0) return { ok: false, message: "No editable fields were provided." };
  return { ok: true, value: out };
}

const DOC_TYPES = new Set(["w9", "tax", "insurance", "license", "other"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface CleanVendorInvoice {
  invoiceNumber: string | null;
  amount: string | null; // decimal string or null; never coerced to 0
  currency: string;
  invoiceDate: string | null;
  dueDate: string | null;
  description: string | null;
}

export function normalizeVendorInvoiceInput(raw: any): ValidationResult<CleanVendorInvoice> {
  let amount: string | null = null;
  if (raw?.amount !== undefined && raw?.amount !== null && String(raw.amount).trim() !== "") {
    const n = Number(raw.amount);
    if (!Number.isFinite(n) || n < 0 || n > 1e12) return { ok: false, message: "Enter a valid, non-negative amount." };
    amount = n.toFixed(2);
  }
  const currencyRaw = clean(raw?.currency, 8);
  const currency = currencyRaw ? currencyRaw.toUpperCase() : "USD";
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, message: "Currency must be a 3-letter code." };
  for (const [k, v] of [["invoiceDate", raw?.invoiceDate], ["dueDate", raw?.dueDate]] as const) {
    if (v !== undefined && v !== null && String(v).trim() !== "" && !ISO_DATE_RE.test(String(v).trim())) {
      return { ok: false, message: `${k} must be an ISO date (YYYY-MM-DD).` };
    }
  }
  return {
    ok: true,
    value: {
      invoiceNumber: clean(raw?.invoiceNumber, 80),
      amount,
      currency,
      invoiceDate: raw?.invoiceDate && ISO_DATE_RE.test(String(raw.invoiceDate).trim()) ? String(raw.invoiceDate).trim() : null,
      dueDate: raw?.dueDate && ISO_DATE_RE.test(String(raw.dueDate).trim()) ? String(raw.dueDate).trim() : null,
      description: clean(raw?.description, 2000),
    },
  };
}

export function normalizeVendorDocumentType(raw: any): string {
  const t = clean(raw, 40)?.toLowerCase() || "w9";
  return DOC_TYPES.has(t) ? t : "other";
}

// ── Admin: vendor CRUD (company-scoped) ─────────────────────────────────────

export interface VendorRow {
  id: string;
  companyId: string;
  businessName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  taxId: string | null;
  serviceType: string | null;
  notes: string | null;
  status: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

function mapVendor(r: any): VendorRow {
  return {
    id: r.id, companyId: r.company_id, businessName: r.business_name,
    contactName: r.contact_name ?? null, email: r.email ?? null, phone: r.phone ?? null,
    address: r.address ?? null, city: r.city ?? null, state: r.state ?? null, zip: r.zip ?? null,
    taxId: r.tax_id ?? null, serviceType: r.service_type ?? null, notes: r.notes ?? null,
    status: r.status, createdAt: r.created_at ? new Date(r.created_at) : null,
    updatedAt: r.updated_at ? new Date(r.updated_at) : null,
  };
}

export interface VendorPortalStatus {
  vendorId: string;
  accessEnabled: boolean; // vendors.status === 'active'
  inviteStatus: "none" | "pending" | "accepted" | "expired";
  linkedUserId: string | null;
  linkedUserActive: boolean;
}

export async function loadVendorPortalStatuses(companyId: string): Promise<Map<string, VendorPortalStatus>> {
  const out = new Map<string, VendorPortalStatus>();
  const vendors = (await db.execute(sql`SELECT id, status FROM vendors WHERE company_id = ${companyId}`)).rows || [];
  for (const v of vendors as any[]) {
    out.set(v.id, {
      vendorId: v.id, accessEnabled: v.status === "active",
      inviteStatus: "none", linkedUserId: null, linkedUserActive: false,
    });
  }
  const invites = (await db.execute(sql`
    SELECT relationship_id, status, expires_at FROM account_invites
    WHERE company_id = ${companyId} AND relationship_kind = 'vendor' AND relationship_id IS NOT NULL
  `)).rows || [];
  for (const inv of invites as any[]) {
    const s = out.get(inv.relationship_id);
    if (!s) continue;
    if (inv.status === "accepted") s.inviteStatus = "accepted";
    else if (inv.status === "pending") {
      const expired = inv.expires_at && new Date(inv.expires_at).getTime() < Date.now();
      if (s.inviteStatus !== "accepted") s.inviteStatus = expired ? "expired" : "pending";
    }
  }
  const links = (await db.execute(sql`
    SELECT il.subject_id, il.user_id, il.link_status, u.is_active
    FROM identity_links il
    JOIN users u ON u.id = il.user_id
    WHERE il.company_id = ${companyId} AND il.subject_type = 'vendor'
  `)).rows || [];
  for (const l of links as any[]) {
    const s = out.get(l.subject_id);
    if (!s) continue;
    s.linkedUserId = l.user_id;
    s.linkedUserActive = l.link_status === "active" && l.is_active === true;
    if (s.inviteStatus === "none" || s.inviteStatus === "pending") s.inviteStatus = "accepted";
  }
  return out;
}

export async function listVendorsForCompany(companyId: string): Promise<(VendorRow & { portal: VendorPortalStatus })[]> {
  const res = await db.execute(sql`
    SELECT * FROM vendors WHERE company_id = ${companyId} ORDER BY LOWER(business_name) ASC LIMIT 1000
  `);
  const statuses = await loadVendorPortalStatuses(companyId);
  return (res.rows || []).map((r: any) => {
    const v = mapVendor(r);
    return { ...v, portal: statuses.get(v.id) ?? { vendorId: v.id, accessEnabled: v.status === "active", inviteStatus: "none" as const, linkedUserId: null, linkedUserActive: false } };
  });
}

export async function getVendorForCompany(vendorId: string, companyId: string): Promise<VendorRow | null> {
  const r = firstRow<any>(await db.execute(sql`
    SELECT * FROM vendors WHERE id = ${vendorId} AND company_id = ${companyId} LIMIT 1
  `));
  return r ? mapVendor(r) : null;
}

export async function createVendor(companyId: string, input: CleanVendor, createdByUserId: string): Promise<VendorRow> {
  const r = firstRow<any>(await db.execute(sql`
    INSERT INTO vendors
      (company_id, business_name, contact_name, email, phone, address, city, state, zip, tax_id, service_type, notes, status, created_by_user_id)
    VALUES
      (${companyId}, ${input.businessName}, ${input.contactName}, ${input.email}, ${input.phone}, ${input.address},
       ${input.city}, ${input.state}, ${input.zip}, ${input.taxId}, ${input.serviceType}, ${input.notes}, 'active', ${createdByUserId})
    RETURNING *
  `));
  return mapVendor(r);
}

export async function updateVendorContact(
  vendorId: string, companyId: string, patch: CleanVendorPatch,
): Promise<VendorRow | null> {
  const existing = await getVendorForCompany(vendorId, companyId);
  if (!existing) return null;
  const next = {
    businessName: patch.businessName ?? existing.businessName,
    contactName: patch.contactName !== undefined ? patch.contactName : existing.contactName,
    email: patch.email !== undefined ? patch.email : existing.email,
    phone: patch.phone !== undefined ? patch.phone : existing.phone,
    address: patch.address !== undefined ? patch.address : existing.address,
    city: patch.city !== undefined ? patch.city : existing.city,
    state: patch.state !== undefined ? patch.state : existing.state,
    zip: patch.zip !== undefined ? patch.zip : existing.zip,
    serviceType: patch.serviceType !== undefined ? patch.serviceType : existing.serviceType,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
  };
  const r = firstRow<any>(await db.execute(sql`
    UPDATE vendors SET
      business_name = ${next.businessName}, contact_name = ${next.contactName}, email = ${next.email},
      phone = ${next.phone}, address = ${next.address}, city = ${next.city}, state = ${next.state},
      zip = ${next.zip}, service_type = ${next.serviceType}, notes = ${next.notes}, updated_at = NOW()
    WHERE id = ${vendorId} AND company_id = ${companyId}
    RETURNING *
  `));
  return r ? mapVendor(r) : null;
}

/**
 * Enable / disable a vendor's portal access (company-scoped). "Disable" sets
 * vendors.status='inactive', revokes any identity_links for this vendor, and
 * flips the linked users row to is_active=false — the existing login /
 * requireAuth checks already reject an inactive account, so no new enforcement
 * path is introduced.
 */
export async function setVendorAccessEnabled(
  vendorId: string, companyId: string, enabled: boolean,
): Promise<VendorRow | null> {
  const existing = await getVendorForCompany(vendorId, companyId);
  if (!existing) return null;
  try {
    await db.execute(sql`BEGIN`);
    await db.execute(sql`
      UPDATE vendors SET status = ${enabled ? "active" : "inactive"}, updated_at = NOW()
      WHERE id = ${vendorId} AND company_id = ${companyId}
    `);
    await db.execute(sql`
      UPDATE identity_links SET link_status = ${enabled ? "active" : "revoked"},
        revoked_at = CASE WHEN ${enabled}::boolean THEN NULL ELSE NOW() END
      WHERE company_id = ${companyId} AND subject_type = 'vendor' AND subject_id = ${vendorId}
    `);
    await db.execute(sql`
      UPDATE users SET is_active = ${enabled}, invite_status = ${enabled ? "active" : "suspended"}
      WHERE company_id = ${companyId}
        AND id IN (SELECT user_id FROM identity_links WHERE subject_type = 'vendor' AND subject_id = ${vendorId})
    `);
    await db.execute(sql`COMMIT`);
  } catch (e) {
    await db.execute(sql`ROLLBACK`).catch(() => {});
    throw e;
  }
  return getVendorForCompany(vendorId, companyId);
}

/** Create (or refresh) a `vendor` invite for a vendor that has an email on file. */
export async function inviteVendorUser(
  vendorId: string, companyId: string, invitedByUserId: string,
): Promise<{ ok: true; rawToken: string; expiresAt: Date; email: string } | { ok: false; status: number; message: string }> {
  const vendor = await getVendorForCompany(vendorId, companyId);
  if (!vendor) return { ok: false, status: 404, message: "Vendor not found" };
  const email = vendor.email ? normalizeEmail(vendor.email) : null;
  if (!email) return { ok: false, status: 400, message: "Add an email address to the vendor before inviting them." };
  if (vendor.status !== "active") return { ok: false, status: 409, message: "Re-enable vendor access before sending an invite." };
  const inv = await createOrRefreshInvite({
    companyId, email, relationshipKind: "vendor", relationshipId: vendorId,
    role: "vendor", invitedByUserId,
  });
  return { ok: true, rawToken: inv.rawToken, expiresAt: inv.expiresAt, email };
}

// ── Vendor portal: resolve the acting user's own vendor ─────────────────────

export interface VendorContext {
  vendorId: string;
  companyId: string;
}

/**
 * The single vendor a logged-in user is allowed to act as. An ACTIVE
 * identity_links row with subject_type='vendor' is the only binding; a revoked
 * link or a missing/inactive vendor yields null (→ 403 at the route).
 */
export async function resolveVendorForUser(userId: string): Promise<VendorContext | null> {
  const r = firstRow<any>(await db.execute(sql`
    SELECT v.id AS vendor_id, v.company_id
    FROM identity_links il
    JOIN vendors v ON v.id = il.subject_id AND v.company_id = il.company_id
    WHERE il.user_id = ${userId} AND il.subject_type = 'vendor'
      AND il.link_status = 'active' AND v.status = 'active'
    ORDER BY il.created_at ASC
    LIMIT 1
  `));
  return r ? { vendorId: r.vendor_id, companyId: r.company_id } : null;
}

// ── Vendor submissions (invoices + documents) ──────────────────────────────

export interface StoredFile {
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string | null;
}

export async function createVendorInvoiceSubmission(
  ctx: VendorContext, userId: string, input: CleanVendorInvoice, file: StoredFile | null,
): Promise<any> {
  const r = firstRow<any>(await db.execute(sql`
    INSERT INTO vendor_invoices
      (vendor_id, company_id, invoice_number, amount, currency, invoice_date, due_date, description,
       status, file_name, file_url, file_size, mime_type, submitted_by_user_id)
    VALUES
      (${ctx.vendorId}, ${ctx.companyId}, ${input.invoiceNumber}, ${input.amount}, ${input.currency},
       ${input.invoiceDate}, ${input.dueDate}, ${input.description}, 'submitted',
       ${file?.fileName ?? null}, ${file?.fileUrl ?? null}, ${file?.fileSize ?? null}, ${file?.mimeType ?? null}, ${userId})
    RETURNING *
  `));
  return r;
}

export async function createVendorDocumentSubmission(
  ctx: VendorContext, userId: string, documentType: string, notes: string | null, file: StoredFile,
): Promise<any> {
  const r = firstRow<any>(await db.execute(sql`
    INSERT INTO vendor_documents
      (vendor_id, company_id, document_type, file_name, file_url, file_size, mime_type, notes, uploaded_by_user_id)
    VALUES
      (${ctx.vendorId}, ${ctx.companyId}, ${documentType}, ${file.fileName}, ${file.fileUrl},
       ${file.fileSize}, ${file.mimeType}, ${notes}, ${userId})
    RETURNING *
  `));
  return r;
}

export async function listSubmissionsForVendor(ctx: VendorContext): Promise<{ invoices: any[]; documents: any[] }> {
  const invoices = (await db.execute(sql`
    SELECT id, invoice_number, amount, currency, invoice_date, due_date, description, status,
           file_name, review_note, reviewed_at, created_at
    FROM vendor_invoices WHERE vendor_id = ${ctx.vendorId} AND company_id = ${ctx.companyId}
    ORDER BY created_at DESC LIMIT 500
  `)).rows || [];
  const documents = (await db.execute(sql`
    SELECT id, document_type, file_name, notes, status, review_note, reviewed_at, created_at
    FROM vendor_documents WHERE vendor_id = ${ctx.vendorId} AND company_id = ${ctx.companyId}
    ORDER BY created_at DESC LIMIT 500
  `)).rows || [];
  return { invoices, documents };
}

// ── Admin: review vendor submissions (status only — no ledger side effects) ──

export async function listPendingVendorSubmissionsForCompany(companyId: string): Promise<{ invoices: any[]; documents: any[] }> {
  const invoices = (await db.execute(sql`
    SELECT vi.*, v.business_name
    FROM vendor_invoices vi JOIN vendors v ON v.id = vi.vendor_id
    WHERE vi.company_id = ${companyId}
    ORDER BY (vi.status = 'submitted') DESC, vi.created_at DESC
    LIMIT 500
  `)).rows || [];
  const documents = (await db.execute(sql`
    SELECT vd.*, v.business_name
    FROM vendor_documents vd JOIN vendors v ON v.id = vd.vendor_id
    WHERE vd.company_id = ${companyId}
    ORDER BY vd.created_at DESC
    LIMIT 500
  `)).rows || [];
  return { invoices, documents };
}

const INVOICE_STATUSES = new Set(["submitted", "approved", "rejected", "needs_info"]);

/**
 * Set a vendor invoice's review status. PR 3 scope: this ONLY writes to
 * vendor_invoices (status / reviewer / note). It never creates an expense,
 * expense_payment, check, contractor_payment, or any ledger row.
 */
export async function reviewVendorInvoice(
  invoiceId: string, companyId: string, reviewerUserId: string, status: string, note: string | null,
): Promise<{ ok: true; row: any } | { ok: false; status: number; message: string }> {
  if (!INVOICE_STATUSES.has(status)) return { ok: false, status: 400, message: "Unknown review status." };
  const existing = firstRow<any>(await db.execute(sql`
    SELECT id FROM vendor_invoices WHERE id = ${invoiceId} AND company_id = ${companyId} LIMIT 1
  `));
  if (!existing) return { ok: false, status: 404, message: "Invoice not found" };
  const row = firstRow<any>(await db.execute(sql`
    UPDATE vendor_invoices
    SET status = ${status}, review_note = ${note}, reviewed_by_user_id = ${reviewerUserId},
        reviewed_at = NOW(), updated_at = NOW()
    WHERE id = ${invoiceId} AND company_id = ${companyId}
    RETURNING *
  `));
  return { ok: true, row };
}

const DOC_REVIEW_STATUSES = new Set(["received", "approved", "rejected"]);

export async function reviewVendorDocument(
  documentId: string, companyId: string, reviewerUserId: string, status: string, note: string | null,
): Promise<{ ok: true; row: any } | { ok: false; status: number; message: string }> {
  if (!DOC_REVIEW_STATUSES.has(status)) return { ok: false, status: 400, message: "Unknown review status." };
  const existing = firstRow<any>(await db.execute(sql`
    SELECT id FROM vendor_documents WHERE id = ${documentId} AND company_id = ${companyId} LIMIT 1
  `));
  if (!existing) return { ok: false, status: 404, message: "Document not found" };
  // Review writes status / review_note / reviewer only — the vendor's own
  // `notes` from upload is left untouched. No ledger/payment effect.
  const row = firstRow<any>(await db.execute(sql`
    UPDATE vendor_documents
    SET status = ${status}, review_note = ${note}, reviewed_by_user_id = ${reviewerUserId}, reviewed_at = NOW()
    WHERE id = ${documentId} AND company_id = ${companyId}
    RETURNING *
  `));
  return { ok: true, row };
}
