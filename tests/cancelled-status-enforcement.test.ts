/**
 * P0-D — "cancelled" vs "canceled" enforcement. The platform console, license
 * service and gate override write "cancelled"; Stripe/legacy rows say
 * "canceled". requireActiveSubscription used to block only "canceled" and
 * checkTenantGate only "cancelled", so each spelling slipped past one gate.
 * Static + pure-function checks; the real-server proof is
 * tests/cancelled-status-enforcement-db.test.ts.
 *
 * Run: npx tsx tests/cancelled-status-enforcement.test.ts
 */
import fs from "node:fs";
import { normalizeSubscriptionStatus, isCancelledSubscriptionStatus, CANCELLED_SUBSCRIPTION_STATUS_SPELLINGS } from "../server/subscription-status";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); }
}

console.log("normalizeSubscriptionStatus");
for (const raw of ["cancelled", "canceled", "CANCELED", " Cancelled ", "Canceled"]) {
  ok(`${JSON.stringify(raw)} → cancelled`, normalizeSubscriptionStatus(raw) === "cancelled" && isCancelledSubscriptionStatus(raw));
}
for (const [raw, want] of [["suspended", "suspended"], ["active_paid", "active_paid"], ["Trial_Active", "trial_active"], ["grace_period", "grace_period"], [null, ""], [undefined, ""]] as const) {
  ok(`${JSON.stringify(raw)} → ${JSON.stringify(want)} (no unrelated remapping)`, normalizeSubscriptionStatus(raw) === want && !isCancelledSubscriptionStatus(raw));
}
ok("both spellings listed", JSON.stringify([...CANCELLED_SUBSCRIPTION_STATUS_SPELLINGS].sort()) === JSON.stringify(["canceled", "cancelled"]));

console.log("\nrequireActiveSubscription (server/routes.ts)");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const ras = routes.match(/async function requireActiveSubscription[\s\S]*?\n\}/)?.[0] ?? "";
ok("found", ras.length > 0);
ok("normalizes the stored status", /const status = normalizeSubscriptionStatus\(company\.subscription_status\);/.test(ras));
ok("blocks suspended (403 tenant_suspended)", /if \(status === "suspended"\)[\s\S]{0,80}status\(403\)[\s\S]{0,160}reason: "tenant_suspended"/.test(ras));
ok("blocks cancelled (403 tenant_cancelled)", /if \(status === "cancelled"\)[\s\S]{0,80}status\(403\)[\s\S]{0,160}reason: "tenant_cancelled"/.test(ras));
ok("no raw single-spelling comparison left", !/=== "canceled"/.test(ras));
ok("applied to every non-GET /api request except publicWritePaths", /req\.method === "GET" \|\| publicWritePaths\.some\(p => req\.path\.startsWith\(p\)\)\) return next\(\);\n\s*requireActiveSubscription\(req, res, next\)/.test(routes));
const pwp = routes.match(/const publicWritePaths = \[([^\]]*)\]/)?.[1] ?? "";
ok("recovery + billing paths stay exempt (/auth/, /billing/activate)", pwp.includes('"/auth/"') && pwp.includes('"/billing/activate"'));

console.log("\ncheckTenantGate (server/tenant-enforcement.ts)");
const gate = fs.readFileSync("server/tenant-enforcement.ts", "utf8");
ok("normalizes the stored status", /const status = normalizeSubscriptionStatus\(c\.subscription_status\);/.test(gate));
ok("blocks cancelled with code cancelled", /if \(status === "cancelled"\) \{[\s\S]{0,80}allowed: false[\s\S]{0,120}code: "cancelled"/.test(gate));

console.log("\nBilling lifecycle (server/billingLifecycle.ts)");
const billing = fs.readFileSync("server/billingLifecycle.ts", "utf8");
ok("payment_failed never moves suspended / either cancelled spelling into grace_period", /AND subscription_status NOT IN \('suspended', 'cancelled', 'canceled'\)/.test(billing));
ok("no-op guard stops before mirror / audit / email", /if \(!graceResult\.rowCount\) return false;[\s\S]{0,400}if \(!moved\) \{[\s\S]{0,160}return;\n\s*\}\n\s*await mirrorTenantStatusFromCompany\(company\.id, "grace_period"\)/.test(billing));
ok("cancelled is never auto-reactivated by a Stripe payment", /if \(status === "cancelled"\) refused = /.test(billing));

console.log("\nClient restriction flag (client/src/hooks/use-trial.ts)");
const trial = fs.readFileSync("client/src/hooks/use-trial.ts", "utf8");
ok("isRestricted covers both spellings", trial.includes('subscriptionStatus === "canceled"') && trial.includes('subscriptionStatus === "cancelled"'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
