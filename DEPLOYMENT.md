# PayLink VPS Deployment Guide

## Architecture

```
app.mypaylink.app       -> Nginx (SSL) -> 127.0.0.1:8000 (PayLink app)
mypaylink.app           -> Nginx (SSL) -> public marketing site (future)
```

The PayLink app runs on `127.0.0.1:8000` (not publicly accessible).
Nginx terminates SSL and reverse-proxies `app.mypaylink.app` traffic to it.

## Prerequisites

- Node.js 20+ (LTS recommended)
- PostgreSQL 15+
- Nginx with SSL (certbot / Let's Encrypt)
- PM2 (`npm install -g pm2`) or systemd for process management
- Working directory: `/home/paylinkssh/paylink-app/PayLink`

## 1. Environment Setup

```bash
cd /home/paylinkssh/paylink-app/PayLink
cp .env.example .env
nano .env    # Fill in production values
```

### Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | Must be `production` |
| `HOST` | Yes | `127.0.0.1` (bind to loopback only) |
| `PORT` | Yes | `8000` (must match Nginx upstream) |
| `DATABASE_URL` | Yes | `postgresql://lshawver:PASSWORD@127.0.0.1:5432/paylink` |
| `SESSION_SECRET` | Yes | Generate with `openssl rand -hex 32` |
| `APP_BASE_URL` | Recommended | `https://app.mypaylink.app` (used in email links) |
| `UPLOAD_DIR` | Recommended | Absolute path to uploads directory |
| `SMTP_HOST` | Optional | SMTP server for email notifications |
| `SMTP_PORT` | Optional | SMTP port (587 for STARTTLS, 465 for implicit TLS) |
| `SMTP_TLS` | Optional | `true` to enable STARTTLS on port 587 |
| `SMTP_USER` | Optional | SMTP authentication username |
| `SMTP_PASS` | Optional | SMTP authentication password |
| `SMTP_FROM` | Optional | Sender address for outbound emails |
| `OPENAI_API_KEY` | Optional | For AI receipt scanning |
| `TWILIO_ACCOUNT_SID` | Optional | For SMS notifications |
| `TWILIO_AUTH_TOKEN` | Optional | For SMS notifications |
| `TWILIO_PHONE_NUMBER` | Optional | For SMS notifications |

The app will **refuse to start** in production if `DATABASE_URL` or `SESSION_SECRET` is missing.

## 2. Install, Build & Start

```bash
cd /home/paylinkssh/paylink-app/PayLink

# Install dependencies
npm install --production=false

# Build for production (compiles TypeScript + bundles frontend)
npm run build

# Copy session table SQL (required after every build)
cp node_modules/connect-pg-simple/table.sql dist/

# Create uploads directory with correct permissions
mkdir -p uploads
chmod 755 uploads

# Start with PM2 (recommended)
pm2 start npm --name paylink -- run start
pm2 save

# Or start directly for testing
npm run start
```

### Scripts Reference

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development with HMR (port 5000) |
| `npm run build` | Production build (outputs to `dist/`) |
| `npm run start` | Production server (`node dist/index.cjs`) |
| `npm run check` | TypeScript type checking |

### Expected App Port

The app listens on **port 8000** by default in production (set via `PORT=8000` in `.env`).
It binds to `127.0.0.1` only, so it is not directly accessible from the internet.

### Working Directory

All commands must be run from: `/home/paylinkssh/paylink-app/PayLink`

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
        proxy_set_header X-Forwarded-Host $host;

        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

### Nginx Notes

- `client_max_body_size 10m` matches the app's 10MB upload limit for documents
- WebSocket upgrade headers support live reload during development
- `proxy_read_timeout 120s` accommodates AI receipt scanning (OpenAI calls)
- `X-Forwarded-Proto` and `X-Forwarded-Host` are required for correct absolute URL generation and secure cookies

### Recommended Rate Limiting

Add to the `http` block in `/etc/nginx/nginx.conf`:

```nginx
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;
```

Add to the server block:

```nginx
location /api/auth/login {
    limit_req zone=login burst=3 nodelay;
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Public Website (mypaylink.app) — Future

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

    # For now, redirect to the app
    location / {
        return 302 https://app.mypaylink.app;
    }
}
```

## 4. SSL Setup

```bash
sudo certbot --nginx -d app.mypaylink.app
sudo certbot --nginx -d mypaylink.app -d www.mypaylink.app

# Verify auto-renewal
sudo certbot renew --dry-run
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
ExecStart=/usr/bin/node dist/index.cjs
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
```

## 6. Health Checks

```bash
# Basic health (no auth required, no DB check)
curl http://127.0.0.1:8000/health
# Expected: {"status":"ok","timestamp":"2026-03-23T12:00:00.000Z"}

# Database readiness (no auth required, pings DB)
curl http://127.0.0.1:8000/ready
# Expected (200): {"status":"ok","database":"connected"}
# Expected (503): {"status":"error","database":"unavailable"}
```

These endpoints are registered before session middleware and are excluded from authentication.
Use them for Nginx health checks, monitoring systems, or load balancer probes.

## 7. File Permissions

```bash
# Uploads directory (writable by app user)
chown paylinkssh:paylinkssh /home/paylinkssh/paylink-app/PayLink/uploads
chmod 755 /home/paylinkssh/paylink-app/PayLink/uploads

# Uploaded files will be created with the app user's default umask
# Files are served via Express static middleware at /uploads/*
# Behind Nginx reverse proxy, upload URLs look like:
#   https://app.mypaylink.app/uploads/1711234567890-123456789.jpg
```

## 8. Logs & Troubleshooting

### Log Locations

| Service | Log Command |
|---------|-------------|
| PayLink (PM2) | `pm2 logs paylink` |
| PayLink (systemd) | `journalctl -u paylink -f` |
| Nginx access | `tail -f /var/log/nginx/access.log` |
| Nginx errors | `tail -f /var/log/nginx/error.log` |
| PostgreSQL | `tail -f /var/log/postgresql/postgresql-15-main.log` |

### Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| App won't start, "FATAL: Missing required environment variables" | `.env` is missing `DATABASE_URL` or `SESSION_SECRET` | Fill in `.env` values |
| App won't start, upload directory not writable | Wrong ownership on uploads dir | `chown paylinkssh:paylinkssh uploads` |
| 502 Bad Gateway from Nginx | App not running or wrong port | Check `pm2 status` and verify `PORT=8000` |
| Login works but session drops | `secure: true` cookie with HTTP (no SSL) | Ensure Nginx has SSL configured |
| Cookies not set in browser | Missing `X-Forwarded-Proto` header | Add `proxy_set_header X-Forwarded-Proto $scheme;` to Nginx |
| /ready returns 503 | Database connection failed | Check `DATABASE_URL` and PostgreSQL status |
| Uploads return 404 | `UPLOAD_DIR` mismatch between `.env` and actual directory | Verify paths match |

## 9. Deploy Checklist

```bash
# 1. Backup database FIRST
mkdir -p ~/backups
pg_dump -U lshawver -h 127.0.0.1 paylink > ~/backups/paylink_backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Pull new code
cd /home/paylinkssh/paylink-app/PayLink
git pull

# 3. Install dependencies
npm install --production=false

# 4. Build
npm run build

# 5. Copy session table SQL (required after every build)
cp node_modules/connect-pg-simple/table.sql dist/

# 6. Restart
pm2 restart paylink
# or: sudo systemctl restart paylink

# 7. Verify
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/ready
```

## 10. Rollback Procedure

If a deploy goes wrong:

```bash
# 1. Stop the app
pm2 stop paylink

# 2. Restore database from backup
psql -U lshawver -h 127.0.0.1 paylink < ~/backups/paylink_backup_YYYYMMDD_HHMMSS.sql

# 3. Revert code to previous version
git log --oneline -5          # find the last good commit
git checkout <commit-hash>    # revert to it

# 4. Rebuild
npm install --production=false
npm run build
cp node_modules/connect-pg-simple/table.sql dist/

# 5. Restart
pm2 start paylink

# 6. Verify
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/ready
```

## 11. Security Summary

### App-Layer (implemented)

- `trust proxy` enabled in production (reads X-Forwarded headers from Nginx)
- Secure cookies: `httpOnly: true`, `secure: true` in production, `sameSite: "lax"`
- Session secret required in production (app refuses to start without it)
- Production env validation: fails fast on missing `DATABASE_URL` and `SESSION_SECRET`
- Security headers: HSTS, X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy
- Production error handler hides stack traces, SQL errors, and internal file paths
- Upload size limits (5MB images, 10MB documents) with file type whitelisting
- Role-based access control on all sensitive API endpoints
- Session-based auth with PostgreSQL session store
- No CORS headers set (same-origin serving eliminates the need)

### Nginx-Layer (configure in Nginx)

- SSL/TLS termination with Let's Encrypt
- Rate limiting on login endpoint (recommended config above)
- `client_max_body_size` for upload limits
- IP-based access control if needed

## 12. Transition from paylink.adiken.org

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

## 13. Database Notes

PayLink uses **PostgreSQL** (not MySQL). The `DATABASE_URL` format is:
```
postgresql://user:password@host:port/database
```

The app auto-migrates schema on startup (only adds columns/tables, never drops).
Schema change rules are documented in the project README.
