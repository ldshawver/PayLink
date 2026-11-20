# Staging rollout — #205 → #206 → #207 (prepared, not executed)

Nothing in this document has been run against staging except the read-only
backup and its restore rehearsal recorded below. Every numbered step after
"Approval" needs explicit approval (auth/session + migration = Global Admin
class under AGENTS.md). Production is out of scope: staging evidence is
reported before any production plan is written.

## Why order matters

* `deploy-app.yml` deploys **staging on every push to `main`** and takes no
  database backup. There is no branch-deploy path, so "deploy to staging" means
  "merge to `main`", one PR at a time.
* #206 and #207 import #205's allocator and sign-in code; #207's accept hook
  needs #206's onboarding rows. Merging out of order would not compile or
  would ship routes against missing tables.
* 0031 is gated (ledger `paylink_migrations.applied`) and applied by hand.
  0032 (clears plaintext PINs) is **not** part of this rollout.

## Evidence already gathered (2026-11-20)

| Check | Result |
| --- | --- |
| Stack heads | #205 `51bd373`, #206 `618616e`, #207 `3f6cde1`; CI green on each |
| `main`, staging, production | all `c23b655` / 2.2.21 |
| Newer migrations touching 0031/0032 | none on any branch |
| Staging backup | `pg_dump -Fc` of `apppaylinkstaging`, 1.4 MB, sha256 recorded beside the file (`/root/paylink-backups/staging-preflight/`, mode 600) |
| Restore rehearsal | restored into a disposable local DB: checksum OK, 265/265 tables, row counts identical to live staging (workers 7, companies 4, users 6, ledger 0029/0030) |
| Preflight on the copy | duplicate `(company_id, employee_number)` = 0; plaintext PINs = 7 |
| 0031 on the copy (applied twice) | ledger row ×1; 7/7 PINs hashed and verify; plaintext kept; one sign-in code per company (4/4); unique index present; no row-count or PIN-value change |
| Allocator on the copy (rolled back) | each company → 2601, 2602; existing 1003/2222 cannot collide; 0 counters left after rollback |
| Restored copy | dropped after the rehearsal |

## Steps

### 0. Approval
Written go-ahead for: merging #205, applying 0031 to staging, then #206, then #207.

### 1. Fresh backup immediately before 0031
The rehearsal backup above is evidence of the procedure, not the restore point.
```
pg_dump "$STAGING_DATABASE_URL" -Fc -Z6 --no-owner -f staging-pre-0031-<UTC>.dump
sha256sum staging-pre-0031-<UTC>.dump > staging-pre-0031-<UTC>.dump.sha256
```
Verify: `sha256sum -c`, `pg_restore -l` lists the tables, restore into a
disposable DB and compare row counts for workers/companies/users/ledger.

### 2. #205 → `main` (staging deploys automatically)
Mark ready, merge. Verify `https://staging.mypaylink.app/api/version` reports
the merge commit, health OK, PM2 `paylink-staging` restarts 0, and **existing
sign-in still works unchanged** (back-compat mode until the ledger has 0031).

### 3. Apply 0031 to staging
```
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0031_company_scoped_signin.sql
```
Re-run the queries from the rehearsal: ledger ×1, every PIN hashed and
verifying, one code per company, unique index. Strict mode engages within ~5 s.

### 4. #205 staging acceptance (synthetic company only)
Typed company code sign-in; remembered device; code rotation invalidates
remembered devices; kiosk bind/revoke; punch isolation between two companies;
rate limit and generic failure messages; audit rows with no PIN/code; 20
concurrent worker creations → unique numbers. Rollback drill: redeploy
v2.2.21 to staging, sign in with an existing PIN, roll forward.

### 5. #206 → `main`
Rebase #206 onto `main` (`git rebase --onto origin/main feat/company-scoped-signin`),
CI green, merge. Acceptance: admin adds a contractor to their own company;
foreign company in the body → 403; duplicate email → 409 with one record;
concurrent creates → consecutive numbers; worker is inactive.

### 6. #207 → `main`
Rebase onto `main`, CI green, merge. **Staging email is live** — use only a
designated test mailbox for the synthetic contractor (decision pending).
Also note the staging env file sets `SMTP_PASSWORD` while the env fallback
reads `SMTP_PASS`; delivery depends on the DB-stored email settings. A failed
send is safe (502, link revoked, retry allowed). Acceptance: one email per
burst of clicks, link expires and is single-use, accept creates one account
and completes the setup step, worker stays inactive.

### 7. Not in this rollout
0032 on staging (only after production has passed its own rollback window).
Production — separate plan after this evidence is reported.

## Rollback (staging)

| After | Action |
| --- | --- |
| Step 2/5/6 | Redeploy the previous `main` commit to staging (`deploy-app.yml` dispatch). Tables from 0031 stay; v2.2.21 ignores them. |
| Step 3 | Keep 0031 (additive). If data is wrong: restore the step-1 dump into staging after stopping `paylink-staging`. |
| PIN changed under new code then rolled back | Admin re-sets that PIN under v2.2.21 (see `docs/company-signin/rollout-plan.md`). |
