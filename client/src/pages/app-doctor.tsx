import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import DeveloperDiagnosticsPanel from "@/components/app-doctor/developer-diagnostics-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Bot, Bug, CheckCircle2, GitPullRequest, Loader2, RefreshCw, ShieldAlert, Siren,
  Activity, Server, Cpu, Database, AlertTriangle, TicketCheck, XCircle, ExternalLink,
  ClipboardList, FlaskConical, RotateCcw, Tag
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type AppDoctorReport = {
  id: string;
  company_id?: string | null;
  source: string;
  severity: string;
  status: string;
  title: string;
  error_message: string;
  stack_trace?: string | null;
  route?: string | null;
  occurrence_count?: number;
  ai_summary?: string | null;
  ai_root_cause?: string | null;
  ai_suggested_fix?: string | null;
  ai_patch?: string | null;
  recommended_files?: unknown;
  risk_level?: string | null;
  pr_url?: string | null;
  issue_category?: string | null;
  severity_class?: string | null;
  required_approver_role?: string | null;
  test_plan?: string | null;
  rollback_plan?: string | null;
  created_at: string;
  updated_at?: string | null;
};

type RepairTicket = {
  id: string;
  report_id?: string | null;
  company_id?: string | null;
  status: string;
  severity_class: string;
  required_approver_role: string;
  proposed_patch?: string | null;
  affected_files?: string | null;
  test_plan?: string | null;
  rollback_plan?: string | null;
  approved_by_user_id?: string | null;
  approved_at?: string | null;
  rejected_by_user_id?: string | null;
  rejected_reason?: string | null;
  pr_url?: string | null;
  branch_name?: string | null;
  pr_number?: number | null;
  created_by_user_id?: string | null;
  report_title?: string | null;
  report_severity?: string | null;
  created_at: string;
  updated_at?: string | null;
};

type Diagnostics = {
  timestamp: string;
  nodeVersion: string;
  uptimeSeconds: number;
  dbHealth: string;
  commitHash: string;
  environment: string;
  aiConfig: {
    provider: string;
    model: string;
    repairEnabled: boolean;
    prEnabled: boolean;
    githubConfigured: boolean;
    maxRiskAutoDraft: string;
    requireApproval: boolean;
  };
  reports: {
    last24hBySeverity: Record<string, number>;
    last7dByStatus: Record<string, number>;
    last7dByCategory: Record<string, number>;
  };
  repairTickets: { open: number; pendingApproval: number };
};

type Company = { id: string; name: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "ai_review_ready" || status === "fixed" || status === "approved" || status === "merged") return "default";
  if (status === "needs_ai_config" || status === "rejected") return "destructive";
  if (status === "reviewed" || status === "ignored" || status === "pr_created" || status === "pr_requested") return "secondary";
  return "outline";
}

function severityClassVariant(sc: string | null | undefined): "default" | "secondary" | "outline" | "destructive" {
  if (sc === "major") return "destructive";
  if (sc === "medium") return "default";
  return "outline";
}

function parseRecommended(value?: unknown) {
  if (!value) return { files: [], tests: [] };
  if (typeof value === "object") return value as { files?: string[]; tests?: string[] };
  try { return JSON.parse(String(value)); } catch { return { files: [], tests: [] }; }
}

function parseAffectedFiles(value?: string | null): string[] {
  if (!value) return [];
  try { return JSON.parse(value); } catch { return []; }
}

