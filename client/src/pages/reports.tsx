import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type {
  Worker, TimeEntry, PayrollRun, PayrollItem, Schedule, TimePunch,
  AccrualBalance, AccrualAccount, Qualification, Review,
  TaxDeduction, PayStubTransaction, Company, SavedReport, SecondaryWageGroup, Receipt as ExpenseReceipt
} from "@shared/schema";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
  Shield, Star, Award, Receipt, Building, Calculator, ExternalLink,
  Save, Trash2, Eye, Search, Briefcase, ChevronDown, ChevronRight,
  XCircle, CheckCircle2, Tag, Banknote, ListChecks, FileCheck2,
} from "lucide-react";
import { PayrollSummaryReportDialog } from "@/components/reports/payroll-summary-report";
import { PayrollRegisterReportDialog } from "@/components/reports/payroll-register-report";
import { TimesheetReportDialog } from "@/components/reports/timesheet-report";

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
    setLocation(`/app/reports?tab=${newTab}`);
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

function SaveReportButton({ reportType, category, defaultName, headers, rows }: {
  reportType: string; category: string; defaultName: string; headers: string[]; rows: string[][];
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiRequest("POST", "/api/saved-reports", {
        name: `${defaultName} - ${new Date().toLocaleDateString()}`,
        reportType,
        category,
        headers: JSON.stringify(headers),
        data: JSON.stringify(rows),
        rowCount: rows.length,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/saved-reports"] });
      toast({ title: "Report saved successfully" });
    } catch (err: any) {
      toast({ title: "Error saving report", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleSave} disabled={saving || rows.length === 0} data-testid={`button-save-${reportType}`}>
      <Save className="mr-2 h-4 w-4" />{saving ? "Saving..." : "Save Report"}
    </Button>
  );
}

function SavedReportViewDialog({ open, onOpenChange, reportId }: { open: boolean; onOpenChange: (v: boolean) => void; reportId: string | null }) {
  const { data: report, isLoading } = useQuery<SavedReport>({
    queryKey: ["/api/saved-reports", reportId],
    enabled: open && !!reportId,
  });

  let headers: string[] = [];
  let rows: string[][] = [];
  try {
    headers = report?.headers ? JSON.parse(report.headers) : [];
    rows = report?.data ? JSON.parse(report.data) : [];
  } catch { }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-saved-report-title">{report?.name || "Saved Report"}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary">{report?.category}</Badge>
              <Badge variant="outline">{report?.reportType}</Badge>
              <span className="text-xs text-muted-foreground">{report?.rowCount} rows</span>
              <span className="text-xs text-muted-foreground">Saved {report?.createdAt ? new Date(report.createdAt).toLocaleString() : ""}</span>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="button-print-saved"><Printer className="mr-2 h-4 w-4" />Print</Button>
                <Button variant="outline" size="sm" onClick={() => downloadCSV(headers, rows, `${report?.name || "report"}.csv`)} data-testid="button-export-saved"><Download className="mr-2 h-4 w-4" />Export CSV</Button>
              </div>
            </div>
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>{headers.map((h, i) => <TableHead key={i}>{h}</TableHead>)}</TableRow>
              </TableHeader>
              <TableBody>
                {rows.length > 0 ? rows.map((row, ri) => (
                  <TableRow key={ri}>{row.map((cell, ci) => <TableCell key={ci}>{cell}</TableCell>)}</TableRow>
                )) : (
                  <TableRow><TableCell colSpan={headers.length || 1} className="text-center text-muted-foreground py-8">No data</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SavedReportsTab() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [viewReportId, setViewReportId] = useState<string | null>(null);
  const [viewOpen, setViewOpen] = useState(false);

  const { data: reports = [], isLoading } = useQuery<SavedReport[]>({ queryKey: ["/api/saved-reports"] });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/saved-reports/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-reports"] });
      toast({ title: "Report deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filtered = reports.filter(r => {
    if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
    if (searchQuery && !r.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const categoryLabel = (cat: string) => {
    const labels: Record<string, string> = { employee: "Employee", timesheet: "Timesheet", payroll: "Payroll", tax: "Tax", hr: "HR" };
    return labels[cat] || cat;
  };

  if (isLoading) {
    return <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search saved reports..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-saved-reports"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-category-filter">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="employee">Employee</SelectItem>
            <SelectItem value="timesheet">Timesheet</SelectItem>
            <SelectItem value="payroll">Payroll</SelectItem>
            <SelectItem value="tax">Tax</SelectItem>
            <SelectItem value="hr">HR</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground max-w-md" data-testid="text-no-saved-reports">
            {reports.length === 0
              ? "No saved reports yet. Generate a report from any category and save it for quick access."
              : "No reports match your search criteria."}
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Saved</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.id} data-testid={`row-saved-report-${r.id}`}>
                    <TableCell className="font-medium max-w-[200px] truncate">{r.name}</TableCell>
                    <TableCell className="text-sm">{r.reportType}</TableCell>
                    <TableCell><Badge variant="secondary">{categoryLabel(r.category)}</Badge></TableCell>
                    <TableCell>{r.rowCount}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ""}</TableCell>
                    <TableCell className="text-sm">{r.createdBy || "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" data-testid={`button-view-report-${r.id}`} onClick={() => { setViewReportId(r.id); setViewOpen(true); }}><Eye className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" data-testid={`button-delete-report-${r.id}`} onClick={() => deleteMutation.mutate(r.id)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <SavedReportViewDialog open={viewOpen} onOpenChange={setViewOpen} reportId={viewReportId} />
    </div>
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
          <div className="overflow-x-auto">
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
          </div>
        )}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground" data-testid="text-clocked-in-count">
            {clockedIn.length} employee{clockedIn.length !== 1 ? "s" : ""} currently clocked in
          </p>
          <SaveReportButton reportType="whos-in" category="employee" defaultName="Who's In Summary" headers={["Employee", "Clock In Time", "Date"]} rows={clockedIn.map(e => [getWorkerName(e.workerId), e.clockIn ? new Date(e.clockIn).toLocaleTimeString() : "—", e.date])} />
        </div>
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
          <SaveReportButton reportType="employee-info" category="employee" defaultName="Employee Information" headers={["Name", "Email", "Phone", "Type", "Job Title", "Department", "Pay Rate", "Status"]} rows={workers.map(w => [`${w.firstName} ${w.lastName}`, w.email || "", w.phone || "", w.workerType, w.jobTitle || "", w.department || "", w.payRate, w.isActive ? "Active" : "Inactive"])} />
        </div>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <div className="overflow-x-auto">
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
          </div>
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
          <div>
            <div className="overflow-x-auto">
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
            </div>
            <div className="flex justify-end mt-3">
              <SaveReportButton reportType="timesheet-summary" category="timesheet" defaultName="Timesheet Summary" headers={["Employee", "Total Hours"]} rows={rows.map(([wId, hrs]) => [getWorkerName(wId), hrs.toFixed(2)])} />
            </div>
          </div>
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
          <SaveReportButton reportType="payroll-export" category="payroll" defaultName="Payroll Export" headers={["ID", "Period Start", "Period End", "Status", "Total Gross", "Total Net", "Total Hours", "OT Hours", "Worker Count", "Processed At"]} rows={payrollRuns.map(r => [r.id, r.periodStart, r.periodEnd, r.status || "", r.totalGross || "0", r.totalNet || "0", r.totalHours || "0", r.totalOvertimeHours || "0", String(r.workerCount || 0), r.processedAt ? new Date(r.processedAt).toLocaleString() : ""])} />
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
          <div className="overflow-x-auto">
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
          </div>
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
          <SaveReportButton reportType="audit-trail" category="employee" defaultName="Audit Trail" headers={["Employee", "Action", "Date", "Time"]} rows={sorted.map(e => [getWorkerName(e.workerId), getAction(e), e.date, getTime(e)])} />
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
          <div className="overflow-x-auto">
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
          </div>
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
          <SaveReportButton reportType="schedule-summary" category="timesheet" defaultName="Schedule Summary" headers={["Department", "Employee", "Date", "Start Time", "End Time"]} rows={sorted.map(s => [s.department || "", getWorkerName(s.workerId), s.date, s.startTime || "", s.endTime || ""])} />
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
          <div className="overflow-x-auto">
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
          </div>
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
  const { data: wageGroups = [] } = useQuery<SecondaryWageGroup[]>({
    queryKey: ["/api/secondary-wage-groups"],
    enabled: open,
  });

  const isLoading = loadingEntries || loadingWorkers;
  const getWorkerName = (id: string) => {
    const w = workers.find((w) => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  };
  const wgLookup: Record<string, SecondaryWageGroup> = {};
  wageGroups.forEach(wg => { wgLookup[wg.id] = wg; });
  const getWageGroupName = (id: string | null | undefined) => {
    if (!id) return "Default";
    return wgLookup[id]?.name || "Default";
  };
  const getWageGroupRate = (id: string | null | undefined) => {
    if (!id || !wgLookup[id]) return "";
    return `$${Number(wgLookup[id].hourlyRate || 0).toFixed(2)}/hr`;
  };

  const sorted = [...timeEntries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const handlePrint = () => window.print();
  const handleExportCSV = () => {
    const headers = ["Employee", "Date", "Clock In", "Clock Out", "Break Mins", "Total Hours", "OT Hours", "Wage Group", "Rate", "Status"];
    const rows = sorted.map((e) => [
      getWorkerName(e.workerId),
      e.date,
      e.clockIn ? new Date(e.clockIn).toLocaleTimeString() : "",
      e.clockOut ? new Date(e.clockOut).toLocaleTimeString() : "",
      String(e.breakMinutes || 0),
      Number(e.totalHours || 0).toFixed(2),
      Number(e.overtimeHours || 0).toFixed(2),
      getWageGroupName(e.wageGroupId),
      getWageGroupRate(e.wageGroupId),
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
          <SaveReportButton reportType="timesheet-detail" category="timesheet" defaultName="Timesheet Detail" headers={["Employee", "Date", "Clock In", "Clock Out", "Break Mins", "Total Hours", "OT Hours", "Wage Group", "Rate", "Status"]} rows={sorted.map(e => [getWorkerName(e.workerId), e.date, e.clockIn ? new Date(e.clockIn).toLocaleTimeString() : "", e.clockOut ? new Date(e.clockOut).toLocaleTimeString() : "", String(e.breakMinutes || 0), String(Number(e.totalHours || 0).toFixed(2)), String(Number(e.overtimeHours || 0).toFixed(2)), getWageGroupName(e.wageGroupId), getWageGroupRate(e.wageGroupId), e.status || ""])} />
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
          <div className="overflow-x-auto">
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
                <TableHead>Wage Group</TableHead>
                <TableHead className="text-right">Rate</TableHead>
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
                  <TableCell>{getWageGroupName(e.wageGroupId)}</TableCell>
                  <TableCell className="text-right">{getWageGroupRate(e.wageGroupId)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{e.status || "pending"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
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
          <SaveReportButton reportType="punch-summary" category="timesheet" defaultName="Punch Summary" headers={["Employee", "Punch Type", "Punch Time", "Note"]} rows={sorted.map(p => [getWorkerName(p.workerId), p.punchType, p.punchTime ? new Date(p.punchTime).toLocaleString() : "", p.note || ""])} />
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
          <div className="overflow-x-auto">
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
          </div>
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
          <SaveReportButton reportType="accrual-balance" category="timesheet" defaultName="Accrual Balance Summary" headers={["Employee", "Type", "Account", "Balance", "Used", "Available"]} rows={balances.map(b => { const acct = accounts.find(a => a.id === b.accrualAccountId); return [getWorkerName(b.workerId), acct?.type || "", acct?.name || "", String(Number(b.balance || 0).toFixed(2)), String(Number(b.usedHours || 0).toFixed(2)), String((Number(b.balance || 0) - Number(b.usedHours || 0)).toFixed(2))]; })} />
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
          <div className="overflow-x-auto">
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
          </div>
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
          <SaveReportButton reportType="exception-summary" category="timesheet" defaultName="Exception Summary" headers={["Employee", "Date", "Issue Type", "Total Hours", "OT Hours", "Status"]} rows={sorted.map(e => [getWorkerName(e.workerId), e.date, Number(e.totalHours || 0) > 8 ? "Overtime" : Number(e.totalHours || 0) < 4 ? "Short Shift" : "Other", String(Number(e.totalHours || 0).toFixed(2)), String(Number(e.overtimeHours || 0).toFixed(2)), e.status || ""])} />
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
          <div className="overflow-x-auto">
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
          </div>
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
          <SaveReportButton reportType="paystub-summary" category="payroll" defaultName="Paystub Summary" headers={["Employee", "Date", "Amount", "Payment Method", "Status", "Check Number", "Reference"]} rows={sorted.map(t => [getWorkerName(t.workerId), t.transactionDate || "", String(Number(t.amount || 0).toFixed(2)), t.paymentMethod || "", t.status || "", t.checkNumber || "", t.reference || ""])} />
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
          <div className="overflow-x-auto">
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
          </div>
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
          <SaveReportButton reportType="general-ledger" category="payroll" defaultName="General Ledger Summary" headers={["Period Start", "Period End", "Status", "Total Gross", "Total Net", "Total Deductions", "Worker Count"]} rows={sorted.map(r => [r.periodStart, r.periodEnd, r.status || "", "$" + Number(r.totalGross || 0).toFixed(2), "$" + Number(r.totalNet || 0).toFixed(2), "$" + (Number(r.totalGross || 0) - Number(r.totalNet || 0)).toFixed(2), String(r.workerCount || 0)])} />
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
          <div className="overflow-x-auto">
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
          </div>
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
          <SaveReportButton reportType="tax-summary" category="tax" defaultName="Tax Summary" headers={["Name", "Type", "Rate", "Employer Paid"]} rows={deductions.map(d => [d.name, d.type || "", d.rate || "", d.isEmployerPaid ? "Yes" : "No"])} />
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
          <div className="overflow-x-auto">
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
          </div>
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
          <SaveReportButton reportType="qualification-summary" category="hr" defaultName="Qualification Summary" headers={["Employee", "Qualification", "Type", "Expiration"]} rows={qualifications.map(q => [getWorkerName(q.workerId), q.name, q.type || "", q.expirationDate || ""])} />
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
          <div className="overflow-x-auto">
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
          </div>
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
          <SaveReportButton reportType="review-summary" category="hr" defaultName="Review Summary" headers={["Employee", "Review Date", "Rating", "Status"]} rows={reviews.map(r => [getWorkerName(r.workerId), r.reviewDate || "", String(r.rating || ""), r.status || ""])} />
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
          <div className="overflow-x-auto">
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
          </div>
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

type PayrollSummaryWorker = {
  workerId: string; grossPay: number; regularPay: number; overtimePay: number; doubleTimePay: number;
  deductions: number; netPay: number; regularHours: number; overtimeHours: number; doubleTimeHours: number;
  fedWithholding: number; stateWithholding: number; sdiWithheld: number;
  ssTaxEmployee: number; ssTaxEmployer: number; medicareTaxEmployee: number; medicareTaxEmployer: number;
  ssTaxableWages: number; futaTaxableWages: number; futaTax: number;
  suiTaxableWages: number; suiTax: number; ettTax: number;
};
type PayrollSummaryGrandTotal = {
  grossPay: number; deductions: number; netPay: number; regularHours: number; overtimeHours: number;
  fedWithholding: number; stateWithholding: number; sdiWithheld: number;
  ssTaxEmployee: number; ssTaxEmployer: number; medicareTaxEmployee: number; medicareTaxEmployer: number;
  ssTaxableWages: number; futaTaxableWages: number; futaTax: number;
  suiTaxableWages: number; suiTax: number; ettTax: number;
};
type PayrollSummary = { workerTotals: PayrollSummaryWorker[]; grandTotal: PayrollSummaryGrandTotal; runCount: number };

function usePayrollData(open: boolean) {
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"], enabled: open });
  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"], enabled: open });
  const { data: payrollRuns = [] } = useQuery<PayrollRun[]>({ queryKey: ["/api/payroll-runs"], enabled: open });
  const { data: deductions = [] } = useQuery<TaxDeduction[]>({ queryKey: ["/api/taxes-deductions"], enabled: open });
  return { workers, companies, payrollRuns, deductions };
}

function usePayrollSummary(open: boolean, year: string, quarter: string, companyId: string) {
  const params = new URLSearchParams({ year });
  if (quarter) params.set("quarter", quarter);
  if (companyId && companyId !== "all") params.set("companyId", companyId);
  const { data } = useQuery<PayrollSummary>({ queryKey: ["/api/payroll-summary?" + params.toString()], enabled: open });
  const emptyGrand: PayrollSummaryGrandTotal = { grossPay: 0, deductions: 0, netPay: 0, regularHours: 0, overtimeHours: 0, fedWithholding: 0, stateWithholding: 0, sdiWithheld: 0, ssTaxEmployee: 0, ssTaxEmployer: 0, medicareTaxEmployee: 0, medicareTaxEmployer: 0, ssTaxableWages: 0, futaTaxableWages: 0, futaTax: 0, suiTaxableWages: 0, suiTax: 0, ettTax: 0 };
  return data || { workerTotals: [], grandTotal: emptyGrand, runCount: 0 };
}

type QuarterlyTaxLine = { taxCode: string; taxName: string; isEmployerPaid: boolean; stateCode: string | null; totalTaxableWages: number; totalAmount: number; itemCount: number };
type QuarterlyTaxes = { totals: QuarterlyTaxLine[]; byWorker: Record<string, Record<string, { taxableWages: number; amount: number; taxName: string; stateCode: string | null }>>; runCount: number; year: number; quarter: string | null };

function useQuarterlyTaxes(open: boolean, year: string, quarter: string, companyId: string, companies: Company[]) {
  return useQuery<QuarterlyTaxes>({
    queryKey: ["/api/companies", companyId, "quarterly-taxes", year, quarter],
    queryFn: async () => {
      const params = new URLSearchParams({ year });
      if (quarter) params.set("quarter", quarter);
      const empty: QuarterlyTaxes = { totals: [], byWorker: {}, runCount: 0, year: Number(year), quarter: quarter || null };
      const fetchOne = async (cid: string): Promise<QuarterlyTaxes> => {
        const r = await fetch(`/api/companies/${cid}/quarterly-taxes?${params}`, { credentials: "include" });
        if (!r.ok) return empty;
        return r.json();
      };
      if (companyId !== "all") return fetchOne(companyId);
      const all = await Promise.all(companies.map(c => fetchOne(c.id)));
      const merged: QuarterlyTaxes = { totals: [], byWorker: {}, runCount: 0, year: Number(year), quarter: quarter || null };
      for (const d of all) {
        merged.runCount += d.runCount;
        for (const t of d.totals) {
          const existing = merged.totals.find(x => x.taxCode === t.taxCode);
          if (existing) { existing.totalTaxableWages += t.totalTaxableWages; existing.totalAmount += t.totalAmount; existing.itemCount += t.itemCount; }
          else merged.totals.push({ ...t });
        }
        for (const [wid, lines] of Object.entries(d.byWorker)) {
          if (!merged.byWorker[wid]) merged.byWorker[wid] = {};
          for (const [code, line] of Object.entries(lines)) {
            if (!merged.byWorker[wid][code]) merged.byWorker[wid][code] = { taxableWages: 0, amount: 0, taxName: line.taxName, stateCode: line.stateCode };
            merged.byWorker[wid][code].taxableWages += line.taxableWages;
            merged.byWorker[wid][code].amount += line.amount;
          }
        }
      }
      return merged;
    },
    enabled: open && (companyId !== "all" || companies.length > 0),
  });
}

type WorkerYTD = { workerId: string; grossPay: number; federalTaxableWages: number; federalWithheld: number; ssWages: number; ssTaxEmployee: number; medicareWages: number; medicareTaxEmployee: number; caPitWages: number; caPitWithheld: number; caSdiWithheld: number; employerSsTax: number; employerMedicareTax: number; futaTax: number; caUiTax: number; caEttTax: number; netPay: number };

function useCompanyYTDTaxes(open: boolean, year: string, companyId: string, companies: Company[]) {
  return useQuery<WorkerYTD[]>({
    queryKey: ["/api/companies", companyId, "ytd-taxes", year],
    queryFn: async () => {
      const fetchOne = async (cid: string): Promise<WorkerYTD[]> => {
        const r = await fetch(`/api/companies/${cid}/ytd-taxes?year=${year}`, { credentials: "include" });
        if (!r.ok) return [];
        return r.json();
      };
      if (companyId !== "all") return fetchOne(companyId);
      const all = await Promise.all(companies.map(c => fetchOne(c.id)));
      const merged: Record<string, WorkerYTD> = {};
      for (const rows of all) {
        for (const row of rows) {
          if (!merged[row.workerId]) { merged[row.workerId] = { ...row }; continue; }
          const m = merged[row.workerId];
          m.grossPay += row.grossPay; m.federalTaxableWages += row.federalTaxableWages;
          m.federalWithheld += row.federalWithheld; m.ssWages += row.ssWages;
          m.ssTaxEmployee += row.ssTaxEmployee; m.medicareWages += row.medicareWages;
          m.medicareTaxEmployee += row.medicareTaxEmployee; m.caPitWages += row.caPitWages;
          m.caPitWithheld += row.caPitWithheld; m.caSdiWithheld += row.caSdiWithheld;
          m.netPay += row.netPay;
        }
      }
      return Object.values(merged);
    },
    enabled: open && (companyId !== "all" || companies.length > 0),
  });
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
  const { workers, companies } = usePayrollData(open);
  const { data: ytdRows = [], isLoading: loadingYtd } = useCompanyYTDTaxes(open, year, companyId, companies);

  const employees = workers.filter(w => w.workerType === "employee" && w.isActive);
  const companyEmployees = companyId === "all" ? employees : employees.filter(w => w.companyId === companyId);

  const getWorkerTotals = (worker: typeof employees[0]) => {
    const ytd = ytdRows.find(r => r.workerId === worker.id);
    if (!ytd) return { grossPay: 0, netPay: 0, fedTax: 0, ssTax: 0, medicareTax: 0, stateTax: 0, ssWages: 0, medicareWages: 0 };
    return {
      grossPay: ytd.grossPay,
      netPay: ytd.netPay,
      fedTax: ytd.federalWithheld,
      ssTax: ytd.ssTaxEmployee,
      medicareTax: ytd.medicareTaxEmployee,
      stateTax: ytd.caPitWithheld,
      ssWages: ytd.ssWages,
      medicareWages: ytd.medicareWages,
    };
  };

  const handlePrint = () => window.print();
  const handleExportCSV = () => {
    const headers = ["Employee", "SSN", "Gross Wages", "Federal Withheld", "SS Tax", "Medicare Tax", "State Withheld", "SS Wages", "Medicare Wages", "Total Deductions", "Net Pay"];
    const rows = companyEmployees.map(w => {
      const t = getWorkerTotals(w);
      return [
        `${w.firstName} ${w.lastName}`, w.ssn || "N/A",
        t.grossPay.toFixed(2), t.fedTax.toFixed(2), t.ssTax.toFixed(2),
        t.medicareTax.toFixed(2), t.stateTax.toFixed(2), t.ssWages.toFixed(2), t.medicareWages.toFixed(2),
        t.netPay.toFixed(2),
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
          <SaveReportButton reportType="w2-annual" category="tax" defaultName="W-2 Annual Report" headers={["Employee", "SSN", "Gross Pay", "Fed Withheld", "SS Tax", "Medicare Tax", "State Withheld", "Net Pay"]} rows={companyEmployees.map(w => { const t = getWorkerTotals(w); return [w.firstName + " " + w.lastName, w.ssn || "", "$" + t.grossPay.toFixed(2), "$" + t.fedTax.toFixed(2), "$" + t.ssTax.toFixed(2), "$" + t.medicareTax.toFixed(2), "$" + t.stateTax.toFixed(2), "$" + t.netPay.toFixed(2)]; })} />
        </div>
        {companyEmployees.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-w2">No W-2 eligible employees found for {year}.</p>
        ) : (
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead><TableHead>SSN</TableHead>
                <TableHead className="text-right">Gross Wages</TableHead>
                <TableHead className="text-right">Fed Withheld</TableHead>
                <TableHead className="text-right">SS Tax (6.2%)</TableHead>
                <TableHead className="text-right">Medicare (1.45%)</TableHead>
                <TableHead className="text-right">State Withheld</TableHead>
                <TableHead className="text-right">Net Pay</TableHead>
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
                    <TableCell className="text-right font-medium">${t.netPay.toFixed(2)}</TableCell>
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
                <TableCell className="text-right">${companyEmployees.reduce((s, w) => s + getWorkerTotals(w).netPay, 0).toFixed(2)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          </div>
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
  const { workers, companies } = usePayrollData(open);
  const summary = usePayrollSummary(open, year, reportType === "quarterly" ? quarter : "", companyId);

  const contractors = workers.filter(w => w.workerType === "contractor" && w.isActive);
  const filtered = companyId === "all" ? contractors : contractors.filter(w => w.companyId === companyId);

  const getContractorPay = (worker: typeof contractors[0]) => {
    const wt = summary.workerTotals.find(t => t.workerId === worker.id);
    return wt ? wt.grossPay : 0;
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
          <SaveReportButton reportType="1099-nec" category="tax" defaultName="Form 1099-NEC" headers={["Contractor", "TIN", "Compensation"]} rows={contractors.map(c => [c.firstName + " " + c.lastName, c.ssn || "", "$" + (Number(c.payRate || 0) * 2080).toFixed(2)])} />
        </div>
        {filtered.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-1099">No contractors found for the selected period.</p>
        ) : (
          <div className="overflow-x-auto">
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Form941Dialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState("Q1");
  const [companyId, setCompanyId] = useState("all");
  const { workers, companies } = usePayrollData(open);
  const { data: qTaxes, isLoading: loadingQTaxes } = useQuarterlyTaxes(open, year, quarter, companyId, companies);

  const employees = workers.filter(w => w.workerType === "employee" && w.isActive);
  const filtered = companyId === "all" ? employees : employees.filter(w => w.companyId === companyId);

  const totals = qTaxes?.totals || [];
  const getAmt = (code: string) => totals.find(t => t.taxCode === code)?.totalAmount || 0;
  const getTaxableWages = (code: string) => totals.find(t => t.taxCode === code)?.totalTaxableWages || 0;

  const totalWages = Object.values(qTaxes?.byWorker || {}).reduce((s, lines) => s + (lines["__grossPay"]?.amount || 0), 0);
  const fedWithholding = getAmt("fed_income_tax");
  const ssEmployee = getAmt("ss_employee");
  const ssEmployer = getAmt("ss_employer");
  const medicareEmployee = getAmt("medicare_employee");
  const medicareEmployer = getAmt("medicare_employer");
  const ssTaxableWages = getTaxableWages("ss_employee");
  const totalTaxDeposits = fedWithholding + ssEmployee + ssEmployer + medicareEmployee + medicareEmployer;
  const dataSource = (qTaxes?.runCount || 0) > 0 ? `Based on ${qTaxes?.runCount} processed payroll runs` : "No processed payroll runs found for this period";

  const handleExportCSV = () => {
    const headers = ["Line Item", "Amount"];
    const rows = [
      ["Number of employees", String(filtered.length)],
      ["Total wages, tips, compensation", totalWages.toFixed(2)],
      ["Federal income tax withheld", fedWithholding.toFixed(2)],
      ["SS taxable wages (capped at $168,600/employee)", ssTaxableWages.toFixed(2)],
      ["Social Security tax — employee (6.2%)", ssEmployee.toFixed(2)],
      ["Social Security tax — employer (6.2%)", ssEmployer.toFixed(2)],
      ["Medicare wages", totalWages.toFixed(2)],
      ["Medicare tax — employee (1.45%)", medicareEmployee.toFixed(2)],
      ["Medicare tax — employer (1.45%)", medicareEmployer.toFixed(2)],
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
          <SaveReportButton reportType="form-941" category="tax" defaultName="Form 941" headers={["Line", "Description", "Amount"]} rows={[["1", "Employees", String(filtered.length)], ["2", "Wages", "$" + totalWages.toFixed(2)], ["3", "Federal Income Tax Withheld", "$" + fedWithholding.toFixed(2)], ["5a wages", "SS Taxable Wages", "$" + ssTaxableWages.toFixed(2)], ["5a tax", "SS Tax (both halves)", "$" + (ssEmployee + ssEmployer).toFixed(2)], ["5c wages", "Medicare Wages", "$" + totalWages.toFixed(2)], ["5c tax", "Medicare Tax (both halves)", "$" + (medicareEmployee + medicareEmployer).toFixed(2)], ["10", "Total Taxes", "$" + totalTaxDeposits.toFixed(2)]]} />
        </div>
        <div className="border rounded-lg p-4 space-y-3 mt-2">
          <h3 className="font-semibold text-sm">Form 941 — {quarter} {year}</h3>
          <p className="text-xs text-muted-foreground italic">{dataSource}</p>
          {loadingQTaxes && <div className="py-4 text-center text-muted-foreground text-sm">Loading stored tax data…</div>}
          <div className="overflow-x-auto">
          <Table>
            <TableBody>
              <TableRow><TableCell>1. Number of employees who received wages</TableCell><TableCell className="text-right font-medium">{filtered.length}</TableCell></TableRow>
              <TableRow><TableCell>2. Wages, tips, and other compensation</TableCell><TableCell className="text-right font-medium">${totalWages.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>3. Federal income tax withheld</TableCell><TableCell className="text-right font-medium">${fedWithholding.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>5a. Taxable Social Security wages (capped at $168,600/employee)</TableCell><TableCell className="text-right font-medium">${ssTaxableWages.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell className="pl-6 text-muted-foreground">SS tax — employee (6.2%)</TableCell><TableCell className="text-right">${ssEmployee.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell className="pl-6 text-muted-foreground">SS tax — employer (6.2%)</TableCell><TableCell className="text-right">${ssEmployer.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>5c. Taxable Medicare wages & tips</TableCell><TableCell className="text-right font-medium">${totalWages.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell className="pl-6 text-muted-foreground">Medicare tax — employee (1.45%)</TableCell><TableCell className="text-right">${medicareEmployee.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell className="pl-6 text-muted-foreground">Medicare tax — employer (1.45%)</TableCell><TableCell className="text-right">${medicareEmployer.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>5d. Total SS and Medicare taxes</TableCell><TableCell className="text-right font-medium">${(ssEmployee + ssEmployer + medicareEmployee + medicareEmployer).toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>6. Total taxes before adjustments (line 3 + line 5d)</TableCell><TableCell className="text-right font-medium">${totalTaxDeposits.toFixed(2)}</TableCell></TableRow>
              <TableRow className="font-bold"><TableCell>10. Total taxes after adjustments</TableCell><TableCell className="text-right">${totalTaxDeposits.toFixed(2)}</TableCell></TableRow>
            </TableBody>
          </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Form940Dialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [companyId, setCompanyId] = useState("all");
  const { workers, companies } = usePayrollData(open);
  const summary = usePayrollSummary(open, year, "", companyId);

  const employees = workers.filter(w => w.workerType === "employee" && w.isActive);
  const filtered = companyId === "all" ? employees : employees.filter(w => w.companyId === companyId);

  const g940 = summary.grandTotal;
  const totalWages = g940.grossPay;
  const futaWages = g940.futaTaxableWages;
  const futaTax = g940.futaTax;
  const stateCredit = futaWages * 0.054;

  const handleExportCSV = () => {
    const headers = ["Line Item", "Amount"];
    const rows = [
      ["Total payments to employees", totalWages.toFixed(2)],
      ["FUTA taxable wages (first $7,000/employee)", futaWages.toFixed(2)],
      ["FUTA tax before adjustments (0.6%)", futaTax.toFixed(2)],
      ["State unemployment tax credit (5.4%)", stateCredit.toFixed(2)],
      ["Total FUTA tax (net after credit)", futaTax.toFixed(2)],
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
          <SaveReportButton reportType="form-940" category="tax" defaultName="Form 940" headers={["Line", "Description", "Amount"]} rows={[["3", "Total FUTA Wages", "$" + totalWages.toFixed(2)], ["8", "FUTA Tax Before Adj", "$" + futaTax.toFixed(2)]]} />
        </div>
        <div className="border rounded-lg p-4 space-y-3 mt-2">
          <h3 className="font-semibold text-sm">Form 940 — {year}</h3>
          <div className="overflow-x-auto">
          <Table>
            <TableBody>
              <TableRow><TableCell>3. Total payments to all employees</TableCell><TableCell className="text-right font-medium">${totalWages.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>7. Total taxable FUTA wages (first $7,000/employee)</TableCell><TableCell className="text-right font-medium">${futaWages.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>8. FUTA tax before adjustments (0.6%)</TableCell><TableCell className="text-right font-medium">${futaTax.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>9. State unemployment tax credit (5.4%)</TableCell><TableCell className="text-right font-medium">${stateCredit.toFixed(2)}</TableCell></TableRow>
              <TableRow className="font-bold"><TableCell>14. Total FUTA tax</TableCell><TableCell className="text-right">${futaTax.toFixed(2)}</TableCell></TableRow>
            </TableBody>
          </Table>
          </div>
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
  const { data: qTaxes, isLoading: loadingDE9 } = useQuarterlyTaxes(open, year, quarter, companyId, companies);

  const employees = workers.filter(w => w.workerType === "employee" && w.isActive);
  const filtered = companyId === "all" ? employees : employees.filter(w => w.companyId === companyId);

  const totals = qTaxes?.totals || [];
  const getAmt = (code: string) => totals.find(t => t.taxCode === code)?.totalAmount || 0;
  const getTaxableWages = (code: string) => totals.find(t => t.taxCode === code)?.totalTaxableWages || 0;

  const totalWages = Object.values(qTaxes?.byWorker || {}).reduce((s, lines) => s + (lines["__grossPay"]?.amount || 0), 0);
  const pitWithheld = getAmt("ca_pit");
  const sdiWithheld = getAmt("ca_sdi");
  const suiWages = getTaxableWages("ca_ui");
  const suiContrib = getAmt("ca_ui");
  const ettContrib = getAmt("ca_ett");
  const de9DataSource = (qTaxes?.runCount || 0) > 0 ? `Based on ${qTaxes?.runCount} processed payroll runs` : "No processed payroll runs found for this period";

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
          <SaveReportButton reportType="de9" category="tax" defaultName="DE 9" headers={["Line", "Description", "Amount"]} rows={[["A", "Total Subject Wages", "$" + totalWages.toFixed(2)], ["D", "SDI Withholding", "$" + sdiWithheld.toFixed(2)], ["E", "PIT Withholding", "$" + pitWithheld.toFixed(2)]]} />
        </div>
        <div className="border rounded-lg p-4 space-y-3 mt-2">
          <h3 className="font-semibold text-sm">California DE 9 — {quarter} {year}</h3>
          <p className="text-xs text-muted-foreground italic">{de9DataSource}</p>
          {loadingDE9 && <div className="py-4 text-center text-muted-foreground text-sm">Loading stored tax data…</div>}
          <div className="overflow-x-auto">
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
          </div>
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
  const { data: qTaxes, isLoading: loadingDE9C } = useQuarterlyTaxes(open, year, quarter, companyId, companies);

  const employees = workers.filter(w => w.workerType === "employee" && w.isActive);
  const filtered = companyId === "all" ? employees : employees.filter(w => w.companyId === companyId);
  const byWorker = qTaxes?.byWorker || {};

  const getWorkerData = (w: typeof employees[0]) => {
    const lines = byWorker[w.id] || {};
    const pitWages = lines["ca_pit"]?.taxableWages ?? 0;
    const pitWithheld = lines["ca_pit"]?.amount ?? 0;
    const sdiWages = lines["ca_sdi"]?.taxableWages ?? 0;
    const sdiWithheld = lines["ca_sdi"]?.amount ?? 0;
    const grossPay = lines["__grossPay"]?.amount ?? 0;
    return { wages: grossPay || pitWages, pitWithheld, sdiWages: grossPay || sdiWages, sdiWithheld };
  };

  const de9cTotals = filtered.reduce((acc, w) => {
    const d = getWorkerData(w);
    return { wages: acc.wages + d.wages, pitWithheld: acc.pitWithheld + d.pitWithheld, sdiWages: acc.sdiWages + d.sdiWages, sdiWithheld: acc.sdiWithheld + d.sdiWithheld };
  }, { wages: 0, pitWithheld: 0, sdiWages: 0, sdiWithheld: 0 });

  const handleExportCSV = () => {
    const headers = ["SSN", "Last Name", "First Name", "PIT Wages", "PIT Withheld", "SDI Wages", "SDI Withheld"];
    const rows = filtered.map(w => {
      const d = getWorkerData(w);
      return [
        w.ssn || "N/A", w.lastName, w.firstName,
        d.wages.toFixed(2), d.pitWithheld.toFixed(2),
        d.sdiWages.toFixed(2), d.sdiWithheld.toFixed(2),
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
          <SaveReportButton reportType="de9c" category="tax" defaultName="DE 9C" headers={["Employee", "SSN", "PIT Wages", "PIT Withheld", "SDI Wages", "SDI Withheld"]} rows={filtered.map(e => { const d = getWorkerData(e); return [e.firstName + " " + e.lastName, e.ssn || "", "$" + d.wages.toFixed(2), "$" + d.pitWithheld.toFixed(2), "$" + d.sdiWages.toFixed(2), "$" + d.sdiWithheld.toFixed(2)]; })} />
        </div>
        {loadingDE9C && <div className="py-4 text-center text-muted-foreground text-sm">Loading stored tax data…</div>}
        {filtered.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-de9c">No employees found for the selected period.</p>
        ) : (
          <div className="overflow-x-auto">
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
                const d = getWorkerData(w);
                return (
                  <TableRow key={w.id} data-testid={`row-de9c-${w.id}`}>
                    <TableCell>{w.ssn ? `***-**-${w.ssn.slice(-4)}` : "N/A"}</TableCell>
                    <TableCell>{w.lastName}</TableCell>
                    <TableCell>{w.firstName}</TableCell>
                    <TableCell className="text-right">${d.wages.toFixed(2)}</TableCell>
                    <TableCell className="text-right">${d.pitWithheld.toFixed(2)}</TableCell>
                    <TableCell className="text-right">${d.sdiWages.toFixed(2)}</TableCell>
                    <TableCell className="text-right">${d.sdiWithheld.toFixed(2)}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="font-bold border-t-2">
                <TableCell colSpan={3}>Totals</TableCell>
                <TableCell className="text-right">${de9cTotals.wages.toFixed(2)}</TableCell>
                <TableCell className="text-right">${de9cTotals.pitWithheld.toFixed(2)}</TableCell>
                <TableCell className="text-right">${de9cTotals.sdiWages.toFixed(2)}</TableCell>
                <TableCell className="text-right">${de9cTotals.sdiWithheld.toFixed(2)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-2">File with: California Employment Development Department (EDD) — accompanies DE 9</p>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeEarningsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [companyId, setCompanyId] = useState("all");
  const { workers, companies } = usePayrollData(open);
  const { data: ytdRows = [], isLoading: loadingYtd } = useCompanyYTDTaxes(open, year, companyId, companies);

  const employees = workers.filter(w => w.workerType === "employee" && w.isActive);
  const filtered = companyId === "all" ? employees : employees.filter(w => w.companyId === companyId);

  const getYtd = (workerId: string) => ytdRows.find(r => r.workerId === workerId);

  const totals = filtered.reduce((acc, w) => {
    const y = getYtd(w.id);
    if (!y) return acc;
    return {
      grossPay: acc.grossPay + y.grossPay,
      federalWithheld: acc.federalWithheld + y.federalWithheld,
      ssTaxEmployee: acc.ssTaxEmployee + y.ssTaxEmployee,
      medicareTaxEmployee: acc.medicareTaxEmployee + y.medicareTaxEmployee,
      caPitWithheld: acc.caPitWithheld + y.caPitWithheld,
      caSdiWithheld: acc.caSdiWithheld + y.caSdiWithheld,
      netPay: acc.netPay + y.netPay,
    };
  }, { grossPay: 0, federalWithheld: 0, ssTaxEmployee: 0, medicareTaxEmployee: 0, caPitWithheld: 0, caSdiWithheld: 0, netPay: 0 });

  const handleExportCSV = () => {
    const headers = ["Employee", "Gross Pay", "Fed Withheld", "SS Tax (Emp)", "Medicare (Emp)", "CA PIT", "CA SDI", "Total Deductions", "Net Pay"];
    const rows = filtered.map(w => {
      const y = getYtd(w.id);
      const totalDed = (y?.federalWithheld || 0) + (y?.ssTaxEmployee || 0) + (y?.medicareTaxEmployee || 0) + (y?.caPitWithheld || 0) + (y?.caSdiWithheld || 0);
      return [
        `${w.firstName} ${w.lastName}`,
        (y?.grossPay || 0).toFixed(2),
        (y?.federalWithheld || 0).toFixed(2),
        (y?.ssTaxEmployee || 0).toFixed(2),
        (y?.medicareTaxEmployee || 0).toFixed(2),
        (y?.caPitWithheld || 0).toFixed(2),
        (y?.caSdiWithheld || 0).toFixed(2),
        totalDed.toFixed(2),
        (y?.netPay || 0).toFixed(2),
      ];
    });
    downloadCSV(headers, rows, `employee_earnings_${year}.csv`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-earnings">Employee Earnings Report — YTD {year}</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">Year-to-date gross pay, tax withholdings, and net pay per employee — sourced from stored payroll item tax records.</p>
        </DialogHeader>
        <TaxReportFilters year={year} setYear={setYear} quarter="" setQuarter={() => {}} companyId={companyId} setCompanyId={setCompanyId} companies={companies} showQuarter={false} />
        <div className="flex items-center gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="button-print-earnings"><Printer className="mr-2 h-4 w-4" />Print</Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-earnings"><Download className="mr-2 h-4 w-4" />Export CSV</Button>
          <SaveReportButton
            reportType="employee-earnings"
            category="tax"
            defaultName="Employee Earnings"
            headers={["Employee", "Gross Pay", "Fed Withheld", "SS Tax", "Medicare", "CA PIT", "CA SDI", "Net Pay"]}
            rows={filtered.map(w => {
              const y = getYtd(w.id);
              return [`${w.firstName} ${w.lastName}`, "$" + (y?.grossPay || 0).toFixed(2), "$" + (y?.federalWithheld || 0).toFixed(2), "$" + (y?.ssTaxEmployee || 0).toFixed(2), "$" + (y?.medicareTaxEmployee || 0).toFixed(2), "$" + (y?.caPitWithheld || 0).toFixed(2), "$" + (y?.caSdiWithheld || 0).toFixed(2), "$" + (y?.netPay || 0).toFixed(2)];
            })}
          />
        </div>
        {loadingYtd && <div className="py-4 text-center text-muted-foreground text-sm">Loading stored tax data…</div>}
        {filtered.length === 0 ? (
          <p className="text-muted-foreground py-4" data-testid="text-no-earnings">No employees found.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Gross Pay</TableHead>
                  <TableHead className="text-right">Fed Withheld</TableHead>
                  <TableHead className="text-right">SS Tax (Emp)</TableHead>
                  <TableHead className="text-right">Medicare (Emp)</TableHead>
                  <TableHead className="text-right">CA PIT</TableHead>
                  <TableHead className="text-right">CA SDI</TableHead>
                  <TableHead className="text-right">Total Deducted</TableHead>
                  <TableHead className="text-right">Net Pay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(w => {
                  const y = getYtd(w.id);
                  const totalDed = (y?.federalWithheld || 0) + (y?.ssTaxEmployee || 0) + (y?.medicareTaxEmployee || 0) + (y?.caPitWithheld || 0) + (y?.caSdiWithheld || 0);
                  return (
                    <TableRow key={w.id} data-testid={`row-earnings-${w.id}`}>
                      <TableCell className="font-medium">{w.firstName} {w.lastName}</TableCell>
                      <TableCell className="text-right">${(y?.grossPay || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right">${(y?.federalWithheld || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right">${(y?.ssTaxEmployee || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right">${(y?.medicareTaxEmployee || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right">${(y?.caPitWithheld || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right">${(y?.caSdiWithheld || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right">${totalDed.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-medium">${(y?.netPay || 0).toFixed(2)}</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="font-bold border-t-2">
                  <TableCell>Totals ({filtered.length} employees)</TableCell>
                  <TableCell className="text-right">${totals.grossPay.toFixed(2)}</TableCell>
                  <TableCell className="text-right">${totals.federalWithheld.toFixed(2)}</TableCell>
                  <TableCell className="text-right">${totals.ssTaxEmployee.toFixed(2)}</TableCell>
                  <TableCell className="text-right">${totals.medicareTaxEmployee.toFixed(2)}</TableCell>
                  <TableCell className="text-right">${totals.caPitWithheld.toFixed(2)}</TableCell>
                  <TableCell className="text-right">${totals.caSdiWithheld.toFixed(2)}</TableCell>
                  <TableCell className="text-right">${(totals.federalWithheld + totals.ssTaxEmployee + totals.medicareTaxEmployee + totals.caPitWithheld + totals.caSdiWithheld).toFixed(2)}</TableCell>
                  <TableCell className="text-right">${totals.netPay.toFixed(2)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Form1096Dialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [companyId, setCompanyId] = useState("all");
  const { workers, companies } = usePayrollData(open);
  const summary = usePayrollSummary(open, year, "", companyId);

  const contractors = workers.filter(w => w.workerType === "contractor" && w.isActive);
  const filtered = companyId === "all" ? contractors : contractors.filter(w => w.companyId === companyId);
  const eligible = filtered.filter(w => {
    const wt = summary.workerTotals.find(t => t.workerId === w.id);
    return wt ? wt.grossPay >= 600 : false;
  });
  const totalComp = eligible.reduce((s, w) => {
    const wt = summary.workerTotals.find(t => t.workerId === w.id);
    return s + (wt ? wt.grossPay : 0);
  }, 0);

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
          <SaveReportButton reportType="form-1096" category="tax" defaultName="Form 1096" headers={["Line", "Description", "Amount"]} rows={[["1", "Filer Name/Address", ""], ["3", "Number of 1099s", String(eligible.length)], ["5", "Total Amount", "$" + totalComp.toFixed(2)]]} />
        </div>
        <div className="border rounded-lg p-4 space-y-3 mt-2">
          <h3 className="font-semibold text-sm">Form 1096 — Annual Summary and Transmittal of U.S. Information Returns — {year}</h3>
          <p className="text-xs text-muted-foreground">This form accompanies paper filings of 1099-NEC forms submitted to the IRS.</p>
          <div className="overflow-x-auto">
          <Table>
            <TableBody>
              <TableRow><TableCell>Filer's name and address</TableCell><TableCell className="text-right font-medium">{companyId !== "all" ? companies.find(c => c.id === companyId)?.name || "—" : "All Companies"}</TableCell></TableRow>
              <TableRow><TableCell>Type of form being transmitted</TableCell><TableCell className="text-right font-medium">1099-NEC</TableCell></TableRow>
              <TableRow><TableCell>Box 3 — Number of forms</TableCell><TableCell className="text-right font-medium">{eligible.length}</TableCell></TableRow>
              <TableRow><TableCell>Box 4 — Federal income tax withheld</TableCell><TableCell className="text-right font-medium">$0.00</TableCell></TableRow>
              <TableRow className="font-bold"><TableCell>Box 5 — Total amount reported</TableCell><TableCell className="text-right">${totalComp.toFixed(2)}</TableCell></TableRow>
            </TableBody>
          </Table>
          </div>
          <p className="text-xs text-muted-foreground">File with: Internal Revenue Service (IRS) — accompanies paper 1099-NEC submissions</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Tax Liability Dialog (Task #4) ────────────────────────────────────────

type TaxLiabilityRow = {
  taxCode: string; taxName: string; isEmployerPaid: boolean; stateCode: string | null;
  totalTaxableWages: number; totalAmount: number; periodCount: number;
};

function TaxLiabilityDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [companyId, setCompanyId] = useState("all");
  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"], enabled: open });
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  // Per-company data when "all" is selected — never merged across legal entities
  const { data: perCompanyLiability = [], isLoading: loadingAll } = useQuery<{ company: Company; rows: TaxLiabilityRow[] }[]>({
    queryKey: ["/api/all-companies", "tax-liability", startDate, endDate],
    queryFn: async () => {
      const results = await Promise.all(companies.map(async (c) => {
        const r = await fetch(`/api/companies/${c.id}/tax-liability?startDate=${startDate}&endDate=${endDate}`, { credentials: "include" });
        if (!r.ok) return { company: c, rows: [] as TaxLiabilityRow[] };
        return { company: c, rows: await r.json() as TaxLiabilityRow[] };
      }));
      return results;
    },
    enabled: open && companyId === "all" && companies.length > 0,
  });

  // Single-company data
  const { data: liability = [], isLoading: loadingSingle } = useQuery<TaxLiabilityRow[]>({
    queryKey: ["/api/companies", companyId, "tax-liability", startDate, endDate],
    queryFn: async () => {
      const r = await fetch(`/api/companies/${companyId}/tax-liability?startDate=${startDate}&endDate=${endDate}`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: open && companyId !== "all",
  });

  const isLoading = companyId === "all" ? loadingAll : loadingSingle;
  const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const flatLiability = companyId === "all"
    ? perCompanyLiability.flatMap(p => p.rows)
    : liability;

  const handleExportCSV = () => {
    const headers = ["Company", "Tax Code", "Tax Name", "Payer", "State", "Taxable Wages", "Amount", "Line Items"];
    const rows = companyId === "all"
      ? perCompanyLiability.flatMap(p => p.rows.map(r => [
          p.company.name, r.taxCode, r.taxName, r.isEmployerPaid ? "Employer" : "Employee",
          r.stateCode || "Federal", fmt(r.totalTaxableWages), fmt(r.totalAmount), String(r.periodCount),
        ]))
      : liability.map(r => [
          companies.find(c => c.id === companyId)?.name || companyId,
          r.taxCode, r.taxName, r.isEmployerPaid ? "Employer" : "Employee",
          r.stateCode || "Federal", fmt(r.totalTaxableWages), fmt(r.totalAmount), String(r.periodCount),
        ]);
    downloadCSV(headers, rows, `tax_liability_${year}.csv`);
  };

  const renderTaxTable = (rows: TaxLiabilityRow[]) => {
    const employeeTaxes = rows.filter(r => !r.isEmployerPaid);
    const employerTaxes = rows.filter(r => r.isEmployerPaid);
    const renderSection = (title: string, sectionRows: TaxLiabilityRow[]) => (
      <div className="space-y-1">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</h4>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tax Code</TableHead>
              <TableHead>Tax Name</TableHead>
              <TableHead>Jurisdiction</TableHead>
              <TableHead className="text-right">Taxable Wages</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Lines</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sectionRows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">No data.</TableCell></TableRow>
            ) : sectionRows.map(r => (
              <TableRow key={r.taxCode} data-testid={`row-tax-liability-${r.taxCode}`}>
                <TableCell className="font-mono text-xs">{r.taxCode}</TableCell>
                <TableCell>{r.taxName}</TableCell>
                <TableCell><Badge variant="outline">{r.stateCode || "Federal"}</Badge></TableCell>
                <TableCell className="text-right">{fmt(r.totalTaxableWages)}</TableCell>
                <TableCell className="text-right font-medium">{fmt(r.totalAmount)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{r.periodCount}</TableCell>
              </TableRow>
            ))}
            {sectionRows.length > 0 && (
              <TableRow className="font-semibold border-t">
                <TableCell colSpan={4}>Subtotal</TableCell>
                <TableCell className="text-right">{fmt(sectionRows.reduce((s, r) => s + r.totalAmount, 0))}</TableCell>
                <TableCell></TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    );
    return (
      <div className="space-y-4 overflow-x-auto">
        {renderSection("Employee-Paid Taxes", employeeTaxes)}
        {renderSection("Employer-Paid Taxes", employerTaxes)}
        <div className="flex justify-between text-sm font-bold border-t pt-2">
          <span>Total</span>
          <span>{fmt(rows.reduce((s, r) => s + r.totalAmount, 0))}</span>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto" data-testid="dialog-tax-liability">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-tax-liability">Tax Liability Report — {year}</DialogTitle>
        </DialogHeader>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <Label className="text-xs">Year</Label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-[100px]" data-testid="select-liability-year"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[currentYear, currentYear - 1, currentYear - 2].map(y => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Legal Entity / Company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger className="w-[220px]" data-testid="select-liability-company"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Companies (per-entity view)</SelectItem>
                {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="button-print-liability"><Printer className="mr-2 h-4 w-4" />Print</Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-liability"><Download className="mr-2 h-4 w-4" />Export CSV</Button>
          <SaveReportButton reportType="tax-liability" category="tax" defaultName={`Tax Liability ${year}`} headers={["Tax Code", "Tax Name", "Payer", "Amount"]} rows={flatLiability.map(r => [r.taxCode, r.taxName, r.isEmployerPaid ? "Employer" : "Employee", fmt(r.totalAmount)])} />
        </div>
        {isLoading ? (
          <div className="space-y-2 mt-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : companyId === "all" ? (
          <div className="space-y-8 mt-4">
            {perCompanyLiability.length === 0 ? (
              <p className="text-muted-foreground text-sm">No companies found.</p>
            ) : perCompanyLiability.map(({ company, rows }) => (
              <div key={company.id} className="space-y-3 border rounded-lg p-4" data-testid={`section-company-${company.id}`}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">{company.name}</h3>
                  <Badge variant="secondary" className="text-xs">
                    {fmt(rows.reduce((s, r) => s + r.totalAmount, 0))} total liability
                  </Badge>
                </div>
                {rows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No processed payrolls in {year}.</p>
                ) : renderTaxTable(rows)}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4">
            {renderTaxTable(liability)}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Tax Audit Dialog (Task #4) ─────────────────────────────────────────────

type PayrollOverrideRow = {
  id: string; payrollItemId: string; taxCode: string;
  overriddenAmount: string; reason: string | null;
  overriddenBy: string | null; overriddenAt: string;
};

function TaxAuditDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("all");

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"], enabled: open });
  const { data: allRuns = [], isLoading: loadingRuns } = useQuery<PayrollRun[]>({ queryKey: ["/api/payroll-runs"], enabled: open });

  const filteredRuns = selectedCompanyId === "all" ? allRuns : allRuns.filter(r => r.companyId === selectedCompanyId);
  const runId = selectedRunId || filteredRuns[0]?.id || "";

  const { data: overrides = [], isLoading: loadingOverrides } = useQuery<PayrollOverrideRow[]>({
    queryKey: ["/api/payroll-runs", runId, "tax-overrides"],
    queryFn: async () => {
      if (!runId) return [];
      const r = await fetch(`/api/payroll-runs/${runId}/tax-overrides`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!runId && open,
  });

  const { data: taxLines = [], isLoading: loadingTaxLines } = useQuery<any[]>({
    queryKey: ["/api/payroll-runs", runId, "taxes"],
    queryFn: async () => {
      if (!runId) return [];
      const r = await fetch(`/api/payroll-runs/${runId}/taxes`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!runId && open,
  });

  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"], enabled: open });
  const { data: items = [] } = useQuery<any[]>({
    queryKey: ["/api/payroll-runs", runId, "items"],
    queryFn: async () => {
      if (!runId) return [];
      const r = await fetch(`/api/payroll-runs/${runId}/items`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!runId && open,
  });

  const { data: snapshotRaw } = useQuery<{ snapshotJson: string; engineVersion: string; createdAt: string } | null>({
    queryKey: ["/api/payroll-runs", runId, "tax-snapshot"],
    queryFn: async () => {
      if (!runId) return null;
      const r = await fetch(`/api/payroll-runs/${runId}/tax-snapshot`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!runId && open,
  });

  const snapshot = snapshotRaw?.snapshotJson ? (() => { try { return JSON.parse(snapshotRaw.snapshotJson); } catch { return null; } })() : null;

  const run = allRuns.find(r => r.id === runId);
  const isLoading = loadingRuns || loadingOverrides || loadingTaxLines;
  const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const getWorkerName = (workerId: string) => {
    const w = workers.find(w => w.id === workerId);
    return w ? `${w.firstName} ${w.lastName}` : workerId;
  };
  const getWorkerForItem = (itemId: string) => {
    const item = items.find((i: any) => i.id === itemId);
    return item ? getWorkerName(item.workerId) : "—";
  };

  const NON_TAX_AUDIT_CODES = ["PRE_TAX_DED", "POST_TAX_DED", "AMENDMENT_DED"];
  const taxOnlyLines = taxLines.filter((l: any) => !NON_TAX_AUDIT_CODES.includes(l.taxCode));

  const groupedTaxLines = taxOnlyLines.reduce<Record<string, any[]>>((acc, line) => {
    const key = line.taxCode;
    if (!acc[key]) acc[key] = [];
    acc[key].push(line);
    return acc;
  }, {});

  const summaryRows = Object.entries(groupedTaxLines).map(([code, lines]) => ({
    taxCode: code,
    taxName: lines[0]?.taxName || code,
    isEmployerPaid: lines[0]?.isEmployerPaid || false,
    total: lines.reduce((s: number, l: any) => s + Number(l.amount || 0), 0),
    count: lines.length,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto" data-testid="dialog-tax-audit">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-tax-audit">Tax Audit — Per-Run Breakdown</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Company</Label>
            <Select value={selectedCompanyId} onValueChange={v => { setSelectedCompanyId(v); setSelectedRunId(""); }}>
              <SelectTrigger className="w-[180px]" data-testid="select-audit-company"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Companies</SelectItem>
                {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Payroll Run</Label>
            <Select value={runId} onValueChange={setSelectedRunId}>
              <SelectTrigger className="w-[280px]" data-testid="select-audit-run"><SelectValue placeholder="Select a run" /></SelectTrigger>
              <SelectContent>
                {filteredRuns.map(r => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.periodStart} – {r.periodEnd}{r.payDate ? ` (Pay: ${r.payDate})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="button-print-audit"><Printer className="mr-2 h-4 w-4" />Print</Button>
        </div>

        {!runId ? (
          <p className="text-muted-foreground py-8 text-center text-sm">Select a payroll run to view the tax audit.</p>
        ) : isLoading ? (
          <div className="space-y-2 mt-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : (
          <div className="space-y-6 mt-4">
            {/* Run Tax Summary */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Tax Summary — {run?.periodStart} to {run?.periodEnd}</h3>
              {summaryRows.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No stored tax lines for this run. Re-process the payroll to generate tax engine data.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tax Code</TableHead>
                        <TableHead>Tax Name</TableHead>
                        <TableHead>Payer</TableHead>
                        <TableHead className="text-right">Total Amount</TableHead>
                        <TableHead className="text-right">Employee Lines</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summaryRows.map(r => (
                        <TableRow key={r.taxCode} data-testid={`row-audit-tax-${r.taxCode}`}>
                          <TableCell className="font-mono text-xs">{r.taxCode}</TableCell>
                          <TableCell>{r.taxName}</TableCell>
                          <TableCell>
                            <Badge variant={r.isEmployerPaid ? "secondary" : "outline"}>
                              {r.isEmployerPaid ? "Employer" : "Employee"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium">{fmt(r.total)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{r.count}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold border-t-2">
                        <TableCell colSpan={3}>Total</TableCell>
                        <TableCell className="text-right">{fmt(summaryRows.reduce((s, r) => s + r.total, 0))}</TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* Overrides */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                Tax Overrides
                {overrides.length > 0 && <Badge variant="destructive">{overrides.length} override{overrides.length !== 1 ? "s" : ""}</Badge>}
              </h3>
              {overrides.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tax overrides recorded for this run.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Tax Code</TableHead>
                        <TableHead className="text-right">Original</TableHead>
                        <TableHead className="text-right">Overridden</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Overridden By</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overrides.map(o => (
                        <TableRow key={o.id} data-testid={`row-override-${o.id}`}>
                          <TableCell>{getWorkerForItem(o.payrollItemId)}</TableCell>
                          <TableCell className="font-mono text-xs">{o.taxCode}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{fmt(Number((o as any).originalAmount || 0))}</TableCell>
                          <TableCell className="text-right font-medium">{fmt(Number(o.overriddenAmount))}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{o.reason || "—"}</TableCell>
                          <TableCell className="text-sm">{o.overriddenBy || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {o.overriddenAt ? new Date(o.overriddenAt).toLocaleDateString() : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* Snapshot Inputs — engine state captured at processing time */}
            {snapshot && snapshot.workers && snapshot.workers.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">
                  Snapshot Inputs
                  {snapshotRaw && <span className="text-xs font-normal text-muted-foreground ml-2">Engine v{snapshotRaw.engineVersion} · Captured {new Date(snapshotRaw.createdAt).toLocaleString()}</span>}
                </h3>
                <p className="text-xs text-muted-foreground">Full tax engine inputs recorded at processing time for reproducible audit. Compare against current tax lines to detect overrides or reprocessing drift.</p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Filing Status</TableHead>
                        <TableHead className="text-right">W-4 Allow.</TableHead>
                        <TableHead className="text-right">Add. Withholding</TableHead>
                        <TableHead>Pay Period</TableHead>
                        <TableHead className="text-right">Gross Pay</TableHead>
                        <TableHead className="text-right">Taxable Wages</TableHead>
                        <TableHead className="text-right">Pre-Tax Ded.</TableHead>
                        <TableHead className="text-right">YTD Gross (Prior)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snapshot.workers.map((w: any) => (
                        <TableRow key={w.workerId} data-testid={`row-snapshot-${w.workerId}`}>
                          <TableCell>{getWorkerName(w.workerId)}</TableCell>
                          <TableCell className="capitalize">{w.filingStatus ?? "single"}</TableCell>
                          <TableCell className="text-right">{w.w4Allowances ?? 0}</TableCell>
                          <TableCell className="text-right">{w.additionalWithholding != null ? fmt(Number(w.additionalWithholding)) : "—"}</TableCell>
                          <TableCell className="text-xs">{w.payPeriodType ?? "—"}</TableCell>
                          <TableCell className="text-right">{w.grossPay != null ? fmt(Number(w.grossPay)) : "—"}</TableCell>
                          <TableCell className="text-right">{w.taxableWages != null ? fmt(Number(w.taxableWages)) : "—"}</TableCell>
                          <TableCell className="text-right">{w.preTaxDeductions != null ? fmt(Number(w.preTaxDeductions)) : "—"}</TableCell>
                          <TableCell className="text-right">{w.ytdGross != null ? fmt(Number(w.ytdGross)) : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Snapshot vs Stored comparison per worker */}
                <h4 className="text-xs font-semibold text-muted-foreground mt-3">Snapshot Tax Lines vs. Stored (Overrides Highlighted)</h4>
                {snapshot.workers.map((sw: any) => {
                  const workerItem = items.find((i: any) => i.workerId === sw.workerId);
                  const storedLines: Record<string, number> = taxOnlyLines
                    .filter((l: any) => l.payrollItemId === workerItem?.id)
                    .reduce((acc: Record<string, number>, l: any) => { acc[l.taxCode] = Number(l.amount || 0); return acc; }, {});
                  const snapTaxLines: any[] = (sw.taxLines || []).filter((l: any) => !NON_TAX_AUDIT_CODES.includes(l.taxCode));
                  if (snapTaxLines.length === 0) return null;
                  return (
                    <div key={sw.workerId} className="border rounded p-2 space-y-1" data-testid={`snapshot-worker-${sw.workerId}`}>
                      <p className="text-xs font-medium">{getWorkerName(sw.workerId)}</p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Tax Code</TableHead>
                            <TableHead className="text-right text-xs">Snapshot</TableHead>
                            <TableHead className="text-right text-xs">Stored</TableHead>
                            <TableHead className="text-right text-xs">Delta</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {snapTaxLines.map((l: any) => {
                            const stored = storedLines[l.taxCode] ?? null;
                            const snap = Number(l.amount);
                            const delta = stored !== null ? stored - snap : null;
                            const hasOverride = delta !== null && Math.abs(delta) > 0.001;
                            return (
                              <TableRow key={l.taxCode} className={hasOverride ? "bg-yellow-50 dark:bg-yellow-950" : ""} data-testid={`snapshot-line-${sw.workerId}-${l.taxCode}`}>
                                <TableCell className="font-mono text-xs py-1">{l.taxCode}</TableCell>
                                <TableCell className="text-right text-xs py-1">{fmt(snap)}</TableCell>
                                <TableCell className="text-right text-xs py-1">{stored !== null ? fmt(stored) : "—"}</TableCell>
                                <TableCell className={`text-right text-xs py-1 ${hasOverride ? "font-semibold text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                                  {delta !== null ? (delta >= 0 ? "+" : "") + fmt(delta) : "—"}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Tax Remittance Report (Task #4) ───────────────────────────────────────────
function TaxRemittanceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [quarter, setQuarter] = useState("Q1");
  const [companyId, setCompanyId] = useState("");

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"], enabled: open });

  const effectiveCompanyId = companyId || companies[0]?.id || "";

  const { data: qData, isLoading } = useQuery<any>({
    queryKey: ["/api/companies", effectiveCompanyId, "quarterly-taxes", year, quarter],
    queryFn: async () => {
      if (!effectiveCompanyId) return null;
      const r = await fetch(`/api/companies/${effectiveCompanyId}/quarterly-taxes?year=${year}&quarter=${quarter}`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!effectiveCompanyId && open,
  });

  const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totals: Record<string, { taxCode: string; taxName: string; isEmployerPaid: boolean; totalAmount: number }> = {};
  if (qData?.totals) {
    for (const t of qData.totals) {
      totals[t.taxCode] = { taxCode: t.taxCode, taxName: t.taxName, isEmployerPaid: t.isEmployerPaid, totalAmount: t.totalAmount };
    }
  }

  const AGENCY_MAP: Record<string, { label: string; codes: string[] }> = {
    irs: {
      label: "IRS (Internal Revenue Service)",
      codes: ["fed_income_tax", "ss_employee", "ss_employer", "medicare_employee", "medicare_employer", "futa"],
    },
    ca_edd: {
      label: "CA EDD (Employment Development Department)",
      codes: ["ca_sdi", "ca_pit", "ca_ui", "ca_ett"],
    },
  };

  const renderAgency = (agencyKey: string) => {
    const agency = AGENCY_MAP[agencyKey];
    const rows = agency.codes.map(code => {
      const t = totals[code];
      return { taxCode: code, taxName: t?.taxName || code, isEmployerPaid: t?.isEmployerPaid ?? false, amount: t?.totalAmount ?? 0 };
    });
    const agencyTotal = rows.reduce((s, r) => s + r.amount, 0);
    return (
      <div key={agencyKey} className="space-y-2 border rounded-lg p-4" data-testid={`section-remittance-${agencyKey}`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{agency.label}</h3>
          <Badge variant={agencyTotal > 0 ? "default" : "outline"}>{fmt(agencyTotal)}</Badge>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tax Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Payer</TableHead>
              <TableHead className="text-right">Amount Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.taxCode} data-testid={`row-remittance-${r.taxCode}`}>
                <TableCell className="font-mono text-xs">{r.taxCode}</TableCell>
                <TableCell>{r.taxName}</TableCell>
                <TableCell>
                  <Badge variant={r.isEmployerPaid ? "secondary" : "outline"}>
                    {r.isEmployerPaid ? "Employer" : "Employee"}
                  </Badge>
                </TableCell>
                <TableCell className={`text-right font-medium ${r.amount > 0 ? "" : "text-muted-foreground"}`}>
                  {fmt(r.amount)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="font-bold border-t">
              <TableCell colSpan={3}>Agency Total</TableCell>
              <TableCell className="text-right">{fmt(agencyTotal)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  };

  const handleExportCSV = () => {
    const headers = ["Agency", "Tax Code", "Description", "Payer", "Amount Due"];
    const rows: string[][] = [];
    for (const [agencyKey, agency] of Object.entries(AGENCY_MAP)) {
      for (const code of agency.codes) {
        const t = totals[code];
        rows.push([
          agency.label, code, t?.taxName || code,
          t?.isEmployerPaid ? "Employer" : "Employee",
          (t?.totalAmount ?? 0).toFixed(2),
        ]);
      }
    }
    downloadCSV(headers, rows, `tax_remittance_${year}_${quarter}.csv`);
  };

  const grandTotal = Object.values(totals).reduce((s, t) => s + t.totalAmount, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto" data-testid="dialog-tax-remittance">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title-tax-remittance">Tax Remittance Report</DialogTitle>
        </DialogHeader>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <Label className="text-xs">Company</Label>
            <Select value={effectiveCompanyId} onValueChange={setCompanyId}>
              <SelectTrigger className="w-[200px]" data-testid="select-remittance-company"><SelectValue /></SelectTrigger>
              <SelectContent>
                {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Year</Label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-[100px]" data-testid="select-remittance-year"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[currentYear, currentYear - 1, currentYear - 2].map(y => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Quarter</Label>
            <Select value={quarter} onValueChange={setQuarter}>
              <SelectTrigger className="w-[100px]" data-testid="select-remittance-quarter"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Q1", "Q2", "Q3", "Q4"].map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-remittance"><Download className="mr-2 h-4 w-4" />Export CSV</Button>
        </div>

        {isLoading ? (
          <div className="space-y-2 mt-4">{[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
        ) : !effectiveCompanyId ? (
          <p className="text-muted-foreground text-sm mt-4">No companies found.</p>
        ) : (
          <div className="space-y-4 mt-4">
            <p className="text-xs text-muted-foreground">
              Amounts owed to tax agencies for {companies.find(c => c.id === effectiveCompanyId)?.name} — {year} {quarter}.
              Sourced from stored payroll_item_taxes for all processed/paid runs in this quarter.
            </p>
            {Object.keys(AGENCY_MAP).map(k => renderAgency(k))}
            <div className="flex justify-between items-center border-t pt-3 font-bold">
              <span>Grand Total Remittance Due</span>
              <span data-testid="text-remittance-grand-total">{fmt(grandTotal)}</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function parseShiftHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return Math.round(mins / 60 * 100) / 100;
}

function JobCostReportSection() {
  const { data: schedules = [], isLoading: schedulesLoading } = useQuery<any[]>({ queryKey: ["/api/schedules"] });
  const { data: workers = [] } = useQuery<any[]>({ queryKey: ["/api/workers"] });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"] });
  const { data: companies = [] } = useQuery<any[]>({ queryKey: ["/api/companies"] });
  const { data: receipts = [] } = useQuery<any[]>({ queryKey: ["/api/receipts"] });

  const today = new Date();
  const firstOfMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const todayStr = today.toISOString().split("T")[0];

  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(todayStr);
  const [filterCompany, setFilterCompany] = useState("all");
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());

  const toggleExpand = (jobId: string) => {
    setExpandedJobs(prev => {
      const next = new Set(prev);
      next.has(jobId) ? next.delete(jobId) : next.add(jobId);
      return next;
    });
  };

  const filteredSchedules = schedules.filter(s => {
    if (filterCompany !== "all" && s.companyId !== filterCompany) return false;
    if (startDate && s.date < startDate) return false;
    if (endDate && s.date > endDate) return false;
    return true;
  });

  const filteredReceipts = receipts.filter(r => {
    if (!r.includeInJobCost) return false;
    if (filterCompany !== "all" && r.companyId !== filterCompany) return false;
    if (startDate && r.receiptDate < startDate) return false;
    if (endDate && r.receiptDate > endDate) return false;
    return true;
  });

  const jobGroups = (() => {
    const map: Record<string, {
      job: any;
      shifts: any[];
      totalHours: number;
      laborCost: number;
      expenseCost: number;
    }> = {};

    filteredSchedules.forEach(s => {
      const key = s.jobId || "__none__";
      if (!map[key]) map[key] = { job: jobs.find(j => j.id === s.jobId) || null, shifts: [], totalHours: 0, laborCost: 0, expenseCost: 0 };
      const worker = workers.find((w: any) => w.id === s.workerId);
      const hours = parseShiftHours(s.startTime, s.endTime);
      const rate = Number(worker?.payRate || 0);
      map[key].shifts.push({ ...s, worker, hours, cost: hours * rate });
      map[key].totalHours += hours;
      map[key].laborCost += hours * rate;
    });

    filteredReceipts.forEach(r => {
      const key = r.jobId || "__none__";
      if (!map[key]) map[key] = { job: jobs.find(j => j.id === r.jobId) || null, shifts: [], totalHours: 0, laborCost: 0, expenseCost: 0 };
      map[key].expenseCost += Number(r.amount || 0);
    });

    return Object.entries(map)
      .map(([key, val]) => ({ key, ...val, totalCost: val.laborCost + val.expenseCost }))
      .sort((a, b) => b.totalCost - a.totalCost);
  })();

  const grandTotalHours = jobGroups.reduce((s, g) => s + g.totalHours, 0);
  const grandLaborCost = jobGroups.reduce((s, g) => s + g.laborCost, 0);
  const grandExpenseCost = jobGroups.reduce((s, g) => s + g.expenseCost, 0);
  const grandTotal = grandLaborCost + grandExpenseCost;

  function exportCSV() {
    const rows = [["Job", "Company", "Date", "Employee", "Hours", "Pay Rate", "Labor Cost", "Expense Cost", "Total Cost"]];
    jobGroups.forEach(g => {
      const jobName = g.job?.name || "No Job";
      g.shifts.forEach(s => {
        const co = companies.find((c: any) => c.id === s.companyId)?.name || "";
        const emp = s.worker ? `${s.worker.firstName} ${s.worker.lastName}` : "";
        rows.push([jobName, co, s.date, emp, s.hours.toFixed(2), Number(s.worker?.payRate || 0).toFixed(2), s.cost.toFixed(2), "", ""]);
      });
      if (g.expenseCost > 0) {
        rows.push([jobName, "", "", "Expenses", "", "", "", g.expenseCost.toFixed(2), ""]);
      }
      rows.push([jobName, "", "", "SUBTOTAL", g.totalHours.toFixed(2), "", g.laborCost.toFixed(2), g.expenseCost.toFixed(2), g.totalCost.toFixed(2)]);
    });
    rows.push(["TOTAL", "", "", "", grandTotalHours.toFixed(2), "", grandLaborCost.toFixed(2), grandExpenseCost.toFixed(2), grandTotal.toFixed(2)]);
    const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-cost-report-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center">
          <Select value={filterCompany} onValueChange={setFilterCompany}>
            <SelectTrigger className="w-44" data-testid="select-jobcost-company"><SelectValue placeholder="All Companies" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Label className="text-sm">From</Label>
            <Input type="date" className="w-36" value={startDate} onChange={e => setStartDate(e.target.value)} data-testid="input-jobcost-start" />
            <Label className="text-sm">To</Label>
            <Input type="date" className="w-36" value={endDate} onChange={e => setEndDate(e.target.value)} data-testid="input-jobcost-end" />
          </div>
        </div>
        <Button variant="outline" onClick={exportCSV} data-testid="button-jobcost-export">
          <Download className="h-4 w-4 mr-2" />Export CSV
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Jobs with Activity</p>
          <p className="text-2xl font-bold">{jobGroups.filter(g => g.key !== "__none__").length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total Scheduled Hours</p>
          <p className="text-2xl font-bold">{grandTotalHours.toFixed(1)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total Labor Cost</p>
          <p className="text-2xl font-bold text-emerald-600">${grandLaborCost.toFixed(2)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total Job Cost</p>
          <p className="text-2xl font-bold text-primary">${grandTotal.toFixed(2)}</p>
        </CardContent></Card>
      </div>

      {schedulesLoading ? <Skeleton className="h-64 w-full" /> : jobGroups.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <Briefcase className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">No shifts with job assignments found for this period.</p>
          <p className="text-sm text-muted-foreground mt-1">Assign jobs to shifts in the Schedule page to track job costs.</p>
        </CardContent></Card>
      ) : (
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Job</TableHead>
                <TableHead className="text-right">Shifts</TableHead>
                <TableHead className="text-right">Sched. Hours</TableHead>
                <TableHead className="text-right">Labor Cost</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right font-bold">Total Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobGroups.flatMap(g => [
                <TableRow
                  key={`main-${g.key}`}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => toggleExpand(g.key)}
                  data-testid={`row-jobcost-${g.key}`}
                >
                  <TableCell className="w-8">
                    {expandedJobs.has(g.key)
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Briefcase className="h-4 w-4 text-muted-foreground" />
                      {g.key === "__none__" ? <span className="italic text-muted-foreground">No Job Assigned</span> : g.job?.name || g.key}
                    </div>
                    {g.job?.companyId && <div className="text-xs text-muted-foreground mt-0.5">{companies.find((c: any) => c.id === g.job.companyId)?.name || ""}</div>}
                  </TableCell>
                  <TableCell className="text-right">{g.shifts.length}</TableCell>
                  <TableCell className="text-right">{g.totalHours.toFixed(2)}h</TableCell>
                  <TableCell className="text-right text-emerald-600">${g.laborCost.toFixed(2)}</TableCell>
                  <TableCell className="text-right text-orange-600">${g.expenseCost.toFixed(2)}</TableCell>
                  <TableCell className="text-right font-bold">${g.totalCost.toFixed(2)}</TableCell>
                </TableRow>,
                ...(expandedJobs.has(g.key) ? g.shifts.map(s => (
                  <TableRow key={`shift-${s.id}`} className="bg-muted/30 text-sm">
                    <TableCell />
                    <TableCell className="pl-8 text-muted-foreground">
                      <div>{s.date}</div>
                      <div className="text-xs">{s.startTime} – {s.endTime}</div>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {s.worker ? `${s.worker.firstName} ${s.worker.lastName}` : "—"}
                    </TableCell>
                    <TableCell className="text-right">{s.hours.toFixed(2)}h</TableCell>
                    <TableCell className="text-right text-emerald-600">${s.cost.toFixed(2)}</TableCell>
                    <TableCell />
                    <TableCell />
                  </TableRow>
                )) : []),
              ])}
              <TableRow className="border-t-2 font-bold bg-muted/20">
                <TableCell />
                <TableCell>Grand Total</TableCell>
                <TableCell className="text-right">{jobGroups.reduce((s, g) => s + g.shifts.length, 0)}</TableCell>
                <TableCell className="text-right">{grandTotalHours.toFixed(2)}h</TableCell>
                <TableCell className="text-right text-emerald-600">${grandLaborCost.toFixed(2)}</TableCell>
                <TableCell className="text-right text-orange-600">${grandExpenseCost.toFixed(2)}</TableCell>
                <TableCell className="text-right">${grandTotal.toFixed(2)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent></Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper shared across expense report sub-components
// ─────────────────────────────────────────────────────────────────────────────
function fmt$(v: any) { return `$${parseFloat(String(v || 0)).toFixed(2)}`; }

function ExpenseFilterBar({
  companies, companyId, setCompanyId,
  startDate, setStartDate, endDate, setEndDate,
  children,
}: {
  companies: Company[]; companyId: string; setCompanyId: (v: string) => void;
  startDate: string; setStartDate: (v: string) => void; endDate: string; setEndDate: (v: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap gap-3 items-end mb-4">
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Company</Label>
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger className="w-44" data-testid="select-exp-report-company"><SelectValue placeholder="All companies" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All companies</SelectItem>
            {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">From</Label>
        <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="h-9 w-38" data-testid="input-exp-report-start" />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">To</Label>
        <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="h-9 w-38" data-testid="input-exp-report-end" />
      </div>
      {children}
    </div>
  );
}

// ── 1. Expense by Category ────────────────────────────────────────────────
function ExpenseByCategoryReport({ companies }: { companies: Company[] }) {
  const [companyId, setCompanyId] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const params = new URLSearchParams();
  if (companyId !== "all") params.set("companyId", companyId);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);

  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/reports/expense-by-category", companyId, startDate, endDate],
    queryFn: async () => {
      const r = await fetch(`/api/reports/expense-by-category?${params}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: true,
  });

  function exportCsv() {
    const header = "Category,Count,Total,Approved Total,Paid,Unpaid Approved\n";
    const body = rows.map(r =>
      `"${r.category}",${r.count},${Number(r.total).toFixed(2)},${Number(r.approved_total).toFixed(2)},${Number(r.paid_total).toFixed(2)},${Number(r.unpaid_approved_total).toFixed(2)}`
    ).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([header + body], { type: "text/csv" }));
    a.download = `expense-by-category-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const grandTotal = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const grandPaid  = rows.reduce((s, r) => s + Number(r.paid_total || 0), 0);
  const grandUnpaid = rows.reduce((s, r) => s + Number(r.unpaid_approved_total || 0), 0);

  return (
    <div className="space-y-4">
      <ExpenseFilterBar companies={companies} companyId={companyId} setCompanyId={setCompanyId} startDate={startDate} setStartDate={setStartDate} endDate={endDate} setEndDate={setEndDate}>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0} data-testid="button-cat-export">
          <Download className="h-3.5 w-3.5 mr-1" />CSV
        </Button>
      </ExpenseFilterBar>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Grand Total</p><p className="text-2xl font-bold">{fmt$(grandTotal)}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Paid</p><p className="text-2xl font-bold text-green-600">{fmt$(grandPaid)}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Approved / Unpaid</p><p className="text-2xl font-bold text-amber-600">{fmt$(grandUnpaid)}</p></CardContent></Card>
      </div>
      {isLoading ? <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div> : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground"><Tag className="h-8 w-8 mx-auto mb-2 opacity-30" /><p>No expenses found for the selected filters</p></CardContent></Card>
      ) : (
        <div className="overflow-x-auto">
          <Table data-testid="table-expense-by-category">
            <TableHeader><TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Count</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Approved</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Unpaid / Approved</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.category} data-testid={`row-cat-${r.category}`}>
                  <TableCell className="font-medium"><Badge variant="outline">{r.category}</Badge></TableCell>
                  <TableCell className="text-right">{r.count}</TableCell>
                  <TableCell className="text-right font-mono">{fmt$(r.total)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt$(r.approved_total)}</TableCell>
                  <TableCell className="text-right font-mono text-green-700">{fmt$(r.paid_total)}</TableCell>
                  <TableCell className="text-right font-mono text-amber-700">{fmt$(r.unpaid_approved_total)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-bold border-t-2">
                <TableCell>TOTAL</TableCell>
                <TableCell className="text-right">{rows.reduce((s, r) => s + r.count, 0)}</TableCell>
                <TableCell className="text-right font-mono">{fmt$(grandTotal)}</TableCell>
                <TableCell className="text-right font-mono">{fmt$(rows.reduce((s, r) => s + Number(r.approved_total || 0), 0))}</TableCell>
                <TableCell className="text-right font-mono text-green-700">{fmt$(grandPaid)}</TableCell>
                <TableCell className="text-right font-mono text-amber-700">{fmt$(grandUnpaid)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ── 2. Vendor Payment Summary ─────────────────────────────────────────────
function VendorPaymentReport({ companies }: { companies: Company[] }) {
  const [companyId, setCompanyId] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [minAmount, setMinAmount] = useState("");

  const params = new URLSearchParams();
  if (companyId !== "all") params.set("companyId", companyId);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (minAmount) params.set("minAmount", minAmount);

  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/reports/vendor-payments", companyId, startDate, endDate, minAmount],
    queryFn: async () => {
      const r = await fetch(`/api/reports/vendor-payments?${params}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  function exportCsv() {
    const header = "Payee,Payments,Total Paid,First Payment,Last Payment,Check Numbers\n";
    const body = rows.map(r =>
      `"${r.payee}",${r.payment_count},${Number(r.total_paid).toFixed(2)},"${r.first_payment ? new Date(r.first_payment).toLocaleDateString() : ""}","${r.last_payment ? new Date(r.last_payment).toLocaleDateString() : ""}","${r.check_numbers || ""}"`
    ).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([header + body], { type: "text/csv" }));
    a.download = `vendor-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const grandTotal = rows.reduce((s, r) => s + Number(r.total_paid || 0), 0);
  const vendors1099 = rows.filter(r => Number(r.total_paid) >= 600);

  return (
    <div className="space-y-4">
      <ExpenseFilterBar companies={companies} companyId={companyId} setCompanyId={setCompanyId} startDate={startDate} setStartDate={setStartDate} endDate={endDate} setEndDate={setEndDate}>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Min Amount ($)</Label>
          <Input type="number" value={minAmount} onChange={e => setMinAmount(e.target.value)} placeholder="0" className="h-9 w-28" data-testid="input-vendor-min" />
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0} data-testid="button-vendor-export">
          <Download className="h-3.5 w-3.5 mr-1" />CSV
        </Button>
      </ExpenseFilterBar>
      {vendors1099.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-amber-800 dark:text-amber-300">
            <strong>{vendors1099.length} vendor{vendors1099.length !== 1 ? "s" : ""}</strong> at or above the $600 1099-NEC threshold.
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Paid to Vendors</p><p className="text-2xl font-bold">{fmt$(grandTotal)}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Unique Vendors</p><p className="text-2xl font-bold">{rows.length}</p></CardContent></Card>
      </div>
      {isLoading ? <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div> : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground"><Banknote className="h-8 w-8 mx-auto mb-2 opacity-30" /><p>No vendor payments found</p></CardContent></Card>
      ) : (
        <div className="overflow-x-auto">
          <Table data-testid="table-vendor-payments">
            <TableHeader><TableRow>
              <TableHead>Payee / Vendor</TableHead>
              <TableHead className="text-right">Payments</TableHead>
              <TableHead className="text-right">Total Paid</TableHead>
              <TableHead>First Payment</TableHead>
              <TableHead>Last Payment</TableHead>
              <TableHead>Check #s</TableHead>
              <TableHead>1099?</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.payee} data-testid={`row-vendor-${r.payee}`}>
                  <TableCell className="font-medium">{r.payee}</TableCell>
                  <TableCell className="text-right">{r.payment_count}</TableCell>
                  <TableCell className="text-right font-mono">{fmt$(r.total_paid)}</TableCell>
                  <TableCell className="text-sm">{r.first_payment ? new Date(r.first_payment).toLocaleDateString() : "—"}</TableCell>
                  <TableCell className="text-sm">{r.last_payment ? new Date(r.last_payment).toLocaleDateString() : "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.check_numbers || "—"}</TableCell>
                  <TableCell>
                    {Number(r.total_paid) >= 600
                      ? <Badge variant="destructive" className="text-xs">≥$600</Badge>
                      : <span className="text-xs text-muted-foreground">No</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ── 3. Paid vs Unpaid Expenses ────────────────────────────────────────────
function PaidUnpaidExpenseReport({ companies }: { companies: Company[] }) {
  const [companyId, setCompanyId] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filterPayment, setFilterPayment] = useState("all");

  const params = new URLSearchParams();
  if (companyId !== "all") params.set("companyId", companyId);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);

  const { data: all = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/reports/expense-payment-status", companyId, startDate, endDate],
    queryFn: async () => {
      const r = await fetch(`/api/reports/expense-payment-status?${params}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const rows = all.filter(r => filterPayment === "all" || (r.payment_status || "unpaid") === filterPayment);
  const paidRows = all.filter(r => r.payment_status === "paid");
  const unpaidRows = all.filter(r => (r.payment_status || "unpaid") !== "paid" && r.status === "approved");
  const paidTotal = paidRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const unpaidTotal = unpaidRows.reduce((s, r) => s + Number(r.amount || 0), 0);

  function exportCsv() {
    const header = "Date,Vendor,Category,Amount,Status,Payment Status,Check #,Paid Date,Payee,Memo\n";
    const body = rows.map(r =>
      `${r.expense_date},"${r.vendor || ""}","${r.category_name || ""}",${Number(r.amount).toFixed(2)},${r.status},${r.payment_status || "unpaid"},"${r.check_number || ""}","${r.paid_at ? new Date(r.paid_at).toLocaleDateString() : ""}","${r.payee_name || ""}","${r.memo || ""}"`
    ).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([header + body], { type: "text/csv" }));
    a.download = `paid-unpaid-expenses-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div className="space-y-4">
      <ExpenseFilterBar companies={companies} companyId={companyId} setCompanyId={setCompanyId} startDate={startDate} setStartDate={setStartDate} endDate={endDate} setEndDate={setEndDate}>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Payment Status</Label>
          <Select value={filterPayment} onValueChange={setFilterPayment}>
            <SelectTrigger className="w-36" data-testid="select-payment-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="unpaid">Unpaid</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0} data-testid="button-paid-unpaid-export">
          <Download className="h-3.5 w-3.5 mr-1" />CSV
        </Button>
      </ExpenseFilterBar>
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Paid</p><p className="text-2xl font-bold text-green-600">{fmt$(paidTotal)}</p><p className="text-xs text-muted-foreground">{paidRows.length} expenses</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Approved / Unpaid</p><p className="text-2xl font-bold text-amber-600">{fmt$(unpaidTotal)}</p><p className="text-xs text-muted-foreground">{unpaidRows.length} expenses</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Showing</p><p className="text-2xl font-bold">{rows.length}</p><p className="text-xs text-muted-foreground">expenses</p></CardContent></Card>
      </div>
      {isLoading ? <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div> : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground"><ListChecks className="h-8 w-8 mx-auto mb-2 opacity-30" /><p>No expenses found</p></CardContent></Card>
      ) : (
        <div className="overflow-x-auto">
          <Table data-testid="table-paid-unpaid">
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Vendor</TableHead><TableHead>Category</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Approval</TableHead><TableHead>Payment</TableHead>
              <TableHead>Check #</TableHead><TableHead>Paid Date</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} data-testid={`row-paidunpaid-${r.id}`}>
                  <TableCell className="text-sm">{r.expense_date}</TableCell>
                  <TableCell className="text-sm font-medium">{r.vendor || r.payee_name || "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{r.category_name || "—"}</Badge></TableCell>
                  <TableCell className="text-right font-mono">{fmt$(r.amount)}</TableCell>
                  <TableCell><Badge variant={r.status === "approved" ? "default" : r.status === "rejected" ? "destructive" : "secondary"} className="text-xs">{r.status}</Badge></TableCell>
                  <TableCell>
                    {(r.payment_status || "unpaid") === "paid"
                      ? <Badge variant="default" className="bg-green-600 text-xs">paid</Badge>
                      : <Badge variant="outline" className="text-amber-600 border-amber-400 text-xs">unpaid</Badge>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.check_number || "—"}</TableCell>
                  <TableCell className="text-sm">{r.paid_at ? new Date(r.paid_at).toLocaleDateString() : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ── 4. Contractor Invoice Payments ────────────────────────────────────────
function ContractorInvoicePaymentReport({ companies }: { companies: Company[] }) {
  const [companyId, setCompanyId] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const params = new URLSearchParams();
  if (companyId !== "all") params.set("companyId", companyId);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (statusFilter !== "all") params.set("status", statusFilter);

  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/reports/contractor-invoice-payments", companyId, startDate, endDate, statusFilter],
    queryFn: async () => {
      const r = await fetch(`/api/reports/contractor-invoice-payments?${params}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const totalInvoiced = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalPaid = rows.reduce((s, r) => s + Number(r.amount_paid || 0), 0);
  const totalOutstanding = rows.reduce((s, r) => s + Number(r.balance_due || 0), 0);
  const threshold1099 = rows.filter(r => r.is_1099_reportable || Number(r.amount_paid || 0) >= 600);

  function exportCsv() {
    const header = "Date,Invoice #,Contractor,Amount,Amount Paid,Balance,Status,Paid Date,Payment Ref,1099\n";
    const body = rows.map(r =>
      `${r.invoice_date},"${r.invoice_number || ""}","${r.first_name || ""} ${r.last_name || ""}",${Number(r.amount).toFixed(2)},${Number(r.amount_paid || 0).toFixed(2)},${Number(r.balance_due || 0).toFixed(2)},${r.status},"${r.paid_at ? new Date(r.paid_at).toLocaleDateString() : ""}","${r.payment_reference || ""}",${r.is_1099_reportable ? "Yes" : "No"}`
    ).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([header + body], { type: "text/csv" }));
    a.download = `contractor-invoice-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div className="space-y-4">
      <ExpenseFilterBar companies={companies} companyId={companyId} setCompanyId={setCompanyId} startDate={startDate} setStartDate={setStartDate} endDate={endDate} setEndDate={setEndDate}>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36" data-testid="select-invoice-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0} data-testid="button-ci-export">
          <Download className="h-3.5 w-3.5 mr-1" />CSV
        </Button>
      </ExpenseFilterBar>
      {threshold1099.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-amber-800 dark:text-amber-300">
            <strong>{threshold1099.length} contractor invoice{threshold1099.length !== 1 ? "s" : ""}</strong> at or above the $600 1099-NEC threshold.
          </span>
        </div>
      )}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Invoiced</p><p className="text-2xl font-bold">{fmt$(totalInvoiced)}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Paid</p><p className="text-2xl font-bold text-green-600">{fmt$(totalPaid)}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Outstanding Balance</p><p className="text-2xl font-bold text-amber-600">{fmt$(totalOutstanding)}</p></CardContent></Card>
      </div>
      {isLoading ? <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div> : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground"><FileCheck2 className="h-8 w-8 mx-auto mb-2 opacity-30" /><p>No invoices found</p></CardContent></Card>
      ) : (
        <div className="overflow-x-auto">
          <Table data-testid="table-ci-payments">
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Invoice #</TableHead><TableHead>Contractor</TableHead>
              <TableHead className="text-right">Invoiced</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Status</TableHead><TableHead>Paid Date</TableHead><TableHead>1099</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} data-testid={`row-ci-${r.id}`}>
                  <TableCell className="text-sm">{r.invoice_date}</TableCell>
                  <TableCell className="text-sm font-medium">{r.invoice_number || "—"}</TableCell>
                  <TableCell className="text-sm">{`${r.first_name || ""} ${r.last_name || ""}`.trim() || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{fmt$(r.amount)}</TableCell>
                  <TableCell className="text-right font-mono text-green-700">{fmt$(r.amount_paid)}</TableCell>
                  <TableCell className="text-right font-mono text-amber-700">{fmt$(r.balance_due)}</TableCell>
                  <TableCell><Badge variant={r.status === "paid" ? "default" : r.status === "rejected" ? "destructive" : "secondary"} className="text-xs">{r.status}</Badge></TableCell>
                  <TableCell className="text-sm">{r.paid_at ? new Date(r.paid_at).toLocaleDateString() : "—"}</TableCell>
                  <TableCell>{r.is_1099_reportable || Number(r.amount_paid || 0) >= 600 ? <Badge variant="destructive" className="text-xs">1099</Badge> : <span className="text-xs text-muted-foreground">No</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ── 5. Company Expense Summary (preserved from original) ──────────────────
function CompanyExpenseSummaryReport({ companies }: { companies: Company[] }) {
  const { data: receipts = [], isLoading } = useQuery<ExpenseReceipt[]>({ queryKey: ["/api/receipts"] });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"] });
  const [reportView, setReportView] = useState<"company" | "reimbursement">("company");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCompany, setFilterCompany] = useState("all");

  const getWorkerName = (id: string | null) => { if (!id) return "—"; const w = workers.find(w => w.id === id); return w ? `${w.firstName} ${w.lastName}` : "—"; };
  const getCompanyName = (id: string | null) => { if (!id) return "—"; return companies.find(c => c.id === id)?.name || "—"; };
  const getJobName = (id: string | null) => { if (!id) return "—"; return (jobs as any[]).find(j => j.id === id)?.name || "—"; };

  const allFiltered = receipts.filter(r => {
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (filterCompany !== "all" && r.companyId !== filterCompany) return false;
    return true;
  });

  const companyGroups = (() => {
    const map: Record<string, { label: string; receipts: ExpenseReceipt[]; total: number; approved: number; pending: number }> = {};
    allFiltered.forEach(r => {
      const key = r.companyId || "none";
      const label = key !== "none" ? getCompanyName(key) : "No Company";
      if (!map[key]) map[key] = { label, receipts: [], total: 0, approved: 0, pending: 0 };
      const amt = parseFloat(r.amount?.toString() || "0");
      map[key].receipts.push(r);
      map[key].total += amt;
      if (r.status === "approved") map[key].approved += amt;
      if (r.status === "pending") map[key].pending += amt;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  })();

  const reimbursements = allFiltered.filter(r => (r as any).isReimbursement);
  const reimbursementsByEmployee = (() => {
    const map: Record<string, { name: string; company: string; receipts: ExpenseReceipt[]; total: number; approved: number; pending: number }> = {};
    reimbursements.forEach(r => {
      const key = r.workerId || "none";
      const name = key !== "none" ? getWorkerName(key) : "Unassigned";
      const co = r.companyId ? getCompanyName(r.companyId) : "";
      if (!map[key]) map[key] = { name, company: co, receipts: [], total: 0, approved: 0, pending: 0 };
      const amt = parseFloat(r.amount?.toString() || "0");
      map[key].receipts.push(r);
      map[key].total += amt;
      if (r.status === "approved") map[key].approved += amt;
      if (r.status === "pending") map[key].pending += amt;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  })();

  function exportCSV() {
    const rows = [["Date", "Vendor", "Description", "Category", "Company", "Employee", "Job Cost", "Amount", "Status", "Reimbursement", "Payment Method"]];
    allFiltered.forEach(r => {
      rows.push([r.receiptDate, r.vendor || "", r.description || "", r.category || "", getCompanyName(r.companyId), getWorkerName(r.workerId), getJobName(r.jobId), r.amount?.toString() || "0", r.status || "", (r as any).isReimbursement ? "Yes" : "No", (r as any).paymentMethod || ""]);
    });
    const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `expense-report-${new Date().toISOString().split("T")[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center">
          <Select value={reportView} onValueChange={(v: any) => setReportView(v)}>
            <SelectTrigger className="w-56" data-testid="select-expense-report-view"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="company">Company Expense Summary</SelectItem>
              <SelectItem value="reimbursement">Employee Reimbursements</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterCompany} onValueChange={setFilterCompany}>
            <SelectTrigger className="w-40" data-testid="select-expense-company"><SelectValue placeholder="Company" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-36" data-testid="select-expense-status"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCSV} data-testid="button-export-expenses">
            <Download className="h-4 w-4 mr-2" />Export CSV
          </Button>
          <Button variant="outline" onClick={() => {
            const params = new URLSearchParams();
            if (filterCompany !== "all") params.set("companyId", filterCompany);
            if (filterStatus !== "all") params.set("status", filterStatus);
            if (reportView === "reimbursement") params.set("type", "reimbursement");
            window.open(`/api/receipts/export-pdf?${params.toString()}`, "_blank");
          }} data-testid="button-export-expense-pdf">
            <Download className="h-4 w-4 mr-2" />Export PDF
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : reportView === "company" ? (
        companyGroups.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground">
            <Receipt className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No expense receipts found</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Expenses</CardTitle></CardHeader>
                <CardContent><p className="text-2xl font-bold">${allFiltered.reduce((s, r) => s + parseFloat(r.amount?.toString() || "0"), 0).toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">{allFiltered.length} receipts</p></CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Approved</CardTitle></CardHeader>
                <CardContent><p className="text-2xl font-bold text-green-600">${allFiltered.filter(r => r.status === "approved").reduce((s, r) => s + parseFloat(r.amount?.toString() || "0"), 0).toFixed(2)}</p></CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Pending Approval</CardTitle></CardHeader>
                <CardContent><p className="text-2xl font-bold text-amber-600">${allFiltered.filter(r => r.status === "pending").reduce((s, r) => s + parseFloat(r.amount?.toString() || "0"), 0).toFixed(2)}</p></CardContent></Card>
            </div>
            {companyGroups.map(group => (
              <Card key={group.label} data-testid={`expense-group-${group.label}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">{group.label}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">{group.receipts.length} receipts | Approved: ${group.approved.toFixed(2)} | Pending: ${group.pending.toFixed(2)}</p>
                    </div>
                    <p className="font-bold text-lg">${group.total.toFixed(2)}</p>
                  </div>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Date</TableHead><TableHead>Vendor</TableHead><TableHead>Employee</TableHead>
                      <TableHead>Category</TableHead><TableHead>Job Cost</TableHead><TableHead>Type</TableHead>
                      <TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {group.receipts.map(r => (
                        <TableRow key={r.id}>
                          <TableCell className="text-sm">{r.receiptDate}</TableCell>
                          <TableCell className="text-sm font-medium">{r.vendor || "—"}</TableCell>
                          <TableCell className="text-sm">{getWorkerName(r.workerId)}</TableCell>
                          <TableCell><Badge variant="outline" className="capitalize text-xs">{(r.category || "general").replace(/-/g, " ")}</Badge></TableCell>
                          <TableCell className="text-sm">{getJobName(r.jobId)}</TableCell>
                          <TableCell>{(r as any).isReimbursement ? <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-xs">Reimb.</Badge> : <span className="text-xs text-muted-foreground">Expense</span>}</TableCell>
                          <TableCell><Badge variant={r.status === "approved" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}>{r.status || "pending"}</Badge></TableCell>
                          <TableCell className="text-right font-medium">${parseFloat(r.amount?.toString() || "0").toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : (
        reimbursementsByEmployee.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground">
            <Receipt className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No employee reimbursements found</p>
            <p className="text-sm mt-1">Mark receipts as "Employee Reimbursement" in Expenses & Receipts.</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Reimbursements</CardTitle></CardHeader>
                <CardContent><p className="text-2xl font-bold">${reimbursements.reduce((s, r) => s + parseFloat(r.amount?.toString() || "0"), 0).toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">{reimbursements.length} claims from {reimbursementsByEmployee.length} employees</p></CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Approved</CardTitle></CardHeader>
                <CardContent><p className="text-2xl font-bold text-green-600">${reimbursements.filter(r => r.status === "approved").reduce((s, r) => s + parseFloat(r.amount?.toString() || "0"), 0).toFixed(2)}</p></CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Awaiting Approval</CardTitle></CardHeader>
                <CardContent><p className="text-2xl font-bold text-amber-600">${reimbursements.filter(r => r.status === "pending").reduce((s, r) => s + parseFloat(r.amount?.toString() || "0"), 0).toFixed(2)}</p></CardContent></Card>
            </div>
            {reimbursementsByEmployee.map(group => (
              <Card key={group.name} data-testid={`reimb-group-${group.name}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">{group.name}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">{group.company} | {group.receipts.length} claims | Approved: ${group.approved.toFixed(2)} | Pending: ${group.pending.toFixed(2)}</p>
                    </div>
                    <p className="font-bold text-lg">${group.total.toFixed(2)}</p>
                  </div>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Date</TableHead><TableHead>Vendor</TableHead><TableHead>Description</TableHead>
                      <TableHead>Category</TableHead><TableHead>Payment</TableHead>
                      <TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {group.receipts.map(r => (
                        <TableRow key={r.id}>
                          <TableCell className="text-sm">{r.receiptDate}</TableCell>
                          <TableCell className="text-sm font-medium">{r.vendor || "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{r.description || "—"}</TableCell>
                          <TableCell><Badge variant="outline" className="capitalize text-xs">{(r.category || "general").replace(/-/g, " ")}</Badge></TableCell>
                          <TableCell className="text-sm capitalize">{((r as any).paymentMethod || "—").replace(/_/g, " ")}</TableCell>
                          <TableCell><Badge variant={r.status === "approved" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}>{r.status || "pending"}</Badge></TableCell>
                          <TableCell className="text-right font-medium">${parseFloat(r.amount?.toString() || "0").toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ── Main ExpenseReportSection — 5-tab container ───────────────────────────
function ExpenseReportSection() {
  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const [subTab, setSubTab] = useState("category");

  const subTabs = [
    { id: "category",   label: "By Category",      icon: <Tag className="h-3.5 w-3.5" /> },
    { id: "vendor",     label: "Vendor Payments",   icon: <Banknote className="h-3.5 w-3.5" /> },
    { id: "paidunpaid", label: "Paid vs Unpaid",    icon: <ListChecks className="h-3.5 w-3.5" /> },
    { id: "invoices",   label: "Invoice Payments",  icon: <FileCheck2 className="h-3.5 w-3.5" /> },
    { id: "summary",    label: "Company Summary",   icon: <Building className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b pb-3">
        {subTabs.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              subTab === t.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            data-testid={`tab-exp-report-${t.id}`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>
      {subTab === "category"   && <ExpenseByCategoryReport companies={companies} />}
      {subTab === "vendor"     && <VendorPaymentReport companies={companies} />}
      {subTab === "paidunpaid" && <PaidUnpaidExpenseReport companies={companies} />}
      {subTab === "invoices"   && <ContractorInvoicePaymentReport companies={companies} />}
      {subTab === "summary"    && <CompanyExpenseSummaryReport companies={companies} />}
    </div>
  );
}

// ── Check Register Dialog ──────────────────────────────────────────────────

interface CheckAuditLog {
  id: string;
  payroll_run_id: string;
  company_id: string;
  initiated_by_user_id: string;
  check_count: number;
  total_amount: string;
  micr_validation: string;
  validation_errors: any;
  print_blocked: boolean;
  template_id: string | null;
  event_type: string;
  worker_id: string | null;
  check_number: string | null;
  notes: string | null;
  created_at: string;
}

function CheckRegisterDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: runs = [] } = useQuery<PayrollRun[]>({ queryKey: ["/api/payroll-runs"] });
  const [registerTab, setRegisterTab] = useState<"payroll" | "vendor">("payroll");
  const [companyId, setCompanyId] = useState("all");
  const [eventType, setEventType] = useState("all");
  const [limit, setLimit] = useState("100");
  const [search, setSearch] = useState("");
  const [vendorStart, setVendorStart] = useState("");
  const [vendorEnd, setVendorEnd] = useState("");

  const { data: logs = [], isLoading } = useQuery<CheckAuditLog[]>({
    queryKey: ["/api/check-print-audit", companyId, limit],
    queryFn: async () => {
      const params = new URLSearchParams({ limit });
      if (companyId !== "all") params.set("companyId", companyId);
      const res = await fetch(`/api/check-print-audit?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open && registerTab === "payroll",
  });

  const vendorParams = new URLSearchParams();
  if (companyId !== "all") vendorParams.set("companyId", companyId);
  if (vendorStart) vendorParams.set("startDate", vendorStart);
  if (vendorEnd) vendorParams.set("endDate", vendorEnd);

  const { data: vendorChecks = [], isLoading: vendorLoading } = useQuery<any[]>({
    queryKey: ["/api/reports/vendor-checks", companyId, vendorStart, vendorEnd],
    queryFn: async () => {
      const res = await fetch(`/api/reports/vendor-checks?${vendorParams}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
    enabled: open && registerTab === "vendor",
  });

  const filtered = logs.filter(l => {
    if (eventType !== "all" && (l.event_type || "print") !== eventType) return false;
    if (search) {
      const s = search.toLowerCase();
      return (l.payroll_run_id || "").toLowerCase().includes(s)
        || (l.check_number || "").toLowerCase().includes(s)
        || (l.event_type || "").toLowerCase().includes(s);
    }
    return true;
  });

  const companyName = (id: string) => companies.find(c => c.id === id)?.name || id;
  const runLabel = (id: string) => {
    const r = runs.find(r => r.id === id);
    return r ? `${r.periodStart || ""} – ${r.periodEnd || ""}` : id;
  };

  function exportPayrollCsv() {
    const header = ["Date", "Company", "Pay Run", "Event", "Checks", "Total Amount", "MICR OK", "Check Number", "Notes"].join(",");
    const rows = filtered.map(l => [
      new Date(l.created_at).toLocaleString(),
      `"${companyName(l.company_id)}"`,
      `"${runLabel(l.payroll_run_id)}"`,
      l.event_type || "print",
      l.check_count || "",
      Number(l.total_amount || 0).toFixed(2),
      l.micr_validation || "",
      l.check_number || "",
      `"${(l.notes || "").replace(/"/g, "'")}"`,
    ].join(","));
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `payroll_check_register_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  function exportVendorCsv() {
    const header = ["Check Date", "Payee", "Check #", "Amount", "Memo", "Paid At"].join(",");
    const rows = vendorChecks.map(v => [
      v.check_date,
      `"${v.payee}"`,
      v.check_number || "",
      Number(v.amount || 0).toFixed(2),
      `"${(v.memo || "").replace(/"/g, "'")}"`,
      v.paid_at ? new Date(v.paid_at).toLocaleDateString() : "",
    ].join(","));
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vendor_check_register_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const totalChecks = filtered.reduce((s, l) => s + Number(l.check_count || 0), 0);
  const totalAmount = filtered.reduce((s, l) => s + Number(l.total_amount || 0), 0);
  const vendorTotal = vendorChecks.reduce((s, v) => s + Number(v.amount || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col" data-testid="dialog-check-register">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-primary" />
            Check Register
          </DialogTitle>
        </DialogHeader>

        {/* Register type tabs */}
        <div className="flex gap-2 border-b pb-3">
          <button
            onClick={() => setRegisterTab("payroll")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${registerTab === "payroll" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            data-testid="tab-check-register-payroll"
          >
            <DollarSign className="h-3.5 w-3.5" />Payroll Checks
          </button>
          <button
            onClick={() => setRegisterTab("vendor")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${registerTab === "vendor" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            data-testid="tab-check-register-vendor"
          >
            <Banknote className="h-3.5 w-3.5" />Vendor AP Checks
          </button>
        </div>

        {registerTab === "payroll" ? (
          <>
            <div className="flex flex-wrap gap-3 items-end mb-3">
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Company</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger className="w-44" data-testid="select-check-reg-company">
                    <SelectValue placeholder="All companies" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All companies</SelectItem>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Event type</Label>
                <Select value={eventType} onValueChange={setEventType}>
                  <SelectTrigger className="w-36" data-testid="select-check-reg-event">
                    <SelectValue placeholder="All events" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All events</SelectItem>
                    <SelectItem value="print">Print</SelectItem>
                    <SelectItem value="calibration_test">Calibration test</SelectItem>
                    <SelectItem value="reprint">Reprint</SelectItem>
                    <SelectItem value="void">Void</SelectItem>
                    <SelectItem value="reissue">Reissue</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Max rows</Label>
                <Select value={limit} onValueChange={setLimit}>
                  <SelectTrigger className="w-24" data-testid="select-check-reg-limit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="250">250</SelectItem>
                    <SelectItem value="500">500</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-32">
                <Label className="text-xs">Search</Label>
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Run ID, check #…" className="h-9" data-testid="input-check-reg-search" />
              </div>
              <Button size="sm" variant="outline" onClick={exportPayrollCsv} disabled={filtered.length === 0} data-testid="button-check-reg-export">
                <Download className="h-3.5 w-3.5 mr-1.5" />CSV
              </Button>
            </div>

            <div className="flex gap-6 px-1 py-2 bg-muted/40 rounded-md text-sm mb-2">
              <span><strong>{filtered.length}</strong> events</span>
              <span><strong>{totalChecks}</strong> checks printed</span>
              <span><strong>${totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong> total</span>
            </div>

            <div className="overflow-auto flex-1">
              {isLoading ? (
                <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No check print events found.</p>
              ) : (
                <Table data-testid="table-check-register">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Pay Run</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead className="text-right">Checks</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>MICR</TableHead>
                      <TableHead>Check #</TableHead>
                      <TableHead>By</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(l => (
                      <TableRow key={l.id} data-testid={`row-check-reg-${l.id}`}>
                        <TableCell className="text-xs whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</TableCell>
                        <TableCell className="text-xs">{companyName(l.company_id)}</TableCell>
                        <TableCell className="text-xs">{runLabel(l.payroll_run_id)}</TableCell>
                        <TableCell>
                          <Badge variant={
                            (l.event_type || "print") === "print" ? "default" :
                            l.event_type === "reprint" ? "secondary" :
                            l.event_type === "calibration_test" ? "secondary" :
                            l.event_type === "void" ? "destructive" : "outline"
                          } className="text-xs capitalize">
                            {l.event_type || "print"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs">{l.check_count || 0}</TableCell>
                        <TableCell className="text-right text-xs">${Number(l.total_amount || 0).toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant={(l.micr_validation === "ok" || l.micr_validation === "calibration_test") ? "secondary" : (l.micr_validation === "fail" ? "destructive" : "outline")} className="text-xs">
                            {l.micr_validation || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono">{l.check_number || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground" data-testid={`text-reg-by-${l.id}`}>
                          {l.initiated_by_user_id ? l.initiated_by_user_id.slice(0, 8) + "…" : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{l.notes || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-3 items-end mb-3">
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Company</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger className="w-44" data-testid="select-vendor-check-company">
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
                <Input type="date" value={vendorStart} onChange={e => setVendorStart(e.target.value)} className="h-9 w-36" data-testid="input-vendor-check-start" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">To</Label>
                <Input type="date" value={vendorEnd} onChange={e => setVendorEnd(e.target.value)} className="h-9 w-36" data-testid="input-vendor-check-end" />
              </div>
              <Button size="sm" variant="outline" onClick={exportVendorCsv} disabled={vendorChecks.length === 0} data-testid="button-vendor-check-export">
                <Download className="h-3.5 w-3.5 mr-1.5" />CSV
              </Button>
            </div>

            <div className="flex gap-6 px-1 py-2 bg-muted/40 rounded-md text-sm mb-2">
              <span><strong>{vendorChecks.length}</strong> vendor checks</span>
              <span><strong>${vendorTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong> total paid</span>
            </div>

            <div className="overflow-auto flex-1">
              {vendorLoading ? (
                <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
              ) : vendorChecks.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Banknote className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No vendor AP checks found.</p>
                  <p className="text-xs mt-1">Vendor checks are created when you print a check for an approved expense.</p>
                </div>
              ) : (
                <Table data-testid="table-vendor-check-register">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Check Date</TableHead>
                      <TableHead>Payee</TableHead>
                      <TableHead>Check #</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Memo</TableHead>
                      <TableHead>Paid At</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendorChecks.map(v => (
                      <TableRow key={v.id} data-testid={`row-vendor-check-${v.id}`}>
                        <TableCell className="text-xs whitespace-nowrap">{v.check_date}</TableCell>
                        <TableCell className="text-sm font-medium">{v.payee}</TableCell>
                        <TableCell className="text-xs font-mono">{v.check_number}</TableCell>
                        <TableCell className="text-right text-sm font-mono">${Number(v.amount || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{v.memo || "—"}</TableCell>
                        <TableCell className="text-xs">{v.paid_at ? new Date(v.paid_at).toLocaleDateString() : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function VoidedChecksDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const [companyId, setCompanyId] = useState("all");

  const { data: allLogs = [], isLoading } = useQuery<CheckAuditLog[]>({
    queryKey: ["/api/check-print-audit", companyId, "500"],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "500" });
      if (companyId !== "all") params.set("companyId", companyId);
      const res = await fetch(`/api/check-print-audit?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open,
  });

  const logs = allLogs.filter(l => l.event_type === "void" || l.event_type === "reissue" || l.event_type === "reprint");
  const companyName = (id: string) => companies.find(c => c.id === id)?.name || id;

  function exportCsv() {
    const header = ["Date", "Company", "Run ID", "Event", "Check Number", "Notes"].join(",");
    const rows = logs.map(l => [
      new Date(l.created_at).toLocaleString(),
      `"${companyName(l.company_id)}"`,
      l.payroll_run_id,
      l.event_type,
      l.check_number || "",
      `"${(l.notes || "").replace(/"/g, "'")}"`,
    ].join(","));
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `voided_checks_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col" data-testid="dialog-voided-checks">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-destructive" />
            Voided / Reissued Checks
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-3 items-end mb-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger className="w-44" data-testid="select-voided-company">
                <SelectValue placeholder="All companies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={logs.length === 0} data-testid="button-voided-export">
            <Download className="h-3.5 w-3.5 mr-1.5" />CSV
          </Button>
        </div>

        <div className="overflow-auto flex-1">
          {isLoading ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
              <p className="text-sm text-muted-foreground">No voided or reissued checks on record.</p>
            </div>
          ) : (
            <Table data-testid="table-voided-checks">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Run ID</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Check #</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map(l => (
                  <TableRow key={l.id} data-testid={`row-voided-${l.id}`}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{companyName(l.company_id)}</TableCell>
                    <TableCell className="text-xs font-mono">{l.payroll_run_id}</TableCell>
                    <TableCell>
                      <Badge
                        variant={l.event_type === "void" ? "destructive" : l.event_type === "reprint" ? "secondary" : "outline"}
                        className="text-xs capitalize"
                      >
                        {l.event_type === "reissue" ? "reissued" : l.event_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{l.check_number || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground" data-testid={`text-audit-by-${l.id}`}>
                      {l.initiated_by_user_id ? l.initiated_by_user_id.slice(0, 8) + "…" : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.notes || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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
  const [payrollSummaryReportOpen, setPayrollSummaryReportOpen] = useState(false);
  const [payrollRegisterReportOpen, setPayrollRegisterReportOpen] = useState(false);
  const [timesheetBrandedReportOpen, setTimesheetBrandedReportOpen] = useState(false);
  const [checkRegisterOpen, setCheckRegisterOpen] = useState(false);
  const [voidedChecksOpen, setVoidedChecksOpen] = useState(false);
  const [qualificationSummaryOpen, setQualificationSummaryOpen] = useState(false);
  const [reviewSummaryOpen, setReviewSummaryOpen] = useState(false);
  const [w2Open, setW2Open] = useState(false);
  const [form1099Open, setForm1099Open] = useState(false);
  const [form1096Open, setForm1096Open] = useState(false);
  const [form941Open, setForm941Open] = useState(false);
  const [form940Open, setForm940Open] = useState(false);
  const [de9Open, setDE9Open] = useState(false);
  const [de9cOpen, setDE9COpen] = useState(false);
  const [taxLiabilityOpen, setTaxLiabilityOpen] = useState(false);
  const [taxAuditOpen, setTaxAuditOpen] = useState(false);
  const [employeeEarningsOpen, setEmployeeEarningsOpen] = useState(false);
  const [taxRemittanceOpen, setTaxRemittanceOpen] = useState(false);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-blue-accent" data-testid="text-page-title">Reports</h1>
        <p className="text-muted-foreground mt-1">Generate and view reports across all categories.</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto -mx-1 px-1">
        <TabsList className="inline-flex w-max" data-testid="tabs-reports">
          <TabsTrigger value="saved" data-testid="tab-saved">Saved Reports</TabsTrigger>
          <TabsTrigger value="employee" data-testid="tab-employee">Employee Reports</TabsTrigger>
          <TabsTrigger value="timesheet" data-testid="tab-timesheet">Timesheet Reports</TabsTrigger>
          <TabsTrigger value="payroll" data-testid="tab-payroll">Payroll Reports</TabsTrigger>
          <TabsTrigger value="tax" data-testid="tab-tax">Tax Reports</TabsTrigger>
          <TabsTrigger value="hr" data-testid="tab-hr">HR Reports</TabsTrigger>
          <TabsTrigger value="expense" data-testid="tab-expense">Expense Reports</TabsTrigger>
          <TabsTrigger value="job-cost" data-testid="tab-job-cost">Job Cost</TabsTrigger>
        </TabsList>
        </div>

        <TabsContent value="saved" className="mt-6">
          <SavedReportsTab />
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
              title="Timesheet Detail Report"
              description="Branded timesheet report with clock in/out, hours breakdown, and totals — filterable by company and date range."
              icon={<ClipboardList className="h-5 w-5" />}
              onGenerate={() => setTimesheetBrandedReportOpen(true)}
            />
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
              title="Timesheet Detail (Legacy)"
              description="Detailed timesheet entries with clock times."
              icon={<Clock className="h-5 w-5" />}
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
              title="Payroll Summary"
              description="Branded summary report: totals, employee table, payment method breakout, and funding required for any pay run."
              icon={<BarChart3 className="h-5 w-5" />}
              onGenerate={() => setPayrollSummaryReportOpen(true)}
            />
            <ReportCard
              title="Payroll Register"
              description="Detailed per-employee register showing hours, gross pay, deductions, net pay, and check number for any pay run."
              icon={<ClipboardList className="h-5 w-5" />}
              onGenerate={() => setPayrollRegisterReportOpen(true)}
            />
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
            <ReportCard
              title="Printed Check Register"
              description="Full audit log of every check printing event — company, run, MICR status, check count, and total. Export to CSV for reconciliation."
              icon={<Printer className="h-5 w-5" />}
              onGenerate={() => setCheckRegisterOpen(true)}
            />
            <ReportCard
              title="Voided / Reissued Checks"
              description="Filtered view of voided and reissued checks from the check print audit log for exception reporting and reconciliation."
              icon={<XCircle className="h-5 w-5" />}
              onGenerate={() => setVoidedChecksOpen(true)}
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
            <ReportCard
              title="Tax Liability Report"
              description="Itemized employer and employee tax liability by tax code, sourced from stored tax engine data."
              icon={<Calculator className="h-5 w-5" />}
              onGenerate={() => setTaxLiabilityOpen(true)}
            />
            <ReportCard
              title="Tax Audit"
              description="Per-run tax breakdown and override audit trail from the deterministic tax engine."
              icon={<Shield className="h-5 w-5" />}
              onGenerate={() => setTaxAuditOpen(true)}
            />
            <ReportCard
              title="Employee Earnings Report"
              description="YTD gross pay, federal/CA tax withholdings, SS, Medicare, and net pay per employee — sourced from stored tax engine records."
              icon={<DollarSign className="h-5 w-5" />}
              onGenerate={() => setEmployeeEarningsOpen(true)}
            />
            <ReportCard
              title="Tax Remittance Report"
              description="Per-agency tax amounts due for IRS and CA EDD by company and quarter — sourced from stored tax engine data. Use for remittance scheduling."
              icon={<Calculator className="h-5 w-5" />}
              onGenerate={() => setTaxRemittanceOpen(true)}
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

        <TabsContent value="expense" className="mt-6">
          <ExpenseReportSection />
        </TabsContent>

        <TabsContent value="job-cost" className="mt-6">
          <JobCostReportSection />
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
      <TaxLiabilityDialog open={taxLiabilityOpen} onOpenChange={setTaxLiabilityOpen} />
      <TaxAuditDialog open={taxAuditOpen} onOpenChange={setTaxAuditOpen} />
      <EmployeeEarningsDialog open={employeeEarningsOpen} onOpenChange={setEmployeeEarningsOpen} />
      <TaxRemittanceDialog open={taxRemittanceOpen} onOpenChange={setTaxRemittanceOpen} />
      <QualificationSummaryDialog open={qualificationSummaryOpen} onOpenChange={setQualificationSummaryOpen} />
      <ReviewSummaryDialog open={reviewSummaryOpen} onOpenChange={setReviewSummaryOpen} />

      {/* Branded report dialogs */}
      <PayrollSummaryReportDialog open={payrollSummaryReportOpen} onOpenChange={setPayrollSummaryReportOpen} />
      <PayrollRegisterReportDialog open={payrollRegisterReportOpen} onOpenChange={setPayrollRegisterReportOpen} />
      <TimesheetReportDialog open={timesheetBrandedReportOpen} onOpenChange={setTimesheetBrandedReportOpen} />

      {/* Check audit dialogs */}
      <CheckRegisterDialog open={checkRegisterOpen} onOpenChange={setCheckRegisterOpen} />
      <VoidedChecksDialog open={voidedChecksOpen} onOpenChange={setVoidedChecksOpen} />
    </div>
  );
}