# Phase 0.5, Branch 2: `tenant_companies.tenant_id` FK Preflight

**Status:** Preflight and evidence gathering only. The FK migration is **prepared but NOT applied** to any real schema — see §7 for why, and what would need to happen before it could be.

**Baseline:** `origin/main` @ `8d3e262` ("Phase 0.5: close platform_support/platform_implementation admin-alias privilege escalation in expandRoleForGuard", #96).

**Scope, per `docs/saas-readiness/phase-0.5-security-convergence-report.md`, blocker #7 and "Branch 2 — Tenant-integrity FK preflight/migration":** `tenant_companies.tenant_id` (`shared/schema.ts:4690`) has no foreign-key constraint to `tenants.id`, unlike the adjacent `company_id`, which does (`.references(() => companies.id, { onDelete: "cascade" })`, `shared/schema.ts:4691`). The original review could not produce a real orphan count because it could not confidently identify which of the ambiguous local databases (`PayLinkapp`, `apppaylinkmain`, `apppaylinkstaging`, `paylink`, `paylink_hardening_*`) was safe to query without risking real data. This branch was explicitly instructed to use **only a disposable database and synthetic fixtures**, and to **not query or mutate staging/production tenant data** — so it does not resolve that ambiguity either. It instead answers everything that can be answered without touching real data, and hands off a ready-to-run, pre-tested tool for whoever has legitimate access to run the real check.

---

## 1. Lifecycle trace — every code path that writes `tenants` or `tenant_companies`

Exhaustive grep of `server/`, `scripts/`, and `migrations/` for `tenants`/`tenant_companies` reads and writes:

| Path | What it does | Transactional? | Orphan-safe? |
|---|---|---|---|
| `server/index.ts:3609-3630` — boot-time bootstrap | `CREATE TABLE IF NOT EXISTS` for both tables (idempotent), then seeds two `tenants` rows: **"Alavont Holding"** (slug `alavont-holding`, status `active`, notes "Primary production tenant") and **"Demo Tenant"** (slug `demo-tenant`, status `demo`), both `ON CONFLICT (slug) DO NOTHING` | N/A (DDL + idempotent seed) | Yes — creates no `tenant_companies` rows |
| `POST /api/trial/signup` (`server/routes.ts:24015-24102`) | Creates `companies`, `users`, `tenants`, and `tenant_companies` rows together | **Yes** — wrapped in `BEGIN`/`COMMIT`/`ROLLBACK` (`server/routes.ts:24058,24102-24104`) | Yes — tenant and its membership row are created atomically |
| `POST /api/tenants` (`server/routes.ts:31349-31371`, `requireSuperAdmin`) | Creates a `tenants` row only | N/A (single insert) | Yes — creates no `tenant_companies` row itself |
| `POST /api/tenants/:id/companies` (`server/routes.ts:31450-31466`, `requireSuperAdmin`) | `INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES (:id, companyId, ...) ON CONFLICT (tenant_id, company_id) DO UPDATE ...` | Single insert | **No — see §2, this is the orphan-creation vector.** `companyId` is validated implicitly (its own FK to `companies.id` throws `23503`, caught and reported as 400 "Company not found"); the URL's `:id` (`tenant_id`) is used with **no existence check at all**. |
| `DELETE /api/tenants/:id/companies/:companyId` (`server/routes.ts:31469-31489`, `requireSuperAdmin`) | Deletes one `tenant_companies` row by exact `(tenant_id, company_id)` tuple; 404s truthfully on no match (batch-5 fix, verified defect 9) | Single delete | Yes — never creates data |
| `PATCH /api/tenants/:id` (`server/routes.ts:31403-31447`) | Updates `tenants` status/metadata columns only | N/A | Yes — no `tenant_companies` writes |
| `GET /api/tenants`, `GET /api/tenants/:id`, `GET /api/provisioning/*` | Reads only | N/A | N/A |
| `server/tenant-context.ts:77-104` (`getTenantIdForCompany`) | `SELECT ... FROM tenant_companies tc JOIN tenants t ON t.id = tc.tenant_id WHERE tc.company_id = $1` — **INNER JOIN** | N/A (read) | **Fails safe**: an orphaned `tenant_companies` row (dangling `tenant_id`) is silently excluded by the join, so this lookup returns `null` (treated as "company has no tenant assigned") rather than erroring or leaking stale data. |
| `server/demo-seed.ts`, `server/provisioning/TenantProvisioningService.ts`, `server/workers/orchestrator.ts` | **Zero references** to `tenants` or `tenant_companies` (confirmed by grep) | — | — |

**No code path in this codebase deletes a `tenants` row.** There is no `DELETE /api/tenants/:id` route, and no script or worker issues `DELETE FROM tenants`. This matters directly for §3 (ON DELETE semantics): the CASCADE clause chosen there is currently inert in production — nothing exercises it today — it is chosen for schema correctness and consistency with `company_id`'s existing cascade, not because a deletion flow exists to trigger it.

**Related, but distinct, finding (not this FK's concern):** `server/demo-seed.ts`'s `provisionDemoTenant()` creates `companies` rows that are never linked into `tenant_companies` at all — a *company-with-no-tenant* gap, not a *tenant_companies-row-with-no-tenant* gap. This is the already-documented, separately-tracked T3/PT3 finding ("no company→tenant mapping tooling exists") in `gap-analysis.md` and is out of scope for this FK, which only constrains `tenant_companies.tenant_id`.

---

## 2. Orphan risk — one real, demonstrated vector; no others found in application code

**`POST /api/tenants/:id/companies` can create a dangling `tenant_companies` row today.** The route validates `companyId` (its FK throws `23503` on a bad id) but never checks that `req.params.id` (`tenant_id`) refers to a real tenant before inserting. This was reproduced empirically, not just read from source: `tests/tenant-companies-fk-preflight-db.test.ts` (disposable database, synthetic fixtures) logs in as a synthetic `platform_super_admin`, calls this route with a random, never-created tenant id, and confirms:

- The route returns **`201 Created`**, not 404.
- A `tenant_companies` row is actually written with a `tenant_id` that matches nothing in `tenants`.
- `scripts/tenant-companies-fk-preflight/check-orphans.ts` correctly detects exactly that one orphan and reports it non-clean.

This is gated by `requireSuperAdmin()` (not exploitable by a lower-privileged role), and its practical blast radius is limited by `getTenantIdForCompany`'s INNER JOIN (§1) silently treating the orphaned row as "no tenant" rather than surfacing bad data — so this is a **data-integrity gap, not an active security leak**. It is, however, a real and currently-unguarded way for a single mistyped tenant id (e.g. a stale id from a deleted browser tab, a copy-paste error) to leave permanent dead data behind, silently, with a 201 success response giving no indication anything is wrong.

**No other orphan-creation vector was found.** Trial signup is transactional (§1). Bootstrap seeding creates no `tenant_companies` rows. There is no tenant-deletion path to create orphans via a missing cascade. Demo provisioning never touches `tenant_companies` at all.

**Real (staging/production) orphan count: unknown — out of scope for this branch by explicit instruction.** `scripts/tenant-companies-fk-preflight/check-orphans.ts` is written, tested, and ready to answer this the moment someone with legitimate access and authorization runs it against the real target database (see §7).

---

## 3. ON DELETE semantics

**Recommendation: `ON DELETE CASCADE`**, matching the sibling `company_id` FK (`shared/schema.ts:4691`) and the join-table semantics of `tenant_companies` — a membership row has no independent meaning once its tenant is gone.

This was verified empirically in the disposable database: deleting a synthetic `tenants` row cascade-removed its `tenant_companies` row and left the referenced `companies` row completely untouched (the cascade is scoped to the join table only, never to `companies`).

As noted in §1, this clause is not exercised by any current application code path (no tenant-deletion route exists), so this choice is about schema correctness and future-proofing, not a behavior change to anything live today.

---

## 4. Type compatibility

Confirmed both in source and against the live disposable database's `information_schema`: `tenant_companies.tenant_id` and `tenants.id` are both `character varying` (`varchar`) with no length modifier — directly compatible, no cast or migration-of-data needed before the FK can be added.

---

## 5. Production-tenant preservation and the internal/complimentary subscription model

- **This FK migration never deletes, modifies, or reads any `tenants` or `companies` row's content** — it only adds a referential-integrity check on `tenant_companies.tenant_id`. Applying it (once a clean real orphan check authorizes doing so) cannot itself alter "Alavont Holding," "Demo Tenant," or any other existing tenant or company row.
- **The internal/complimentary subscription model does not exist yet** (`docs/saas-readiness/gap-analysis.md` PT1, `architecture.md §15`: `grep` for `billing_mode`/`is_internal`/`internal_subscription`/`complimentary` in `shared/schema.ts` → zero hits; scoped to Phase 1h, not Phase 0.5). There is nothing in the current schema for this migration to "preserve" in the sense of existing columns or constraints — the applicable constraint is *forward-looking*: this FK preflight introduces no hardcoded identification of "Alavont Holding" or any other tenant by id, name, or slug, so it does not foreclose or complicate that future model's design. `migration.sql` and `check-orphans.ts` are both fully generic — they operate on the `tenant_id`/`tenants.id` relationship structurally, with no tenant-specific logic anywhere.

---

## 6. Evidence gathered (disposable database, synthetic fixtures only)

`tests/tenant-companies-fk-preflight-db.test.ts` — 18/18 checks pass. It boots the real, unmodified application server against a disposable Postgres database and empirically proves, in order:

1. Clean fixtures start with zero orphans.
2. `POST /api/tenants/:id/companies` with a nonexistent tenant id returns 201 and writes a dangling row (§2's vector, reproduced live).
3. `check-orphans.ts` detects that orphan (non-zero exit, correct count, correct id printed).
4. `migration.sql` is **refused by Postgres itself** while the orphan exists — fails atomically, leaves no partial constraint, and does not touch the orphaned row (i.e., the safety net is real, not just documentation).
5. Once the orphan is resolved, `check-orphans.ts` reports clean.
6. `migration.sql` applies cleanly against an orphan-free table.
7. `validate.ts` confirms the constraint's exact shape (`FOREIGN KEY tenant_id -> tenants.id`, `ON DELETE CASCADE`) and confirms the migration changed zero existing rows (purely additive).
8. The `ON DELETE CASCADE` actually cascades (deleting a tenant removes its `tenant_companies` row; the referenced company is untouched).
9. `rollback.sql` fully reverses the migration — constraint gone, zero data changed.

A schema-drift note surfaced while building this test (documented in the test file's own comments, and the same class as two pre-existing, already-documented-and-not-fixed bugs from PR #96 — `companies.status`, `feature_registry.key`): `tenant_companies`'s `UNIQUE(tenant_id, company_id)` constraint is declared only in `server/index.ts`'s bootstrap SQL (`server/index.ts:3623-3630`), never in `shared/schema.ts`, so a database built via `drizzle-kit push` (as the disposable test database is) lacks it, and `POST /api/tenants/:id/companies`'s `ON CONFLICT (tenant_id, company_id)` clause 500s until it's added. The test works around this identically to how `tests/cross-tenant-batch-5-routes-db.test.ts` worked around the equivalent gap for `feature_overrides` — a disposable-database-only `ALTER TABLE ... ADD CONSTRAINT`, not an application-code change. **Not fixed here** — out of scope for this branch, per instruction.

---

## 7. Verdict: the FK migration is prepared, NOT authorized to run yet

Per the original convergence report's own acceptance criterion for this branch: *"orphan count is 0 (or every orphan is explicitly triaged and resolved) before the constraint lands."* That criterion can only be evaluated against the real (staging/production) database, and this branch was explicitly instructed not to query or mutate staging/production tenant data. **The evidence available to this branch is therefore necessarily incomplete for authorizing a real-database migration, and none was attempted.** `shared/schema.ts` has deliberately **not** been changed — the FK is not wired into the app's live schema, `drizzle-kit push`, or any automatic migration path.

**What exists, ready to run, once someone with legitimate production access picks this up:**

1. `scripts/tenant-companies-fk-preflight/check-orphans.ts` — run it first, read-only, against the real target database (`FORCE_REAL_DB=1 DATABASE_URL=... npx tsx scripts/tenant-companies-fk-preflight/check-orphans.ts`). If it reports 0 orphans and 0 NULLs, proceed. If not, resolve every reported row first (it prints `tenant_id`/`company_id`/`created_at` for each, enough to triage without any other tool).
2. `scripts/tenant-companies-fk-preflight/migration.sql` — apply only after step 1 is clean. It is additive and safe: Postgres itself refuses it if any orphan slipped in between the check and the apply (demonstrated in §6, item 4).
3. `scripts/tenant-companies-fk-preflight/validate.ts` — confirm the constraint's shape and that the migration changed zero rows.
4. `scripts/tenant-companies-fk-preflight/rollback.sql` — available and dry-run-verified if the constraint ever needs to come back out.

**Recommended, but not implemented in this branch** (would require touching `server/routes.ts`, out of this preflight's scope): add an explicit tenant-existence check to `POST /api/tenants/:id/companies` (`server/routes.ts:31450`) before the insert, so a stale/mistyped tenant id 404s instead of silently creating new dangling data — this closes the vector at the application layer in addition to the database-layer FK, and should probably land in the same PR that actually applies the FK.

---

## 8. Explicitly out of scope for this branch (per instruction, unchanged)

- `GET /api/tenants/:id` 500s for every caller (`companies.status` column doesn't exist) — pre-existing, documented in PR #96, not touched here.
- `GET /api/debug/permissions/me` 500s for every caller (`feature_registry.key` should be `feature_key`) — pre-existing, documented in PR #96, not touched here.
- The `tenant_companies` `UNIQUE(tenant_id, company_id)` schema-drift gap (§6) — documented, worked around in test infrastructure only, not repaired in application code.
- Adding the app-level tenant-existence check to `POST /api/tenants/:id/companies` (§7) — recommended, not implemented.
- Any query against, or mutation of, staging or production tenant data — none was performed.
