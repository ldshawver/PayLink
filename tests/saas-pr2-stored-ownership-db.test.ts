/**
 * SaaS PR 2 — stored-resource ownership (real HTTP, DB).
 *
 * Proves, against the real server and a disposable database, that the audit's
 * live-confirmed financial / payroll / employment / personal-data defects are
 * closed and stay closed:
 *
 *  A. list endpoints (remittance sources, payroll runs, expenses, customers, and
 *     the code-confirmed funding accounts / time-off / 1099 export): a missing
 *     companyId never means every tenant; a supplied one is authorized before
 *     the query; company-less non-platform users are denied; platform keeps its
 *     intentional behaviour. Sentinel rows in Tenant A and Tenant B prove that no
 *     top-level or nested value from the other tenant is returned.
 *  B. by-id writes (pay methods, payroll items, users, punch approval) authorize
 *     the STORED owner — never a body/query companyId — and leave the victim row
 *     byte-identical when denied.
 *  C. sensitive by-id reads (payroll-run taxes, ACH batch, 1099 summary, time-off
 *     request, compliance worker) return none of the victim's sensitive values.
 *  D. the company-less bypass: a non-platform user with NULL company_id is not a
 *     platform user.
 *  E. payroll-item family (taxes, tax override, amend), pay-method delete,
 *     worker-document delete (no admin bypass), system documents (platform-only).
 *  Persona: same-company employees do not gain coworkers' medical reasons / SSN.
 *  Multi-company: A1-only vs A1+A2 (explicit grant) vs scheduling-only reach.
 *  Public proposal approval requires the share token (missing / wrong / other
 *  proposal's / no-longer-public token denied; replay → 409, first approval kept).
 *
 * Fixture: Tenant A (A1, A2), Tenant B (B1), untenanted enterprise S (S1, S2).
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/saas-pr2-stored-ownership-db.test.ts
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
    console.log("TEST_DATABASE_URL not set — skipping saas-pr2-stored-ownership tests (0 run).");
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
  const sysDocIds: string[] = [];
  let server: TestServer | undefined;

  // Sentinels — unique per company, never printed.
  const SEN = (kind: string, co: string) => `ZZPR2-${kind}-${co}-${sfx}`;
  const SSN: Record<string, string> = { A1: "900-21-0001", A1b: "900-21-0002", A2: "900-21-0003", B1: "900-21-0004", S2: "900-21-0005" };

  try {
    // ── Fixture ──────────────────────────────────────────────────────────────
    await q(`INSERT INTO enterprises (id,name) VALUES ($1,$2)`, [ES, `PR2 Ent S ${sfx}`]);
    await q(`INSERT INTO companies (id,name,subscription_status,enterprise_id,is_demo) VALUES
      ($1,$6,'active_paid',NULL,false),($2,$7,'active_paid',NULL,false),($3,$8,'active_paid',NULL,false),
      ($4,$9,'active_paid',$11,false),($5,$10,'active_paid',$11,false)`,
      [A1, A2, B1, S1, S2, `PR2 A1 ${sfx}`, `PR2 A2 ${sfx}`, `PR2 B1 ${sfx}`, `PR2 S1 ${sfx}`, `PR2 S2 ${sfx}`, ES]);
    await q(`INSERT INTO tenants (id,name,slug,status) VALUES ($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [tA, `PR2 Tenant A ${sfx}`, `pr2-a-${sfx}`, tB, `PR2 Tenant B ${sfx}`, `pr2-b-${sfx}`]);
    await q(`INSERT INTO tenant_companies (tenant_id,company_id,is_primary) VALUES ($1,$2,true),($1,$3,false),($4,$5,true)`, [tA, A1, A2, tB, B1]);

    const W: Record<string, string> = {};
    for (const [key, co] of [["A1", A1], ["A1b", A1], ["A1mgr", A1], ["A2", A2], ["B1", B1], ["S1", S1], ["S2", S2]] as const) {
      const id = uid(); W[key] = id;
      await q(`INSERT INTO workers (id,company_id,first_name,last_name,worker_type,pay_rate,pay_type,ssn,address)
        VALUES ($1,$2,$3,'Fixture','employee','41.00','hourly',$4,$5)`, [id, co, `PR2${key}`, SSN[key] ?? null, SEN("ADDR", key)]);
    }

    const pw = await bcrypt.hash("Pr2!Synthetic", 10);
    const U: Record<string, string> = {};
    const mkUser = async (key: string, role: string, companyId: string | null, workerId: string | null = null) => {
      const id = uid(); U[key] = id;
      await q(`INSERT INTO users (id,username,password,role,company_id,worker_id,is_active) VALUES ($1,$2,$3,$4,$5,$6,true)`,
        [id, `pr2_${key}_${sfx}`, pw, role, companyId, workerId]);
    };
    await mkUser("psa", "platform_super_admin", null);
    await mkUser("adminA", "admin", A1);                 // A1-only tenant admin
    await mkUser("adminA12", "admin", A1);               // A1 + explicit grant to A2
    await mkUser("mgrA", "manager", A1, W.A1mgr);        // same-company manager
    await mkUser("empA", "employee", A1, W.A1);          // ordinary employee
    await mkUser("empAb", "employee", A1, W.A1b);        // coworker
    await mkUser("noco", "admin", null);                 // company-less non-platform
    await mkUser("adminB", "admin", B1);
    await mkUser("schedS1", "manager", S1);              // scheduling-only reach to S2
    await mkUser("victimB", "employee", B1);             // delete target in B
    await mkUser("victimA", "employee", A1);             // delete target in A (own-company success)
    await mkUser("victimB2", "employee", B1);            // platform delete success
    await q(`INSERT INTO company_user_access (user_id,company_id,role,is_default_company,is_active,worker_type)
      VALUES ($1,$2,'admin',false,true,'manager')`, [U.adminA12, A2]);

    // Per-company financial / HR rows (A1, A2, B1, S2).
    const R: Record<string, Record<string, string>> = {};
    const coOf: Record<string, string> = { A1, A2, B1, S2 };
    const wOf: Record<string, string> = { A1: W.A1, A2: W.A2, B1: W.B1, S2: W.S2 };
    for (const key of ["A1", "A2", "B1", "S2"]) {
      const co = coOf[key], w = wOf[key];
      const r: Record<string, string> = {}; R[key] = r;
      r.pm = uid();
      await q(`INSERT INTO pay_methods (id,worker_id,method_type,bank_name,account_type,routing_number,account_number,is_primary,is_active)
        VALUES ($1,$2,'direct_deposit','Fixture Bank','checking',$3,$4,true,true)`, [r.pm, w, SEN("RTG", key), SEN("ACCT", key)]);
      r.run = uid();
      await q(`INSERT INTO payroll_runs (id,company_id,period_start,period_end,status) VALUES ($1,$2,'2026-09-01','2026-09-14','draft')`, [r.run, co]);
      r.item = uid();
      await q(`INSERT INTO payroll_items (id,payroll_run_id,worker_id,gross_pay,deductions,net_pay) VALUES ($1,$2,$3,'1000.00','200.00','800.00')`, [r.item, r.run, w]);
      await q(`INSERT INTO payroll_item_taxes (payroll_item_id,tax_code,tax_name,taxable_wages,rate,amount,is_employer_paid)
        VALUES ($1,'FIT',$2,'1000.00','0.1','100.00',false)`, [r.item, SEN("TAX", key)]);
      await q(`INSERT INTO ach_batches (payroll_run_id,company_id,batch_id,status,batch_file) VALUES ($1,$2,$3,'pending',$4)`,
        [r.run, co, SEN("BATCHID", key), SEN("ACHFILE", key)]);
      r.rs = uid();
      await q(`INSERT INTO remittance_sources (id,company_id,name,routing_number,account_number) VALUES ($1,$2,$3,'021000021',$4)`,
        [r.rs, co, SEN("RSNAME", key), SEN("RSACCT", key)]);
      r.exp = uid();
      await q(`INSERT INTO expenses (id,company_id,submitter_id,expense_date,amount,description,status) VALUES ($1,$2,$3,'2026-09-02','12.34',$4,'submitted')`,
        [r.exp, co, w, SEN("EXP", key)]);
      r.cust = uid();
      await q(`INSERT INTO customers (id,company_id,customer_name) VALUES ($1,$2,$3)`, [r.cust, co, SEN("CUST", key)]);
      r.fa = uid();
      await q(`INSERT INTO funding_accounts (id,company_id,account_name,masked_identifier,current_balance) VALUES ($1,$2,$3,'****1234','5000.00')`,
        [r.fa, co, SEN("FUND", key)]);
      r.punch = uid();
      await q(`INSERT INTO time_punches (id,worker_id,company_id,punch_type,punch_time,approval_status) VALUES ($1,$2,$3,'clock_in',NOW(),'pending')`, [r.punch, w, co]);
      r.tor = uid();
      await q(`INSERT INTO time_off_requests (id,worker_id,company_id,request_type,start_date,end_date,reason,status) VALUES ($1,$2,$3,'sick','2026-10-01','2026-10-02',$4,'pending')`,
        [r.tor, w, co, SEN("MEDICAL", key)]);
      r.s1099 = uid();
      await q(`INSERT INTO contractor_1099_summaries (id,company_id,worker_id,tax_year) VALUES ($1,$2,$3,2026)`, [r.s1099, co, w]);
      r.doc = uid();
      await q(`INSERT INTO worker_documents (id,worker_id,name,file_url) VALUES ($1,$2,$3,'/uploads/zz-pr2.pdf')`, [r.doc, w, SEN("DOC", key)]);
    }
    // Same-company coworker rows (persona tests).
    const torA1b = uid();
    await q(`INSERT INTO time_off_requests (id,worker_id,company_id,request_type,start_date,end_date,reason,status) VALUES ($1,$2,$3,'sick','2026-10-05','2026-10-06',$4,'pending')`,
      [torA1b, W.A1b, A1, SEN("MEDICAL", "A1b")]);
    const pmA1b = uid();
    await q(`INSERT INTO pay_methods (id,worker_id,method_type,account_number,is_primary,is_active) VALUES ($1,$2,'direct_deposit',$3,true,true)`,
      [pmA1b, W.A1b, SEN("ACCT", "A1b")]);
    const sysDoc = uid(); sysDocIds.push(sysDoc);
    await q(`INSERT INTO system_documents (id,title,description) VALUES ($1,$2,'fixture')`, [sysDoc, SEN("SYSDOC", "G")]);

    server = await startTestServer(url);
    const base = server.baseUrl;
    const S: Record<string, Session> = {};
    for (const k of Object.keys(U)) S[k] = await login(base, `pr2_${k}_${sfx}`, "Pr2!Synthetic");
    const call = (who: string, m: string, p: string, b?: unknown) => apiRequest(base, m, p, S[who], b);
    const raw = async (who: string, p: string) => {
      const res = await fetch(`${base}${p}`, { headers: { cookie: S[who].cookie } });
      return { status: res.status, body: await res.text() };
    };
    const snap = async (table: string, id: string) =>
      JSON.stringify((await q(`SELECT row_to_json(t) AS j FROM ${table} t WHERE id = $1`, [id])).rows[0]?.j ?? null);
    const exists = async (table: string, id: string) => (await q(`SELECT 1 FROM ${table} WHERE id=$1`, [id])).rowCount === 1;

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── Group A: list endpoints (sentinel leak test) ──");
    type ListCase = { path: string; kind: string; platformAll: boolean };
    const LISTS: ListCase[] = [
      { path: "/api/remittance-sources", kind: "RSACCT", platformAll: true },
      { path: "/api/payroll-runs", kind: "RUN", platformAll: true },
      { path: "/api/expenses", kind: "EXP", platformAll: true },
      { path: "/api/customers", kind: "CUST", platformAll: false },
      { path: "/api/funding-accounts", kind: "FUND", platformAll: true },
      { path: "/api/time-off-requests", kind: "MEDICAL", platformAll: true },
    ];
    // payroll runs carry no free-text sentinel: use the run id itself.
    const sentinel = (kind: string, key: string) => (kind === "RUN" ? R[key].run : SEN(kind, key));
    for (const L of LISTS) {
      const tag = (s: string) => `[${L.path}] ${s}`;
      const qs = (co?: string) => (co ? `${L.path}?companyId=${co}` : L.path);
      let r = await call("adminA", "GET", qs());
      check(tag("Tenant A, no companyId → A records only"), r.status === 200 && text(r.body).includes(sentinel(L.kind, "A1"))
        && !text(r.body).includes(sentinel(L.kind, "B1")) && !text(r.body).includes(sentinel(L.kind, "A2")), `status=${r.status}`);
      r = await call("adminA", "GET", qs(A1));
      check(tag("Tenant A, companyId=A → A records"), r.status === 200 && text(r.body).includes(sentinel(L.kind, "A1")) && !text(r.body).includes(sentinel(L.kind, "B1")), `status=${r.status}`);
      r = await call("adminA", "GET", qs(B1));
      check(tag("Tenant A, companyId=B → denied, no B data"), r.status === 403 && !text(r.body).includes(sentinel(L.kind, "B1")), `status=${r.status}`);
      r = await call("adminA", "GET", `${L.path}?companyId=all`);
      check(tag("Tenant A, companyId=all → still own company only"), r.status === 200 && !text(r.body).includes(sentinel(L.kind, "B1")), `status=${r.status}`);
      r = await call("noco", "GET", qs());
      check(tag("company-less non-platform, no companyId → denied"), r.status === 403 && !text(r.body).includes(sentinel(L.kind, "B1")), `status=${r.status}`);
      r = await call("noco", "GET", qs(B1));
      check(tag("company-less non-platform, companyId=B → denied"), r.status === 403 && !text(r.body).includes(sentinel(L.kind, "B1")), `status=${r.status}`);
      r = await call("psa", "GET", qs(B1));
      if (L.path === "/api/expenses") {
        // Pre-existing (unchanged by PR 2): GET /api/expenses treats only literal
        // admin/manager as reviewers, so a platform user sees only expenses it submitted.
        check(tag("platform, companyId=B → allowed (pre-existing submitter-only view, no leak)"), r.status === 200 && !text(r.body).includes(sentinel(L.kind, "B1")), `status=${r.status}`);
        continue;
      }
      check(tag("platform, companyId=B → B records"), r.status === 200 && text(r.body).includes(sentinel(L.kind, "B1")), `status=${r.status}`);
      r = await call("psa", "GET", qs());
      if (L.platformAll) check(tag("platform, no companyId → intentional all-company view"), r.status === 200 && text(r.body).includes(sentinel(L.kind, "A1")) && text(r.body).includes(sentinel(L.kind, "B1")), `status=${r.status}`);
      else check(tag("platform, no companyId → must name a company (400)"), r.status === 400, `status=${r.status}`);
    }
    {
      // Most important single assertion of this PR.
      const r = await call("adminA", "GET", "/api/remittance-sources");
      const b = text(r.body);
      check("remittance sources: tenant with no companyId gets NO other tenant's bank account numbers",
        r.status === 200 && !b.includes(SEN("RSACCT", "B1")) && !b.includes(SEN("RSACCT", "A2")) && !b.includes(SEN("RSACCT", "S2")));
    }
    {
      let r = await raw("adminA", `/api/1099-summaries/export?companyId=${B1}&year=2026`);
      check("1099 export: other tenant's company → 403, no SSN/address", r.status === 403 && !r.body.includes(SSN.B1) && !r.body.includes(SEN("ADDR", "B1")), `status=${r.status}`);
      r = await raw("noco", `/api/1099-summaries/export?companyId=${A1}&year=2026`);
      check("1099 export: company-less non-platform → 403", r.status === 403 && !r.body.includes(SSN.A1), `status=${r.status}`);
      r = await raw("adminA", `/api/1099-summaries/export?companyId=${A1}&year=2026`);
      check("1099 export: own company still works", r.status === 200, `status=${r.status}`);
      r = await raw("psa", `/api/1099-summaries/export?companyId=${B1}&year=2026`);
      check("1099 export: platform → allowed", r.status === 200, `status=${r.status}`);
    }
    {
      let r = await call("noco", "GET", "/api/users");
      check("GET /api/users: company-less non-platform admin no longer gets every tenant's users", r.status === 403 && !text(r.body).includes(U.adminB), `status=${r.status}`);
      r = await call("adminA", "GET", "/api/users");
      check("GET /api/users: tenant admin sees own company only", r.status === 200 && text(r.body).includes(U.empA) && !text(r.body).includes(U.adminB), `status=${r.status}`);
      r = await call("adminA", "GET", `/api/payroll-summary?companyId=${B1}`);
      check("GET /api/payroll-summary?companyId=B → 403", r.status === 403, `status=${r.status}`);
      r = await call("noco", "GET", "/api/payroll-summary");
      check("GET /api/payroll-summary company-less → 403", r.status === 403, `status=${r.status}`);
    }

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── Groups B/C/E: by-id matrix (stored owner) ──");
    type ById = {
      name: string; method: string; path: (id: string) => string; table?: string;
      idA: string; idB: string; body?: Record<string, unknown>; sensitive?: string[];
      ownOk?: boolean; platformOk?: boolean;
    };
    const BYID: ById[] = [
      { name: "PATCH pay-method", method: "PATCH", path: (id) => `/api/pay-methods/${id}`, table: "pay_methods", idA: R.A1.pm, idB: R.B1.pm,
        body: { accountNumber: "ATTACKER-000", routingNumber: "000000000" }, sensitive: [SEN("ACCT", "B1"), SEN("RTG", "B1")] },
      { name: "PATCH payroll-item", method: "PATCH", path: (id) => `/api/payroll-items/${id}`, table: "payroll_items", idA: R.A1.item, idB: R.B1.item,
        body: { grossPay: "99999.00", netPay: "99999.00" } },
      { name: "PATCH time-punch approve", method: "PATCH", path: (id) => `/api/time-punches/${id}/approve`, table: "time_punches", idA: R.A1.punch, idB: R.B1.punch,
        body: { action: "approve" } },
      { name: "GET payroll-run taxes", method: "GET", path: (id) => `/api/payroll-runs/${id}/taxes`, idA: R.A1.run, idB: R.B1.run, sensitive: [SEN("TAX", "B1")] },
      { name: "GET payroll-run ACH batch", method: "GET", path: (id) => `/api/payroll-runs/${id}/ach-batch`, idA: R.A1.run, idB: R.B1.run, sensitive: [SEN("ACHFILE", "B1"), SEN("BATCHID", "B1")] },
      { name: "GET payroll-run tax-snapshot", method: "GET", path: (id) => `/api/payroll-runs/${id}/tax-snapshot`, idA: R.A1.run, idB: R.B1.run },
      { name: "GET payroll-run tax-overrides", method: "GET", path: (id) => `/api/payroll-runs/${id}/tax-overrides`, idA: R.A1.run, idB: R.B1.run },
      { name: "GET payroll-run transaction-runs", method: "GET", path: (id) => `/api/payroll-runs/${id}/transaction-runs`, idA: R.A1.run, idB: R.B1.run },
      { name: "GET payroll-run compliance-events", method: "GET", path: (id) => `/api/payroll-runs/${id}/compliance-events`, idA: R.A1.run, idB: R.B1.run },
      { name: "GET payroll-item taxes", method: "GET", path: (id) => `/api/payroll-items/${id}/taxes`, idA: R.A1.item, idB: R.B1.item, sensitive: [SEN("TAX", "B1")] },
      { name: "GET 1099 summary", method: "GET", path: (id) => `/api/1099-summaries/${id}`, idA: R.A1.s1099, idB: R.B1.s1099, sensitive: [R.B1.s1099, W.B1] },
      { name: "PATCH 1099 summary", method: "PATCH", path: (id) => `/api/1099-summaries/${id}`, table: "contractor_1099_summaries", idA: R.A1.s1099, idB: R.B1.s1099,
        body: { status: "filed", notes: "tampered" } },
      { name: "GET time-off request", method: "GET", path: (id) => `/api/time-off-requests/${id}`, idA: R.A1.tor, idB: R.B1.tor, sensitive: [SEN("MEDICAL", "B1")] },
      { name: "PATCH time-off request", method: "PATCH", path: (id) => `/api/time-off-requests/${id}`, table: "time_off_requests", idA: R.A1.tor, idB: R.B1.tor,
        body: { status: "approved", reason: "tampered" } },
      { name: "GET compliance worker", method: "GET", path: (id) => `/api/compliance/worker/${id}`, idA: W.A1, idB: W.B1, sensitive: [SSN.B1, SEN("ADDR", "B1")] },
      { name: "PATCH compliance worker profile", method: "PATCH", path: (id) => `/api/compliance/worker/${id}/profile`, idA: W.A1, idB: W.B1, body: { notes: "tampered" } },
      { name: "PATCH remittance source", method: "PATCH", path: (id) => `/api/remittance-sources/${id}`, table: "remittance_sources", idA: R.A1.rs, idB: R.B1.rs,
        body: { accountNumber: "ATTACKER-333", routingNumber: "000000000" }, sensitive: [SEN("RSACCT", "B1")] },
      { name: "PATCH customer", method: "PATCH", path: (id) => `/api/customers/${id}`, table: "customers", idA: R.A1.cust, idB: R.B1.cust,
        body: { customerName: "tampered" }, sensitive: [SEN("CUST", "B1")] },
      { name: "PATCH funding account", method: "PATCH", path: (id) => `/api/funding-accounts/${id}`, table: "funding_accounts", idA: R.A1.fa, idB: R.B1.fa,
        body: { accountName: "tampered" }, sensitive: [SEN("FUND", "B1")] },
      { name: "GET expense", platformOk: false, method: "GET", path: (id) => `/api/expenses/${id}`, idA: R.A1.exp, idB: R.B1.exp, sensitive: [SEN("EXP", "B1")] },
      { name: "PATCH expense", platformOk: false, method: "PATCH", path: (id) => `/api/expenses/${id}`, table: "expenses", idA: R.A1.exp, idB: R.B1.exp,
        body: { description: "tampered", amount: "99999" } },
      { name: "GET expense audit trail", method: "GET", path: (id) => `/api/expenses/${id}/audit`, idA: R.A1.exp, idB: R.B1.exp },
      { name: "GET expense attachments", platformOk: false, method: "GET", path: (id) => `/api/expenses/${id}/attachments`, idA: R.A1.exp, idB: R.B1.exp },
    ];
    for (const c of BYID) {
      const tag = (s: string) => `[${c.name}] ${s}`;
      const before = c.table ? await snap(c.table, c.idB) : "";
      const attacks: Array<[string, string, string, unknown]> = [
        ["A → B resource", "adminA", c.path(c.idB), c.body],
        ["A → B via query companyId", "adminA", `${c.path(c.idB)}?companyId=${A1}`, c.body],
        ["A → B via body companyId", "adminA", c.path(c.idB), c.method === "GET" ? undefined : { ...(c.body ?? {}), companyId: A1 }],
        ["company-less → B resource", "noco", c.path(c.idB), c.body],
        ["company-less → A resource", "noco", c.path(c.idA), c.body],
      ];
      for (const [label, who, p, b] of attacks) {
        const r = await call(who, c.method, p, b);
        const leaked = (c.sensitive ?? []).filter((s) => text(r.body).includes(s));
        check(tag(`${label} → denied, no sensitive values`), denied(r.status) && leaked.length === 0, `status=${r.status} leaked=${leaked.length}`);
      }
      if (c.table) check(tag("victim row byte-identical after all attacks"), (await snap(c.table, c.idB)) === before);
      const own = await call("adminA", c.method, c.path(c.idA), c.body);
      check(tag("A → own resource succeeds"), own.status === 200, `status=${own.status}`);
      const plat = await call("psa", c.method, c.path(c.idB), c.body);
      if (c.platformOk === false) {
        // Pre-existing persona rule, unchanged by PR 2: expense review is literal admin/manager only.
        check(tag("platform → passes company check, pre-existing persona rule still applies (403, no leak)"), plat.status === 403 && !(c.sensitive ?? []).some((s) => text(plat.body).includes(s)), `status=${plat.status}`);
      } else {
        check(tag("platform → any tenant (intentional)"), plat.status === 200, `status=${plat.status}`);
      }
    }

    // payroll-item: no re-parenting through the body
    {
      const before = await snap("payroll_items", R.A1.item);
      const r = await call("adminA", "PATCH", `/api/payroll-items/${R.A1.item}`, { payrollRunId: R.B1.run, workerId: W.B1, grossPay: "1000.00" });
      const row = (await q(`SELECT payroll_run_id, worker_id FROM payroll_items WHERE id=$1`, [R.A1.item])).rows[0];
      check("PATCH own payroll-item cannot move it to another tenant's run/worker", r.status === 200 && row.payroll_run_id === R.A1.run && row.worker_id === W.A1, `status=${r.status} ${before.length > 0}`);
    }
    // payroll-item tax override / amend — denial must create nothing
    {
      const cnt = async () => Number((await q(`SELECT count(*)::int n FROM payroll_overrides WHERE payroll_item_id=$1`, [R.B1.item])).rows[0].n);
      const itemBefore = await snap("payroll_items", R.B1.item);
      const o0 = await cnt();
      let r = await call("adminA", "PATCH", `/api/payroll-items/${R.B1.item}/tax-override`, { taxCode: "FIT", overrideAmount: 0, reason: "attack" });
      check("tax-override on another tenant's item → denied, no override row", denied(r.status) && (await cnt()) === o0, `status=${r.status}`);
      r = await call("noco", "PATCH", `/api/payroll-items/${R.B1.item}/tax-override`, { taxCode: "FIT", overrideAmount: 0, reason: "attack" });
      check("tax-override company-less → denied", denied(r.status) && (await cnt()) === o0, `status=${r.status}`);
      const am0 = Number((await q(`SELECT count(*)::int n FROM pay_stub_amendments WHERE company_id=$1`, [B1])).rows[0].n);
      r = await call("adminA", "POST", `/api/payroll-items/${R.B1.item}/amend`, { grossPay: 1, deductions: 0, netPay: 1, note: "attack" });
      const am1 = Number((await q(`SELECT count(*)::int n FROM pay_stub_amendments WHERE company_id=$1`, [B1])).rows[0].n);
      check("amend another tenant's item → denied, no amendment, item unchanged", denied(r.status) && am1 === am0 && (await snap("payroll_items", R.B1.item)) === itemBefore, `status=${r.status}`);
      r = await call("adminA", "PATCH", `/api/payroll-items/${R.A1.item}/tax-override`, { taxCode: "FIT", overrideAmount: 90, reason: "own" });
      check("tax-override own item → allowed", r.status === 200 || r.status === 201, `status=${r.status}`);
      r = await call("adminA", "POST", `/api/payroll-items/${R.A1.item}/amend`, { grossPay: 1000, deductions: 200, netPay: 800, note: "own" });
      check("amend own item → allowed", r.status === 200 || r.status === 201, `status=${r.status}`);
    }

    console.log("\n── Group A by-id families: banking / customer / funding / expense writes ──");
    {
      // expense workflow + delete on another tenant's expense
      for (const [m, p, b] of [["POST", `/api/expenses/${R.B1.exp}/approve`, {}], ["POST", `/api/expenses/${R.B1.exp}/reject`, { reason: "x" }],
        ["DELETE", `/api/expenses/${R.B1.exp}`, undefined]] as Array<[string, string, unknown]>) {
        const before = await snap("expenses", R.B1.exp);
        let r = await call("adminA", m, p, b);
        check(`${m} ${p.replace(R.B1.exp, ":B")} as other tenant's admin → denied, expense unchanged`, denied(r.status) && (await snap("expenses", R.B1.exp)) === before, `status=${r.status}`);
        r = await call("noco", m, p, b);
        check(`${m} ${p.replace(R.B1.exp, ":B")} company-less → denied`, denied(r.status) && (await snap("expenses", R.B1.exp)) === before, `status=${r.status}`);
      }
      const r0 = await call("adminA", "PATCH", `/api/expenses/${R.A1.exp}`, { companyId: B1, description: "own edit" });
      const expCo = (await q(`SELECT company_id FROM expenses WHERE id=$1`, [R.A1.exp])).rows[0].company_id;
      check("PATCH own expense cannot re-parent it to another tenant (companyId ignored)", r0.status === 200 && expCo === A1, `status=${r0.status}`);
      // remittance source / customer / funding account deletes
      for (const [table, p, id] of [["remittance_sources", "/api/remittance-sources/", R.B1.rs], ["customers", "/api/customers/", R.B1.cust],
        ["funding_accounts", "/api/funding-accounts/", R.B1.fa]] as Array<[string, string, string]>) {
        let r = await call("adminA", "DELETE", `${p}${id}`);
        check(`DELETE other tenant's ${table} row → denied, row intact`, denied(r.status) && (await exists(table, id)), `status=${r.status}`);
        r = await call("noco", "DELETE", `${p}${id}`);
        check(`DELETE ${table} company-less → denied`, denied(r.status) && (await exists(table, id)), `status=${r.status}`);
      }
      let r = await call("adminA", "POST", `/api/funding-accounts/${R.B1.fa}/set-default`, {});
      check("set-default on another tenant's funding account → denied", denied(r.status) && (await q(`SELECT is_default FROM funding_accounts WHERE id=$1`, [R.B1.fa])).rows[0]?.is_default === false, `status=${r.status}`);
      // universal (company_id NULL) funding account — shared by every tenant → platform only
      const faU = uid();
      await q(`INSERT INTO funding_accounts (id,company_id,account_name) VALUES ($1,NULL,$2)`, [faU, SEN("FUND", "UNIVERSAL")]);
      const uBefore = await snap("funding_accounts", faU);
      r = await call("adminA", "PATCH", `/api/funding-accounts/${faU}`, { accountName: "tenant-tampered" });
      check("tenant admin PATCH universal funding account → 403, unchanged", r.status === 403 && (await snap("funding_accounts", faU)) === uBefore, `status=${r.status}`);
      r = await call("adminA", "DELETE", `/api/funding-accounts/${faU}`);
      check("tenant admin DELETE universal funding account → 403, row intact", r.status === 403 && (await exists("funding_accounts", faU)), `status=${r.status}`);
      r = await call("psa", "PATCH", `/api/funding-accounts/${faU}`, { notes: "platform edit" });
      check("platform PATCH universal funding account → allowed", r.status === 200, `status=${r.status}`);
      r = await call("adminA", "GET", "/api/funding-accounts");
      check("tenant list still includes universal funding accounts (read semantics unchanged)", r.status === 200 && text(r.body).includes(SEN("FUND", "UNIVERSAL")), `status=${r.status}`);
      await q(`DELETE FROM funding_accounts WHERE id=$1`, [faU]);
      // payroll check routes — stored run owner; company-less bypass closed
      for (const p of [`/api/checks/${R.B1.item}/pdf`, `/api/payroll-runs/${R.B1.run}/checks-pdf`]) {
        let rr = await raw("noco", p);
        check(`company-less → GET ${p.replace(R.B1.item, ":item").replace(R.B1.run, ":run")} → 403, no PDF`, rr.status === 403 && !rr.body.startsWith("%PDF"), `status=${rr.status}`);
        rr = await raw("adminA", p);
        check(`other tenant's admin → GET ${p.replace(R.B1.item, ":item").replace(R.B1.run, ":run")} → 403, no PDF`, rr.status === 403 && !rr.body.startsWith("%PDF"), `status=${rr.status}`);
      }
      for (const p of [`/api/checks/${R.B1.item}/void`, `/api/checks/${R.B1.item}/reprint`]) {
        const before = await snap("payroll_items", R.B1.item);
        const rr = await call("noco", "POST", p, { voidReason: "attack", reprintReason: "attack", reason: "attack" });
        check(`company-less → POST ${p.replace(R.B1.item, ":item")} → denied, item unchanged`, denied(rr.status) && (await snap("payroll_items", R.B1.item)) === before, `status=${rr.status}`);
      }
    }

    console.log("\n── Destructive by-id: DELETE ──");
    {
      // pay method
      let before = await snap("pay_methods", R.B1.pm);
      let r = await call("adminA", "DELETE", `/api/pay-methods/${R.B1.pm}`);
      check("DELETE other tenant's pay method → denied, row intact", denied(r.status) && (await snap("pay_methods", R.B1.pm)) === before, `status=${r.status}`);
      r = await call("noco", "DELETE", `/api/pay-methods/${R.B1.pm}`);
      check("DELETE pay method company-less → denied", denied(r.status) && (await exists("pay_methods", R.B1.pm)), `status=${r.status}`);
      // worker document — admin used to skip the company check entirely
      before = await snap("worker_documents", R.B1.doc);
      r = await call("adminA", "DELETE", `/api/worker-documents/${R.B1.doc}`);
      check("DELETE other tenant's worker document as ADMIN → denied (admin bypass closed)", denied(r.status) && (await snap("worker_documents", R.B1.doc)) === before, `status=${r.status}`);
      r = await call("noco", "DELETE", `/api/worker-documents/${R.B1.doc}`);
      check("DELETE worker document company-less → denied", denied(r.status) && (await exists("worker_documents", R.B1.doc)), `status=${r.status}`);
      r = await call("adminA", "DELETE", `/api/worker-documents/${R.A1.doc}`);
      check("DELETE own-company worker document → allowed", r.status === 200 && !(await exists("worker_documents", R.A1.doc)), `status=${r.status}`);
      // time-off
      before = await snap("time_off_requests", R.B1.tor);
      r = await call("adminA", "DELETE", `/api/time-off-requests/${R.B1.tor}`);
      check("DELETE other tenant's time-off → denied", denied(r.status) && (await snap("time_off_requests", R.B1.tor)) === before, `status=${r.status}`);
      // users
      r = await call("adminA", "DELETE", `/api/users/${U.victimB}`);
      check("DELETE other tenant's user → denied, user intact", denied(r.status) && (await exists("users", U.victimB)), `status=${r.status}`);
      r = await call("adminA", "DELETE", `/api/users/${U.psa}`);
      check("tenant admin DELETE platform user → denied", denied(r.status) && (await exists("users", U.psa)), `status=${r.status}`);
      r = await call("adminA", "DELETE", `/api/users/${U.noco}`);
      check("tenant admin DELETE company-less user → denied", denied(r.status) && (await exists("users", U.noco)), `status=${r.status}`);
      r = await call("noco", "DELETE", `/api/users/${U.victimA}`);
      check("company-less admin DELETE any user → denied", denied(r.status) && (await exists("users", U.victimA)), `status=${r.status}`);
      r = await call("adminA", "DELETE", `/api/users/${uid()}`);
      check("DELETE unknown user id → 404", r.status === 404, `status=${r.status}`);
      r = await call("adminA", "DELETE", `/api/users/${U.victimA}`);
      check("tenant admin DELETE own-company user → allowed", r.status === 200 && !(await exists("users", U.victimA)), `status=${r.status}`);
      r = await call("psa", "DELETE", `/api/users/${U.victimB2}`);
      check("platform DELETE any tenant's user → allowed", r.status === 200 && !(await exists("users", U.victimB2)), `status=${r.status}`);
      // own pay method delete last
      r = await call("adminA", "DELETE", `/api/pay-methods/${R.A1.pm}`);
      check("DELETE own-company pay method → allowed", r.status === 200 && !(await exists("pay_methods", R.A1.pm)), `status=${r.status}`);
    }

    console.log("\n── System documents (platform-wide table) ──");
    {
      const before = await snap("system_documents", sysDoc);
      let r = await call("adminA", "PATCH", `/api/system-documents/${sysDoc}`, { title: "tampered" });
      check("tenant admin PATCH platform-wide system document → 403", r.status === 403 && (await snap("system_documents", sysDoc)) === before, `status=${r.status}`);
      r = await call("adminA", "DELETE", `/api/system-documents/${sysDoc}`);
      check("tenant admin DELETE platform-wide system document → 403", r.status === 403 && (await exists("system_documents", sysDoc)), `status=${r.status}`);
      r = await call("adminA", "POST", "/api/system-documents", { title: SEN("SYSDOC", "ATTACK") });
      const created = (await q(`SELECT count(*)::int n FROM system_documents WHERE title=$1`, [SEN("SYSDOC", "ATTACK")])).rows[0].n;
      check("tenant admin POST platform-wide system document → 403, nothing created", r.status === 403 && created === 0, `status=${r.status}`);
      r = await call("adminA", "GET", `/api/system-documents/${sysDoc}`);
      check("tenant users can still READ system documents", r.status === 200, `status=${r.status}`);
      r = await call("psa", "PATCH", `/api/system-documents/${sysDoc}`, { description: "platform edit" });
      check("platform admin PATCH system document → allowed", r.status === 200, `status=${r.status}`);
    }

    console.log("\n── Persona: same company ≠ sensitive access ──");
    {
      let r = await call("empA", "GET", `/api/time-off-requests/${torA1b}`);
      check("employee reading a coworker's time-off → 403, no medical reason", r.status === 403 && !text(r.body).includes(SEN("MEDICAL", "A1b")), `status=${r.status}`);
      r = await call("empA", "GET", `/api/time-off-requests/${R.A1.tor}`);
      check("employee reading own time-off → 200", r.status === 200, `status=${r.status}`);
      r = await call("empA", "GET", "/api/time-off-requests");
      check("employee time-off list → own requests only (no coworker reasons)", r.status === 200 && text(r.body).includes(R.A1.tor) && !text(r.body).includes(SEN("MEDICAL", "A1b")), `status=${r.status}`);
      r = await call("empA", "GET", `/api/time-off-requests?workerId=${W.A1b}`);
      check("employee cannot widen the list with ?workerId=<coworker>", r.status === 200 && !text(r.body).includes(SEN("MEDICAL", "A1b")), `status=${r.status}`);
      r = await call("mgrA", "GET", `/api/time-off-requests/${torA1b}`);
      check("manager in the same company can read the request", r.status === 200, `status=${r.status}`);
      r = await call("empA", "GET", `/api/compliance/worker/${W.A1b}`);
      check("employee reading a coworker's compliance record → 403, no SSN", r.status === 403 && !text(r.body).includes(SSN.A1b), `status=${r.status}`);
      r = await call("mgrA", "GET", `/api/compliance/worker/${W.A1b}`);
      check("manager compliance read → 200 with NO SSN/address (minimal worker projection)", r.status === 200 && !text(r.body).includes(SSN.A1b) && !text(r.body).includes(SEN("ADDR", "A1b")) && (r.body as any)?.worker?.workerType === "employee", `status=${r.status}`);
      r = await call("empA", "PATCH", `/api/pay-methods/${pmA1b}`, { accountNumber: "ATTACKER-111" });
      check("employee editing a coworker's pay method → 403", r.status === 403 && (await q(`SELECT account_number FROM pay_methods WHERE id=$1`, [pmA1b])).rows[0].account_number === SEN("ACCT", "A1b"), `status=${r.status}`);
      const torBefore = (await q(`SELECT status FROM time_off_requests WHERE id=$1`, [R.A1.tor])).rows[0].status;
      r = await call("empA", "PATCH", `/api/time-off-requests/${R.A1.tor}`, { status: "approved", reviewedBy: U.empA });
      const torAfter = (await q(`SELECT status, reviewed_by FROM time_off_requests WHERE id=$1`, [R.A1.tor])).rows[0];
      check("employee cannot self-approve own time-off via PATCH (review fields stripped → 400)", r.status === 400 && torAfter.status === torBefore && torAfter.reviewed_by !== U.empA, `status=${r.status}`);
      r = await call("empA", "PATCH", `/api/time-off-requests/${R.A1.tor}`, { status: "approved", endDate: "2026-10-03" });
      const torAfter2 = (await q(`SELECT status, end_date::text AS e FROM time_off_requests WHERE id=$1`, [R.A1.tor])).rows[0];
      check("employee can still edit own request's dates, but not its status", r.status === 200 && torAfter2.status === torBefore && torAfter2.e === "2026-10-03", `status=${r.status}`);
      r = await call("empA", "DELETE", `/api/time-off-requests/${torA1b}`);
      check("employee deleting a coworker's time-off → 403", r.status === 403 && (await exists("time_off_requests", torA1b)), `status=${r.status}`);
    }

    console.log("\n── Same-tenant multi-company: A1-only vs A1+A2 vs scheduling-only ──");
    {
      let r = await call("adminA", "GET", `/api/payroll-runs?companyId=${A2}`);
      check("A1-only admin → A2 payroll runs denied", r.status === 403 && !text(r.body).includes(R.A2.run), `status=${r.status}`);
      r = await call("adminA12", "GET", `/api/payroll-runs?companyId=${A2}`);
      check("A1+A2 (explicit grant) admin → A2 payroll runs allowed", r.status === 200 && text(r.body).includes(R.A2.run), `status=${r.status}`);
      r = await call("adminA", "GET", `/api/payroll-runs/${R.A2.run}/taxes`);
      check("A1-only admin → A2 run taxes denied", r.status === 403 && !text(r.body).includes(SEN("TAX", "A2")), `status=${r.status}`);
      r = await call("adminA12", "GET", `/api/payroll-runs/${R.A2.run}/taxes`);
      check("A1+A2 admin → A2 run taxes allowed", r.status === 200 && text(r.body).includes(SEN("TAX", "A2")), `status=${r.status}`);
      r = await call("adminA12", "GET", "/api/remittance-sources");
      check("A1+A2 admin, no companyId → default (home) company only", r.status === 200 && text(r.body).includes(R.A1.rs) && !text(r.body).includes(R.A2.rs) && !text(r.body).includes(SEN("RSACCT", "A2")), `status=${r.status}`);
      // scheduling-only reach (enterprise sibling) must not become financial/HR access
      r = await call("schedS1", "GET", "/api/workers?scheduling=true");
      check("scheduling-only user still sees sibling worker in the scheduling picker", r.status === 200 && text(r.body).includes(W.S2) && !text(r.body).includes(SSN.S2), `status=${r.status}`);
      const schedDenials: Array<[string, string]> = [
        ["GET", `/api/payroll-runs?companyId=${S2}`], ["GET", `/api/remittance-sources?companyId=${S2}`],
        ["GET", `/api/time-off-requests?companyId=${S2}`], ["GET", `/api/payroll-runs/${R.S2.run}/taxes`],
        ["GET", `/api/payroll-runs/${R.S2.run}/ach-batch`], ["GET", `/api/time-off-requests/${R.S2.tor}`],
        ["GET", `/api/compliance/worker/${W.S2}`], ["GET", `/api/funding-accounts?companyId=${S2}`],
      ];
      for (const [m, p] of schedDenials) {
        r = await call("schedS1", m, p);
        const leaked = [SEN("RSACCT", "S2"), SEN("MEDICAL", "S2"), SEN("TAX", "S2"), SEN("ACHFILE", "S2"), SSN.S2, SEN("FUND", "S2"), R.S2.run].filter((s) => text(r.body).includes(s));
        check(`scheduling-only → ${m} ${p.split("?")[0]} denied`, r.status === 403 && leaked.length === 0, `status=${r.status}`);
      }
      const pmBefore = await snap("pay_methods", R.S2.pm);
      r = await call("schedS1", "PATCH", `/api/pay-methods/${R.S2.pm}`, { accountNumber: "ATTACKER-222" });
      check("scheduling-only → sibling pay method write denied", r.status === 403 && (await snap("pay_methods", R.S2.pm)) === pmBefore, `status=${r.status}`);
    }

    console.log("\n── Public contractor proposal approval (share token) ──");
    {
      const mkProp = async (co: string, contractor: string, status: string, token: string | null) => {
        const id = uid();
        await q(`INSERT INTO contractor_proposals (id,company_id,contractor_id,issue_date,status,share_token,title) VALUES ($1,$2,$3,'2026-09-01',$4,$5,$6)`,
          [id, co, contractor, status, token, SEN("PROP", status)]);
        return id;
      };
      const tokA = crypto.randomBytes(32).toString("hex"), tokB = crypto.randomBytes(32).toString("hex"), tokX = crypto.randomBytes(32).toString("hex");
      const pA = await mkProp(A1, W.A1, "sent", tokA);
      const pB = await mkProp(B1, W.B1, "sent", tokB);
      const pX = await mkProp(B1, W.B1, "superseded", tokX);
      const pN = await mkProp(B1, W.B1, "sent", null);
      const statusOf = async (id: string) => (await q(`SELECT status, approval_name FROM contractor_proposals WHERE id=$1`, [id])).rows[0];
      // /api/contractor-proposals/* sits behind the global session gate, so the live
      // defect was: ANY authenticated user (any tenant, any role) could approve ANY
      // tenant's proposal knowing only its id. The attacker here is Tenant A's employee.
      const approve = (id: string, token?: string, name = "Client One", viaPortal = false, who: string | null = "empA") =>
        apiRequest(base, "POST", viaPortal ? `/api/portal/proposals/${id}/approve${token ? `?token=${token}` : ""}` : `/api/contractor-proposals/${id}/client-approve${token ? `?token=${token}` : ""}`,
          viaPortal || who === null ? null : S[who], { approvalName: name, approvalEmail: "client@example.test" });
      let r = await approve(pB, undefined, "Attacker", false, null);
      check("anonymous client-approve → 401 (global session gate), unchanged", r.status === 401 && (await statusOf(pB)).status === "sent", `status=${r.status}`);
      r = await approve(pB);
      check("authenticated cross-tenant client-approve with NO token (id only) → 401, unchanged", r.status === 401 && (await statusOf(pB)).status === "sent", `status=${r.status}`);
      r = await approve(pB, undefined, "Attacker", false, "adminA");
      check("cross-tenant ADMIN client-approve with no token → 401, unchanged", r.status === 401 && (await statusOf(pB)).status === "sent", `status=${r.status}`);
      r = await approve(pB, "0".repeat(64));
      check("client-approve with a WRONG token → 403, unchanged", r.status === 403 && (await statusOf(pB)).status === "sent", `status=${r.status}`);
      r = await approve(pB, tokA);
      check("client-approve with ANOTHER proposal's token → 403, unchanged", r.status === 403 && (await statusOf(pB)).status === "sent", `status=${r.status}`);
      r = await apiRequest(base, "POST", `/api/contractor-proposals/${pB}/client-approve`, S.empA, { approvalName: "X", approvalEmail: "x@example.test", token: tokA });
      check("client-approve with another proposal's token in the BODY → 403", r.status === 403 && (await statusOf(pB)).status === "sent", `status=${r.status}`);
      r = await approve(pX, tokX);
      check("client-approve on a no-longer-public (superseded) proposal → 403 (token no longer valid)", r.status === 403 && (await statusOf(pX)).status === "superseded", `status=${r.status}`);
      r = await approve(pN, "");
      check("client-approve on a proposal that never had a token → 401/403", (r.status === 401 || r.status === 403) && (await statusOf(pN)).status === "sent", `status=${r.status}`);
      r = await approve(pB, tokB, "Client One");
      check("client-approve with the correct token → approved", r.status === 200 && (await statusOf(pB)).status === "approved", `status=${r.status}`);
      r = await approve(pB, tokB, "Replay Person");
      const after = await statusOf(pB);
      check("replay → 409; first approver's name kept", r.status === 409 && after.status === "approved" && after.approval_name === "Client One", `status=${r.status}`);
      r = await approve(pA, tokA, "Portal Client", true);
      check("legitimate portal approval flow still works", r.status === 200 && (await statusOf(pA)).status === "approved", `status=${r.status}`);
      r = await approve(pA, tokA, "Portal Replay", true);
      check("portal approval replay → 409, approver unchanged", r.status === 409 && (await statusOf(pA)).approval_name === "Portal Client", `status=${r.status}`);
    }

    console.log("\n── Legacy company-less bypass: representative Group D routes ──");
    {
      const D: Array<[string, string, unknown?]> = [
        ["GET", `/api/payroll-runs/${R.B1.run}`], ["GET", `/api/payroll-runs/${R.B1.run}/items`],
        ["POST", `/api/payroll-runs/${R.B1.run}/lock`, {}], ["DELETE", `/api/payroll-runs/${R.B1.run}`],
        ["GET", `/api/customers/${R.B1.cust}`], ["PATCH", `/api/time-punches/${R.B1.punch}`, { note: "x" }],
        ["GET", `/api/check-templates?companyId=${B1}`], ["GET", `/api/payroll-payment-records?companyId=${B1}`],
      ];
      const runBefore = await snap("payroll_runs", R.B1.run);
      for (const [m, p, b] of D) {
        const r = await call("noco", m, p, b);
        check(`company-less non-platform → ${m} ${p.split("?")[0].replace(/[0-9a-f-]{36}/g, ":id")} denied`, denied(r.status), `status=${r.status}`);
      }
      check("payroll run untouched by company-less attempts", (await snap("payroll_runs", R.B1.run)) === runBefore);
      const r = await call("adminB", "GET", `/api/payroll-runs/${R.B1.run}`);
      check("tenant B admin still reads own run", r.status === 200, `status=${r.status}`);
    }
  } finally {
    if (server) await server.stop();
    try {
      const likeUsers = `pr2_%_${sfx}`;
      await q(`DELETE FROM company_user_access WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`, [likeUsers]);
      await q(`DELETE FROM session WHERE sess->>'userId' IN (SELECT id FROM users WHERE username LIKE $1)`, [likeUsers]).catch(() => {});
      await q(`DELETE FROM authorization_audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE username LIKE $1)`, [likeUsers]).catch(() => {});
      await q(`DELETE FROM payroll_overrides WHERE payroll_item_id IN (SELECT pi.id FROM payroll_items pi JOIN payroll_runs pr ON pr.id = pi.payroll_run_id WHERE pr.company_id = ANY($1::varchar[]))`, [companyIds]).catch(() => {});
      // A pre-fix server lets the company-less user void/reprint checks, which writes
      // audit rows referencing that user — remove them so cleanup works on any baseline.
      await q(`DELETE FROM check_print_audit_logs WHERE initiated_by_user_id IN (SELECT id FROM users WHERE username LIKE $1)`, [likeUsers]).catch(() => {});
      await q(`DELETE FROM users WHERE username LIKE $1`, [likeUsers]);
      await q(`DELETE FROM system_documents WHERE id = ANY($1::varchar[]) OR title LIKE $2`, [sysDocIds, `ZZPR2-%-${sfx}`]);
      await cascadeDelete(pool, "companies", companyIds);
      await q(`DELETE FROM tenants WHERE id = ANY($1::varchar[])`, [[tA, tB]]);
      await q(`DELETE FROM enterprises WHERE id = $1`, [ES]);
      const residue = [...(await verifyZeroResidue(pool, "companies", companyIds))];
      const stray = (await q(`SELECT
          (SELECT count(*) FROM users WHERE username LIKE $1)::int u,
          (SELECT count(*) FROM tenants WHERE id = ANY($2::varchar[]))::int t,
          (SELECT count(*) FROM enterprises WHERE id = $3)::int e,
          (SELECT count(*) FROM system_documents WHERE title LIKE $4)::int sd,
          (SELECT count(*) FROM pay_methods WHERE account_number LIKE $4)::int pm`,
        [likeUsers, [tA, tB], ES, `ZZPR2-%-${sfx}`])).rows[0];
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
