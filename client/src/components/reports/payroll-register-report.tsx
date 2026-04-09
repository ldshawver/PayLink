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

interface PayrollRegisterReportProps {
  run: PayrollRun;
  items: PayrollItem[];
  company: Company | undefined;
  workers: Worker[];
}

export function PayrollRegisterReport({ run, items, company, workers }: PayrollRegisterReportProps) {
  const generatedBy = useReportUser();
  const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtH = (n: number) => n > 0 ? n.toFixed(2) : "—";
  const getWorker = (id: string) => workers.find(w => w.id === id);

  const period = run.periodStart && run.periodEnd ? `${run.periodStart} – ${run.periodEnd}` : "—";

  const sorted = [...items].sort((a, b) => {
    const wa = getWorker(a.workerId);
    const wb = getWorker(b.workerId);
    const na = wa ? `${wa.lastName} ${wa.firstName}` : a.workerId;
    const nb = wb ? `${wb.lastName} ${wb.firstName}` : b.workerId;
    return na.localeCompare(nb);
  });

  const rows = sorted.map(item => {
    const w = getWorker(item.workerId);
    const name = w ? `${w.lastName}, ${w.firstName}` : item.workerId;
    const reg = Number(item.regularHours || 0);
    const ot = Number(item.overtimeHours || 0);
    const dt = Number(item.doubleTimeHours || 0);
    const gross = Number(item.grossPay || 0);
    const deductions = Number(item.deductions || 0);
    const net = Number(item.netPay || 0);
    const method = (item.paymentMethod || "—").replace(/_/g, " ");
    const rate = w?.payType === "salary"
      ? `Salary`
      : w?.hourlyRate ? `$${Number(w.hourlyRate).toFixed(2)}/hr` : "—";

    return [
      name,
      rate,
      fmtH(reg),
      fmtH(ot),
      fmtH(dt),
      fmtH(reg + ot + dt),
      fmt(gross),
      deductions > 0 ? fmt(deductions) : "—",
      fmt(net),
      method,
      item.checkNumber ? String(item.checkNumber) : "—",
    ];
  });

  const totGross = items.reduce((s, i) => s + Number(i.grossPay || 0), 0);
  const totDed = items.reduce((s, i) => s + Number(i.deductions || 0), 0);
  const totNet = items.reduce((s, i) => s + Number(i.netPay || 0), 0);
  const totReg = items.reduce((s, i) => s + Number(i.regularHours || 0), 0);
  const totOt = items.reduce((s, i) => s + Number(i.overtimeHours || 0), 0);
  const totDt = items.reduce((s, i) => s + Number(i.doubleTimeHours || 0), 0);

  const footerRow = [
    "TOTALS", "",
    fmtH(totReg), fmtH(totOt), fmtH(totDt), fmtH(totReg + totOt + totDt),
    fmt(totGross), totDed > 0 ? fmt(totDed) : "—", fmt(totNet), "", "",
  ];

  const totalsItems = [
    { label: "Employees", value: String(items.length) },
    { label: "Regular Hours", value: fmtH(totReg) },
    { label: "Overtime Hours", value: fmtH(totOt) },
    { label: "Double-Time Hours", value: fmtH(totDt) },
    { label: "Gross Pay", value: fmt(totGross) },
    { label: "Deductions", value: fmt(totDed), negative: true },
    { label: "Net Pay", value: fmt(totNet), emphasis: true },
    { label: "Employer Taxes", value: fmt(Number(run.totalEmployerTaxes || 0)) },
    { label: "Total Funding Required", value: fmt(totNet + Number(run.totalEmployerTaxes || 0)), emphasis: true },
  ];

  const handleCSV = () => {
    const headers = ["Employee", "Rate", "Reg Hrs", "OT Hrs", "DT Hrs", "Total Hrs", "Gross Pay", "Deductions", "Net Pay", "Method", "Check #"];
    const csvRows = sorted.map(item => {
      const w = getWorker(item.workerId);
      const name = w ? `${w.firstName} ${w.lastName}` : item.workerId;
      const reg = Number(item.regularHours || 0);
      const ot = Number(item.overtimeHours || 0);
      const dt = Number(item.doubleTimeHours || 0);
      const rate = w?.payType === "salary" ? "Salary" : w?.hourlyRate ? Number(w.hourlyRate).toFixed(2) : "";
      return [
        name, rate, reg.toFixed(2), ot.toFixed(2), dt.toFixed(2), (reg + ot + dt).toFixed(2),
        Number(item.grossPay || 0).toFixed(2), Number(item.deductions || 0).toFixed(2), Number(item.netPay || 0).toFixed(2),
        item.paymentMethod || "", item.checkNumber ? String(item.checkNumber) : "",
      ];
    });
    exportReportCSV(`payroll-register-${run.periodStart}-${run.periodEnd}.csv`, headers, csvRows);
  };

  return (
    <ReportShell onExportCSV={handleCSV} csvLabel="Export Register CSV">
      <ReportHeader
        title="Payroll Register"
        subtitle={`${company?.name || "—"} · Pay Period ${period}`}
        company={company ? {
          name: company.name, legalName: company.legalName,
          address: company.address, city: company.city, state: company.state, zip: company.zip,
          phone: company.phone, ein: company.ein,
        } : undefined}
        metadata={[
          { label: "Pay Period", value: period },
          { label: "Pay Date", value: run.payDate || "—" },
          { label: "Status", value: (run.status || "draft") },
          { label: "Employees", value: String(items.length) },
        ]}
      />

      <ReportSection title="Employee Payroll Register">
        <ReportTable
          headers={["Employee", "Rate", "Reg Hrs", "OT Hrs", "DT Hrs", "Total Hrs", "Gross Pay", "Deductions", "Net Pay", "Method", "Check #"]}
          rows={rows}
          footerRows={[footerRow]}
          alignRight={[2, 3, 4, 5, 6, 7, 8, 10]}
        />
      </ReportSection>

      <ReportSection title="Run Totals">
        <ReportTotalsGrid items={totalsItems} columns={2} />
      </ReportSection>

      <ReportFooter generatedBy={generatedBy} note={`Payroll Register · Run ${run.id.slice(0, 8)}`} />
    </ReportShell>
  );
}

