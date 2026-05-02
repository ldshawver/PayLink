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
  Rocket, Layers, CreditCard, BarChart3, ScrollText, Lock, Unlock, AlertTriangle,
  ClipboardCheck, ChevronDown, ChevronRight, Filter, AlertOctagon,
  FlaskConical, BookOpen, Users, Cpu, Globe, FileSignature, Bell,
  ShieldCheck, UserCheck, Banknote, Receipt, Printer, FileCheck2
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

// ─── Readiness tab helpers ────────────────────────────────────────────────────
const AREA_ICONS: Record<string, any> = {
  payroll_engine: Cpu, tax_calculations: Receipt, pay_period_schedules: Clock,
  multi_company_income: Building2, paystubs: FileText, check_printing: Printer,
  ach_stripe: Banknote, reports_exports: BarChart3, ca_compliance: Globe,
  multi_state: Globe, document_mgmt: BookOpen, onboarding_packets: UserCheck,
  contractor_workflow: FileSignature, esignatures: FileCheck2, notifications: Bell,
  rbac: Shield, tenant_isolation: Lock, audit_logs: ScrollText, soc2: ShieldCheck,
  gdpr: Shield, demo_provisioning: FlaskConical, customer_onboarding: Users,
};

function RiskBadge({ level }: { level: string }) {
  const cls: Record<string, string> = {
    critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    low: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  };
  return <Badge className={`text-xs font-medium ${cls[level] ?? ""}`}>{level}</Badge>;
}

function AreaStatusIcon({ status }: { status: string }) {
  if (status === "pass") return <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />;
  return <AlertOctagon className="h-5 w-5 text-red-500 shrink-0" />;
}

