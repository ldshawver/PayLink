import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Download, RefreshCw, Server, GitBranch, Shield, Key, Plug, Database,
  Building2, FileText, Terminal, CheckCircle2, XCircle, AlertCircle, Clock,
  Rocket, Layers, CreditCard, BarChart3, ScrollText, Lock, Unlock, AlertTriangle
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function StatusBadge({ ok, label, warn }: { ok: boolean; label?: string; warn?: boolean }) {
  if (ok) return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 text-xs">{label ?? "OK"}</Badge>;
  if (warn) return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 text-xs">{label ?? "Warning"}</Badge>;
  return <Badge variant="destructive" className="text-xs">{label ?? "Missing"}</Badge>;
}

function SectionCard({ title, icon: Icon, children, description }: { title: string; icon: any; children: React.ReactNode; description?: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function KVRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

function LoadingState() { return <p className="text-muted-foreground text-sm py-4">Loading…</p>; }
function ErrorState({ msg }: { msg?: string }) { return <p className="text-destructive text-sm py-4">{msg ?? "Failed to load"}</p>; }

// ─── System tab ───────────────────────────────────────────────────────────────
function SystemTab() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/platform/audit/system"], staleTime: 30000 });
  if (isLoading) return <LoadingState />;
  if (!data) return <ErrorState />;
  return (
    <div className="space-y-4">
      <SectionCard title="Runtime" icon={Server}>
        <KVRow label="Node version" value={data.nodeVersion} mono />
        <KVRow label="Platform" value={data.platform} />
        <KVRow label="Architecture" value={data.arch} />
        <KVRow label="Uptime" value={`${Math.floor(data.uptimeSeconds / 60)}m ${data.uptimeSeconds % 60}s`} />
        <KVRow label="Memory (RSS)" value={`${Math.round(data.memoryMb)} MB`} />
        <KVRow label="Environment" value={<Badge variant={data.nodeEnv === "production" ? "default" : "secondary"}>{data.nodeEnv}</Badge>} />
        <KVRow label="Port" value={data.port} mono />
        <KVRow label="Hostname" value={data.hostname} mono />
      </SectionCard>
      <SectionCard title="Git" icon={GitBranch}>
        <KVRow label="Commit" value={data.git?.commit ?? "unknown"} mono />
        <KVRow label="Branch" value={data.git?.branch ?? "unknown"} mono />
        <KVRow label="Commit date" value={data.git?.date ?? "unknown"} />
        <KVRow label="Author" value={data.git?.author ?? "unknown"} />
      </SectionCard>
    </div>
  );
}

// ─── Deploy tab ───────────────────────────────────────────────────────────────
function DeployTab() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/platform/audit/deploy"], staleTime: 30000 });
  if (isLoading) return <LoadingState />;
  if (!data) return <ErrorState />;
  const overall = data.readiness?.overall;
  return (
    <div className="space-y-4">
      <div className={`rounded-lg border-2 p-4 flex items-center gap-3 ${overall ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-destructive bg-red-50 dark:bg-red-950/30"}`}>
        {overall ? <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" /> : <XCircle className="h-6 w-6 text-destructive shrink-0" />}
        <div>
          <p className="font-semibold">{overall ? "Production Ready" : "Not Production Ready"}</p>
          <p className="text-sm text-muted-foreground">{overall ? "All required env vars are set." : `Missing: ${data.missingRequiredVars?.join(", ")}`}</p>
        </div>
      </div>
      <SectionCard title="Environment" icon={Rocket}>
        <KVRow label="NODE_ENV" value={<Badge variant={data.environment === "production" ? "default" : "secondary"}>{data.environment}</Badge>} />
        <KVRow label="Port" value={data.port} mono />
        <KVRow label="APP_BASE_URL" value={data.appBaseUrl ?? <span className="text-amber-600 text-xs">Not set</span>} mono />
      </SectionCard>
      <SectionCard title="Required Env Vars" icon={Key}>
        {(data.requiredEnvVars ?? []).map((k: string) => (
          <KVRow key={k} label={k}
            value={<StatusBadge ok={!data.missingRequiredVars?.includes(k)} label={data.missingRequiredVars?.includes(k) ? "MISSING" : "Set"} />}
          />
        ))}
      </SectionCard>
      <SectionCard title="Optional Env Vars" icon={Key} description="Missing optional vars reduce functionality but don't block deployment">
        {(data.optionalEnvVars ?? []).map((k: string) => (
          <KVRow key={k} label={k}
            value={<StatusBadge ok={!data.missingOptionalVars?.includes(k)} warn={data.missingOptionalVars?.includes(k)} label={data.missingOptionalVars?.includes(k) ? "Not set" : "Set"} />}
          />
        ))}
      </SectionCard>
      <SectionCard title="Git" icon={GitBranch}>
        <KVRow label="Commit" value={data.git?.commit ?? "unknown"} mono />
        <KVRow label="Branch" value={data.git?.branch ?? "unknown"} mono />
        <KVRow label="Date" value={data.git?.date ?? "unknown"} />
        <KVRow label="Author" value={data.git?.author ?? "unknown"} />
      </SectionCard>
      {data.pm2 && Array.isArray(data.pm2) && (
        <SectionCard title="PM2 Processes" icon={Server}>
          {data.pm2.map((p: any) => (
            <KVRow key={p.name} label={p.name}
              value={
                <div className="flex items-center gap-2">
                  <StatusBadge ok={p.status === "online"} label={p.status} />
                  {p.restarts != null && <span className="text-xs text-muted-foreground">{p.restarts} restarts</span>}
                </div>
              }
            />
          ))}
        </SectionCard>
      )}
    </div>
  );
}

// ─── Integrations tab ─────────────────────────────────────────────────────────
function IntegrationsTab() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/platform/audit/integrations"], staleTime: 30000 });
  if (isLoading) return <LoadingState />;
  if (!data) return <ErrorState />;
  return (
    <div className="space-y-4">
      <SectionCard title="SMTP / Email" icon={FileText}>
        <KVRow label="Configured" value={<StatusBadge ok={data.smtp.configured} label={data.smtp.configured ? "Configured" : "Not configured"} />} />
        {data.smtp.missing?.length > 0 && (
          <KVRow label="Missing vars" value={
            <div className="flex flex-wrap gap-1 justify-end">
              {data.smtp.missing.map((v: string) => <Badge key={v} variant="destructive" className="text-xs font-mono">{v}</Badge>)}
            </div>
          } />
        )}
        <KVRow label="SMTP_HOST" value={<StatusBadge ok={data.smtp.hasHost} warn={!data.smtp.hasHost && !!data.smtp.derivedHost} label={data.smtp.hasHost ? "Set" : data.smtp.derivedHost ? "Auto-derived" : "Not set"} />} />
        <KVRow label="SMTP_USER" value={<StatusBadge ok={data.smtp.hasUser} label={data.smtp.hasUser ? "Set" : "Not set"} />} />
        <KVRow label="SMTP_PASS" value={<StatusBadge ok={data.smtp.hasPass} label={data.smtp.hasPass ? "Set" : "Not set"} />} />
        <KVRow label="FROM address" value={data.smtp.from ?? "—"} mono />
        {data.smtp.derivedHost && <KVRow label="Host (derived)" value={<span className="font-mono text-xs text-amber-600">{data.smtp.derivedHost} (auto)</span>} />}
      </SectionCard>
      <SectionCard title="SMS / Twilio" icon={FileText}>
        <KVRow label="Configured" value={<StatusBadge ok={data.twilio.configured} label={data.twilio.configured ? "Configured" : "Not configured"} />} />
        {data.twilio.missing?.length > 0 && (
          <KVRow label="Missing vars" value={
            <div className="flex flex-wrap gap-1 justify-end">
              {data.twilio.missing.map((v: string) => <Badge key={v} variant="destructive" className="text-xs font-mono">{v}</Badge>)}
            </div>
          } />
        )}
        <KVRow label="TWILIO_ACCOUNT_SID" value={<StatusBadge ok={data.twilio.hasSid} label={data.twilio.hasSid ? "Set" : "Not set"} />} />
        <KVRow label="TWILIO_AUTH_TOKEN" value={<StatusBadge ok={data.twilio.hasToken} label={data.twilio.hasToken ? "Set" : "Not set"} />} />
        <KVRow label="TWILIO_PHONE_NUMBER" value={<StatusBadge ok={data.twilio.hasPhone} label={data.twilio.hasPhone ? "Set" : "Not set"} />} />
      </SectionCard>
      <SectionCard title="Stripe" icon={CreditCard}>
        <KVRow label="Configured" value={<StatusBadge ok={data.stripe.configured} />} />
        <KVRow label="STRIPE_SECRET_KEY" value={<StatusBadge ok={data.stripe.hasSecret} label={data.stripe.hasSecret ? "Set" : "Not set"} />} />
        <KVRow label="STRIPE_WEBHOOK_SECRET" value={<StatusBadge ok={data.stripe.hasWebhook} label={data.stripe.hasWebhook ? "Set" : "Not set"} />} />
      </SectionCard>
      <SectionCard title="Database" icon={Database}>
        <KVRow label="DATABASE_URL" value={<StatusBadge ok={data.db.hasUrl} label={data.db.hasUrl ? "Set" : "Not set"} />} />
        <KVRow label="Connection" value={<StatusBadge ok={data.db.connected} label={data.db.connected ? "Connected" : "Failed"} />} />
        <KVRow label="Table count" value={data.db.tableCount ?? "—"} />
      </SectionCard>
    </div>
  );
}

