/**
 * Static regression check for the production deploy environment-file path.
 *
 * Background: deploy-production.yml previously pointed ENV_FILE at
 * /etc/paylink/production.env, which does not exist on the VPS. The established
 * production environment file is /etc/paylink/.env (staging uses
 * /etc/paylink/.env.staging). The mismatch made every production deploy abort at
 * the very first `test -f "$ENV_FILE"` check — before any mutation — so no
 * rollback was ever needed, but the release could not ship.
 *
 * Run: npx tsx tests/production-deploy-env-path-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const workflowPath = ".github/workflows/deploy-production.yml";
const workflow = fs.readFileSync(workflowPath, "utf8");

// The remote deploy script body handed to appleboy/ssh-action.
const scriptMatch = workflow.match(/script:\s*\|\s*\n([\s\S]+)$/);
assert(scriptMatch, "deploy-production.yml has an inline ssh-action script block");
const script = scriptMatch![1];

// ── 1. /etc/paylink/.env is used ─────────────────────────────────────────────
// Matches "/etc/paylink/.env" but not "/etc/paylink/.env.staging" / ".env.example".
const usesProdEnv = /\/etc\/paylink\/\.env(?![.\w])/;
assert(
  usesProdEnv.test(workflow),
  "production workflow references the established env file /etc/paylink/.env",
);
assert(
  /ENV_FILE:\s*\/etc\/paylink\/\.env(?![.\w])/.test(workflow),
  "job-level env: block sets ENV_FILE to /etc/paylink/.env",
);
assert(
  /ENV_FILE="\/etc\/paylink\/\.env"/.test(script),
  "remote deploy script sets ENV_FILE=\"/etc/paylink/.env\"",
);

// ── 2. /etc/paylink/production.env is NOT used ───────────────────────────────
assert(
  !workflow.includes("/etc/paylink/production.env"),
  "production workflow no longer references the non-existent /etc/paylink/production.env",
);

// ── 3. A missing env file fails BEFORE any deployment mutation ───────────────
assert(workflow.includes("script_stop: true"), "ssh-action aborts the run on the first failing command (script_stop: true)");
assert(/set -Eeuo pipefail/.test(script), "remote script runs under 'set -Eeuo pipefail'");

const guardIdx = script.indexOf('test -f "$ENV_FILE"');
assert(guardIdx > -1, "remote script guards on 'test -f \"$ENV_FILE\"'");

// Every mutating / side-effecting operation must come strictly after the guard.
const mutations = [
  'mkdir -p "$BACKUP_DIR"',
  'pg_dump "$DATABASE_URL"',
  "git fetch origin --tags",
  'git checkout --force "$RELEASE_TAG"',
  "rm -rf dist/",
  "pnpm build",
  'pm2 delete "$PM2_NAME"',
  "pm2 start",
];
for (const m of mutations) {
  const idx = script.indexOf(m);
  assert(idx > -1, `remote script still performs deploy step: ${m}`);
  assert(idx > guardIdx, `deploy step '${m}' runs only after the env-file guard`);
}

// The env file is read for its values but never echoed into the logs.
assert(!/(cat|head|tail|printenv|env)\s+.*\$ENV_FILE/.test(script), "remote script never dumps the env file contents to logs");
assert(script.includes('echo "ENV_FILE=$ENV_FILE"'), "remote script logs only the env-file path, not its contents");

// ── 4. release_tag validation remains enforced ──────────────────────────────
assert(/release_tag:\s*\n\s*description:/.test(workflow) && /required:\s*true/.test(workflow), "workflow_dispatch requires the release_tag input");
assert(script.includes('RELEASE_TAG="${{ inputs.release_tag }}"'), "remote script binds RELEASE_TAG from the dispatch input");
assert(workflow.includes('test -n "$RELEASE_TAG"'), "workflow rejects an empty release tag");
assert(
  script.includes('EXPECTED_TAG="v$PACKAGE_VERSION"') &&
    /if \[ "\$RELEASE_TAG" != "\$EXPECTED_TAG" \] && \[ "\$RELEASE_TAG" != "\$PACKAGE_VERSION" \]; then/.test(script) &&
    script.includes("exit 1"),
  "remote script rejects a release_tag that does not match the checked-out package.json version",
);
const versionGuardIdx = script.indexOf('EXPECTED_TAG="v$PACKAGE_VERSION"');
assert(
  versionGuardIdx > -1 && versionGuardIdx < script.indexOf('pm2 delete "$PM2_NAME"'),
  "the release_tag/version guard runs before the PM2 swap",
);

console.log("PASS: production deploy env-file path static checks passed");
