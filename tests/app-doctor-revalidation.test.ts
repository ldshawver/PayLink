/**
 * App Doctor issue revalidation — behavioural (pure) + static wiring checks.
 * Migration 0023. Run: npx tsx tests/app-doctor-revalidation.test.ts
 *
 * Pins:
 *   - a still-valid issue stays "reproduced"/active; a resolved one → "not_reproduced";
 *   - AI-outage is tracked separately from issue validity (ai_last_error*), never archives;
 *   - the active issue window (GET /api/app-doctor/reports) excludes archived rows by default;
 *   - admin/manager gate on the mutating routes is preserved; tenant scoping preserved;
 *   - no hard delete of issue history.
 */
import fs from "node:fs";
import {
  decideRevalidation,
  extractAssetHashes,
  escalatedSeverity,
  normalizeRevalidationStatus,
  type RevalidationEvidence,
} from "../server/app-doctor/revalidation-logic";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const base: RevalidationEvidence = {
  newerOccurrences: 0,
  referencedAssetHashes: [],
  currentAssetHashes: ["index-ChBOfM_r", "schedule-bkXb9BIt"],
  endpointRepro: "not_applicable",
  recentLogMatches: 0,
  buildChangedSinceReport: false,
};

console.log("decideRevalidation — reproduction signals win");
{
  const d = decideRevalidation({ ...base, newerOccurrences: 3 });
  ok("newer occurrences → reproduced + keepActive", d.status === "reproduced" && d.keepActive, JSON.stringify(d));
}
{
  const d = decideRevalidation({ ...base, endpointRepro: "error" });
  ok("route probe 5xx → reproduced", d.status === "reproduced" && d.keepActive);
}
{
  const d = decideRevalidation({ ...base, recentLogMatches: 2 });
  ok("recent log matches → reproduced", d.status === "reproduced");
}

console.log("\ndecideRevalidation — resolution");
{
  // the schedule/timeFormat case: referenced asset hash no longer in the build, nothing recent
  const d = decideRevalidation({ ...base, referencedAssetHashes: ["schedule-B0MWJpMM"], currentAssetHashes: ["schedule-bkXb9BIt", "index-ABC123"] });
  ok("all referenced asset hashes gone from current build → not_reproduced + !keepActive", d.status === "not_reproduced" && !d.keepActive, JSON.stringify(d));
}
{
  const d = decideRevalidation({ ...base, endpointRepro: "ok", buildChangedSinceReport: true });
  ok("route now OK + build changed since report → not_reproduced", d.status === "not_reproduced" && !d.keepActive);
}

console.log("\ndecideRevalidation — inconclusive stays active");
{
  const d = decideRevalidation({ ...base, referencedAssetHashes: ["a-AAAAAA", "b-BBBBBB"], currentAssetHashes: ["a-AAAAAA"] });
  ok("some but not all referenced hashes stale → inconclusive + keepActive", d.status === "inconclusive" && d.keepActive, JSON.stringify(d));
}
{
  const d = decideRevalidation({ ...base, endpointRepro: "not_applicable" });
  ok("frontend route, no other signal → inconclusive + keepActive (never silently archived)", d.status === "inconclusive" && d.keepActive);
}
{
  const d = decideRevalidation({ ...base, endpointRepro: "unknown" });
  ok("auth-gated probe, no other signal → inconclusive", d.status === "inconclusive" && d.keepActive);
}

console.log("\nextractAssetHashes");
ok("pulls stem from /assets/<stem>.js", JSON.stringify(extractAssetHashes("boom at /assets/schedule-B0MWJpMM.js:1")) === JSON.stringify(["schedule-B0MWJpMM"]));
ok("pulls bare <stem>.css and dedupes", JSON.stringify(extractAssetHashes("index-ABC123.css and index-ABC123.css")) === JSON.stringify(["index-ABC123"]));
ok("ignores non-hashed names", extractAssetHashes("see main.js and style.css").length === 0);

console.log("\nescalatedSeverity — only raises");
ok("medium → high when newer occurrence is high", escalatedSeverity("medium", "high") === "high");
ok("high stays (no lower)", escalatedSeverity("high", "low") === null);
ok("critical never changes", escalatedSeverity("critical", "high") === null);

console.log("\nnormalizeRevalidationStatus");
ok("passes the 3 canonical values", ["reproduced", "not_reproduced", "inconclusive"].every((s) => normalizeRevalidationStatus(s) === s));
ok("unknown → null", normalizeRevalidationStatus("maybe") === null);

