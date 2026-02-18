import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import type { Worker, TimeEntry, PayrollRun } from "@shared/schema";
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
    const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "employee_information.csv";
    a.click();
    URL.revokeObjectURL(url);
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
    const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "payroll_export.csv";
    a.click();
    URL.revokeObjectURL(url);
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

export default function ReportsPage() {
  const [tab, setTab] = useTabParam();
  const [whosInOpen, setWhosInOpen] = useState(false);
  const [employeeInfoOpen, setEmployeeInfoOpen] = useState(false);
  const [timesheetSummaryOpen, setTimesheetSummaryOpen] = useState(false);
  const [payrollExportOpen, setPayrollExportOpen] = useState(false);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Reports</h1>
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
              description="Audit trail reports coming soon."
              icon={<Shield className="h-5 w-5" />}
              comingSoon
            />
          </div>
        </TabsContent>

        <TabsContent value="timesheet" className="mt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              title="Schedule Summary"
              description="Overview of scheduled shifts by department."
              icon={<CalendarDays className="h-5 w-5" />}
              comingSoon
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
              comingSoon
            />
            <ReportCard
              title="Punch Summary"
              description="Raw punch data analysis."
              icon={<BarChart3 className="h-5 w-5" />}
              comingSoon
            />
            <ReportCard
              title="Accrual Balance Summary"
              description="Current accrual balances for all employees."
              icon={<Calculator className="h-5 w-5" />}
              comingSoon
            />
            <ReportCard
              title="Exception Summary"
              description="Time and attendance exceptions."
              icon={<AlertTriangle className="h-5 w-5" />}
              comingSoon
            />
          </div>
        </TabsContent>

        <TabsContent value="payroll" className="mt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              title="Paystub Summary"
              description="Summary of all pay stubs by period."
              icon={<Receipt className="h-5 w-5" />}
              comingSoon
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
              comingSoon
            />
          </div>
        </TabsContent>

        <TabsContent value="tax" className="mt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              title="Tax Summary - Generic"
              description="General tax withholding summary."
              icon={<DollarSign className="h-5 w-5" />}
              comingSoon
            />
            <ReportCard
              title="US State Unemployment"
              description="State unemployment tax report."
              icon={<FileText className="h-5 w-5" />}
              comingSoon
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
              comingSoon
            />
            <ReportCard
              title="Review Summary"
              description="Performance review status and ratings."
              icon={<Star className="h-5 w-5" />}
              comingSoon
            />
          </div>
        </TabsContent>
      </Tabs>

      <WhosInDialog open={whosInOpen} onOpenChange={setWhosInOpen} />
      <EmployeeInfoDialog open={employeeInfoOpen} onOpenChange={setEmployeeInfoOpen} />
      <TimesheetSummaryDialog open={timesheetSummaryOpen} onOpenChange={setTimesheetSummaryOpen} />
      <PayrollExportDialog open={payrollExportOpen} onOpenChange={setPayrollExportOpen} />
    </div>
  );
}
