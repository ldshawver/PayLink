import { useState, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { Company, Worker, PayrollRun, PayrollItem, PayPeriod, TaxDeduction, RemittanceSource, RemittanceAgency, RemittanceAgencyEvent, PayStubAccount, PayStubAmendment, PayStubTransaction, PayPeriodSchedule, LegalEntity, CheckTemplate, PayrollPaymentMethod, FundingAccount, PayrollPaymentRecord } from "@shared/schema";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "wouter";
import {
  DollarSign, Clock, Calendar, ChevronDown, ChevronUp, Plus, Download, Printer,
  Calculator, FileText, CreditCard, CalendarDays, Settings, Building, Building2, Receipt, Zap,
  ChevronLeft, ChevronRight, Check, AlertCircle, ArrowRight, Pencil, Trash2,
  Layout, Eye, EyeOff, Image, Save, Copy, ExternalLink, RefreshCw,
  Banknote, Wallet, BadgeCheck, CircleDot, ToggleLeft, ToggleRight, BarChart3,
  Lock, LockOpen, Send, ShieldCheck, Info, CheckCircle2, XCircle, Brain, Sparkles
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

function PolicyDocLink() {
  return (
    <a
      href="/app/company-documents?category=payroll"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
      data-testid="link-payroll-processing-rules"
    >
      <FileText className="h-3 w-3" />
      Payroll Processing Rules
    </a>
  );
}

function useTabParam(): [string, (tab: string) => void] {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get("tab") || "process";
  const setTab = (newTab: string) => {
    setLocation(`/app/payroll?tab=${newTab}`);
  };
  return [tab, setTab];
}

// ── Pay-period resolution ─────────────────────────────────────────────────────
// Period dates are now computed server-side from the company's active
// Pay Period Schedule. The frontend calls /api/pay-period-schedules/resolve-period
// and displays the server-resolved period — no local date math.
type ResolvedPeriod = { periodStart: string; periodEnd: string; schedule: PayPeriodSchedule };

function fmtPeriodDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function ProcessPayrollTab() {
  const { toast } = useToast();
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({ companyId: "", payDate: "" });
  const [showAll, setShowAll] = useState(false);
  const [dateSearch, setDateSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [workerFilter, setWorkerFilter] = useState("all");

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: payrollRuns = [], isLoading } = useQuery<PayrollRun[]>({ queryKey: ["/api/payroll-runs"] });

  // ── Resolve pay period from active schedule + payDate (server-side) ──────
  const { data: resolvedPeriod, error: resolveError } = useQuery<ResolvedPeriod>({
    queryKey: ["/api/pay-period-schedules/resolve-period", formData.companyId, formData.payDate],
    queryFn: async () => {
      const res = await fetch(
        `/api/pay-period-schedules/resolve-period?companyId=${encodeURIComponent(formData.companyId)}&payDate=${encodeURIComponent(formData.payDate)}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw Object.assign(new Error(body.message || "Could not resolve period"), body);
      }
      return res.json();
    },
    enabled: !!(formData.companyId && formData.payDate),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!formData.companyId) throw new Error("Please select a company");
      if (!formData.payDate) throw new Error("Please select a pay date");
      if (!resolvedPeriod) throw new Error("Pay period could not be resolved — check active schedule");
      const res = await apiRequest("POST", "/api/payroll-runs", {
        companyId: formData.companyId,
        payDate: formData.payDate,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs"] });
      toast({ title: "Payroll run created" });
      setDialogOpen(false);
      setFormData({ companyId: "", payDate: "" });
    },
    onError: (err: Error) => {
      // Try to extract the JSON body message from throwIfResNotOk format "STATUS: {json}"
      let description = err.message;
      const jsonStart = description.indexOf("{");
      if (jsonStart !== -1) {
        try { description = JSON.parse(description.slice(jsonStart)).message || description; } catch { /* keep raw */ }
      }
      toast({ title: "Payroll Error", description, variant: "destructive" });
    },
  });

  const totalRuns = payrollRuns.length;
  const totalPayroll = payrollRuns.reduce((sum, r) => sum + Number(r.totalGross || 0), 0);

  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || id;
  const getWorkerName = (id: string) => {
    const w = workers.find(w => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  };

  const sortedRuns = [...payrollRuns].sort((a, b) =>
    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );

  const latestByCompany: Record<string, PayrollRun> = {};
  for (const run of sortedRuns) {
    if (!latestByCompany[run.companyId]) {
      latestByCompany[run.companyId] = run;
    }
  }

  const filterableWorkers = companyFilter === "all"
    ? workers
    : workers.filter(w => w.companyId === companyFilter);

  const selectedWorker = workerFilter !== "all" ? workers.find(w => w.id === workerFilter) : null;

  let displayRuns: PayrollRun[];
  if (showAll || dateSearch || companyFilter !== "all" || workerFilter !== "all") {
    displayRuns = sortedRuns.filter(run => {
      if (companyFilter !== "all" && run.companyId !== companyFilter) return false;
      if (selectedWorker && run.companyId !== selectedWorker.companyId) return false;
      if (dateSearch) {
        const periodStart = run.periodStart ? String(run.periodStart) : "";
        const periodEnd = run.periodEnd ? String(run.periodEnd) : "";
        const createdDate = run.createdAt ? new Date(run.createdAt).toISOString().split("T")[0] : "";
        return periodStart.includes(dateSearch) || periodEnd.includes(dateSearch) || createdDate.includes(dateSearch);
      }
      return true;
    });
  } else {
    displayRuns = Object.values(latestByCompany);
    displayRuns.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }

  const exportCSV = (run: PayrollRun, items: PayrollItem[]) => {
    const headers = ["Worker", "Type", "Rate", "Reg Hrs", "OT Hrs", "Reg Pay", "OT Pay", "Gross", "Deductions", "Net Pay", "Check #"];
    const rows = items.map(item => [
      getWorkerName(item.workerId),
      item.payType || "hourly",
      item.payRate,
      item.regularHours,
      item.overtimeHours,
      item.regularPay,
      item.overtimePay,
      item.grossPay,
      item.deductions,
      item.netPay,
      item.checkNumber || "",
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-run-${run.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="loading-process-payroll">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
        {[1, 2].map(i => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm text-muted-foreground">
            Create, process, approve, and lock payroll runs. Each run moves through a linear workflow: Draft → Processed → Approved → ACH/Checks → Locked.
          </p>
        </div>
        <PolicyDocLink />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Runs</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-runs">{totalRuns}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Payroll</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-payroll">
              ${totalPayroll.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Companies</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-company-count">{Object.keys(latestByCompany).length}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={companyFilter} onValueChange={v => {
            setCompanyFilter(v);
            setWorkerFilter("all");
            if (v !== "all") setShowAll(true);
            else setShowAll(false);
          }}>
            <SelectTrigger className="w-[200px]" data-testid="select-payroll-company-filter">
              <SelectValue placeholder="All Companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={workerFilter} onValueChange={v => {
            setWorkerFilter(v);
            if (v !== "all") {
              const w = workers.find(wk => wk.id === v);
              if (w) { setCompanyFilter(w.companyId || "all"); setShowAll(true); }
            } else {
              if (companyFilter === "all") setShowAll(false);
            }
          }}>
            <SelectTrigger className="w-[180px]" data-testid="select-payroll-worker-filter">
              <SelectValue placeholder="All Employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {filterableWorkers.map(w => <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            type="date"
            className="w-[180px]"
            data-testid="input-payroll-date-search"
            value={dateSearch}
            onChange={e => { setDateSearch(e.target.value); if (e.target.value) setShowAll(true); }}
            placeholder="Search by date"
          />
          {dateSearch && (
            <Button variant="ghost" size="sm" onClick={() => setDateSearch("")} data-testid="button-clear-date">
              Clear
            </Button>
          )}
          <Button
            variant={showAll ? "default" : "outline"}
            size="sm"
            onClick={() => { setShowAll(!showAll); if (showAll) { setDateSearch(""); setCompanyFilter("all"); } }}
            data-testid="button-toggle-all-payrolls"
          >
            {showAll ? "Show Latest Only" : "Show All Payrolls"}
          </Button>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-run-payroll"><Plus className="mr-2 h-4 w-4" />Run Payroll</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between gap-2">
                Run Payroll
                <a
                  href="/docs/payroll/MyPayLink_Payroll_Processing_Rules_v1.0.docx"
                  download
                  className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 font-normal"
                  data-testid="link-payroll-rules"
                  onClick={e => e.stopPropagation()}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                  Payroll Rules v1.0
                </a>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-1">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={formData.companyId} onValueChange={v => setFormData(p => ({ ...p, companyId: v }))}>
                  <SelectTrigger data-testid="select-run-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Pay Date</Label>
                <Input
                  type="date"
                  data-testid="input-pay-date"
                  value={formData.payDate}
                  onChange={e => setFormData(p => ({ ...p, payDate: e.target.value }))}
                />
              </div>

              {formData.companyId && formData.payDate && !resolvedPeriod && resolveError && (
                <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{(resolveError as any)?.message || "Could not resolve pay period for this date."}</span>
                </div>
              )}

              {resolvedPeriod && (
                <div className="rounded-md border bg-muted/40 p-3 space-y-1.5 text-sm">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Pay Period — {resolvedPeriod.schedule.name} ({resolvedPeriod.schedule.type})
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Period start</span>
                    <span className="font-medium">{fmtPeriodDate(resolvedPeriod.periodStart)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Period end</span>
                    <span className="font-medium">{fmtPeriodDate(resolvedPeriod.periodEnd)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t pt-1.5 mt-1">
                    <span className="text-muted-foreground">Payday</span>
                    <span className="font-semibold text-emerald-600">{fmtPeriodDate(formData.payDate)}</span>
                  </div>
                </div>
              )}

              <Button
                className="w-full"
                data-testid="button-submit-payroll"
                disabled={createMutation.isPending || !formData.companyId || !formData.payDate || !resolvedPeriod}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? "Creating..." : "Create Payroll Run"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {!showAll && !dateSearch && companyFilter === "all" && workerFilter === "all" && payrollRuns.length > Object.keys(latestByCompany).length && (
        <p className="text-sm text-muted-foreground">
          Showing latest payroll per company. {payrollRuns.length - Object.keys(latestByCompany).length} older run(s) hidden.
        </p>
      )}

      <div className="space-y-4">
        {displayRuns.map(run => (
          <PayrollRunCard
            key={run.id}
            run={run}
            companyName={getCompanyName(run.companyId)}
            expanded={expandedRun === run.id}
            onToggle={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
            getWorkerName={getWorkerName}
            onExportCSV={exportCSV}
            filterWorkerId={workerFilter}
          />
        ))}
        {displayRuns.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              {payrollRuns.length === 0
                ? 'No payroll runs yet. Click "Run Payroll" to get started.'
                : "No payroll runs match your search."}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function AchStatusBadge({ achStatus }: { achStatus: string | null | undefined }) {
  if (!achStatus) return <Badge variant="outline" className="text-xs">Not submitted</Badge>;
  const map: Record<string, { label: string; className: string }> = {
    file_ready: { label: "NACHA file ready", className: "border-blue-300 text-blue-700 dark:text-blue-400" },
    submitted: { label: "ACH Submitted", className: "border-emerald-300 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20" },
    settled: { label: "ACH Settled", className: "border-emerald-500 text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/30" },
    failed: { label: "ACH Failed", className: "border-red-300 text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/20" },
  };
  const cfg = map[achStatus] || { label: achStatus, className: "" };
  return <Badge variant="outline" className={`text-xs ${cfg.className}`}>{cfg.label}</Badge>;
}

function PayrollSummaryPanel({ run, items }: { run: PayrollRun; items: PayrollItem[] }) {
  const itemGross = items.reduce((s, i) => s + Number(i.grossPay || 0), 0);
  const itemDeductions = items.reduce((s, i) => s + Number(i.deductions || 0), 0);
  const itemNet = items.reduce((s, i) => s + Number(i.netPay || 0), 0);
  const totalHours = items.reduce((s, i) => s + Number(i.regularHours || 0) + Number(i.overtimeHours || 0) + Number(i.doubleTimeHours || 0), 0);

  const totalGross = Number(run.totalGross || 0) || itemGross;
  const totalDeductions = Number(run.totalDeductions || 0) || itemDeductions;
  const totalNet = Number(run.totalNet || 0) || itemNet;
  const totalEmployerTaxes = Number(run.totalEmployerTaxes || 0);
  const totalReimbursements = Number(run.totalReimbursements || 0);
  const totalFundingRequired = totalNet + totalEmployerTaxes;

  const byMethod: Record<string, { count: number; net: number }> = {};
  for (const item of items) {
    const m = item.paymentMethod || "unspecified";
    if (!byMethod[m]) byMethod[m] = { count: 0, net: 0 };
    byMethod[m].count++;
    byMethod[m].net += Number(item.netPay || 0);
  }

  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="rounded-lg border bg-muted/20 p-4 space-y-4 print:bg-white print:border-gray-300" data-testid={`payroll-summary-panel-${run.id}`}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4" />Payroll Summary</h3>
        <Button variant="ghost" size="sm" className="print:hidden" onClick={() => window.print()} data-testid={`button-print-summary-${run.id}`}>
          <Printer className="h-3 w-3 mr-1" />Print
        </Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">Pay Period</p>
          <p className="font-medium">{run.periodStart} – {run.periodEnd}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">Pay Date</p>
          <p className="font-medium text-emerald-700 dark:text-emerald-400">{run.payDate || "—"}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">Employees</p>
          <p className="font-medium">{run.workerCount ?? items.length}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">Total Hours</p>
          <p className="font-medium">{(Number(run.totalHours) || totalHours).toFixed(1)}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">Gross Pay</p>
          <p className="font-semibold text-base">${fmt(totalGross)}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">Employee Deductions</p>
          <p className="font-medium text-red-700 dark:text-red-400">–${fmt(totalDeductions)}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">Employer Taxes</p>
          <p className="font-medium text-amber-700 dark:text-amber-400">${fmt(totalEmployerTaxes)}</p>
        </div>
        {totalReimbursements > 0 && (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">Reimbursements</p>
            <p className="font-medium text-blue-700 dark:text-blue-400">${fmt(totalReimbursements)}</p>
          </div>
        )}
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">Net Pay (Employee)</p>
          <p className="font-semibold text-base text-emerald-700 dark:text-emerald-400">${fmt(totalNet)}</p>
        </div>
        <div className="space-y-0.5 col-span-2 md:col-span-1">
          <p className="text-xs text-muted-foreground">Total Funding Required</p>
          <p className="font-bold text-base">${fmt(totalFundingRequired)}</p>
          {totalEmployerTaxes > 0 && <p className="text-xs text-muted-foreground">(net pay + employer taxes)</p>}
        </div>
      </div>
      {Object.keys(byMethod).length > 0 && (
        <div className="border-t pt-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Payment Method Breakout</p>
          <div className="flex flex-wrap gap-3">
            {Object.entries(byMethod).map(([method, data]) => (
              <div key={method} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                <Badge variant="outline" className="text-xs capitalize">{method.replace("_", " ")}</Badge>
                <span className="text-muted-foreground">{data.count} emp</span>
                <span className="font-medium">${fmt(data.net)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PayrollRunCard({
  run, companyName, expanded, onToggle, getWorkerName, onExportCSV, filterWorkerId = "all",
}: {
  run: PayrollRun;
  companyName: string;
  expanded: boolean;
  onToggle: () => void;
  getWorkerName: (id: string) => string;
  onExportCSV: (run: PayrollRun, items: PayrollItem[]) => void;
  filterWorkerId?: string;
}) {
  const { toast } = useToast();
  const { data: items = [], isLoading } = useQuery<PayrollItem[]>({
    queryKey: ["/api/payroll-runs", run.id, "items"],
    queryFn: async () => {
      const res = await fetch(`/api/payroll-runs/${run.id}/items`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch items");
      return res.json();
    },
    enabled: expanded,
  });

  const { data: fundingAccts = [] } = useQuery<FundingAccount[]>({
    queryKey: ["/api/funding-accounts"],
    enabled: expanded,
  });

  const { data: allAmendments = [] } = useQuery<PayStubAmendment[]>({
    queryKey: ["/api/pay-stub-amendments"],
    enabled: expanded,
  });
  const amendmentsByWorker: Record<string, PayStubAmendment[]> = {};
  for (const a of allAmendments) {
    if (a.amendmentType === "deduction" && a.status === "active") {
      if (!amendmentsByWorker[a.workerId]) amendmentsByWorker[a.workerId] = [];
      amendmentsByWorker[a.workerId].push(a);
    }
  }

  const displayItems = filterWorkerId === "all" ? items : items.filter(i => i.workerId === filterWorkerId);

  const isLocked = !!(run.lockedAt) || !!(run.isLocked);
  const isApproved = !!(run.approvedAt);
  const achStatus: string | null = run.achStatus || null;
  const achSubmittedAt: string | null = run.achSubmittedAt ? String(run.achSubmittedAt) : null;
  const achBatchId: string | null = run.achBatchId || null;

  const totalNet = items.reduce((s, i) => s + Number(i.netPay || 0), 0);
  const totalEmployerTaxesCalc = Number(run.totalEmployerTaxes || 0);
  const totalFundingRequired = totalNet + totalEmployerTaxesCalc;
  const linkedAccount = fundingAccts.find(a => a.id === run.fundingAccountId);
  const accountBalance = linkedAccount ? Number(linkedAccount.currentBalance || linkedAccount.openingBalance || 0) : null;
  const isFundingShort = accountBalance !== null && totalFundingRequired > accountBalance;
  const noFundingAccount = expanded && items.length > 0 && run.status !== "draft" && !run.fundingAccountId;

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editItem, setEditItem] = useState<PayrollItem | null>(null);
  const [editForm, setEditForm] = useState({ regularHours: "", overtimeHours: "", doubleTimeHours: "", payRate: "", regularPay: "", overtimePay: "", doubleTimePay: "", grossPay: "", deductions: "", netPay: "", checkNumber: "", paymentMethod: "", paymentPlatform: "" });

  const editItemMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editForm }) => {
      const res = await apiRequest("PATCH", `/api/payroll-items/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs", run.id, "items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs"] });
      toast({ title: "Payroll item updated" });
      setEditItem(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/payroll-runs/${run.id}`, { status: "draft" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs"] });
      toast({ title: "Payroll run reopened for editing" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openEdit = (item: PayrollItem) => {
    setEditItem(item);
    setEditForm({
      regularHours: item.regularHours?.toString() || "0",
      overtimeHours: item.overtimeHours?.toString() || "0",
      doubleTimeHours: item.doubleTimeHours?.toString() || "0",
      payRate: item.payRate?.toString() || "0",
      regularPay: item.regularPay?.toString() || "0",
      overtimePay: item.overtimePay?.toString() || "0",
      doubleTimePay: item.doubleTimePay?.toString() || "0",
      grossPay: item.grossPay?.toString() || "0",
      deductions: item.deductions?.toString() || "0",
      netPay: item.netPay?.toString() || "0",
      checkNumber: item.checkNumber || "",
      paymentMethod: item.paymentMethod || "",
      paymentPlatform: item.paymentPlatform || "",
    });
  };

  const [aiReviewOpen, setAiReviewOpen] = useState(false);
  const [aiReviewResult, setAiReviewResult] = useState<{
    overallRisk: "low" | "medium" | "high";
    summary: string;
    flags: { severity: "error" | "warning" | "info"; category: string; title: string; detail: string }[];
  } | null>(null);

  const aiReviewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/payroll-runs/${run.id}/ai-review`, {});
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "AI review failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setAiReviewResult(data);
      setAiReviewOpen(true);
    },
    onError: (err: Error) => {
      toast({ title: "AI Review Error", description: err.message, variant: "destructive" });
    },
  });

  const processMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/payroll-runs/${run.id}/process`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs", run.id, "items"] });
      toast({ title: "Payroll processed successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/payroll-runs/${run.id}/approve`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs"] });
      toast({ title: "Payroll run approved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const submitAchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/payroll-runs/${run.id}/submit-ach`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs"] });
      toast({ title: "ACH batch submitted", description: "Direct deposits have been submitted to the ACH network." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const lockMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/payroll-runs/${run.id}/lock`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs"] });
      toast({ title: "Payroll run locked", description: "All details are now read-only." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/payroll-runs/${run.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs"] });
      toast({ title: "Payroll run deleted" });
      setConfirmDelete(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setConfirmDelete(false);
    },
  });

  const ddToggleMutation = useMutation({
    mutationFn: async (val: boolean) => {
      const res = await apiRequest("PATCH", `/api/payroll-runs/${run.id}`, { useDirectDeposit: val });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [payDateInput, setPayDateInput] = useState(run.payDate || "");

  const payDateMutation = useMutation({
    mutationFn: async (date: string) => {
      const res = await apiRequest("PATCH", `/api/payroll-runs/${run.id}`, { payDate: date });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs"] });
      toast({ title: "Pay date saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const downloadNacha = async () => {
    try {
      const res = await fetch(`/api/payroll-runs/${run.id}/nacha`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to generate ACH file" }));
        toast({ title: "ACH Error", description: err.message, variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const nameMatch = disposition.match(/filename="([^"]+)"/);
      const fileName = nameMatch ? nameMatch[1] : `ACH_${run.periodEnd}.ach`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "NACHA file downloaded", description: `${fileName} — upload to your bank to initiate direct deposits.` });
      await apiRequest("PATCH", `/api/payroll-runs/${run.id}`, { achStatus: "file_ready" });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs"] });
    } catch {
      toast({ title: "Error", description: "Failed to download ACH file", variant: "destructive" });
    }
  };

  const statusVariant = run.status === "paid" ? "default" : run.status === "processed" ? "secondary" : "outline";

  // Full guided workflow step indicators matching the required sequence:
  // Select Company → Select Pay Date → Preview Items → Generate Summary → Approve → Submit ACH/Print Checks → Lock
  const steps = [
    { label: "Select Company", done: true, active: false },
    { label: "Select Pay Date", done: !!run.payDate, active: !run.payDate },
    { label: "Preview Items", done: run.status !== "draft", active: run.status === "draft" },
    { label: "Generate Summary", done: run.status === "processed" || run.status === "paid", active: run.status === "draft" },
    { label: "Approve", done: isApproved, active: run.status === "processed" && !isApproved },
    { label: achStatus === "submitted" || achStatus === "settled" ? "ACH Submitted" : "Submit ACH / Print Checks", done: achStatus === "submitted" || achStatus === "settled", active: isApproved && !achStatus && !isLocked },
    { label: "Locked", done: isLocked, active: isApproved && (achStatus === "submitted" || achStatus === "settled" || run.useDirectDeposit === false) && !isLocked },
  ];

  return (
    <Card data-testid={`card-payroll-run-${run.id}`} className={isLocked ? "border-slate-300 dark:border-slate-700" : ""}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-3 flex-wrap">
          <CardTitle className="text-base">{companyName}</CardTitle>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">
              Period: <span className="font-medium text-foreground">{run.periodStart}</span> – <span className="font-medium text-foreground">{run.periodEnd}</span>
            </span>
            {run.payDate && (
              <span className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />Pay Date: {new Date(run.payDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            )}
          </div>
          <Badge variant={statusVariant} data-testid={`badge-status-${run.id}`}>{run.status}</Badge>
          {isApproved && !isLocked && (
            <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-400 text-xs flex items-center gap-1">
              <ShieldCheck className="h-3 w-3" />Approved
            </Badge>
          )}
          {isLocked && (
            <Badge variant="outline" className="border-slate-400 text-slate-600 dark:text-slate-400 text-xs flex items-center gap-1" data-testid={`badge-locked-${run.id}`}>
              <Lock className="h-3 w-3" />Locked
            </Badge>
          )}
          {achStatus && (
            <AchStatusBadge achStatus={achStatus} />
          )}
          {(run.status === "processed" || run.status === "paid") && (
            <Button
              variant="ghost" size="sm"
              className="text-xs text-muted-foreground hover:text-foreground h-auto py-0.5 px-1.5"
              data-testid={`link-payroll-summary-${run.id}`}
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
            >
              <BarChart3 className="h-3 w-3 mr-1" />Payroll Summary
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">{run.workerCount} workers</span>
          <span className="text-sm font-medium">${Number(run.totalGross || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
          <span className="text-sm text-muted-foreground">{Number(run.totalHours || 0).toFixed(1)} hrs</span>
          {!isLocked && (
            <Button
              size="icon" variant="ghost"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              data-testid={`button-delete-run-${run.id}`}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button size="icon" variant="ghost" data-testid={`button-expand-${run.id}`} onClick={onToggle}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Payroll Run?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the payroll run for <strong>{companyName}</strong> covering{" "}
            <strong>{run.periodStart} — {run.periodEnd}</strong> and all its payroll items.
            This cannot be undone.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setConfirmDelete(false)} data-testid="button-cancel-delete-run">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-run"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Payroll Run"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!editItem} onOpenChange={(o) => !o && setEditItem(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Edit Payroll Item — {editItem ? getWorkerName(editItem.workerId) : ""}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { label: "Pay Rate", key: "payRate" },
              { label: "Regular Hours", key: "regularHours" },
              { label: "Overtime Hours", key: "overtimeHours" },
              { label: "Double Time Hours", key: "doubleTimeHours" },
              { label: "Regular Pay", key: "regularPay" },
              { label: "Overtime Pay", key: "overtimePay" },
              { label: "Double Time Pay", key: "doubleTimePay" },
              { label: "Gross Pay", key: "grossPay" },
              { label: "Deductions", key: "deductions" },
              { label: "Net Pay", key: "netPay" },
              { label: "Check Number", key: "checkNumber" },
            ].map(({ label, key }) => (
              <div key={key} className="grid gap-1">
                <Label className="text-xs">{label}</Label>
                <Input
                  type={key === "checkNumber" ? "text" : "number"}
                  step="0.01"
                  value={(editForm as any)[key]}
                  onChange={(e) => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                  data-testid={`input-edit-item-${key}`}
                />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 border-t pt-3">
            <div className="grid gap-1">
              <Label className="text-xs">Payment Method</Label>
              <Select value={editForm.paymentMethod} onValueChange={v => setEditForm(f => ({ ...f, paymentMethod: v === "none" ? "" : v }))}>
                <SelectTrigger data-testid="select-edit-paymentMethod"><SelectValue placeholder="Select method" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not specified</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="direct_deposit">Direct Deposit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editForm.paymentMethod === "direct_deposit" && (
              <div className="grid gap-1">
                <Label className="text-xs">Platform (if digital)</Label>
                <Select value={editForm.paymentPlatform} onValueChange={v => setEditForm(f => ({ ...f, paymentPlatform: v === "none" ? "" : v }))}>
                  <SelectTrigger data-testid="select-edit-paymentPlatform"><SelectValue placeholder="Select platform" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Bank / ACH</SelectItem>
                    <SelectItem value="apple_pay">Apple Pay</SelectItem>
                    <SelectItem value="cash_app">Cash App</SelectItem>
                    <SelectItem value="paypal">PayPal</SelectItem>
                    <SelectItem value="venmo">Venmo</SelectItem>
                    <SelectItem value="zelle">Zelle</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
            <Button
              disabled={editItemMutation.isPending}
              onClick={() => editItem && editItemMutation.mutate({ id: editItem.id, data: editForm })}
              data-testid="button-save-payroll-item"
            >
              {editItemMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {expanded && (
        <CardContent className="space-y-4">
          {/* ── Workflow steps indicator ───────────────────────────────── */}
          <div className="flex items-center gap-1 flex-wrap" data-testid={`workflow-steps-${run.id}`}>
            {steps.map((step, idx) => (
              <Fragment key={step.label}>
                <div className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium
                  ${step.done ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400" :
                    step.active ? "bg-blue-100 text-blue-800 dark:bg-blue-950/30 dark:text-blue-400 ring-1 ring-blue-400" :
                    "bg-muted text-muted-foreground"}`}
                >
                  {step.done ? <Check className="h-3 w-3" /> : step.active ? <CircleDot className="h-3 w-3" /> : <span className="h-3 w-3 rounded-full border border-current inline-flex" />}
                  {step.label}
                </div>
                {idx < steps.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
              </Fragment>
            ))}
          </div>

          {isLoading ? (
            <Skeleton className="h-32 w-full" data-testid={`loading-items-${run.id}`} />
          ) : (
            <>
              {/* ── Preview Items step (shown for draft runs) ─────────────── */}
              {run.status === "draft" && (
                <div className="rounded-lg border bg-muted/10 p-4 space-y-2" data-testid={`preview-items-panel-${run.id}`}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <Info className="h-4 w-4 text-blue-500" />
                      Preview Items — Review Before Generating Summary
                    </h3>
                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400">
                      Draft
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Review the period <span className="font-medium">{run.periodStart}</span> – <span className="font-medium">{run.periodEnd}</span> before generating the payroll summary.
                    All time entries for active employees will be included. Click <strong>Generate Summary</strong> to process and produce the payroll summary.
                  </p>
                </div>
              )}

              {/* ── Payroll Summary panel (shown when processed) ─────────── */}
              {(run.status === "processed" || run.status === "paid") && items.length > 0 && (
                <PayrollSummaryPanel run={run} items={items} />
              )}

              {/* ── Funding validation ────────────────────────────────────── */}
              {noFundingAccount && (
                <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2" data-testid={`alert-no-funding-${run.id}`}>
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-medium">No funding account linked.</span>
                    <span className="ml-1">Assign a funding account to this payroll run to enable funding validation.</span>
                  </div>
                </div>
              )}
              {isFundingShort && (
                <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-800 dark:text-red-300 flex items-start gap-2" data-testid={`alert-underfunded-${run.id}`}>
                  <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-medium">Underfunding warning.</span>
                    <span className="ml-1">Total funding required (${totalFundingRequired.toLocaleString("en-US", { minimumFractionDigits: 2 })}) exceeds funding account balance (${(accountBalance as number).toLocaleString("en-US", { minimumFractionDigits: 2 })}).</span>
                  </div>
                </div>
              )}

              {/* ── ACH Status section ────────────────────────────────────── */}
              {(run.status === "processed" || run.status === "paid") && run.useDirectDeposit !== false && (
                <div className="rounded-lg border bg-muted/20 p-3 space-y-2" data-testid={`ach-section-${run.id}`}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ACH / Direct Deposit Status</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <AchStatusBadge achStatus={achStatus} />
                    {achBatchId && (
                      <span className="text-xs font-mono text-muted-foreground" data-testid={`ach-batch-id-${run.id}`}>Batch: {achBatchId}</span>
                    )}
                    {achSubmittedAt && (
                      <span className="text-xs text-muted-foreground" data-testid={`ach-submitted-at-${run.id}`}>
                        Submitted: {new Date(achSubmittedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {achStatus === "submitted" || achStatus === "settled"
                      ? "ACH batch has been submitted to the network. Processing takes 1–3 business days."
                      : "Download the NACHA file to send to your bank, or use Submit ACH to mark it as electronically submitted."}
                  </p>
                </div>
              )}

              {/* ── Direct Deposit Controls ───────────────────────────────── */}
              {!isLocked && (
                <div className="flex flex-wrap items-center gap-4 p-3 rounded-lg border bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`dd-toggle-${run.id}`}
                      checked={run.useDirectDeposit !== false}
                      onCheckedChange={(val) => ddToggleMutation.mutate(val)}
                      disabled={ddToggleMutation.isPending || isLocked}
                      data-testid={`switch-direct-deposit-${run.id}`}
                    />
                    <Label htmlFor={`dd-toggle-${run.id}`} className="text-sm font-medium cursor-pointer">
                      Direct Deposit (ACH) this payroll
                    </Label>
                  </div>
                  {run.useDirectDeposit !== false && (
                    <div className="flex items-center gap-2">
                      <Label className="text-sm text-muted-foreground whitespace-nowrap">Pay Date:</Label>
                      <Input
                        type="date"
                        className="h-7 w-36 text-sm"
                        value={payDateInput}
                        onChange={(e) => setPayDateInput(e.target.value)}
                        onBlur={(e) => e.target.value && payDateMutation.mutate(e.target.value)}
                        disabled={isLocked}
                        data-testid={`input-pay-date-${run.id}`}
                      />
                    </div>
                  )}
                  {run.useDirectDeposit === false && (
                    <span className="text-sm text-muted-foreground italic">Direct deposit disabled — employees will receive checks</span>
                  )}
                </div>
              )}

              {/* ── Action buttons ───────────────────────────────────────── */}
              {isLocked ? (
                <div className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 text-sm text-slate-600 dark:text-slate-400" data-testid={`locked-notice-${run.id}`}>
                  <Lock className="h-4 w-4 shrink-0" />
                  <span>This payroll run is locked. All details are read-only. Locked on {run.lockedAt ? new Date(run.lockedAt).toLocaleDateString() : "—"}.</span>
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {/* AI Pre-Flight Review — available for draft and processed runs */}
                  {(run.status === "draft" || run.status === "processed") && !isLocked && (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`button-ai-review-${run.id}`}
                      disabled={aiReviewMutation.isPending}
                      onClick={() => aiReviewMutation.mutate()}
                      className="border-violet-400/50 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                    >
                      <Brain className="mr-2 h-4 w-4" />
                      {aiReviewMutation.isPending ? "Analyzing..." : "AI Pre-Flight Review"}
                    </Button>
                  )}
                  {run.status === "draft" && (
                    <Button
                      size="sm"
                      data-testid={`button-process-run-${run.id}`}
                      disabled={processMutation.isPending}
                      onClick={() => processMutation.mutate()}
                    >
                      <Zap className="mr-2 h-4 w-4" />
                      {processMutation.isPending ? "Processing..." : "Generate Summary"}
                    </Button>
                  )}
                  {run.status === "processed" && !isApproved && (
                    <Button
                      size="sm"
                      variant="default"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      data-testid={`button-approve-run-${run.id}`}
                      disabled={approveMutation.isPending}
                      onClick={() => approveMutation.mutate()}
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      {approveMutation.isPending ? "Approving..." : "Approve Payroll"}
                    </Button>
                  )}
                  {(run.status === "processed" || run.status === "paid") && isApproved && run.useDirectDeposit !== false && achStatus !== "submitted" && achStatus !== "settled" && (
                    <>
                      <Button
                        size="sm"
                        variant="default"
                        className="bg-teal-600 hover:bg-teal-700 text-white"
                        onClick={downloadNacha}
                        data-testid={`button-download-ach-${run.id}`}
                      >
                        <Download className="mr-2 h-4 w-4" />Download NACHA File
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-teal-400 text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950/20"
                        data-testid={`button-submit-ach-${run.id}`}
                        disabled={submitAchMutation.isPending}
                        onClick={() => submitAchMutation.mutate()}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        {submitAchMutation.isPending ? "Submitting..." : "Submit ACH Batch"}
                      </Button>
                    </>
                  )}
                  {(run.status === "processed" || run.status === "paid") && isApproved && (
                    run.useDirectDeposit === false || achStatus === "submitted" || achStatus === "settled"
                      ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-slate-400 text-slate-700 hover:bg-slate-50 dark:text-slate-400"
                          data-testid={`button-lock-run-${run.id}`}
                          disabled={lockMutation.isPending}
                          onClick={() => lockMutation.mutate()}
                        >
                          <Lock className="mr-2 h-4 w-4" />
                          {lockMutation.isPending ? "Locking..." : "Lock Payroll Run"}
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground px-2 py-1 rounded border border-dashed" data-testid={`lock-pending-notice-${run.id}`}>
                          <LockOpen className="h-3 w-3" />
                          <span>Submit ACH or confirm checks printed to enable locking</span>
                        </div>
                      )
                  )}
                  {(run.status === "processed" || run.status === "paid") && (
                    <Button
                      variant="outline" size="sm"
                      data-testid={`button-reopen-run-${run.id}`}
                      disabled={reopenMutation.isPending}
                      onClick={() => reopenMutation.mutate()}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      {reopenMutation.isPending ? "Reopening..." : "Reopen for Editing"}
                    </Button>
                  )}
                  {(run.status === "processed" || run.status === "paid") && (
                    <Link href={`/app/print-check/${run.id}`}>
                      <Button variant="outline" size="sm" data-testid={`button-print-checks-${run.id}`}>
                        <Printer className="mr-2 h-4 w-4" />Print Checks
                      </Button>
                    </Link>
                  )}
                  {(run.status === "processed" || run.status === "paid") && (
                    <Link href={`/app/print-check/${run.id}?packet=1`}>
                      <Button variant="outline" size="sm" data-testid={`button-print-packet-${run.id}`}>
                        <FileText className="mr-2 h-4 w-4" />Print Payroll Packet
                      </Button>
                    </Link>
                  )}
                  <Button variant="outline" size="sm" data-testid={`button-export-csv-${run.id}`} onClick={() => onExportCSV(run, items)}>
                    <Download className="mr-2 h-4 w-4" />Export CSV
                  </Button>
                </div>
              )}

              {/* ── AI Pre-Flight Review Dialog ──────────────────────────── */}
              <Dialog open={aiReviewOpen} onOpenChange={setAiReviewOpen}>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="dialog-ai-review">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Brain className="h-5 w-5 text-violet-500" />
                      AI Payroll Pre-Flight Review
                    </DialogTitle>
                  </DialogHeader>
                  {aiReviewResult && (
                    <div className="space-y-4">
                      {/* Risk level banner */}
                      <div className={`flex items-center gap-3 p-3 rounded-lg border ${
                        aiReviewResult.overallRisk === "high"
                          ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
                          : aiReviewResult.overallRisk === "medium"
                          ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
                          : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800"
                      }`}>
                        {aiReviewResult.overallRisk === "high" ? (
                          <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                        ) : aiReviewResult.overallRisk === "medium" ? (
                          <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
                        ) : (
                          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                        )}
                        <div>
                          <div className={`font-semibold text-sm capitalize ${
                            aiReviewResult.overallRisk === "high" ? "text-red-700 dark:text-red-300"
                            : aiReviewResult.overallRisk === "medium" ? "text-amber-700 dark:text-amber-300"
                            : "text-emerald-700 dark:text-emerald-300"
                          }`}>
                            {aiReviewResult.overallRisk === "high" ? "High Risk" : aiReviewResult.overallRisk === "medium" ? "Review Recommended" : "Looks Good"} — {aiReviewResult.overallRisk.charAt(0).toUpperCase() + aiReviewResult.overallRisk.slice(1)} Risk
                          </div>
                          <div className="text-sm text-muted-foreground">{aiReviewResult.summary}</div>
                        </div>
                      </div>

                      {/* Flags */}
                      {aiReviewResult.flags.length === 0 ? (
                        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground bg-muted/40 rounded-lg">
                          <Sparkles className="h-4 w-4 text-emerald-500" />
                          No issues found. Payroll data looks clean and ready to process.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-sm font-medium text-muted-foreground">{aiReviewResult.flags.length} item{aiReviewResult.flags.length !== 1 ? "s" : ""} flagged for review:</p>
                          {aiReviewResult.flags.map((flag, i) => (
                            <div key={i} className={`p-3 rounded-lg border-l-4 ${
                              flag.severity === "error"
                                ? "border-l-red-500 bg-red-50 dark:bg-red-950/20"
                                : flag.severity === "warning"
                                ? "border-l-amber-500 bg-amber-50 dark:bg-amber-950/20"
                                : "border-l-blue-500 bg-blue-50 dark:bg-blue-950/20"
                            }`}>
                              <div className="flex items-start gap-2">
                                {flag.severity === "error" ? (
                                  <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                                ) : flag.severity === "warning" ? (
                                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                                ) : (
                                  <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                                )}
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold">{flag.title}</span>
                                    <Badge variant="outline" className="text-xs capitalize">{flag.category}</Badge>
                                  </div>
                                  <p className="text-sm text-muted-foreground mt-1">{flag.detail}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <p className="text-xs text-muted-foreground border-t pt-3">
                        AI review is advisory only. Always verify payroll data before final processing. Powered by GPT-4o.
                      </p>
                    </div>
                  )}
                </DialogContent>
              </Dialog>

              {/* ── Items table (read-only for locked runs) ──────────────── */}
              {(!isLocked || expanded) && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Worker</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Rate</TableHead>
                        <TableHead>Reg Hrs</TableHead>
                        <TableHead>OT Hrs</TableHead>
                        <TableHead>Reg Pay</TableHead>
                        <TableHead>OT Pay</TableHead>
                        <TableHead>Gross</TableHead>
                        <TableHead>Deductions</TableHead>
                        <TableHead>Net Pay</TableHead>
                        <TableHead>Check #</TableHead>
                        {!isLocked && <TableHead className="w-10"></TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayItems.map(item => {
                        const workerAmends = amendmentsByWorker[item.workerId] || [];
                        const amendTotal = workerAmends.reduce((s, a) => s + Number(a.amount || 0), 0);
                        const storedDeductions = Number(item.deductions || 0);
                        const grossPay = Number(item.grossPay || 0);
                        const displayDeductions = storedDeductions >= amendTotal ? storedDeductions : storedDeductions + amendTotal;
                        const displayNetPay = grossPay - displayDeductions;
                        return (
                          <Fragment key={item.id}>
                            <TableRow data-testid={`row-payroll-item-${item.id}`}>
                              <TableCell>{getWorkerName(item.workerId)}</TableCell>
                              <TableCell>{item.payType || "hourly"}</TableCell>
                              <TableCell>${Number(item.payRate || 0).toFixed(2)}</TableCell>
                              <TableCell>{Number(item.regularHours || 0).toFixed(1)}</TableCell>
                              <TableCell>{Number(item.overtimeHours || 0).toFixed(1)}</TableCell>
                              <TableCell>${Number(item.regularPay || 0).toFixed(2)}</TableCell>
                              <TableCell>${Number(item.overtimePay || 0).toFixed(2)}</TableCell>
                              <TableCell className="font-medium">${grossPay.toFixed(2)}</TableCell>
                              <TableCell>
                                <div className={amendTotal > 0 && storedDeductions < amendTotal ? "font-medium text-red-700 dark:text-red-400" : ""}>
                                  ${displayDeductions.toFixed(2)}
                                </div>
                                {amendTotal > 0 && storedDeductions < amendTotal && (
                                  <div className="text-xs text-amber-600 mt-0.5">⚠ reprocess to save</div>
                                )}
                              </TableCell>
                              <TableCell className="font-medium">${displayNetPay.toFixed(2)}</TableCell>
                              <TableCell>{item.checkNumber || "—"}</TableCell>
                              {!isLocked && (
                                <TableCell>
                                  <Button size="icon" variant="ghost" onClick={() => openEdit(item)} data-testid={`button-edit-payroll-item-${item.id}`}>
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                </TableCell>
                              )}
                            </TableRow>
                            {workerAmends.map(a => (
                              <TableRow key={`amend-${a.id}`} className="bg-red-50 dark:bg-red-950/20">
                                <TableCell colSpan={8} className="text-xs text-red-700 dark:text-red-400 pl-6 py-1 italic">
                                  ↳ Deduction: {a.description || "Pay Stub Deduction"}
                                </TableCell>
                                <TableCell className="text-xs font-medium text-red-700 dark:text-red-400 py-1">–${Number(a.amount || 0).toFixed(2)}</TableCell>
                                <TableCell colSpan={isLocked ? 2 : 3} />
                              </TableRow>
                            ))}
                          </Fragment>
                        );
                      })}
                      {items.length === 0 && (
                        <TableRow><TableCell colSpan={isLocked ? 11 : 12} className="text-center text-muted-foreground">No items — process payroll to generate them</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

type PayStubItemWithRun = PayrollItem & { _run: PayrollRun };

function PayStubViewModal({ item, worker, company, run, taxesDeductions, onClose }: {
  item: PayStubItemWithRun;
  worker: Worker | undefined;
  company: Company | undefined;
  run: PayrollRun;
  taxesDeductions: TaxDeduction[];
  onClose: () => void;
}) {
  const { data: amendments = [] } = useQuery<PayStubAmendment[]>({ queryKey: ["/api/pay-stub-amendments"] });
  const isLocked = run.status === "processed" || run.status === "paid";
  const grossPay = Number(item.grossPay || 0);
  const netPay = Number(item.netPay || 0);
  const deductions = Number(item.deductions || 0);
  const fmtDate = (d: string | null | undefined) => {
    if (!d) return "—";
    const parts = d.split("-");
    return parts.length === 3 ? `${parts[1]}/${parts[2]}/${parts[0]}` : d;
  };

  const payDate = run.payDate ? fmtDate(run.payDate) : "—";

  const companyDeductions = taxesDeductions.filter(d => d.companyId === run.companyId && d.isActive && !d.isEmployerPaid && !d.isReferenceOnly);
  const isContractor = worker?.workerType === "contractor";
  const workerAmendments = amendments.filter(a => a.workerId === item.workerId && a.status === "active" && a.amendmentType === "deduction");
  // Scope stub edit history to this specific run by matching the periodEnd (set as effectiveDate during edit)
  const stubHistory = amendments.filter(a =>
    a.workerId === item.workerId &&
    a.amendmentType === "stub_edit" &&
    a.effectiveDate === run.periodEnd
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Pay Stub — {worker ? `${worker.firstName} ${worker.lastName}` : "Employee"}
            {isLocked && <Badge variant="secondary" className="text-xs">Read Only</Badge>}
          </DialogTitle>
        </DialogHeader>

        {isLocked && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2" data-testid="banner-stub-locked">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Finalized — Read Only. This pay stub belongs to a processed payroll run and cannot be edited.
          </div>
        )}

        <div className="space-y-4">
          {/* Header info */}
          <div className="grid grid-cols-2 gap-4 text-sm border rounded-lg p-4 bg-muted/20">
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Company</div>
              <div className="font-medium">{company?.name || "—"}</div>
              {company?.ein && <div className="text-xs text-muted-foreground">EIN: {company.ein}</div>}
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground mb-0.5">Pay Date</div>
              <div className="font-semibold text-emerald-600">{payDate}</div>
              <div className="text-xs text-muted-foreground">
                Period: {fmtDate(run.periodStart)} — {fmtDate(run.periodEnd)}
              </div>
            </div>
          </div>

          {/* Employee info */}
          {worker && (
            <div className="text-sm border rounded-lg p-4">
              <div className="font-semibold mb-1">{worker.firstName} {worker.lastName}</div>
              {worker.address && <div className="text-muted-foreground text-xs">{worker.address}</div>}
              {(worker.city || worker.state || worker.zip) && (
                <div className="text-muted-foreground text-xs">{[worker.city, worker.state, worker.zip].filter(Boolean).join(", ")}</div>
              )}
              {worker.ssn && (
                <div className="text-xs text-muted-foreground mt-1">SSN: ***-**-{worker.ssn.replace(/\D/g, "").slice(-4) || "****"}</div>
              )}
            </div>
          )}

          {/* Earnings */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide">Earnings</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-right text-xs">Hours</TableHead>
                  <TableHead className="text-right text-xs">Rate</TableHead>
                  <TableHead className="text-right text-xs">Amount</TableHead>
                  <TableHead className="text-right text-xs">YTD</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-sm">Regular</TableCell>
                  <TableCell className="text-right text-sm">{Number(item.regularHours || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-right text-sm">${Number(item.payRate || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-right text-sm">${Number(item.regularPay || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-right text-sm">${Number(item.ytdGross || 0).toFixed(2)}</TableCell>
                </TableRow>
                {Number(item.overtimeHours || 0) > 0 && (
                  <TableRow>
                    <TableCell className="text-sm">Overtime (1.5×)</TableCell>
                    <TableCell className="text-right text-sm">{Number(item.overtimeHours || 0).toFixed(2)}</TableCell>
                    <TableCell className="text-right text-sm">${(Number(item.payRate || 0) * 1.5).toFixed(2)}</TableCell>
                    <TableCell className="text-right text-sm">${Number(item.overtimePay || 0).toFixed(2)}</TableCell>
                    <TableCell className="text-right text-sm">—</TableCell>
                  </TableRow>
                )}
                {Number(item.doubleTimeHours || 0) > 0 && (
                  <TableRow>
                    <TableCell className="text-sm">Double Time (2×)</TableCell>
                    <TableCell className="text-right text-sm">{Number(item.doubleTimeHours || 0).toFixed(2)}</TableCell>
                    <TableCell className="text-right text-sm">${(Number(item.payRate || 0) * 2).toFixed(2)}</TableCell>
                    <TableCell className="text-right text-sm">${Number(item.doubleTimePay || 0).toFixed(2)}</TableCell>
                    <TableCell className="text-right text-sm">—</TableCell>
                  </TableRow>
                )}
                <TableRow className="font-semibold bg-muted/20">
                  <TableCell className="text-sm" colSpan={3}>Gross Pay</TableCell>
                  <TableCell className="text-right text-sm">${grossPay.toFixed(2)}</TableCell>
                  <TableCell className="text-right text-sm">${Number(item.ytdGross || 0).toFixed(2)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* Deductions */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide">Deductions</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Description</TableHead>
                  <TableHead className="text-right text-xs">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companyDeductions
                  .filter(d => {
                    const appliesTo = d.appliesTo || "all";
                    if (appliesTo === "employee" && isContractor) return false;
                    if (appliesTo === "contractor" && !isContractor) return false;
                    return true;
                  })
                  .map(d => {
                    let amount = 0;
                    if (d.calculationType === "percentage") {
                      const base = d.maxAmount ? Math.min(grossPay, Number(d.maxAmount)) : grossPay;
                      amount = base * (Number(d.rate || 0) / 100);
                    } else {
                      amount = Number(d.rate || 0);
                    }
                    if (amount <= 0) return null;
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="text-sm">{d.name}</TableCell>
                        <TableCell className="text-right text-sm">${amount.toFixed(2)}</TableCell>
                      </TableRow>
                    );
                  })
                  .filter(Boolean)
                }
                {workerAmendments.map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="text-sm text-red-600 dark:text-red-400">{a.description || "Pay Stub Deduction"}</TableCell>
                    <TableCell className="text-right text-sm text-red-600 dark:text-red-400">${Number(a.amount || 0).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold bg-muted/20">
                  <TableCell className="text-sm">Total Deductions</TableCell>
                  <TableCell className="text-right text-sm">${deductions.toFixed(2)}</TableCell>
                </TableRow>
                <TableRow className="font-bold">
                  <TableCell className="text-sm">Net Pay</TableCell>
                  <TableCell className="text-right text-sm text-emerald-600">${netPay.toFixed(2)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* YTD Summary */}
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="border rounded-lg p-3 text-center">
              <div className="text-xs text-muted-foreground mb-0.5">YTD Gross</div>
              <div className="font-semibold">${Number(item.ytdGross || 0).toFixed(2)}</div>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="text-xs text-muted-foreground mb-0.5">YTD Deductions</div>
              <div className="font-semibold">${Number(item.ytdDeductions || 0).toFixed(2)}</div>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="text-xs text-muted-foreground mb-0.5">YTD Net</div>
              <div className="font-semibold text-emerald-600">${Number(item.ytdNet || 0).toFixed(2)}</div>
            </div>
          </div>

          {/* Audit History */}
          {stubHistory.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
                <FileText className="h-3 w-3" />Amendment History
              </div>
              <div className="p-3 space-y-2">
                {stubHistory.map(h => (
                  <div key={h.id} className="text-xs border-l-2 border-amber-400 pl-3 py-1">
                    <div className="font-medium">{h.description || "Amendment"}</div>
                    <div className="text-muted-foreground">{h.publicNote}</div>
                    <div className="text-muted-foreground">{h.createdAt ? new Date(h.createdAt).toLocaleString() : ""}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {item.checkNumber && (
            <div className="flex justify-between text-sm border rounded-lg p-3 bg-muted/20">
              <span className="text-muted-foreground">Check Number</span>
              <span className="font-mono font-medium">#{item.checkNumber}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} data-testid="button-close-stub-modal">Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PayStubEditModal({ item, run, onClose, onSaved }: {
  item: PayStubItemWithRun;
  run: PayrollRun;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const isLocked = run.status === "processed" || run.status === "paid";

  const [note, setNote] = useState("");
  const [grossPay, setGrossPay] = useState(String(item.grossPay || "0"));
  const [deductions, setDeductions] = useState(String(item.deductions || "0"));
  const [netPay, setNetPay] = useState(String(item.netPay || "0"));

  const amendMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/payroll-items/${item.id}/amend`, {
        grossPay,
        deductions,
        netPay,
        note: note || "Manual pay stub amendment",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs"] });
      queryClient.invalidateQueries({ predicate: q => (q.queryKey[0] as string)?.startsWith?.("/api/all-payroll-items") });
      queryClient.invalidateQueries({ queryKey: ["/api/pay-stub-amendments"] });
      toast({ title: "Pay stub amended", description: "Prior values saved to audit history." });
      onSaved();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Pay Stub</DialogTitle>
        </DialogHeader>
        {isLocked && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2" data-testid="banner-edit-locked">
            <AlertCircle className="h-4 w-4 shrink-0" />
            This payroll run is locked (status: {run.status}). Editing is not permitted.
          </div>
        )}
        {!isLocked && (
          <div className="space-y-4">
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-300">
              Editing this stub will record the prior values as an amendment in the audit history.
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div className="grid gap-1">
                <Label className="text-xs">Gross Pay</Label>
                <Input type="number" step="0.01" value={grossPay} onChange={e => setGrossPay(e.target.value)} data-testid="input-stub-edit-gross" />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Deductions</Label>
                <Input type="number" step="0.01" value={deductions} onChange={e => setDeductions(e.target.value)} data-testid="input-stub-edit-deductions" />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Net Pay</Label>
                <Input type="number" step="0.01" value={netPay} onChange={e => setNetPay(e.target.value)} data-testid="input-stub-edit-net" />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Amendment Note (required for audit)</Label>
                <Textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Reason for amendment..."
                  rows={2}
                  data-testid="input-stub-edit-note"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                disabled={amendMutation.isPending || !note.trim()}
                onClick={() => amendMutation.mutate()}
                data-testid="button-submit-stub-edit"
              >
                {amendMutation.isPending ? "Saving..." : "Save Amendment"}
              </Button>
            </div>
          </div>
        )}
        {isLocked && (
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PayStubsTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "platform_super_admin";
  const [ytdCompanyId, setYtdCompanyId] = useState("");
  const [filterCompanyId, setFilterCompanyId] = useState("all");
  const [filterWorkerId, setFilterWorkerId] = useState("all");
  const [filterPeriod, setFilterPeriod] = useState("");
  const [viewItem, setViewItem] = useState<PayStubItemWithRun | null>(null);
  const [editItem, setEditItem] = useState<PayStubItemWithRun | null>(null);
  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: payrollRuns = [], isLoading: runsLoading } = useQuery<PayrollRun[]>({ queryKey: ["/api/payroll-runs"] });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: taxesDeductions = [] } = useQuery<TaxDeduction[]>({ queryKey: ["/api/taxes-deductions"] });

  const allItemsQuery = useQuery<PayStubItemWithRun[]>({
    queryKey: ["/api/all-payroll-items", payrollRuns.map(r => r.id).join(",")],
    queryFn: async () => {
      const allItems: PayStubItemWithRun[] = [];
      for (const run of payrollRuns) {
        try {
          const res = await fetch(`/api/payroll-runs/${run.id}/items`, { credentials: "include" });
          if (res.ok) {
            const items: PayrollItem[] = await res.json();
            allItems.push(...items.map(item => ({ ...item, _run: run })));
          }
        } catch {}
      }
      return allItems;
    },
    enabled: payrollRuns.length > 0,
  });

  const recalcYtdMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/payroll/recalculate-ytd", { companyId: ytdCompanyId }),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs"] });
      queryClient.invalidateQueries({ predicate: q => (q.queryKey[0] as string)?.startsWith?.("/api/all-payroll-items") });
      toast({ title: "YTD Recalculated", description: data.message });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const items = allItemsQuery.data || [];
  const getWorker = (id: string) => workers.find(w => w.id === id);
  const getWorkerName = (id: string) => {
    const w = getWorker(id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  };

  const filterableWorkers = filterCompanyId === "all"
    ? workers
    : workers.filter(w => w.companyId === filterCompanyId);

  const filteredItems = items.filter(item => {
    if (filterCompanyId !== "all" && item._run.companyId !== filterCompanyId) return false;
    if (filterWorkerId !== "all" && item.workerId !== filterWorkerId) return false;
    if (filterPeriod) {
      const ps = item._run.periodStart ? String(item._run.periodStart) : "";
      const pe = item._run.periodEnd ? String(item._run.periodEnd) : "";
      return ps.includes(filterPeriod) || pe.includes(filterPeriod);
    }
    return true;
  });

  const handlePrintStub = (item: PayStubItemWithRun) => {
    window.open(`/app/print-check/${item._run.id}?worker=${item.workerId}`, "_blank");
  };

  if (runsLoading) {
    return <div data-testid="loading-pay-stubs"><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Recalculate YTD tool */}
      <Card className="border-amber-200 dark:border-amber-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-amber-600" />
            Recalculate Year-to-Date Totals
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Fixes ytd_gross and ytd_net on all stored payroll items so they reflect only the current calendar year. Run this if pay stubs or Q1 reports show incorrect YTD figures.
          </p>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Select value={ytdCompanyId} onValueChange={setYtdCompanyId}>
            <SelectTrigger className="w-[220px]" data-testid="select-ytd-company">
              <SelectValue placeholder="Select company" />
            </SelectTrigger>
            <SelectContent>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            data-testid="button-recalculate-ytd"
            variant="outline"
            className="border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950"
            disabled={!ytdCompanyId || recalcYtdMutation.isPending}
            onClick={() => recalcYtdMutation.mutate()}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${recalcYtdMutation.isPending ? "animate-spin" : ""}`} />
            {recalcYtdMutation.isPending ? "Recalculating…" : "Recalculate YTD"}
          </Button>
        </CardContent>
      </Card>

    <Card>
      <CardHeader>
        <CardTitle>Pay Stubs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <Select value={filterCompanyId} onValueChange={v => { setFilterCompanyId(v); setFilterWorkerId("all"); }} data-testid="select-stubs-company">
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Companies" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterWorkerId} onValueChange={setFilterWorkerId} data-testid="select-stubs-employee">
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Employees" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {filterableWorkers.map(w => <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            type="date"
            className="w-[160px]"
            value={filterPeriod}
            onChange={e => setFilterPeriod(e.target.value)}
            placeholder="Filter by period"
            data-testid="input-stubs-period"
          />
          {(filterCompanyId !== "all" || filterWorkerId !== "all" || filterPeriod) && (
            <Button variant="ghost" size="sm" onClick={() => { setFilterCompanyId("all"); setFilterWorkerId("all"); setFilterPeriod(""); }} data-testid="button-stubs-clear">
              Clear Filters
            </Button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">{filteredItems.length} of {items.length} stubs</span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Pay Date</TableHead>
                <TableHead>Gross Pay</TableHead>
                <TableHead>Net Pay</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map(item => {
                const isLocked = item._run.status === "processed" || item._run.status === "paid";
                const company = companies.find(c => c.id === item._run.companyId);
                const worker = getWorker(item.workerId);
                const payDate = item._run.payDate
                  ? new Date(item._run.payDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : "—";
                return (
                  <TableRow key={item.id} data-testid={`row-pay-stub-${item.id}`}>
                    <TableCell>{getWorkerName(item.workerId)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{company?.name || "—"}</TableCell>
                    <TableCell className="text-sm">{item._run.periodStart} — {item._run.periodEnd}</TableCell>
                    <TableCell className="text-sm font-medium text-emerald-600">{payDate}</TableCell>
                    <TableCell>${Number(item.grossPay || 0).toFixed(2)}</TableCell>
                    <TableCell>${Number(item.netPay || 0).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={isLocked ? "secondary" : "outline"} data-testid={`badge-stub-status-${item.id}`}>
                        {isLocked ? "finalized" : (item._run.status || "draft")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="View pay stub"
                          onClick={() => setViewItem(item)}
                          data-testid={`button-view-stub-${item.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Print pay stub"
                          onClick={() => handlePrintStub(item)}
                          data-testid={`button-print-stub-${item.id}`}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        {isAdmin && (
                          <Button
                            size="icon"
                            variant="ghost"
                            title={isLocked ? "Locked — cannot edit" : "Edit pay stub (admin)"}
                            disabled={isLocked}
                            onClick={() => !isLocked && setEditItem(item)}
                            data-testid={`button-edit-stub-${item.id}`}
                          >
                            <Pencil className={`h-4 w-4 ${isLocked ? "opacity-30" : ""}`} />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredItems.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  {items.length === 0 ? "No pay stubs available" : "No stubs match the selected filters"}
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    {viewItem && (
      <PayStubViewModal
        item={viewItem}
        worker={getWorker(viewItem.workerId)}
        company={companies.find(c => c.id === viewItem._run.companyId)}
        run={viewItem._run}
        taxesDeductions={taxesDeductions}
        onClose={() => setViewItem(null)}
      />
    )}
    {editItem && (
      <PayStubEditModal
        item={editItem}
        run={editItem._run}
        onClose={() => setEditItem(null)}
        onSaved={() => setEditItem(null)}
      />
    )}
    </div>
  );
}

function PayPeriodsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({ companyId: "", startDate: "", endDate: "", payDate: "" });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: payPeriods = [], isLoading } = useQuery<PayPeriod[]>({ queryKey: ["/api/pay-periods"] });

  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || id;

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/pay-periods", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-periods"] });
      toast({ title: "Pay period created" });
      setDialogOpen(false);
      setFormData({ companyId: "", startDate: "", endDate: "", payDate: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div data-testid="loading-pay-periods"><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Pay periods are auto-generated by the <strong>Pay Period Schedules</strong> engine when payroll runs are processed. Records shown here are read-only historical references.</p>
        <PolicyDocLink />
      </div>
      <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30">
        <CardContent className="p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">These are auto-generated pay period records.</p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              To configure recurring payroll schedules (weekly, bi-weekly, semi-monthly, monthly), use the <strong>Pay Period Schedules</strong> tab. Manual pay period creation is for legacy data import only and will not affect the payroll engine.
            </p>
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" data-testid="button-add-pay-period"><Plus className="mr-2 h-4 w-4" />Import Legacy Pay Period</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Pay Period</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={formData.companyId} onValueChange={v => setFormData(p => ({ ...p, companyId: v }))}>
                  <SelectTrigger data-testid="select-period-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" data-testid="input-period-start-date" value={formData.startDate} onChange={e => setFormData(p => ({ ...p, startDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" data-testid="input-period-end-date" value={formData.endDate} onChange={e => setFormData(p => ({ ...p, endDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Pay Date</Label>
                <Input type="date" data-testid="input-period-pay-date" value={formData.payDate} onChange={e => setFormData(p => ({ ...p, payDate: e.target.value }))} />
              </div>
              <Button
                className="w-full"
                data-testid="button-submit-pay-period"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate(formData)}
              >
                {createMutation.isPending ? "Creating..." : "Create Pay Period"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Pay Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payPeriods.map(pp => (
                  <TableRow key={pp.id} data-testid={`row-pay-period-${pp.id}`}>
                    <TableCell>{getCompanyName(pp.companyId)}</TableCell>
                    <TableCell>{pp.startDate}</TableCell>
                    <TableCell>{pp.endDate}</TableCell>
                    <TableCell>{pp.payDate || "—"}</TableCell>
                    <TableCell><Badge variant="outline" data-testid={`badge-period-status-${pp.id}`}>{pp.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {payPeriods.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No pay periods</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  mandatory_tax: "Mandatory Taxes",
  garnishment: "Garnishments & Court Orders",
  benefit_deduction: "Benefit Deductions",
  voluntary_deduction: "Voluntary Deductions",
};

const CATEGORY_ORDER = ["mandatory_tax", "garnishment", "benefit_deduction", "voluntary_deduction"];

const APPLIES_TO_LABELS: Record<string, string> = { all: "All Workers", employee: "Employees", contractor: "Contractors" };

function TaxesDeductionsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string>("all");
  const [formData, setFormData] = useState({
    companyId: "", name: "", type: "tax", category: "mandatory_tax", subcategory: "",
    calculationType: "percentage", rate: "", maxAmount: "", isEmployerPaid: false,
    isReferenceOnly: false, appliesTo: "all",
  });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: taxesDeductions = [], isLoading } = useQuery<TaxDeduction[]>({ queryKey: ["/api/taxes-deductions"] });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/taxes-deductions", {
        ...data,
        rate: data.rate ? String(data.rate) : "0",
        maxAmount: data.maxAmount ? String(data.maxAmount) : null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/taxes-deductions"] });
      toast({ title: "Tax/Deduction created" });
      setDialogOpen(false);
      setFormData({ companyId: "", name: "", type: "tax", category: "mandatory_tax", subcategory: "", calculationType: "percentage", rate: "", maxAmount: "", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "all" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const quickSetupMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await apiRequest("POST", "/api/taxes-deductions/quick-setup", { companyId });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/taxes-deductions"] });
      toast({ title: "Quick Setup Complete", description: `Created ${data.count} standard items` });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/taxes-deductions/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/taxes-deductions"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/taxes-deductions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/taxes-deductions"] });
      toast({ title: "Item deleted" });
    },
  });

  if (isLoading) return <div data-testid="loading-taxes-deductions"><Skeleton className="h-64 w-full" /></div>;

  const filteredItems = selectedCompany === "all"
    ? taxesDeductions
    : taxesDeductions.filter(td => td.companyId === selectedCompany);

  const groupedItems: Record<string, TaxDeduction[]> = {};
  for (const cat of CATEGORY_ORDER) groupedItems[cat] = [];
  for (const td of filteredItems) {
    const cat = td.category || "mandatory_tax";
    if (!groupedItems[cat]) groupedItems[cat] = [];
    groupedItems[cat].push(td);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">Configure taxes, deductions, and benefits applied during payroll processing.</p>
        <PolicyDocLink />
      </div>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Select value={selectedCompany} onValueChange={setSelectedCompany}>
            <SelectTrigger className="w-[200px]" data-testid="select-td-filter-company">
              <SelectValue placeholder="All companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          {selectedCompany !== "all" && (
            <Button
              variant="outline"
              data-testid="button-quick-setup"
              disabled={quickSetupMutation.isPending}
              onClick={() => quickSetupMutation.mutate(selectedCompany)}
            >
              <Zap className="mr-2 h-4 w-4" />
              {quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
            </Button>
          )}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-tax-deduction"><Plus className="mr-2 h-4 w-4" />Add Item</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Add Tax / Deduction / Benefit</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Company</Label>
                  <Select value={formData.companyId} onValueChange={v => setFormData(p => ({ ...p, companyId: v }))}>
                    <SelectTrigger data-testid="select-td-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                    <SelectContent>
                      {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input data-testid="input-td-name" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={formData.type} onValueChange={v => setFormData(p => ({ ...p, type: v }))}>
                      <SelectTrigger data-testid="select-td-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tax">Tax</SelectItem>
                        <SelectItem value="deduction">Deduction</SelectItem>
                        <SelectItem value="benefit">Benefit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select value={formData.category} onValueChange={v => setFormData(p => ({ ...p, category: v }))}>
                      <SelectTrigger data-testid="select-td-category"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORY_ORDER.map(c => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Calculation</Label>
                    <Select value={formData.calculationType} onValueChange={v => setFormData(p => ({ ...p, calculationType: v }))}>
                      <SelectTrigger data-testid="select-td-calc-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">Percentage</SelectItem>
                        <SelectItem value="fixed">Fixed Amount</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Applies To</Label>
                    <Select value={formData.appliesTo} onValueChange={v => setFormData(p => ({ ...p, appliesTo: v }))}>
                      <SelectTrigger data-testid="select-td-applies"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Workers</SelectItem>
                        <SelectItem value="employee">Employees Only</SelectItem>
                        <SelectItem value="contractor">Contractors Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Rate</Label>
                    <Input type="number" step="0.01" data-testid="input-td-rate" value={formData.rate} onChange={e => setFormData(p => ({ ...p, rate: e.target.value }))} placeholder={formData.calculationType === "percentage" ? "e.g. 6.2" : "e.g. 150.00"} />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Annual Amount</Label>
                    <Input type="number" step="0.01" data-testid="input-td-max-amount" value={formData.maxAmount} onChange={e => setFormData(p => ({ ...p, maxAmount: e.target.value }))} placeholder="Optional" />
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Checkbox id="isEmployerPaid" data-testid="checkbox-td-employer-paid" checked={formData.isEmployerPaid} onCheckedChange={(c) => setFormData(p => ({ ...p, isEmployerPaid: c === true }))} />
                    <Label htmlFor="isEmployerPaid">Employer Paid</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="isReferenceOnly" data-testid="checkbox-td-reference" checked={formData.isReferenceOnly} onCheckedChange={(c) => setFormData(p => ({ ...p, isReferenceOnly: c === true }))} />
                    <Label htmlFor="isReferenceOnly">Reference Only (not deducted)</Label>
                  </div>
                </div>
                <Button className="w-full" data-testid="button-submit-tax-deduction" disabled={createMutation.isPending || !formData.companyId || !formData.name} onClick={() => createMutation.mutate(formData)}>
                  {createMutation.isPending ? "Creating..." : "Create Item"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <DollarSign className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground mb-2">No taxes or deductions configured.</p>
            {selectedCompany !== "all" && (
              <p className="text-sm text-muted-foreground">Use Quick Setup to add standard US tax items for this company.</p>
            )}
          </CardContent>
        </Card>
      ) : (
        CATEGORY_ORDER.map(cat => {
          const items = groupedItems[cat];
          if (!items || items.length === 0) return null;
          return (
            <Card key={cat}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {CATEGORY_LABELS[cat]}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Applies To</TableHead>
                        <TableHead>Calc</TableHead>
                        <TableHead>Rate</TableHead>
                        <TableHead>Max</TableHead>
                        <TableHead>Flags</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-20">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map(td => (
                        <TableRow key={td.id} data-testid={`row-tax-deduction-${td.id}`} className={td.isReferenceOnly ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}>
                          <TableCell className="font-medium">{td.name}</TableCell>
                          <TableCell>
                            <Badge variant={td.type === "tax" ? "default" : td.type === "benefit" ? "secondary" : "outline"} className="text-xs">
                              {td.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{APPLIES_TO_LABELS[td.appliesTo || "all"] || "All"}</TableCell>
                          <TableCell className="text-xs">{td.calculationType === "percentage" ? "%" : "$"}</TableCell>
                          <TableCell>{td.calculationType === "percentage" ? `${Number(td.rate || 0)}%` : `$${Number(td.rate || 0).toFixed(2)}`}</TableCell>
                          <TableCell className="text-xs">{td.maxAmount ? `$${Number(td.maxAmount).toLocaleString()}` : "—"}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {td.isEmployerPaid && <Badge variant="outline" className="text-[10px]">Employer</Badge>}
                              {td.isReferenceOnly && <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-600">Ref Only</Badge>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <button
                              onClick={() => toggleActiveMutation.mutate({ id: td.id, isActive: !td.isActive })}
                              data-testid={`toggle-active-${td.id}`}
                              className="cursor-pointer"
                            >
                              <Badge variant={td.isActive ? "default" : "outline"} className="text-xs cursor-pointer">
                                {td.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </button>
                          </TableCell>
                          <TableCell>
                            <Button size="icon" variant="ghost" data-testid={`button-delete-td-${td.id}`} onClick={() => deleteMutation.mutate(td.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

function RemittanceSourcesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<RemittanceSource | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<string>("all");
  const emptyForm = { companyId: "", name: "", type: "check", status: "enabled", country: "US", currency: "USD", routingNumber: "", accountNumber: "", institution: "", lastCheckNumber: 0 };
  const [formData, setFormData] = useState(emptyForm);

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: remittanceSources = [], isLoading } = useQuery<RemittanceSource[]>({ queryKey: ["/api/remittance-sources"] });

  const openEdit = (rs: RemittanceSource) => {
    setEditingSource(rs);
    setFormData({
      companyId: rs.companyId || "",
      name: rs.name || "",
      type: rs.type || "check",
      status: rs.status || "enabled",
      country: rs.country || "US",
      currency: rs.currency || "USD",
      routingNumber: rs.routingNumber || "",
      accountNumber: rs.accountNumber || "",
      institution: rs.institution || "",
      lastCheckNumber: rs.lastCheckNumber || 0,
    });
    setDialogOpen(true);
  };

  const openAdd = () => {
    setEditingSource(null);
    setFormData(emptyForm);
    setDialogOpen(true);
  };

  const quickSetupMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await apiRequest("POST", "/api/remittance-sources/quick-setup", { companyId });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/remittance-sources"] });
      toast({ title: "Quick Setup Complete", description: data.message || `Created ${data.count} remittance sources` });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/remittance-sources", {
        ...data,
        routingNumber: data.routingNumber || null,
        accountNumber: data.accountNumber || null,
        institution: data.institution || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/remittance-sources"] });
      toast({ title: "Remittance source created" });
      setDialogOpen(false);
      setFormData(emptyForm);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const res = await apiRequest("PATCH", `/api/remittance-sources/${id}`, {
        ...data,
        routingNumber: data.routingNumber || null,
        accountNumber: data.accountNumber || null,
        institution: data.institution || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/remittance-sources"] });
      toast({ title: "Remittance source updated" });
      setDialogOpen(false);
      setEditingSource(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/remittance-sources/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/remittance-sources"] });
      toast({ title: "Remittance source deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleSubmit = () => {
    if (editingSource) {
      updateMutation.mutate({ id: editingSource.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  if (isLoading) return <div data-testid="loading-remittance-sources"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="space-y-4">
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30">
        <CardContent className="p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Bank Accounts &amp; ACH Sources — ODFI credentials for payroll disbursement</p>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
              These records store your company's bank routing and account numbers used as the Originating Depository Financial Institution (ODFI) when generating NACHA ACH files.
              <strong> Routing Number</strong> and <strong>Account Number</strong> fields are required for ACH direct deposit processing.
              Link these to a <em>Funding Account</em> using the Funding Accounts tab.
            </p>
          </div>
        </CardContent>
      </Card>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Select value={selectedCompany} onValueChange={setSelectedCompany}>
            <SelectTrigger className="w-[200px]" data-testid="select-rs-filter-company">
              <SelectValue placeholder="All companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          {selectedCompany !== "all" && (
            <Button
              variant="secondary"
              data-testid="button-rs-quick-setup"
              disabled={quickSetupMutation.isPending}
              onClick={() => quickSetupMutation.mutate(selectedCompany)}
            >
              <Zap className="mr-2 h-4 w-4" />
              {quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
            </Button>
          )}
        <Button data-testid="button-add-remittance-source" onClick={openAdd}><Plus className="mr-2 h-4 w-4" />Add Remittance Source</Button>
        <Dialog open={dialogOpen} onOpenChange={open => { setDialogOpen(open); if (!open) setEditingSource(null); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editingSource ? "Edit Remittance Source" : "Add Remittance Source"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={formData.companyId} onValueChange={v => setFormData(p => ({ ...p, companyId: v }))}>
                  <SelectTrigger data-testid="select-rs-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input data-testid="input-rs-name" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={formData.type} onValueChange={v => setFormData(p => ({ ...p, type: v }))}>
                  <SelectTrigger data-testid="select-rs-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="direct_deposit">Direct Deposit</SelectItem>
                    <SelectItem value="ach">ACH</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={v => setFormData(p => ({ ...p, status: v }))}>
                  <SelectTrigger data-testid="select-rs-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="enabled">Enabled</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Country</Label>
                <Input data-testid="input-rs-country" value={formData.country} onChange={e => setFormData(p => ({ ...p, country: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Input data-testid="input-rs-currency" value={formData.currency} onChange={e => setFormData(p => ({ ...p, currency: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Routing Number</Label>
                <Input data-testid="input-rs-routing" value={formData.routingNumber} onChange={e => setFormData(p => ({ ...p, routingNumber: e.target.value }))} placeholder="9-digit bank routing number" />
              </div>
              <div className="space-y-2">
                <Label>Account Number</Label>
                <Input data-testid="input-rs-account" value={formData.accountNumber} onChange={e => setFormData(p => ({ ...p, accountNumber: e.target.value }))} placeholder="Business checking account number" />
              </div>
              <div className="space-y-2">
                <Label>Institution</Label>
                <Input data-testid="input-rs-institution" value={formData.institution} onChange={e => setFormData(p => ({ ...p, institution: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Last Check Number</Label>
                <Input type="number" data-testid="input-rs-last-check" value={formData.lastCheckNumber} onChange={e => setFormData(p => ({ ...p, lastCheckNumber: Number(e.target.value) }))} />
              </div>
              <Button
                className="w-full"
                data-testid="button-submit-remittance-source"
                disabled={createMutation.isPending || updateMutation.isPending}
                onClick={handleSubmit}
              >
                {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : editingSource ? "Save Changes" : "Create Remittance Source"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Routing #</TableHead>
                  <TableHead>Account #</TableHead>
                  <TableHead>Institution</TableHead>
                  <TableHead>Last Check #</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remittanceSources.map(rs => (
                  <TableRow key={rs.id} data-testid={`row-remittance-source-${rs.id}`}>
                    <TableCell className="font-medium">{rs.name}</TableCell>
                    <TableCell>
                      <Badge variant={rs.type === "check" ? "default" : rs.type === "direct_deposit" ? "secondary" : "outline"} data-testid={`badge-rs-type-${rs.id}`}>
                        {rs.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={rs.status === "enabled" ? "default" : "outline"} data-testid={`badge-rs-status-${rs.id}`}>
                        {rs.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{rs.routingNumber || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="font-mono text-sm">{rs.accountNumber ? `••••${rs.accountNumber.slice(-4)}` : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{rs.institution || "—"}</TableCell>
                    <TableCell>{rs.lastCheckNumber || 0}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" data-testid={`button-edit-rs-${rs.id}`} onClick={() => openEdit(rs)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" data-testid={`button-delete-rs-${rs.id}`} onClick={() => { if (confirm(`Delete "${rs.name}"?`)) deleteMutation.mutate(rs.id); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {remittanceSources.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No remittance sources configured</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RemittanceAgenciesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string>("all");
  const [formData, setFormData] = useState({
    companyId: "", name: "", type: "federal", status: "enabled",
    country: "US", provinceState: "", agency: "", startDate: "", endDate: "",
  });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: remittanceAgencies = [], isLoading } = useQuery<RemittanceAgency[]>({ queryKey: ["/api/remittance-agencies"] });

  const quickSetupMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await apiRequest("POST", "/api/remittance-agencies/quick-setup", { companyId });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/remittance-agencies"] });
      toast({ title: "Quick Setup Complete", description: data.message || `Created ${data.count} remittance agencies` });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/remittance-agencies", {
        ...data,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        provinceState: data.provinceState || null,
        agency: data.agency || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/remittance-agencies"] });
      toast({ title: "Remittance agency created" });
      setDialogOpen(false);
      setFormData({ companyId: "", name: "", type: "federal", status: "enabled", country: "US", provinceState: "", agency: "", startDate: "", endDate: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <div data-testid="loading-remittance-agencies"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Select value={selectedCompany} onValueChange={setSelectedCompany}>
            <SelectTrigger className="w-[200px]" data-testid="select-ra-filter-company">
              <SelectValue placeholder="All companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          {selectedCompany !== "all" && (
            <Button
              variant="secondary"
              data-testid="button-ra-quick-setup"
              disabled={quickSetupMutation.isPending}
              onClick={() => quickSetupMutation.mutate(selectedCompany)}
            >
              <Zap className="mr-2 h-4 w-4" />
              {quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
            </Button>
          )}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-remittance-agency"><Plus className="mr-2 h-4 w-4" />Add Remittance Agency</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Remittance Agency</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={formData.companyId} onValueChange={v => setFormData(p => ({ ...p, companyId: v }))}>
                  <SelectTrigger data-testid="select-ra-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input data-testid="input-ra-name" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={formData.type} onValueChange={v => setFormData(p => ({ ...p, type: v }))}>
                  <SelectTrigger data-testid="select-ra-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="federal">Federal</SelectItem>
                    <SelectItem value="state">State</SelectItem>
                    <SelectItem value="local">Local</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={v => setFormData(p => ({ ...p, status: v }))}>
                  <SelectTrigger data-testid="select-ra-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="enabled">Enabled</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Country</Label>
                <Input data-testid="input-ra-country" value={formData.country} onChange={e => setFormData(p => ({ ...p, country: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Province/State</Label>
                <Input data-testid="input-ra-province" value={formData.provinceState} onChange={e => setFormData(p => ({ ...p, provinceState: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Agency</Label>
                <Input data-testid="input-ra-agency" value={formData.agency} onChange={e => setFormData(p => ({ ...p, agency: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" data-testid="input-ra-start-date" value={formData.startDate} onChange={e => setFormData(p => ({ ...p, startDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" data-testid="input-ra-end-date" value={formData.endDate} onChange={e => setFormData(p => ({ ...p, endDate: e.target.value }))} />
              </div>
              <Button
                className="w-full"
                data-testid="button-submit-remittance-agency"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate(formData)}
              >
                {createMutation.isPending ? "Creating..." : "Create Remittance Agency"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Province/State</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remittanceAgencies.map(ra => (
                  <TableRow key={ra.id} data-testid={`row-remittance-agency-${ra.id}`}>
                    <TableCell className="font-medium">{ra.name}</TableCell>
                    <TableCell>
                      <Badge variant={ra.type === "federal" ? "default" : ra.type === "state" ? "secondary" : "outline"} data-testid={`badge-ra-type-${ra.id}`}>
                        {ra.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={ra.status === "enabled" ? "default" : "outline"} data-testid={`badge-ra-status-${ra.id}`}>
                        {ra.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{ra.country || "—"}</TableCell>
                    <TableCell>{ra.provinceState || "—"}</TableCell>
                    <TableCell>{ra.startDate || "—"}</TableCell>
                    <TableCell>{ra.endDate || "—"}</TableCell>
                  </TableRow>
                ))}
                {remittanceAgencies.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No remittance agencies configured</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const TAX_WIZARD_STEPS = [
  { id: "configure", label: "Configure", icon: Settings },
  { id: "workers", label: "Workers & Summary", icon: Calculator },
  { id: "forms", label: "Generate Forms", icon: FileText },
  { id: "complete", label: "Review & Complete", icon: Check },
] as const;

type TaxWizardStepId = typeof TAX_WIZARD_STEPS[number]["id"];

const RUN_TYPE_OPTIONS = [
  { value: "quarterly_q1", label: "Q1 Quarterly (Jan-Mar)", description: "941, state withholding" },
  { value: "quarterly_q2", label: "Q2 Quarterly (Apr-Jun)", description: "941, state withholding" },
  { value: "quarterly_q3", label: "Q3 Quarterly (Jul-Sep)", description: "941, state withholding" },
  { value: "quarterly_q4", label: "Q4 Quarterly (Oct-Dec)", description: "941, state withholding" },
  { value: "annual", label: "Annual Year-End", description: "W-2s, 1099-NECs, 940, W-3" },
  { value: "audit", label: "Audit / Review", description: "Full tax summary for audit" },
];

const OFFICIAL_FORM_URLS: Record<string, string> = {
  w2: "https://www.irs.gov/pub/irs-pdf/fw2.pdf",
  "1099nec": "https://www.irs.gov/pub/irs-pdf/f1099nec.pdf",
  "941": "https://www.irs.gov/pub/irs-pdf/f941.pdf",
  "940": "https://www.irs.gov/pub/irs-pdf/f940.pdf",
  w3: "https://www.irs.gov/pub/irs-pdf/fw3.pdf",
  "1096": "https://www.irs.gov/pub/irs-pdf/f1096.pdf",
  de9: "https://edd.ca.gov/siteassets/files/pdf_pub_ctr/de9.pdf",
  de9c: "https://edd.ca.gov/siteassets/files/pdf_pub_ctr/de9c.pdf",
};

const TAX_FORMS = [
  { id: "w2", label: "W-2 (Wage & Tax Statement)", description: "For each employee — IRS", appliesTo: "employee", runTypes: ["annual"] },
  { id: "1099nec", label: "1099-NEC (Nonemployee Compensation)", description: "For each contractor paid $600+ — IRS", appliesTo: "contractor", runTypes: ["annual"] },
  { id: "941", label: "Form 941 (Quarterly Federal Tax Return)", description: "Federal employment taxes — IRS", appliesTo: "company", runTypes: ["quarterly_q1", "quarterly_q2", "quarterly_q3", "quarterly_q4"] },
  { id: "940", label: "Form 940 (Annual FUTA Tax Return)", description: "Federal unemployment tax — IRS", appliesTo: "company", runTypes: ["annual"] },
  { id: "w3", label: "W-3 (Transmittal of Wage Statements)", description: "Summary transmittal for all W-2s — IRS", appliesTo: "company", runTypes: ["annual"] },
  { id: "1096", label: "Form 1096 (Annual Summary & Transmittal)", description: "Transmittal for 1099 forms — IRS", appliesTo: "company", runTypes: ["annual"] },
  { id: "de9", label: "DE 9 (Quarterly Contribution Return)", description: "CA quarterly employment taxes — EDD", appliesTo: "company", runTypes: ["quarterly_q1", "quarterly_q2", "quarterly_q3", "quarterly_q4"] },
  { id: "de9c", label: "DE 9C (Quarterly Employee Detail)", description: "CA individual employee wage detail — EDD", appliesTo: "company", runTypes: ["quarterly_q1", "quarterly_q2", "quarterly_q3", "quarterly_q4"] },
  { id: "state_withholding", label: "State Withholding Return", description: "State income tax withholding", appliesTo: "company", runTypes: ["quarterly_q1", "quarterly_q2", "quarterly_q3", "quarterly_q4", "annual"] },
  { id: "tax_summary", label: "Tax Summary Report", description: "Complete tax liability summary", appliesTo: "company", runTypes: ["quarterly_q1", "quarterly_q2", "quarterly_q3", "quarterly_q4", "annual", "audit"] },
];

function TaxWizardTab() {
  const { toast } = useToast();
  const [wizardStep, setWizardStep] = useState<TaxWizardStepId>("configure");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [taxYear, setTaxYear] = useState<string>(String(new Date().getFullYear()));
  const [taxPeriod, setTaxPeriod] = useState<string>("");
  const [runType, setRunType] = useState<string>("");
  const [selectedForms, setSelectedForms] = useState<Set<string>>(new Set());
  const [backendResult, setBackendResult] = useState<any>(null);
  const [currentSnapshotId, setCurrentSnapshotId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: legalEntities = [] } = useQuery<LegalEntity[]>({ queryKey: ["/api/legal-entities"] });
  const { data: taxesDeductions = [] } = useQuery<TaxDeduction[]>({ queryKey: ["/api/taxes-deductions"] });
  const { data: payrollRuns = [] } = useQuery<PayrollRun[]>({ queryKey: ["/api/payroll-runs"] });
  const { data: taxSnapshots = [], refetch: refetchSnapshots } = useQuery<any[]>({
    queryKey: ["/api/tax-wizard/snapshots", selectedCompanyId],
    queryFn: async () => {
      if (!selectedCompanyId) return [];
      const res = await fetch(`/api/tax-wizard/snapshots?companyId=${selectedCompanyId}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedCompanyId,
  });

  const selectedCompany = companies.find(c => c.id === selectedCompanyId);
  const selectedLegalEntity = selectedCompany?.legalEntityId
    ? legalEntities.find(le => le.id === selectedCompany.legalEntityId)
    : null;

  const calculateMutation = useMutation({
    mutationFn: async ({ formType }: { formType: string }) => {
      const res = await apiRequest("POST", "/api/tax-wizard/calculate", {
        companyId: selectedCompanyId,
        taxYear,
        taxPeriod: taxPeriod || null,
        formType,
        legalEntityId: selectedCompany?.legalEntityId || null,
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data: any) => {
      setBackendResult(data);
      setCurrentSnapshotId(data.snapshot?.id || null);
      refetchSnapshots();
      toast({ title: "Tax data generated from actual payroll records", description: `${data.data?.summary?.payrollRunCount || 0} payroll runs analyzed` });
    },
    onError: (err: Error) => toast({ title: "Calculation failed", description: err.message, variant: "destructive" }),
  });

  const updateSnapshotMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/tax-wizard/snapshots/${id}`, { status });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => { refetchSnapshots(); toast({ title: "Filing status updated" }); },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const companyWorkers = workers.filter(w => w.companyId === selectedCompanyId);
  const employees = companyWorkers.filter(w => w.workerType === "employee" || !w.workerType);
  const contractors = companyWorkers.filter(w => w.workerType === "contractor");
  const companyDeductions = taxesDeductions.filter(td => td.companyId === selectedCompanyId);

  const companyPayrollRuns = payrollRuns.filter(pr => pr.companyId === selectedCompanyId && pr.status === "processed");

  const calcWorkerTax = (worker: Worker) => {
    const grossPay = Number(worker.payRate || 0) * 2080;
    const isContractor = worker.workerType === "contractor";
    const applicableDeductions = companyDeductions.filter(td => {
      if (!td.isActive) return false;
      const appliesTo = td.appliesTo || "all";
      if (appliesTo === "employee" && isContractor) return false;
      if (appliesTo === "contractor" && !isContractor) return false;
      return true;
    });
    let totalTax = 0;
    let totalRef = 0;
    const breakdown: { name: string; amount: number; isRef: boolean }[] = [];
    for (const td of applicableDeductions) {
      if (td.isEmployerPaid) continue;
      let amount = 0;
      if (td.calculationType === "percentage") {
        const base = td.maxAmount ? Math.min(grossPay, Number(td.maxAmount)) : grossPay;
        amount = base * (Number(td.rate || 0) / 100);
      } else {
        amount = Number(td.rate || 0) * 26;
      }
      const isRef = td.isReferenceOnly || false;
      breakdown.push({ name: td.name, amount, isRef });
      if (isRef) totalRef += amount;
      else totalTax += amount;
    }
    return { grossPay, totalTax, totalRef, netPay: grossPay - totalTax, breakdown, isContractor };
  };

  const availableForms = TAX_FORMS.filter(f => f.runTypes.includes(runType));

  const currentStepIndex = TAX_WIZARD_STEPS.findIndex(s => s.id === wizardStep);
  const canGoNext = () => {
    if (wizardStep === "configure") return !!selectedCompanyId && !!runType;
    if (wizardStep === "workers") return true;
    if (wizardStep === "forms") return selectedForms.size > 0;
    return true;
  };
  const goNext = () => {
    if (wizardStep === "configure") {
      const defaultForms = availableForms.map(f => f.id);
      setSelectedForms(new Set(defaultForms));
    }
    if (wizardStep === "forms") {
      const primaryForm = Array.from(selectedForms)[0];
      if (primaryForm) {
        const formTypeMap: Record<string, string> = {
          "941": "941", "w2": "W-2", "1099nec": "1099-NEC",
          "940": "940", "w3": "W-3", "1096": "1096",
          "state_withholding": "state_withholding", "tax_summary": "tax_summary",
        };
        const apiFormType = formTypeMap[primaryForm] || primaryForm;
        calculateMutation.mutate({ formType: apiFormType });
      }
    }
    if (currentStepIndex < TAX_WIZARD_STEPS.length - 1) setWizardStep(TAX_WIZARD_STEPS[currentStepIndex + 1].id);
  };
  const goPrev = () => {
    if (currentStepIndex > 0) setWizardStep(TAX_WIZARD_STEPS[currentStepIndex - 1].id);
  };
  const resetWizard = () => {
    setWizardStep("configure");
    setSelectedCompanyId("");
    setTaxPeriod("");
    setRunType("");
    setSelectedForms(new Set());
    setBackendResult(null);
    setCurrentSnapshotId(null);
  };

  const toggleForm = (formId: string) => {
    setSelectedForms(prev => {
      const next = new Set(prev);
      if (next.has(formId)) next.delete(formId);
      else next.add(formId);
      return next;
    });
  };

  const runTypeLabel = RUN_TYPE_OPTIONS.find(r => r.value === runType)?.label || runType;

  const w2Count = employees.length;
  const nec1099Count = contractors.filter(c => Number(c.payRate || 0) * 2080 >= 600).length;

  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6" data-testid="tax-wizard">
      <div className="flex items-center gap-2 flex-wrap">
        {TAX_WIZARD_STEPS.map((step, idx) => {
          const StepIcon = step.icon;
          const isActive = step.id === wizardStep;
          const isCompleted = idx < currentStepIndex;
          return (
            <div key={step.id} className="flex items-center gap-2">
              {idx > 0 && <div className={`h-px w-6 ${isCompleted ? "bg-primary" : "bg-border"}`} />}
              <button
                data-testid={`wizard-step-${step.id}`}
                onClick={() => { if (idx <= currentStepIndex) setWizardStep(step.id); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive ? "bg-primary text-primary-foreground" : isCompleted ? "bg-primary/10 text-primary" : "text-muted-foreground"
                }`}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : <StepIcon className="h-4 w-4" />}
                {step.label}
              </button>
            </div>
          );
        })}
      </div>

      {wizardStep === "configure" && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Configure Tax Run</h3>
            <p className="text-sm text-muted-foreground">Select the company, tax year, and type of tax run to process.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Company</Label>
              <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                <SelectTrigger data-testid="select-wizard-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>
                  {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {selectedCompany && selectedLegalEntity && (
                <p className="text-xs text-muted-foreground">Legal Entity: {selectedLegalEntity.legalName}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Tax Year</Label>
              <Select value={taxYear} onValueChange={setTaxYear}>
                <SelectTrigger data-testid="select-wizard-year"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[0, 1, 2].map(offset => {
                    const y = String(new Date().getFullYear() - offset);
                    return <SelectItem key={y} value={y}>{y}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Run Type</Label>
              <Select value={runType} onValueChange={v => { setRunType(v); if (!v.startsWith("quarterly")) setTaxPeriod(""); }}>
                <SelectTrigger data-testid="select-wizard-run-type"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {RUN_TYPE_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {runType.startsWith("quarterly") && (
              <div className="space-y-2">
                <Label>Quarter Period</Label>
                <Select value={taxPeriod} onValueChange={setTaxPeriod}>
                  <SelectTrigger data-testid="select-wizard-quarter"><SelectValue placeholder="Select quarter" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Q1">Q1 (Jan–Mar)</SelectItem>
                    <SelectItem value="Q2">Q2 (Apr–Jun)</SelectItem>
                    <SelectItem value="Q3">Q3 (Jul–Sep)</SelectItem>
                    <SelectItem value="Q4">Q4 (Oct–Dec)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {selectedCompanyId && runType && (
            <Card>
              <CardContent className="p-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold">{employees.length}</p>
                    <p className="text-xs text-muted-foreground">Employees</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{contractors.length}</p>
                    <p className="text-xs text-muted-foreground">Contractors</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{companyDeductions.filter(d => d.isActive).length}</p>
                    <p className="text-xs text-muted-foreground">Active Tax Items</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{companyPayrollRuns.length}</p>
                    <p className="text-xs text-muted-foreground">Payroll Runs</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {selectedCompanyId && companyDeductions.length === 0 && (
            <Card className="border-amber-200 dark:border-amber-800">
              <CardContent className="p-4 flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium">No tax items configured for this company.</p>
                  <p className="text-xs text-muted-foreground">Go to Taxes & Deductions tab and use Quick Setup to add standard US tax items first.</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {wizardStep === "workers" && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Workers & Tax Summary</h3>
            <p className="text-sm text-muted-foreground">{selectedCompany?.name} — {taxYear} {runTypeLabel}. Estimated annual figures based on pay rates.</p>
          </div>
          {companyWorkers.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                No workers found for this company.
              </CardContent>
            </Card>
          ) : (
            <>
              {employees.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Employees ({employees.length})</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Employee</TableHead>
                            <TableHead className="text-right">Est. Gross</TableHead>
                            <TableHead className="text-right">Est. Taxes</TableHead>
                            <TableHead className="text-right">Est. Net</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {employees.map(w => {
                            const tax = calcWorkerTax(w);
                            return (
                              <TableRow key={w.id} data-testid={`row-worker-${w.id}`}>
                                <TableCell className="font-medium">{w.firstName} {w.lastName}<span className="text-xs text-muted-foreground ml-2">#{w.employeeNumber || "—"}</span></TableCell>
                                <TableCell className="text-right">${fmt(tax.grossPay)}</TableCell>
                                <TableCell className="text-right text-destructive">${fmt(tax.totalTax)}</TableCell>
                                <TableCell className="text-right font-medium">${fmt(tax.netPay)}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
              {contractors.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Contractors ({contractors.length})</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Contractor</TableHead>
                            <TableHead className="text-right">Est. Gross</TableHead>
                            <TableHead className="text-right">Est. Net (Paid)</TableHead>
                            <TableHead className="text-right">SE Tax (Reference)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {contractors.map(w => {
                            const tax = calcWorkerTax(w);
                            return (
                              <TableRow key={w.id} data-testid={`row-worker-${w.id}`}>
                                <TableCell className="font-medium">{w.firstName} {w.lastName}</TableCell>
                                <TableCell className="text-right">${fmt(tax.grossPay)}</TableCell>
                                <TableCell className="text-right font-medium">${fmt(tax.netPay)}</TableCell>
                                <TableCell className="text-right">
                                  {tax.totalRef > 0 ? (
                                    <span className="text-blue-600 dark:text-blue-400" title="Self-employment tax the contractor is responsible for paying independently">
                                      ${fmt(tax.totalRef)}
                                    </span>
                                  ) : "—"}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                  <CardContent className="pt-0 pb-3">
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      Self-Employment Tax is shown for reference only. Contractors are responsible for paying their own Social Security (12.4%) and Medicare (2.9%) taxes.
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {wizardStep === "forms" && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Generate Tax Forms</h3>
            <p className="text-sm text-muted-foreground">Select which forms to generate for {taxYear} {runTypeLabel}.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {availableForms.map(form => {
              const isSelected = selectedForms.has(form.id);
              let count = "";
              if (form.id === "w2") count = `${w2Count} form(s)`;
              else if (form.id === "1099nec") count = `${nec1099Count} form(s)`;
              return (
                <button
                  key={form.id}
                  data-testid={`form-option-${form.id}`}
                  onClick={() => toggleForm(form.id)}
                  className={`p-4 border rounded-lg text-left transition-all ${
                    isSelected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? "bg-primary border-primary" : "border-muted-foreground"}`}>
                        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                      <span className="font-medium text-sm">{form.label}</span>
                    </div>
                    {count && <Badge variant="secondary" className="text-xs">{count}</Badge>}
                  </div>
                  <div className="flex items-center gap-2 mt-1 ml-6">
                    <p className="text-xs text-muted-foreground">{form.description}</p>
                    {OFFICIAL_FORM_URLS[form.id] && (
                      <a
                        href={OFFICIAL_FORM_URLS[form.id]}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`link-official-form-${form.id}`}
                        onClick={e => e.stopPropagation()}
                        className="text-xs text-primary hover:underline flex items-center gap-0.5 flex-shrink-0"
                      >
                        Official PDF <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {availableForms.length === 0 && (
            <Card><CardContent className="p-6 text-center text-muted-foreground">No forms available for this run type.</CardContent></Card>
          )}
        </div>
      )}

      {wizardStep === "complete" && (
        <div className="space-y-4">
          {calculateMutation.isPending && (
            <Card><CardContent className="p-6 text-center"><Skeleton className="h-8 w-48 mx-auto mb-2" /><p className="text-sm text-muted-foreground">Analyzing actual payroll records from database...</p></CardContent></Card>
          )}
          {!calculateMutation.isPending && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 mx-auto mb-4">
                <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-xl font-semibold text-center mb-2">Tax Run Complete</h3>
              <p className="text-center text-muted-foreground mb-6">
                {taxYear} {taxPeriod ? `(${taxPeriod})` : ""} {runTypeLabel} for {selectedCompany?.name}
              </p>

              {backendResult && (
                <div className="space-y-4 mb-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center border rounded-lg p-4 bg-muted/30">
                    <div><p className="text-xl font-bold">${Number(backendResult.data?.summary?.totalWages || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</p><p className="text-xs text-muted-foreground">Total Wages</p></div>
                    <div><p className="text-xl font-bold">${Number(backendResult.data?.summary?.totalTaxWithheld || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</p><p className="text-xs text-muted-foreground">Tax Withheld</p></div>
                    <div><p className="text-xl font-bold">{backendResult.data?.summary?.employeeCount || 0}</p><p className="text-xs text-muted-foreground">Employees</p></div>
                    <div><p className="text-xl font-bold">{backendResult.data?.summary?.payrollRunCount || 0}</p><p className="text-xs text-muted-foreground">Payroll Runs</p></div>
                  </div>
                  {backendResult.data?.form941 && (
                    <div className="border rounded-lg p-4">
                      <h4 className="font-semibold mb-3 text-sm">Form 941 Preview</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex justify-between"><span className="text-muted-foreground">Line 1 — Employees:</span><span className="font-medium">{backendResult.data.form941.line1_employees}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Line 2 — Wages:</span><span className="font-medium">${backendResult.data.form941.line2_wages}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Line 3 — Fed Tax Withheld:</span><span className="font-medium">${backendResult.data.form941.line3_federal_tax_withheld}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Line 5a — SS Wages:</span><span className="font-medium">${backendResult.data.form941.line5a_ss_wages}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Line 5c — Medicare Wages:</span><span className="font-medium">${backendResult.data.form941.line5c_medicare_wages}</span></div>
                        <div className="flex justify-between font-semibold"><span>Line 6 — Total Tax:</span><span>${backendResult.data.form941.line6_total_taxes}</span></div>
                      </div>
                    </div>
                  )}
                  {currentSnapshotId && (
                    <div className="border rounded-lg p-4">
                      <h4 className="font-semibold mb-3 text-sm flex items-center gap-2">Filing Status Workflow <Badge variant="secondary" data-testid="badge-snapshot-status">{taxSnapshots.find(s => s.id === currentSnapshotId)?.status || "generated"}</Badge></h4>
                      <div className="flex flex-wrap gap-2">
                        {(["reviewed", "approved", "filed"] as const).map(status => {
                          const currentStatus = taxSnapshots.find(s => s.id === currentSnapshotId)?.status || "generated";
                          const statusOrder = ["generated", "reviewed", "approved", "filed"];
                          const currentIdx = statusOrder.indexOf(currentStatus);
                          const thisIdx = statusOrder.indexOf(status);
                          const isDone = thisIdx <= currentIdx;
                          const isNext = thisIdx === currentIdx + 1;
                          return (
                            <Button
                              key={status}
                              size="sm"
                              variant={isDone ? "default" : "outline"}
                              disabled={!isNext || updateSnapshotMutation.isPending}
                              onClick={() => updateSnapshotMutation.mutate({ id: currentSnapshotId, status })}
                              data-testid={`button-mark-${status}`}
                            >
                              {isDone && <Check className="h-3 w-3 mr-1" />}
                              Mark as {status.charAt(0).toUpperCase() + status.slice(1)}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!backendResult && (
                <div className="border rounded-lg p-4 mb-4 bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
                  <p className="text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2"><AlertCircle className="h-4 w-4" />Backend calculation did not return results. This may mean no processed payroll runs exist for the selected period.</p>
                </div>
              )}

              <div className="space-y-4">
                <div className="border rounded-lg p-4">
                  <h4 className="font-semibold mb-3">Forms Selected</h4>
                  <div className="space-y-2">
                    {Array.from(selectedForms).map(formId => {
                      const form = TAX_FORMS.find(f => f.id === formId);
                      if (!form) return null;
                      return (
                        <div key={formId} className="flex items-center justify-between py-1" data-testid={`generated-form-${formId}`}>
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-primary" />
                            <span className="text-sm">{form.label}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {OFFICIAL_FORM_URLS[formId] && (
                              <a href={OFFICIAL_FORM_URLS[formId]} target="_blank" rel="noopener noreferrer" data-testid={`link-blank-form-${formId}`}>
                                <Button size="sm" variant="ghost" className="text-xs"><ExternalLink className="h-3 w-3 mr-1" />Blank Form</Button>
                              </a>
                            )}
                            <Button size="sm" variant="outline" data-testid={`button-download-${formId}`}>
                              <Download className="h-3 w-3 mr-1" />Print/Export
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-center gap-3 pt-4">
                  <Button data-testid="button-wizard-restart" onClick={resetWizard}>
                    Start New Tax Run
                  </Button>
                  <Button variant="outline" data-testid="button-wizard-print-all" onClick={() => window.print()}>
                    <Printer className="mr-2 h-4 w-4" />Print Summary
                  </Button>
                  <Button variant="outline" data-testid="button-wizard-show-history" onClick={() => setShowHistory(true)}>
                    View All Snapshots
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
          )}
        </div>
      )}

      {showHistory && selectedCompanyId && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Tax Filing Snapshot History</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowHistory(false)}>Close</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Form</TableHead>
                    <TableHead>Year</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Generated</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {taxSnapshots.map((snap: any) => (
                    <TableRow key={snap.id} data-testid={`row-snapshot-${snap.id}`}>
                      <TableCell><Badge variant="outline">{snap.formType}</Badge></TableCell>
                      <TableCell>{snap.taxYear}</TableCell>
                      <TableCell>{snap.taxPeriod || "Annual"}</TableCell>
                      <TableCell>
                        <Badge variant={snap.status === "filed" ? "default" : snap.status === "approved" ? "secondary" : "outline"} data-testid={`badge-snap-status-${snap.id}`}>
                          {snap.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{snap.generatedAt ? new Date(snap.generatedAt).toLocaleDateString() : "—"}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => { setCurrentSnapshotId(snap.id); setBackendResult({ data: JSON.parse(snap.generatedDataJson || "{}") }); }}>
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {taxSnapshots.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No tax filing snapshots yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {wizardStep !== "complete" && (
        <div className="flex items-center justify-between gap-4">
          <Button variant="outline" data-testid="button-wizard-prev" disabled={currentStepIndex === 0} onClick={goPrev}>
            <ChevronLeft className="mr-2 h-4 w-4" />Back
          </Button>
          <Button data-testid="button-wizard-next" disabled={!canGoNext()} onClick={goNext}>
            {wizardStep === "forms" ? "Generate & Complete" : "Next"}
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

const PSA_TYPE_LABELS: Record<string, string> = {
  earning: "Earnings",
  tax: "Taxes",
  deduction: "Deductions",
  employer_contribution: "Employer Contributions",
  employee_contribution: "Employee Contributions",
  benefit: "Benefits",
  other: "Other",
};
const PSA_TYPE_ORDER = ["earning", "tax", "deduction", "employer_contribution", "employee_contribution", "benefit", "other"];

function PayStubAccountsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<PayStubAccount | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<string>("all");
  const [formData, setFormData] = useState({
    companyId: "", legalEntityId: "", name: "", type: "earning", status: "enabled",
    displayOrder: 0, debitAccount: "", creditAccount: "",
  });
  const [editFormData, setEditFormData] = useState({
    name: "", type: "earning", status: "enabled", displayOrder: 0, debitAccount: "", creditAccount: "", legalEntityId: "",
  });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: legalEntities = [] } = useQuery<LegalEntity[]>({ queryKey: ["/api/legal-entities"] });
  const { data: payStubAccounts = [], isLoading } = useQuery<PayStubAccount[]>({ queryKey: ["/api/pay-stub-accounts"] });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/pay-stub-accounts", {
        ...data,
        legalEntityId: data.legalEntityId && data.legalEntityId !== "none" ? data.legalEntityId : null,
        debitAccount: data.debitAccount || null,
        creditAccount: data.creditAccount || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-stub-accounts"] });
      toast({ title: "Pay stub account created" });
      setDialogOpen(false);
      setFormData({ companyId: "", legalEntityId: "", name: "", type: "earning", status: "enabled", displayOrder: 0, debitAccount: "", creditAccount: "" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const [quickStartOpen, setQuickStartOpen] = useState(false);
  const [quickStartCompany, setQuickStartCompany] = useState("");

  const quickSetupMutation = useMutation({
    mutationFn: async ({ companyId, legalEntityId }: { companyId: string; legalEntityId: string }) => {
      const res = await apiRequest("POST", "/api/pay-stub-accounts/quick-setup", { companyId, legalEntityId: legalEntityId || null });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-stub-accounts"] });
      toast({ title: "Quick Start Complete", description: data.message });
      setQuickStartOpen(false);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/pay-stub-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-stub-accounts"] });
      toast({ title: "Account deleted" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editFormData }) => {
      const res = await apiRequest("PATCH", `/api/pay-stub-accounts/${id}`, {
        ...data,
        legalEntityId: data.legalEntityId && data.legalEntityId !== "none" ? data.legalEntityId : null,
        debitAccount: data.debitAccount || null,
        creditAccount: data.creditAccount || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-stub-accounts"] });
      toast({ title: "Account updated" });
      setEditDialogOpen(false);
      setEditingAccount(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openEdit = (psa: PayStubAccount) => {
    setEditingAccount(psa);
    setEditFormData({
      name: psa.name,
      type: psa.type || "earning",
      status: psa.status || "enabled",
      displayOrder: psa.displayOrder ?? 0,
      debitAccount: psa.debitAccount || "",
      creditAccount: psa.creditAccount || "",
      legalEntityId: psa.legalEntityId || "",
    });
    setEditDialogOpen(true);
  };

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiRequest("PATCH", `/api/pay-stub-accounts/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-stub-accounts"] });
    },
  });

  if (isLoading) return <div data-testid="loading-pay-stub-accounts"><Skeleton className="h-64 w-full" /></div>;

  const getLegalEntityName = (leId: string | null | undefined) => {
    if (!leId) return null;
    return legalEntities.find(le => le.id === leId)?.legalName || null;
  };

  const selectedComp = companies.find(c => c.id === selectedCompany);
  const selectedCompLegalEntityId = selectedComp?.legalEntityId || "";

  const filteredAccounts = selectedCompany === "all"
    ? payStubAccounts
    : payStubAccounts.filter(a => a.companyId === selectedCompany);

  const sortedAccounts = [...filteredAccounts].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

  const groupedAccounts: Record<string, PayStubAccount[]> = {};
  for (const t of PSA_TYPE_ORDER) groupedAccounts[t] = [];
  for (const a of sortedAccounts) {
    const t = a.type || "other";
    if (!groupedAccounts[t]) groupedAccounts[t] = [];
    groupedAccounts[t].push(a);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Select value={selectedCompany} onValueChange={setSelectedCompany}>
          <SelectTrigger className="w-[200px]" data-testid="select-psa-filter-company">
            <SelectValue placeholder="All companies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            data-testid="button-psa-quick-start"
            onClick={() => { setQuickStartCompany(selectedCompany !== "all" ? selectedCompany : ""); setQuickStartOpen(true); }}
          >
            <Zap className="mr-2 h-4 w-4" />Quick Start
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-pay-stub-account"><Plus className="mr-2 h-4 w-4" />Add Account</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Add Pay Stub Account</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Company</Label>
                    <Select value={formData.companyId} onValueChange={v => setFormData(p => ({ ...p, companyId: v }))}>
                      <SelectTrigger data-testid="select-psa-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                      <SelectContent>
                        {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Paid By (Legal Entity)</Label>
                    <Select value={formData.legalEntityId} onValueChange={v => setFormData(p => ({ ...p, legalEntityId: v }))}>
                      <SelectTrigger data-testid="select-psa-legal-entity"><SelectValue placeholder="Optional" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {legalEntities.map(le => <SelectItem key={le.id} value={le.id}>{le.legalName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input data-testid="input-psa-name" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={formData.type} onValueChange={v => setFormData(p => ({ ...p, type: v }))}>
                      <SelectTrigger data-testid="select-psa-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="earning">Earning</SelectItem>
                        <SelectItem value="tax">Tax</SelectItem>
                        <SelectItem value="deduction">Deduction</SelectItem>
                        <SelectItem value="employer_contribution">Employer Contribution</SelectItem>
                        <SelectItem value="employee_contribution">Employee Contribution</SelectItem>
                        <SelectItem value="benefit">Benefit</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={formData.status} onValueChange={v => setFormData(p => ({ ...p, status: v }))}>
                      <SelectTrigger data-testid="select-psa-status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="enabled">Enabled</SelectItem>
                        <SelectItem value="disabled">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Display Order</Label>
                    <Input type="number" data-testid="input-psa-display-order" value={formData.displayOrder} onChange={e => setFormData(p => ({ ...p, displayOrder: Number(e.target.value) }))} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Debit Account (GL)</Label>
                    <Input data-testid="input-psa-debit" value={formData.debitAccount} onChange={e => setFormData(p => ({ ...p, debitAccount: e.target.value }))} placeholder="Optional" />
                  </div>
                  <div className="space-y-2">
                    <Label>Credit Account (GL)</Label>
                    <Input data-testid="input-psa-credit" value={formData.creditAccount} onChange={e => setFormData(p => ({ ...p, creditAccount: e.target.value }))} placeholder="Optional" />
                  </div>
                </div>
                <Button
                  className="w-full"
                  data-testid="button-submit-pay-stub-account"
                  disabled={createMutation.isPending || !formData.companyId || !formData.name}
                  onClick={() => createMutation.mutate(formData)}
                >
                  {createMutation.isPending ? "Creating..." : "Create Account"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Quick Start Dialog */}
      <Dialog open={quickStartOpen} onOpenChange={setQuickStartOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-yellow-500" />Pay Stub Accounts — Quick Start</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Creates the following standard accounts for the selected company. Accounts that already exist will be skipped.</p>
          <div className="space-y-2 my-2 max-h-72 overflow-y-auto pr-1">
            {[
              { label: "Earnings", color: "text-green-700 dark:text-green-400", items: ["Regular Wages", "Overtime", "Vacation"] },
              { label: "Taxes", color: "text-red-700 dark:text-red-400", items: ["Federal Income Tax", "Social Security", "Medicare", "CA Personal Income Tax", "CA State Disability Insurance"] },
              { label: "Deductions", color: "text-orange-700 dark:text-orange-400", items: ["Health Insurance", "401k"] },
              { label: "Employer Contributions", color: "text-blue-700 dark:text-blue-400", items: ["Employer Social Security", "Employer Medicare", "FUTA", "CA Unemployment Insurance (SUI)", "CA Employment Training Tax (ETT)"] },
              { label: "Employee Contributions", color: "text-purple-700 dark:text-purple-400", items: ["Employee Social Security (12.4%)", "Employee Medicare (2.9%)"] },
            ].map(group => (
              <div key={group.label}>
                <p className={`text-xs font-semibold uppercase tracking-wider mb-1 ${group.color}`}>{group.label}</p>
                <div className="flex flex-wrap gap-1">
                  {group.items.map(item => (
                    <span key={item} className="text-xs bg-muted rounded px-2 py-0.5">{item}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label>Apply to Company</Label>
            <Select value={quickStartCompany} onValueChange={setQuickStartCompany}>
              <SelectTrigger data-testid="select-quick-start-company"><SelectValue placeholder="Select a company" /></SelectTrigger>
              <SelectContent>
                {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setQuickStartOpen(false)}>Cancel</Button>
            <Button
              data-testid="button-quick-start-confirm"
              disabled={!quickStartCompany || quickSetupMutation.isPending}
              onClick={() => {
                const comp = companies.find(c => c.id === quickStartCompany);
                quickSetupMutation.mutate({ companyId: quickStartCompany, legalEntityId: comp?.legalEntityId || "" });
              }}
            >
              <Zap className="mr-2 h-4 w-4" />
              {quickSetupMutation.isPending ? "Creating accounts..." : "Run Quick Start"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {filteredAccounts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-10 text-center">
            <Receipt className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="font-semibold mb-1">No pay stub accounts yet</h3>
            <p className="text-sm text-muted-foreground mb-5 max-w-sm mx-auto">
              Pay stub accounts define the line items that appear on employee pay stubs — earnings, taxes, deductions, and contributions.
            </p>
            <Button
              data-testid="button-empty-quick-start"
              onClick={() => { setQuickStartCompany(selectedCompany !== "all" ? selectedCompany : ""); setQuickStartOpen(true); }}
            >
              <Zap className="mr-2 h-4 w-4" />Quick Start — Create Standard Accounts
            </Button>
          </CardContent>
        </Card>
      ) : (
        PSA_TYPE_ORDER.map(type => {
          const items = groupedAccounts[type];
          if (!items || items.length === 0) return null;
          return (
            <Card key={type}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {PSA_TYPE_LABELS[type] || type}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Paid By (Legal Entity)</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Order</TableHead>
                        <TableHead>Debit</TableHead>
                        <TableHead>Credit</TableHead>
                        <TableHead className="w-20">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map(psa => {
                        const comp = companies.find(c => c.id === psa.companyId);
                        const leName = getLegalEntityName(psa.legalEntityId);
                        return (
                          <TableRow key={psa.id} data-testid={`row-pay-stub-account-${psa.id}`}>
                            <TableCell className="font-medium">{psa.name}</TableCell>
                            <TableCell className="text-sm">{comp?.name || "—"}</TableCell>
                            <TableCell className="text-sm">{leName || "—"}</TableCell>
                            <TableCell>
                              <button
                                onClick={() => toggleStatusMutation.mutate({ id: psa.id, status: psa.status === "enabled" ? "disabled" : "enabled" })}
                                className="cursor-pointer"
                                data-testid={`toggle-psa-status-${psa.id}`}
                              >
                                <Badge variant={psa.status === "enabled" ? "default" : "outline"} className="text-xs cursor-pointer">
                                  {psa.status}
                                </Badge>
                              </button>
                            </TableCell>
                            <TableCell>{psa.displayOrder ?? 0}</TableCell>
                            <TableCell className="text-xs">{psa.debitAccount || "—"}</TableCell>
                            <TableCell className="text-xs">{psa.creditAccount || "—"}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button size="icon" variant="ghost" data-testid={`button-edit-psa-${psa.id}`} onClick={() => openEdit(psa)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button size="icon" variant="ghost" data-testid={`button-delete-psa-${psa.id}`} onClick={() => deleteMutation.mutate(psa.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={v => { setEditDialogOpen(v); if (!v) setEditingAccount(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Pay Stub Account</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input data-testid="input-edit-psa-name" value={editFormData.name} onChange={e => setEditFormData(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Paid By (Legal Entity)</Label>
              <Select value={editFormData.legalEntityId || "none"} onValueChange={v => setEditFormData(p => ({ ...p, legalEntityId: v }))}>
                <SelectTrigger data-testid="select-edit-psa-legal-entity"><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {legalEntities.map(le => <SelectItem key={le.id} value={le.id}>{le.legalName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={editFormData.type} onValueChange={v => setEditFormData(p => ({ ...p, type: v }))}>
                  <SelectTrigger data-testid="select-edit-psa-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="earning">Earning</SelectItem>
                    <SelectItem value="tax">Tax</SelectItem>
                    <SelectItem value="deduction">Deduction</SelectItem>
                    <SelectItem value="employer_contribution">Employer Contribution</SelectItem>
                    <SelectItem value="employee_contribution">Employee Contribution</SelectItem>
                    <SelectItem value="benefit">Benefit</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editFormData.status} onValueChange={v => setEditFormData(p => ({ ...p, status: v }))}>
                  <SelectTrigger data-testid="select-edit-psa-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="enabled">Enabled</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Display Order</Label>
                <Input type="number" data-testid="input-edit-psa-display-order" value={editFormData.displayOrder} onChange={e => setEditFormData(p => ({ ...p, displayOrder: Number(e.target.value) }))} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Debit Account (GL)</Label>
                <Input data-testid="input-edit-psa-debit" value={editFormData.debitAccount} onChange={e => setEditFormData(p => ({ ...p, debitAccount: e.target.value }))} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>Credit Account (GL)</Label>
                <Input data-testid="input-edit-psa-credit" value={editFormData.creditAccount} onChange={e => setEditFormData(p => ({ ...p, creditAccount: e.target.value }))} placeholder="Optional" />
              </div>
            </div>
            <Button
              className="w-full"
              data-testid="button-save-edit-psa"
              disabled={updateMutation.isPending || !editFormData.name}
              onClick={() => editingAccount && updateMutation.mutate({ id: editingAccount.id, data: editFormData })}
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const BLANK_AMENDMENT = {
  companyId: "", workerId: "", payStubAccountId: "", amendmentType: "earning",
  amountType: "fixed", amount: "", rate: "", units: "", percent: "",
  effectiveDate: "", description: "", status: "active",
};

function PayStubAmendmentsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ ...BLANK_AMENDMENT });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: payStubAccountsList = [] } = useQuery<PayStubAccount[]>({ queryKey: ["/api/pay-stub-accounts"] });
  const { data: amendments = [], isLoading } = useQuery<PayStubAmendment[]>({ queryKey: ["/api/pay-stub-amendments"] });

  const getWorkerName = (id: string) => { const w = workers.find(w => w.id === id); return w ? `${w.firstName} ${w.lastName}` : id; };
  const filteredWorkers = formData.companyId ? workers.filter(w => w.companyId === formData.companyId) : workers;

  const openAdd = () => { setEditingId(null); setFormData({ ...BLANK_AMENDMENT }); setDialogOpen(true); };
  const openEdit = (am: any) => {
    setEditingId(am.id);
    setFormData({
      companyId: am.companyId || "",
      workerId: am.workerId || "",
      payStubAccountId: am.payStubAccountId || "",
      amendmentType: am.amendmentType || "earning",
      amountType: am.amountType || "fixed",
      amount: am.amount ? String(am.amount) : "",
      rate: am.rate ? String(am.rate) : "",
      units: am.units ? String(am.units) : "",
      percent: am.percent ? String(am.percent) : "",
      effectiveDate: am.effectiveDate || "",
      description: am.description || "",
      status: am.status || "active",
    });
    setDialogOpen(true);
  };

  const buildPayload = (data: typeof formData) => ({
    ...data,
    amount: data.amount ? String(data.amount) : "0",
    rate: data.rate ? String(data.rate) : "0",
    units: data.units ? String(data.units) : "0",
    percent: data.percent ? String(data.percent) : "0",
    effectiveDate: data.effectiveDate || null,
    description: data.description || null,
    payStubAccountId: data.payStubAccountId || null,
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (editingId) {
        const res = await apiRequest("PATCH", `/api/pay-stub-amendments/${editingId}`, buildPayload(data));
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/pay-stub-amendments", buildPayload(data));
        return res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-stub-amendments"] });
      toast({ title: editingId ? "Amendment updated" : "Amendment created" });
      setDialogOpen(false);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/pay-stub-amendments/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-stub-amendments"] });
      toast({ title: "Amendment deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <div data-testid="loading-pay-stub-amendments"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button data-testid="button-add-pay-stub-amendment" onClick={openAdd}><Plus className="mr-2 h-4 w-4" />Add Amendment</Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "Edit Amendment" : "Add Pay Stub Amendment"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Type — most important, shown first */}
            <div className="space-y-2">
              <Label>Type <span className="text-red-500">*</span></Label>
              <Select value={formData.amendmentType} onValueChange={v => setFormData(p => ({ ...p, amendmentType: v }))}>
                <SelectTrigger data-testid="select-psam-amendment-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="earning">Earning — adds to gross pay (bonus, reimbursement)</SelectItem>
                  <SelectItem value="deduction">Deduction — reduces net pay (loan repayment, advance)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Worker <span className="text-red-500">*</span></Label>
              <Select value={formData.workerId} onValueChange={v => setFormData(p => ({ ...p, workerId: v }))}>
                <SelectTrigger data-testid="select-psam-worker"><SelectValue placeholder="Select worker" /></SelectTrigger>
                <SelectContent>{workers.map(w => <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount ($)</Label>
              <Input type="number" step="0.01" placeholder="0.00" data-testid="input-psam-amount" value={formData.amount} onChange={e => setFormData(p => ({ ...p, amount: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Effective Date</Label>
              <Input type="date" data-testid="input-psam-effective-date" value={formData.effectiveDate} onChange={e => setFormData(p => ({ ...p, effectiveDate: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Must fall within the pay period being processed.</p>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea placeholder="e.g. Paycheck advance repayment" data-testid="input-psam-description" value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={v => setFormData(p => ({ ...p, status: v }))}>
                <SelectTrigger data-testid="select-psam-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" data-testid="button-submit-pay-stub-amendment"
              disabled={saveMutation.isPending || !formData.workerId}
              onClick={() => saveMutation.mutate(formData)}>
              {saveMutation.isPending ? "Saving..." : editingId ? "Save Changes" : "Create Amendment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Effective Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {amendments.map(am => (
                  <TableRow key={am.id} data-testid={`row-pay-stub-amendment-${am.id}`}>
                    <TableCell className="font-medium">{getWorkerName(am.workerId)}</TableCell>
                    <TableCell>
                      <Badge variant={am.amendmentType === "deduction" ? "destructive" : "default"}
                        data-testid={`badge-psam-type-${am.id}`}>
                        {am.amendmentType === "deduction" ? "Deduction" : "Earning"}
                      </Badge>
                    </TableCell>
                    <TableCell className={am.amendmentType === "deduction" ? "text-red-600 font-medium" : "text-green-600 font-medium"}>
                      {am.amendmentType === "deduction" ? "-" : "+"}${Number(am.amount || 0).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{am.description || "—"}</TableCell>
                    <TableCell>{am.effectiveDate || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={am.status === "active" ? "default" : "outline"} data-testid={`badge-psam-status-${am.id}`}>
                        {am.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" data-testid={`button-edit-amendment-${am.id}`} onClick={() => openEdit(am)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="text-red-500 hover:text-red-700"
                          data-testid={`button-delete-amendment-${am.id}`}
                          onClick={() => { if (confirm("Delete this amendment?")) deleteMutation.mutate(am.id); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {amendments.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No pay stub amendments</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PayStubTransactionsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeView, setActiveView] = useState<"runs" | "manual">("runs");
  const [formData, setFormData] = useState({
    companyId: "", workerId: "", status: "pending", paymentMethod: "check",
    amount: "", transactionDate: "", checkNumber: "", reference: "",
  });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: transactions = [], isLoading } = useQuery<PayStubTransaction[]>({ queryKey: ["/api/pay-stub-transactions"] });
  const { data: transactionRuns = [], isLoading: runsLoading } = useQuery<any[]>({ queryKey: ["/api/payroll-transaction-runs"] });

  const getWorkerName = (id: string) => { const w = workers.find(w => w.id === id); return w ? `${w.firstName} ${w.lastName}` : id; };

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/pay-stub-transactions", {
        ...data,
        amount: data.amount ? String(data.amount) : "0",
        transactionDate: data.transactionDate || null,
        checkNumber: data.checkNumber || null,
        reference: data.reference || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-stub-transactions"] });
      toast({ title: "Transaction created" });
      setDialogOpen(false);
      setFormData({ companyId: "", workerId: "", status: "pending", paymentMethod: "check", amount: "", transactionDate: "", checkNumber: "", reference: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading && runsLoading) return <div data-testid="loading-pay-stub-transactions"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="space-y-4">
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30">
        <CardContent className="p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Payroll Transaction Runs are auto-generated by the engine when processing ACH/payroll.</p>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">The <strong>Engine-Generated Runs</strong> view shows ACH batches and payroll payment records. Manual transactions are legacy entries used for audit and reconciliation only.</p>
          </div>
        </CardContent>
      </Card>
      <div className="flex items-center gap-2">
        <Button variant={activeView === "runs" ? "default" : "outline"} size="sm" onClick={() => setActiveView("runs")} data-testid="button-view-transaction-runs">
          Engine-Generated Runs ({transactionRuns.length})
        </Button>
        <Button variant={activeView === "manual" ? "default" : "outline"} size="sm" onClick={() => setActiveView("manual")} data-testid="button-view-manual-transactions">
          Manual Transactions ({transactions.length})
        </Button>
      </div>
      {activeView === "runs" && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run ID</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Settled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactionRuns.map((run: any) => (
                    <TableRow key={run.id} data-testid={`row-transaction-run-${run.id}`}>
                      <TableCell className="font-mono text-xs">{run.id?.slice(0, 8)}…</TableCell>
                      <TableCell><Badge variant="outline">{run.type || run.batchType || "payroll"}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={run.status === "settled" ? "default" : run.status === "failed" ? "destructive" : "secondary"}>
                          {run.status || "pending"}
                        </Badge>
                      </TableCell>
                      <TableCell>${Number(run.totalAmount || run.amount || 0).toFixed(2)}</TableCell>
                      <TableCell>{run.createdAt ? new Date(run.createdAt).toLocaleDateString() : "—"}</TableCell>
                      <TableCell>{run.settledAt ? new Date(run.settledAt).toLocaleDateString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {transactionRuns.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No engine-generated transaction runs yet. Transaction runs are created automatically when ACH batches are processed.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
      {activeView === "manual" && (
      <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-pay-stub-transaction"><Plus className="mr-2 h-4 w-4" />Add Transaction</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Pay Stub Transaction</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={formData.companyId} onValueChange={v => setFormData(p => ({ ...p, companyId: v }))}>
                  <SelectTrigger data-testid="select-pst-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Worker</Label>
                <Select value={formData.workerId} onValueChange={v => setFormData(p => ({ ...p, workerId: v }))}>
                  <SelectTrigger data-testid="select-pst-worker"><SelectValue placeholder="Select worker" /></SelectTrigger>
                  <SelectContent>
                    {workers.map(w => <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={v => setFormData(p => ({ ...p, status: v }))}>
                  <SelectTrigger data-testid="select-pst-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="voided">Voided</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={formData.paymentMethod} onValueChange={v => setFormData(p => ({ ...p, paymentMethod: v }))}>
                  <SelectTrigger data-testid="select-pst-payment-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="direct_deposit">Direct Deposit</SelectItem>
                    <SelectItem value="ach">ACH</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input type="number" step="0.01" data-testid="input-pst-amount" value={formData.amount} onChange={e => setFormData(p => ({ ...p, amount: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Transaction Date</Label>
                <Input type="date" data-testid="input-pst-date" value={formData.transactionDate} onChange={e => setFormData(p => ({ ...p, transactionDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Check Number</Label>
                <Input data-testid="input-pst-check-number" value={formData.checkNumber} onChange={e => setFormData(p => ({ ...p, checkNumber: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Reference</Label>
                <Input data-testid="input-pst-reference" value={formData.reference} onChange={e => setFormData(p => ({ ...p, reference: e.target.value }))} />
              </div>
              <Button
                className="w-full"
                data-testid="button-submit-pay-stub-transaction"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate(formData)}
              >
                {createMutation.isPending ? "Creating..." : "Create Transaction"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment Method</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Check #</TableHead>
                  <TableHead>Transaction Date</TableHead>
                  <TableHead>Reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map(tx => (
                  <TableRow key={tx.id} data-testid={`row-pay-stub-transaction-${tx.id}`}>
                    <TableCell>{getWorkerName(tx.workerId)}</TableCell>
                    <TableCell>
                      <Badge variant={tx.status === "completed" ? "default" : tx.status === "pending" ? "secondary" : "outline"} data-testid={`badge-pst-status-${tx.id}`}>
                        {tx.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" data-testid={`badge-pst-method-${tx.id}`}>{tx.paymentMethod}</Badge>
                    </TableCell>
                    <TableCell>${Number(tx.amount || 0).toFixed(2)}</TableCell>
                    <TableCell>{tx.checkNumber || "—"}</TableCell>
                    <TableCell>{tx.transactionDate || "—"}</TableCell>
                    <TableCell>{tx.reference || "—"}</TableCell>
                  </TableRow>
                ))}
                {transactions.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No pay stub transactions</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
    )}
  </div>
  );
}

function PayPeriodSchedulesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    companyId: "", name: "", description: "", type: "biweekly",
    anchorDate: "", transactionDayOffset: 3, semiMonthlyDay1: 1,
    semiMonthlyDay2: 15, isActive: true,
  });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: schedules = [], isLoading } = useQuery<PayPeriodSchedule[]>({ queryKey: ["/api/pay-period-schedules"] });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/pay-period-schedules", {
        ...data,
        anchorDate: data.anchorDate || null,
        description: data.description || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-period-schedules"] });
      toast({ title: "Pay period schedule created" });
      setDialogOpen(false);
      setFormData({ companyId: "", name: "", description: "", type: "biweekly", anchorDate: "", transactionDayOffset: 3, semiMonthlyDay1: 1, semiMonthlyDay2: 15, isActive: true });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <div data-testid="loading-pay-period-schedules"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-pay-period-schedule"><Plus className="mr-2 h-4 w-4" />Add Schedule</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Pay Period Schedule</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={formData.companyId} onValueChange={v => setFormData(p => ({ ...p, companyId: v }))}>
                  <SelectTrigger data-testid="select-pps-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input data-testid="input-pps-name" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea data-testid="input-pps-description" value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={formData.type} onValueChange={v => setFormData(p => ({ ...p, type: v }))}>
                  <SelectTrigger data-testid="select-pps-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Biweekly</SelectItem>
                    <SelectItem value="semi_monthly">Semi-Monthly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Anchor Date</Label>
                <Input type="date" data-testid="input-pps-anchor-date" value={formData.anchorDate} onChange={e => setFormData(p => ({ ...p, anchorDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Transaction Day Offset</Label>
                <Input type="number" data-testid="input-pps-offset" value={formData.transactionDayOffset} onChange={e => setFormData(p => ({ ...p, transactionDayOffset: Number(e.target.value) }))} />
              </div>
              {formData.type === "semi_monthly" && (
                <>
                  <div className="space-y-2">
                    <Label>Semi-Monthly Day 1</Label>
                    <Input type="number" data-testid="input-pps-semi-day1" value={formData.semiMonthlyDay1} onChange={e => setFormData(p => ({ ...p, semiMonthlyDay1: Number(e.target.value) }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Semi-Monthly Day 2</Label>
                    <Input type="number" data-testid="input-pps-semi-day2" value={formData.semiMonthlyDay2} onChange={e => setFormData(p => ({ ...p, semiMonthlyDay2: Number(e.target.value) }))} />
                  </div>
                </>
              )}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="isActivePPS"
                  data-testid="checkbox-pps-active"
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData(p => ({ ...p, isActive: checked === true }))}
                />
                <Label htmlFor="isActivePPS">Active</Label>
              </div>
              <Button
                className="w-full"
                data-testid="button-submit-pay-period-schedule"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate(formData)}
              >
                {createMutation.isPending ? "Creating..." : "Create Schedule"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Anchor Date</TableHead>
                  <TableHead>Transaction Day Offset</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map(s => (
                  <TableRow key={s.id} data-testid={`row-pay-period-schedule-${s.id}`}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      <Badge variant={s.type === "biweekly" ? "default" : s.type === "weekly" ? "secondary" : "outline"} data-testid={`badge-pps-type-${s.id}`}>
                        {s.type}
                      </Badge>
                    </TableCell>
                    <TableCell>{s.anchorDate || "—"}</TableCell>
                    <TableCell>{s.transactionDayOffset ?? 3}</TableCell>
                    <TableCell>
                      <Badge variant={s.isActive ? "default" : "outline"} data-testid={`badge-pps-active-${s.id}`}>
                        {s.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {schedules.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No pay period schedules configured</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PlaceholderTab({ icon: Icon, message }: { icon: typeof Calculator; message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center p-12 text-center">
        <Icon className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground" data-testid="text-placeholder-message">{message}</p>
      </CardContent>
    </Card>
  );
}

const DEFAULT_LAYOUT_CONFIG = {
  showCompanyLogo: true,
  showCompanyName: true,
  showCompanyAddress: true,
  showCheckNumber: true,
  showMicrLine: true,
  showEarningsDetail: true,
  showDeductionsDetail: true,
  showYtdTotals: true,
  showPayPeriod: true,
  showEmployeeAddress: true,
};

const TEMPLATE_PRESETS: Record<string, { label: string; description: string }> = {
  standard: { label: "Standard", description: "Check on top, pay stub on bottom" },
  voucher: { label: "Voucher", description: "Stub on top, check in middle, stub on bottom" },
  "three-part": { label: "3-Part Stub", description: "Three detachable stubs per page" },
};

function CheckPreview({ templateType, config, company }: {
  templateType: string;
  config: Record<string, boolean>;
  company?: Company;
}) {
  const coName = company?.name || "Company Name";
  const coAddr = company?.address ? `${company.address}, ${company.city || "City"}, ${company.state || "ST"} ${company.zip || ""}` : "123 Main St, City, ST 00000";

  const checkPortion = (
    <div className="border border-primary/40 rounded p-3 bg-background space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {config.showCompanyLogo && (
            company?.logoUrl
              ? <img src={company.logoUrl} alt="" className="h-7 w-7 object-contain" />
              : <div className="h-7 w-7 bg-primary/10 rounded flex items-center justify-center text-[10px] font-bold text-primary">{coName[0]}</div>
          )}
          <div>
            {config.showCompanyName && <p className="text-[11px] font-bold">{coName}</p>}
            {config.showCompanyAddress && <p className="text-[9px] text-muted-foreground">{coAddr}</p>}
          </div>
        </div>
        <div className="text-right">
          {config.showCheckNumber && <p className="text-[9px] font-mono text-muted-foreground">Check #1001</p>}
          <p className="text-[9px] text-muted-foreground">Mar 15, 2026</p>
          <p className="text-[8px] text-muted-foreground/60">Void after 90 days</p>
        </div>
      </div>
      <div className="flex justify-between items-end pt-0">
        <div>
          <p className="text-[9px] text-muted-foreground">Pay to the order of:</p>
          <p className="text-[11px] font-bold">John Doe</p>
          <p className="text-[9px] text-muted-foreground italic">Payroll Mar 1 to Mar 15</p>
        </div>
        <p className="text-sm font-bold">$2,172.00</p>
      </div>
      {config.showMicrLine && (
        <div className="border-t pt-1">
          <p className="text-[8px] font-mono text-muted-foreground tracking-wider font-bold">⑈021000021⑈ ⑆123456789⑆ 1001</p>
        </div>
      )}
    </div>
  );

  const mailingStub = (
    <div className="border border-dashed border-muted-foreground/30 rounded overflow-hidden">
      <div className="flex h-28 relative">
        {/* LEFT: Stacked addresses — positioned for envelope windows */}
        <div className="absolute left-0 top-0 w-1/2 h-full text-[9px]">
          {/* Company address: 22mm from top, 9mm from left (scaled ~20%, so ~4px top, ~2px left) */}
          <div className="absolute" style={{ top: "16%", left: "8px" }}>
            <p className="text-[9px] font-semibold">{coName}</p>
            <p className="text-[8px] text-muted-foreground leading-tight">{coAddr}</p>
          </div>
          {/* Employee address: 55mm from top, 15mm from left (scaled) */}
          <div className="absolute border border-muted-foreground/20 rounded p-1 bg-white/50" style={{ top: "52%", left: "14px" }}>
            <p className="text-[9px] font-bold">John Doe</p>
            <p className="text-[8px] text-muted-foreground leading-tight">456 Employee St</p>
            <p className="text-[8px] text-muted-foreground">City, ST 11111</p>
          </div>
        </div>

        {/* RIGHT: Paystub with company name + EIN */}
        <div className="absolute left-1/2 top-0 p-2 flex-1 space-y-1">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-bold">PAYSTUB</p>
              <p className="text-[6px] text-muted-foreground">{coName} — EIN: 12-3456789</p>
            </div>
            <div className="text-[6px] text-muted-foreground text-right">
              {config.showPayPeriod && <div>Period: Mar 1 – Mar 15, 2026</div>}
              <div>Pay Date: Mar 20, 2026</div>
            </div>
          </div>
          <p className="text-[5px] text-muted-foreground/70 italic border-b border-muted-foreground/20 pb-0.5">Independent contractor — responsible for self-employment tax</p>
          
          {/* Earnings table */}
          <table className="w-full border-collapse text-[7px]">
            <thead>
              <tr className="border-b border-foreground">
                <th className="text-left px-1 text-[6px] font-bold">EARNINGS</th>
                <th className="text-right px-1 text-[6px] font-bold">HOURS</th>
                <th className="text-right px-1 text-[6px] font-bold">RATE</th>
                <th className="text-right px-1 text-[6px] font-bold">CURRENT</th>
                <th className="text-right px-1 text-[6px] font-bold">YTD</th>
              </tr>
            </thead>
            <tbody className="text-[7px]">
              <tr>
                <td className="px-1 text-left">Regular</td>
                <td className="px-1 text-right">80</td>
                <td className="px-1 text-right">—</td>
                <td className="px-1 text-right">—</td>
                <td className="px-1 text-right">—</td>
              </tr>
              <tr className="border-t border-muted-foreground/50">
                <td className="px-1 text-left font-bold">TOTAL HOURS</td>
                <td className="px-1 text-right font-bold">80</td>
                <td className="px-1 text-right">—</td>
                <td className="px-1 text-right">—</td>
                <td className="px-1 text-right">—</td>
              </tr>
            </tbody>
          </table>

          {/* Deductions section */}
          <div className="pt-0.5 space-y-0.5 text-[7px]">
            <div className="flex justify-between font-bold">
              <span>GROSS PAY</span>
              <span>$2,400</span>
              <span>$12,000</span>
            </div>
            <div className="flex justify-between border-b border-muted-foreground/30 pb-0.5">
              <span>TOTAL DEDUCTIONS</span>
              <span>$228</span>
              <span>$1,140</span>
            </div>
            <div className="flex justify-between font-bold text-[8px]">
              <span>NET PAY</span>
              <span>$2,172</span>
              <span>$10,860</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const earningsStub = (
    <div className="border border-dashed border-muted-foreground/30 rounded p-2 bg-muted/20 space-y-1">
      <div className="flex gap-3">
        {config.showEarningsDetail && (
          <div className="flex-1 space-y-0.5">
            <p className="text-[9px] font-semibold">Earnings</p>
            <div className="text-[8px] text-muted-foreground space-y-0.5">
              <div className="flex justify-between"><span>Regular 80h @ $30</span><span>$2,400</span></div>
              <div className="flex justify-between"><span>Overtime 3h @ $45</span><span>$135</span></div>
              <div className="flex justify-between font-semibold border-t pt-0.5"><span>Gross Pay</span><span>$2,535</span></div>
            </div>
          </div>
        )}
        {config.showDeductionsDetail && (
          <div className="flex-1 space-y-0.5">
            <p className="text-[9px] font-semibold">Deductions</p>
            <div className="text-[8px] text-muted-foreground space-y-0.5">
              <div className="flex justify-between"><span>Federal Tax</span><span>$312</span></div>
              <div className="flex justify-between"><span>CA State Tax</span><span>$96</span></div>
              <div className="flex justify-between font-semibold border-t pt-0.5"><span>Net Pay</span><span>$2,172</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const genericStub = (
    <div className="border border-dashed border-muted-foreground/30 rounded p-2 bg-muted/20 space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {config.showCompanyName && <span className="text-[9px] font-semibold">{coName}</span>}
        </div>
        {config.showPayPeriod && <span className="text-[8px] text-muted-foreground">Mar 1–15, 2026</span>}
      </div>
      <div className="flex gap-2">
        {config.showEarningsDetail && (
          <div className="flex-1 text-[8px] text-muted-foreground">
            <p className="font-semibold text-foreground">Earnings</p>
            <div className="flex justify-between"><span>Regular</span><span>$2,400</span></div>
            <div className="flex justify-between"><span>Overtime</span><span>$180</span></div>
          </div>
        )}
        {config.showDeductionsDetail && (
          <div className="flex-1 text-[8px] text-muted-foreground">
            <p className="font-semibold text-foreground">Deductions</p>
            <div className="flex justify-between"><span>Federal</span><span>$312</span></div>
            <div className="flex justify-between"><span>State</span><span>$96</span></div>
          </div>
        )}
      </div>
      {config.showYtdTotals && (
        <div className="flex justify-between text-[8px] border-t pt-1">
          <span className="font-semibold">YTD Gross: $12,000</span>
          <span className="font-semibold">YTD Net: $9,180</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-1 p-3 border rounded-lg bg-muted/10 max-w-md">
      <p className="text-[10px] font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Preview</p>
      {templateType === "standard" && (
        <div className="space-y-1">
          {checkPortion}
          <div className="border-t border-dashed border-muted-foreground/40 my-0.5" />
          {mailingStub}
          <div className="border-t border-dashed border-muted-foreground/40 my-0.5" />
          {earningsStub}
        </div>
      )}
      {templateType === "voucher" && (
        <div className="space-y-1">
          {genericStub}
          <div className="border-t border-dashed border-muted-foreground/40 my-0.5" />
          {checkPortion}
          <div className="border-t border-dashed border-muted-foreground/40 my-0.5" />
          {genericStub}
        </div>
      )}
      {templateType === "three-part" && (
        <div className="space-y-1">
          {checkPortion}
          <div className="border-t border-dashed border-muted-foreground/40 my-0.5" />
          {genericStub}
          <div className="border-t border-dashed border-muted-foreground/40 my-0.5" />
          {genericStub}
        </div>
      )}
    </div>
  );
}

function CheckLayoutTab() {
  const { toast } = useToast();
  const [selectedCompany, setSelectedCompany] = useState<string>("");
  const [editingTemplate, setEditingTemplate] = useState<CheckTemplate | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("standard");
  const [layoutConfig, setLayoutConfig] = useState<Record<string, boolean>>({ ...DEFAULT_LAYOUT_CONFIG });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const effectiveCompanyId = selectedCompany && selectedCompany !== "all" ? selectedCompany : undefined;
  const { data: templates = [], isLoading } = useQuery<CheckTemplate[]>({
    queryKey: ["/api/check-templates", effectiveCompanyId || "all"],
    queryFn: async () => {
      const url = effectiveCompanyId ? `/api/check-templates?companyId=${effectiveCompanyId}` : "/api/check-templates";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const invalidateTemplates = () => {
    queryClient.invalidateQueries({ predicate: (query) => (query.queryKey[0] as string)?.startsWith?.("/api/check-templates") || query.queryKey[0] === "/api/check-templates" });
  };

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; templateType: string; companyId: string; layoutConfig: string; isDefault: boolean }) => {
      await apiRequest("POST", "/api/check-templates", data);
    },
    onSuccess: () => {
      invalidateTemplates();
      setAddOpen(false);
      setNewName("");
      setNewType("standard");
      setLayoutConfig({ ...DEFAULT_LAYOUT_CONFIG });
      toast({ title: "Template created" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CheckTemplate> }) => {
      await apiRequest("PATCH", `/api/check-templates/${id}`, data);
    },
    onSuccess: () => {
      invalidateTemplates();
      setEditingTemplate(null);
      toast({ title: "Template updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/check-templates/${id}`);
    },
    onSuccess: () => {
      invalidateTemplates();
      toast({ title: "Template deleted" });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) => {
      const others = templates.filter(t => t.companyId === effectiveCompanyId && t.id !== id);
      for (const t of others) {
        if (t.isDefault) await apiRequest("PATCH", `/api/check-templates/${t.id}`, { isDefault: false });
      }
      await apiRequest("PATCH", `/api/check-templates/${id}`, { isDefault: true });
    },
    onSuccess: () => {
      invalidateTemplates();
      toast({ title: "Default template set" });
    },
  });

  const openEdit = (t: CheckTemplate) => {
    setEditingTemplate(t);
    try {
      setLayoutConfig(JSON.parse(t.layoutConfig || "{}"));
    } catch {
      setLayoutConfig({ ...DEFAULT_LAYOUT_CONFIG });
    }
  };

  const selectedCompanyObj = companies.find(c => c.id === effectiveCompanyId);

  const toggleField = (field: string) => {
    setLayoutConfig(prev => ({ ...prev, [field]: !prev[field] }));
  };

  const layoutFields = [
    { key: "showCompanyLogo", label: "Company Logo" },
    { key: "showCompanyName", label: "Company Name" },
    { key: "showCompanyAddress", label: "Company Address" },
    { key: "showCheckNumber", label: "Check Number" },
    { key: "showMicrLine", label: "MICR Line" },
    { key: "showEarningsDetail", label: "Earnings Detail" },
    { key: "showDeductionsDetail", label: "Deductions Detail" },
    { key: "showYtdTotals", label: "YTD Totals" },
    { key: "showPayPeriod", label: "Pay Period" },
    { key: "showEmployeeAddress", label: "Employee Address" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Check Layout Templates</h2>
        <div className="flex items-center gap-3">
          <Select value={selectedCompany} onValueChange={setSelectedCompany}>
            <SelectTrigger className="w-[200px]" data-testid="select-template-company">
              <SelectValue placeholder="All companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-template" disabled={!effectiveCompanyId}>
                <Plus className="mr-2 h-4 w-4" />New Template
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Create Check Template</DialogTitle></DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Template Name</Label>
                  <Input data-testid="input-template-name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Standard Paycheck" />
                </div>
                <div className="grid gap-2">
                  <Label>Template Type</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {Object.entries(TEMPLATE_PRESETS).map(([key, preset]) => (
                      <button
                        key={key}
                        data-testid={`button-preset-${key}`}
                        onClick={() => setNewType(key)}
                        className={`p-3 border rounded-lg text-left transition-colors ${newType === key ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/50"}`}
                      >
                        <p className="text-sm font-medium">{preset.label}</p>
                        <p className="text-xs text-muted-foreground">{preset.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Layout Options</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {layoutFields.map(f => (
                      <div key={f.key} className="flex items-center justify-between rounded-md border px-3 py-2">
                        <span className="text-sm">{f.label}</span>
                        <Switch
                          data-testid={`switch-${f.key}`}
                          checked={layoutConfig[f.key] ?? true}
                          onCheckedChange={() => toggleField(f.key)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <CheckPreview templateType={newType} config={layoutConfig} company={selectedCompanyObj} />
                <Button
                  data-testid="button-create-template"
                  disabled={!newName || !effectiveCompanyId || createMutation.isPending}
                  onClick={() => effectiveCompanyId && createMutation.mutate({
                    name: newName,
                    templateType: newType,
                    companyId: effectiveCompanyId,
                    layoutConfig: JSON.stringify(layoutConfig),
                    isDefault: templates.length === 0,
                  })}
                >
                  {createMutation.isPending ? "Creating..." : "Create Template"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map(i => <Card key={i}><CardContent className="p-6"><Skeleton className="h-32 w-full" /></CardContent></Card>)}
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Layout className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No check templates yet. Select a company and create one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map(t => {
            let config: Record<string, boolean>;
            try { config = JSON.parse(t.layoutConfig || "{}"); } catch { config = { ...DEFAULT_LAYOUT_CONFIG }; }
            const tCompany = companies.find(c => c.id === t.companyId);
            return (
              <Card key={t.id} data-testid={`card-template-${t.id}`} className={t.isDefault ? "ring-2 ring-primary" : ""}>
                <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      {t.name}
                      {t.isDefault && <Badge variant="secondary" className="text-xs">Default</Badge>}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">{TEMPLATE_PRESETS[t.templateType || "standard"]?.label || t.templateType} — {tCompany?.name || "Unknown"}</p>
                  </div>
                  <div className="flex gap-1">
                    {!t.isDefault && (
                      <Button size="sm" variant="outline" data-testid={`button-set-default-${t.id}`} onClick={() => setDefaultMutation.mutate(t.id)}>
                        <Check className="h-3 w-3 mr-1" />Set Default
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" data-testid={`button-edit-template-${t.id}`} onClick={() => openEdit(t)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" data-testid={`button-delete-template-${t.id}`} onClick={() => deleteMutation.mutate(t.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <CheckPreview templateType={t.templateType || "standard"} config={config} company={tCompany} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!editingTemplate} onOpenChange={(open) => !open && setEditingTemplate(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Template: {editingTemplate?.name}</DialogTitle></DialogHeader>
          {editingTemplate && (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Template Name</Label>
                <Input data-testid="input-edit-template-name" value={editingTemplate.name} onChange={e => setEditingTemplate({ ...editingTemplate, name: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Template Type</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {Object.entries(TEMPLATE_PRESETS).map(([key, preset]) => (
                    <button
                      key={key}
                      data-testid={`button-edit-preset-${key}`}
                      onClick={() => setEditingTemplate({ ...editingTemplate, templateType: key })}
                      className={`p-3 border rounded-lg text-left transition-colors ${editingTemplate.templateType === key ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/50"}`}
                    >
                      <p className="text-sm font-medium">{preset.label}</p>
                      <p className="text-xs text-muted-foreground">{preset.description}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Layout Options</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {layoutFields.map(f => (
                    <div key={f.key} className="flex items-center justify-between rounded-md border px-3 py-2">
                      <span className="text-sm">{f.label}</span>
                      <Switch
                        data-testid={`switch-edit-${f.key}`}
                        checked={layoutConfig[f.key] ?? true}
                        onCheckedChange={() => toggleField(f.key)}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <CheckPreview templateType={editingTemplate.templateType || "standard"} config={layoutConfig} company={companies.find(c => c.id === editingTemplate.companyId)} />
              <Button
                data-testid="button-save-template"
                disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate({
                  id: editingTemplate.id,
                  data: {
                    name: editingTemplate.name,
                    templateType: editingTemplate.templateType,
                    layoutConfig: JSON.stringify(layoutConfig),
                  },
                })}
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Payment Methods Tab ───────────────────────────────────────────────────────
const PM_CATEGORY_LABELS: Record<string, string> = { cash: "Cash", check: "Check", ach: "Bank / ACH", digital_wallet: "Digital Wallet", other: "Other" };

function PaymentMethodsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMethod, setEditingMethod] = useState<PayrollPaymentMethod | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<string>("all");
  const emptyForm = { companyId: "" as string | null, code: "", name: "", category: "other", isDigitalWallet: false, isBankBased: false, requiresReferenceNumber: false, requiresAccountSelection: true, sortOrder: 0 };
  const [formData, setFormData] = useState(emptyForm);

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: methods = [], isLoading } = useQuery<PayrollPaymentMethod[]>({ queryKey: ["/api/payroll-payment-methods"] });

  const filteredMethods = selectedCompany === "all" ? methods : methods.filter(m => !m.companyId || m.companyId === selectedCompany);

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (editingMethod) {
        const res = await apiRequest("PATCH", `/api/payroll-payment-methods/${editingMethod.id}`, { ...data, companyId: data.companyId || null });
        return res.json();
      }
      const res = await apiRequest("POST", "/api/payroll-payment-methods", { ...data, companyId: data.companyId || null });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-payment-methods"] });
      toast({ title: editingMethod ? "Payment method updated" : "Payment method created" });
      setDialogOpen(false);
      setEditingMethod(null);
      setFormData(emptyForm);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/payroll-payment-methods/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll-payment-methods"] }); toast({ title: "Deleted" }); },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => { await apiRequest("PATCH", `/api/payroll-payment-methods/${id}`, { active }); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/payroll-payment-methods"] }),
  });

  const quickSetupMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", "/api/payroll-payment-methods/quick-setup", { companyId: selectedCompany !== "all" ? selectedCompany : null }); return res.json(); },
    onSuccess: (d: any) => { queryClient.invalidateQueries({ queryKey: ["/api/payroll-payment-methods"] }); toast({ title: "Quick Setup Complete", description: d.message }); },
    onError: (err: Error) => toast({ title: "Quick Setup Failed", description: err.message, variant: "destructive" }),
  });

  const openEdit = (m: PayrollPaymentMethod) => {
    setEditingMethod(m);
    setFormData({ companyId: m.companyId || "", code: m.code, name: m.name, category: m.category || "other", isDigitalWallet: m.isDigitalWallet ?? false, isBankBased: m.isBankBased ?? false, requiresReferenceNumber: m.requiresReferenceNumber ?? false, requiresAccountSelection: m.requiresAccountSelection ?? true, sortOrder: m.sortOrder ?? 0 });
    setDialogOpen(true);
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Select value={selectedCompany} onValueChange={setSelectedCompany}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All companies" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => quickSetupMutation.mutate()} disabled={quickSetupMutation.isPending}>
            <Zap className="mr-2 h-4 w-4" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup (8 methods)"}
          </Button>
          <Dialog open={dialogOpen} onOpenChange={v => { setDialogOpen(v); if (!v) { setEditingMethod(null); setFormData(emptyForm); } }}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-payment-method"><Plus className="mr-2 h-4 w-4" />Add Method</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>{editingMethod ? "Edit Payment Method" : "Add Payment Method"}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Code</Label>
                    <Input placeholder="e.g. ACH" value={formData.code} onChange={e => setFormData(p => ({ ...p, code: e.target.value.toUpperCase() }))} data-testid="input-pm-code" />
                  </div>
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input placeholder="e.g. ACH Direct Deposit" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} data-testid="input-pm-name" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select value={formData.category} onValueChange={v => setFormData(p => ({ ...p, category: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(PM_CATEGORY_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Company (optional)</Label>
                    <Select value={formData.companyId || "global"} onValueChange={v => setFormData(p => ({ ...p, companyId: v === "global" ? null : v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="global">Global (all companies)</SelectItem>
                        {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Sort Order</Label>
                    <Input type="number" value={formData.sortOrder} onChange={e => setFormData(p => ({ ...p, sortOrder: Number(e.target.value) }))} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {([
                    { key: "isDigitalWallet", label: "Digital Wallet" },
                    { key: "isBankBased", label: "Bank-Based" },
                    { key: "requiresReferenceNumber", label: "Requires Reference #" },
                    { key: "requiresAccountSelection", label: "Requires Account Selection" },
                  ] as const).map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer text-sm">
                      <Checkbox checked={!!formData[key]} onCheckedChange={v => setFormData(p => ({ ...p, [key]: !!v }))} />
                      {label}
                    </label>
                  ))}
                </div>
                <Button className="w-full" disabled={saveMutation.isPending || !formData.code || !formData.name} onClick={() => saveMutation.mutate(formData)} data-testid="button-save-pm">
                  {saveMutation.isPending ? "Saving..." : editingMethod ? "Save Changes" : "Create Method"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30">
        <CardContent className="p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Payment Methods serve as an allowlist for worker pay setup forms.</p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              When workers or managers configure payment preferences, only methods that are <strong>Active</strong> and match the company will appear as options.
              Use <strong>Quick Setup</strong> to seed standard US methods. Inactive methods are hidden from worker pay setup.
            </p>
          </div>
        </CardContent>
      </Card>

      {filteredMethods.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <CreditCard className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground mb-2">No payment methods configured.</p>
          <p className="text-sm text-muted-foreground">Use Quick Setup to seed the 8 standard methods (Cash, Check, ACH, Apple Pay, Cash App, PayPal, Venmo, Zelle).</p>
        </CardContent></Card>
      ) : (
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMethods.map(m => (
                <TableRow key={m.id} data-testid={`row-pm-${m.id}`}>
                  <TableCell><Badge variant="outline" className="font-mono text-xs">{m.code}</Badge></TableCell>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell className="text-sm">{PM_CATEGORY_LABELS[m.category || "other"] || m.category}</TableCell>
                  <TableCell className="text-xs space-x-1">
                    {m.isDigitalWallet && <Badge variant="secondary" className="text-xs">Digital</Badge>}
                    {m.isBankBased && <Badge variant="secondary" className="text-xs">Bank</Badge>}
                    {m.requiresReferenceNumber && <Badge variant="outline" className="text-xs">Ref#</Badge>}
                  </TableCell>
                  <TableCell className="text-sm">{m.sortOrder ?? 0}</TableCell>
                  <TableCell className="text-sm">{m.companyId ? (companies.find(c => c.id === m.companyId)?.name || "—") : <span className="text-muted-foreground italic text-xs">Global</span>}</TableCell>
                  <TableCell>
                    <button onClick={() => toggleMutation.mutate({ id: m.id, active: !m.active })} className="cursor-pointer" data-testid={`toggle-pm-${m.id}`}>
                      <Badge variant={m.active ? "default" : "outline"} className="cursor-pointer text-xs">{m.active ? "Active" : "Inactive"}</Badge>
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(m)} data-testid={`button-edit-pm-${m.id}`}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(m.id)} data-testid={`button-delete-pm-${m.id}`}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}
    </div>
  );
}

// ── Funding Accounts Tab ──────────────────────────────────────────────────────
const FA_TYPE_LABELS: Record<string, string> = {
  bank_checking: "Bank Checking", bank_savings: "Bank Savings", cash_on_hand: "Cash on Hand",
  paypal_balance: "PayPal Balance", venmo_balance: "Venmo Balance", cash_app_balance: "Cash App Balance",
  apple_pay_linked: "Apple Pay Linked", clearing_account: "Clearing Account",
};

function FundingAccountsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<FundingAccount | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<string>("all");
  const emptyForm = { companyId: "" as string | null, accountCode: "", accountName: "", accountType: "bank_checking", institutionName: "", maskedIdentifier: "", currency: "USD", allowForPayroll: true, reconciliationEnabled: false, openingBalance: "0", notes: "", remittanceSourceId: "" as string | null };
  const [formData, setFormData] = useState(emptyForm);

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: accounts = [], isLoading } = useQuery<FundingAccount[]>({ queryKey: ["/api/funding-accounts"] });
  const { data: remittanceSources = [] } = useQuery<RemittanceSource[]>({ queryKey: ["/api/remittance-sources"] });

  const filteredAccounts = selectedCompany === "all" ? accounts : accounts.filter(a => !a.companyId || a.companyId === selectedCompany);

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = { ...data, companyId: data.companyId || null, remittanceSourceId: data.remittanceSourceId || null };
      if (editingAccount) {
        const res = await apiRequest("PATCH", `/api/funding-accounts/${editingAccount.id}`, payload);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/funding-accounts", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/funding-accounts"] });
      toast({ title: editingAccount ? "Funding account updated" : "Funding account created" });
      setDialogOpen(false);
      setEditingAccount(null);
      setFormData(emptyForm);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/funding-accounts/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/funding-accounts"] }); toast({ title: "Deleted" }); },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => { await apiRequest("PATCH", `/api/funding-accounts/${id}`, { active }); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/funding-accounts"] }),
  });

  const quickSetupMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", "/api/funding-accounts/quick-setup", { companyId: selectedCompany !== "all" ? selectedCompany : null }); return res.json(); },
    onSuccess: (d: any) => { queryClient.invalidateQueries({ queryKey: ["/api/funding-accounts"] }); toast({ title: "Quick Setup Complete", description: d.message }); },
    onError: (err: Error) => toast({ title: "Quick Setup Failed", description: err.message, variant: "destructive" }),
  });

  const openEdit = (a: FundingAccount) => {
    setEditingAccount(a);
    setFormData({ companyId: a.companyId || "", accountCode: a.accountCode || "", accountName: a.accountName, accountType: a.accountType || "bank_checking", institutionName: a.institutionName || "", maskedIdentifier: a.maskedIdentifier || "", currency: a.currency || "USD", allowForPayroll: a.allowForPayroll ?? true, reconciliationEnabled: a.reconciliationEnabled ?? false, openingBalance: String(a.openingBalance || "0"), notes: a.notes || "", remittanceSourceId: (a as any).remittanceSourceId || "" });
    setDialogOpen(true);
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Select value={selectedCompany} onValueChange={setSelectedCompany}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All companies" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => quickSetupMutation.mutate()} disabled={quickSetupMutation.isPending}>
            <Zap className="mr-2 h-4 w-4" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup (8 accounts)"}
          </Button>
          <Dialog open={dialogOpen} onOpenChange={v => { setDialogOpen(v); if (!v) { setEditingAccount(null); setFormData(emptyForm); } }}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-funding-account"><Plus className="mr-2 h-4 w-4" />Add Account</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>{editingAccount ? "Edit Funding Account" : "Add Funding Account"}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Account Code</Label>
                    <Input placeholder="e.g. PC-001" value={formData.accountCode} onChange={e => setFormData(p => ({ ...p, accountCode: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Account Name *</Label>
                    <Input placeholder="e.g. Payroll Checking" value={formData.accountName} onChange={e => setFormData(p => ({ ...p, accountName: e.target.value }))} data-testid="input-fa-name" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Account Type</Label>
                    <Select value={formData.accountType} onValueChange={v => setFormData(p => ({ ...p, accountType: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(FA_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Company (optional)</Label>
                    <Select value={formData.companyId || "global"} onValueChange={v => setFormData(p => ({ ...p, companyId: v === "global" ? null : v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="global">Global (all companies)</SelectItem>
                        {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Institution Name</Label>
                    <Input placeholder="e.g. Chase Bank" value={formData.institutionName} onChange={e => setFormData(p => ({ ...p, institutionName: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Masked Identifier</Label>
                    <Input placeholder="e.g. ••••4321" value={formData.maskedIdentifier} onChange={e => setFormData(p => ({ ...p, maskedIdentifier: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Currency</Label>
                    <Select value={formData.currency} onValueChange={v => setFormData(p => ({ ...p, currency: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="CAD">CAD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Opening Balance</Label>
                    <Input type="number" value={formData.openingBalance} onChange={e => setFormData(p => ({ ...p, openingBalance: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Linked Bank / ACH Source <span className="text-muted-foreground text-xs">(for ACH payroll)</span></Label>
                  <Select value={formData.remittanceSourceId || "none"} onValueChange={v => setFormData(p => ({ ...p, remittanceSourceId: v === "none" ? null : v }))}>
                    <SelectTrigger data-testid="select-fa-remittance-source"><SelectValue placeholder="Select bank account" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not linked</SelectItem>
                      {remittanceSources.filter(rs => rs.type === "ach" || rs.type === "direct_deposit").map(rs => (
                        <SelectItem key={rs.id} value={rs.id}>
                          {rs.name} {rs.routingNumber ? `(routing: •••${rs.routingNumber.slice(-4)})` : ""}
                        </SelectItem>
                      ))}
                      {remittanceSources.filter(rs => rs.type === "ach" || rs.type === "direct_deposit").length === 0 && (
                        <SelectItem value="no-ach" disabled>No ACH bank accounts configured</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Link an ACH bank source to use this account for direct deposit payroll runs.</p>
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} rows={2} />
                </div>
                <div className="flex gap-6">
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox checked={formData.allowForPayroll} onCheckedChange={v => setFormData(p => ({ ...p, allowForPayroll: !!v }))} />
                    Allow for Payroll
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox checked={formData.reconciliationEnabled} onCheckedChange={v => setFormData(p => ({ ...p, reconciliationEnabled: !!v }))} />
                    Reconciliation Enabled
                  </label>
                </div>
                <Button className="w-full" disabled={saveMutation.isPending || !formData.accountName} onClick={() => saveMutation.mutate(formData)} data-testid="button-save-fa">
                  {saveMutation.isPending ? "Saving..." : editingAccount ? "Save Changes" : "Create Account"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {filteredAccounts.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <Banknote className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground mb-2">No funding accounts configured.</p>
          <p className="text-sm text-muted-foreground">Use Quick Setup to seed 8 standard accounts (Operating Checking, Payroll Checking, digital wallets, etc.).</p>
        </CardContent></Card>
      ) : (
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Account Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Institution</TableHead>
                <TableHead>Identifier</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Payroll</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAccounts.map(a => (
                <TableRow key={a.id} data-testid={`row-fa-${a.id}`}>
                  <TableCell><span className="font-mono text-xs">{a.accountCode || "—"}</span></TableCell>
                  <TableCell className="font-medium">{a.accountName}</TableCell>
                  <TableCell className="text-sm">{FA_TYPE_LABELS[a.accountType || ""] || a.accountType}</TableCell>
                  <TableCell className="text-sm">{a.institutionName || "—"}</TableCell>
                  <TableCell className="text-sm">{a.maskedIdentifier || "—"}</TableCell>
                  <TableCell className="text-sm">{a.currency || "USD"}</TableCell>
                  <TableCell>{a.allowForPayroll ? <Check className="h-4 w-4 text-green-600" /> : <span className="text-muted-foreground text-xs">No</span>}</TableCell>
                  <TableCell className="text-sm">{a.companyId ? (companies.find(c => c.id === a.companyId)?.name || "—") : <span className="text-muted-foreground italic text-xs">Global</span>}</TableCell>
                  <TableCell>
                    <button onClick={() => toggleMutation.mutate({ id: a.id, active: !a.active })} className="cursor-pointer">
                      <Badge variant={a.active ? "default" : "outline"} className="cursor-pointer text-xs">{a.active ? "Active" : "Inactive"}</Badge>
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(a)} data-testid={`button-edit-fa-${a.id}`}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(a.id)} data-testid={`button-delete-fa-${a.id}`}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}
    </div>
  );
}

// ── Payment Records Tab ───────────────────────────────────────────────────────
const PR_STATUS_COLORS: Record<string, string> = { pending: "outline", processing: "secondary", paid: "default", cleared: "default", failed: "destructive", voided: "outline", reversed: "destructive", partial: "secondary" };

function PaymentRecordsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<PayrollPaymentRecord | null>(null);
  const [filterCompany, setFilterCompany] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [ytdYear, setYtdYear] = useState(new Date().getFullYear());

  const emptyForm = {
    companyId: "" as string | null, payrollRunId: "" as string | null, payrollItemId: "" as string | null,
    workerId: "" as string | null, payDate: "", payPeriodStart: "", payPeriodEnd: "", taxYear: new Date().getFullYear(),
    grossPayAmount: "", taxableWagesAmount: "", employeeTaxWithheld: "", employerTaxAmount: "", netPayAmount: "",
    paymentMethodId: "" as string | null, fundingAccountId: "" as string | null, paymentMethodCode: "",
    status: "pending", paymentReference: "", checkNumber: "", memo: "",
  };
  const [formData, setFormData] = useState(emptyForm);

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: runs = [] } = useQuery<PayrollRun[]>({ queryKey: ["/api/payroll-runs"] });
  const { data: methods = [] } = useQuery<PayrollPaymentMethod[]>({ queryKey: ["/api/payroll-payment-methods"] });
  const { data: fundingAccts = [] } = useQuery<FundingAccount[]>({ queryKey: ["/api/funding-accounts"] });
  const { data: records = [], isLoading } = useQuery<PayrollPaymentRecord[]>({ queryKey: ["/api/payroll-payment-records"] });
  const { data: ytdSummary } = useQuery<any>({ queryKey: ["/api/payroll-payment-records/ytd-summary", ytdYear], queryFn: async () => { const res = await fetch(`/api/payroll-payment-records/ytd-summary?taxYear=${ytdYear}`); return res.json(); } });

  const filteredRecords = records.filter(r => {
    if (filterCompany !== "all" && r.companyId !== filterCompany) return false;
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    return true;
  });

  const fmt = (v: any) => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = { ...data, companyId: data.companyId || null, payrollRunId: data.payrollRunId || null, payrollItemId: data.payrollItemId || null, workerId: data.workerId || null, paymentMethodId: data.paymentMethodId || null, fundingAccountId: data.fundingAccountId || null, payDate: data.payDate || null, payPeriodStart: data.payPeriodStart || null, payPeriodEnd: data.payPeriodEnd || null };
      if (editingRecord) { const res = await apiRequest("PATCH", `/api/payroll-payment-records/${editingRecord.id}`, payload); return res.json(); }
      const res = await apiRequest("POST", "/api/payroll-payment-records", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-payment-records"] });
      toast({ title: editingRecord ? "Record updated" : "Payment record created" });
      setDialogOpen(false);
      setEditingRecord(null);
      setFormData(emptyForm);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/payroll-payment-records/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll-payment-records"] }); toast({ title: "Deleted" }); },
  });

  const voidMutation = useMutation({
    mutationFn: async (id: string) => { const res = await apiRequest("PATCH", `/api/payroll-payment-records/${id}`, { status: "voided", voidedAt: new Date().toISOString() }); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll-payment-records"] }); toast({ title: "Payment record voided" }); },
  });

  const openEdit = (r: PayrollPaymentRecord) => {
    setEditingRecord(r);
    setFormData({ companyId: r.companyId || "", payrollRunId: r.payrollRunId || "", payrollItemId: r.payrollItemId || "", workerId: r.workerId || "", payDate: r.payDate || "", payPeriodStart: r.payPeriodStart || "", payPeriodEnd: r.payPeriodEnd || "", taxYear: r.taxYear || new Date().getFullYear(), grossPayAmount: String(r.grossPayAmount || ""), taxableWagesAmount: String(r.taxableWagesAmount || ""), employeeTaxWithheld: String(r.employeeTaxWithheld || ""), employerTaxAmount: String(r.employerTaxAmount || ""), netPayAmount: String(r.netPayAmount || ""), paymentMethodId: r.paymentMethodId || "", fundingAccountId: r.fundingAccountId || "", paymentMethodCode: r.paymentMethodCode || "", status: r.status || "pending", paymentReference: r.paymentReference || "", checkNumber: r.checkNumber || "", memo: r.memo || "" });
    setDialogOpen(true);
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const workerName = (id: string | null | undefined) => { if (!id) return "—"; const w = workers.find(w => w.id === id); return w ? `${w.firstName} ${w.lastName}` : id; };
  const methodName = (id: string | null | undefined) => methods.find(m => m.id === id)?.name || id || "—";
  const accountName = (id: string | null | undefined) => fundingAccts.find(a => a.id === id)?.accountName || id || "—";

  return (
    <div className="space-y-4">
      {/* YTD Summary Cards */}
      {ytdSummary && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="h-4 w-4" />YTD by Payment Method ({ytdYear})</CardTitle></CardHeader>
            <CardContent>
              {ytdSummary.byMethod?.length > 0 ? (
                <Table>
                  <TableHeader><TableRow><TableHead>Method</TableHead><TableHead className="text-right">Count</TableHead><TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Net</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {ytdSummary.byMethod.map((m: any) => (
                      <TableRow key={m.code}><TableCell><Badge variant="outline" className="font-mono text-xs">{m.code}</Badge></TableCell><TableCell className="text-right">{m.count}</TableCell><TableCell className="text-right">${fmt(m.totalGross)}</TableCell><TableCell className="text-right font-medium">${fmt(m.totalNet)}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : <p className="text-sm text-muted-foreground">No payment data for {ytdYear}.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Banknote className="h-4 w-4" />YTD by Funding Account ({ytdYear})</CardTitle></CardHeader>
            <CardContent>
              {ytdSummary.byAccount?.length > 0 ? (
                <Table>
                  <TableHeader><TableRow><TableHead>Account</TableHead><TableHead className="text-right">Count</TableHead><TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Net</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {ytdSummary.byAccount.map((a: any) => (
                      <TableRow key={a.name}><TableCell className="text-sm">{accountName(a.name)}</TableCell><TableCell className="text-right">{a.count}</TableCell><TableCell className="text-right">${fmt(a.totalGross)}</TableCell><TableCell className="text-right font-medium">${fmt(a.totalNet)}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : <p className="text-sm text-muted-foreground">No payment data for {ytdYear}.</p>}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filter + Add bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Select value={filterCompany} onValueChange={setFilterCompany}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="All companies" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {["pending","processing","paid","cleared","failed","voided","reversed","partial"].map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(ytdYear)} onValueChange={v => setYtdYear(Number(v))}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[2024, 2025, 2026, 2027].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Dialog open={dialogOpen} onOpenChange={v => { setDialogOpen(v); if (!v) { setEditingRecord(null); setFormData(emptyForm); } }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-payment-record"><Plus className="mr-2 h-4 w-4" />Record Payment</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editingRecord ? "Edit Payment Record" : "Record Payroll Payment"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Company</Label>
                  <Select value={formData.companyId || "none"} onValueChange={v => setFormData(p => ({ ...p, companyId: v === "none" ? null : v, payrollRunId: null }))}>
                    <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                    <SelectContent><SelectItem value="none">None</SelectItem>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Payroll Run <span className="text-muted-foreground text-xs">(auto-fills dates)</span></Label>
                  <Select
                    value={formData.payrollRunId || "none"}
                    onValueChange={v => {
                      if (v === "none") {
                        setFormData(p => ({ ...p, payrollRunId: null }));
                      } else {
                        const run = runs.find(r => r.id === v);
                        setFormData(p => ({
                          ...p,
                          payrollRunId: v,
                          payDate: run?.payDate || p.payDate,
                          payPeriodStart: run?.periodStart || p.payPeriodStart,
                          payPeriodEnd: run?.periodEnd || p.payPeriodEnd,
                          companyId: run?.companyId || p.companyId,
                        }));
                      }
                    }}
                  >
                    <SelectTrigger data-testid="select-payment-record-run"><SelectValue placeholder="Select run (optional)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {runs
                        .filter(r => !formData.companyId || r.companyId === formData.companyId)
                        .map(r => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.periodStart} – {r.periodEnd}{r.payDate ? ` (pay ${r.payDate})` : ""}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Employee</Label>
                  <Select value={formData.workerId || "none"} onValueChange={v => setFormData(p => ({ ...p, workerId: v === "none" ? null : v }))}>
                    <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                    <SelectContent><SelectItem value="none">None</SelectItem>{workers.map(w => <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-2"><Label>Pay Date</Label><Input type="date" value={formData.payDate} onChange={e => setFormData(p => ({ ...p, payDate: e.target.value }))} /></div>
                <div className="space-y-2"><Label>Period Start</Label><Input type="date" value={formData.payPeriodStart} onChange={e => setFormData(p => ({ ...p, payPeriodStart: e.target.value }))} /></div>
                <div className="space-y-2"><Label>Period End</Label><Input type="date" value={formData.payPeriodEnd} onChange={e => setFormData(p => ({ ...p, payPeriodEnd: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <Select value={formData.paymentMethodId || "none"} onValueChange={v => { const m = methods.find(m => m.id === v); setFormData(p => ({ ...p, paymentMethodId: v === "none" ? null : v, paymentMethodCode: m?.code || "" })); }}>
                    <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                    <SelectContent><SelectItem value="none">None</SelectItem>{methods.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Funding Account</Label>
                  <Select value={formData.fundingAccountId || "none"} onValueChange={v => setFormData(p => ({ ...p, fundingAccountId: v === "none" ? null : v }))}>
                    <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                    <SelectContent><SelectItem value="none">None</SelectItem>{fundingAccts.filter(a => a.allowForPayroll && a.active).map(a => <SelectItem key={a.id} value={a.id}>{a.accountName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-2"><Label>Gross Pay</Label><Input type="number" value={formData.grossPayAmount} onChange={e => setFormData(p => ({ ...p, grossPayAmount: e.target.value }))} /></div>
                <div className="space-y-2"><Label>Tax Withheld</Label><Input type="number" value={formData.employeeTaxWithheld} onChange={e => setFormData(p => ({ ...p, employeeTaxWithheld: e.target.value }))} /></div>
                <div className="space-y-2"><Label>Net Pay</Label><Input type="number" value={formData.netPayAmount} onChange={e => setFormData(p => ({ ...p, netPayAmount: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={formData.status} onValueChange={v => setFormData(p => ({ ...p, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{["pending","processing","paid","cleared","failed","voided","reversed","partial"].map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Check Number</Label><Input value={formData.checkNumber} onChange={e => setFormData(p => ({ ...p, checkNumber: e.target.value }))} /></div>
                <div className="space-y-2"><Label>Reference</Label><Input value={formData.paymentReference} onChange={e => setFormData(p => ({ ...p, paymentReference: e.target.value }))} /></div>
              </div>
              <div className="space-y-2"><Label>Memo</Label><Textarea value={formData.memo} onChange={e => setFormData(p => ({ ...p, memo: e.target.value }))} rows={2} /></div>
              <Button className="w-full" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate(formData)} data-testid="button-save-pr">
                {saveMutation.isPending ? "Saving..." : editingRecord ? "Save Changes" : "Create Record"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {filteredRecords.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">No payment records found.</p>
          <p className="text-sm text-muted-foreground mt-1">Use "Record Payment" to log payroll disbursements separate from the payroll calculation.</p>
        </CardContent></Card>
      ) : (
        <Card><CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pay Date</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Funding Account</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Tax</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Check #</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.map(r => (
                  <TableRow key={r.id} data-testid={`row-pr-${r.id}`}>
                    <TableCell className="text-sm">{r.payDate || "—"}</TableCell>
                    <TableCell className="text-sm font-medium">{workerName(r.workerId)}</TableCell>
                    <TableCell className="text-sm">{methodName(r.paymentMethodId)}</TableCell>
                    <TableCell className="text-sm">{accountName(r.fundingAccountId)}</TableCell>
                    <TableCell className="text-right text-sm">${fmt(r.grossPayAmount)}</TableCell>
                    <TableCell className="text-right text-sm">${fmt(r.employeeTaxWithheld)}</TableCell>
                    <TableCell className="text-right text-sm font-medium">${fmt(r.netPayAmount)}</TableCell>
                    <TableCell>
                      <Badge variant={(PR_STATUS_COLORS[r.status || "pending"] || "outline") as any} className="text-xs">{r.status || "pending"}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{r.checkNumber || "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(r)} data-testid={`button-edit-pr-${r.id}`}><Pencil className="h-4 w-4" /></Button>
                        {r.status !== "voided" && (
                          <Button size="icon" variant="ghost" onClick={() => voidMutation.mutate(r.id)} title="Void" data-testid={`button-void-pr-${r.id}`}><AlertCircle className="h-4 w-4 text-amber-500" /></Button>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(r.id)} data-testid={`button-delete-pr-${r.id}`}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}

export default function PayrollPage() {
  const [activeTab, setActiveTab] = useTabParam();

  const tabs = [
    { value: "process", label: "Process Payroll" },
    { value: "tax-wizard", label: "Tax Wizard" },
    { value: "pay-stubs", label: "Pay Stubs" },
    { value: "pay-stub-transactions", label: "Pay Stub Transactions" },
    { value: "pay-periods", label: "Pay Periods" },
    { value: "pay-stub-amendments", label: "Pay Stub Amendments" },
    { value: "pay-period-schedules", label: "Pay Period Schedules" },
    { value: "pay-stub-accounts", label: "Pay Stub Accounts" },
    { value: "taxes-deductions", label: "Taxes & Deductions" },
    { value: "remittance-agencies", label: "Remittance Agencies" },
    { value: "remittance-sources", label: "Remittance Sources" },
    { value: "check-layout", label: "Check Layout" },
    { value: "payment-methods", label: "Payment Methods" },
    { value: "funding-accounts", label: "Funding Accounts" },
    { value: "payment-records", label: "Payment Records" },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <DollarSign className="h-6 w-6 text-blue-accent" />
        <h1 className="text-2xl font-bold" data-testid="text-payroll-title">Payroll</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto">
          <TabsList className="inline-flex w-max" data-testid="tabs-payroll">
            {tabs.map(t => (
              <TabsTrigger key={t.value} value={t.value} data-testid={`tab-${t.value}`}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="process"><ProcessPayrollTab /></TabsContent>
        <TabsContent value="tax-wizard"><TaxWizardTab /></TabsContent>
        <TabsContent value="pay-stubs"><PayStubsTab /></TabsContent>
        <TabsContent value="pay-stub-transactions"><PayStubTransactionsTab /></TabsContent>
        <TabsContent value="pay-periods"><PayPeriodsTab /></TabsContent>
        <TabsContent value="pay-stub-amendments"><PayStubAmendmentsTab /></TabsContent>
        <TabsContent value="pay-period-schedules"><PayPeriodSchedulesTab /></TabsContent>
        <TabsContent value="pay-stub-accounts"><PayStubAccountsTab /></TabsContent>
        <TabsContent value="taxes-deductions"><TaxesDeductionsTab /></TabsContent>
        <TabsContent value="remittance-agencies"><RemittanceAgenciesTab /></TabsContent>
        <TabsContent value="remittance-sources"><RemittanceSourcesTab /></TabsContent>
        <TabsContent value="check-layout"><CheckLayoutTab /></TabsContent>
        <TabsContent value="payment-methods"><PaymentMethodsTab /></TabsContent>
        <TabsContent value="funding-accounts"><FundingAccountsTab /></TabsContent>
        <TabsContent value="payment-records"><PaymentRecordsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
