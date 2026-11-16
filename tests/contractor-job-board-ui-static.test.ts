/**
 * Static wiring checks for the Contractor Hub Jobs section (job board UI):
 * hub wiring, CSRF transport, every called endpoint exists, the two paths
 * stay separate on screen, and candidates never see each other.
 * Run: npx tsx tests/contractor-job-board-ui-static.test.ts
 */
import fs from "node:fs";

const hub = fs.readFileSync("client/src/pages/contractor-hub.tsx", "utf8");
const ui = fs.readFileSync("client/src/components/contractor-hub/job-board.tsx", "utf8");
const lib = fs.readFileSync("client/src/lib/job-board.ts", "utf8");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const qc = fs.readFileSync("client/src/lib/queryClient.ts", "utf8");
const service = fs.readFileSync("server/job-board/service.ts", "utf8");
const app = fs.readFileSync("client/src/App.tsx", "utf8");

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (!cond) { console.error(`FAIL: ${name}`, detail ?? ""); process.exit(1); }
  passed++;
  console.log(`PASS: ${name}`);
}
const between = (a: string, b: string) => {
  const s = ui.indexOf(a); const e = ui.indexOf(b, s + 1);
  if (s < 0 || e < 0) throw new Error(`markers not found: ${a} / ${b}`);
  return ui.slice(s, e);
};

// ── Hub wiring ──────────────────────────────────────────────────────────────
ok("HubSection includes jobs", /type HubSection = "dashboard" \| "jobs" \|/.test(hub));
ok("Jobs nav item follows Overview", /\{ id: "dashboard", label: "Overview", icon: LayoutDashboard \},\n\s+\{ id: "jobs", label: "Jobs", icon: Briefcase \}/.test(hub));
ok("both ?section= allow-lists include jobs", (hub.match(/\["dashboard","jobs","proposals"/g) ?? []).length === 2);
ok("hub renders JobBoardSection for the jobs section", hub.includes('{section === "jobs" && (') && hub.includes("<JobBoardSection user={user} initialJobId={deepLinkJobId}"));
ok("notification deep links pass the posting id to the Jobs section", hub.includes('setDeepLinkJobId(s === "jobs" ? entityId : null);'));
ok("award → proposal deep link waits for the refetched proposal", hub.includes("setPendingProposalId(entityId)") && hub.includes("proposals.find(p => p.id === pendingProposalId)"));
ok("Overview shows the job board summary for admins and any worker", hub.includes("(jobViews.canManage || jobViews.canBrowse)") && hub.includes('<JobBoardSummaryCard mode={jobViews.canManage ? "admin" : "worker"}'));
ok("hub is routed at /app/contractor-hub", app.includes('<Route path="/app/contractor-hub">'));
ok("job-board notification links use the routed /app/contractor-hub path", !/["`]\/contractor-hub\?/.test(service) && (service.match(/"\/app\/contractor-hub\?section=/g) ?? []).length >= 3);

