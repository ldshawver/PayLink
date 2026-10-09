/**
 * Stored-Resource Ownership Guard — server/auth/stored-resource-guard.ts
 *
 * Pure (DB-free) authorization decisions for SaaS PR 2: company-scoped LIST
 * endpoints and by-id operations on financial, payroll, employment and
 * personal-data resources.
 *
 * Closes the SaaS readiness audit's live-confirmed cross-tenant defects:
 *  - list endpoints that honoured any ?companyId (and returned EVERY tenant's
 *    rows when it was omitted) — remittance sources (bank routing/account
 *    numbers), payroll runs, expenses, customers;
 *  - by-id reads/writes that never compared the STORED owning company with the
 *    actor (pay methods, payroll items, payroll-run taxes/ACH, 1099 summaries,
 *    time punches, time-off requests, compliance worker records, users);
 *  - the systemic "user.companyId && …" guard shape that let a company-less
 *    non-platform user skip the company comparison entirely.
 *
 * Invariants:
 *  - a missing companyId NEVER means "all tenants" for a non-platform actor;
 *  - a supplied companyId is authorized (canAccessCompany) BEFORE any query;
 *  - a company-less non-platform actor is not a platform actor;
 *  - by-id operations authorize the owner resolved from the stored record,
 *    never a companyId taken from the request.
 *
 * Design mirrors org-ownership-guard.ts: route helpers resolve the DB facts
 * (platform role, stored owner, canAccessCompany results) and pass plain values
 * in, so every decision is unit-testable without a database.
 */

export interface GuardDenial {
  allowed: false;
  status: number;
  message: string;
}

/**
 * Normalizes a client-supplied list companyId. Absent, blank, non-string
 * (e.g. a repeated query param) and the UI's "all" sentinel all mean
 * "not supplied" — which then resolves to the actor's own scope, never to
 * every tenant (only a platform actor on an endpoint that allows it gets that).
 */
export function normalizeListCompanyId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v || v === "all") return undefined;
  return v;
}

export interface ListScopeInput {
  /** isPlatformCompanyBypassRole(actor.role). */
  isPlatform: boolean;
  /** normalizeListCompanyId(req.query.companyId). */
  requestedCompanyId: string | undefined;
  /** canAccessCompany(actor, requestedCompanyId) — only meaningful when one was supplied. */
  requestedAccessible: boolean;
  /**
   * The actor's default company: their home company (resolveTenantCompanyId), or
   * — for a company-less user — their single explicit company_user_access grant.
   * null when neither resolves unambiguously.
   */
  defaultCompanyId: string | null;
  /** Whether this endpoint intentionally lets a platform actor list every company. */
  allowPlatformAll: boolean;
}

export type ListScopeDecision =
  | { allowed: true; /** undefined = every company (platform only). */ companyId: string | undefined }
  | GuardDenial;

export function decideListScope(input: ListScopeInput): ListScopeDecision {
  if (input.requestedCompanyId !== undefined) {
    if (input.isPlatform || input.requestedAccessible) {
      return { allowed: true, companyId: input.requestedCompanyId };
    }
    return { allowed: false, status: 403, message: "You do not have access to this company" };
  }
  if (input.isPlatform) {
    if (input.allowPlatformAll) return { allowed: true, companyId: undefined };
    return { allowed: false, status: 400, message: "companyId is required" };
  }
  if (input.defaultCompanyId) return { allowed: true, companyId: input.defaultCompanyId };
  return { allowed: false, status: 403, message: "Your account is not scoped to a company" };
}

export interface StoredResourceInput {
  /** Whether the resource exists. */
  exists: boolean;
  /** The resource's STORED owning company (resolved server-side). */
  storedCompanyId: string | null | undefined;
  /** isPlatformCompanyBypassRole(actor.role). */
  isPlatform: boolean;
  /** canAccessCompany(actor, storedCompanyId) — only meaningful for a non-null owner. */
  storedAccessible: boolean;
  /** Human label used in the 404 message ("Payroll run", "Pay method", …). */
  label?: string;
}

export type StoredResourceDecision = { allowed: true } | GuardDenial;

/**
 * resource id → load → STORED owner → canAccessCompany → operate.
 * A resource whose owner cannot be resolved is platform-only: a NULL owner is
 * never treated as "shared with every tenant" here.
 */
