/**
 * PayPal subscriptions charge (plan price × quantity). They do not support a
 * fixed base fee plus a per-seat price on one plan. A $1.00 plan whose
 * quantity is the monthly total in dollars charges exactly $29 + $4 × employees
 * and can be revised by changing the quantity when the roster changes.
 */
export const PAYPAL_BASE_CENTS = 2900;
export const PAYPAL_SEAT_CENTS = 400;
export const PAYPAL_UNIT_CENTS = 100;

export function monthlyTotalCents(activeEmployees: number): number {
  const seats = Number.isFinite(activeEmployees) ? Math.max(0, Math.floor(activeEmployees)) : 0;
  return PAYPAL_BASE_CENTS + PAYPAL_SEAT_CENTS * seats;
}

/** Quantity sent to PayPal. One unit is one dollar of the monthly bill. */
export function paypalQuantity(activeEmployees: number): string {
  return String(monthlyTotalCents(activeEmployees) / PAYPAL_UNIT_CENTS);
}

export type PaypalBillingSignal = "active_paid" | "past_due" | "grace_period" | "suspended" | "cancelled";

/**
 * Maps a verified PayPal webhook onto the subscription states this app already
 * uses. Unknown events are ignored. Payment failure enters grace_period, the
 * same state Stripe payment failures use; an explicit PAST_DUE resource status
 * maps to past_due.
 */
export function mapPaypalEvent(eventType: string, resourceStatus?: string | null): PaypalBillingSignal | null {
  const type = eventType.trim().toUpperCase();
  const status = (resourceStatus || "").trim().toUpperCase();
  if (type === "BILLING.SUBSCRIPTION.PAYMENT.FAILED") return "grace_period";
  if (status === "PAST_DUE") return "past_due";
  if (
    type === "BILLING.SUBSCRIPTION.CANCELLED" ||
    type === "BILLING.SUBSCRIPTION.EXPIRED" ||
    status === "CANCELLED" ||
    status === "EXPIRED"
  ) {
    return "cancelled";
  }
  if (type === "BILLING.SUBSCRIPTION.SUSPENDED" || status === "SUSPENDED") return "suspended";
  if (
    type === "BILLING.SUBSCRIPTION.ACTIVATED" ||
    type === "BILLING.SUBSCRIPTION.RE-ACTIVATED" ||
    type === "PAYMENT.SALE.COMPLETED" ||
    status === "ACTIVE"
  ) {
    return "active_paid";
  }
  return null;
}
