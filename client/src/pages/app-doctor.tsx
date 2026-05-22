import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Bot, Bug, CheckCircle2, GitPullRequest, Loader2, RefreshCw, ShieldAlert, Siren } from "lucide-react";

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
  created_at: string;
  updated_at?: string | null;
};

type Company = { id: string; name: string };

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "ai_review_ready" || status === "fixed") return "default";
  if (status === "needs_ai_config") return "destructive";
  if (status === "reviewed" || status === "ignored") return "secondary";
  return "outline";
}

function parseRecommended(value?: unknown) {
  if (!value) return { files: [], tests: [] };
  if (typeof value === "object") return value as { files?: string[]; tests?: string[] };
  try { return JSON.parse(value); } catch { return { files: [], tests: [] }; }
}

export default function AppDoctorPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(user?.companyId || "");
  const isPlatform = (user?.role || "").startsWith("platform_");

  const companiesQuery = useQuery<Company[]>({
    queryKey: ["/api/companies"],
    enabled: isPlatform,
  });

  const reportsQuery = useQuery<AppDoctorReport[]>({
    queryKey: ["/api/app-doctor/reports", selectedCompanyId],
    queryFn: async () => {
      const qs = selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : "";
      const res = await fetch(`/api/app-doctor/reports${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const reports = reportsQuery.data || [];
  const [selectedId, setSelectedId] = useState<string>("");
  const selected = useMemo(() => reports.find(r => r.id === selectedId) || reports[0], [reports, selectedId]);
  const recommended = parseRecommended(selected?.recommended_files);

  const analyzeMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/app-doctor/reports/${id}/analyze`, {}).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/app-doctor/reports"] });
      toast({ title: "AI diagnosis refreshed" });
    },
    onError: (e: any) => toast({ title: "AI analysis failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => apiRequest("PATCH", `/api/app-doctor/reports/${id}`, { status }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/app-doctor/reports"] });
      toast({ title: "Report updated" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/app-doctor/reports", {
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
      setSelectedId(report.id);
      toast({ title: "Test report created", description: "App Doctor is receiving reports." });
    },
    onError: (e: any) => toast({ title: "Test report failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            AI App Doctor
          </h1>
          <p className="text-sm text-muted-foreground mt-1">AI diagnoses runtime errors and prepares safe fixes for human review.</p>
        </div>
        {isPlatform && (
          <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
            <SelectTrigger className="w-72" data-testid="select-app-doctor-company">
              <SelectValue placeholder="All companies" />
            </SelectTrigger>
            <SelectContent>
              {(companiesQuery.data || []).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button variant="outline" onClick={() => testMutation.mutate()} disabled={testMutation.isPending || (isPlatform && !selectedCompanyId)}>
          {testMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Siren className="h-4 w-4 mr-1" />}
          Send Test Report
        </Button>
      </div>

      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription className="text-sm">
          App Doctor proposes fixes and PR-ready notes. Payroll submission, ACH release, tax filing, tenant access, and deploy decisions still require human approval.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,520px)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Bug className="h-4 w-4" />Detected Issues</CardTitle>
            <CardDescription>{reports.length} recent report{reports.length === 1 ? "" : "s"}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {reportsQuery.isError && (
              <div className="m-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                Failed to load App Doctor reports: {(reportsQuery.error as Error)?.message || "Unknown error"}
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Issue</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Seen</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map(report => (
                  <TableRow key={report.id} onClick={() => setSelectedId(report.id)} className="cursor-pointer" data-testid={`row-app-doctor-${report.id}`}>
                    <TableCell>
                      <div className="font-medium line-clamp-1">{report.title}</div>
                      <div className="text-xs text-muted-foreground line-clamp-1">{report.route || report.source}</div>
                    </TableCell>
                    <TableCell><Badge variant={report.severity === "critical" || report.severity === "high" ? "destructive" : "outline"}>{report.severity}</Badge></TableCell>
                    <TableCell><Badge variant={statusVariant(report.status)}>{report.status.replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell>{report.occurrence_count || 1}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(report.updated_at || report.created_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {reports.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">No issues reported yet.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review</CardTitle>
            <CardDescription>{selected ? selected.title : "Select an issue to review"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selected ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={statusVariant(selected.status)}>{selected.status.replace(/_/g, " ")}</Badge>
                  <Badge variant="outline">risk: {selected.risk_level || "unknown"}</Badge>
                  <Badge variant="outline">{selected.source}</Badge>
                </div>
                <section>
                  <h3 className="text-sm font-medium mb-1">AI Summary</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selected.ai_summary || "No AI diagnosis yet."}</p>
                </section>
                <section>
                  <h3 className="text-sm font-medium mb-1">Likely Root Cause</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selected.ai_root_cause || selected.error_message}</p>
                </section>
                <section>
                  <h3 className="text-sm font-medium mb-1">Suggested Fix</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selected.ai_suggested_fix || "Run analysis to generate a suggested fix."}</p>
                </section>
                {selected.ai_patch && (
                  <section>
                    <h3 className="text-sm font-medium mb-1">Proposed Patch Notes</h3>
                    <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-56 whitespace-pre-wrap">{selected.ai_patch}</pre>
                  </section>
                )}
                {(recommended.files?.length || recommended.tests?.length) && (
                  <section className="text-sm text-muted-foreground space-y-1">
                    {recommended.files?.length > 0 && <p><strong>Files:</strong> {recommended.files.join(", ")}</p>}
                    {recommended.tests?.length > 0 && <p><strong>Tests:</strong> {recommended.tests.join(", ")}</p>}
                  </section>
                )}
                {selected.stack_trace && (
                  <details>
                    <summary className="text-sm font-medium cursor-pointer">Stack Trace</summary>
                    <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap mt-2">{selected.stack_trace}</pre>
                  </details>
                )}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button size="sm" onClick={() => analyzeMutation.mutate(selected.id)} disabled={analyzeMutation.isPending}>
                    {analyzeMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                    Analyze
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ id: selected.id, status: "reviewed" })}>
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Mark Reviewed
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ id: selected.id, status: "pr_requested" })}>
                    <GitPullRequest className="h-4 w-4 mr-1" />
                    Request PR
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No report selected.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
