/**
 * Static regression check: the production deploy verifies the pre-deploy backup
 * before any app mutation.
 *
 * `test -s` alone accepts a truncated dump (pg_dump killed mid-stream, disk full
 * after the first bytes). The remote script must also require the plain-format
 * completion marker, verify the gzip archive, and record a checksum — all before
 * `git checkout` and the PM2 swap, so a bad backup aborts the deploy with the
 * running release untouched.
 *
 * Run: npx tsx tests/production-deploy-backup-integrity-static.test.ts
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

assert(script.includes("set -Eeuo pipefail"), "remote script still fails fast");

const pgDumpIdx = idx('pg_dump "$DATABASE_URL" > "$BACKUP_FILE"');
const markerIdx = idx("-- PostgreSQL database dump complete");
const gzipIdx = idx('gzip -f "$BACKUP_FILE"');
const gzipTestIdx = idx('gzip -t "${BACKUP_FILE}.gz"');
const shaIdx = idx('sha256sum "${BACKUP_FILE}.gz"');
const checkoutIdx = idx('git checkout --force "$RELEASE_TAG"');
const pm2DeleteIdx = idx('pm2 delete "$PM2_NAME"');

assert(pgDumpIdx < markerIdx && markerIdx < gzipIdx, "completion marker is checked on the raw dump, before compression");
assert(gzipIdx < gzipTestIdx && gzipTestIdx < shaIdx, "gzip archive is verified, then checksummed");
assert(shaIdx < checkoutIdx && checkoutIdx < pm2DeleteIdx, "all backup verification precedes checkout and the PM2 swap");

// The marker check must abort, and must not use an early-exiting grep in a pipe
// (grep -q closing the pipe would SIGPIPE tail and trip pipefail on a GOOD dump).
const markerBlock = script.slice(markerIdx - 200, markerIdx + 250);
assert(/grep -c/.test(markerBlock) && !/grep -q[^\n]*PostgreSQL database dump complete/.test(markerBlock), "marker check counts matches (no grep -q in a pipefail pipe)");
assert(/exit 1/.test(markerBlock), "missing completion marker aborts the deploy");

console.log("PASS: production deploy backup integrity static checks passed");
