import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2, Star, MessageSquare, Bug, Sparkles, Lightbulb,
  RefreshCw, CheckCircle2, AlertTriangle, Clock, Monitor,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface FeedbackTicket {
  id: string; company_id: string | null;
  submitter_user_id: string; submitter_name: string | null; submitter_email: string | null;
  type: string; severity: string; status: string; priority_fix: boolean;
  assigned_user_id: string | null;
  title: string; description: string;
  page_url: string | null; browser_info: string | null;
  screenshot_path: string | null; screenshot_paths: string[] | null;
  error_code: string | null;
  steps_to_reproduce: string | null; expected_behavior: string | null; actual_behavior: string | null;
  console_errors: string | null;
  created_at: string; updated_at: string;
}

interface FeedbackComment {
  id: string; ticket_id: string; author_user_id: string; author_name: string | null;
  body: string; is_internal: boolean; created_at: string;
}

const STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "reviewed", label: "Reviewed" },
  { value: "priority_fix", label: "Priority Fix" },
  { value: "in_progress", label: "In Progress" },
  { value: "waiting_on_user", label: "Waiting on User" },
  { value: "closed", label: "Closed / Resolved" },
  { value: "rejected", label: "Rejected" },
];
const TYPE_OPTIONS = [
  { value: "bug", label: "Bug", icon: "🐛" },
  { value: "ux", label: "UX / Improvement", icon: "✨" },
  { value: "feature", label: "Feature Request", icon: "💡" },
  { value: "change_request", label: "Change Request", icon: "🔄" },
  { value: "hr", label: "HR / Workplace Concern", icon: "🛡️" },
  { value: "general", label: "General", icon: "💬" },
];
const SEVERITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const STATUS_BADGE: Record<string, string> = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  reviewed: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  priority_fix: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  waiting_on_user: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  closed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  rejected: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const SEVERITY_BADGE: Record<string, string> = {
  low: "bg-green-50 text-green-700 border-green-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  critical: "bg-red-50 text-red-700 border-red-200",
};

function statusLabel(s: string) { return STATUS_OPTIONS.find(o => o.value === s)?.label || s; }

