/** Static guards for the emergency contact step (PR 5). No database. */
import fs from "node:fs";
let passed = 0, failed = 0;
const check = (n: string, ok: boolean) => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.error(`  ✗ ${n}`); } };
const svc = fs.readFileSync("server/contractor-onboarding/emergency-contact.ts", "utf8");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const block = (s: string, len = 1500) => { const i = routes.indexOf(s); return i < 0 ? "" : routes.slice(i, i + len); };
check("reuses employee_contacts + workers mirror (no new table)", /INSERT INTO employee_contacts/.test(svc) && /UPDATE workers SET emergency_contact_name/.test(svc) && !/CREATE TABLE/i.test(svc));
check("one transaction, serialized per worker, worker re-checked in the company", /db\.transaction/.test(svc) && /pg_advisory_xact_lock\(hashtext\(\$\{`emergency-contact:\$\{workerId\}`\}\)\)/.test(svc) && /FROM workers WHERE id = \$\{workerId\} AND company_id = \$\{companyId\} FOR UPDATE/.test(svc));
check("audit carries no contact values", /after_json\)[\s\S]{0,400}JSON\.stringify\(\{ hasEmail: !!value\.email \}\)/.test(svc));
check("PUT takes company + worker from the session (CSRF)", /app\.put\("\/api\/my-onboarding\/emergency-contact", requireAuth, requireCsrfToken/.test(routes) && /companyId: me\.companyId, workerId: me\.workerId/.test(block('app.put("/api/my-onboarding/emergency-contact"')));
check("admin read uses same-company private-data rule", /canAccessWorkerPrivateDocs/.test(block('app.get("/api/contractor-onboarding/:id/emergency-contact"')));
check("responses are no-store", /no-store/.test(block('app.get("/api/my-onboarding/emergency-contact"')) && /no-store/.test(block('app.get("/api/contractor-onboarding/:id/emergency-contact"')));
console.log(`\nemergency contact static: ${passed} passed${failed ? `, ${failed} failed` : ""}`);
process.exit(failed ? 1 : 0);
