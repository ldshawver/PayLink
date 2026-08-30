/**
 * Contractor-invoice payment lifecycle — pure helpers.
 *
 * No DB, no Express, no side effects. The route handler in server/routes.ts
 * loads records and runs the transaction (SELECT ... FOR UPDATE); this module
 * owns the rules so they can be unit-tested without a database:
 *   - the normalized payment-method allowlist (new writes only — historical
 *     free-text values are never rewritten)
 *   - invoice status recomputation from authoritative numeric values
 *   - the idempotency fingerprint
 *   - amount validation
 */
import crypto from "node:crypto";

export { isUniqueConstraintViolation } from "./contract-signing-flow";

/** Partial unique indexes (mirrored in migrations/0016 + server/index.ts boot DDL). */
export const CONTRACTOR_PAYMENT_IDEMPOTENCY_INDEX = "uq_contractor_payments_company_idempotency_key";
export const CONTRACTOR_TRADE_COMP_IDEMPOTENCY_INDEX = "uq_contractor_trade_comp_company_idempotency_key";

/** New-write payment methods. Historical rows may hold any free-text value; those are never reinterpreted. */
export const CONTRACTOR_PAYMENT_METHODS = ["cash", "ach", "check", "trade_credit", "rent_credit", "other"] as const;
export type ContractorPaymentMethod = (typeof CONTRACTOR_PAYMENT_METHODS)[number];

/** Methods that require a free-text description on the payment. */
export const DESCRIPTION_REQUIRED_METHODS: ReadonlySet<string> = new Set(["trade_credit", "rent_credit", "other"]);

/** Methods that move money outside MyPayLink — a void only reverses the internal accounting record. */
export const EXTERNAL_SETTLEMENT_METHODS: ReadonlySet<string> = new Set(["cash", "ach", "trade_credit", "rent_credit"]);

export function normalizeContractorPaymentMethod(raw: unknown): ContractorPaymentMethod | null {
  const v = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (CONTRACTOR_PAYMENT_METHODS as readonly string[]).includes(v) ? (v as ContractorPaymentMethod) : null;
}

