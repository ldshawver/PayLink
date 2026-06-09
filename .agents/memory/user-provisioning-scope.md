---
name: User provisioning & company-scoped CRUD must guard scope beyond requireRole
description: Why requireRole("admin") alone is insufficient on tenant-writable endpoints, and the systemic gap pattern found across org-hierarchy CRUD.
---

# Scope enforcement on admin endpoints

`requireRole("admin")` legacy-expands tenant_admin/tenant_owner into "admin"
(via expandRoleForGuard). So any endpoint that writes `role` or `companyId`
straight from `req.body` under only `requireRole("admin")` is exploitable by a
tenant admin: they can escalate to a platform role and/or act cross-tenant.

**Rule:** any endpoint a tenant actor can reach that writes `role`/`companyId`,
or mutates a company-scoped record by id, MUST additionally (a) block
platform/system role grants by non-platform users, and (b) verify the target
company via `canAccessCompany` (and explicitly reject `companyId: null` / a null
target company for tenant actors — `canAccessCompany(user, null)` returns true).

**Why:** the user-provisioning endpoints (POST/PATCH /api/users) shipped with
this exact hole — a CRITICAL privilege-escalation + cross-tenant vector. Fixed
with the pure decision module `server/auth/user-provisioning-guard.ts`
(`evaluateUserProvisioning`), wired into both handlers; platform users left
unchanged by design.

**Systemic gap (audited):** the same trust-req.body.companyId pattern recurs
across org-hierarchy CRUD. FIXED so far: POST /api/schedules (now uses pure
`evaluateScheduleAccess` in server/auth/schedule-access-guard.ts +
canAccessCompany). STILL OPEN (audited, not yet fixed):
enterprises/branches/divisions/cost-centers create/update trust req.body, plus
several GET list endpoints (enterprises/branches/divisions) return all rows with
no auth middleware or scope filter. Contrast: PATCH /api/schedules/:id and PATCH
/api/users/:id DO guard ownership, so the pattern to copy already exists in-repo.

**How to apply:** when adding/reviewing any company-scoped write endpoint, copy
the ownership-guard pattern (resolve requestor + target, call canAccessCompany)
rather than relying on the role gate alone.
