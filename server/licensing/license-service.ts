/**
 * DB-facing side of the tenant license model — server/licensing/license-service.ts
 *
 * PR 4 of the SaaS identity/onboarding architecture cleanup.
 *
 * Everything here is company-scoped by an explicit `companyId` argument. The
 * pure display logic lives in ./license-resolver.ts; the narrow opt-in gate in
 * ./license-gate.ts.
 *
 * SPLIT-BRAIN RULE (enforced by adminUpsertLicense):
 *   `companies.subscription_status` + trial/grace columns remain the
 *   AUTHORITATIVE enforcement state read by checkTenantGate() /
 *   requireActiveSubscription. Any admin action that changes a company's
 *   effective access MUST update those columns (same UPDATE pattern as the
 *   existing POST /api/platform/audit/licensing/:companyId/gate-override route)
 *   in the SAME transaction that writes the tenant_licenses mirror + audit
 *   event. tenant_licenses is never allowed to drift from the company columns
 *   for a status that maps to an access change.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { checkTenantGate, type TenantGateResult } from "../tenant-enforcement";
import {
  resolveLicense,
  normalizeLicenseStatus,
  LICENSE_STATUSES,
  type ResolvedLicense,
  type LicenseStatus,
  type TenantLicenseInput,
  type CompanyGateInput,
} from "./license-resolver";

type Exec = { execute: (q: any) => Promise<{ rows: any[] }> };

function firstRow<T = any>(res: any): T | undefined {
  return (res?.rows?.[0] as T | undefined) ?? undefined;
}

export interface TenantLicenseRow {
  id: string;
  company_id: string;
  tenant_id: string | null;
  plan_type: string;
  status: string;
  trial_start: string | null;
  trial_end: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  source: string;
  external_ref: string | null;
  notes: string | null;
  status_reason: string | null;
  status_changed_at: string | null;
  status_changed_by_user_id: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActorInfo {
  userId: string | null;
  role: string | null;
}

/** normalized license status → the authoritative companies.subscription_status
 *  spelling used by checkTenantGate() / requireActiveSubscription. */
const STATUS_TO_COMPANY: Record<LicenseStatus, string> = {
  trialing: "trial_active",
  active: "active_paid",
  expired: "trial_expired",
  suspended: "suspended",
  cancelled: "cancelled",
  inactive: "suspended",
};

// ── Reads ───────────────────────────────────────────────────────────────────

export async function getTenantLicenseRow(
  companyId: string,
  exec: Exec = db,
): Promise<TenantLicenseRow | null> {
  if (!companyId) return null;
  const res = await exec.execute(
    sql`SELECT * FROM tenant_licenses WHERE company_id = ${companyId} LIMIT 1`,
  );
  return firstRow<TenantLicenseRow>(res) ?? null;
}

export async function loadCompanyGate(
  companyId: string,
  exec: Exec = db,
): Promise<CompanyGateInput | null> {
  if (!companyId) return null;
  const res = await exec.execute(sql`
    SELECT subscription_status, plan_name, trial_start, trial_end, billing_active,
           grace_period_end, gate_override_reason, is_demo
    FROM companies WHERE id = ${companyId} LIMIT 1
  `);
  const c = firstRow<any>(res);
  if (!c) return null;
  return {
    subscriptionStatus: c.subscription_status ?? null,
    planName: c.plan_name ?? null,
    trialStart: c.trial_start ?? null,
    trialEnd: c.trial_end ?? null,
    billingActive: c.billing_active ?? null,
    gracePeriodEnd: c.grace_period_end ?? null,
    gateOverrideReason: c.gate_override_reason ?? null,
    isDemo: c.is_demo ?? null,
  };
}

function rowToLicenseInput(row: TenantLicenseRow | null): TenantLicenseInput | null {
  if (!row) return null;
  return {
    status: row.status,
    planType: row.plan_type,
    trialStart: row.trial_start,
    trialEnd: row.trial_end,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    source: row.source,
  };
}

export interface CompanyLicenseView {
  companyId: string;
  resolved: ResolvedLicense;
  /** Authoritative access decision — from the UNCHANGED legacy gate. */
  gate: TenantGateResult;
  record: TenantLicenseRow | null;
}

/**
 * The one call the API surface should use. Combines:
 *   - the pure resolver (display status, trial window, plan) and
 *   - checkTenantGate() (the authoritative allow/block — UNCHANGED by PR 4).
 */