// ─── Features tab ─────────────────────────────────────────────────────────────
function FeaturesTab() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/platform/audit/features"], staleTime: 60000 });
  if (isLoading) return <LoadingState />;
  if (!data) return <ErrorState />;
  const features: any[] = data.features ?? [];
  const modules = [...new Set(features.map((f: any) => f.module))].sort();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          { label: "Total Features", count: features.length, color: "default" },
          { label: "Enabled", count: features.filter((f: any) => f.enabled).length, color: "emerald" },
          { label: "Gated / Missing Config", count: features.filter((f: any) => f.gated).length, color: "amber" },
        ].map(({ label, count, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3 text-center">
              <p className={`text-2xl font-bold ${color === "emerald" ? "text-emerald-600" : color === "amber" ? "text-amber-600" : ""}`}>{count}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {modules.map(mod => (
        <SectionCard key={mod} title={`Module: ${mod}`} icon={Layers}>
          {features.filter((f: any) => f.module === mod).map((f: any) => (
            <div key={f.id} className="flex items-start justify-between py-1.5 border-b border-border/40 last:border-0 gap-2">
              <div>
                <p className="text-sm font-medium">{f.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{f.id}</p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <StatusBadge ok={f.enabled} label={f.enabled ? "Enabled" : "Disabled"} />
                {f.gated && f.missingFor?.length > 0 && (
                  <div className="flex flex-wrap gap-1 justify-end">
                    {f.missingFor.map((m: string) => <Badge key={m} variant="outline" className="text-xs font-mono text-amber-600">{m}</Badge>)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </SectionCard>
      ))}
      {data.registries && (
        <SectionCard title="Module Gating Rules" icon={Lock} description="Which env vars gate which modules">
          {(data.registries.moduleGatingRules ?? []).map((r: any) => (
            <div key={r.module} className="flex items-start justify-between py-1.5 border-b border-border/40 last:border-0 gap-2">
              <span className="text-sm font-mono">{r.module}</span>
              <div className="flex flex-wrap gap-1 justify-end">
                {r.requiresEnvVars.map((v: string) => <Badge key={v} variant="outline" className="text-xs font-mono">{v}</Badge>)}
              </div>
            </div>
          ))}
        </SectionCard>
      )}
    </div>
  );
}

// ─── Roles tab ────────────────────────────────────────────────────────────────
function RolesTab() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/platform/audit/roles"], staleTime: 60000 });
  if (isLoading) return <LoadingState />;
  if (!data) return <ErrorState />;
  return (
    <div className="space-y-4">
      {Object.entries(data.layers as Record<string, any[]>).map(([layer, roles]) => (
        <SectionCard key={layer} title={layer} icon={Shield}>
          <div className="space-y-1">
            {roles.map((r: any) => (
              <div key={r.role} className="flex items-start justify-between gap-3 py-1.5 border-b border-border/40 last:border-0">
                <div>
                  <span className="font-mono text-xs font-medium">{r.role}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
                </div>
                <div className="flex flex-wrap gap-1 justify-end shrink-0">
                  {r.aliases?.map((a: string) => <Badge key={a} variant="outline" className="text-xs font-mono">{a}</Badge>)}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      ))}
    </div>
  );
}

// ─── Routes tab ───────────────────────────────────────────────────────────────
function RoutesTab() {
  const [filter, setFilter] = useState("");
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/platform/audit/routes"], staleTime: 60000 });
  if (isLoading) return <LoadingState />;
  if (!data) return <ErrorState />;
  const routes: any[] = data.routes ?? [];
  const filtered = routes.filter(r =>
    !filter || r.path.toLowerCase().includes(filter.toLowerCase()) || r.method.toLowerCase().includes(filter.toLowerCase())
  );
  const methodColor: Record<string, string> = {
    GET: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    POST: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    PATCH: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
    PUT: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
    DELETE: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input className="border rounded px-3 py-1.5 text-sm flex-1 max-w-xs bg-background" placeholder="Filter routes…" value={filter} onChange={e => setFilter(e.target.value)} data-testid="input-route-filter" />
        <Badge variant="secondary">{filtered.length} / {routes.length} routes</Badge>
      </div>
      <ScrollArea className="h-[500px] border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow><TableHead className="w-[80px]">Method</TableHead><TableHead>Path</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r, i) => (
              <TableRow key={i}>
                <TableCell><span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${methodColor[r.method] ?? "bg-gray-100 text-gray-800"}`}>{r.method}</span></TableCell>
                <TableCell className="font-mono text-xs">{r.path}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}

// ─── Tenants tab ──────────────────────────────────────────────────────────────
function TenantsTab() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/platform/audit/tenants"], staleTime: 30000 });
  if (isLoading) return <LoadingState />;
  if (!data) return <ErrorState />;
  const tenants: any[] = data.tenants ?? [];
  return (
    <div className="space-y-3">
      <Badge variant="secondary">{tenants.length} tenant{tenants.length !== 1 ? "s" : ""}</Badge>
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Workers</TableHead>
              <TableHead>Trial End</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.map((t: any) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell>{t.plan_name ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={["past_due", "cancelled", "suspended"].includes(t.subscription_status) ? "destructive" : t.subscription_status === "trial_active" ? "secondary" : "default"} className="text-xs capitalize">
                    {t.subscription_status ?? "unknown"}
                  </Badge>
                </TableCell>
                <TableCell>{t.worker_count ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{t.trial_end ? new Date(t.trial_end).toLocaleDateString() : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Contracts tab ────────────────────────────────────────────────────────────
function ContractsTab() {
  const { data, isLoading, refetch } = useQuery<any>({ queryKey: ["/api/platform/audit/contracts"], staleTime: 30000 });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const signMutation = useMutation({
    mutationFn: (companyId: string) => apiRequest("POST", `/api/platform/audit/contracts/${companyId}/sign`, {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/platform/audit/contracts"] }); toast({ title: "Agreement marked as signed" }); },
    onError: () => toast({ title: "Failed to mark agreement", variant: "destructive" }),
  });
  if (isLoading) return <LoadingState />;
  if (!data) return <ErrorState />;
  const contracts: any[] = data.contracts ?? [];
  const blocked = contracts.filter((c: any) => c.accessStatus.startsWith("blocked"));
  return (
    <div className="space-y-4">
      {blocked.length > 0 && (
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <p className="font-semibold text-amber-800 dark:text-amber-200">{blocked.length} tenant{blocked.length !== 1 ? "s" : ""} currently blocked</p>
          </div>
          <div className="space-y-1">
            {blocked.map((c: any) => (
              <p key={c.companyId} className="text-sm text-amber-700 dark:text-amber-300">• {c.companyName} — <span className="font-mono">{c.accessStatus}</span></p>
            ))}
          </div>
        </div>
      )}
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Subscription</TableHead>
              <TableHead>Agreement</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contracts.map((c: any) => (
              <TableRow key={c.companyId}>
                <TableCell className="font-medium">{c.companyName}{c.isDemo && <Badge variant="outline" className="ml-2 text-xs">demo</Badge>}</TableCell>
                <TableCell className="text-xs">{c.planName ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={["blocked_past_due", "blocked_cancelled", "blocked_suspended"].includes(c.accessStatus) ? "destructive" : "secondary"} className="text-xs capitalize">
                    {c.subscriptionStatus ?? "—"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {c.agreementOnFile
                    ? <div className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /><span className="text-xs">{c.agreementSignedAt ? new Date(c.agreementSignedAt).toLocaleDateString() : "On file"}</span></div>
                    : <div className="flex items-center gap-1"><XCircle className="h-3.5 w-3.5 text-amber-500" /><span className="text-xs text-muted-foreground">Not signed</span></div>}
                </TableCell>
                <TableCell>
                  <Badge variant={c.accessStatus === "active" || c.accessStatus === "trial" || c.accessStatus === "demo_exempt" ? "default" : c.accessStatus === "grace" ? "secondary" : "destructive"} className="text-xs">
                    {c.accessStatus.replace(/_/g, " ")}
                  </Badge>
                </TableCell>
                <TableCell>
                  {!c.agreementOnFile && !c.isDemo && (
                    <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => signMutation.mutate(c.companyId)} disabled={signMutation.isPending} data-testid={`button-sign-agreement-${c.companyId}`}>
                      Mark Signed
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Licensing tab ────────────────────────────────────────────────────────────
function LicensingTab() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/platform/audit/licensing"], staleTime: 30000 });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [overrideCompany, setOverrideCompany] = useState<string | null>(null);
  const [overrideStatus, setOverrideStatus] = useState("active_paid");
  const overrideMutation = useMutation({
    mutationFn: ({ companyId, status }: { companyId: string; status: string }) =>
      apiRequest("POST", `/api/platform/audit/licensing/${companyId}/gate-override`, { subscriptionStatus: status, reason: "Platform override by super admin" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/audit/licensing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/audit/contracts"] });
      setOverrideCompany(null);
      toast({ title: "Subscription status updated" });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });
  if (isLoading) return <LoadingState />;
  if (!data) return <ErrorState />;
  const plans: any[] = data.licensing ?? [];
  const summary = data.summary ?? {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
        {[
          { label: "Total", count: summary.total, cls: "" },
          { label: "Licensed", count: summary.licensed, cls: "text-emerald-600" },
          { label: "Trial", count: summary.trial, cls: "text-blue-600" },
          { label: "Demo", count: summary.demo, cls: "text-purple-600" },
          { label: "Grace", count: summary.grace, cls: "text-amber-600" },
          { label: "Unlicensed", count: summary.unlicensed, cls: "text-red-600" },
        ].map(({ label, count, cls }) => (
          <Card key={label}><CardContent className="pt-3 pb-2 text-center"><p className={`text-xl font-bold ${cls}`}>{count ?? 0}</p><p className="text-xs text-muted-foreground">{label}</p></CardContent></Card>
        ))}
      </div>
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>License</TableHead>
              <TableHead>Workers</TableHead>
              <TableHead>Trial End</TableHead>
              <TableHead>Override</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((p: any) => (
              <TableRow key={p.companyId}>
                <TableCell className="font-medium">{p.companyName}{p.isDemo && <Badge variant="outline" className="ml-2 text-xs">demo</Badge>}</TableCell>
                <TableCell className="text-xs">{p.planName ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={p.licenseStatus === "licensed" ? "default" : p.licenseStatus === "trial" ? "secondary" : p.licenseStatus === "demo" ? "outline" : "destructive"} className="text-xs">
                    {p.licenseStatus}
                  </Badge>
                </TableCell>
                <TableCell>{p.activeWorkers}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{p.trialEnd ? new Date(p.trialEnd).toLocaleDateString() : "—"}</TableCell>
                <TableCell>
                  {overrideCompany === p.companyId ? (
                    <div className="flex items-center gap-2">
                      <Select value={overrideStatus} onValueChange={setOverrideStatus}>
                        <SelectTrigger className="h-7 text-xs w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active_paid">active_paid</SelectItem>
                          <SelectItem value="trial_active">trial_active</SelectItem>
                          <SelectItem value="grace">grace</SelectItem>
                          <SelectItem value="past_due">past_due</SelectItem>
                          <SelectItem value="cancelled">cancelled</SelectItem>
                          <SelectItem value="suspended">suspended</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="h-7 text-xs" onClick={() => overrideMutation.mutate({ companyId: p.companyId, status: overrideStatus })} disabled={overrideMutation.isPending}>Save</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOverrideCompany(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setOverrideCompany(p.companyId); setOverrideStatus(p.subscriptionStatus ?? "active_paid"); }} data-testid={`button-override-${p.companyId}`}>
                      Override
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Billing tab ──────────────────────────────────────────────────────────────
function BillingTab() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/platform/audit/billing"], staleTime: 30000 });
  if (isLoading) return <LoadingState />;
  if (!data) return <ErrorState />;
  const billing: any[] = data.billing ?? [];
  const summary = data.summary ?? {};
  const healthColor: Record<string, string> = {
    healthy: "bg-emerald-100 text-emerald-800", trial: "bg-blue-100 text-blue-800",
    exempt: "bg-purple-100 text-purple-800", grace: "bg-amber-100 text-amber-800",
    past_due: "bg-red-100 text-red-800", cancelled: "bg-gray-100 text-gray-800",
    suspended: "bg-red-200 text-red-900",
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        {[
          { label: "Healthy", count: summary.healthy, cls: "text-emerald-600" },
          { label: "Trial", count: summary.trial, cls: "text-blue-600" },
          { label: "Grace", count: summary.grace, cls: "text-amber-600" },
          { label: "Past Due", count: summary.pastDue, cls: "text-red-600" },
        ].map(({ label, count, cls }) => (
          <Card key={label}><CardContent className="pt-3 pb-2 text-center"><p className={`text-xl font-bold ${cls}`}>{count ?? 0}</p><p className="text-xs text-muted-foreground">{label}</p></CardContent></Card>
        ))}
      </div>
      <SectionCard title="Stripe" icon={CreditCard}>
        <KVRow label="Stripe Configured" value={<StatusBadge ok={data.stripeConfigured} />} />
        <KVRow label="Webhook Configured" value={<StatusBadge ok={data.stripeWebhookConfigured} />} />
      </SectionCard>
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Billing Health</TableHead>
              <TableHead>Payment on File</TableHead>
              <TableHead>Stripe Customer</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {billing.map((b: any) => (
              <TableRow key={b.companyId}>
                <TableCell className="font-medium">{b.companyName}{b.isDemo && <Badge variant="outline" className="ml-2 text-xs">demo</Badge>}</TableCell>
                <TableCell className="text-xs">{b.planName ?? "—"}</TableCell>
                <TableCell>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${healthColor[b.billingHealth] ?? "bg-gray-100 text-gray-800"}`}>
                    {b.billingHealth?.replace(/_/g, " ")}
                  </span>
                </TableCell>
                <TableCell>{b.paymentMethodOnFile ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}</TableCell>
                <TableCell>{b.hasStripeCustomer ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Migrations tab ───────────────────────────────────────────────────────────
function MigrationsTab() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/platform/audit/migrations"], staleTime: 60000 });
  if (isLoading) return <LoadingState />;
  if (!data) return <ErrorState />;
  const migrations: any[] = data.migrations ?? [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          { label: "Tables", count: migrations.filter(m => m.type === "table").length, icon: Database },
          { label: "Columns", count: migrations.filter(m => m.type === "column").length, icon: FileText },
          { label: "Seeds", count: migrations.filter(m => m.type === "seed").length, icon: CheckCircle2 },
        ].map(({ label, count, icon: Icon }) => (
          <Card key={label}><CardContent className="pt-4 pb-3 text-center"><Icon className="h-5 w-5 mx-auto mb-1 text-muted-foreground" /><p className="text-2xl font-bold">{count}</p><p className="text-xs text-muted-foreground">{label}</p></CardContent></Card>
        ))}
      </div>
      <ScrollArea className="h-[400px] border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Migration</TableHead><TableHead className="w-[80px]">Type</TableHead><TableHead className="w-[80px]">Status</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {migrations.map((m: any, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{m.key}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{m.type}</Badge></TableCell>
                <TableCell>{m.status === "ok" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-destructive" />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}

// ─── Logs tab ─────────────────────────────────────────────────────────────────
function LogsTab() {
  const { data: appData, isLoading: appLoading } = useQuery<any>({ queryKey: ["/api/platform/audit/logs/app"], staleTime: 30000 });
  const { data: deployData, isLoading: deployLoading } = useQuery<any>({ queryKey: ["/api/platform/audit/logs/deploy"], staleTime: 30000 });
  return (
    <div className="space-y-4">
      <SectionCard title="Recent Git Commits" icon={GitBranch} description="Last 30 commits in the repository">
        {deployLoading ? <LoadingState /> : (
          <ScrollArea className="h-[250px]">
            {(deployData?.recentCommits ?? []).map((c: any, i: number) => (
              <div key={i} className="flex items-start gap-3 py-1.5 border-b border-border/40 last:border-0">
                <span className="font-mono text-xs text-muted-foreground shrink-0 w-16">{c.commit}</span>
                <span className="text-sm">{c.message}</span>
              </div>
            ))}
            {(!deployData?.recentCommits?.length) && <p className="text-sm text-muted-foreground py-2">No git history available</p>}
          </ScrollArea>
        )}
        {deployData?.lastDiffStat && (
          <div className="mt-3 pt-3 border-t">
            <p className="text-xs font-medium mb-1 text-muted-foreground">Last commit diff stat:</p>
            <pre className="text-xs bg-muted rounded p-2 overflow-auto">{deployData.lastDiffStat}</pre>
          </div>
        )}
        {deployData?.undeployedCommits?.length > 0 && (
          <div className="mt-3 pt-3 border-t">
            <p className="text-xs font-medium text-amber-600 mb-1">Undeployed commits (ahead of origin/main):</p>
            {deployData.undeployedCommits.map((c: any, i: number) => (
              <p key={i} className="text-xs font-mono text-amber-700">{c.commit} {c.message}</p>
            ))}
          </div>
        )}
      </SectionCard>
      <SectionCard title="Automation Events (Recent)" icon={BarChart3}>
        {appLoading ? <LoadingState /> : (
          <ScrollArea className="h-[200px]">
            {(appData?.automationEvents ?? []).map((e: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0 gap-2">
                <div>
                  <span className="text-sm">{e.trigger}</span>
                  <p className="text-xs text-muted-foreground">{e.companyName}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={e.status === "completed" ? "default" : e.status === "failed" ? "destructive" : "secondary"} className="text-xs">{e.status}</Badge>
                  <span className="text-xs text-muted-foreground">{e.at ? new Date(e.at).toLocaleDateString() : "—"}</span>
                </div>
              </div>
            ))}
            {!appData?.automationEvents?.length && <p className="text-sm text-muted-foreground py-2">No automation events found</p>}
          </ScrollArea>
        )}
      </SectionCard>
      <SectionCard title="Recent Payroll Runs" icon={ScrollText}>
        {appLoading ? <LoadingState /> : (
          <ScrollArea className="h-[200px]">
            {(appData?.payrollLog ?? []).map((r: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0 gap-2">
                <div>
                  <span className="text-sm">{r.companyName}</span>
                  <p className="text-xs text-muted-foreground">Pay date: {r.payDate ?? "—"}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={r.status === "completed" ? "default" : r.status === "draft" ? "outline" : "secondary"} className="text-xs">{r.status}</Badge>
                  <span className="text-xs text-muted-foreground">{r.at ? new Date(r.at).toLocaleDateString() : "—"}</span>
                </div>
              </div>
            ))}
            {!appData?.payrollLog?.length && <p className="text-sm text-muted-foreground py-2">No payroll runs found</p>}
          </ScrollArea>
        )}
      </SectionCard>
    </div>
  );
}

// ─── Permissions tab ──────────────────────────────────────────────────────────
function PermissionsTab() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/platform/audit/permissions"], staleTime: 60000 });
  if (isLoading) return <LoadingState />;
  if (!data) return <ErrorState />;
  const perms: any[] = data.permissions ?? [];
  const byRole: Record<string, any[]> = {};
  for (const p of perms) {
    if (!byRole[p.role_name]) byRole[p.role_name] = [];
    byRole[p.role_name].push(p);
  }
  return (
    <div className="space-y-4">
      <Badge variant="secondary">{perms.length} permission row{perms.length !== 1 ? "s" : ""} across {Object.keys(byRole).length} role{Object.keys(byRole).length !== 1 ? "s" : ""}</Badge>
      {Object.entries(byRole).map(([role, ps]) => (
        <SectionCard key={role} title={role} icon={Key}>
          <ScrollArea className="max-h-[300px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resource</TableHead>
                  <TableHead className="w-12 text-center">View</TableHead>
                  <TableHead className="w-12 text-center">Create</TableHead>
                  <TableHead className="w-12 text-center">Edit</TableHead>
                  <TableHead className="w-12 text-center">Delete</TableHead>
                  <TableHead className="w-12 text-center">Export</TableHead>
                  <TableHead className="w-12 text-center">Approve</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ps.map((p: any, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{p.resource}</TableCell>
                    {["can_view", "can_create", "can_edit", "can_delete", "can_export", "can_approve"].map(col => (
                      <TableCell key={col} className="text-center">
                        {p[col] ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mx-auto" /> : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </SectionCard>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PlatformAuditPage() {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  async function downloadBundle() {
    setExporting(true);
    try {
      const data = await apiRequest("GET", "/api/platform/audit/export");
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `paylink-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Audit bundle downloaded", description: "Upload this JSON to ChatGPT for cross-reference." });
    } catch {
      toast({ title: "Failed to download audit bundle", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Platform Audit Surface</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Read-only deployment state. Platform super admin only. Export the JSON bundle and upload to ChatGPT for production readiness cross-reference.
          </p>
        </div>
        <Button onClick={downloadBundle} disabled={exporting} data-testid="button-download-audit">
          <Download className="h-4 w-4 mr-2" />
          {exporting ? "Exporting…" : "Export Audit Bundle"}
        </Button>
      </div>

      <Tabs defaultValue="system">
        <TabsList className="flex-wrap h-auto gap-1 p-1" data-testid="tabs-platform-audit">
          <TabsTrigger value="system" data-testid="tab-audit-system"><Server className="h-3.5 w-3.5 mr-1" />System</TabsTrigger>
          <TabsTrigger value="deploy" data-testid="tab-audit-deploy"><Rocket className="h-3.5 w-3.5 mr-1" />Deploy</TabsTrigger>
          <TabsTrigger value="integrations" data-testid="tab-audit-integrations"><Plug className="h-3.5 w-3.5 mr-1" />Integrations</TabsTrigger>
          <TabsTrigger value="features" data-testid="tab-audit-features"><Layers className="h-3.5 w-3.5 mr-1" />Features</TabsTrigger>
          <TabsTrigger value="roles" data-testid="tab-audit-roles"><Shield className="h-3.5 w-3.5 mr-1" />Roles</TabsTrigger>
          <TabsTrigger value="permissions" data-testid="tab-audit-permissions"><Key className="h-3.5 w-3.5 mr-1" />Permissions</TabsTrigger>
          <TabsTrigger value="routes" data-testid="tab-audit-routes"><Terminal className="h-3.5 w-3.5 mr-1" />Routes</TabsTrigger>
          <TabsTrigger value="tenants" data-testid="tab-audit-tenants"><Building2 className="h-3.5 w-3.5 mr-1" />Tenants</TabsTrigger>
          <TabsTrigger value="contracts" data-testid="tab-audit-contracts"><FileText className="h-3.5 w-3.5 mr-1" />Contracts</TabsTrigger>
          <TabsTrigger value="licensing" data-testid="tab-audit-licensing"><Unlock className="h-3.5 w-3.5 mr-1" />Licensing</TabsTrigger>
          <TabsTrigger value="billing" data-testid="tab-audit-billing"><CreditCard className="h-3.5 w-3.5 mr-1" />Billing</TabsTrigger>
          <TabsTrigger value="migrations" data-testid="tab-audit-migrations"><Database className="h-3.5 w-3.5 mr-1" />Migrations</TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-audit-logs"><ScrollText className="h-3.5 w-3.5 mr-1" />Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="system" className="mt-6"><SystemTab /></TabsContent>
        <TabsContent value="deploy" className="mt-6"><DeployTab /></TabsContent>
        <TabsContent value="integrations" className="mt-6"><IntegrationsTab /></TabsContent>
        <TabsContent value="features" className="mt-6"><FeaturesTab /></TabsContent>
        <TabsContent value="roles" className="mt-6"><RolesTab /></TabsContent>
        <TabsContent value="permissions" className="mt-6"><PermissionsTab /></TabsContent>
        <TabsContent value="routes" className="mt-6"><RoutesTab /></TabsContent>
        <TabsContent value="tenants" className="mt-6"><TenantsTab /></TabsContent>
        <TabsContent value="contracts" className="mt-6"><ContractsTab /></TabsContent>
        <TabsContent value="licensing" className="mt-6"><LicensingTab /></TabsContent>
        <TabsContent value="billing" className="mt-6"><BillingTab /></TabsContent>
        <TabsContent value="migrations" className="mt-6"><MigrationsTab /></TabsContent>
        <TabsContent value="logs" className="mt-6"><LogsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
