# PayLink VPS Deployment Guide

## Architecture

```
mypaylink.app           -> Nginx -> public marketing site (future)
app.mypaylink.app       -> Nginx -> PayLink app (127.0.0.1:8000)
```

The PayLink app runs on `127.0.0.1:8000` (not publicly accessible).
Nginx reverse-proxies `app.mypaylink.app` traffic to it.

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Nginx with SSL (certbot/Let's Encrypt)
- PM2 or systemd for process management

## 1. Environment Setup

```bash
cd /home/paylinkssh/paylink-app/PayLink
cp .env.example .env
# Edit .env with your production values
```

Required `.env` values:
```
NODE_ENV=production
HOST=127.0.0.1
PORT=8000
DATABASE_URL=postgresql://lshawver:YOUR_PASSWORD@127.0.0.1:5432/paylink
SESSION_SECRET=<generate with: openssl rand -hex 32>
PUBLIC_BASE_URL=https://mypaylink.app
APP_BASE_URL=https://app.mypaylink.app
UPLOAD_DIR=/home/paylinkssh/paylink-app/PayLink/uploads
```

## 2. Build & Start

```bash
# Install dependencies
npm install

# Build for production (compiles TypeScript + bundles frontend)
npm run build

# Copy session table SQL (required after every build)
cp node_modules/connect-pg-simple/table.sql dist/

# Start in production
npm run start

# Or with PM2:
pm2 start npm --name paylink -- run start
pm2 save
```

### Scripts Reference

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development with HMR (port 5000) |
| `npm run build` | Production build |
| `npm run start` | Production server (uses dist/index.cjs) |
| `npm run check` | TypeScript type checking |

## 3. Nginx Configuration

### Secure App (app.mypaylink.app)

```nginx
server {
    listen 80;
    server_name app.mypaylink.app;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.mypaylink.app;

    ssl_certificate /etc/letsencrypt/live/app.mypaylink.app/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.mypaylink.app/privkey.pem;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

### Public Website (mypaylink.app) - Future

```nginx
server {
    listen 80;
    server_name mypaylink.app www.mypaylink.app;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name mypaylink.app www.mypaylink.app;

    ssl_certificate /etc/letsencrypt/live/mypaylink.app/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mypaylink.app/privkey.pem;

    # For now, redirect to the app. When marketing site is built, serve it here.
    location / {
        return 302 https://app.mypaylink.app;
    }
}
```

### Nginx Notes

- `client_max_body_size 10m` matches the app's 10MB upload limit for documents
- WebSocket upgrade headers are included for Vite HMR in dev (harmless in prod)
- `proxy_read_timeout 120s` accommodates AI receipt scanning (OpenAI calls)

## 4. SSL Setup

```bash
sudo certbot --nginx -d app.mypaylink.app
sudo certbot --nginx -d mypaylink.app -d www.mypaylink.app
```

## 5. Systemd Service (Alternative to PM2)

Create `/etc/systemd/system/paylink.service`:

```ini
[Unit]
Description=PayLink Application
After=network.target postgresql.service

[Service]
Type=simple
User=paylinkssh
WorkingDirectory=/home/paylinkssh/paylink-app/PayLink
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
EnvironmentFile=/home/paylinkssh/paylink-app/PayLink/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable paylink
sudo systemctl start paylink
sudo systemctl status paylink
journalctl -u paylink -f  # view logs
```

## 6. Health Checks

```bash
# Basic health
curl http://127.0.0.1:8000/health
# Expected: {"status":"ok","timestamp":"..."}

# Database readiness
curl http://127.0.0.1:8000/ready
# Expected: {"status":"ok","database":"connected"}
```

These can be used for Nginx health checks or monitoring.

## 7. Deploy Checklist

```bash
# 1. Backup database
mkdir -p ~/backups
pg_dump -U lshawver -h 127.0.0.1 paylink > ~/backups/paylink_backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Pull new code
cd /home/paylinkssh/paylink-app/PayLink
git pull

# 3. Install dependencies
npm install

# 4. Build
npm run build

# 5. Copy session table SQL
cp node_modules/connect-pg-simple/table.sql dist/

# 6. Restart
pm2 restart paylink
# or: sudo systemctl restart paylink

# 7. Verify
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/ready
```

## 8. Security Summary

### App-Layer (implemented)

- `trust proxy` enabled in production (reads X-Forwarded headers)
- Secure cookies (`HttpOnly`, `Secure` in production, `SameSite=Lax`)
- Security headers: HSTS, X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy
- Production error handler hides stack traces
- Upload size limits (5MB images, 10MB documents)
- File type whitelisting on uploads
- Role-based access control on all sensitive endpoints
- Session-based auth with PostgreSQL session store

### Nginx-Layer (configure in Nginx)

- SSL/TLS termination
- Rate limiting (add `limit_req_zone` for `/api/auth/login`)
- `client_max_body_size` for upload limits
- IP-based access control if needed

### Recommended Nginx rate limiting

```nginx
# In http block:
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;

# In server/location blocks:
location /api/auth/login {
    limit_req zone=login burst=3 nodelay;
    proxy_pass http://127.0.0.1:8000;
    # ... other proxy headers
}
```

## 9. Transition from paylink.adiken.org

1. Deploy to VPS with new Nginx config for `app.mypaylink.app`
2. Keep `paylink.adiken.org` config active temporarily
3. Add redirect from old domain to new:
   ```nginx
   server {
       server_name paylink.adiken.org;
       return 301 https://app.mypaylink.app$request_uri;
   }
   ```
4. After confirming everything works, remove old config

## 10. Database Note

PayLink uses **PostgreSQL** (not MySQL). The `DATABASE_URL` format is:
```
postgresql://user:password@host:port/database
```

The app auto-migrates schema on startup (only adds columns/tables, never drops).
