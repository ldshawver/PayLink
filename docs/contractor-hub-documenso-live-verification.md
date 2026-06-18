# Contractor Hub Documenso Live Verification Runbook

Status: **CONDITIONAL PASS — Phase 1 only** until a live Documenso signing and demo-tenant archive flow are verified.

This runbook exists to prevent Phase 1 route/link and tenant-isolation work from being mistaken for production readiness.

## 1. VPS Environment Verification

Run this on the VPS or production-like host. Do not print secret values.

```bash
npx tsx scripts/verify-documenso-env.ts
```

Expected safe output:

- `MYPAYLINK_DOCUMENSO_API_KEY: PRESENT`
- `MYPAYLINK_DOCUMENSO_BASE_URL: PRESENT`
- `MYPAYLINK_DOCUMENSO_ENABLED: PRESENT`
- `MYPAYLINK_DOCUMENSO_BASE_URL_HOST: document.luxit.app`
- `Documenso environment verification passed without exposing secrets.`

## 2. Required Automated Checks

Run before and after live demo testing:

```bash
npm run check
git diff --check
npx tsx server/contract-signing-flow.test.ts
npx tsx server/document-hub-tenant-isolation.test.ts
```

## 3. Demo-Tenant Signing Test

Use a non-production demo tenant/company and non-sensitive demo signer email.

1. Create a contractor proposal.
2. Approve the proposal.
3. Generate a contract from the approved proposal.
4. Add the primary signer with email.
5. Send the contract via Documenso.
6. Confirm the signer receives the Documenso email.
7. Open the email link and confirm the signing page is not blank and does not 404.
8. Complete signing in Documenso.
9. Confirm the Documenso webhook updates the local contract and signer statuses.
10. Confirm the signed PDF is retrieved and stored locally.
11. Confirm the proposal-backed invoice is created exactly once.
12. Confirm the signed document appears in Document Hub.
13. Confirm audit records exist for signing and archive events.

## 4. Email Link Verification

Verify each link from a generated signing email:

- `/sign/contracts/:token` loads a valid public signing page.
- `/app/contractor-hub/contracts/:id/sign` loads a valid authenticated Contractor Hub signing page.
- No blank page.
- No 404.
- External signer token access does not require normal `user_company_access`.

## 5. Delegated Signer Verification

Verify these signer variants:

- Primary signer can sign.
- Additional delegated signer can sign.
- Replacement signer can sign after replacing the original signer.
- Invalid token is denied.
- Expired token is denied.

## 6. Document Hub Runtime Verification

Verify these Document Hub behaviors in the same demo tenant:

- Upload.
- View.
- Download.
- Print.
- Search.
- Metadata edit.
- Version history creation.
- Audit trail creation.
- Cross-company access denial.

## 7. Final Approval Rule

Final status must remain:

> CONDITIONAL PASS until live Documenso signing and demo tenant archive flow are verified.

Do not mark this production-ready until every checklist item above is completed with evidence from the configured VPS/demo environment.
