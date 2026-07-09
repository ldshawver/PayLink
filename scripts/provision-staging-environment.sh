#!/usr/bin/env bash
set -euo pipefail

# Provision an isolated PayLink staging instance without modifying production.
# Requires: /etc/paylink/.env and /etc/paylink/.env.staging to exist.

PROD_ENV_FILE="${PROD_ENV_FILE:-/etc/paylink/.env}"
STAGING_ENV_FILE="${STAGING_ENV_FILE:-/etc/paylink/.env.staging}"
PROD_APP_DIR="${PROD_APP_DIR:-/home/paylinkssh/paylink-app/PayLink}"
STAGING_APP_DIR="${STAGING_APP_DIR:-/home/paylinkssh/paylink-staging/PayLink}"
STAGING_PARENT_DIR="$(dirname "$STAGING_APP_DIR")"
PROD_PM2_PROCESS="${PROD_PM2_PROCESS:-paylink}"
STAGING_PM2_PROCESS="${STAGING_PM2_PROCESS:-paylink-staging}"
PROD_PORT="${PROD_PORT:-8000}"
STAGING_PORT="${STAGING_PORT:-8010}"
PROD_URL="${PROD_URL:-https://mypaylink.app}"
STAGING_URL="${STAGING_URL:-https://staging.mypaylink.app}"
STAGING_HOST="${STAGING_HOST:-staging.mypaylink.app}"
STAGING_DB_NAME="${STAGING_DB_NAME:-paylink_staging}"
STAGING_DB_USER="${STAGING_DB_USER:-paylink_staging}"
STAGING_UPLOAD_DIR="${STAGING_UPLOAD_DIR:-/home/paylinkssh/paylink-staging/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/home/paylinkssh/backups}"
NGINX_AVAILABLE_DIR="${NGINX_AVAILABLE_DIR:-/etc/nginx/sites-available}"
NGINX_ENABLED_DIR="${NGINX_ENABLED_DIR:-/etc/nginx/sites-enabled}"
STAGING_NGINX_CONF="$NGINX_AVAILABLE_DIR/$STAGING_HOST.conf"
REPORT_FILE="${REPORT_FILE:-/home/paylinkssh/paylink-staging/staging-verification-report.txt}"
ALLOW_EXISTING_STAGING_DB="${ALLOW_EXISTING_STAGING_DB:-}"

log() { printf '[staging-provision] %s\n' "$*"; }
announce() { printf '[staging-provision] RUN: %s\n' "$*"; }
fatal() { printf '[staging-provision] ERROR: %s\n' "$*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || fatal "Missing required command: $1"; }
read_env_value() { grep -E "^$2=" "$1" | tail -n 1 | cut -d= -f2- | sed 's/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//'; }
mask_url() { node -e 'const v=process.argv[1]||""; try{const u=new URL(v); if(u.password)u.password="***"; if(u.username)u.username=u.username||"***"; console.log(u.toString())}catch{console.log(v?"[set]":"[missing]")}' "$1"; }
set_env_value() {
  local file="$1" key="$2" value="$3" escaped
  escaped="$(printf '%s' "$value" | sed 's/[&/\\]/\\&/g')"
  if grep -qE "^${key}=" "$file"; then
    sed -i "s/^${key}=.*/${key}=${escaped}/" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

[ "$(id -u)" -eq 0 ] || fatal "Run as root so PostgreSQL, PM2, and Nginx can be configured."
[ -f "$PROD_ENV_FILE" ] || fatal "Production env file not found: $PROD_ENV_FILE"
[ -f "$STAGING_ENV_FILE" ] || fatal "Staging env file not found: $STAGING_ENV_FILE"
[ -d "$PROD_APP_DIR/.git" ] || fatal "Production repository not found: $PROD_APP_DIR"
[ "$PROD_APP_DIR" != "$STAGING_APP_DIR" ] || fatal "Production and staging app paths must differ."
[ "$PROD_PM2_PROCESS" != "$STAGING_PM2_PROCESS" ] || fatal "Production and staging PM2 process names must differ."
[ "$PROD_ENV_FILE" != "$STAGING_ENV_FILE" ] || fatal "Production and staging env files must differ."
[ "$PROD_PORT" != "$STAGING_PORT" ] || fatal "Production and staging ports must differ."
case "$STAGING_HOST" in app.mypaylink.app|mypaylink.app) fatal "STAGING_HOST must not be a production hostname." ;; esac
case "$STAGING_NGINX_CONF" in *app.mypaylink.app.conf|*mypaylink.app.conf) fatal "Refusing to write a production Nginx config path: $STAGING_NGINX_CONF" ;; esac

