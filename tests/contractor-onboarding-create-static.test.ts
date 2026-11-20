/**
 * Contractor onboarding PR 1 — static wiring guards (no DB, no network).
 * Pins the security-relevant shape of POST/GET /api/contractor-onboarding and
 * the create service so a later edit cannot quietly loosen them.
 */
import fs from "node:fs";
import { normalizeCreateInput, CONTRACTOR_ONBOARDING_STEPS } from "../server/contractor-onboarding/create";

let passed = 0, failed = 0;
const check = (n: string, ok: boolean) => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.error(`  ✗ ${n}`); } };
const routes = fs.readFileSync("server/routes.ts", "utf8");
const svc = fs.readFileSync("server/contractor-onboarding/create.ts", "utf8");
const handler = (method: string) => {
  const i = routes.indexOf(`app.${method}("/api/contractor-onboarding",`);
  return i < 0 ? "" : routes.slice(i, routes.indexOf("\n  });", i));
};
const post = handler("post"), get = handler("get");

check("POST route exists with requireAuth, requireRole(\"admin\") only, CSRF and demo-write block",
  /app\.post\("\/api\/contractor-onboarding", requireAuth, requireRole\("admin"\), requireCsrfToken, blockDemoWrites,/.test(post));
check("GET route requires auth and admin/manager", /app\.get\("\/api\/contractor-onboarding", requireAuth, requireRole\("admin", "manager"\),/.test(get));
check("company comes from the session user, never the request", /resolveTenantCompanyId\(actingUser\)/.test(post) && !/req\.(body|query|params)\??\.companyId/.test(post) && !/req\.(body|query|params)\??\.companyId/.test(get));
check("handler passes only the normalized 3-field input to the service", /input: parsed\.value/.test(post) && !/\.\.\.req\.body/.test(post));
check("errors never log the request body", !/console\.error\([^)]*req\.body/.test(post));
check("service: advisory lock on (company, email) inside the transaction", /db\.transaction[\s\S]*pg_advisory_xact_lock\(hashtext\(/.test(svc));
check("service: number allocated in the same transaction (PR #205 allocator)", /allocateEmployeeNumber\(tx/.test(svc));
check("service: worker created inactive (fail closed)", /'inactive_temporary', false/.test(svc));
check("service: audit after_json holds only employeeNumber + package", /after_json\)[\s\S]{0,200}JSON\.stringify\(\{ employeeNumber, package: CONTRACTOR_ONBOARDING_PACKAGE \}\)/.test(svc));
check("service sends no email/SMS", !/sendEmail|sendMail|sendGenericNotificationEmail|twilio|sms/i.test(svc));
const v = normalizeCreateInput({ firstName: " A ", lastName: "B", email: " X@Y.Test ", companyId: "c", employeeNumber: "1" });
check("normalizer keeps exactly firstName/lastName/email (trimmed, email lower-cased)", v.ok && JSON.stringify(v.value) === JSON.stringify({ firstName: "A", lastName: "B", email: "x@y.test" }));
check("normalizer rejects a non-object body", !normalizeCreateInput(null).ok && !normalizeCreateInput("x").ok);
check("checklist: 6 steps ending with admin_review that depends on every document step",
  CONTRACTOR_ONBOARDING_STEPS.length === 6 && CONTRACTOR_ONBOARDING_STEPS[5].key === "admin_review"
  && ["contractor_agreement", "government_id", "emergency_contact", "w9"].every((k) => CONTRACTOR_ONBOARDING_STEPS[5].dependsOn?.includes(k)));

console.log(`\ncontractor onboarding create static: ${passed} passed${failed ? `, ${failed} failed` : ""}`);
if (failed) process.exit(1);
