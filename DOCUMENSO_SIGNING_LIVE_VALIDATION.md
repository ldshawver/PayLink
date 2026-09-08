# Documenso Contract Signing Live Validation Runbook

Use this runbook before marking the Documenso signing-link fix production-ready. The repository is a single-package pnpm app named `rest-express`; it is not a pnpm workspace with `@workspace/api-server` or `@workspace/platform` packages. As a result, these ticket-supplied commands do not match this repository and will report no matching projects:

```bash
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/platform typecheck
pnpm --filter @workspace/api-server test -- --runInBand
```

Use the repository-local validation commands instead:

```bash
pnpm typecheck
pnpm exec tsx tests/contract-signing-redirect-static.test.ts
pnpm exec tsx tests/contract-documenso-static.test.ts
pnpm exec tsx tests/contract-signer-management-static.test.ts
```

`pnpm lint:ratchet` is also not currently defined in `package.json`; add that script before requiring it as a release gate.


## GitHub Actions deployment validation

This fix is not complete until the normal GitHub Actions deployment workflow succeeds for the merge commit containing the signing-link fixes. The deployment workflow must show successful install, typecheck, signing-route regression tests, build, deployment, public health check, production smoke tests, and artifact upload.

After deployment, confirm the workflow artifacts include:

- `deployment-manifest.json`
- `documenso-signing-smoke-report.txt`

Artifacts are retained for 30 days by `.github/workflows/deploy-app.yml`.

The production smoke test calls `GET /api/version` and compares the returned `commit` to the deployed GitHub SHA. The production server should return the deployed commit or a newer commit from the same fix line.

## Required live CloudPanel/VPS checks

Run these checks on the MyPayLink CloudPanel Ubuntu 24.04 VPS, not on the LUXit VPS and not on the Debian 13 Documenso host except for Documenso provider inspection.

### 1. Confirm latest build is deployed

```bash
cd /home/paylinkssh/paylink-app/PayLink
git rev-parse --short HEAD
git log -1 --oneline
pnpm typecheck
```

The deployed commit must include the signing fallback commit or a later commit containing the same changes.

### 2. Confirm nginx routes both domains to the app

```bash
sudo nginx -T | sed -n '/server_name mypaylink.app app.mypaylink.app/,/}/p'
sudo nginx -t
```

Expected: `mypaylink.app` and `app.mypaylink.app` are in the HTTPS app server block and proxy to `127.0.0.1:8000`.

### 3. Verify SPA fallback for signing routes

```bash
curl -I https://app.mypaylink.app/app/contractor-hub/contracts/735551c2-ec6c-41e6-976d-1eef4e13bfa5/sign
curl -I https://mypaylink.app/app/contractor-hub/contracts/not-a-valid-id/sign
curl -I https://mypaylink.app/sign/contracts/not-a-real-token
```

Expected: no raw nginx/Flask/Express `Not Found` page. App-shell routes under `/app/*` and `/sign/*` should return or redirect to a controlled MyPayLink app page.

### 4. Check production logs for the affected path

```bash
sudo tail -n 500 /var/log/nginx/access.log | grep '735551c2-ec6c-41e6-976d-1eef4e13bfa5/sign'
sudo tail -n 500 /var/log/nginx/error.log | grep '735551c2-ec6c-41e6-976d-1eef4e13bfa5/sign' || true
pm2 logs --lines 500 | grep '735551c2-ec6c-41e6-976d-1eef4e13bfa5/sign' || true
```

Expected: current requests are served by the MyPayLink app/nginx proxy path and do not produce raw 404 responses.

### 5. Check production DB for affected contract and Documenso metadata

Run read-only SQL only:

```sql
SELECT id, company_id, contractor_id, status, title, fully_signed_at, proposal_id, converted_to_invoice_id
FROM contractor_contracts
WHERE id = '735551c2-ec6c-41e6-976d-1eef4e13bfa5';

SELECT id, contract_id, company_id, contractor_id, name, email, status, signed_at, signing_token_expires_at
FROM contract_signers
WHERE contract_id = '735551c2-ec6c-41e6-976d-1eef4e13bfa5'
ORDER BY COALESCE(signing_order, "order", 1), created_at;

SELECT id, company_id, related_record_id, documenso_document_id, status, signer_email, sent_at, raw_response
FROM documenso_signature_requests
WHERE document_type = 'contract'
  AND related_record_id = '735551c2-ec6c-41e6-976d-1eef4e13bfa5'
ORDER BY created_at DESC;
```

