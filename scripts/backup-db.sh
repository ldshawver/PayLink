#!/usr/bin/env bash
# PayLink — nightly production PostgreSQL backup (encrypted, off-server, restore-verified)
#
# Runbook: docs/deployment/production-db-backup.md
# Scheduled by: scripts/backup/systemd/paylink-db-backup.{service,timer} (runs as paylinkssh)
#
# Pipeline (any failure aborts, alerts, and leaves no partial artifact behind):
#   1. pg_dump --format=custom into a private (0700) work dir
#   2. pg_restore --list sanity check (TOC readable, minimum table count)
#   3. restore drill: the dump is restored into a throwaway, socket-only cluster
#      (scripts/backup-restore-verify.sh) — a backup that cannot be restored is a failure
#   4. gpg --encrypt to an OFFLINE-held public key (the server never holds the private key)
#   5. sha256 + manifest, kept locally (encrypted copy only; plaintext is deleted)
#   6. rclone upload to the off-server remote, then download-and-hash verification
#   7. retention: local prune always; remote prune only when explicitly enabled
#   8. success/failure ping (dead-man healthcheck) + failure email
#
# Configuration (all KEY=value, parsed — never sourced/eval'd):
#   /etc/paylink/.env         app env: DATABASE_URL, SMTP_* (read-only use)
#   /etc/paylink/backup.env   backup env: see scripts/backup/backup.env.example
# Either path can be overridden with PAYLINK_ENV_FILE / PAYLINK_BACKUP_ENV_FILE
# (used by tests). Any PAYLINK_BACKUP_* already set in the environment wins.

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${PAYLINK_ENV_FILE:-/etc/paylink/.env}"
BACKUP_ENV_FILE="${PAYLINK_BACKUP_ENV_FILE:-/etc/paylink/backup.env}"
TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"

log() { echo "[paylink-backup ${TIMESTAMP}] $*"; }
err() { echo "[paylink-backup ${TIMESTAMP}] ERROR: $*" >&2; }

# ---------------------------------------------------------------------------
# Env-file parsing: KEY=value lines only, optional `export `, optional quotes.
# Values are never evaluated by the shell.
# ---------------------------------------------------------------------------
read_env_var() {
  local file="$1" key="$2" line value
  [ -r "$file" ] || return 0
  line="$(grep -E "^(export[[:space:]]+)?${key}=" "$file" | tail -n 1 || true)"
  [ -n "$line" ] || return 0
  value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "$value" =~ ^\"(.*)\"$ ]] || [[ "$value" =~ ^\'(.*)\'$ ]]; then
    value="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$value"
}

# cfg KEY DEFAULT — environment, then backup.env, then default
cfg() {
  local key="$1" default="${2:-}" value
  value="${!key:-}"
  [ -n "$value" ] || value="$(read_env_var "$BACKUP_ENV_FILE" "$key")"
  [ -n "$value" ] || value="$default"
  printf '%s' "$value"
}

LABEL="$(cfg PAYLINK_BACKUP_LABEL prod)"
BACKUP_DIR="$(cfg PAYLINK_BACKUP_DIR /var/backups/paylink/nightly)"
LOCAL_RETAIN_DAYS="$(cfg PAYLINK_BACKUP_LOCAL_RETAIN_DAYS 14)"
REMOTE_RETAIN_DAYS="$(cfg PAYLINK_BACKUP_REMOTE_RETAIN_DAYS "")"
GPG_RECIPIENT="$(cfg PAYLINK_BACKUP_GPG_RECIPIENT "")"
GPG_HOME="$(cfg PAYLINK_BACKUP_GNUPGHOME "${GNUPGHOME:-}")"
RCLONE_REMOTE="$(cfg PAYLINK_BACKUP_RCLONE_REMOTE "")"
RCLONE_CONFIG_PATH="$(cfg PAYLINK_BACKUP_RCLONE_CONFIG "")"
RESTORE_VERIFY="$(cfg PAYLINK_BACKUP_RESTORE_VERIFY 1)"
MIN_TABLES="$(cfg PAYLINK_BACKUP_MIN_TABLES 50)"
REQUIRE_ROWS="$(cfg PAYLINK_BACKUP_REQUIRE_ROWS "companies users")"
HEALTHCHECK_URL="$(cfg PAYLINK_BACKUP_HEALTHCHECK_URL "")"
ALERT_EMAIL="$(cfg PAYLINK_BACKUP_ALERT_EMAIL "")"
DB_URL="$(cfg PAYLINK_BACKUP_DATABASE_URL "")"
[ -n "$DB_URL" ] || DB_URL="$(read_env_var "$ENV_FILE" DATABASE_URL)"

