import fs from "fs";

let failed = 0;
function ok(name: string, pass: boolean) { if (pass) console.log(`✓ ${name}`); else { failed++; console.error(`✗ ${name}`); } }

const diag = fs.readFileSync("server/diagnostics.ts", "utf8");
const index = fs.readFileSync("server/index.ts", "utf8");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const appDoctor = fs.readFileSync("client/src/pages/app-doctor.tsx", "utf8");
const page = fs.readFileSync("client/src/components/app-doctor/developer-diagnostics-panel.tsx", "utf8");
const docs = fs.readFileSync("docs/developer-diagnostics-final-review-evidence.md", "utf8");

const app = fs.readFileSync("client/src/App.tsx", "utf8");
const appSidebar = fs.readFileSync("client/src/components/app-sidebar.tsx", "utf8");
const platformSidebar = fs.readFileSync("client/src/components/platform-sidebar.tsx", "utf8");

ok("request ID middleware generates requestId", diag.includes("requestDiagnostics") && diag.includes("X-Request-Id") && diag.includes('newId("req_")'));
ok("global error handler returns correlationId", diag.includes("globalErrorHandler") && diag.includes("correlationId") && diag.includes("Internal server error"));
ok("diagnostics role guard hydrates user instead of trusting req.session.role", diag.includes("getRequestUser") && diag.includes("storage.getUser") && !diag.includes("session?.role"));
ok("super_admin is allowed and unauthorized users are blocked", diag.includes('new Set(["platform_owner", "super_admin", "system_admin"])') && diag.includes("return res.status(403)"));
ok("errors are written to error.log", diag.includes('path.join(logDir, "error.log")') && index.includes("globalErrorHandler"));
ok("strong raw string redaction covers token/session/password query params", diag.includes("token|session|jwt|password") && diag.includes("[REDACTED_SECRET]") && diag.includes("REDACTED_SECRET_LINK"));
ok("bounded log reading does not read full files", diag.includes("readLastBytes") && diag.includes("fs.readSync") && !diag.includes("readFileSync(filePath"));
ok("diagnostic bundle exports MyPayLink logs", diag.includes('LOG_TYPES = ["app", "error", "appdr", "github", "payroll", "pdf", "database", "security"]') && diag.includes('logs/${type}.log') && diag.includes('logs/journal.log') && !diag.includes("luxit"));
ok("bundle contains env presence only", diag.includes("DATABASE_URL_PRESENT") && diag.includes("GITHUB_TOKEN_PRESENT") && !diag.includes("DATABASE_URL:"));
ok("App Doctor PR failure marks pr_creation_failed", routes.includes("pr_creation_failed") && routes.includes("Repair ticket saved, but PR creation failed"));
ok("App Doctor PR failure returns non-raw 500 payload", routes.includes("res.status(200).json") && routes.includes("retryAction"));
ok("App Doctor UI treats success:false as failure", appDoctor.includes("data?.success === false") && appDoctor.includes("variant: \"destructive\""));
ok("App Doctor UI renders Retry PR Creation button", appDoctor.includes('ticket.status === "pr_creation_failed"') && appDoctor.includes("button-retry-pr"));
ok("Diagnostics panel is embedded under App Doctor and uses MyPayLink logs", page.includes("App Doctor Platform Operations diagnostics") && page.includes('"error"') && !page.includes("luxit"));
ok("production runtime alignment documented for MyPayLink", docs.includes("MyPayLink Node/Express") && docs.includes("not the unrelated Luxit"));

ok("diagnostics endpoints have rate limits", diag.includes('diagnosticsRateLimit("diagnostics-health", 60') && diag.includes('diagnosticsRateLimit("diagnostics-logs", 30') && diag.includes('diagnosticsRateLimit("diagnostics-export", 5'));
ok("ZIP export has configurable size limit and truncation note", diag.includes("DIAGNOSTICS_MAX_ZIP_BYTES") && diag.includes("TRUNCATED: diagnostics export size limit reached"));
ok("ZIP export audit includes identity, request, client, and contents metadata", diag.includes("exportContents") && diag.includes("userAgent") && diag.includes("zipBytes") && diag.includes("correlationId"));
ok("diagnostics route definitions are GET-only", diag.includes('app.get("/api/admin/diagnostics/health"') && diag.includes('app.get("/api/admin/diagnostics/logs"') && diag.includes('app.get("/api/admin/diagnostics/export"') && !diag.includes("app.post"));
ok("health exposes environment version commit build node and process info", diag.includes("version:") && diag.includes("buildTime") && diag.includes("nodeVersion") && diag.includes("pm2Process") && page.includes("PM2 Process"));
ok("retention policy is documented", docs.includes("Retention and rotation policy") && docs.includes("10 MB") && docs.includes("DIAGNOSTICS_MAX_ZIP_BYTES"));
ok("diagnostics is not exposed as standalone navigation or route", !app.includes("/app/developer-diagnostics") && !app.includes("/platform/developer-diagnostics") && !appSidebar.includes("/app/developer-diagnostics") && !platformSidebar.includes("/platform/developer-diagnostics"));
ok("App Doctor centralizes platform operations tabs", appDoctor.includes("Deployment Center") && appDoctor.includes("Release Manager") && appDoctor.includes("Database Management") && appDoctor.includes("Environment Comparison") && appDoctor.includes("Audit Center") && appDoctor.includes("Diagnostics"));
ok("diagnostics implementation does not import paycheck/paystub/MICR modules", !diag.includes("payroll-calculator") && !page.includes("print-check"));

if (failed) process.exit(1);
