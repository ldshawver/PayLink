import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { PayrollRun, PayrollItem, Company, Worker } from "@shared/schema";
import {
  ReportShell, ReportHeader, ReportSection, ReportTable, ReportTotalsGrid, ReportFooter,
  exportReportCSV, useReportUser,
} from "@/components/report-template";

// ── PayrollSummaryReport ───────────────────────────────────────────────────
// Pure display component. Takes pre-fetched data and renders the branded report.

interface PayrollSummaryReportProps {
  run: PayrollRun;
  items: PayrollItem[];
  company: Company | undefined;
  workers: Worker[];
}

export function PayrollSummaryReport({ run, items, company, workers }: PayrollSummaryReportProps) {
  const generatedBy = useReportUser();

  const getWorker = (id: string) => workers.find(w => w.id === id);
  const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtH = (n: number) => n.toFixed(2) + " hrs";

  const totalGross = Number(run.totalGross || 0) || items.reduce((s, i) => s + Number(i.grossPay || 0), 0);
  const totalDeductions = Number(run.totalDeductions || 0) || items.reduce((s, i) => s + Number(i.deductions || 0), 0);
  const totalNet = Number(run.totalNet || 0) || items.reduce((s, i) => s + Number(i.netPay || 0), 0);
  const totalEmployerTaxes = Number(run.totalEmployerTaxes || 0);
  const totalReimbursements = Number(run.totalReimbursements || 0);
  const totalFunding = totalNet + totalEmployerTaxes;
  const totalHours = items.reduce((s, i) => s + Number(i.regularHours || 0) + Number(i.overtimeHours || 0) + Number(i.doubleTimeHours || 0), 0);

  const byMethod: Record<string, { count: number; net: number }> = {};
  for (const item of items) {
    const m = (item.paymentMethod || "unspecified").replace(/_/g, " ");
    if (!byMethod[m]) byMethod[m] = { count: 0, net: 0 };
    byMethod[m].count++;
    byMethod[m].net += Number(item.netPay || 0);
  }

  const empRows = items.map(item => {
    const w = getWorker(item.workerId);
    const name = w ? `${w.lastName}, ${w.firstName}` : item.workerId;
    const reg = Number(item.regularHours || 0);
    const ot = Number(item.overtimeHours || 0);
    const dt = Number(item.doubleTimeHours || 0);
    const totalH = reg + ot + dt;
    const method = (item.paymentMethod || "—").replace(/_/g, " ");
    return [
      name,
      w?.payType === "salary" ? "Salary" : "Hourly",
      totalH > 0 ? fmtH(totalH) : "—",
      fmt(Number(item.grossPay || 0)),
      Number(item.deductions || 0) > 0 ? fmt(Number(item.deductions || 0)) : "—",
      fmt(Number(item.netPay || 0)),
      method,
    ];
  });

  const empFooter = [
    ["TOTALS", "", fmtH(totalHours), fmt(totalGross), fmt(totalDeductions), fmt(totalNet), ""],
  ];

  const methodRows = Object.entries(byMethod).map(([m, d]) => [
    m.charAt(0).toUpperCase() + m.slice(1),
    String(d.count),
    fmt(d.net),
  ]);

  const totalsLeft: { label: string; value: string; emphasis?: boolean; negative?: boolean }[] = [
    { label: "Employees", value: String(run.workerCount ?? items.length) },
    { label: "Total Hours", value: fmtH(totalHours) },
    { label: "Gross Pay", value: fmt(totalGross) },
    { label: "Employee Deductions", value: fmt(totalDeductions), negative: true },
    ...(totalReimbursements > 0 ? [{ label: "Reimbursements", value: fmt(totalReimbursements) }] : []),
    { label: "Net Pay (to Employees)", value: fmt(totalNet), emphasis: true },
    { label: "Employer Taxes", value: fmt(totalEmployerTaxes) },
    { label: "Total Funding Required", value: fmt(totalFunding), emphasis: true },
  ];

  const handleCSV = () => {
    const headers = ["Employee", "Pay Type", "Total Hours", "Gross Pay", "Deductions", "Net Pay", "Payment Method"];
    const rows = items.map(item => {
      const w = getWorker(item.workerId);
      const name = w ? `${w.firstName} ${w.lastName}` : item.workerId;
      const reg = Number(item.regularHours || 0);
      const ot = Number(item.overtimeHours || 0);
      const dt = Number(item.doubleTimeHours || 0);
      return [
        name, w?.payType === "salary" ? "Salary" : "Hourly",
        (reg + ot + dt).toFixed(2),
        Number(item.grossPay || 0).toFixed(2),
        Number(item.deductions || 0).toFixed(2),
        Number(item.netPay || 0).toFixed(2),
        item.paymentMethod || "",
      ];
    });
    exportReportCSV(`payroll-summary-${run.periodStart}-${run.periodEnd}.csv`, headers, rows);
  };

  const companyName = company?.name || "—";
  const period = run.periodStart && run.periodEnd ? `${run.periodStart} – ${run.periodEnd}` : "—";
  const payDate = run.payDate || "—";
  const runStatus = (run.status || "draft").charAt(0).toUpperCase() + (run.status || "draft").slice(1);

  const printTitle = ["Payroll Summary", companyName !== "—" ? companyName : null, period !== "—" ? period : null].filter(Boolean).join(" · ");

  return (
    <ReportShell onExportCSV={handleCSV} csvLabel="Export CSV" printTitle={printTitle}>
      <ReportHeader
        title="Payroll Summary"
        subtitle={`${companyName} · Pay Period ${period}`}
        company={company ? {
          name: company.name,
          legalName: company.legalName,
          address: company.address,
          city: company.city,
          state: company.state,
          zip: company.zip,
          phone: company.phone,
          ein: company.ein,
        } : undefined}
        metadata={[
          { label: "Pay Period", value: period },
          { label: "Pay Date", value: payDate },
          { label: "Status", value: runStatus },
          { label: "Pay Frequency", value: (company?.payFrequency || "—").replace(/_/g, " ") },
          { label: "Employees", value: String(run.workerCount ?? items.length) },
          { label: "Run ID", value: run.id.slice(0, 8) + "…" },
        ]}
      />

      <ReportSection title="Employee Detail">
        <ReportTable
          headers={["Employee", "Pay Type", "Hours", "Gross Pay", "Deductions", "Net Pay", "Method"]}
          rows={empRows}
          footerRows={empFooter}
          alignRight={[2, 3, 4, 5]}
        />
      </ReportSection>

      <div className="grid sm:grid-cols-2 gap-6 mt-2">
        {Object.keys(byMethod).length > 0 && (
          <ReportSection title="Payment Method Breakout">
            <ReportTable
              headers={["Method", "Employees", "Total Net"]}
              rows={methodRows}
              footerRows={[["TOTAL", String(items.length), fmt(totalNet)]]}
              alignRight={[2]}
            />
          </ReportSection>
        )}

        <ReportSection title="Totals">
          <ReportTotalsGrid items={totalsLeft} columns={2} />
        </ReportSection>
      </div>

      <ReportFooter generatedBy={generatedBy} note={`Run ID ${run.id.slice(0, 8)}`} />
    </ReportShell>
  );
}