// ── Transport: CSRF on every mutation, no bypass ────────────────────────────
ok("getCsrfToken is exported for multipart/header-bearing requests", qc.includes("export function getCsrfToken()"));
const jobSend = between("export async function jobSend", "function refreshJobBoard");
ok("jobSend always echoes the CSRF cookie", jobSend.includes('headers["x-csrf-token"] = csrf'));
ok("jobSend sends credentials", jobSend.includes('credentials: "include"'));
ok("only jobGet and jobSend call fetch", (ui.match(/\bfetch\(/g) ?? []).length === 2);
ok("no apiRequest/raw mutation path in the job board UI", !ui.includes("apiRequest(") && (ui.match(/\{ method[,:]/g) ?? []).length === 1);
ok("UI never issues DELETE or PUT", !/"DELETE"|"PUT"/.test(ui));
ok("award carries an Idempotency-Key", /award`, \{ json: \{\}, headers: \{ "Idempotency-Key": key \} \}/.test(ui));
ok("award key is created once per dialog (reused on retry)", ui.includes("const [key] = useState(newIdempotencyKey);"));
ok("posting files download through the authenticated route, never /uploads", ui.includes("/api/job-post-attachments/${a.id}/download") && !ui.includes("/uploads"));
ok("résumés download through the private HR route", ui.includes("/api/employment-application-documents/${d.id}/download"));
ok("no browser storage of job-board data", !/localStorage|sessionStorage/.test(ui));
const useUploadBody = between("function useUpload(", "function useRemove(");
ok("uploads go through jobSend (CSRF)", useUploadBody.includes('jobSend("POST", urlFor(), { form: fd })'));

// ── Every endpoint the UI calls is a real route with the right method ───────
const routeSet = new Set<string>();
for (const m of routes.matchAll(/app\.(get|post|patch)\("(\/api\/(?:job-post|contractor-job|employment-application|job-screening)[^"]*)"/g)) {
  routeSet.add(`${m[1].toUpperCase()} ${m[2].replace(/:\w+/g, ":p")}`);
}
const norm = (u: string) => u.replace(/\$\{[^}]+\}/g, ":p").replace(/\?.*$/, "");
const used: string[] = [];
for (const m of ui.matchAll(/jobGet(?:<[^>]+>)?\(`([^`]+)`/g)) used.push(`GET ${norm(m[1])}`);
for (const m of ui.matchAll(/jobGet(?:<[^>]+>)?\("([^"]+)"/g)) used.push(`GET ${norm(m[1])}`);
for (const m of ui.matchAll(/jobSend(?:<[^>]+>)?\("(POST|PATCH)", `([^`]+)`/g)) used.push(`${m[1]} ${norm(m[2])}`);
for (const m of ui.matchAll(/jobSend(?:<[^>]+>)?\("(POST|PATCH)", "([^"]+)"/g)) used.push(`${m[1]} ${norm(m[2])}`);
const jb = used.filter((u) => /\/api\/(job-post|contractor-job|employment-application|job-screening)/.test(u));
ok("found the UI's job-board calls", jb.length >= 30, jb);
const expanded = jb.flatMap((u) => u === "POST /api/contractor-job-bids/:p/:p"
  ? ["review", "shortlist", "request-revision", "reject"].map((a) => `POST /api/contractor-job-bids/:p/${a}`)
  : u === "POST /api/job-posts/:p/:p"
    ? ["publish", "pause", "reopen", "close", "archive"].map((a) => `POST /api/job-posts/:p/${a}`)
    : u === "POST /api/employment-applications/:p/:p"
      ? ["review", "interview", "offer", "hire", "reject"].map((a) => `POST /api/employment-applications/:p/${a}`)
      : [u]);
for (const u of expanded) ok(`route exists: ${u}`, routeSet.has(u));
// Calls the extractor cannot see (multi-line calls, URLs passed through helpers).
for (const [route, needle] of [
  ["POST /api/contractor-job-bids/:p/award", '"POST", `/api/contractor-job-bids/${bid.id}/award`'],
  ["POST /api/job-posts/:p/attachments", "useUpload(() => `/api/job-posts/${postId}/attachments`)"],
  ["POST /api/contractor-job-bids/:p/attachments", "useUpload(() => `/api/contractor-job-bids/${existing!.id}/attachments`)"],
  ["POST /api/employment-applications/:p/documents", "useUpload(() => `/api/employment-applications/${existing!.id}/documents`, { documentType: \"resume\" })"],
  ["POST /api/job-post-attachments/:p/remove", "useRemove((id) => `/api/job-post-attachments/${id}/remove`)"],
  ["POST /api/employment-application-documents/:p/remove", "useRemove((id) => `/api/employment-application-documents/${id}/remove`)"],
  ["GET /api/job-post-attachments/:p/download", "`${API_BASE_URL}/api/job-post-attachments/${a.id}/download`"],
  ["GET /api/employment-application-documents/:p/download", "`${API_BASE_URL}/api/employment-application-documents/${d.id}/download`"],
  ["POST /api/employment-applications/:p/convert-to-worker", "`/api/employment-applications/${app.id}/convert-to-worker`"],
] as const) {
  ok(`route exists and is used: ${route}`, routeSet.has(route) && ui.includes(needle));
}
ok("proposal review action → path mapping matches the routes", ui.includes('`/api/contractor-job-bids/${bid.id}/${action.replace("_", "-")}`'));
ok("posting transition path is built from POST_ACTIONS", ui.includes("`/api/job-posts/${postId}/${action}`"));
ok("application steps post to explicit transition routes", ui.includes("`/api/employment-applications/${app.id}/${action}`"));

// ── Two paths, clearly separated on screen ──────────────────────────────────
ok("create starts with Contractor Work vs Employee Position", ui.includes('testId="choice-classification-contractor"') && ui.includes('testId="choice-classification-employee"')
  && ui.indexOf('"choice-classification-contractor"') < ui.indexOf("`choice-schedule-${s}`"));
ok("the button is labelled Create Posting", ui.includes("Create Posting"));
ok("classification badge on every card and header", between("function PostCard(", "// ═══").includes("<ClassificationBadge post={post} />")
  && (ui.match(/<ClassificationBadge post=\{p\} size="lg" \/>/g) ?? []).length === 2);
ok("card CTA uses the server-derived label (Submit Proposal / Apply)", ui.includes("{post.cta}"));
ok("contractor form submits with 'Submit Proposal'", between("function ContractorBidPanel(", "function ApplicationPanel(").includes('"Submit Proposal"'));
ok("employee form submits with 'Apply'", between("function ApplicationPanel(", "function ContractorQuestionsPanel(").includes("<UserCheck className=\"h-4 w-4 mr-1\" />Apply"));
ok("admin sheet shows Proposals OR Applications by classification", ui.includes('{employee ? <AdminApplicationsPanel post={p} /> : <AdminBidsPanel post={p} onNavigate={onNavigate} />}'));
ok("worker sheet shows the proposal form OR the application form by classification", ui.includes("{employee ? <ApplicationPanel post={p} /> : <ContractorBidPanel post={p} onNavigate={onNavigate} />}"));
ok("separate My Proposals and My Applications tabs", ui.includes('data-testid="tab-jobs-my-proposals"') && ui.includes('data-testid="tab-jobs-my-applications"'));
ok("My Proposals only for contractors", ui.includes('{canPropose && <TabsTrigger value="proposals"'));
ok("invitations + proposal Q&A only on contractor postings", ui.includes('{!employee && <TabsTrigger value="invitations"') && ui.includes('{!employee && <TabsTrigger value="questions"'));
ok("screening tab only on employee postings", ui.includes('{employee && <TabsTrigger value="screening"'));
const appUi = between("// ─── Employee applications: comparison, hiring, conversion", "// ─── Questions / invitations / activity");
ok("the employee admin path never calls a proposal or award endpoint", !appUi.includes("/api/contractor-job-bids") && !/award/i.test(appUi.replace(/Award(s)?/g, "")));
ok("conversion requires an explicit confirmation and sends workerType employee", appUi.includes("{ confirm: true, workerType: \"employee\" }") && appUi.includes("disabled={!confirmed || convert.isPending}"));
ok("hire dialog states no proposal/contract/invoice is created", appUi.includes("does not create a contractor proposal, contract or invoice"));
ok("publishing indicator-flagged contractor work requires a ticked acknowledgement", ui.includes("acknowledgeClassification: true") && ui.includes("disabled={!ack || transition.isPending}"));
ok("classification warning shows the no-legal-conclusion notice", between("function ClassificationWarning(", "function FilterBar(").includes("{CLASSIFICATION_NOTICE}"));
ok("classification is locked after publish in the editor", ui.includes("const classificationLocked = !!post && post.status !== \"draft\";"));
ok("applicant must tick every acknowledgement", between("function ApplicationPanel(", "function ContractorQuestionsPanel(").includes("APPLICATION_ACKNOWLEDGEMENTS.map"));

// ── Candidate privacy in the worker view ────────────────────────────────────
const workerUi = between("// Worker (contractors + employees)", "// Dashboard summary");
ok("worker view only lists its own proposals (/mine)", !/jobGet[^(]*\(`[^`]*\/bids`/.test(workerUi) && workerUi.includes('"/api/contractor-job-bids/mine"'));
ok("worker view only lists its own applications (/mine)", !/jobGet[^(]*\(`[^`]*\/applications`/.test(workerUi) && workerUi.includes('"/api/employment-applications/mine"'));
ok("worker view never renders another candidate's name", !workerUi.includes("contractorName") && !workerUi.includes("applicantName"));
ok("worker view never calls events/invitations endpoints", !workerUi.includes("/events") && !workerUi.includes("/invitations"));
ok("feature-off 503 has a friendly state", ui.includes("status === 503") && ui.includes("The job board isn't enabled yet"));

// ── Pure logic lives outside React so tests can import it ───────────────────
ok("lib/job-board.ts has no React import", !/from "react"/.test(lib));
ok("lib documents the server mirror", lib.includes("mirror the server rules"));

console.log(`\nJob board UI static: ${passed} checks passed.`);