// ── PayrollRegisterReportDialog ────────────────────────────────────────────

interface PayrollRegisterReportDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultRunId?: string;
}

export function PayrollRegisterReportDialog({ open, onOpenChange, defaultRunId }: PayrollRegisterReportDialogProps) {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("all");
  const [selectedRunId, setSelectedRunId] = useState<string>(defaultRunId || "");

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"], enabled: open });
  const { data: allRuns = [], isLoading: loadingRuns } = useQuery<PayrollRun[]>({ queryKey: ["/api/payroll-runs"], enabled: open });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"], enabled: open });

  const filteredRuns = selectedCompanyId === "all" ? allRuns : allRuns.filter(r => r.companyId === selectedCompanyId);
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
  const isLoading = loadingRuns || loadingItems;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto" data-testid="dialog-payroll-register-report">
        <DialogHeader>
          <DialogTitle data-testid="text-payroll-register-report-title">Payroll Register</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-3 mb-4 report-no-print">
          <div className="flex flex-col gap-1 min-w-[160px]">
            <Label className="text-xs">Company</Label>
            <Select value={selectedCompanyId} onValueChange={v => { setSelectedCompanyId(v); setSelectedRunId(""); }}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-register-company">
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
              <SelectTrigger className="h-8 text-xs" data-testid="select-register-run">
                <SelectValue placeholder="Select a payroll run" />
              </SelectTrigger>
              <SelectContent>
                {filteredRuns.map(r => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.periodStart} – {r.periodEnd}{r.payDate ? ` (Pay: ${r.payDate})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : !run ? (
          <div className="py-10 text-center text-muted-foreground text-sm">
            Select a payroll run to generate the register.
          </div>
        ) : (
          <PayrollRegisterReport run={run} items={items} company={company} workers={workers} />
        )}
      </DialogContent>
    </Dialog>
  );
}
