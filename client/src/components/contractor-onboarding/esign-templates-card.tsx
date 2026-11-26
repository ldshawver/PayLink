import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getCsrfToken, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2 } from "lucide-react";

type Kind = "contractor_agreement" | "w9";
type Mapping = { kind: Kind; label: string; templateId: string | null; templateRecipientId: string | null; enabled: boolean; approvedAt: string | null };
type Settings = { server: { tablesReady: boolean; sendingEnabled: boolean; documensoConfigured: boolean }; templates: Mapping[] };

/**
 * Per-company Documenso template mapping for the agreement and the W-9.
 * Enabling a template records this administrator's approval of it.
 */
export function EsignTemplatesCard() {
  const { data, isLoading } = useQuery<Settings>({ queryKey: ["/api/contractor-onboarding/esign-templates"] });
  if (isLoading || !data) return null;
  const s = data.server;
  const blockers = [
    !s.tablesReady && "Database migration 0033 has not been applied.",
    !s.documensoConfigured && "Documenso is not configured on this server.",
    !s.sendingEnabled && "Sending is turned off on this server (CONTRACTOR_ONBOARDING_ESIGN_ENABLED).",
  ].filter(Boolean) as string[];
  return (
    <Card data-testid="card-esign-templates">
      <CardHeader>
        <CardTitle className="text-base">Documents to sign</CardTitle>
        <CardDescription>Documenso templates used for each contractor. Turning a template on records your approval of it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {blockers.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm" data-testid="text-esign-blockers">
            <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />Documents cannot be sent yet</div>
            <ul className="mt-1 list-disc pl-6">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          </div>
        )}
        {data.templates.map((m) => <TemplateRow key={m.kind} mapping={m} disabled={!s.tablesReady} />)}
      </CardContent>
    </Card>
  );
}

function TemplateRow({ mapping, disabled }: { mapping: Mapping; disabled: boolean }) {
  const { toast } = useToast();
  const [templateId, setTemplateId] = useState(mapping.templateId ?? "");
  const [recipientId, setRecipientId] = useState(mapping.templateRecipientId ?? "");
  const [enabled, setEnabled] = useState(mapping.enabled);
  useEffect(() => { setTemplateId(mapping.templateId ?? ""); setRecipientId(mapping.templateRecipientId ?? ""); setEnabled(mapping.enabled); }, [mapping]);
  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/contractor-onboarding/esign-templates/${mapping.kind}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfToken() ?? "" },
        body: JSON.stringify({ templateId, templateRecipientId: recipientId || null, enabled }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Could not save.");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-onboarding/esign-templates"] });
      toast({ title: `${mapping.label} saved`, description: enabled ? "Template approved and turned on." : "Template saved and turned off." });
    },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });
  const id = mapping.kind;
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end border-t pt-4 first:border-t-0 first:pt-0" data-testid={`row-esign-${id}`}>
      <div className="sm:col-span-4 flex items-center gap-2 text-sm font-medium">
        {mapping.label}
        <Badge variant={mapping.enabled ? "default" : "secondary"}>{mapping.enabled ? "On" : "Off"}</Badge>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`tpl-${id}`}>Documenso template ID</Label>
        <Input id={`tpl-${id}`} value={templateId} maxLength={64} autoComplete="off" disabled={disabled}
          onChange={(e) => setTemplateId(e.target.value)} data-testid={`input-template-${id}`} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`rcp-${id}`}>Template signer ID (optional)</Label>
        <Input id={`rcp-${id}`} value={recipientId} maxLength={64} autoComplete="off" disabled={disabled}
          onChange={(e) => setRecipientId(e.target.value)} data-testid={`input-template-recipient-${id}`} />
      </div>
      <div className="flex items-center gap-2 pb-2">
        <Switch id={`on-${id}`} checked={enabled} onCheckedChange={setEnabled} disabled={disabled} data-testid={`switch-template-${id}`} />
        <Label htmlFor={`on-${id}`}>On</Label>
      </div>
      <Button onClick={() => save.mutate()} disabled={disabled || save.isPending || !templateId.trim()} data-testid={`button-save-template-${id}`}>
        {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
      </Button>
    </div>
  );
}
