/**
 * Static guards for the per-company YYNN allocator (migration 0041).
 * No database. Run: npx tsx tests/employee-number-allocator-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const sqlText = fs.readFileSync("migrations/0041_employee_number_counters.sql", "utf8");
const code = sqlText.replace(/--.*$/gm, "");
const mod = fs.readFileSync("server/employee-numbers.ts", "utf8");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const access = fs.readFileSync("server/identity/contractor-access-requests.ts", "utf8");
const postWorkers = routes.slice(routes.indexOf('app.post("/api/workers"'), routes.indexOf('app.patch("/api/workers/:id"'));

let pass = 0, fail = 0;
function t(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

t("0041 is one transaction, owner-guarded, requires 0037, ledger version 0041", () => {
  assert.match(code, /^BEGIN;/m);
  assert.match(code, /^COMMIT;/m);
  assert.match(code, /IF app_owner <> current_user THEN/);
  assert.match(code, /apply 0037 first/);
  assert.match(code, /INSERT INTO paylink_migrations\.applied[\s\S]*'0041'[\s\S]*ON CONFLICT \(version\) DO NOTHING/);
});

t("0041 is additive: counter table, seed, unique index, duplicate precheck; no DROP/TRUNCATE/DELETE/RENAME", () => {
  assert.match(code, /CREATE TABLE IF NOT EXISTS employee_number_counters/);
  assert.match(code, /ON CONFLICT \(company_id, year_prefix\) DO NOTHING/);
  assert.match(code, /CREATE UNIQUE INDEX IF NOT EXISTS uq_workers_company_employee_number/);
  assert.match(code, /duplicate \(company_id, employee_number\) pairs exist/);
  assert.doesNotMatch(code, /\b(DROP|TRUNCATE|DELETE FROM|RENAME)\b/i);
});

t("0041 executable SQL does not hash PINs or create sign-in tables", () => {
  assert.doesNotMatch(code, /pin_hash|pgcrypto|gen_salt|company_signin|kiosk|signin_event|crypt\(/i);
});

t("allocator locks the counter when the table exists and falls back to an advisory lock", () => {
  assert.match(mod, /export async function allocateEmployeeNumber/);
  assert.match(mod, /export class EmployeeNumberExhaustedError/);
  assert.match(mod, /to_regclass\('public\.employee_number_counters'\)/);
  assert.match(mod, /pg_advisory_xact_lock/);
  assert.match(mod, /FOR UPDATE/);
  assert.match(mod, /throw new EmployeeNumberExhaustedError/);
});

t("allocator module has no PIN or sign-in code", () => {
  assert.doesNotMatch(mod, /pin_hash|pinHash|bcrypt|company_signin|signin_code|preparePinFields|verifyWorkerPin/);
});

t("POST /api/workers allocates inside the insert transaction and no longer scans for highest+1 / 1001", () => {
  assert.match(postWorkers, /db\.transaction\(async \(tx\) => \{[\s\S]*allocateEmployeeNumber\(tx as any, values\.companyId\)[\s\S]*tx\.insert\(workers\)/);
  assert.doesNotMatch(postWorkers, /storage\.getWorkers\(req\.body\.companyId\)/);
  assert.doesNotMatch(postWorkers, /1001/);
  assert.match(postWorkers, /EmployeeNumberExhaustedError/);
  assert.match(postWorkers, /isEmployeeNumberConflict/);
});

t("contractor access approval allocates with the same helper", () => {
  assert.match(access, /allocateEmployeeNumber\(tx as any, companyId\)/);
  assert.doesNotMatch(access, /1001/);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
