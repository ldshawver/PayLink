---
name: Phase 3A Tenant Isolation
description: Key decisions and patterns from the four Phase 3A security fixes applied to canAccessCompany, privacy_audit_log, breach_incidents, and product_api_keys.
---

# Phase 3A Tenant Isolation Fixes

## canAccessCompany Enterprise Sibling Fix
**Rule:** Always JOIN `tenant_companies` on both sides of the enterprise sibling check. Deny if both companies are assigned to different tenants. Allow if either is unassigned (can't determine — Phase 2 compat).
**Why:** Without this check, Company A in Tenant 1 could access Company B in Tenant 2 if they shared an enterprise_id.
**How to apply:** Any new cross-company access path that checks enterprise siblings must include the tenant cross-check.

## privacy_audit_log and breach_incidents Column Split
**Rule:** Both tables now have TWO separate columns:
- `company_id` — the actual company that performed the action (use for filtering in company-scoped queries)
- `tenant_id` — the real tenant ID resolved via `getTenantIdForCompany()` (for cross-tenant platform admin queries)

Old code stored `user.companyId` in `tenant_id` — that was wrong and was backfilled in Phase 3A.
**Why:** They are different IDs. tenant_id is from the `tenants` table; company_id is from `companies`.
**How to apply:** All reads filtered by company scope must use `company_id = user.companyId`. Platform-wide reads can aggregate by `tenant_id`.

## writePrivacyAuditLog Helper (routes.ts)
- Accepts both `companyId` (preferred) and legacy `tenantId` (treated as companyId for compat)
- Internally resolves real tenant_id via `getTenantIdForCompany(effectiveCompanyId)` (cached 30s)
- Always pass `companyId: user.companyId` at call sites (NOT tenantId)

## product_api_keys Masking Pattern
**Rule:** pk_* keys (format `pk_${64 hex chars}`) are NEVER stored raw. Storage pattern:
- `key_hash`: SHA-256 of raw key
- `key_prefix`: first 8 chars (for display)
- `masked_key`: `${keyPrefix}...${rawKey.slice(-4)}` 
- `api_key`: NULL for pk_* keys; kept for JSON e-sign configs (DocuSign/Acrobat Sign)

**Why:** Raw secrets in DB = instant compromise on any read. JSON e-sign configs (docusign, acrobat_sign productName) store credential blobs in api_key — `getCompanyESignConfig()` parses them with JSON.parse. Don't hash/mask those.
**How to apply:** POST endpoint returns raw key ONCE in response body. GET strips api_key for hashed keys. Webhook auth uses `getProductApiKeyByHash()` first, falls back to raw match for legacy/JSON-config keys.
