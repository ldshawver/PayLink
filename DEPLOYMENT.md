# PayLink VPS Deployment Guide

## Confirmed deployment targets

| Target | Repository | VPS path | PM2 user | PM2 process | Port | Env file |
|---|---|---|---|---|---:|---|
| Production | `git@github.com:ldshawver/PayLink.git` | `/home/paylinkssh/paylink-app/PayLink` | `paylinkssh` | `paylink` | `8000` | `/etc/paylink/.env` |
| Staging | `git@github.com:ldshawver/PayLink.git` | `/home/paylinkssh/paylink-staging/PayLink` | `paylinkssh` | `paylink-staging` | `8010` | `/etc/paylink/.env.staging` |

Do not deploy PayLink from `/root/lux-email-bot`, `/root/PayLink`, or any `luxit` path/user. PayLink is managed with PM2 only.

## Deployment policy

- Pushes to `main` deploy **staging only**.
- Production deployments are **manual only** via `.github/workflows/deploy-app.yml`.
- Production deployments must provide a Git release tag such as `v2.1.1`.
- Production never deploys directly from `main`; it checks out and deploys the requested release tag.
- Before production deploys, `package.json` `version`, `APP_VERSION` from `/etc/paylink/.env`, and the release tag without the `v` prefix must all match.
- Before staging deploys, `/etc/paylink/.env` and `/etc/paylink/.env.staging` must both contain `DATABASE_URL`, and those values must differ.

## Mandatory pre-deployment gate

Every deploy aborts unless all safety gate steps succeed:

1. PostgreSQL backup using the selected target `DATABASE_URL`.
2. `pm2 save --force` succeeds.
3. Nginx config backup or explicit backup marker is written.
4. Current Git commit and package version are recorded.

## Rollback and deployment history

If build, restart, Nginx apply, or health validation fails, deployment automatically rolls back to the previously recorded commit and restarts the target PM2 process. The deploy script appends JSON lines to `/home/paylinkssh/deployment-history.log` with version, commit, release tag, environment, deployment time, deployed by, migration status, rollback status, and final status.

## Health validation

The deploy script validates all of the following before recording success:

- `/health`
- `/ready` with database connectivity
- upload/storage directory exists and is writable
- required environment values are loaded
- `/api/version` responds
- `/api/version` commit matches the deployed Git commit
- startup auto-migrations reached readiness, recorded as migration status

## Manual deployment

Run on the VPS as a user with access to the PayLink checkout and PM2 process:

```bash
# Staging deploys origin/main
/home/paylinkssh/paylink-staging/PayLink/scripts/deploy-paylink.sh staging

# Production deploys only an explicit release tag
/home/paylinkssh/paylink-app/PayLink/scripts/deploy-paylink.sh production v2.1.1
```

## Safe staging bootstrap when the provisioning script is missing on the VPS

If `/home/paylinkssh/paylink-app/PayLink/scripts/provision-staging-environment.sh` is missing on the live VPS, copy **only that script** from the reviewed branch or PR artifact. Do not `git pull`, `rsync` the repository, restart PM2, run migrations, or execute the script until the staging isolation checks below pass.

Before copying anything to the VPS, confirm that the provisioning script exists in the current local checkout at the exact path `scripts/provision-staging-environment.sh`. If it exists only in another PR or commit, fetch and check out that pinned commit first; do not run any VPS install command until the local file exists and passes syntax validation.

```bash
ls -l scripts/provision-staging-environment.sh
bash -n scripts/provision-staging-environment.sh
sha256sum scripts/provision-staging-environment.sh
```

### Option A — copy only the script from your workstation

Run from a local checkout of the reviewed PR/branch only after the local preflight above passes:

```bash
scp scripts/provision-staging-environment.sh \
  paylinkssh@$APP_VPS_HOST:/tmp/provision-staging-environment.sh

ssh paylinkssh@$APP_VPS_HOST 'set -euo pipefail
  install -d /home/paylinkssh/paylink-app/PayLink/scripts
  install -m 0755 /tmp/provision-staging-environment.sh \
    /home/paylinkssh/paylink-app/PayLink/scripts/provision-staging-environment.sh
  sha256sum /home/paylinkssh/paylink-app/PayLink/scripts/provision-staging-environment.sh
'
```

### Option B — fetch only the script from GitHub

Use a pinned commit SHA from the approved infrastructure PR, not a moving branch name:

