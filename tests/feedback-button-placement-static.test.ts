/**
 * Feedback button placement + applicant feedback access (v2.2.21) — static and
 * pure-function checks. No database, network or server.
 *
 * - The ONE shared FeedbackButton is fixed bottom-right, small, above page
 *   content (z-40) but below dialogs/menus/toasts (z-50+), hidden in print,
 *   with its accessible label and data-testid intact; every authenticated shell
 *   (tenant app, Platform Console, applicant portal) renders it and reserves
 *   bottom clearance so page content can scroll clear of it.
 * - The applicant API allowlist gains EXACTLY the four feedback routes the My
 *   Feedback view needs; every other route in the route-security manifest
 *   (1,154 routes) stays denied for applicants.
 * - Feedback mutations require the CSRF header (before multer for uploads) and
 *   the handlers confine applicants to their own tickets.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APPLICANT_ALLOWED_API, isApplicantApiAllowed } from "../server/job-board/applicant-api-allowlist";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const read = (f: string) => readFileSync(f, "utf8");
const button = read("client/src/components/FeedbackButton.tsx");
const app = read("client/src/App.tsx");
const applicantPortal = read("client/src/pages/applicant-portal.tsx");
const myFeedback = read("client/src/pages/MyFeedbackPage.tsx");
const feedbackRoutes = read("server/feedback-routes.ts");
const routes = read("server/routes.ts");

const launcher = button.match(/<Button\s+type="button"\s+onClick=\{openFeedbackForm\}[\s\S]*?<\/Button>/)?.[0] ?? "";
const launcherClass = launcher.match(/className="([^"]+)"/)?.[1] ?? "";
const classes = new Set(launcherClass.split(/\s+/));

console.log("placement");
check("the launcher <Button> is found", () => assert.ok(launcher && launcherClass));
check("fixed at the bottom-right (safe-area aware) on mobile and sm+", () => {
  for (const c of [
    "fixed",
    "right-[max(1rem,env(safe-area-inset-right))]", "bottom-[max(1rem,env(safe-area-inset-bottom))]",
    "sm:right-[max(1.5rem,env(safe-area-inset-right))]", "sm:bottom-[max(1.5rem,env(safe-area-inset-bottom))]",
  ]) assert.ok(classes.has(c), c);
});
check("never positioned on the left", () => assert.doesNotMatch(launcherClass, /(^|\s)(sm:)?left-/));
check("icon-sized on mobile (40px circle), compact icon+label from sm up (36px tall)", () => {
  for (const c of ["h-10", "w-10", "p-0", "rounded-full", "sm:h-9", "sm:w-auto", "sm:px-3"]) assert.ok(classes.has(c), c);
  assert.match(launcher, /<span className="hidden sm:inline">Feedback<\/span>/);
});
check("z-40: above page content, below dialogs/sheets/popovers/menus (z-50) and toasts (z-100)", () => {
  assert.ok(classes.has("z-40"));
  assert.doesNotMatch(launcherClass, /z-\[/, "no arbitrary z-index (the old z-[2147483647] covered open dialogs/menus)");
});
check("hidden when printing (checks/reports)", () => assert.ok(classes.has("print:hidden")));
check("opts out of the elevate rule that forces position:relative/z-index:0 (would un-fix the launcher)", () => {
  assert.ok(classes.has("no-default-hover-elevate") && classes.has("no-default-active-elevate"));
  const css = read("client/src/index.css");
  assert.match(css, /\.hover-elevate:not\(\.no-default-hover-elevate\),[\s\S]*?\.active-elevate-2:not\(\.no-default-active-elevate\) \{\s*position: relative;\s*z-index: 0;/, "the escape hatch still guards the rule");
});
check("accessible label and data-testid preserved; icon is decorative", () => {
  assert.match(launcher, /aria-label="Send feedback"/);
  assert.match(launcher, /data-testid="button-feedback-open"/);
  assert.match(launcher, /<MessageSquarePlus aria-hidden="true" \/>/);
});
check("launcher is the dialog's DialogTrigger (focus returns to it on close; aria-expanded)", () => {
  assert.match(button, /<DialogTrigger asChild>\s*<Button\s+type="button"\s+onClick=\{openFeedbackForm\}/);
});
check("still renders nothing without a signed-in user (logout removes it)", () => assert.match(button, /if \(!user\) return null;/));

console.log("every authenticated shell renders the one shared component");
check("exactly one FeedbackButton component exists (no duplicate)", () => {
  assert.equal((button.match(/export function FeedbackButton\(/g) ?? []).length, 1);
});
const fnBody = (src: string, name: string) => {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const next = src.indexOf("\nfunction ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
};
const MAIN_CLEARANCE = 'pb-[calc(5rem+env(safe-area-inset-bottom))]';
check("tenant app shell (admin/manager/employee/contractor/vendor) renders it + bottom clearance", () => {
  const body = fnBody(app, "AuthenticatedLayout");
  assert.match(body, /<FeedbackButton \/>/);
  assert.ok(body.includes(MAIN_CLEARANCE));
});
check("Platform Console shell renders it + bottom clearance", () => {
  const body = fnBody(app, "PlatformLayout");
  assert.match(body, /<FeedbackButton \/>/);
  assert.ok(body.includes(MAIN_CLEARANCE));
});
check("applicant portal renders it, bottom clearance, and the My Feedback view at /app/my-feedback", () => {
  assert.match(applicantPortal, /import \{ FeedbackButton \} from "@\/components\/FeedbackButton";/);
  assert.match(applicantPortal, /<FeedbackButton \/>/);
  assert.ok(applicantPortal.includes(MAIN_CLEARANCE));
  assert.match(applicantPortal, /const FEEDBACK_PATH = "\/app\/my-feedback";/);
  assert.match(applicantPortal, /<MyFeedbackPage \/>/);
  assert.match(button, /href="\/app\/my-feedback"/, "the dialog's 'View my submissions' link reaches the same view");
});
check("copy says bottom-right (no stale 'bottom-left' instructions)", () => {
  assert.match(myFeedback, /button in the bottom-right corner/);
  for (const [f, src] of [["MyFeedbackPage", myFeedback], ["FeedbackButton", button], ["applicant-portal", applicantPortal]]) {
    assert.doesNotMatch(src, /bottom-left/i, f);
  }
});

console.log("CSRF");
check("submit sends the double-submit CSRF header (multipart fetch)", () => {
  assert.match(button, /import \{ getCsrfToken \} from "@\/lib\/queryClient";/);
  assert.match(button, /headers: csrfToken \? \{ "x-csrf-token": csrfToken \} : undefined/);
});
check("POST /api/feedback checks CSRF BEFORE multer writes any file", () => {
  assert.match(feedbackRoutes, /"\/api\/feedback",\s*requireAuth,\s*requireCsrfToken,[^\n]*\n\s*upload\.array\("screenshots", 3\)/);
});
check("PATCH /api/feedback/:id and POST /api/feedback/:id/comments require CSRF", () => {
  assert.match(feedbackRoutes, /app\.patch\("\/api\/feedback\/:id", requireAuth, requireCsrfToken,/);
  assert.match(feedbackRoutes, /app\.post\("\/api\/feedback\/:id\/comments", requireAuth, requireCsrfToken,/);
});

console.log("applicant handler confinement");
check("applicants: own tickets only, never update; no reviewer/HR-permission path", () => {
  assert.match(feedbackRoutes, /if \(isApplicantRole\(user\.role\)\) return submitter && action !== "update";/);
});
check("applicants get 404 (not 403) for any ticket they did not submit — comments GET and POST", () => {
  assert.equal((feedbackRoutes.match(/if \(isApplicantRole\(user\.role\) && ticket\.submitter_user_id !== user\.id\) return res\.status\(404\)/g) ?? []).length, 2);
});
check("disabled applicants keep no feedback access (submit, mine, comments)", () => {
  assert.equal((feedbackRoutes.match(/if \(isDisabledApplicant\(user\)\) return res\.status\(403\)/g) ?? []).length, 4);
});
check("applicant responses are projected (no assignment, company, browser/IP or console diagnostics)", () => {
  const view = feedbackRoutes.match(/function applicantTicketView[\s\S]*?\n}\n/)?.[0] ?? "";
  for (const forbidden of ["assigned_user_id", "company_id", "browser_info", "console_errors", "submitter_email", "submitter_user_id"]) {
    assert.ok(!view.includes(forbidden), forbidden);
  }
  assert.match(feedbackRoutes, /rows\.map\(applicantTicketView\)/);
  assert.match(feedbackRoutes, /comments\.filter\(c => !c\.is_internal\)\.map\(applicantCommentView\)/);
  const cview = feedbackRoutes.match(/function applicantCommentView[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.ok(!cview.includes("author_user_id"), "reviewer user ids are not exposed");
});
check("applicant comments can never be internal (flag honoured only for admin/platform)", () => {
  assert.match(feedbackRoutes, /const internalFlag = !!isInternal && \(admin \|\| platform\);/);
  assert.match(feedbackRoutes, /function isAdminRole[\s\S]*?role === "admin" \|\| role === "manager" \|\| role === "system_admin" \|\|\s*role\.startsWith\("tenant_"\) \|\| role\.startsWith\("platform_"\)/);
});
check("owner/company/status come from the session/server, never the request body", () => {
  const post = feedbackRoutes.slice(feedbackRoutes.indexOf('"/api/feedback",'), feedbackRoutes.indexOf(`app.get("/api/feedback/mine"`));
  const destructured = post.match(/const \{\s*([\s\S]*?)\s*\} = req\.body/)?.[1] ?? "";
  for (const f of ["companyId", "company_id", "submitterUserId", "status", "assignedUserId", "priorityFix", "tenantId"]) {
    assert.ok(!new RegExp(`\\b${f}\\b`).test(destructured), f);
  }
  assert.match(post, /\$\{resolvedCompanyId\}, \$\{userId\}/);
  assert.match(post, /\$\{sev\}, 'new',/);
});

console.log("applicant API allowlist");
check("routes.ts uses the shared allowlist module (no inline copy)", () => {
  assert.match(routes, /import \{ isApplicantApiAllowed \} from "\.\/job-board\/applicant-api-allowlist";/);
  assert.match(routes, /if \(role !== "applicant"\) return next\(\);\s*if \(isApplicantApiAllowed\(req\.method, req\.path\)\) return next\(\);/);
  assert.doesNotMatch(routes, /const APPLICANT_ALLOWED_API/);
});
check("17 entries, every regex anchored at both ends except the two pre-existing namespace prefixes", () => {
  assert.equal(APPLICANT_ALLOWED_API.length, 17);
  for (const [, re] of APPLICANT_ALLOWED_API) {
    assert.ok(re.source.startsWith("^"), re.source);
    if (re.source !== "^\\/auth\\/" && re.source !== "^\\/public\\/job-board\\/") assert.ok(re.source.endsWith("$"), re.source);
  }
});

const UUID = "0b9c1f9e-6a7d-4c41-9a3e-2f5b8c7d6e1f";
const FEEDBACK_ALLOWED = new Set(["POST /feedback", "GET /feedback/mine", "GET /feedback/:id/comments", "POST /feedback/:id/comments"]);
check("exactly the four feedback routes are allowed", () => {
  assert.ok(isApplicantApiAllowed("POST", "/feedback"));
  assert.ok(isApplicantApiAllowed("GET", "/feedback/mine"));
  assert.ok(isApplicantApiAllowed("GET", `/feedback/${UUID}/comments`));
  assert.ok(isApplicantApiAllowed("POST", `/feedback/${UUID}/comments`));
  assert.ok(isApplicantApiAllowed("GET", "/feedback/mine?x=1"), "query strings are ignored");
});
check("feedback admin queue, single ticket, updates and look-alikes stay denied", () => {
  for (const [m, p] of [
    ["GET", "/feedback"], ["GET", `/feedback/${UUID}`], ["PATCH", `/feedback/${UUID}`], ["PUT", `/feedback/${UUID}`],
    ["DELETE", `/feedback/${UUID}`], ["POST", "/feedback/mine"], ["PATCH", "/feedback/mine"], ["GET", "/feedback/"],
    ["POST", "/feedback/"], ["GET", "/feedback/mine/"], ["GET", "/feedbackx"], ["POST", "/feedback-admin"],
    ["GET", `/feedback/${UUID}/comments/x`], ["PATCH", `/feedback/${UUID}/comments`], ["DELETE", `/feedback/${UUID}/comments`],
    ["GET", "/feedback/not-a-uuid/comments"], ["GET", "/feedback/../workers/comments"], ["GET", `/x/feedback/${UUID}/comments`],
  ] as const) assert.ok(!isApplicantApiAllowed(m, p), `${m} ${p}`);
});

type ManifestEntry = { method: string; path: string };
const manifest = JSON.parse(read("docs/saas-readiness/route-security-manifest.json")) as { entries: ManifestEntry[] };
// Pre-existing applicant allowances (unchanged by this release) + the four feedback routes.
const PRE_EXISTING = /^\/(auth\/|public\/job-board\/|job-posts\/(available|summary|:[^/]+|:[^/]+\/applications)$|employment-applications\/(mine|:[^/]+|:[^/]+\/(submit|withdraw|documents))$|employment-application-documents\/:[^/]+\/(download|remove)$|job-post-attachments\/:[^/]+\/download$)/;
check(`every route in the route-security manifest (${manifest.entries.length}) is denied unless explicitly allowed`, () => {
  let allowed = 0, denied = 0;
  for (const e of manifest.entries) {
    if (!e.path.startsWith("/api/")) continue;
    const rel = e.path.slice(4);
    const concrete = rel.replace(/:[A-Za-z_]+/g, UUID);
    const verdict = isApplicantApiAllowed(e.method, concrete);
    const key = `${e.method} ${rel.replace(/:[A-Za-z_]+/g, ":id")}`;
    const expectedFeedback = FEEDBACK_ALLOWED.has(key);
    if (rel.startsWith("/feedback")) {
      assert.equal(verdict, expectedFeedback, key);
    } else if (verdict) {
      // Anything else allowed must be one of the pre-existing job-board/auth allowances.
      assert.ok(PRE_EXISTING.test(rel), `unexpected applicant allowance: ${e.method} ${e.path}`);
    }
    if (verdict) allowed++; else denied++;
  }
  assert.ok(denied > 1000, `denied=${denied}`);
  console.log(`      (${allowed} allowed, ${denied} denied)`);
});
check("all seven manifest feedback routes are classified — four allowed, three denied", () => {
  const fb = manifest.entries.filter((e) => e.path.startsWith("/api/feedback"));
  assert.equal(fb.length, 7);
  const allowedKeys = fb.filter((e) => isApplicantApiAllowed(e.method, e.path.slice(4).replace(/:[A-Za-z_]+/g, UUID))).map((e) => `${e.method} ${e.path}`).sort();
  assert.deepEqual(allowedKeys, ["GET /api/feedback/:id/comments", "GET /api/feedback/mine", "POST /api/feedback", "POST /api/feedback/:id/comments"]);
});

console.log(`\nfeedback button placement + applicant feedback static: ${passed} passed`);
