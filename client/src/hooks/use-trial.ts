import { useQuery } from "@tanstack/react-query";

interface TrialStatus {
  subscriptionStatus: string;
  planName: string;
  isTrial: boolean;
  isTrialExpired: boolean;
  isDemo: boolean;
  trialEnd: string | null;
  daysRemaining: number;
  billingActive: boolean;
  paymentMethodOnFile: boolean;
  contactName: string | null;
}

export function useTrial() {
  const { data, isLoading } = useQuery<TrialStatus>({
    queryKey: ["/api/trial/status"],
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  return {
    trialStatus: data,
    isLoading,
    isTrial: data?.isTrial || false,
    isTrialExpired: data?.isTrialExpired || false,
    isDemo: data?.isDemo || false,
    daysRemaining: data?.daysRemaining || 0,
    subscriptionStatus: data?.subscriptionStatus || "active_paid",
    isRestricted: data?.isTrialExpired || data?.subscriptionStatus === "suspended" || data?.subscriptionStatus === "canceled",
  };
}
