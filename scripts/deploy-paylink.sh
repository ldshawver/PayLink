#!/bin/bash
set -euo pipefail

TARGET_ENV="${1:-staging}"
RELEASE_TAG="${2:-${RELEASE_TAG:-}}"
DEPLOYED_BY="${GITHUB_ACTOR:-${USER:-unknown}}"
REPO_URL="git@github.com:ldshawver/PayLink.git"
PM2_USER="paylinkssh"
BACKUP_DIR="/home/paylinkssh/backups"
HISTORY_LOG="/home/paylinkssh/deployment-history.log"
NGINX_CONF_PATH="/etc/nginx/sites-enabled/mypaylink.app.conf"
ROLLBACK_STATUS="not_required"
MIGRATION_STATUS="not_checked"

case "$TARGET_ENV" in
  production|prod)
    TARGET_ENV="production"
    APP_DIR="/home/paylinkssh/paylink-app/PayLink"
    ENV_FILE="/etc/paylink/.env"
    PM2_PROCESS="paylink"
    APP_PORT="8000"
    ;;
  staging|stage)
    TARGET_ENV="staging"
    APP_DIR="/home/paylinkssh/paylink-staging/PayLink"
    ENV_FILE="/etc/paylink/.env.staging"
    PM2_PROCESS="paylink-staging"
    APP_PORT="8010"
    ;;
  *)
    echo "Usage: $0 [production|staging] [release-tag]" >&2
    exit 2
    ;;
esac

