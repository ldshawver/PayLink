import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import type { Worker, TimeEntry, TimePunch, Schedule, CostCenter, Job } from "@shared/schema";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
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
  TrendingDown,
  Newspaper,
  Play,
  Square,
  Coffee,
  ArrowRight,
  LogIn,
  Shield,
  Activity,
  XCircle,
  CheckCircle2,
  Hourglass,
  ExternalLink,
  Check,
  X,
  AlertCircle,
  MessageSquare,
  Ban,
  Pencil,
  Target,
  DollarSign,
  BarChart3,
  Receipt,
  PlusCircle,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DASHLET_STORAGE_KEY = "paylink-dashlets";

interface DashletConfig {
  id: string;
  label: string;
  roles?: string[];
}

const ADMIN_ROLES = [
  "admin", "manager", "supervisor",
  "platform_super_admin", "platform_admin", "platform_support", "platform_implementation",
  "tenant_owner", "tenant_admin", "tenant_hr_admin", "tenant_payroll_admin", "tenant_finance_admin",
  "tenant_manager", "tenant_supervisor",
];

const MANAGER_ROLES = [
  "admin", "manager", "supervisor",
  "platform_super_admin", "platform_admin", "platform_support", "platform_implementation",
  "tenant_owner", "tenant_admin", "tenant_hr_admin", "tenant_payroll_admin", "tenant_finance_admin",
  "tenant_manager", "tenant_supervisor",
];

const ALL_DASHLETS: DashletConfig[] = [
  { id: "news", label: "News" },
  { id: "exception-summary", label: "Exception Summary", roles: ADMIN_ROLES },
  { id: "messages", label: "Messages" },
  { id: "requests", label: "My Requests" },
  { id: "request-authorizations", label: "Awaiting My Approval", roles: ADMIN_ROLES },
  { id: "exceptions", label: "Exceptions" },
  { id: "exceptions-subordinates", label: "Exceptions (Subordinates)", roles: ADMIN_ROLES },
  { id: "schedule-summary-subordinates", label: "Schedule Summary (Subordinates)", roles: ADMIN_ROLES },
  { id: "schedule-summary", label: "Schedule Summary" },
  { id: "whos-in-out", label: "Who's In/Out" },
  { id: "timesheet-summary", label: "Timesheet Summary" },
  { id: "weekly-labor-cost", label: "Weekly Labor Cost vs Goal", roles: MANAGER_ROLES },
  { id: "weekly-financial-kpi", label: "Weekly Financial KPIs", roles: MANAGER_ROLES },
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
  const { data: exceptions, isLoading: loadingEx } = useQuery<any[]>({
    queryKey: ["/api/dashboard/exceptions"],
  });
  const { data: timeEntries, isLoading: loadingEntries } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries"],
  });

  if (loadingEx || loadingEntries) return <DashletSkeleton />;

  const entries = timeEntries || [];
  const exList = exceptions || [];
  const pendingApprovalCount = exList.filter((e) => e.status === "pending_approval").length;
  const missingClockOutCount = exList.filter((e) => e.exceptionType === "Missing clock-out").length;
  const highOTCount = entries.filter((e) => Number(e.overtimeHours) > 4).length;

  return (
    <Card data-testid="dashlet-exception-summary">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
          <AlertTriangle className="h-4 w-4 text-teal-accent" />
          Exception Summary
        </CardTitle>
        <Link href="/app/attendance?tab=clock-in-approvals">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" data-testid="link-exception-summary-view-all">
            View All <ExternalLink className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b">
              <td className="py-1.5 text-muted-foreground">Pending Approvals</td>
              <td className="py-1.5 text-right font-medium" data-testid="count-pending-approval">{pendingApprovalCount}</td>
            </tr>
            <tr className="border-b">
              <td className="py-1.5 text-muted-foreground">Missing Clock-Out</td>
              <td className="py-1.5 text-right font-medium" data-testid="count-missing-clockout">{missingClockOutCount}</td>
            </tr>
            <tr>
              <td className="py-1.5 text-muted-foreground">High Overtime (&gt;4h)</td>
              <td className="py-1.5 text-right font-medium" data-testid="count-high-ot">{highOTCount}</td>
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
        <Link href="/app/messages">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" data-testid="link-messages-view-all">
            View All <ExternalLink className="h-3 w-3 ml-1" />
          </Button>
        </Link>
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

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "approved") return "default";
  if (status === "denied" || status === "rejected") return "destructive";
  if (status === "pending" || status === "pending_approval") return "outline";
  return "secondary";
}

function statusLabel(status: string): string {
  if (status === "pending_approval") return "Pending Approval";
  if (status === "action_required") return "Action Required";
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}

