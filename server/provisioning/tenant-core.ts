/**
 * Tenant-core provisioning — the structure every self-serve tenant needs,
 * shared by POST /api/trial/signup and provisionDemoTenant (server/demo-seed.ts):
 *
 *   tenants row → primary tenant_companies link → tenant_licenses row →
 *   onboarding_progress row → explicit company_user_access grant for the admin
 *
 * Runs on the CALLER's transaction handle (`tx`) so it commits or rolls back
 * with the rest of the caller's provisioning. Idempotent per company: a
 * transaction-scoped advisory lock keyed on the company serializes concurrent
 * calls, and each step reuses what already exists. Duplicate prevention does
 * not rely on unique constraints beyond uq_tenant_licenses_company: production
 * has none on onboarding_progress or tenant_companies.company_id, and a schema
 * built by `drizzle-kit push` also lacks the startup-DDL uniques on
 * company_user_access(user_id, company_id) and tenant_companies(tenant_id,
 * company_id) — so the lock + existence checks are what prevent duplicates.
 *
 * Deliberately NOT part of TenantProvisioningService.ts: that service drives the
 * paid-customer commercial-gate / implementation workflow on the pooled `db`
 * and is not transaction-aware.
 */
import { sql } from "drizzle-orm";
import { ensureTrialLicense, type ActorInfo } from "../licensing/license-service";

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

export interface ProvisionTenantCoreOptions {
  tenant: {
    name: string;
    /** Must be unique across tenants (tenants_slug_key). */
    slug: string;
    status: "trial" | "demo";
    billingContactName?: string | null;
    billingContactEmail?: string | null;
  };
  license: {
    status: "trialing" | "active";
    planType: string;
    trialStart?: Date | null;
    trialEnd?: Date | null;
    source: string;
    reason: string;
  };
  actor?: ActorInfo;
}

export interface ProvisionTenantCoreResult {
  tenantId: string;
  tenantCreated: boolean;
  licenseCreated: boolean;
  onboardingCreated: boolean;
  accessGrantCreated: boolean;
}

export async function provisionTenantCore(
  tx: Tx,
  companyId: string,
  adminUserId: string,
  opts: ProvisionTenantCoreOptions,
): Promise<ProvisionTenantCoreResult> {
  if (!companyId || !adminUserId) throw new Error("provisionTenantCore: companyId and adminUserId are required");

  // Serialize provisioning of this company until the caller's transaction ends.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('provision_tenant_core'), hashtext(${companyId}))`);

  // ── Tenant + primary link (reuse an existing link) ──────────────────────
  let tenantCreated = false;
  const linked = await tx.execute(sql`
    SELECT tenant_id FROM tenant_companies WHERE company_id = ${companyId}
    ORDER BY is_primary DESC, created_at ASC LIMIT 1
  `);
  let tenantId = linked.rows[0]?.tenant_id as string | undefined;
  if (!tenantId) {
    const tenantRes = await tx.execute(sql`
      INSERT INTO tenants (name, slug, status, billing_contact_name, billing_contact_email, primary_admin_user_id)
      VALUES (${opts.tenant.name}, ${opts.tenant.slug}, ${opts.tenant.status},
              ${opts.tenant.billingContactName ?? null}, ${opts.tenant.billingContactEmail ?? null}, ${adminUserId})
      RETURNING id
    `);
    tenantId = tenantRes.rows[0].id as string;
    await tx.execute(sql`
      INSERT INTO tenant_companies (tenant_id, company_id, is_primary)
      VALUES (${tenantId}, ${companyId}, TRUE)
    `);
    tenantCreated = true;
  }

  // ── License (ON CONFLICT (company_id) DO NOTHING inside) ─────────────────
  const license = await ensureTrialLicense(
    companyId,
    {
      tenantId,
      planType: opts.license.planType,
      trialStart: opts.license.trialStart ?? null,
      trialEnd: opts.license.trialEnd ?? null,
      source: opts.license.source,
      status: opts.license.status,
      reason: opts.license.reason,
      actor: opts.actor ?? { userId: adminUserId, role: "admin" },
    },
    tx,
  );

  // ── Onboarding progress (no unique constraint → existence check under lock)
  const onboarding = await tx.execute(sql`
    INSERT INTO onboarding_progress (company_id, user_id)
    SELECT ${companyId}, ${adminUserId}
    WHERE NOT EXISTS (
      SELECT 1 FROM onboarding_progress WHERE company_id = ${companyId} AND user_id = ${adminUserId}
    )
    RETURNING id
  `);

  // ── Explicit admin grant on the admin's OWN home company only ────────────
  // Same row the startup company_user_access backfill (server/index.ts) would
  // write for this user, so it adds no access the account does not already
  // have; it just stops new accounts depending on a restart for it.
  const grant = await tx.execute(sql`
    INSERT INTO company_user_access (user_id, company_id, role, is_default_company, is_active, worker_type)
    SELECT id, company_id, COALESCE(role, 'employee'), TRUE, TRUE,
      CASE WHEN role IN ('admin','manager','tenant_admin','tenant_manager') THEN 'manager'
           WHEN role LIKE 'platform_%' THEN 'admin'
           ELSE 'employee' END
    FROM users
    WHERE id = ${adminUserId} AND company_id = ${companyId}
      AND NOT EXISTS (
        SELECT 1 FROM company_user_access WHERE user_id = ${adminUserId} AND company_id = ${companyId}
      )
    RETURNING id
  `);
  if (grant.rows.length === 0) {
    const existing = await tx.execute(sql`
      SELECT 1 FROM company_user_access WHERE user_id = ${adminUserId} AND company_id = ${companyId}
    `);
    if (existing.rows.length === 0) {
      throw new Error("provisionTenantCore: admin user does not belong to the company being provisioned");
    }
  }

  return {
    tenantId,
    tenantCreated,
    licenseCreated: license.created,
    onboardingCreated: onboarding.rows.length > 0,
    accessGrantCreated: grant.rows.length > 0,
  };
}