for c in git node npm pnpm curl openssl; do require_cmd "$c"; done
require_cmd psql
require_cmd pm2
require_cmd nginx

PROD_DB_URL="$(read_env_value "$PROD_ENV_FILE" DATABASE_URL || true)"
[ -n "$PROD_DB_URL" ] || fatal "DATABASE_URL missing from $PROD_ENV_FILE"
PROD_DB_NAME="$(node -e 'const u=new URL(process.argv[1]); console.log(u.pathname.replace(/^\//,""))' "$PROD_DB_URL")"
[ "$PROD_DB_NAME" != "$STAGING_DB_NAME" ] || fatal "Staging database name must differ from production database name."

log "Auditing environment variables that must differ between production and staging."
DIFF_KEYS=(DATABASE_URL APP_ENV NODE_ENV PORT APP_BASE_URL PUBLIC_APP_URL VITE_API_BASE_URL UPLOAD_DIR COOKIE_DOMAIN SESSION_COOKIE_DOMAIN REDIS_URL STRIPE_WEBHOOK_SECRET DOCUMENSO_WEBHOOK_SECRET)
for key in "${DIFF_KEYS[@]}"; do
  prod_val="$(read_env_value "$PROD_ENV_FILE" "$key" 2>/dev/null || true)"
  staging_val="$(read_env_value "$STAGING_ENV_FILE" "$key" 2>/dev/null || true)"
  if [ -n "$prod_val" ] && [ "$prod_val" = "$staging_val" ]; then
    log "Will update staging-only value for $key."
  fi
done

announce "mkdir -p $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

log "Checking whether staging PostgreSQL database/user already exist."
if command -v sudo >/dev/null 2>&1; then
  PSQL_AS_POSTGRES=(sudo -u postgres psql -v ON_ERROR_STOP=1)
else
  PSQL_AS_POSTGRES=(su - postgres -c "psql -v ON_ERROR_STOP=1")
fi
STAGING_DB_EXISTS="$("${PSQL_AS_POSTGRES[@]}" -tAc "SELECT 1 FROM pg_database WHERE datname = '$STAGING_DB_NAME'" | tr -d '[:space:]')"
STAGING_ROLE_EXISTS="$("${PSQL_AS_POSTGRES[@]}" -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$STAGING_DB_USER'" | tr -d '[:space:]')"
if { [ "$STAGING_DB_EXISTS" = "1" ] || [ "$STAGING_ROLE_EXISTS" = "1" ]; } && [ "$ALLOW_EXISTING_STAGING_DB" != "yes" ]; then
  fatal "Staging database/user already exists. Set ALLOW_EXISTING_STAGING_DB=yes only after confirming it is safe to reuse; this script will not overwrite existing staging DB/user by default."
fi

log "Creating isolated PostgreSQL database and role if needed."
STAGING_DB_PASSWORD="$(openssl rand -base64 36 | tr -d '\n' | tr '/' '_' | tr '+' '-')"
announce "create PostgreSQL role/database $STAGING_DB_USER/$STAGING_DB_NAME if absent (password redacted)"
"${PSQL_AS_POSTGRES[@]}" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$STAGING_DB_USER') THEN
    CREATE ROLE $STAGING_DB_USER LOGIN PASSWORD '$STAGING_DB_PASSWORD';
  ELSE
    ALTER ROLE $STAGING_DB_USER WITH LOGIN PASSWORD '$STAGING_DB_PASSWORD';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE $STAGING_DB_NAME OWNER $STAGING_DB_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$STAGING_DB_NAME')\gexec