function AreaCard({ area }: { area: any }) {
  const [open, setOpen] = useState(false);
  const Icon = AREA_ICONS[area.id] ?? FileText;
  const borderCls = area.status === "pass"
    ? "border-emerald-200 dark:border-emerald-800"
    : area.status === "warning"
    ? "border-amber-200 dark:border-amber-800"
    : "border-red-200 dark:border-red-800";

  return (
    <div className={`border rounded-lg overflow-hidden ${borderCls}`} data-testid={`card-readiness-${area.id}`}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(o => !o)}
        data-testid={`button-readiness-expand-${area.id}`}
      >
        <span className="text-muted-foreground shrink-0 text-xs font-mono w-5 text-right">{area.recommendedFixOrder}</span>
        <AreaStatusIcon status={area.status} />
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{area.name}</span>
            <RiskBadge level={area.riskLevel} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{area.summary}</p>
        </div>
        {area.blockingIssue && (
          <span className="text-xs text-red-600 dark:text-red-400 font-medium shrink-0 hidden sm:block max-w-[200px] truncate">
            ⛔ {area.blockingIssue}
          </span>
        )}
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t bg-muted/20 px-4 pb-4 pt-3 space-y-4">
          {area.blockingIssue && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 px-3 py-2">
              <AlertOctagon className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-300 font-medium">{area.blockingIssue}</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Missing pieces */}
            {area.missingPieces?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Missing / Gaps</p>
                <ul className="space-y-1">
                  {area.missingPieces.map((m: string, i: number) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs">
                      <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                      <span>{m}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Test cases */}
            {area.testCases?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Test Cases</p>
                <ul className="space-y-1">
                  {area.testCases.map((t: string, i: number) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs">
                      <FlaskConical className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            {/* Affected tables */}
            <div>
              <p className="font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Affected Tables</p>
              <div className="flex flex-wrap gap-1">
                {area.affectedTables?.map((t: string) => (
                  <span key={t} className="font-mono bg-muted border rounded px-1.5 py-0.5 text-xs">{t}</span>
                ))}
              </div>
            </div>

            {/* Affected routes */}
            <div>
              <p className="font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Affected Routes</p>
              <div className="space-y-0.5">
                {area.affectedRoutes?.map((r: string, i: number) => (
                  <p key={i} className="font-mono text-xs text-muted-foreground">{r}</p>
                ))}
              </div>
            </div>

            {/* Affected UI + owner */}
            <div>
              <p className="font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Affected UI</p>
              <div className="flex flex-wrap gap-1 mb-2">
                {area.affectedUi?.map((u: string) => (
                  <span key={u} className="bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 rounded px-1.5 py-0.5 text-xs">{u}</span>
                ))}
              </div>
              <p className="text-muted-foreground">Owner: <span className="font-medium text-foreground">{area.owner}</span></p>
            </div>
          </div>

          {/* SOC2 checks (special) */}
          {area.id === "soc2" && Array.isArray(area.evidence?.checks) && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Baseline Control Checks</p>
              <div className="space-y-1">
                {area.evidence.checks.map((c: any, i: number) => (
                  <div key={i} className="flex items-center gap-2">
                    {c.pass ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <XCircle className="h-3.5 w-3.5 text-red-500" />}
                    <span className="text-xs">{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tenant isolation checks (special) */}
          {area.id === "tenant_isolation" && Array.isArray(area.evidence?.isoChecks) && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Table Isolation Checks</p>
              <div className="flex flex-wrap gap-2">
                {area.evidence.isoChecks.map((c: any, i: number) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs">
                    {c.hasCompanyId ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <XCircle className="h-3.5 w-3.5 text-red-500" />}
                    <span className="font-mono">{c.table}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Readiness tab ────────────────────────────────────────────────────────────
function ReadinessTab() {
  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["/api/platform/audit/readiness"],
    staleTime: 60000,
  });
  const [statusFilter, setStatusFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [search, setSearch] = useState("");

  if (isLoading) return <LoadingState />;
  if (!data) return <ErrorState />;

  const areas: any[] = data.areas ?? [];
  const summary = data.summary ?? {};

  const filtered = areas.filter((a: any) => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (riskFilter !== "all" && a.riskLevel !== riskFilter) return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase()) && !a.summary.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Summary scorecard */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Pass", count: summary.pass ?? 0, cls: "text-emerald-600", bg: "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20" },
          { label: "Warning", count: summary.warning ?? 0, cls: "text-amber-600", bg: "border-amber-200 bg-amber-50 dark:bg-amber-950/20" },
          { label: "Fail", count: summary.fail ?? 0, cls: "text-red-600", bg: "border-red-200 bg-red-50 dark:bg-red-950/20" },
          { label: "Critical Fails", count: summary.critical_fails ?? 0, cls: "text-red-800 font-bold", bg: "border-red-400 bg-red-100 dark:bg-red-950/40" },
        ].map(({ label, count, cls, bg }) => (
          <Card key={label} className={`border ${bg}`}>
            <CardContent className="pt-4 pb-3 text-center">
              <p className={`text-3xl font-bold ${cls}`}>{count}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Overall status banner */}
      {summary.critical_fails > 0 ? (
        <div className="flex items-center gap-3 rounded-lg border-2 border-red-500 bg-red-50 dark:bg-red-950/30 px-4 py-3">
          <AlertOctagon className="h-5 w-5 text-red-600 shrink-0" />
          <div>
            <p className="font-semibold text-red-800 dark:text-red-200">Not Production Ready — {summary.critical_fails} critical area{summary.critical_fails !== 1 ? "s" : ""} failing</p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">Resolve all critical fails before going live. See fix order (column #) for priority.</p>
          </div>
        </div>
      ) : summary.fail > 0 ? (
        <div className="flex items-center gap-3 rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
          <div>
            <p className="font-semibold text-amber-800 dark:text-amber-200">{summary.fail} area{summary.fail !== 1 ? "s" : ""} failing — review before production</p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">No critical failures, but {summary.warning} warnings remain. Address in order.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <div>
            <p className="font-semibold text-emerald-800 dark:text-emerald-200">All areas passing — {summary.warning} warning{summary.warning !== 1 ? "s" : ""} to investigate</p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">No failures detected. Review warnings and test cases for full confidence.</p>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          className="border rounded px-3 py-1.5 text-sm flex-1 max-w-xs bg-background"
          placeholder="Search areas…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          data-testid="input-readiness-search"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 text-xs w-32" data-testid="select-readiness-status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="fail">Fail</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="pass">Pass</SelectItem>
          </SelectContent>
        </Select>
        <Select value={riskFilter} onValueChange={setRiskFilter}>
          <SelectTrigger className="h-8 text-xs w-32" data-testid="select-readiness-risk"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All risks</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="shrink-0">{filtered.length} / {areas.length}</Badge>
        <Button size="sm" variant="ghost" className="h-8 text-xs shrink-0" onClick={() => refetch()} disabled={isFetching} data-testid="button-readiness-refresh">
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Area cards sorted by fix order */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">No areas match the current filters.</p>
        )}
        {filtered.map((area: any) => <AreaCard key={area.id} area={area} />)}
      </div>

      <p className="text-xs text-muted-foreground text-right">
        Last checked: {data.summary?.lastRun ? new Date(data.summary.lastRun).toLocaleString() : "—"}
      </p>
    </div>
  );
}

// ─── npm Audit Tab ────────────────────────────────────────────────────────────
const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  moderate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  low: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  info: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

function NpmAuditTab() {
  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["/api/platform/audit/npm-audit"],
    staleTime: 120000,
  });

  if (isLoading) return <LoadingState />;
  if (!data) return <ErrorState msg="Failed to run npm audit" />;

  const s = data.summary ?? {};
  const findings: any[] = data.findings ?? [];
  const hasVulns = (s.critical ?? 0) + (s.high ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {hasVulns
            ? <AlertOctagon className="h-5 w-5 text-red-500" />
            : <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
          <span className="font-semibold text-sm">
            {hasVulns ? `${(s.critical ?? 0) + (s.high ?? 0)} critical/high vulnerabilities found` : "No critical/high vulnerabilities"}
          </span>
        </div>
        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => refetch()} disabled={isFetching} data-testid="button-npm-audit-refresh">
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {["critical", "high", "moderate", "low", "info", "total"].map(k => (
          <Card key={k} className={`border ${k === "critical" && s[k] > 0 ? "border-red-400 bg-red-50 dark:bg-red-950/30" : ""}`}>
            <CardContent className="pt-3 pb-2 text-center">
              <p className={`text-2xl font-bold ${k === "critical" && s[k] > 0 ? "text-red-700" : k === "high" && s[k] > 0 ? "text-orange-600" : ""}`}>{s[k] ?? 0}</p>
              <p className="text-xs text-muted-foreground capitalize">{k}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {findings.length > 0 && (
        <SectionCard title="Vulnerability Details" icon={AlertTriangle} description={`${findings.length} packages with known vulnerabilities`}>
          <div className="space-y-2">
            {findings.map((f: any, i: number) => (
              <div key={i} className="flex items-start justify-between gap-2 py-2 border-b last:border-0" data-testid={`row-npm-vuln-${i}`}>
                <div>
                  <span className="font-mono text-sm font-medium">{f.name}</span>
                  {f.range && <span className="text-xs text-muted-foreground ml-2">@ {f.range}</span>}
                  {f.via?.length > 0 && <p className="text-xs text-muted-foreground mt-0.5">Via: {f.via.join(", ")}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className={`text-xs capitalize ${SEVERITY_COLORS[f.severity] ?? ""}`}>{f.severity}</Badge>
                  {f.fixAvailable === true && <Badge className="text-xs bg-emerald-100 text-emerald-800">Fix available</Badge>}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {findings.length === 0 && (
        <SectionCard title="All Clear" icon={CheckCircle2}>
          <p className="text-sm text-muted-foreground">No known vulnerabilities in direct or transitive dependencies.</p>
        </SectionCard>
      )}

      <p className="text-xs text-muted-foreground text-right">
        Scanned: {data.scannedAt ? new Date(data.scannedAt).toLocaleString() : "—"}
      </p>
    </div>
  );
}

// ─── Security Audit Tab (unified breach + privacy audit log) ─────────────────
function SecurityAuditTab() {
  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["/api/platform/audit/security"],
    staleTime: 30000,
  });

  if (isLoading) return <LoadingState />;
  if (!data) return <ErrorState />;

  const breachIncidents: any[] = data.breachIncidents ?? [];
  const privacyLog: any[] = data.privacyAuditLog ?? [];

  const ACTION_COLORS: Record<string, string> = {
    data_export: "bg-blue-100 text-blue-800",
    data_anonymization: "bg-red-100 text-red-800",
    breach_notification: "bg-orange-100 text-orange-800",
    mfa_enrolled: "bg-green-100 text-green-800",
    mfa_disabled: "bg-yellow-100 text-yellow-800",
    retention_policy_change: "bg-purple-100 text-purple-800",
    consent_change: "bg-pink-100 text-pink-800",
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500" />
          Security — Breach Incidents &amp; Privacy Audit Log
        </h3>
        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => refetch()} disabled={isFetching} data-testid="button-security-refresh">
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      <SectionCard title={`Breach Incidents (${breachIncidents.length})`} icon={AlertOctagon}
        description="All breach incidents across all tenants. New submissions trigger a platform-level audit log entry.">
        {breachIncidents.length === 0 ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />No breach incidents recorded
          </p>
        ) : (
          <div className="space-y-2">
            {breachIncidents.map((inc: any, i: number) => (
              <div key={inc.id ?? i} className="rounded-lg border p-3 space-y-1" data-testid={`row-breach-${i}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{new Date(inc.discoveredAt).toLocaleDateString()} — {inc.nature?.substring(0, 80)}</span>
                  <div className="flex gap-1">
                    {inc.containmentComplete && <Badge className="text-xs bg-green-100 text-green-800">Contained</Badge>}
                    {inc.dpaNotified && <Badge className="text-xs bg-blue-100 text-blue-800">DPA Notified</Badge>}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Tenant: {inc.tenantId ?? "platform"} · Subjects: ~{inc.approximateSubjects}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title={`Privacy Audit Log — Recent 100 Events`} icon={ScrollText}
        description="All privacy-relevant events across all tenants (data exports, anonymizations, MFA changes, breach notifications).">
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {privacyLog.length === 0 && <p className="text-sm text-muted-foreground">No events recorded</p>}
          {privacyLog.map((entry: any, i: number) => (
            <div key={entry.id ?? i} className="flex items-center justify-between gap-2 py-1.5 border-b last:border-0 text-xs" data-testid={`row-privacy-${i}`}>
              <div className="flex items-center gap-2 min-w-0">
                <Badge className={`text-[10px] shrink-0 ${ACTION_COLORS[entry.actionType] ?? "bg-gray-100 text-gray-700"}`}>{entry.actionType}</Badge>
                <span className="text-muted-foreground truncate">{entry.detail}</span>
              </div>
              <span className="text-muted-foreground shrink-0">{new Date(entry.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      </SectionCard>
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
          <TabsTrigger value="readiness" data-testid="tab-audit-readiness" className="font-semibold"><ClipboardCheck className="h-3.5 w-3.5 mr-1" />Readiness</TabsTrigger>
          <TabsTrigger value="npm-audit" data-testid="tab-audit-npm"><ShieldCheck className="h-3.5 w-3.5 mr-1" />npm Audit</TabsTrigger>
          <TabsTrigger value="security" data-testid="tab-audit-security"><AlertTriangle className="h-3.5 w-3.5 mr-1" />Security</TabsTrigger>
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
        <TabsContent value="readiness" className="mt-6"><ReadinessTab /></TabsContent>
        <TabsContent value="npm-audit" className="mt-6"><NpmAuditTab /></TabsContent>
        <TabsContent value="security" className="mt-6"><SecurityAuditTab /></TabsContent>
      </Tabs>
    </div>
  );
}