export function decideStoredResourceAccess(input: StoredResourceInput): StoredResourceDecision {
  if (!input.exists) return { allowed: false, status: 404, message: `${input.label ?? "Resource"} not found` };
  if (input.isPlatform) return { allowed: true };
  if (!input.storedCompanyId) {
    return { allowed: false, status: 403, message: "Forbidden: this record is not owned by your company" };
  }
  if (input.storedAccessible) return { allowed: true };
  return { allowed: false, status: 403, message: "Forbidden: this record belongs to a different company" };
}

/**
 * Fields a by-id PATCH must never write from the request body: identity,
 * ownership / re-parenting links and server-maintained audit stamps. Callers
 * strip these before calling storage.update*(id, body).
 */
export const OWNERSHIP_IMMUTABLE_FIELDS: readonly string[] = [
  "id", "companyId", "workerId", "payrollRunId", "payrollItemId", "userId",
  "createdAt", "createdBy",
];

export function stripOwnershipFields(
  body: unknown,
  extra: readonly string[] = [],
): Record<string, any> {
  const out: Record<string, any> = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return out;
  const blocked = new Set<string>([...OWNERSHIP_IMMUTABLE_FIELDS, ...extra]);
  for (const [k, v] of Object.entries(body)) {
    if (!blocked.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Minimal worker projection for the worker-compliance tab. The client reads
 * only identity and workerType from `worker`; the full row (SSN, bank, tax,
 * address, pay) must not be returned by a compliance read.
 */
export function toComplianceWorker(w: {
  id: string; companyId?: string | null; firstName?: string | null; lastName?: string | null;
  workerType?: string | null; employeeNumber?: string | null; status?: string | null;
}) {
  return {
    id: w.id,
    companyId: w.companyId ?? null,
    firstName: w.firstName ?? null,
    lastName: w.lastName ?? null,
    workerType: w.workerType ?? null,
    employeeNumber: w.employeeNumber ?? null,
    status: w.status ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SaaS PR 2B — supplied-companyId gate + table-driven stored owners
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sentinels that mean "not a specific company" in client payloads. They are not
 * authorized here; each route decides what (if anything) they mean.
 */
const NON_COMPANY_SENTINELS = new Set(["all", "__universal__", "null", "undefined"]);

/**
 * Every company id a request explicitly names in ?companyId / ?company_id or the
 * top-level JSON body's companyId / company_id. Non-strings, blanks and the
 * sentinels above are ignored.
 */
export function extractSuppliedCompanyIds(query: unknown, body: unknown): string[] {
  const out = new Set<string>();
  const take = (v: unknown) => {
    if (typeof v !== "string") return;
    const s = v.trim();
    if (s && !NON_COMPANY_SENTINELS.has(s)) out.add(s);
  };
  for (const src of [query, body]) {
    if (!src || typeof src !== "object" || Array.isArray(src)) continue;
    take((src as any).companyId);
    take((src as any).company_id);
  }
  return Array.from(out);
}

/**
 * Mount-relative /api path prefixes whose writes may legitimately name a
 * scheduling-only (enterprise sibling) company — cross-company scheduling is
 * the one capability enterprise reach grants (SaaS PR 1).
 */
export const SCHEDULING_WRITE_PREFIXES: readonly string[] = [
  "/schedules", "/shift-offers", "/recurring-schedules", "/marketplace/",
];

/**
 * Paths the supplied-companyId gate does not inspect: unauthenticated/public
 * flows and portals that authenticate by token, plus vendor-portal (already
 * confined to its own payer company by the vendor middleware).
 */
export const SUPPLIED_COMPANY_GATE_EXEMPT_PREFIXES: readonly string[] = [
  "/auth/", "/portal/", "/account-invites/", "/contractor-signup", "/trial/signup",
  "/demo/provision", "/webhooks/", "/pay/", "/time-clock/", "/signing/contracts/",
  "/public/sign/contracts/", "/vendor-portal/", "/analytics/event", "/license/request",
];

export interface SuppliedCompanyInput {
  /** HTTP method. */
  method: string;
  /** Mount-relative path (req.path inside app.use("/api")). */
  path: string;
  /** isPlatformCompanyBypassRole(actor.role). */
  isPlatform: boolean;
  /** Per supplied id: canAccessCompany(actor, id). */
  general: Record<string, boolean>;
  /** Per supplied id: canScheduleIntoCompany(actor, id). */
  scheduling: Record<string, boolean>;
}

/**
 * The global "a supplied companyId is authorized BEFORE the handler runs" rule.
 * - reads: general access or scheduling reach (sensitive lists are additionally
 *   scoped per route with resolveListScope, which accepts general access only);
 * - writes: general access, or scheduling reach on a scheduling path only.
 */
export function decideSuppliedCompanyAccess(input: SuppliedCompanyInput): { allowed: true } | GuardDenial {
  if (input.isPlatform) return { allowed: true };
  const isRead = input.method === "GET" || input.method === "HEAD" || input.method === "OPTIONS";
  const schedulingPath = SCHEDULING_WRITE_PREFIXES.some((p) => input.path === p || input.path.startsWith(p.endsWith("/") ? p : p + "/") || input.path.startsWith(p + "?"));
  for (const id of Object.keys(input.general)) {
    if (input.general[id]) continue;
    if (input.scheduling[id] && (isRead || schedulingPath)) continue;
    return { allowed: false, status: 403, message: "You do not have access to this company" };
  }
  return { allowed: true };
}

/**
 * Stored-owner resolution for by-id resources (SaaS PR 2B). Each entry is the
 * SQL expression, evaluated against the row aliased `r`, that yields the
 * owning company. Derived owners fall back to the parent / worker / creator
 * when a nullable company_id is NULL; a still-NULL owner is platform-only.
 * Table and expression strings are compile-time constants (never request data).
 */
export const OWNED_RESOURCES = {
  accrualAccount:        { table: "accrual_accounts", owner: "r.company_id", label: "Accrual account" },
  accrualPolicy:         { table: "accrual_policies", owner: "r.company_id", label: "Accrual policy" },
  accrualPolicyMilestone:{ table: "accrual_policy_milestones", owner: "(SELECT p.company_id FROM accrual_policies p WHERE p.id = r.accrual_policy_id)", label: "Milestone" },
  appDoctorReport:       { table: "app_doctor_reports", owner: "r.company_id", label: "Report" },
  bizDocumentItem:       { table: "biz_document_items", owner: "(SELECT d.company_id FROM biz_documents d WHERE d.id = r.document_id)", label: "Item" },
  bizDocumentAttachment: { table: "biz_document_attachments", owner: "(SELECT d.company_id FROM biz_documents d WHERE d.id = r.document_id)", label: "Attachment" },
  contractorContract:    { table: "contractor_contracts", owner: "COALESCE(r.company_id, (SELECT w.company_id FROM workers w WHERE w.id = r.contractor_id))", label: "Contract" },
  contractorInvoice:     { table: "contractor_invoices", owner: "COALESCE(r.company_id, (SELECT w.company_id FROM workers w WHERE w.id = r.contractor_id))", label: "Invoice" },
  contractorProposal:    { table: "contractor_proposals", owner: "COALESCE(r.company_id, (SELECT w.company_id FROM workers w WHERE w.id = r.contractor_id))", label: "Proposal" },
  contributingPayCode:   { table: "contributing_pay_codes", owner: "r.company_id", label: "Contributing pay code" },
  documentFolder:        { table: "document_folders", owner: "r.company_id", label: "Folder" },
  documentRetentionPolicy:{ table: "document_retention_policies", owner: "r.company_id", label: "Policy" },
  employeeGroup:         { table: "employee_groups", owner: "r.company_id", label: "Employee group" },
  employeeTitle:         { table: "employee_titles", owner: "r.company_id", label: "Employee title" },
  employeeWageGroup:     { table: "employee_wage_groups", owner: "(SELECT w.company_id FROM workers w WHERE w.id = r.worker_id)", label: "Wage group assignment" },
  invoiceApprovalWorkflow:{ table: "invoice_approval_workflows", owner: "r.company_id", label: "Workflow" },
  invoiceTemplate:       { table: "invoice_templates", owner: "r.company_id", label: "Template" },
  overtimePolicy:        { table: "overtime_policies", owner: "r.company_id", label: "Overtime policy" },
  payCode:               { table: "pay_codes", owner: "r.company_id", label: "Pay code" },
  payFormula:            { table: "pay_formulas", owner: "r.company_id", label: "Pay formula" },
  payPeriodSchedule:     { table: "pay_period_schedules", owner: "r.company_id", label: "Pay period schedule" },
  payPeriod:             { table: "pay_periods", owner: "r.company_id", label: "Pay period" },
  payStubAccount:        { table: "pay_stub_accounts", owner: "r.company_id", label: "Pay stub account" },
  payStubAmendment:      { table: "pay_stub_amendments", owner: "r.company_id", label: "Pay stub amendment" },
  payStubTransaction:    { table: "pay_stub_transactions", owner: "r.company_id", label: "Pay stub transaction" },
  paymentMethodConfig:   { table: "payment_method_configs", owner: "r.company_id", label: "Payment method config" },
  payrollReimbursement:  { table: "payroll_reimbursement_items", owner: "COALESCE(r.company_id, (SELECT w.company_id FROM workers w WHERE w.id = r.worker_id))", label: "Reimbursement" },
  recurringExpense:      { table: "recurring_expense_templates", owner: "r.company_id", label: "Recurring expense" },
  recurringSchedule:     { table: "recurring_schedules", owner: "r.company_id", label: "Recurring schedule" },
  regularTimePolicy:     { table: "regular_time_policies", owner: "r.company_id", label: "Regular time policy" },
  savedReport:           { table: "saved_reports", owner: "COALESCE(r.company_id, (SELECT u.company_id FROM users u WHERE u.username = r.created_by LIMIT 1))", label: "Report" },
  schedulePolicy:        { table: "schedule_policies", owner: "r.company_id", label: "Schedule policy" },
  schedulePreference:    { table: "schedule_preferences", owner: "r.company_id", label: "Schedule preference" },
  secondaryWageGroup:    { table: "secondary_wage_groups", owner: "r.company_id", label: "Secondary wage group" },
  taxFilingSnapshot:     { table: "tax_filing_snapshots", owner: "r.company_id", label: "Snapshot" },
  taxDeduction:          { table: "taxes_deductions", owner: "r.company_id", label: "Tax/deduction" },
  workerAgreement:       { table: "worker_agreements", owner: "r.company_id", label: "Agreement" },
  workerLanguage:        { table: "worker_languages", owner: "COALESCE(r.company_id, (SELECT w.company_id FROM workers w WHERE w.id = r.worker_id))", label: "Language" },
  workerOnboarding:      { table: "worker_onboarding", owner: "r.company_id", label: "Onboarding" },
  premiumPolicy:         { table: "premium_policies", owner: "r.company_id", label: "Premium policy" },
  mealPolicy:            { table: "meal_policies", owner: "r.company_id", label: "Meal policy" },
  breakPolicy:           { table: "break_policies", owner: "r.company_id", label: "Break policy" },
  exceptionPolicy:       { table: "exception_policies", owner: "r.company_id", label: "Exception policy" },
  absencePolicy:         { table: "absence_policies", owner: "r.company_id", label: "Absence policy" },
  holidayPolicy:         { table: "holiday_policies", owner: "r.company_id", label: "Holiday policy" },
  roundingPolicy:        { table: "rounding_policies", owner: "r.company_id", label: "Rounding policy" },
  contributingShift:     { table: "contributing_shifts", owner: "r.company_id", label: "Contributing shift" },
  worker:                { table: "workers", owner: "r.company_id", label: "Worker" },
  user:                  { table: "users", owner: "r.company_id", label: "User" },
} as const;

export type OwnedResourceKind = keyof typeof OWNED_RESOURCES;

/**
 * Same as decideStoredResourceAccess, plus a self-owned exception: the
 * contractor / worker the record belongs to may reach it (their own invoice,
 * proposal, notification preferences, …) regardless of company grants.
 */
export function decideOwnedOrSelfAccess(input: StoredResourceInput & { isSelf: boolean }): StoredResourceDecision {
  if (input.exists && input.isSelf) return { allowed: true };
  return decideStoredResourceAccess(input);
}
