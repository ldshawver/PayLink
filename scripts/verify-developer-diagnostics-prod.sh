#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://app.mypaylink.app}"
COOKIE_FILE="${COOKIE_FILE:-/tmp/mypaylink-admin.cookies}"
ZIP_PATH="${ZIP_PATH:-/tmp/mypaylink-diagnostics.zip}"
SCAN_DIR="${SCAN_DIR:-/tmp/mypaylink-diagnostics-scan}"
SERVICE_NAME="${PAYLINK_SYSTEMD_SERVICE:-paylink}"

if [[ ! -f "$COOKIE_FILE" ]]; then
  echo "Missing COOKIE_FILE=$COOKIE_FILE. Log in as platform_owner, super_admin, or system_admin and save cookies first." >&2
  exit 2
fi

printf '\n[1/4] MyPayLink service status (best effort)\n'
systemctl status "$SERVICE_NAME" --no-pager || true
journalctl -u "$SERVICE_NAME" -n 100 --no-pager >/tmp/mypaylink-journal.txt || true
wc -l /tmp/mypaylink-journal.txt || true

printf '\n[2/4] Export diagnostics ZIP\n'
curl -fsS -b "$COOKIE_FILE" -o "$ZIP_PATH" "$BASE_URL/api/admin/diagnostics/export"
unzip -l "$ZIP_PATH"

printf '\n[3/4] Verify required ZIP entries\n'
for entry in \
  logs/app.log \
  logs/error.log \
  logs/appdr.log \
  logs/github.log \
  logs/payroll.log \
  logs/pdf.log \
  logs/database.log \
  logs/security.log \
  logs/journal.log \
  json/environment.json \
  json/system-health.json \
  json/recent-errors.json \
  json/appdr-status.json \
  json/github-status.json \
  json/versions.json; do
  unzip -l "$ZIP_PATH" "$entry" | grep -F "$entry" >/dev/null
  echo "present: $entry"
done

printf '\n[4/4] Redaction scan\n'
rm -rf "$SCAN_DIR"
mkdir -p "$SCAN_DIR"
unzip -q "$ZIP_PATH" -d "$SCAN_DIR"
if rg -n "(ghp_|github_pat_|Bearer [A-Za-z0-9._-]+|token=|session=|jwt=|password=|api[_-]?key=|key=|secret=|[0-9]{3}-[0-9]{2}-[0-9]{4}|[0-9]{2}-[0-9]{7}|routing[=: ]+[0-9]{4,}|account[=: ]+[0-9]{4,})" "$SCAN_DIR"; then
  echo "Potential unredacted sensitive value found. Review before attaching ZIP." >&2
  exit 3
fi
echo "redaction scan: no obvious raw secrets/PII/bank identifiers found"
