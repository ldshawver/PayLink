/**
 * Password-reset policy tests. No database, no network, no live server.
 * Run: npx tsx server/__tests__/password-reset.test.ts
 */
import assert from "node:assert/strict";
import {
  FORGOT_PASSWORD_MESSAGE,
  MIN_PASSWORD_LENGTH,
  chooseResetUser,
  createIdentifierRateLimit,
  hashPasswordResetToken,
  passwordMeetsPolicy,
  type ResetUserRow,
} from "../password-reset.js";

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

const user = (over: Partial<ResetUserRow>): ResetUserRow => ({
  id: "u1",
  username: "ada",
  email: "ada@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  isActive: true,
  ...over,
});

async function run() {
  await test("the public response does not depend on whether the account exists", () => {
    assert.match(FORGOT_PASSWORD_MESSAGE, /If an account matches/);
    assert.doesNotMatch(FORGOT_PASSWORD_MESSAGE, /not found|no account|unknown/i);
  });

  await test("username match wins and is case-insensitive", () => {
    const chosen = chooseResetUser([
      user({ id: "email-person", username: "other", email: "ada@example.com" }),
      user({ id: "name-person", username: "Ada", email: "different@example.com" }),
    ], " ada ");
    assert.equal(chosen?.id, "name-person");
  });

  await test("a single email match is used when the username does not match", () => {
    const chosen = chooseResetUser([user({ username: "ada" })], "Ada@Example.com");
    assert.equal(chosen?.id, "u1");
  });

  await test("duplicate emails and disabled accounts do not send", () => {
    const dupes = chooseResetUser([
      user({ id: "a", username: "a", email: "shared@example.com" }),
      user({ id: "b", username: "b", email: "shared@example.com" }),
    ], "shared@example.com");
    assert.equal(dupes, null);
    const disabled = chooseResetUser([user({ isActive: false })], "ada");
    assert.equal(disabled, null);
    assert.equal(chooseResetUser([user({})], "nobody"), null);
  });

  await test("password policy requires 8 to 200 characters", () => {
    assert.equal(MIN_PASSWORD_LENGTH, 8);
    assert.equal(passwordMeetsPolicy("short"), false);
    assert.equal(passwordMeetsPolicy("long-enough"), true);
    assert.equal(passwordMeetsPolicy("x".repeat(201)), false);
    assert.equal(passwordMeetsPolicy(12), false);
  });

  await test("reset tokens are stored as a sha256 hex digest, not the raw value", () => {
    const hash = hashPasswordResetToken("raw-token-value");
    assert.equal(hash.length, 64);
    assert.notEqual(hash, "raw-token-value");
    assert.equal(hash, hashPasswordResetToken("raw-token-value"));
  });

  await test("per-identifier limit is 3 per window and does not affect another identifier", () => {
    let clock = 0;
    const limit = createIdentifierRateLimit(3, 1_000, () => clock);
    assert.equal(limit.allowed("Ada"), true);
    assert.equal(limit.allowed("ada"), true);
    assert.equal(limit.allowed("ADA"), true);
    assert.equal(limit.allowed("ada"), false);
    assert.equal(limit.allowed("grace"), true);
    clock = 1_001;
    assert.equal(limit.allowed("ada"), true);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
