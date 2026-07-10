import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("server/feedback-routes.ts", "utf8");
const button = readFileSync("client/src/components/FeedbackButton.tsx", "utf8");
const admin = readFileSync("client/src/pages/FeedbackAdminPage.tsx", "utf8");
const mine = readFileSync("client/src/pages/MyFeedbackPage.tsx", "utf8");

assert.match(routes, /const ALLOWED_TYPES = new Set\(\["bug", "ux", "feature", "change_request", "hr", "general"\]\)/, "backend accepts the HR feedback type");
assert.match(routes, /function hasBuiltInHrFeedbackAccess[\s\S]*tenant_hr_admin[\s\S]*platform_/, "HR feedback reviewers are restricted to HR/admin/platform roles by default");
assert.match(routes, /rp\.resource IN \('feedback_hr', 'hr_feedback'\)/, "explicit HR feedback reviewer permission resources are checked");
assert.match(routes, /if \(ticket\.type === "hr"\) return canReviewHrFeedback\(user\)/, "single-ticket access applies HR feedback reviewer checks");
assert.match(routes, /type <> 'hr' OR submitter_user_id = \$\{user\.id\}/, "feedback list hides HR tickets from non-HR reviewers except their own submissions");
assert.doesNotMatch(routes, /u\.role IN \('admin','manager','system_admin'\)/, "regular managers are not notified as default HR feedback reviewers");
assert.match(routes, /comments\.filter\(c => !c\.is_internal\)/, "submitters do not receive internal HR/admin notes");

assert.match(button, /function scrubSensitiveText/, "captured client errors are scrubbed before submission");
assert.match(button, /redacted-ssn/, "captured client errors redact SSN-like values");
assert.match(button, /password\|passwd\|pwd\|token\|secret\|api\[-_ \]\?key\|authorization\|bearer/, "captured client errors redact credential-like values");
assert.match(button, /fixed bottom-5 left-5 sm:bottom-6 sm:left-6/, "floating feedback button keeps mobile-safe margins away from the corner");
assert.match(button, /z-\[2147483647\]/, "feedback launcher remains above overlays");

assert.match(admin, /value: "hr"/, "Feedback Admin can filter HR feedback for authorized reviewers");
assert.match(mine, /hr: "🛡️"/, "My Feedback shows the HR feedback icon for submitters");

console.log("feedback HR security static checks passed");
