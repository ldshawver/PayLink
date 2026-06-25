#!/usr/bin/env bash
set -euo pipefail

APP_DOMAIN="mypaylink.app"
APP_SUBDOMAIN="app.mypaylink.app"
APP_UPSTREAM="http://127.0.0.1:8000"
CONF_SRC="${1:-scripts/nginx-mypaylink.conf}"
CONF_DST="${NGINX_CONF_DST:-/etc/nginx/sites-enabled/mypaylink.app.conf}"
CONFLICT_DIR="${NGINX_CONFLICT_DIR:-/etc/nginx/sites-enabled/paylink-disabled-conflicts}"

if [ ! -f "$CONF_SRC" ]; then
  echo "FATAL: nginx config source not found: $CONF_SRC" >&2
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "FATAL: nginx is not installed or not on PATH" >&2
  exit 1
fi

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

same_file() {
  [ -e "$1" ] && [ -e "$2" ] && [ "$(readlink -f "$1")" = "$(readlink -f "$2")" ]
}

echo "--- Active nginx config before change: $APP_DOMAIN / $APP_SUBDOMAIN references ---"
$SUDO nginx -T 2>/tmp/paylink-nginx-before.err | awk \
  '/server_name/ && ($0 ~ /mypaylink\.app/ || $0 ~ /app\.mypaylink\.app/) { print }' || true
cat /tmp/paylink-nginx-before.err >&2 || true

# CloudPanel/certbot can leave an old app.mypaylink.app static or redirect-only vhost
# enabled beside the PayLink vhost. Move only enabled files that explicitly claim the
# app subdomain and are not the canonical destination.
$SUDO mkdir -p "$CONFLICT_DIR"
if [ -d /etc/nginx/sites-enabled ]; then
  while IFS= read -r enabled_conf; do
    if same_file "$enabled_conf" "$CONF_DST"; then
      continue
    fi
    if $SUDO grep -Eq "server_name[[:space:]][^;]*${APP_SUBDOMAIN//./\.}([^[:alnum:]_.-]|;)" "$enabled_conf"; then
      backup_name="$(basename "$enabled_conf").disabled.$(date -u +%Y%m%dT%H%M%SZ)"
      echo "Disabling conflicting enabled nginx vhost for $APP_SUBDOMAIN: $enabled_conf -> $CONFLICT_DIR/$backup_name"
      $SUDO mv "$enabled_conf" "$CONFLICT_DIR/$backup_name"
    fi
  done < <(find /etc/nginx/sites-enabled -maxdepth 1 -type f -o -type l 2>/dev/null)
fi

$SUDO cp "$CONF_SRC" "$CONF_DST"
$SUDO nginx -t
$SUDO systemctl reload nginx

echo "--- Active nginx config after reload: $APP_DOMAIN / $APP_SUBDOMAIN references ---"
ACTIVE_CONFIG="$($SUDO nginx -T 2>/tmp/paylink-nginx-after.err)"
printf '%s\n' "$ACTIVE_CONFIG" | awk \
  '/server_name/ && ($0 ~ /mypaylink\.app/ || $0 ~ /app\.mypaylink\.app/) { print }'
cat /tmp/paylink-nginx-after.err >&2 || true

printf '%s\n' "$ACTIVE_CONFIG" | grep -Eq "server_name[[:space:]]+${APP_DOMAIN//./\.}[[:space:]]+${APP_SUBDOMAIN//./\.};" || {
  echo "FATAL: $APP_DOMAIN and $APP_SUBDOMAIN are not in the same HTTPS app server_name block" >&2
  exit 1
}
printf '%s\n' "$ACTIVE_CONFIG" | grep -Fq "proxy_pass $APP_UPSTREAM;" || {
  echo "FATAL: active nginx config does not proxy to $APP_UPSTREAM" >&2
  exit 1
}

echo "Nginx app host routing verified: $APP_DOMAIN and $APP_SUBDOMAIN proxy all routes to $APP_UPSTREAM"
