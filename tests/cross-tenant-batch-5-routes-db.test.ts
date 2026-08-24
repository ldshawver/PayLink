/**
 * Phase 0.5 — cross-tenant negative tests, batch 5: the next highest-risk
 * unresolved / needs-runtime-hardening routes selected from the committed
 * storage-scope-trace manifest (docs/saas-readiness/storage-scope-trace-manifest.json)
 * and route-security manifest, plus manual source reading, excluding every
 * route already covered by batch 1 (tests/cross-tenant-worker-routes-db.test.ts,
 * PR #84/#85), batch 2 (tests/cross-tenant-batch-2-routes-db.test.ts,
 * PR #87/#88), batch 3 (tests/cross-tenant-batch-3-routes-db.test.ts,
 * PR #89/#90), or batch 4 (tests/cross-tenant-batch-4-routes-db.test.ts,
 * PR #91/#92).
 *
 * Unlike batches 1-4, this batch is weighted toward the *platform-console
 * and platform-audit* surface (routes gated by requirePlatformRole() /
 * requirePlatformAudit() / requireSuperAdmin() rather than a tenant-scoped
 * requireRole()), per the recovery-checkpoint instruction to prioritize
 * "platform-console/audit routes with parameterized company IDs and other
 * routes where static tracing could not prove tenant enforcement." Every
 * route below traced to `disposition: "unresolved"` or
 * `"needs-runtime-hardening"` with no resolvable `storage.*` call in the
 * committed storage-scope-trace manifest, takes a client-supplied
 * companyId/tenantId path or body parameter, and was manually read end to
 * end before being included here.
 *
 * Routes tested (manifest disposition | source):
 *   1.  GET   /api/feature-registry/tenant/:companyId              | unresolved | server/routes.ts:35715
 *   2.  POST  /api/feature-registry/activate                       | unresolved | server/routes.ts:35813
 *   3.  POST  /api/feature-registry/bulk-activate                  | unresolved | server/routes.ts:35864
 *   4.  GET   /api/provisioning/tenants/:companyId                 | unresolved | server/routes.ts:31433
 *   5.  GET   /api/provisioning/tenants/:companyId/audit            | unresolved | server/routes.ts:31440
 *   6.  POST  /api/provisioning/tenants/:companyId/retry            | unresolved | server/routes.ts:31456
 *   7.  PATCH /api/provisioning/tenants/:companyId/gates            | unresolved | server/routes.ts:31466
 *   8.  POST  /api/provisioning/event                               | unresolved | server/routes.ts:31447
 *   9.  POST  /api/platform/audit/contracts/:companyId/sign         | unresolved | server/routes.ts:33289
 *  10.  POST  /api/platform/audit/licensing/:companyId/gate-override| unresolved | server/routes.ts:33306
 *  11.  DELETE /api/tenants/:id/companies/:companyId                | unresolved | server/routes.ts:31404
 *  12.  GET   /api/audit-log                                        | unresolved | server/routes.ts:31089
 *
 * Selection rationale (manual source reading, cross-referenced against the
 * committed storage-scope-trace and route-security manifests):
 *   All twelve routes accept a client-supplied companyId (path, query, or
 *   body) or a dual tenantId+companyId pair, mutate, approve, delete, or
 *   expose tenant-owned or cross-tenant business/commercial/audit data, and
 *   the storage-scope-trace could not resolve a `storage.*`/inline-db call
 *   inside the handler body to confirm or deny tenant enforcement (every
 *   one of these routes calls out through a service module —
 *   TenantProvisioningService, the platform-audit inline SQL block, or the
 *   tenant_companies/authorization_audit_log query blocks — that the static
 *   trace does not follow). None were tested in batches 1-4.
 *
 *   1-3. Feature-registry routes: gated by requirePlatformRole(), which
 *        accepts any of seven platform roles (platform_super_admin,
 *        platform_admin, platform_sales, platform_implementation,
 *        platform_support, platform_billing, platform_auditor) — see
 *        server/routes.ts:306-324. #2/#3 add an inline narrowing check
 *        (platform_super_admin/platform_admin only); #1 does not, so any of
 *        the seven roles can read any tenant's feature-override state. This
 *        is by design for a read endpoint but is verified here rather than
 *        assumed. #2/#3 also mutate `feature_overrides`
 *        (companyId has no FK — server/storage.ts / shared/schema.ts) with
 *        no existence check on the target companyId.
 *   4-5. Provisioning read routes: same broad requirePlatformRole() gate,
 *        delegate to TenantProvisioningService.getProvisioningStatus /
 *        storage.getTenantProvisioningAuditLogs, both correctly filtered by
 *        the path companyId — verified here as a company-isolation sanity
 *        check (not itself a defect) before testing the two neighboring
 *        mutating routes below, which share the same broad gate.
 *   6.  POST retry — same broad requirePlatformRole() gate, NO inline
 *       narrowing (unlike #2/#3). Calls handleProvisioningEvent(...,
 *       "tenant.provisioning.requested", ...), which — if the target
 *       tenant's commercial gates already all read as passed — runs the
 *       *entire* provisioning workflow: activates billing
 *       (companies.subscription_status → active_paid), creates a tenant
 *       owner user with a fixed default password, seeds departments, and
 *       marks the tenant commercially live. A platform_auditor or
 *       platform_billing account — roles that should plausibly be
 *       read-only — can fully provision/activate any tenant.
 *   7.  PATCH gates — same broad requirePlatformRole() gate (any of seven
 *       platform roles can mutate a tenant's commercial gates). Additionally,
 *       storage.upsertTenantCommercialGate(companyId, data) is called with
 *       `req.body` passed through verbatim as `data`
 *       (server/routes.ts:31466-31471); its insert branch builds
 *       `{ companyId, ...data }` and its update branch builds
 *       `{ ...data, updatedAt }` (server/storage.ts:4298-4312) — in both
 *       cases, if the request body itself contains a `companyId` key, that
 *       value silently wins over the URL's `:companyId` path segment
 *       (object-spread override), so the gate row for the URL's tenant can
 *       be reassigned to (or created under) a different companyId entirely
 *       — the exact "client-supplied companyId reassignment" pattern this
 *       audit batch was scoped to look for, on a route that was never
 *       previously tested.
 *   8.  POST /api/provisioning/event — same broad requirePlatformRole()
 *       gate, no inline narrowing, and no restriction on which event types
 *       an caller may send. handleProvisioningEvent's "tenant.suspended"
 *       case suspends any company's subscription outright
 *       (companies.subscription_status → suspended) and its
 *       "subscription.activated" case flips the commercial subscription
 *       gate to active — both reachable by a platform_billing or
 *       platform_sales account, not just platform_super_admin/platform_admin.
 *   9-10. Platform-audit contract-sign / licensing-gate-override — gated by
 *        requirePlatformAudit (platform_super_admin only, correctly narrow
 *        — included here as a positive control alongside the broader
 *        provisioning/feature-registry gates above). Both mutate
 *        `companies` by raw SQL `UPDATE ... WHERE id = ${companyId}` with
 *        no existence check and no rowCount check before responding
 *        `{ success: true }` (server/routes.ts:33289-33326) — a nonexistent
 *        companyId still reports success.
 *   11. DELETE /api/tenants/:id/companies/:companyId — gated by
 *       requireSuperAdmin() (platform_super_admin only, correctly narrow —
 *       another positive control). Deletes by the tuple (tenant_id,
 *       company_id) with no existence check and no rowCount check before
 *       responding `{ ok: true }`, and unconditionally calls
 *       invalidateTenantCache(companyId) regardless of whether a row was
 *       actually deleted — the "side effects after rejected/no-op
 *       requests" test case this audit batch was scoped to look for.
 *   12. GET /api/audit-log — gated by requireRole("admin",
 *       "platform_super_admin"), which looks narrow, but requireRole
 *       expands the caller's role through expandRoleForGuard() first
 *       (server/routes.ts:260-280), which aliases platform_admin,
 *       platform_support, and platform_implementation to also carry
 *       "admin" — so all three pass this gate too, not just
 *       platform_super_admin. Inside the handler,
 *       `isSuperAdmin = currentUser?.role === "platform_super_admin"` is an
 *       *exact* string match (not alias-aware), so a platform_admin /
 *       platform_support / platform_implementation caller is treated as
 *       "not super admin" and falls to
 *       `resolvedCompanyId = currentUser?.companyId ?? undefined`
 *       (server/routes.ts:31097-31099) — but platform-scoped accounts are
 *       required to have companyId = NULL (enforced at login,
 *       server/routes.ts:1584-1590), so resolvedCompanyId is always
 *       `undefined` for these three roles. storage.getAuthorizationAuditLogsFiltered
 *       only applies a companyId filter `if (opts.companyId)` — undefined
 *       is falsy, so no filter is applied at all, and the query returns
 *       every company's authorization-audit-log rows. This is included
 *       here (rather than deferred) because it is a genuine, previously
 *       untested cross-tenant read gap reachable by three named roles, not
 *       just the intended platform_super_admin.
 *
 * Deliberately excluded from this batch (already covered / not selected):
 *   GET /api/feature-registry/log, POST /api/tenants/:id/companies were
 *   read and found to share the exact same gate/defect shape as routes
 *   already included above (#1 and #11 respectively) — omitted to keep this
 *   batch inside the ~8-12 route budget rather than duplicating coverage of
 *   an already-demonstrated pattern. GET /api/provisioning/tenants,
 *   GET /api/provisioning/templates, GET /api/admin/lifecycle-overview,
 *   GET /api/tenants, GET /api/tenants/:id, GET /api/breach-incidents,
 *   POST /api/breach-incidents were read and are legitimately
 *   platform-wide/no-parameterized-companyId listings (or already
 *   correctly filtered) — outside this batch's "accepts a tenant-owned
 *   identifier" selection criterion (route-security-manifest disposition
 *   was `null`/not a storage-scope-trace target for all of these).
 *
 * GET /api/audit-log/export-csv shares the exact same
 * resolvedCompanyId logic as GET /api/audit-log (#12) — not independently
 * re-tested here; the finding and repair recommendation for #12 applies to
 * both. The same is true of platform_support and platform_implementation
 * for #12 — the vulnerable code path is role-alias-driven and identical for
 * all three roles; only platform_admin is exercised directly below, with
 * the other two documented as sharing the same code path rather than
 * separately tested, to keep this file's fixture/session count bounded.
 *
 * Methodology matches tests/cross-tenant-batch-4-routes-db.test.ts exactly:
 * boots the REAL, unmodified application server (server/index.ts) against a
 * disposable Postgres database, creates synthetic tenants/users/platform
 * accounts with real authenticated sessions via the real POST
 * /api/auth/login route, and exercises each route's actual authorization
 * logic over real HTTP requests. Not a mock.
 *
 * This is a TEST-FIRST / AUDIT-FIRST branch: no runtime repair is made here
 * for any defect this file verifies. Verified defects are documented in
 * docs/saas-readiness/phase-0.5-batch-5-cross-tenant-findings.md, along
 * with the proposed hardening branch (saas/phase0.5-cross-tenant-batch-5-hardening).
 *
 * SAFETY: requires TEST_DATABASE_URL to point at a disposable database,
 * refuses staging/production-shaped names/hosts, aborts if TEST_DATABASE_URL
 * equals DATABASE_URL, and verifies current_database() before any write.
 * Cleanup is the same generic FK-aware cascade delete rooted at the two
 * synthetic company ids plus the two synthetic tenant ids
 * (scripts/cross-tenant-negative-tests/cascade-cleanup.ts), run in a
 * `finally` block and independently re-verified afterward. The server
 * harness is the PR #86-fixed process-group-aware harness — stop() signals
 * the whole process group, not just the tracked pid, so no child/orphan
 * process or held port survives this run. Session cookies, password
 * hashes, and the connection string are never logged — only
 * PASS/FAIL/INCONCLUSIVE/EXPECTED GLOBAL/N/A outcomes and non-sensitive
 * route response shapes (booleans/status codes/role names), never actual
 * dollar amounts or document contents.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/cross-tenant-batch-5-routes-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import fs from "node:fs";
import { startTestServer, login, apiRequest, type TestServer, type Session } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];
const MANIFEST_PATH = "docs/saas-readiness/cross-tenant-batch-5-test-manifest.json";

type Disposition = "PASS" | "FAIL" | "INCONCLUSIVE" | "EXPECTED GLOBAL" | "N/A";

interface CaseResult {
  case: string;
  disposition: Disposition;
  detail: string;
}

interface RouteResult {
  id: string;
  source: string;
  cases: CaseResult[];
}

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.log("TEST_DATABASE_URL not set — skipping cross-tenant batch-5 tests (0 run).");
    return;
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(testDatabaseUrl)) {
      throw new Error("TEST_DATABASE_URL looks like it points at staging/production. Refusing to run.");
    }
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is identical to DATABASE_URL. Refusing to run against what may be the app's real database.");
  }

  const pool = new Pool({ connectionString: testDatabaseUrl, max: 4 });
  const companyIds: string[] = [];
  const tenantIds: string[] = [];
  const routeResults: RouteResult[] = [];
  let harnessOk = true;
  let server: TestServer | undefined;

  function record(routeId: string, source: string, caseResults: CaseResult[]) {
    routeResults.push({ id: routeId, source, cases: caseResults });
  }

  try {
    const dbNameRes = await pool.query("SELECT current_database() AS name");
    const dbName = dbNameRes.rows[0]?.name as string;
    if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) {
      throw new Error(`current_database() = "${dbName}" looks like staging/production. Refusing to run.`);
    }

    // ── Fixtures: two synthetic tenants/companies, never real data ───────────
    const suffix = crypto.randomBytes(4).toString("hex");
    const companyA = crypto.randomUUID();
    const companyB = crypto.randomUUID();
    companyIds.push(companyA, companyB);
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2), ($3, $4)`, [companyA, `CT5 Test Tenant A ${suffix}`, companyB, `CT5 Test Tenant B ${suffix}`]);

    const tenantX = crypto.randomUUID();
    const tenantY = crypto.randomUUID();
    tenantIds.push(tenantX, tenantY);
    await pool.query(
      `INSERT INTO tenants (id, name, slug, status) VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
      [tenantX, `CT5 Tenant X ${suffix}`, `ct5-tenant-x-${suffix}`, tenantY, `CT5 Tenant Y ${suffix}`, `ct5-tenant-y-${suffix}`],
    );
    const tenantCompanyXA = crypto.randomUUID();
    const tenantCompanyYB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO tenant_companies (id, tenant_id, company_id, is_primary) VALUES ($1, $2, $3, true), ($4, $5, $6, true)`,
      [tenantCompanyXA, tenantX, companyA, tenantCompanyYB, tenantY, companyB],
    );

    const pwPlain = crypto.randomBytes(12).toString("hex");
    const pwHash = await bcrypt.hash(pwPlain, 10);

    const userAAdmin = crypto.randomUUID();
    const platformSuperAdminId = crypto.randomUUID();
    const platformAdminId = crypto.randomUUID();
    const platformBillingId = crypto.randomUUID();
    const platformAuditorId = crypto.randomUUID();
    const usernameAAdmin = `ct5_a_admin_${suffix}`;
    const usernamePlatformSuperAdmin = `ct5_plat_super_${suffix}`;
    const usernamePlatformAdmin = `ct5_plat_admin_${suffix}`;
    const usernamePlatformBilling = `ct5_plat_billing_${suffix}`;
    const usernamePlatformAuditor = `ct5_plat_auditor_${suffix}`;
    const nonexistentId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO users (id, username, password, role, company_id, worker_id, first_name, last_name, is_active) VALUES
       ($1,$2,$3,'admin',$4,NULL,'CT5','AdminA', true),
       ($5,$6,$3,'platform_super_admin',NULL,NULL,'CT5','PlatSuper', true),
       ($7,$8,$3,'platform_admin',NULL,NULL,'CT5','PlatAdmin', true),
       ($9,$10,$3,'platform_billing',NULL,NULL,'CT5','PlatBilling', true),
       ($11,$12,$3,'platform_auditor',NULL,NULL,'CT5','PlatAuditor', true)`,
      [
        userAAdmin, usernameAAdmin, pwHash, companyA,
        platformSuperAdminId, usernamePlatformSuperAdmin,
        platformAdminId, usernamePlatformAdmin,
        platformBillingId, usernamePlatformBilling,
        platformAuditorId, usernamePlatformAuditor,
      ],
    );

    // ── Schema-drift workaround (test-infra only, not an app-code change) ────
    // feature_overrides.(company_id, feature_key) is declared UNIQUE only in
    // server/index.ts's own `CREATE TABLE IF NOT EXISTS` bootstrap
    // (server/index.ts:3235-3246), never in shared/schema.ts — so a database
    // built via `drizzle-kit push` (as this disposable test database is) gets
    // a feature_overrides table with no such constraint, and the app's own
    // `CREATE TABLE IF NOT EXISTS` is a no-op once the table already exists.
    // POST /api/feature-registry/activate and .../bulk-activate both rely on
    // `ON CONFLICT (company_id, feature_key) DO UPDATE`, which requires this
    // exact constraint to exist or every upsert 500s regardless of caller —
    // confirmed by reproduction before adding this workaround. This is a
    // distinct instance of the same schema-drift class already tracked in
    // docs/saas-readiness/phase-0.5-a-ci-baseline-manifest.md (finding D5:
    // columns/constraints added only via raw bootstrap SQL, never mirrored in
    // shared/schema.ts) — documented in the findings doc as an
    // out-of-scope-for-this-batch informational note, not a cross-tenant
    // defect, and NOT repaired in application code here (audit-only branch).
    // Adding the missing constraint directly to this disposable database is
    // test-infrastructure setup, the same category of action as the
    // `drizzle-kit push` that built this schema in the first place — it does
    // not touch server/, shared/, or storage.ts.
    await pool.query(`ALTER TABLE feature_overrides ADD CONSTRAINT IF NOT EXISTS feature_overrides_company_feature_unique UNIQUE (company_id, feature_key)`).catch(async () => {
      // Older Postgres (<15) lacks "ADD CONSTRAINT IF NOT EXISTS" — fall back to a plain unique index, which ON CONFLICT accepts equally.
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS feature_overrides_company_feature_unique_idx ON feature_overrides (company_id, feature_key)`);
    });

    // ── Feature registry + per-tenant overrides ───────────────────────────────
    const featureKey = `ct5_test_feature_${suffix}`;
    await pool.query(
      `INSERT INTO feature_registry (feature_key, module, feature_name, layer, default_on) VALUES ($1, 'ct5', 'CT5 Test Feature', 'tenant', false)`,
      [featureKey],
    );
    await pool.query(
      `INSERT INTO feature_overrides (company_id, feature_key, enabled, notes) VALUES ($1, $2, true, 'CT5 override A')`,
      [companyA, featureKey],
    );

    // ── Tenant commercial gates ────────────────────────────────────────────────
    const gateA = crypto.randomUUID();
    await pool.query(
      `INSERT INTO tenant_commercial_gates (id, company_id, agreement_status, implementation_fee_status, subscription_status, payment_method_status, lifecycle_state, selected_template)
       VALUES ($1, $2, 'signed', 'paid', 'active', 'verified', 'pending_activation', 'small_business_payroll_only')`,
      [gateA, companyA],
    );
    // companyB deliberately has NO pre-existing gate row (exercises the
    // insert branch of storage.upsertTenantCommercialGate, and getOrCreateGate).

    // ── Provisioning audit-log fixtures (for the read-scoping sanity check) ───
    const provAuditA = crypto.randomUUID();
    await pool.query(
      `INSERT INTO tenant_provisioning_audit_logs (id, company_id, event_type, status, details) VALUES ($1, $2, 'tenant.provisioning.requested', 'success', 'CT5 seed audit row A')`,
      [provAuditA, companyA],
    );

    // ── Authorization-audit-log fixtures (for GET /api/audit-log) ─────────────
    const authAuditA = crypto.randomUUID();
    const authAuditB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO authorization_audit_log (id, actor_user_id, change_type, company_id, note) VALUES
       ($1, $2, 'ct5_test_change', $3, 'CT5 audit row A'),
       ($4, $2, 'ct5_test_change', $5, 'CT5 audit row B')`,
      [authAuditA, userAAdmin, companyA, authAuditB, companyB],
    );

    // ── Boot the real server against this disposable database ────────────────
    server = await startTestServer(testDatabaseUrl);
    const baseUrl = server.baseUrl;

    const sessionAAdmin: Session = await login(baseUrl, usernameAAdmin, pwPlain);
    const sessionPlatformSuperAdmin: Session = await login(baseUrl, usernamePlatformSuperAdmin, pwPlain);
    const sessionPlatformAdmin: Session = await login(baseUrl, usernamePlatformAdmin, pwPlain);
    const sessionPlatformBilling: Session = await login(baseUrl, usernamePlatformBilling, pwPlain);
    const sessionPlatformAuditor: Session = await login(baseUrl, usernamePlatformAuditor, pwPlain);

    // ══════════════════════ 1. GET /api/feature-registry/tenant/:companyId ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "GET", `/api/feature-registry/tenant/${companyA}`, sessionPlatformSuperAdmin);
      const list1 = Array.isArray(r1.body) ? (r1.body as Array<{ featureKey?: string; overrideEnabled?: boolean }>) : [];
      const rowA = list1.find((x) => x.featureKey === featureKey);
      cases.push({ case: "1. Platform super admin reads Tenant A's feature overrides by companyId", disposition: r1.status === 200 && rowA?.overrideEnabled === true ? "PASS" : "FAIL", detail: `status=${r1.status} overrideEnabled=${rowA?.overrideEnabled}` });

      const r2 = await apiRequest(baseUrl, "GET", `/api/feature-registry/tenant/${companyB}`, sessionPlatformSuperAdmin);
      const list2 = Array.isArray(r2.body) ? (r2.body as Array<{ featureKey?: string; overrideEnabled?: boolean | null }>) : [];
      const rowB = list2.find((x) => x.featureKey === featureKey);
      cases.push({
        case: "2. Same platform super admin reads Tenant B's feature overrides via a different companyId path segment",
        disposition: r2.status === 200 && rowB && rowB.overrideEnabled == null ? "EXPECTED GLOBAL" : "INCONCLUSIVE",
        detail: `status=${r2.status} overrideEnabled=${rowB?.overrideEnabled} — this route is an intentional platform-console cross-tenant view; correctly returns B's own (empty) override state, not A's, confirming the companyId path segment is honored as a real filter rather than ignored.`,
      });

      const r3 = await apiRequest(baseUrl, "GET", `/api/feature-registry/tenant/${companyA}`, sessionPlatformBilling);
      cases.push({
        case: "3. Role-gate breadth: lowest-trust platform role (platform_billing) can also read any tenant's feature-override state",
        disposition: r3.status === 200 ? "EXPECTED GLOBAL" : "INCONCLUSIVE",
        detail: `status=${r3.status} — requirePlatformRole() (server/routes.ts:306-324) accepts all 7 platform roles for this read-only route with no inline narrowing; documented as expected/by-design for a read, not a defect, since no tenant-scoped role can reach this route at all (case 4).`,
      });

      const r4 = await apiRequest(baseUrl, "GET", `/api/feature-registry/tenant/${companyA}`, sessionAAdmin);
      cases.push({ case: "4. Tenant-scoped (non-platform) admin is blocked", disposition: r4.status === 403 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      const r5 = await apiRequest(baseUrl, "GET", `/api/feature-registry/tenant/${nonexistentId}`, sessionPlatformSuperAdmin);
      const list5 = Array.isArray(r5.body) ? r5.body : [];
      cases.push({ case: "5. Nonexistent companyId — no company-existence check; LEFT JOIN yields default (non-overridden) feature state rather than an error, no data leaked", disposition: r5.status === 200 && Array.isArray(list5) ? "PASS" : "FAIL", detail: `status=${r5.status} count=${(list5 as unknown[]).length}` });

      const r6 = await apiRequest(baseUrl, "GET", `/api/feature-registry/tenant/${companyA}`, null);
      cases.push({ case: "6. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("GET /api/feature-registry/tenant/:companyId", "server/routes.ts:35715", cases);
    }

    // ══════════════════════ 2. POST /api/feature-registry/activate ══════════════════════
    {
      const cases: CaseResult[] = [];
      const featureKey2 = `ct5_test_feature2_${suffix}`;
      await pool.query(`INSERT INTO feature_registry (feature_key, module, feature_name, layer, default_on) VALUES ($1, 'ct5', 'CT5 Test Feature 2', 'tenant', false)`, [featureKey2]);

      const r1 = await apiRequest(baseUrl, "POST", `/api/feature-registry/activate`, sessionPlatformSuperAdmin, { companyId: companyA, featureKey: featureKey2, enabled: true });
      cases.push({ case: "1. Platform super admin activates a feature for Tenant A (explicit target, by design)", disposition: r1.status === 200 && (r1.body as any)?.companyId === companyA ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      const r2 = await apiRequest(baseUrl, "POST", `/api/feature-registry/activate`, sessionPlatformBilling, { companyId: companyA, featureKey: featureKey2, enabled: false });
      cases.push({
        case: "2. Role-gate check: platform_billing is blocked by this route's own inline narrowing (platform_super_admin/platform_admin only) despite passing the outer requirePlatformRole() gate",
        disposition: r2.status === 403 ? "PASS" : "FAIL",
        detail: `status=${r2.status} — contrasts with #6/#7/#8 below, which have no such inline narrowing.`,
      });

      const beforeCount = await pool.query("SELECT COUNT(*)::int AS n FROM feature_overrides WHERE company_id = $1", [nonexistentId]);
      const r3 = await apiRequest(baseUrl, "POST", `/api/feature-registry/activate`, sessionPlatformSuperAdmin, { companyId: nonexistentId, featureKey: featureKey2, enabled: true });
      const afterCount = await pool.query("SELECT COUNT(*)::int AS n FROM feature_overrides WHERE company_id = $1", [nonexistentId]);
      const orphanCreated = afterCount.rows[0].n > beforeCount.rows[0].n;
      if (orphanCreated) await pool.query("DELETE FROM feature_overrides WHERE company_id = $1", [nonexistentId]);
      cases.push({
        case: "3. Nonexistent companyId — feature_overrides.company_id has no FK constraint (shared/schema.ts), and this handler never checks storage.getCompany(companyId) before writing",
        disposition: orphanCreated ? "FAIL" : "PASS",
        detail: orphanCreated ? `VERIFIED DEFECT: status=${r3.status}, an orphaned feature_overrides row was silently created for a companyId that does not exist in companies. Cleaned up immediately after detection.` : `status=${r3.status}, no orphan row created`,
      });

      const r4 = await apiRequest(baseUrl, "POST", `/api/feature-registry/activate`, sessionAAdmin, { companyId: companyA, featureKey: featureKey2, enabled: true });
      cases.push({ case: "4. Tenant-scoped (non-platform) admin is blocked", disposition: r4.status === 403 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      const r5 = await apiRequest(baseUrl, "POST", `/api/feature-registry/activate`, null, { companyId: companyA, featureKey: featureKey2, enabled: true });
      cases.push({ case: "5. Missing authentication", disposition: r5.status === 401 ? "PASS" : "FAIL", detail: `status=${r5.status}` });

      record("POST /api/feature-registry/activate", "server/routes.ts:35813", cases);
    }

    // ══════════════════════ 3. POST /api/feature-registry/bulk-activate ══════════════════════
    {
      const cases: CaseResult[] = [];
      const featureKey3 = `ct5_test_feature3_${suffix}`;
      await pool.query(`INSERT INTO feature_registry (feature_key, module, feature_name, layer, default_on) VALUES ($1, 'ct5', 'CT5 Test Feature 3', 'tenant', false)`, [featureKey3]);

      const r1 = await apiRequest(baseUrl, "POST", `/api/feature-registry/bulk-activate`, sessionPlatformSuperAdmin, { companyId: companyA, features: [{ featureKey: featureKey3, enabled: true }] });
      cases.push({ case: "1. Platform super admin bulk-activates a feature for Tenant A", disposition: r1.status === 200 && (r1.body as any)?.count === 1 ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      const r2 = await apiRequest(baseUrl, "POST", `/api/feature-registry/bulk-activate`, sessionPlatformAuditor, { companyId: companyA, features: [{ featureKey: featureKey3, enabled: false }] });
      cases.push({
        case: "2. Role-gate check: platform_auditor is blocked by this route's own inline narrowing (platform_super_admin/platform_admin only)",
        disposition: r2.status === 403 ? "PASS" : "FAIL",
        detail: `status=${r2.status}`,
      });

      const r3 = await apiRequest(baseUrl, "POST", `/api/feature-registry/bulk-activate`, sessionAAdmin, { companyId: companyA, features: [{ featureKey: featureKey3, enabled: true }] });
      cases.push({ case: "3. Tenant-scoped (non-platform) admin is blocked", disposition: r3.status === 403 ? "PASS" : "FAIL", detail: `status=${r3.status}` });

      const r4 = await apiRequest(baseUrl, "POST", `/api/feature-registry/bulk-activate`, null, { companyId: companyA, features: [{ featureKey: featureKey3, enabled: true }] });
      cases.push({ case: "4. Missing authentication", disposition: r4.status === 401 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      record("POST /api/feature-registry/bulk-activate", "server/routes.ts:35864", cases);
    }

    // ══════════════════════ 4. GET /api/provisioning/tenants/:companyId ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "GET", `/api/provisioning/tenants/${companyA}`, sessionPlatformSuperAdmin);
      const gate1 = (r1.body as any)?.gate;
      cases.push({ case: "1. Platform super admin reads Tenant A's provisioning status", disposition: r1.status === 200 && gate1?.companyId === companyA ? "PASS" : "FAIL", detail: `status=${r1.status} gate.companyId=${gate1?.companyId}` });

      const r2 = await apiRequest(baseUrl, "GET", `/api/provisioning/tenants/${companyB}`, sessionPlatformSuperAdmin);
      const gate2 = (r2.body as any)?.gate;
      cases.push({
        case: "2. Same session reads Tenant B's provisioning status via a different companyId — correctly returns B's own (null, no gate row yet) state rather than A's",
        disposition: r2.status === 200 && gate2 == null ? "PASS" : "FAIL",
        detail: `status=${r2.status} gate=${JSON.stringify(gate2)}`,
      });

      const r3 = await apiRequest(baseUrl, "GET", `/api/provisioning/tenants/${companyA}`, sessionAAdmin);
      cases.push({ case: "3. Tenant-scoped (non-platform) admin is blocked", disposition: r3.status === 403 ? "PASS" : "FAIL", detail: `status=${r3.status}` });

      const r4 = await apiRequest(baseUrl, "GET", `/api/provisioning/tenants/${nonexistentId}`, sessionPlatformSuperAdmin);
      cases.push({ case: "4. Nonexistent companyId — returns { gate: null, auditLogs: [], implementationProject: null } gracefully, no error, no leak", disposition: r4.status === 200 && (r4.body as any)?.gate === null ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      const r5 = await apiRequest(baseUrl, "GET", `/api/provisioning/tenants/${companyA}`, null);
      cases.push({ case: "5. Missing authentication", disposition: r5.status === 401 ? "PASS" : "FAIL", detail: `status=${r5.status}` });

      record("GET /api/provisioning/tenants/:companyId", "server/routes.ts:31433", cases);
    }

    // ══════════════════════ 5. GET /api/provisioning/tenants/:companyId/audit ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "GET", `/api/provisioning/tenants/${companyA}/audit`, sessionPlatformSuperAdmin);
      const list1 = Array.isArray(r1.body) ? (r1.body as Array<{ companyId?: string; details?: string }>) : [];
      cases.push({ case: "1. Platform super admin reads Tenant A's provisioning audit log", disposition: r1.status === 200 && list1.some((x) => x.details === "CT5 seed audit row A") ? "PASS" : "FAIL", detail: `status=${r1.status} count=${list1.length}` });

      const r2 = await apiRequest(baseUrl, "GET", `/api/provisioning/tenants/${companyB}/audit`, sessionPlatformSuperAdmin);
      const list2 = Array.isArray(r2.body) ? (r2.body as Array<{ details?: string }>) : [];
      const leaked = r2.status === 200 && list2.some((x) => x.details === "CT5 seed audit row A");
      cases.push({
        case: "2. Same session reads Tenant B's provisioning audit log via a different companyId — must not carry Tenant A's row",
        disposition: leaked ? "FAIL" : r2.status === 200 && list2.length === 0 ? "PASS" : "INCONCLUSIVE",
        detail: leaked ? `VERIFIED DEFECT: Tenant A's audit row appeared while filtering by Tenant B's companyId.` : `status=${r2.status} count=${list2.length}`,
      });

      const r3 = await apiRequest(baseUrl, "GET", `/api/provisioning/tenants/${companyA}/audit`, sessionAAdmin);
      cases.push({ case: "3. Tenant-scoped (non-platform) admin is blocked", disposition: r3.status === 403 ? "PASS" : "FAIL", detail: `status=${r3.status}` });

      const r4 = await apiRequest(baseUrl, "GET", `/api/provisioning/tenants/${companyA}/audit`, null);
      cases.push({ case: "4. Missing authentication", disposition: r4.status === 401 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      record("GET /api/provisioning/tenants/:companyId/audit", "server/routes.ts:31440", cases);
    }

    // ══════════════════════ 6. POST /api/provisioning/tenants/:companyId/retry ══════════════════════
    {
      const cases: CaseResult[] = [];
      const beforeGate = await pool.query("SELECT lifecycle_state, provisioned_at FROM tenant_commercial_gates WHERE company_id = $1", [companyA]);
      const beforeAuditCount = await pool.query("SELECT COUNT(*)::int AS n FROM tenant_provisioning_audit_logs WHERE company_id = $1", [companyA]);

      const r1 = await apiRequest(baseUrl, "POST", `/api/provisioning/tenants/${companyA}/retry`, sessionPlatformAuditor);

      const afterGate = await pool.query("SELECT lifecycle_state, provisioned_at FROM tenant_commercial_gates WHERE company_id = $1", [companyA]);
      const afterAuditCount = await pool.query("SELECT COUNT(*)::int AS n FROM tenant_provisioning_audit_logs WHERE company_id = $1", [companyA]);
      // lifecycle_state flipping pending_activation -> active is the definitive,
      // unconditional marker runProvisioningWorkflow sets after every step runs
      // (server/provisioning/TenantProvisioningService.ts:203-210) — a more
      // reliable signal than "a new user was created" (stepCreateTenantOwner
      // skips user creation when one already exists for the company, which is
      // true here since this batch's own fixture already seeded userAAdmin for
      // Tenant A before this route runs).
      const provisioned =
        beforeGate.rows[0]?.lifecycle_state === "pending_activation" &&
        afterGate.rows[0]?.lifecycle_state === "active" &&
        afterGate.rows[0]?.provisioned_at != null &&
        afterAuditCount.rows[0].n > beforeAuditCount.rows[0].n;

      cases.push({
        case: "1. Role-gate breadth: platform_auditor (no inline narrowing on this route, unlike #2/#3) can fully provision/activate Tenant A — flips the commercial gate's lifecycle_state to active and runs every provisioning step (billing activation, owner-user bootstrap, department/permission seeding, implementation-project creation)",
        disposition: provisioned ? "FAIL" : "INCONCLUSIVE",
        detail: provisioned
          ? `VERIFIED DEFECT: status=${r1.status}, body=${JSON.stringify(r1.body)}. tenant_commercial_gates.lifecycle_state for Tenant A went from "pending_activation" to "active" (provisioned_at set, ${afterAuditCount.rows[0].n - beforeAuditCount.rows[0].n} new tenant_provisioning_audit_logs rows written) via a request from a platform_auditor session. requirePlatformRole() (server/routes.ts:306-324) accepts platform_auditor for this route with no inline check narrower than "any platform role" — the same power as platform_super_admin/platform_admin on a route named "retry" that a support/billing/auditor account would reasonably be expected to only observe, not trigger.`
          : `status=${r1.status}, no full-provisioning transition detected (lifecycle_state before="${beforeGate.rows[0]?.lifecycle_state}" after="${afterGate.rows[0]?.lifecycle_state}") — treated as inconclusive rather than PASS/FAIL pending manual confirmation of gate state.`,
      });

      const r2 = await apiRequest(baseUrl, "POST", `/api/provisioning/tenants/${nonexistentId}/retry`, sessionPlatformSuperAdmin);
      cases.push({ case: "2. Nonexistent companyId — storage.getTenantCommercialGate returns undefined and this route explicitly 404s (unlike most other routes in this batch)", disposition: r2.status === 404 ? "PASS" : "FAIL", detail: `status=${r2.status}` });

      const r3 = await apiRequest(baseUrl, "POST", `/api/provisioning/tenants/${companyB}/retry`, sessionAAdmin);
      cases.push({ case: "3. Tenant-scoped (non-platform) admin is blocked", disposition: r3.status === 403 ? "PASS" : "FAIL", detail: `status=${r3.status}` });

      const r4 = await apiRequest(baseUrl, "POST", `/api/provisioning/tenants/${companyB}/retry`, null);
      cases.push({ case: "4. Missing authentication", disposition: r4.status === 401 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      record("POST /api/provisioning/tenants/:companyId/retry", "server/routes.ts:31456", cases);
    }

    // ══════════════════════ 7. PATCH /api/provisioning/tenants/:companyId/gates ══════════════════════
    {
      const cases: CaseResult[] = [];

      const r1 = await apiRequest(baseUrl, "PATCH", `/api/provisioning/tenants/${companyA}/gates`, sessionPlatformSuperAdmin, { notes: "CT5 patched by super admin" });
      cases.push({ case: "1. Platform super admin patches Tenant A's own gate notes", disposition: r1.status === 200 && (r1.body as any)?.notes === "CT5 patched by super admin" ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      const beforeReassign = await pool.query("SELECT company_id FROM tenant_commercial_gates WHERE id = $1", [gateA]);
      const r2 = await apiRequest(baseUrl, "PATCH", `/api/provisioning/tenants/${companyA}/gates`, sessionPlatformSuperAdmin, { companyId: companyB, notes: "CT5 reassignment attempt" });
      const afterReassign = await pool.query("SELECT company_id FROM tenant_commercial_gates WHERE id = $1", [gateA]);
      const reassigned = afterReassign.rows[0]?.company_id !== beforeReassign.rows[0]?.company_id;
      if (reassigned) await pool.query("UPDATE tenant_commercial_gates SET company_id = $1 WHERE id = $2", [companyA, gateA]);
      cases.push({
        case: "2. Client-supplied companyId reassignment: PATCH targets Tenant A's gate row via the URL, but the request body also carries companyId=Tenant B — storage.upsertTenantCommercialGate's update branch does `{ ...data, updatedAt }` (server/storage.ts:4301-4304), so a body-supplied companyId silently overrides the URL's tenant scoping",
        disposition: reassigned ? "FAIL" : "PASS",
        detail: reassigned ? `VERIFIED DEFECT: status=${r2.status}. Tenant A's own commercial-gate row (id=${gateA}) had its company_id column reassigned from ${beforeReassign.rows[0]?.company_id} to Tenant B's id via the request body, despite the URL explicitly targeting Tenant A. Restored immediately after detection.` : `status=${r2.status}, company_id unchanged (${beforeReassign.rows[0]?.company_id})` });

      const beforeInsertCount = await pool.query("SELECT COUNT(*)::int AS n FROM tenant_commercial_gates WHERE company_id = $1", [companyB]);
      const r3 = await apiRequest(baseUrl, "PATCH", `/api/provisioning/tenants/${companyA}/gates`, sessionPlatformSuperAdmin, { companyId: companyB, notes: "CT5 insert-branch reassignment probe" });
      const afterInsertCount = await pool.query("SELECT COUNT(*)::int AS n FROM tenant_commercial_gates WHERE company_id = $1", [companyB]);
      const insertReassigned = afterInsertCount.rows[0].n > beforeInsertCount.rows[0].n;
      cases.push({
        case: "3. Note — case 2 above already exercises the update branch (Tenant A already had a gate row); this case is INCONCLUSIVE-by-construction once a gate row exists for A, retained for completeness of the insert-branch code path described in the module docstring rather than re-run against a fresh company",
        disposition: "N/A",
        detail: `insert-branch companyId-override (values({ companyId, ...data }), server/storage.ts:4307-4310) was not independently exercised in this run because case 2 already created a gate row for Tenant A before this case executes; documented in the findings doc as an equivalent code path requiring the same fix. companyB gate rows before=${beforeInsertCount.rows[0].n} after=${afterInsertCount.rows[0].n}${insertReassigned ? " (unexpected extra row created — see findings doc)" : ""}`,
      });

      const r4 = await apiRequest(baseUrl, "PATCH", `/api/provisioning/tenants/${companyA}/gates`, sessionPlatformBilling, { notes: "CT5 billing role probe" });
      cases.push({
        case: "4. Role-gate breadth: platform_billing (no inline narrowing on this route) can mutate any tenant's commercial/subscription gates",
        disposition: r4.status === 200 ? "FAIL" : "INCONCLUSIVE",
        detail: r4.status === 200 ? `VERIFIED DEFECT: status=200 — requirePlatformRole() (server/routes.ts:306-324) allows platform_billing to reach and mutate commercial gate state (agreement/implementation-fee/subscription/payment-method status), with no narrower role check on a mutating route.` : `status=${r4.status}`,
      });

      const r5 = await apiRequest(baseUrl, "PATCH", `/api/provisioning/tenants/${companyA}/gates`, sessionAAdmin, { notes: "x" });
      cases.push({ case: "5. Tenant-scoped (non-platform) admin is blocked", disposition: r5.status === 403 ? "PASS" : "FAIL", detail: `status=${r5.status}` });

      const r6 = await apiRequest(baseUrl, "PATCH", `/api/provisioning/tenants/${companyA}/gates`, null, { notes: "x" });
      cases.push({ case: "6. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("PATCH /api/provisioning/tenants/:companyId/gates", "server/routes.ts:31466", cases);
    }

    // ══════════════════════ 8. POST /api/provisioning/event ══════════════════════
    {
      const cases: CaseResult[] = [];

      const beforeStatus = await pool.query("SELECT subscription_status FROM companies WHERE id = $1", [companyA]);
      const r1 = await apiRequest(baseUrl, "POST", `/api/provisioning/event`, sessionPlatformBilling, { companyId: companyA, event: "tenant.suspended" });
      const afterStatus = await pool.query("SELECT subscription_status FROM companies WHERE id = $1", [companyA]);
      const suspended = afterStatus.rows[0]?.subscription_status === "suspended" && beforeStatus.rows[0]?.subscription_status !== "suspended";
      if (suspended) await pool.query("UPDATE companies SET subscription_status = $1 WHERE id = $2", [beforeStatus.rows[0]?.subscription_status, companyA]);
      cases.push({
        case: "1. Role-gate breadth: platform_billing (no inline narrowing) can suspend any tenant's subscription outright via event=\"tenant.suspended\"",
        disposition: suspended ? "FAIL" : "INCONCLUSIVE",
        detail: suspended ? `VERIFIED DEFECT: status=${r1.status}. companies.subscription_status for Tenant A changed from "${beforeStatus.rows[0]?.subscription_status}" to "suspended" via a request from a platform_billing session — a role whose name implies billing-adjacent read/administrative access, not the power to unilaterally suspend a paying tenant. Restored immediately after detection.` : `status=${r1.status}, subscription_status unchanged`,
      });

      const beforeGateB = await pool.query("SELECT COUNT(*)::int AS n FROM tenant_commercial_gates WHERE company_id = $1", [companyB]);
      const r2 = await apiRequest(baseUrl, "POST", `/api/provisioning/event`, sessionPlatformBilling, { companyId: companyB, event: "subscription.activated" });
      const afterGateB = await pool.query("SELECT subscription_status FROM tenant_commercial_gates WHERE company_id = $1", [companyB]);
      cases.push({
        case: "2. Role-gate breadth: platform_billing can also flip Tenant B's commercial subscription-gate to active via event=\"subscription.activated\" (auto-creates the gate row via getOrCreateGate if none existed)",
        disposition: afterGateB.rows[0]?.subscription_status === "active" ? "FAIL" : "INCONCLUSIVE",
        detail: afterGateB.rows[0]?.subscription_status === "active" ? `VERIFIED DEFECT: status=${r2.status}, tenant_commercial_gates.subscription_status for Tenant B is now "active" (before this request: no gate row existed, beforeCount=${beforeGateB.rows[0].n}). This is the exact "subscription paid/verified" step the commercial gate model exists to protect, bypassable by the lowest-trust platform role.` : `status=${r2.status} gateStatus=${afterGateB.rows[0]?.subscription_status}`,
      });

      const r3 = await apiRequest(baseUrl, "POST", `/api/provisioning/event`, sessionPlatformSuperAdmin, { companyId: nonexistentId, event: "agreement.signed" });
      cases.push({ case: "3. Nonexistent companyId — tenant_commercial_gates.company_id has an FK to companies(id); getOrCreateGate's insert fails, caught internally by handleProvisioningEvent, and the route still responds 200 with success:false rather than throwing or leaking", disposition: r3.status === 200 && (r3.body as any)?.success === false ? "PASS" : "INCONCLUSIVE", detail: `status=${r3.status} body=${JSON.stringify(r3.body)}` });

      const r4 = await apiRequest(baseUrl, "POST", `/api/provisioning/event`, sessionAAdmin, { companyId: companyA, event: "agreement.signed" });
      cases.push({ case: "4. Tenant-scoped (non-platform) admin is blocked", disposition: r4.status === 403 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      const r5 = await apiRequest(baseUrl, "POST", `/api/provisioning/event`, null, { companyId: companyA, event: "agreement.signed" });
      cases.push({ case: "5. Missing authentication", disposition: r5.status === 401 ? "PASS" : "FAIL", detail: `status=${r5.status}` });

      record("POST /api/provisioning/event", "server/routes.ts:31447", cases);
    }

    // ══════════════════════ 9. POST /api/platform/audit/contracts/:companyId/sign ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "POST", `/api/platform/audit/contracts/${companyA}/sign`, sessionPlatformSuperAdmin);
      const after1 = await pool.query("SELECT agreement_signed_at, agreement_signed_by_user_id FROM companies WHERE id = $1", [companyA]);
      cases.push({ case: "1. Platform super admin signs Tenant A's agreement (explicit target, by design)", disposition: r1.status === 200 && after1.rows[0]?.agreement_signed_at != null && after1.rows[0]?.agreement_signed_by_user_id === platformSuperAdminId ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      const before2 = await pool.query("SELECT COUNT(*)::int AS n FROM companies WHERE agreement_signed_by_user_id = $1 AND id = $2", [platformSuperAdminId, nonexistentId]);
      const r2 = await apiRequest(baseUrl, "POST", `/api/platform/audit/contracts/${nonexistentId}/sign`, sessionPlatformSuperAdmin);
      cases.push({
        case: "2. Nonexistent companyId — UPDATE affects 0 rows (no existence check, no rowCount check) but the route still reports { success: true }",
        disposition: r2.status === 200 && (r2.body as any)?.success === true ? "FAIL" : "INCONCLUSIVE",
        detail: (r2.body as any)?.success === true ? `VERIFIED DEFECT: status=${r2.status}, body=${JSON.stringify(r2.body)} — reports success for an id that matches no company row (server/routes.ts:33289-33303 never checks UPDATE's rowCount or pre-verifies the company exists). No cross-tenant data exposure results (nothing was actually changed, confirmed: matching-row count before=${before2.rows[0].n}) — misleading audit-trail response, not a tenant-isolation break.` : `status=${r2.status} body=${JSON.stringify(r2.body)}`,
      });

      const r3 = await apiRequest(baseUrl, "POST", `/api/platform/audit/contracts/${companyA}/sign`, sessionPlatformBilling);
      cases.push({ case: "3. Role-gate check: requirePlatformAudit correctly excludes platform_billing (platform_super_admin only) — positive control contrasting with #6/#7/#8's broad requirePlatformRole()", disposition: r3.status === 403 ? "PASS" : "FAIL", detail: `status=${r3.status}` });

      const r4 = await apiRequest(baseUrl, "POST", `/api/platform/audit/contracts/${companyA}/sign`, sessionAAdmin);
      cases.push({ case: "4. Tenant-scoped (non-platform) admin is blocked", disposition: r4.status === 403 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      const r5 = await apiRequest(baseUrl, "POST", `/api/platform/audit/contracts/${companyA}/sign`, null);
      cases.push({ case: "5. Missing authentication", disposition: r5.status === 401 ? "PASS" : "FAIL", detail: `status=${r5.status}` });

      record("POST /api/platform/audit/contracts/:companyId/sign", "server/routes.ts:33289", cases);
    }

    // ══════════════════════ 10. POST /api/platform/audit/licensing/:companyId/gate-override ══════════════════════
    {
      const cases: CaseResult[] = [];
      const beforeA = await pool.query("SELECT subscription_status FROM companies WHERE id = $1", [companyA]);
      const beforeB = await pool.query("SELECT subscription_status, gate_override_reason FROM companies WHERE id = $1", [companyB]);

      const r1 = await apiRequest(baseUrl, "POST", `/api/platform/audit/licensing/${companyB}/gate-override`, sessionPlatformSuperAdmin, { subscriptionStatus: "active_paid", reason: "CT5 manual override test" });
      const afterA = await pool.query("SELECT subscription_status FROM companies WHERE id = $1", [companyA]);
      const afterB = await pool.query("SELECT subscription_status, gate_override_reason FROM companies WHERE id = $1", [companyB]);
      const targetedCorrectly = afterB.rows[0]?.subscription_status === "active_paid" && afterB.rows[0]?.gate_override_reason === "CT5 manual override test";
      const aUnaffected = afterA.rows[0]?.subscription_status === beforeA.rows[0]?.subscription_status;
      cases.push({
        case: "1. Platform super admin overrides Tenant B's licensing gate — verifies the correct company is targeted and Tenant A is untouched (expected/by-design platform action, not a leak)",
        disposition: r1.status === 200 && targetedCorrectly && aUnaffected ? "EXPECTED GLOBAL" : "FAIL",
        detail: `status=${r1.status} targetedCorrectly=${targetedCorrectly} aUnaffected=${aUnaffected}`,
      });
      await pool.query("UPDATE companies SET subscription_status = $1, gate_override_reason = $2 WHERE id = $3", [beforeB.rows[0]?.subscription_status, beforeB.rows[0]?.gate_override_reason, companyB]);

      const r2 = await apiRequest(baseUrl, "POST", `/api/platform/audit/licensing/${nonexistentId}/gate-override`, sessionPlatformSuperAdmin, { reason: "CT5 nonexistent probe" });
      cases.push({
        case: "2. Nonexistent companyId — same no-existence-check / no-rowCount-check pattern as #9, still reports { success: true }",
        disposition: r2.status === 200 && (r2.body as any)?.success === true ? "FAIL" : "INCONCLUSIVE",
        detail: (r2.body as any)?.success === true ? `VERIFIED DEFECT: status=${r2.status}, body=${JSON.stringify(r2.body)} — same pattern as finding for POST .../contracts/:companyId/sign, on the higher-impact licensing-override endpoint.` : `status=${r2.status} body=${JSON.stringify(r2.body)}`,
      });

      const r3 = await apiRequest(baseUrl, "POST", `/api/platform/audit/licensing/${companyA}/gate-override`, sessionPlatformAuditor, { reason: "CT5 auditor probe" });
      cases.push({ case: "3. Role-gate check: requirePlatformAudit correctly excludes platform_auditor too (platform_super_admin only) — positive control", disposition: r3.status === 403 ? "PASS" : "FAIL", detail: `status=${r3.status}` });

      const r4 = await apiRequest(baseUrl, "POST", `/api/platform/audit/licensing/${companyA}/gate-override`, sessionAAdmin, { reason: "x" });
      cases.push({ case: "4. Tenant-scoped (non-platform) admin is blocked", disposition: r4.status === 403 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      const r5 = await apiRequest(baseUrl, "POST", `/api/platform/audit/licensing/${companyA}/gate-override`, null, { reason: "x" });
      cases.push({ case: "5. Missing authentication", disposition: r5.status === 401 ? "PASS" : "FAIL", detail: `status=${r5.status}` });

      record("POST /api/platform/audit/licensing/:companyId/gate-override", "server/routes.ts:33306", cases);
    }

    // ══════════════════════ 11. DELETE /api/tenants/:id/companies/:companyId ══════════════════════
    {
      const cases: CaseResult[] = [];

      const before1 = await pool.query("SELECT 1 FROM tenant_companies WHERE tenant_id = $1 AND company_id = $2", [tenantY, companyB]);
      const r1 = await apiRequest(baseUrl, "DELETE", `/api/tenants/${tenantX}/companies/${companyB}`, sessionPlatformSuperAdmin);
      const after1 = await pool.query("SELECT 1 FROM tenant_companies WHERE tenant_id = $1 AND company_id = $2", [tenantY, companyB]);
      cases.push({
        case: "1. Mismatched tenant/company pair (real Tenant X + Tenant B's companyId, but B actually belongs to Tenant Y) does not delete Tenant Y's real association",
        disposition: before1.rows.length > 0 && after1.rows.length > 0 ? "PASS" : "FAIL",
        detail: `status=${r1.status} — WHERE tenant_id=X AND company_id=B matches no row since B belongs to Y, so Y's real (tenant_id,company_id) tuple is untouched. rowExistsBefore=${before1.rows.length > 0} rowExistsAfter=${after1.rows.length > 0}`,
      });

      const r1body = r1.body as any;
      cases.push({
        case: "2. Side effect after a no-op request: the mismatched-pair request in case 1 still reports { ok: true } (no rowCount check) — DELETE has no existence verification before responding, and invalidateTenantCache(companyId) is called unconditionally regardless of whether any row was actually deleted",
        disposition: r1.status === 200 && r1body?.ok === true ? "FAIL" : "INCONCLUSIVE",
        detail: r1.status === 200 && r1body?.ok === true ? `VERIFIED DEFECT: a request that deleted nothing (case 1) reports the same { ok: true } response as an actual deletion — an API consumer or automation cannot distinguish "deleted" from "no matching row existed" from the response alone (server/routes.ts:31404-31415).` : `status=${r1.status} body=${JSON.stringify(r1body)}`,
      });

      const before3 = await pool.query("SELECT 1 FROM tenant_companies WHERE tenant_id = $1 AND company_id = $2", [tenantX, companyA]);
      const r3 = await apiRequest(baseUrl, "DELETE", `/api/tenants/${tenantX}/companies/${companyA}`, sessionPlatformSuperAdmin);
      const after3 = await pool.query("SELECT 1 FROM tenant_companies WHERE tenant_id = $1 AND company_id = $2", [tenantX, companyA]);
      cases.push({ case: "3. Platform super admin deletes the real, correctly-matched Tenant X ↔ Tenant A's companyId association", disposition: before3.rows.length > 0 && after3.rows.length === 0 && r3.status === 200 ? "PASS" : "FAIL", detail: `status=${r3.status}` });
      if (after3.rows.length === 0) {
        await pool.query("INSERT INTO tenant_companies (id, tenant_id, company_id, is_primary) VALUES ($1, $2, $3, true)", [crypto.randomUUID(), tenantX, companyA]);
      }

      const r4 = await apiRequest(baseUrl, "DELETE", `/api/tenants/${tenantX}/companies/${companyA}`, sessionPlatformBilling);
      cases.push({ case: "4. Role-gate check: requireSuperAdmin correctly excludes platform_billing (platform_super_admin only) — positive control", disposition: r4.status === 403 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      const r5 = await apiRequest(baseUrl, "DELETE", `/api/tenants/${tenantX}/companies/${companyA}`, sessionAAdmin);
      cases.push({ case: "5. Tenant-scoped (non-platform) admin is blocked", disposition: r5.status === 403 ? "PASS" : "FAIL", detail: `status=${r5.status}` });

      const r6 = await apiRequest(baseUrl, "DELETE", `/api/tenants/${tenantX}/companies/${companyA}`, null);
      cases.push({ case: "6. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("DELETE /api/tenants/:id/companies/:companyId", "server/routes.ts:31404", cases);
    }

    // ══════════════════════ 12. GET /api/audit-log ══════════════════════
    {
      const cases: CaseResult[] = [];

      const r1 = await apiRequest(baseUrl, "GET", `/api/audit-log`, sessionAAdmin);
      const rows1 = Array.isArray((r1.body as any)?.rows) ? (r1.body as any).rows as Array<{ companyId?: string; note?: string }> : [];
      const onlyOwnCompany = rows1.every((x) => x.companyId !== companyB);
      cases.push({ case: "1. Tenant A admin (legacy \"admin\" role) reads the audit log — force-scoped to their own company regardless of the resolvedCompanyId branch, does not see Tenant B's row", disposition: r1.status === 200 && rows1.some((x) => x.note === "CT5 audit row A") && onlyOwnCompany ? "PASS" : "FAIL", detail: `status=${r1.status} count=${rows1.length} onlyOwnCompany=${onlyOwnCompany}` });

      const r2 = await apiRequest(baseUrl, "GET", `/api/audit-log?companyId=${companyB}`, sessionAAdmin);
      const rows2 = Array.isArray((r2.body as any)?.rows) ? (r2.body as any).rows as Array<{ companyId?: string }> : [];
      const leaked2 = r2.status === 200 && rows2.some((x) => x.companyId === companyB);
      cases.push({
        case: "2. Tenant A admin attempts to override scope via ?companyId=Tenant B — resolvedCompanyId ignores the query param for non-platform_super_admin roles (server/routes.ts:31097-31099)",
        disposition: leaked2 ? "FAIL" : r2.status === 200 ? "PASS" : "INCONCLUSIVE",
        detail: leaked2 ? `VERIFIED DEFECT: Tenant B's row appeared despite the caller being Tenant A's admin.` : `status=${r2.status} count=${rows2.length} (force-scoped to caller's own company)`,
      });

      const r3 = await apiRequest(baseUrl, "GET", `/api/audit-log`, sessionPlatformAdmin);
      const rows3 = Array.isArray((r3.body as any)?.rows) ? (r3.body as any).rows as Array<{ companyId?: string }> : [];
      const crossTenantLeak = r3.status === 200 && rows3.some((x) => x.companyId === companyA) && rows3.some((x) => x.companyId === companyB);
      cases.push({
        case: "3. platform_admin (NOT platform_super_admin) reads the audit log with no companyId param — expandRoleForGuard() aliases platform_admin to also carry \"admin\" (server/routes.ts:260-280), so requireRole(\"admin\",\"platform_super_admin\") admits it; inside the handler isSuperAdmin is an exact-string check that platform_admin fails, so it falls to resolvedCompanyId = currentUser.companyId — but platform accounts are required to have companyId=NULL (enforced at login), so resolvedCompanyId is undefined and storage.getAuthorizationAuditLogsFiltered applies no company filter at all (server/storage.ts:4171-4207, `if (opts.companyId)`)",
        disposition: crossTenantLeak ? "FAIL" : "INCONCLUSIVE",
        detail: crossTenantLeak ? `VERIFIED DEFECT: status=${r3.status}, a single platform_admin request with no ?companyId= returned BOTH Tenant A's row (companyId=${companyA}) and Tenant B's row (companyId=${companyB}) — a full unfiltered cross-tenant authorization-audit-log read, reachable by platform_admin and (same code path, not independently re-tested here) platform_support and platform_implementation.` : `status=${r3.status} count=${rows3.length}`,
      });

      const r4 = await apiRequest(baseUrl, "GET", `/api/audit-log`, null);
      cases.push({ case: "4. Missing authentication", disposition: r4.status === 401 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      const rEmp = await apiRequest(baseUrl, "GET", `/api/audit-log`, sessionPlatformBilling);
      cases.push({ case: "5. Unrelated platform role (platform_billing) not aliased to \"admin\" by expandRoleForGuard is correctly blocked", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `status=${rEmp.status}` });

      record("GET /api/audit-log", "server/routes.ts:31089", cases);
    }

    // ── Print + write the machine-readable manifest ───────────────────────────
    console.log("\n=== Cross-tenant batch-5 route test matrix ===\n");
    const summary: Record<Disposition, number> = { PASS: 0, FAIL: 0, INCONCLUSIVE: 0, "EXPECTED GLOBAL": 0, "N/A": 0 };
    for (const r of routeResults) {
      console.log(`${r.id}  (${r.source})`);
      for (const c of r.cases) {
        summary[c.disposition]++;
        const mark = c.disposition === "PASS" || c.disposition === "EXPECTED GLOBAL" ? "✓" : c.disposition === "N/A" ? "•" : c.disposition === "INCONCLUSIVE" ? "?" : "✗";
        console.log(`  ${mark} [${c.disposition}] ${c.case}`);
      }
      console.log("");
    }
    console.log(`Summary: ${summary.PASS} PASS, ${summary.FAIL} FAIL, ${summary.INCONCLUSIVE} INCONCLUSIVE, ${summary["EXPECTED GLOBAL"]} EXPECTED GLOBAL, ${summary["N/A"]} N/A`);

    fs.writeFileSync(
      MANIFEST_PATH,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString().slice(0, 10),
          sourceRouteManifest: "docs/saas-readiness/storage-scope-trace-manifest.json",
          summary,
          routes: routeResults,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`Manifest written to ${MANIFEST_PATH}`);

    if (summary.FAIL === 0) {
      console.log("\nAll cases PASS — no cross-tenant authorization gaps found in this batch.");
    } else {
      console.log(`\n${summary.FAIL} verified defect(s) found — see docs/saas-readiness/phase-0.5-batch-5-cross-tenant-findings.md. This is an audit-only branch; no repair is made here.`);
    }
  } finally {
    if (server) {
      try {
        await server.stop();
      } catch (e) {
        harnessOk = false;
        console.error("Failed to stop test server cleanly:", e);
      }
    }
    try {
      const deletions = await cleanupFixtures(pool, companyIds, tenantIds);
      console.log(`Cleanup verified: zero synthetic rows remain. Deleted: ${deletions.map((d) => `${d.table}(${d.count})`).join(", ")}`);
    } catch (e) {
      harnessOk = false;
      console.error("Cleanup verification failed:", e);
    }
    await pool.end();
  }

  if (!harnessOk) {
    process.exitCode = 1;
  }
}

async function cleanupFixtures(pool: Pool, companyIds: string[], tenantIds: string[]): Promise<Array<{ table: string; column: string; count: number }>> {
  const deletions = await cascadeDelete(pool, "companies", companyIds);
  const leftovers = await verifyZeroResidue(pool, "companies", companyIds);
  if (leftovers.length > 0) {
    throw new Error(`Cleanup verification failed — leftover rows: ${leftovers.join("; ")}`);
  }
  // tenants/tenant_companies rows are not reachable from the companies-rooted
  // cascade (tenant_companies.tenant_id carries no FK — see findings doc,
  // schema-drift/data-integrity observation), so they are deleted directly.
  await pool.query("DELETE FROM tenant_companies WHERE tenant_id = ANY($1::varchar[])", [tenantIds]);
  await pool.query("DELETE FROM tenants WHERE id = ANY($1::varchar[])", [tenantIds]);
  const tenantLeftovers = await pool.query("SELECT id FROM tenants WHERE id = ANY($1::varchar[])", [tenantIds]);
  if (tenantLeftovers.rows.length > 0) {
    throw new Error(`Cleanup verification failed — leftover synthetic tenants: ${tenantLeftovers.rows.map((r) => r.id).join(", ")}`);
  }
  return deletions;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
