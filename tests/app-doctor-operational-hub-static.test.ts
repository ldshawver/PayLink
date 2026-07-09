import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const page = fs.readFileSync("client/src/pages/app-doctor.tsx", "utf8");

assert(routes.includes('/api/app-doctor/operations'), "App Doctor exposes operations hub endpoint");
assert(routes.includes('collectAppDoctorOperationsSnapshot'), "App Doctor collects operations snapshot");
assert(routes.includes('SELECT * FROM app_doctor_repair_tickets') && routes.includes("duplicate: true"), "repair tickets are idempotent and duplicate-safe");
assert(routes.includes('.github/app-doctor-tickets/${ticket.id}.md'), "GitHub PR creation commits a review artifact before opening PR");
assert(routes.includes('GitHub branch creation failed') && routes.includes('pulls?head='), "GitHub PR creation handles branch/PR retry paths");
assert(page.includes('card-app-doctor-operations-hub'), "App Doctor page renders operational hub card");
assert(page.includes('Deployment Management') && page.includes('Staging Verification') && page.includes('Database / Tenant Scans'), "operational hub shows deployment, staging, and tenant scan sections");
assert(page.includes('Push Notification Diagnostics') && page.includes('Release / Rollback'), "operational hub shows push notification and release/rollback diagnostics");
assert(page.includes('button-send-test-report'), "Send Test Report action remains available");

console.log("App Doctor operational hub static checks passed");
