#!/bin/bash
set -e

APP_DIR="/home/paylinkssh/paylink-app/PayLink"
BACKUP_DIR="/home/paylinkssh/backups"

echo "=== PayLink Deploy Started at $(date) ==="

mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/paylink_backup_$(date +%Y%m%d_%H%M%S).sql"
echo "1. Backing up database..."
pg_dump -U lshawver -h 127.0.0.1 paylink > "$BACKUP_FILE"
echo "   Saved: $BACKUP_FILE"

cd "$APP_DIR"
echo "2. Pulling latest code..."
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
git pull origin main

echo "3. Installing dependencies..."
npm install --production=false

echo "4. Building..."
npm run build

echo "5. Copying session table SQL..."
cp node_modules/connect-pg-simple/table.sql dist/

if [ ! -f ecosystem.config.cjs ]; then
  echo "6. Creating ecosystem config..."
  cat > ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: "paylink",
    script: "dist/index.cjs",
    cwd: "/home/paylinkssh/paylink-app/PayLink",
    node_args: "--env-file=.env"
  }]
};
EOF
fi

echo "7. Restarting app..."
pm2 restart paylink 2>/dev/null || pm2 start ecosystem.config.cjs
pm2 save

echo "8. Waiting for startup..."
sleep 10

HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/health)
READY=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/ready)

echo "   Health: $HEALTH | Ready: $READY"

if [ "$HEALTH" != "200" ] || [ "$READY" != "200" ]; then
  echo "ERROR: Health checks failed!"
  echo "--- PM2 Logs ---"
  pm2 logs paylink --lines 30 --nostream
  echo ""
  echo "To rollback:"
  echo "  psql -U lshawver -h 127.0.0.1 paylink < $BACKUP_FILE"
  echo "  git checkout HEAD~1"
  echo "  npm run build && cp node_modules/connect-pg-simple/table.sql dist/"
  echo "  pm2 restart paylink"
  exit 1
fi

ls -t "$BACKUP_DIR"/paylink_backup_*.sql 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true

echo "=== Deploy Complete ==="
