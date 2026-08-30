/**
 * Vendor/expense Cut Check payment lifecycle — pure helpers (Release B2).
 *
 * No DB, no Express, no side effects. Reuses the money + idempotency primitives
 * from ./contractor-payments so both ledgers share one cents/fingerprint model.
 * B2 is check-only (ACH / electronic bill payment are out of scope).
 */
import crypto from "node:crypto";

export {
  toCents, fromCents, checkPaymentAmount, requireIdempotencyKey,
  externalSettlementDisclaimer, isUniqueConstraintViolation,
} from "./contractor-payments";

/** Partial unique indexes (mirrored in migrations/0017 + server/index.ts boot DDL). */
export const EXPENSE_PAYMENT_IDEMPOTENCY_INDEX = "uq_expense_payments_company_idempotency_key";
export const EXPENSE_CHECK_NUMBER_INDEX = "uq_expense_payments_funding_check_number";

/** Vendor/expense checks are the only issuance method in B2. */
export const EXPENSE_PAYMENT_METHOD = "check" as const;
export type ExpensePaymentMethod = typeof EXPENSE_PAYMENT_METHOD;

/** A vendor/expense check reverses only MyPayLink's internal record; the paper check may need a bank stop-payment. */
export const EXPENSE_VOID_STOP_PAYMENT_NOTE =
  "MyPayLink has reversed its internal accounting record for this check. If the paper check was already printed or mailed, place a stop-payment with your bank — MyPayLink cannot recall it.";

export type ExpensePaymentStatus = "unpaid" | "partially_paid" | "paid";

/**
 * Recompute an expense's payment status from the authoritative ledger sum.
 *   fully covered              -> "paid"
 *   some paid, some due         -> "partially_paid"
 *   nothing paid / reversed to 0 -> "unpaid"
 */
export function recomputeExpensePaymentStatus(totalCents: number, paidCents: number): ExpensePaymentStatus {
  if (paidCents >= totalCents) return "paid";
  if (paidCents > 0) return "partially_paid";
  return "unpaid";
}

export interface ExpensePaymentFingerprintInput {
  companyId: string | null | undefined;
  expenseId: string;
  amountCents: number;
  method: string;
  fundingAccountId: string | null | undefined;
  payeeName: string | null | undefined;
}

/**
 * Stable fingerprint of the financial identity of an expense-check request.
 * Never includes the post-payment balance — a replay after the balance drops to
 * zero must still match the same key.
 */
export function expensePaymentFingerprint(input: ExpensePaymentFingerprintInput): string {
  const canonical = JSON.stringify([
    String(input.companyId ?? ""),
    String(input.expenseId),
    Math.round(input.amountCents),
    String(input.method),
    String(input.fundingAccountId ?? ""),
    String(input.payeeName ?? "").trim().toLowerCase(),
  ]);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export type ExpenseEligibility =
  | { ok: true; payeeName: string }
  | { ok: false; code: string; message: string };

export interface ExpenseForCutCheck {
  companyId: string | null;
  status: string | null;
  paymentStatus: string | null;
  vendor: string | null;
  payeeName: string | null;
  isArchived?: boolean | null;
  archivedAt?: Date | string | null;
  amount: string | number | null;
}

/**
 * A vendor/expense is Cut-Check-eligible only when it belongs to the acting
 * company, has a vendor/payee, is approved, is not rejected/deleted/archived/
 * voided, and is not already fully paid. Balance and role checks happen in the
 * locked transaction / route.
 */
export function checkExpenseEligibility(
  expense: ExpenseForCutCheck | null | undefined,
  ctx: { companyId: string | null | undefined },
): ExpenseEligibility {
  if (!expense) return { ok: false, code: "EXPENSE_NOT_FOUND", message: "Expense not found." };
  if (!expense.companyId || expense.companyId !== ctx.companyId) {
    return { ok: false, code: "EXPENSE_CROSS_COMPANY", message: "This expense belongs to a different company." };
  }
  const payeeName = String(expense.payeeName || expense.vendor || "").trim();
  if (!payeeName) {
    return { ok: false, code: "EXPENSE_NO_VENDOR", message: "This expense has no assigned vendor / payee." };
  }
  const status = String(expense.status ?? "").toLowerCase();
  if (status !== "approved") {
    return { ok: false, code: "EXPENSE_NOT_APPROVED", message: `Only approved expenses can be paid by check (status is "${expense.status}").` };
  }
  if (["rejected", "deleted", "voided", "void"].includes(status)) {
    return { ok: false, code: "EXPENSE_NOT_PAYABLE", message: `Expense status "${expense.status}" cannot be paid.` };
  }
  if (expense.isArchived || expense.archivedAt) {
    return { ok: false, code: "EXPENSE_ARCHIVED", message: "This expense is archived." };
  }
  if (String(expense.paymentStatus ?? "").toLowerCase() === "paid") {
    return { ok: false, code: "EXPENSE_ALREADY_PAID", message: "This expense is already fully paid." };
  }
  return { ok: true, payeeName };
}