function RequestsDashlet() {
  const { data: requests, isLoading } = useQuery<any[]>({
    queryKey: ["/api/dashboard/my-requests"],
  });

  if (isLoading) return <DashletSkeleton />;

  const items = requests || [];

  return (
    <Card data-testid="dashlet-requests">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
          <Inbox className="h-4 w-4 text-teal-accent" />
          My Requests
        </CardTitle>
        <Link href="/app/attendance?tab=time-off">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" data-testid="link-requests-view-all">
            View All <ExternalLink className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            <Inbox className="h-8 w-8 mb-2" />
            <span className="text-sm">No pending requests</span>
          </div>
        ) : (
          <div className="space-y-2">
            {items.slice(0, 5).map((req) => (
              <Link key={req.id} href={req.actionUrl}>
                <div
                  className="flex items-center justify-between gap-2 text-sm cursor-pointer rounded-md hover:bg-muted/50 p-1.5 -mx-1.5 transition-colors"
                  data-testid={`request-item-${req.id}`}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="truncate font-medium">{req.label}</span>
                    <span className="text-xs text-muted-foreground truncate">{req.description}</span>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {req.companyName && <span className="text-[10px] text-muted-foreground">{req.companyName}</span>}
                      {req.costCenterName && <span className="text-[10px] text-muted-foreground">· {req.costCenterName}</span>}
                      {req.submittedAt && (
                        <span className="text-[10px] text-muted-foreground">
                          · {new Date(req.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge variant={statusBadgeVariant(req.status)} className="shrink-0 text-[10px]">
                    {statusLabel(req.status)}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RequestAuthorizationsDashlet() {
  const { toast } = useToast();
  const { data: approvals, isLoading } = useQuery<any[]>({
    queryKey: ["/api/dashboard/pending-approvals"],
  });

  const approvePunch = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `/api/clock-in-requests/${id}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/pending-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/exceptions"] });
      toast({ title: "Punch approved" });
    },
    onError: () => toast({ title: "Error", description: "Failed to approve punch", variant: "destructive" }),
  });

  const denyPunch = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `/api/clock-in-requests/${id}/deny`, { reason: "Denied by manager" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/pending-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/exceptions"] });
      toast({ title: "Punch denied" });
    },
    onError: () => toast({ title: "Error", description: "Failed to deny punch", variant: "destructive" }),
  });

  const approveTimeOff = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `/api/time-off-requests/${id}/review`, { decision: "approved" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/pending-approvals"] });
      toast({ title: "Time off approved" });
    },
    onError: () => toast({ title: "Error", description: "Failed to approve time off", variant: "destructive" }),
  });

  const denyTimeOff = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `/api/time-off-requests/${id}/review`, { decision: "denied" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/pending-approvals"] });
      toast({ title: "Time off denied" });
    },
    onError: () => toast({ title: "Error", description: "Failed to deny time off", variant: "destructive" }),
  });

  if (isLoading) return <DashletSkeleton />;

  const items = approvals || [];

  return (
    <Card data-testid="dashlet-request-authorizations">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
          <CheckSquare className="h-4 w-4 text-teal-accent" />
          Awaiting My Approval
        </CardTitle>
        <Link href="/app/attendance?tab=clock-in-approvals">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" data-testid="link-authorizations-view-all">
            View All <ExternalLink className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            <CheckSquare className="h-8 w-8 mb-2" />
            <span className="text-sm">No pending authorizations</span>
          </div>
        ) : (
          <div className="space-y-2">
            {items.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-2 text-sm"
                data-testid={`approval-item-${item.id}`}
              >
                <Link href={item.actionUrl} className="flex flex-col min-w-0 flex-1 cursor-pointer hover:underline">
                  <span className="truncate font-medium">{item.requesterName}</span>
                  <span className="text-xs text-muted-foreground truncate">{item.label}: {item.description}</span>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {item.companyName && <span className="text-[10px] text-muted-foreground">{item.companyName}</span>}
                    {item.costCenterName && <span className="text-[10px] text-muted-foreground">· {item.costCenterName}</span>}
                    {item.jobName && <span className="text-[10px] text-muted-foreground">· {item.jobName}</span>}
                    {item.submittedAt && (
                      <span className="text-[10px] text-muted-foreground">
                        · {new Date(item.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>
                </Link>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30"
                    disabled={approvePunch.isPending || approveTimeOff.isPending}
                    onClick={(e) => {
                      e.preventDefault();
                      if (item.requestType === "punch_approval") {
                        approvePunch.mutate(item.sourceId);
                      } else {
                        approveTimeOff.mutate(item.sourceId);
                      }
                    }}
                    data-testid={`button-approve-${item.id}`}
                    title="Approve"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                    disabled={denyPunch.isPending || denyTimeOff.isPending}
                    onClick={(e) => {
                      e.preventDefault();
                      if (item.requestType === "punch_approval") {
                        denyPunch.mutate(item.sourceId);
                      } else {
                        denyTimeOff.mutate(item.sourceId);
                      }
                    }}
                    data-testid={`button-deny-${item.id}`}
                    title="Deny"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ExceptionsDashlet({ label, testId }: { label: string; testId: string }) {
  const { toast } = useToast();
  const { data: exceptions, isLoading } = useQuery<any[]>({
    queryKey: ["/api/dashboard/exceptions"],
  });
  const [commentItem, setCommentItem] = useState<{ id: string; sourceType: string; sourceId: string } | null>(null);
  const [commentText, setCommentText] = useState("");
  const [editPunchId, setEditPunchId] = useState<string | null>(null);
  const [editPunchTime, setEditPunchTime] = useState<string>("");

  const approvePunch = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `/api/clock-in-requests/${id}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/pending-approvals"] });
      toast({ title: "Punch approved" });
    },
    onError: () => toast({ title: "Error", description: "Failed to approve", variant: "destructive" }),
  });

  const denyPunch = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `/api/clock-in-requests/${id}/deny`, { reason: "Denied by manager" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/pending-approvals"] });
      toast({ title: "Punch denied" });
    },
    onError: () => toast({ title: "Error", description: "Failed to deny", variant: "destructive" }),
  });

  const approveTimeEntry = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `/api/time-entries/${id}`, { status: "approved" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      toast({ title: "Timesheet authorized" });
    },
    onError: () => toast({ title: "Error", description: "Failed to authorize timesheet", variant: "destructive" }),
  });

  const rejectTimeEntry = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `/api/time-entries/${id}`, { status: "rejected" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      toast({ title: "Timesheet rejected" });
    },
    onError: () => toast({ title: "Error", description: "Failed to reject timesheet", variant: "destructive" }),
  });

  const correctPunchTime = useMutation({
    mutationFn: async ({ id, correctedTime }: { id: string; correctedTime: string }) =>
      apiRequest("PATCH", `/api/clock-in-requests/${id}/correct-time`, { correctedTime }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/exceptions"] });
      setEditPunchId(null);
      setEditPunchTime("");
      toast({ title: "Corrected time saved" });
    },
    onError: () => toast({ title: "Error", description: "Failed to save corrected time", variant: "destructive" }),
  });

  const addComment = useMutation({
    mutationFn: async ({ sourceType, sourceId, note }: { sourceType: string; sourceId: string; note: string }) => {
      if (sourceType === "time_entry") {
        return apiRequest("PATCH", `/api/time-entries/${sourceId}`, { note });
      }
      if (sourceType === "clock_in_request") {
        return apiRequest("PATCH", `/api/clock-in-requests/${sourceId}/note`, { note });
      }
      // time_punch: no direct note endpoint — surface an error rather than swallowing it
      throw new Error(`Comments are not yet supported for exception type: ${sourceType}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/exceptions"] });
      setCommentItem(null);
      setCommentText("");
      toast({ title: "Comment added" });
    },
    onError: () => toast({ title: "Error", description: "Failed to add comment", variant: "destructive" }),
  });

  if (isLoading) return <DashletSkeleton />;

  const items = (exceptions || []).slice(0, 5);

  const exceptionStatusColor = (status: string) => {
    if (status === "pending_approval") return "text-amber-600 dark:text-amber-400";
    if (status === "action_required") return "text-red-600 dark:text-red-400";
    return "text-muted-foreground";
  };

  return (
    <>
    <Card data-testid={testId}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
          <AlertTriangle className="h-4 w-4 text-teal-accent" />
          {label}
        </CardTitle>
        <Link href="/app/attendance">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" data-testid={`link-${testId}-view-all`}>
            View All <ExternalLink className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No exceptions found</p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-2 text-sm"
                data-testid={`exception-entry-${item.id}`}
              >
                <Link href={item.actionUrl} className="flex flex-col min-w-0 flex-1 cursor-pointer hover:underline">
                  <span className="truncate font-medium">{item.workerName}</span>
                  <span className={`text-xs truncate ${exceptionStatusColor(item.status)}`}>
                    {item.date && <span>{item.date} · </span>}
                    {item.exceptionType}
                  </span>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {item.companyName && <span className="text-[10px] text-muted-foreground">{item.companyName}</span>}
                    {item.costCenterName && <span className="text-[10px] text-muted-foreground">· {item.costCenterName}</span>}
                    {item.jobName && <span className="text-[10px] text-muted-foreground">· {item.jobName}</span>}
                  </div>
                </Link>
                <div className="flex items-center gap-0.5 shrink-0">
                  {/* clock_in_request: Edit corrected time / Approve / Deny */}
                  {item.sourceType === "clock_in_request" && (
                    <>
                      {item.canEdit && (
                        editPunchId === item.sourceId ? (
                          <span className="flex items-center gap-1">
                            <input
                              type="datetime-local"
                              className="text-xs border rounded px-1 h-6 bg-background"
                              value={editPunchTime}
                              onChange={(e) => setEditPunchTime(e.target.value)}
                              data-testid={`input-correct-time-${item.id}`}
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30"
                              disabled={correctPunchTime.isPending || !editPunchTime}
                              onClick={(e) => { e.preventDefault(); correctPunchTime.mutate({ id: item.sourceId, correctedTime: new Date(editPunchTime).toISOString() }); }}
                              data-testid={`button-save-correct-time-${item.id}`}
                              title="Save corrected time"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-muted-foreground"
                              onClick={(e) => { e.preventDefault(); setEditPunchId(null); setEditPunchTime(""); }}
                              data-testid={`button-cancel-correct-time-${item.id}`}
                              title="Cancel"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                            onClick={(e) => { e.preventDefault(); setEditPunchId(item.sourceId); setEditPunchTime(""); }}
                            data-testid={`button-exception-edit-${item.id}`}
                            title="Set corrected clock-in time"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )
                      )}
                      {item.canApprove && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30"
                            disabled={approvePunch.isPending}
                            onClick={(e) => { e.preventDefault(); approvePunch.mutate(item.sourceId); }}
                            data-testid={`button-exception-approve-${item.id}`}
                            title="Approve punch"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            disabled={denyPunch.isPending}
                            onClick={(e) => { e.preventDefault(); denyPunch.mutate(item.sourceId); }}
                            data-testid={`button-exception-deny-${item.id}`}
                            title="Deny punch"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </>
                  )}
                  {/* time_entry: Edit timecard + Authorize + Reject (for pending/action_required items) */}
                  {item.sourceType === "time_entry" && (
                    <>
                      <Link href={item.actionUrl || `/app/attendance`} data-testid={`button-exception-edit-${item.id}`} title="Edit timecard">
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30">
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                      {item.canApprove && (item.status === "pending" || item.status === "action_required") && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30"
                            onClick={(e) => { e.preventDefault(); approveTimeEntry.mutate(item.sourceId); }}
                            disabled={approveTimeEntry.isPending}
                            data-testid={`button-exception-authorize-${item.id}`}
                            title="Authorize timesheet"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            onClick={(e) => { e.preventDefault(); rejectTimeEntry.mutate(item.sourceId); }}
                            disabled={rejectTimeEntry.isPending}
                            data-testid={`button-exception-reject-${item.id}`}
                            title="Reject timesheet"
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </>
                  )}
                  {/* Comment button: visible for all items where canComment is true */}
                  {item.canComment && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      onClick={(e) => {
                        e.preventDefault();
                        setCommentItem({ id: item.id, sourceType: item.sourceType, sourceId: item.sourceId });
                        setCommentText("");
                      }}
                      data-testid={`button-exception-comment-${item.id}`}
                      title="Add comment"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>

    {/* Comment dialog */}
    <Dialog open={!!commentItem} onOpenChange={(open) => { if (!open) { setCommentItem(null); setCommentText(""); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Comment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Textarea
            placeholder="Enter your comment or note..."
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            className="min-h-[80px]"
            data-testid="input-exception-comment"
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => { setCommentItem(null); setCommentText(""); }}
            data-testid="button-exception-comment-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (commentItem && commentText.trim()) {
                addComment.mutate({ sourceType: commentItem.sourceType, sourceId: commentItem.sourceId, note: commentText.trim() });
              }
            }}
            disabled={addComment.isPending || !commentText.trim()}
            data-testid="button-exception-comment-submit"
          >
            Save Comment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
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
        <Link href="/app/schedule">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" data-testid="link-schedule-subordinates-view-all">
            View All <ExternalLink className="h-3 w-3 ml-1" />
          </Button>
        </Link>
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
                <Link key={sched.id} href="/app/schedule">
                  <div
                    className="flex items-center justify-between gap-2 text-sm cursor-pointer rounded-md hover:bg-muted/50 p-1 -mx-1 transition-colors"
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
                </Link>
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
        <Link href="/app/schedule">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" data-testid="link-schedule-summary-view-all">
            View <ExternalLink className="h-3 w-3 ml-1" />
          </Button>
        </Link>
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
                <Link key={entry.id} href="/app/attendance">
                  <div
                    className="flex items-center justify-between gap-2 text-sm cursor-pointer rounded-md hover:bg-muted/50 p-1 -mx-1 transition-colors"
                    data-testid={`whos-in-entry-${entry.id}`}
                  >
                    <span className="truncate">{name}</span>
                    <Badge variant="default" className="shrink-0">In</Badge>
                  </div>
                </Link>
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
        <Link href="/app/attendance">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" data-testid="link-timesheet-summary-view-all">
            View <ExternalLink className="h-3 w-3 ml-1" />
          </Button>
        </Link>
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

type ClockState = "clocked_out" | "clocked_in" | "on_break" | "back_from_break" | "pending_punch_approval" | "missing_punch";

function DashboardClockCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const workersQuery = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const entriesQuery = useQuery<TimeEntry[]>({ queryKey: ["/api/time-entries"] });
  const punchesQuery = useQuery<TimePunch[]>({ queryKey: ["/api/time-punches"] });
  const clockStatusQuery = useQuery<{ pendingApproval: any; missingPunch: any }>({
    queryKey: ["/api/dashboard/clock-status"],
  });

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

  // "Back from break" = most recent punch is break_end within the last 30 min
  const lastPunch = todayPunches[0];
  const isBackFromBreak = isClockedIn && !isOnBreak &&
    lastPunch?.punchType === "break_end" &&
    (Date.now() - new Date(lastPunch.punchTime).getTime()) < 30 * 60 * 1000;

  // Pending punch approval (worker attempted to clock in but needs supervisor approval)
  const pendingApproval = clockStatusQuery.data?.pendingApproval;
  const missingPunch = clockStatusQuery.data?.missingPunch;

  // Determine the effective clock state
  const clockState: ClockState = (() => {
    if (pendingApproval) return "pending_punch_approval";
    if (missingPunch && !isClockedIn) return "missing_punch";
    if (isClockedIn && isOnBreak) return "on_break";
    if (isClockedIn && isBackFromBreak) return "back_from_break";
    if (isClockedIn) return "clocked_in";
    return "clocked_out";
  })();

  const punchMutation = useMutation({
    mutationFn: async (punchType: string) => {
      if (!linkedWorker) throw new Error("No linked worker found");
      const res = await apiRequest("POST", "/api/time-punches", {
        workerId: linkedWorker.id,
        companyId: linkedWorker.companyId,
        punchType,
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body, punchType };
    },
    onSuccess: ({ status, body, punchType }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-punches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/clock-status"] });
      if (status === 202 && body?.status === "pending_approval") {
        toast({
          title: "Approval Required",
          description: body.message || "Your clock-in request has been sent for manager approval.",
        });
      } else {
        const labels: Record<string, string> = {
          clock_in: "Clocked In",
          clock_out: "Clocked Out",
          break_start: "Break Started",
          break_end: "Break Ended",
        };
        toast({ title: labels[punchType] || "Punch Recorded" });
      }
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

  // State-derived display properties
  const stateDisplay: Record<ClockState, { label: string; iconClass: string; badgeClass: string; icon: JSX.Element; showLive: boolean }> = {
    clocked_in:             { label: "Clocked In",           iconClass: "bg-emerald-100 dark:bg-emerald-900/30", badgeClass: "bg-emerald-600 text-white",  icon: <Clock className="h-6 w-6 text-emerald-600" />,  showLive: true  },
    on_break:               { label: "On Break",             iconClass: "bg-amber-100 dark:bg-amber-900/30",     badgeClass: "bg-amber-500 text-white",     icon: <Coffee className="h-6 w-6 text-amber-600" />,   showLive: false },
    back_from_break:        { label: "Back from Break",      iconClass: "bg-teal-100 dark:bg-teal-900/30",       badgeClass: "bg-teal-600 text-white",      icon: <Clock className="h-6 w-6 text-teal-600" />,     showLive: true  },
    pending_punch_approval: { label: "Pending Approval",     iconClass: "bg-yellow-100 dark:bg-yellow-900/30",   badgeClass: "bg-yellow-500 text-white",    icon: <AlertCircle className="h-6 w-6 text-yellow-600" />, showLive: false },
    missing_punch:          { label: "Missing Clock-Out",    iconClass: "bg-red-100 dark:bg-red-900/30",         badgeClass: "bg-red-600 text-white",       icon: <AlertCircle className="h-6 w-6 text-red-600" />, showLive: false },
    clocked_out:            { label: "Clocked Out",          iconClass: "bg-slate-100 dark:bg-slate-800",        badgeClass: "",                            icon: <LogIn className="h-6 w-6 text-slate-500" />,    showLive: false },
  };
  const stateInfo = stateDisplay[clockState];

  return (
    <Card className="border-teal-200 dark:border-teal-800 bg-gradient-to-r from-teal-50/50 to-transparent dark:from-teal-950/20" data-testid="dashlet-clock-actions">
      <CardContent className="p-4 md:p-5">
        {/* Missing punch alert banner */}
        {clockState === "missing_punch" && missingPunch && (
          <div className="flex items-center gap-2 mb-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300" data-testid="alert-missing-punch">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Missing clock-out on <strong>{missingPunch.date}</strong>. Please correct your timecard.</span>
            <Link href="/app/attendance" className="ml-auto font-semibold underline whitespace-nowrap">Fix now</Link>
          </div>
        )}
        {/* Pending punch approval banner */}
        {clockState === "pending_punch_approval" && pendingApproval && (
          <div className="flex items-center gap-2 mb-3 rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-300" data-testid="alert-pending-punch-approval">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Your clock-in is awaiting supervisor approval.</span>
            <Link href="/app/attendance" className="ml-auto font-semibold underline whitespace-nowrap">View</Link>
          </div>
        )}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`h-12 w-12 rounded-xl flex items-center justify-center shadow-sm cursor-pointer transition-opacity hover:opacity-80 ${stateInfo.iconClass}`}
              onClick={() => navigate("/app/attendance")}
              title="View live timecard"
              data-testid="icon-clock-status-link"
            >
              {stateInfo.icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Link href="/app/attendance">
                  <span className="font-semibold text-sm hover:underline cursor-pointer" data-testid="text-clock-worker-name">
                    {linkedWorker.firstName} {linkedWorker.lastName}
                  </span>
                </Link>
                <Badge
                  variant="secondary"
                  className={`text-[11px] ${stateInfo.badgeClass}`}
                  data-testid="badge-dashboard-clock-status"
                >
                  {stateInfo.label}
                </Badge>
                {stateInfo.showLive && (
                  <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold px-1.5 py-0.5" data-testid="badge-dashboard-live">
                    LIVE
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                {clockInTime && <span data-testid="text-clock-in-time">In since {clockInTime}</span>}
                {totalToday > 0 && <span data-testid="text-hours-today">{totalToday.toFixed(1)}h today</span>}
                {clockState === "clocked_out" && todayPunches.length === 0 && <span data-testid="text-no-punches">No punches today</span>}
                {(clockState === "clocked_in" || clockState === "back_from_break") && (
                  <Link href="/app/attendance">
                    <span className="text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1" data-testid="link-view-timecard">
                      View timecard <ExternalLink className="h-3 w-3" />
                    </span>
                  </Link>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {(clockState === "clocked_out" || clockState === "missing_punch") ? (
              <Button
                onClick={() => punchMutation.mutate("clock_in")}
                disabled={punchMutation.isPending}
                className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm gap-2"
                data-testid="button-dashboard-clock-in"
              >
                <Play className="h-4 w-4" />
                Clock In
              </Button>
            ) : clockState === "pending_punch_approval" ? (
              <Button
                variant="outline"
                disabled
                className="flex-1 sm:flex-none gap-2 border-yellow-300 text-yellow-700 dark:border-yellow-700 dark:text-yellow-400 opacity-70"
                data-testid="button-dashboard-pending"
              >
                <AlertCircle className="h-4 w-4" />
                Awaiting Approval
              </Button>
            ) : (
              <>
                {(clockState === "clocked_in" || clockState === "back_from_break") && (
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
                {clockState === "on_break" && (
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

// ── Helper utilities ─────────────────────────────────────────────────────────
function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function getThisWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const d = new Date(now);
  d.setDate(now.getDate() - day);
  return d.toISOString().split("T")[0];
}

// ── Goal Configuration Modal ──────────────────────────────────────────────────
type GoalType = "labor" | "revenue";

interface GoalConfigModalProps {
  goalType: GoalType;
  companyId?: string;
  onClose: () => void;
}

function GoalConfigModal({ goalType, onClose }: GoalConfigModalProps) {
  const { toast } = useToast();
  const endpoint = goalType === "labor" ? "/api/kpi/labor-goals" : "/api/kpi/revenue-goals";
  const queryKey = [endpoint];

  const { data: goals, isLoading } = useQuery<any[]>({ queryKey });

  const [weekStart, setWeekStart] = useState(getThisWeekStart());
  const [targetAmount, setTargetAmount] = useState("");
  const [autoRecur, setAutoRecur] = useState(false);

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", endpoint, { weekStart, targetAmount: parseFloat(targetAmount || "0"), autoRecur }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: [goalType === "labor" ? "/api/kpi/labor-cost-summary" : "/api/kpi/financial-summary"] });
      setTargetAmount("");
      setAutoRecur(false);
      toast({ title: "Goal saved" });
    },
    onError: () => toast({ title: "Error", description: "Failed to save goal", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `${endpoint}/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Goal deleted" });
    },
    onError: () => toast({ title: "Error", description: "Failed to delete goal", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-goal-config">
        <DialogHeader>
          <DialogTitle>
            {goalType === "labor" ? "Weekly Labor Budget Goals" : "Weekly Revenue Goals"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Week Starting</label>
              <Input
                type="date"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
                data-testid="input-goal-week-start"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Target Amount ($)</label>
              <Input
                type="number"
                min="0"
                step="100"
                placeholder="e.g. 10000"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                data-testid="input-goal-target-amount"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="auto-recur"
              checked={autoRecur}
              onCheckedChange={setAutoRecur}
              data-testid="switch-goal-auto-recur"
            />
            <label htmlFor="auto-recur" className="text-sm cursor-pointer">
              Auto-recur this goal every week
            </label>
          </div>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !targetAmount}
            className="w-full"
            data-testid="button-save-goal"
          >
            <PlusCircle className="h-4 w-4 mr-2" />
            Save Goal
          </Button>

          <div className="border-t pt-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Existing Goals</p>
            {isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (goals || []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-3">No goals configured</p>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {(goals || []).map((g: any) => (
                  <div key={g.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border text-sm" data-testid={`row-goal-${g.id}`}>
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium">{formatCurrency(parseFloat(g.targetAmount || g.target_amount || "0"))}</span>
                      <span className="text-xs text-muted-foreground">
                        Week of {g.weekStart || g.week_start}
                        {g.autoRecur || g.auto_recur ? " · Auto-recur" : ""}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      onClick={() => deleteMutation.mutate(g.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-goal-${g.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Weekly Labor Cost KPI Widget ──────────────────────────────────────────────
function WeeklyLaborCostWidget() {
  const [showGoalConfig, setShowGoalConfig] = useState(false);
  const [showDrillthrough, setShowDrillthrough] = useState(false);
  const [filterCostCenter, setFilterCostCenter] = useState("_all_");
  const [filterJob, setFilterJob] = useState("_all_");
  const weekStart = getThisWeekStart();

  const { data: costCenters } = useQuery<CostCenter[]>({ queryKey: ["/api/cost-centers"] });
  const { data: jobs } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/kpi/labor-cost-summary", weekStart, filterCostCenter, filterJob],
    queryFn: async () => {
      const params = new URLSearchParams({ weekStart });
      if (filterCostCenter && filterCostCenter !== "_all_") params.set("costCenterId", filterCostCenter);
      if (filterJob && filterJob !== "_all_") params.set("jobId", filterJob);
      const r = await fetch(`/api/kpi/labor-cost-summary?${params}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const laborCost = data?.estimatedLaborCost ?? 0;
  const goal = data?.goal ?? null;
  const variance = data?.variance ?? null;
  const variancePct = data?.variancePct ?? null;
  const trendVsPrior = data?.trendVsPrior ?? null;
  const isOverBudget = variance !== null && variance > 0;

  return (
    <>
      <Card className="col-span-1 lg:col-span-2" data-testid="dashlet-weekly-labor-cost">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
            <BarChart3 className="h-4 w-4 text-teal-accent" />
            Weekly Labor Cost vs Goal
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => refetch()}
              title="Refresh"
              data-testid="button-labor-cost-refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setShowGoalConfig(true)}
              data-testid="button-labor-cost-configure-goal"
            >
              <Target className="h-3.5 w-3.5 mr-1" />
              Set Goal
            </Button>
            <Link href="/app/timesheets">
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" data-testid="link-labor-cost-view-all">
                View <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {/* Cost center / job scope filters */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Select value={filterCostCenter} onValueChange={setFilterCostCenter}>
              <SelectTrigger className="h-7 text-xs w-36" data-testid="select-labor-cost-center">
                <SelectValue placeholder="All cost centers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all_">All cost centers</SelectItem>
                {(costCenters || []).map((cc: CostCenter) => (
                  <SelectItem key={cc.id} value={String(cc.id)} data-testid={`option-labor-cost-center-${cc.id}`}>{cc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterJob} onValueChange={setFilterJob}>
              <SelectTrigger className="h-7 text-xs w-32" data-testid="select-labor-job">
                <SelectValue placeholder="All jobs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all_">All jobs</SelectItem>
                {(jobs || []).map((j: Job) => (
                  <SelectItem key={j.id} value={String(j.id)} data-testid={`option-labor-job-${j.id}`}>{j.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-2xl font-bold" data-testid="text-labor-cost-actual">
                    {formatCurrency(laborCost)}
                  </div>
                  <div className="text-xs text-muted-foreground">Estimated Labor Cost</div>
                </div>
                {goal !== null && (
                  <div className="text-right">
                    <div className="text-lg font-semibold text-muted-foreground" data-testid="text-labor-cost-goal">
                      {formatCurrency(goal)}
                    </div>
                    <div className="text-xs text-muted-foreground">Weekly Budget</div>
                  </div>
                )}
              </div>

              {goal !== null && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Budget usage</span>
                    <span className={isOverBudget ? "text-red-600 dark:text-red-400 font-medium" : "text-green-600 dark:text-green-400 font-medium"}>
                      {goal > 0 ? Math.min(100, Math.round((laborCost / goal) * 100)) : 0}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isOverBudget ? "bg-red-500" : "bg-green-500"}`}
                      style={{ width: `${Math.min(100, goal > 0 ? (laborCost / goal) * 100 : 0)}%` }}
                      data-testid="bar-labor-cost-usage"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 text-sm pt-1">
                {variance !== null && (
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Variance</span>
                    <span className={`font-semibold ${isOverBudget ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`} data-testid="text-labor-cost-variance">
                      {isOverBudget ? "+" : ""}{formatCurrency(variance)}
                    </span>
                  </div>
                )}
                {variancePct !== null && (
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Variance %</span>
                    <span className={`font-semibold ${isOverBudget ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`} data-testid="text-labor-cost-variance-pct">
                      {isOverBudget ? "+" : ""}{variancePct.toFixed(1)}%
                    </span>
                  </div>
                )}
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">vs Prior Week</span>
                  <span className={`font-semibold flex items-center gap-1 ${trendVsPrior === null ? "text-muted-foreground" : trendVsPrior > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`} data-testid="text-labor-cost-trend">
                    {trendVsPrior === null ? "N/A" : (
                      <>
                        {trendVsPrior > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                        {trendVsPrior > 0 ? "+" : ""}{trendVsPrior.toFixed(1)}%
                      </>
                    )}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">OT Hours</span>
                  <span className="font-semibold" data-testid="text-labor-cost-ot-hours">{(data?.totalOvertimeHours ?? 0).toFixed(1)}h</span>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => setShowDrillthrough(true)}
                data-testid="button-labor-cost-drillthrough"
              >
                View Cost Center Breakdown
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {showGoalConfig && <GoalConfigModal goalType="labor" onClose={() => setShowGoalConfig(false)} />}

      {showDrillthrough && (
        <Dialog open onOpenChange={(open) => { if (!open) setShowDrillthrough(false); }}>
          <DialogContent className="sm:max-w-2xl" data-testid="dialog-labor-drillthrough">
            <DialogHeader>
              <DialogTitle>Labor Cost Breakdown — Week of {weekStart}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3 text-sm font-medium text-muted-foreground border-b pb-2">
                <span>Cost Center</span>
                <span className="text-right">Worked / Sched Hrs</span>
                <span className="text-right">Est. Labor Cost</span>
              </div>
              {isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (data?.breakdown || []).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No labor data for this week</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {(data?.breakdown || []).map((row: any, i: number) => (
                    <Link key={i} href="/app/timesheets">
                      <div
                        className="grid grid-cols-3 gap-3 text-sm cursor-pointer rounded-md hover:bg-muted/50 px-1 py-1.5 -mx-1 transition-colors"
                        data-testid={`row-labor-breakdown-${i}`}
                      >
                        <span className="truncate">{row.groupName}</span>
                        <span className="text-right">{row.workedHours.toFixed(1)}h / {row.scheduledHours.toFixed(1)}h</span>
                        <span className="text-right font-medium">{formatCurrency(row.estimatedLaborCost)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
              <div className="border-t pt-2 grid grid-cols-3 gap-3 text-sm font-semibold">
                <span>Total</span>
                <span className="text-right">{(data?.totalWorkedHours ?? 0).toFixed(1)}h / {(data?.totalScheduledHours ?? 0).toFixed(1)}h</span>
                <span className="text-right">{formatCurrency(laborCost)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Overtime: {(data?.totalOvertimeHours ?? 0).toFixed(1)}h (projected payroll cost includes 1.5× OT multiplier)
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ── Weekly Financial KPI Widget ───────────────────────────────────────────────
function WeeklyFinancialKPIWidget() {
  const [showGoalConfig, setShowGoalConfig] = useState(false);
  const [filterCostCenter, setFilterCostCenter] = useState("_all_");
  const [filterJob, setFilterJob] = useState("_all_");
  const weekStart = getThisWeekStart();

  const { data: costCenters } = useQuery<CostCenter[]>({ queryKey: ["/api/cost-centers"] });
  const { data: jobs } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/kpi/financial-summary", weekStart, filterCostCenter, filterJob],
    queryFn: async () => {
      const params = new URLSearchParams({ weekStart });
      if (filterCostCenter && filterCostCenter !== "_all_") params.set("costCenterId", filterCostCenter);
      if (filterJob && filterJob !== "_all_") params.set("jobId", filterJob);
      const r = await fetch(`/api/kpi/financial-summary?${params}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const revenue = data?.revenue ?? { actual: 0, goal: null, variance: null, variancePct: null };
  const ar = data?.ar ?? { outstanding: 0, collectionsThisWeek: 0 };
  const ap = data?.ap ?? { billsDueThisWeek: 0 };
  const bottomLine = data?.bottomLine ?? { revenue: 0, laborCost: 0, apBills: 0, estimatedMargin: 0, formula: "" };
  const marginPositive = bottomLine.estimatedMargin >= 0;

  return (
    <>
      <Card className="col-span-1 lg:col-span-2" data-testid="dashlet-weekly-financial-kpi">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
            <DollarSign className="h-4 w-4 text-teal-accent" />
            Weekly Financial KPIs
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => refetch()}
              title="Refresh"
              data-testid="button-financial-kpi-refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setShowGoalConfig(true)}
              data-testid="button-financial-kpi-configure-goal"
            >
              <Target className="h-3.5 w-3.5 mr-1" />
              Set Goal
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Cost center / job scope filters — affects AP/Bills and Labor in bottom-line */}
          <div className="flex flex-col gap-1.5 mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={filterCostCenter} onValueChange={setFilterCostCenter}>
                <SelectTrigger className="h-7 text-xs w-36" data-testid="select-financial-cost-center">
                  <SelectValue placeholder="All cost centers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all_">All cost centers</SelectItem>
                  {(costCenters || []).map((cc: CostCenter) => (
                    <SelectItem key={cc.id} value={String(cc.id)} data-testid={`option-financial-cost-center-${cc.id}`}>{cc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterJob} onValueChange={setFilterJob}>
                <SelectTrigger className="h-7 text-xs w-32" data-testid="select-financial-job">
                  <SelectValue placeholder="All jobs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all_">All jobs</SelectItem>
                  {(jobs || []).map((j: Job) => (
                    <SelectItem key={j.id} value={String(j.id)} data-testid={`option-financial-job-${j.id}`}>{j.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(filterCostCenter !== "_all_" || filterJob !== "_all_") && (
              <p className="text-[10px] text-muted-foreground" data-testid="text-financial-scope-note">
                Filters apply to AP/Bills and Labor. Revenue and AR are company-wide.
              </p>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Revenue vs Goal */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Revenue vs Goal</span>
                  <Link href="/app/invoices" data-testid="link-revenue-invoices" className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
                    Invoices <ExternalLink className="h-2.5 w-2.5 ml-0.5" />
                  </Link>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Link href="/app/invoices" className="font-semibold text-base hover:underline" data-testid="text-revenue-actual">{formatCurrency(revenue.actual)}</Link>
                  {revenue.goal !== null ? (
                    <span className={`text-sm font-medium ${revenue.variance !== null && revenue.variance >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-revenue-variance">
                      {revenue.variance !== null && revenue.variance >= 0 ? "+" : ""}{formatCurrency(revenue.variance ?? 0)} vs {formatCurrency(revenue.goal)} goal
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">No goal set</span>
                  )}
                </div>
              </div>

              {/* AR/Collections */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">AR / Collections</span>
                  <Link href="/app/invoices" data-testid="link-ar-aging" className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
                    AR Aging <ExternalLink className="h-2.5 w-2.5 ml-0.5" />
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <Link href="/app/invoices" className="font-medium hover:underline" data-testid="text-ar-outstanding">{formatCurrency(ar.outstanding)}</Link>
                    <div className="text-xs text-muted-foreground">Outstanding AR</div>
                  </div>
                  <div>
                    <Link href="/app/invoices" className="font-medium text-green-600 dark:text-green-400 hover:underline" data-testid="text-ar-collections">{formatCurrency(ar.collectionsThisWeek)}</Link>
                    <div className="text-xs text-muted-foreground">Collected This Week</div>
                  </div>
                </div>
              </div>

              {/* AP/Bills */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">AP / Bills</span>
                  <Link href="/app/expenses" data-testid="link-ap-bills" className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
                    Bills Queue <ExternalLink className="h-2.5 w-2.5 ml-0.5" />
                  </Link>
                </div>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <Link href="/app/expenses" className="font-medium text-amber-600 dark:text-amber-400 hover:underline" data-testid="text-ap-bills">{formatCurrency(ap.billsDueThisWeek)}</Link>
                  <span className="text-xs text-muted-foreground">Approved expenses this week</span>
                </div>
              </div>

              {/* Bottom Line */}
              <div className="border-t pt-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bottom-Line KPI</span>
                  <Link href="/app/timesheets" data-testid="link-bottom-line-labor" className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
                    Labor Cost <ExternalLink className="h-2.5 w-2.5 ml-0.5" />
                  </Link>
                </div>
                <div className="rounded-md bg-muted/50 p-3 space-y-1.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Revenue</span>
                    <Link href="/app/invoices" className="font-medium hover:underline" data-testid="text-bottom-line-revenue">{formatCurrency(bottomLine.revenue)}</Link>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">− Labor Cost</span>
                    <Link href="/app/timesheets" className="font-medium text-red-600 dark:text-red-400 hover:underline" data-testid="text-bottom-line-labor">{formatCurrency(bottomLine.laborCost)}</Link>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">− AP/Bills</span>
                    <Link href="/app/expenses" className="font-medium text-red-600 dark:text-red-400 hover:underline" data-testid="text-bottom-line-ap">{formatCurrency(bottomLine.apBills)}</Link>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t pt-1.5">
                    <span className="font-semibold">= Est. Margin</span>
                    <span className={`font-bold text-base ${marginPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-bottom-line-margin">
                      {marginPositive ? "" : "−"}{formatCurrency(Math.abs(bottomLine.estimatedMargin))}
                    </span>
                  </div>
                </div>
                {bottomLine.formula && (
                  <p className="text-[10px] text-muted-foreground mt-1.5 italic">{bottomLine.formula}</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {showGoalConfig && <GoalConfigModal goalType="revenue" onClose={() => setShowGoalConfig(false)} />}
    </>
  );
}

const LIFECYCLE_STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  active_paid: { label: "Active (Paid)", color: "text-green-600 dark:text-green-400", icon: CheckCircle2 },
  trial_active: { label: "Trial Active", color: "text-blue-600 dark:text-blue-400", icon: Activity },
  grace_period: { label: "Grace Period", color: "text-amber-600 dark:text-amber-400", icon: Hourglass },
  suspended: { label: "Suspended", color: "text-red-600 dark:text-red-400", icon: XCircle },
  canceled: { label: "Canceled", color: "text-gray-500 dark:text-gray-400", icon: XCircle },
  trial_expired: { label: "Trial Expired", color: "text-orange-600 dark:text-orange-400", icon: AlertTriangle },
};

function LifecycleOverviewWidget() {
  const { data, isLoading } = useQuery<{
    statusCounts: Record<string, number>;
    flaggedTenants: { id: string; name: string; subscription_status: string; grace_period_end?: string }[];
    total: number;
  }>({
    queryKey: ["/api/admin/lifecycle-overview"],
    queryFn: async () => {
      const r = await fetch("/api/admin/lifecycle-overview");
      if (!r.ok) throw new Error("Not authorized");
      return r.json();
    },
    staleTime: 60000,
    retry: false,
  });

  if (isLoading) {
    return (
      <Card data-testid="widget-lifecycle-overview">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const flaggedCount = (data.statusCounts["grace_period"] || 0) + (data.statusCounts["suspended"] || 0);

  return (
    <Card data-testid="widget-lifecycle-overview" className="col-span-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-blue-600" />
            Tenant Lifecycle Overview
          </CardTitle>
          <div className="flex items-center gap-2">
            {flaggedCount > 0 && (
              <Badge variant="destructive" className="text-xs" data-testid="badge-flagged-count">
                {flaggedCount} require attention
              </Badge>
            )}
            <Link href="/app/audit-log">
              <Button variant="outline" size="sm" data-testid="button-view-audit-log">
                View Audit Log
              </Button>
            </Link>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          {Object.entries(data.statusCounts).map(([status, count]) => {
            const cfg = LIFECYCLE_STATUS_CONFIG[status] || { label: status, color: "text-gray-500", icon: Activity };
            const Icon = cfg.icon;
            return (
              <div
                key={status}
                className="flex flex-col items-center p-3 rounded-lg border bg-card"
                data-testid={`stat-lifecycle-${status}`}
              >
                <Icon className={`h-5 w-5 mb-1 ${cfg.color}`} />
                <span className="text-xl font-bold">{count}</span>
                <span className="text-xs text-muted-foreground text-center leading-tight">{cfg.label}</span>
              </div>
            );
          })}
        </div>
        {data.flaggedTenants.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Tenants Needing Attention</p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {data.flaggedTenants.map(t => {
                const cfg = LIFECYCLE_STATUS_CONFIG[t.subscription_status] || { label: t.subscription_status, color: "text-gray-500", icon: Activity };
                const Icon = cfg.icon;
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between px-3 py-2 rounded-md border bg-muted/30 text-sm"
                    data-testid={`row-flagged-tenant-${t.id}`}
                  >
                    <span className="font-medium truncate">{t.name}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {t.grace_period_end && (
                        <span className="text-xs text-muted-foreground">
                          until {new Date(t.grace_period_end).toLocaleDateString()}
                        </span>
                      )}
                      <span className={`flex items-center gap-1 text-xs font-medium ${cfg.color}`}>
                        <Icon className="h-3.5 w-3.5" />
                        {cfg.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
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
    "weekly-labor-cost": <WeeklyLaborCostWidget />,
    "weekly-financial-kpi": <WeeklyFinancialKPIWidget />,
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

      {userRole === "platform_super_admin" && (
        <div className="grid grid-cols-1 gap-4">
          <LifecycleOverviewWidget />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {allowedDashlets.filter((d) => visibility[d.id] !== false).map((d) => (
          <div key={d.id}>{dashletComponents[d.id]}</div>
        ))}
      </div>
    </div>
  );
}
