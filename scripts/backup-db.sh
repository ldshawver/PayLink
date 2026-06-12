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
# Optional: set BACKUP_ALERT_EMAIL in /etc/paylink/.env to receive failure alerts.

set -euo pipefail

ENV_FILE="/etc/paylink/.env"
BACKUP_DIR="/var/backups/paylink"
RETAIN_DAYS=30
TIMESTAMP=$(date -u '+%Y-%m-%d_%H%M%S')
LOG_PREFIX="[paylink-backup ${TIMESTAMP}]"

# ── Helper: send failure email via SMTP if vars are set ──────────────────────
# Must be defined before use.
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
m['Subject'] = f'❌ PayLink backup FAILED — {ts}'
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

# ── Load environment ──────────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "$LOG_PREFIX ERROR: $ENV_FILE not found — cannot run backup"
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "$LOG_PREFIX ERROR: DATABASE_URL is not set in $ENV_FILE"
  exit 1
fi

# ── Ensure backup directory exists ────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"

# ── Run backup ────────────────────────────────────────────────────────────────
BACKUP_FILE="$BACKUP_DIR/paylink_${TIMESTAMP}.sql.gz"
echo "$LOG_PREFIX Starting backup → $BACKUP_FILE"

if pg_dump "$DATABASE_URL" | gzip -9 > "$BACKUP_FILE"; then
  SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
  echo "$LOG_PREFIX ✓ Backup written — $SIZE"
else
  echo "$LOG_PREFIX ❌ pg_dump failed — removing partial file"
  rm -f "$BACKUP_FILE"
  send_failure_email "pg_dump exited non-zero — no backup was saved for ${TIMESTAMP}"
  exit 1
fi

# ── Verify the backup is readable ────────────────────────────────────────────
if ! gunzip -t "$BACKUP_FILE" 2>/dev/null; then
  echo "$LOG_PREFIX ❌ Backup integrity check failed — file may be corrupt"
  send_failure_email "gunzip -t integrity check failed for $BACKUP_FILE"
  rm -f "$BACKUP_FILE"
  exit 1
fi
echo "$LOG_PREFIX ✓ Integrity check passed"

# ── Prune old backups (keep RETAIN_DAYS days of history) ─────────────────────
PRUNED=$(find "$BACKUP_DIR" -name "paylink_*.sql.gz" -mtime "+${RETAIN_DAYS}" -print -delete 2>/dev/null | wc -l)
if [ "$PRUNED" -gt 0 ]; then
  echo "$LOG_PREFIX Pruned $PRUNED backup(s) older than ${RETAIN_DAYS} days"
fi

REMAINING=$(find "$BACKUP_DIR" -name "paylink_*.sql.gz" | wc -l)
echo "$LOG_PREFIX ✓ Done — $REMAINING backup(s) retained in $BACKUP_DIR"
