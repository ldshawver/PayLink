#!/bin/bash
# PayLink — Nightly Database Backup
#
# Usage:
#   bash scripts/backup-db.sh
#
# Cron (run as paylinkssh, 2 AM UTC every day):
#   0 2 * * * /home/paylinkssh/paylink-app/PayLink/scripts/backup-db.sh >> /var/log/paylink-backup.log 2>&1
#
# One-time setup on VPS:
#   touch /var/log/paylink-backup.log
#   chown paylinkssh:paylinkssh /var/log/paylink-backup.log
#   mkdir -p /var/backups/paylink
#   chown paylinkssh:paylinkssh /var/backups/paylink
#   chmod +x /home/paylinkssh/paylink-app/PayLink/scripts/backup-db.sh
#
# Requirements:
#   - DATABASE_URL set in environment or sourced from /etc/paylink/.env
#     (falls back to individual PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD vars)
#   - pg_dump available on PATH
#   - Write access to BACKUP_DIR
#
# The write is atomic: pg_dump targets a .tmp file; the .tmp is integrity-checked
# before being renamed to the final filename. A failed run never leaves a partial
# file at the canonical path.
#
# Optional: set BACKUP_ALERT_EMAIL in /etc/paylink/.env to receive failure alerts.

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (override via environment)
# ---------------------------------------------------------------------------
BACKUP_DIR="${PAYLINK_BACKUP_DIR:-/var/backups/paylink}"
RETAIN_DAYS="${PAYLINK_BACKUP_RETAIN_DAYS:-30}"
ENV_FILE="/etc/paylink/.env"
TIMESTAMP=$(date -u '+%Y-%m-%d_%H%M%S')
LOG_PREFIX="[paylink-backup ${TIMESTAMP}]"
FINAL_FILE="${BACKUP_DIR}/paylink_${TIMESTAMP}.sql.gz"
TMP_FILE="${FINAL_FILE}.tmp"

# ---------------------------------------------------------------------------
# Helper: send failure email via SMTP if vars are set
# ---------------------------------------------------------------------------
send_failure_email() {
  local MESSAGE="$1"
  if [ -z "${SMTP_USER:-}" ] || [ -z "${SMTP_PASS:-}" ] || [ -z "${BACKUP_ALERT_EMAIL:-}" ]; then
    echo "$LOG_PREFIX (Email alert skipped — SMTP_USER, SMTP_PASS, or BACKUP_ALERT_EMAIL not set in $ENV_FILE)"
    return 0
  fi

  local SMTP_HOST_VAL="${SMTP_HOST:-smtp.gmail.com}"
  local SMTP_PORT_VAL="${SMTP_PORT:-587}"
  local FROM_ADDR="${SMTP_FROM:-$SMTP_USER}"
  local HOSTNAME_VAL
  HOSTNAME_VAL=$(hostname)

  python3 - "$MESSAGE" "$HOSTNAME_VAL" "$TIMESTAMP" \
            "$SMTP_HOST_VAL" "$SMTP_PORT_VAL" \
            "$FROM_ADDR" "$SMTP_USER" "$SMTP_PASS" \
            "$BACKUP_ALERT_EMAIL" <<'PYEOF'
import sys, smtplib, ssl
from email.mime.text import MIMEText

msg_body, host, ts, smtp_host, smtp_port, from_addr, smtp_user, smtp_pass, to_addr = sys.argv[1:]

body = f"""PayLink nightly database backup FAILED.

Error:  {msg_body}
Host:   {host}
Time:   {ts} UTC

Manual backup command:
  source /etc/paylink/.env
  pg_dump "$DATABASE_URL" | gzip -9 > /var/backups/paylink/paylink_manual_$(date +%Y%m%d_%H%M%S).sql.gz

See /var/log/paylink-backup.log for full details.
"""

m = MIMEText(body)
m['Subject'] = f'\u274c PayLink backup FAILED \u2014 {ts}'
m['From'] = from_addr
m['To'] = to_addr

ctx = ssl.create_default_context()
with smtplib.SMTP(smtp_host, int(smtp_port)) as s:
    s.starttls(context=ctx)
    s.login(smtp_user, smtp_pass)
    s.sendmail(from_addr, [to_addr], m.as_string())
print(f'Failure alert sent to {to_addr}')
PYEOF
}

