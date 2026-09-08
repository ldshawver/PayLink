# MyOrder.fun Runtime Verification

Verification date: 2026-07-09.

## Finding

The expected MyOrder.fun runtime directories are not present in this checkout:

- `artifacts/api-server/src/routes/import.ts`
- `artifacts/api-server/src/routes/orders.ts`
- `artifacts/api-server/src/routes/shift-queue.ts`
- `artifacts/api-server/src/routes/shifts.ts`
- `artifacts/api-server/src/lib/*`
- `artifacts/platform/src/pages/*`
- `lib/db/src/schema/*`
- `lib/db/drizzle/*`

A repository search found no production API-server registration importing those route modules. Therefore the previous implementation created duplicate inactive files and could not be verified as production runtime code.

## Action taken

The inactive POS helper, route-wrapper, schema metadata, repair script, and tests added by the prior PR were removed. Do not merge a MyOrder.fun POS stabilization PR from this checkout until the real MyOrder.fun runtime source tree is present and the production API server imports the modified route modules.

## Required verification when the correct source tree is available

- Confirm the production API server imports the active `artifacts/api-server/src/routes/*` modules.
- Modify the existing active route handlers rather than creating duplicate route files.
- Add tests proving route registration imports those files and route handlers call stabilization logic.
- Validate import, Inventory/PAR, checkout, duplicate repair dry-run/confirm, order receipt, shift-start receipt, and shift-end receipt behavior in staging.
