import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, AlertTriangle, AlertCircle, Info, RefreshCw, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

interface AuditIssue {
  severity: "error" | "warning" | "info";
  category: string;
  message: string;
  entity?: string;
}

interface AuditResult {
  summary: { errors: number; warnings: number; info: number; total: number };
  issues: AuditIssue[];
}

function issueActionLink(issue: AuditIssue): { label: string; href: string } | null {
  const cat = issue.category?.toLowerCase();
  if (cat === "legal entity") return { label: "Configure", href: "/app/company?tab=legal" };
  if (cat === "ein missing") return { label: "Configure", href: "/app/company?tab=legal" };
  if (cat === "pay frequency") return { label: "Company Settings", href: "/app/company" };
  if (cat === "missing worker data" || cat === "worker") return { label: "Employees", href: "/app/employees" };
  return null;
}

export default function PayrollAuditPage() {
  const [companyId, setCompanyId] = useState<string>("all");

  const { data: companies } = useQuery<any[]>({ queryKey: ["/api/companies"] });

  const queryUrl = companyId && companyId !== "all"
    ? `/api/payroll-audit?companyId=${companyId}`
    : "/api/payroll-audit";

  const { data: audit, isLoading, isError, refetch, isFetching } = useQuery<AuditResult>({
    queryKey: ["/api/payroll-audit", companyId],
    queryFn: async () => {
      const res = await fetch(queryUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch audit");
      return res.json();
    },
  });

  const severityIcon = (s: string) => {
    if (s === "error") return <AlertCircle className="h-4 w-4 text-red-500" />;
    if (s === "warning") return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    return <Info className="h-4 w-4 text-blue-500" />;
  };

  const severityBadge = (s: string) => {
    if (s === "error") return <Badge variant="destructive" data-testid={`badge-severity-${s}`}>Error</Badge>;
    if (s === "warning") return <Badge className="bg-yellow-500 text-white" data-testid={`badge-severity-${s}`}>Warning</Badge>;
    return <Badge variant="secondary" data-testid={`badge-severity-${s}`}>Info</Badge>;
  };

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="payroll-audit-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Payroll Audit</h1>
          <p className="text-muted-foreground">Check payroll configuration for errors, missing data, and compliance issues.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-company-filter">
              <SelectValue placeholder="All Companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies?.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-audit">
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Re-run Audit
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
      ) : isError ? (
        <Card data-testid="card-error">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-16 w-16 text-red-500 mb-4" />
            <h2 className="text-xl font-semibold text-red-600">Audit Failed</h2>
            <p className="text-muted-foreground mt-1">Could not run payroll audit. Please try again.</p>
            <Button variant="outline" className="mt-4" onClick={() => refetch()} data-testid="button-retry-audit">Retry</Button>
          </CardContent>
        </Card>
      ) : audit ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card data-testid="card-summary-total">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Issues</CardTitle></CardHeader>
              <CardContent><div className="text-3xl font-bold">{audit.summary.total}</div></CardContent>
            </Card>
            <Card data-testid="card-summary-errors">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-red-500">Errors</CardTitle></CardHeader>
              <CardContent><div className="text-3xl font-bold text-red-500">{audit.summary.errors}</div></CardContent>
            </Card>
            <Card data-testid="card-summary-warnings">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-yellow-500">Warnings</CardTitle></CardHeader>
              <CardContent><div className="text-3xl font-bold text-yellow-500">{audit.summary.warnings}</div></CardContent>
            </Card>
            <Card data-testid="card-summary-info">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-blue-500">Info</CardTitle></CardHeader>
              <CardContent><div className="text-3xl font-bold text-blue-500">{audit.summary.info}</div></CardContent>
            </Card>
          </div>

          {audit.summary.total === 0 ? (
            <Card data-testid="card-all-clear">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <ShieldCheck className="h-16 w-16 text-green-500 mb-4" />
                <h2 className="text-xl font-semibold text-green-600">All Clear</h2>
                <p className="text-muted-foreground mt-1">No payroll issues detected.</p>
              </CardContent>
            </Card>
          ) : (
            <Card data-testid="card-issues-list">
              <CardHeader><CardTitle>Issues</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {audit.issues.map((issue, idx) => {
                    const action = issueActionLink(issue);
                    return (
                      <div key={idx} className="flex items-start gap-3 p-3 rounded-lg border" data-testid={`row-issue-${idx}`}>
                        {severityIcon(issue.severity)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {severityBadge(issue.severity)}
                            <span className="text-xs font-medium text-muted-foreground">{issue.category}</span>
                            {issue.entity && <span className="text-xs text-muted-foreground">— {issue.entity}</span>}
                          </div>
                          <p className="text-sm" data-testid={`text-issue-message-${idx}`}>{issue.message}</p>
                          {action && (
                            <Link href={action.href}>
                              <span className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1 cursor-pointer" data-testid={`link-fix-issue-${idx}`}>
                                <ExternalLink className="h-3 w-3" />
                                {action.label} →
                              </span>
                            </Link>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
