import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, AlertTriangle, Pause, XCircle, HelpCircle } from "lucide-react";

/**
 * Normalized tenant-license status badge — PR 4.
 *
 * Purely presentational. The status string comes from the shared resolver
 * (server/licensing/license-resolver.ts, surfaced on /api/license/status and
 * /api/auth/me `license.status`). This badge never decides access.
 */
export type LicenseBadgeStatus =
  | "trialing"
  | "active"
  | "expired"
  | "suspended"
  | "cancelled"
  | "inactive"
  | string;

const MAP: Record<string, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  active: { label: "Active", className: "bg-emerald-100 text-emerald-800 border-emerald-200", Icon: CheckCircle2 },
  trialing: { label: "Trial", className: "bg-blue-100 text-blue-800 border-blue-200", Icon: Clock },
  expired: { label: "Expired", className: "bg-orange-100 text-orange-800 border-orange-200", Icon: AlertTriangle },
  suspended: { label: "Suspended", className: "bg-red-100 text-red-800 border-red-200", Icon: Pause },
  cancelled: { label: "Cancelled", className: "bg-zinc-200 text-zinc-800 border-zinc-300", Icon: XCircle },
  inactive: { label: "Inactive", className: "bg-zinc-200 text-zinc-700 border-zinc-300", Icon: XCircle },
};

export function LicenseBadge({
  status,
  legacy,
  "data-testid": testId,
}: {
  status: LicenseBadgeStatus;
  legacy?: boolean;
  "data-testid"?: string;
}) {
  const cfg = MAP[status] ?? { label: status || "Unknown", className: "bg-zinc-100 text-zinc-700 border-zinc-200", Icon: HelpCircle };
  const { Icon } = cfg;
  return (
    <Badge
      variant="outline"
      className={`gap-1 font-medium ${cfg.className}`}
      data-testid={testId ?? `license-badge-${status}`}
      title={legacy ? "Resolved from legacy company state — no structured license record yet" : undefined}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
      {legacy ? <span className="opacity-60">(legacy)</span> : null}
    </Badge>
  );
}
