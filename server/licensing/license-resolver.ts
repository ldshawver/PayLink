/**
 * Shared license resolver — server/licensing/license-resolver.ts
 *
 * PR 4 of the SaaS identity/onboarding architecture cleanup.
 *
 * This module is PURE and dependency-free so it can be exercised directly by
 * tests. It answers one question deterministically:
 *
 *   "Given a company's optional structured `tenant_licenses` record and its
 *    legacy `companies` gate columns, what is the single license state we
 *    should DISPLAY, and where did that answer come from?"
 *
 * IMPORTANT — this module does NOT decide access.
 *   Whether a tenant is actually blocked stays with
 *   server/tenant-enforcement.ts `checkTenantGate()` and the
 *   `requireActiveSubscription` middleware, which read the `companies` columns.
 *   PR 4 does not change that path. The resolver only produces a normalized,
 *   display-facing view and is consumed by:
 *     - GET /api/license/status              (advisory badge data)
 *     - the platform license admin screens
 *     - server/licensing/license-gate.ts     (narrow opt-in gate — and even
 *       there, only an EXPLICIT tenant_licenses row can block; a missing row
 *       always passes)
 *
 * Fallback precedence for the effective status:
 *   1. `tenant_licenses.status`      — an explicit structured record wins
 *   2. `companies.subscription_status` (+ trial_end / grace_period_end)
 *   3. legacy default: 'active'      — a company we know nothing about is
 *                                      treated as a working legacy tenant
 */

export type LicenseStatus =
  | "trialing"
  | "active"
  | "expired"
  | "suspended"
  | "cancelled"
  | "inactive";

export const LICENSE_STATUSES: readonly LicenseStatus[] = [
  "trialing",
  "active",
  "expired",
  "suspended",
  "cancelled",
  "inactive",
];

/** Statuses that the narrow opt-in gate treats as blocking (when — and only
 *  when — they come from an explicit tenant_licenses row). */
export const BLOCKING_LICENSE_STATUSES: readonly LicenseStatus[] = [
  "expired",
  "suspended",
  "cancelled",
  "inactive",
];

export type LicenseResolutionSource =
  | "tenant_licenses"
  | "company_gate"
  | "legacy_default";

/** The subset of a `tenant_licenses` row the resolver needs. */
export interface TenantLicenseInput {
  status?: string | null;
  planType?: string | null;
  trialStart?: Date | string | null;
  trialEnd?: Date | string | null;
  currentPeriodStart?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
  source?: string | null;
}

/** The subset of the `companies` row the resolver falls back to. */
export interface CompanyGateInput {
  subscriptionStatus?: string | null;
  planName?: string | null;
  trialStart?: Date | string | null;
  trialEnd?: Date | string | null;
  billingActive?: boolean | null;
  gracePeriodEnd?: Date | string | null;
  gateOverrideReason?: string | null;
  isDemo?: boolean | null;
}

