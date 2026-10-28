/**
 * P0-C — fail-closed tenant gating. checkTenantGate returned { allowed: true }
 * when its query threw and for any status it did not recognise (including
 * trial_expired and grace_period, which fell through to the default allow);
 * requireActiveSubscription let a write through when the user's company row
 * was missing or its status was unrecognised. Both now deny.
 * Static + pure-function checks; the real-server proof (including a real
 * database failure) is tests/tenant-gate-fail-closed-db.test.ts.
 *
 * Run: npx tsx tests/tenant-gate-fail-closed.test.ts
 */
import fs from "node:fs";
import { isKnownSubscriptionStatus, normalizeSubscriptionStatus, KNOWN_SUBSCRIPTION_STATUSES } from "../server/subscription-status";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); }
}

console.log("isKnownSubscriptionStatus");
const written = ["active_paid", "active", "trial_active", "trialing", "trial", "trial_expired", "grace_period", "grace", "past_due", "suspended", "cancelled", "canceled", "CANCELED"];
for (const raw of written) ok(`${JSON.stringify(raw)} is known`, isKnownSubscriptionStatus(normalizeSubscriptionStatus(raw)));
for (const raw of [null, undefined, "", "  ", "pending", "inactive", "demo", "activ_paid"]) {
  ok(`${JSON.stringify(raw)} is NOT known`, !isKnownSubscriptionStatus(normalizeSubscriptionStatus(raw)));
}
ok("known set has exactly the classified statuses", KNOWN_SUBSCRIPTION_STATUSES.size === 11);

console.log("\nEvery status the server writes is known");
const serverFiles = ["server/routes.ts", "server/demo-seed.ts", "server/seed.ts", "server/billingLifecycle.ts", "server/provisioning/TenantProvisioningService.ts", "server/provisioning/tenant-core.ts", "server/licensing/license-service.ts", "server/tenant-gate-override.ts", "server/tenant-admin-suspension.ts"];
const writtenLiterals = new Set<string>();
for (const f of serverFiles) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/subscription_status\s*=\s*'([a-z_]+)'/g)) writtenLiterals.add(m[1]);
  for (const m of src.matchAll(/subscriptionStatus:\s*"([a-z_]+)"/g)) writtenLiterals.add(m[1]);
  for (const m of src.matchAll(/INSERT INTO companies \([^)]*subscription_status[^)]*\)\s*VALUES \(\s*[^;]*?'([a-z_]+)'/g)) writtenLiterals.add(m[1]);
}
const licenseMap = fs.readFileSync("server/licensing/license-service.ts", "utf8").match(/const STATUS_TO_COMPANY[^{]*\{([^}]*)\}/)?.[1] ?? "";
for (const m of licenseMap.matchAll(/"([a-z_]+)"/g)) writtenLiterals.add(m[1]);
const override = fs.readFileSync("server/tenant-gate-override.ts", "utf8").match(/GATE_OVERRIDE_STATUSES = \[([^\]]*)\]/)?.[1] ?? "";
for (const m of override.matchAll(/"([a-z_]+)"/g)) writtenLiterals.add(m[1]);
ok("found written statuses", writtenLiterals.size >= 6);
for (const s of writtenLiterals) ok(`written status ${s} is known`, isKnownSubscriptionStatus(s));

console.log("\ncheckTenantGate (server/tenant-enforcement.ts)");
const gate = fs.readFileSync("server/tenant-enforcement.ts", "utf8");
const catchBlock = gate.match(/\} catch \(e\) \{[\s\S]*?\n {2}\}\n\}/)?.[0] ?? "";
ok("catch block found", catchBlock.length > 0);
ok("query error → allowed: false, code gate_unavailable", /allowed: false[\s\S]{0,160}code: "gate_unavailable"/.test(catchBlock));
ok("query error never returns allowed: true", !/allowed: true/.test(catchBlock));
ok("error detail is logged, not returned", /console\.error\("\[TenantGate\] check failed:", e\)/.test(catchBlock) && !/reason: [^,]*e\.|message/.test(catchBlock.replace(/console\.error[^\n]*/, "")));
const body = gate.slice(gate.indexOf("export async function checkTenantGate"), gate.indexOf("} catch (e) {"));
const tail = body.slice(body.lastIndexOf('if (status === "suspended")'));
ok("final fall-through denies (no trailing allowed: true)", /return \{\s*allowed: false,[\s\S]{0,120}code: "tenant_inactive"/.test(tail) && !/allowed: true/.test(tail));
ok("trial_expired is blocked explicitly", /if \(status === "trial_expired"\) \{[\s\S]{0,40}allowed: false[\s\S]{0,120}code: "trial_expired"/.test(body));
ok("both grace spellings get the expiry check", /GRACE_SUBSCRIPTION_STATUSES as readonly string\[\]\)\.includes\(status\)\) \{[\s\S]{0,120}grace_period_end/.test(body));
ok("all trial spellings get the trial_end check", /TRIAL_SUBSCRIPTION_STATUSES as readonly string\[\]\)\.includes\(status\)\) \{[\s\S]{0,80}trial_end/.test(body));
ok("demo bypass still limited to an effective demo", /if \(demoStatus === "demo"\) return \{ allowed: true \}/.test(body));
ok("GateCode includes gate_unavailable", /\| "gate_unavailable";/.test(gate));

console.log("\nrequireActiveSubscription (server/routes.ts)");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const ras = routes.match(/async function requireActiveSubscription[\s\S]*?\n\}/)?.[0] ?? "";
ok("found", ras.length > 0);
ok("missing company row → 403 tenant_inactive (was next())", !/if \(rows\.rows\.length === 0\) return next\(\);/.test(ras) && /if \(rows\.rows\.length === 0\) \{\s*return res\.status\(403\)[\s\S]{0,160}reason: "tenant_inactive"/.test(ras));
ok("unrecognised status → 403 tenant_inactive before next()", /if \(!isKnownSubscriptionStatus\(status\)\) \{[\s\S]{0,200}status\(403\)[\s\S]{0,160}reason: "tenant_inactive"[\s\S]{0,40}\}\n\s*next\(\);/.test(ras));
ok("expired \"grace\" is denied without a status write", /if \(status === "grace"\) \{\s*return res\.status\(403\)/.test(ras));
ok("lookup error → generic 503 (no error detail)", /\} catch \(_e\) \{\s*return res\.status\(503\)\.json\(\{ message: "Unable to verify subscription status\. Please try again\." \}\);/.test(ras));
ok("platform users (no companyId) and anonymous requests still pass", /if \(!req\.session\?\.userId\) return next\(\);/.test(ras) && /if \(!user\?\.companyId\) return next\(\);/.test(ras));
const pwp = routes.match(/const publicWritePaths = \[([^\]]*)\]/)?.[1] ?? "";
ok("public + recovery paths stay exempt", ['"/auth/"', '"/trial/signup"', '"/demo/provision"', '"/billing/activate"', '"/webhooks/documenso"'].every((p) => pwp.includes(p)));

console.log("\nClient (client/src/components/account-blocked.tsx)");
const blocked = fs.readFileSync("client/src/components/account-blocked.tsx", "utf8");
ok("gate_unavailable has a label and a retry hint", /gate_unavailable: "Status Unavailable"/.test(blocked) && /gate\.code === "gate_unavailable"/.test(blocked));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
