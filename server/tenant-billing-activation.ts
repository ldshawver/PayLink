import {
  checkSubscriptionTransition, isIntegrityRepairReason, syncPrimaryTenantMirror, COMPANY_ID_RE, MAX_REASON_LENGTH,
} from "./tenant-gate-override";

// P0-E: platform-staff billing activation (POST /api/billing/activate).
//
// Activation records that billing was set up for a company and moves it to
// active_paid. It is NOT a reinstatement: it uses the shared
// checkSubscriptionTransition() policy with allowReinstatement: false, so a
// cancelled company must first be reinstated through tenant status
// administration (PATCH /api/tenants/:id) or the gate override. Demo and
// integrity-repair companies are refused. Status, trial_signups, the
// tenants.status mirror and a mandatory authorization_audit_log row commit or
// roll back together. Authorization is enforced by requirePlatformAdminRole()
// on the route AND re-checked here.

export const BILLING_ACTIVATION_ROLES = ["platform_super_admin", "platform_admin"] as const;

export interface BillingActivationActor { userId: string; role: string | null | undefined }
export type BillingActivationResult =
  | { ok: true; companyId: string; previousStatus: string | null; statusChanged: boolean }
  | { ok: false; status: number; message: string };

interface PgClient { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>; release: () => void }
interface PgPool { connect: () => Promise<PgClient> }

export async function applyBillingActivation(
  pool: PgPool,
  companyId: unknown,
  input: { note?: unknown },
  actor: BillingActivationActor,
): Promise<BillingActivationResult> {
  if (!BILLING_ACTIVATION_ROLES.includes((actor.role || "") as any) || !actor.userId) {
    return { ok: false, status: 403, message: "Platform administrator access required" };
  }
  if (typeof companyId !== "string" || !companyId) return { ok: false, status: 400, message: "companyId is required" };
  if (!COMPANY_ID_RE.test(companyId)) return { ok: false, status: 400, message: "Invalid companyId" };
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
    return { ok: false, status: 400, message: "note must be a string" };
  }
  const note = typeof input.note === "string" ? input.note.trim() || null : null;
  if (note && note.length > MAX_REASON_LENGTH) return { ok: false, status: 400, message: `note must be at most ${MAX_REASON_LENGTH} characters` };

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
      return { ok: false, status: 409, message: "Company is an inert integrity-repair record; billing cannot be activated" };
    }
    const isDemo = company.is_demo === true;
    const before: string | null = company.subscription_status ?? null;
    const check = checkSubscriptionTransition(before, "active_paid", isDemo, { allowReinstatement: false });
    if (!check.ok) { await client.query("ROLLBACK"); return check; }
    const statusChanged = !check.noop;

    await client.query(
      `UPDATE companies SET subscription_status = 'active_paid', billing_active = TRUE, payment_method_on_file = TRUE WHERE id = $1`,
      [companyId],
    );
    await client.query(
      `UPDATE trial_signups SET subscription_status = 'active_paid', billing_active = TRUE, payment_method_on_file = TRUE WHERE company_id = $1`,
      [companyId],
    );
    const tenantId = await syncPrimaryTenantMirror(client, companyId, "active_paid", isDemo, company.trial_end, statusChanged);
    await client.query(
      `INSERT INTO authorization_audit_log (actor_user_id, target_resource, change_type, before_value, after_value, note, company_id, tenant_id, created_at)
       VALUES ($1, 'companies.subscription_status', 'billing_activated', $2, 'active_paid', $3, $4, $5, NOW())`,
      [actor.userId, before ?? "", note, companyId, tenantId],
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
