import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTrial } from "@/hooks/use-trial";
import { useAuth } from "@/hooks/use-auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  CreditCard, Zap, Users, DollarSign, Calendar, CheckCircle,
  AlertTriangle, Clock, Shield, TrendingUp, Loader2,
} from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    trial_active: { label: "Trial Active", variant: "default" },
    trial_expired: { label: "Trial Expired", variant: "destructive" },
    active_paid: { label: "Active", variant: "default" },
    past_due: { label: "Past Due", variant: "destructive" },
    suspended: { label: "Suspended", variant: "destructive" },
    canceled: { label: "Canceled", variant: "secondary" },
  };
  const c = config[status] || { label: status, variant: "outline" as const };
  return <Badge variant={c.variant} data-testid="badge-subscription-status">{c.label}</Badge>;
}

export default function BillingPage() {
  const { trialStatus, isTrial, isTrialExpired, daysRemaining, subscriptionStatus } = useTrial();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: billingData, isLoading: billingLoading } = useQuery<any>({
    queryKey: ["/api/billing/summary"],
    staleTime: 30000,
  });

  const activateMutation = useMutation({
    mutationFn: async () => {
      fetch("/api/analytics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventName: "billing_setup_started", pageSource: "billing" }),
      }).catch(() => {});
      await apiRequest("POST", "/api/billing/activate", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trial/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/summary"] });
      toast({ title: "Subscription Activated", description: "You now have full access to PayLink." });
      fetch("/api/analytics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventName: "billing_setup_completed", pageSource: "billing" }),
      }).catch(() => {});
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to activate subscription.", variant: "destructive" });
    },
  });

  useEffect(() => {
    fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventName: "billing_page_view", pageSource: "billing" }),
    }).catch(() => {});
  }, []);

  const billableCount = billingData?.billableEmployeeCount || 0;
  const basePrice = 29;
  const perEmployee = 4;
  const projectedMonthly = basePrice + (billableCount * perEmployee);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-billing-title">Billing & Subscription</h1>
        <p className="text-muted-foreground mt-1">Manage your PayLink subscription and billing details</p>
      </div>

      {isTrialExpired && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900">
          <CardContent className="p-4 md:p-6">
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                  <h3 className="font-semibold text-lg" data-testid="text-trial-expired-heading">Your Free Trial Has Ended</h3>
                </div>
                <p className="text-muted-foreground">
                  Your company setup and employee data are still available. Activate your subscription to continue using payroll, time tracking, and employee tools.
                </p>
              </div>
              <Button
                size="lg"
                className="bg-gradient-to-r from-teal-600 to-blue-600 hover:opacity-90 shrink-0"
                onClick={() => activateMutation.mutate()}
                disabled={activateMutation.isPending}
                data-testid="button-activate-expired"
              >
                <CreditCard className="h-4 w-4 mr-2" />
                {activateMutation.isPending ? "Activating..." : "Activate Subscription"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card data-testid="card-current-plan">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-teal-500" />
              Current Plan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold" data-testid="text-plan-name">Starter Plan</span>
              <StatusBadge status={subscriptionStatus} />
            </div>

            <div className="bg-gradient-to-br from-teal-500/10 to-blue-500/10 rounded-lg p-4 border border-teal-500/20">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-teal-600 dark:text-teal-400" data-testid="text-base-price">$29</span>
                <span className="text-muted-foreground">/month base</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">+ $4 per active employee / month</p>
            </div>

            {isTrial && (
              <div className="flex items-center gap-2 text-sm bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
                <Clock className="h-4 w-4 text-blue-500" />
                <span data-testid="text-trial-days">
                  <strong>{daysRemaining} days</strong> remaining in your free trial
                </span>
              </div>
            )}

            {trialStatus?.trialEnd && isTrial && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span data-testid="text-trial-end-date">
                  Trial ends: {new Date(trialStatus.trialEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </span>
              </div>
            )}

            {subscriptionStatus === "active_paid" && (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle className="h-4 w-4" />
                <span data-testid="text-subscription-active">Subscription is active</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-billing-summary">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-teal-500" />
              Billing Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {billingLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" />
                      Billable Employees
                    </div>
                    <span className="font-semibold" data-testid="text-billable-count">{billableCount}</span>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between text-sm">
                    <span>Base plan</span>
                    <span>${basePrice}.00</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span>{billableCount} employees x ${perEmployee}</span>
                    <span>${billableCount * perEmployee}.00</span>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Projected Monthly Total</span>
                    <span className="text-xl font-bold text-teal-600 dark:text-teal-400" data-testid="text-projected-total">
                      ${projectedMonthly}.00
                    </span>
                  </div>
                </div>

                {isTrial && (
                  <p className="text-xs text-muted-foreground">
                    This is your projected cost after the trial period. You won't be charged during the trial.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-plan-features">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-teal-500" />
            What's Included
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
            {[
              "Payroll processing & pay stubs",
              "NACHA ACH direct deposit",
              "Tax form generation (W-2, 1099, 941)",
              "Time clock & attendance tracking",
              "Employee scheduling & shift marketplace",
              "PTO & time-off management",
              "Employee management",
              "Multi-company support",
              "Role-based access control",
              "Expense management & AI scanning",
              "Reports & CSV exports",
              "Employee self-service portal",
            ].map((feature) => (
              <div key={feature} className="flex items-start gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-teal-500 mt-0.5 shrink-0" />
                <span>{feature}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {(isTrial || isTrialExpired) && (
        <Card className="border-teal-200 dark:border-teal-800" data-testid="card-activate-cta">
          <CardContent className="p-6 text-center space-y-4">
            <Zap className="h-10 w-10 text-teal-500 mx-auto" />
            <h3 className="text-xl font-semibold">
              {isTrialExpired ? "Reactivate Your Account" : "Ready to Activate?"}
            </h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              {isTrialExpired
                ? "Your data is secure and waiting. Activate your subscription to continue using PayLink."
                : "Subscribe now to ensure uninterrupted access when your trial ends. Your data is safe either way."}
            </p>
            <Button
              size="lg"
              className="bg-gradient-to-r from-teal-600 to-blue-600 hover:opacity-90"
              onClick={() => activateMutation.mutate()}
              disabled={activateMutation.isPending}
              data-testid="button-activate-subscription"
            >
              <CreditCard className="h-4 w-4 mr-2" />
              {activateMutation.isPending ? "Activating..." : "Activate Subscription — $" + projectedMonthly + "/mo"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Cancel anytime. No long-term commitment required.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
