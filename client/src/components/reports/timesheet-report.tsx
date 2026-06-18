import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { TimeEntry, Worker, Company } from "@shared/schema";

type ReportTimeEntry = TimeEntry & { regularHours?: string | number | null; overtimeHours?: string | number | null; doubleTimeHours?: string | number | null };
import {
  ReportShell, ReportHeader, ReportSection, ReportTable, ReportTotalsGrid, ReportFooter,
  exportReportCSV, useReportUser,
} from "@/components/report-template";

interface TimesheetReportProps {
  entries: ReportTimeEntry[];
  workers: Worker[];
  company: Company | undefined;
  dateFrom: string;
  dateTo: string;
}

export function TimesheetReport({ entries, workers, company, dateFrom, dateTo }: TimesheetReportProps) {
  const generatedBy = useReportUser();
  const getWorker = (id: string) => workers.find(w => w.id === id);
  const fmtH = (n: number) => n.toFixed(2) + " hrs";
  const fmt12 = (iso: string | Date | null | undefined) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }); } catch { return String(iso); }
  };
  const period = dateFrom && dateTo ? `${dateFrom} – ${dateTo}` : dateFrom || dateTo || "All dates";
  const fmtDate = (value: string | Date | null | undefined): string => value instanceof Date ? value.toISOString().slice(0, 10) : (value ? String(value) : "—");

  const sorted = [...entries].sort((a, b) => {
    const wa = getWorker(a.workerId);
    const wb = getWorker(b.workerId);
    const na = wa ? `${wa.lastName} ${wa.firstName}` : a.workerId;
    const nb = wb ? `${wb.lastName} ${wb.firstName}` : b.workerId;
    return na.localeCompare(nb) || String(a.date || "").localeCompare(String(b.date || ""));
  });

  const rows: string[][] = sorted.map(e => {
    const w = getWorker(e.workerId);
    const name = w ? `${w.lastName}, ${w.firstName}` : e.workerId;
    const reg = Number(e.regularHours || 0);
    const ot = Number(e.overtimeHours || 0);
    const dt = Number(e.doubleTimeHours || 0);
    const total = reg + ot + dt;
    return [
      name,
      fmtDate(e.date),
      fmt12(e.clockIn),
      fmt12(e.clockOut),
      fmtH(reg),
      ot > 0 ? fmtH(ot) : "—",
      dt > 0 ? fmtH(dt) : "—",
      fmtH(total),
      String(e.status || "—"),
    ];
  });

  const totReg = entries.reduce((s, e) => s + Number(e.regularHours || 0), 0);
  const totOt = entries.reduce((s, e) => s + Number(e.overtimeHours || 0), 0);
  const totDt = entries.reduce((s, e) => s + Number(e.doubleTimeHours || 0), 0);
  const totAll = totReg + totOt + totDt;

  const uniqueEmployees = new Set(entries.map(e => e.workerId)).size;
  const uniqueDays = new Set(entries.map(e => e.date)).size;

  const totalsItems = [
    { label: "Employees", value: String(uniqueEmployees) },
    { label: "Days Worked", value: String(uniqueDays) },
    { label: "Time Entries", value: String(entries.length) },
    { label: "Regular Hours", value: fmtH(totReg) },
    { label: "Overtime Hours", value: fmtH(totOt) },
    { label: "Double-Time Hours", value: fmtH(totDt) },
    { label: "Total Hours", value: fmtH(totAll), emphasis: true },
  ];

  const handleCSV = () => {
    const headers = ["Employee", "Date", "Clock In", "Clock Out", "Regular Hrs", "OT Hrs", "DT Hrs", "Total Hrs", "Status"];
    const csvRows: string[][] = sorted.map(e => {
      const w = getWorker(e.workerId);
      const name = w ? `${w.firstName} ${w.lastName}` : e.workerId;
      const reg = Number(e.regularHours || 0);
      const ot = Number(e.overtimeHours || 0);
      const dt = Number(e.doubleTimeHours || 0);
      return [name, fmtDate(e.date), fmt12(e.clockIn), fmt12(e.clockOut), reg.toFixed(2), ot.toFixed(2), dt.toFixed(2), (reg + ot + dt).toFixed(2), String(e.status || "")];
    });
    exportReportCSV(`timesheet-${dateFrom}-${dateTo}.csv`, headers, csvRows);
  };

  const printTitle = ["Timesheet Detail Report", company?.name || "All Companies", period].filter(Boolean).join(" · ");

  return (
    <ReportShell onExportCSV={handleCSV} csvLabel="Export Timesheet CSV" printTitle={printTitle}>
      <ReportHeader
        title="Timesheet Detail Report"
        subtitle={`${company?.name || "All companies"} · ${period}`}
        company={company ? {
          name: company.name, legalName: company.legalName,
          address: company.address, city: company.city, state: company.state, zip: company.zip,
          phone: company.phone,
        } : undefined}
        metadata={[
          { label: "Date Range", value: period },
          { label: "Employees", value: String(uniqueEmployees) },
          { label: "Total Entries", value: String(entries.length) },
          { label: "Total Hours", value: fmtH(totAll) },
        ]}
      />

      <ReportSection title="Time Entries">
        <ReportTable
          headers={["Employee", "Date", "Clock In", "Clock Out", "Reg Hrs", "OT Hrs", "DT Hrs", "Total", "Status"]}
          rows={rows}
          footerRows={[
            ["TOTALS", "", "", "", fmtH(totReg), fmtH(totOt), fmtH(totDt), fmtH(totAll), ""],
          ]}
          alignRight={[4, 5, 6, 7]}
        />
      </ReportSection>

      <ReportSection title="Summary Totals">
        <ReportTotalsGrid items={totalsItems} columns={2} />
      </ReportSection>

      <ReportFooter generatedBy={generatedBy} note="Timesheet Detail Report" />
    </ReportShell>
  );
}

// ── TimesheetReportDialog ──────────────────────────────────────────────────

interface TimesheetReportDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function TimesheetReportDialog({ open, onOpenChange }: TimesheetReportDialogProps) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(monthAgo);
  const [dateTo, setDateTo] = useState(today);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("all");

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"], enabled: open });
  const { data: allEntries = [], isLoading } = useQuery<TimeEntry[]>({ queryKey: ["/api/time-entries"], enabled: open });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"], enabled: open });

  const companyWorkerIds = selectedCompanyId === "all"
    ? new Set(workers.map(w => w.id))
    : new Set(workers.filter(w => w.companyId === selectedCompanyId).map(w => w.id));

  const filtered = allEntries.filter(e => {
    const inRange = (!dateFrom || (e.date || "") >= dateFrom) && (!dateTo || (e.date || "") <= dateTo);
    const inCompany = companyWorkerIds.has(e.workerId);
    return inRange && inCompany;
  });

  const company = selectedCompanyId !== "all" ? companies.find(c => c.id === selectedCompanyId) : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="dialog-timesheet-report">
        <DialogHeader>
          <DialogTitle data-testid="text-timesheet-report-title">Timesheet Detail Report</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-3 mb-4 report-no-print">
          <div className="flex flex-col gap-1 min-w-[160px]">
            <Label className="text-xs">Company</Label>
            <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-timesheet-company">
                <SelectValue placeholder="All companies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-xs w-36" data-testid="input-timesheet-from" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-xs w-36" data-testid="input-timesheet-to" />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <TimesheetReport
            entries={filtered}
            workers={workers}
            company={company}
            dateFrom={dateFrom}
            dateTo={dateTo}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
