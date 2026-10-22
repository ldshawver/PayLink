# PayLink Disaster Recovery Runbook

**Classification:** Internal — Restricted  
**Last Updated:** 2026-10-21  
**Owner:** PayLink Platform Engineering  
**Review Cycle:** Quarterly

---

## 1. RTO / RPO Targets

| Tier | Service Component | RTO | RPO |
|------|-------------------|-----|-----|
| P1 | Payroll processing (active pay run) | 2 hours | 15 minutes |
| P2 | Core web application (login, dashboard) | 4 hours | 1 hour |
| P3 | Reporting, audit log, documents | 8 hours | 4 hours |
| P4 | Platform console | 24 hours | 4 hours |

---

## 2. Infrastructure Overview

| Component | Technology | Host |
|-----------|-----------|------|
| Application | Node.js / Express, managed by PM2 | VPS (`APP_VPS_HOST`) |
| Database | PostgreSQL | VPS (same host, local socket) |
| Static assets | Served by Express from `dist/public/` | VPS |
| Backups | Nightly encrypted `pg_dump` (systemd timer) → local `/var/backups/paylink/nightly/` + off-server rclone remote; see §3 | VPS + off-server |
| CI/CD | GitHub Actions → SSH deploy (`appleboy/ssh-action`, secrets: `APP_VPS_HOST`, `APP_VPS_SSH_KEY`) | `.github/workflows/deploy-app.yml` |

---

## 3. Automated Nightly Backup

> **Correction (2026-10-21, PB-1):** earlier revisions of this section said a nightly
> `scripts/backup-db.sh` cron was installed. It never was. The 2026-10-21 audit found no
> cron or timer entry and no log file, and the only output was two manual runs from
> 2026-06-12. CloudPanel's own backup jobs cover MySQL and CloudPanel's SQLite only, not
> PayLink's PostgreSQL.

The current mechanism, install steps, alerting and drill schedule are in
**[`docs/deployment/production-db-backup.md`](docs/deployment/production-db-backup.md)**.

| Property | Value |
|----------|-------|
| Schedule | `paylink-db-backup.timer`, nightly 03:40 UTC (`Persistent=true`), runs as `paylinkssh` |
| Scripts | `scripts/backup-db.sh` + `scripts/backup-restore-verify.sh`, installed root-owned to `/usr/local/lib/paylink-backup/` |
| Format | `pg_dump --format=custom`, GPG-encrypted to an offline-held key (`*.dump.gpg` + `.sha256` + `.manifest.txt`) |
| Verification | Every backup is restored into a throwaway socket-only cluster before it is accepted. The off-server copy is read back and hash-checked |
| Local copy | `/var/backups/paylink/nightly/`, 14 days (encrypted only) |
| Off-server | rclone remote `paylink-offsite:<bucket>/prod/YYYY/MM/`, retention via bucket lifecycle |
| Alerting | Dead-man healthcheck (start / success / `fail`) + failure email |
| Second source | Pre-deploy dumps in `/home/paylinkssh/paylink-predeploy-backups/` (taken on every production deploy) |

---

## 4. Database Restore Procedure

Follow **§5 of [`docs/deployment/production-db-backup.md`](docs/deployment/production-db-backup.md)**.
In summary:

1. On the admin machine, fetch the backup and verify its sha256. Decrypt it with the offline key.
2. Stop the app (`pm2 stop paylink`).
3. Restore into a **new** database, `paylink_restore_<TS>`, with `pg_restore --exit-on-error --no-owner`.
4. Compare row counts against the backup's manifest.
5. Point `DATABASE_URL` at the new database (or rename the databases). Restart and verify `/api/version`.
6. Keep the old database until the restored one has been accepted.

Never `dropdb` the live database before a verified replacement exists. The previous revision
of this procedure did that.

---

## 5. Application Rollback Procedure

### Quick Rollback (Git Reset)
```bash
cd /home/paylinkssh/paylink-app/PayLink
pm2 stop paylink

# Find last known-good commit
git log --oneline -20

# Reset to that commit
git reset --hard <COMMIT_SHA>

# Reinstall and rebuild
pnpm install --frozen-lockfile=false --reporter=append-only
pnpm build

# Restart
APP_PATH="/home/paylinkssh/paylink-app/PayLink"
pm2 start "$APP_PATH/dist/index.cjs" \
  --name paylink \
  --cwd "$APP_PATH" \
  --interpreter node \
  --node-args="--require dotenv/config" \
  -- dotenv_config_path=/etc/paylink/.env
pm2 save --force

# Verify
sleep 5
curl http://127.0.0.1:8000/health
curl https://mypaylink.app/health
```

