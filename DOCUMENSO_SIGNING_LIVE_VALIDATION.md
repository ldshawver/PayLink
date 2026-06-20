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
