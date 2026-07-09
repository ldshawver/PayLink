# MyPayLink Developer Diagnostics Final Review Evidence

Date: 2026-07-04

## Runtime alignment

This PR applies to the MyPayLink Node/Express application in this repository, not the unrelated Luxit Flask/Gunicorn service.

Evidence in this repo:

- `package.json` names the app `rest-express` and starts production with `NODE_ENV=production node dist/index.cjs`.
- `server/index.ts` creates the Express app and HTTP server.
- `DEPLOYMENT.md` documents a MyPayLink/PayLink systemd unit with `ExecStart=/usr/bin/node dist/index.cjs`.

Commands used to verify this repo does not contain a Flask/Gunicorn app target:

```bash
find . -maxdepth 4 \( -name '*.py' -o -name 'requirements.txt' -o -name 'wsgi.py' -o -name 'app.py' -o -name 'pyproject.toml' \) -print
rg -n "express|createServer|registerRoutes|gunicorn|Flask|app:app" package.json server DEPLOYMENT.md -S -g '!node_modules'
```

If production for this feature is not the MyPayLink Node/Express app served by this repo, stop and provide the correct repository before merging.

## Permission proof

Diagnostics access is limited to authenticated users whose hydrated user record has one of these roles:

- `platform_owner`
- `super_admin`
- `system_admin`

The diagnostics middleware must not depend on `req.session.role`; it hydrates the user via the same storage user lookup used elsewhere in the app when `req.user` is absent.

Protected routes:

- `GET /api/admin/diagnostics/health`
- `GET /api/admin/diagnostics/logs`
- `GET /api/admin/diagnostics/export`

## Log/export proof

The diagnostics bundle is generated from bounded MyPayLink log reads only. It must not read entire multi-GB log files into memory.

Expected ZIP entries:

```text
logs/app.log
logs/error.log
logs/appdr.log
logs/github.log
logs/payroll.log
logs/pdf.log
logs/database.log
logs/security.log
logs/journal.log
json/environment.json
json/system-health.json
json/recent-errors.json
json/appdr-status.json
json/github-status.json
json/versions.json
```

## Redaction proof

Redaction must run before display/export and catch raw string patterns including:

- `token=`
- `session=`
- `jwt=`
- `password=`
- `api_key=`
- `key=`
- `secret=`
- reset/signing links
- authorization headers
- bearer tokens
- GitHub tokens
- query-string tokens

Production verification command after exporting a bundle:

```bash
rm -rf /tmp/mypaylink-diagnostics-scan
mkdir -p /tmp/mypaylink-diagnostics-scan
unzip -q /tmp/mypaylink-diagnostics.zip -d /tmp/mypaylink-diagnostics-scan
rg -n "(ghp_|github_pat_|Bearer [A-Za-z0-9._-]+|token=|session=|jwt=|password=|api[_-]?key=|key=|secret=|reset|signing)" /tmp/mypaylink-diagnostics-scan
```

Expected result: no raw sensitive values; only redaction placeholders and `_PRESENT` boolean metadata are allowed.

## App Dr PR failure proof

Expected safe failure response when GitHub PR creation fails after a ticket exists:

```json
{
  "success": false,
  "status": "pr_creation_failed",
  "message": "Repair ticket saved, but PR creation failed. Error ID: <correlation_id>",
  "correlationId": "<correlation_id>",
  "retryAction": "Retry PR Creation"
}
```

The frontend must detect `success:false`, show the failure message, keep the ticket in `pr_creation_failed`, and render a `Retry PR Creation` button for that status.

## Retention and rotation policy

Diagnostic log retention is configurable and intentionally bounded:

- Write path: `PAYLINK_LOG_DIR` or `storage/logs` by default.
- Rotation threshold: `10 MB` per log file.
- Retention count: last `10` rotated files per log type.
- Export read window: bounded tail reads, `512 KB` per log source by default.
- Export size ceiling: `DIAGNOSTICS_MAX_ZIP_BYTES` or `50 MB` by default.
- Compression: ZIP export compression is generated on demand; long-term compressed archive retention is not performed by the app.
- Deletion: old rotated files beyond the configured retention count are deleted during rotation.

Diagnostics routes are read-only `GET`/`HEAD` surfaces. The separate App Doctor PR retry action remains a POST workflow because it intentionally calls GitHub and can update a repair-ticket status.
