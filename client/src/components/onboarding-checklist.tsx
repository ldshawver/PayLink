import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useTrial } from "@/hooks/use-trial";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import {
  Building2,
  UserPlus,
  Calendar,
  Settings,
  Clock,
  DollarSign,
  CheckCircle2,
  Circle,
  Rocket,
} from "lucide-react";

interface OnboardingData {
  id: string;
  step_company_details: boolean;
  step_first_employee: boolean;
  step_pay_schedule: boolean;
  step_payroll_config: boolean;
  step_time_clock: boolean;
  step_payroll_preview: boolean;
  step_bank_connected: boolean;
  onboarding_wizard_completed: boolean;
  completed_at: string | null;
}

const steps = [
  { key: "step_company_details", label: "Set up company details", desc: "Add your company name, EIN, and address", icon: Building2, route: "/app/company" },
  { key: "step_first_employee", label: "Add your first employee", desc: "Enter employee info, pay rate, and tax details", icon: UserPlus, route: "/app/employee" },
  { key: "step_pay_schedule", label: "Configure pay schedule", desc: "Set your pay frequency (weekly, biweekly, etc.)", icon: Calendar, route: "/app/company" },
  { key: "step_payroll_config", label: "Set up payroll", desc: "Configure tax settings and deductions", icon: Settings, route: "/app/payroll" },
  { key: "step_time_clock", label: "Try the time clock", desc: "Clock in and see how attendance tracking works", icon: Clock, route: "/app/attendance" },
  { key: "step_payroll_preview", label: "Preview a payroll run", desc: "Create a draft payroll to see calculations", icon: DollarSign, route: "/app/payroll" },
];

export function OnboardingChecklist() {
  const { isTrial } = useTrial();
  const [, setLocation] = useLocation();

  const { data: progress, isLoading } = useQuery<OnboardingData>({
    queryKey: ["/api/onboarding/progress"],
    enabled: isTrial,
  });

  const completeMutation = useMutation({
    mutationFn: async (step: string) => {
      await apiRequest("PATCH", "/api/onboarding/progress", { step });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/progress"] });
    },
  });

  if (!isTrial || isLoading || !progress) return null;
  if (progress.completed_at || progress.onboarding_wizard_completed) return null;

  const completedCount = steps.filter(s => progress[s.key as keyof OnboardingData]).length;
  const progressPercent = Math.round((completedCount / steps.length) * 100);

  return (
    <Card className="border-2 border-teal-500/30 bg-gradient-to-br from-teal-500/5 to-blue-500/5" data-testid="card-onboarding-checklist">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-teal-500" />
            <CardTitle className="text-lg">Getting Started</CardTitle>
          </div>
          <span className="text-sm text-muted-foreground" data-testid="text-onboarding-progress">{completedCount}/{steps.length} complete</span>
        </div>
        <div className="w-full bg-muted rounded-full h-2 mt-2">
          <div
            className="bg-gradient-to-r from-teal-500 to-blue-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
            data-testid="progress-onboarding"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {steps.map((step) => {
          const done = !!progress[step.key as keyof OnboardingData];
          const Icon = step.icon;
          return (
            <div
              key={step.key}
              className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${done ? "opacity-60" : "hover:bg-accent cursor-pointer"}`}
              onClick={() => {
                if (!done) {
                  setLocation(step.route);
                }
              }}
              data-testid={`onboarding-step-${step.key}`}
            >
              {done ? (
                <CheckCircle2 className="h-5 w-5 text-teal-500 flex-shrink-0" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${done ? "line-through" : ""}`}>{step.label}</p>
                <p className="text-xs text-muted-foreground">{step.desc}</p>
              </div>
              {!done && (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-shrink-0 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    completeMutation.mutate(step.key);
                  }}
                  data-testid={`button-complete-${step.key}`}
                >
                  Mark Done
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
