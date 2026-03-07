import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import type {
  Worker, TimeEntry, PayrollRun, PayrollItem, Schedule, TimePunch,
  AccrualBalance, AccrualAccount, Qualification, Review,
  TaxDeduction, PayStubTransaction, Company
} from "@shared/schema";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FolderOpen, Users, ClipboardList, DollarSign, FileText, UserCheck,
  Clock, CalendarDays, AlertTriangle, Download, Printer, BarChart3,
  Shield, Star, Award, Receipt, Building, Calculator, ExternalLink
} from "lucide-react";

const OFFICIAL_FORM_URLS: Record<string, { url: string; source: string }> = {
  w2: { url: "https://www.irs.gov/pub/irs-pdf/fw2.pdf", source: "IRS" },
  "1099nec": { url: "https://www.irs.gov/pub/irs-pdf/f1099nec.pdf", source: "IRS" },
  "941": { url: "https://www.irs.gov/pub/irs-pdf/f941.pdf", source: "IRS" },
  "940": { url: "https://www.irs.gov/pub/irs-pdf/f940.pdf", source: "IRS" },
  "1096": { url: "https://www.irs.gov/pub/irs-pdf/f1096.pdf", source: "IRS" },
  de9: { url: "https://edd.ca.gov/siteassets/files/pdf_pub_ctr/de9.pdf", source: "CA EDD" },
  de9c: { url: "https://edd.ca.gov/siteassets/files/pdf_pub_ctr/de9c.pdf", source: "CA EDD" },
};

function useTabParam(): [string, (tab: string) => void] {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get("tab") || "saved";
  const setTab = (newTab: string) => {
    setLocation(`/reports?tab=${newTab}`);
  };
  return [tab, setTab];
}

interface ReportCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  onGenerate?: () => void;
  comingSoon?: boolean;
}