export default function FeedbackAdminPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const isPlatform = (user?.role || "").startsWith("platform_");

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (filterType !== "all") p.set("type", filterType);
    if (filterStatus !== "all") p.set("status", filterStatus);
    if (filterSeverity !== "all") p.set("severity", filterSeverity);
    if (filterFrom) p.set("from", filterFrom);
    if (filterTo) p.set("to", filterTo);
    return p.toString();
  }, [filterType, filterStatus, filterSeverity, filterFrom, filterTo]);

  const ticketsQuery = useQuery<FeedbackTicket[]>({
    queryKey: ["/api/feedback", queryParams],
    queryFn: async () => {
      const r = await fetch(`/api/feedback${queryParams ? `?${queryParams}` : ""}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load tickets");
      return r.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/feedback/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      toast({ title: "Updated" });
    },
    onError: (err) => toast({ title: "Update failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const tickets = ticketsQuery.data ?? [];
  const activeTicket = tickets.find(t => t.id === activeId) || null;

  // Stats
  const stats = useMemo(() => ({
    newCount: tickets.filter(t => t.status === "new").length,
    inProgress: tickets.filter(t => t.status === "in_progress").length,
    priority: tickets.filter(t => t.priority_fix).length,
    closed: tickets.filter(t => t.status === "closed" || t.status === "rejected").length,
    critical: tickets.filter(t => t.severity === "critical").length,
  }), [tickets]);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-feedback-admin-title">Feedback &amp; Bug Reports</h1>
          <p className="text-sm text-muted-foreground">
            {isPlatform ? "Viewing all tenants" : "Viewing your company's submissions"}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "New", value: stats.newCount, icon: <AlertTriangle className="h-4 w-4" />, color: "text-blue-600" },
          { label: "In Progress", value: stats.inProgress, icon: <Clock className="h-4 w-4" />, color: "text-amber-600" },
          { label: "Priority Fix", value: stats.priority, icon: <Star className="h-4 w-4 fill-current" />, color: "text-rose-600" },
          { label: "Critical", value: stats.critical, icon: <Bug className="h-4 w-4" />, color: "text-red-600" },
          { label: "Resolved", value: stats.closed, icon: <CheckCircle2 className="h-4 w-4" />, color: "text-emerald-600" },
        ].map(s => (
          <Card key={s.label} className="py-3">
            <CardContent className="p-0 px-4 flex items-center gap-3">
              <span className={s.color}>{s.icon}</span>
              <div>
                <p className="text-2xl font-bold leading-none">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm">Filters</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pb-4">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger data-testid="select-filter-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.icon} {o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger data-testid="select-filter-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Severity</Label>
            <Select value={filterSeverity} onValueChange={setFilterSeverity}>
              <SelectTrigger data-testid="select-filter-severity"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                {SEVERITY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} data-testid="input-filter-from" />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} data-testid="input-filter-to" />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm">
            {ticketsQuery.isLoading ? "Loading…" : `${tickets.length} ticket${tickets.length !== 1 ? "s" : ""}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          {ticketsQuery.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No tickets match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 pr-2 w-5"></th>
                    <th className="py-2 pr-3">Title</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Severity</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Submitter</th>
                    <th className="py-2 pr-3">Submitted</th>
                    <th className="py-2 pr-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map(t => (
                    <tr
                      key={t.id}
                      className="border-t hover:bg-accent/40 cursor-pointer"
                      onClick={() => setActiveId(t.id)}
                      data-testid={`row-feedback-${t.id}`}
                    >
                      <td className="py-2 pr-2">
                        {t.priority_fix && <Star className="h-3.5 w-3.5 text-rose-500 fill-rose-500" />}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium" data-testid={`text-feedback-title-${t.id}`}>{t.title}</div>
                        {t.error_code && (
                          <code className="text-xs text-muted-foreground font-mono">{t.error_code}</code>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <span className="text-sm">{TYPE_OPTIONS.find(o => o.value === t.type)?.icon ?? "💬"}</span>
                        <span className="text-xs text-muted-foreground ml-1">{TYPE_OPTIONS.find(o => o.value === t.type)?.label ?? t.type}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs border ${SEVERITY_BADGE[t.severity] || ""}`}>
                          {t.severity}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[t.status] || ""}`}>
                          {statusLabel(t.status)}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground text-xs">
                        {t.submitter_name || "—"}
                        {t.submitter_email && <div className="text-xs opacity-70">{t.submitter_email}</div>}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground text-xs">{new Date(t.created_at).toLocaleString()}</td>
                      <td className="py-2 pr-2">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={e => { e.stopPropagation(); setActiveId(t.id); }} data-testid={`button-open-feedback-${t.id}`}>
                          Open
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <FeedbackDetailDialog
        ticket={activeTicket}
        open={!!activeTicket}
        onClose={() => setActiveId(null)}
        onUpdate={body => activeTicket && updateMutation.mutate({ id: activeTicket.id, body })}
        updating={updateMutation.isPending}
        companyId={user?.companyId ?? null}
      />
    </div>
  );
}

function parseBrowserInfo(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function parseConsoleErrors(raw: string | null): Array<{ msg: string; ts: string; source?: string; stack?: string }> {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function FeedbackDetailDialog({
  ticket, open, onClose, onUpdate, updating, companyId,
}: {
  ticket: FeedbackTicket | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (body: Record<string, unknown>) => void;
  updating: boolean;
  companyId: string | null;
}) {
  const { toast } = useToast();
  const [commentBody, setCommentBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [showDevInfo, setShowDevInfo] = useState(false);

  const commentsQuery = useQuery<FeedbackComment[]>({
    queryKey: ["/api/feedback", ticket?.id, "comments"],
    enabled: !!ticket,
    queryFn: async () => {
      const r = await fetch(`/api/feedback/${ticket!.id}/comments`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load comments");
      return r.json();
    },
  });

  // Company users for assignment dropdown
  const usersQuery = useQuery<Array<{ id: string; username: string | null; firstName?: string; lastName?: string; email?: string }>>({
    queryKey: ["/api/users/company", companyId],
    enabled: !!companyId && open,
    queryFn: async () => {
      const r = await fetch("/api/users", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const addComment = useMutation({
    mutationFn: async () => {
      if (!ticket) return;
      return apiRequest("POST", `/api/feedback/${ticket.id}/comments`, { body: commentBody.trim(), isInternal });
    },
    onSuccess: () => {
      setCommentBody(""); setIsInternal(false);
      queryClient.invalidateQueries({ queryKey: ["/api/feedback", ticket?.id, "comments"] });
      toast({ title: "Comment added" });
    },
    onError: err => toast({ title: "Failed to add comment", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  if (!ticket) return null;

  const browserInfo = parseBrowserInfo(ticket.browser_info);
  const consoleErrors = parseConsoleErrors(ticket.console_errors);
  const allScreenshots = [
    ...(ticket.screenshot_paths ?? []),
    ...(ticket.screenshot_path && !(ticket.screenshot_paths ?? []).includes(ticket.screenshot_path) ? [ticket.screenshot_path] : []),
  ].filter(Boolean);

  const typeInfo = TYPE_OPTIONS.find(o => o.value === ticket.type);
  const companyUsers = usersQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-feedback-detail-title">
            <span className="text-xl">{typeInfo?.icon ?? "💬"}</span>
            {ticket.title}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap gap-2 items-center">
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs border ${SEVERITY_BADGE[ticket.severity] || ""}`}>
              {ticket.severity}
            </span>
            <span>·</span>
            <span>{typeInfo?.label ?? ticket.type}</span>
            <span>·</span>
            <span>submitted {new Date(ticket.created_at).toLocaleString()}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">

          {/* Quick actions */}
          <div className="flex flex-wrap gap-2 p-3 bg-muted/30 rounded-lg border">
            <div className="flex-1 min-w-36">
              <Label className="text-xs mb-1 block">Status</Label>
              <Select value={ticket.status} onValueChange={v => onUpdate({ status: v })}>
                <SelectTrigger className="h-8" data-testid="select-detail-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-44">
              <Label className="text-xs mb-1 block">Assign to</Label>
              <Select
                value={ticket.assigned_user_id || "unassigned"}
                onValueChange={v => onUpdate({ assignedUserId: v === "unassigned" ? null : v })}
              >
                <SelectTrigger className="h-8" data-testid="select-detail-assigned"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {companyUsers.map(u => (
                    <SelectItem key={u.id} value={u.id}>
                      {[u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || u.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button
                size="sm"
                variant={ticket.priority_fix ? "default" : "outline"}
                onClick={() => onUpdate({ priorityFix: !ticket.priority_fix })}
                disabled={updating}
                className="h-8"
                data-testid="button-toggle-priority-fix"
              >
                <Star className={`h-3.5 w-3.5 mr-1.5 ${ticket.priority_fix ? "fill-current" : ""}`} />
                {ticket.priority_fix ? "Priority" : "Flag"}
              </Button>
              {ticket.status !== "closed" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onUpdate({ status: "closed" })}
                  disabled={updating}
                  className="h-8 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                  data-testid="button-mark-complete"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Mark Complete
                </Button>
              )}
            </div>
          </div>

          {/* Submitter */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Submitter</Label>
              <p className="mt-0.5">{ticket.submitter_name || "—"}</p>
              {ticket.submitter_email && <p className="text-xs text-muted-foreground">{ticket.submitter_email}</p>}
            </div>
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Updated</Label>
              <p className="mt-0.5">{new Date(ticket.updated_at).toLocaleString()}</p>
            </div>
          </div>

          {/* Description */}
          <div>
            <Label className="text-xs uppercase text-muted-foreground">Description</Label>
            <p className="whitespace-pre-wrap text-sm mt-1" data-testid="text-feedback-description">{ticket.description}</p>
          </div>

          {/* Error code */}
          {ticket.error_code && (
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Error Code / Message</Label>
              <code className="block text-sm bg-muted px-3 py-2 rounded mt-1 font-mono break-all">{ticket.error_code}</code>
            </div>
          )}

          {/* Steps / Expected / Actual */}
          {ticket.steps_to_reproduce && (
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Steps to Reproduce</Label>
              <p className="whitespace-pre-wrap text-sm mt-1">{ticket.steps_to_reproduce}</p>
            </div>
          )}
          {(ticket.expected_behavior || ticket.actual_behavior) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {ticket.expected_behavior && (
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Expected</Label>
                  <p className="whitespace-pre-wrap text-sm mt-1">{ticket.expected_behavior}</p>
                </div>
              )}
              {ticket.actual_behavior && (
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Actual</Label>
                  <p className="whitespace-pre-wrap text-sm mt-1">{ticket.actual_behavior}</p>
                </div>
              )}
            </div>
          )}

          {/* Screenshots */}
          {allScreenshots.length > 0 && (
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Screenshots ({allScreenshots.length})</Label>
              <div className="flex flex-wrap gap-3 mt-2">
                {allScreenshots.map((s, i) => (
                  <a key={i} href={s} target="_blank" rel="noreferrer" className="block hover:opacity-80 transition-opacity" data-testid={`img-screenshot-${i}`}>
                    <img src={s} alt={`Screenshot ${i + 1}`} className="max-h-48 max-w-xs rounded border object-contain" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Dev Info panel (collapsible) */}
          <div className="border rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowDevInfo(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors text-sm font-medium"
              data-testid="button-toggle-dev-info"
            >
              <span className="flex items-center gap-2"><Monitor className="h-4 w-4" /> Developer Info</span>
              <span className="text-xs text-muted-foreground">{showDevInfo ? "Hide" : "Show"}</span>
            </button>
            {showDevInfo && (
              <div className="p-3 space-y-3 text-xs font-mono bg-zinc-950 dark:bg-zinc-950 text-zinc-100">
                <div className="space-y-1">
                  <p className="text-zinc-400 font-sans font-semibold">Page &amp; Time</p>
                  <p>📍 {ticket.page_url || "—"}</p>
                  <p>🕐 Submitted: {new Date(ticket.created_at).toISOString()}</p>
                </div>
                {Object.keys(browserInfo).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-zinc-400 font-sans font-semibold">Browser / Client</p>
                    {browserInfo.userAgent && <p className="break-all">UA: {browserInfo.userAgent}</p>}
                    {browserInfo.acceptLanguage && <p>Lang: {browserInfo.acceptLanguage}</p>}
                    {browserInfo.ip && <p>IP: {browserInfo.ip}</p>}
                    {browserInfo.capturedAt && <p>Captured: {browserInfo.capturedAt}</p>}
                  </div>
                )}
                {consoleErrors.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-zinc-400 font-sans font-semibold">Captured JS Errors ({consoleErrors.length})</p>
                    {consoleErrors.map((e, i) => (
                      <div key={i} className="border border-zinc-700 rounded p-2 space-y-0.5">
                        <p className="text-red-400 break-all">{e.msg}</p>
                        {e.source && <p className="text-zinc-400">at {e.source}</p>}
                        {e.stack && <p className="text-zinc-500 break-all">{e.stack}</p>}
                        <p className="text-zinc-600">{e.ts}</p>
                      </div>
                    ))}
                  </div>
                )}
                {consoleErrors.length === 0 && (
                  <p className="text-zinc-500">No JS errors captured at time of submission.</p>
                )}
              </div>
            )}
          </div>

          {/* Comments */}
          <div className="border-t pt-4 space-y-3">
            <Label className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Comments &amp; Notes
            </Label>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {commentsQuery.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (commentsQuery.data || []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No comments yet.</p>
              ) : (
                (commentsQuery.data || []).map(c => (
                  <div
                    key={c.id}
                    className={`text-sm p-2 rounded border ${c.is_internal ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700" : "bg-muted/30"}`}
                    data-testid={`comment-${c.id}`}
                  >
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>{c.author_name || "User"}{c.is_internal ? " · 🔒 internal" : ""}</span>
                      <span>{new Date(c.created_at).toLocaleString()}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{c.body}</p>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-2">
              <Textarea
                placeholder="Add a comment or internal note…"
                value={commentBody}
                onChange={e => setCommentBody(e.target.value)}
                rows={2}
                data-testid="input-comment-body"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isInternal}
                    onChange={e => setIsInternal(e.target.checked)}
                    data-testid="checkbox-comment-internal"
                  />
                  Internal note (admins only — not visible to submitter)
                </label>
                <Button
                  size="sm"
                  onClick={() => addComment.mutate()}
                  disabled={addComment.isPending || !commentBody.trim()}
                  data-testid="button-submit-comment"
                >
                  {addComment.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                  Post
                </Button>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="button-detail-close">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
