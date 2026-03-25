import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import type { Worker, TimeEntry, TimePunch, Schedule } from "@shared/schema";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  LayoutDashboard,
  Settings,
  Mail,
  Inbox,
  CheckSquare,
  AlertTriangle,
  Clock,
  CalendarDays,
  Users,
  FileText,
  TrendingUp,
  Newspaper,
  Play,
  Square,
  Coffee,
  ArrowRight,
  LogIn,
} from "lucide-react";

const DASHLET_STORAGE_KEY = "paylink-dashlets";

interface DashletConfig {
  id: string;
  label: string;
  roles?: string[];
}

const ALL_DASHLETS: DashletConfig[] = [
  { id: "news", label: "News" },
  { id: "exception-summary", label: "Exception Summary", roles: ["admin", "manager"] },
  { id: "messages", label: "Messages" },
  { id: "requests", label: "Requests" },
  { id: "request-authorizations", label: "Request Authorizations", roles: ["admin", "manager"] },
  { id: "exceptions", label: "Exceptions", roles: ["admin", "manager"] },
  { id: "exceptions-subordinates", label: "Exceptions (Subordinates)", roles: ["admin", "manager"] },
  { id: "schedule-summary-subordinates", label: "Schedule Summary (Subordinates)", roles: ["admin", "manager"] },
  { id: "schedule-summary", label: "Schedule Summary" },
  { id: "whos-in-out", label: "Who's In/Out" },
  { id: "timesheet-summary", label: "Timesheet Summary" },
];