export interface ResolvedLicense {
  /** Normalized display status. */
  effectiveStatus: LicenseStatus;
  /** Which input produced `effectiveStatus`. */
  source: LicenseResolutionSource;
  /** True when a `tenant_licenses` row was supplied. */
  hasLicenseRecord: boolean;
  /** True when there is NO `tenant_licenses` row — a legacy / pre-PR4 tenant. */
  isLegacy: boolean;
  /** Plan/type label, best-effort from the record then the company. */
  planType: string | null;
  trial: {
    isTrial: boolean;
    start: string | null;
    end: string | null;
    /** Whole days until `end` (negative once past). Null when no end date. */
    daysRemaining: number | null;
    expired: boolean;
  };
  /**
   * Whether the NARROW opt-in gate (server/licensing/license-gate.ts) would
   * block on this state. ALWAYS false unless `effectiveStatus` is a blocking
   * status AND it came from an explicit `tenant_licenses` row. A legacy tenant
   * (no record) is never gate-blocked by PR 4 regardless of company state —
   * existing enforcement via checkTenantGate() is unchanged and separate.
   */
  gateBlocks: boolean;
  /** Short human label for a badge. */
  label: string;
  /** Diagnostic notes (never an enforcement signal on their own). */
  reasons: string[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function toIso(v: Date | string | null | undefined): string | null {
  const d = toDate(v);
  return d ? d.toISOString() : null;
}

/** Map any known legacy `companies.subscription_status` spelling to the
 *  normalized vocabulary. Unknown values fall through to `active` so we never
 *  invent a block the legacy gate would not itself impose. */
export function normalizeCompanyStatus(raw: string | null | undefined): LicenseStatus {
  const s = (raw || "").trim().toLowerCase();
  switch (s) {
    case "trial":
    case "trialing":
    case "trial_active":
      return "trialing";
    case "trial_expired":
      return "expired";
    case "active":
    case "active_paid":
    case "paid":
    case "grace":
    case "grace_period":
    case "past_due": // still allowed by checkTenantGate on its own for `grace`; past_due handled by legacy gate, not us
      return "active";
    case "suspended":
      return "suspended";
    case "canceled":
    case "cancelled":
      return "cancelled";
    case "inactive":
      return "inactive";
    default:
      return "active";
  }
}

/** Normalize a `tenant_licenses.status` value. Unknown → `inactive` (an
 *  explicit-but-unrecognized license record is treated conservatively, unlike
 *  the legacy company fallback). */
export function normalizeLicenseStatus(raw: string | null | undefined): LicenseStatus {
  const s = (raw || "").trim().toLowerCase();
  if ((LICENSE_STATUSES as string[]).includes(s)) return s as LicenseStatus;
  switch (s) {
    case "trial":
    case "trial_active":
      return "trialing";
    case "trial_expired":
      return "expired";
    case "active_paid":
    case "paid":
      return "active";
    case "canceled":
      return "cancelled";
    default:
      return "inactive";
  }
}

const LABELS: Record<LicenseStatus, string> = {
  trialing: "Trial",
  active: "Active",
  expired: "Expired",
  suspended: "Suspended",
  cancelled: "Cancelled",
  inactive: "Inactive",
};

/**
 * Resolve the display-facing license state for a company.
 *
 * @param license  the `tenant_licenses` row, or null/undefined when none exists
 * @param company  the `companies` gate columns, or null/undefined when unknown
 * @param now      injectable clock for tests (defaults to `new Date()`)
 */
export function resolveLicense(
  license: TenantLicenseInput | null | undefined,
  company: CompanyGateInput | null | undefined,
  now: Date = new Date(),
): ResolvedLicense {
  const reasons: string[] = [];
  const hasLicenseRecord = !!license && (license.status != null || license.planType != null || license.trialEnd != null);
  const isLegacy = !hasLicenseRecord;

  // ── Trial window (record first, then company) ──────────────────────────────
  const trialStart = toDate(license?.trialStart) ?? toDate(company?.trialStart);
  const trialEnd = toDate(license?.trialEnd) ?? toDate(company?.trialEnd);
  const trialEndExpired = !!trialEnd && trialEnd.getTime() < now.getTime();
  const daysRemaining = trialEnd
    ? Math.ceil((trialEnd.getTime() - now.getTime()) / MS_PER_DAY)
    : null;

  // ── Effective status ──────────────────────────────────────────────────────
  let effectiveStatus: LicenseStatus;
  let source: LicenseResolutionSource;

  if (hasLicenseRecord) {
    effectiveStatus = normalizeLicenseStatus(license!.status);
    source = "tenant_licenses";
    reasons.push(`tenant_licenses.status=${(license!.status ?? "null")} → ${effectiveStatus}`);
    // A record that says "trialing" but whose trial window has lapsed reads as expired.
    if (effectiveStatus === "trialing" && trialEndExpired) {
      effectiveStatus = "expired";
      reasons.push("trial_end has passed → expired");
    }
  } else if (company && (company.subscriptionStatus != null || company.trialEnd != null || company.isDemo != null)) {
    if (company.isDemo) {
      effectiveStatus = "active";
      source = "company_gate";
      reasons.push("companies.is_demo=true → active (demo)");
    } else {
      effectiveStatus = normalizeCompanyStatus(company.subscriptionStatus);
      source = "company_gate";
      reasons.push(`companies.subscription_status=${company.subscriptionStatus ?? "null"} → ${effectiveStatus}`);
      if (effectiveStatus === "trialing" && trialEndExpired) {
        effectiveStatus = "expired";
        reasons.push("companies.trial_end has passed → expired");
      }
    }
  } else {
    effectiveStatus = "active";
    source = "legacy_default";
    reasons.push("no tenant_licenses row and no company gate state → legacy-active default");
  }

  const planType = (license?.planType ?? company?.planName ?? null) || null;

  // ── Gate decision (narrow, opt-in, record-only) ───────────────────────────
  // PR 4 rule: only an EXPLICIT tenant_licenses record can cause the new gate
  // to block. Legacy tenants (no record) are never blocked by PR 4. Existing
  // enforcement (checkTenantGate / requireActiveSubscription) is separate and
  // unchanged.
  const gateBlocks =
    source === "tenant_licenses" &&
    (BLOCKING_LICENSE_STATUSES as string[]).includes(effectiveStatus);
  if (gateBlocks) {
    reasons.push(`explicit license record is ${effectiveStatus} → narrow gate blocks`);
  } else if (isLegacy) {
    reasons.push("legacy tenant (no record) → narrow gate always passes");
  }

  return {
    effectiveStatus,
    source,
    hasLicenseRecord,
    isLegacy,
    planType,
    trial: {
      isTrial: effectiveStatus === "trialing",
      start: toIso(trialStart),
      end: toIso(trialEnd),
      daysRemaining,
      expired: trialEndExpired,
    },
    gateBlocks,
    label: LABELS[effectiveStatus],
    reasons,
  };
}
