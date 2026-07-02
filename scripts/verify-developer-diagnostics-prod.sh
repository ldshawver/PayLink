#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://app.mypaylink.app}"
COOKIE_FILE="${COOKIE_FILE:-/tmp/paylink-admin.cookies}"
ZIP_PATH="${ZIP_PATH:-/tmp/paylink-diagnostics.zip}"
SCAN_DIR="${SCAN_DIR:-/tmp/paylink-diagnostics-scan}"

printf '\n[1/5] Luxit service/log commands\n'
sudo tail -n 500 /var/log/luxit-error.log >/tmp/luxit-error-tail.txt
sudo tail -n 500 /var/log/luxit-access.log >/tmp/luxit-access-tail.txt
sudo journalctl -u luxit -n 500 --no-pager >/tmp/luxit-journal.txt
sudo systemctl status luxit --no-pager >/tmp/luxit-systemctl-status.txt || true
wc -l /tmp/luxit-error-tail.txt /tmp/luxit-access-tail.txt /tmp/luxit-journal.txt /tmp/luxit-systemctl-status.txt

printf '\n[2/5] Export diagnostics ZIP using an existing allowed-admin cookie jar\n'
if [[ ! -f "$COOKIE_FILE" ]]; then
  echo "Missing COOKIE_FILE=$COOKIE_FILE. Log in as platform_owner, super_admin, or system_admin and save cookies first." >&2
  exit 2
fi
curl -fsS -b "$COOKIE_FILE" -o "$ZIP_PATH" "$BASE_URL/api/admin/diagnostics/export"
unzip -l "$ZIP_PATH"

printf '\n[3/5] Verify required ZIP entries\n'
for entry in \
  logs/luxit-access.log \
  logs/luxit-error.log \
  logs/journal-luxit.log \
  json/environment.json \
  json/system-health.json \
  json/recent-errors.json \
  json/appdr-status.json \
  json/github-status.json \
  json/versions.json; do
  unzip -l "$ZIP_PATH" "$entry" | grep -F "$entry" >/dev/null
  echo "present: $entry"
done

printf '\n[4/5] Redaction scan\n'
rm -rf "$SCAN_DIR"
mkdir -p "$SCAN_DIR"
unzip -q "$ZIP_PATH" -d "$SCAN_DIR"
if rg -n "(ghp_|github_pat_|Bearer [A-Za-z0-9._-]+|api[_-]?key[=:]|password[=:]|session[=:]|jwt[=:]|[0-9]{3}-[0-9]{2}-[0-9]{4}|[0-9]{2}-[0-9]{7}|routing[=: ]+[0-9]{4,}|account[=: ]+[0-9]{4,})" "$SCAN_DIR"; then
  echo "Potential unredacted sensitive value found. Review before attaching ZIP." >&2
  exit 3
fi
echo "redaction scan: no obvious raw secrets/PII/bank identifiers found"

printf '\n[5/5] Environment JSON presence-only preview\n'
cat "$SCAN_DIR/json/environment.json"
printf '\nVerification complete. Attach sanitized command output to PR. Do not attach the ZIP publicly unless approved.\n'