Expected: contract and signer status are tenant/company scoped, the Documenso document id is present when sent via Documenso, and the generated return URL targets `/app/contractor-hub/contracts/:id/sign`.

### 6. Confirm completion lifecycle

Verify whether Documenso is configured to email completed agreements to all signers. If Documenso does not send completion emails in this integration, implement MyPayLink completion emails before closing the ticket.

Read-only checks for existing filing/audit evidence:

```sql
SELECT id, company_id, document_type, status, title, file_url, metadata, tags, created_at
FROM dam_documents
WHERE company_id = '<company_id_from_contract>'
  AND (
    metadata::text ILIKE '%735551c2-ec6c-41e6-976d-1eef4e13bfa5%'
    OR title ILIKE '%735551c2-ec6c-41e6-976d-1eef4e13bfa5%'
  )
ORDER BY created_at DESC;

SELECT id, company_id, action, details, created_at
FROM document_audit_logs
WHERE details ILIKE '%735551c2-ec6c-41e6-976d-1eef4e13bfa5%'
ORDER BY created_at DESC;
```

Expected for fully signed contracts: one filed signed agreement/reference, `document_type = contractor_contract_signed_agreement`, `status = signed_final`, linked company/contractor/contract/proposal/invoice metadata, and searchable tags. Replaying a Documenso completion webhook must not duplicate invoices, Document Hub records, or completion emails.

## Current status language

Until all live checks above pass, report this ticket as:

> Code-level partial fix complete. Production/live verification and completion lifecycle still required.

## 2026-08-11 — Sender resolution, signer-specific links, exactly-once invoice (branch `fix/documenso-contract-invoice-automation`)

Scope: Contractor Hub only (`server/contract-signing-flow.ts`, `server/routes.ts`, and their tests). No schema/migration changes.

Fixes confirmed or made in this pass:

1. **Sender resolution** — `resolveDocumensoSenderIdentity()` in `server/contract-signing-flow.ts` resolves worker → user → company, in that order, and never assumes the acting employee's email is a Documenso account. Initial send now fails closed (`400`) instead of sending under the generic "MyPayLink sender" fallback when no worker/user/company identity resolves. The reminder path (`sendContractSigningReminderNow`) previously sent no sender identity at all; it now uses the same resolver as initial send.
2. **Signer-specific links** — `findSignerSpecificDocumensoLink()` matches by Documenso recipient id first, then normalized email, and returns `null` (fail closed, no cross-signer fallback) on zero or ambiguous matches. Resend already used this correctly. **The reminder path was found sending every signer to the authenticated `/app/contractor-hub?section=contracts&id=...` route instead of that signer's own public Documenso signing URL — an unauthenticated-contractor-hits-authenticated-route bug matching exactly the failure mode this fix line exists to prevent.** Fixed: reminders now use `contract_signers.documenso_signing_url` for that specific signer row, or record a `missing_signer_specific_documenso_url` failure and skip sending rather than falling back.
3. **Exactly-one invoice** — all four invoice-creation call sites (orphan-invoice repair, public completion, authenticated completion, webhook completion) now route through one new helper, `autoCreateContractInvoiceExactlyOnce()` in `server/routes.ts`, which runs `SELECT ... FOR UPDATE` on the `contractor_proposals` row inside a single `db.transaction`, checks for an existing invoice by `contract_id OR proposal_id`, and only then inserts. Webhook completion calls this helper unconditionally on every completion event (not gated by a local "already fully signed" flag), so duplicate/replayed webhook deliveries are safe by construction rather than by a status check that could itself race. Webhook signature verification (`verifyWebhookSecret`) already ran before any event insert or mutation (`server/routes.ts` `/api/webhooks/documenso`, line ~25355) — confirmed, not modified.
4. **Report redaction** — `/api/app-doctor/diagnostics` already exposed only booleans (`signingUrlPresent`, `documentIdExists`, etc.) for Documenso state, never raw tokens or signing URLs — confirmed, not modified.

