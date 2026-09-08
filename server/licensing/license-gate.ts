/**
 * Narrow, opt-in license gate — server/licensing/license-gate.ts
 *
 * PR 4 of the SaaS identity/onboarding architecture cleanup.
 *
 * SCOPE — deliberately tiny. This middleware is attached to a SMALL, explicit
 * set of non-protected tenant-scoped write routes (POST /api/customers,
 * POST /api/invoices, POST /api/documents). It is NOT attached to payroll,
 * checks, Documenso, employee login, contractor access, or the vendor portal —
 * those keep exactly the enforcement they have today via
 * `requireActiveSubscription` / `checkTenantGate()`, which PR 4 does not touch.
 *
 * RULE — only an EXPLICIT `tenant_licenses` row can block here:
 *   - no `tenant_licenses` row for the company  → ALWAYS pass (legacy / existing
 *     production tenants are never affected by PR 4)
 *   - row present, status ∈ {expired, suspended, cancelled, inactive} → 403
 *   - row present, any other status              → pass
 *
 * This keeps the guarantee that a missing license row never locks anyone out,
 * and that PR 4 changes the behaviour of a route only for a company that has
 * been explicitly licensed (a new trial, or a platform-admin action — both of
 * which also keep the `companies` gate columns consistent).
 */
import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { getTenantLicenseRow } from "./license-service";
import { normalizeLicenseStatus, BLOCKING_LICENSE_STATUSES } from "./license-resolver";

export async function requireLicenseNotBlocked(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) return next(); // auth is enforced by requireAuth earlier in the chain

    const user = await storage.getUser(userId);
    const companyId = user?.companyId;
    if (!companyId) return next(); // platform users / unscoped accounts — not our concern

    const row = await getTenantLicenseRow(companyId);
    if (!row) return next(); // legacy tenant — never blocked by PR 4

    const status = normalizeLicenseStatus(row.status);
    if ((BLOCKING_LICENSE_STATUSES as string[]).includes(status)) {
      res.status(403).json({
        message:
          status === "expired"
            ? "This workspace's license has expired. Contact your administrator to restore access."
            : status === "suspended"
            ? "This workspace's license is suspended. Contact support@mypaylink.app to restore access."
            : status === "cancelled"
            ? "This workspace's license has been cancelled."
            : "This workspace's license is inactive.",
        code: "license_blocked",
        licenseStatus: status,
      });
      return;
    }
    return next();
  } catch (e) {
    // Fail OPEN — a resolver/DB hiccup must never harden a route that PR 4 was
    // explicitly told not to tighten for existing tenants.
    console.error("[license-gate] check failed, passing through:", e);
    return next();
  }
}
