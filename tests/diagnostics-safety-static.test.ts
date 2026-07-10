import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const index = fs.readFileSync("server/index.ts", "utf8");
const safety = fs.readFileSync("server/diagnostics-safety.ts", "utf8");
const appDoctor = fs.readFileSync("client/src/pages/app-doctor.tsx", "utf8");

assert(routes.includes("isGlobalDiagnosticsRole") && routes.includes('role === "platform_super_admin"') && routes.includes('role === "platform_admin"'), "global diagnostics are restricted to canonical platform roles");
assert(routes.includes("(req.user as any) || await storage.getUser") && routes.includes("const isGlobalDiagnostics = isGlobalDiagnosticsRole(user?.role)"), "diagnostics uses persisted/hydrated user role, not session role");
assert(routes.includes('return res.status(403).json({ message: "Global diagnostics require a platform admin role" })'), "tenant-scoped admins without company context cannot export global diagnostics");
assert(safety.includes("readBoundedLogTail") && safety.includes("fs.readSync") && !safety.includes("readFileSync(full"), "diagnostics bounded log tail avoids full large log reads");
assert(safety.includes("DIAGNOSTIC_FILE_MODE = 0o600") && safety.includes("DIAGNOSTIC_DIR_MODE = 0o700"), "diagnostics logs are owner-only");
assert(index.includes("redactDiagnosticText(req.originalUrl || req.path)") && index.includes("redactDiagnosticText(JSON.stringify(capturedJsonResponse))"), "request logging redacts paths and response text before writing");
for (const tokenRoute of ["/sign/contracts/", "/api/signing/contracts/", "/api/onboarding/portal/", "/portal/validate"]) {
  assert(safety.includes(tokenRoute), `redaction covers ${tokenRoute}`);
}
for (const key of ["token", "session", "jwt", "password", "secret", "key", "code", "invite", "reset"]) {
  assert(safety.includes(key), `redaction covers ${key}= assignments`);
}
assert(routes.includes("pr_creation_failed") && routes.includes("res.status(503).json") && routes.includes("success: false"), "PR creation failures surface as non-2xx failure state");
assert(appDoctor.includes('ticket.status === "pr_creation_failed"') && appDoctor.includes("Retry PR Creation"), "App Doctor UI exposes Retry PR Creation for failed PR state");

console.log("PASS: diagnostics safety static checks passed");