/** Round to cents using integer math to avoid float drift. */
export function toCents(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export type AmountCheck =
  | { ok: true; cents: number }
  | { ok: false; code: "INVALID_AMOUNT" | "AMOUNT_EXCEEDS_BALANCE"; message: string };

/**
 * Reject zero, negative, non-finite, and balance-exceeding payments.
 * balanceDueCents is the authoritative remaining balance recomputed inside the
 * locked transaction (total - sum of non-void payments).
 */
export function checkPaymentAmount(rawAmount: unknown, balanceDueCents: number): AmountCheck {
  const cents = toCents(rawAmount);
  if (!Number.isFinite(cents) || cents <= 0) {
    return { ok: false, code: "INVALID_AMOUNT", message: "Payment amount must be a positive number." };
  }
  if (cents > balanceDueCents + 0 /* exact */) {
    return {
      ok: false,
      code: "AMOUNT_EXCEEDS_BALANCE",
      message: `Payment amount ($${fromCents(cents).toFixed(2)}) exceeds the remaining balance ($${fromCents(Math.max(0, balanceDueCents)).toFixed(2)}).`,
    };
  }
  return { ok: true, cents };
}

/**
 * Recompute an invoice's status from authoritative numeric values.
 *   fully covered           -> "paid"
 *   some paid, some due      -> "partially_paid"
 *   nothing paid (or reversed back to zero) -> "sent"
 * "draft"/"voided"/"rejected*" invoices are never reached here — the route
 * guards those before locking.
 */
export function recomputeInvoiceStatus(totalCents: number, amountPaidCents: number): "paid" | "partially_paid" | "sent" {
  if (amountPaidCents >= totalCents) return "paid";
  if (amountPaidCents > 0) return "partially_paid";
  return "sent";
}

export interface PaymentFingerprintInput {
  companyId: string | null | undefined;
  invoiceId: string;
  method: string;
  amountCents: number;
  tradeCompensationId?: string | null;
}

/**
 * Stable fingerprint of the financial identity of a payment request. Same
 * Idempotency-Key + same fingerprint => return the original result unchanged.
 * Same key + different fingerprint => 409 IDEMPOTENCY_KEY_REUSED.
 */
export function paymentFingerprint(input: PaymentFingerprintInput): string {
  const canonical = JSON.stringify([
    String(input.companyId ?? ""),
    String(input.invoiceId),
    String(input.method),
    Math.round(input.amountCents),
    input.tradeCompensationId ? String(input.tradeCompensationId) : null,
  ]);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/** Trim + require a non-empty Idempotency-Key for every financial POST. */
export function requireIdempotencyKey(raw: unknown): { ok: true; key: string } | { ok: false; message: string } {
  const key = String(raw ?? "").trim();
  if (!key) return { ok: false, message: "An Idempotency-Key header is required for this operation." };
  if (key.length > 255) return { ok: false, message: "Idempotency-Key is too long (max 255 characters)." };
  return { ok: true, key };
}

export interface TradeCompensationRecord {
  id: string;
  companyId: string;
  contractorUserId: string;
  approvedAt: Date | string | null;
  valuationMethod: string | null;
  totalValue: string | number | null;
  contractorPaymentId: string | null;
}

export type TradeCreditCheck =
  | { ok: true; appliedCents: number }
  | { ok: false; code: string; message: string };

/**
 * Validate that an approved fair-market-value trade-compensation record may be
 * applied, exactly once, to a payment on this invoice.
 */
export function checkTradeCreditApplicable(
  comp: TradeCompensationRecord | null | undefined,
  ctx: { companyId: string | null | undefined; contractorId: string | null | undefined; paymentCents: number },
): TradeCreditCheck {
  if (!comp) return { ok: false, code: "TRADE_COMP_NOT_FOUND", message: "The linked trade-compensation record was not found." };
  if (comp.companyId !== ctx.companyId) {
    return { ok: false, code: "TRADE_COMP_CROSS_COMPANY", message: "The trade-compensation record belongs to a different company." };
  }
  if (comp.contractorUserId !== ctx.contractorId) {
    return { ok: false, code: "TRADE_COMP_CONTRACTOR_MISMATCH", message: "The trade-compensation record belongs to a different contractor." };
  }
  if (!comp.approvedAt) {
    return { ok: false, code: "TRADE_COMP_NOT_APPROVED", message: "The trade-compensation record has not been approved." };
  }
  if (String(comp.valuationMethod ?? "").toLowerCase() !== "fair_market_value") {
    return { ok: false, code: "TRADE_COMP_NOT_FMV", message: "The trade-compensation record is not valued at fair market value." };
  }
  if (comp.contractorPaymentId) {
    return { ok: false, code: "TRADE_COMP_ALREADY_LINKED", message: "The trade-compensation record is already linked to another payment." };
  }
  const availableCents = toCents(comp.totalValue);
  if (!Number.isFinite(availableCents) || availableCents <= 0) {
    return { ok: false, code: "TRADE_COMP_NO_VALUE", message: "The trade-compensation record has no approved value." };
  }
  if (ctx.paymentCents > availableCents) {
    return {
      ok: false,
      code: "TRADE_COMP_VALUE_INSUFFICIENT",
      message: `The approved trade value ($${fromCents(availableCents).toFixed(2)}) does not cover this payment ($${fromCents(ctx.paymentCents).toFixed(2)}).`,
    };
  }
  return { ok: true, appliedCents: ctx.paymentCents };
}

export interface TradeCompFingerprintInput {
  companyId: string;
  contractorUserId: string;
  payrollItemId?: string | null;
  itemSku?: string | null;
  itemName?: string | null;
  totalValueCents: number;
}

/**
 * Fallback fingerprint for a trade-compensation post when the caller supplies no
 * Idempotency-Key. It intentionally includes the payroll item / SKU so that two
 * legitimately-distinct credits are not collapsed; when no such anchor exists the
 * caller MUST provide an explicit key.
 */
export function tradeCompFingerprint(input: TradeCompFingerprintInput): string {
  const canonical = JSON.stringify([
    String(input.companyId),
    String(input.contractorUserId),
    input.payrollItemId ? String(input.payrollItemId) : null,
    input.itemSku ? String(input.itemSku) : null,
    input.itemName ? String(input.itemName) : null,
    Math.round(input.totalValueCents),
  ]);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/** Human note added to a void when the method settles outside MyPayLink. */
export function externalSettlementDisclaimer(method: string): string | null {
  return EXTERNAL_SETTLEMENT_METHODS.has(method)
    ? "MyPayLink has reversed its internal accounting record for this payment. It does not reverse an external bank transfer or recover cash automatically."
    : null;
}
