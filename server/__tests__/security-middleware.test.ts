/**
 * Unit tests for server/security-middleware.ts (Concierge Launch Option A,
 * blocker 3 — rate-limit + CSRF middleware). Pure in-process tests: no
 * database, no network, no live server.
 *
 * Run with: npx tsx server/__tests__/security-middleware.test.ts
 * Exit code 0 = all tests pass. Exit code 1 = one or more tests failed.
 */

import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import { createRateLimiter, requireCsrfToken, CSRF_HEADER_NAME } from "../security-middleware.js";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; },
  };
  return res as Response & typeof res;
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return { ip: "1.2.3.4", method: "POST", headers: {}, get(name: string) { return (this.headers as any)[name.toLowerCase()]; }, ...overrides } as any;
}

async function run() {
  await test("rate limiter allows requests under the max", () => {
    const limiter = createRateLimiter("test-under", { windowMs: 60_000, max: 3 });
    const req = mockReq();
    let nextCalled = 0;
    const next: NextFunction = () => { nextCalled++; };
    const res = mockRes();
    limiter(req, res, next);
    limiter(req, res, next);
    limiter(req, res, next);
    assert.equal(nextCalled, 3);
    assert.equal(res.statusCode, 200);
  });

  await test("rate limiter blocks the request once the max is exceeded", () => {
    const limiter = createRateLimiter("test-over", { windowMs: 60_000, max: 2 });
    const req = mockReq();
    let nextCalled = 0;
    const next: NextFunction = () => { nextCalled++; };
    let res = mockRes();
    limiter(req, res, next);
    res = mockRes();
    limiter(req, res, next);
    res = mockRes();
    limiter(req, res, next);
    assert.equal(nextCalled, 2, "next() should only run for the first `max` requests");
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.message, "Too many requests. Please wait a moment and try again.");
    assert.ok(res.headers["Retry-After"], "429 response should include Retry-After");
  });

  await test("rate limiter buckets are isolated per key (different IP doesn't share a bucket)", () => {
    const limiter = createRateLimiter("test-keyed", { windowMs: 60_000, max: 1 });
    let nextCalled = 0;
    const next: NextFunction = () => { nextCalled++; };
    limiter(mockReq({ ip: "1.1.1.1" } as any), mockRes(), next);
    limiter(mockReq({ ip: "2.2.2.2" } as any), mockRes(), next);
    assert.equal(nextCalled, 2, "requests from two different IPs should not share a bucket");
  });

  await test("rate limiter buckets are isolated per limiter name (same IP, different route)", () => {
    const limiterA = createRateLimiter("test-name-a", { windowMs: 60_000, max: 1 });
    const limiterB = createRateLimiter("test-name-b", { windowMs: 60_000, max: 1 });
    let nextCalled = 0;
    const next: NextFunction = () => { nextCalled++; };
    const req = mockReq();
    limiterA(req, mockRes(), next);
    limiterB(req, mockRes(), next);
    assert.equal(nextCalled, 2, "two different named limiters should not share a bucket for the same IP");
  });

  await test("CSRF check passes through GET requests regardless of token", () => {
    const req = mockReq({ method: "GET", session: { userId: "u1", csrfToken: "abc" } } as any);
    let nextCalled = 0;
    requireCsrfToken(req, mockRes(), () => { nextCalled++; });
    assert.equal(nextCalled, 1);
  });

  await test("CSRF check passes through requests with no active session", () => {
    const req = mockReq({ method: "POST", session: undefined } as any);
    let nextCalled = 0;
    requireCsrfToken(req, mockRes(), () => { nextCalled++; });
    assert.equal(nextCalled, 1, "unauthenticated mutating requests are not blocked here — rate limiting covers them instead");
  });

  await test("CSRF check rejects a mutating session request with a missing header", () => {
    const req = mockReq({ method: "POST", session: { userId: "u1", csrfToken: "abc" } } as any);
    let nextCalled = 0;
    const res = mockRes();
    requireCsrfToken(req, res, () => { nextCalled++; });
    assert.equal(nextCalled, 0);
    assert.equal(res.statusCode, 403);
  });

  await test("CSRF check rejects a mutating session request with a mismatched header", () => {
    const req = mockReq({
      method: "POST",
      session: { userId: "u1", csrfToken: "abc" },
      headers: { [CSRF_HEADER_NAME]: "wrong" },
    } as any);
    let nextCalled = 0;
    const res = mockRes();
    requireCsrfToken(req, res, () => { nextCalled++; });
    assert.equal(nextCalled, 0);
    assert.equal(res.statusCode, 403);
  });

  await test("CSRF check accepts a mutating session request with a matching header", () => {
    const req = mockReq({
      method: "POST",
      session: { userId: "u1", csrfToken: "abc" },
      headers: { [CSRF_HEADER_NAME]: "abc" },
    } as any);
    let nextCalled = 0;
    requireCsrfToken(req, mockRes(), () => { nextCalled++; });
    assert.equal(nextCalled, 1);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
