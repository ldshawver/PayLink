/**
 * Static regression checks for the App Doctor operational hub.
 * Run: npx tsx tests/app-doctor-operational-hub-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const page = fs.readFileSync("client/src/pages/app-doctor.tsx", "utf8");

for (const [file, content] of [
  ["server/routes.ts", routes],
  ["client/src/pages/app-doctor.tsx", page],
] as const) {
  assert(!new RegExp("^(" + "<{7}" + "|={7}|" + ">{7}" + ")$", "m").test(content), `${file} has no unresolved merge conflict markers`);
}

assert(routes.includes('app.get("/api/app-doctor/diagnostics"'), "diagnostics endpoint is registered");
assert(routes.includes('app.get("/api/app-doctor/reports"') && routes.includes('app.post("/api/app-doctor/reports"'), "report list/create routes are preserved");
assert(routes.includes('app.get("/api/app-doctor/repair-tickets"') && routes.includes('app.post("/api/app-doctor/repair-tickets"'), "repair-ticket list/create routes are preserved");
assert(routes.includes('app.post("/api/app-doctor/repair-tickets/:id/create-pr"') && routes.includes("pr_creation_failed"), "PR creation and retry failure state are preserved");
assert(routes.includes('source: "app_doctor_self_test"') || page.includes('source: "app_doctor_self_test"'), "Send Test Report still creates self-test reports");
assert(page.includes('data-testid="button-send-test-report"') && page.includes('isPlatform && !selectedCompanyId'), "Send Test Report permission/scope guard is preserved");
assert(page.includes('data-testid="card-documenso-contract-diagnostics"'), "Documenso diagnostics card is preserved in the operational hub");
assert(page.includes("Retry PR Creation") && page.includes('ticket.status === "pr_creation_failed"'), "PR retry action is visible for failed PR creation");
assert(routes.includes("isGlobalDiagnosticsRole") && routes.includes("Global diagnostics require a platform admin role"), "global diagnostics role guard is preserved");
assert(routes.includes("documenso") && routes.includes("duplicateEmails") && routes.includes("possibleIdentityMismatches"), "Documenso diagnostics resend fixes are preserved");
assert(!routes.includes("<".repeat(7)) && !routes.includes(">".repeat(7)), "server/routes.ts is conflict-marker free after resolution");

assert(routes.includes('/api/app-doctor/operations'), "App Doctor exposes operations hub endpoint");
assert(routes.includes('collectAppDoctorOperationsSnapshot'), "App Doctor collects operations snapshot");
assert(routes.includes('SELECT * FROM app_doctor_repair_tickets') && routes.includes("duplicate: true"), "repair tickets are idempotent and duplicate-safe");
assert(routes.includes('.github/app-doctor-tickets/${ticket.id}.md'), "GitHub PR creation commits a review artifact before opening PR");
assert(routes.includes('GitHub branch creation failed') && routes.includes('pulls?head='), "GitHub PR creation handles branch/PR retry paths");
assert(page.includes('card-app-doctor-operations-hub'), "App Doctor page renders operational hub card");
assert(page.includes('Deployment Management') && page.includes('Staging Verification') && page.includes('Database / Tenant Scans'), "operational hub shows deployment, staging, and tenant scan sections");
assert(page.includes('Push Notification Diagnostics') && page.includes('Release / Rollback'), "operational hub shows push notification and release/rollback diagnostics");
assert(page.includes('button-send-test-report'), "Send Test Report action remains available");

console.log("PASS: App Doctor operational hub static checks passed");
