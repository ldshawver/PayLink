import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  FileText, Check, X, Clock, AlertTriangle, RefreshCw,
  ChevronDown, CalendarDays, TrendingUp, Users, Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TimeEntry, Worker, Company } from "@shared/schema";

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant={status === "approved" ? "default" : status === "rejected" ? "destructive" : "secondary"}
      data-testid={`badge-status-${status}`}
    >
      {status === "approved" && <Check className="h-3 w-3 mr-1" />}
      {status === "rejected" && <X className="h-3 w-3 mr-1" />}
      {status === "pending" && <Clock className="h-3 w-3 mr-1" />}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function ExceptionBadges({ entry }: { entry: TimeEntry }) {
  const badges: JSX.Element[] = [];
  if ((entry as any).isUnscheduled) {
    badges.push(
      <Badge key="unscheduled" variant="destructive" className="text-xs gap-1">
        <AlertTriangle className="h-3 w-3" /> Unscheduled
      </Badge>
    );
  } else {
    const late = Number((entry as any).lateMinutes || 0);
    const early = Number((entry as any).earlyDepartureMinutes || 0);
    if (late > 5) {
      badges.push(
        <Badge key="late" className="text-xs gap-1 bg-amber-500 hover:bg-amber-600">
          <Clock className="h-3 w-3" /> Late {late}m
        </Badge>
      );
    }
    if (early > 5) {
      badges.push(
        <Badge key="early" className="text-xs gap-1 bg-orange-500 hover:bg-orange-600">
          <Clock className="h-3 w-3" /> Left Early {early}m
        </Badge>
      );
    }
    if (late <= 5 && early <= 5 && (entry as any).scheduledStart) {
      badges.push(
        <Badge key="ontime" className="text-xs gap-1 bg-emerald-600 hover:bg-emerald-700">
          <Check className="h-3 w-3" /> On Time
        </Badge>
      );
    }
  }
  return <div className="flex flex-wrap gap-1">{badges}</div>;
}

function fmtTime(ts: Date | string | null | undefined) {
  if (!ts) return "-";
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function fmtHHMM(timeStr: string | null | undefined) {
  if (!timeStr) return "-";
  const [h, m] = timeStr.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h % 12) || 12);
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

