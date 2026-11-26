/**
 * Trial-length and expiry rules. No database, no network, no live server.
 * Run: npx tsx server/__tests__/trial-lifecycle.test.ts
 */
import assert from "node:assert/strict";
import { DEFAULT_TRIAL_LENGTH_DAYS, parseTrialLengthDays, trialLengthMs, trialOfferCopy } from "../platform-settings.js";
import { shouldExpireTrial } from "../trial-lifecycle.js";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${err?.message || err}`);
    failed++;
  }
}

const now = new Date("2026-06-01T00:00:00Z");
const past = new Date("2026-05-01T00:00:00Z");
const future = new Date("2026-07-01T00:00:00Z");

test("missing or invalid trial length stays at the historical 30 days", () => {
  assert.equal(DEFAULT_TRIAL_LENGTH_DAYS, 30);
  assert.equal(parseTrialLengthDays(undefined), null);
  assert.equal(parseTrialLengthDays(""), null);
  assert.equal(parseTrialLengthDays("0"), null);
  assert.equal(parseTrialLengthDays("366"), null);
  assert.equal(parseTrialLengthDays("14.5"), null);
  assert.equal(parseTrialLengthDays("45"), 45);
  assert.equal(parseTrialLengthDays(14), 14);
});

test("default marketing copy is the 30-day, no-credit-card sentence", () => {
  assert.equal(trialOfferCopy(), "30-day trial, no credit card");
  assert.equal(trialOfferCopy(14), "14-day trial, no credit card");
  assert.equal(trialLengthMs(30), 30 * 24 * 60 * 60 * 1000);
});

test("only an elapsed trial_active, trialing, or trial company is expired", () => {
  assert.equal(shouldExpireTrial("trial_active", past, now), true);
  assert.equal(shouldExpireTrial("trialing", past, now), true);
  assert.equal(shouldExpireTrial(" TRIAL ", past, now), true);
  assert.equal(shouldExpireTrial("trial_active", future, now), false);
  assert.equal(shouldExpireTrial("trial_active", null, now), false);
  assert.equal(shouldExpireTrial("trial_expired", past, now), false);
  assert.equal(shouldExpireTrial("active_paid", past, now), false);
  assert.equal(shouldExpireTrial("suspended", past, now), false);
  assert.equal(shouldExpireTrial("cancelled", past, now), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
