# Developer Diagnostics Final Review Evidence

Date: 2026-07-02
Branch commit reviewed: `630b843` plus this evidence commit.

## 1. Runtime alignment

### Repo runtime evidence

The active application runtime in this repository is Node/Express:

- `package.json` declares the project as `rest-express` and uses `NODE_ENV=production node dist/index.cjs` for production start.
- `server/index.ts` creates an Express app and HTTP server.
- `DEPLOYMENT.md` documents the systemd unit with `ExecStart=/usr/bin/node dist/index.cjs`.

Commands run in this workspace:

```bash
rg -n "express|createServer|registerRoutes|systemd|luxit|gunicorn|flask|Flask" package.json server DEPLOYMENT.md .github -S -g '!node_modules' | head -120
find . -maxdepth 3 \( -name '*.py' -o -name 'requirements.txt' -o -name 'wsgi.py' -o -name 'app.py' \) -print
```

Observed evidence:

```text
package.json:2:  "name": "rest-express"
package.json:6-11 scripts include:
  "dev": "NODE_ENV=development tsx server/index.ts"
  "start": "NODE_ENV=production node dist/index.cjs"
server/index.ts:1:import express, { type Request, Response, NextFunction } from "express";
server/index.ts:26:const app = express();
server/index.ts:27:const httpServer = createServer(app);
server/index.ts:3998:  await registerRoutes(httpServer, app);
DEPLOYMENT.md systemd unit: ExecStart=/usr/bin/node dist/index.cjs
```

The `find` command returned no Flask/Gunicorn entrypoint files (`*.py`, `requirements.txt`, `wsgi.py`, `app.py`) within `-maxdepth 3` in this repo snapshot.

### Mapping to `luxit` systemd service

This repo's documented unit name is `paylink.service`, but the diagnostics implementation intentionally reads the requested deployment service/log names (`luxit`) because the production host may have renamed the unit. The expected mapping on production should be:

```ini
[Service]
WorkingDirectory=/path/to/PayLink
ExecStart=/usr/bin/node dist/index.cjs
StandardOutput=journal
StandardError=journal
```

under the `luxit` unit name. Confirm on the VPS with:

```bash
sudo systemctl status luxit --no-pager
sudo systemctl cat luxit --no-pager
```

If `ExecStart` is not Node (`node dist/index.cjs` or equivalent), do not merge until the runtime mismatch is resolved.

## 2. Permission proof

Backend diagnostics access is restricted in `server/diagnostics.ts` to exactly:

```ts
new Set(["platform_owner", "super_admin", "system_admin"])
```

and every diagnostics API route uses `requireDiagnosticsRole`:

- `GET /api/admin/diagnostics/health`
- `GET /api/admin/diagnostics/logs`
- `GET /api/admin/diagnostics/export`

Frontend app route/sidebar access is restricted to the same roles for `/app/developer-diagnostics`.

## 3. Log access proof

Commands requested by reviewer were executed in this container:

```bash
sudo tail -n 500 /var/log/luxit-error.log
sudo tail -n 500 /var/log/luxit-access.log
sudo journalctl -u luxit -n 500 --no-pager
sudo systemctl status luxit --no-pager
```

Observed container output:

```text
tail: cannot open '/var/log/luxit-error.log' for reading: No such file or directory
tail: cannot open '/var/log/luxit-access.log' for reading: No such file or directory
No journal files were found.
-- No entries --
System has not been booted with systemd as init system (PID 1). Can't operate.
Failed to connect to bus: Host is down
```

Conclusion: this development container cannot prove production Luxit log access because it does not contain the Luxit log files and is not booted with systemd. Do not merge until the same commands succeed on the CloudPanel VPS or the app endpoint returns sanitized log rows from that host.

## 4. Export proof

Code-level evidence: `server/diagnostics.ts` adds these ZIP entries:

```text
logs/luxit-access.log
logs/luxit-error.log
logs/journal-luxit.log
json/environment.json
json/system-health.json
json/recent-errors.json
json/appdr-status.json
json/github-status.json
json/versions.json
```

Production verification command after logging in as an allowed admin:

```bash
curl -fsS -b /tmp/paylink-admin.cookies -o /tmp/paylink-diagnostics.zip https://app.mypaylink.app/api/admin/diagnostics/export
unzip -l /tmp/paylink-diagnostics.zip
```

Do not attach the ZIP publicly unless it has been scanned with the redaction checks below.

## 5. Redaction proof

Code-level evidence: `redactSensitive()` replaces secret, token, JWT/session-like, SSN/EIN/DOB, bank/routing/account, address-keyed, and payroll-keyed values with these placeholders:

```text
[REDACTED_SECRET]
[REDACTED_BANK]
[REDACTED_PII]
[REDACTED_PAYROLL]
```

Production ZIP scan command:

```bash
rm -rf /tmp/paylink-diagnostics-scan
mkdir -p /tmp/paylink-diagnostics-scan
unzip -q /tmp/paylink-diagnostics.zip -d /tmp/paylink-diagnostics-scan
rg -n "(ghp_|github_pat_|Bearer [A-Za-z0-9._-]+|api[_-]?key[=:]|password[=:]|session[=:]|jwt[=:]|[0-9]{3}-[0-9]{2}-[0-9]{4}|[0-9]{2}-[0-9]{7}|routing[=: ]+[0-9]{4,}|account[=: ]+[0-9]{4,})" /tmp/paylink-diagnostics-scan
```

Expected result: no matches except redaction placeholders or key names ending in `_PRESENT` with boolean values.

## 6. App Dr proof

Code-level evidence:

- PR creation failure updates the ticket to `pr_creation_failed`.
- The route returns HTTP 200 with `success: false`, a safe message, `correlationId`, and `retryAction` instead of a raw 500.
- Retrying from `pr_creation_failed` writes a security/audit diagnostics log event: `App Dr retry PR creation triggered`.

Production simulation should be run against a disposable App Dr ticket by temporarily using a bad GitHub token/repo in staging, not production payroll data.

Expected safe response shape:

```json
{
  "success": false,
  "status": "pr_creation_failed",
  "message": "Repair ticket saved, but PR creation failed. Error ID: <correlation_id>",
  "correlationId": "<correlation_id>",
  "retryAction": "Retry PR Creation"
}
```

## Merge status

**Do not merge until production/staging evidence from the CloudPanel VPS is attached to the PR:**

- Successful `sudo tail` output for both Luxit log files.
- Successful `sudo journalctl -u luxit -n 500 --no-pager` output.
- Successful `sudo systemctl status luxit --no-pager` output showing the Luxit service maps to this Node/Express app.
- `unzip -l` output for the exported diagnostics bundle showing the required entries.
- Redaction scan output showing no raw secrets/PII/bank/payroll-sensitive values.
- App Dr PR failure simulation output showing `pr_creation_failed`, safe correlation-ID response, and retry audit log entry.