export async function resolveCompanyLicense(
  companyId: string,
  exec: Exec = db,
): Promise<CompanyLicenseView> {
  const [record, gate, gateResult] = await Promise.all([
    getTenantLicenseRow(companyId, exec),
    loadCompanyGate(companyId, exec),
    checkTenantGate(companyId),
  ]);
  const resolved = resolveLicense(rowToLicenseInput(record), gate);
  return { companyId, resolved, gate: gateResult, record };
}

export async function listCompanyLicenses(
  exec: Exec = db,
): Promise<Array<{
  companyId: string;
  companyName: string;
  isDemo: boolean;
  subscriptionStatus: string | null;
  record: TenantLicenseRow | null;
  resolved: ResolvedLicense;
}>> {
  const res = await exec.execute(sql`
    SELECT c.id, c.name, c.is_demo, c.subscription_status, c.plan_name,
           c.trial_start, c.trial_end, c.billing_active, c.grace_period_end,
           c.gate_override_reason,
           tl.id AS tl_id, tl.company_id AS tl_company_id, tl.tenant_id AS tl_tenant_id,
           tl.plan_type, tl.status AS tl_status, tl.trial_start AS tl_trial_start,
           tl.trial_end AS tl_trial_end, tl.current_period_start, tl.current_period_end,
           tl.source, tl.external_ref, tl.notes, tl.status_reason,
           tl.status_changed_at, tl.status_changed_by_user_id,
           tl.created_by_user_id, tl.updated_by_user_id,
           tl.created_at AS tl_created_at, tl.updated_at AS tl_updated_at
    FROM companies c
    LEFT JOIN tenant_licenses tl ON tl.company_id = c.id
    ORDER BY c.name ASC
  `);
  return (res.rows as any[]).map((r) => {
    const record: TenantLicenseRow | null = r.tl_id
      ? {
          id: r.tl_id,
          company_id: r.tl_company_id,
          tenant_id: r.tl_tenant_id ?? null,
          plan_type: r.plan_type,
          status: r.tl_status,
          trial_start: r.tl_trial_start ?? null,
          trial_end: r.tl_trial_end ?? null,
          current_period_start: r.current_period_start ?? null,
          current_period_end: r.current_period_end ?? null,
          source: r.source,
          external_ref: r.external_ref ?? null,
          notes: r.notes ?? null,
          status_reason: r.status_reason ?? null,
          status_changed_at: r.status_changed_at ?? null,
          status_changed_by_user_id: r.status_changed_by_user_id ?? null,
          created_by_user_id: r.created_by_user_id ?? null,
          updated_by_user_id: r.updated_by_user_id ?? null,
          created_at: r.tl_created_at,
          updated_at: r.tl_updated_at,
        }
      : null;
    const gate: CompanyGateInput = {
      subscriptionStatus: r.subscription_status ?? null,
      planName: r.plan_name ?? null,
      trialStart: r.trial_start ?? null,
      trialEnd: r.trial_end ?? null,
      billingActive: r.billing_active ?? null,
      gracePeriodEnd: r.grace_period_end ?? null,
      gateOverrideReason: r.gate_override_reason ?? null,
      isDemo: r.is_demo ?? null,
    };
    return {
      companyId: r.id,
      companyName: r.name,
      isDemo: !!r.is_demo,
      subscriptionStatus: r.subscription_status ?? null,
      record,
      resolved: resolveLicense(rowToLicenseInput(record), gate),
    };
  });
}

