import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

/**
 * Advisory license strip — PR 4.
 *
 * Renders ONLY when the workspace has an explicit tenant_licenses record whose
 * resolved status is blocking (expired / suspended / cancelled / inactive).
 * Legacy tenants (no record) never see this — `hasLicenseRecord` gate below.
 *
 * This is a message, not a gate. Access enforcement stays with the server
 * (checkTenantGate / requireActiveSubscription, unchanged) and the narrow
 * per-route license gate.
 */
type LicenseStatusResponse = {
  scoped: boolean;
  license: null | {
    status: string;
    label: string;
    isLegacy: boolean;
    hasLicenseRecord: boolean;
    gateBlocks: boolean;
  };
};

const BLOCKING = new Set(["expired", "suspended", "cancelled", "inactive"]);

const MESSAGES: Record<string, string> = {
  expired: "This workspace's license has expired. Some actions are limited until it is renewed.",
  suspended: "This workspace's license is suspended. Contact support@mypaylink.app to restore full access.",
  cancelled: "This workspace's license has been cancelled.",
  inactive: "This workspace's license is inactive.",
};

export function LicenseStatusBanner() {
  const { data } = useQuery<LicenseStatusResponse>({
    queryKey: ["/api/license/status"],
    staleTime: 60_000,
  });

  const lic = data?.license;
  if (!lic || !lic.hasLicenseRecord || lic.isLegacy) return null;
  if (!BLOCKING.has(lic.status)) return null;

  return (
    <div
      className="bg-gradient-to-r from-red-600 to-orange-600 text-white px-4 py-2.5 flex items-center gap-2 text-sm"
      data-testid="banner-license-blocked"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="font-medium">{lic.label}</span>
      <span className="opacity-80">— {MESSAGES[lic.status] ?? "Contact your administrator."}</span>
    </div>
  );
}
