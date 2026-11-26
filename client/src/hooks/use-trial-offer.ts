import { useQuery } from "@tanstack/react-query";

export const DEFAULT_TRIAL_LENGTH_DAYS = 30;

/**
 * Public trial-offer copy. Falls back to the historical 30-day wording when
 * the setting cannot be loaded.
 */
export function useTrialOffer() {
  const { data } = useQuery<{ trialLengthDays: number; summary: string }>({
    queryKey: ["/api/public/trial-offer"],
    staleTime: 60_000,
  });
  const trialLengthDays = Number.isInteger(data?.trialLengthDays) && (data?.trialLengthDays ?? 0) > 0
    ? data!.trialLengthDays
    : DEFAULT_TRIAL_LENGTH_DAYS;
  return {
    trialLengthDays,
    summary: data?.summary || `${trialLengthDays}-day trial, no credit card`,
  };
}