BASENAME="paylink-${LABEL}-${TIMESTAMP}"
WORK_DIR=""
STAGE="startup"

[ -n "$GPG_HOME" ] && export GNUPGHOME="$GPG_HOME"
[ -n "$RCLONE_CONFIG_PATH" ] && export RCLONE_CONFIG="$RCLONE_CONFIG_PATH"

# ---------------------------------------------------------------------------
# Notifications. Neither path ever includes connection strings or secrets.
# ---------------------------------------------------------------------------
ping_healthcheck() {
  local suffix="$1" body="$2"
  [ -n "$HEALTHCHECK_URL" ] || return 0
  curl -fsS -m 15 --retry 3 -o /dev/null --data-raw "$body" "${HEALTHCHECK_URL%/}${suffix}" \
    || err "healthcheck ping failed (non-fatal)"
}

send_failure_email() {
  local message="$1"
  local smtp_user smtp_pass
  smtp_user="$(read_env_var "$ENV_FILE" SMTP_USER)"
  # Production's app env names it SMTP_PASSWORD; older scripts used SMTP_PASS.
  smtp_pass="$(read_env_var "$ENV_FILE" SMTP_PASSWORD)"
  [ -n "$smtp_pass" ] || smtp_pass="$(read_env_var "$ENV_FILE" SMTP_PASS)"
  if [ -z "$ALERT_EMAIL" ] || [ -z "$smtp_user" ] || [ -z "$smtp_pass" ]; then
    log "(failure email skipped — PAYLINK_BACKUP_ALERT_EMAIL or SMTP credentials not configured)"
    return 0
  fi
  BK_MSG="$message" BK_HOST="$(hostname)" BK_TS="$TIMESTAMP" BK_LABEL="$LABEL" \
  BK_SMTP_HOST="$(read_env_var "$ENV_FILE" SMTP_HOST)" \
  BK_SMTP_PORT="$(read_env_var "$ENV_FILE" SMTP_PORT)" \
  BK_SMTP_SECURE="$(read_env_var "$ENV_FILE" SMTP_SECURE)" \
  BK_SMTP_FROM="$(read_env_var "$ENV_FILE" SMTP_FROM)" \
  BK_SMTP_USER="$smtp_user" BK_SMTP_PASS="$smtp_pass" BK_TO="$ALERT_EMAIL" \
  timeout 60 python3 - <<'PYEOF' || err "failure email could not be sent (non-fatal)"
import os, smtplib, ssl
from email.mime.text import MIMEText
e = os.environ
host = e.get("BK_SMTP_HOST") or "smtp.gmail.com"
port = int(e.get("BK_SMTP_PORT") or "587")
implicit_tls = port == 465 or (e.get("BK_SMTP_SECURE", "").lower() == "true")
sender = e.get("BK_SMTP_FROM") or e["BK_SMTP_USER"]
body = (
    f"PayLink {e['BK_LABEL']} database backup FAILED.\n\n"
    f"Error: {e['BK_MSG']}\nHost:  {e['BK_HOST']}\nRun:   {e['BK_TS']} UTC\n\n"
    "Details: journalctl -u paylink-db-backup.service -n 200\n"
    "Runbook: docs/deployment/production-db-backup.md\n"
)
m = MIMEText(body)
m["Subject"] = f"PayLink {e['BK_LABEL']} backup FAILED - {e['BK_TS']}"
m["From"] = sender
m["To"] = e["BK_TO"]
ctx = ssl.create_default_context()
if implicit_tls:
    s = smtplib.SMTP_SSL(host, port, context=ctx, timeout=30)
else:
    s = smtplib.SMTP(host, port, timeout=30)
    s.starttls(context=ctx)
with s:
    s.login(e["BK_SMTP_USER"], e["BK_SMTP_PASS"])
    s.sendmail(sender, [e["BK_TO"]], m.as_string())
print("failure alert email sent")
PYEOF
}

