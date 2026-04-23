import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import {
  Clock,
  Check,
  X,
  Plus,
  ClipboardList,
  Fingerprint,
  CalendarClock,
  BookOpen,
  Pencil,
  Trash2,
  MoreHorizontal,
  RefreshCw,
  AlertTriangle,
  CalendarOff,
  SlidersHorizontal,
  Star,
  Sun,
  Sunset,
  Moon,
  Sunrise,
  Coffee,
  ChevronLeft,
  ChevronRight,
  Building2,
  LayoutGrid,
  List,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { isManagerOrAbove } from "@/lib/roles";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  TimeEntry,
  TimePunch,
  Worker,
  Company,
  AccrualBalance,
  AccrualAccount,
  TimeOffRequest,
  SchedulePreference,
} from "@shared/schema";

function useTabParam(defaultTab: string): string {
  const search = useSearch();
  const params = new URLSearchParams(search);
  return params.get("tab") || defaultTab;
}

function formatTimestamp(dateStr: string | Date | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function toLocalDatetimeString(dateStr: string | Date | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant={
        status === "approved"
          ? "default"
          : status === "rejected"
          ? "destructive"
          : "secondary"
      }
      data-testid={`badge-status-${status}`}
    >
      {status === "approved" && <Check className="h-3 w-3 mr-1" />}
      {status === "rejected" && <X className="h-3 w-3 mr-1" />}
      {status === "pending" && <Clock className="h-3 w-3 mr-1" />}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function PunchTypeBadge({ type }: { type: string }) {
  const label = type.replace(/_/g, " ");
  const variant = type === "clock_in" ? "default" : type === "clock_out" ? "destructive" : "secondary";
  return (
    <Badge variant={variant} data-testid={`badge-punch-type-${type}`}>
      {label.charAt(0).toUpperCase() + label.slice(1)}
    </Badge>
  );
}

function LoadingSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="p-6 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function ExceptionBadges({ entry }: { entry: TimeEntry }) {
  const e = entry as any;
  const badges: JSX.Element[] = [];
  if (e.isUnscheduled) {
    badges.push(
      <Badge key="unscheduled" variant="destructive" className="text-xs gap-1 whitespace-nowrap">
        <AlertTriangle className="h-3 w-3" /> Unscheduled
      </Badge>
    );
  } else if (e.scheduledStart) {
    const late = Number(e.lateMinutes || 0);
    const early = Number(e.earlyDepartureMinutes || 0);
    if (late > 5) {
      badges.push(
        <Badge key="late" className="text-xs gap-1 whitespace-nowrap bg-amber-500 hover:bg-amber-600">
          <Clock className="h-3 w-3" /> Late {late}m
        </Badge>
      );
    }
    if (early > 5) {
      badges.push(
        <Badge key="early" className="text-xs gap-1 whitespace-nowrap bg-orange-500 hover:bg-orange-600">
          <Clock className="h-3 w-3" /> Left Early {early}m
        </Badge>
      );
    }
    if (late <= 5 && early <= 5) {
      badges.push(
        <Badge key="ontime" className="text-xs gap-1 whitespace-nowrap bg-emerald-600 hover:bg-emerald-700">
          <Check className="h-3 w-3" /> On Time
        </Badge>
      );
    }
  }
  return <div className="flex flex-wrap gap-1">{badges}</div>;
}

function fmtTimeOnly(ts: Date | string | null | undefined) {
  if (!ts) return null;
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { start: fmt(start), end: fmt(end) };
}

function getWeekDates(weekOffset: number): { start: string; end: string; days: Date[] } {
  const now = new Date();
  const day = now.getDay();
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - day + weekOffset * 7);
  startDate.setHours(0, 0, 0, 0);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    days.push(d);
  }
  const pad = (n: number) => n.toString().padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { start: fmt(days[0]), end: fmt(days[6]), days };
}

function TimesheetTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canEdit = isManagerOrAbove(user?.role || "");
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [workerFilter, setWorkerFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"weekly" | "list">("weekly");

  const { start: weekStart, end: weekEnd, days: weekDays } = getWeekDates(weekOffset);
  const [convertCompany, setConvertCompany] = useState("");
  const [convertStart, setConvertStart] = useState(weekStart);
  const [convertEnd, setConvertEnd] = useState(weekEnd);
  const [editForm, setEditForm] = useState({
    clockIn: "",
    clockOut: "",
    breakMinutes: "0",
    totalHours: "0",
    overtimeHours: "0",
    doubleTimeHours: "0",
    status: "pending",
  });
  const [addForm, setAddForm] = useState({
    workerId: "",
    companyId: "",
    date: new Date().toISOString().split("T")[0],
    clockIn: "",
    clockOut: "",
    breakMinutes: "0",
    totalHours: "0",
    overtimeHours: "0",
    status: "approved",
  });

  const pad = (n: number) => n.toString().padStart(2, "0");
  const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const entryQueryParams = new URLSearchParams();
  entryQueryParams.set("startDate", weekStart);
  entryQueryParams.set("endDate", weekEnd);
  if (companyFilter !== "all") entryQueryParams.set("companyId", companyFilter);
  if (workerFilter !== "all") entryQueryParams.set("workerId", workerFilter);

  const { data: entries, isLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries", weekStart, weekEnd, companyFilter, workerFilter],
    queryFn: async () => {
      const res = await fetch(`/api/time-entries?${entryQueryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load entries");
      return res.json();
    },
  });

  const { data: workers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const workerMap = new Map(workers?.map((w) => [w.id, w]) || []);
  const filteredWorkers = companyFilter !== "all"
    ? (workers || []).filter(w => w.companyId === companyFilter)
    : (workers || []);

  const updateEntry = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      await apiRequest("PATCH", `/api/time-entries/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      toast({ title: "Time entry updated" });
      setEditEntry(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createEntry = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      await apiRequest("POST", "/api/time-entries", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      toast({ title: "Time entry created" });
      setAddOpen(false);
      setAddForm({
        workerId: "",
        companyId: "",
        date: new Date().toISOString().split("T")[0],
        clockIn: "",
        clockOut: "",
        breakMinutes: "0",
        totalHours: "0",
        overtimeHours: "0",
        status: "approved",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteEntry = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/time-entries/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      toast({ title: "Time entry deleted" });
      setDeleteId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/time-entries/convert-from-punches", {
        companyId: convertCompany,
        startDate: convertStart,
        endDate: convertEnd,
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      setConvertOpen(false);
      toast({
        title: "Conversion complete",
        description: `Created ${data.created} entries, skipped ${data.skipped} already existing.`,
      });
    },
    onError: () => {
      toast({ title: "Conversion failed", variant: "destructive" });
    },
  });

  // Auto-convert punches to time entries on load and when the week changes
  useEffect(() => {
    if (!user) return;
    const companiesToConvert: string[] = user.companyId && !user.role.startsWith("platform_")
      ? [user.companyId]
      : (companies || []).map((c: any) => c.id);
    if (companiesToConvert.length === 0) return;
    (async () => {
      for (const cid of companiesToConvert) {
        try {
          await apiRequest("POST", "/api/time-entries/convert-from-punches", {
            companyId: cid,
            startDate: weekStart,
            endDate: weekEnd,
          });
        } catch {
          // Best-effort: skip companies that fail
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
    })();
  }, [weekStart, weekEnd]); // Re-run when user navigates to a different week

  const openEdit = (entry: TimeEntry) => {
    setEditEntry(entry);
    setEditForm({
      clockIn: toLocalDatetimeString(entry.clockIn),
      clockOut: toLocalDatetimeString(entry.clockOut),
      breakMinutes: String(entry.breakMinutes || 0),
      totalHours: String(entry.totalHours || 0),
      overtimeHours: String(entry.overtimeHours || 0),
      doubleTimeHours: String(entry.doubleTimeHours || 0),
      status: entry.status || "pending",
    });
  };

  const handleRecalculate = () => {
    if (editForm.clockIn && editForm.clockOut) {
      const clockIn = new Date(editForm.clockIn);
      const clockOut = new Date(editForm.clockOut);
      const diffMs = clockOut.getTime() - clockIn.getTime();
      const breakHrs = (parseInt(editForm.breakMinutes) || 0) / 60;
      const total = Math.max(0, diffMs / (1000 * 60 * 60) - breakHrs);
      const ot = total > 8 ? Math.min(total - 8, 4) : 0;
      const dt = total > 12 ? total - 12 : 0;
      setEditForm(prev => ({
        ...prev,
        totalHours: total.toFixed(2),
        overtimeHours: ot.toFixed(2),
        doubleTimeHours: dt.toFixed(2),
      }));
    }
  };

  const sortedEntries = (entries || []).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Weekly grid data
  const entryByWorkerDay = new Map<string, Map<string, TimeEntry[]>>();
  for (const entry of (entries || [])) {
    if (!entryByWorkerDay.has(entry.workerId)) entryByWorkerDay.set(entry.workerId, new Map());
    const dayMap = entryByWorkerDay.get(entry.workerId)!;
    if (!dayMap.has(entry.date)) dayMap.set(entry.date, []);
    dayMap.get(entry.date)!.push(entry);
  }
  const workerIdsInWeek = Array.from(entryByWorkerDay.keys());

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = fmtDate(new Date());

  const formatWeekRange = () => {
    const s = weekDays[0];
    const e = weekDays[6];
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    const sStr = s.toLocaleDateString("en-US", opts);
    const eStr = e.toLocaleDateString("en-US", { ...opts, year: "numeric" });
    return `${sStr} – ${eStr}`;
  };

  const statusColor = (status: string | null | undefined) => {
    if (status === "approved") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
    if (status === "rejected") return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
    return "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  };

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 px-4 pt-4">
        {/* Row 1: Week nav + view toggle + actions */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={() => setWeekOffset(w => w - 1)} data-testid="button-prev-week">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-sm font-medium min-w-[160px] text-center" data-testid="text-week-range">
              {formatWeekRange()}
            </div>
            <Button size="icon" variant="ghost" onClick={() => setWeekOffset(w => w + 1)} data-testid="button-next-week">
              <ChevronRight className="h-4 w-4" />
            </Button>
            {weekOffset !== 0 && (
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setWeekOffset(0)} data-testid="button-today-week">
                Today
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-md border">
              <Button
                size="sm" variant={viewMode === "weekly" ? "default" : "ghost"}
                className="rounded-r-none px-2.5"
                onClick={() => setViewMode("weekly")}
                data-testid="button-view-weekly"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                size="sm" variant={viewMode === "list" ? "default" : "ghost"}
                className="rounded-l-none px-2.5"
                onClick={() => setViewMode("list")}
                data-testid="button-view-list"
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setConvertOpen(true)} data-testid="button-convert-punches">
                <RefreshCw className="h-4 w-4 mr-2" />Convert Punches
              </Button>
            )}
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
            {canEdit && (
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-time-entry">
                <Plus className="h-4 w-4 mr-2" />Add Entry
              </Button>
            </DialogTrigger>
            )}
          <DialogContent>
            <DialogHeader><DialogTitle>Add Time Entry</DialogTitle></DialogHeader>
            <div className="grid gap-3 mt-2">
              <div className="grid gap-1.5">
                <Label>Employee</Label>
                <Select value={addForm.workerId} onValueChange={v => setAddForm(f => ({ ...f, workerId: v }))}>
                  <SelectTrigger data-testid="select-add-entry-worker"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {(workers || []).map(w => (
                      <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}{!w.isActive ? " (inactive)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Company</Label>
                <Select value={addForm.companyId} onValueChange={v => setAddForm(f => ({ ...f, companyId: v }))}>
                  <SelectTrigger data-testid="select-add-entry-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {(companies || []).map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Date</Label>
                <Input type="date" value={addForm.date} onChange={e => setAddForm(f => ({ ...f, date: e.target.value }))} data-testid="input-add-entry-date" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Clock In</Label>
                  <Input type="datetime-local" value={addForm.clockIn} onChange={e => {
                    const clockIn = e.target.value;
                    setAddForm(f => {
                      const update: typeof f = { ...f, clockIn };
                      if (clockIn && f.clockOut) {
                        const diffMs = new Date(f.clockOut).getTime() - new Date(clockIn).getTime();
                        const breakMs = (parseInt(f.breakMinutes) || 0) * 60000;
                        const total = Math.max(0, (diffMs - breakMs) / 3600000);
                        update.totalHours = total.toFixed(2);
                      }
                      return update;
                    });
                  }} data-testid="input-add-entry-clockin" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Clock Out</Label>
                  <Input type="datetime-local" value={addForm.clockOut} onChange={e => {
                    const clockOut = e.target.value;
                    setAddForm(f => {
                      const update: typeof f = { ...f, clockOut };
                      if (f.clockIn && clockOut) {
                        const diffMs = new Date(clockOut).getTime() - new Date(f.clockIn).getTime();
                        const breakMs = (parseInt(f.breakMinutes) || 0) * 60000;
                        const total = Math.max(0, (diffMs - breakMs) / 3600000);
                        update.totalHours = total.toFixed(2);
                      }
                      return update;
                    });
                  }} data-testid="input-add-entry-clockout" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="grid gap-1.5">
                  <Label>Break (min)</Label>
                  <Input type="number" value={addForm.breakMinutes} onChange={e => setAddForm(f => ({ ...f, breakMinutes: e.target.value }))} data-testid="input-add-entry-break" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Total Hours</Label>
                  <Input type="number" step="0.01" value={addForm.totalHours} onChange={e => setAddForm(f => ({ ...f, totalHours: e.target.value }))} data-testid="input-add-entry-total" />
                </div>
                <div className="grid gap-1.5">
                  <Label>OT Hours</Label>
                  <Input type="number" step="0.01" value={addForm.overtimeHours} onChange={e => setAddForm(f => ({ ...f, overtimeHours: e.target.value }))} data-testid="input-add-entry-ot" />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Status</Label>
                <Select value={addForm.status} onValueChange={v => setAddForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger data-testid="select-add-entry-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => createEntry.mutate({
                  workerId: addForm.workerId,
                  companyId: addForm.companyId,
                  date: addForm.date,
                  clockIn: addForm.clockIn ? new Date(addForm.clockIn).toISOString() : null,
                  clockOut: addForm.clockOut ? new Date(addForm.clockOut).toISOString() : null,
                  breakMinutes: parseInt(addForm.breakMinutes) || 0,
                  totalHours: addForm.totalHours,
                  overtimeHours: addForm.overtimeHours,
                  status: addForm.status,
                })}
                disabled={!addForm.workerId || !addForm.companyId || !addForm.date || createEntry.isPending}
                data-testid="button-submit-add-entry"
              >
                {createEntry.isPending ? "Creating..." : "Create Entry"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
          </div>
        </div>

        {/* Row 2: Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <Select value={companyFilter} onValueChange={v => { setCompanyFilter(v); setWorkerFilter("all"); }} data-testid="select-company-filter">
            <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-company-filter-trigger">
              <SelectValue placeholder="All companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {(companies || []).map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={workerFilter} onValueChange={setWorkerFilter} data-testid="select-worker-filter">
            <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-worker-filter-trigger">
              <SelectValue placeholder="All employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {filteredWorkers.map(w => (
                <SelectItem key={w.id} value={w.id}>
                  {w.firstName} {w.lastName}{!w.isActive ? " (inactive)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground ml-auto" data-testid="text-entry-count">
            {(entries || []).length} {(entries || []).length === 1 ? "entry" : "entries"}
          </span>
        </div>
      </div>

      {/* Weekly grid view */}
      {viewMode === "weekly" && (
        <div className="px-4 overflow-x-auto">
          {workerIdsInWeek.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <ClipboardList className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No time entries for this week</p>
              <p className="text-xs text-muted-foreground mt-1">Use "Convert Punches" or "Add Entry" to create entries</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left font-medium py-2 px-3 min-w-[140px] border-r">Employee</th>
                    {weekDays.map((day, i) => {
                      const dateStr = fmtDate(day);
                      const isToday = dateStr === today;
                      return (
                        <th key={i} className={`text-center font-medium py-2 px-2 min-w-[80px] border-r last:border-r-0 ${isToday ? "bg-teal-50 dark:bg-teal-950/30" : ""}`}>
                          <div className={`text-xs ${isToday ? "text-teal-700 dark:text-teal-300 font-semibold" : "text-muted-foreground"}`}>{dayLabels[i]}</div>
                          <div className={`text-xs mt-0.5 ${isToday ? "text-teal-600 dark:text-teal-400 font-medium" : "text-muted-foreground/70"}`}>
                            {day.toLocaleDateString("en-US", { month: "numeric", day: "numeric" })}
                          </div>
                        </th>
                      );
                    })}
                    <th className="text-center font-medium py-2 px-3 min-w-[70px] bg-muted/70">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {workerIdsInWeek.map(workerId => {
                    const worker = workerMap.get(workerId);
                    const dayMap = entryByWorkerDay.get(workerId)!;
                    const weekTotal = Array.from(dayMap.values())
                      .flat()
                      .reduce((sum, e) => sum + Number(e.totalHours || 0), 0);
                    return (
                      <tr key={workerId} className="border-t hover:bg-muted/20 transition-colors">
                        <td className="py-2 px-3 border-r font-medium text-sm">
                          {worker ? `${worker.firstName} ${worker.lastName}` : "Unknown"}
                          {worker?.jobTitle && <div className="text-xs text-muted-foreground font-normal truncate max-w-[130px]">{worker.jobTitle}</div>}
                        </td>
                        {weekDays.map((day, i) => {
                          const dateStr = fmtDate(day);
                          const dayEntries = dayMap.get(dateStr) || [];
                          const dayHours = dayEntries.reduce((sum, e) => sum + Number(e.totalHours || 0), 0);
                          const isToday = dateStr === today;
                          const hasOt = dayEntries.some(e => Number(e.overtimeHours || 0) > 0);
                          const firstEntry = dayEntries[0];
                          return (
                            <td key={i} className={`py-1.5 px-2 text-center border-r last:border-r-0 ${isToday ? "bg-teal-50/50 dark:bg-teal-950/20" : ""}`}>
                              {dayEntries.length > 0 ? (
                                <button
                                  className={`w-full rounded px-1.5 py-1 text-xs font-medium ${canEdit ? "transition-opacity hover:opacity-80 cursor-pointer" : "cursor-default"} ${statusColor(firstEntry?.status)}`}
                                  onClick={() => canEdit && firstEntry && openEdit(firstEntry)}
                                  data-testid={`cell-${workerId}-${dateStr}`}
                                  title={canEdit ? `${dayHours.toFixed(1)}h — click to edit` : `${dayHours.toFixed(1)}h`}
                                >
                                  <div>{dayHours.toFixed(1)}h</div>
                                  {hasOt && <div className="text-xs opacity-70">+OT</div>}
                                </button>
                              ) : (
                                <span className="text-muted-foreground/30 text-xs">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2 px-3 text-center bg-muted/30 font-semibold text-sm">
                          {weekTotal.toFixed(1)}h
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/50">
                    <td className="py-2 px-3 text-xs font-medium text-muted-foreground border-r">Daily Total</td>
                    {weekDays.map((day, i) => {
                      const dateStr = fmtDate(day);
                      const dayTotal = (entries || [])
                        .filter(e => e.date === dateStr)
                        .reduce((sum, e) => sum + Number(e.totalHours || 0), 0);
                      const isToday = dateStr === today;
                      return (
                        <td key={i} className={`py-2 px-2 text-center text-xs font-medium border-r last:border-r-0 ${isToday ? "bg-teal-50/50 dark:bg-teal-950/20" : ""}`}>
                          {dayTotal > 0 ? `${dayTotal.toFixed(1)}h` : <span className="text-muted-foreground/40">—</span>}
                        </td>
                      );
                    })}
                    <td className="py-2 px-3 text-center text-xs font-semibold bg-muted/70">
                      {(entries || []).reduce((sum, e) => sum + Number(e.totalHours || 0), 0).toFixed(1)}h
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* List view */}
      {viewMode === "list" && (
        sortedEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <ClipboardList className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No time entries for this week</p>
          </div>
        ) : (
          <div className="overflow-x-auto px-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Clock In</TableHead>
                  <TableHead>Clock Out</TableHead>
                  <TableHead>Break</TableHead>
                  <TableHead>Total Hours</TableHead>
                  <TableHead>OT Hours</TableHead>
                  <TableHead>Exceptions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedEntries.map((entry) => {
                  const worker = workerMap.get(entry.workerId);
                  const e = entry as any;
                  return (
                    <TableRow key={entry.id} data-testid={`row-timeentry-${entry.id}`}
                      className={e.isUnscheduled ? "bg-destructive/5" : ""}>
                      <TableCell className="font-medium">
                        <div>
                          <div>{worker ? `${worker.firstName} ${worker.lastName}` : "Unknown"}</div>
                          {e.source === "punches" && (
                            <div className="text-xs text-muted-foreground">From punches</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{entry.date}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {e.scheduledStart ? (
                          <div>
                            <div>{fmtTimeOnly(e.scheduledStart)}</div>
                            <div>{fmtTimeOnly(e.scheduledEnd)}</div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {entry.clockIn ? formatTimestamp(entry.clockIn) : "-"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {entry.clockOut ? formatTimestamp(entry.clockOut) : "-"}
                      </TableCell>
                      <TableCell className="text-sm">{entry.breakMinutes || 0}m</TableCell>
                      <TableCell className="text-sm font-medium">
                        {Number(entry.totalHours || 0).toFixed(1)}
                        {e.scheduledHours && (
                          <div className="text-xs text-muted-foreground">/{Number(e.scheduledHours).toFixed(1)} sched</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {Number(entry.overtimeHours || 0) > 0 ? (
                          <span className="font-medium">{Number(entry.overtimeHours).toFixed(1)}</span>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        <ExceptionBadges entry={entry} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={entry.status || "pending"} />
                      </TableCell>
                      <TableCell className="text-right">
                        {canEdit && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" data-testid={`button-entry-menu-${entry.id}`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(entry)} data-testid={`button-edit-entry-${entry.id}`}>
                                <Pencil className="h-4 w-4 mr-2" />Edit
                              </DropdownMenuItem>
                              {entry.status === "pending" && (
                                <DropdownMenuItem
                                  onClick={() => updateEntry.mutate({ id: entry.id, data: { status: "approved" } })}
                                  data-testid={`button-approve-${entry.id}`}
                                >
                                  <Check className="h-4 w-4 mr-2" />Approve
                                </DropdownMenuItem>
                              )}
                              {entry.status === "pending" && (
                                <DropdownMenuItem
                                  onClick={() => updateEntry.mutate({ id: entry.id, data: { status: "rejected" } })}
                                  data-testid={`button-reject-${entry.id}`}
                                >
                                  <X className="h-4 w-4 mr-2" />Reject
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => setDeleteId(entry.id)}
                                data-testid={`button-delete-entry-${entry.id}`}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )
      )}

      {/* Convert Punches Dialog */}
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Convert Punches to Timesheet</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Matches clock punch pairs for the selected period, compares against the schedule, and creates
              timesheet entries with exception flags.
            </p>
            <div className="space-y-2">
              <Label>Company</Label>
              <Select value={convertCompany} onValueChange={setConvertCompany}>
                <SelectTrigger data-testid="select-convert-company">
                  <SelectValue placeholder="Select company..." />
                </SelectTrigger>
                <SelectContent>
                  {(companies || []).map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={convertStart}
                  onChange={e => setConvertStart(e.target.value)}
                  data-testid="input-convert-start" />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" value={convertEnd}
                  onChange={e => setConvertEnd(e.target.value)}
                  data-testid="input-convert-end" />
              </div>
            </div>
            <div className="bg-muted/50 rounded-md p-3 text-xs text-muted-foreground space-y-1">
              <p>• Existing punch-converted entries will be skipped</p>
              <p>• Workers with no schedule are flagged as "Unscheduled"</p>
              <p>• Late arrivals and early departures are calculated automatically</p>
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

      <Dialog open={!!editEntry} onOpenChange={(open) => !open && setEditEntry(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Time Entry</DialogTitle></DialogHeader>
          {editEntry && (
            <div className="grid gap-3 mt-2">
              <p className="text-sm text-muted-foreground">
                {workerMap.get(editEntry.workerId)
                  ? `${workerMap.get(editEntry.workerId)!.firstName} ${workerMap.get(editEntry.workerId)!.lastName}`
                  : "Unknown"} — {editEntry.date}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Clock In</Label>
                  <Input type="datetime-local" value={editForm.clockIn} onChange={e => {
                    const clockIn = e.target.value;
                    setEditForm(f => {
                      const updated = { ...f, clockIn };
                      if (clockIn && f.clockOut) {
                        const diff = new Date(f.clockOut).getTime() - new Date(clockIn).getTime();
                        if (diff > 0) {
                          const breakHrs = (parseInt(f.breakMinutes) || 0) / 60;
                          const total = Math.max(0, diff / 3600000 - breakHrs);
                          const ot = total > 8 ? Math.min(total - 8, 4) : 0;
                          const dt = total > 12 ? total - 12 : 0;
                          updated.totalHours = total.toFixed(2);
                          updated.overtimeHours = ot.toFixed(2);
                          updated.doubleTimeHours = dt.toFixed(2);
                        }
                      }
                      return updated;
                    });
                  }} data-testid="input-edit-clockin" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Clock Out</Label>
                  <Input type="datetime-local" value={editForm.clockOut} onChange={e => {
                    const clockOut = e.target.value;
                    setEditForm(f => {
                      const updated = { ...f, clockOut };
                      if (f.clockIn && clockOut) {
                        const diff = new Date(clockOut).getTime() - new Date(f.clockIn).getTime();
                        if (diff > 0) {
                          const breakHrs = (parseInt(f.breakMinutes) || 0) / 60;
                          const total = Math.max(0, diff / 3600000 - breakHrs);
                          const ot = total > 8 ? Math.min(total - 8, 4) : 0;
                          const dt = total > 12 ? total - 12 : 0;
                          updated.totalHours = total.toFixed(2);
                          updated.overtimeHours = ot.toFixed(2);
                          updated.doubleTimeHours = dt.toFixed(2);
                        }
                      }
                      return updated;
                    });
                  }} data-testid="input-edit-clockout" />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Break (minutes)</Label>
                <Input type="number" value={editForm.breakMinutes} onChange={e => setEditForm(f => ({ ...f, breakMinutes: e.target.value }))} data-testid="input-edit-break" />
              </div>
              <Button variant="outline" size="sm" onClick={handleRecalculate} data-testid="button-recalculate">
                Recalculate Hours
              </Button>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="grid gap-1.5">
                  <Label>Total Hours</Label>
                  <Input type="number" step="0.01" value={editForm.totalHours} onChange={e => setEditForm(f => ({ ...f, totalHours: e.target.value }))} data-testid="input-edit-total" />
                </div>
                <div className="grid gap-1.5">
                  <Label>OT Hours</Label>
                  <Input type="number" step="0.01" value={editForm.overtimeHours} onChange={e => setEditForm(f => ({ ...f, overtimeHours: e.target.value }))} data-testid="input-edit-ot" />
                </div>
                <div className="grid gap-1.5">
                  <Label>DT Hours</Label>
                  <Input type="number" step="0.01" value={editForm.doubleTimeHours} onChange={e => setEditForm(f => ({ ...f, doubleTimeHours: e.target.value }))} data-testid="input-edit-dt" />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Status</Label>
                <Select value={editForm.status} onValueChange={v => setEditForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger data-testid="select-edit-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => updateEntry.mutate({
                  id: editEntry.id,
                  data: {
                    clockIn: editForm.clockIn ? new Date(editForm.clockIn).toISOString() : null,
                    clockOut: editForm.clockOut ? new Date(editForm.clockOut).toISOString() : null,
                    breakMinutes: parseInt(editForm.breakMinutes) || 0,
                    totalHours: editForm.totalHours,
                    overtimeHours: editForm.overtimeHours,
                    doubleTimeHours: editForm.doubleTimeHours,
                    status: editForm.status,
                  },
                })}
                disabled={updateEntry.isPending}
                data-testid="button-save-entry"
              >
                {updateEntry.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Time Entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this time entry. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteEntry.mutate(deleteId)}
              data-testid="button-confirm-delete-entry"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PunchesTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canEdit = isManagerOrAbove(user?.role || "");
  const [editPunch, setEditPunch] = useState<TimePunch | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ punchType: "clock_in", punchTime: "", note: "" });
  const [addForm, setAddForm] = useState({
    workerId: "",
    companyId: "",
    punchType: "clock_in",
    punchTime: "",
    note: "",
  });

  const { data: punches, isLoading } = useQuery<TimePunch[]>({
    queryKey: ["/api/time-punches"],
  });

  const { data: workers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const workerMap = new Map(workers?.map((w) => [w.id, w]) || []);

  const updatePunch = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      await apiRequest("PATCH", `/api/time-punches/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-punches"] });
      toast({ title: "Punch updated" });
      setEditPunch(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createPunch = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      await apiRequest("POST", "/api/time-punches", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-punches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      toast({ title: "Punch created" });
      setAddOpen(false);
      setAddForm({ workerId: "", companyId: "", punchType: "clock_in", punchTime: "", note: "" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deletePunch = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/time-punches/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-punches"] });
      toast({ title: "Punch deleted" });
      setDeleteId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const openEdit = (punch: TimePunch) => {
    setEditPunch(punch);
    setEditForm({
      punchType: punch.punchType,
      punchTime: toLocalDatetimeString(punch.punchTime),
      note: punch.note || "",
    });
  };

  const sortedPunches = (punches || []).sort(
    (a, b) => new Date(b.punchTime).getTime() - new Date(a.punchTime).getTime()
  );

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-4 pt-4">
        <p className="text-sm text-muted-foreground">{sortedPunches.length} punches</p>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          {canEdit && (
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-punch">
              <Plus className="h-4 w-4 mr-2" />Add Punch
            </Button>
          </DialogTrigger>
          )}
          <DialogContent>
            <DialogHeader><DialogTitle>Add Manual Punch</DialogTitle></DialogHeader>
            <div className="grid gap-3 mt-2">
              <div className="grid gap-1.5">
                <Label>Employee</Label>
                <Select value={addForm.workerId} onValueChange={v => setAddForm(f => ({ ...f, workerId: v }))}>
                  <SelectTrigger data-testid="select-add-punch-worker"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {(workers || []).map(w => (
                      <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}{!w.isActive ? " (inactive)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Company</Label>
                <Select value={addForm.companyId} onValueChange={v => setAddForm(f => ({ ...f, companyId: v }))}>
                  <SelectTrigger data-testid="select-add-punch-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {(companies || []).map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Punch Type</Label>
                <Select value={addForm.punchType} onValueChange={v => setAddForm(f => ({ ...f, punchType: v }))}>
                  <SelectTrigger data-testid="select-add-punch-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="clock_in">Clock In</SelectItem>
                    <SelectItem value="clock_out">Clock Out</SelectItem>
                    <SelectItem value="break_start">Break Start</SelectItem>
                    <SelectItem value="break_end">Break End</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Punch Time</Label>
                <Input type="datetime-local" value={addForm.punchTime} onChange={e => setAddForm(f => ({ ...f, punchTime: e.target.value }))} data-testid="input-add-punch-time" />
              </div>
              <div className="grid gap-1.5">
                <Label>Note (optional)</Label>
                <Textarea value={addForm.note} onChange={e => setAddForm(f => ({ ...f, note: e.target.value }))} placeholder="e.g., Missed punch — manually added" data-testid="input-add-punch-note" />
              </div>
              <Button
                onClick={() => createPunch.mutate({
                  workerId: addForm.workerId,
                  companyId: addForm.companyId,
                  punchType: addForm.punchType,
                  punchTime: addForm.punchTime ? new Date(addForm.punchTime).toISOString() : new Date().toISOString(),
                  note: addForm.note || undefined,
                })}
                disabled={!addForm.workerId || !addForm.companyId || !addForm.punchTime || createPunch.isPending}
                data-testid="button-submit-add-punch"
              >
                {createPunch.isPending ? "Creating..." : "Create Punch"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {sortedPunches.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Fingerprint className="h-12 w-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No punches found</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Punch Time</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedPunches.map((punch) => {
                const worker = workerMap.get(punch.workerId);
                return (
                  <TableRow key={punch.id} data-testid={`row-punch-${punch.id}`}>
                    <TableCell className="font-medium">
                      {worker ? `${worker.firstName} ${worker.lastName}` : "Unknown"}
                    </TableCell>
                    <TableCell>
                      <PunchTypeBadge type={punch.punchType} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatTimestamp(punch.punchTime)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {punch.note || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEdit && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" data-testid={`button-punch-menu-${punch.id}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(punch)} data-testid={`button-edit-punch-${punch.id}`}>
                              <Pencil className="h-4 w-4 mr-2" />Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeleteId(punch.id)}
                              data-testid={`button-delete-punch-${punch.id}`}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!editPunch} onOpenChange={(open) => !open && setEditPunch(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Punch</DialogTitle></DialogHeader>
          {editPunch && (
            <div className="grid gap-3 mt-2">
              <p className="text-sm text-muted-foreground font-medium">
                {workerMap.get(editPunch.workerId)
                  ? `${workerMap.get(editPunch.workerId)!.firstName} ${workerMap.get(editPunch.workerId)!.lastName}`
                  : "Unknown"}
              </p>
              <div className="grid gap-1.5">
                <Label>Punch Type</Label>
                <Select value={editForm.punchType} onValueChange={v => setEditForm(f => ({ ...f, punchType: v }))}>
                  <SelectTrigger data-testid="select-edit-punch-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="clock_in">Clock In</SelectItem>
                    <SelectItem value="clock_out">Clock Out</SelectItem>
                    <SelectItem value="break_start">Break In</SelectItem>
                    <SelectItem value="break_end">Break Out</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Punch Time</Label>
                <Input type="datetime-local" value={editForm.punchTime} onChange={e => setEditForm(f => ({ ...f, punchTime: e.target.value }))} data-testid="input-edit-punch-time" />
              </div>
              <div className="grid gap-1.5">
                <Label>Note</Label>
                <Textarea value={editForm.note} onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))} data-testid="input-edit-punch-note" />
              </div>
              <Button
                onClick={() => updatePunch.mutate({
                  id: editPunch.id,
                  data: {
                    punchType: editForm.punchType,
                    punchTime: editForm.punchTime ? new Date(editForm.punchTime).toISOString() : undefined,
                    note: editForm.note,
                  },
                })}
                disabled={updatePunch.isPending}
                data-testid="button-save-punch"
              >
                {updatePunch.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Punch?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this punch record. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deletePunch.mutate(deleteId)}
              data-testid="button-confirm-delete-punch"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AccrualBalancesTab() {
  const { data: balances, isLoading } = useQuery<AccrualBalance[]>({
    queryKey: ["/api/accrual-balances"],
  });

  const { data: workers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  const { data: accounts } = useQuery<AccrualAccount[]>({
    queryKey: ["/api/accrual-accounts"],
  });

  const workerMap = new Map(workers?.map((w) => [w.id, w]) || []);
  const accountMap = new Map(accounts?.map((a) => [a.id, a]) || []);

  if (isLoading) return <LoadingSkeleton />;

  if (!balances || balances.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <CalendarClock className="h-12 w-12 text-muted-foreground/30 mb-3" />
        <p className="text-sm font-medium text-muted-foreground">No accrual balances found</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Balance</TableHead>
            <TableHead>Used Hours</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {balances.map((bal) => {
            const worker = workerMap.get(bal.workerId);
            const account = accountMap.get(bal.accrualAccountId);
            return (
              <TableRow key={bal.id} data-testid={`row-balance-${bal.id}`}>
                <TableCell className="font-medium">
                  {worker ? `${worker.firstName} ${worker.lastName}` : "Unknown"}
                </TableCell>
                <TableCell className="text-sm">
                  {account ? account.name : bal.accrualAccountId}
                </TableCell>
                <TableCell className="text-sm font-medium">
                  {Number(bal.balance || 0).toFixed(1)}
                </TableCell>
                <TableCell className="text-sm">
                  {Number(bal.usedHours || 0).toFixed(1)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function AccrualsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    type: "pto",
    accrualRate: "",
    accrualFrequency: "per_pay_period",
    maxBalance: "",
    companyId: "",
  });

  const { data: accounts, isLoading } = useQuery<AccrualAccount[]>({
    queryKey: ["/api/accrual-accounts"],
  });

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const createAccount = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/accrual-accounts", {
        ...formData,
        accrualRate: formData.accrualRate || "0",
        maxBalance: formData.maxBalance || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accrual-accounts"] });
      toast({ title: "Accrual account created" });
      setDialogOpen(false);
      setFormData({
        name: "",
        type: "pto",
        accrualRate: "",
        accrualFrequency: "per_pay_period",
        maxBalance: "",
        companyId: "",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-accrual-account">
              <Plus className="h-4 w-4 mr-2" />
              Add Accrual Account
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Accrual Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label htmlFor="accrual-name">Name</Label>
                <Input
                  id="accrual-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Vacation Days"
                  data-testid="input-accrual-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v })}>
                  <SelectTrigger data-testid="select-accrual-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pto">PTO</SelectItem>
                    <SelectItem value="sick">Sick</SelectItem>
                    <SelectItem value="vacation">Vacation</SelectItem>
                    <SelectItem value="personal">Personal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="accrual-rate">Accrual Rate</Label>
                <Input
                  id="accrual-rate"
                  type="number"
                  value={formData.accrualRate}
                  onChange={(e) => setFormData({ ...formData, accrualRate: e.target.value })}
                  placeholder="e.g., 4"
                  data-testid="input-accrual-rate"
                />
              </div>
              <div className="space-y-2">
                <Label>Accrual Frequency</Label>
                <Select value={formData.accrualFrequency} onValueChange={(v) => setFormData({ ...formData, accrualFrequency: v })}>
                  <SelectTrigger data-testid="select-accrual-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_pay_period">Per Pay Period</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="annually">Annually</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-balance">Max Balance</Label>
                <Input
                  id="max-balance"
                  type="number"
                  value={formData.maxBalance}
                  onChange={(e) => setFormData({ ...formData, maxBalance: e.target.value })}
                  placeholder="e.g., 120"
                  data-testid="input-max-balance"
                />
              </div>
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={formData.companyId} onValueChange={(v) => setFormData({ ...formData, companyId: v })}>
                  <SelectTrigger data-testid="select-accrual-company">
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    {(companies || []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full"
                onClick={() => createAccount.mutate()}
                disabled={createAccount.isPending || !formData.name || !formData.companyId}
                data-testid="button-submit-accrual-account"
              >
                {createAccount.isPending ? "Creating..." : "Create Account"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {(!accounts || accounts.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-16">
          <BookOpen className="h-12 w-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No accrual accounts found</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Accrual Rate</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Max Balance</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id} data-testid={`row-accrual-${account.id}`}>
                  <TableCell className="font-medium">{account.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" data-testid={`badge-accrual-type-${account.id}`}>
                      {(account.type || "pto").toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {Number(account.accrualRate || 0)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {(account.accrualFrequency || "per_pay_period").replace(/_/g, " ")}
                  </TableCell>
                  <TableCell className="text-sm">
                    {account.maxBalance ? Number(account.maxBalance) : "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={account.isActive ? "default" : "secondary"} data-testid={`badge-active-${account.id}`}>
                      {account.isActive ? "Active" : "Inactive"}
                    </Badge>
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

function PendingApprovalsTab() {
  const { toast } = useToast();

  const { data: pendingPunches = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/time-punches/pending"],
  });

  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const workerMap = new Map(workers.map(w => [w.id, w]));
  const companyMap = new Map(companies.map(c => [c.id, c]));

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

  if (isLoading) return <LoadingSkeleton rows={3} />;

  return (
    <div className="space-y-4">
      {pendingPunches.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Check className="h-12 w-12 text-emerald-500/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No pending punches</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            All clock-ins matched a schedule.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="px-4 pt-4 pb-2">
            <p className="text-sm text-muted-foreground">
              {pendingPunches.length} punch{pendingPunches.length !== 1 ? "es" : ""} awaiting approval.
              These clock-ins had no matching schedule and require manager review before payroll processing.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worker</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingPunches.map((punch: any) => {
                const worker = workerMap.get(punch.workerId);
                const company = companyMap.get(punch.companyId);
                return (
                  <TableRow key={punch.id} data-testid={`row-pending-punch-${punch.id}`}
                    className="bg-amber-50/50 dark:bg-amber-950/10">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-xs font-medium text-amber-700 dark:text-amber-400">
                          {worker ? `${(worker.firstName || "?")[0]}${(worker.lastName || "?")[0]}` : "??"}
                        </div>
                        <span className="text-sm">
                          {worker ? `${worker.firstName} ${worker.lastName}` : "Unknown"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{company?.name || "-"}</TableCell>
                    <TableCell>
                      <PunchTypeBadge type={punch.punchType} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatTimestamp(punch.punchTime)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300">
                        <AlertTriangle className="h-3 w-3" /> No matching schedule
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="outline"
                          className="h-7 text-xs border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
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
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const TIME_OFF_TYPES = [
  { value: "vacation", label: "Vacation" },
  { value: "personal", label: "Personal" },
  { value: "sick", label: "Sick" },
  { value: "unpaid", label: "Unpaid" },
  { value: "bereavement", label: "Bereavement" },
  { value: "jury_duty", label: "Jury Duty" },
  { value: "medical", label: "Medical" },
  { value: "other", label: "Other" },
];

const SHIFT_TIMES = [
  { value: "early_morning", label: "Early Morning (before 6am)" },
  { value: "morning", label: "Morning (6am–12pm)" },
  { value: "midday", label: "Midday (10am–2pm)" },
  { value: "afternoon", label: "Afternoon (12pm–6pm)" },
  { value: "evening", label: "Evening (4pm–10pm)" },
  { value: "graveyard", label: "Graveyard (10pm–6am)" },
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function importanceBadge(n: number) {
  const map: Record<number, { label: string; className: string }> = {
    1: { label: "Critical", className: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400" },
    2: { label: "High", className: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400" },
    3: { label: "Medium", className: "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400" },
    4: { label: "Low", className: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400" },
    5: { label: "Lowest", className: "bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400" },
  };
  const m = map[n] ?? map[3];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${m.className}`}>{m.label}</span>;
}

function timeOffStatusBadge(status: string) {
  if (status === "approved") return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400">Approved</Badge>;
  if (status === "denied") return <Badge className="bg-red-100 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400">Denied</Badge>;
  return <Badge variant="secondary">Pending</Badge>;
}

// ── Time-Off Requests Tab ────────────────────────────────────────────────────
function TimeOffRequestsTab() {
  const { toast } = useToast();
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [workerFilter, setWorkerFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<TimeOffRequest | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ workerId: "", companyId: "", requestType: "vacation", startDate: "", endDate: "", reason: "" });
  const [reviewForm, setReviewForm] = useState({ decision: "approved", reviewNote: "" });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: requests = [], isLoading } = useQuery<TimeOffRequest[]>({
    queryKey: ["/api/time-off-requests", companyFilter, workerFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (companyFilter !== "all") params.set("companyId", companyFilter);
      if (workerFilter !== "all") params.set("workerId", workerFilter);
      const res = await fetch(`/api/time-off-requests?${params}`);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest("POST", "/api/time-off-requests", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-off-requests"] });
      setDialogOpen(false);
      setForm({ workerId: "", companyId: "", requestType: "vacation", startDate: "", endDate: "", reason: "" });
      toast({ title: "Request created" });
    },
    onError: () => toast({ title: "Failed to create request", variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof reviewForm }) =>
      apiRequest("PATCH", `/api/time-off-requests/${id}/review`, { decision: data.decision, reviewNote: data.reviewNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-off-requests"] });
      setReviewDialogOpen(false);
      toast({ title: "Request reviewed" });
    },
    onError: () => toast({ title: "Failed to review request", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/time-off-requests/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-off-requests"] });
      setDeleteId(null);
      toast({ title: "Request deleted" });
    },
    onError: () => toast({ title: "Failed to delete request", variant: "destructive" }),
  });

  const filteredWorkers = form.companyId ? workers.filter(w => w.companyId === form.companyId) : workers;
  const workerName = (id: string) => { const w = workers.find(x => x.id === id); return w ? `${w.firstName} ${w.lastName}` : id; };
  const companyName = (id: string) => companies.find(x => x.id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center justify-between p-4 pb-0">
        <div className="flex gap-2">
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="w-44 h-8 text-sm" data-testid="select-tor-company">
              <SelectValue placeholder="All Companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={workerFilter} onValueChange={setWorkerFilter}>
            <SelectTrigger className="w-44 h-8 text-sm" data-testid="select-tor-worker">
              <SelectValue placeholder="All Employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {workers.map(w => <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-time-off-request">
              <Plus className="h-4 w-4 mr-1" /> New Request
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Time-Off Request</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={v => setForm(f => ({ ...f, companyId: v, workerId: "" }))}>
                  <SelectTrigger data-testid="select-tor-form-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Employee</Label>
                <Select value={form.workerId} onValueChange={v => setForm(f => ({ ...f, workerId: v }))}>
                  <SelectTrigger data-testid="select-tor-form-worker"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>{filteredWorkers.map(w => <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Request Type</Label>
                <Select value={form.requestType} onValueChange={v => setForm(f => ({ ...f, requestType: v }))}>
                  <SelectTrigger data-testid="select-tor-form-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{TIME_OFF_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <Label>Start Date</Label>
                  <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} data-testid="input-tor-start-date" />
                </div>
                <div>
                  <Label>End Date</Label>
                  <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} data-testid="input-tor-end-date" />
                </div>
              </div>
              <div>
                <Label>Reason (optional)</Label>
                <Textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} rows={2} data-testid="textarea-tor-reason" />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button
                onClick={() => createMutation.mutate(form)}
                disabled={createMutation.isPending || !form.workerId || !form.companyId || !form.startDate || !form.endDate}
                data-testid="button-submit-tor">
                {createMutation.isPending ? "Saving…" : "Submit Request"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : requests.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <CalendarOff className="h-10 w-10 mx-auto mb-2 opacity-30" />
          <p>No time-off requests found</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Review Note</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map(r => (
              <TableRow key={r.id} data-testid={`row-tor-${r.id}`}>
                <TableCell className="font-medium">{workerName(r.workerId)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{companyName(r.companyId)}</TableCell>
                <TableCell className="capitalize text-sm">{TIME_OFF_TYPES.find(t => t.value === r.requestType)?.label ?? r.requestType}</TableCell>
                <TableCell className="text-sm">{r.startDate} → {r.endDate}</TableCell>
                <TableCell>{timeOffStatusBadge(r.status)}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[160px] truncate">{r.reviewNote ?? "—"}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" data-testid={`menu-tor-${r.id}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {r.status === "pending" && (
                        <DropdownMenuItem onClick={() => { setSelectedRequest(r); setReviewForm({ decision: "approved", reviewNote: "" }); setReviewDialogOpen(true); }}
                          data-testid={`menu-review-tor-${r.id}`}>
                          <Check className="h-4 w-4 mr-2" /> Review
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(r.id)} data-testid={`menu-delete-tor-${r.id}`}>
                        <Trash2 className="h-4 w-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      )}

      {/* Review Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Review Time-Off Request</DialogTitle></DialogHeader>
          {selectedRequest && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                <strong>{workerName(selectedRequest.workerId)}</strong> — {TIME_OFF_TYPES.find(t => t.value === selectedRequest.requestType)?.label} from {selectedRequest.startDate} to {selectedRequest.endDate}
              </p>
              <div>
                <Label>Decision</Label>
                <Select value={reviewForm.decision} onValueChange={v => setReviewForm(f => ({ ...f, decision: v }))}>
                  <SelectTrigger data-testid="select-review-decision"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approved">Approve</SelectItem>
                    <SelectItem value="denied">Deny</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Note (optional)</Label>
                <Textarea value={reviewForm.reviewNote} onChange={e => setReviewForm(f => ({ ...f, reviewNote: e.target.value }))} rows={2} data-testid="textarea-review-note" />
              </div>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button
              onClick={() => selectedRequest && reviewMutation.mutate({ id: selectedRequest.id, data: reviewForm })}
              disabled={reviewMutation.isPending}
              data-testid="button-submit-review">
              {reviewMutation.isPending ? "Saving…" : "Submit Review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this request?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Schedule Preferences Tab ─────────────────────────────────────────────────
function SchedulePreferencesTab() {
  const { toast } = useToast();
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [workerFilter, setWorkerFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({
    workerId: "", companyId: "", preferenceType: "day_off",
    dayOfWeek: "none" as string, shiftTime: "none", preferNotToWork: false, importance: 3, note: "",
  });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: prefs = [], isLoading } = useQuery<SchedulePreference[]>({
    queryKey: ["/api/schedule-preferences", companyFilter, workerFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (companyFilter !== "all") params.set("companyId", companyFilter);
      if (workerFilter !== "all") params.set("workerId", workerFilter);
      const res = await fetch(`/api/schedule-preferences?${params}`);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest("POST", "/api/schedule-preferences", {
      ...data,
      dayOfWeek: data.dayOfWeek !== "none" ? Number(data.dayOfWeek) : null,
      shiftTime: data.shiftTime !== "none" ? data.shiftTime : null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-preferences"] });
      setDialogOpen(false);
      setForm({ workerId: "", companyId: "", preferenceType: "day_off", dayOfWeek: "none", shiftTime: "none", preferNotToWork: false, importance: 3, note: "" });
      toast({ title: "Preference saved" });
    },
    onError: () => toast({ title: "Failed to save preference", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/schedule-preferences/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-preferences"] });
      setDeleteId(null);
      toast({ title: "Preference deleted" });
    },
    onError: () => toast({ title: "Failed to delete preference", variant: "destructive" }),
  });

  const filteredWorkers = form.companyId ? workers.filter(w => w.companyId === form.companyId) : workers;
  const workerName = (id: string) => { const w = workers.find(x => x.id === id); return w ? `${w.firstName} ${w.lastName}` : id; };
  const companyName = (id: string) => companies.find(x => x.id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center justify-between p-4 pb-0">
        <div className="flex gap-2">
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="w-44 h-8 text-sm" data-testid="select-sp-company">
              <SelectValue placeholder="All Companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={workerFilter} onValueChange={setWorkerFilter}>
            <SelectTrigger className="w-44 h-8 text-sm" data-testid="select-sp-worker">
              <SelectValue placeholder="All Employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {workers.map(w => <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-schedule-pref">
              <Plus className="h-4 w-4 mr-1" /> Add Preference
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Schedule Preference</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={v => setForm(f => ({ ...f, companyId: v, workerId: "" }))}>
                  <SelectTrigger data-testid="select-sp-form-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Employee</Label>
                <Select value={form.workerId} onValueChange={v => setForm(f => ({ ...f, workerId: v }))}>
                  <SelectTrigger data-testid="select-sp-form-worker"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>{filteredWorkers.map(w => <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Preference Type</Label>
                <Select value={form.preferenceType} onValueChange={v => setForm(f => ({ ...f, preferenceType: v }))}>
                  <SelectTrigger data-testid="select-sp-form-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day_off">Day Off</SelectItem>
                    <SelectItem value="preferred_day">Preferred Work Day</SelectItem>
                    <SelectItem value="preferred_shift">Preferred Shift</SelectItem>
                    <SelectItem value="unavailable">Unavailable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <Label>Day of Week</Label>
                  <Select value={String(form.dayOfWeek)} onValueChange={v => setForm(f => ({ ...f, dayOfWeek: v }))}>
                    <SelectTrigger data-testid="select-sp-form-day"><SelectValue placeholder="Any day" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Any day</SelectItem>
                      {DAY_NAMES.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Shift Time</Label>
                  <Select value={form.shiftTime} onValueChange={v => setForm(f => ({ ...f, shiftTime: v }))}>
                    <SelectTrigger data-testid="select-sp-form-shift"><SelectValue placeholder="Any shift" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Any shift</SelectItem>
                      {SHIFT_TIMES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Importance (1=Critical, 5=Lowest)</Label>
                <Select value={String(form.importance)} onValueChange={v => setForm(f => ({ ...f, importance: Number(v) }))}>
                  <SelectTrigger data-testid="select-sp-form-importance"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 — Critical</SelectItem>
                    <SelectItem value="2">2 — High</SelectItem>
                    <SelectItem value="3">3 — Medium</SelectItem>
                    <SelectItem value="4">4 — Low</SelectItem>
                    <SelectItem value="5">5 — Lowest</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Note (optional)</Label>
                <Input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} data-testid="input-sp-form-note" />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button
                onClick={() => createMutation.mutate(form)}
                disabled={createMutation.isPending || !form.workerId || !form.companyId}
                data-testid="button-submit-sp">
                {createMutation.isPending ? "Saving…" : "Save Preference"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : prefs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <SlidersHorizontal className="h-10 w-10 mx-auto mb-2 opacity-30" />
          <p>No schedule preferences found</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Day</TableHead>
              <TableHead>Shift</TableHead>
              <TableHead>Importance</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prefs.map(p => (
              <TableRow key={p.id} data-testid={`row-sp-${p.id}`}>
                <TableCell className="font-medium">{workerName(p.workerId)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{companyName(p.companyId)}</TableCell>
                <TableCell className="capitalize text-sm">{p.preferenceType.replace(/_/g, " ")}</TableCell>
                <TableCell className="text-sm">{p.dayOfWeek != null ? DAY_NAMES[p.dayOfWeek] ?? String(p.dayOfWeek) : "—"}</TableCell>
                <TableCell className="text-sm">{SHIFT_TIMES.find(s => s.value === p.shiftTime)?.label.split(" ")[0] ?? "—"}</TableCell>
                <TableCell>{importanceBadge(p.importance)}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[140px] truncate">{p.note ?? "—"}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => setDeleteId(p.id)} data-testid={`button-delete-sp-${p.id}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this preference?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type ClockInRequest = {
  id: string;
  worker_id: string;
  company_id: string;
  request_type: string;
  requested_at: string;
  minutes_diff: number;
  scheduled_start: string | null;
  scheduled_end: string | null;
  status: string;
  denial_reason: string | null;
  first_name: string;
  last_name: string;
  employee_number: string | null;
  company_name: string;
};

function ClockInApprovalsTab() {
  const { toast } = useToast();
  const [denyId, setDenyId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");

  const { data: requests = [], isLoading, refetch } = useQuery<ClockInRequest[]>({
    queryKey: ["/api/clock-in-requests", statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/clock-in-requests?status=${statusFilter}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/clock-in-requests/${id}/approve`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message); }
    },
    onSuccess: () => { toast({ title: "Clock-in approved" }); refetch(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const denyMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await fetch(`/api/clock-in-requests/${id}/deny`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message); }
    },
    onSuccess: () => { toast({ title: "Clock-in denied" }); setDenyId(null); setDenyReason(""); refetch(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function requestLabel(type: string) {
    if (type === "early_clockin") return "Early Clock-In";
    if (type === "late_clockin") return "Late Clock-In";
    if (type === "unscheduled") return "Unscheduled";
    return type.replace(/_/g, " ");
  }

  function requestBadgeClass(type: string) {
    if (type === "early_clockin") return "bg-blue-500 hover:bg-blue-600";
    if (type === "late_clockin") return "bg-amber-500 hover:bg-amber-600";
    if (type === "unscheduled") return "bg-red-500 hover:bg-red-600";
    return "";
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">Show:</p>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36" data-testid="select-request-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-requests">
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : requests.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm" data-testid="text-no-requests">
          No {statusFilter} clock-in requests.
        </div>
      ) : (
        <Table data-testid="table-clock-in-requests">
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Requested At</TableHead>
              <TableHead>Scheduled Start</TableHead>
              <TableHead>Status</TableHead>
              {statusFilter === "pending" && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map(r => (
              <TableRow key={r.id} data-testid={`row-request-${r.id}`}>
                <TableCell className="font-medium">
                  {r.first_name} {r.last_name}
                  {r.employee_number && <span className="text-xs text-muted-foreground ml-1">#{r.employee_number}</span>}
                </TableCell>
                <TableCell>{r.company_name}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Badge className={`text-xs text-white w-fit ${requestBadgeClass(r.request_type)}`}>
                      {requestLabel(r.request_type)}
                    </Badge>
                    {r.request_type !== "unscheduled" && r.minutes_diff !== null && (
                      <span className="text-xs text-muted-foreground">
                        {Math.abs(r.minutes_diff)} min {r.minutes_diff < 0 ? "early" : "late"}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm">{formatTimestamp(r.requested_at)}</TableCell>
                <TableCell className="text-sm">
                  {r.scheduled_start ? fmtTimeOnly(r.scheduled_start) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  {r.status === "pending" && <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending</Badge>}
                  {r.status === "approved" && <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white"><Check className="h-3 w-3 mr-1" />Approved</Badge>}
                  {r.status === "denied" && (
                    <div className="flex flex-col gap-0.5">
                      <Badge variant="destructive"><X className="h-3 w-3 mr-1" />Denied</Badge>
                      {r.denial_reason && <span className="text-xs text-muted-foreground">{r.denial_reason}</span>}
                    </div>
                  )}
                </TableCell>
                {statusFilter === "pending" && (
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white h-7 px-2"
                        onClick={() => approveMutation.mutate(r.id)}
                        disabled={approveMutation.isPending}
                        data-testid={`button-approve-${r.id}`}
                      >
                        <Check className="h-3.5 w-3.5 mr-1" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 px-2"
                        onClick={() => { setDenyId(r.id); setDenyReason(""); }}
                        data-testid={`button-deny-${r.id}`}
                      >
                        <X className="h-3.5 w-3.5 mr-1" /> Deny
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!denyId} onOpenChange={open => !open && setDenyId(null)}>
        <DialogContent data-testid="dialog-deny-request">
          <DialogHeader>
            <DialogTitle>Deny Clock-In Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="deny-reason">Reason (optional)</Label>
            <Textarea
              id="deny-reason"
              value={denyReason}
              onChange={e => setDenyReason(e.target.value)}
              placeholder="E.g., Not approved — contact your manager before clocking in outside your schedule."
              rows={3}
              data-testid="input-deny-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDenyId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => denyId && denyMutation.mutate({ id: denyId, reason: denyReason })}
              disabled={denyMutation.isPending}
              data-testid="button-confirm-deny"
            >
              {denyMutation.isPending ? "Denying..." : "Deny Clock-In"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AttendancePage() {
  const currentTab = useTabParam("timesheet");

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-attendance-title">
          Attendance
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage timesheets, punches, and accrual balances.
        </p>
      </div>

      <Tabs value={currentTab} className="w-full">
        <div className="overflow-x-auto -mx-1 px-1">
        <TabsList className="inline-flex w-max" data-testid="tabs-attendance">
          <Link href="/app/attendance?tab=timesheet">
            <TabsTrigger value="timesheet" data-testid="tab-timesheet" asChild>
              <span className="flex items-center gap-1.5">
                <ClipboardList className="h-4 w-4" />
                Timesheet
              </span>
            </TabsTrigger>
          </Link>
          <Link href="/app/attendance?tab=punches">
            <TabsTrigger value="punches" data-testid="tab-punches" asChild>
              <span className="flex items-center gap-1.5">
                <Fingerprint className="h-4 w-4" />
                Punches
              </span>
            </TabsTrigger>
          </Link>
          <Link href="/app/attendance?tab=accrual-balances">
            <TabsTrigger value="accrual-balances" data-testid="tab-accrual-balances" asChild>
              <span className="flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4" />
                Accrual Balances
              </span>
            </TabsTrigger>
          </Link>
          <Link href="/app/attendance?tab=accruals">
            <TabsTrigger value="accruals" data-testid="tab-accruals" asChild>
              <span className="flex items-center gap-1.5">
                <BookOpen className="h-4 w-4" />
                Accruals
              </span>
            </TabsTrigger>
          </Link>
          <Link href="/app/attendance?tab=pending-approvals">
            <TabsTrigger value="pending-approvals" data-testid="tab-pending-approvals" asChild>
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                Pending Approvals
              </span>
            </TabsTrigger>
          </Link>
          <Link href="/app/attendance?tab=time-off">
            <TabsTrigger value="time-off" data-testid="tab-time-off" asChild>
              <span className="flex items-center gap-1.5">
                <CalendarOff className="h-4 w-4" />
                Time Off
              </span>
            </TabsTrigger>
          </Link>
          <Link href="/app/attendance?tab=clock-in-approvals">
            <TabsTrigger value="clock-in-approvals" data-testid="tab-clock-in-approvals" asChild>
              <span className="flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                Clock-In Approvals
              </span>
            </TabsTrigger>
          </Link>
          <Link href="/app/attendance?tab=schedule-preferences">
            <TabsTrigger value="schedule-preferences" data-testid="tab-schedule-preferences" asChild>
              <span className="flex items-center gap-1.5">
                <SlidersHorizontal className="h-4 w-4" />
                Schedule Preferences
              </span>
            </TabsTrigger>
          </Link>
        </TabsList>
        </div>

        <TabsContent value="timesheet">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Time Entries</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="px-4 py-2 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800 text-sm text-blue-800 dark:text-blue-200" data-testid="text-schedule-disclaimer">
                Employees are responsible for reporting to their scheduled shifts on time. Unapproved absences or tardiness may result in disciplinary action per company policy.
              </div>
              <TimesheetTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="punches">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Time Punches</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <PunchesTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accrual-balances">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Accrual Balances</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <AccrualBalancesTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accruals">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Accrual Accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <AccrualsTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pending-approvals">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Pending Punch Approvals
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <PendingApprovalsTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="time-off">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CalendarOff className="h-5 w-5 text-teal-600" />
                Time-Off Requests
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200" data-testid="text-time-off-disclaimer">
                Submitting a time-off request does not guarantee approval. All requests are subject to manager review based on business needs and staffing requirements.
              </div>
              <TimeOffRequestsTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="clock-in-approvals">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-500" />
                Clock-In Approval Requests
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Employees outside their scheduled time require manager approval before clocking in. Review and act on pending requests here.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <ClockInApprovalsTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedule-preferences">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <SlidersHorizontal className="h-5 w-5 text-teal-600" />
                Schedule Preferences
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <SchedulePreferencesTab />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