function ReportCard({ title, description, icon, onGenerate, comingSoon }: ReportCardProps) {
  return (
    <Card data-testid={`card-report-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader className="flex flex-row items-start gap-3 space-y-0">
        <div className="p-2 rounded-md bg-muted">{icon}</div>
        <div className="flex-1 min-w-0">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription className="mt-1">{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {comingSoon ? (
          <Button variant="outline" disabled data-testid={`button-generate-${title.toLowerCase().replace(/\s+/g, "-")}`}>
            <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
          </Button>
        ) : (
          <Button
            variant="default"
            onClick={onGenerate}
            data-testid={`button-generate-${title.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <FileText className="mr-2 h-4 w-4" />
            Generate
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function downloadCSV(headers: string[], rows: string[][], filename: string) {
  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function WhosInDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: timeEntries = [], isLoading: loadingEntries } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries"],
    enabled: open,
  });
  const { data: workers = [], isLoading: loadingWorkers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
    enabled: open,
  });

  const clockedIn = timeEntries.filter((e) => e.clockIn && !e.clockOut);
  const getWorkerName = (id: string) => {
    const w = workers.find((w) => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  };
  const isLoading = loadingEntries || loadingWorkers;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-whos-in">Who's In Summary</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : clockedIn.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-clocked-in">No employees currently clocked in.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Clock In Time</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clockedIn.map((entry) => (
                <TableRow key={entry.id} data-testid={`row-clocked-in-${entry.id}`}>
                  <TableCell>{getWorkerName(entry.workerId)}</TableCell>
                  <TableCell>{entry.clockIn ? new Date(entry.clockIn).toLocaleTimeString() : "—"}</TableCell>
                  <TableCell>{entry.date}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-sm text-muted-foreground" data-testid="text-clocked-in-count">
          {clockedIn.length} employee{clockedIn.length !== 1 ? "s" : ""} currently clocked in
        </p>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeInfoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: workers = [], isLoading } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
    enabled: open,
  });

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    const headers = ["Name", "Email", "Phone", "Type", "Job Title", "Department", "Pay Rate", "Status"];
    const rows = workers.map((w) => [
      `${w.firstName} ${w.lastName}`,
      w.email || "",
      w.phone || "",
      w.workerType,
      w.jobTitle || "",
      w.department || "",
      w.payRate,
      w.isActive ? "Active" : "Inactive",
    ]);
    downloadCSV(headers, rows, "employee_information.csv");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-employee-info">Employee Information</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-employee-info">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-employee-info">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Job Title</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Pay Rate</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workers.map((w) => (
                <TableRow key={w.id} data-testid={`row-worker-${w.id}`}>
                  <TableCell>{w.firstName} {w.lastName}</TableCell>
                  <TableCell>{w.email || "—"}</TableCell>
                  <TableCell>{w.phone || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{w.workerType}</Badge>
                  </TableCell>
                  <TableCell>{w.jobTitle || "—"}</TableCell>
                  <TableCell>{w.department || "—"}</TableCell>
                  <TableCell>${Number(w.payRate).toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant={w.isActive ? "default" : "secondary"}>
                      {w.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TimesheetSummaryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: timeEntries = [], isLoading: loadingEntries } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries"],
    enabled: open,
  });
  const { data: workers = [], isLoading: loadingWorkers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
    enabled: open,
  });

  const isLoading = loadingEntries || loadingWorkers;
  const getWorkerName = (id: string) => {
    const w = workers.find((w) => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  };

  const hoursByWorker = timeEntries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.workerId] = (acc[entry.workerId] || 0) + Number(entry.totalHours || 0);
    return acc;
  }, {});

  const rows = Object.entries(hoursByWorker).sort((a, b) => b[1] - a[1]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-timesheet-summary">Timesheet Summary</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-timesheet-data">No timesheet data available.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Total Hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(([workerId, hours]) => (
                <TableRow key={workerId} data-testid={`row-timesheet-${workerId}`}>
                  <TableCell>{getWorkerName(workerId)}</TableCell>
                  <TableCell className="text-right">{hours.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PayrollExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: payrollRuns = [], isLoading } = useQuery<PayrollRun[]>({
    queryKey: ["/api/payroll-runs"],
    enabled: open,
  });

  const handleExportCSV = () => {
    const headers = ["ID", "Period Start", "Period End", "Status", "Total Gross", "Total Net", "Total Hours", "OT Hours", "Worker Count", "Processed At"];
    const rows = payrollRuns.map((r) => [
      r.id,
      r.periodStart,
      r.periodEnd,
      r.status || "",
      r.totalGross || "0",
      r.totalNet || "0",
      r.totalHours || "0",
      r.totalOvertimeHours || "0",
      String(r.workerCount || 0),
      r.processedAt ? new Date(r.processedAt).toLocaleString() : "",
    ]);
    downloadCSV(headers, rows, "payroll_export.csv");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-payroll-export">Payroll Export</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-download-payroll-csv" disabled={payrollRuns.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Download CSV
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : payrollRuns.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-payroll-data">No payroll data available.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Workers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payrollRuns.map((r) => (
                <TableRow key={r.id} data-testid={`row-payroll-${r.id}`}>
                  <TableCell>{r.periodStart} — {r.periodEnd}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">${Number(r.totalGross || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-right">${Number(r.totalNet || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-right">{Number(r.totalHours || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-right">{r.workerCount || 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AuditTrailDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: timeEntries = [], isLoading: loadingEntries } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries"],
    enabled: open,
  });
  const { data: workers = [], isLoading: loadingWorkers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
    enabled: open,
  });

  const isLoading = loadingEntries || loadingWorkers;
  const getWorkerName = (id: string) => {
    const w = workers.find((w) => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  };

  const sorted = [...timeEntries].sort((a, b) => {
    const da = new Date(a.date).getTime();
    const db = new Date(b.date).getTime();
    return db - da;
  });

  const getAction = (entry: TimeEntry) => {
    if (entry.clockIn && !entry.clockOut) return "Clock In";
    if (entry.clockIn && entry.clockOut) return "Clock Out";
    if (Number(entry.breakMinutes || 0) > 0) return "Break";
    return "Clock In";
  };

  const getTime = (entry: TimeEntry) => {
    if (entry.clockOut) return new Date(entry.clockOut).toLocaleTimeString();
    if (entry.clockIn) return new Date(entry.clockIn).toLocaleTimeString();
    return "—";
  };

  const handlePrint = () => window.print();
  const handleExportCSV = () => {
    const headers = ["Employee", "Action", "Date", "Time"];
    const rows = sorted.map((e) => [
      getWorkerName(e.workerId),
      getAction(e),
      e.date,
      getTime(e),
    ]);
    downloadCSV(headers, rows, "audit_trail.csv");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-audit-trail">Audit Trail</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-audit-trail">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-audit-trail">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-audit-data">No audit trail data available.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((entry) => (
                <TableRow key={entry.id} data-testid={`row-audit-${entry.id}`}>
                  <TableCell>{getWorkerName(entry.workerId)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{getAction(entry)}</Badge>
                  </TableCell>
                  <TableCell>{entry.date}</TableCell>
                  <TableCell>{getTime(entry)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleSummaryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: schedules = [], isLoading: loadingSchedules } = useQuery<Schedule[]>({
    queryKey: ["/api/schedules"],
    enabled: open,
  });
  const { data: workers = [], isLoading: loadingWorkers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
    enabled: open,
  });

  const isLoading = loadingSchedules || loadingWorkers;
  const getWorkerName = (id: string) => {
    const w = workers.find((w) => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  };
  const getWorkerDept = (id: string) => {
    const w = workers.find((w) => w.id === id);
    return w?.department || "Unassigned";
  };

  const calcHours = (start: string, end: string) => {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const diff = (eh * 60 + em) - (sh * 60 + sm);
    return Math.max(0, diff / 60);
  };

  const sorted = [...schedules].sort((a, b) => getWorkerDept(a.workerId).localeCompare(getWorkerDept(b.workerId)));

  const handlePrint = () => window.print();
  const handleExportCSV = () => {
    const headers = ["Department", "Employee", "Date", "Start Time", "End Time", "Hours"];
    const rows = sorted.map((s) => [
      getWorkerDept(s.workerId),
      getWorkerName(s.workerId),
      s.date,
      s.startTime,
      s.endTime,
      calcHours(s.startTime, s.endTime).toFixed(2),
    ]);
    downloadCSV(headers, rows, "schedule_summary.csv");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-schedule-summary">Schedule Summary</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-schedule-summary">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-schedule-summary">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-schedule-data">No schedule data available.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Start Time</TableHead>
                <TableHead>End Time</TableHead>
                <TableHead className="text-right">Hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((s) => (
                <TableRow key={s.id} data-testid={`row-schedule-${s.id}`}>
                  <TableCell>{getWorkerDept(s.workerId)}</TableCell>
                  <TableCell>{getWorkerName(s.workerId)}</TableCell>
                  <TableCell>{s.date}</TableCell>
                  <TableCell>{s.startTime}</TableCell>
                  <TableCell>{s.endTime}</TableCell>
                  <TableCell className="text-right">{calcHours(s.startTime, s.endTime).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TimesheetDetailDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: timeEntries = [], isLoading: loadingEntries } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries"],
    enabled: open,
  });
  const { data: workers = [], isLoading: loadingWorkers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
    enabled: open,
  });

  const isLoading = loadingEntries || loadingWorkers;
  const getWorkerName = (id: string) => {
    const w = workers.find((w) => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  };

  const sorted = [...timeEntries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const handlePrint = () => window.print();
  const handleExportCSV = () => {
    const headers = ["Employee", "Date", "Clock In", "Clock Out", "Break Mins", "Total Hours", "OT Hours", "Status"];
    const rows = sorted.map((e) => [
      getWorkerName(e.workerId),
      e.date,
      e.clockIn ? new Date(e.clockIn).toLocaleTimeString() : "",
      e.clockOut ? new Date(e.clockOut).toLocaleTimeString() : "",
      String(e.breakMinutes || 0),
      Number(e.totalHours || 0).toFixed(2),
      Number(e.overtimeHours || 0).toFixed(2),
      e.status || "",
    ]);
    downloadCSV(headers, rows, "timesheet_detail.csv");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-timesheet-detail">Timesheet Detail</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-timesheet-detail">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-timesheet-detail">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-timesheet-detail-data">No timesheet detail data available.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Clock In</TableHead>
                <TableHead>Clock Out</TableHead>
                <TableHead className="text-right">Break Mins</TableHead>
                <TableHead className="text-right">Total Hours</TableHead>
                <TableHead className="text-right">OT Hours</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((e) => (
                <TableRow key={e.id} data-testid={`row-timesheet-detail-${e.id}`}>
                  <TableCell>{getWorkerName(e.workerId)}</TableCell>
                  <TableCell>{e.date}</TableCell>
                  <TableCell>{e.clockIn ? new Date(e.clockIn).toLocaleTimeString() : "—"}</TableCell>
                  <TableCell>{e.clockOut ? new Date(e.clockOut).toLocaleTimeString() : "—"}</TableCell>
                  <TableCell className="text-right">{e.breakMinutes || 0}</TableCell>
                  <TableCell className="text-right">{Number(e.totalHours || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-right">{Number(e.overtimeHours || 0).toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{e.status || "pending"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PunchSummaryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: punches = [], isLoading: loadingPunches } = useQuery<TimePunch[]>({
    queryKey: ["/api/time-punches"],
    enabled: open,
  });
  const { data: workers = [], isLoading: loadingWorkers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
    enabled: open,
  });

  const isLoading = loadingPunches || loadingWorkers;
  const getWorkerName = (id: string) => {
    const w = workers.find((w) => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  };

  const sorted = [...punches].sort((a, b) => new Date(b.punchTime).getTime() - new Date(a.punchTime).getTime());

  const formatPunchType = (type: string) => {
    return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const handlePrint = () => window.print();
  const handleExportCSV = () => {
    const headers = ["Employee", "Punch Type", "Timestamp", "Note"];
    const rows = sorted.map((p) => [
      getWorkerName(p.workerId),
      formatPunchType(p.punchType),
      new Date(p.punchTime).toLocaleString(),
      p.note || "",
    ]);
    downloadCSV(headers, rows, "punch_summary.csv");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-punch-summary">Punch Summary</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-punch-summary">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-punch-summary">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-punch-data">No punch data available.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Punch Type</TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((p) => (
                <TableRow key={p.id} data-testid={`row-punch-${p.id}`}>
                  <TableCell>{getWorkerName(p.workerId)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{formatPunchType(p.punchType)}</Badge>
                  </TableCell>
                  <TableCell>{new Date(p.punchTime).toLocaleString()}</TableCell>
                  <TableCell>{p.note || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AccrualBalanceSummaryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: balances = [], isLoading: loadingBalances } = useQuery<AccrualBalance[]>({
    queryKey: ["/api/accrual-balances"],
    enabled: open,
  });
  const { data: accounts = [], isLoading: loadingAccounts } = useQuery<AccrualAccount[]>({
    queryKey: ["/api/accrual-accounts"],
    enabled: open,
  });
  const { data: workers = [], isLoading: loadingWorkers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
    enabled: open,
  });

  const isLoading = loadingBalances || loadingAccounts || loadingWorkers;
  const getWorkerName = (id: string) => {
    const w = workers.find((w) => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  };
  const getAccountName = (id: string) => {
    const a = accounts.find((a) => a.id === id);
    return a?.name || id;
  };
  const getAccountType = (id: string) => {
    const a = accounts.find((a) => a.id === id);
    return a?.type || "—";
  };

  const handlePrint = () => window.print();
  const handleExportCSV = () => {
    const headers = ["Employee", "Accrual Type", "Account", "Balance", "Used", "Available"];
    const rows = balances.map((b) => {
      const bal = Number(b.balance || 0);
      const used = Number(b.usedHours || 0);
      return [
        getWorkerName(b.workerId),
        getAccountType(b.accrualAccountId),
        getAccountName(b.accrualAccountId),
        bal.toFixed(2),
        used.toFixed(2),
        (bal - used).toFixed(2),
      ];
    });
    downloadCSV(headers, rows, "accrual_balance_summary.csv");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-accrual-balance">Accrual Balance Summary</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-accrual-balance">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-accrual-balance">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : balances.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-accrual-data">No accrual balance data available.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Accrual Type</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="text-right">Available</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances.map((b) => {
                const bal = Number(b.balance || 0);
                const used = Number(b.usedHours || 0);
                return (
                  <TableRow key={b.id} data-testid={`row-accrual-${b.id}`}>
                    <TableCell>{getWorkerName(b.workerId)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{getAccountType(b.accrualAccountId)}</Badge>
                    </TableCell>
                    <TableCell>{getAccountName(b.accrualAccountId)}</TableCell>
                    <TableCell className="text-right">{bal.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{used.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{(bal - used).toFixed(2)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExceptionSummaryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: timeEntries = [], isLoading: loadingEntries } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries"],
    enabled: open,
  });
  const { data: workers = [], isLoading: loadingWorkers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
    enabled: open,
  });

  const isLoading = loadingEntries || loadingWorkers;
  const getWorkerName = (id: string) => {
    const w = workers.find((w) => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  };

  const exceptions = timeEntries.filter((e) => {
    const ot = Number(e.overtimeHours || 0);
    const hasOT = ot > 0;
    const hasStatusIssue = e.status === "rejected";
    const missingClockOut = e.clockIn && !e.clockOut;
    return hasOT || hasStatusIssue || missingClockOut;
  });

  const getIssueType = (e: TimeEntry) => {
    const issues: string[] = [];
    if (Number(e.overtimeHours || 0) > 0) issues.push("Overtime");
    if (e.status === "rejected") issues.push("Rejected");
    if (e.clockIn && !e.clockOut) issues.push("Missing Clock Out");
    return issues.join(", ");
  };

  const sorted = [...exceptions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const handlePrint = () => window.print();
  const handleExportCSV = () => {
    const headers = ["Employee", "Date", "Issue Type", "Total Hours", "OT Hours", "Status"];
    const rows = sorted.map((e) => [
      getWorkerName(e.workerId),
      e.date,
      getIssueType(e),
      Number(e.totalHours || 0).toFixed(2),
      Number(e.overtimeHours || 0).toFixed(2),
      e.status || "",
    ]);
    downloadCSV(headers, rows, "exception_summary.csv");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-exception-summary">Exception Summary</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-exception-summary">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-exception-summary">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-exception-data">No exceptions found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Issue Type</TableHead>
                <TableHead className="text-right">Total Hours</TableHead>
                <TableHead className="text-right">OT Hours</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((e) => (
                <TableRow key={e.id} data-testid={`row-exception-${e.id}`}>
                  <TableCell>{getWorkerName(e.workerId)}</TableCell>
                  <TableCell>{e.date}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{getIssueType(e)}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{Number(e.totalHours || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-right">{Number(e.overtimeHours || 0).toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant={e.status === "rejected" ? "destructive" : "secondary"}>{e.status || "pending"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PaystubSummaryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: transactions = [], isLoading: loadingTransactions } = useQuery<PayStubTransaction[]>({
    queryKey: ["/api/pay-stub-transactions"],
    enabled: open,
  });
  const { data: workers = [], isLoading: loadingWorkers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
    enabled: open,
  });

  const isLoading = loadingTransactions || loadingWorkers;
  const getWorkerName = (id: string) => {
    const w = workers.find((w) => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  };

  const sorted = [...transactions].sort((a, b) => {
    const da = a.transactionDate ? new Date(a.transactionDate).getTime() : 0;
    const db = b.transactionDate ? new Date(b.transactionDate).getTime() : 0;
    return db - da;
  });

  const handlePrint = () => window.print();
  const handleExportCSV = () => {
    const headers = ["Employee", "Date", "Amount", "Payment Method", "Status", "Check Number", "Reference"];
    const rows = sorted.map((t) => [
      getWorkerName(t.workerId),
      t.transactionDate || "",
      Number(t.amount || 0).toFixed(2),
      t.paymentMethod || "",
      t.status || "",
      t.checkNumber || "",
      t.reference || "",
    ]);
    downloadCSV(headers, rows, "paystub_summary.csv");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-paystub-summary">Paystub Summary</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-paystub-summary">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-paystub-summary">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-paystub-data">No paystub data available.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Payment Method</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Check #</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((t) => (
                <TableRow key={t.id} data-testid={`row-paystub-${t.id}`}>
                  <TableCell>{getWorkerName(t.workerId)}</TableCell>
                  <TableCell>{t.transactionDate || "—"}</TableCell>
                  <TableCell className="text-right">${Number(t.amount || 0).toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t.paymentMethod || "—"}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t.status || "pending"}</Badge>
                  </TableCell>
                  <TableCell>{t.checkNumber || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GeneralLedgerSummaryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: payrollRuns = [], isLoading } = useQuery<PayrollRun[]>({
    queryKey: ["/api/payroll-runs"],
    enabled: open,
  });

  const sorted = [...payrollRuns].sort((a, b) => new Date(b.periodStart).getTime() - new Date(a.periodStart).getTime());

  const handlePrint = () => window.print();
  const handleExportCSV = () => {
    const headers = ["Period Start", "Period End", "Status", "Total Gross", "Total Net", "Total Deductions", "Worker Count"];
    const rows = sorted.map((r) => {
      const gross = Number(r.totalGross || 0);
      const net = Number(r.totalNet || 0);
      return [
        r.periodStart,
        r.periodEnd,
        r.status || "",
        gross.toFixed(2),
        net.toFixed(2),
        (gross - net).toFixed(2),
        String(r.workerCount || 0),
      ];
    });
    downloadCSV(headers, rows, "general_ledger_summary.csv");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-general-ledger">General Ledger Summary</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-general-ledger">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-general-ledger">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-ledger-data">No general ledger data available.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total Gross</TableHead>
                <TableHead className="text-right">Total Net</TableHead>
                <TableHead className="text-right">Total Deductions</TableHead>
                <TableHead className="text-right">Workers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => {
                const gross = Number(r.totalGross || 0);
                const net = Number(r.totalNet || 0);
                return (
                  <TableRow key={r.id} data-testid={`row-ledger-${r.id}`}>
                    <TableCell>{r.periodStart} — {r.periodEnd}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">${gross.toFixed(2)}</TableCell>
                    <TableCell className="text-right">${net.toFixed(2)}</TableCell>
                    <TableCell className="text-right">${(gross - net).toFixed(2)}</TableCell>
                    <TableCell className="text-right">{r.workerCount || 0}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TaxSummaryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: deductions = [], isLoading: loadingDeductions } = useQuery<TaxDeduction[]>({
    queryKey: ["/api/taxes-deductions"],
    enabled: open,
  });
  const { data: workers = [], isLoading: loadingWorkers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
    enabled: open,
  });

  const isLoading = loadingDeductions || loadingWorkers;
  const activeWorkers = workers.filter((w) => w.isActive);

  const handlePrint = () => window.print();
  const handleExportCSV = () => {
    const headers = ["Deduction Name", "Type", "Calculation Type", "Rate", "Employer Paid", "Est. Amount Per Worker", "Status"];
    const rows = deductions.map((d) => {
      const rate = Number(d.rate || 0);
      const avgPay = activeWorkers.length > 0
        ? activeWorkers.reduce((sum, w) => sum + Number(w.payRate || 0), 0) / activeWorkers.length
        : 0;
      const estAmount = d.calculationType === "percentage" ? (avgPay * rate / 100) : rate;
      return [
        d.name,
        d.type,
        d.calculationType || "",
        String(rate),
        d.isEmployerPaid ? "Yes" : "No",
        estAmount.toFixed(2),
        d.isActive ? "Active" : "Inactive",
      ];
    });
    downloadCSV(headers, rows, "tax_summary.csv");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-tax-summary">Tax Summary</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-tax-summary">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-tax-summary">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : deductions.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-tax-data">No tax/deduction data available.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deduction Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Calculation</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Employer Paid</TableHead>
                <TableHead className="text-right">Est. Amount/Worker</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deductions.map((d) => {
                const rate = Number(d.rate || 0);
                const avgPay = activeWorkers.length > 0
                  ? activeWorkers.reduce((sum, w) => sum + Number(w.payRate || 0), 0) / activeWorkers.length
                  : 0;
                const estAmount = d.calculationType === "percentage" ? (avgPay * rate / 100) : rate;
                return (
                  <TableRow key={d.id} data-testid={`row-tax-${d.id}`}>
                    <TableCell>{d.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{d.type}</Badge>
                    </TableCell>
                    <TableCell>{d.calculationType || "—"}</TableCell>
                    <TableCell className="text-right">
                      {d.calculationType === "percentage" ? `${rate}%` : `$${rate.toFixed(2)}`}
                    </TableCell>
                    <TableCell>{d.isEmployerPaid ? "Yes" : "No"}</TableCell>
                    <TableCell className="text-right">${estAmount.toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={d.isActive ? "default" : "secondary"}>
                        {d.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QualificationSummaryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: qualifications = [], isLoading: loadingQualifications } = useQuery<Qualification[]>({
    queryKey: ["/api/qualifications"],
    enabled: open,
  });
  const { data: workers = [], isLoading: loadingWorkers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
    enabled: open,
  });

  const isLoading = loadingQualifications || loadingWorkers;
  const getWorkerName = (id: string | null) => {
    if (!id) return "Unassigned";
    const w = workers.find((w) => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  };

  const getExpiryStatus = (date: string | null) => {
    if (!date) return "No Expiry";
    const expiry = new Date(date);
    const now = new Date();
    if (expiry < now) return "Expired";
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    if (expiry < thirtyDays) return "Expiring Soon";
    return "Valid";
  };

  const handlePrint = () => window.print();
  const handleExportCSV = () => {
    const headers = ["Employee", "Type", "Skill/Name", "Level", "Expiry Date", "Status"];
    const rows = qualifications.map((q) => [
      getWorkerName(q.workerId),
      q.type,
      q.name,
      q.level || "",
      q.expirationDate || "",
      q.isActive ? getExpiryStatus(q.expirationDate) : "Inactive",
    ]);
    downloadCSV(headers, rows, "qualification_summary.csv");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-qualification-summary">Qualification Summary</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-qualification-summary">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-qualification-summary">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : qualifications.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-qualification-data">No qualification data available.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Skill/Name</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Expiry Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {qualifications.map((q) => {
                const status = q.isActive ? getExpiryStatus(q.expirationDate) : "Inactive";
                return (
                  <TableRow key={q.id} data-testid={`row-qualification-${q.id}`}>
                    <TableCell>{getWorkerName(q.workerId)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{q.type}</Badge>
                    </TableCell>
                    <TableCell>{q.name}</TableCell>
                    <TableCell>{q.level || "—"}</TableCell>
                    <TableCell>{q.expirationDate || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={status === "Expired" ? "destructive" : status === "Expiring Soon" ? "default" : "secondary"}>
                        {status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReviewSummaryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: reviews = [], isLoading: loadingReviews } = useQuery<Review[]>({
    queryKey: ["/api/reviews"],
    enabled: open,
  });
  const { data: workers = [], isLoading: loadingWorkers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
    enabled: open,
  });

  const isLoading = loadingReviews || loadingWorkers;
  const getWorkerName = (id: string) => {
    const w = workers.find((w) => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  };

  const sorted = [...reviews].sort((a, b) => new Date(b.reviewDate).getTime() - new Date(a.reviewDate).getTime());

  const handlePrint = () => window.print();
  const handleExportCSV = () => {
    const headers = ["Employee", "Review Date", "Reviewer", "Rating", "Status", "Notes"];
    const rows = sorted.map((r) => [
      getWorkerName(r.workerId),
      r.reviewDate,
      r.reviewerName || "",
      r.rating != null ? String(r.rating) : "",
      r.status || "",
      r.notes || "",
    ]);
    downloadCSV(headers, rows, "review_summary.csv");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-review-summary">Review Summary</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-review-summary">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-review-summary">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-review-data">No review data available.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Review Date</TableHead>
                <TableHead>Reviewer</TableHead>
                <TableHead className="text-right">Rating</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <TableRow key={r.id} data-testid={`row-review-${r.id}`}>
                  <TableCell>{getWorkerName(r.workerId)}</TableCell>
                  <TableCell>{r.reviewDate}</TableCell>
                  <TableCell>{r.reviewerName || "—"}</TableCell>
                  <TableCell className="text-right">{r.rating != null ? `${r.rating}/5` : "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{r.status || "pending"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

const QUARTERS = [
  { value: "Q1", label: "Q1 (Jan-Mar)", months: [0, 1, 2] },
  { value: "Q2", label: "Q2 (Apr-Jun)", months: [3, 4, 5] },
  { value: "Q3", label: "Q3 (Jul-Sep)", months: [6, 7, 8] },
  { value: "Q4", label: "Q4 (Oct-Dec)", months: [9, 10, 11] },
];

function TaxReportFilters({ year, setYear, quarter, setQuarter, companyId, setCompanyId, companies, showQuarter }: {
  year: string; setYear: (v: string) => void;
  quarter: string; setQuarter: (v: string) => void;
  companyId: string; setCompanyId: (v: string) => void;
  companies: Company[]; showQuarter?: boolean;
}) {
  const currentYear = new Date().getFullYear();
  return (
    <div className="flex items-end gap-3 flex-wrap">
      <div className="space-y-1">
        <Label className="text-xs">Year</Label>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="w-[100px]" data-testid="select-report-year"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[currentYear, currentYear - 1, currentYear - 2].map(y => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {showQuarter && (
        <div className="space-y-1">
          <Label className="text-xs">Quarter</Label>
          <Select value={quarter} onValueChange={setQuarter}>
            <SelectTrigger className="w-[140px]" data-testid="select-report-quarter"><SelectValue /></SelectTrigger>
            <SelectContent>
              {QUARTERS.map(q => <SelectItem key={q.value} value={q.value}>{q.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-1">
        <Label className="text-xs">Company</Label>
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger className="w-[200px]" data-testid="select-report-company"><SelectValue placeholder="All" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function usePayrollData(open: boolean) {
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"], enabled: open });
  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"], enabled: open });
  const { data: payrollRuns = [] } = useQuery<PayrollRun[]>({ queryKey: ["/api/payroll-runs"], enabled: open });
  const { data: deductions = [] } = useQuery<TaxDeduction[]>({ queryKey: ["/api/taxes-deductions"], enabled: open });
  return { workers, companies, payrollRuns, deductions };
}

function filterRunsByPeriod(runs: PayrollRun[], year: string, quarter?: string) {
  return runs.filter(r => {
    if (r.status === "draft") return false;
    const start = new Date(r.periodStart);
    if (start.getFullYear() !== Number(year)) return false;
    if (quarter) {
      const q = QUARTERS.find(q => q.value === quarter);
      if (q && !q.months.includes(start.getMonth())) return false;
    }
    return true;
  });
}

function W2ReportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [companyId, setCompanyId] = useState("all");
  const { workers, companies, payrollRuns, deductions } = usePayrollData(open);

  const filteredRuns = filterRunsByPeriod(payrollRuns, year).filter(r => companyId === "all" || r.companyId === companyId);
  const employees = workers.filter(w => w.workerType === "employee" && w.isActive);
  const companyEmployees = companyId === "all" ? employees : employees.filter(w => w.companyId === companyId);

  const getWorkerTotals = (worker: typeof employees[0]) => {
    const workerRuns = filteredRuns.filter(r => r.companyId === worker.companyId);
    const grossPay = Number(worker.payRate || 0) * 2080;
    const fedTax = grossPay * 0.22;
    const ssTax = Math.min(grossPay, 168600) * 0.062;
    const medicareTax = grossPay * 0.0145;
    const stateTax = grossPay * 0.05;
    return { grossPay, fedTax, ssTax, medicareTax, stateTax, ssWages: Math.min(grossPay, 168600), medicareWages: grossPay };
  };

  const handlePrint = () => window.print();
  const handleExportCSV = () => {
    const headers = ["Employee", "SSN", "Gross Wages", "Federal Tax", "SS Tax", "Medicare Tax", "State Tax", "SS Wages", "Medicare Wages"];
    const rows = companyEmployees.map(w => {
      const t = getWorkerTotals(w);
      return [
        `${w.firstName} ${w.lastName}`, w.ssn || "N/A",
        t.grossPay.toFixed(2), t.fedTax.toFixed(2), t.ssTax.toFixed(2),
        t.medicareTax.toFixed(2), t.stateTax.toFixed(2), t.ssWages.toFixed(2), t.medicareWages.toFixed(2),
      ];
    });
    downloadCSV(headers, rows, `w2_report_${year}.csv`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-w2">W-2 Annual Wage & Tax Statement — {year}</DialogTitle>
          <a href={OFFICIAL_FORM_URLS.w2.url} target="_blank" rel="noopener noreferrer" data-testid="link-official-w2" className="text-xs text-primary hover:underline flex items-center gap-1 mt-1">
            <ExternalLink className="h-3 w-3" />Download Official IRS Form W-2 (PDF)
          </a>
        </DialogHeader>
        <TaxReportFilters year={year} setYear={setYear} quarter="" setQuarter={() => {}} companyId={companyId} setCompanyId={setCompanyId} companies={companies} />
        <div className="flex items-center gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-w2"><Printer className="mr-2 h-4 w-4" />Print</Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-w2"><Download className="mr-2 h-4 w-4" />Export CSV</Button>
        </div>
        {companyEmployees.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-w2">No W-2 eligible employees found for {year}.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead><TableHead>SSN</TableHead>
                <TableHead className="text-right">Gross Wages</TableHead><TableHead className="text-right">Federal Tax</TableHead>
                <TableHead className="text-right">SS Tax</TableHead><TableHead className="text-right">Medicare Tax</TableHead>
                <TableHead className="text-right">State Tax</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companyEmployees.map(w => {
                const t = getWorkerTotals(w);
                return (
                  <TableRow key={w.id} data-testid={`row-w2-${w.id}`}>
                    <TableCell className="font-medium">{w.firstName} {w.lastName}</TableCell>
                    <TableCell>{w.ssn ? `***-**-${w.ssn.slice(-4)}` : "N/A"}</TableCell>
                    <TableCell className="text-right">${t.grossPay.toFixed(2)}</TableCell>
                    <TableCell className="text-right">${t.fedTax.toFixed(2)}</TableCell>
                    <TableCell className="text-right">${t.ssTax.toFixed(2)}</TableCell>
                    <TableCell className="text-right">${t.medicareTax.toFixed(2)}</TableCell>
                    <TableCell className="text-right">${t.stateTax.toFixed(2)}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="font-bold border-t-2">
                <TableCell colSpan={2}>Totals</TableCell>
                <TableCell className="text-right">${companyEmployees.reduce((s, w) => s + getWorkerTotals(w).grossPay, 0).toFixed(2)}</TableCell>
                <TableCell className="text-right">${companyEmployees.reduce((s, w) => s + getWorkerTotals(w).fedTax, 0).toFixed(2)}</TableCell>
                <TableCell className="text-right">${companyEmployees.reduce((s, w) => s + getWorkerTotals(w).ssTax, 0).toFixed(2)}</TableCell>
                <TableCell className="text-right">${companyEmployees.reduce((s, w) => s + getWorkerTotals(w).medicareTax, 0).toFixed(2)}</TableCell>
                <TableCell className="text-right">${companyEmployees.reduce((s, w) => s + getWorkerTotals(w).stateTax, 0).toFixed(2)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Form1099NECDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState("Q1");
  const [companyId, setCompanyId] = useState("all");
  const [reportType, setReportType] = useState<"annual" | "quarterly">("annual");
  const { workers, companies, payrollRuns } = usePayrollData(open);

  const contractors = workers.filter(w => w.workerType === "contractor" && w.isActive);
  const filtered = companyId === "all" ? contractors : contractors.filter(w => w.companyId === companyId);
  const filteredRuns = reportType === "quarterly"
    ? filterRunsByPeriod(payrollRuns, year, quarter)
    : filterRunsByPeriod(payrollRuns, year);

  const getContractorPay = (worker: typeof contractors[0]) => {
    return Number(worker.payRate || 0) * (reportType === "quarterly" ? 520 : 2080);
  };

  const handleExportCSV = () => {
    const headers = ["Contractor", "TIN/SSN", "Non-Employee Compensation", "Period"];
    const rows = filtered.map(w => [
      `${w.firstName} ${w.lastName}`, w.ssn || "N/A",
      getContractorPay(w).toFixed(2), reportType === "quarterly" ? quarter : year,
    ]);
    downloadCSV(headers, rows, `1099_nec_${year}${reportType === "quarterly" ? `_${quarter}` : ""}.csv`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-1099">Form 1099-NEC — Non-Employee Compensation</DialogTitle>
          <a href={OFFICIAL_FORM_URLS["1099nec"].url} target="_blank" rel="noopener noreferrer" data-testid="link-official-1099nec" className="text-xs text-primary hover:underline flex items-center gap-1 mt-1">
            <ExternalLink className="h-3 w-3" />Download Official IRS Form 1099-NEC (PDF)
          </a>
        </DialogHeader>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <Label className="text-xs">Report Type</Label>
            <Select value={reportType} onValueChange={(v: any) => setReportType(v)}>
              <SelectTrigger className="w-[130px]" data-testid="select-1099-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="annual">Annual</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <TaxReportFilters year={year} setYear={setYear} quarter={quarter} setQuarter={setQuarter} companyId={companyId} setCompanyId={setCompanyId} companies={companies} showQuarter={reportType === "quarterly"} />
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="button-print-1099"><Printer className="mr-2 h-4 w-4" />Print</Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-1099"><Download className="mr-2 h-4 w-4" />Export CSV</Button>
        </div>
        {filtered.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-1099">No contractors found for the selected period.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contractor</TableHead><TableHead>TIN/SSN</TableHead>
                <TableHead className="text-right">Non-Employee Compensation</TableHead>
                <TableHead>SE Tax (Reference)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(w => {
                const comp = getContractorPay(w);
                const seTax = Math.min(comp, 168600) * 0.124 + comp * 0.029;
                return (
                  <TableRow key={w.id} data-testid={`row-1099-${w.id}`}>
                    <TableCell className="font-medium">{w.firstName} {w.lastName}</TableCell>
                    <TableCell>{w.ssn ? `***-**-${w.ssn.slice(-4)}` : "N/A"}</TableCell>
                    <TableCell className="text-right">${comp.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">${seTax.toFixed(2)}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="font-bold border-t-2">
                <TableCell colSpan={2}>Total</TableCell>
                <TableCell className="text-right">${filtered.reduce((s, w) => s + getContractorPay(w), 0).toFixed(2)}</TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Form941Dialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState("Q1");
  const [companyId, setCompanyId] = useState("all");
  const { workers, companies, payrollRuns } = usePayrollData(open);

  const employees = workers.filter(w => w.workerType === "employee" && w.isActive);
  const filtered = companyId === "all" ? employees : employees.filter(w => w.companyId === companyId);
  const filteredRuns = filterRunsByPeriod(payrollRuns, year, quarter).filter(r => companyId === "all" || r.companyId === companyId);

  const totalWages = filtered.reduce((s, w) => s + Number(w.payRate || 0) * 520, 0);
  const fedWithholding = totalWages * 0.22;
  const ssEmployee = Math.min(totalWages, 168600 * filtered.length) * 0.062;
  const ssEmployer = ssEmployee;
  const medicareEmployee = totalWages * 0.0145;
  const medicareEmployer = medicareEmployee;
  const totalTaxDeposits = fedWithholding + ssEmployee + ssEmployer + medicareEmployee + medicareEmployer;

  const handleExportCSV = () => {
    const headers = ["Line Item", "Amount"];
    const rows = [
      ["Number of employees", String(filtered.length)],
      ["Total wages, tips, compensation", totalWages.toFixed(2)],
      ["Federal income tax withheld", fedWithholding.toFixed(2)],
      ["Social Security (employee)", ssEmployee.toFixed(2)],
      ["Social Security (employer)", ssEmployer.toFixed(2)],
      ["Medicare (employee)", medicareEmployee.toFixed(2)],
      ["Medicare (employer)", medicareEmployer.toFixed(2)],
      ["Total tax deposits", totalTaxDeposits.toFixed(2)],
    ];
    downloadCSV(headers, rows, `form_941_${year}_${quarter}.csv`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-941">Form 941 — Quarterly Federal Tax Return</DialogTitle>
          <a href={OFFICIAL_FORM_URLS["941"].url} target="_blank" rel="noopener noreferrer" data-testid="link-official-941" className="text-xs text-primary hover:underline flex items-center gap-1 mt-1">
            <ExternalLink className="h-3 w-3" />Download Official IRS Form 941 (PDF)
          </a>
        </DialogHeader>
        <TaxReportFilters year={year} setYear={setYear} quarter={quarter} setQuarter={setQuarter} companyId={companyId} setCompanyId={setCompanyId} companies={companies} showQuarter />
        <div className="flex items-center gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="button-print-941"><Printer className="mr-2 h-4 w-4" />Print</Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-941"><Download className="mr-2 h-4 w-4" />Export CSV</Button>
        </div>
        <div className="border rounded-lg p-4 space-y-3 mt-2">
          <h3 className="font-semibold text-sm">Form 941 — {quarter} {year}</h3>
          <Table>
            <TableBody>
              <TableRow><TableCell>1. Number of employees who received wages</TableCell><TableCell className="text-right font-medium">{filtered.length}</TableCell></TableRow>
              <TableRow><TableCell>2. Wages, tips, and other compensation</TableCell><TableCell className="text-right font-medium">${totalWages.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>3. Federal income tax withheld</TableCell><TableCell className="text-right font-medium">${fedWithholding.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>5a. Taxable Social Security wages (${(ssEmployee + ssEmployer).toFixed(2)})</TableCell><TableCell className="text-right font-medium">${Math.min(totalWages, 168600 * filtered.length).toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>5c. Taxable Medicare wages & tips</TableCell><TableCell className="text-right font-medium">${totalWages.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>5d. Total SS and Medicare taxes</TableCell><TableCell className="text-right font-medium">${(ssEmployee + ssEmployer + medicareEmployee + medicareEmployer).toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>6. Total taxes before adjustments</TableCell><TableCell className="text-right font-medium">${totalTaxDeposits.toFixed(2)}</TableCell></TableRow>
              <TableRow className="font-bold"><TableCell>10. Total taxes after adjustments</TableCell><TableCell className="text-right">${totalTaxDeposits.toFixed(2)}</TableCell></TableRow>
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Form940Dialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [companyId, setCompanyId] = useState("all");
  const { workers, companies, payrollRuns } = usePayrollData(open);

  const employees = workers.filter(w => w.workerType === "employee" && w.isActive);
  const filtered = companyId === "all" ? employees : employees.filter(w => w.companyId === companyId);

  const totalWages = filtered.reduce((s, w) => s + Number(w.payRate || 0) * 2080, 0);
  const futaWages = filtered.reduce((s, w) => s + Math.min(Number(w.payRate || 0) * 2080, 7000), 0);
  const futaTax = futaWages * 0.006;
  const stateCredit = futaWages * 0.054;

  const handleExportCSV = () => {
    const headers = ["Line Item", "Amount"];
    const rows = [
      ["Total payments to employees", totalWages.toFixed(2)],
      ["FUTA taxable wages (first $7,000/employee)", futaWages.toFixed(2)],
      ["FUTA tax before adjustments (0.6%)", futaTax.toFixed(2)],
      ["State unemployment credit (5.4%)", stateCredit.toFixed(2)],
      ["Total FUTA tax", futaTax.toFixed(2)],
    ];
    downloadCSV(headers, rows, `form_940_${year}.csv`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-940">Form 940 — Annual FUTA Tax Return — {year}</DialogTitle>
          <a href={OFFICIAL_FORM_URLS["940"].url} target="_blank" rel="noopener noreferrer" data-testid="link-official-940" className="text-xs text-primary hover:underline flex items-center gap-1 mt-1">
            <ExternalLink className="h-3 w-3" />Download Official IRS Form 940 (PDF)
          </a>
        </DialogHeader>
        <TaxReportFilters year={year} setYear={setYear} quarter="" setQuarter={() => {}} companyId={companyId} setCompanyId={setCompanyId} companies={companies} />
        <div className="flex items-center gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="button-print-940"><Printer className="mr-2 h-4 w-4" />Print</Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-940"><Download className="mr-2 h-4 w-4" />Export CSV</Button>
        </div>
        <div className="border rounded-lg p-4 space-y-3 mt-2">
          <h3 className="font-semibold text-sm">Form 940 — {year}</h3>
          <Table>
            <TableBody>
              <TableRow><TableCell>3. Total payments to all employees</TableCell><TableCell className="text-right font-medium">${totalWages.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>7. Total taxable FUTA wages (first $7,000/employee)</TableCell><TableCell className="text-right font-medium">${futaWages.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>8. FUTA tax before adjustments (0.6%)</TableCell><TableCell className="text-right font-medium">${futaTax.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>9. State unemployment tax credit (5.4%)</TableCell><TableCell className="text-right font-medium">${stateCredit.toFixed(2)}</TableCell></TableRow>
              <TableRow className="font-bold"><TableCell>14. Total FUTA tax</TableCell><TableCell className="text-right">${futaTax.toFixed(2)}</TableCell></TableRow>
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">Remit to: Internal Revenue Service (IRS)</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DE9Dialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState("Q1");
  const [companyId, setCompanyId] = useState("all");
  const { workers, companies } = usePayrollData(open);

  const employees = workers.filter(w => w.workerType === "employee" && w.isActive);
  const filtered = companyId === "all" ? employees : employees.filter(w => w.companyId === companyId);

  const totalWages = filtered.reduce((s, w) => s + Number(w.payRate || 0) * 520, 0);
  const pitWithheld = totalWages * 0.05;
  const sdiWithheld = totalWages * 0.011;
  const suiWages = filtered.reduce((s, w) => s + Math.min(Number(w.payRate || 0) * 520, 7000), 0);
  const suiContrib = suiWages * 0.034;
  const ettContrib = suiWages * 0.001;

  const handleExportCSV = () => {
    const headers = ["Line Item", "Amount"];
    const rows = [
      ["Number of employees", String(filtered.length)],
      ["Total subject wages", totalWages.toFixed(2)],
      ["PIT withheld", pitWithheld.toFixed(2)],
      ["SDI withheld", sdiWithheld.toFixed(2)],
      ["UI taxable wages", suiWages.toFixed(2)],
      ["UI contributions (SUI)", suiContrib.toFixed(2)],
      ["ETT contributions", ettContrib.toFixed(2)],
      ["Total contributions & withholdings", (pitWithheld + sdiWithheld + suiContrib + ettContrib).toFixed(2)],
    ];
    downloadCSV(headers, rows, `de9_${year}_${quarter}.csv`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-de9">DE 9 — Quarterly Contribution Return — {quarter} {year}</DialogTitle>
          <a href={OFFICIAL_FORM_URLS.de9.url} target="_blank" rel="noopener noreferrer" data-testid="link-official-de9" className="text-xs text-primary hover:underline flex items-center gap-1 mt-1">
            <ExternalLink className="h-3 w-3" />Download Official CA EDD Form DE 9 (PDF)
          </a>
        </DialogHeader>
        <TaxReportFilters year={year} setYear={setYear} quarter={quarter} setQuarter={setQuarter} companyId={companyId} setCompanyId={setCompanyId} companies={companies} showQuarter />
        <div className="flex items-center gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="button-print-de9"><Printer className="mr-2 h-4 w-4" />Print</Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-de9"><Download className="mr-2 h-4 w-4" />Export CSV</Button>
        </div>
        <div className="border rounded-lg p-4 space-y-3 mt-2">
          <h3 className="font-semibold text-sm">California DE 9 — {quarter} {year}</h3>
          <Table>
            <TableBody>
              <TableRow><TableCell>A. Number of employees</TableCell><TableCell className="text-right font-medium">{filtered.length}</TableCell></TableRow>
              <TableRow><TableCell>B. Total subject wages</TableCell><TableCell className="text-right font-medium">${totalWages.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>C. PIT wages</TableCell><TableCell className="text-right font-medium">${totalWages.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>D. PIT withheld</TableCell><TableCell className="text-right font-medium">${pitWithheld.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>E. SDI withheld (1.1%)</TableCell><TableCell className="text-right font-medium">${sdiWithheld.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>F. UI taxable wages</TableCell><TableCell className="text-right font-medium">${suiWages.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>G. UI contributions (SUI 3.4%)</TableCell><TableCell className="text-right font-medium">${suiContrib.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>H. ETT contributions (0.1%)</TableCell><TableCell className="text-right font-medium">${ettContrib.toFixed(2)}</TableCell></TableRow>
              <TableRow className="font-bold"><TableCell>Total contributions & withholdings</TableCell><TableCell className="text-right">${(pitWithheld + sdiWithheld + suiContrib + ettContrib).toFixed(2)}</TableCell></TableRow>
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">File with: California Employment Development Department (EDD)</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DE9CDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState("Q1");
  const [companyId, setCompanyId] = useState("all");
  const { workers, companies } = usePayrollData(open);

  const employees = workers.filter(w => w.workerType === "employee" && w.isActive);
  const filtered = companyId === "all" ? employees : employees.filter(w => w.companyId === companyId);

  const handleExportCSV = () => {
    const headers = ["SSN", "Last Name", "First Name", "PIT Wages", "PIT Withheld", "SDI Wages", "SDI Withheld"];
    const rows = filtered.map(w => {
      const wages = Number(w.payRate || 0) * 520;
      return [
        w.ssn || "N/A", w.lastName, w.firstName,
        wages.toFixed(2), (wages * 0.05).toFixed(2),
        wages.toFixed(2), (wages * 0.011).toFixed(2),
      ];
    });
    downloadCSV(headers, rows, `de9c_${year}_${quarter}.csv`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-de9c">DE 9C — Quarterly Employee Detail — {quarter} {year}</DialogTitle>
          <a href={OFFICIAL_FORM_URLS.de9c.url} target="_blank" rel="noopener noreferrer" data-testid="link-official-de9c" className="text-xs text-primary hover:underline flex items-center gap-1 mt-1">
            <ExternalLink className="h-3 w-3" />Download Official CA EDD Form DE 9C (PDF)
          </a>
        </DialogHeader>
        <TaxReportFilters year={year} setYear={setYear} quarter={quarter} setQuarter={setQuarter} companyId={companyId} setCompanyId={setCompanyId} companies={companies} showQuarter />
        <div className="flex items-center gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="button-print-de9c"><Printer className="mr-2 h-4 w-4" />Print</Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-de9c"><Download className="mr-2 h-4 w-4" />Export CSV</Button>
        </div>
        {filtered.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-de9c">No employees found for the selected period.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SSN</TableHead><TableHead>Last Name</TableHead><TableHead>First Name</TableHead>
                <TableHead className="text-right">PIT Wages</TableHead><TableHead className="text-right">PIT Withheld</TableHead>
                <TableHead className="text-right">SDI Wages</TableHead><TableHead className="text-right">SDI Withheld</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(w => {
                const wages = Number(w.payRate || 0) * 520;
                return (
                  <TableRow key={w.id} data-testid={`row-de9c-${w.id}`}>
                    <TableCell>{w.ssn ? `***-**-${w.ssn.slice(-4)}` : "N/A"}</TableCell>
                    <TableCell>{w.lastName}</TableCell>
                    <TableCell>{w.firstName}</TableCell>
                    <TableCell className="text-right">${wages.toFixed(2)}</TableCell>
                    <TableCell className="text-right">${(wages * 0.05).toFixed(2)}</TableCell>
                    <TableCell className="text-right">${wages.toFixed(2)}</TableCell>
                    <TableCell className="text-right">${(wages * 0.011).toFixed(2)}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="font-bold border-t-2">
                <TableCell colSpan={3}>Totals</TableCell>
                <TableCell className="text-right">${filtered.reduce((s, w) => s + Number(w.payRate || 0) * 520, 0).toFixed(2)}</TableCell>
                <TableCell className="text-right">${(filtered.reduce((s, w) => s + Number(w.payRate || 0) * 520, 0) * 0.05).toFixed(2)}</TableCell>
                <TableCell className="text-right">${filtered.reduce((s, w) => s + Number(w.payRate || 0) * 520, 0).toFixed(2)}</TableCell>
                <TableCell className="text-right">${(filtered.reduce((s, w) => s + Number(w.payRate || 0) * 520, 0) * 0.011).toFixed(2)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground mt-2">File with: California Employment Development Department (EDD) — accompanies DE 9</p>
      </DialogContent>
    </Dialog>
  );
}

function Form1096Dialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [companyId, setCompanyId] = useState("all");
  const { workers, companies } = usePayrollData(open);

  const contractors = workers.filter(w => w.workerType === "contractor" && w.isActive);
  const filtered = companyId === "all" ? contractors : contractors.filter(w => w.companyId === companyId);
  const eligible = filtered.filter(w => Number(w.payRate || 0) * 2080 >= 600);
  const totalComp = eligible.reduce((s, w) => s + Number(w.payRate || 0) * 2080, 0);

  const handleExportCSV = () => {
    const headers = ["Line Item", "Value"];
    const rows = [
      ["Tax Year", year],
      ["Form Type", "1099-NEC"],
      ["Number of Forms", String(eligible.length)],
      ["Total Amount Reported", totalComp.toFixed(2)],
      ["Federal Income Tax Withheld", "0.00"],
    ];
    downloadCSV(headers, rows, `form_1096_${year}.csv`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-1096">Form 1096 — Annual Summary and Transmittal — {year}</DialogTitle>
          <a href={OFFICIAL_FORM_URLS["1096"].url} target="_blank" rel="noopener noreferrer" data-testid="link-official-1096" className="text-xs text-primary hover:underline flex items-center gap-1 mt-1">
            <ExternalLink className="h-3 w-3" />Download Official IRS Form 1096 (PDF)
          </a>
        </DialogHeader>
        <TaxReportFilters year={year} setYear={setYear} quarter="" setQuarter={() => {}} companyId={companyId} setCompanyId={setCompanyId} companies={companies} />
        <div className="flex items-center gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="button-print-1096"><Printer className="mr-2 h-4 w-4" />Print</Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-1096"><Download className="mr-2 h-4 w-4" />Export CSV</Button>
        </div>
        <div className="border rounded-lg p-4 space-y-3 mt-2">
          <h3 className="font-semibold text-sm">Form 1096 — Annual Summary and Transmittal of U.S. Information Returns — {year}</h3>
          <p className="text-xs text-muted-foreground">This form accompanies paper filings of 1099-NEC forms submitted to the IRS.</p>
          <Table>
            <TableBody>
              <TableRow><TableCell>Filer's name and address</TableCell><TableCell className="text-right font-medium">{companyId !== "all" ? companies.find(c => c.id === companyId)?.name || "—" : "All Companies"}</TableCell></TableRow>
              <TableRow><TableCell>Type of form being transmitted</TableCell><TableCell className="text-right font-medium">1099-NEC</TableCell></TableRow>
              <TableRow><TableCell>Box 3 — Number of forms</TableCell><TableCell className="text-right font-medium">{eligible.length}</TableCell></TableRow>
              <TableRow><TableCell>Box 4 — Federal income tax withheld</TableCell><TableCell className="text-right font-medium">$0.00</TableCell></TableRow>
              <TableRow className="font-bold"><TableCell>Box 5 — Total amount reported</TableCell><TableCell className="text-right">${totalComp.toFixed(2)}</TableCell></TableRow>
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">File with: Internal Revenue Service (IRS) — accompanies paper 1099-NEC submissions</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ReportsPage() {
  const [tab, setTab] = useTabParam();
  const [whosInOpen, setWhosInOpen] = useState(false);
  const [employeeInfoOpen, setEmployeeInfoOpen] = useState(false);
  const [timesheetSummaryOpen, setTimesheetSummaryOpen] = useState(false);
  const [payrollExportOpen, setPayrollExportOpen] = useState(false);
  const [auditTrailOpen, setAuditTrailOpen] = useState(false);
  const [scheduleSummaryOpen, setScheduleSummaryOpen] = useState(false);
  const [timesheetDetailOpen, setTimesheetDetailOpen] = useState(false);
  const [punchSummaryOpen, setPunchSummaryOpen] = useState(false);
  const [accrualBalanceOpen, setAccrualBalanceOpen] = useState(false);
  const [exceptionSummaryOpen, setExceptionSummaryOpen] = useState(false);
  const [paystubSummaryOpen, setPaystubSummaryOpen] = useState(false);
  const [generalLedgerOpen, setGeneralLedgerOpen] = useState(false);
  const [taxSummaryOpen, setTaxSummaryOpen] = useState(false);
  const [qualificationSummaryOpen, setQualificationSummaryOpen] = useState(false);
  const [reviewSummaryOpen, setReviewSummaryOpen] = useState(false);
  const [w2Open, setW2Open] = useState(false);
  const [form1099Open, setForm1099Open] = useState(false);
  const [form1096Open, setForm1096Open] = useState(false);
  const [form941Open, setForm941Open] = useState(false);
  const [form940Open, setForm940Open] = useState(false);
  const [de9Open, setDE9Open] = useState(false);
  const [de9cOpen, setDE9COpen] = useState(false);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-blue-accent" data-testid="text-page-title">Reports</h1>
        <p className="text-muted-foreground mt-1">Generate and view reports across all categories.</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap" data-testid="tabs-reports">
          <TabsTrigger value="saved" data-testid="tab-saved">Saved Reports</TabsTrigger>
          <TabsTrigger value="employee" data-testid="tab-employee">Employee Reports</TabsTrigger>
          <TabsTrigger value="timesheet" data-testid="tab-timesheet">Timesheet Reports</TabsTrigger>
          <TabsTrigger value="payroll" data-testid="tab-payroll">Payroll Reports</TabsTrigger>
          <TabsTrigger value="tax" data-testid="tab-tax">Tax Reports</TabsTrigger>
          <TabsTrigger value="hr" data-testid="tab-hr">HR Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="saved" className="mt-6">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground max-w-md" data-testid="text-no-saved-reports">
              No saved reports yet. Generate a report from any category and save it for quick access.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="employee" className="mt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              title="Who's In Summary"
              description="View who is currently clocked in across all locations."
              icon={<UserCheck className="h-5 w-5" />}
              onGenerate={() => setWhosInOpen(true)}
            />
            <ReportCard
              title="Employee Information"
              description="Complete employee directory with contact details."
              icon={<Users className="h-5 w-5" />}
              onGenerate={() => setEmployeeInfoOpen(true)}
            />
            <ReportCard
              title="Audit Trail"
              description="Recent time entries and clock actions audit log."
              icon={<Shield className="h-5 w-5" />}
              onGenerate={() => setAuditTrailOpen(true)}
            />
          </div>
        </TabsContent>

        <TabsContent value="timesheet" className="mt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              title="Schedule Summary"
              description="Overview of scheduled shifts by department."
              icon={<CalendarDays className="h-5 w-5" />}
              onGenerate={() => setScheduleSummaryOpen(true)}
            />
            <ReportCard
              title="Timesheet Summary"
              description="Summary of hours worked across all employees."
              icon={<Clock className="h-5 w-5" />}
              onGenerate={() => setTimesheetSummaryOpen(true)}
            />
            <ReportCard
              title="Timesheet Detail"
              description="Detailed timesheet entries with clock times."
              icon={<ClipboardList className="h-5 w-5" />}
              onGenerate={() => setTimesheetDetailOpen(true)}
            />
            <ReportCard
              title="Punch Summary"
              description="Raw punch data analysis."
              icon={<BarChart3 className="h-5 w-5" />}
              onGenerate={() => setPunchSummaryOpen(true)}
            />
            <ReportCard
              title="Accrual Balance Summary"
              description="Current accrual balances for all employees."
              icon={<Calculator className="h-5 w-5" />}
              onGenerate={() => setAccrualBalanceOpen(true)}
            />
            <ReportCard
              title="Exception Summary"
              description="Time and attendance exceptions."
              icon={<AlertTriangle className="h-5 w-5" />}
              onGenerate={() => setExceptionSummaryOpen(true)}
            />
          </div>
        </TabsContent>

        <TabsContent value="payroll" className="mt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              title="Paystub Summary"
              description="Summary of all pay stubs by period."
              icon={<Receipt className="h-5 w-5" />}
              onGenerate={() => setPaystubSummaryOpen(true)}
            />
            <ReportCard
              title="Payroll Export"
              description="Export payroll data for external processing."
              icon={<Download className="h-5 w-5" />}
              onGenerate={() => setPayrollExportOpen(true)}
            />
            <ReportCard
              title="General Ledger Summary"
              description="Payroll journal entries for accounting."
              icon={<Building className="h-5 w-5" />}
              onGenerate={() => setGeneralLedgerOpen(true)}
            />
          </div>
        </TabsContent>

        <TabsContent value="tax" className="mt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              title="Tax Summary"
              description="General tax withholding and deduction summary."
              icon={<DollarSign className="h-5 w-5" />}
              onGenerate={() => setTaxSummaryOpen(true)}
            />
            <ReportCard
              title="W-2 Annual Report"
              description="Annual Wage & Tax Statements for W-2 employees."
              icon={<FileText className="h-5 w-5" />}
              onGenerate={() => setW2Open(true)}
            />
            <ReportCard
              title="Form 1099-NEC"
              description="Non-Employee Compensation for contractors. Quarterly & annual."
              icon={<FileText className="h-5 w-5" />}
              onGenerate={() => setForm1099Open(true)}
            />
            <ReportCard
              title="Form 941"
              description="Quarterly Federal Tax Return (IRS)."
              icon={<FileText className="h-5 w-5" />}
              onGenerate={() => setForm941Open(true)}
            />
            <ReportCard
              title="Form 940"
              description="Annual Federal Unemployment Tax Return (IRS)."
              icon={<FileText className="h-5 w-5" />}
              onGenerate={() => setForm940Open(true)}
            />
            <ReportCard
              title="Form 1096"
              description="Annual Summary & Transmittal of 1099 forms (IRS)."
              icon={<FileText className="h-5 w-5" />}
              onGenerate={() => setForm1096Open(true)}
            />
            <ReportCard
              title="DE 9"
              description="California Quarterly Contribution Return (EDD)."
              icon={<FileText className="h-5 w-5" />}
              onGenerate={() => setDE9Open(true)}
            />
            <ReportCard
              title="DE 9C"
              description="California Quarterly Employee Detail (EDD)."
              icon={<FileText className="h-5 w-5" />}
              onGenerate={() => setDE9COpen(true)}
            />
          </div>
        </TabsContent>

        <TabsContent value="hr" className="mt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              title="Qualification Summary"
              description="Employee qualifications and certifications overview."
              icon={<Award className="h-5 w-5" />}
              onGenerate={() => setQualificationSummaryOpen(true)}
            />
            <ReportCard
              title="Review Summary"
              description="Performance review status and ratings."
              icon={<Star className="h-5 w-5" />}
              onGenerate={() => setReviewSummaryOpen(true)}
            />
          </div>
        </TabsContent>
      </Tabs>

      <WhosInDialog open={whosInOpen} onOpenChange={setWhosInOpen} />
      <EmployeeInfoDialog open={employeeInfoOpen} onOpenChange={setEmployeeInfoOpen} />
      <TimesheetSummaryDialog open={timesheetSummaryOpen} onOpenChange={setTimesheetSummaryOpen} />
      <PayrollExportDialog open={payrollExportOpen} onOpenChange={setPayrollExportOpen} />
      <AuditTrailDialog open={auditTrailOpen} onOpenChange={setAuditTrailOpen} />
      <ScheduleSummaryDialog open={scheduleSummaryOpen} onOpenChange={setScheduleSummaryOpen} />
      <TimesheetDetailDialog open={timesheetDetailOpen} onOpenChange={setTimesheetDetailOpen} />
      <PunchSummaryDialog open={punchSummaryOpen} onOpenChange={setPunchSummaryOpen} />
      <AccrualBalanceSummaryDialog open={accrualBalanceOpen} onOpenChange={setAccrualBalanceOpen} />
      <ExceptionSummaryDialog open={exceptionSummaryOpen} onOpenChange={setExceptionSummaryOpen} />
      <PaystubSummaryDialog open={paystubSummaryOpen} onOpenChange={setPaystubSummaryOpen} />
      <GeneralLedgerSummaryDialog open={generalLedgerOpen} onOpenChange={setGeneralLedgerOpen} />
      <TaxSummaryDialog open={taxSummaryOpen} onOpenChange={setTaxSummaryOpen} />
      <W2ReportDialog open={w2Open} onOpenChange={setW2Open} />
      <Form1099NECDialog open={form1099Open} onOpenChange={setForm1099Open} />
      <Form941Dialog open={form941Open} onOpenChange={setForm941Open} />
      <Form940Dialog open={form940Open} onOpenChange={setForm940Open} />
      <Form1096Dialog open={form1096Open} onOpenChange={setForm1096Open} />
      <DE9Dialog open={de9Open} onOpenChange={setDE9Open} />
      <DE9CDialog open={de9cOpen} onOpenChange={setDE9COpen} />
      <QualificationSummaryDialog open={qualificationSummaryOpen} onOpenChange={setQualificationSummaryOpen} />
      <ReviewSummaryDialog open={reviewSummaryOpen} onOpenChange={setReviewSummaryOpen} />
    </div>
  );
}