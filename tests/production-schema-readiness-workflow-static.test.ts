import fs from "node:fs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const workflow = fs.readFileSync(".github/workflows/apply-schema-readiness-production.yml", "utf8");

assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /pg_dump "\$DATABASE_URL"/);
assert.match(workflow, /PostgreSQL database dump complete/);
assert.match(workflow, /gzip -t/);
assert.match(workflow, /0027_tenant_provisioning_audit_logs\.sql/);
assert.match(workflow, /0028_tenant_provisioning_gates_and_projects\.sql/);
assert.match(workflow, /test "\$BEFORE_COUNTS" = "\$AFTER_COUNTS"/);
assert.doesNotMatch(workflow, /\b(DROP|DELETE|TRUNCATE)\b/);

const psqlInlineCommands = workflow
  .split("\n")
  .filter((line) => line.includes('psql "$DATABASE_URL"') && line.includes('-c "'));
assert.equal(psqlInlineCommands.length, 4, "expected four inline psql -c safety queries");
for (const command of psqlInlineCommands) {
  assert.match(command, /-c ".+"/, "each psql -c query must open and close on one physical line");
}

const scriptMatch = workflow.match(/          script: \|\n([\s\S]+)$/);
assert.ok(scriptMatch, "SSH script block must exist");
const script = scriptMatch[1]
  .split("\n")
  .map((line) => line.startsWith("            ") ? line.slice(12) : line)
  .join("\n");
const stopGuard = "DRONE_SSH_PREV_COMMAND_EXIT_CODE=$?; if [ $DRONE_SSH_PREV_COMMAND_EXIT_CODE -ne 0 ]; then exit $DRONE_SSH_PREV_COMMAND_EXIT_CODE; fi";
const injectedScript = script
  .split("\n")
  .flatMap((line) => line.trim() ? [line, stopGuard] : [line])
  .join("\n");
const parseResult = spawnSync("bash", ["-n"], { input: injectedScript, encoding: "utf8" });
assert.equal(parseResult.status, 0, `script_stop-injected SSH script must parse: ${parseResult.stderr}`);

console.log("PASS: production schema-readiness workflow is backup-gated and additive-only");
