import { mapSubscriptionStatusToTenantStatus } from "./tenant-context";
import { INTEGRITY_REPAIR_MARKER } from "./workers/demo-cleanup";
import { normalizeSubscriptionStatus } from "./subscription-status";

// PR-C1: platform_super_admin break-glass gate override
// (POST /api/platform/audit/licensing/:companyId/gate-override).
//
// Deliberately separate from the ordinary tenant-status administration in
// server/tenant-status-admin.ts: it is company-scoped, speaks the raw
// companies.subscription_status vocabulary (incl. grace / past_due), and may
// reinstate a suspended or cancelled company. It is NOT unconstrained:
//   - only the values the Platform Audit UI offers are accepted;
//   - every target has an explicit list of states it may be reached from, so
//     an override cannot "soften" a suspension/cancellation into a status the
//     write-path middleware does not block (past_due, grace, trial);
//   - demo companies may only be suspended or cancelled;
//   - inert integrity-repair companies are never touched;
//   - status, gate_override_reason, the tenants.status mirror and a mandatory
//     authorization_audit_log row commit or roll back as one transaction.
// Authorization is enforced by requirePlatformAudit on the route AND here.

export const GATE_OVERRIDE_ROLE = "platform_super_admin";

// Exactly the values offered by client/src/pages/platform-audit.tsx (LicensingTab).
export const GATE_OVERRIDE_STATUSES = ["active_paid", "trial_active", "grace", "past_due", "suspended", "cancelled"] as const;
export type GateOverrideStatus = (typeof GATE_OVERRIDE_STATUSES)[number];

type StatusClass = "active" | "trial" | "trial_expired" | "grace" | "past_due" | "suspended" | "cancelled" | "unknown";

export function classifySubscriptionStatus(stored: string | null | undefined): StatusClass {
  switch ((stored || "").trim().toLowerCase()) {
    case "active_paid": case "active": return "active";
    case "trial_active": case "trialing": return "trial";
    case "trial_expired": return "trial_expired";
    case "grace": case "grace_period": return "grace";
    case "past_due": return "past_due";
    case "suspended": return "suspended";
    case "cancelled": case "canceled": return "cancelled";
    default: return "unknown";
  }
}

// target → states it may be reached from. Reinstatement out of suspended or
// cancelled is only to active_paid (or suspended → trial_active, matching
// TENANT_STATUS_TRANSITIONS); an unrecognized stored value may only be made
// more restrictive.
export const GATE_OVERRIDE_TRANSITIONS: Record<GateOverrideStatus, readonly StatusClass[]> = {
  // "active" / "trial" sources only matter for legacy spellings (active,
  // trialing): an exact match is already a no-op.
  active_paid: ["active", "trial", "trial_expired", "grace", "past_due", "suspended", "cancelled"],
  trial_active: ["trial", "suspended"],
  grace: ["active", "past_due"],
  past_due: ["active", "trial", "grace"],
  suspended: ["active", "trial", "trial_expired", "grace", "past_due", "unknown"],
  cancelled: ["active", "trial", "trial_expired", "grace", "past_due", "suspended", "unknown"],
};

// The single companies.subscription_status transition policy (P0-E). The gate
// override accepts only GATE_OVERRIDE_STATUSES as input; the license service
// may additionally expire a trial. trial_expired is never reachable from
// past_due/suspended/cancelled (checkTenantGate does not block trial_expired,
// so that would soften an enforcement state at the gate).
export const SUBSCRIPTION_TRANSITIONS: Record<string, readonly StatusClass[]> = {
  ...GATE_OVERRIDE_TRANSITIONS,
  trial_expired: ["trial", "active", "grace"],
};

export const MAX_REASON_LENGTH = 500;
export const COMPANY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type GateOverrideCheck = { ok: true; noop: boolean } | { ok: false; status: number; message: string };

export function isIntegrityRepairReason(reason: string | null | undefined): boolean {
  return (reason ?? "").trim().toLowerCase().startsWith(INTEGRITY_REPAIR_MARKER);
}

/**
 * Shared transition check for every path that writes
 * companies.subscription_status on purpose (gate override, billing
 * activation, license admin, Stripe reactivation). Moving a company OUT of
 * cancelled is a reinstatement and is reserved for the explicit, audited
 * reinstatement operations (PATCH /api/tenants/:id and the gate override);
 * every other caller passes allowReinstatement: false.
 */
export function checkSubscriptionTransition(
  stored: string | null | undefined,
  to: string,
  isDemo: boolean,
  opts: { allowReinstatement: boolean },
): GateOverrideCheck {
  if (!(to in SUBSCRIPTION_TRANSITIONS)) return { ok: false, status: 400, message: `Unsupported subscription status: ${to}` };
  if (normalizeSubscriptionStatus(stored) === to) return { ok: true, noop: true };
  if (isDemo && to !== "suspended" && to !== "cancelled") {
    return { ok: false, status: 409, message: "A demo company can only be suspended or cancelled" };
  }
  const from = classifySubscriptionStatus(stored);
  if (from === "cancelled" && !opts.allowReinstatement) {
    return { ok: false, status: 409, message: "A cancelled company can only be reinstated by a platform administrator through tenant status administration or the gate override" };
  }
  if (!SUBSCRIPTION_TRANSITIONS[to].includes(from)) {
    return { ok: false, status: 409, message: `Status change ${stored || "(none)"} → ${to} is not allowed` };
  }
  return { ok: true, noop: false };
}

