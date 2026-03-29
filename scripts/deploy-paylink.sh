#!/bin/bash
set -e

APP_DIR="/home/paylinkssh/paylink-app/PayLink"
BACKUP_DIR="/home/paylinkssh/backups"
ENV_FILE="/etc/paylink/.env"

echo "=========================================="
echo "PayLink Deploy - $(date)"
echo "=========================================="

# Validate required production files exist
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Aborting."
  exit 1
fi

# Load env for pg_dump
source "$ENV_FILE" 2>/dev/null || true

mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/paylink_backup_$(date +%Y%m%d_%H%M%S).sql"
echo "1. Backing up database..."
pg_dump "$DATABASE_URL" > "$BACKUP_FILE"
echo "   Saved: $BACKUP_FILE"

cd "$APP_DIR"
echo "2. Syncing latest code (hard reset to match repo)..."
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
git fetch origin main
git reset --hard origin/main

echo "3. Installing dependencies..."
npm install --production=false
chmod +x "$APP_DIR/node_modules/.bin/"* 2>/dev/null || true

echo "4. Normalizing ownership and building..."
cd "$APP_DIR"
chown -R paylinkssh:mypaylink-app "$APP_DIR"
chmod -R u+rwX "$APP_DIR"
rm -rf "$APP_DIR/dist"
mkdir -p "$APP_DIR/dist"
npm run build

echo "5. Copying session table SQL..."
cp node_modules/connect-pg-simple/table.sql dist/ 2>/dev/null || true

echo "6. Starting app as paylinkssh (clean delete + fresh start)..."
cd "$APP_DIR"

# Remove from paylinkssh PM2 list if present
pm2 delete paylink 2>/dev/null || true

# Kill any process holding port 8000 (handles root-owned processes too)
fuser -k 8000/tcp 2>/dev/null || true
# Fallback: pkill by binary path
pkill -f "dist/index.cjs" 2>/dev/null || true
sleep 3

pm2 start dist/index.cjs \
  --name paylink \
  --cwd "$APP_DIR" \
  --interpreter node \
  --node-args="-r dotenv/config" \
  --update-env \
  -- dotenv_config_path="$ENV_FILE"
pm2 save --force

echo "7. Waiting for startup..."
sleep 12

HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/health 2>/dev/null || echo "000")
READY=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/ready 2>/dev/null || echo "000")

echo "   Health: $HEALTH | Ready: $READY"

if [ "$HEALTH" != "200" ] || [ "$READY" != "200" ]; then
  echo "ERROR: Health checks failed!"
  echo "--- PM2 Logs ---"
  pm2 logs paylink --lines 40 --nostream
  echo ""
  echo "To rollback:"
  echo "  pg_dump -> psql restore: psql \$DATABASE_URL < $BACKUP_FILE"
  echo "  git checkout HEAD~1 && npm run build"
  echo "  cp node_modules/connect-pg-simple/table.sql dist/"
  echo "  pm2 restart paylink --update-env"
  exit 1
fi

# Keep only 10 most recent backups
ls -t "$BACKUP_DIR"/paylink_backup_*.sql 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true

echo "=========================================="
echo "Deploy Complete! Health: $HEALTH | Ready: $READY"
echo "$(date)"
echo "=========================================="
