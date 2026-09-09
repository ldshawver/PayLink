# Documenso proposal / signing repair

Fixes three defects in the contractor proposal → Documenso signing → status pipeline,
plus a diagnostic false-positive. Code-only, no schema change.

## 1. Proposal send returns 500 "Failed to send proposal"

`POST /api/contractor-proposals/:id/send` built its atomic status-transition guard as:

```
WHERE id = ${req.params.id} AND status = ANY(${PRE_SEND_STATUSES})
```

Drizzle binds a JS array as a single parameter, so this renders as
`status = ANY(($2, $3, $4))` — a **row constructor**, which Postgres rejects
(`op ANY/ALL (array) requires array on right side`). Every `/send` call threw,
and the route's `catch (e)` swallowed it with **no logging**, surfacing only a
generic 500. App Doctor saw it via the global 500-capture middleware with no
stack trace.

**Fix:** use `status IN (${sql.join(...)})` — expands to individual bound params
(the pattern already used by the proposal lifecycle filter, and documented at
that site). The `catch` now `console.error`s the real error.

Affected proposals (`draft`, no `share_token`, no `sent_at`) are unblocked by
the code fix alone — they can be re-sent. No data repair needed.

## 2. Recipient IDs dropped when persisting a Documenso envelope

`createDocumensoDocument` built `signingLinks` only from
`POST /envelope/distribute`'s `recipients`. When distribute returns recipients
without ids (or none at all), the recipient `id` — which MyPayLink persists as
`documenso_signature_requests.documenso_recipient_ids` and
`contract_signers.documenso_recipient_id`, and later uses to resync signer
status — was lost.

**Fix:** new pure helper `mergeDocumensoRecipientSources(distributed, created)`.
`POST /envelope/create` always returns recipients with their `id`; merge those in
(keyed by email) so the `id` is never dropped. `distribute` still wins for
`token` / `signingUrl`.

## 3. Signing status page renders blank

`/sign/contracts/<token>/status` is a public route (no auth gate) — and it had
**no error boundary**, so any render error or a post-deploy lazy-chunk-load
failure produced a blank page.

**Fixes:**
- Wrap the `/sign/contracts/` route in `<AppErrorBoundary area="public_contract_signing">`
  (auto-reloads on a stale chunk, reports other errors, shows a fallback).
- `contract-signing.tsx` now calls the `/status` API variant when the URL is a
  `/status` return, so the server runs its Documenso status sync before
  responding (fresh state, not "ready to sign" right after signing).
- Explicit non-blank renders for `documenso_unavailable` / `documenso_managed`,
  for any post-signing return that didn't resolve to a terminal state, and for
  any unrecognized state (never the misleading "type your signature" form).

## 4. Diagnostic false-positive: "recipient IDs missing"

`GET /api/app-doctor/diagnostics` counted **email-less** `contract_signers` rows
(the legacy "No email" placeholder) toward its recipient totals. Such a row can
never receive a `documenso_recipient_id`, so it forced `recipientIdsExist=false`
and a spurious `needs_repair / sync_recipients` flag on contracts whose real
recipients were fine (e.g. the reported contract `b8f5c606`, already
`fully_signed`).

**Fix:** the contract-signers join now requires `email IS NOT NULL AND btrim(email) <> ''`.

## Not touched

Production contract `b8f5c606` is not modified (its real recipients already have
ids; it is `fully_signed`). No `documenso_signature_requests` /
`contract_signers` rows are written, resent, voided, or deleted by this change.

## Tests

- `tests/documenso-recipient-merge.test.ts` (required) — the merge helper.
- `tests/documenso-proposal-signing-repair-static.test.ts` (required) — the SQL
  fix (with a drizzle-render regression witness), the catch logging, the merge
  wiring, the error-boundary + `/status` fetch, and the diagnostic exclusion.
- `tests/documenso-repair-diagnostic-db.test.ts` (db) — email-less signers
  excluded from the recipient count against real Postgres.
- `tests/contractor-proposal-identity-wiring-static.test.ts` — one assertion
  updated (it pinned the exact buggy `ANY(${...})` SQL).