on_exit() {
  local code=$?
  trap - EXIT
  if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
    rm -rf -- "$WORK_DIR"
  fi
  if [ "$code" -ne 0 ]; then
    err "backup FAILED at stage '${STAGE}' (exit ${code})"
    ping_healthcheck "/fail" "PayLink ${LABEL} backup FAILED at stage '${STAGE}' (exit ${code}) on $(hostname)"
    send_failure_email "failed at stage '${STAGE}' (exit ${code})"
  fi
  exit "$code"
}
trap on_exit EXIT
trap 'exit 130' INT TERM

fail() { err "$*"; exit 1; }

# ---------------------------------------------------------------------------
# 0. Preflight
# ---------------------------------------------------------------------------
STAGE="preflight"
ping_healthcheck "/start" ""
for tool in pg_dump pg_restore gpg rclone python3 sha256sum flock; do
  command -v "$tool" >/dev/null 2>&1 || fail "required tool not found on PATH: $tool"
done
[ -n "$DB_URL" ] || fail "no DATABASE_URL in $ENV_FILE and PAYLINK_BACKUP_DATABASE_URL not set"
[ -n "$GPG_RECIPIENT" ] || fail "PAYLINK_BACKUP_GPG_RECIPIENT is not set (refusing to write unencrypted off-server backups)"
[ -n "$RCLONE_REMOTE" ] || fail "PAYLINK_BACKUP_RCLONE_REMOTE is not set"
[[ "$LOCAL_RETAIN_DAYS" =~ ^[0-9]+$ ]] && [ "$LOCAL_RETAIN_DAYS" -ge 2 ] \
  || fail "PAYLINK_BACKUP_LOCAL_RETAIN_DAYS must be an integer >= 2"
if [ -n "$REMOTE_RETAIN_DAYS" ]; then
  [[ "$REMOTE_RETAIN_DAYS" =~ ^[0-9]+$ ]] && [ "$REMOTE_RETAIN_DAYS" -ge 7 ] \
    || fail "PAYLINK_BACKUP_REMOTE_RETAIN_DAYS must be an integer >= 7 (or unset to leave remote retention to bucket lifecycle rules)"
fi
gpg --batch --list-keys "$GPG_RECIPIENT" >/dev/null 2>&1 \
  || fail "GPG recipient key not found in keyring (GNUPGHOME=${GNUPGHOME:-~/.gnupg})"
if gpg --batch --list-secret-keys "$GPG_RECIPIENT" >/dev/null 2>&1; then
  log "WARNING: the private key for the backup recipient is present on this host; it should be held offline only"
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || fail "another backup run holds $BACKUP_DIR/.backup.lock"

WORK_DIR="$(mktemp -d "$BACKUP_DIR/.work-XXXXXX")"
chmod 700 "$WORK_DIR"

