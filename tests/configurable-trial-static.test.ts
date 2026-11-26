/**
 * Wiring checks for the configurable trial length and the expiry sweep.
 * Run: npx tsx tests/configurable-trial-static.test.ts
 */
import fs from "node:fs";
import assert from "node:assert/strict";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const orchestrator = fs.readFileSync("server/workers/orchestrator.ts", "utf8");
const lifecycle = fs.readFileSync("server/trial-lifecycle.ts", "utf8");
const index = fs.readFileSync("server/index.ts", "utf8");
const migration = fs.readFileSync("migrations/0039_platform_settings.sql", "utf8");
const home = fs.readFileSync("client/src/pages/platform-home.tsx", "utf8");
const signup = routes.slice(routes.indexOf('app.post("/api/trial/signup"'), routes.indexOf('app.post("/api/trial/signup"') + 8000);

function ok(name: string, condition: boolean) {
  assert.equal(condition, true, name);
  console.log(`PASS: ${name}`);
}

ok("trial signup reads the platform trial length", /getTrialLengthDays\(/.test(signup) && /trialLengthMs\(trialDays\)/.test(signup));
ok("trial signup no longer hard-codes 30 days", !/30 \* 24 \* 60 \* 60 \* 1000/.test(signup));
ok("public trial offer is on the auth allowlist", /req\.path === "\/public\/trial-offer"/.test(routes));
ok("platform settings read requires a platform role", /app\.get\("\/api\/platform\/settings",\s*requireAuth,\s*requirePlatformRole\(\)/.test(routes));
ok("platform settings write requires a platform admin and CSRF", /app\.patch\("\/api\/platform\/settings",\s*requireAuth,\s*requirePlatformRole\(\),\s*requirePlatformAdminRole\(\),\s*requireCsrfToken/.test(routes));
ok("the sweep expires elapsed trials and suspends ended grace periods", /expireElapsedTrials\(/.test(lifecycle) && /checkAndSuspendExpiredGracePeriods\(/.test(lifecycle));
ok("elapsed-trial update is limited to trial statuses whose trial_end has passed", /subscription_status IN \('trial_active', 'trialing', 'trial'\)/.test(lifecycle) && /trial_end < /.test(lifecycle));
ok("orchestrator schedules the sweep", /scheduleJob\("TrialGraceSweep",\s*jobTrialGraceSweep,\s*HOUR_MS/.test(orchestrator) && !/\/\/\s*scheduleJob\("TrialGraceSweep"/.test(orchestrator));
ok("migration 0039 creates platform_settings", /CREATE TABLE IF NOT EXISTS platform_settings/.test(migration));
ok("migration 0039 does not drop or delete data", !/\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(migration));
ok("startup DDL creates platform_settings", /platform_settings table/.test(index));
ok("platform console has a trial-length field", /data-testid="input-trial-length-days"/.test(home) && /data-testid="button-save-trial-length"/.test(home));

console.log("\nConfigurable trial wiring checks passed.");
