# MyPayLink staging and production deployment architecture

## Confirmed MyPayLink deployment targets

| Environment | App path | PM2 user | PM2 process | Database | Domain | Port | Env file | Deploy policy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Production | `/home/paylinkssh/paylink-app/PayLink` | `paylinkssh` | `paylink` | `mypaylink_prod` | `app.mypaylink.app` | `8000` | `/etc/paylink/.env` | Manual `workflow_dispatch` only after staging approval |
| Staging | `/home/paylinkssh/paylink-staging/PayLink` | `paylinkssh` | `paylink-staging` | `mypaylink_staging` | `staging.mypaylink.app` | `8010` | `/etc/paylink/.env.staging` | Default target for Codex/Replit changes |

Repository: `git@github.com:ldshawver/PayLink.git`

## Nginx / CloudPanel routing

CloudPanel owns reverse proxy configuration. Deployment workflows must not require passwordless sudo or mutate nginx config.

- `app.mypaylink.app` proxies to `127.0.0.1:8000`.
- `staging.mypaylink.app` proxies to `127.0.0.1:8010`.

## Mandatory isolation rules

- Staging and production must never share the same `DATABASE_URL` or database name.
- Staging and production must never share writable upload storage. If production uploads are needed for testing, copy them to staging as a one-time read-only source and write staging uploads to a separate path.
- Staging must use separate email, payment, GitHub, OAuth, webhook, and test keys where providers support separate keys.
- `APP_ENV` must be one of `production`, `staging`, or `development`.
- `APP_VERSION` must be set to the release version, for example `2.1.1`.
- Codex/Replit deploy automation may target staging only unless a Global Admin explicitly approves a production release.

## Health and diagnostics

`GET /health` returns the active environment, app version, commit, database connectivity, and timestamp. `GET /api/version` returns commit/build metadata plus `environment` and `version`. The App Doctor diagnostics center shows the same environment/version information for admins.

## Production deployment checklist

1. Back up `mypaylink_prod` and record the backup path.
2. Deploy the candidate commit to staging (`paylink-staging`).
3. Run migrations on staging only.
4. Run staging smoke tests against `staging.mypaylink.app` and `http://127.0.0.1:8010/health`.
5. Obtain explicit release approval.
6. Tag the approved release, for example `v2.1.1`, `v2.1.2`, or `v2.2.0`.
7. Manually deploy the tag to production (`paylink`).
8. Run production smoke tests against `app.mypaylink.app` and `http://127.0.0.1:8000/health`.
9. Monitor `pm2 logs paylink --lines 100` and application error dashboards.

## Rollback checklist

- Previous git tag or commit SHA is recorded before deploy.
- Previous production DB backup is present and restorable.
- Previous `/etc/paylink/.env` copy is present.
- Roll back code with `git checkout <previous-tag>` in `/home/paylinkssh/paylink-app/PayLink`.
- Restore the previous DB backup only after Global Admin approval.
- Restart production with `pm2 restart paylink --update-env`.
- Restart staging with `pm2 restart paylink-staging --update-env` if staging rollback is needed.
- Verify `curl https://app.mypaylink.app/health` after rollback.

## Migration safety

- Prefer reversible migrations whenever possible.
- Production migrations require a fresh database backup first.
- Destructive migrations require explicit manual approval and a documented restore plan.
- Allowed automatic migration patterns are additive only: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and nullable or safely defaulted `ALTER TABLE ADD COLUMN`.
