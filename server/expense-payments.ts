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
import { toCents, fromCents } from "./contractor-payments";

/** Partial unique indexes (mirrored in migrations/0017 + 0018 + server/index.ts boot DDL). */
export const EXPENSE_PAYMENT_IDEMPOTENCY_INDEX = "uq_expense_payments_company_idempotency_key";
export const EXPENSE_CHECK_NUMBER_INDEX = "uq_expense_payments_funding_check_number";
export const EXPENSE_TRADE_COMP_EXPENSE_PAYMENT_INDEX = "uq_contractor_trade_comp_expense_payment_id";

/**
 * B2 shipped check-only; this constant is retained for the Cut Check path and
 * for callers/tests that still name the single issuance method explicitly.
 */
export const EXPENSE_PAYMENT_METHOD = "check" as const;

/**
 * All methods the expense/AP payment UI may record against the `expense_payments`
 * ledger (migration 0018). Historical free-text values are never rewritten — only
 * new writes are validated. `check` is issued via /cut-check; the rest via
 * /record-payment.
 */
export const EXPENSE_PAYMENT_METHODS = ["check", "cash", "ach", "trade_credit", "rent_credit", "other"] as const;
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];

/** Non-check methods recorded through POST /api/expenses/:id/record-payment. */
export const EXPENSE_RECORD_PAYMENT_METHODS = ["cash", "ach", "trade_credit", "rent_credit", "other"] as const;

/** Methods that require a free-text description on the payment. */
export const EXPENSE_DESCRIPTION_REQUIRED_METHODS: ReadonlySet<string> = new Set(["trade_credit", "rent_credit", "other"]);

export function normalizeExpensePaymentMethod(raw: unknown): ExpensePaymentMethod | null {
  const v = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (EXPENSE_PAYMENT_METHODS as readonly string[]).includes(v) ? (v as ExpensePaymentMethod) : null;
}

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
  /** Present only for trade_credit payments (migration 0018); appended so a check fingerprint is unchanged. */
  tradeCompensationId?: string | null;
}

/**
 * Stable fingerprint of the financial identity of an expense payment request.
 * Never includes the post-payment balance — a replay after the balance drops to
 * zero must still match the same key. `tradeCompensationId` is appended (not
 * inserted) so existing check fingerprints are byte-for-byte unchanged.
 */