export async function getLicenseEvents(
  companyId: string,
  limit = 50,
  exec: Exec = db,
): Promise<any[]> {
  const res = await exec.execute(sql`
    SELECT * FROM tenant_license_events
    WHERE company_id = ${companyId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  return res.rows ?? [];
}

// ── Writes ──────────────────────────────────────────────────────────────────

async function recordEvent(
  exec: Exec,
  args: {
    licenseId: string | null;
    companyId: string;
    eventType: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    fromPlan?: string | null;
    toPlan?: string | null;
    reason?: string | null;
    actor: ActorInfo;
    metadata?: Record<string, any> | null;
  },
): Promise<void> {
  await exec.execute(sql`
    INSERT INTO tenant_license_events
      (license_id, company_id, event_type, from_status, to_status, from_plan, to_plan,
       reason, actor_user_id, actor_role, metadata)
    VALUES
      (${args.licenseId}, ${args.companyId}, ${args.eventType}, ${args.fromStatus ?? null},
       ${args.toStatus ?? null}, ${args.fromPlan ?? null}, ${args.toPlan ?? null},
       ${args.reason ?? null}, ${args.actor.userId ?? "system"}, ${args.actor.role ?? null},
       ${args.metadata ? JSON.stringify(args.metadata) : null})
  `);
}

/**
 * Create a `tenant_licenses` row for a company that does not have one, WITHOUT
 * changing any access state. No-op (returns the existing row) when a row is
 * already present. Safe to call inside another transaction — pass that
 * transaction's executor as `exec`.
 *
 * Used by POST /api/trial/signup so a brand-new trial company gets a structured
 * license record atomically with the rest of its provisioning.
 */
export async function ensureTrialLicense(
  companyId: string,
  opts: {
    tenantId?: string | null;
    planType?: string | null;
    trialStart?: Date | string | null;
    trialEnd?: Date | string | null;
    source?: string;
    actor?: ActorInfo;
  },
  exec: Exec = db,
): Promise<{ created: boolean; row: TenantLicenseRow | null }> {
  if (!companyId) return { created: false, row: null };
  const actor = opts.actor ?? { userId: "system", role: null };
  const planType = opts.planType ?? "starter";
  const source = opts.source ?? "trial_signup";

  const res = await exec.execute(sql`
    INSERT INTO tenant_licenses
      (company_id, tenant_id, plan_type, status, trial_start, trial_end, source,
       created_by_user_id, updated_by_user_id, status_changed_at, status_changed_by_user_id,
       status_reason)
    VALUES
      (${companyId}, ${opts.tenantId ?? null}, ${planType}, 'trialing',
       ${opts.trialStart ?? null}, ${opts.trialEnd ?? null}, ${source},
       ${actor.userId ?? "system"}, ${actor.userId ?? "system"}, NOW(),
       ${actor.userId ?? "system"}, 'trial signup')
    ON CONFLICT (company_id) DO NOTHING
    RETURNING *
  `);
  const row = firstRow<TenantLicenseRow>(res) ?? null;
  if (row) {
    await recordEvent(exec, {
      licenseId: row.id,
      companyId,
      eventType: "created",
      toStatus: "trialing",
      toPlan: planType,
      reason: "trial signup",
      actor,
      metadata: { source },
    });
    return { created: true, row };
  }
  return { created: false, row: await getTenantLicenseRow(companyId, exec) };
}

export interface AdminLicensePatch {
  status?: string;
  planType?: string;
  trialEnd?: string | null;
  notes?: string | null;
  reason?: string | null;
}

export class LicenseValidationError extends Error {
  status = 400;
}
export class CompanyNotFoundError extends Error {
  status = 404;
}

/**
 * Platform-admin license mutation. Runs in ONE transaction and keeps the
 * `companies` gate columns and the `tenant_licenses` mirror consistent:
 *
 *   1. validate the requested status/plan
 *   2. if `status` changes the effective access state → UPDATE companies
 *      SET subscription_status = <mapped>, gate_override_reason = <reason>
 *      (identical to the existing gate-override route)
 *   3. UPSERT the tenant_licenses row (structured mirror + metadata)
 *   4. INSERT a tenant_license_events audit row
 *   5. INSERT an authorization_audit_log row (matches billingLifecycle.ts
 *      convention so the platform billing/lifecycle audit surfaces see it)
 *
 * All-or-nothing.
 */
export async function adminUpsertLicense(
  companyId: string,
  patch: AdminLicensePatch,
  actor: ActorInfo,
): Promise<{ record: TenantLicenseRow; companyStatusChanged: boolean; companyStatus: string | null }> {
  // Admin input is validated STRICTLY against the canonical vocabulary (plus a
  // couple of legacy spellings). Unlike the resolver's defensive
  // normalizeLicenseStatus() — which coerces an unknown *stored* value to
  // 'inactive' so a bad row still reads conservatively — a bad value from an
  // admin form must be rejected, never silently coerced into a blocking status.
  const STRICT_STATUS_INPUT: Record<string, (typeof LICENSE_STATUSES)[number]> = {
    trialing: "trialing", active: "active", expired: "expired",
    suspended: "suspended", cancelled: "cancelled", inactive: "inactive",
    trial: "trialing", trial_active: "trialing", trial_expired: "expired",
    active_paid: "active", canceled: "cancelled",
  };
  let wantStatus: (typeof LICENSE_STATUSES)[number] | undefined;
  if (patch.status != null && `${patch.status}`.trim() !== "") {
    const key = `${patch.status}`.trim().toLowerCase();
    if (!(key in STRICT_STATUS_INPUT)) {
      throw new LicenseValidationError(
        `Invalid license status: ${patch.status}. Expected one of: ${LICENSE_STATUSES.join(", ")}`,
      );
    }
    wantStatus = STRICT_STATUS_INPUT[key];
  }
  if (patch.planType != null && !`${patch.planType}`.trim()) {
    throw new LicenseValidationError("planType cannot be blank");
  }

  return db.transaction(async (tx) => {
    const exec = tx as unknown as Exec;

    const compRes = await exec.execute(sql`
      SELECT id, subscription_status, plan_name, trial_end FROM companies WHERE id = ${companyId} LIMIT 1
    `);
    const company = firstRow<any>(compRes);
    if (!company) throw new CompanyNotFoundError("Company not found");

    const existing = await getTenantLicenseRow(companyId, exec);
    const fromStatus = existing ? normalizeLicenseStatus(existing.status) : null;
    const fromPlan = existing?.plan_type ?? company.plan_name ?? null;
    const toStatus = wantStatus ?? fromStatus ?? "active";
    const toPlan = patch.planType ?? fromPlan ?? "starter";
    const reason = (patch.reason ?? "").trim() || null;

    // ── 2. company gate columns (authoritative) ──────────────────────────────
    let companyStatusChanged = false;
    let companyStatus: string | null = company.subscription_status ?? null;
    if (wantStatus) {
      const mapped = STATUS_TO_COMPANY[wantStatus];
      if (mapped && mapped !== company.subscription_status) {
        await exec.execute(sql`
          UPDATE companies
          SET subscription_status = ${mapped},
              gate_override_reason = ${reason}
          WHERE id = ${companyId}
        `);
        companyStatusChanged = true;
        companyStatus = mapped;
      } else if (reason) {
        await exec.execute(sql`
          UPDATE companies SET gate_override_reason = ${reason} WHERE id = ${companyId}
        `);
      }
    }

    // ── 3. tenant_licenses mirror ────────────────────────────────────────────
    const statusChangeClause = wantStatus && wantStatus !== fromStatus;
    const upsertRes = await exec.execute(sql`
      INSERT INTO tenant_licenses
        (company_id, plan_type, status, trial_end, notes, source, status_reason,
         status_changed_at, status_changed_by_user_id, created_by_user_id, updated_by_user_id)
      VALUES
        (${companyId}, ${toPlan}, ${toStatus}, ${patch.trialEnd ?? null}, ${patch.notes ?? null},
         'admin', ${reason}, NOW(), ${actor.userId ?? "system"}, ${actor.userId ?? "system"},
         ${actor.userId ?? "system"})
      ON CONFLICT (company_id) DO UPDATE SET
        plan_type = ${toPlan},
        status = ${toStatus},
        trial_end = COALESCE(${patch.trialEnd ?? null}, tenant_licenses.trial_end),
        notes = COALESCE(${patch.notes ?? null}, tenant_licenses.notes),
        source = 'admin',
        status_reason = ${reason},
        status_changed_at = CASE WHEN ${statusChangeClause} THEN NOW() ELSE tenant_licenses.status_changed_at END,
        status_changed_by_user_id = CASE WHEN ${statusChangeClause} THEN ${actor.userId ?? "system"} ELSE tenant_licenses.status_changed_by_user_id END,
        updated_by_user_id = ${actor.userId ?? "system"},
        updated_at = NOW()
      RETURNING *
    `);
    const record = firstRow<TenantLicenseRow>(upsertRes)!;

    // ── 4. license event ────────────────────────────────────────────────────
    await recordEvent(exec, {
      licenseId: record.id,
      companyId,
      eventType: !existing
        ? "created"
        : statusChangeClause
        ? "status_changed"
        : toPlan !== fromPlan
        ? "plan_changed"
        : "updated",
      fromStatus,
      toStatus,
      fromPlan,
      toPlan,
      reason,
      actor,
      metadata: { companyStatusChanged, companyStatus, trialEnd: patch.trialEnd ?? null },
    });

    // ── 5. authorization_audit_log (existing billing/lifecycle convention) ───
    if (companyStatusChanged) {
      try {
        await exec.execute(sql`
          INSERT INTO authorization_audit_log
            (actor_user_id, change_type, before_value, after_value, note, company_id, created_at)
          VALUES
            (${actor.userId ?? "system"}, 'license_admin_update',
             ${company.subscription_status ?? "unknown"}, ${companyStatus},
             ${`Platform license update: ${fromStatus ?? "none"} → ${toStatus}${reason ? ` (${reason})` : ""}`},
             ${companyId}, NOW())
        `);
      } catch (e) {
        // authorization_audit_log is best-effort here — the tenant_license_events
        // row above is the primary audit record. Never fail the mutation on it.
        console.error("[license-service] authorization_audit_log write failed:", e);
      }
    }

    return { record, companyStatusChanged, companyStatus };
  });
}