# ---------------------------------------------------------------------------
# Source production env if running as cron (no shell env loaded)
# ---------------------------------------------------------------------------
if [ -f "$ENV_FILE" ]; then
  set -o allexport
  # shellcheck disable=SC1090
  source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | grep -v '^#')
  set +o allexport
else
  echo "$LOG_PREFIX ERROR: $ENV_FILE not found — cannot run backup"
  exit 1
fi

# ---------------------------------------------------------------------------
# Build connection string
# Prefer DATABASE_URL. Fall back to individual PG* vars.
# ---------------------------------------------------------------------------
if [ -n "${DATABASE_URL:-}" ]; then
  PG_CONNSTR="$DATABASE_URL"
elif [ -n "${PGDATABASE:-}" ]; then
  _host="${PGHOST:-127.0.0.1}"
  _port="${PGPORT:-5432}"
  _user="${PGUSER:-}"
  _db="${PGDATABASE}"
  if [ -n "$_user" ]; then
    PG_CONNSTR="postgresql://${_user}@${_host}:${_port}/${_db}"
  else
    PG_CONNSTR="postgresql://${_host}:${_port}/${_db}"
  fi
else
  echo "$LOG_PREFIX ERROR: Neither DATABASE_URL nor PGDATABASE is set in $ENV_FILE"
  send_failure_email "Neither DATABASE_URL nor PGDATABASE is set — cannot determine connection"
  exit 1
fi

# ---------------------------------------------------------------------------
# Ensure backup directory exists
# ---------------------------------------------------------------------------
mkdir -p "$BACKUP_DIR"

# ---------------------------------------------------------------------------
# Cleanup trap — remove the temp file on unexpected exit
# ---------------------------------------------------------------------------
cleanup() {
  local code=$?
  if [ -f "$TMP_FILE" ]; then
    rm -f "$TMP_FILE"
    echo "$LOG_PREFIX Removed incomplete temp file: ${TMP_FILE}"
  fi
  if [ "$code" -ne 0 ]; then
    send_failure_email "Script exited with code ${code} — see log for details" 2>/dev/null || true
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Run backup into a temp file (atomic write pattern)
# ---------------------------------------------------------------------------
echo "$LOG_PREFIX Starting backup -> ${FINAL_FILE}"

pg_dump \
  --no-password \
  --format=plain \
  --clean \
  --if-exists \
  --dbname="${PG_CONNSTR}" \
  | gzip -9 > "${TMP_FILE}"

# ---------------------------------------------------------------------------
# Integrity check before promoting the temp file
# ---------------------------------------------------------------------------
if gunzip -t "${TMP_FILE}" 2>/dev/null; then
  echo "$LOG_PREFIX Integrity check passed"
else
  echo "$LOG_PREFIX ERROR: Integrity check FAILED — backup discarded"
  exit 2
fi

# Atomically promote temp -> final
mv "${TMP_FILE}" "${FINAL_FILE}"

SIZE=$(du -sh "${FINAL_FILE}" | cut -f1)
echo "$LOG_PREFIX Backup written — $SIZE"

# Disarm trap (temp file is gone; success path should not send alert)
trap - EXIT INT TERM

# ---------------------------------------------------------------------------
# Prune old backups (older than RETAIN_DAYS days)
# ---------------------------------------------------------------------------
PRUNED=$(find "$BACKUP_DIR" -name "paylink_*.sql.gz" -mtime "+${RETAIN_DAYS}" -print -delete 2>/dev/null | wc -l)
if [ "$PRUNED" -gt 0 ]; then
  echo "$LOG_PREFIX Pruned $PRUNED backup(s) older than ${RETAIN_DAYS} days"
fi

REMAINING=$(find "$BACKUP_DIR" -name "paylink_*.sql.gz" | wc -l)
echo "$LOG_PREFIX Done — $REMAINING backup(s) retained in $BACKUP_DIR"
