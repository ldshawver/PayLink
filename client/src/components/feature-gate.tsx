import { useFeatureFlag } from "@/lib/featureFlags";
import { useAuth } from "@/hooks/use-auth";
import { Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FeatureGateProps {
  featureKey: string;
  featureName?: string;
  children: React.ReactNode;
}

/**
 * FeatureGate — wraps a page/component and shows an upgrade prompt
 * when the current tenant does not have the feature enabled.
 *
 * Platform users always bypass the gate (they see everything).
 */
export function FeatureGate({ featureKey, featureName, children }: FeatureGateProps) {
  const { user } = useAuth();
  const enabled = useFeatureFlag(featureKey);

  // Platform users always bypass
  if (user?.role?.startsWith("platform_")) {
    return <>{children}</>;
  }

  if (!enabled) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
        <div className="max-w-md">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Feature Not Available</h2>
          <p className="text-muted-foreground mb-6">
            {featureName
              ? `${featureName} is not included in your current plan.`
              : "This feature is not included in your current plan."}
            {" "}Contact your PayLink account manager to upgrade.
          </p>
          <Button
            variant="outline"
            onClick={() => window.history.back()}
            data-testid="button-feature-gate-back"
          >
            Go Back
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
