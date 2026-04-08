import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Download, RefreshCw, Server, GitBranch, Shield, Key, Plug, Database,
  Building2, FileText, Terminal, CheckCircle2, XCircle, AlertCircle, Clock
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function StatusBadge({ ok, label }: { ok: boolean; label?: string }) {
  return ok
    ? <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 text-xs">{label ?? "OK"}</Badge>
    : <Badge variant="destructive" className="text-xs">{label ?? "Missing"}</Badge>;
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

// ─── System tab ───────────────────────────────────────────────────────────────
function SystemTab() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/platform/audit/system"], staleTime: 30000 });
  if (isLoading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (!data) return <p className="text-destructive text-sm">Failed to load</p>;
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

// ─── Integrations tab ─────────────────────────────────────────────────────────
function IntegrationsTab() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/platform/audit/integrations"], staleTime: 30000 });
  if (isLoading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (!data) return <p className="text-destructive text-sm">Failed to load</p>;
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
        <KVRow label="SMTP_HOST" value={<StatusBadge ok={data.smtp.hasHost} label={data.smtp.hasHost ? "Set" : "Not set"} />} />
        <KVRow label="SMTP_USER" value={<StatusBadge ok={data.smtp.hasUser} label={data.smtp.hasUser ? "Set" : "Not set"} />} />
        <KVRow label="SMTP_PASS" value={<StatusBadge ok={data.smtp.hasPass} label={data.smtp.hasPass ? "Set" : "Not set"} />} />
        <KVRow label="FROM address" value={data.smtp.from ?? "—"} mono />
        {data.smtp.derivedHost && (
          <KVRow label="Host (derived)" value={<span className="font-mono text-xs text-amber-600">{data.smtp.derivedHost} (auto)</span>} />
        )}
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
      <SectionCard title="Stripe" icon={FileText}>
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

// ─── Roles tab ────────────────────────────────────────────────────────────────
function RolesTab() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/platform/audit/roles"], staleTime: 60000 });
  if (isLoading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (!data) return <p className="text-destructive text-sm">Failed to load</p>;
  return (
    <div className="space-y-4">
      {Object.entries(data.layers as Record<string, any[]>).map(([layer, roles]) => (
        <SectionCard key={layer} title={layer} icon={Shield}>
          <div className="space-y-2">
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
  if (isLoading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (!data) return <p className="text-destructive text-sm">Failed to load</p>;

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
        <input
          className="border rounded px-3 py-1.5 text-sm flex-1 max-w-xs bg-background"
          placeholder="Filter routes…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          data-testid="input-route-filter"
        />
        <Badge variant="secondary">{filtered.length} / {routes.length} routes</Badge>
      </div>
      <ScrollArea className="h-[500px] border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Method</TableHead>
              <TableHead>Path</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r, i) => (
              <TableRow key={i}>
                <TableCell>
                  <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${methodColor[r.method] ?? "bg-gray-100 text-gray-800"}`}>
                    {r.method}
                  </span>
                </TableCell>
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
  if (isLoading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (!data) return <p className="text-destructive text-sm">Failed to load</p>;

  const tenants: any[] = data.tenants ?? [];
  const planColor: Record<string, string> = {
    trial: "secondary", active: "default", grace: "outline", cancelled: "destructive",
  };

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
                <TableCell>{t.planName ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={(planColor[t.subscriptionStatus] as any) ?? "outline"} className="text-xs capitalize">
                    {t.subscriptionStatus ?? "unknown"}
                  </Badge>
                </TableCell>
                <TableCell>{t.workerCount ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{t.trialEnd ? new Date(t.trialEnd).toLocaleDateString() : "—"}</TableCell>
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
  if (isLoading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (!data) return <p className="text-destructive text-sm">Failed to load</p>;

  const migrations: any[] = data.migrations ?? [];
  const tables = migrations.filter(m => m.type === "table");
  const columns = migrations.filter(m => m.type === "column");
  const seeds = migrations.filter(m => m.type === "seed");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          { label: "Tables", count: tables.length, icon: Database },
          { label: "Columns", count: columns.length, icon: FileText },
          { label: "Seeds", count: seeds.length, icon: CheckCircle2 },
        ].map(({ label, count, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3 text-center">
              <Icon className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
              <p className="text-2xl font-bold">{count}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <ScrollArea className="h-[400px] border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Migration</TableHead>
              <TableHead className="w-[80px]">Type</TableHead>
              <TableHead className="w-[80px]">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {migrations.map((m: any, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{m.key}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{m.type}</Badge></TableCell>
                <TableCell>
                  {m.status === "ok"
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    : <XCircle className="h-4 w-4 text-destructive" />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
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
      toast({ title: "Audit bundle downloaded" });
    } catch {
      toast({ title: "Failed to download audit bundle", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Platform Audit Surface</h1>
          <p className="text-muted-foreground mt-1">
            Read-only deployment state snapshot. Use the export to share with ChatGPT for cross-reference.
          </p>
        </div>
        <Button onClick={downloadBundle} disabled={exporting} data-testid="button-download-audit">
          <Download className="h-4 w-4 mr-2" />
          {exporting ? "Exporting…" : "Export Audit Bundle"}
        </Button>
      </div>

      <Tabs defaultValue="system">
        <TabsList className="flex-wrap h-auto gap-1" data-testid="tabs-platform-audit">
          <TabsTrigger value="system" data-testid="tab-audit-system"><Server className="h-3.5 w-3.5 mr-1" />System</TabsTrigger>
          <TabsTrigger value="integrations" data-testid="tab-audit-integrations"><Plug className="h-3.5 w-3.5 mr-1" />Integrations</TabsTrigger>
          <TabsTrigger value="roles" data-testid="tab-audit-roles"><Shield className="h-3.5 w-3.5 mr-1" />Roles</TabsTrigger>
          <TabsTrigger value="routes" data-testid="tab-audit-routes"><Terminal className="h-3.5 w-3.5 mr-1" />Routes</TabsTrigger>
          <TabsTrigger value="tenants" data-testid="tab-audit-tenants"><Building2 className="h-3.5 w-3.5 mr-1" />Tenants</TabsTrigger>
          <TabsTrigger value="migrations" data-testid="tab-audit-migrations"><Database className="h-3.5 w-3.5 mr-1" />Migrations</TabsTrigger>
        </TabsList>

        <TabsContent value="system" className="mt-6"><SystemTab /></TabsContent>
        <TabsContent value="integrations" className="mt-6"><IntegrationsTab /></TabsContent>
        <TabsContent value="roles" className="mt-6"><RolesTab /></TabsContent>
        <TabsContent value="routes" className="mt-6"><RoutesTab /></TabsContent>
        <TabsContent value="tenants" className="mt-6"><TenantsTab /></TabsContent>
        <TabsContent value="migrations" className="mt-6"><MigrationsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