Static tests `tests/contract-documenso-static.test.ts` and `tests/contractor-lifecycle-audit-static.test.ts` asserted on exact pre-refactor source strings (e.g. `SELECT id FROM contractor_invoices`, the removed `!wasAlreadyFullySigned` invoice guard) and were updated to assert on the current, intentionally-changed behavior instead of being reverted.

Validation run from `/home/paylinkssh/paylink-worktrees/documenso-contract-invoice-automation` (branch `fix/documenso-contract-invoice-automation`):

```bash
npx tsx server/contract-signing-flow.test.ts
npx tsx tests/contract-signing-flow.test.ts
npx tsx tests/contract-documenso-static.test.ts
npx tsx tests/contractor-hub-lifecycle-static.test.ts
npx tsx tests/contractor-lifecycle-audit-static.test.ts
npx tsx tests/contract-signing-reminders-static.test.ts
npx tsx tests/documenso-resend-static.test.ts tests/documenso-resend-behavior.test.ts tests/documenso-resend-self-heal-static.test.ts tests/documenso-service.test.ts tests/documenso-incident-static.test.ts
npx tsx tests/contract-signature-actions.test.ts tests/contract-signer-management-static.test.ts tests/contract-signing-redirect-static.test.ts tests/proposal-contract-workflow-static.test.ts tests/public-contract-signing-static.test.ts tests/contractor-hub-documenso-button-static.test.ts tests/contract-email.test.ts
npx tsx server/__tests__/api-json-guard.test.ts   # CI's registered `test` job
git diff --check
pnpm typecheck   # tsc --project tsconfig.server.json
pnpm check       # tsc (full project)
pnpm build
```

All passed. `tests/contract-conversion-email.test.ts` could not run in this session — it requires a live `DATABASE_URL`/SMTP test environment not present outside the `paylinkssh` account's `/etc/paylink/*.env` files, and it does not touch any file in this diff; treat it as environment-blocked, not a regression, and re-run it on staging before sign-off.

## Versioning note found during this pass

`server/app-metadata.ts`'s `getAppVersion()` (used by `/health` and `/api/version`) reads `process.env.APP_VERSION`, which neither `.github/workflows/deploy-app.yml` (staging) nor `.github/workflows/deploy-production.yml` (production) ever sets — both only export `PAYLINK_COMMIT`/`PAYLINK_BUILD_TIME` (production also sets `PAYLINK_VERSION` from the release tag, which nothing currently reads for the health/version endpoints). Live `curl 127.0.0.1:{8000,8010,8020}/api/version` on 2026-08-11 confirms this: all three environments report `"version":"2.1.1","app_version":"2.1.1","commit":"unknown"` regardless of what's actually deployed. `scripts/deploy-paylink.sh` (the documented manual deploy path) already does this correctly — it sets `APP_VERSION="$PACKAGE_VERSION"` and validates the release tag matches `package.json` before deploying — but the live GitHub Actions workflows do not call that script and bypass this check. See the production report for the proposed minimum fix.

**Fixed in this pass (2026-08-12):** both `deploy-app.yml` and `deploy-production.yml` now compute `PACKAGE_VERSION=$(node -p "require('./package.json').version")` from the checked-out code and pass `APP_VERSION="$PACKAGE_VERSION"` to `pm2 start`. Production additionally aborts (`exit 1`) before any build/restart if `release_tag` doesn't match `v$PACKAGE_VERSION` (or `$PACKAGE_VERSION`), mirroring `scripts/deploy-paylink.sh`'s existing check. New static test: `tests/deploy-version-propagation-static.test.ts` (9 assertions, all passing) verifies this propagation and the ordering (version check before PM2 restart) on both workflow files. `PAYLINK_COMMIT` was already set correctly on every path and is unchanged. Not yet live-verified on staging/production — this is a workflow-file change, verify with `curl {staging,production}/api/version` after the next actual staging deploy.

## 2026-08-12 — Exactly-once invoice concurrency reconciliation

Reviewed (not newly changed) as part of pre-merge diligence on the four-call-site consolidation described above:

