import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Clock, Layers, Info } from "lucide-react";

interface TenantFeatureRow {
  id: string;
  featureKey: string;
  module: string;
  featureName: string;
  tier: string;
  description: string | null;
  defaultOn: boolean | string;
  isBeta: boolean | string;
  billingImpact: boolean | string;
  overrideEnabled: boolean | null;
  overrideExpiresAt: string | null;
  overrideNotes: string | null;
  effectiveEnabled: boolean | string;
}

const bool = (v: boolean | string | null | undefined): boolean =>
  v === true || v === "true" || v === "t";

function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    starter: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    professional: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    enterprise: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    all: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[tier] ?? colors.all}`}>
      {tier}
    </span>
  );
}

/**
 * TenantFeaturesPanel — Read-only view of the current tenant's feature entitlements.
 * Shown in the Company page under the "Features" tab.
 * Only visible to tenant_admin / tenant_owner / tenant_hr_admin.
 */
export function TenantFeaturesPanel() {
  const { user } = useAuth();
  const companyId = user?.companyId;

  const { data: features = [], isLoading } = useQuery<TenantFeatureRow[]>({
    queryKey: ["/api/feature-registry/my-features"],
    queryFn: () =>
      fetch("/api/feature-registry/my-features", { credentials: "include" }).then(r => r.json()),
  });

  // Group by module
  const grouped: Record<string, TenantFeatureRow[]> = {};
  for (const f of features) {
    if (!grouped[f.module]) grouped[f.module] = [];
    grouped[f.module].push(f);
  }
  const modules = Object.keys(grouped).sort();

  const enabledCount = features.filter(f => bool(f.effectiveEnabled)).length;
  const totalCount = features.length;

  if (isLoading) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        Loading feature entitlements…
      </div>
    );
  }

  if (!features.length) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <Layers className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p>No feature data available. Contact your PayLink account manager.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-4 p-4 rounded-lg border bg-muted/20">
        <Layers className="h-8 w-8 text-teal-600 shrink-0" />
        <div>
          <div className="text-lg font-bold">{enabledCount} of {totalCount} features enabled</div>
          <div className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
            <Info className="h-3.5 w-3.5" />
            Feature availability is managed by your PayLink platform team. Contact support to change your plan.
          </div>
        </div>
      </div>

      {/* Features by module */}
      {modules.map(module => (
        <Card key={module}>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{module}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="divide-y">
              {grouped[module].map(f => {
                const effective = bool(f.effectiveEnabled);
                const hasOverride = f.overrideEnabled !== null;
                const isExpired = f.overrideExpiresAt ? new Date(f.overrideExpiresAt) < new Date() : false;
                return (
                  <div
                    key={f.id}
                    data-testid={`feature-status-${f.featureKey}`}
                    className={`flex items-start gap-3 py-3 ${!effective ? "opacity-60" : ""}`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {effective && !isExpired ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : isExpired ? (
                        <Clock className="h-4 w-4 text-amber-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-medium ${!effective ? "text-muted-foreground" : ""}`}>
                          {f.featureName}
                        </span>
                        <TierBadge tier={f.tier} />
                        {bool(f.isBeta) && (
                          <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">beta</Badge>
                        )}
                        {hasOverride && (
                          <Badge variant="outline" className="text-xs">custom</Badge>
                        )}
                      </div>
                      {f.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>
                      )}
                      {f.overrideExpiresAt && effective && (
                        <div className="text-xs text-amber-600 mt-0.5 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Trial ends {new Date(f.overrideExpiresAt).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
