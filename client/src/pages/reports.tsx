import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import type {
  Worker, TimeEntry, PayrollRun, Schedule, TimePunch,
  AccrualBalance, AccrualAccount, Qualification, Review,
  TaxDeduction, PayStubTransaction
} from "@shared/schema";
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
  Shield, Star, Award, Receipt, Building, Calculator
} from "lucide-react";

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
              title="Form 941"
              description="Quarterly Federal Tax Return."
              icon={<FileText className="h-5 w-5" />}
              comingSoon
            />
            <ReportCard
              title="Form 940"
              description="Annual Federal Unemployment Tax Return."
              icon={<FileText className="h-5 w-5" />}
              comingSoon
            />
            <ReportCard
              title="Form 1099-NEC"
              description="Non-Employee Compensation reporting."
              icon={<FileText className="h-5 w-5" />}
              comingSoon
            />
            <ReportCard
              title="Form W2/W3"
              description="Annual Wage and Tax Statements."
              icon={<FileText className="h-5 w-5" />}
              comingSoon
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
      <QualificationSummaryDialog open={qualificationSummaryOpen} onOpenChange={setQualificationSummaryOpen} />
      <ReviewSummaryDialog open={reviewSummaryOpen} onOpenChange={setReviewSummaryOpen} />
    </div>
  );
}