// ── PayrollSummaryReportDialog ─────────────────────────────────────────────
// Dialog wrapper. Accepts an optional `defaultRunId`; if provided, pre-selects
// that run. Otherwise lets the user pick company + run.

interface PayrollSummaryReportDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultRunId?: string;
}

export function PayrollSummaryReportDialog({ open, onOpenChange, defaultRunId }: PayrollSummaryReportDialogProps) {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("all");
  const [selectedRunId, setSelectedRunId] = useState<string>(defaultRunId || "");

  const { data: companies = [], isLoading: loadingCo } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
    enabled: open,
  });
  const { data: allRuns = [], isLoading: loadingRuns } = useQuery<PayrollRun[]>({
    queryKey: ["/api/payroll-runs"],
    enabled: open,
  });
  const { data: workers = [] } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
    enabled: open,
  });

  const filteredRuns = selectedCompanyId === "all"
    ? allRuns
    : allRuns.filter(r => r.companyId === selectedCompanyId);

  const runId = selectedRunId || (defaultRunId ?? filteredRuns[0]?.id ?? "");
  const run = allRuns.find(r => r.id === runId);

  const { data: items = [], isLoading: loadingItems } = useQuery<PayrollItem[]>({
    queryKey: ["/api/payroll-runs", runId, "items"],
    queryFn: async () => {
      if (!runId) return [];
      const res = await fetch(`/api/payroll-runs/${runId}/items`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!runId,
  });

  const company = run ? companies.find(c => c.id === run.companyId) : undefined;
  const isLoading = loadingCo || loadingRuns || loadingItems;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="dialog-payroll-summary-report">
        <DialogHeader>
          <DialogTitle data-testid="text-payroll-summary-report-title">Payroll Summary Report</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-3 mb-4 report-no-print">
          <div className="flex flex-col gap-1 min-w-[160px]">
            <Label className="text-xs">Company</Label>
            <Select value={selectedCompanyId} onValueChange={v => { setSelectedCompanyId(v); setSelectedRunId(""); }}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-report-company">
                <SelectValue placeholder="All companies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 min-w-[240px]">
            <Label className="text-xs">Payroll Run</Label>
            <Select value={runId} onValueChange={setSelectedRunId}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-report-run">
                <SelectValue placeholder="Select a payroll run" />
              </SelectTrigger>
              <SelectContent>
                {filteredRuns.map(r => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.periodStart} – {r.periodEnd}
                    {r.payDate ? ` (Pay: ${r.payDate})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !run ? (
          <div className="py-10 text-center text-muted-foreground text-sm">
            Select a payroll run to generate the report.
          </div>
        ) : (
          <PayrollSummaryReport run={run} items={items} company={company} workers={workers} />
        )}
      </DialogContent>
    </Dialog>
  );
}
