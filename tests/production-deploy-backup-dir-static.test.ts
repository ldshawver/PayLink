/**
 * Static regression check for the production deploy pre-deploy-backup step.
 *
 * Background: the shared backup directory (/home/paylinkssh/paylink-db-backups)
 * can exist but be owned by root and not writable by the deploy SSH user, which
 * made `pg_dump "$DATABASE_URL" > "$BACKUP_FILE"` fail with "Permission denied"
 * *before* any deploy mutation. The step now falls back to a deploy-user-owned
 * path when the configured directory is not writable, while keeping the backup,
 * integrity check, checkout, build, PM2 swap, health-check and rollback
 * behavior unchanged.
 *
 * Run: npx tsx tests/production-deploy-backup-dir-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/deploy-production.yml", "utf8");

const scriptMatch = workflow.match(/script:\s*\|\s*\n([\s\S]+)$/);
assert(scriptMatch, "deploy-production.yml has an inline ssh-action script block");
const script = scriptMatch![1];

const idx = (needle: string) => {
  const i = script.indexOf(needle);
  assert(i > -1, `remote script contains: ${needle}`);
  return i;
};

// ── the pre-deploy backup still happens, in order, before the PM2 swap ───────
const guardIdx = idx('test -f "$ENV_FILE"');
const mkdirIdx = idx('mkdir -p "$BACKUP_DIR"');
const pgDumpIdx = idx('pg_dump "$DATABASE_URL" > "$BACKUP_FILE"');
idx('test -s "$BACKUP_FILE"');
idx('gzip -f "$BACKUP_FILE"');
const checkoutIdx = idx('git checkout --force "$RELEASE_TAG"');
const pm2DeleteIdx = idx('pm2 delete "$PM2_NAME"');

assert(guardIdx < mkdirIdx, "env-file guard runs before the backup dir is touched");
assert(mkdirIdx < pgDumpIdx, "backup dir is prepared before pg_dump");
assert(pgDumpIdx < checkoutIdx && checkoutIdx < pm2DeleteIdx, "pg_dump backup runs before checkout, which runs before the PM2 swap");

// ── writability guard + fallback to a deploy-user-owned path ────────────────
assert(
  /if \[ ! -w "\$BACKUP_DIR" \]; then/.test(script),
  "backup step checks whether $BACKUP_DIR is writable",
);
assert(
  /BACKUP_DIR="\$\{HOME:-\/home\/paylinkssh\}\/[^"]+"/.test(script),
  "backup step falls back to a $HOME-based (deploy-user-owned) path when the shared dir is not writable",
);
const fallbackIdx = script.search(/if \[ ! -w "\$BACKUP_DIR" \]; then/);
assert(fallbackIdx > guardIdx && fallbackIdx < pgDumpIdx, "the writability fallback is resolved after the env guard and before pg_dump");

// The BACKUP_FILE path is derived from BACKUP_DIR *after* the fallback may reassign it.
assert(
  fallbackIdx < idx('BACKUP_FILE="$BACKUP_DIR/predeploy-'),
  "BACKUP_FILE is computed from the final BACKUP_DIR (post-fallback)",
);

// ── still no env-file exposure, still tag-validated ─────────────────────────
assert(!/(cat|head|tail|printenv)\s+.*\$ENV_FILE/.test(script), "backup change does not dump the env file contents to logs");
assert(workflow.includes('test -n "$RELEASE_TAG"'), "release_tag validation remains enforced");
assert(
  script.includes('EXPECTED_TAG="v$PACKAGE_VERSION"') && script.includes("exit 1"),
  "release_tag/version match guard remains enforced",
);

console.log("PASS: production deploy backup-dir resilience static checks passed");
