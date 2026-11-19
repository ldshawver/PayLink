# Company-scoped employee sign-in — rollout and rollback plan

Status: **PR only. Not merged, not deployed.** Production changes require review of this plan.

## What changes

| Area | Before | After |
|---|---|---|
| Employee PIN sign-in and time clock | Employee number + PIN looked up across **all** companies | Company sign-in code + employee number + PIN. The code is remembered on the device; an admin-bound kiosk never asks for it. |
| PIN storage | Plaintext `workers.pin`, compared in plain text, **returned by worker APIs** to admin browsers | bcrypt `workers.pin_hash` only. No `/api` response carries `pin`, `pinHash` or `pin_hash` (`hasPin` boolean instead). |
| PIN-created accounts | `username = employee number`, `password = bcrypt(PIN)`, so a global username/password login was possible | Unique username that reveals no IDs, random unusable password. A legacy password that still equals the PIN is replaced at the next PIN sign-in. |
| Rate limiting on PIN / time-clock routes | None | Per IP (PIN login 30 / 15 min; time clock 300 / 15 min per kiosk or IP), plus a lockout after 10 failures per (company, employee number) in 15 min |
| Audit | None for PIN sign-in | `employee_signin_events`: outcome, reason, company, number, hashed IP. Never a PIN or code. Code rotation and kiosk bind/revoke go to `authorization_audit_log`. |
| `POST /api/time-clock/punch` with a session | Accepted **any** `workerId` | Own worker, or an admin/manager with access to the worker's company |
| Kiosk username/password fallback (`/api/time-clock/sign-in`) | Skipped the main login's rate limit, MFA, email verification and platform-account guard | Login rate limit; platform, MFA and unverified accounts refused; on a bound kiosk, the account's company must match |
| Employee numbers | App-side "highest + 1" (race-prone), default 1001, no constraint | Per-company `YYNN` allocated inside the worker insert's transaction (`employee_number_counters`, row lock). `UNIQUE (company_id, employee_number)`. Existing numbers untouched. |
| `/api/import/workers` | Each record's `companyId` was not authorized | Each row's company must be one the actor administers |

Next numbers, from verified production data (read-only, 2026-11-19): Adiken Properties **2613**, Adiken Inc. **2612**, Lucifer Cruz **2605**. Companies with no `26xx` numbers start at `2601`. In 2027 each company starts at `2701`. After `YY99` the allocator stops with an actionable error and never reuses or reformats a number.

## Migrations

- **0031** (`migrations/0031_company_scoped_signin.sql`): one transaction, run as the app table owner.
  - Refuses if any company has a duplicate employee number.
  - Enables `pgcrypto`, which the database owner is allowed to do.
  - Hashes every plaintext PIN **inside Postgres**, so no PIN reaches the application or logs.
  - Creates a sign-in code for every company, seeds the counters from each company's own data, and adds the unique index and the kiosk and audit tables.
  - Records `0031` in the ledger. Rerunning it does nothing.
  - **Plaintext PINs are kept** so rolling back to v2.2.21 still works.
- **0032** (`migrations/0032_clear_plaintext_pins.sql`): clears plaintext PINs.
  - **Irreversible for rollback.** Apply only after acceptance, once the rollback window has closed.
  - Refuses unless 0031 has been applied and every plaintext PIN has a hash.
- `workers.pin_hash` is also added by the boot-time additive DDL, so the code never queries a column that doesn't exist.

## Backward compatibility

- **Code deployed before 0031:** sign-in behaves exactly as today (global lookup), except PINs are verified against the hash when one exists, PIN-created accounts get safe credentials, and responses never carry PINs. Company scoping switches on when `0031` appears in `paylink_migrations.applied`, checked within 5 seconds and with no restart.
- **Existing sessions keep working.** Tested: a session created before the migration is still valid afterwards.
- After logout or session expiry (24 h), an employee enters the company code **once per device**.

## Proposed rollout (needs approval at each step)

1. Production backup with restore rehearsal, same procedure as v2.2.20.
2. Rehearse 0031 on the restored copy. Check: ledger ×1, every plaintext PIN hashed, one code per company, counters (Adiken Properties 12, Adiken Inc. 11, Lucifer Cruz 4), unique index present, pre-existing tables identical apart from `workers.pin_hash`.
3. **Communicate first.** Admins get their company's code from Settings → Employee sign-in (available right after step 5), or from a read-only query run by the platform team before deploy. Admins bind shared time-clock devices.
4. Release PR (version bump) → annotated tag.
5. Apply 0031 through a gated workflow (new, modelled on `apply-job-board-production.yml`: pinned checksum, refuses unless the ledger matches), then deploy.
6. Verify:
   - `/health` and `/api/version`, processes.
   - A synthetic-company PIN sign-in with the code (**an authorized production test company is still needed; none exists today**).
   - No `pin` in worker API responses.
   - Audit rows appear.
7. **Close the transition gap.** Any of the 9 production accounts whose password still equals the PIN can sign in by username/password until its next PIN sign-in. Options: (a) accept and let it close naturally; (b) a reviewed one-off that sets those passwords to random values. Recommendation: (b), included with step 5.
8. After a stable period, apply 0032.

## Rollback

| Situation | Action |
|---|---|
| Before 0031 | Redeploy v2.2.21. Nothing to undo. |
| After 0031, before 0032 | Redeploy v2.2.21. Plaintext PINs are still present, so legacy PIN sign-in works again. The 0031 tables are additive and ignored by v2.2.21. **Exception:** a worker whose PIN was set or changed after the deploy has only a hash, so an admin must re-set that PIN under v2.2.21 (list: `SELECT id FROM workers WHERE pin IS NULL AND pin_hash IS NOT NULL`). |
| After 0032 | v2.2.21 can no longer verify PINs. Roll forward only. |

Never roll back by restoring the database.

## Not in this PR (later PRs)

- Contractor onboarding (create form, Documenso agreement + W-9, private documents, completion gate, welcome email).
- SSN protection (`workers.ssn` and `persons.ssn` are plaintext and returned by worker APIs).
- The existing pseudo-transaction in `approveContractorAccessRequest`: `BEGIN`/`COMMIT` through a connection pool spans different connections, so its `FOR UPDATE` double-approve guard is ineffective.