GRANT ALL PRIVILEGES ON DATABASE $STAGING_DB_NAME TO $STAGING_DB_USER;
SQL
STAGING_DB_URL="postgresql://$STAGING_DB_USER:$STAGING_DB_PASSWORD@127.0.0.1:5432/$STAGING_DB_NAME"

log "Updating $STAGING_ENV_FILE for staging isolation."
announce "cp -p $STAGING_ENV_FILE $BACKUP_DIR/.env.staging.<timestamp>.bak"
cp -p "$STAGING_ENV_FILE" "$BACKUP_DIR/.env.staging.$(date +%Y%m%d_%H%M%S).bak"
announce "update staging env keys in $STAGING_ENV_FILE (DATABASE_URL password redacted from logs)"
set_env_value "$STAGING_ENV_FILE" DATABASE_URL "$STAGING_DB_URL"
set_env_value "$STAGING_ENV_FILE" APP_ENV "staging"
set_env_value "$STAGING_ENV_FILE" NODE_ENV "production"
set_env_value "$STAGING_ENV_FILE" PORT "$STAGING_PORT"
set_env_value "$STAGING_ENV_FILE" APP_BASE_URL "$STAGING_URL"
set_env_value "$STAGING_ENV_FILE" PUBLIC_APP_URL "$STAGING_URL"
set_env_value "$STAGING_ENV_FILE" VITE_API_BASE_URL "$STAGING_URL"
set_env_value "$STAGING_ENV_FILE" UPLOAD_DIR "$STAGING_UPLOAD_DIR"

if [ "$PROD_DB_URL" = "$STAGING_DB_URL" ]; then
  fatal "Refusing to continue: staging and production DATABASE_URL values match."
fi

log "Creating staging clone at $STAGING_APP_DIR."
announce "mkdir -p $STAGING_PARENT_DIR $STAGING_UPLOAD_DIR $BACKUP_DIR"
mkdir -p "$STAGING_PARENT_DIR" "$STAGING_UPLOAD_DIR" "$BACKUP_DIR"
if [ ! -d "$STAGING_APP_DIR/.git" ]; then
  announce "git clone $PROD_APP_DIR $STAGING_APP_DIR"
  git clone "$PROD_APP_DIR" "$STAGING_APP_DIR"
fi
cd "$STAGING_APP_DIR"
git config --global --add safe.directory "$STAGING_APP_DIR" 2>/dev/null || true
git remote set-url origin "$(git -C "$PROD_APP_DIR" remote get-url origin)" || true
announce "git fetch origin main"
git fetch origin main
announce "git reset --hard origin/main in $STAGING_APP_DIR"
git reset --hard origin/main
announce "pnpm install --frozen-lockfile=false --reporter=append-only"
pnpm install --frozen-lockfile=false --reporter=append-only
announce "rm -rf $STAGING_APP_DIR/dist"
rm -rf dist
announce "pnpm build"
pnpm build
cp node_modules/connect-pg-simple/table.sql dist/ 2>/dev/null || true

log "Starting PM2 process $STAGING_PM2_PROCESS on port $STAGING_PORT."
announce "pm2 delete $STAGING_PM2_PROCESS (staging only; ignored if absent)"
pm2 delete "$STAGING_PM2_PROCESS" 2>/dev/null || true
STAGING_COMMIT="$(git rev-parse HEAD)"
STAGING_VERSION="$(node -p "require('./package.json').version")"
announce "pm2 start dist/index.cjs --name $STAGING_PM2_PROCESS --cwd $STAGING_APP_DIR -- dotenv_config_path=$STAGING_ENV_FILE"
PAYLINK_COMMIT="$STAGING_COMMIT" PAYLINK_BUILD_TIME="$(date -u '+%Y-%m-%dT%H:%M:%SZ')" APP_VERSION="$STAGING_VERSION" \
  pm2 start dist/index.cjs --name "$STAGING_PM2_PROCESS" --cwd "$STAGING_APP_DIR" --interpreter node --node-args="-r dotenv/config" --update-env -- dotenv_config_path="$STAGING_ENV_FILE"
