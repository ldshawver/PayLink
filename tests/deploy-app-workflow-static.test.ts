/**
 * Static regression checks for deploy app pre-flight env validation.
 * Run: npx tsx tests/deploy-app-workflow-static.test.ts
 */
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/deploy-app.yml", "utf8");
function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

ok("pre-flight runs under bash with strict debug flags", workflow.includes("bash <<'PAYLINK_PREFLIGHT'") && workflow.includes("set -euxo pipefail"));
ok("pre-flight prints host/user/env-file diagnostics", workflow.includes('echo "Host: $(hostname)"') && workflow.includes('echo "User: $(whoami)"') && workflow.includes('echo "Env file exists: $(test -f "$ENV_FILE" && echo yes || echo no)"'));
ok("diagnostic grep commands cannot abort workflow", workflow.includes("grep -n '^DATABASE_URL=' \"$ENV_FILE\" | sed 's/=.*$/=<redacted>/' || true") && workflow.includes("grep -n '^SESSION_SECRET=' \"$ENV_FILE\" | sed 's/=.*$/=<redacted>/' || true") && workflow.includes("grep -n '^APP_BASE_URL=' \"$ENV_FILE\" | sed 's/=.*$/=<redacted>/' || true"));
ok("diagnostics redact secret values", workflow.includes("<redacted>") && !workflow.includes("DATABASE_URL_VALUE=$(grep"));
ok("required variable checks use grep -q under if negation", workflow.includes("if ! grep -q '^DATABASE_URL=.' \"$ENV_FILE\"; then") && workflow.includes("if ! grep -q '^SESSION_SECRET=.' \"$ENV_FILE\"; then") && workflow.includes("if ! grep -q '^APP_BASE_URL=.' \"$ENV_FILE\"; then"));

console.log("\nDeploy app workflow env validation checks passed.");
