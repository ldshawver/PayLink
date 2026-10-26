import {
  checkSubscriptionTransition, isIntegrityRepairReason, syncPrimaryTenantMirror, COMPANY_ID_RE, MAX_REASON_LENGTH,
} from "./tenant-gate-override";

// Administrative suspension of one company (POST /api/provisioning/event with
// event "tenant.suspended").
//
// Goes through the shared checkSubscriptionTransition() policy with
// allowReinstatement: false, so a cancelled company is refused (suspended is
// reactivatable; cancelled must stay cancelled) and integrity-repair records
// are refused. companies.subscription_status, the provisioning gate, the
// tenants.status mirror and a mandatory authorization_audit_log row
// (change_type 'admin_suspension') commit or roll back together.
//
// The 'admin_suspension' row is what marks the suspension's SOURCE as admin:
// billingLifecycle.getSuspensionSource() reads it, so a Stripe payment never
// lifts it. Re-suspending an already-suspended company still writes the row —
// that deliberately re-labels an earlier billing suspension as administrative.
// Lifting it requires an explicit, audited platform-administrator action
// (PATCH /api/tenants/:id, the gate override, a license update or billing
// activation).

export const ADMIN_SUSPENSION_ROLES = ["platform_super_admin", "platform_admin"] as const;
export const ADMIN_SUSPENSION_CHANGE_TYPE = "admin_suspension";

export interface AdminSuspensionActor { userId: string; role: string | null | undefined }
export type AdminSuspensionResult =
  | { ok: true; companyId: string; previousStatus: string | null; statusChanged: boolean }
  | { ok: false; status: number; message: string };

interface PgClient { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>; release: () => void }
interface PgPool { connect: () => Promise<PgClient> }

export async function applyAdminSuspension(
  pool: PgPool,
  companyId: unknown,
  input: { reason?: unknown; via?: string },
  actor: AdminSuspensionActor,
): Promise<AdminSuspensionResult> {
  if (!ADMIN_SUSPENSION_ROLES.includes((actor.role || "") as any) || !actor.userId) {
    return { ok: false, status: 403, message: "Platform administrator access required" };
  }
  if (typeof companyId !== "string" || !companyId) return { ok: false, status: 400, message: "companyId is required" };
  if (!COMPANY_ID_RE.test(companyId)) return { ok: false, status: 400, message: "Invalid companyId" };
  if (input.reason !== undefined && input.reason !== null && typeof input.reason !== "string") {
    return { ok: false, status: 400, message: "reason must be a string" };
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() || null : null;
  if (reason && reason.length > MAX_REASON_LENGTH) return { ok: false, status: 400, message: `reason must be at most ${MAX_REASON_LENGTH} characters` };
  const via = input.via || "provisioning";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, subscription_status, is_demo, trial_end, gate_override_reason FROM companies WHERE id = $1 FOR UPDATE`,
      [companyId],
    );
    const company = rows[0];
    if (!company) { await client.query("ROLLBACK"); return { ok: false, status: 404, message: "Company not found" }; }
    if (isIntegrityRepairReason(company.gate_override_reason)) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, message: "Company is an inert integrity-repair record; it cannot be suspended" };
    }
    const isDemo = company.is_demo === true;
    const before: string | null = company.subscription_status ?? null;
    const check = checkSubscriptionTransition(before, "suspended", isDemo, { allowReinstatement: false });
    if (!check.ok) { await client.query("ROLLBACK"); return check; }
    const statusChanged = !check.noop;

    if (statusChanged) {
      await client.query(`UPDATE companies SET subscription_status = 'suspended' WHERE id = $1`, [companyId]);
    }
    await client.query(
      `UPDATE tenant_commercial_gates SET lifecycle_state = 'suspended', suspended_at = NOW(), updated_at = NOW() WHERE company_id = $1`,
      [companyId],
    );
    const tenantId = await syncPrimaryTenantMirror(client, companyId, "suspended", isDemo, company.trial_end, statusChanged);
    await client.query(
      `INSERT INTO authorization_audit_log (actor_user_id, target_resource, change_type, before_value, after_value, note, company_id, tenant_id, created_at)
       VALUES ($1, 'companies.subscription_status', $2, $3, 'suspended', $4, $5, $6, NOW())`,
      [actor.userId, ADMIN_SUSPENSION_CHANGE_TYPE, before ?? "", `source=admin; via=${via}; role=${actor.role}; reason=${reason ?? "(none given)"}`, companyId, tenantId],
    );
    await client.query(
      `INSERT INTO tenant_provisioning_audit_logs (company_id, event_type, step, status, details, triggered_by)
       VALUES ($1, 'tenant.suspended', NULL, 'success', $2, $3)`,
      [companyId, statusChanged ? "Tenant suspended by platform administrator" : "Tenant already suspended; suspension recorded as administrative", actor.userId],
    );
    await client.query("COMMIT");
    return { ok: true, companyId, previousStatus: before, statusChanged };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* connection already broken */ }
    throw e;
  } finally {
    client.release();
  }
}
