/**
 * PayPal pricing, sandbox default, and webhook mapping. No network.
 * Run: npx tsx server/__tests__/paypal-billing.test.ts
 */
import assert from "node:assert/strict";
import { readPaypalConfig, verifyPaypalWebhook } from "../paypal-client.js";
import { mapPaypalEvent, monthlyTotalCents, paypalQuantity } from "../paypal-pricing.js";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${err?.message || err}`);
    failed++;
  }
}

async function run() {
  await test("monthly total is $29 plus $4 per active employee", () => {
    assert.equal(monthlyTotalCents(0), 2900);
    assert.equal(monthlyTotalCents(10), 6900);
    assert.equal(paypalQuantity(10), "69");
    assert.equal(paypalQuantity(-3), "29");
  });

  await test("PayPal stays on the sandbox host unless PAYPAL_ENV=live", () => {
    assert.equal(readPaypalConfig({}), null);
    const sandbox = readPaypalConfig({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" });
    assert.equal(sandbox?.apiBase, "https://api-m.sandbox.paypal.com");
    assert.equal(sandbox?.live, false);
    const live = readPaypalConfig({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret", PAYPAL_ENV: "live" });
    assert.equal(live?.apiBase, "https://api-m.paypal.com");
    assert.equal(live?.live, true);
  });

  await test("subscription and payment events map onto existing billing states", () => {
    assert.equal(mapPaypalEvent("BILLING.SUBSCRIPTION.ACTIVATED", "ACTIVE"), "active_paid");
    assert.equal(mapPaypalEvent("PAYMENT.SALE.COMPLETED"), "active_paid");
    assert.equal(mapPaypalEvent("BILLING.SUBSCRIPTION.PAYMENT.FAILED", "ACTIVE"), "grace_period");
    assert.equal(mapPaypalEvent("BILLING.SUBSCRIPTION.UPDATED", "PAST_DUE"), "past_due");
    assert.equal(mapPaypalEvent("BILLING.SUBSCRIPTION.SUSPENDED"), "suspended");
    assert.equal(mapPaypalEvent("BILLING.SUBSCRIPTION.CANCELLED"), "cancelled");
    assert.equal(mapPaypalEvent("BILLING.SUBSCRIPTION.EXPIRED"), "cancelled");
    assert.equal(mapPaypalEvent("CUSTOMER.SOMETHING"), null);
  });

  await test("a failed PayPal signature check is not treated as verified", async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      assert.match(String(url), /api-m\.sandbox\.paypal\.com/);
      return new Response(JSON.stringify({ verification_status: "FAILURE" }), { status: 200 });
    }) as typeof fetch;
    const ok = await verifyPaypalWebhook({}, { id: "evt" }, {
      fetchImpl,
      config: {
        clientId: "id",
        clientSecret: "secret",
        apiBase: "https://api-m.sandbox.paypal.com",
        webhookId: "WH-1",
        planId: null,
        live: false,
      },
    });
    assert.equal(ok, false);
  });

  await test("webhook verification is refused when PAYPAL_WEBHOOK_ID is missing", async () => {
    let called = 0;
    const fetchImpl = (async () => { called++; return new Response("{}", { status: 200 }); }) as typeof fetch;
    const ok = await verifyPaypalWebhook({}, { id: "evt" }, {
      fetchImpl,
      config: {
        clientId: "id",
        clientSecret: "secret",
        apiBase: "https://api-m.sandbox.paypal.com",
        webhookId: null,
        planId: null,
        live: false,
      },
    });
    assert.equal(ok, false);
    assert.equal(called, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
