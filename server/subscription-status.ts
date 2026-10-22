// P0-D: single place that normalizes companies.subscription_status spellings
// for enforcement. Both "cancelled" (written by the platform console, license
// service and gate override) and "canceled" (Stripe's spelling, legacy rows)
// exist in data; every enforcement check must treat them identically.

export const CANCELLED_SUBSCRIPTION_STATUS = "cancelled";

// Every stored spelling of the cancelled state. SQL guards that cannot call
// normalizeSubscriptionStatus() must list all of these.
export const CANCELLED_SUBSCRIPTION_STATUS_SPELLINGS = ["cancelled", "canceled"] as const;

export function normalizeSubscriptionStatus(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toLowerCase();
  return (CANCELLED_SUBSCRIPTION_STATUS_SPELLINGS as readonly string[]).includes(s) ? CANCELLED_SUBSCRIPTION_STATUS : s;
}

export function isCancelledSubscriptionStatus(raw: string | null | undefined): boolean {
  return normalizeSubscriptionStatus(raw) === CANCELLED_SUBSCRIPTION_STATUS;
}
