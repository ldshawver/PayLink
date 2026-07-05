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
