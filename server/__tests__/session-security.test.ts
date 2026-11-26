/**
 * Session hardening unit tests. No database, no network, no live server.
 * Run: npx tsx server/__tests__/session-security.test.ts
 */
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import {
  DEV_SESSION_SECRET,
  DEFAULT_SESSION_IDLE_MINUTES,
  ProductionSessionSecretError,
  resolveSessionSecret,
  resolveSessionIdleMinutes,
  singleSessionPerUserEnabled,
  idleExpired,
  createLoginLockout,
  enforceSessionControls,
  clearSessionCookie,
} from "../session-security.js";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
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

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    cleared: null as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
    clearCookie(name: string, opts: unknown) { this.cleared = { name, opts }; },
    headersSent: false,
  };
  return res as Response & typeof res;
}

function mockReq(session: Record<string, unknown> | null, sessionID = "sid-current"): Request {
  const req: any = {
    sessionID,
    session: session
      ? {
          ...session,
          destroy(cb: (err?: Error) => void) { req.session = null; cb(); },
        }
      : undefined,
  };
  return req;
}

async function run() {
  await test("production refuses a missing SESSION_SECRET", () => {
    assert.throws(
      () => resolveSessionSecret({ NODE_ENV: "production" }),
      (err: unknown) => err instanceof ProductionSessionSecretError && /SESSION_SECRET/.test((err as Error).message),
    );
  });

  await test("production refuses a blank or development SESSION_SECRET", () => {
    assert.throws(() => resolveSessionSecret({ NODE_ENV: "production", SESSION_SECRET: "   " }), ProductionSessionSecretError);
    assert.throws(
      () => resolveSessionSecret({ NODE_ENV: "production", SESSION_SECRET: DEV_SESSION_SECRET }),
      ProductionSessionSecretError,
    );
  });

  await test("production accepts a distinct secret and development keeps the fallback", () => {
    assert.equal(resolveSessionSecret({ NODE_ENV: "production", SESSION_SECRET: "prod-secret-value" }), "prod-secret-value");
    assert.equal(resolveSessionSecret({ NODE_ENV: "development" }), DEV_SESSION_SECRET);
    assert.equal(resolveSessionSecret({ NODE_ENV: "test", SESSION_SECRET: "from-env" }), "from-env");
  });

  await test("idle minutes default to 30 and reject out-of-range values", () => {
    assert.equal(resolveSessionIdleMinutes({}), DEFAULT_SESSION_IDLE_MINUTES);
    assert.equal(resolveSessionIdleMinutes({ SESSION_IDLE_MINUTES: "15" }), 15);
    assert.equal(resolveSessionIdleMinutes({ SESSION_IDLE_MINUTES: "0" }), DEFAULT_SESSION_IDLE_MINUTES);
    assert.equal(resolveSessionIdleMinutes({ SESSION_IDLE_MINUTES: "nope" }), DEFAULT_SESSION_IDLE_MINUTES);
    assert.equal(resolveSessionIdleMinutes({ SESSION_IDLE_MINUTES: "1441" }), DEFAULT_SESSION_IDLE_MINUTES);
  });

  await test("single-session setting defaults off", () => {
    assert.equal(singleSessionPerUserEnabled({}), false);
    assert.equal(singleSessionPerUserEnabled({ SINGLE_SESSION_PER_USER: "false" }), false);
    assert.equal(singleSessionPerUserEnabled({ SINGLE_SESSION_PER_USER: "true" }), true);
    assert.equal(singleSessionPerUserEnabled({ SINGLE_SESSION_PER_USER: "1" }), true);
  });

  await test("idle clock treats a missing timestamp as not yet expired", () => {
    assert.equal(idleExpired(undefined, 1_000_000, 60_000), false);
    assert.equal(idleExpired(1_000_000 - 60_000, 1_000_000, 60_000), false);
    assert.equal(idleExpired(1_000_000 - 60_001, 1_000_000, 60_000), true);
  });

  await test("idle middleware signs out an inactive session and rolls an active one", async () => {
    const idle = mockReq({ userId: "u1", lastActivityAt: 1_000 });
    let nextCalled = 0;
    const res = mockRes();
    await enforceSessionControls(idle, res, () => { nextCalled++; }, { idleMs: 500, now: 2_000 });
    assert.equal(nextCalled, 0);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.reason, "idle_timeout");
    assert.equal((res.cleared as any).name, "connect.sid");

    const active = mockReq({ userId: "u1", role: "admin", lastActivityAt: 1_500 });
    const res2 = mockRes();
    await enforceSessionControls(active, res2, () => { nextCalled++; }, { idleMs: 500, now: 1_800, singleSession: false });
    assert.equal(nextCalled, 1);
    assert.equal((active.session as any).lastActivityAt, 1_800);
  });

  await test("idle middleware applies before a role is consulted (pending MFA included)", async () => {
    const req = mockReq({ pendingMfaUserId: "u1", lastActivityAt: 0 });
    const res = mockRes();
    let nextCalled = 0;
    await enforceSessionControls(req, res, () => { nextCalled++; }, { idleMs: 10, now: 50 });
    assert.equal(nextCalled, 0);
    assert.equal(res.body.reason, "idle_timeout");
  });

  await test("single-session check is a no-op while the setting is off", async () => {
    let lookups = 0;
    const req = mockReq({ userId: "u1", lastActivityAt: 10 });
    let nextCalled = 0;
    await enforceSessionControls(req, mockRes(), () => { nextCalled++; }, {
      idleMs: 1000,
      now: 20,
      singleSession: false,
      loadActiveSessionId: async () => { lookups++; return "other"; },
    });
    assert.equal(nextCalled, 1);
    assert.equal(lookups, 0);
  });

  await test("single-session check rejects a superseded session and fails closed on lookup errors", async () => {
    const stale = mockReq({ userId: "u1", lastActivityAt: 10 }, "sid-old");
    const res = mockRes();
    let nextCalled = 0;
    const next: NextFunction = () => { nextCalled++; };
    await enforceSessionControls(stale, res, next, {
      idleMs: 1000,
      now: 20,
      singleSession: true,
      loadActiveSessionId: async () => "sid-new",
    });
    assert.equal(nextCalled, 0);
    assert.equal(res.body.reason, "session_superseded");

    const broken = mockReq({ userId: "u1", lastActivityAt: 10 }, "sid-old");
    const res2 = mockRes();
    await enforceSessionControls(broken, res2, next, {
      idleMs: 1000,
      now: 20,
      singleSession: true,
      loadActiveSessionId: async () => { throw new Error("column missing"); },
    });
    assert.equal(res2.body.reason, "session_check_failed");
    assert.equal(nextCalled, 0);
  });

  await test("lockout trips per account at 5 failures and leaves a different account alone", () => {
    let clock = 1_000_000;
    const lockout = createLoginLockout(() => clock);
    for (let i = 0; i < 4; i++) lockout.recordFailure("Admin", "1.1.1.1");
    assert.equal(lockout.inspect("admin", "1.1.1.1").locked, false);
    lockout.recordFailure("ADMIN", "1.1.1.1");
    const locked = lockout.inspect("admin", "9.9.9.9");
    assert.equal(locked.locked, true);
    assert.equal(locked.scope, "account");
    assert.equal(lockout.inspect("other-user", "9.9.9.9").locked, false);
    assert.ok(locked.retryAfterSeconds >= 15 * 60 - 1);
  });

  await test("lockout trips per IP at 20 failures across accounts", () => {
    const lockout = createLoginLockout(() => 5_000_000);
    for (let i = 0; i < 20; i++) lockout.recordFailure(`user-${i}`, "5.5.5.5");
    const locked = lockout.inspect("never-seen", "5.5.5.5");
    assert.equal(locked.locked, true);
    assert.equal(locked.scope, "ip");
    assert.equal(lockout.inspect("never-seen", "6.6.6.6").locked, false);
  });

  await test("a later failure while locked doubles the backoff, and success clears only that account", () => {
    let clock = 0;
    const lockout = createLoginLockout(() => clock);
    for (let i = 0; i < 5; i++) lockout.recordFailure("ada", "1.1.1.1");
    const first = lockout.inspect("ada", "8.8.8.8").retryAfterSeconds;
    lockout.recordFailure("ada", "1.1.1.1");
    const second = lockout.inspect("ada", "8.8.8.8").retryAfterSeconds;
    assert.ok(second > first, `expected backoff to grow (${first} -> ${second})`);
    lockout.recordSuccess("ada");
    assert.equal(lockout.inspect("ada", "8.8.8.8").locked, false);
    clock = 10_000;
    for (let i = 0; i < 20; i++) lockout.recordFailure(`other-${i}`, "1.1.1.1");
    assert.equal(lockout.inspect("ada", "1.1.1.1").scope, "ip");
  });

  await test("failures outside the window do not accumulate into a lock", () => {
    let clock = 0;
    const lockout = createLoginLockout(() => clock);
    for (let i = 0; i < 4; i++) {
      lockout.recordFailure("ada", "1.1.1.1");
      clock += 16 * 60 * 1000;
    }
    assert.equal(lockout.inspect("ada", "1.1.1.1").locked, false);
  });

  await test("clearSessionCookie targets the shared parent domain in production only", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const prod = mockRes();
    clearSessionCookie(prod);
    assert.equal((prod.cleared as any).opts.domain, ".mypaylink.app");
    process.env.NODE_ENV = "test";
    const dev = mockRes();
    clearSessionCookie(dev);
    assert.equal((dev.cleared as any).opts.domain, undefined);
    process.env.NODE_ENV = prev;
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