### Rollback via GitHub Actions
1. Open GitHub → Actions → `PayLink CI / Deploy` workflow
2. Click **Run workflow** → select the last successful run's commit SHA
3. The `security-tests` → `build` → `deploy` pipeline will run; SSH deploys to the VPS and verifies `/health`
4. Wait for deploy to complete and health checks to pass

---

## 6. Environment File Recovery

The `.env` file lives at `/etc/paylink/.env` (not version-controlled).  
A reference of required variables is in `DEPLOYMENT.md`.

**If the env file is lost:**
1. Restore from your secrets manager or a secure offline backup
2. At minimum, set: `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`
3. Restart `paylink` with PM2

---

## 7. Escalation Contacts

| Role | Contact | Availability |
|------|---------|--------------|
| Primary On-Call Engineer | (fill in) | 24/7 via PagerDuty |
| Database Administrator | (fill in) | Business hours + on-call |
| Infrastructure Lead | (fill in) | Business hours + on-call |
| Product Owner | (fill in) | Business hours |
| Stripe Support (payments) | https://support.stripe.com | 24/7 |
| VPS Provider Support | (fill in hosting provider URL) | 24/7 |

---

## 8. Quarterly DR Drill Checklist

Run this checklist each quarter. Record date and initials of engineer performing each step.

| # | Step | Date Verified | Engineer |
|---|------|---------------|----------|
| 1 | Confirm `last-success` < 26h old and the healthcheck shows no missed runs | | |
| 2 | Off-site restore drill with the offline key (`production-db-backup.md` §6); row counts match manifest | | |
| 2a | Confirm both offline copies of the backup private key are present and readable | | |
| 3 | Confirm application health endpoints respond after restart | | |
| 4 | Test rollback procedure on staging environment | | |
| 5 | Verify escalation contacts are up to date | | |
| 6 | Review and update RTO/RPO targets | | |
| 7 | Confirm secrets/env file backup is accessible | | |
| 8 | Run tenant isolation security tests (`npx tsx tests/security.test.ts`) | | |

---

## 9. Deployment Monitoring & Rollback Runbook

### 9.1 How the Automated Deploy Pipeline Works

Every push to `main` (and any manual `workflow_dispatch`) triggers `.github/workflows/deploy-app.yml`:

| Stage | What it does | Failure behaviour |
|-------|-------------|-------------------|
| **SSH connectivity check** | Opens SSH connection, confirms host is reachable | Fails fast — no code touched |
| **Pre-flight env check** | Verifies `/etc/paylink/.env` exists; checks `DATABASE_URL`, `SESSION_SECRET`, `APP_BASE_URL` | Fails fast — no code touched |
| **Deploy** | `git reset --hard origin/main` → install deps → build → nginx config → PM2 restart | Proceeds to health check |
| **Internal health check** | Polls `http://127.0.0.1:8000/health` up to 30× (3 s apart) | Triggers auto-rollback on failure |
| **Auto-rollback** | Resets to previous commit, rebuilds, restarts PM2, re-polls `/health` | Logs outcome; exits 1 (fails CI) |
| **Public routing gate** | Polls `https://mypaylink.app/health` up to 6× (5 s apart) — **hard fail** | Non-200 exits 1 and fails the workflow |
| **Email notification** | Sends HTML email (success or failure) via SMTP to `DEPLOY_NOTIFY_EMAIL` | `continue-on-error: true` — email failure never blocks the deploy result |

### 9.2 Monitoring Checklist (After Every Deploy)

1. Open GitHub → Actions → `Deploy PayLink App` → confirm the run is green.
2. Click the run → expand **Deploy to VPS** step → look for `✓ Deployment complete`.
3. Check `https://mypaylink.app/health` returns `{"status":"ok"}`.
4. If the public health check shows a warning (nginx routing), see §9.5 below.

### 9.3 Automated Rollback (Triggered by Pipeline)

