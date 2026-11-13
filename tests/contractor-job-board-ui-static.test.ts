/**
 * Static wiring checks for the Contractor Hub Jobs section (job board UI).
 * Run: npx tsx tests/contractor-job-board-ui-static.test.ts
 */
import fs from "node:fs";

const hub = fs.readFileSync("client/src/pages/contractor-hub.tsx", "utf8");
const ui = fs.readFileSync("client/src/components/contractor-hub/job-board.tsx", "utf8");
const lib = fs.readFileSync("client/src/lib/job-board.ts", "utf8");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const qc = fs.readFileSync("client/src/lib/queryClient.ts", "utf8");
const service = fs.readFileSync("server/contractor-jobs/service.ts", "utf8");
const app = fs.readFileSync("client/src/App.tsx", "utf8");

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (!cond) { console.error(`FAIL: ${name}`, detail ?? ""); process.exit(1); }
  passed++;
  console.log(`PASS: ${name}`);
}

// ── Hub wiring ──────────────────────────────────────────────────────────────
ok("HubSection includes jobs", /type HubSection = "dashboard" \| "jobs" \|/.test(hub));
ok("Jobs nav item follows Overview", /\{ id: "dashboard", label: "Overview", icon: LayoutDashboard \},\n\s+\{ id: "jobs", label: "Jobs", icon: Briefcase \}/.test(hub));
ok("both ?section= allow-lists include jobs", (hub.match(/\["dashboard","jobs","proposals"/g) ?? []).length === 2);
ok("hub renders JobBoardSection for the jobs section", hub.includes('{section === "jobs" && (') && hub.includes("<JobBoardSection user={user} initialJobId={deepLinkJobId}"));
ok("notification deep links pass the posting id to the Jobs section", hub.includes('setDeepLinkJobId(s === "jobs" ? entityId : null);'));
ok("award → proposal deep link waits for the refetched proposal", hub.includes("setPendingProposalId(entityId)") && hub.includes("proposals.find(p => p.id === pendingProposalId)"));
ok("Overview shows the job board summary", hub.includes("<JobBoardSummaryCard mode={jobViews.canManage ? \"admin\" : \"contractor\"}"));

ok("hub is routed at /app/contractor-hub", app.includes('<Route path="/app/contractor-hub">'));
ok("job-board notification links use the routed /app/contractor-hub path", !/["`]\/contractor-hub\?/.test(service) && (service.match(/"\/app\/contractor-hub\?section=/g) ?? []).length >= 3);

