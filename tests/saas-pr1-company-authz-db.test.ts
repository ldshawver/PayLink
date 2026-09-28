/**
 * SaaS PR 1 — company authorization + organization ownership (real HTTP, DB).
 *
 * Proves, against the real server and a disposable database:
 *  - canAccessCompany(): no enterprise-sibling bypass, no NULL-company bypass;
 *    own company + explicit company_user_access grants + listed platform roles only.
 *  - The audit's enterprise-hop takeover chain fails at every step, including
 *    when a victim-enterprise link already exists in the data.
 *  - PATCH /api/companies/:id enforces the tenant field allowlist (enterpriseId,
 *    subscription/billing/demo/trial are platform-controlled).
 *  - Legal entities, departments, branches, divisions, positions, cost centers,
 *    jobs: list scoping; create never trusts a foreign companyId; update/delete
 *    authorize the STORED owner; universal rows are platform-only; no re-parenting.
 *  - Enterprises are platform-controlled.
 *  - GET /api/workers?scheduling=true returns only a minimal projection within the
 *    actor's scheduling scope; cross-company scheduling within an enterprise still works
 *    without granting general access to the sibling company.
 *
 * Fixture: Tenant A (A1, A2), Tenant B (B1), legacy untenanted victim V (enterprise EV,
 * the production shape), and an untenanted enterprise S (S1, S2) for scheduling.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/saas-pr1-company-authz-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { startTestServer, login, apiRequest, type TestServer } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

let passed = 0, failed = 0;
const errors: string[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); errors.push(name); failed++; }
};
const json = (b: unknown) => JSON.stringify(b ?? "");
const idsOf = (b: unknown) => (Array.isArray(b) ? (b as any[]).map((r) => r.id) : []);

type OrgKind = { name: string; path: string; table: string; nameCol: string; bodyName: string; listsUniversal: boolean };
const ORG: OrgKind[] = [
  { name: "departments", path: "/api/departments", table: "departments", nameCol: "name", bodyName: "name", listsUniversal: true },
  { name: "branches", path: "/api/branches", table: "branches", nameCol: "name", bodyName: "name", listsUniversal: true },
  { name: "divisions", path: "/api/divisions", table: "divisions", nameCol: "name", bodyName: "name", listsUniversal: true },
  { name: "positions", path: "/api/positions", table: "positions", nameCol: "title", bodyName: "title", listsUniversal: true },
  { name: "cost centers", path: "/api/cost-centers", table: "cost_centers", nameCol: "name", bodyName: "name", listsUniversal: true },
  { name: "jobs", path: "/api/jobs", table: "jobs", nameCol: "name", bodyName: "name", listsUniversal: false },
  { name: "legal entities", path: "/api/legal-entities", table: "legal_entities", nameCol: "legal_name", bodyName: "legalName", listsUniversal: false },
];

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log("TEST_DATABASE_URL not set — skipping saas-pr1-company-authz tests (0 run).");
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
  const [A1, A2, B1, V, S1, S2] = [uid(), uid(), uid(), uid(), uid(), uid()];
  const companyIds = [A1, A2, B1, V, S1, S2];
  const [tA, tB] = [uid(), uid()];
  const [EB, EV, ES] = [uid(), uid(), uid()];
  const universalIds: Record<string, string> = {};
  const extraLegalEntityIds: string[] = [];
  let server: TestServer | undefined;

  try {
    await q(`INSERT INTO enterprises (id,name) VALUES ($1,$2),($3,$4),($5,$6)`,
      [EB, `PR1 Ent B ${sfx}`, EV, `PR1 Ent Victim ${sfx}`, ES, `PR1 Ent Sched ${sfx}`]);
    await q(`INSERT INTO companies (id,name,subscription_status,enterprise_id,is_demo) VALUES
      ($1,$7,'active_paid',NULL,false),($2,$8,'active_paid',NULL,false),($3,$9,'active_paid',$13,false),
      ($4,$10,'active_paid',$14,false),($5,$11,'active_paid',$15,false),($6,$12,'active_paid',$15,false)`,
      [A1, A2, B1, V, S1, S2, `PR1 A1 ${sfx}`, `PR1 A2 ${sfx}`, `PR1 B1 ${sfx}`, `PR1 Victim ${sfx}`, `PR1 S1 ${sfx}`, `PR1 S2 ${sfx}`, EB, EV, ES]);
    await q(`INSERT INTO tenants (id,name,slug,status) VALUES ($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [tA, `PR1 Tenant A ${sfx}`, `pr1-a-${sfx}`, tB, `PR1 Tenant B ${sfx}`, `pr1-b-${sfx}`]);
    await q(`INSERT INTO tenant_companies (tenant_id,company_id,is_primary) VALUES ($1,$2,true),($1,$3,false),($4,$5,true)`, [tA, A1, A2, tB, B1]);

    const workers: Record<string, string> = {};
    for (const [key, co, ssn] of [["A1", A1, "900-00-0001"], ["A2", A2, "900-00-0002"], ["B1", B1, "900-00-0003"],
      ["V", V, "900-00-0004"], ["S1", S1, "900-00-0005"], ["S2", S2, "900-00-0006"]] as const) {
      const id = uid(); workers[key] = id;
      await q(`INSERT INTO workers (id,company_id,first_name,last_name,worker_type,pay_rate,pay_type,ssn,address)
        VALUES ($1,$2,$3,'Fixture','contractor','41.00','hourly',$4,'1 Private Lane')`, [id, co, `PR1${key}`, ssn]);
    }

    const pw = await bcrypt.hash("Pr1!Synthetic", 10);
    const users: Record<string, string> = {};
    const mkUser = async (key: string, role: string, companyId: string | null, workerId: string | null = null) => {
      const id = uid(); users[key] = id;
      await q(`INSERT INTO users (id,username,password,role,company_id,worker_id,is_active) VALUES ($1,$2,$3,$4,$5,$6,true)`,
        [id, `pr1_${key}_${sfx}`, pw, role, companyId, workerId]);
    };
    await mkUser("psa", "platform_super_admin", null);
    await mkUser("adminA", "admin", A1);          // tenant admin with explicit grant to A2
    await mkUser("a1only", "manager", A1);        // A1-only user
    await mkUser("empA", "employee", A1, workers.A1);
    await mkUser("noco", "admin", null);          // companyless non-platform, no grants
    await mkUser("nocoGranted", "admin", null);   // companyless non-platform, explicit grant to A2
    await mkUser("adminB", "admin", B1);
    await mkUser("schedS1", "manager", S1);       // scheduler in untenanted enterprise S
    await q(`INSERT INTO company_user_access (user_id,company_id,role,is_default_company,is_active,worker_type)
      VALUES ($1,$2,'admin',false,true,'manager'),($3,$2,'admin',false,true,'manager')`, [users.adminA, A2, users.nocoGranted]);

    // Org rows: one per company in A1, A2, B1 + one universal, per resource.
    const rows: Record<string, Record<string, string>> = {};
    for (const k of ORG) {
      rows[k.name] = {};
      for (const [co, cid] of [["A1", A1], ["A2", A2], ["B1", B1], ["U", null]] as const) {
        const id = uid(); rows[k.name][co] = id;
        await q(`INSERT INTO ${k.table} (id, company_id, ${k.nameCol}) VALUES ($1,$2,$3)`, [id, cid, `PR1-${k.table}-${co}-${sfx}`]);
        if (cid === null) universalIds[k.table] = id;
      }
    }
    await q(`UPDATE legal_entities SET ein='98-7654321' WHERE id=$1`, [rows["legal entities"].B1]);

    server = await startTestServer(url);
    const base = server.baseUrl;
    const S: Record<string, any> = {};
    for (const k of Object.keys(users)) S[k] = await login(base, `pr1_${k}_${sfx}`, "Pr1!Synthetic");
    const call = (who: string, m: string, p: string, b?: unknown) => apiRequest(base, m, p, S[who], b);
    const nameOf = async (k: OrgKind, id: string) => (await q(`SELECT ${k.nameCol} AS v, company_id FROM ${k.table} WHERE id=$1`, [id])).rows[0];

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── Organization resources ──");
    for (const k of ORG) {
      const R = rows[k.name];
      const tag = (s: string) => `[${k.name}] ${s}`;

      let r = await call("adminA", "GET", k.path);
      const listed = idsOf(r.body);
      check(tag("A LIST own company rows"), r.status === 200 && listed.includes(R.A1), `status=${r.status}`);
      check(tag("A LIST no Tenant B leakage"), !listed.includes(R.B1) && !json(r.body).includes("98-7654321"));
      check(tag("A LIST default does not include sibling A2"), !listed.includes(R.A2));
      check(tag(`A LIST universal rows ${k.listsUniversal ? "included (existing behaviour)" : "not included (existing behaviour)"}`), listed.includes(R.U) === k.listsUniversal);

      r = await call("adminA", "GET", `${k.path}?companyId=${B1}`);
      check(tag("A LIST ?companyId=B1 → 403"), r.status === 403, `status=${r.status}`);
      r = await call("adminA", "GET", `${k.path}?companyId=${A2}`);
      check(tag("explicit grant: A LIST ?companyId=A2 works"), r.status === 200 && idsOf(r.body).includes(R.A2), `status=${r.status}`);
      r = await call("a1only", "GET", `${k.path}?companyId=${A2}`);
      check(tag("A1-only GET A2 → 403"), r.status === 403, `status=${r.status}`);

      // A → B
      r = await call("adminA", "PATCH", `${k.path}/${R.B1}`, { [k.bodyName]: "pwned" });
      let row = await nameOf(k, R.B1);
      check(tag("A → B PATCH denied, DB unchanged"), r.status === 404 && row.v === `PR1-${k.table}-B1-${sfx}` && row.company_id === B1, `status=${r.status}`);
      r = await call("adminA", "PATCH", `${k.path}/${R.B1}`, { [k.bodyName]: "pwned", companyId: A1 });
      row = await nameOf(k, R.B1);
      check(tag("A → B PATCH with own companyId in body still denied"), r.status === 404 && row.company_id === B1, `status=${r.status}`);
      r = await call("adminA", "DELETE", `${k.path}/${R.B1}`);
      check(tag("A → B DELETE denied, row kept"), r.status === 404 && !!(await nameOf(k, R.B1)), `status=${r.status}`);
      const injName = `PR1-inject-${k.table}-${sfx}`;
      r = await call("adminA", "POST", k.path, { [k.bodyName]: injName, companyId: B1 });
      let inj = (await q(`SELECT company_id FROM ${k.table} WHERE ${k.nameCol}=$1`, [injName])).rows;
      check(tag("A → B POST with B companyId → 403, nothing inserted"), r.status === 403 && inj.length === 0, `status=${r.status}`);

      // A1-only → A2
      r = await call("a1only", "PATCH", `${k.path}/${R.A2}`, { [k.bodyName]: "a1-was-here" });
      check(tag("A1-only → A2 PATCH denied"), r.status === 404 && (await nameOf(k, R.A2)).v === `PR1-${k.table}-A2-${sfx}`, `status=${r.status}`);
      r = await call("a1only", "DELETE", `${k.path}/${R.A2}`);
      check(tag("A1-only → A2 DELETE denied"), r.status === 404 && !!(await nameOf(k, R.A2)), `status=${r.status}`);
      r = await call("a1only", "POST", k.path, { [k.bodyName]: `${injName}-a2`, companyId: A2 });
      inj = (await q(`SELECT 1 FROM ${k.table} WHERE ${k.nameCol}=$1`, [`${injName}-a2`])).rows;
      check(tag("A1-only → A2 POST → 403"), r.status === 403 && inj.length === 0, `status=${r.status}`);

      // Universal rows
      r = await call("adminA", "PATCH", `${k.path}/${R.U}`, { [k.bodyName]: "tenant-edit" });
      check(tag("tenant PATCH universal row → 403"), r.status === 403 && (await nameOf(k, R.U)).v === `PR1-${k.table}-U-${sfx}`, `status=${r.status}`);
      r = await call("adminA", "DELETE", `${k.path}/${R.U}`);
      check(tag("tenant DELETE universal row → 403"), r.status === 403 && !!(await nameOf(k, R.U)), `status=${r.status}`);

      // Companyless
      r = await call("noco", "GET", k.path);
      check(tag("companyless LIST → []"), r.status === 200 && idsOf(r.body).length === 0, `status=${r.status} n=${idsOf(r.body).length}`);
      r = await call("noco", "GET", `${k.path}?companyId=${B1}`);
      check(tag("companyless LIST ?companyId=B1 → 403"), r.status === 403, `status=${r.status}`);
      r = await call("noco", "PATCH", `${k.path}/${R.A1}`, { [k.bodyName]: "noco" });
      check(tag("companyless PATCH A row denied"), r.status === 404, `status=${r.status}`);
      r = await call("noco", "POST", k.path, { [k.bodyName]: `${injName}-noco`, companyId: B1 });
      check(tag("companyless POST into B → 403"), r.status === 403, `status=${r.status}`);
      r = await call("nocoGranted", "GET", `${k.path}?companyId=${A2}`);
      check(tag("companyless WITH explicit grant: LIST A2 works"), r.status === 200 && idsOf(r.body).includes(R.A2), `status=${r.status}`);

      // Positive: own company + explicit grant
      r = await call("adminA", "PATCH", `${k.path}/${R.A1}`, { [k.bodyName]: `PR1-${k.table}-A1-renamed-${sfx}` });
      row = await nameOf(k, R.A1);
      check(tag("own PATCH works and company_id is NOT nulled"), r.status === 200 && row.company_id === A1 && row.v.includes("renamed"), `status=${r.status} company=${row?.company_id}`);
      r = await call("adminA", "PATCH", `${k.path}/${R.A1}`, { companyId: null });
      check(tag("own row cannot be re-parented to universal"), r.status === 403 && (await nameOf(k, R.A1)).company_id === A1, `status=${r.status}`);
      r = await call("adminA", "PATCH", `${k.path}/${R.A2}`, { [k.bodyName]: `PR1-${k.table}-A2-granted-${sfx}` });
      check(tag("explicit grant: A PATCH A2 row works"), r.status === 200 && (await nameOf(k, R.A2)).company_id === A2, `status=${r.status}`);
      const ownName = `PR1-own-${k.table}-${sfx}`;
      r = await call("adminA", "POST", k.path, { [k.bodyName]: ownName, companyId: "__universal__" });
      const own = (await q(`SELECT id, company_id FROM ${k.table} WHERE ${k.nameCol}=$1`, [ownName])).rows[0];
      check(tag("tenant POST with universal default → pinned to OWN company (never NULL)"), r.status === 201 && own?.company_id === A1, `status=${r.status} company=${own?.company_id}`);
      if (own) {
        r = await call("adminA", "DELETE", `${k.path}/${own.id}`);
        check(tag("own DELETE works"), r.status === 200 && (await q(`SELECT 1 FROM ${k.table} WHERE id=$1`, [own.id])).rows.length === 0, `status=${r.status}`);
      }

      // Platform admin (intentional)
      r = await call("psa", "GET", k.path);
      check(tag("platform admin LIST sees all companies"), r.status === 200 && idsOf(r.body).includes(R.B1) && idsOf(r.body).includes(R.A1));
      r = await call("psa", "PATCH", `${k.path}/${R.U}`, { [k.bodyName]: `PR1-${k.table}-U-platform-${sfx}` });
      check(tag("platform admin may manage universal row"), r.status === 200 && (await nameOf(k, R.U)).company_id === null, `status=${r.status}`);
      r = await call("adminB", "GET", k.path);
      check(tag("Tenant B unaffected: B lists own row, not A"), r.status === 200 && idsOf(r.body).includes(R.B1) && !idsOf(r.body).includes(R.A1));
    }

    console.log("\n── Cross-company references ──");
    let r = await call("adminA", "POST", "/api/departments", { name: `PR1-xref-${sfx}`, divisionId: rows["divisions"].B1 });
    check("department referencing Tenant B division → 400", r.status === 400, `status=${r.status}`);
    r = await call("adminA", "POST", "/api/departments", { name: `PR1-xref-mgr-${sfx}`, managerId: workers.B1 });
    check("department with Tenant B worker as manager → 400", r.status === 400, `status=${r.status}`);
    r = await call("adminA", "POST", "/api/positions", { title: `PR1-xref-pos-${sfx}`, departmentId: rows["departments"].U });
    const xp = (await q(`SELECT id FROM positions WHERE title=$1`, [`PR1-xref-pos-${sfx}`])).rows[0];
    check("position referencing a universal department is allowed", r.status === 201 && !!xp, `status=${r.status}`);

    console.log("\n── Legal-entity sensitivity ──");
    r = await call("empA", "GET", "/api/legal-entities");
    check("employee GET /api/legal-entities → 403", r.status === 403, `status=${r.status}`);
    r = await call("a1only", "GET", "/api/legal-entities");
    check("A1 manager sees no Tenant B EIN", r.status === 200 && !json(r.body).includes("98-7654321"));

    console.log("\n── Enterprises (platform-controlled) ──");
    r = await call("adminA", "GET", "/api/enterprises");
    check("tenant GET enterprises lists no foreign enterprise ids", r.status === 200 && ![EB, EV, ES].some((e) => json(r.body).includes(e)));
    r = await call("adminA", "POST", "/api/enterprises", { name: `PR1-ent-${sfx}` });
    check("tenant POST enterprise → 403", r.status === 403, `status=${r.status}`);
    r = await call("a1only", "PATCH", `/api/enterprises/${EB}`, { name: "pwned" });
    check("tenant PATCH enterprise → 403, unchanged", r.status === 403 && (await q(`SELECT name FROM enterprises WHERE id=$1`, [EB])).rows[0].name === `PR1 Ent B ${sfx}`, `status=${r.status}`);
    r = await call("adminA", "DELETE", `/api/enterprises/${EV}`);
    check("tenant DELETE enterprise → 403", r.status === 403 && (await q(`SELECT 1 FROM enterprises WHERE id=$1`, [EV])).rows.length === 1, `status=${r.status}`);
    r = await call("psa", "PATCH", `/api/enterprises/${ES}`, { name: `PR1 Ent Sched ${sfx}` });
    check("platform admin PATCH enterprise works", r.status === 200, `status=${r.status}`);

    console.log("\n── Company control fields ──");
    const coRow = async (id: string) => (await q(`SELECT name, enterprise_id, subscription_status, is_demo, billing_active FROM companies WHERE id=$1`, [id])).rows[0];
    for (const [label, body] of [
      ["enterpriseId", { enterpriseId: EV }],
      ["subscriptionStatus", { subscriptionStatus: "trial_active" }],
      ["isDemo", { isDemo: true }],
      ["billingActive", { billingActive: true }],
      ["trialEnd", { trialEnd: "2099-01-01T00:00:00Z" }],
      ["planName", { planName: "enterprise" }],
    ] as const) {
      r = await call("a1only", "PATCH", `/api/companies/${A1}`, { name: `PR1 A1 ${sfx}`, ...body });
      const c = await coRow(A1);
      check(`tenant PATCH company ${label} → 403, nothing written`, r.status === 403 && c.enterprise_id === null && c.subscription_status === "active_paid" && c.is_demo === false && c.billing_active !== true, `status=${r.status}`);
    }
    r = await call("adminA", "PATCH", `/api/companies/${A1}`, { name: `PR1 A1 renamed ${sfx}`, timezone: "America/Chicago" });
    check("tenant PATCH allowlisted company fields works", r.status === 200 && (await coRow(A1)).name === `PR1 A1 renamed ${sfx}`, `status=${r.status}`);
    const fullA1 = (await call("adminA", "GET", `/api/companies/${A1}`)).body as any;
    r = await call("adminA", "PATCH", `/api/companies/${A1}`, { ...fullA1, name: `PR1 A1 ${sfx}` });
    check("settings-form echo of the whole company object still saves", r.status === 200, `status=${r.status} ${json(r.body).slice(0, 160)}`);
    r = await call("adminA", "PATCH", `/api/companies/${A1}`, { legalEntityId: rows["legal entities"].B1 });
    check("tenant cannot point company at another tenant's legal entity", r.status === 403, `status=${r.status}`);
    r = await call("adminA", "PATCH", `/api/companies/${B1}`, { name: "pwned" });
    check("tenant PATCH another tenant's company → 403", r.status === 403 && (await coRow(B1)).name === `PR1 B1 ${sfx}`, `status=${r.status}`);
    r = await call("noco", "PATCH", `/api/companies/${B1}`, { name: "pwned" });
    check("companyless PATCH company → 403 (previously allowed)", r.status === 403 && (await coRow(B1)).name === `PR1 B1 ${sfx}`, `status=${r.status}`);
    r = await call("noco", "GET", `/api/companies/${B1}`);
    check("companyless GET company → 403 (previously allowed)", r.status === 403, `status=${r.status}`);
    r = await call("adminA", "POST", "/api/companies", { name: `PR1 rogue ${sfx}`, enterpriseId: EV });
    check("tenant POST /api/companies → 403", r.status === 403 && (await q(`SELECT 1 FROM companies WHERE name=$1`, [`PR1 rogue ${sfx}`])).rows.length === 0, `status=${r.status}`);
    r = await call("psa", "PATCH", `/api/companies/${B1}`, { isDemo: false, name: `PR1 B1 ${sfx}` });
    check("platform admin may PATCH control fields", r.status === 200, `status=${r.status}`);

    console.log("\n── Enterprise takeover chain (audit reproduction) ──");
    r = await call("adminA", "GET", "/api/enterprises");
    check("1. attacker cannot discover victim enterprise id", !json(r.body).includes(EV));
    r = await call("adminA", "PATCH", `/api/companies/${A1}`, { enterpriseId: EV });
    check("2. attacker cannot associate own company with victim enterprise", r.status === 403 && (await coRow(A1)).enterprise_id === null, `status=${r.status}`);
    // Worst case: assume the link already exists in data (e.g. set before this fix).
    await q(`UPDATE companies SET enterprise_id=$1 WHERE id=$2`, [EV, A1]);
    r = await call("adminA", "GET", "/api/companies");
    const vEntry = (Array.isArray(r.body) ? (r.body as any[]) : []).find((c) => c.id === V);
    check("3. even when linked, victim company is not returned as a full record", !vEntry || (vEntry.schedulingOnly === true && vEntry.ein === undefined && vEntry.subscriptionStatus === undefined));
    r = await call("adminA", "GET", `/api/companies/${V}`);
    check("3b. GET victim company → 403", r.status === 403, `status=${r.status}`);
    r = await call("adminA", "GET", `/api/contractors?companyId=${V}`);
    check("4. victim worker data via canAccessCompany route → 403", r.status === 403 && !json(r.body).includes("900-00-0004"), `status=${r.status}`);
    r = await call("adminA", "POST", "/api/users", { username: `pr1_implant_${sfx}`, password: "Implant!Pass1", role: "admin", companyId: V });
    const implant = (await q(`SELECT 1 FROM users WHERE username=$1`, [`pr1_implant_${sfx}`])).rows.length;
    check("5. POST /api/users admin INTO victim company → 403, no user", r.status === 403 && implant === 0, `status=${r.status}`);
    r = await call("adminA", "PATCH", `/api/companies/${V}`, { name: "owned" });
    check("6. administrative PATCH of victim company → 403", r.status === 403, `status=${r.status}`);
    r = await call("adminA", "PATCH", `/api/departments/${rows["departments"].B1}`, { name: "owned" });
    check("7. victim-side org write still denied", r.status === 404, `status=${r.status}`);
    await q(`UPDATE companies SET enterprise_id=NULL WHERE id=$1`, [A1]);
    r = await call("adminA", "GET", `/api/contractors?companyId=${B1}`);
    check("tenanted victim (Tenant B) contractors → 403", r.status === 403, `status=${r.status}`);

    console.log("\n── canAccessCompany: companyless / explicit grant / platform ──");
    r = await call("noco", "GET", `/api/contractors?companyId=${B1}`);
    check("companyless → Tenant B contractors → 403 (previously 200)", r.status === 403, `status=${r.status}`);
    r = await call("noco", "GET", `/api/contractors?companyId=${A1}`);
    check("companyless → Tenant A contractors → 403", r.status === 403, `status=${r.status}`);
    r = await call("nocoGranted", "GET", `/api/contractors?companyId=${A2}`);
    check("companyless WITH explicit grant → granted company works", r.status === 200 && json(r.body).includes(workers.A2), `status=${r.status}`);
    r = await call("adminA", "GET", `/api/contractors?companyId=${A2}`);
    check("same-tenant multi-company via explicit grant works", r.status === 200 && json(r.body).includes(workers.A2), `status=${r.status}`);
    r = await call("a1only", "GET", `/api/contractors?companyId=${A2}`);
    check("same tenant WITHOUT grant → 403", r.status === 403, `status=${r.status}`);
    r = await call("psa", "GET", `/api/contractors?companyId=${B1}`);
    check("platform admin → any company works", r.status === 200 && json(r.body).includes(workers.B1), `status=${r.status}`);
    r = await call("noco", "POST", "/api/users", { username: `pr1_noco_implant_${sfx}`, password: "Implant!Pass1", role: "admin", companyId: B1 });
    check("companyless POST /api/users into B → 403", r.status === 403, `status=${r.status}`);

    console.log("\n── Cross-company scheduling ──");
    const hasSensitive = (b: unknown) => /900-00-000|1 Private Lane|"ssn"|"address"/.test(json(b));
    r = await call("a1only", "GET", "/api/workers?scheduling=true");
    let ids = idsOf(r.body);
    check("A1 manager picker: own workers only", r.status === 200 && ids.includes(workers.A1) && !ids.includes(workers.B1) && !ids.includes(workers.V) && !ids.includes(workers.A2), `ids=${ids.length}`);
    check("A1 manager picker: no SSN/address/private fields", !hasSensitive(r.body));
    check("A1 manager picker: payRate kept for own company (labor cost)", (r.body as any[]).find((w) => w.id === workers.A1)?.payRate === "41.00");
    r = await call("adminA", "GET", "/api/workers?scheduling=true");
    ids = idsOf(r.body);
    check("A admin picker: own + explicitly granted A2, never B/V", ids.includes(workers.A1) && ids.includes(workers.A2) && !ids.includes(workers.B1) && !ids.includes(workers.V));
    r = await call("schedS1", "GET", "/api/workers?scheduling=true");
    ids = idsOf(r.body);
    const s2 = (r.body as any[]).find((w) => w.id === workers.S2);
    check("enterprise scheduler picker: own + enterprise sibling S2, no other tenants", ids.includes(workers.S1) && !!s2 && !ids.includes(workers.A1) && !ids.includes(workers.B1));
    check("enterprise sibling projection has no payRate / SSN / address", !!s2 && s2.payRate === undefined && !hasSensitive(r.body));
    r = await call("schedS1", "GET", "/api/companies");
    const s2co = (Array.isArray(r.body) ? (r.body as any[]) : []).find((c) => c.id === S2);
    check("sibling company listed only as scheduling projection", !!s2co && s2co.schedulingOnly === true && s2co.ein === undefined && s2co.subscriptionStatus === undefined);
    const day = "2031-03-04";
    r = await call("schedS1", "POST", "/api/schedules", { workerId: workers.S1, companyId: S2, date: day, startTime: "09:00", endTime: "17:00" });
    check("cross-company schedule within enterprise still works", r.status === 201, `status=${r.status} ${json(r.body).slice(0, 120)}`);
    r = await call("schedS1", "POST", "/api/schedules", { workerId: workers.S1, companyId: B1, date: day, startTime: "09:00", endTime: "17:00" });
    check("schedule into another tenant's company → 403", r.status === 403, `status=${r.status}`);
    r = await call("schedS1", "POST", "/api/schedules", { workerId: workers.B1, companyId: S1, date: day, startTime: "09:00", endTime: "17:00" });
    check("scheduling another tenant's worker → 400", r.status === 400, `status=${r.status}`);
    r = await call("schedS1", "GET", `/api/contractors?companyId=${S2}`);
    check("enterprise sibling grants NO general access (contractors → 403)", r.status === 403, `status=${r.status}`);
    r = await call("schedS1", "POST", "/api/users", { username: `pr1_sib_implant_${sfx}`, password: "Implant!Pass1", role: "admin", companyId: S2 });
    check("enterprise sibling grants NO user provisioning (POST /api/users → 403)", r.status === 403, `status=${r.status}`);
    r = await call("schedS1", "PATCH", `/api/companies/${S2}`, { name: "x" });
    check("enterprise sibling grants NO company administration", r.status === 403, `status=${r.status}`);
    r = await call("psa", "GET", "/api/workers?scheduling=true");
    check("platform picker returns projection (no SSN)", r.status === 200 && idsOf(r.body).includes(workers.B1) && !hasSensitive(r.body));
    r = await call("empA", "GET", "/api/workers?scheduling=true");
    check("employee picker still self-only", r.status === 200 && idsOf(r.body).length === 1 && idsOf(r.body)[0] === workers.A1);

    console.log("\n── effective-access reflects the corrected rules ──");
    r = await call("schedS1", "GET", "/api/auth/effective-access");
    const ea = r.body as any;
    check("effective-access: sibling in scheduling scope only, not accessibleCompanyIds",
      r.status === 200 && ea.isPlatformAdmin === false && !ea.accessibleCompanyIds.includes(S2) && ea.schedulingCompanyIds.includes(S2), `status=${r.status}`);
    r = await call("noco", "GET", "/api/auth/effective-access");
    check("effective-access: companyless user is NOT reported as platform admin", r.status === 200 && (r.body as any).isPlatformAdmin === false, `status=${r.status}`);
  } finally {
    if (server) await server.stop();
    try {
      const likeUsers = `pr1_%_${sfx}`;
      await q(`DELETE FROM schedules WHERE company_id = ANY($1::varchar[])`, [companyIds]).catch(() => {});
      await q(`DELETE FROM company_user_access WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`, [likeUsers]);
      await q(`DELETE FROM session WHERE sess->>'userId' IN (SELECT id FROM users WHERE username LIKE $1)`, [likeUsers]).catch(() => {});
      await q(`DELETE FROM users WHERE username LIKE $1`, [likeUsers]);
      for (const k of ORG) {
        await q(`DELETE FROM ${k.table} WHERE ${k.nameCol} LIKE $1`, [`PR1-%${sfx}%`]);
        await q(`DELETE FROM ${k.table} WHERE company_id = ANY($1::varchar[])`, [companyIds]);
      }
      for (const id of Object.values(universalIds)) await q(`DELETE FROM ${Object.keys(universalIds).find((t) => universalIds[t] === id)} WHERE id=$1`, [id]);
      for (const id of extraLegalEntityIds) await q(`DELETE FROM legal_entities WHERE id=$1`, [id]);
      await cascadeDelete(pool, "companies", companyIds);
      await q(`DELETE FROM tenants WHERE id = ANY($1::varchar[])`, [[tA, tB]]);
      await q(`DELETE FROM enterprises WHERE id = ANY($1::varchar[])`, [[EB, EV, ES]]);
      const residue = [...(await verifyZeroResidue(pool, "companies", companyIds))];
      const stray = (await q(`SELECT
          (SELECT count(*) FROM users WHERE username LIKE $1)::int u,
          (SELECT count(*) FROM tenants WHERE id = ANY($2::varchar[]))::int t,
          (SELECT count(*) FROM enterprises WHERE id = ANY($3::varchar[]))::int e,
          (SELECT count(*) FROM departments WHERE name LIKE $4)::int d,
          (SELECT count(*) FROM legal_entities WHERE legal_name LIKE $4)::int l`,
        [likeUsers, [tA, tB], [EB, EV, ES], `PR1-%${sfx}%`])).rows[0];
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
