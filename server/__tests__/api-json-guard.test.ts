/**
 * API JSON Guard Integration Tests — server/__tests__/api-json-guard.test.ts
 *
 * Run with:  npx tsx server/__tests__/api-json-guard.test.ts
 *
 * Spins up a minimal Express app that uses the REAL production middleware:
 *  - server/middleware/api-json-guard.ts  (applyApiJsonGuard)
 *  - server/middleware/api-not-found.ts   (apiNotFoundHandler)
 *
 * This ensures any change to either module is immediately caught here —
 * the tests do NOT copy or re-implement the guard logic.
 *
 * What is tested:
 *  1. Known-valid /api/* paths return Content-Type: application/json and valid JSON
 *  2. Intentionally invalid /api/* paths hit the real apiNotFoundHandler (404 JSON)
 *  3. A route that accidentally overrides Content-Type to text/html triggers the
 *     real guard warning (on-finish console.warn fires; no crash)
 *
 * No database or external services required — only route handlers are mocked;
 * all middleware is the real production code.
 *
 * Exit code 0 = all tests pass.
 * Exit code 1 = one or more tests failed.
 */

import http from "node:http";
import assert from "node:assert/strict";
import express, { type Request, type Response } from "express";
import { applyApiJsonGuard } from "../middleware/api-json-guard.js";
import { apiNotFoundHandler } from "../middleware/api-not-found.js";

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const errors: string[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${err.message}`);
    errors.push(`${name}: ${err.message}`);
    failed++;
  }
}

// ── Test app ──────────────────────────────────────────────────────────────────
// Uses the REAL production middleware modules. Route handlers are minimal stubs
// that represent the same contract as the production routes (correct status +
// JSON body for authenticated endpoints that reject unauthenticated requests).

function buildTestApp() {
  const app = express();
  app.use(express.json());

  // ── (1) Real API JSON-only guard from server/middleware/api-json-guard.ts ───
  applyApiJsonGuard(app);

  // ── (2) Minimal stubs for known-valid /api/* routes ───────────────────────
  // These mirror the production contract: correct status code, JSON body.
  app.get("/api/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // auth/me returns 401 when unauthenticated — must still be JSON
  app.get("/api/auth/me", (_req: Request, res: Response) => {
    res.status(401).json({ message: "Unauthorized" });
  });

  // a POST endpoint that accepts a body
  app.post("/api/auth/login", (_req: Request, res: Response) => {
    res.status(200).json({ message: "ok" });
  });

  // ── (3) Route that deliberately overrides Content-Type to HTML ─────────────
  // Simulates a route regression. The real guard (already mounted above) will
  // emit a console.warn on "finish". This test confirms the warning fires and
  // that our assertions catch this content-type regression.
  app.get("/api/test-bad-html-route", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html");
    res.status(200).send("<html><body>oops</body></html>");
  });

  // ── (4) Catch-all: real apiNotFoundHandler from server/middleware/api-not-found.ts
  // Same handler that server/vite.ts (dev) and server/static.ts (prod) use.
  app.use("/api/{*path}", apiNotFoundHandler);

  return app;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

interface HttpResult {
  statusCode: number;
  contentType: string;
  body: string;
}

function httpRequest(
  server: http.Server,
  method: string,
  path: string,
  body?: object
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const payload = body ? JSON.stringify(body) : undefined;

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method,
        headers: {
          Accept: "application/json",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            contentType: String(res.headers["content-type"] ?? ""),
            body: data,
          });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Test suite ────────────────────────────────────────────────────────────────

async function runTests(server: http.Server): Promise<void> {

  console.log("\n── Known-valid /api/* paths ─────────────────────────────────────────────");

  await test("GET /api/health → 200 application/json", async () => {
    const r = await httpRequest(server, "GET", "/api/health");
    assert.strictEqual(r.statusCode, 200, `Expected 200, got ${r.statusCode}`);
    assert.ok(
      r.contentType.includes("application/json"),
      `Expected application/json, got: ${r.contentType}`
    );
  });

  await test("GET /api/health body is valid JSON", async () => {
    const r = await httpRequest(server, "GET", "/api/health");
    let parsed: any;
    assert.doesNotThrow(
      () => { parsed = JSON.parse(r.body); },
      `Body is not valid JSON: ${r.body.slice(0, 200)}`
    );
    assert.strictEqual(parsed.status, "ok");
  });

  await test("GET /api/health body does not contain HTML", async () => {
    const r = await httpRequest(server, "GET", "/api/health");
    assert.ok(!r.body.includes("<!DOCTYPE"), `Body unexpectedly contains <!DOCTYPE>`);
    assert.ok(!r.body.includes("<html"), `Body unexpectedly contains <html>`);
  });

  await test("GET /api/auth/me → 401 application/json (unauthenticated)", async () => {
    const r = await httpRequest(server, "GET", "/api/auth/me");
    assert.ok(
      r.contentType.includes("application/json"),
      `Expected application/json, got: ${r.contentType}`
    );
  });

  await test("GET /api/auth/me body is valid JSON", async () => {
    const r = await httpRequest(server, "GET", "/api/auth/me");
    assert.doesNotThrow(
      () => JSON.parse(r.body),
      `Body is not valid JSON: ${r.body.slice(0, 200)}`
    );
  });

  await test("POST /api/auth/login → application/json", async () => {
    const r = await httpRequest(server, "POST", "/api/auth/login", { username: "x", password: "y" });
    assert.ok(
      r.contentType.includes("application/json"),
      `Expected application/json, got: ${r.contentType}`
    );
  });

  await test("POST /api/auth/login body is valid JSON", async () => {
    const r = await httpRequest(server, "POST", "/api/auth/login", { username: "x", password: "y" });
    assert.doesNotThrow(
      () => JSON.parse(r.body),
      `Body is not valid JSON: ${r.body.slice(0, 200)}`
    );
  });

  console.log("\n── Intentionally invalid /api/* paths (real apiNotFoundHandler) ─────────");

  const invalidPaths = [
    "/api/does-not-exist",
    "/api/xyz/abc",
    "/api/fake/nested/deep/path",
    "/api/typo-route",
    "/api/123invalid",
  ];

  for (const path of invalidPaths) {
    await test(`GET ${path} → 404 application/json`, async () => {
      const r = await httpRequest(server, "GET", path);
      assert.strictEqual(r.statusCode, 404, `Expected 404, got ${r.statusCode}`);
      assert.ok(
        r.contentType.includes("application/json"),
        `Expected application/json, got: ${r.contentType}`
      );
    });

    await test(`GET ${path} body is valid JSON (not HTML)`, async () => {
      const r = await httpRequest(server, "GET", path);
      assert.doesNotThrow(
        () => JSON.parse(r.body),
        `Body is not valid JSON: ${r.body.slice(0, 200)}`
      );
      assert.ok(!r.body.includes("<html"), `Body contains <html> for ${path}`);
      assert.ok(!r.body.includes("<!DOCTYPE"), `Body contains <!DOCTYPE> for ${path}`);
    });
  }

  for (const path of ["/api/does-not-exist", "/api/xyz/abc"]) {
    await test(`POST ${path} → 404 application/json`, async () => {
      const r = await httpRequest(server, "POST", path);
      assert.strictEqual(r.statusCode, 404, `Expected 404, got ${r.statusCode}`);
      assert.ok(
        r.contentType.includes("application/json"),
        `Expected application/json, got: ${r.contentType}`
      );
    });
  }

  console.log("\n── Guard warning path (real guard detects non-JSON Content-Type) ─────────");

  await test(
    "GET /api/test-bad-html-route → real guard emits warning; Content-Type is text/html",
    async () => {
      // The real guard (applyApiJsonGuard) sets application/json early, but
      // the route overrides it to text/html. The guard then emits a console.warn
      // on "finish". This test confirms:
      //  a) the guard warning fires without crashing the process
      //  b) the content-type regression is detectable (so automated tests catch it)
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => {
        warnings.push(args.join(" "));
        origWarn(...args);
      };
      try {
        const r = await httpRequest(server, "GET", "/api/test-bad-html-route");
        // Give the "finish" event time to fire
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(
          r.contentType.includes("text/html"),
          `Expected text/html from bad route, got: ${r.contentType}`
        );
        assert.ok(r.body.includes("<html"), `Expected HTML body from bad route`);
        assert.ok(
          warnings.some((w) => w.includes("[API JSON guard]")),
          `Expected [API JSON guard] warning but got: ${JSON.stringify(warnings)}`
        );
      } finally {
        console.warn = origWarn;
      }
    }
  );

  await test(
    "GET /api/test-bad-html-route → confirmed non-JSON (this is the regression to prevent in production)",
    async () => {
      const r = await httpRequest(server, "GET", "/api/test-bad-html-route");
      const isJson = r.contentType.includes("application/json");
      assert.strictEqual(isJson, false, "Bad route unexpectedly returned application/json");
    }
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const app = buildTestApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const addr = server.address() as { port: number };
  console.log(`\nAPI JSON Guard Tests — test server on 127.0.0.1:${addr.port}`);

  try {
    await runTests(server);
  } finally {
    server.close();
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.error("\nFailed tests:");
    errors.forEach((e) => console.error(`  • ${e}`));
    process.exit(1);
  }
})();