function loadVisibility(): Record<string, boolean> {
  try {
    const stored = localStorage.getItem(DASHLET_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  const defaults: Record<string, boolean> = {};
  ALL_DASHLETS.forEach((d) => (defaults[d.id] = true));
  return defaults;
}

function saveVisibility(v: Record<string, boolean>) {
  localStorage.setItem(DASHLET_STORAGE_KEY, JSON.stringify(v));
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function getWeekStart(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day;
  return new Date(now.getFullYear(), now.getMonth(), diff);
}

function DashletSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-3/4 mb-2" />
        <Skeleton className="h-4 w-1/2" />
      </CardContent>
    </Card>
  );
}

function NewsDashlet() {
  const newsItems = [
    { date: "2026-02-18", title: "System updated to v2.0" },
    { date: "2026-02-15", title: "New policy management features" },
    { date: "2026-02-10", title: "Payroll processing improvements" },
    { date: "2026-02-05", title: "Schedule module enhancements" },
  ];

  return (
    <Card data-testid="dashlet-news">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
          <Newspaper className="h-4 w-4 text-teal-accent" />
          PayLink Updates
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {newsItems.map((item, i) => (
            <div key={i} className="flex flex-col" data-testid={`news-item-${i}`}>
              <span className="text-xs text-muted-foreground">{item.date}</span>
              <span className="text-sm">{item.title}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ExceptionSummaryDashlet() {
  const { data: timeEntries, isLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries"],
  });

  if (isLoading) return <DashletSkeleton />;

  const entries = timeEntries || [];
  const pendingCount = entries.filter((e) => e.status === "pending").length;
  const highOTCount = entries.filter((e) => Number(e.overtimeHours) > 8).length;
  const missingClockOutCount = entries.filter((e) => e.clockIn && !e.clockOut).length;

  return (
    <Card data-testid="dashlet-exception-summary">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
          <AlertTriangle className="h-4 w-4 text-teal-accent" />
          Exception Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b">
              <td className="py-1.5 text-muted-foreground">Pending Timesheets</td>
              <td className="py-1.5 text-right font-medium" data-testid="count-pending">{pendingCount}</td>
            </tr>
            <tr className="border-b">
              <td className="py-1.5 text-muted-foreground">High Overtime (&gt;8h)</td>
              <td className="py-1.5 text-right font-medium" data-testid="count-high-ot">{highOTCount}</td>
            </tr>
            <tr>
              <td className="py-1.5 text-muted-foreground">Missing Clock-Out</td>
              <td className="py-1.5 text-right font-medium" data-testid="count-missing-clockout">{missingClockOutCount}</td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function MessagesDashlet() {
  return (
    <Card data-testid="dashlet-messages">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
          <Mail className="h-4 w-4 text-teal-accent" />
          Messages
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
          <Mail className="h-8 w-8 mb-2" />
          <span className="text-sm">No new messages</span>
        </div>
      </CardContent>
    </Card>
  );
}

function RequestsDashlet() {
  return (
    <Card data-testid="dashlet-requests">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
          <Inbox className="h-4 w-4 text-teal-accent" />
          Requests
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
          <Inbox className="h-8 w-8 mb-2" />
          <span className="text-sm">No pending requests</span>
        </div>
      </CardContent>
    </Card>
  );
}

function RequestAuthorizationsDashlet() {
  return (
    <Card data-testid="dashlet-request-authorizations">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
          <CheckSquare className="h-4 w-4 text-teal-accent" />
          Request Authorizations
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
          <CheckSquare className="h-8 w-8 mb-2" />
          <span className="text-sm">No pending authorizations</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ExceptionsDashlet({ label, testId }: { label: string; testId: string }) {
  const { data: timeEntries, isLoading: loadingEntries } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries"],
  });
  const { data: workers, isLoading: loadingWorkers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  if (loadingEntries || loadingWorkers) return <DashletSkeleton />;

  const entries = timeEntries || [];
  const workerMap = new Map((workers || []).map((w) => [w.id, w]));
  const pendingEntries = entries
    .filter((e) => e.status === "pending" || Number(e.overtimeHours) > 8)
    .slice(0, 5);

  return (
    <Card data-testid={testId}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
          <AlertTriangle className="h-4 w-4 text-teal-accent" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {pendingEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No exceptions found</p>
        ) : (
          <div className="space-y-2">
            {pendingEntries.map((entry) => {
              const worker = workerMap.get(entry.workerId);
              const name = worker ? `${worker.firstName} ${worker.lastName}` : "Unknown";
              return (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-2 text-sm"
                  data-testid={`exception-entry-${entry.id}`}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="truncate font-medium">{name}</span>
                    <span className="text-xs text-muted-foreground">
                      {entry.date} &middot; {Number(entry.totalHours).toFixed(1)}h
                    </span>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {entry.status}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScheduleSummarySubordinatesDashlet() {
  const { data: schedules, isLoading: loadingSchedules } = useQuery<Schedule[]>({
    queryKey: ["/api/schedules"],
  });
  const { data: workers, isLoading: loadingWorkers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  if (loadingSchedules || loadingWorkers) return <DashletSkeleton />;

  const workerMap = new Map((workers || []).map((w) => [w.id, w]));
  const today = getToday();
  const upcoming = (schedules || [])
    .filter((s) => s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  return (
    <Card data-testid="dashlet-schedule-summary-subordinates">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
          <CalendarDays className="h-4 w-4 text-teal-accent" />
          Schedule Summary (Subordinates)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No upcoming schedules</p>
        ) : (
          <div className="space-y-2">
            {upcoming.map((sched) => {
              const worker = workerMap.get(sched.workerId);
              const name = worker ? `${worker.firstName} ${worker.lastName}` : "Unknown";
              return (
                <div
                  key={sched.id}
                  className="flex items-center justify-between gap-2 text-sm"
                  data-testid={`schedule-entry-${sched.id}`}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="truncate font-medium">{name}</span>
                    <span className="text-xs text-muted-foreground">{sched.date}</span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {sched.startTime} - {sched.endTime}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScheduleSummaryDashlet() {
  const { data: schedules, isLoading } = useQuery<Schedule[]>({
    queryKey: ["/api/schedules"],
  });

  if (isLoading) return <DashletSkeleton />;

  const today = getToday();
  const todaySchedules = (schedules || []).filter((s) => s.date === today);
  const published = todaySchedules.filter((s) => s.status === "published").length;
  const total = todaySchedules.length;

  return (
    <Card data-testid="dashlet-schedule-summary">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
          <Clock className="h-4 w-4 text-teal-accent" />
          Schedule Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Scheduled Today</span>
            <span className="font-medium" data-testid="count-scheduled-today">{total}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Published</span>
            <span className="font-medium" data-testid="count-published">{published}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Draft</span>
            <span className="font-medium" data-testid="count-draft">{total - published}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WhosInOutDashlet() {
  const { data: timeEntries, isLoading: loadingEntries } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries"],
  });
  const { data: workers, isLoading: loadingWorkers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  if (loadingEntries || loadingWorkers) return <DashletSkeleton />;

  const workerMap = new Map((workers || []).map((w) => [w.id, w]));
  const allWorkers = workers || [];
  const today = getToday();
  const todayEntries = (timeEntries || []).filter((e) => e.date === today);
  const clockedIn = todayEntries.filter((e) => e.clockIn && !e.clockOut);
  const inCount = clockedIn.length;
  const outCount = allWorkers.filter((w) => w.isActive).length - inCount;

  return (
    <Card data-testid="dashlet-whos-in-out">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
          <Users className="h-4 w-4 text-teal-accent" />
          Who's In/Out
        </CardTitle>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="default" data-testid="badge-in-count">In: {inCount}</Badge>
          <Badge variant="secondary" data-testid="badge-out-count">Out: {Math.max(0, outCount)}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {clockedIn.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No one currently clocked in</p>
        ) : (
          <div className="space-y-2">
            {clockedIn.map((entry) => {
              const worker = workerMap.get(entry.workerId);
              const name = worker ? `${worker.firstName} ${worker.lastName}` : "Unknown";
              return (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-2 text-sm"
                  data-testid={`whos-in-entry-${entry.id}`}
                >
                  <span className="truncate">{name}</span>
                  <Badge variant="default" className="shrink-0">In</Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TimesheetSummaryDashlet() {
  const { data: timeEntries, isLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries"],
  });

  if (isLoading) return <DashletSkeleton />;

  const entries = timeEntries || [];
  const weekStart = getWeekStart();
  const weekEntries = entries.filter((e) => new Date(e.date) >= weekStart);
  const totalHours = weekEntries.reduce((sum, e) => sum + Number(e.totalHours), 0);
  const pendingCount = entries.filter((e) => e.status === "pending").length;
  const approvedCount = entries.filter((e) => e.status === "approved").length;
  const rejectedCount = entries.filter((e) => e.status === "rejected").length;

  return (
    <Card data-testid="dashlet-timesheet-summary">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
          <FileText className="h-4 w-4 text-teal-accent" />
          Timesheet Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground flex items-center gap-1 flex-wrap">
              <TrendingUp className="h-3 w-3" />
              Hours This Week
            </span>
            <span className="font-medium" data-testid="count-total-hours">{totalHours.toFixed(1)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Pending Approvals</span>
            <span className="font-medium" data-testid="count-pending-approvals">{pendingCount}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Approved</span>
            <span className="font-medium" data-testid="count-approved">{approvedCount}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Rejected</span>
            <span className="font-medium" data-testid="count-rejected">{rejectedCount}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardClockCard() {
  const { user } = useAuth();
  const { toast } = useToast();

  const workersQuery = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const entriesQuery = useQuery<TimeEntry[]>({ queryKey: ["/api/time-entries"] });
  const punchesQuery = useQuery<TimePunch[]>({ queryKey: ["/api/time-punches"] });

  const workers = workersQuery.data || [];
  const linkedWorker = workers.find(
    (w) => (user as any)?.workerId === w.id || w.email === user?.username || w.employeeNumber === user?.username
  );

  const openEntry = linkedWorker
    ? entriesQuery.data?.find((e) => e.workerId === linkedWorker.id && e.clockIn && !e.clockOut)
    : null;

  const todayPunches = linkedWorker
    ? (punchesQuery.data || [])
        .filter((p) => p.workerId === linkedWorker.id)
        .filter((p) => new Date(p.punchTime).toDateString() === new Date().toDateString())
        .sort((a, b) => new Date(b.punchTime).getTime() - new Date(a.punchTime).getTime())
    : [];

  const isOnBreak = todayPunches.length > 0 && todayPunches[0].punchType === "break_start";
  const isClockedIn = !!openEntry;

  const punchMutation = useMutation({
    mutationFn: async (punchType: string) => {
      if (!linkedWorker) throw new Error("No linked worker found");
      await apiRequest("POST", "/api/time-punches", {
        workerId: linkedWorker.id,
        companyId: linkedWorker.companyId,
        punchType,
      });
    },
    onSuccess: (_, punchType) => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-punches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      const labels: Record<string, string> = {
        clock_in: "Clocked In",
        clock_out: "Clocked Out",
        break_start: "Break Started",
        break_end: "Break Ended",
      };
      toast({ title: labels[punchType] || "Punch Recorded" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!linkedWorker) return null;

  const clockInTime = openEntry?.clockIn
    ? new Date(openEntry.clockIn).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : null;

  const totalToday = todayPunches.length > 0
    ? (() => {
        let total = 0;
        const sorted = [...todayPunches].reverse();
        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i].punchType === "clock_in") {
            const end = sorted.find((p, j) => j > i && (p.punchType === "clock_out" || p.punchType === "break_start"));
            if (end) {
              total += (new Date(end.punchTime).getTime() - new Date(sorted[i].punchTime).getTime()) / 3600000;
            } else if (isClockedIn) {
              total += (Date.now() - new Date(sorted[i].punchTime).getTime()) / 3600000;
            }
          } else if (sorted[i].punchType === "break_end") {
            const end = sorted.find((p, j) => j > i && (p.punchType === "clock_out" || p.punchType === "break_start"));
            if (end) {
              total += (new Date(end.punchTime).getTime() - new Date(sorted[i].punchTime).getTime()) / 3600000;
            } else if (isClockedIn) {
              total += (Date.now() - new Date(sorted[i].punchTime).getTime()) / 3600000;
            }
          }
        }
        return total;
      })()
    : 0;

  return (
    <Card className="border-teal-200 dark:border-teal-800 bg-gradient-to-r from-teal-50/50 to-transparent dark:from-teal-950/20" data-testid="dashlet-clock-actions">
      <CardContent className="p-4 md:p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`h-12 w-12 rounded-xl flex items-center justify-center shadow-sm ${
              isClockedIn
                ? isOnBreak
                  ? "bg-amber-100 dark:bg-amber-900/30"
                  : "bg-emerald-100 dark:bg-emerald-900/30"
                : "bg-slate-100 dark:bg-slate-800"
            }`}>
              {isClockedIn ? (
                isOnBreak ? (
                  <Coffee className="h-6 w-6 text-amber-600" />
                ) : (
                  <Clock className="h-6 w-6 text-emerald-600" />
                )
              ) : (
                <LogIn className="h-6 w-6 text-slate-500" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm" data-testid="text-clock-worker-name">
                  {linkedWorker.firstName} {linkedWorker.lastName}
                </span>
                <Badge
                  variant={isClockedIn ? "default" : "secondary"}
                  className={`text-[11px] ${
                    isClockedIn
                      ? isOnBreak
                        ? "bg-amber-500 text-white"
                        : "bg-emerald-600 text-white"
                      : ""
                  }`}
                  data-testid="badge-dashboard-clock-status"
                >
                  {isClockedIn ? (isOnBreak ? "On Break" : "Clocked In") : "Clocked Out"}
                </Badge>
                {isClockedIn && !isOnBreak && (
                  <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold px-1.5 py-0.5" data-testid="badge-dashboard-live">
                    LIVE
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                {clockInTime && <span data-testid="text-clock-in-time">In since {clockInTime}</span>}
                {totalToday > 0 && <span data-testid="text-hours-today">{totalToday.toFixed(1)}h today</span>}
                {!isClockedIn && todayPunches.length === 0 && <span data-testid="text-no-punches">No punches today</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {!isClockedIn && !isOnBreak ? (
              <Button
                onClick={() => punchMutation.mutate("clock_in")}
                disabled={punchMutation.isPending}
                className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm gap-2"
                data-testid="button-dashboard-clock-in"
              >
                <Play className="h-4 w-4" />
                Clock In
              </Button>
            ) : (
              <>
                {isClockedIn && !isOnBreak && (
                  <Button
                    variant="outline"
                    onClick={() => punchMutation.mutate("break_start")}
                    disabled={punchMutation.isPending}
                    className="flex-1 sm:flex-none gap-2 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30"
                    data-testid="button-dashboard-break-start"
                  >
                    <Coffee className="h-4 w-4" />
                    Break
                  </Button>
                )}
                {isOnBreak && (
                  <Button
                    variant="outline"
                    onClick={() => punchMutation.mutate("break_end")}
                    disabled={punchMutation.isPending}
                    className="flex-1 sm:flex-none gap-2 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30"
                    data-testid="button-dashboard-break-end"
                  >
                    <ArrowRight className="h-4 w-4" />
                    End Break
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => punchMutation.mutate("clock_out")}
                  disabled={punchMutation.isPending}
                  className="flex-1 sm:flex-none gap-2 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
                  data-testid="button-dashboard-clock-out"
                >
                  <Square className="h-4 w-4" />
                  Clock Out
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const userRole = (user as any)?.role || "employee";
  const [visibility, setVisibility] = useState<Record<string, boolean>>(loadVisibility);

  useEffect(() => {
    saveVisibility(visibility);
  }, [visibility]);

  function toggleDashlet(id: string) {
    setVisibility((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const allowedDashlets = useMemo(() => {
    return ALL_DASHLETS.filter(d => !d.roles || d.roles.includes(userRole));
  }, [userRole]);

  const dashletComponents: Record<string, JSX.Element> = {
    "news": <NewsDashlet />,
    "exception-summary": <ExceptionSummaryDashlet />,
    "messages": <MessagesDashlet />,
    "requests": <RequestsDashlet />,
    "request-authorizations": <RequestAuthorizationsDashlet />,
    "exceptions": <ExceptionsDashlet label="Exceptions" testId="dashlet-exceptions" />,
    "exceptions-subordinates": (
      <ExceptionsDashlet label="Exceptions (Subordinates)" testId="dashlet-exceptions-subordinates" />
    ),
    "schedule-summary-subordinates": <ScheduleSummarySubordinatesDashlet />,
    "schedule-summary": <ScheduleSummaryDashlet />,
    "whos-in-out": <WhosInOutDashlet />,
    "timesheet-summary": <TimesheetSummaryDashlet />,
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-dashboard-title">
          <LayoutDashboard className="h-6 w-6 text-blue-accent" />
          Dashboard
        </h1>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" data-testid="button-configure">
              <Settings className="h-4 w-4 mr-2" />
              Configure
            </Button>
          </DialogTrigger>
          <DialogContent data-testid="dialog-configure">
            <DialogHeader>
              <DialogTitle>Configure Dashboard</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 max-h-80 overflow-y-auto py-2">
              {allowedDashlets.map((dashlet) => (
                <div key={dashlet.id} className="flex items-center gap-3">
                  <Checkbox
                    id={`toggle-${dashlet.id}`}
                    checked={visibility[dashlet.id] !== false}
                    onCheckedChange={() => toggleDashlet(dashlet.id)}
                    data-testid={`checkbox-${dashlet.id}`}
                  />
                  <Label htmlFor={`toggle-${dashlet.id}`} className="cursor-pointer">
                    {dashlet.label}
                  </Label>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <OnboardingChecklist />

      <DashboardClockCard />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {allowedDashlets.filter((d) => visibility[d.id] !== false).map((d) => (
          <div key={d.id}>{dashletComponents[d.id]}</div>
        ))}
      </div>
    </div>
  );
}