// ── Transport: CSRF on every mutation, no bypass ────────────────────────────
ok("getCsrfToken is exported for multipart/header-bearing requests", qc.includes("export function getCsrfToken()"));
const jobSend = ui.slice(ui.indexOf("export async function jobSend"), ui.indexOf("function refreshJobBoard"));
ok("jobSend always echoes the CSRF cookie", jobSend.includes('headers["x-csrf-token"] = csrf'));
ok("jobSend sends credentials", jobSend.includes('credentials: "include"'));
const fetchCalls = ui.match(/\bfetch\(/g) ?? [];
ok("only jobGet and jobSend call fetch", fetchCalls.length === 2, fetchCalls.length);
ok("no apiRequest/raw mutation path in the job board UI", !ui.includes("apiRequest(") && (ui.match(/\{ method[,:]/g) ?? []).length === 1);
ok("UI never issues DELETE or PUT", !/jobSend\(\s*"(DELETE|PUT)"/.test(ui) && !/"DELETE"|"PUT"/.test(ui));
ok("award carries an Idempotency-Key", /award`, \{ json: \{\}, headers: \{ "Idempotency-Key": key \} \}/.test(ui));
ok("award key is created once per dialog (reused on retry)", ui.includes("const [key] = useState(newIdempotencyKey);"));
ok("attachments download through the authenticated route, never /uploads", ui.includes("/api/contractor-job-attachments/${a.id}/download") && !ui.includes("/uploads"));
ok("no browser storage of job-board data", !/localStorage|sessionStorage/.test(ui));

// ── Every endpoint the UI calls is a real route with the right method ───────
const routeSet = new Set<string>();
for (const m of routes.matchAll(/app\.(get|post|patch)\("(\/api\/contractor-job[^"]*)"/g)) {
  routeSet.add(`${m[1].toUpperCase()} ${m[2].replace(/:\w+/g, ":p")}`);
}
const norm = (u: string) => u.replace(/\$\{[^}]+\}/g, ":p").replace(/\?.*$/, "");
const used: string[] = [];
for (const m of ui.matchAll(/jobGet(?:<[^>]+>)?\(`([^`]+)`/g)) used.push(`GET ${norm(m[1])}`);
for (const m of ui.matchAll(/jobGet(?:<[^>]+>)?\("([^"]+)"/g)) used.push(`GET ${norm(m[1])}`);
for (const m of ui.matchAll(/jobSend(?:<[^>]+>)?\("(POST|PATCH)", `([^`]+)`/g)) used.push(`${m[1]} ${norm(m[2])}`);
for (const m of ui.matchAll(/jobSend(?:<[^>]+>)?\("(POST|PATCH)", "([^"]+)"/g)) used.push(`${m[1]} ${norm(m[2])}`);
ok("found the UI's job-board calls", used.filter((u) => u.includes("/api/contractor-job")).length >= 20, used);
// Bid review actions are built as /${action.replace("_", "-")}: expand them.
const expanded = used.flatMap((u) => u.endsWith("/:p/:p") && u.startsWith("POST /api/contractor-job-bids")
  ? ["review", "shortlist", "request-revision", "reject"].map((a) => `POST /api/contractor-job-bids/:p/${a}`)
  : u === "POST /api/contractor-jobs/:p/:p"
    ? ["publish", "pause", "reopen", "close", "archive"].map((a) => `POST /api/contractor-jobs/:p/${a}`)
    : [u]);
for (const u of expanded.filter((x) => x.includes("/api/contractor-job"))) {
  ok(`route exists: ${u}`, routeSet.has(u));
}
// Calls the extractor cannot see (multi-line award call, upload URLs passed through useUpload).
for (const [route, needle] of [
  ["POST /api/contractor-job-bids/:p/award", '"POST", `/api/contractor-job-bids/${bid.id}/award`'],
  ["POST /api/contractor-jobs/:p/attachments", "useUpload(() => `/api/contractor-jobs/${postId}/attachments`)"],
  ["POST /api/contractor-job-bids/:p/attachments", "useUpload(() => `/api/contractor-job-bids/${existing!.id}/attachments`)"],
  ["GET /api/contractor-job-attachments/:p/download", "`${API_BASE_URL}/api/contractor-job-attachments/${a.id}/download`"],
] as const) {
  ok(`route exists and is used: ${route}`, routeSet.has(route) && ui.includes(needle));
}
const useUploadBody = ui.slice(ui.indexOf("function useUpload("), ui.indexOf("function useRemoveAttachment"));
ok("uploads go through jobSend (CSRF)", useUploadBody.includes('jobSend("POST", urlFor(), { form: fd })'));
ok("bid review action → path mapping matches the routes", ui.includes('`/api/contractor-job-bids/${bid.id}/${action.replace("_", "-")}`'));
ok("posting transition path is built from POST_ACTIONS", ui.includes("`/api/contractor-jobs/${postId}/${action}`"));

// ── Competitor privacy in the contractor view ───────────────────────────────
const contractorUi = ui.slice(ui.indexOf("function ContractorJobBoard"), ui.indexOf("// Dashboard summary"));
ok("contractor view never reads another bid list (only its own /mine)", !/jobGet[^(]*\(`[^`]*\/bids`/.test(contractorUi) && contractorUi.includes('"/api/contractor-job-bids/mine"'));
ok("contractor view never renders contractorName", !contractorUi.includes("contractorName"));
ok("contractor view never calls events/invitations endpoints", !contractorUi.includes("/events") && !contractorUi.includes("/invitations"));
ok("feature-off 503 has a friendly state", ui.includes("status === 503") && ui.includes("The job board isn't enabled yet"));

// ── Pure logic lives outside React so tests can import it ───────────────────
ok("lib/job-board.ts has no React import", !/from "react"/.test(lib));
ok("lib documents the server mirror", lib.includes("mirror the server state machines"));

console.log(`\nContractor job board UI static: ${passed} checks passed.`);