- **Locked row:** `SELECT * FROM contractor_proposals WHERE id = ... AND company_id = ... FOR UPDATE`, inside `autoCreateContractInvoiceExactlyOnce()` (`server/routes.ts`). The lock is on the `contractor_proposals` row referenced by the contract's `proposal_id`, not the contract row itself.
- **Same transaction/client:** yes — the lock, the `findExistingInvoice` lookup, the `contractor_invoices` INSERT, and the `markProposalConverted` UPDATE all run through the same `tx` handle from a single `db.transaction(async (tx) => { ... })` (Drizzle over `node-postgres`, one checked-out connection for the whole callback).
- **All four entry points call the helper:** confirmed by direct read of the diff — orphan-invoice repair (`server/routes.ts:11554`), public signer completion (`:14198`), authenticated completion (`:14542`), and Documenso webhook completion (`:25423`) all call `autoCreateContractInvoiceExactlyOnce(...)` and no longer contain their own inline invoice-creation logic.
- **Direct inserts remain outside the helper:** yes, two pre-existing ones, both unrelated to contract-completion automation and unchanged by this diff — `POST /api/contractor-proposals/:id/convert-to-invoice` (`server/routes.ts:~12563`) and `POST /api/contractor-invoices/from-proposal` (`server/routes.ts:~17006`). Both are admin/manager-only manual invoicing actions. Neither takes a `FOR UPDATE` lock; the `convert-to-invoice` endpoint does **not** check `proposal.converted_to_invoice_id` before inserting, so two rapid manual clicks (or a manual click racing the automatic webhook path) on the same proposal are not guaranteed exactly-once the way the four automatic paths are. This is a pre-existing gap, not introduced or worsened by this branch, and out of scope for this fix.
- **Uniqueness is application-level only:** there is no unique constraint or unique index on `contractor_invoices.contract_id` or `.proposal_id` (confirmed by reading `migrations/0000_org_hierarchy_permissions.sql` and `migrations/20260709_contractor_hub_document_lifecycle_repair.sql` — only a non-unique `(company_id, contract_id, created_at DESC)` index exists). Exactly-once currently depends entirely on the `FOR UPDATE` row lock plus the transactional check-then-insert pattern in the helper; there is no database-level backstop if a future code path bypasses the helper.
- **Insert failure after full signing:** the contract/proposal status mutation (`fully_signed`, `contract_signers.status = 'signed'`) happens in a separate statement outside the helper's transaction, so it is not rolled back by an invoice-insert failure. The invoice INSERT itself is inside the helper's transaction, so if it fails, the whole transaction (lock, insert, `markProposalConverted`) rolls back atomically — no partial invoice row and no proposal marked converted.
- **Retry without duplication:** a retry (replayed webhook, or another completion-path call) re-acquires the same `FOR UPDATE` lock, re-reads `proposal.converted_to_invoice_id` (still `NULL` after a rolled-back attempt) and `findExistingInvoice` (still empty after rollback), and proceeds to create exactly one invoice. If the prior attempt actually succeeded, `converted_to_invoice_id` is already set and `autoCreateProposalBackedInvoice` returns `null` immediately — no duplicate insert, no duplicate side effects (PDF archival is gated on the helper returning a truthy invoice).
- **Testing performed:** `tests/contract-signing-flow.test.ts` and `server/contract-signing-flow.test.ts` unit-test `autoCreateProposalBackedInvoice()`'s idempotency logic against an in-memory fake `deps` object with sequential (not concurrent) calls — this proves the logic is correct in isolation but does **not** exercise real Postgres locking, transaction isolation, or true concurrent requests.
- **Database-backed concurrency test:** not run. This session had access only to the shared `apppaylinkmain`/`apppaylinkstaging`/`paylink` Postgres databases on this host, none of which is a confirmed disposable/isolated test database — writing synthetic concurrent-completion test data into any of them was judged unsafe without explicit confirmation they're safe to mutate. Per instruction, this is **not** reported as validated:

  > Implementation reviewed; database-backed concurrent completion validation remains required on staging.

- **Also still required on staging:** `tests/contract-conversion-email.test.ts` (environment-blocked in this session, see above).
