---
name: authorization_audit_log dual column conventions
description: The audit-log table is written two incompatible ways in this codebase; pick the right one to avoid silent column/FK mismatches.
---

# authorization_audit_log has TWO write conventions

The `authorization_audit_log` table is written two different ways depending on the call site:

1. **Typed path — `writeAuditLog()` helper** (module-level in `server/routes.ts`). Uses the Drizzle schema columns: `actor_user_id`, `target_user_id`, `target_resource`, `change_type`, `before_value`, `after_value`, `note`, `company_id`, `tenant_id`.
2. **Raw-SQL path** (scattered inline `db.execute` calls, e.g. invoice download/access-denied logging). Uses a *different* column set: `actor_id`, `action`, `resource_type`, `resource_id`, `metadata` (jsonb).

The physical table carries both column families (added incrementally via additive migrations), so both work — but they are NOT interchangeable. Mixing them (e.g. inserting `change_type` via the raw-SQL column list) will fail or write to the wrong columns.

**Why:** easy to copy the wrong INSERT pattern from a nearby endpoint and get a column-does-not-exist error or a half-empty row.

**How to apply:** for any new audit write, prefer `writeAuditLog()` (typed, canonical). `actor_user_id` is `NOT NULL` with **no FK**, so sentinel actors like `"stripe_webhook"` / `"system"` are safe there. Only use the raw `actor_id/action/...` shape when extending an endpoint that already uses it.