if [ "$TARGET_ENV" = "production" ]; then
  if ! [[ "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9]+)*$ ]]; then
    echo "ERROR: production deployments require a Git release tag like v2.1.1." >&2
    exit 2
  fi
else
  RELEASE_TAG=""
fi

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
record_history() {
  status="$1"; commit="$2"; version="$3"; tag="$4"; migration="$5"; rollback="$6"
  mkdir -p "$(dirname "$HISTORY_LOG")"
  printf '{"version":"%s","commit":"%s","release_tag":"%s","environment":"%s","deployment_time":"%s","deployed_by":"%s","migration_status":"%s","rollback_status":"%s","status":"%s"}\n' \
    "$(json_escape "$version")" "$(json_escape "$commit")" "$(json_escape "$tag")" "$(json_escape "$TARGET_ENV")" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$(json_escape "$DEPLOYED_BY")" "$(json_escape "$migration")" "$(json_escape "$rollback")" "$(json_escape "$status")" >> "$HISTORY_LOG"
}
read_env_value() { node -e 'const fs=require("fs"); const k=process.argv[2], f=process.argv[3]; for (const line of fs.readFileSync(f,"utf8").split(/\r?\n/)) { const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1]===k) { let v=m[2].trim(); if ((v.startsWith("\"")&&v.endsWith("\""))||(v.startsWith("\'" )&&v.endsWith("\'"))) v=v.slice(1,-1); process.stdout.write(v); process.exit(0); } } process.exit(1);' "$2" "$1"; }

CURRENT_COMMIT="unknown"
NEW_COMMIT="unknown"
PACKAGE_VERSION="unknown"
BACKUP_FILE=""
NGINX_BACKUP=""

echo "=========================================="
echo "PayLink Deploy ($TARGET_ENV) - $(date)"
echo "Repo: $REPO_URL"
echo "Path: $APP_DIR"
echo "PM2 user: $PM2_USER"
echo "PM2 process: $PM2_PROCESS"
echo "Port: $APP_PORT"
echo "Env: $ENV_FILE"
echo "Release tag: ${RELEASE_TAG:-none}"
echo "=========================================="

if [ ! -f "$ENV_FILE" ]; then echo "ERROR: $ENV_FILE not found. Aborting."; exit 1; fi
if [ "$TARGET_ENV" = "staging" ]; then
  PROD_DB="$(read_env_value /etc/paylink/.env DATABASE_URL 2>/dev/null || true)"
  STAGING_DB="$(read_env_value /etc/paylink/.env.staging DATABASE_URL 2>/dev/null || true)"
  if [ -z "$PROD_DB" ] || [ -z "$STAGING_DB" ] || [ "$PROD_DB" = "$STAGING_DB" ]; then
    echo "ERROR: staging DATABASE_URL must exist and differ from production DATABASE_URL." >&2
    exit 1
  fi
fi

# Never source production env globally; read only specific values needed for preflight.
DATABASE_URL_FOR_BACKUP="$(read_env_value "$ENV_FILE" DATABASE_URL)"
APP_BASE_URL_FOR_HEALTH="$(read_env_value "$ENV_FILE" APP_BASE_URL 2>/dev/null || true)"
NODE_ENV_FOR_CHECK="$(read_env_value "$ENV_FILE" NODE_ENV 2>/dev/null || echo production)"

cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
git remote set-url origin "$REPO_URL" || true
CURRENT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
CURRENT_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
echo "Current commit: $CURRENT_COMMIT"
echo "Current version: $CURRENT_VERSION"

echo "1. Mandatory pre-deployment gate..."
umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/paylink_${TARGET_ENV}_backup_$(date +%Y%m%d_%H%M%S).sql"
( DATABASE_URL="$DATABASE_URL_FOR_BACKUP"; pg_dump "$DATABASE_URL" > "$BACKUP_FILE" ) || { echo "ERROR: PostgreSQL backup failed"; exit 1; }
chmod 600 "$BACKUP_FILE"
pm2 save --force || { echo "ERROR: PM2 save failed"; exit 1; }
NGINX_BACKUP="$BACKUP_DIR/nginx_${TARGET_ENV}_$(date +%Y%m%d_%H%M%S).conf"
if [ -f "$NGINX_CONF_PATH" ]; then
  sudo cp "$NGINX_CONF_PATH" "$NGINX_BACKUP" || { echo "ERROR: Nginx backup failed"; exit 1; }
else
  echo "# nginx config absent at deploy time" > "$NGINX_BACKUP" || { echo "ERROR: Nginx backup marker failed"; exit 1; }
fi
printf 'commit=%s\nversion=%s\nenvironment=%s\ntime=%s\n' "$CURRENT_COMMIT" "$CURRENT_VERSION" "$TARGET_ENV" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$BACKUP_DIR/paylink_${TARGET_ENV}_current_version.txt" || { echo "ERROR: current version record failed"; exit 1; }
echo "   Gate passed: database, PM2, Nginx, and current version recorded."

rollback() {
  reason="$1"
  ROLLBACK_STATUS="attempted"
  echo "Deployment failed: $reason — rolling back to $CURRENT_COMMIT"
  pm2 logs "$PM2_PROCESS" --lines 80 --nostream || true
  git reset --hard "$CURRENT_COMMIT" || true
  pnpm install --frozen-lockfile=false --reporter=append-only || true
  pnpm build || true
  pm2 delete "${PM2_PROCESS}-candidate" 2>/dev/null || true
  pm2 restart "$PM2_PROCESS" --update-env || PAYLINK_COMMIT="$CURRENT_COMMIT" PAYLINK_BUILD_TIME="$(date -u '+%Y-%m-%dT%H:%M:%SZ')" APP_VERSION="$CURRENT_VERSION" pm2 start "$APP_DIR/dist/index.cjs" --name "$PM2_PROCESS" --cwd "$APP_DIR" --interpreter node --node-args="-r dotenv/config" --update-env -- dotenv_config_path="$ENV_FILE" || true
  pm2 save --force || true
  if [ -n "$NGINX_BACKUP" ] && [ -f "$NGINX_BACKUP" ] && [ "$TARGET_ENV" = "production" ]; then
    sudo cp "$NGINX_BACKUP" "$NGINX_CONF_PATH" && sudo nginx -t && sudo nginx -s reload || true
  fi
  if curl -fs "http://127.0.0.1:$APP_PORT/health" >/dev/null 2>&1; then ROLLBACK_STATUS="succeeded"; else ROLLBACK_STATUS="failed"; fi
  record_history "failed" "$NEW_COMMIT" "$PACKAGE_VERSION" "$RELEASE_TAG" "$MIGRATION_STATUS" "$ROLLBACK_STATUS"
}
trap 'code=$?; if [ $code -ne 0 ]; then rollback "command failed with exit $code"; fi' EXIT

echo "2. Syncing target code..."
if [ "$TARGET_ENV" = "production" ]; then
  git fetch --tags origin
  git rev-parse -q --verify "refs/tags/$RELEASE_TAG" >/dev/null || { echo "ERROR: refs/tags/$RELEASE_TAG does not exist; branch names are not allowed" >&2; exit 2; }
  git checkout --force "refs/tags/$RELEASE_TAG"
else
  git fetch origin main
  git reset --hard origin/main
fi
NEW_COMMIT=$(git rev-parse HEAD)
PACKAGE_VERSION=$(node -p "require('./package.json').version")
EXPECTED_TAG="v$PACKAGE_VERSION"
APP_VERSION_VALUE="${RELEASE_TAG#v}"
if [ "$TARGET_ENV" = "production" ]; then
  if [ "$RELEASE_TAG" != "$EXPECTED_TAG" ] || [ "$APP_VERSION_VALUE" != "$PACKAGE_VERSION" ]; then
    echo "ERROR: version mismatch. package=$PACKAGE_VERSION APP_VERSION=${APP_VERSION_VALUE:-missing} release_tag=$RELEASE_TAG expected_tag=$EXPECTED_TAG" >&2
    exit 1
  fi
fi

echo "3. Installing dependencies and building..."
if ! command -v pnpm >/dev/null 2>&1; then npm install -g pnpm@10.33.0; fi
pnpm install --frozen-lockfile=false --reporter=append-only
rm -rf "$APP_DIR/dist"
pnpm build
[ -f "$APP_DIR/dist/public/index.html" ] && [ -f "$APP_DIR/dist/public/app.html" ] || { echo "ERROR: frontend build artifacts missing. Refusing PM2 restart."; exit 1; }
cp node_modules/connect-pg-simple/table.sql dist/ 2>/dev/null || true
MIGRATION_STATUS="startup_auto_migrations_pending_app_start"

echo "4. Starting candidate PM2 process without deleting current production..."
CANDIDATE_PM2_PROCESS="${PM2_PROCESS}-candidate"
pm2 delete "$CANDIDATE_PM2_PROCESS" 2>/dev/null || true
if ss -lntp 2>/dev/null | grep -q "127.0.0.1:$APP_PORT" && ! ss -lntp 2>/dev/null | grep "127.0.0.1:$APP_PORT" | grep -E 'node|PM2|dist/index\.cjs' >/dev/null; then
  echo "ERROR: 127.0.0.1:$APP_PORT is owned by a non-PayLink process." >&2
  exit 1
fi
PAYLINK_BUILD_TIME=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
PAYLINK_COMMIT="$NEW_COMMIT" PAYLINK_BUILD_TIME="$PAYLINK_BUILD_TIME" APP_VERSION="$PACKAGE_VERSION" pm2 start dist/index.cjs --name "$CANDIDATE_PM2_PROCESS" --cwd "$APP_DIR" --interpreter node --node-args="-r dotenv/config" --update-env -- dotenv_config_path="$ENV_FILE"
pm2 save --force

if [ "$TARGET_ENV" = "production" ]; then
  "$APP_DIR/scripts/apply_mypaylink_nginx.sh" "$APP_DIR/scripts/nginx-mypaylink.conf"
else
  echo "5. Skipping Nginx config for staging."
fi

echo "6. Expanded health validation..."
for i in $(seq 1 30); do curl -fs "http://127.0.0.1:$APP_PORT/health" >/dev/null 2>&1 && break; sleep 3; [ "$i" = "30" ] && { echo "ERROR: /health failed"; exit 1; }; done
curl -fs "http://127.0.0.1:$APP_PORT/ready" | grep -q '"database":"connected"' || { echo "ERROR: /ready database connectivity failed"; exit 1; }
[ -d "${UPLOAD_DIR:-$APP_DIR/uploads}" ] && [ -w "${UPLOAD_DIR:-$APP_DIR/uploads}" ] || { echo "ERROR: storage connectivity failed"; exit 1; }
[ -n "${NODE_ENV_FOR_CHECK:-}" ] && [ -n "${APP_BASE_URL_FOR_HEALTH:-}" ] && [ -n "${DATABASE_URL_FOR_BACKUP:-}" ] || { echo "ERROR: environment validation failed"; exit 1; }
VERSION_JSON=$(curl -fs "http://127.0.0.1:$APP_PORT/api/version") || { echo "ERROR: version endpoint failed"; exit 1; }
printf '%s' "$VERSION_JSON" | grep -q "\"commit\":\"$NEW_COMMIT\"" || { echo "ERROR: deployed git commit mismatch: $VERSION_JSON"; exit 1; }
printf '%s' "$VERSION_JSON" | grep -q "\"environment\":" || { echo "ERROR: environment missing from version endpoint"; exit 1; }
MIGRATION_STATUS="startup_auto_migrations_verified_by_ready"
pm2 delete "$PM2_PROCESS" 2>/dev/null || true
pm2 restart "$CANDIDATE_PM2_PROCESS" --name "$PM2_PROCESS" --update-env

trap - EXIT
ROLLBACK_STATUS="not_required"
record_history "success" "$NEW_COMMIT" "$PACKAGE_VERSION" "$RELEASE_TAG" "$MIGRATION_STATUS" "$ROLLBACK_STATUS"
ls -t "$BACKUP_DIR"/paylink_${TARGET_ENV}_backup_*.sql 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true

echo "=========================================="
echo "Deploy Complete! Target: $TARGET_ENV | Version: $PACKAGE_VERSION | Commit: $NEW_COMMIT"
echo "=========================================="