export function checkGateOverrideTransition(stored: string | null | undefined, to: unknown, isDemo: boolean): GateOverrideCheck {
  if (typeof to !== "string" || !(GATE_OVERRIDE_STATUSES as readonly string[]).includes(to)) {
    return { ok: false, status: 400, message: `Invalid subscriptionStatus. Expected one of: ${GATE_OVERRIDE_STATUSES.join(", ")}` };
  }
  return checkSubscriptionTransition(stored, to, isDemo, { allowReinstatement: true });
}

/**
 * Re-derives the tenants.status mirror for a company on the caller's
 * transaction client. Only the tenant's PRIMARY company drives the mirror
 * (same resolution as applyTenantPatch / the reconcile job). Returns the
 * company's tenant id (null when unassigned).
 */
export async function syncPrimaryTenantMirror(
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> },
  companyId: string,
  status: string | null,
  isDemo: boolean,
  trialEnd: Date | string | null | undefined,
  statusChanged: boolean,
): Promise<string | null> {
  const { rows } = await client.query(
    `SELECT tc.tenant_id,
            (SELECT p.company_id FROM tenant_companies p WHERE p.tenant_id = tc.tenant_id
              ORDER BY p.is_primary DESC, p.created_at ASC LIMIT 1) AS primary_company_id
     FROM tenant_companies tc WHERE tc.company_id = $1 LIMIT 1`,
    [companyId],
  );
  const tenantId: string | null = rows[0]?.tenant_id ?? null;
  if (statusChanged && tenantId && rows[0].primary_company_id === companyId) {
    await client.query(`UPDATE tenants SET status = $1, updated_at = NOW() WHERE id = $2`, [mapSubscriptionStatusToTenantStatus(status, isDemo, trialEnd), tenantId]);
  }
  return tenantId;
}

export interface GateOverrideInput { subscriptionStatus?: unknown; reason?: unknown }
export interface GateOverrideActor { userId: string; role: string | null | undefined }
export type GateOverrideResult =
  | { ok: true; companyId: string; subscriptionStatus: string | null; statusChanged: boolean; tenantId: string | null }
  | { ok: false; status: number; message: string };

interface PgClient { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>; release: () => void }
interface PgPool { connect: () => Promise<PgClient> }

export async function applyGateOverride(pool: PgPool, companyId: string, input: GateOverrideInput, actor: GateOverrideActor): Promise<GateOverrideResult> {
  if (actor.role !== GATE_OVERRIDE_ROLE || !actor.userId) {
    return { ok: false, status: 403, message: "Platform super admin only" };
  }
  if (typeof companyId !== "string" || !COMPANY_ID_RE.test(companyId)) {
    return { ok: false, status: 400, message: "Invalid company id" };
  }
  const wantStatus = input.subscriptionStatus;
  const hasStatus = wantStatus !== undefined && wantStatus !== null && wantStatus !== "";
  if (hasStatus && (typeof wantStatus !== "string" || !(GATE_OVERRIDE_STATUSES as readonly string[]).includes(wantStatus))) {
    return { ok: false, status: 400, message: `Invalid subscriptionStatus. Expected one of: ${GATE_OVERRIDE_STATUSES.join(", ")}` };
  }
  if (input.reason !== undefined && input.reason !== null && typeof input.reason !== "string") {
    return { ok: false, status: 400, message: "reason must be a string" };
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() || null : null;
  if (hasStatus && !reason) return { ok: false, status: 400, message: "A reason is required for a gate override" };
  if (reason && reason.length > MAX_REASON_LENGTH) return { ok: false, status: 400, message: `reason must be at most ${MAX_REASON_LENGTH} characters` };
  if (reason && isIntegrityRepairReason(reason)) {
    return { ok: false, status: 400, message: `reason may not start with "${INTEGRITY_REPAIR_MARKER}" (reserved marker)` };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: companyRows } = await client.query(
      `SELECT id, subscription_status, is_demo, trial_end, gate_override_reason FROM companies WHERE id = $1 FOR UPDATE`,
      [companyId],
    );
    const company = companyRows[0];
    if (!company) { await client.query("ROLLBACK"); return { ok: false, status: 404, message: "Company not found" }; }
    if (isIntegrityRepairReason(company.gate_override_reason)) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, message: "Company is an inert integrity-repair record; gate override is not permitted" };
    }
    const isDemo = company.is_demo === true;
    const before: string | null = company.subscription_status ?? null;

    let statusChanged = false;
    if (hasStatus) {
      const check = checkGateOverrideTransition(before, wantStatus, isDemo);
      if (!check.ok) { await client.query("ROLLBACK"); return check; }
      statusChanged = !check.noop;
    }
    const after = statusChanged ? (wantStatus as string) : before;

    if (statusChanged) {
      await client.query(`UPDATE companies SET subscription_status = $1, gate_override_reason = $2 WHERE id = $3`, [after, reason, companyId]);
    } else {
      await client.query(`UPDATE companies SET gate_override_reason = $1 WHERE id = $2`, [reason, companyId]);
    }

    // Overriding a secondary company never rewrites its tenant's displayed status.
    const tenantId = await syncPrimaryTenantMirror(client, companyId, after, isDemo, company.trial_end, statusChanged);

    await client.query(
      `INSERT INTO authorization_audit_log (actor_user_id, target_resource, change_type, before_value, after_value, note, company_id, tenant_id, created_at)
       VALUES ($1, $2, 'gate_override', $3, $4, $5, $6, $7, NOW())`,
      [actor.userId, `company:${companyId}`, before ?? "", after ?? "",
       JSON.stringify({ role: actor.role, reason, previousReason: company.gate_override_reason ?? null, statusChanged }),
       companyId, tenantId],
    );
    await client.query("COMMIT");
    return { ok: true, companyId, subscriptionStatus: after, statusChanged, tenantId };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* connection already broken */ }
    throw e;
  } finally {
    client.release();
  }
}