# Connection details go into a private pgpass file + PG* env vars so the
# password never appears in argv (visible to every local user via ps).
STAGE="connect-config"
mapfile -t PGPARTS < <(BK_URL="$DB_URL" BK_PGPASS="$WORK_DIR/pgpass" python3 - <<'PYEOF'
import os, sys
from urllib.parse import urlsplit, unquote, parse_qs
u = urlsplit(os.environ["BK_URL"])
if u.scheme not in ("postgres", "postgresql"):
    sys.exit("DATABASE_URL is not a postgres URL")
q = parse_qs(u.query)
host = unquote(u.hostname or "") or q.get("host", ["127.0.0.1"])[0]
port = str(u.port or q.get("port", ["5432"])[0])
user = unquote(u.username or "") or q.get("user", [""])[0]
pw = unquote(u.password or "") or q.get("password", [""])[0]
db = unquote(u.path.lstrip("/")) or q.get("dbname", [""])[0]
sslmode = q.get("sslmode", [""])[0]
if not db:
    sys.exit("DATABASE_URL has no database name")
esc = lambda v: v.replace("\\", "\\\\").replace(":", "\\:")
fd = os.open(os.environ["BK_PGPASS"], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.write(":".join(esc(v) for v in (host, port, db, user or "*", pw)) + "\n")
for v in (host, port, user, db, sslmode):
    print(v)
PYEOF
)
[ "${#PGPARTS[@]}" -eq 5 ] || fail "could not parse the database URL"
export PGPASSFILE="$WORK_DIR/pgpass" PGHOST="${PGPARTS[0]}" PGPORT="${PGPARTS[1]}" PGDATABASE="${PGPARTS[3]}"
[ -n "${PGPARTS[2]}" ] && export PGUSER="${PGPARTS[2]}"
[ -n "${PGPARTS[4]}" ] && export PGSSLMODE="${PGPARTS[4]}"
unset DB_URL

# ---------------------------------------------------------------------------
# 1. Dump (custom format: compressed, TOC-verifiable, selectively restorable)
# ---------------------------------------------------------------------------
STAGE="pg_dump"
DUMP="$WORK_DIR/${BASENAME}.dump"
log "dumping database '${PGDATABASE}' on ${PGHOST}:${PGPORT}"
pg_dump --no-password --format=custom --compress=6 --file="$DUMP" 2>"$WORK_DIR/pg_dump.err" \
  || { sed 's/^/  pg_dump: /' "$WORK_DIR/pg_dump.err" >&2; fail "pg_dump failed"; }
test -s "$DUMP" || fail "pg_dump produced an empty file"
SERVER_VERSION="$(psql --no-password -XAtc 'SHOW server_version' 2>/dev/null || echo unknown)"

# ---------------------------------------------------------------------------
# 2. TOC sanity
# ---------------------------------------------------------------------------
STAGE="toc-check"
pg_restore --list "$DUMP" >"$WORK_DIR/toc.txt" || fail "pg_restore cannot read the dump TOC"
TOC_TABLES="$(awk '$4 == "TABLE" && $5 != "DATA"' "$WORK_DIR/toc.txt" | wc -l)"
TOC_DATA="$(awk '$4 == "TABLE" && $5 == "DATA"' "$WORK_DIR/toc.txt" | wc -l)"
[ "$TOC_TABLES" -ge "$MIN_TABLES" ] \
  || fail "dump contains ${TOC_TABLES} tables, below PAYLINK_BACKUP_MIN_TABLES=${MIN_TABLES}"
log "dump OK: $(du -h "$DUMP" | cut -f1), ${TOC_TABLES} tables, ${TOC_DATA} data sections"

# ---------------------------------------------------------------------------
# 3. Restore drill into a throwaway cluster
# ---------------------------------------------------------------------------
STAGE="restore-verify"
REPORT="$WORK_DIR/restore-report.txt"
if [ "$RESTORE_VERIFY" = "1" ]; then
  "$SCRIPT_DIR/backup-restore-verify.sh" \
    --min-tables "$MIN_TABLES" --require-rows "$REQUIRE_ROWS" --report "$REPORT" "$DUMP" \
    || fail "restore drill failed — this backup is NOT recoverable"
else
  log "WARNING: restore drill disabled (PAYLINK_BACKUP_RESTORE_VERIFY=${RESTORE_VERIFY})"
  echo "restore drill: SKIPPED" >"$REPORT"
fi

# ---------------------------------------------------------------------------
# 4. Encrypt, checksum, manifest
# ---------------------------------------------------------------------------
STAGE="encrypt"
PLAIN_SHA="$(sha256sum "$DUMP" | cut -d' ' -f1)"
ENC="$WORK_DIR/${BASENAME}.dump.gpg"
gpg --batch --yes --quiet --trust-model always --recipient "$GPG_RECIPIENT" \
  --encrypt --output "$ENC" "$DUMP" || fail "gpg encryption failed"
# --list-packets exits non-zero here by design (no secret key on this host), so
# only its output is checked.
PACKETS="$(gpg --batch --list-packets "$ENC" 2>/dev/null || true)"
grep -q '^:pubkey enc packet' <<<"$PACKETS" \
  || fail "encrypted file does not carry a public-key encryption packet"
rm -f -- "$DUMP"
(cd "$WORK_DIR" && sha256sum "${BASENAME}.dump.gpg" >"${BASENAME}.dump.gpg.sha256")
ENC_SHA="$(cut -d' ' -f1 "$WORK_DIR/${BASENAME}.dump.gpg.sha256")"

MANIFEST="$WORK_DIR/${BASENAME}.manifest.txt"
{
  echo "label=${LABEL}"
  echo "created_utc=${TIMESTAMP}"
  echo "host=$(hostname)"
  echo "database=${PGDATABASE}"
  echo "server_version=${SERVER_VERSION}"
  echo "pg_dump_version=$(pg_dump --version)"
  echo "format=pg_dump custom, gpg public-key encrypted"
  echo "gpg_recipient=${GPG_RECIPIENT}"
  echo "toc_tables=${TOC_TABLES}"
  echo "plain_sha256=${PLAIN_SHA}"
  echo "encrypted_sha256=${ENC_SHA}"
  echo "encrypted_bytes=$(stat -c %s "$ENC")"
  echo "--- restore drill ---"
  cat "$REPORT"
} >"$MANIFEST"

# ---------------------------------------------------------------------------
# 5. Keep the encrypted copy locally
# ---------------------------------------------------------------------------
STAGE="local-store"
for f in "${BASENAME}.dump.gpg" "${BASENAME}.dump.gpg.sha256" "${BASENAME}.manifest.txt"; do
  mv -- "$WORK_DIR/$f" "$BACKUP_DIR/$f"
done
log "stored locally: $BACKUP_DIR/${BASENAME}.dump.gpg"

# ---------------------------------------------------------------------------
# 6. Off-server upload + read-back verification
# ---------------------------------------------------------------------------
STAGE="upload"
REMOTE_DIR="${RCLONE_REMOTE%/}/$(date -u '+%Y/%m')"
for f in "${BASENAME}.dump.gpg" "${BASENAME}.dump.gpg.sha256" "${BASENAME}.manifest.txt"; do
  rclone copyto --retries 3 --low-level-retries 10 "$BACKUP_DIR/$f" "$REMOTE_DIR/$f" \
    || fail "upload failed for $f"
done
STAGE="remote-verify"
REMOTE_SHA="$(rclone cat "$REMOTE_DIR/${BASENAME}.dump.gpg" | sha256sum | cut -d' ' -f1)"
[ "$REMOTE_SHA" = "$ENC_SHA" ] || fail "off-server copy hash mismatch (local ${ENC_SHA}, remote ${REMOTE_SHA})"
log "off-server copy verified (sha256 ${ENC_SHA:0:16}…)"

# ---------------------------------------------------------------------------
# 7. Retention (only files this script creates; never pre-deploy dumps)
# ---------------------------------------------------------------------------
STAGE="retention"
PRUNED="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "paylink-${LABEL}-*" -mtime "+${LOCAL_RETAIN_DAYS}" -print -delete | wc -l)"
log "local retention: pruned ${PRUNED} file(s) older than ${LOCAL_RETAIN_DAYS} days"
if [ -n "$REMOTE_RETAIN_DAYS" ]; then
  rclone delete --min-age "${REMOTE_RETAIN_DAYS}d" --include "paylink-${LABEL}-*" "${RCLONE_REMOTE%/}" \
    || fail "remote retention prune failed"
  log "remote retention: pruned objects older than ${REMOTE_RETAIN_DAYS} days"
fi

# ---------------------------------------------------------------------------
# 8. Success
# ---------------------------------------------------------------------------
STAGE="done"
printf '%s %s\n' "$TIMESTAMP" "${BASENAME}.dump.gpg" >"$BACKUP_DIR/last-success"
log "backup complete: ${BASENAME}.dump.gpg"
ping_healthcheck "" "PayLink ${LABEL} backup OK: ${BASENAME}.dump.gpg (${TOC_TABLES} tables)"
