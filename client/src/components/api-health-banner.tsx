import { WifiOff, X } from "lucide-react";
import { useApiHealth } from "@/hooks/use-api-health";

export function ApiHealthBanner() {
  const { showBanner, dismiss } = useApiHealth();

  if (!showBanner) return null;

  return (
    <div
      role="alert"
      data-testid="global-api-health-banner"
      className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-sm shrink-0"
    >
      <WifiOff className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <span className="flex-1">
        <strong className="font-semibold">Connection issue:</strong>{" "}
        PayLink cannot reach the API right now. Some data may not load until connectivity is restored.
      </span>
      <button
        onClick={dismiss}
        aria-label="Dismiss connectivity warning"
        data-testid="btn-dismiss-api-health-banner"
        className="shrink-0 rounded p-0.5 hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
