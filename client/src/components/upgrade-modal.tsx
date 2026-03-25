import { useState, useEffect } from "react";
import { useTrial } from "@/hooks/use-trial";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, CreditCard, Shield, Zap } from "lucide-react";

export function UpgradeModal() {
  const [open, setOpen] = useState(false);
  const { isTrialExpired, isRestricted } = useTrial();
  const { toast } = useToast();

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("open-upgrade-modal", handler);
    return () => window.removeEventListener("open-upgrade-modal", handler);
  }, []);

  useEffect(() => {
    if (isTrialExpired) {
      const timer = setTimeout(() => setOpen(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [isTrialExpired]);

  const activateMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/billing/activate", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trial/status"] });
      setOpen(false);
      toast({ title: "Subscription activated", description: "You now have full access to PayLink." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to activate subscription. Please try again.", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg" data-testid="modal-upgrade">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Zap className="h-5 w-5 text-teal-500" />
            {isTrialExpired ? "Your Trial Has Ended" : "Upgrade to PayLink Starter"}
          </DialogTitle>
          <DialogDescription>
            {isTrialExpired
              ? "Your 30-day trial has expired. Subscribe to continue using PayLink — your data is safe and waiting."
              : "Unlock PayLink with simple, transparent pricing."
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="bg-gradient-to-br from-teal-500/10 to-blue-500/10 rounded-lg p-4 border border-teal-500/20">
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-3xl font-bold text-teal-500">$29</span>
              <span className="text-muted-foreground">/month base</span>
            </div>
            <p className="text-sm text-muted-foreground">+ $4 per active employee / month</p>
          </div>

          <div className="space-y-2">
            {[
              "Full payroll processing & direct deposit",
              "Time clock, scheduling & shift marketplace",
              "Tax form generation (W-2, 1099, 941)",
              "Multi-company management",
              "Expense management & AI receipt scanning",
              "Unlimited reports & CSV exports",
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-teal-500 flex-shrink-0" />
                <span>{feature}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            <Shield className="h-4 w-4 flex-shrink-0" />
            <span>Your data is secure. Subscribe anytime to pick up right where you left off.</span>
          </div>

          <div className="flex gap-3">
            <Button
              className="flex-1 bg-gradient-to-r from-teal-600 to-blue-600 hover:opacity-90"
              onClick={() => activateMutation.mutate()}
              disabled={activateMutation.isPending}
              data-testid="button-activate-subscription"
            >
              <CreditCard className="h-4 w-4 mr-2" />
              {activateMutation.isPending ? "Activating..." : "Activate Subscription"}
            </Button>
            {!isTrialExpired && (
              <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-close-upgrade">
                Maybe Later
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
