---
name: Contractor Hub action endpoint authorization
description: Enterprise-aware company access check for proposal action endpoints (accept, reject, request-revision, etc.)
---

## Rule
All proposal action endpoints (accept, request-signature, reject, request-revision, convert-to-invoice, counteroffer) must use `canAccessCompany(userCompanyId, targetCompanyId)` instead of a simple `===` equality check against `proposal.company_id`.

## Why
The proposals GET list uses an enterprise-aware filter — admins of Company A can see proposals from Company B when both share the same `enterprise_id`. Without the same widening on action endpoints, enterprise admins got 403 "Forbidden" when trying to approve/reject any proposal that belonged to a sibling company. This was a silent mismatch between what the list showed and what the user could act on.

## How to apply
The helper `canAccessCompany(userCompanyId, targetCompanyId)` is defined at module scope in `server/routes.ts`. Use it any time a proposal/contract/invoice action endpoint checks company ownership for a tenant-scoped user:

```typescript
const isPlatformUser = !user?.companyId;
if (!isPlatformUser && !(await canAccessCompany(user!.companyId!, proposal.company_id)))
  return res.status(403).json({ message: "Forbidden" });
```

Platform users (role starts with `platform_`) bypass this check entirely via the `isPlatformUser` flag.

## Note
Line ~11892 (share-token generation endpoint) still uses the old pattern with different variable names (`isPlatform` / `user.companyId`) — lower risk but should be updated for consistency.
