/**
 * SaaS PR 2B — remaining stored-resource ownership + supplied-companyId gate
 * (real HTTP, DB).
 *
 * Proves against the real server and a disposable database that the 151 routes
 * PR 2 deferred are closed, and that no route at all lets a tenant actor address
 * another company by naming it:
 *
 *  G. global supplied-companyId gate: ?companyId / body.companyId of a company
 *     outside the actor's reach → 403 on ANY /api route (incl. families never
 *     touched here); scheduling reach accepted for reads and scheduling writes
 *     only; company-less non-platform actors are not platform actors.
 *  L. company-scoped lists: an omitted companyId is the actor's own company,
 *     never every tenant (Tenant B sentinels never appear); platform keeps
 *     intentional all-company reads.
 *  B. by-id: every OWNED_RESOURCES family — foreign PATCH/DELETE → 403/404 and
 *     the victim row is byte-identical; own-company works; universal (NULL
 *     company) rows are platform-only writes; PATCH cannot re-parent.
 *  C. contractor hub: invoices / proposals / contracts — company access or the
 *     contractor themself; enterprise siblings are NOT general access.
 *  P. personas: employees see only their own reviews / qualifications /
 *     schedule preferences / notifications.
 *  X. specials: expense categories (global table) platform-only, payment-method
 *     config defaults never seeded into a foreign company, deactivate-extras /
 *     resolve-debug / repair-tickets / saved reports / permissions/effective.
 *
 * Fixture: Tenant A (A1, A2), Tenant B (B1), untenanted enterprise S (S1, S2).
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/saas-pr2b-remaining-ownership-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { startTestServer, login, apiRequest, type TestServer, type Session } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

let passed = 0, failed = 0;
const errors: string[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); errors.push(name); failed++; }
};
const text = (b: unknown) => (typeof b === "string" ? b : JSON.stringify(b ?? ""));
const denied = (s: number) => s === 403 || s === 404;

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log("TEST_DATABASE_URL not set — skipping saas-pr2b-remaining-ownership tests (0 run).");
    return;
  }
  for (const p of FORBIDDEN_PATTERNS) if (p.test(url)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing to run.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL is identical to DATABASE_URL. Refusing.");

  const pool = new Pool({ connectionString: url, max: 6 });
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const dbName = (await q("SELECT current_database() AS n")).rows[0]?.n as string;
  if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) throw new Error(`current_database()="${dbName}" looks protected. Refusing.`);

  const sfx = crypto.randomBytes(4).toString("hex");
  const uid = () => crypto.randomUUID();
  const [A1, A2, B1, S1, S2] = [uid(), uid(), uid(), uid(), uid()];
  const companyIds = [A1, A2, B1, S1, S2];
  const [tA, tB] = [uid(), uid()];
  const ES = uid();
  const SEN = (kind: string, co: string) => `ZZPR2B-${kind}-${co}-${sfx}`;
  const universalRows: Array<[string, string]> = [];
  const expenseCategoryIds: string[] = [];
  let server: TestServer | undefined;

  // Schema-aware fixture insert: fills NOT NULL columns that have no default.
  const colCache = new Map<string, Array<{ name: string; type: string; nullable: boolean; hasDefault: boolean }>>();
  const cols = async (table: string) => {
    if (!colCache.has(table)) {
      const r = await q(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1`, [table]);
      if (!r.rows.length) throw new Error(`fixture: table ${table} not found`);
      colCache.set(table, r.rows.map((c: any) => ({ name: c.column_name, type: c.data_type, nullable: c.is_nullable === "YES", hasDefault: c.column_default !== null })));
    }
    return colCache.get(table)!;
  };
  const filler = (type: string, tag: string) => {
    if (/int|numeric|double|real/.test(type)) return 1;
    if (type === "boolean") return false;
    if (type === "date") return "2026-09-01";
    if (/timestamp/.test(type)) return new Date().toISOString();
    if (/json/.test(type)) return "{}";
    if (type === "ARRAY") return "{}";
    return tag;
  };
  const fkCache = new Map<string, Record<string, string>>();
  const fks = async (table: string) => {
    if (!fkCache.has(table)) {
      const r = await q(`SELECT kcu.column_name, ccu.table_name AS ref FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1`, [table]);
      fkCache.set(table, Object.fromEntries(r.rows.map((x: any) => [x.column_name, x.ref])));
    }
    return fkCache.get(table)!;
  };
  // Required FK references resolve to the fixture's own company / worker / user.
  const fkCtx: { company?: string; worker?: string; user?: string } = {};
  const insert = async (table: string, values: Record<string, unknown>, tag: string): Promise<string> => {
    const c = await cols(table);
    const fk = await fks(table);
    const row: Record<string, unknown> = { id: uid(), ...values };
    for (const col of c) {
      if (col.name in row || col.nullable || col.hasDefault) continue;
      const ref = fk[col.name];
      if (ref === "companies") row[col.name] = fkCtx.company ?? (values as any).company_id;
      else if (ref === "workers") row[col.name] = fkCtx.worker;
      else if (ref === "users") row[col.name] = fkCtx.user;
      else if (ref) throw new Error(`fixture: ${table}.${col.name} requires FK to ${ref}`);
      else row[col.name] = filler(col.type, tag);
    }
    const known = new Set(c.map((x) => x.name));
    const keys = Object.keys(row).filter((k) => known.has(k));
    await q(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, keys.map((k) => row[k]));
    return row.id as string;
  };

  try {
    // ── Fixture ──────────────────────────────────────────────────────────────
    await q(`INSERT INTO enterprises (id,name) VALUES ($1,$2)`, [ES, `PR2B Ent S ${sfx}`]);
    await q(`INSERT INTO companies (id,name,subscription_status,enterprise_id,is_demo) VALUES
      ($1,$6,'active_paid',NULL,false),($2,$7,'active_paid',NULL,false),($3,$8,'active_paid',NULL,false),
      ($4,$9,'active_paid',$11,false),($5,$10,'active_paid',$11,false)`,
      [A1, A2, B1, S1, S2, `PR2B A1 ${sfx}`, `PR2B A2 ${sfx}`, `PR2B B1 ${sfx}`, `PR2B S1 ${sfx}`, `PR2B S2 ${sfx}`, ES]);
    await q(`INSERT INTO tenants (id,name,slug,status) VALUES ($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [tA, `PR2B Tenant A ${sfx}`, `pr2b-a-${sfx}`, tB, `PR2B Tenant B ${sfx}`, `pr2b-b-${sfx}`]);
    await q(`INSERT INTO tenant_companies (tenant_id,company_id,is_primary) VALUES ($1,$2,true),($1,$3,false),($4,$5,true)`, [tA, A1, A2, tB, B1]);

    const W: Record<string, string> = {};
    for (const [key, co, type] of [["A1", A1, "employee"], ["A1b", A1, "employee"], ["A1mgr", A1, "employee"], ["A1c", A1, "contractor"],
      ["A2", A2, "employee"], ["B1", B1, "employee"], ["B1c", B1, "contractor"], ["S1", S1, "employee"], ["S2", S2, "employee"], ["S2c", S2, "contractor"]] as const) {
      const id = uid(); W[key] = id;
      await q(`INSERT INTO workers (id,company_id,first_name,last_name,worker_type,pay_rate,pay_type) VALUES ($1,$2,$3,'Fixture',$4,'30.00','hourly')`,
        [id, co, `PR2B${key}`, type]);
    }

    const pw = await bcrypt.hash("Pr2b!Synthetic", 10);
    const U: Record<string, string> = {};
    const mkUser = async (key: string, role: string, companyId: string | null, workerId: string | null = null) => {
      const id = uid(); U[key] = id;
      await q(`INSERT INTO users (id,username,password,role,company_id,worker_id,is_active) VALUES ($1,$2,$3,$4,$5,$6,true)`,
        [id, `pr2b_${key}_${sfx}`, pw, role, companyId, workerId]);
    };
    await mkUser("psa", "platform_super_admin", null);
    await mkUser("adminA", "admin", A1);
    await mkUser("adminA12", "admin", A1);
    await mkUser("mgrA", "manager", A1, W.A1mgr);
    await mkUser("empA", "employee", A1, W.A1);
    await mkUser("conA", "contractor", A1, W.A1c);
    await mkUser("noco", "admin", null);
    await mkUser("adminB", "admin", B1);
    await mkUser("schedS1", "manager", S1, W.S1);
    await q(`INSERT INTO company_user_access (user_id,company_id,role,is_default_company,is_active,worker_type)
      VALUES ($1,$2,'admin',false,true,'manager')`, [U.adminA12, A2]);

    // ── Owned rows per company (A1 own, A2 granted, B1 victim) ───────────────
    type Fam = { table: string; path: string; patch: Record<string, unknown>; extra?: (co: string, key: string) => Promise<Record<string, unknown>>; del?: boolean; patchable?: boolean; nameCol?: string };
    const wOf: Record<string, string> = { A1: W.A1, A2: W.A2, B1: W.B1 };
    const coOf: Record<string, string> = { A1, A2, B1 };
    const FAMS: Fam[] = [
      { table: "accrual_accounts", path: "/api/accrual-accounts", patch: { name: "x" }, nameCol: "name" },
      { table: "pay_periods", path: "/api/pay-periods", patch: { status: "open" }, del: false },
      { table: "taxes_deductions", path: "/api/taxes-deductions", patch: { name: "x" }, nameCol: "name" },
      { table: "pay_codes", path: "/api/pay-codes", patch: { name: "x" }, nameCol: "name" },
      { table: "worker_languages", path: "/api/worker-languages", patch: { language: "x" }, extra: async (_c, k) => ({ worker_id: wOf[k] }), nameCol: "language" },
      { table: "recurring_expense_templates", path: "/api/recurring-expenses", patch: { description: "x" }, del: false, nameCol: "description" },
      { table: "pay_stub_accounts", path: "/api/pay-stub-accounts", patch: { name: "x" }, nameCol: "name" },
      { table: "employee_groups", path: "/api/employee-groups", patch: { name: "x" }, nameCol: "name" },
      { table: "employee_titles", path: "/api/employee-titles", patch: { name: "x" }, nameCol: "name" },
      { table: "pay_formulas", path: "/api/pay-formulas", patch: { name: "x" }, nameCol: "name" },
      { table: "contributing_pay_codes", path: "/api/contributing-pay-codes", patch: { name: "x" }, nameCol: "name" },
      { table: "regular_time_policies", path: "/api/regular-time-policies", patch: { name: "x" }, nameCol: "name" },
      { table: "overtime_policies", path: "/api/overtime-policies", patch: { name: "x" }, nameCol: "name" },
      { table: "schedule_policies", path: "/api/schedule-policies", patch: { name: "x" }, nameCol: "name" },
      { table: "accrual_policies", path: "/api/accrual-policies", patch: { name: "x" }, nameCol: "name" },
      { table: "secondary_wage_groups", path: "/api/secondary-wage-groups", patch: { name: "x" }, nameCol: "name" },
      { table: "pay_period_schedules", path: "/api/pay-period-schedules", patch: { name: "x" }, nameCol: "name" },
      { table: "pay_stub_amendments", path: "/api/pay-stub-amendments", patch: { description: "x" }, extra: async (_c, k) => ({ worker_id: wOf[k] }) },
      { table: "pay_stub_transactions", path: "/api/pay-stub-transactions", patch: { reference: "x" }, extra: async (_c, k) => ({ worker_id: wOf[k] }), del: false },
      { table: "invoice_templates", path: "/api/invoice-templates", patch: { name: "x" }, nameCol: "name" },
      { table: "payment_method_configs", path: "/api/payment-method-configs", patch: { displayName: "x" }, nameCol: "display_name" },
      { table: "document_folders", path: "/api/document-folders", patch: { name: "x" }, del: false, nameCol: "name" },
      { table: "document_retention_policies", path: "/api/document-retention-policies", patch: { description: "x" } },
      { table: "invoice_approval_workflows", path: "/api/invoice-approval-workflows", patch: { name: "x" }, del: false, nameCol: "name" },
      { table: "worker_agreements", path: "/api/worker-agreements", patch: { title: "x" }, extra: async (_c, k) => ({ worker_id: wOf[k] }) },
      { table: "worker_onboarding", path: "/api/worker-onboarding", patch: { managerNotes: "x" }, extra: async (_c, k) => ({ worker_id: wOf[k] }) },
      { table: "schedule_preferences", path: "/api/schedule-preferences", patch: { note: "x" }, extra: async (_c, k) => ({ worker_id: wOf[k] }) },
      { table: "recurring_schedules", path: "/api/recurring-schedules", patch: { note: "x" }, extra: async (_c, k) => ({ worker_id: wOf[k] }) },
      { table: "tax_filing_snapshots", path: "/api/tax-wizard/snapshots", patch: { notes: "x" } },
      { table: "premium_policies", path: "/api/premium-policies", patch: { name: "x" }, nameCol: "name" },
      { table: "meal_policies", path: "/api/meal-policies", patch: { name: "x" }, nameCol: "name" },
      { table: "break_policies", path: "/api/break-policies", patch: { name: "x" }, nameCol: "name" },
      { table: "exception_policies", path: "/api/exception-policies", patch: { name: "x" }, nameCol: "name" },
      { table: "absence_policies", path: "/api/absence-policies", patch: { name: "x" }, nameCol: "name" },
      { table: "holiday_policies", path: "/api/holiday-policies", patch: { name: "x" }, nameCol: "name" },
      { table: "rounding_policies", path: "/api/rounding-policies", patch: { name: "x" }, nameCol: "name" },
      { table: "contributing_shifts", path: "/api/contributing-shifts", patch: { name: "x" }, nameCol: "name" },
      { table: "saved_reports", path: "/api/saved-reports", patch: {}, patchable: false, nameCol: "name" },
    ];
    const ROW: Record<string, Record<string, string>> = {};
    for (const f of FAMS) {
      ROW[f.table] = {};
      for (const key of ["A1", "A2", "B1"]) {
        Object.assign(fkCtx, { company: coOf[key], worker: wOf[key], user: U.adminA });
        const extra = f.extra ? await f.extra(coOf[key], key) : {};
        const named = f.nameCol ? { [f.nameCol]: SEN(f.table, key) } : {};
        ROW[f.table][key] = await insert(f.table, { company_id: coOf[key], ...named, ...extra }, SEN(f.table, key));
      }
    }
    // Universal (NULL-company) rows in nullable-company tables: tenant writes must be refused.
    for (const t of ["employee_titles", "employee_groups", "overtime_policies", "invoice_templates", "secondary_wage_groups"]) {
      const f = FAMS.find((x) => x.table === t)!;
      const id = await insert(t, { company_id: null, ...(f.nameCol ? { [f.nameCol]: SEN(t, "U") } : {}) }, SEN(t, "U"));
      universalRows.push([t, id]);
    }
    // Derived-owner rows.
    const ewg: Record<string, string> = {};
    for (const key of ["A1", "B1"]) {
      const swg = ROW.secondary_wage_groups[key];
      ewg[key] = await insert("employee_wage_groups", { worker_id: wOf[key], wage_group_id: swg }, SEN("ewg", key));
    }
    const milestone: Record<string, string> = {};
    for (const key of ["A1", "B1"]) milestone[key] = await insert("accrual_policy_milestones", { accrual_policy_id: ROW.accrual_policies[key] }, SEN("ms", key));
    const reimb: Record<string, string> = {};
    for (const key of ["A1", "B1"]) {
      Object.assign(fkCtx, { company: coOf[key], worker: wOf[key] });
      reimb[key] = await insert("payroll_reimbursement_items", { company_id: coOf[key], worker_id: wOf[key] }, SEN("reimb", key));
    }
    const runOf: Record<string, string> = {};
    for (const key of ["A1", "B1"]) {
      runOf[key] = uid();
      await q(`INSERT INTO payroll_runs (id,company_id,period_start,period_end,status) VALUES ($1,$2,'2026-09-01','2026-09-14','draft')`, [runOf[key], coOf[key]]);
    }

    // Contractor hub rows: A1 contractor (own), B1 (foreign tenant), S2 (enterprise sibling of S1).
    const CH: Record<string, { prop: string; inv: string; ctr: string }> = {};
    for (const [key, co, w] of [["A1", A1, W.A1c], ["B1", B1, W.B1c], ["S2", S2, W.S2c]] as const) {
      Object.assign(fkCtx, { company: co, worker: w, user: U.psa });
      const prop = await insert("contractor_proposals", { company_id: co, contractor_id: w, title: SEN("PROP", key), status: "draft" }, SEN("PROP", key));
      const inv = await insert("contractor_invoices", { company_id: co, contractor_id: w, description: SEN("INV", key), status: "submitted", amount: "100.00", proposal_reference: "ref" }, SEN("INV", key));
      const ctr = await insert("contractor_contracts", { company_id: co, contractor_id: w, title: SEN("CTR", key), status: "active" }, SEN("CTR", key));
      await q(`INSERT INTO proposal_line_items (proposal_id,name,quantity,unit_price,line_total) VALUES ($1,$2,1,10,10)`, [prop, SEN("LINE", key)]);
      await insert("contract_signers", { contract_id: ctr, name: SEN("SIGNER", key), email: `zz-${key}-${sfx}@example.invalid` }, SEN("SIGNER", key));
      CH[key] = { prop, inv, ctr };
    }

    // Persona rows (reviews / qualifications) for A1 employee + coworker, and B1.
    for (const [key, co, w] of [["A1", A1, W.A1], ["A1b", A1, W.A1b], ["B1", B1, W.B1]] as const) {
      Object.assign(fkCtx, { company: co, worker: w, user: U.psa });
      await insert("reviews", { company_id: co, worker_id: w, notes: SEN("REVIEW", key) }, SEN("REVIEW", key));
      await insert("qualifications", { company_id: co, worker_id: w, name: SEN("QUAL", key) }, SEN("QUAL", key));
    }
    Object.assign(fkCtx, { company: B1, worker: W.B1, user: U.psa });
    const repA = await insert("app_doctor_reports", { company_id: A1, title: SEN("APPDOC", "A1") }, SEN("APPDOC", "A1"));
    const repB = await insert("app_doctor_reports", { company_id: B1, title: SEN("APPDOC", "B1") }, SEN("APPDOC", "B1"));
    await insert("app_doctor_repair_tickets", { company_id: B1, report_id: repB, title: SEN("TICKET", "B1") }, SEN("TICKET", "B1"));
    const catId = await insert("expense_categories", { name: SEN("CAT", "G") }, SEN("CAT", "G"));
    expenseCategoryIds.push(catId);
    const ppsB2 = await insert("pay_period_schedules", { company_id: B1, name: SEN("PPS2", "B1"), is_active: true }, SEN("PPS2", "B1"));
    await q(`UPDATE pay_period_schedules SET is_active = true WHERE id = $1`, [ROW.pay_period_schedules.B1]);

    server = await startTestServer(url);
    const base = server.baseUrl;
    const S: Record<string, Session> = {};
    for (const k of Object.keys(U)) S[k] = await login(base, `pr2b_${k}_${sfx}`, "Pr2b!Synthetic");
    const call = (who: string, m: string, p: string, b?: unknown) => apiRequest(base, m, p, S[who], b);
    const snap = async (table: string, id: string) =>
      JSON.stringify((await q(`SELECT row_to_json(t) AS j FROM ${table} t WHERE id = $1`, [id])).rows[0]?.j ?? null);

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── Group G: global supplied-companyId gate ──");
    for (const [m, p, b] of [
      ["GET", `/api/departments?companyId=${B1}`, undefined],
      ["GET", `/api/workers?companyId=${B1}`, undefined],
      ["GET", `/api/jobs?company_id=${B1}`, undefined],
      ["POST", "/api/pay-codes", { companyId: B1, name: SEN("INJECT", "B1"), code: "ZZ" }],
      ["POST", "/api/stations", { companyId: B1, stationName: SEN("INJECT", "B1") }],
      ["POST", "/api/payroll-runs", { companyId: B1, periodStart: "2026-09-01", periodEnd: "2026-09-14" }],
      ["POST", "/api/pay-period-schedules", { company_id: B1, name: SEN("INJECT", "B1"), type: "weekly" }],
    ] as const) {
      const r = await call("adminA", m, p, b);
      check(`G Tenant A ${m} ${p.split("?")[0]} naming B → 403`, r.status === 403, `status=${r.status}`);
    }
    const injected = (await q(`SELECT
        (SELECT count(*) FROM pay_codes WHERE name = $1)::int + (SELECT count(*) FROM stations WHERE station_name = $1)::int +
        (SELECT count(*) FROM pay_period_schedules WHERE name = $1)::int + (SELECT count(*) FROM payroll_runs WHERE company_id = $2 AND id <> $3)::int AS n`,
      [SEN("INJECT", "B1"), B1, runOf.B1])).rows[0].n;
    check("G no row created in Tenant B by body-companyId writes", Number(injected) === 0, `rows=${injected}`);
    let r = await call("adminA12", "GET", `/api/pay-codes?companyId=${A2}`);
    check("G explicit grant (A2) passes the gate", r.status === 200 && text(r.body).includes(SEN("pay_codes", "A2")), `status=${r.status}`);
    r = await call("noco", "GET", `/api/pay-codes?companyId=${A1}`);
    check("G company-less non-platform naming A → 403", r.status === 403, `status=${r.status}`);
    r = await call("schedS1", "GET", `/api/recurring-schedules?companyId=${S2}`);
    check("G scheduling reach: read sibling scheduling list allowed", r.status === 200, `status=${r.status}`);
    r = await call("schedS1", "POST", "/api/pay-codes", { companyId: S2, name: SEN("INJECT", "S2"), code: "ZZ" });
    check("G scheduling reach does NOT allow non-scheduling writes into sibling", r.status === 403, `status=${r.status}`);
    r = await call("schedS1", "GET", `/api/pay-codes?companyId=${S2}`);
    check("G scheduling reach does NOT allow payroll-config list of sibling", r.status === 403, `status=${r.status}`);
    r = await call("schedS1", "POST", "/api/schedules", { companyId: S2 });
    check("G scheduling write into sibling passes the gate (handler validates)", r.status !== 403 || !/do not have access to this company/.test(text(r.body)), `status=${r.status}`);
    r = await call("psa", "GET", `/api/pay-codes?companyId=${B1}`);
    check("G platform super admin unaffected", r.status === 200 && text(r.body).includes(SEN("pay_codes", "B1")), `status=${r.status}`);

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── Group L: lists — omitted companyId is never every tenant ──");
    const LISTS: Array<{ path: string; table: string; who?: string }> = FAMS
      .filter((f) => f.nameCol && !["/api/document-folders", "/api/invoice-approval-workflows", "/api/saved-reports"].includes(f.path))
      .map((f) => ({ path: f.path, table: f.table }));
    for (const L of LISTS) {
      const res = await call("adminA", "GET", L.path);
      const b = text(res.body);
      check(`L ${L.path} (A, no companyId) → A only`, res.status === 200 && b.includes(SEN(L.table, "A1")) && !b.includes(SEN(L.table, "B1")) && !b.includes(SEN(L.table, "A2")), `status=${res.status}`);
      const nc = await call("noco", "GET", L.path);
      check(`L ${L.path} company-less → denied, no data`, nc.status >= 400 && nc.status < 500 && !text(nc.body).includes(SEN(L.table, "B1")), `status=${nc.status}`);
    }
    for (const p of ["/api/expenses/export/csv", "/api/contractor-invoices/export/csv", "/api/receipts", "/api/time-punches/pending",
      "/api/clock-in-requests", "/api/payroll-audit", "/api/schedule-audit-logs", "/api/eligibility-rule-sets", "/api/new-hire-defaults",
      "/api/holidays", "/api/kpi-groups", "/api/qualification-groups", "/api/policy-groups", "/api/currencies", "/api/stations",
      "/api/remittance-agencies", "/api/pay-stub-transactions", "/api/marketplace/listings", "/api/shift-offers", "/api/document-hub/assets"]) {
      const res = await call("noco", "GET", p);
      // 400 from a feature / subscription gate is also a denial (no data returned).
      check(`L ${p} company-less → denied`, res.status >= 400 && res.status < 500 && !text(res.body).includes(sfx), `status=${res.status}`);
    }
    r = await call("adminA", "GET", "/api/contractor-invoices/export/csv");
    check("L contractor invoice export (A) excludes B", r.status === 200 && !text(r.body).includes(CH.B1.inv), `status=${r.status}`);
    r = await call("adminA", "GET", "/api/payroll-audit");
    check("L payroll audit (A) never names Tenant B workers", r.status === 200 && !text(r.body).includes("PR2BB1"), `status=${r.status}`);
    r = await call("psa", "GET", "/api/pay-codes");
    check("L platform list-all retained", r.status === 200 && text(r.body).includes(SEN("pay_codes", "B1")) && text(r.body).includes(SEN("pay_codes", "A1")), `status=${r.status}`);
    r = await call("adminA", "GET", "/api/employee-titles");
    check("L universal titles still readable by tenants", r.status === 200 && text(r.body).includes(SEN("employee_titles", "U")), `status=${r.status}`);

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── Group B: by-id ownership (stored owner, victim unchanged) ──");
    for (const f of FAMS) {
      const victim = ROW[f.table].B1;
      const before = await snap(f.table, victim);
      if (f.patchable !== false) {
        let res = await call("adminA", "PATCH", `${f.path}/${victim}`, f.patch);
        check(`B PATCH ${f.path}/:B by Tenant A → denied`, denied(res.status), `status=${res.status}`);
        res = await call("noco", "PATCH", `${f.path}/${victim}`, f.patch);
        check(`B PATCH ${f.path}/:B by company-less → denied`, denied(res.status), `status=${res.status}`);
      }
      if (f.del !== false) {
        const res = await call("adminA", "DELETE", `${f.path}/${victim}`);
        check(`B DELETE ${f.path}/:B by Tenant A → denied`, denied(res.status), `status=${res.status}`);
      }
      check(`B ${f.table} victim row byte-identical`, (await snap(f.table, victim)) === before);
      if (f.patchable !== false) {
        const own = ROW[f.table].A1;
        const res = await call("adminA", "PATCH", `${f.path}/${own}`, { ...f.patch });
        check(`B PATCH ${f.path}/:A by Tenant A → allowed`, res.status === 200, `status=${res.status} ${text(res.body).slice(0, 120)}`);
        const co = (await q(`SELECT company_id FROM ${f.table} WHERE id=$1`, [own])).rows[0]?.company_id;
        check(`B ${f.table} own row still owned by A1`, co === A1, `company_id=${co}`);
      }
      const g = ROW[f.table].A2;
      if (f.patchable !== false) {
        const res = await call("adminA", "PATCH", `${f.path}/${g}`, f.patch);
        check(`B PATCH ${f.path}/:A2 by A1-only admin → denied`, denied(res.status), `status=${res.status}`);
        const res2 = await call("adminA12", "PATCH", `${f.path}/${g}`, f.patch);
        check(`B PATCH ${f.path}/:A2 by granted admin → allowed`, res2.status === 200, `status=${res2.status}`);
      }
    }
    // PATCH cannot re-parent (body companyId of own company is fine, ownership field is ignored)
    r = await call("adminA", "PATCH", `/api/pay-codes/${ROW.pay_codes.A1}`, { name: "y", companyId: A1, id: uid() });
    check("B PATCH strips id/companyId (row keeps id + A1)", r.status === 200 && (await q(`SELECT company_id FROM pay_codes WHERE id=$1`, [ROW.pay_codes.A1])).rows[0]?.company_id === A1, `status=${r.status}`);
    // employee-title PATCH without companyId must NOT null the owner (old behaviour published it to every tenant)
    r = await call("adminA", "PATCH", `/api/employee-titles/${ROW.employee_titles.A1}`, { name: "no-company-field" });
    check("B employee-title PATCH without companyId keeps owner", r.status === 200 && (await q(`SELECT company_id FROM employee_titles WHERE id=$1`, [ROW.employee_titles.A1])).rows[0]?.company_id === A1);
    for (const [t, id] of universalRows) {
      const f = FAMS.find((x) => x.table === t)!;
      const before = await snap(t, id);
      const res = await call("adminA", "PATCH", `${f.path}/${id}`, f.patch);
      const del = await call("adminA", "DELETE", `${f.path}/${id}`);
      check(`B universal ${t}: tenant PATCH/DELETE → 403, unchanged`, res.status === 403 && del.status === 403 && (await snap(t, id)) === before, `patch=${res.status} del=${del.status}`);
    }
    const [ut, uidRow] = universalRows[0];
    r = await call("psa", "PATCH", `/api/employee-titles/${uidRow}`, { name: SEN(ut, "U") });
    check("B universal row: platform PATCH allowed", r.status === 200, `status=${r.status}`);
    r = await call("adminA", "POST", "/api/employee-titles", { name: SEN("TITLE-NEW", "A1") });
    check("B tenant POST title without companyId → own company, not universal",
      r.status === 201 && (await q(`SELECT company_id FROM employee_titles WHERE name=$1`, [SEN("TITLE-NEW", "A1")])).rows[0]?.company_id === A1, `status=${r.status}`);
    // derived owners
    for (const [label, path, rows] of [
      ["employee wage group", "/api/employee-wage-groups", ewg], ["accrual milestone", "/api/accrual-policy-milestones", milestone],
    ] as const) {
      const res = await call("adminA", "DELETE", `${path}/${rows.B1}`);
      check(`B ${label}: delete B's (owner via parent) → denied`, denied(res.status), `status=${res.status}`);
      const own = await call("adminA", "DELETE", `${path}/${rows.A1}`);
      check(`B ${label}: delete own → allowed`, own.status === 200, `status=${own.status}`);
    }
    const reimbBefore = await snap("payroll_reimbursement_items", reimb.B1);
    r = await call("adminA", "PATCH", `/api/payroll-reimbursements/${reimb.B1}`, { notes: "x" });
    check("B reimbursement B by A → denied, unchanged", denied(r.status) && (await snap("payroll_reimbursement_items", reimb.B1)) === reimbBefore, `status=${r.status}`);
    r = await call("adminA", "PATCH", `/api/payroll-reimbursements/${reimb.A1}`, { payrollRunId: runOf.B1 });
    check("B reimbursement A cannot be re-linked to B's payroll run", r.status === 403, `status=${r.status}`);
    r = await call("adminA", "POST", `/api/app-doctor/reports/${repB}/analyze`);
    check("B app-doctor analyze B's report → denied", denied(r.status), `status=${r.status}`);
    const snapBefore = await snap("tax_filing_snapshots", ROW.tax_filing_snapshots.B1);
    r = await call("adminA", "PATCH", `/api/tax-wizard/snapshots/${ROW.tax_filing_snapshots.B1}`, { status: "filed" });
    check("B tax snapshot B mark-filed by A → denied, unchanged", denied(r.status) && (await snap("tax_filing_snapshots", ROW.tax_filing_snapshots.B1)) === snapBefore, `status=${r.status}`);
    r = await call("adminA", "PATCH", `/api/document-retention-policies/${ROW.document_retention_policies.B1}/legal-basis`, { legalBasis: "consent" });
    check("B retention legal-basis on B → denied", denied(r.status), `status=${r.status}`);
    for (const [m, sub] of [["POST", "sign"], ["GET", ""]] as const) {
      const res = await call("adminA", m, `/api/worker-agreements/${ROW.worker_agreements.B1}${sub ? "/" + sub : ""}`, m === "POST" ? { signedByName: "x" } : undefined);
      check(`B worker agreement ${m} ${sub || "read"} B → denied`, denied(res.status), `status=${res.status}`);
    }
    for (const [m, sub, body] of [["POST", "regenerate-token", {}], ["POST", "review", { action: "approve" }], ["GET", "documents", undefined], ["GET", "audit-log", undefined]] as const) {
      const res = await call("adminA", m, `/api/worker-onboarding/${ROW.worker_onboarding.B1}/${sub}`, body);
      check(`B onboarding ${sub} on B → denied`, denied(res.status), `status=${res.status}`);
    }

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── Group C: contractor hub ──");
    const invB = CH.B1.inv, propB = CH.B1.prop, ctrB = CH.B1.ctr;
    const invBBefore = await snap("contractor_invoices", invB);
    for (const [m, p, b] of [
      ["GET", `/api/contractor-invoices/${invB}`, undefined], ["POST", `/api/contractor-invoices/${invB}/approve`, { managerOverride: true }],
      ["POST", `/api/contractor-invoices/${invB}/reject`, { reason: "x" }], ["GET", `/api/contractor-invoices/${invB}/audit`, undefined],
      ["GET", `/api/contractor-invoices/${invB}/payments`, undefined], ["GET", `/api/contractor-invoices/${invB}/reminder-logs`, undefined],
      ["POST", `/api/contractor-invoices/${invB}/send-reminder`, {}], ["POST", `/api/contractor-invoices/${invB}/stripe-checkout-session`, {}],
      ["GET", `/api/contractor-proposals/${propB}/line-items`, undefined], ["POST", `/api/contractor-proposals/${propB}/line-items`, { name: SEN("LINEINJ", "B1") }],
      ["GET", `/api/contractor-proposals/${propB}/events`, undefined], ["GET", `/api/contractor-proposals/${propB}/current-version`, undefined],
      ["DELETE", `/api/contractor-proposals/${propB}`, undefined], ["GET", `/api/contractor-hub/contracts/${ctrB}/sign`, undefined],
    ] as const) {
      const res = await call("adminA", m, p, b);
      check(`C ${m} ${p.replace(/[0-9a-f-]{36}/g, ":B")} by Tenant A → denied`, denied(res.status) && !text(res.body).includes(SEN("LINE", "B1")) && !text(res.body).includes(SEN("SIGNER", "B1")), `status=${res.status}`);
    }
    check("C B invoice unchanged", (await snap("contractor_invoices", invB)) === invBBefore);
    check("C no line item injected into B proposal", Number((await q(`SELECT count(*)::int n FROM proposal_line_items WHERE name=$1`, [SEN("LINEINJ", "B1")])).rows[0].n) === 0);
    check("C B proposal not soft-deleted", (await q(`SELECT deleted_at FROM contractor_proposals WHERE id=$1`, [propB])).rows[0].deleted_at === null);
    r = await call("conA", "GET", `/api/contractor-invoices/${CH.A1.inv}`);
    check("C contractor reads own invoice", r.status === 200, `status=${r.status}`);
    r = await call("conA", "GET", `/api/contractor-proposals/${CH.A1.prop}/line-items`);
    check("C contractor reads own proposal line items", r.status === 200 && text(r.body).includes(SEN("LINE", "A1")), `status=${r.status}`);
    r = await call("conA", "GET", `/api/contractor-invoices/${invB}/payments`);
    check("C contractor cannot read other tenant's invoice payments", denied(r.status), `status=${r.status}`);
    r = await call("adminA", "GET", `/api/contractor-proposals/${CH.A1.prop}/line-items`);
    check("C Tenant A admin reads own proposal", r.status === 200 && text(r.body).includes(SEN("LINE", "A1")), `status=${r.status}`);
    r = await call("adminA", "GET", `/api/contractor-hub/contracts/${CH.A1.ctr}/sign`);
    check("C Tenant A admin reads own contract signers", r.status === 200 && text(r.body).includes(SEN("SIGNER", "A1")), `status=${r.status}`);
    r = await call("schedS1", "GET", "/api/contractor-proposals");
    check("C enterprise sibling proposals NOT visible (S1 manager, S2 proposal)", r.status === 200 && !text(r.body).includes(CH.S2.prop), `status=${r.status}`);
    r = await call("schedS1", "GET", "/api/contractor-contracts");
    check("C enterprise sibling contracts NOT visible", r.status === 200 && !text(r.body).includes(CH.S2.ctr), `status=${r.status}`);
    r = await call("adminA", "GET", "/api/contractor-proposals");
    check("C Tenant A proposals list excludes B", r.status === 200 && text(r.body).includes(CH.A1.prop) && !text(r.body).includes(propB), `status=${r.status}`);
    r = await call("adminA", "GET", "/api/contractor-invoices");
    check("C Tenant A invoice list excludes B", r.status === 200 && !text(r.body).includes(invB), `status=${r.status}`);

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── Group P: personas ──");
    r = await call("empA", "GET", "/api/reviews");
    check("P employee sees own review, not coworker's or B's", r.status === 200 && text(r.body).includes(SEN("REVIEW", "A1")) && !text(r.body).includes(SEN("REVIEW", "A1b")) && !text(r.body).includes(SEN("REVIEW", "B1")), `status=${r.status}`);
    r = await call("empA", "GET", `/api/qualifications?workerId=${W.A1b}`);
    check("P employee cannot read coworker qualifications via workerId", r.status === 200 && !text(r.body).includes(SEN("QUAL", "A1b")), `status=${r.status}`);
    r = await call("adminA", "GET", `/api/reviews?workerId=${W.B1}`);
    check("P Tenant A admin cannot read B worker reviews via workerId", denied(r.status) && !text(r.body).includes(SEN("REVIEW", "B1")), `status=${r.status}`);
    r = await call("mgrA", "GET", "/api/reviews");
    check("P manager sees company reviews", r.status === 200 && text(r.body).includes(SEN("REVIEW", "A1b")), `status=${r.status}`);
    r = await call("adminA", "GET", `/api/notification-preferences/${W.B1}`);
    check("P notification prefs of B worker → denied", denied(r.status), `status=${r.status}`);
    r = await call("empA", "GET", `/api/notification-preferences/${W.A1}`);
    check("P employee reads own notification prefs", r.status === 200, `status=${r.status}`);
    r = await call("adminA", "GET", `/api/permissions/effective/${U.adminB}`);
    check("P effective permissions of B user → denied", denied(r.status), `status=${r.status}`);

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── Group X: specials ──");
    const catBefore = await snap("expense_categories", catId);
    r = await call("adminA", "PATCH", `/api/expense-categories/${catId}`, { name: "tenant-edit" });
    check("X expense category (global) tenant PATCH → 403, unchanged", r.status === 403 && (await snap("expense_categories", catId)) === catBefore, `status=${r.status}`);
    r = await call("adminA", "POST", "/api/expense-categories", { name: SEN("CATNEW", "A1") });
    check("X expense category tenant POST → 403", r.status === 403, `status=${r.status}`);
    r = await call("psa", "PATCH", `/api/expense-categories/${catId}`, { name: SEN("CAT", "G") });
    check("X expense category platform PATCH allowed", r.status === 200, `status=${r.status}`);
    const pmcBefore = Number((await q(`SELECT count(*)::int n FROM payment_method_configs WHERE company_id=$1`, [B1])).rows[0].n);
    r = await call("adminA", "GET", `/api/payment-method-configs?companyId=${B1}`);
    const pmcAfter = Number((await q(`SELECT count(*)::int n FROM payment_method_configs WHERE company_id=$1`, [B1])).rows[0].n);
    check("X payment-method-configs ?companyId=B → 403, no defaults seeded into B", r.status === 403 && pmcAfter === pmcBefore, `status=${r.status} ${pmcBefore}->${pmcAfter}`);
    const ppsBefore = (await q(`SELECT count(*)::int n FROM pay_period_schedules WHERE company_id=$1 AND is_active`, [B1])).rows[0].n;
    r = await call("adminA", "POST", `/api/pay-period-schedules/deactivate-extras?companyId=${B1}`, {});
    check("X deactivate-extras on B → 403, B schedules unchanged", r.status === 403 && (await q(`SELECT count(*)::int n FROM pay_period_schedules WHERE company_id=$1 AND is_active`, [B1])).rows[0].n === ppsBefore, `status=${r.status}`);
    r = await call("adminA", "GET", `/api/pay-period-schedules/${B1}/resolve-debug`);
    check("X resolve-debug for B → 403", r.status === 403, `status=${r.status}`);
    r = await call("noco", "GET", "/api/app-doctor/repair-tickets");
    check("X repair tickets company-less → 403 (was every tenant)", r.status === 403 && !text(r.body).includes(SEN("TICKET", "B1")), `status=${r.status}`);
    r = await call("adminA", "GET", "/api/saved-reports");
    check("X saved reports list excludes B", r.status === 200 && text(r.body).includes(SEN("saved_reports", "A1")) && !text(r.body).includes(SEN("saved_reports", "B1")), `status=${r.status}`);
    r = await call("adminA", "GET", `/api/saved-reports/${ROW.saved_reports.B1}`);
    check("X saved report B by id → denied", denied(r.status), `status=${r.status}`);
    r = await call("adminA", "GET", `/api/schedule/labor-summary?companyId=${B1}&startDate=2026-09-01&endDate=2026-09-30`);
    check("X labor summary (wages) of B → 403", r.status === 403, `status=${r.status}`);
    r = await call("adminA", "GET", "/api/dashboard/stats");
    check("X dashboard stats count only Tenant A1 (3 employees, 1 contractor)", r.status === 200 && (r.body as any).totalEmployees === 3 && (r.body as any).totalContractors === 1, text(r.body));
    void ppsB2; void repA;
  } finally {
    if (server) await server.stop().catch(() => {});
    try {
      const likeUsers = `pr2b_%_${sfx}`;
      await q(`DELETE FROM company_user_access WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`, [likeUsers]);
      await q(`DELETE FROM session WHERE sess->>'userId' IN (SELECT id FROM users WHERE username LIKE $1)`, [likeUsers]).catch(() => {});
      await q(`DELETE FROM authorization_audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE username LIKE $1)`, [likeUsers]).catch(() => {});
      await q(`DELETE FROM expense_categories WHERE id = ANY($1::varchar[]) OR name LIKE $2`, [expenseCategoryIds, `ZZPR2B-%-${sfx}`]);
      await q(`DELETE FROM employee_wage_groups WHERE worker_id IN (SELECT id FROM workers WHERE company_id = ANY($1::varchar[]))`, [companyIds]).catch(() => {});
      await q(`DELETE FROM accrual_policy_milestones WHERE accrual_policy_id IN (SELECT id FROM accrual_policies WHERE company_id = ANY($1::varchar[]))`, [companyIds]).catch(() => {});
      for (const [t, id] of universalRows) await q(`DELETE FROM ${t} WHERE id = $1`, [id]);
      // A vulnerable baseline creates the probe title as a universal (NULL-company) row.
      await q(`DELETE FROM employee_titles WHERE name LIKE $1`, [`ZZPR2B-%-${sfx}`]);
      await q(`DELETE FROM users WHERE username LIKE $1`, [likeUsers]);
      await cascadeDelete(pool, "companies", companyIds);
      await q(`DELETE FROM tenants WHERE id = ANY($1::varchar[])`, [[tA, tB]]);
      await q(`DELETE FROM enterprises WHERE id = $1`, [ES]);
      const residue = [...(await verifyZeroResidue(pool, "companies", companyIds))];
      const stray = (await q(`SELECT
          (SELECT count(*) FROM users WHERE username LIKE $1)::int u,
          (SELECT count(*) FROM tenants WHERE id = ANY($2::varchar[]))::int t,
          (SELECT count(*) FROM expense_categories WHERE name LIKE $3)::int cat,
          (SELECT count(*) FROM employee_titles WHERE name LIKE $3)::int titles`,
        [likeUsers, [tA, tB], `ZZPR2B-%-${sfx}`])).rows[0];
      for (const [k, v] of Object.entries(stray)) if (Number(v) > 0) residue.push(`${k}: ${v}`);
      if (residue.length) { console.error("CLEANUP RESIDUE:", residue.join("; ")); failed++; }
      else console.log("\ncleanup: zero residue confirmed");
    } catch (e) {
      console.error("cleanup error:", (e as Error).message);
      failed++;
    }
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
