/**
 * PayPal tenant billing stays off Stripe and defaults to sandbox.
 * Run: npx tsx tests/paypal-billing-static.test.ts
 */
import fs from "node:fs";
import assert from "node:assert/strict";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const billing = fs.readFileSync("client/src/pages/billing.tsx", "utf8");
const index = fs.readFileSync("server/index.ts", "utf8");
const migration = fs.readFileSync("migrations/0041_paypal_billing.sql", "utf8");
const lifecycle = fs.readFileSync("server/billingLifecycle.ts", "utf8");

assert.match(routes, /app\.post\("\/api\/webhooks\/paypal"/);
assert.match(routes, /processPaypalWebhook\(/);
assert.match(routes, /app\.post\("\/api\/billing\/paypal\/subscribe"/);
assert.match(routes, /req\.path === "\/webhooks\/paypal"/);
assert.match(index, /handleTenantBillingEvent/);
assert.match(lifecycle, /export async function applyExternalBillingSignal/);
assert.doesNotMatch(billing, /Contact Us to Activate/);
assert.match(billing, /button-activate-subscription/);
assert.match(billing, /button-cancel-paypal/);
assert.match(billing, /text-next-bill/);
assert.match(migration, /paypal_subscription_id/);
assert.doesNotMatch(migration, /\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
assert.match(fs.readFileSync("server/paypal-client.ts", "utf8"), /api-m\.sandbox\.paypal\.com/);
assert.match(fs.readFileSync("server/paypal-pricing.ts", "utf8"), /plan price × quantity/);

console.log("PayPal billing wiring checks passed.");
