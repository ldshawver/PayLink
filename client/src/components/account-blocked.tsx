import { AlertTriangle, LogOut, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TenantGate } from "@/hooks/use-auth";

const CODE_LABELS: Record<string, string> = {
  trial_expired: "Trial Expired",
  past_due: "Payment Past Due",
  grace_expired: "Grace Period Expired",
  suspended: "Account Suspended",
  cancelled: "Subscription Cancelled",
  tenant_inactive: "Account Inactive",
};

interface AccountBlockedProps {
  gate: TenantGate;
}

export function AccountBlocked({ gate }: AccountBlockedProps) {
  async function handleLogout() {
    try {
      await apiRequest("POST", "/api/auth/logout", {});
    } catch {}
    queryClient.clear();
    const host = window.location.hostname;
    const isLocal = host === "localhost" || host.includes(".repl.") || host.includes(".replit.");
    window.location.href = isLocal ? "/login" : "https://mypaylink.app/";
  }

  const codeLabel = gate.code ? CODE_LABELS[gate.code] ?? gate.code.replace(/_/g, " ") : "Access Restricted";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-2 border-amber-400">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-amber-100 dark:bg-amber-950 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-amber-600" />
            </div>
          </div>
          <CardTitle className="text-xl text-amber-800 dark:text-amber-200">{codeLabel}</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-base font-medium">{gate.reason}</p>
          {gate.policyDetail && (
            <p className="text-sm text-muted-foreground">{gate.policyDetail}</p>
          )}
          <div className="bg-muted rounded-lg p-4 text-sm text-left space-y-2">
            <p className="font-medium">To restore access:</p>
            <ul className="space-y-1 text-muted-foreground">
              {gate.code === "trial_expired" && (
                <>
                  <li>• Visit your billing portal to subscribe</li>
                  <li>• Choose a plan that fits your team</li>
                </>
              )}
              {(gate.code === "past_due" || gate.code === "grace_expired") && (
                <>
                  <li>• Update your payment method in billing settings</li>
                  <li>• Contact support if you need assistance</li>
                </>
              )}
              {gate.code === "cancelled" && (
                <li>• Resubscribe to a PayLink plan</li>
              )}
              {gate.code === "suspended" && (
                <li>• Contact support to resolve your account status</li>
              )}
              {!gate.code && (
                <li>• Contact support for assistance</li>
              )}
            </ul>
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <Button asChild variant="default" className="w-full" data-testid="button-contact-support">
              <a href="mailto:support@mypaylink.app">
                <Mail className="h-4 w-4 mr-2" />
                Contact Support
              </a>
            </Button>
            <Button variant="outline" onClick={handleLogout} className="w-full" data-testid="button-logout-blocked">
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