function formatUptime(s: number) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const ISSUE_CATEGORY_LABELS: Record<string, string> = {
  api_routing: "API Routing",
  permission_403: "403 Permission",
  database_migration: "DB / Migration",
  frontend_render: "Frontend Render",
  document_pdf: "Document / PDF",
  payroll_calculation: "Payroll / Tax",
  deployment: "Deployment",
  port_process: "Port / Process",
  twilio_sms: "Twilio / SMS",
  documenso_signature: "Documenso",
  other: "Other",
};

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AppDoctorPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(user?.companyId || "");
  const isPlatform = (user?.role || "").startsWith("platform_");
  const isGlobalAdmin = user?.role === "platform_super_admin" || user?.role === "platform_admin";

  // Rejection dialog state
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectingTicketId, setRejectingTicketId] = useState<string>("");
  const [rejectReason, setRejectReason] = useState("");

  // ── Queries ──────────────────────────────────────────────────────────────────

  const companiesQuery = useQuery<Company[]>({
    queryKey: ["/api/companies"],
    enabled: isPlatform,
  });

  const apiHealthQuery = useQuery<{ status: string; timestamp: string }>({
    queryKey: ["/api/health"],
    queryFn: async () => {
      const res = await fetch("/api/health", { credentials: "include" });
      if (!res.headers.get("content-type")?.includes("application/json")) throw new Error("non_json");
      return res.json();
    },
    retry: 1,
    staleTime: 30_000,
  });

  const diagnosticsQuery = useQuery<Diagnostics>({
    queryKey: ["/api/app-doctor/diagnostics", selectedCompanyId],
    queryFn: async () => {
      const qs = selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : "";
      const res = await fetch(`/api/app-doctor/diagnostics${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
    retry: 1,
  });

  const reportsQuery = useQuery<AppDoctorReport[]>({
    queryKey: ["/api/app-doctor/reports", selectedCompanyId],
    queryFn: async () => {
      const qs = selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : "";
      const res = await fetch(`/api/app-doctor/reports${qs}`, { credentials: "include" });
      const bodyText = await res.text();
      if (!res.headers.get("content-type")?.includes("application/json")) {
        const isHtml = bodyText.trim().startsWith("<!DOCTYPE") || bodyText.trim().startsWith("<html");
        throw new Error(isHtml ? "non_json_response" : bodyText || "Unexpected response");
      }
      const body = bodyText ? JSON.parse(bodyText) : null;
      if (!res.ok) throw new Error(body?.message || `Request failed with ${res.status}`);
      return body;
    },
  });

  const ticketsQuery = useQuery<RepairTicket[]>({
    queryKey: ["/api/app-doctor/repair-tickets", selectedCompanyId],
    queryFn: async () => {
      const qs = selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : "";
      const res = await fetch(`/api/app-doctor/repair-tickets${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `${res.status}`);
      return res.json();
    },
  });

  const reports = reportsQuery.data || [];
  const tickets = ticketsQuery.data || [];
  const diag = diagnosticsQuery.data;

  const [selectedReportId, setSelectedReportId] = useState<string>("");
  const selected = useMemo(() => reports.find(r => r.id === selectedReportId) || reports[0], [reports, selectedReportId]);
  const recommended = parseRecommended(selected?.recommended_files);

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const analyzeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/app-doctor/reports/${id}/analyze`, {}).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/app-doctor/reports"] });
      toast({ title: "AI diagnosis refreshed" });
    },
    onError: (e: any) => toast({ title: "AI analysis failed", description: e.message, variant: "destructive" }),
  });

  const updateReportMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/app-doctor/reports/${id}`, { status }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/app-doctor/reports"] });
      toast({ title: "Report updated" });
    },
  });

  const createTicketMutation = useMutation({
    mutationFn: (reportId: string) =>
      apiRequest("POST", "/api/app-doctor/repair-tickets", { reportId }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/app-doctor/repair-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/app-doctor/reports"] });
      toast({ title: "Repair ticket created", description: "Approvers have been notified." });
    },
    onError: (e: any) => toast({ title: "Failed to create repair ticket", description: e.message, variant: "destructive" }),
  });

  const approveTicketMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("PATCH", `/api/app-doctor/repair-tickets/${id}/approve`, {}).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/app-doctor/repair-tickets"] });
      toast({ title: "Repair ticket approved" });
    },
    onError: (e: any) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });

  const rejectTicketMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiRequest("PATCH", `/api/app-doctor/repair-tickets/${id}/reject`, { reason }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/app-doctor/repair-tickets"] });
      setRejectDialogOpen(false);
      setRejectReason("");
      toast({ title: "Repair ticket rejected" });
    },
    onError: (e: any) => toast({ title: "Rejection failed", description: e.message, variant: "destructive" }),
  });

  const createPrMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/app-doctor/repair-tickets/${id}/create-pr`, {}).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/app-doctor/repair-tickets"] });
      if (data?.success === false || data?.status === "pr_creation_failed") {
        toast({
          title: "PR creation failed",
          description: data?.message || `Repair ticket saved, but PR creation failed. Error ID: ${data?.correlationId || "unknown"}`,
          variant: "destructive",
        });
        return;
      }
      if (data.prUrl) {
        toast({ title: "GitHub PR created", description: data.prUrl });
      } else {
        toast({ title: "Marked for manual PR", description: data.note || "GITHUB_TOKEN not configured" });
      }
    },
    onError: (e: any) => toast({ title: "PR creation failed", description: e.message, variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/app-doctor/reports", {
      companyId: selectedCompanyId || user?.companyId,
      source: "app_doctor_self_test",
      severity: "low",
      title: "App Doctor self-test",
      message: "This is a test report generated from the App Doctor review page.",
      route: "/app/app-doctor",
      context: { triggeredBy: user?.id || user?.username || "current_user" },
      autoAnalyze: false,
    }).then(r => r.json()),
    onSuccess: (report: AppDoctorReport) => {
      queryClient.invalidateQueries({ queryKey: ["/api/app-doctor/reports"] });
      setSelectedReportId(report.id);
      toast({ title: "Test report created", description: "App Doctor is receiving reports." });
    },
    onError: (e: any) => toast({ title: "Test report failed", description: e.message, variant: "destructive" }),
  });

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            AI App Doctor
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Diagnoses runtime errors, classifies severity, and proposes safe fixes for human review.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isPlatform && (
            <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
              <SelectTrigger className="w-56" data-testid="select-app-doctor-company">
                <SelectValue placeholder="All companies" />
              </SelectTrigger>
              <SelectContent>
                {(companiesQuery.data || []).map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              diagnosticsQuery.refetch();
              reportsQuery.refetch();
              ticketsQuery.refetch();
            }}
            data-testid="button-refresh-all"
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending || (isPlatform && !selectedCompanyId)}
            data-testid="button-send-test-report"
          >
            {testMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Siren className="h-4 w-4 mr-1" />}
            Send Test Report
          </Button>
        </div>
      </div>

      {/* Safety notice */}
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription className="text-sm flex items-center justify-between gap-2 flex-wrap">
          <span>App Doctor proposes fixes for human review. Payroll, ACH, tax filing, auth, and deploy decisions always require human approval. No changes are applied automatically.</span>
          <span
            data-testid="status-api-health"
            className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
              apiHealthQuery.isLoading ? "border-muted-foreground/30 text-muted-foreground"
              : apiHealthQuery.isError ? "border-destructive/60 text-destructive bg-destructive/10"
              : "border-green-500/60 text-green-600 bg-green-50 dark:bg-green-950/30"
            }`}
          >
            {apiHealthQuery.isLoading ? "Checking API…" : apiHealthQuery.isError ? "API: error" : "API: ok"}
          </span>
        </AlertDescription>
      </Alert>

      {/* Diagnostics panel */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              System Diagnostics
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => diagnosticsQuery.refetch()}
              disabled={diagnosticsQuery.isFetching}
              data-testid="button-refresh-diagnostics"
            >
              {diagnosticsQuery.isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          </div>
          {diag && (
            <CardDescription className="text-xs">
              Snapshot at {new Date(diag.timestamp).toLocaleTimeString()} · Uptime {formatUptime(diag.uptimeSeconds)} · {diag.environment}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {diagnosticsQuery.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading diagnostics…
            </div>
          )}
          {diagnosticsQuery.isError && (
            <p className="text-sm text-destructive">Failed to load diagnostics: {(diagnosticsQuery.error as Error)?.message}</p>
          )}
          {diag && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* DB health */}
              <div className="flex items-start gap-2 rounded-lg border p-3">
                <Database className={`h-4 w-4 mt-0.5 ${diag.dbHealth === "ok" ? "text-green-600" : "text-destructive"}`} />
                <div>
                  <p className="text-xs font-medium">Database</p>
                  <p className={`text-sm font-semibold ${diag.dbHealth === "ok" ? "text-green-600" : "text-destructive"}`}>{diag.dbHealth}</p>
                </div>
              </div>
              {/* AI provider */}
              <div className="flex items-start gap-2 rounded-lg border p-3">
                <Bot className="h-4 w-4 mt-0.5 text-primary" />
                <div>
                  <p className="text-xs font-medium">AI Provider</p>
                  <p className="text-sm font-semibold capitalize">{diag.aiConfig.provider}</p>
                  <p className="text-xs text-muted-foreground">{diag.aiConfig.model}</p>
                </div>
              </div>
              {/* Repair config */}
              <div className="flex items-start gap-2 rounded-lg border p-3">
                <Server className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium">Repair Config</p>
                  <div className="flex flex-col gap-0.5 mt-0.5">
                    <span className={`text-xs ${diag.aiConfig.repairEnabled ? "text-green-600" : "text-muted-foreground"}`}>
                      {diag.aiConfig.repairEnabled ? "✓ Repair enabled" : "✗ Repair disabled"}
                    </span>
                    <span className={`text-xs ${diag.aiConfig.githubConfigured ? "text-green-600" : "text-muted-foreground"}`}>
                      {diag.aiConfig.githubConfigured ? "✓ GitHub configured" : "✗ GitHub not configured"}
                    </span>
                    <span className="text-xs text-muted-foreground">Max auto-draft: {diag.aiConfig.maxRiskAutoDraft}</span>
                  </div>
                </div>
              </div>
              {/* Repair tickets */}
              <div className="flex items-start gap-2 rounded-lg border p-3">
                <TicketCheck className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium">Repair Tickets</p>
                  <p className="text-sm font-semibold">{diag.repairTickets.open} open</p>
                  {diag.repairTickets.pendingApproval > 0 && (
                    <p className="text-xs text-amber-600 font-medium">{diag.repairTickets.pendingApproval} pending approval</p>
                  )}
                </div>
              </div>
              {/* 24h error breakdown */}
              {Object.keys(diag.reports.last24hBySeverity).length > 0 && (
                <div className="sm:col-span-2 rounded-lg border p-3">
                  <p className="text-xs font-medium mb-2 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Last 24h by Severity</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(diag.reports.last24hBySeverity).map(([sev, cnt]) => (
                      <Badge key={sev} variant={sev === "critical" || sev === "high" ? "destructive" : "outline"} className="text-xs">
                        {sev}: {cnt}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {/* 7d category breakdown */}
              {Object.keys(diag.reports.last7dByCategory).length > 0 && (
                <div className="sm:col-span-2 rounded-lg border p-3">
                  <p className="text-xs font-medium mb-2 flex items-center gap-1"><Cpu className="h-3 w-3" />Last 7d by Category</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(diag.reports.last7dByCategory).map(([cat, cnt]) => (
                      <Badge key={cat} variant="outline" className="text-xs">
                        {ISSUE_CATEGORY_LABELS[cat] || cat}: {cnt}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main tabs */}
      <Tabs defaultValue="issues">
        <TabsList data-testid="tabs-app-doctor">
          <TabsTrigger value="issues" data-testid="tab-issues">
            <Bot className="h-4 w-4 mr-1" />
            AI-assisted Operations
            {reports.length > 0 && <Badge variant="outline" className="ml-1.5 text-xs">{reports.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="diagnostics" data-testid="tab-diagnostics">
            <Activity className="h-4 w-4 mr-1" />
            Diagnostics
          </TabsTrigger>
          <TabsTrigger value="tickets" data-testid="tab-tickets">
            <TicketCheck className="h-4 w-4 mr-1" />
            Repair Center
            {tickets.filter(t => t.status === "pending_approval").length > 0 && (
              <Badge variant="destructive" className="ml-1.5 text-xs">
                {tickets.filter(t => t.status === "pending_approval").length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="deployment" data-testid="tab-deployment-center"><Server className="h-4 w-4 mr-1" />Deployment Center</TabsTrigger>
          <TabsTrigger value="releases" data-testid="tab-release-manager"><Tag className="h-4 w-4 mr-1" />Release Manager</TabsTrigger>
          <TabsTrigger value="database" data-testid="tab-database-management"><Database className="h-4 w-4 mr-1" />Database Management</TabsTrigger>
          <TabsTrigger value="environments" data-testid="tab-environment-comparison"><Cpu className="h-4 w-4 mr-1" />Environment Comparison</TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit-center"><ClipboardList className="h-4 w-4 mr-1" />Audit Center</TabsTrigger>
        </TabsList>

        {/* ── AI-assisted Operations Tab ─────────────────────────────────────────── */}
        <TabsContent value="issues" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,540px)]">

            {/* Issue list */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Bug className="h-4 w-4" />
                  Detected Issues
                </CardTitle>
                <CardDescription>{reports.length} recent report{reports.length === 1 ? "" : "s"}</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {reportsQuery.isError && (() => {
                  const msg = (reportsQuery.error as Error)?.message || "";
                  return (
                    <div className="m-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive space-y-2">
                      <p>{msg === "non_json_response" ? "Server is starting — please wait and try again." : `Failed to load: ${msg}`}</p>
                      <button className="text-xs underline" onClick={() => reportsQuery.refetch()}>Retry</button>
                    </div>
                  );
                })()}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Issue</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Seen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reports.map(report => (
                      <TableRow
                        key={report.id}
                        onClick={() => setSelectedReportId(report.id)}
                        className={`cursor-pointer ${selected?.id === report.id ? "bg-muted/60" : ""}`}
                        data-testid={`row-app-doctor-${report.id}`}
                      >
                        <TableCell>
                          <div className="font-medium line-clamp-1">{report.title}</div>
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {report.issue_category ? (ISSUE_CATEGORY_LABELS[report.issue_category] || report.issue_category) : (report.route || report.source)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={report.severity === "critical" || report.severity === "high" ? "destructive" : "outline"}>
                            {report.severity}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {report.severity_class
                            ? <Badge variant={severityClassVariant(report.severity_class)} className="capitalize">{report.severity_class}</Badge>
                            : <span className="text-xs text-muted-foreground">—</span>
                          }
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(report.status)}>{report.status.replace(/_/g, " ")}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{report.occurrence_count || 1}×</TableCell>
                      </TableRow>
                    ))}
                    {reports.length === 0 && !reportsQuery.isLoading && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">No issues reported yet.</TableCell>
                      </TableRow>
                    )}
                    {reportsQuery.isLoading && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-6">
                          <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Report detail panel */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Review</CardTitle>
                <CardDescription className="line-clamp-1">{selected ? selected.title : "Select an issue to review"}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {selected ? (
                  <>
                    {/* Badges row */}
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={statusVariant(selected.status)}>{selected.status.replace(/_/g, " ")}</Badge>
                      <Badge variant={selected.severity === "critical" || selected.severity === "high" ? "destructive" : "outline"}>
                        {selected.severity}
                      </Badge>
                      {selected.severity_class && (
                        <Badge variant={severityClassVariant(selected.severity_class)} className="capitalize">
                          {selected.severity_class} repair
                        </Badge>
                      )}
                      {selected.risk_level && (
                        <Badge variant="outline">risk: {selected.risk_level}</Badge>
                      )}
                      {selected.issue_category && (
                        <Badge variant="outline" className="flex items-center gap-1">
                          <Tag className="h-3 w-3" />
                          {ISSUE_CATEGORY_LABELS[selected.issue_category] || selected.issue_category}
                        </Badge>
                      )}
                    </div>

                    {/* Approver requirement */}
                    {selected.required_approver_role && (
                      <Alert variant={selected.required_approver_role === "global_admin" ? "destructive" : "default"} className="py-2">
                        <ShieldAlert className="h-4 w-4" />
                        <AlertDescription className="text-xs">
                          Requires <strong>{selected.required_approver_role === "global_admin" ? "Global Admin" : "Admin"}</strong> approval before any changes can be applied.
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* AI Summary */}
                    <section>
                      <h3 className="text-sm font-medium mb-1">AI Summary</h3>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selected.ai_summary || "No AI diagnosis yet — run Analyze."}</p>
                    </section>

                    {/* Root Cause */}
                    <section>
                      <h3 className="text-sm font-medium mb-1">Likely Root Cause</h3>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selected.ai_root_cause || selected.error_message}</p>
                    </section>

                    {/* Suggested Fix */}
                    <section>
                      <h3 className="text-sm font-medium mb-1">Suggested Fix</h3>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selected.ai_suggested_fix || "Run analysis to generate a suggested fix."}</p>
                    </section>

                    {/* Proposed Patch */}
                    {selected.ai_patch && (
                      <section>
                        <h3 className="text-sm font-medium mb-1">Proposed Patch</h3>
                        <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap">{selected.ai_patch}</pre>
                      </section>
                    )}

                    {/* Test Plan */}
                    {selected.test_plan && (
                      <section>
                        <h3 className="text-sm font-medium mb-1 flex items-center gap-1"><FlaskConical className="h-3 w-3" />Test Plan</h3>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selected.test_plan}</p>
                      </section>
                    )}

                    {/* Rollback Plan */}
                    {selected.rollback_plan && (
                      <section>
                        <h3 className="text-sm font-medium mb-1 flex items-center gap-1"><RotateCcw className="h-3 w-3" />Rollback Plan</h3>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selected.rollback_plan}</p>
                      </section>
                    )}

                    {/* Files & Tests */}
                    {(recommended.files?.length || recommended.tests?.length) && (
                      <section className="text-sm text-muted-foreground space-y-1">
                        {recommended.files?.length > 0 && (
                          <p className="flex items-start gap-1">
                            <ClipboardList className="h-3 w-3 mt-0.5 shrink-0" />
                            <span><strong>Files:</strong> {recommended.files.join(", ")}</span>
                          </p>
                        )}
                        {recommended.tests?.length > 0 && (
                          <p className="flex items-start gap-1">
                            <FlaskConical className="h-3 w-3 mt-0.5 shrink-0" />
                            <span><strong>Tests:</strong> {recommended.tests.join(", ")}</span>
                          </p>
                        )}
                      </section>
                    )}

                    {/* Stack trace */}
                    {selected.stack_trace && (
                      <details>
                        <summary className="text-sm font-medium cursor-pointer">Stack Trace</summary>
                        <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-40 whitespace-pre-wrap mt-2">{selected.stack_trace}</pre>
                      </details>
                    )}

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 pt-2 border-t">
                      <Button
                        size="sm"
                        onClick={() => analyzeMutation.mutate(selected.id)}
                        disabled={analyzeMutation.isPending}
                        data-testid="button-analyze-report"
                      >
                        {analyzeMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                        Analyze
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateReportMutation.mutate({ id: selected.id, status: "reviewed" })}
                        data-testid="button-mark-reviewed"
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Mark Reviewed
                      </Button>
                      {selected.ai_patch && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => createTicketMutation.mutate(selected.id)}
                          disabled={createTicketMutation.isPending}
                          data-testid="button-create-repair-ticket"
                        >
                          {createTicketMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <TicketCheck className="h-4 w-4 mr-1" />}
                          Create Repair Ticket
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => updateReportMutation.mutate({ id: selected.id, status: "ignored" })}
                        data-testid="button-ignore-report"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No report selected.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Diagnostics Tab ─────────────────────────────────────────────────────── */}
        <TabsContent value="diagnostics" className="mt-4">
          <DeveloperDiagnosticsPanel embedded />
        </TabsContent>

        {/* ── Repair Center Tab ───────────────────────────────────────────────────── */}
        <TabsContent value="tickets" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TicketCheck className="h-4 w-4" />
                Repair Tickets
              </CardTitle>
              <CardDescription>
                Approved repairs go through a ticket → approve → PR flow. Major repairs require global admin approval.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {ticketsQuery.isLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {ticketsQuery.isError && (
                <p className="m-4 text-sm text-destructive">Failed to load tickets: {(ticketsQuery.error as Error)?.message}</p>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Report</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Approver</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets.map(ticket => {
                    const affectedFiles = parseAffectedFiles(ticket.affected_files);
                    const canApprove = ticket.required_approver_role === "global_admin" ? isGlobalAdmin : true;
                    return (
                      <TableRow key={ticket.id} data-testid={`row-repair-ticket-${ticket.id}`}>
                        <TableCell>
                          <div className="font-medium line-clamp-1">{ticket.report_title || ticket.report_id}</div>
                          {affectedFiles.length > 0 && (
                            <div className="text-xs text-muted-foreground line-clamp-1">{affectedFiles.slice(0, 2).join(", ")}{affectedFiles.length > 2 && ` +${affectedFiles.length - 2}`}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={severityClassVariant(ticket.severity_class)} className="capitalize">
                            {ticket.severity_class}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs font-medium ${ticket.required_approver_role === "global_admin" ? "text-destructive" : "text-muted-foreground"}`}>
                            {ticket.required_approver_role === "global_admin" ? "Global Admin" : "Admin"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(ticket.status)}>{ticket.status.replace(/_/g, " ")}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(ticket.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 flex-wrap justify-end">
                            {ticket.status === "pending_approval" && (
                              <>
                                <Button
                                  size="sm"
                                  disabled={!canApprove || approveTicketMutation.isPending}
                                  onClick={() => approveTicketMutation.mutate(ticket.id)}
                                  data-testid={`button-approve-ticket-${ticket.id}`}
                                >
                                  {approveTicketMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                                  {canApprove ? "Approve" : "Needs Global Admin"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => { setRejectingTicketId(ticket.id); setRejectDialogOpen(true); }}
                                  data-testid={`button-reject-ticket-${ticket.id}`}
                                >
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Reject
                                </Button>
                              </>
                            )}
                            {ticket.status === "approved" && (
                              <Button
                                size="sm"
                                onClick={() => createPrMutation.mutate(ticket.id)}
                                disabled={createPrMutation.isPending}
                                data-testid={`button-create-pr-${ticket.id}`}
                              >
                                {createPrMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitPullRequest className="h-3 w-3 mr-1" />}
                                Create PR
                              </Button>
                            )}
                            {ticket.status === "pr_creation_failed" && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-destructive">PR creation failed</span>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => createPrMutation.mutate(ticket.id)}
                                  disabled={createPrMutation.isPending}
                                  data-testid={`button-retry-pr-${ticket.id}`}
                                >
                                  {createPrMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                                  Retry PR Creation
                                </Button>
                              </div>
                            )}
                            {ticket.pr_url && (
                              <Button size="sm" variant="outline" asChild>
                                <a href={ticket.pr_url} target="_blank" rel="noopener noreferrer" data-testid={`link-pr-${ticket.id}`}>
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  View PR
                                </a>
                              </Button>
                            )}
                            {ticket.status === "rejected" && ticket.rejected_reason && (
                              <span className="text-xs text-muted-foreground max-w-[120px] line-clamp-1" title={ticket.rejected_reason}>
                                {ticket.rejected_reason}
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {tickets.length === 0 && !ticketsQuery.isLoading && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                        No repair tickets yet. Create one from a report that has AI analysis and a proposed patch.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Severity class guide */}
          <Card className="mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Severity Class Guide & Approval Rules</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3 text-sm">
                <div className="rounded-lg border p-3 space-y-1">
                  <Badge variant="outline">Minor</Badge>
                  <p className="text-xs text-muted-foreground">Single-file bug fix, cache invalidation, missing JSON guard, UI label fix, non-structural permission check.</p>
                  <p className="text-xs font-medium">Approver: Admin</p>
                </div>
                <div className="rounded-lg border p-3 space-y-1">
                  <Badge variant="default">Medium</Badge>
                  <p className="text-xs text-muted-foreground">Multi-file workflow bug, permission logic update, document/PDF flow fix, notification workflow, webhook processing.</p>
                  <p className="text-xs font-medium">Approver: Admin</p>
                </div>
                <div className="rounded-lg border p-3 space-y-1">
                  <Badge variant="destructive">Major</Badge>
                  <p className="text-xs text-muted-foreground">Payroll/tax calculations, auth/session, DB migrations, company access model, financial separation, app-wide routing.</p>
                  <p className="text-xs font-medium text-destructive">Approver: Global Admin required</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                App Doctor never deploys directly to production. All changes go through a feature branch + PR. Review carefully before merging.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deployment" className="mt-4">
          <Card data-testid="panel-deployment-center"><CardHeader><CardTitle>Deployment Center</CardTitle><CardDescription>Staging and production deployment controls are centralized here for Platform Operations. GitHub Actions remain the execution backend.</CardDescription></CardHeader><CardContent className="text-sm text-muted-foreground">Use the staging and production deployment workflows for controlled releases; production requires a release tag and database backup.</CardContent></Card>
        </TabsContent>
        <TabsContent value="releases" className="mt-4">
          <Card data-testid="panel-release-manager"><CardHeader><CardTitle>Release Manager</CardTitle><CardDescription>Release tags, build metadata, rollback notes, and deployment evidence will be reviewed here.</CardDescription></CardHeader><CardContent className="text-sm text-muted-foreground">Current release metadata is surfaced in Diagnostics → System Health.</CardContent></Card>
        </TabsContent>
        <TabsContent value="database" className="mt-4">
          <Card data-testid="panel-database-management"><CardHeader><CardTitle>Database Management</CardTitle><CardDescription>Read-only database status and backup evidence belong here.</CardDescription></CardHeader><CardContent className="text-sm text-muted-foreground">Production deployments run pg_dump before restart; destructive database actions are not exposed.</CardContent></Card>
        </TabsContent>
        <TabsContent value="environments" className="mt-4">
          <Card data-testid="panel-environment-comparison"><CardHeader><CardTitle>Environment Comparison</CardTitle><CardDescription>Compare staging and production version, commit, DB, storage, PM2, and health signals.</CardDescription></CardHeader><CardContent className="text-sm text-muted-foreground">This comparison is planned as a read-only view fed by diagnostics snapshots.</CardContent></Card>
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <Card data-testid="panel-audit-center"><CardHeader><CardTitle>Audit Center</CardTitle><CardDescription>Diagnostics exports, log searches, repair retries, and deployment actions are audited here.</CardDescription></CardHeader><CardContent className="text-sm text-muted-foreground">Diagnostics export events include user, role, IP, user agent, correlation ID, and export contents.</CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* Reject dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Repair Ticket</DialogTitle>
            <DialogDescription>Provide a reason for rejection so the reporter understands why this repair was not approved.</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason for rejection (optional)"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            rows={3}
            data-testid="textarea-reject-reason"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => rejectTicketMutation.mutate({ id: rejectingTicketId, reason: rejectReason })}
              disabled={rejectTicketMutation.isPending}
              data-testid="button-confirm-reject"
            >
              {rejectTicketMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Reject Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
