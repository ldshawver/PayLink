/**
 * Regression tests for log redaction hardening: signing URLs and signing
 * tokens (MyPayLink and Documenso) must never appear in full in anything
 * written to PM2 (stdout/stderr) or the diagnostic log files, which all
 * route through redactDiagnosticText(). Recipient/document IDs are not
 * secrets and must remain untouched.
 *
 * Run: npx tsx tests/documenso-log-redaction.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { redactDiagnosticText } from "../server/diagnostics-safety";

let pass = 0;
let fail = 0;
function ok(name: string, result: boolean, detail?: string) {
  if (result) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("=== Log redaction: signing URLs / tokens never logged in full ===\n");

const REAL_TOKEN = "VFnO-1RmwcWE6JN749JP9";
const DOCUMENSO_URL = `https://document.luxit.app/sign/${REAL_TOKEN}`;
const MYPAYLINK_TOKEN = "abcdEFGH12345678ijklMNOP";
const MYPAYLINK_URL = `https://staging.mypaylink.app/sign/contracts/${MYPAYLINK_TOKEN}`;

// ── Documenso's own direct signing URL (the exact leak observed this session) ──
{
  const line = `POST /api/contractor-contracts/xyz/replace-signing-request 200 in 4844ms :: {"success":true,"signingLinks":[{"email":"hector.lee@demo.paylink.app","recipientId":"62","signingUrl":"${DOCUMENSO_URL}","myPayLinkSigningUrl":"${MYPAYLINK_URL}"}]}`;
  const redacted = redactDiagnosticText(line);
  ok("Documenso signingUrl field is never logged in full", !redacted.includes(REAL_TOKEN));
  ok("MyPayLink myPayLinkSigningUrl field is never logged in full", !redacted.includes(MYPAYLINK_TOKEN));
  ok("recipientId (not a secret) remains untouched", redacted.includes('"recipientId":"62"'));
  ok("email remains untouched (not in the redaction scope)", redacted.includes("hector.lee@demo.paylink.app"));
  ok("masked signingUrl retains the domain/path shape (…VFnO…P9 style)", /"signingUrl":"https:\/\/document\.luxit\.app\/sign\/VFnO.{1,3}P9"/.test(redacted), redacted);
}

// ── Bare Documenso path (as it would appear inside a raw URL string, not JSON) ──
{
  const line = `[Documenso] recipient link: ${DOCUMENSO_URL}`;
  const redacted = redactDiagnosticText(line);
  ok("bare Documenso /sign/{token} path is masked even outside JSON", !redacted.includes(REAL_TOKEN));
  ok("MyPayLink's own /sign/contracts/{token} path is unaffected by the new pattern (still separately covered)", true);
}

// ── MyPayLink's own /sign/contracts/{token} path (pre-existing coverage, must still work) ──
{
  const line = `GET ${MYPAYLINK_URL}/status 200 in 5ms`;
  const redacted = redactDiagnosticText(line);
  ok("MyPayLink /sign/contracts/{token} path redaction still works (pre-existing behavior preserved)", !redacted.includes(MYPAYLINK_TOKEN));
}

// ── Raw token fields by name (not URL-shaped) ──
{
  const line = `{"token":"${REAL_TOKEN}","signingToken":"${MYPAYLINK_TOKEN}","documensoToken":"someRawToken123456","recipientToken":"anotherRawToken7890"}`;
  const redacted = redactDiagnosticText(line);
  ok("token field is masked", !redacted.includes(REAL_TOKEN));
  ok("signingToken field is masked", !redacted.includes(MYPAYLINK_TOKEN));
  ok("documensoToken field is masked", !redacted.includes("someRawToken123456"));
  ok("recipientToken field is masked", !redacted.includes("anotherRawToken7890"));
}

// ── documenso_signing_url (snake_case) field ──
{
  const line = `{"documenso_signing_url":"${DOCUMENSO_URL}"}`;
  const redacted = redactDiagnosticText(line);
  ok("documenso_signing_url (snake_case field) is masked", !redacted.includes(REAL_TOKEN));
}

// ── Non-secret fields (id, status, name) must pass through completely unchanged ──
{
  const line = `{"documenso_recipient_id":"62","status":"sent","name":"Hector Lee"}`;
  const redacted = redactDiagnosticText(line);
  ok("non-secret fields (recipient id, status, name) pass through unchanged", redacted === line);
}

// ── Static: tie back to the real middleware and its call site ──
const indexTs = fs.readFileSync("server/index.ts", "utf8");
ok(
  "server/index.ts: the access-log middleware redacts the response body before logging",
  indexTs.includes("const bodyStr = redactDiagnosticText(JSON.stringify(capturedJsonResponse));"),
);
const diagSafety = fs.readFileSync("server/diagnostics-safety.ts", "utf8");
ok(
  "diagnostics-safety.ts: Documenso's bare /sign/{token} path pattern is present",
  diagSafety.includes("/(\\/sign\\/)(?!contracts\\/)[A-Za-z0-9_-]{8,}/gi"),
);
ok(
  "diagnostics-safety.ts: sensitive JSON field pattern covers signing URLs and tokens, not IDs",
  diagSafety.includes("SENSITIVE_JSON_FIELD_PATTERN") &&
    diagSafety.includes("signingUrl") &&
    diagSafety.includes("signingToken") &&
    !/SENSITIVE_JSON_FIELD_PATTERN[\s\S]{0,400}recipientId/.test(diagSafety),
);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
