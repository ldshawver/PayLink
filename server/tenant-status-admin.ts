import { mapSubscriptionStatusToTenantStatus } from "./tenant-context";

// PR-C1: platform tenant-record mutation (PATCH /api/tenants/:id).
//
// Status changes are validated against an explicit transition table and
// committed in ONE transaction together with a mandatory
// authorization_audit_log row — if the audit insert fails, the status change
// is rolled back. Authorization (platform_super_admin / platform_admin only)
// is enforced by requirePlatformAdminRole() on the route AND re-checked here
// so a future caller cannot bypass it by reusing this helper.

export const TENANT_PATCH_ADMIN_ROLES = ["platform_super_admin", "platform_admin"] as const;

export const TENANT_STATUS_TO_SUBSCRIPTION_STATUS: Record<string, string> = {
  active: "active_paid",
  trial: "trial_active",
  suspended: "suspended",
  cancelled: "cancelled",
};

// "demo" is intentionally not a reachable target: demo tenants are created
// only by demo provisioning, and flipping a real tenant to demo would set
// companies.is_demo on live customer data. A demo tenant can only be
// suspended or cancelled through this route — never promoted to paid/trial.
export const TENANT_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  trial: ["active", "suspended", "cancelled"],
  active: ["suspended", "cancelled"],
  suspended: ["active", "trial", "cancelled"],
  cancelled: ["active"],
  demo: ["suspended", "cancelled"],
};

const KNOWN_STATUSES = Object.keys(TENANT_STATUS_TRANSITIONS);

export type TransitionCheck = { ok: true; noop: boolean } | { ok: false; message: string };

export function checkTenantStatusTransition(from: string | null | undefined, to: unknown): TransitionCheck {
  if (typeof to !== "string" || !KNOWN_STATUSES.includes(to)) {
    return { ok: false, message: "Invalid status" };
  }
  const current = (from || "").toLowerCase();
  // Re-sending the current status (the edit dialog always does) is a no-op,
  // including "demo" for a demo tenant whose name/notes are being edited.
  if (current === to) return { ok: true, noop: true };
  if (!(to in TENANT_STATUS_TO_SUBSCRIPTION_STATUS)) return { ok: false, message: `Status transition ${current || "(none)"} → ${to} is not allowed` };
  // An unrecognized stored status (legacy/corrupt row) may only be moved to a
  // restrictive state; an admin must not "repair" it straight to active/trial.
  if (!KNOWN_STATUSES.includes(current)) {
    return to === "suspended" || to === "cancelled"
      ? { ok: true, noop: false }
      : { ok: false, message: `Cannot change status from unrecognized state to ${to}` };
  }
  if (!TENANT_STATUS_TRANSITIONS[current].includes(to)) {
    return { ok: false, message: `Status transition ${current} → ${to} is not allowed` };
  }
  return { ok: true, noop: false };
}

export interface TenantPatchInput {
  name?: string; status?: string; billingContactName?: string | null; billingContactEmail?: string | null;
  defaultTimezone?: string; notes?: string | null; stripeCustomerId?: string;
}

export interface TenantPatchActor { userId: string; role: string | null | undefined }

export type TenantPatchResult =
  | { ok: true; tenant: any; companyIds: string[] }
  | { ok: false; status: number; message: string };

interface PgClient { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>; release: () => void }
interface PgPool { connect: () => Promise<PgClient> }

const AUDITED_FIELDS: Array<[keyof TenantPatchInput, string]> = [
  ["name", "name"], ["billingContactName", "billing_contact_name"], ["billingContactEmail", "billing_contact_email"],
  ["defaultTimezone", "default_timezone"], ["notes", "notes"], ["stripeCustomerId", "stripe_customer_id"],
];

