---
name: Contractor invoice Stripe payment reconciliation
description: How online Stripe Checkout payments for Contractor Hub invoices get reconciled, and the idempotency contract.
---

# Contractor invoice Stripe reconciliation path

Contractor Hub invoices can be paid online via Stripe Checkout. The checkout session is created with `metadata.invoiceId`. Reconciliation happens in the Stripe webhook (`/api/stripe/webhook` in `server/index.ts`) on the `checkout.session.completed` event, which dynamic-imports and calls `reconcileContractorInvoiceStripePayment(session)` (module-level export in `server/routes.ts`).

That helper: inserts a `contractor_payments` row, advances the invoice (`amount_paid`/`balance_due`/`status`/`paid_at`), archives the paid invoice PDF to Business Documents (DAM) via `generateInvoicePdf`, writes an audit entry, and notifies the contractor.

**Why (idempotency):** Stripe redelivers webhooks. The helper is keyed off the Stripe reference (`payment_intent` || session `id`) and is a no-op if a `contractor_payments` row already exists with that `reference_number`/`external_payment_id`. Any new payment-recording path must preserve this dedup or duplicate payments will be created on redelivery.

**Webhook context gotcha:** there is no logged-in user in a webhook. Pass `null` (not a sentinel string) for `dam_documents.uploaded_by_user_id` — that column **has an FK to `users(id)`** (nullable). Use sentinel strings only for `authorization_audit_log.actor_user_id`, which has no FK.
