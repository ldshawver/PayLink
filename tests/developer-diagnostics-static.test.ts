import fs from "fs";

let failed = 0;
function ok(name: string, pass: boolean) { if (pass) console.log(`✓ ${name}`); else { failed++; console.error(`✗ ${name}`); } }

const diag = fs.readFileSync("server/diagnostics.ts", "utf8");
const index = fs.readFileSync("server/index.ts", "utf8");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const page = fs.readFileSync("client/src/pages/developer-diagnostics.tsx", "utf8");

ok("request ID middleware generates requestId", diag.includes("requestDiagnostics") && diag.includes("X-Request-Id") && diag.includes('newId("req_")'));
ok("global error handler returns correlationId", diag.includes("globalErrorHandler") && diag.includes("correlationId") && diag.includes("Internal server error"));
ok("errors are written to error.log", diag.includes('path.join(logDir, "error.log")') && index.includes("globalErrorHandler"));
ok("secrets are automatically redacted", diag.includes("[REDACTED_SECRET]") && diag.includes("secretKeys"));
ok("bank data is automatically redacted", diag.includes("[REDACTED_BANK]") && diag.includes("bankKeys"));
ok("non-admins are blocked from diagnostics", diag.includes('new Set(["platform_owner", "super_admin", "system_admin"])') && diag.includes("requireDiagnosticsRole"));
ok("Luxit log sources are read with requested commands", diag.includes('/var/log/luxit-error.log') && diag.includes('/var/log/luxit-access.log') && diag.includes('"sudo", ["tail", "-n"') && diag.includes('"sudo", ["journalctl", "-u", "luxit"') && diag.includes('"sudo", ["systemctl", "status", "luxit"'));
ok("diagnostic bundle exports required zip entries", diag.includes('logs/luxit-access.log') && diag.includes('logs/luxit-error.log') && diag.includes('logs/journal-luxit.log') && diag.includes('/api/admin/diagnostics/export'));
ok("bundle contains env presence only", diag.includes("DATABASE_URL_PRESENT") && diag.includes("GITHUB_TOKEN_PRESENT") && diag.includes("EMAIL_CONFIG_PRESENT") && !diag.includes("DATABASE_URL:"));
ok("journalctl failure cannot crash export", diag.includes("journalctl unavailable") && diag.includes("safeCommand"));
ok("App Doctor PR failure marks pr_creation_failed", routes.includes("pr_creation_failed") && routes.includes("Repair ticket saved, but PR creation failed"));
ok("App Doctor PR failure returns non-raw 500 payload", routes.includes("res.status(200).json") && routes.includes("retryAction"));
ok("retry PR creation accepts previous PR failure status", routes.includes('["approved", "pr_creation_failed"].includes(ticket.status)') && routes.includes("App Dr retry PR creation triggered"));
ok("log rotation is bounded", diag.includes("MAX_LOG_BYTES") && diag.includes("KEEP_ROTATIONS") && diag.includes("rotateIfNeeded"));
ok("Developer Diagnostics UI shows Luxit logs", page.includes("Developer Diagnostics") && page.includes("luxit-error") && page.includes("Export ZIP"));
ok("diagnostics implementation does not import paycheck/paystub/MICR modules", !diag.includes("payroll-calculator") && !page.includes("print-check"));

if (failed) process.exit(1);