When the internal health check fails after deploy, the pipeline automatically:
1. Captures PM2 logs (last 80 lines) for diagnostics.
2. `git reset --hard <prev-commit>` on the VPS.
3. Reinstalls deps and rebuilds from the previous commit.
4. Restarts PM2 and re-checks `/health`.
5. Reports rollback outcome in the Actions log; exits non-zero so the run is marked **failed**.

**You will see this in the Actions log:**
```
⏪ Rolling back to <sha>
✓ Rollback successful — app is healthy on <sha>
```
or:
```
❌ Rollback also failed — manual intervention required
```

### 9.4 Manual Emergency Rollback (SSH)

Use this when the automated rollback also fails, or you need to roll back to a specific known-good commit:

```bash
ssh paylinkssh@$APP_VPS_HOST

cd /home/paylinkssh/paylink-app/PayLink

# 1. Find last known-good commit
git log --oneline -20

# 2. Stop the app
pm2 stop paylink

# 3. Reset to known-good commit
git reset --hard <KNOWN_GOOD_SHA>

# 4. Reinstall and rebuild
pnpm install --frozen-lockfile=false --reporter=append-only
pnpm build

# 5. Restart
APP_PATH="/home/paylinkssh/paylink-app/PayLink"
pm2 start "$APP_PATH/dist/index.cjs" \
  --name paylink \
  --cwd "$APP_PATH" \
  --interpreter node \
  --node-args="--require dotenv/config" \
  -- dotenv_config_path=/etc/paylink/.env
pm2 save --force

# 6. Verify
sleep 5
curl http://127.0.0.1:8000/health
curl https://mypaylink.app/health
pm2 logs paylink --lines 30 --nostream
```

### 9.5 Nginx Manual Fix (When `sudo` Is Unavailable in CI)

If the public routing check fails (`⚠️ nginx may need manual sudo fix`):

```bash
ssh root@$APP_VPS_HOST
cp /home/paylinkssh/paylink-app/PayLink/scripts/nginx-mypaylink.conf \
   /etc/nginx/sites-enabled/mypaylink.app.conf
nginx -t && nginx -s reload
curl https://mypaylink.app/health
```

### 9.6 Required GitHub Secrets

Set all of these at: **GitHub → Repository → Settings → Secrets and variables → Actions**

#### SSH / Deploy (required)

| Secret | Description |
|--------|-------------|
| `APP_VPS_HOST` | VPS hostname or IP address |
| `APP_VPS_USER` | SSH username (`paylinkssh`) |
| `APP_VPS_SSH_KEY` | Private SSH key (PEM format) |
| `APP_VPS_PORT` | SSH port (default 22) |

#### Email notifications (required for deploy alerts)

| Secret | Description | Example |
|--------|-------------|---------|
| `SMTP_HOST` | SMTP server hostname | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP login username | `alerts@yourdomain.com` |
| `SMTP_PASS` | SMTP password or app password | (your password) |
| `SMTP_FROM` | From address (optional — defaults to SMTP_USER) | `PayLink Alerts <alerts@yourdomain.com>` |
| `DEPLOY_NOTIFY_EMAIL` | Recipient for deploy success/failure emails | `you@yourdomain.com` |

> **Gmail tip:** Generate an [App Password](https://myaccount.google.com/apppasswords) — do not use your main account password.
> Email steps use `continue-on-error: true` so a misconfigured SMTP secret never blocks deploys.

### 9.7 Diagnosing a Failed Deploy

```bash
# On the VPS — check PM2 status and recent logs
pm2 status
pm2 logs paylink --lines 100 --nostream

# Verify the env file is intact
ls -la /etc/paylink/.env
source /etc/paylink/.env && echo "DB: ${DATABASE_URL:0:20}..."

# Verify the binary exists and runs
node /home/paylinkssh/paylink-app/PayLink/dist/index.cjs --version 2>&1 || true

# Check if port 8000 is bound
ss -tlnp | grep 8000
```

---

## 10. Cross-References

- **Deployment runbook:** `DEPLOYMENT.md`
- **Backup cron script:** `scripts/backup-db.sh` (nightly at 02:00, logs to `/var/log/paylink-backup.log`)
- **CI/CD workflow:** `.github/workflows/deploy-app.yml`
- **Security testing:** `tests/security.test.ts`
- **Secrets in environment:** See `DEPLOYMENT.md` → Environment Variables section
