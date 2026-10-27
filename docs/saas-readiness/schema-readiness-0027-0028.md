# Schema readiness — migrations 0027 and 0028

Production deploys never run `drizzle-kit push`, so tables declared in
`shared/schema.ts` after the production database was first pushed were never
created there. These two migrations create the provisioning tables that the
tenant suspension / billing-lifecycle code (#177–#182) depends on. They are
hand-applied, gated, and must not be replaced by `drizzle-kit push` (which
would also apply every other drift, including gated FKs).

| File | Creates | Unblocks |
|---|---|---|
| `migrations/0027_tenant_provisioning_audit_logs.sql` | `tenant_provisioning_audit_logs` (+ `paylink_migrations.applied` ledger) | Stripe reactivation after a billing suspension (otherwise refused as `unverifiable`); legacy provisioning-suspension classification; provisioning audit trail |
| `migrations/0028_tenant_provisioning_gates_and_projects.sql` | enum `tenant_lifecycle_state`, `tenant_commercial_gates`, `tenant_implementation_projects` (FKs → `companies(id) ON DELETE CASCADE`) | Every `POST /api/provisioning/event` (incl. audited admin suspension), `GET /api/provisioning/tenants[/:companyId]`, provisioning retry / gates / projects routes |

Both are additive only: new empty objects, no DROP / DELETE / backfill, no
change to any existing object. DDL equals `drizzle-kit push` of
`shared/schema.ts` (names, columns, defaults, constraints) — verified by
`tests/schema-readiness-0027-0028-db.test.ts`, whose shape checks run inside
the migrations themselves.

## Properties

- **Versioned.** Each file records its version in `paylink_migrations.applied`
  (own schema, so drizzle-kit — which manages only `public` — never sees it).
  0028 refuses to run before 0027.
- **One transaction each**, `ON_ERROR_STOP`, `lock_timeout = 5s`,
  `statement_timeout = 60s`. Any failure leaves the database exactly as it was.
- **Owner guard.** Refuses to run unless `current_user` owns
  `public.companies`, so the new tables cannot end up owned by a role the app
  cannot write as.
- **Rerunnable.** Rerun is a no-op. A pre-existing object of the same name with
  any other shape aborts with an explicit message naming the difference.
- **Locking.** 0028 adds FKs from two empty tables, which briefly takes a
  SHARE ROW EXCLUSIVE lock on `companies` (blocks writes to companies, not
  reads). If a long transaction holds a conflicting lock, it fails after 5 s
  instead of queueing.

## Procedure (needs Global Admin approval; not executed)

1. **Rehearse** on an isolated, network-isolated restore of the latest verified
   backup, with the restored objects owned by a role that stands in for the app
   owner:
   - confirm the three tables and the enum are absent;
   - run the DB test against it (it reproduces the failures first, then applies
     both files twice, then exercises provisioning, admin suspension, billing
     reactivation and isolation):
     `TEST_DATABASE_URL='<restore URL, with options=-c role=<owner>>' npx tsx tests/schema-readiness-0027-0028-db.test.ts`
   - `pg_dump --schema-only` before and after; the diff must contain only the
     new schema, enum, tables, primary keys and two FKs.
2. **Back up**: fresh verified pre-migration backup (record sha256).
3. **Apply** as the app table owner:
   ```
   psql '<app DATABASE_URL>' -X -v ON_ERROR_STOP=1 -f migrations/0027_tenant_provisioning_audit_logs.sql
   psql '<app DATABASE_URL>' -X -v ON_ERROR_STOP=1 -f migrations/0028_tenant_provisioning_gates_and_projects.sql
   ```
   No restart is needed; the app does not cache table existence.
4. **Verify**:
   ```sql
   SELECT version, applied_at, applied_by FROM paylink_migrations.applied ORDER BY version;  -- 0027, 0028
   SELECT to_regclass('public.tenant_provisioning_audit_logs'), to_regclass('public.tenant_commercial_gates'),
          to_regclass('public.tenant_implementation_projects'), to_regtype('public.tenant_lifecycle_state');
   SELECT tablename, tableowner FROM pg_tables WHERE tablename IN
     ('tenant_provisioning_audit_logs','tenant_commercial_gates','tenant_implementation_projects');  -- app owner
   ```
   Existing row counts of `companies`, `tenants`, `tenant_companies`,
   `authorization_audit_log` are unchanged.

## Failure and recovery

| Failure (message) | State after | Recovery |
|---|---|---|
| `run as the app table owner (…), not …` | nothing created | Reconnect as the owner (or `SET ROLE` to it) and rerun |
| `apply 0027 first` | nothing created | Apply 0027, then 0028 |
| `… exists with an unexpected shape: …` | nothing created; the existing table and its rows untouched | Compare with `shared/schema.ts`. If only columns are missing, add them (`ALTER TABLE … ADD COLUMN`, additive) and rerun. Anything else: stop and escalate; do not drop or rename |
| `tenant_lifecycle_state exists with unexpected labels` | nothing created by 0028 | Add the missing labels with `ALTER TYPE … ADD VALUE` (additive, in schema order) and rerun; never remove labels |
| `canceling statement due to lock timeout` | nothing created by 0028 | Find the long transaction holding `companies`; rerun when it ends |
| Connection lost mid-file | transaction rolled back | Verify with step 4; rerun |

All rows except the last were exercised on a disposable production-shaped
database (the last follows from each file being a single transaction).

**Rollback.** None needed for the schema: the objects are empty and unused by
the previous release, so a release rollback leaves them in place. `DROP` is not
permitted (AGENTS.md). If a migration must be undone entirely, restore the
pre-migration backup (Global Admin decision).

## Not covered here (separate, reviewed changes)

- `integration_events`, `company_webhook_configs` — integration outbox and
  per-company webhook secrets; their writers swallow errors today.
- `permissions`, `permission_groups`, `user_permission_overrides`,
  `enterprise_role_permissions`, `employee_manager_relations`,
  `user_company_access`, `locations`, `teams`, `platform_modules`,
  `device_tokens` — authorization and org-hierarchy tables; they need their own
  audit (and seed data) before creation.
- Missing columns on existing tables (onboarding packet steps, portal access
  tokens, worker agreements/onboarding, document versions) and FK drift
  (`tenant_companies.company_id` FK is gated separately).