console.log("\nstatic wiring — server/routes.ts");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const idx = fs.readFileSync("server/index.ts", "utf8");
const schema = fs.readFileSync("shared/schema.ts", "utf8");
const migrations = fs.readdirSync("migrations").filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const mig = fs.readFileSync("migrations/0023_app_doctor_revalidation.sql", "utf8");
const page = fs.readFileSync("client/src/pages/app-doctor.tsx", "utf8");
const suites = fs.readFileSync("scripts/test-suites.json", "utf8");

ok("0023_app_doctor_revalidation.sql is present and its migration number is unique", migrations.includes("0023_app_doctor_revalidation.sql") && migrations.filter(m => /^0023_/.test(m)).length === 1);
{
  // strip `-- comment` lines and blank lines → just the executable SQL of the forward section
  const forward = mig.split("ROLLBACK")[0]
    .split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");
  ok("migration forward: only ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS",
    /ADD COLUMN IF NOT EXISTS/.test(forward) && /CREATE INDEX IF NOT EXISTS/.test(forward)
    && !/\b(DROP|DELETE FROM|TRUNCATE)\b/i.test(forward)
    && !/\bUPDATE \w+ SET\b/i.test(forward));
  ok("migration adds archived_at + revalidation_status + ai_last_error (separate from validity)",
    /archived_at/.test(forward) && /revalidation_status/.test(forward) && /ai_last_error\b/.test(forward));
}
ok("boot DDL mirrors the new columns", /app_doctor_reports.archived_at/.test(idx) && /app_doctor_reports.ai_last_error/.test(idx) && /idx_app_doctor_reports_active/.test(idx));
ok("schema.ts adds the revalidation columns", /archivedAt: timestamp\("archived_at"\)/.test(schema) && /aiLastError: text\("ai_last_error"\)/.test(schema));

ok("POST /api/app-doctor/reports/:id/revalidate is behind requireRole(\"admin\", \"manager\")",
  /app\.post\("\/api\/app-doctor\/reports\/:id\/revalidate", requireAuth, requireRole\("admin", "manager"\)/.test(routes));
ok("POST /api/app-doctor/reports/revalidate-active is behind requireRole(\"admin\", \"manager\")",
  /app\.post\("\/api\/app-doctor\/reports\/revalidate-active", requireAuth, requireRole\("admin", "manager"\)/.test(routes));
ok("revalidate route enforces tenant scoping (non-platform → own company only)",
  /!isPlatformUser\(user\?\.role\) && target\.company_id !== user\?\.companyId/.test(routes));
ok("GET /api/app-doctor/reports excludes archived by default (?includeArchived=true opts in)",
  /includeArchived/.test(routes) && /archived_at IS NULL/.test(routes));
ok("revalidate-active is company-scoped (archived_at IS NULL + company_id filter)",
  /WHERE company_id = \$\{companyId\} AND archived_at IS NULL/.test(routes));
ok("no hard delete of app_doctor_reports anywhere",
  !/DELETE FROM app_doctor_reports/i.test(routes) && !/DELETE FROM app_doctor_reports/i.test(idx));
ok("archive sets reason 'no_longer_reproduces' + actor + timestamp, keeps the row",
  /archived_reason = 'no_longer_reproduces'/.test(routes) && /archived_by_user_id = \$\{actor\.userId/.test(routes));
ok("AI failure recorded in ai_last_error* SEPARATELY (analyze path), not in revalidation_status",
  /SET ai_last_error = \$\{localReason/.test(routes) && /ai_last_error_at = NOW\(\)/.test(routes));
ok("successful AI clears ai_last_error*", /SET ai_last_error = NULL, ai_last_error_at = NULL/.test(routes));
ok("revalidate refresh calls analyzeAppDoctorReport and swallows its failure (local review kept)",
  /await analyzeAppDoctorReport\(reportId\)\.catch/.test(routes));
ok("route probe is read-only: GET method only, /api-prefixed, safe-prefix allowlist",
  /method: "GET"/.test(routes) && /SAFE_PREFIXES/.test(routes) && /clean\.startsWith\("\/api\/"\)/.test(routes));

console.log("\nstatic wiring — client + suites");
ok("app-doctor page has Revalidate + Revalidate All Active buttons",
  /data-testid="button-revalidate-report"/.test(page) && /data-testid="button-revalidate-all-active"/.test(page));
ok("app-doctor page surfaces revalidation state + AI-outage note separately",
  /data-testid="app-doctor-revalidation-state"/.test(page) && /data-testid="app-doctor-ai-last-error"/.test(page)
  && /does not affect whether the issue is still valid/.test(page));
ok("this test is registered in the required suite; db test in the db suite",
  /app-doctor-revalidation\.test\.ts/.test(suites) && /app-doctor-revalidation-db\.test\.ts/.test(suites));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
