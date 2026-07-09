import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Activity, Download, Search } from "lucide-react";

type Health = { uptimeSeconds: number; environment: string; version?: string; commitSha: string; buildTime?: string | null; nodeVersion?: string; pm2Process?: string; database: string; storageWritable: boolean; githubConfigured: boolean; emailConfigured: boolean; queueStatus: string; serviceStatus?: string; memory?: { rss: number; free: number; total: number } };
const services = ["error", "app", "appdr", "github", "database", "security", "journal"];

async function fetchJson<T>(url: string): Promise<T> { const res = await fetch(url, { credentials: "include" }); if (!res.ok) throw new Error(await res.text()); return res.json(); }

export default function DeveloperDiagnosticsPanel({ embedded = false }: { embedded?: boolean }) {
  const [service, setService] = useState("error");
  const [level, setLevel] = useState("all");
  const [search, setSearch] = useState("");
  const [correlationId, setCorrelationId] = useState("");
  const qs = new URLSearchParams({ service });
  if (level !== "all") qs.set("level", level); if (search) qs.set("search", search); if (correlationId) qs.set("correlationId", correlationId);
  const health = useQuery({ queryKey: ["/api/admin/diagnostics/health"], queryFn: () => fetchJson<Health>("/api/admin/diagnostics/health") });
  const logs = useQuery({ queryKey: ["/api/admin/diagnostics/logs", service, level, search, correlationId], queryFn: () => fetchJson<{ logs: any[] }>(`/api/admin/diagnostics/logs?${qs}`) });
  const exportBundle = () => { window.location.href = "/api/admin/diagnostics/export"; };
  const recentErrors = (logs.data?.logs || []).filter((l) => ["error", "fatal"].includes(l.level)).slice(0, 25);

  return <div className={embedded ? "space-y-6" : "container mx-auto space-y-6 p-6"} data-testid="panel-app-doctor-diagnostics">
    <div className="flex items-center justify-between"><div><h1 className="text-3xl font-bold">Diagnostics</h1><p className="text-muted-foreground">App Doctor Platform Operations diagnostics for runtime, logs, GitHub, payroll, PDF, and database issues.</p></div><Button onClick={exportBundle} data-testid="button-export-diagnostics"><Download className="mr-2 h-4 w-4" />Export ZIP</Button></div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />System Health</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-4">
      {[ ["Environment", health.data?.environment], ["Version", health.data?.version], ["Commit", health.data?.commitSha], ["Build", health.data?.buildTime], ["Node", health.data?.nodeVersion], ["PM2 Process", health.data?.pm2Process], ["Uptime", `${health.data?.uptimeSeconds ?? 0}s`], ["Database", health.data?.database], ["Storage writable", health.data?.storageWritable ? "yes" : "no"], ["GitHub configured", health.data?.githubConfigured ? "yes" : "no"], ["Email configured", health.data?.emailConfigured ? "yes" : "no"], ["Queue/worker", health.data?.queueStatus], ["MyPayLink systemd", health.data?.serviceStatus ? "available" : "unknown"] ].map(([k,v]) => <div key={k} className="rounded border p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="font-medium break-all">{v || "unknown"}</div></div>)}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Log Viewer</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-3 md:grid-cols-5"><Select value={service} onValueChange={setService}><SelectTrigger data-testid="select-diagnostics-service"><SelectValue /></SelectTrigger><SelectContent>{services.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select><Select value={level} onValueChange={setLevel}><SelectTrigger data-testid="select-diagnostics-level"><SelectValue /></SelectTrigger><SelectContent>{["all","info","warn","error","fatal"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select><Input placeholder="correlationId" value={correlationId} onChange={e=>setCorrelationId(e.target.value)} data-testid="input-diagnostics-correlation" /><Input placeholder="Search text" value={search} onChange={e=>setSearch(e.target.value)} data-testid="input-diagnostics-search" /><Button onClick={()=>logs.refetch()} data-testid="button-search-diagnostics"><Search className="mr-2 h-4 w-4" />Search</Button></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th>timestamp</th><th>level</th><th>service</th><th>message</th><th>route</th><th>tenant</th><th>user</th><th>correlationId</th><th>status</th></tr></thead><tbody>{(logs.data?.logs || []).map((l, i) => <tr className="border-b" key={i}><td>{l.timestamp}</td><td><Badge variant={l.level === "error" || l.level === "fatal" ? "destructive" : "secondary"}>{l.level}</Badge></td><td>{l.service}</td><td className="max-w-sm truncate">{l.message}</td><td>{l.path}</td><td>{l.tenantId || l.companyId}</td><td>{l.userId}</td><td className="font-mono text-xs">{l.correlationId}</td><td>{l.statusCode}</td></tr>)}</tbody></table></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Recent Errors</CardTitle></CardHeader><CardContent>{recentErrors.length ? <ul className="space-y-2">{recentErrors.map((e, i) => <li className="rounded border p-3" key={i}><div className="font-medium">{e.message}</div><div className="text-xs text-muted-foreground">{e.timestamp} · {e.path} · Error ID: {e.correlationId}</div></li>)}</ul> : <p className="text-sm text-muted-foreground">No recent errors in the selected log.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>App Dr / GitHub Diagnostics</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-3"><div>GitHub token configured: <b>{health.data?.githubConfigured ? "yes" : "no"}</b></div><div>Repo configured: <b>{health.data?.githubConfigured ? "yes" : "no"}</b></div><div>Last failure correlationId: <b>{recentErrors[0]?.correlationId || "none"}</b></div></CardContent></Card>
  </div>;
}
