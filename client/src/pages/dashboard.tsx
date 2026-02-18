import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Worker, TimeEntry, Schedule } from "@shared/schema";
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
} from "lucide-react";

const DASHLET_STORAGE_KEY = "paylink-dashlets";

interface DashletConfig {
  id: string;
  label: string;
}

const ALL_DASHLETS: DashletConfig[] = [
  { id: "news", label: "News" },
  { id: "exception-summary", label: "Exception Summary" },
  { id: "messages", label: "Messages" },
  { id: "requests", label: "Requests" },
  { id: "request-authorizations", label: "Request Authorizations" },
  { id: "exceptions", label: "Exceptions" },
  { id: "exceptions-subordinates", label: "Exceptions (Subordinates)" },
  { id: "schedule-summary-subordinates", label: "Schedule Summary (Subordinates)" },
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

export default function Dashboard() {
  const [visibility, setVisibility] = useState<Record<string, boolean>>(loadVisibility);

  useEffect(() => {
    saveVisibility(visibility);
  }, [visibility]);

  function toggleDashlet(id: string) {
    setVisibility((prev) => ({ ...prev, [id]: !prev[id] }));
  }

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
          <LayoutDashboard className="h-6 w-6 text-teal-accent" />
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
              {ALL_DASHLETS.map((dashlet) => (
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {ALL_DASHLETS.filter((d) => visibility[d.id] !== false).map((d) => (
          <div key={d.id}>{dashletComponents[d.id]}</div>
        ))}
      </div>
    </div>
  );
}
