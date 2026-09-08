import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { LicenseBadge } from "@/components/license-badge";
import { KeyRound, ShieldAlert } from "lucide-react";

/**
 * Platform license console — PR 4 (migration 0022).
 *
 * Read + narrow mutate of a company's tenant_licenses record. The PUT keeps the
 * authoritative `companies` gate columns and the tenant_licenses mirror
 * consistent server-side (server/licensing/license-service.ts adminUpsertLicense).
 * Guarded by requirePlatformAdminRole() on the server.
 */

const STATUSES = ["trialing", "active", "expired", "suspended", "cancelled", "inactive"] as const;

type LicenseRow = {
  companyId: string;
  companyName: string;
  isDemo: boolean;
  subscriptionStatus: string | null;
  record: null | {
    id: string;
    plan_type: string;
    status: string;
    trial_end: string | null;
    source: string;
    notes: string | null;
    updated_at: string;
  };
  resolved: {
    effectiveStatus: string;
    source: string;
    isLegacy: boolean;
    planType: string | null;
    trial: { end: string | null; daysRemaining: number | null };
  };
};

export default function PlatformLicensesPage() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<LicenseRow | null>(null);
  const [form, setForm] = useState({ status: "", planType: "", trialEnd: "", notes: "", reason: "" });

  const { data, isLoading } = useQuery<{ licenses: LicenseRow[]; summary: any }>({
    queryKey: ["/api/platform/licenses"],
  });

  const mutation = useMutation({
    mutationFn: async (vars: { companyId: string; body: Record<string, unknown> }) => {
      const res = await apiRequest("PUT", `/api/platform/companies/${vars.companyId}/license`, vars.body);
      return res.json();
    },
    onSuccess: (result) => {
      toast({
        title: "License updated",
        description: result?.companyStatusChanged
          ? `Effective access state changed → ${result.companyStatus}`
          : "Structured record updated; effective access unchanged.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/licenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/license/status"] });
      setSelected(null);
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  function openEditor(row: LicenseRow) {
    setSelected(row);
    setForm({
      status: row.resolved.effectiveStatus,
      planType: row.resolved.planType ?? "starter",
      trialEnd: row.record?.trial_end ? row.record.trial_end.slice(0, 10) : "",
      notes: row.record?.notes ?? "",
      reason: "",
    });
  }

  function submit() {
    if (!selected) return;
    const body: Record<string, unknown> = {
      status: form.status,
      planType: form.planType || undefined,
      notes: form.notes || undefined,
      reason: form.reason || undefined,
    };
    if (form.trialEnd) body.trialEnd = new Date(form.trialEnd).toISOString();
    mutation.mutate({ companyId: selected.companyId, body });
  }

  const rows = data?.licenses ?? [];
  const summary = data?.summary;

  return (
    <div className="p-6 space-y-6" data-testid="platform-licenses-page">
      <div className="flex items-center gap-3">
        <KeyRound className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold">Tenant Licenses</h1>
          <p className="text-sm text-muted-foreground">
            Structured license records. Companies with no record resolve from their existing
            company state and are never locked out.
          </p>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Companies</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{summary.total}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">With record</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{summary.withRecord}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Legacy (fallback)</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{summary.legacy}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Trialing</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{summary.byStatus?.trialing ?? 0}</CardContent></Card>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left">
                <th className="p-3 font-medium">Company</th>
                <th className="p-3 font-medium">License</th>
                <th className="p-3 font-medium">Plan</th>
                <th className="p-3 font-medium">Source</th>
                <th className="p-3 font-medium">Company status</th>
                <th className="p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No companies.</td></tr>
              )}
              {rows.map((row) => (
                <tr key={row.companyId} className="border-b last:border-0 hover:bg-muted/30" data-testid={`license-row-${row.companyId}`}>
                  <td className="p-3 font-medium">{row.companyName}{row.isDemo ? <span className="ml-2 text-xs text-muted-foreground">(demo)</span> : null}</td>
                  <td className="p-3"><LicenseBadge status={row.resolved.effectiveStatus} legacy={row.resolved.isLegacy} /></td>
                  <td className="p-3">{row.resolved.planType ?? "—"}</td>
                  <td className="p-3 text-muted-foreground">{row.resolved.source}</td>
                  <td className="p-3 text-muted-foreground">{row.subscriptionStatus ?? "—"}</td>
                  <td className="p-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => openEditor(row)} data-testid={`license-edit-${row.companyId}`}>
                      Manage
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent data-testid="license-editor-dialog">
          <DialogHeader>
            <DialogTitle>{selected?.companyName} — license</DialogTitle>
            <DialogDescription className="flex items-start gap-2 text-xs">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
              Changing status also updates this company's authoritative access state
              (subscription_status) through the established path, and records an audit event.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger data-testid="license-status-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Plan type</Label>
              <Input value={form.planType} onChange={(e) => setForm((f) => ({ ...f, planType: e.target.value }))} data-testid="license-plan-input" />
            </div>
            <div>
              <Label>Trial end (optional)</Label>
              <Input type="date" value={form.trialEnd} onChange={(e) => setForm((f) => ({ ...f, trialEnd: e.target.value }))} data-testid="license-trial-end-input" />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} data-testid="license-notes-input" />
            </div>
            <div>
              <Label>Reason (recorded on the audit event)</Label>
              <Input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. contract signed / non-payment" data-testid="license-reason-input" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
            <Button onClick={submit} disabled={mutation.isPending} data-testid="license-save-button">
              {mutation.isPending ? "Saving…" : "Save license"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
