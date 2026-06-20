#!/usr/bin/env bash
set -u -o pipefail

BASE_URL="${BASE_URL:-https://mypaylink.app}"
APP_BASE_URL="${APP_BASE_URL:-https://app.mypaylink.app}"
EXPECTED_COMMIT="${EXPECTED_COMMIT:-}"
AFFECTED_CONTRACT_ID="${AFFECTED_CONTRACT_ID:-735551c2-ec6c-41e6-976d-1eef4e13bfa5}"
REPORT_FILE="${REPORT_FILE:-documenso-signing-smoke-report.txt}"

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
: > "$REPORT_FILE"

log() {
  printf '%s\n' "$*" | tee -a "$REPORT_FILE"
}

record_pass() { PASS_COUNT=$((PASS_COUNT + 1)); log "PASS $*"; }
record_warn() { WARN_COUNT=$((WARN_COUNT + 1)); log "WARN $*"; }
record_fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); log "FAIL $*"; }

check_url() {
  local label="$1"
  local url="$2"
  local expected_pattern="${3:-^(200|302)$}"
  local tmp_body tmp_headers status final_url
  tmp_body="$(mktemp)"
  tmp_headers="$(mktemp)"

  status="$(curl -k -sS -L --max-time 30 -D "$tmp_headers" -o "$tmp_body" -w '%{http_code}' "$url" 2>>"$REPORT_FILE" || printf 'ERR')"
  final_url="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {print $2}' "$tmp_headers" | tail -n 1 | tr -d '\r' || true)"

  if [ "$status" = "ERR" ]; then
    record_fail "$label — request failed: $url"
    rm -f "$tmp_body" "$tmp_headers"
    return
  fi

  if ! printf '%s' "$status" | grep -Eq "$expected_pattern"; then
    record_fail "$label — unexpected HTTP $status for $url${final_url:+ (redirect: $final_url)}"
    rm -f "$tmp_body" "$tmp_headers"
    return
  fi

  if grep -Eiq '(404 Not Found|<title>404|default nginx|Welcome to nginx|CloudPanel|The requested URL was not found on the server)' "$tmp_body"; then
    record_fail "$label — raw/default 404-like page detected at $url"
    rm -f "$tmp_body" "$tmp_headers"
    return
  fi

  record_pass "$label — HTTP $status ${final_url:+redirect: $final_url }$url"
  rm -f "$tmp_body" "$tmp_headers"
}

check_optional_url() {
  local env_name="$1"
  local label="$2"
  local url="${!env_name:-}"
  if [ -z "$url" ]; then
    record_warn "$label — skipped; set $env_name to validate this state"
    return
  fi
  check_url "$label" "$url" '^(200|302)$'
}

log "Documenso signing smoke test — $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
log "BASE_URL=$BASE_URL"
log "APP_BASE_URL=$APP_BASE_URL"
log "AFFECTED_CONTRACT_ID=$AFFECTED_CONTRACT_ID"

check_url "home" "$BASE_URL/" '^(200|302)$'
check_url "login" "$BASE_URL/login" '^(200|302)$'
check_url "app shell" "$BASE_URL/app" '^(200|302)$'
check_url "contractor hub shell" "$BASE_URL/app/contractor-hub" '^(200|302)$'
check_url "affected contract signing URL" "$APP_BASE_URL/app/contractor-hub/contracts/$AFFECTED_CONTRACT_ID/sign" '^(200|302)$'
check_url "malformed contract signing URL" "$BASE_URL/app/contractor-hub/contracts/not-a-valid-id/sign" '^(200|302)$'
check_url "public sign fallback" "$BASE_URL/sign/test-invalid" '^(200|302)$'

check_optional_url EXPIRED_SIGNING_URL "expired signer URL"
check_optional_url ALREADY_SIGNED_URL "already signed signer URL"
check_optional_url FULLY_SIGNED_URL "fully signed contract URL"
check_optional_url UNAUTHORIZED_SIGNING_URL "unauthorized signer URL"

version_body="$(mktemp)"
version_status="$(curl -k -sS --max-time 20 -o "$version_body" -w '%{http_code}' "$BASE_URL/api/version" 2>>"$REPORT_FILE" || printf 'ERR')"
if [ "$version_status" = "200" ]; then
  version_commit="$(sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$version_body" | head -n 1)"
  if [ -n "$EXPECTED_COMMIT" ] && [ "$version_commit" != "$EXPECTED_COMMIT" ]; then
    record_fail "version — commit mismatch: got ${version_commit:-unknown}, expected $EXPECTED_COMMIT"
  else
    record_pass "version — commit ${version_commit:-unknown}"
  fi
else
  record_fail "version — /api/version returned $version_status"
fi
rm -f "$version_body"

log "Summary: PASS=$PASS_COUNT WARN=$WARN_COUNT FAIL=$FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
