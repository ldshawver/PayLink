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
  - Re-hashes every remaining plaintext PIN inside Postgres **before** clearing it, so a PIN reset under v2.2.21 during a rollback is the one that survives.

### PIN rules during the rollback window (0031 applied, 0032 not yet)

The new code never writes a plaintext PIN; only v2.2.21 and older do. So while a plaintext PIN exists it is the newest one and is **authoritative**:

- A sign-in compares against the plaintext in constant time and re-syncs `pin_hash` if it is stale. It never clears the plaintext.
- Without a plaintext PIN (set by the new code, or after 0032), the hash decides.
- An admin PIN change or `/api/my/change-pin` under the new code stores only a hash (plaintext NULL). This is the one rollback exception below.

Found by the 2026-11-20 rollback rehearsal (v2.2.21 at c23b655 and this PR alternated against one disposable database). Before the fix:
1. A worker who signed in under the new code **before** 0031 had the plaintext cleared and was locked out after a rollback.
2. A PIN reset under v2.2.21 during a rollback left a stale hash. After rolling forward, **the new PIN was refused and the revoked PIN was accepted**.

Both are fixed and covered by `tests/company-signin-db.test.ts` ("rollback window", "migration 0032").
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

Rehearsed 2026-11-20 on a disposable database: PR code (pre-0031) → apply 0031 → PR code → **v2.2.21** → PR code again.

| Situation | Action | Rehearsed result |
|---|---|---|
| Before 0031 | Redeploy v2.2.21. Nothing to undo: sign-ins under the new code only **added** hashes. | Worker who signed in pre-0031 → v2.2.21 PIN sign-in 200 |
| After 0031, before 0032 | Redeploy v2.2.21. Plaintext PINs are still present, so legacy PIN sign-in works. The 0031 tables are additive and ignored by v2.2.21. **Exception:** a worker whose PIN was set or changed under the new code has only a hash; an admin re-sets that PIN under v2.2.21. List: `SELECT id, company_id, employee_number FROM workers WHERE pin IS NULL AND pin_hash IS NOT NULL`. | Untouched worker 200; worker whose PIN was set under new code 401 (expected, listed by the query) |
| Roll forward again after a rollback | Redeploy the new code. PINs set under v2.2.21 win over the old hash. | New PIN 200, revoked PIN 401 |
| After 0032 | v2.2.21 can no longer verify PINs. Roll forward only. | — |

Remembered-company and kiosk cookies are ignored by v2.2.21 and become valid again on roll-forward unless the code was rotated or the kiosk revoked meanwhile. Sessions are shared by both versions.

Never roll back by restoring the database.

## Staging migration (when approved)

Merging this PR deploys it to staging automatically (`deploy-app.yml` runs on every push to `main` and takes **no** database backup), so merge only after review. Staging order:
1. Manual staging DB backup (`pg_dump`, checksum recorded), then read-only preflight: duplicate `(company_id, employee_number)` count must be 0; count plaintext PINs.
2. Merge → staging deploy (code runs in back-compat mode; sign-in unchanged).
3. Apply 0031 to staging as the app table owner: `psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0031_company_scoped_signin.sql`. Verify ledger ×1, every plaintext PIN hashed, one code per company, counters, unique index.
4. Staging acceptance with a synthetic company only: typed-code sign-in, remembered device, rotation, kiosk bind/revoke, punch isolation, 20 concurrent worker creations, rollback drill (redeploy v2.2.21 to staging, sign in, roll forward).
5. Do **not** apply 0032 on staging until production has passed its own rollback window, so staging can keep rehearsing rollbacks.

## Transition for existing employees and kiosks

| Who | What changes | What they do |
|---|---|---|
| Employee already signed in | Nothing. Sessions survive 0031 and a code rotation (unless the admin ticks "sign out employees"). | Nothing until the next sign-in. |
| Employee at the next sign-in on a personal device | Asked once for the company code, then remembered on that device. Same employee number, same PIN. | Gets the code from the admin (Settings → Employee sign-in), or a printed notice. |
| Shared time-clock device | Without a binding it asks for the code like any device. | Admin opens Settings → Employee sign-in on that device and chooses **Bind this device**. After that it never asks for a code and only serves that company. |
| Admin | Gets a code per company; can rotate it (invalidates remembered devices, optionally signs employees out) and revoke kiosks. | Before go-live: copy the code, bind kiosks. |
| 9 production accounts whose password still equals the PIN | Username/password login still possible until the next PIN sign-in (transition gap). | Step 7 option (b) closes it on deploy day. |

## Not in this PR (later PRs)

- Contractor onboarding (create form, Documenso agreement + W-9, private documents, completion gate, welcome email).
- SSN protection (`workers.ssn` and `persons.ssn` are plaintext and returned by worker APIs).
- The existing pseudo-transaction in `approveContractorAccessRequest`: `BEGIN`/`COMMIT` through a connection pool spans different connections, so its `FOR UPDATE` double-approve guard is ineffective.
