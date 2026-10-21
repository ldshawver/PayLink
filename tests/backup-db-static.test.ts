/**
 * PB-1 — production DB backup: static safety contract (no DB, no network).
 * Run: npx tsx tests/backup-db-static.test.ts
 * Behavioural coverage lives in tests/backup-db-pipeline.test.ts (CI job backup-pipeline).
 *
 * Pins:
 *   - both scripts parse (bash -n) and run with set -euo pipefail + umask 077;
 *   - the DB URL is never passed on argv (pgpass + PG* env) and env files are parsed, never sourced;
 *   - nothing leaves the host unencrypted: encryption precedes upload, plaintext dump is removed,
 *     and a missing GPG recipient aborts instead of falling back to plaintext;
 *   - every backup is restore-drilled into a socket-only throwaway cluster before it counts;
 *   - upload is read-back verified; retention only touches this script's own files;
 *   - remote deletion is opt-in with a 7-day floor;
 *   - failure always pings /fail; SMTP_PASSWORD (the prod env name) is honoured;
 *   - systemd unit runs unprivileged, hardened, from a root-owned install path;
 *   - no secrets in committed config; runbook + DR doc describe the real mechanism.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const backup = fs.readFileSync("scripts/backup-db.sh", "utf8");
const verify = fs.readFileSync("scripts/backup-restore-verify.sh", "utf8");
const unit = fs.readFileSync("scripts/backup/systemd/paylink-db-backup.service", "utf8");
const timer = fs.readFileSync("scripts/backup/systemd/paylink-db-backup.timer", "utf8");
const envExample = fs.readFileSync("scripts/backup/backup.env.example", "utf8");
const runbook = fs.readFileSync("docs/deployment/production-db-backup.md", "utf8");
const dr = fs.readFileSync("DISASTER_RECOVERY.md", "utf8");
const suites = JSON.parse(fs.readFileSync("scripts/test-suites.json", "utf8"));
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const code = (s: string) => s.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const backupCode = code(backup);

console.log("shell hygiene");
for (const [name, file] of [["backup-db.sh", "scripts/backup-db.sh"], ["backup-restore-verify.sh", "scripts/backup-restore-verify.sh"]]) {
  const r = spawnSync("bash", ["-n", file]);
  ok(`${name} parses`, r.status === 0, r.stderr?.toString());
  const src = fs.readFileSync(file, "utf8");
  ok(`${name} uses set -euo pipefail + umask 077`, /^set -euo pipefail$/m.test(src) && /^umask 077$/m.test(src));
  ok(`${name} is executable`, (fs.statSync(file).mode & 0o111) !== 0);
}

console.log("\ncredentials");
ok("env files parsed, never sourced or eval'd", !/^\s*(source|\.)\s/m.test(backupCode) && !/\beval\b/.test(backupCode));
ok("pg_dump gets no --dbname / URL on argv", /pg_dump --no-password --format=custom/.test(backupCode) && !/pg_dump[^\n]*(--dbname|-d |DATABASE_URL|DB_URL)/.test(backupCode));
ok("password delivered via private pgpass file", /PGPASSFILE="\$WORK_DIR\/pgpass"/.test(backupCode) && /0o600/.test(backupCode));
ok("DB URL variable unset after parsing", /^unset DB_URL$/m.test(backupCode));
ok("SMTP password passed via env, not argv", /BK_SMTP_PASS="\$smtp_pass"/.test(backupCode) && !/python3 - "\$/.test(backupCode));
ok("prod env name SMTP_PASSWORD honoured (SMTP_PASS fallback)", /read_env_var "\$ENV_FILE" SMTP_PASSWORD/.test(backupCode) && /SMTP_PASS\)/.test(backupCode));

console.log("\nencryption + off-server");
const iEncrypt = backupCode.indexOf("--encrypt --output");
const iUpload = backupCode.indexOf("rclone copyto");
ok("missing GPG recipient aborts (no plaintext fallback)", /\[ -n "\$GPG_RECIPIENT" \] \|\| fail/.test(backupCode));
ok("encryption happens before any upload", iEncrypt > 0 && iUpload > iEncrypt);
ok("plaintext dump removed right after encryption", /rm -f -- "\$DUMP"/.test(backupCode) && backupCode.indexOf('rm -f -- "$DUMP"') < iUpload);
ok("only .gpg / .sha256 / manifest are uploaded", /for f in "\$\{BASENAME\}\.dump\.gpg" "\$\{BASENAME\}\.dump\.gpg\.sha256" "\$\{BASENAME\}\.manifest\.txt"; do\n\s+rclone copyto/.test(backupCode));
ok("upload read-back hash verified", /rclone cat "\$REMOTE_DIR\/\$\{BASENAME\}\.dump\.gpg" \| sha256sum/.test(backupCode) && /REMOTE_SHA" = "\$ENC_SHA"/.test(backupCode));
ok("warns if the private key is present on the host", /list-secret-keys/.test(backupCode));
ok("work dir is private and always removed", /chmod 700 "\$WORK_DIR"/.test(backupCode) && /rm -rf -- "\$WORK_DIR"/.test(backupCode));
ok("concurrent runs prevented (flock)", /flock -n 9/.test(backupCode));

console.log("\nverification");
ok("dump TOC checked against a table floor", /pg_restore --list "\$DUMP"/.test(backupCode) && /PAYLINK_BACKUP_MIN_TABLES/.test(backupCode));
ok("restore drill runs before encryption/upload", backupCode.indexOf("backup-restore-verify.sh") > 0 && backupCode.indexOf("backup-restore-verify.sh") < iEncrypt);
ok("drill failure is fatal", /\|\| fail "restore drill failed/.test(backupCode));
ok("drill cluster is socket-only (no TCP listener)", /listen_addresses=''/.test(verify));
ok("drill restores with --exit-on-error into its own initdb", /pg_restore" --exit-on-error/.test(verify) && /initdb" -D "\$PGDATA_DIR"/.test(verify));
ok("drill compares restored vs TOC table count + required rows", /table count mismatch/.test(verify) && /required table is empty/.test(verify));
ok("drill never takes a connection string for an existing DB", !/DATABASE_URL|PGHOST=/.test(code(verify)));

console.log("\nretention + alerting");
ok("local prune limited to this script's prefix", /-name "paylink-\$\{LABEL\}-\*" -mtime/.test(backupCode) && !/predeploy/.test(backupCode));
ok("remote prune opt-in with 7-day floor", /REMOTE_RETAIN_DAYS" -ge 7/.test(backupCode) && /if \[ -n "\$REMOTE_RETAIN_DAYS" \]; then\n\s+rclone delete/.test(backupCode));
ok("failure pings /fail and emails", /ping_healthcheck "\/fail"/.test(backupCode) && /send_failure_email "failed at stage/.test(backupCode));
ok("success ping only after last-success marker", backupCode.lastIndexOf('ping_healthcheck ""') > backupCode.indexOf("last-success"));

console.log("\nsystemd");
ok("service runs as paylinkssh, not root", /^User=paylinkssh$/m.test(unit) && !/^User=root/m.test(unit));
ok("service executes the root-owned install copy", /^ExecStart=\/usr\/local\/lib\/paylink-backup\/backup-db\.sh$/m.test(unit));
ok("service hardened", ["NoNewPrivileges=true", "ProtectSystem=strict", "PrivateTmp=true", "UMask=0077"].every((s) => unit.includes(s)));
ok("timer nightly + Persistent", /^OnCalendar=\*-\*-\* 03:40:00 UTC$/m.test(timer) && /^Persistent=true$/m.test(timer));

console.log("\nno committed secrets");
ok("env example holds placeholders only", /REPLACE_WITH_40_HEX_FINGERPRINT/.test(envExample) && !/^PAYLINK_BACKUP_(DATABASE_URL|HEALTHCHECK_URL|ALERT_EMAIL)=\S/m.test(envExample));
ok("no credentials in unit files", !/(PASSWORD|SECRET|TOKEN|postgres(ql)?:\/\/)/i.test(unit + timer));

console.log("\ndocs + wiring");
ok("runbook covers key handling, install, restore, drill", ["Offline key", "Install", "Restore procedure", "Quarterly", "pg_read_all_data"].every((s) => runbook.includes(s)));
ok("runbook restore never targets the live DB in place", /paylink_restore_/.test(runbook) && !/pg_restore[^\n]*-d paylink_production/.test(runbook));
ok("DR doc points at the runbook and drops the stale cron claim", dr.includes("docs/deployment/production-db-backup.md") && !dr.includes("0 2 * * * /home/paylinkssh/paylink-app/PayLink/scripts/backup-db.sh"));
ok("static test registered in required suite", suites.suites.required.files.includes("tests/backup-db-static.test.ts") && suites.suites.required.fileCount === suites.suites.required.files.length);
ok("pipeline test has its own CI job", /backup-pipeline:/.test(ci) && /tests\/backup-db-pipeline\.test\.ts/.test(ci));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
