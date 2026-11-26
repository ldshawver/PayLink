import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface AiStatus {
  available: boolean;
  visionAvailable: boolean;
  message: string;
  platformEnabled: boolean;
  companyEnabled: boolean | null;
  canManageCompany: boolean;
}

export function useAiStatus() {
  return useQuery<AiStatus>({
    queryKey: ["/api/ai/status"],
    staleTime: 30_000,
    retry: false,
  });
}

/** Shown wherever an AI action would otherwise send customer content. */
export function AiUnavailableNotice({ vision = false }: { vision?: boolean }) {
  const { data, isError } = useAiStatus();
  const available = vision ? data?.visionAvailable : data?.available;
  if (data?.available === undefined && !isError) return null;
  if (available) return null;
  const message = isError
    ? "AI status could not be loaded. Scanning and proposal assist stay off until it can."
    : data?.message || "AI is unavailable.";
  return (
    <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300" data-testid="text-ai-unavailable">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <p>{message}</p>
    </div>
  );
}

export function CompanyAiSwitch() {
  const { data } = useAiStatus();
  const { toast } = useToast();
  if (!data?.canManageCompany) return null;
  const enabled = data.companyEnabled !== false;
  async function save(next: boolean) {
    try {
      await apiRequest("PATCH", "/api/company/ai-settings", { enabled: next });
      await queryClient.invalidateQueries({ queryKey: ["/api/ai/status"] });
      toast({ title: next ? "AI turned on for this company" : "AI turned off for this company" });
    } catch (error) {
      toast({ title: "Could not update AI", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  }
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded border p-4" data-testid="card-company-ai">
      <div className="flex-1">
        <p className="text-sm font-medium">Company AI</p>
        <p className="text-xs text-muted-foreground">{data.message}</p>
      </div>
      <Button type="button" variant={enabled ? "outline" : "default"} onClick={() => save(!enabled)} data-testid="button-company-ai-toggle">
        {enabled ? "Turn off" : "Turn on"}
      </Button>
    </div>
  );
}

export function PlatformAiSwitch() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data } = useAiStatus();
  const canEdit = user?.role === "platform_super_admin" || user?.role === "platform_admin";
  if (!canEdit) return null;
  async function save(next: boolean) {
    try {
      await apiRequest("PATCH", "/api/platform/ai-settings", { enabled: next });
      await queryClient.invalidateQueries({ queryKey: ["/api/ai/status"] });
      toast({ title: next ? "Platform AI turned on" : "Platform AI turned off" });
    } catch (error) {
      toast({ title: "Could not update AI", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  }
  return (
    <div className="rounded border p-4 space-y-2" data-testid="card-platform-ai">
      <p className="text-sm font-semibold">Self-hosted AI</p>
      <p className="text-xs text-muted-foreground">{data?.message || "Loading AI status..."}</p>
      <Button type="button" onClick={() => save(!data?.platformEnabled)} data-testid="button-platform-ai-toggle">
        {data?.platformEnabled ? "Turn platform AI off" : "Turn platform AI on"}
      </Button>
    </div>
  );
}
