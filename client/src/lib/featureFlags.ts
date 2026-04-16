import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";

interface FeatureFlagResult {
  all: boolean;      // true for platform users who bypass all gates
  flags: Record<string, boolean>;
}

/**
 * useFeatureFlag — returns true if the current tenant has the given feature enabled.
 *
 * Platform users always get `true` (they bypass feature gates).
 * If the feature key is not in the registry at all, defaults to `true` (forward-compatible).
 *
 * Usage:
 *   const canUseContractorHub = useFeatureFlag("tenant.finance.contractor-hub");
 */
export function useFeatureFlag(featureKey: string): boolean {
  const { user } = useAuth();
  const isPlatformUser = (user?.role ?? "").startsWith("platform_");

  const { data } = useQuery<FeatureFlagResult>({
    queryKey: ["/api/feature-flags"],
    staleTime: 5 * 60 * 1000, // cache for 5 minutes
    enabled: !!user && !isPlatformUser,
  });

  // Platform users see everything
  if (isPlatformUser) return true;
  if (!data) return true; // default open while loading
  if (data.all) return true;
  // If not in registry, default to enabled (forward-compatible)
  if (!(featureKey in data.flags)) return true;
  return data.flags[featureKey] === true;
}

/**
 * useFeatureFlags — returns the full flags map for the current tenant.
 * Useful for rendering multiple gates in one component.
 */
export function useFeatureFlags(): {
  isLoading: boolean;
  isPlatformUser: boolean;
  flags: Record<string, boolean>;
  isEnabled: (key: string) => boolean;
} {
  const { user } = useAuth();
  const isPlatformUser = (user?.role ?? "").startsWith("platform_");

  const { data, isLoading } = useQuery<FeatureFlagResult>({
    queryKey: ["/api/feature-flags"],
    staleTime: 5 * 60 * 1000,
    enabled: !!user && !isPlatformUser,
  });

  const flags = data?.flags ?? {};

  return {
    isLoading: !isPlatformUser && isLoading,
    isPlatformUser,
    flags,
    isEnabled: (key: string) => {
      if (isPlatformUser) return true;
      if (!data) return true;
      if (data.all) return true;
      if (!(key in flags)) return true;
      return flags[key] === true;
    },
  };
}
