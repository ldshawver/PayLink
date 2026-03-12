import { useState } from "react";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  TimeEntry,
  TimePunch,
  Worker,
  Company,
  AccrualBalance,
  AccrualAccount,
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

function TimesheetTab() {
  const { toast } = useToast();
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const weekRange = getWeekRange();
  const [convertCompany, setConvertCompany] = useState("");
  const [convertStart, setConvertStart] = useState(weekRange.start);
  const [convertEnd, setConvertEnd] = useState(weekRange.end);
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
    status: "pending",
  });

  const { data: entries, isLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries"],
  });

  const { data: workers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const workerMap = new Map(workers?.map((w) => [w.id, w]) || []);

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
        status: "pending",
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

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-4 pt-4 gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">{sortedEntries.length} entries</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setConvertOpen(true)} data-testid="button-convert-punches">
            <RefreshCw className="h-4 w-4 mr-2" />Convert Punches
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-time-entry">
              <Plus className="h-4 w-4 mr-2" />Add Entry
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Time Entry</DialogTitle></DialogHeader>
            <div className="grid gap-3 mt-2">
              <div className="grid gap-1.5">
                <Label>Employee</Label>
                <Select value={addForm.workerId} onValueChange={v => setAddForm(f => ({ ...f, workerId: v }))}>
                  <SelectTrigger data-testid="select-add-entry-worker"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {(workers || []).filter(w => w.isActive).map(w => (
                      <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>
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
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Clock In</Label>
                  <Input type="datetime-local" value={addForm.clockIn} onChange={e => setAddForm(f => ({ ...f, clockIn: e.target.value }))} data-testid="input-add-entry-clockin" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Clock Out</Label>
                  <Input type="datetime-local" value={addForm.clockOut} onChange={e => setAddForm(f => ({ ...f, clockOut: e.target.value }))} data-testid="input-add-entry-clockout" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
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

      {sortedEntries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <ClipboardList className="h-12 w-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No time entries found</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
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
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
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
            <div className="grid grid-cols-2 gap-3">
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
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Clock In</Label>
                  <Input type="datetime-local" value={editForm.clockIn} onChange={e => setEditForm(f => ({ ...f, clockIn: e.target.value }))} data-testid="input-edit-clockin" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Clock Out</Label>
                  <Input type="datetime-local" value={editForm.clockOut} onChange={e => setEditForm(f => ({ ...f, clockOut: e.target.value }))} data-testid="input-edit-clockout" />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Break (minutes)</Label>
                <Input type="number" value={editForm.breakMinutes} onChange={e => setEditForm(f => ({ ...f, breakMinutes: e.target.value }))} data-testid="input-edit-break" />
              </div>
              <Button variant="outline" size="sm" onClick={handleRecalculate} data-testid="button-recalculate">
                Recalculate Hours
              </Button>
              <div className="grid grid-cols-3 gap-3">
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
  const [editPunch, setEditPunch] = useState<TimePunch | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ punchTime: "", note: "" });
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
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-punch">
              <Plus className="h-4 w-4 mr-2" />Add Punch
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Manual Punch</DialogTitle></DialogHeader>
            <div className="grid gap-3 mt-2">
              <div className="grid gap-1.5">
                <Label>Employee</Label>
                <Select value={addForm.workerId} onValueChange={v => setAddForm(f => ({ ...f, workerId: v }))}>
                  <SelectTrigger data-testid="select-add-punch-worker"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {(workers || []).filter(w => w.isActive).map(w => (
                      <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>
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
              <p className="text-sm text-muted-foreground">
                {workerMap.get(editPunch.workerId)
                  ? `${workerMap.get(editPunch.workerId)!.firstName} ${workerMap.get(editPunch.workerId)!.lastName}`
                  : "Unknown"} — <PunchTypeBadge type={editPunch.punchType} />
              </p>
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

export default function AttendancePage() {
  const currentTab = useTabParam("timesheet");

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-attendance-title">
          Attendance
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage timesheets, punches, and accrual balances.
        </p>
      </div>

      <Tabs value={currentTab} className="w-full">
        <TabsList data-testid="tabs-attendance">
          <Link href="/attendance?tab=timesheet">
            <TabsTrigger value="timesheet" data-testid="tab-timesheet" asChild>
              <span className="flex items-center gap-1.5">
                <ClipboardList className="h-4 w-4" />
                Timesheet
              </span>
            </TabsTrigger>
          </Link>
          <Link href="/attendance?tab=punches">
            <TabsTrigger value="punches" data-testid="tab-punches" asChild>
              <span className="flex items-center gap-1.5">
                <Fingerprint className="h-4 w-4" />
                Punches
              </span>
            </TabsTrigger>
          </Link>
          <Link href="/attendance?tab=accrual-balances">
            <TabsTrigger value="accrual-balances" data-testid="tab-accrual-balances" asChild>
              <span className="flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4" />
                Accrual Balances
              </span>
            </TabsTrigger>
          </Link>
          <Link href="/attendance?tab=accruals">
            <TabsTrigger value="accruals" data-testid="tab-accruals" asChild>
              <span className="flex items-center gap-1.5">
                <BookOpen className="h-4 w-4" />
                Accruals
              </span>
            </TabsTrigger>
          </Link>
          <Link href="/attendance?tab=pending-approvals">
            <TabsTrigger value="pending-approvals" data-testid="tab-pending-approvals" asChild>
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                Pending Approvals
              </span>
            </TabsTrigger>
          </Link>
        </TabsList>

        <TabsContent value="timesheet">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Time Entries</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
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
      </Tabs>
    </div>
  );
}
