# PayLink Disaster Recovery Runbook

**Classification:** Internal — Restricted  
**Last Updated:** 2026-05-02  
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
| Backups | `pg_dump` via cron, stored in `/var/backups/paylink/` | VPS |
| CI/CD | GitHub Actions → SSH deploy | `.github/workflows/deploy-app.yml` |

---

## 3. Backup Verification (Run Monthly)

```bash
# 1. List available backups
ls -lh /var/backups/paylink/

# 2. Verify a backup file is readable and non-zero
BACKUP_FILE="/var/backups/paylink/paylink_YYYY-MM-DD.sql.gz"
gunzip -t "$BACKUP_FILE" && echo "Backup integrity OK" || echo "BACKUP CORRUPTED"

# 3. Restore to a test database to verify data integrity
createdb paylink_verify
gunzip -c "$BACKUP_FILE" | psql paylink_verify
psql paylink_verify -c "SELECT COUNT(*) FROM companies; SELECT COUNT(*) FROM workers; SELECT COUNT(*) FROM payroll_items;"
dropdb paylink_verify
```

---

## 4. Database Restore Procedure

### Step 1 — Stop Application
```bash
ssh paylinkssh@$APP_VPS_HOST
pm2 stop paylink
pm2 list  # confirm stopped
```

### Step 2 — Backup Current Database (Safety Net)
```bash
pg_dump -Fc paylink_production > /var/backups/paylink/pre_restore_$(date +%Y%m%d_%H%M%S).dump
echo "Pre-restore dump complete"
```

### Step 3 — Drop and Recreate Database
```bash
psql postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='paylink_production' AND pid <> pg_backend_pid();"
dropdb paylink_production
createdb paylink_production
```

### Step 4 — Restore from Backup
```bash
# If compressed SQL dump:
gunzip -c /var/backups/paylink/paylink_TARGET_DATE.sql.gz | psql paylink_production

# If custom-format dump:
pg_restore -d paylink_production /var/backups/paylink/paylink_TARGET_DATE.dump
```

### Step 5 — Verify Restore
```bash
psql paylink_production -c "
  SELECT 'companies' AS tbl, COUNT(*) FROM companies
  UNION ALL SELECT 'workers', COUNT(*) FROM workers
  UNION ALL SELECT 'payroll_runs', COUNT(*) FROM payroll_runs
  UNION ALL SELECT 'payroll_items', COUNT(*) FROM payroll_items;
"
```

### Step 6 — Restart Application
```bash
pm2 restart paylink
sleep 15
curl http://127.0.0.1:8001/health   # expect 200
curl http://127.0.0.1:8001/ready    # expect 200 with database:connected
pm2 logs paylink --lines 50 --nostream
```

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
npm ci --legacy-peer-deps
npm run build

# Restart
pm2 start dist/index.cjs --name paylink --cwd /home/paylinkssh/paylink-app/PayLink \
  --interpreter node --node-args="-r dotenv/config" \
  -- dotenv_config_path=/etc/paylink/.env
pm2 save --force
```

### Rollback via GitHub Actions
1. Open GitHub → Actions → `Deploy Private App` workflow
2. Click **Run workflow** → select the last successful run's commit SHA
3. Wait for deploy to complete and health checks to pass

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
| 1 | Verify latest backup is readable (`gunzip -t`) | | |
| 2 | Restore backup to test database and row-count check | | |
| 3 | Confirm application health endpoints respond after restart | | |
| 4 | Test rollback procedure on staging environment | | |
| 5 | Verify escalation contacts are up to date | | |
| 6 | Review and update RTO/RPO targets | | |
| 7 | Confirm secrets/env file backup is accessible | | |
| 8 | Run tenant isolation security tests (`npx tsx tests/security.test.ts`) | | |

---

## 9. Cross-References

- **Deployment runbook:** `DEPLOYMENT.md`
- **Backup cron script:** `scripts/deploy-paylink.sh`
- **CI/CD workflow:** `.github/workflows/deploy-app.yml`
- **Security testing:** `tests/security.test.ts`
- **Secrets in environment:** See `DEPLOYMENT.md` → Environment Variables section
