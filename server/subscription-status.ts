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

// Fail-closed gating: every normalized companies.subscription_status value the
// tenant gates (checkTenantGate, requireActiveSubscription) know how to
// classify. Anything else — NULL, empty, a typo, a value from a newer or older
// release — means eligibility cannot be determined, so both gates deny.
export const TRIAL_SUBSCRIPTION_STATUSES = ["trial_active", "trialing", "trial"] as const;
export const GRACE_SUBSCRIPTION_STATUSES = ["grace_period", "grace"] as const;
export const KNOWN_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "active_paid", "active",
  ...TRIAL_SUBSCRIPTION_STATUSES, "trial_expired",
  ...GRACE_SUBSCRIPTION_STATUSES, "past_due",
  "suspended", CANCELLED_SUBSCRIPTION_STATUS,
]);

export function isKnownSubscriptionStatus(normalized: string): boolean {
  return KNOWN_SUBSCRIPTION_STATUSES.has(normalized);
}