```bash
APPROVED_COMMIT_SHA="<approved-pr-commit-sha>"
ssh paylinkssh@$APP_VPS_HOST "set -euo pipefail
  curl -fsSL \
    https://raw.githubusercontent.com/ldshawver/PayLink/$APPROVED_COMMIT_SHA/scripts/provision-staging-environment.sh \
    -o /tmp/provision-staging-environment.sh
  install -d /home/paylinkssh/paylink-app/PayLink/scripts
  install -m 0755 /tmp/provision-staging-environment.sh \
    /home/paylinkssh/paylink-app/PayLink/scripts/provision-staging-environment.sh
  sha256sum /home/paylinkssh/paylink-app/PayLink/scripts/provision-staging-environment.sh
"
```

### Required verification before running staging

Run these commands on the VPS without printing secret values:

```bash
sudo test -f /etc/paylink/.env
sudo test -f /etc/paylink/.env.staging
sudo bash -c 'prod=$(grep -E "^DATABASE_URL=" /etc/paylink/.env | cut -d= -f2-); stg=$(grep -E "^DATABASE_URL=" /etc/paylink/.env.staging | cut -d= -f2-); test -n "$prod" && test -n "$stg" && test "$prod" != "$stg"'
pm2 describe paylink >/dev/null
! pm2 describe paylink-staging >/dev/null 2>&1 || pm2 status paylink-staging
ss -ltnp | grep ':8000'
! ss -ltnp | grep ':8010'
getent hosts staging.mypaylink.app
sudo nginx -T | grep -A20 'server_name staging.mypaylink.app' | grep '127.0.0.1:8010'
```

Do **not** start `paylink-staging` until all of the following are true:

1. `/etc/paylink/.env.staging` uses a separate `DATABASE_URL` from `/etc/paylink/.env`.
2. `paylink-staging` is configured to run on port `8010` only.
3. `staging.mypaylink.app` DNS resolves to the VPS.
4. Nginx/CloudPanel routes `staging.mypaylink.app` to `127.0.0.1:8010` and does not modify production hostnames.

If the infrastructure PR is merged instead of copying the script, deploy it to staging only after confirming the diff touches only staging/deployment files and does not alter production runtime code, production PM2 process `paylink`, port `8000`, `/etc/paylink/.env`, production Nginx hostnames, payroll/tax/auth logic, or database schema. Production remains on `/home/paylinkssh/paylink-app/PayLink`, PM2 process `paylink`, and port `8000`.


### Staging acceptance hold before merge or production deployment

Hold infrastructure and contractor-payment PRs until `paylink-staging` is operational on port `8010` with a staging `DATABASE_URL` that is separate from production. Do not merge, tag a release, or deploy production until the staging acceptance checklist below passes and evidence is attached to the PR.

Run the acceptance checklist on staging only:

1. Apply migration `0013` against the staging database only.
2. Create a sample independent contractor payment.
3. Add an approved trade goods credit.
4. Generate a Contractor Statement.
5. Confirm the printed check amount is the cash remainder only.
6. Confirm the statement shows total compensation, trade goods credit, and check payment proof.
7. Confirm the employee paystub PDF is unchanged.
8. Confirm the MICR/check face is unchanged.
9. Confirm a contractor cannot access another contractor's statement.
10. Confirm audit logs record creation, approval, download, and blocked print attempts.

If any acceptance item fails, stop the promotion, keep production unchanged, document the failure in the PR, and fix/retest in staging before requesting production approval.

## PM2 operations

```bash
# Production
pm2 status paylink
pm2 logs paylink --lines 100 --nostream
pm2 restart paylink --update-env

# Staging
pm2 status paylink-staging
pm2 logs paylink-staging --lines 100 --nostream
pm2 restart paylink-staging --update-env
```

## Health checks

```bash
# Production
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/ready
curl http://127.0.0.1:8000/api/version

# Staging
curl http://127.0.0.1:8010/health
curl http://127.0.0.1:8010/ready
curl http://127.0.0.1:8010/api/version
```

## Nginx

The canonical production Nginx config is `scripts/nginx-mypaylink.conf`, which proxies PayLink app traffic to `127.0.0.1:8000`. The helper `scripts/apply_mypaylink_nginx.sh` validates Nginx and reloads it with `nginx -s reload`.

Staging is intentionally not wired by this repository to the production public Nginx host; use the local `127.0.0.1:8010` health checks or an explicitly configured staging proxy.
