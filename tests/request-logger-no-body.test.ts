/**
 * PR-E1 regression: the API access logger must never write response bodies,
 * query strings, or sensitive path values. Drives a real Express app over a
 * real socket with the production logger middleware and inspects every line
 * it emits. Also proves the logger does not alter API responses.
 *
 * Run: npx tsx tests/request-logger-no-body.test.ts
 */
import express from "express";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import { createRequestLogger, sanitizeLogPath, sanitizeRequestId } from "../server/request-logger";

let pass = 0;
let fail = 0;
function ok(name: string, result: boolean, detail?: string) {
  if (result) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// Synthetic values only — shaped like the real fields found in PM2 logs.
const SENSITIVE = {
  accountNumber: "000123456789",
  routingNumber: "021000021",
  ein: "12-3456789",
  taxId: "987-65-4321",
  ssn: "123-45-6789",
  firstName: "Zelda",
  lastName: "Quintanilla-Synthetic",
  email: "zelda.synthetic@example.test",
  grossPay: "48213.77",
  netPay: "39102.11",
  bankName: "Synthetic Credit Union",
};
const SECRET_QUERY = "tok_SYNTHETICsecretVALUE123";

const lines: string[] = [];
const app = express();
app.use((req, _res, next) => { (req as any).requestId = req.headers["x-request-id"] || "req_test123"; next(); });
app.use(createRequestLogger((line) => lines.push(line)));
app.get("/api/workers/:id", (_req, res) => res.json({ id: "w1", ...SENSITIVE }));
app.post("/api/payroll-runs", express.json(), (_req, res) => res.status(201).json({ items: [SENSITIVE, SENSITIVE] }));
app.get("/api/error", (_req, res) => res.status(500).json({ message: `failed for ${SENSITIVE.email} ${SENSITIVE.accountNumber}` }));
app.get("/api/text", (_req, res) => res.send(`ein=${SENSITIVE.ein}`));
app.get("/not-api", (_req, res) => res.json(SENSITIVE));

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const r1 = await fetch(`${base}/api/workers/w1?token=${SECRET_QUERY}&email=${encodeURIComponent(SENSITIVE.email)}&account=${SENSITIVE.accountNumber}`);
  const body1 = await r1.json();
  ok("API response body is unchanged by the logger", JSON.stringify(body1) === JSON.stringify({ id: "w1", ...SENSITIVE }));
  ok("API response status is unchanged by the logger", r1.status === 200);

  const r2 = await fetch(`${base}/api/payroll-runs`, { method: "POST", headers: { "content-type": "application/json", "x-request-id": "req_abc-123" }, body: JSON.stringify({ password: "hunter2-synthetic" }) });
  ok("POST response status unchanged", r2.status === 201 && (await r2.json()).items.length === 2);

  await fetch(`${base}/api/error`);
  await fetch(`${base}/api/text`);
  await fetch(`${base}/api/users/by-email/${encodeURIComponent(SENSITIVE.email)}`);
  await fetch(`${base}/api/bank/${SENSITIVE.accountNumber}/verify`);
  await fetch(`${base}/api/signing/contracts/SYNTHsigningTOKENabcdef123/view`);
  await fetch(`${base}/api/workers/w1`, { headers: { "x-request-id": "evil\tinjected value with spaces" } });
  await fetch(`${base}/not-api`);
  await new Promise((r) => setTimeout(r, 50));
  server.close();

  const all = lines.join("\n");
  ok("one log line per /api request, none for non-API", lines.length === 8, `got ${lines.length}`);
  for (const [k, v] of Object.entries(SENSITIVE)) {
    ok(`log never contains ${k}`, !all.includes(v), lines.find((l) => l.includes(v)));
  }
  ok("log never contains the query-string secret", !all.includes(SECRET_QUERY));
  ok("log never contains a query string at all", !all.includes("?"));
  ok("log never contains a request body value", !all.includes("hunter2"));
  ok("log never contains a signing token from the path", !all.includes("SYNTHsigningTOKENabcdef123"));
  ok("log never contains ' :: ' body separator", !all.includes(" :: "));
  ok("no line exceeds 300 chars", lines.every((l) => l.length <= 300));

  const first = lines[0];
  ok("line keeps method + sanitized route + status + duration + request id",
    /^GET \/api\/workers\/w1 200 in \d+ms rid=req_test123$/.test(first), first);
  ok("client-supplied well-formed request id is retained", lines[1].endsWith("rid=req_abc-123"), lines[1]);
  ok("malformed client request id is replaced, not echoed", lines[7].endsWith("rid=-") && !all.includes("injected"), lines[7]);
  ok("500 status is still recorded", lines[2].startsWith("GET /api/error 500 in "), lines[2]);
  ok("email path segment is masked", lines[4].includes("/api/users/by-email/[email]"), lines[4]);
  ok("long digit path segment is masked", lines[5].includes("/api/bank/[digits]/verify"), lines[5]);

  // Unit-level checks on the sanitizers.
  ok("sanitizeLogPath strips fragments", sanitizeLogPath("/api/x#token=abc") === "/api/x");
  ok("sanitizeLogPath removes control chars (log forging)", !/[\r\n]/.test(sanitizeLogPath("/api/x%0d%0aFAKE 200")));
  ok("sanitizeLogPath bounds length", sanitizeLogPath("/api/" + "a".repeat(5000)).length <= 201);
  ok("sanitizeRequestId rejects overlong ids", sanitizeRequestId("r".repeat(200)) === "-");

  // Static: server/index.ts wires this logger and no longer captures bodies.
  const indexTs = fs.readFileSync("server/index.ts", "utf8");
  ok("server/index.ts mounts createRequestLogger", indexTs.includes("app.use(createRequestLogger(log))"));
  ok("server/index.ts no longer monkey-patches res.json for logging", !indexTs.includes("res.json = function") && !indexTs.includes("capturedJsonResponse"));
  const loggerTs = fs.readFileSync("server/request-logger.ts", "utf8");
  ok("request-logger.ts never references res.json/res.send", !/res\.(json|send)\b/.test(loggerTs));

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
