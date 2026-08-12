# MyPayLink staging and production deployment architecture

## Confirmed MyPayLink deployment targets

| Environment | App path | PM2 user | PM2 process | Database | Domain | Port | Env file | Deploy policy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Development | Local checkout (any workstation/Codex/Replit sandbox) | n/a | n/a (`pnpm dev`) | Local/dev `DATABASE_URL`, never `mypaylink_prod` or `mypaylink_staging` | `localhost` | developer-chosen (commonly `5000`) | local `.env` (not committed; see `.env.example`) | No deploy workflow targets development; it never receives a GitHub Actions deploy |
| Production | `/home/paylinkssh/paylink-app/PayLink` | `paylinkssh` | `paylink` | `mypaylink_prod` | `app.mypaylink.app` | `8000` | `/etc/paylink/.env` | Manual `workflow_dispatch` only after staging approval |
| Staging | `/home/paylinkssh/paylink-staging/PayLink` | `paylinkssh` | `paylink-staging` | `mypaylink_staging` | `staging.mypaylink.app` | `8010` | `/etc/paylink/.env.staging` | Default target for Codex/Replit changes |

Repository: `git@github.com:ldshawver/PayLink.git`

## GitHub Actions promotion path

- `.github/workflows/deploy-app.yml` (**staging**) triggers on `push` to `main` and on manual `workflow_dispatch`. **Pushing a feature branch never deploys staging** — only a push/merge that lands on `main` does. There is no per-branch preview deploy.
- **Merging a PR into `main` deploys staging only.** The staging workflow runs `pnpm typecheck`, the Documenso/signing regression tests, and `pnpm build` on the GitHub-hosted runner before SSHing to the VPS to reset `paylink-staging` to `origin/main` and restart PM2 on port `8010`.
- `.github/workflows/deploy-production.yml` (**production**) has **no `push` trigger at all** — it only runs on manual `workflow_dispatch` with a required `release_tag` input. **Production always requires a later, separate, explicit workflow dispatch**; merging to `main` cannot deploy it.
- The full feature lifecycle is: feature branch → PR → merge to `main` (auto-deploys staging) → staging acceptance (see `DEPLOYMENT.md`) → tag the exact staging-tested commit → `workflow_dispatch` on `deploy-production.yml` with that tag as `release_tag`.
- **Exact-commit promotion:** production must deploy the identical commit that passed staging acceptance. Tag that commit directly (`git tag v2.1.2 <staging-tested-sha> && git push origin v2.1.2`); do not tag or dispatch a later, untested `main` tip.

## Two deploy mechanisms — know which one you're reading about

There are two independent ways PayLink gets deployed to a VPS path, and they do not have the same safety properties:

1. **GitHub Actions workflows** (`deploy-app.yml`, `deploy-production.yml`) — the automatic/standard CI path described above. They back up the production database (`pg_dump` + gzip) before a production deploy and run a post-deploy `/health` poll, but **they do not automatically roll back the release on failure** — a failed health check just fails the job; the previous release is not restored by the workflow itself. Recovery after a failed GitHub Actions deploy is a manual rollback (see below).
2. **`scripts/deploy-paylink.sh`** — a manual, VPS-run script (also usable as the body of a future hardened workflow) that additionally: validates the release tag matches `package.json` version before deploying, starts the new release as a `-candidate` PM2 process before touching the live one, and **automatically rolls back to the prior commit/PM2 process on any failure** via a shell `trap ... EXIT`. This is the safer path for a manual/emergency deploy; see "Manual deployment" in `DEPLOYMENT.md`.

## Required GitHub repository configuration

No GitHub **Environments** (the repo-settings "Environments" feature with required reviewers/protection rules) are configured for this repository — deployment gating for production is enforced entirely by requiring manual `workflow_dispatch` with an explicit `release_tag` input, not by GitHub Environment approval gates.

Repository secrets referenced by the PayLink app deploy workflows (names only — values are never documented here or anywhere in this repo):

| Secret name | Used by | Purpose |
| --- | --- | --- |
| `APP_VPS_HOST` | `deploy-app.yml`, `deploy-production.yml` | SSH host for the PayLink VPS |
| `APP_VPS_USER` | `deploy-app.yml`, `deploy-production.yml` | SSH user (`paylinkssh`) |
| `APP_VPS_SSH_KEY` | `deploy-app.yml`, `deploy-production.yml` | SSH private key |
| `APP_VPS_PORT` | `deploy-app.yml`, `deploy-production.yml` | SSH port |

(`vps-mypaylink-audit.yml` and `deploy-marketing.yml` use a separate `VPS_*`/`MKT_VPS_*`/`PGPASSWORD` secret set for unrelated targets — not part of the PayLink app deploy path.)

Neither deploy workflow declares any repository **variables** (`vars.*`) today.

## Application-version behavior

`GET /health` and `GET /api/version` report `version` from `process.env.APP_VERSION` (`server/app-metadata.ts`, falls back to the `package.json` default of `2.1.1` only if `APP_VERSION` is unset) and `commit` from `process.env.PAYLINK_COMMIT` (the exact deployed Git SHA, set by every deploy path). Both `deploy-app.yml` and `deploy-production.yml` now compute `PACKAGE_VERSION` from the checked-out `package.json` and pass it to `pm2 start` as `APP_VERSION`, so staging and production each report the version of the code actually running, not a stale default. Production additionally refuses to deploy if `release_tag` does not match `v$PACKAGE_VERSION` (or `$PACKAGE_VERSION`) of the checked-out tag.

## Documenso sender configuration

Contract-signing emails resolve a Documenso sender identity (worker → user → company, in that order) via `resolveDocumensoSenderIdentity()` in `server/contract-signing-flow.ts`; sending fails closed with a `400` rather than sending under a generic fallback name when no identity resolves. See `DOCUMENSO_SIGNING_LIVE_VALIDATION.md` for the full live-validation checklist and required manual/staging verification steps — that file is the source of truth for Documenso-specific acceptance criteria and is not duplicated here.

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
