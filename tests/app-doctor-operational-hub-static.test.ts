/**
 * Static regression checks for the App Doctor operational hub.
 * Run: npx tsx tests/app-doctor-operational-hub-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const appDoctor = fs.readFileSync("client/src/pages/app-doctor.tsx", "utf8");

assert(routes.includes('app.get("/api/app-doctor/diagnostics"'), "diagnostics endpoint is registered");
assert(routes.includes('app.get("/api/app-doctor/reports"') && routes.includes('app.post("/api/app-doctor/reports"'), "report list/create routes are preserved");
assert(routes.includes('app.get("/api/app-doctor/repair-tickets"') && routes.includes('app.post("/api/app-doctor/repair-tickets"'), "repair-ticket list/create routes are preserved");
assert(routes.includes('app.post("/api/app-doctor/repair-tickets/:id/create-pr"') && routes.includes("pr_creation_failed"), "PR creation and retry failure state are preserved");
assert(routes.includes('source: "app_doctor_self_test"') || appDoctor.includes('source: "app_doctor_self_test"'), "Send Test Report still creates self-test reports");
assert(appDoctor.includes('data-testid="button-send-test-report"') && appDoctor.includes('isPlatform && !selectedCompanyId'), "Send Test Report permission/scope guard is preserved");
assert(appDoctor.includes('data-testid="card-documenso-contract-diagnostics"'), "Documenso diagnostics card is preserved in the operational hub");
assert(appDoctor.includes("Retry PR Creation") && appDoctor.includes('ticket.status === "pr_creation_failed"'), "PR retry action is visible for failed PR creation");
assert(routes.includes("isGlobalDiagnosticsRole") && routes.includes("Global diagnostics require a platform admin role"), "global diagnostics role guard is preserved");

console.log("PASS: App Doctor operational hub static checks passed");