export async function applyTenantPatch(pool: PgPool, tenantId: string, input: TenantPatchInput, actor: TenantPatchActor): Promise<TenantPatchResult> {
  if (!TENANT_PATCH_ADMIN_ROLES.includes((actor.role || "") as any)) {
    return { ok: false, status: 403, message: "Platform administrator access required" };
  }
  const { name, status, billingContactName, billingContactEmail, defaultTimezone, notes, stripeCustomerId } = input;
  if (status !== undefined && status !== null && status !== "" && !KNOWN_STATUSES.includes(String(status))) {
    return { ok: false, status: 400, message: "Invalid status" };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: existingRows } = await client.query(`SELECT * FROM tenants WHERE id = $1 FOR UPDATE`, [tenantId]);
    if (!existingRows.length) { await client.query("ROLLBACK"); return { ok: false, status: 404, message: "Tenant not found" }; }
    const before = existingRows[0];

    let statusChanged = false;
    let primaryCompanyId: string | undefined;
    if (status) {
      const check = checkTenantStatusTransition(before.status, status);
      if (!check.ok) { await client.query("ROLLBACK"); return { ok: false, status: 409, message: check.message }; }
      statusChanged = !check.noop;
      const { rows: primaryRows } = await client.query(
        `SELECT company_id FROM tenant_companies WHERE tenant_id = $1 ORDER BY is_primary DESC, created_at ASC LIMIT 1`,
        [tenantId],
      );
      primaryCompanyId = primaryRows[0]?.company_id;
      if (!primaryCompanyId) { await client.query("ROLLBACK"); return { ok: false, status: 400, message: "Cannot set status: tenant has no assigned company" }; }
      const { rows: companyRows } = await client.query(`SELECT is_demo FROM companies WHERE id = $1 FOR UPDATE`, [primaryCompanyId]);
      if (companyRows[0]?.is_demo === true && statusChanged && status !== "suspended" && status !== "cancelled") {
        await client.query("ROLLBACK");
        return { ok: false, status: 409, message: "A demo tenant can only be suspended or cancelled" };
      }
      if (statusChanged) {
        // is_demo is preserved: suspending/cancelling a demo keeps it a demo.
        await client.query(`UPDATE companies SET subscription_status = $1 WHERE id = $2`, [TENANT_STATUS_TO_SUBSCRIPTION_STATUS[status], primaryCompanyId]);
        // Mirror re-derived from the canonical subscription_status exactly as
        // mirrorTenantStatusFromCompany() does, but on this transaction's client.
        const subscriptionStatus = TENANT_STATUS_TO_SUBSCRIPTION_STATUS[status];
        await client.query(`UPDATE tenants SET status = $1, updated_at = NOW() WHERE id = $2`, [mapSubscriptionStatusToTenantStatus(subscriptionStatus, false), tenantId]);
      }
    }

    const { rows } = await client.query(`
      UPDATE tenants
      SET name                 = COALESCE($1, name),
          billing_contact_name = COALESCE($2, billing_contact_name),
          billing_contact_email= COALESCE($3, billing_contact_email),
          default_timezone     = COALESCE($4, default_timezone),
          notes                = COALESCE($5, notes),
          stripe_customer_id   = COALESCE($6, stripe_customer_id),
          updated_at           = NOW()
      WHERE id = $7
      RETURNING *
    `, [name || null, billingContactName ?? null, billingContactEmail ?? null,
        defaultTimezone || null, notes ?? null, stripeCustomerId || null, tenantId]);
    const after = rows[0];

    const changedFields = AUDITED_FIELDS.filter(([, col]) => (before[col] ?? null) !== (after[col] ?? null)).map(([k]) => k);
    if (statusChanged) {
      await client.query(
        `INSERT INTO authorization_audit_log (actor_user_id, target_resource, change_type, before_value, after_value, note, company_id, tenant_id)
         VALUES ($1, $2, 'tenant_status_change', $3, $4, $5, $6, $7)`,
        [actor.userId, `tenant:${tenantId}`, String(before.status ?? ""), String(after.status ?? ""), `role=${actor.role}`, primaryCompanyId ?? null, tenantId],
      );
    }
    if (changedFields.length) {
      // Field names only — never the values (billing email/contact are PII).
      await client.query(
        `INSERT INTO authorization_audit_log (actor_user_id, target_resource, change_type, before_value, after_value, note, company_id, tenant_id)
         VALUES ($1, $2, 'tenant_record_update', NULL, $3, $4, NULL, $5)`,
        [actor.userId, `tenant:${tenantId}`, changedFields.join(","), `role=${actor.role}`, tenantId],
      );
    }

    const { rows: companyIdRows } = await client.query(`SELECT company_id FROM tenant_companies WHERE tenant_id = $1`, [tenantId]);
    await client.query("COMMIT");
    return { ok: true, tenant: after, companyIds: companyIdRows.map((r: any) => r.company_id) };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* connection already broken */ }
    throw e;
  } finally {
    client.release();
  }
}