export function expensePaymentFingerprint(input: ExpensePaymentFingerprintInput): string {
  const parts: unknown[] = [
    String(input.companyId ?? ""),
    String(input.expenseId),
    Math.round(input.amountCents),
    String(input.method),
    String(input.fundingAccountId ?? ""),
    String(input.payeeName ?? "").trim().toLowerCase(),
  ];
  if (input.tradeCompensationId) parts.push(String(input.tradeCompensationId));
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
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
  /**
   * When set, this expense mirrors a contractor invoice — it must be paid
   * through the contractor-invoice payment flow so the two ledgers never
   * double-count (spec Part B.4). Optional so existing callers are unaffected.
   */
  contractorInvoiceId?: string | null;
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
  if (expense.contractorInvoiceId) {
    return { ok: false, code: "EXPENSE_LINKED_TO_CONTRACTOR_INVOICE", message: "Pay this through the linked contractor invoice — not as a separate expense payment." };
  }
  const payeeName = String(expense.payeeName || expense.vendor || "").trim();
  if (!payeeName) {
    return { ok: false, code: "EXPENSE_NO_VENDOR", message: "This expense has no assigned vendor / payee." };
  }
  const status = String(expense.status ?? "").toLowerCase();
  if (status !== "approved") {
    return { ok: false, code: "EXPENSE_NOT_APPROVED", message: `Only approved expenses can be paid (status is "${expense.status}").` };
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

export interface ExpenseTradeCompensationRecord {
  id: string;
  companyId: string;
  contractorUserId: string;
  approvedAt: Date | string | null;
  valuationMethod: string | null;
  totalValue: string | number | null;
  contractorPaymentId: string | null;
  expensePaymentId: string | null;
}

export type ExpenseTradeCreditCheck =
  | { ok: true; appliedCents: number }
  | { ok: false; code: string; message: string };

/** The disabled reason the AP UI shows when no valuation can be tied to the expense. */
export const EXPENSE_TRADE_COMP_MISSING_REASON = "Missing approved trade/barter valuation";

/**
 * Prove the trade/barter valuation is auditable-linked to THIS AP expense.
 *
 * contractor_trade_compensation carries no expense_id / invoice_id / contract_id
 * / proposal_id, so the ONLY relationship the schema can prove for an AP expense
 * is that the valuation's contractor is the worker who submitted the expense
 * (contractor_trade_compensation.contractor_user_id === expenses.submitter_id).
 * An expense that is instead linked to a contractor invoice is already blocked
 * earlier (checkExpenseEligibility → EXPENSE_LINKED_TO_CONTRACTOR_INVOICE) and
 * must be paid through that invoice.
 *
 * A free-text payee / vendor name is NOT auditable — anyone can type a
 * contractor's name onto an unrelated expense — so it is never accepted as a
 * link. When the id link cannot be proven the caller rejects trade/barter for
 * the expense with EXPENSE_TRADE_COMP_MISSING_REASON; an unrelated approved
 * same-company valuation is never applicable.
 */
export function expenseTradeCompLinked(
  comp: Pick<ExpenseTradeCompensationRecord, "contractorUserId">,
  ctx: { expensePayeeWorkerId?: string | null },
): boolean {
  return Boolean(comp.contractorUserId && ctx.expensePayeeWorkerId && comp.contractorUserId === ctx.expensePayeeWorkerId);
}

/**
 * Validate that an approved fair-market-value trade-compensation record may be
 * applied, exactly once, to a trade/barter payment on this expense. Mirrors
 * checkTradeCreditApplicable on the contractor side, but the "already used"
 * guard covers BOTH ledgers so a credit can never be double-posted, and the
 * valuation must be provably tied to this expense's payee (expenseTradeCompLinked).
 */
export function checkExpenseTradeCreditApplicable(
  comp: ExpenseTradeCompensationRecord | null | undefined,
  ctx: {
    companyId: string | null | undefined;
    paymentCents: number;
    expensePayeeWorkerId?: string | null;
  },
): ExpenseTradeCreditCheck {
  if (!comp) return { ok: false, code: "TRADE_COMP_NOT_FOUND", message: `${EXPENSE_TRADE_COMP_MISSING_REASON}.` };
  if (comp.companyId !== ctx.companyId) {
    return { ok: false, code: "TRADE_COMP_CROSS_COMPANY", message: "The trade / barter valuation belongs to a different company." };
  }
  if (!expenseTradeCompLinked(comp, ctx)) {
    return {
      ok: false,
      code: "TRADE_COMP_UNRELATED",
      message: `${EXPENSE_TRADE_COMP_MISSING_REASON}. The selected valuation is not linked to this expense's payee.`,
    };
  }
  if (!comp.approvedAt) {
    return { ok: false, code: "TRADE_COMP_NOT_APPROVED", message: "The trade / barter valuation has not been approved." };
  }
  if (String(comp.valuationMethod ?? "").toLowerCase() !== "fair_market_value") {
    return { ok: false, code: "TRADE_COMP_NOT_FMV", message: "The trade / barter valuation is not valued at fair market value." };
  }
  if (comp.contractorPaymentId || comp.expensePaymentId) {
    return { ok: false, code: "TRADE_COMP_ALREADY_LINKED", message: "This trade / barter valuation is already linked to another payment." };
  }
  const availableCents = toCents(comp.totalValue);
  if (!Number.isFinite(availableCents) || availableCents <= 0) {
    return { ok: false, code: "TRADE_COMP_NO_VALUE", message: "The trade / barter valuation has no approved value." };
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
