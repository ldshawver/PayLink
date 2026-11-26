/**
 * Idempotent PayPal catalog setup for the sandbox (or live, only when
 * PAYPAL_ENV=live). Creates the MyPayLink Starter product and the $1 unit
 * plan if they are not already there, then prints PAYPAL_PLAN_ID.
 *
 *   PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... npx tsx scripts/paypal-setup-catalog.ts
 */
import { ensurePaypalCatalog } from "../server/paypal-catalog.js";

const result = await ensurePaypalCatalog();
console.log(JSON.stringify({ ...result, secret: undefined }, null, 2));
console.log(`\nSet PAYPAL_PLAN_ID=${result.planId}`);
