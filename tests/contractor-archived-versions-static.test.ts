import fs from "node:fs";
import assert from "node:assert/strict";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const hub = fs.readFileSync("client/src/pages/contractor-hub.tsx", "utf8");

assert(routes.includes('app.get("/api/contractor-documents/:entityType/:id/archived-versions"'), "archived version API endpoint exists");
assert(routes.includes('if (!isCompanyRep && row.contractor_id !== workerId) return null'), "contractor ownership enforced for proposal/contract/invoice archived versions");
assert(routes.includes('canAccessCompany(user, row.company_id)'), "company access is enforced for archived versions");
assert(routes.includes('canAccessCompany(user, doc.company_id)'), "DAM view/download access uses shared company access helper");
assert(routes.includes('doc.related_contractor_id !== workerId'), "DAM access allows authorized related contractors while blocking unrelated contractors");
assert(routes.includes('Archived document versions are read-only'), "archived DAM versions are server-side read-only");
assert(routes.includes('FROM dam_documents') && routes.includes('is_archived') && routes.includes('downloadUrl: `/api/dam-documents/${d.id}/download`'), "DAM archived/final packets are included with download URLs");
assert(hub.includes('Version History') && hub.includes('Archived') && hub.includes('Read-only'), "UI exposes version history with archived/read-only markers");
assert(hub.includes('btn-view-archived-version') && hub.includes('btn-download-archived-version'), "UI exposes view and download actions for archived versions");
assert(hub.includes('hasVersions: true') && hub.includes('type: doc.type === "file" ? "dam"'), "proposals/contracts/invoices/DAM files can open version history");
assert(hub.includes('Current</span>'), "current version is visually marked");

console.log("contractor archived versions static checks passed");