export default function Timesheets() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("timesheets");
  const [filterCompany, setFilterCompany] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const weekRange = getWeekRange();
  const [convertCompany, setConvertCompany] = useState<string>("");
  const [convertStart, setConvertStart] = useState(weekRange.start);
  const [convertEnd, setConvertEnd] = useState(weekRange.end);

  const { data: entries = [], isLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries"],
  });

  const { data: workers = [] } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const { data: pendingPunches = [], isLoading: pendingLoading } = useQuery<any[]>({
    queryKey: ["/api/time-punches/pending", filterCompany],
    queryFn: async () => {
      const url = filterCompany !== "all"
        ? `/api/time-punches/pending?companyId=${filterCompany}`
        : "/api/time-punches/pending";
      const res = await fetch(url, { credentials: "include" });
      return res.json();
    },
  });

  const workerMap = new Map(workers.map((w) => [w.id, w]));
  const companyMap = new Map(companies.map((c) => [c.id, c]));

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiRequest("PATCH", `/api/time-entries/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Timesheet updated" });
    },
  });

  const approvePunch = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "reject" }) => {
      await apiRequest("PATCH", `/api/time-punches/${id}/approve`, { action });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-punches/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-punches"] });
      toast({ title: "Punch updated" });
    },
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      const result = await apiRequest("POST", "/api/time-entries/convert-from-punches", {
        companyId: convertCompany,
        startDate: convertStart,
        endDate: convertEnd,
      });
      return result;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      setShowConvertDialog(false);
      toast({
        title: "Conversion complete",
        description: `Created ${data.created} entries, skipped ${data.skipped} existing.`,
      });
    },
    onError: () => {
      toast({ title: "Conversion failed", variant: "destructive" });
    },
  });

  const filteredEntries = entries.filter(e => {
    if (filterCompany !== "all" && e.companyId !== filterCompany) return false;
    if (filterStatus !== "all" && e.status !== filterStatus) return false;
    return true;
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totalHours = filteredEntries.reduce((sum, e) => sum + Number(e.totalHours || 0), 0);
  const pendingCount = entries.filter(e => e.status === "pending").length;
  const unscheduledCount = entries.filter(e => (e as any).isUnscheduled).length;
  const pendingPunchCount = pendingPunches.length;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-timesheets-title">
            Timesheets
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review and approve employee time entries.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setShowConvertDialog(true)}
          data-testid="button-convert-punches"
          className="gap-2 w-full sm:w-auto"
        >
          <RefreshCw className="h-4 w-4" />
          Convert Punches
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Entries</p>
            </div>
            <p className="text-2xl font-bold">{filteredEntries.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Hours</p>
            </div>
            <p className="text-2xl font-bold">{totalHours.toFixed(1)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="h-4 w-4 text-primary" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pending Review</p>
            </div>
            <p className="text-2xl font-bold text-primary">{pendingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {pendingPunchCount > 0 ? "Pending Punches" : "Unscheduled"}
              </p>
            </div>
            <p className="text-2xl font-bold text-destructive">
              {pendingPunchCount > 0 ? pendingPunchCount : unscheduledCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={filterCompany} onValueChange={setFilterCompany}>
          <SelectTrigger className="w-48" data-testid="select-filter-company">
            <SelectValue placeholder="All Companies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {companies.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36" data-testid="select-filter-status">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto -mx-1 px-1">
        <TabsList className="inline-flex w-max">
          <TabsTrigger value="timesheets" data-testid="tab-timesheets">
            Timesheets {pendingCount > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">{pendingCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="pending-punches" data-testid="tab-pending-punches">
            Pending Punches {pendingPunchCount > 0 && (
              <Badge variant="destructive" className="ml-2 text-xs">{pendingPunchCount}</Badge>
            )}
          </TabsTrigger>
        </TabsList>
        </div>

        <TabsContent value="timesheets">
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6 space-y-3">
                  {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : filteredEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <FileText className="h-12 w-12 text-muted-foreground/30 mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">No timesheets found</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Use "Convert Punches" to generate timesheet entries from clock punches.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Worker</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Scheduled</TableHead>
                        <TableHead>Clock In</TableHead>
                        <TableHead>Clock Out</TableHead>
                        <TableHead>Break</TableHead>
                        <TableHead>Hours</TableHead>
                        <TableHead>OT</TableHead>
                        <TableHead>Exceptions</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEntries.map(entry => {
                        const worker = workerMap.get(entry.workerId);
                        const e = entry as any;
                        return (
                          <TableRow key={entry.id} data-testid={`row-timesheet-${entry.id}`}
                            className={e.isUnscheduled ? "bg-destructive/5" : ""}>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                                  {worker ? `${worker.firstName[0]}${worker.lastName[0]}` : "??"}
                                </div>
                                <div>
                                  <div className="text-sm">{worker ? `${worker.firstName} ${worker.lastName}` : "Unknown"}</div>
                                  {e.source === "punches" && (
                                    <div className="text-xs text-muted-foreground">From punches</div>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">{entry.date}</TableCell>
                            <TableCell className="text-sm">
                              {e.scheduledStart ? (
                                <div className="text-xs text-muted-foreground">
                                  <div>{fmtTime(e.scheduledStart)}</div>
                                  <div>{fmtTime(e.scheduledEnd)}</div>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground/50">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">{fmtTime(entry.clockIn)}</TableCell>
                            <TableCell className="text-sm">{fmtTime(entry.clockOut)}</TableCell>
                            <TableCell className="text-sm">{entry.breakMinutes || 0}m</TableCell>
                            <TableCell className="text-sm font-medium">
                              {Number(entry.totalHours || 0).toFixed(1)}
                              {e.scheduledHours && (
                                <div className="text-xs text-muted-foreground">
                                  / {Number(e.scheduledHours).toFixed(1)} sched
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">
                              {Number(entry.overtimeHours || 0) > 0 ? (
                                <span className="text-primary font-medium">
                                  {Number(entry.overtimeHours).toFixed(1)}
                                </span>
                              ) : "-"}
                            </TableCell>
                            <TableCell>
                              <ExceptionBadges entry={entry} />
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={entry.status || "pending"} />
                            </TableCell>
                            <TableCell className="text-right">
                              {entry.status === "pending" && (
                                <div className="flex items-center justify-end gap-1">
                                  <Button size="icon" variant="ghost"
                                    onClick={() => updateStatus.mutate({ id: entry.id, status: "approved" })}
                                    data-testid={`button-approve-${entry.id}`}>
                                    <Check className="h-4 w-4 text-primary" />
                                  </Button>
                                  <Button size="icon" variant="ghost"
                                    onClick={() => updateStatus.mutate({ id: entry.id, status: "rejected" })}
                                    data-testid={`button-reject-${entry.id}`}>
                                    <X className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pending-punches">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Punches Awaiting Approval
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                These clock-ins had no matching schedule and require manager approval before being processed.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {pendingLoading ? (
                <div className="p-6 space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : pendingPunches.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Check className="h-10 w-10 text-emerald-500/50 mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">No pending punches</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    All clock-ins have matching schedules.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Worker</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Punch Type</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>Note</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingPunches.map((punch: any) => {
                        const worker = workerMap.get(punch.workerId);
                        const company = companyMap.get(punch.companyId);
                        return (
                          <TableRow key={punch.id} data-testid={`row-pending-punch-${punch.id}`}
                            className="bg-destructive/5">
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <div className="h-7 w-7 rounded-full bg-destructive/10 flex items-center justify-center text-xs font-medium text-destructive">
                                  {worker ? `${worker.firstName[0]}${worker.lastName[0]}` : "??"}
                                </div>
                                <span className="text-sm">
                                  {worker ? `${worker.firstName} ${worker.lastName}` : punch.workerId}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">{company?.name || "-"}</TableCell>
                            <TableCell className="text-sm capitalize">
                              {punch.punchType?.replace("_", " ")}
                            </TableCell>
                            <TableCell className="text-sm">
                              {new Date(punch.punchTime).toLocaleString("en-US", {
                                month: "short", day: "numeric",
                                hour: "numeric", minute: "2-digit",
                              })}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-48 truncate">
                              No schedule — unscheduled punch
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button size="sm" variant="outline"
                                  className="h-7 text-xs border-emerald-500 text-emerald-700 hover:bg-emerald-50"
                                  onClick={() => approvePunch.mutate({ id: punch.id, action: "approve" })}
                                  disabled={approvePunch.isPending}
                                  data-testid={`button-approve-punch-${punch.id}`}>
                                  <Check className="h-3 w-3 mr-1" /> Approve
                                </Button>
                                <Button size="sm" variant="outline"
                                  className="h-7 text-xs border-destructive text-destructive hover:bg-destructive/10"
                                  onClick={() => approvePunch.mutate({ id: punch.id, action: "reject" })}
                                  disabled={approvePunch.isPending}
                                  data-testid={`button-reject-punch-${punch.id}`}>
                                  <X className="h-3 w-3 mr-1" /> Reject
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Convert Punches Dialog */}
      <Dialog open={showConvertDialog} onOpenChange={setShowConvertDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Convert Punches to Timesheets</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              This will match clock punch pairs for the selected date range, compare them against
              the schedule, and create timesheet entries with exception flags (late, early, unscheduled).
            </p>
            <div className="space-y-2">
              <Label>Company</Label>
              <Select value={convertCompany} onValueChange={setConvertCompany}>
                <SelectTrigger data-testid="select-convert-company">
                  <SelectValue placeholder="Select company..." />
                </SelectTrigger>
                <SelectContent>
                  {companies.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={convertStart}
                  onChange={e => setConvertStart(e.target.value)}
                  data-testid="input-convert-start"
                />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={convertEnd}
                  onChange={e => setConvertEnd(e.target.value)}
                  data-testid="input-convert-end"
                />
              </div>
            </div>
            <div className="bg-muted/50 rounded-md p-3 text-xs text-muted-foreground space-y-1">
              <p>• Entries from punches that already exist will be skipped</p>
              <p>• Workers with no matching schedule will be flagged as "Unscheduled"</p>
              <p>• Late arrivals and early departures are automatically calculated</p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" data-testid="button-cancel-convert">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => convertMutation.mutate()}
              disabled={!convertCompany || !convertStart || !convertEnd || convertMutation.isPending}
              data-testid="button-confirm-convert"
            >
              {convertMutation.isPending ? "Converting..." : "Convert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