announce "pm2 save --force"
pm2 save --force

log "Configuring isolated Nginx proxy for $STAGING_HOST."
if [ -e "$STAGING_NGINX_CONF" ]; then
  announce "cp -p $STAGING_NGINX_CONF $BACKUP_DIR/$(basename "$STAGING_NGINX_CONF").<timestamp>.bak"
  cp -p "$STAGING_NGINX_CONF" "$BACKUP_DIR/$(basename "$STAGING_NGINX_CONF").$(date +%Y%m%d_%H%M%S).bak"
fi
if [ -e "$NGINX_ENABLED_DIR/$STAGING_HOST.conf" ] && [ ! -L "$NGINX_ENABLED_DIR/$STAGING_HOST.conf" ]; then
  announce "cp -p $NGINX_ENABLED_DIR/$STAGING_HOST.conf $BACKUP_DIR/$(basename "$STAGING_HOST.conf").enabled.<timestamp>.bak"
  cp -p "$NGINX_ENABLED_DIR/$STAGING_HOST.conf" "$BACKUP_DIR/$STAGING_HOST.conf.enabled.$(date +%Y%m%d_%H%M%S).bak"
fi
announce "write staging-only Nginx config $STAGING_NGINX_CONF"
cat > "$STAGING_NGINX_CONF" <<NGINX
server {
    listen 80;
    server_name $STAGING_HOST;

    location / {
        proxy_pass http://127.0.0.1:$STAGING_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX
announce "ln -sfn $STAGING_NGINX_CONF $NGINX_ENABLED_DIR/$STAGING_HOST.conf"
ln -sfn "$STAGING_NGINX_CONF" "$NGINX_ENABLED_DIR/$STAGING_HOST.conf"
announce "nginx -t"
nginx -t
announce "nginx -s reload"
nginx -s reload

log "Verifying staging health and version endpoints."
for i in $(seq 1 30); do curl -fs "http://127.0.0.1:$STAGING_PORT/health" >/dev/null && break; sleep 3; [ "$i" = 30 ] && fatal "Staging /health did not become healthy."; done
HEALTH_JSON="$(curl -fs "http://127.0.0.1:$STAGING_PORT/health")"
VERSION_JSON="$(curl -fs "http://127.0.0.1:$STAGING_PORT/api/version")"
printf '%s' "$VERSION_JSON" | grep -q '"environment":"staging"' || fatal "/api/version did not report environment=staging: $VERSION_JSON"
printf '%s' "$VERSION_JSON" | grep -q "\"version\":\"$STAGING_VERSION\"" || fatal "/api/version did not report version=$STAGING_VERSION: $VERSION_JSON"
printf '%s' "$VERSION_JSON" | grep -q "\"commit\":\"$STAGING_COMMIT\"" || fatal "/api/version did not report commit=$STAGING_COMMIT: $VERSION_JSON"

cat > "$REPORT_FILE" <<REPORT
PayLink Staging Verification Report
Generated: $(date -u '+%Y-%m-%dT%H:%M:%SZ')

Production path: $PROD_APP_DIR
Staging path: $STAGING_APP_DIR
Production PM2 process: $PROD_PM2_PROCESS
Staging PM2 process: $STAGING_PM2_PROCESS
Production database: $PROD_DB_NAME
Staging database: $STAGING_DB_NAME
Production URL: $PROD_URL
Staging URL: $STAGING_URL
Production port: $PROD_PORT
Staging port: $STAGING_PORT
Production DATABASE_URL: $(mask_url "$PROD_DB_URL")
Staging DATABASE_URL: $(mask_url "$STAGING_DB_URL")
Health endpoint: $HEALTH_JSON
Version endpoint: $VERSION_JSON
REPORT

cat "$REPORT_FILE"
log "Done. Production was not restarted, redeployed, or pointed at the staging database."
