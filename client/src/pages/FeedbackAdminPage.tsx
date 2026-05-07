import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Star, MessageSquare } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

interface FeedbackTicket {
  id: string;
  company_id: string | null;
  submitter_user_id: string;
  submitter_name: string | null;
  submitter_email: string | null;
  type: string;
  severity: string;
  status: string;
  priority_fix: boolean;
  assigned_user_id: string | null;
  title: string;
  description: string;
  page_url: string | null;
  browser_info: string | null;
  screenshot_path: string | null;
  created_at: string;
  updated_at: string;
}

interface FeedbackComment {
  id: string;
  ticket_id: string;
  author_user_id: string;
  author_name: string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
}

const STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "reviewed", label: "Reviewed" },
  { value: "priority_fix", label: "Priority Fix" },
  { value: "in_progress", label: "In Progress" },
  { value: "waiting_on_user", label: "Waiting on User" },
  { value: "closed", label: "Closed" },
  { value: "rejected", label: "Rejected" },
];
const TYPE_OPTIONS = [
  { value: "bug", label: "Bug" },
  { value: "ux", label: "UX" },
  { value: "feature", label: "Feature" },
  { value: "general", label: "General" },
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

function statusLabel(s: string): string {
  return STATUS_OPTIONS.find((o) => o.value === s)?.label || s;
}

export default function FeedbackAdminPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");
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
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      return apiRequest("PATCH", `/api/feedback/${id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      toast({ title: "Updated" });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Update failed", description: msg, variant: "destructive" });
    },
  });

  const tickets = ticketsQuery.data ?? [];
  const activeTicket = tickets.find((t) => t.id === activeId) || null;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-feedback-admin-title">Feedback & Bug Reports</h1>
          <p className="text-sm text-muted-foreground">
            {isPlatform ? "Viewing all tenants" : "Viewing your company's submissions"}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <Label>Type</Label>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger data-testid="select-filter-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger data-testid="select-filter-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Severity</Label>
            <Select value={filterSeverity} onValueChange={setFilterSeverity}>
              <SelectTrigger data-testid="select-filter-severity"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                {SEVERITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>From</Label>
            <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} data-testid="input-filter-from" />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} data-testid="input-filter-to" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {ticketsQuery.isLoading ? "Loading…" : `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ticketsQuery.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No tickets match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-2"></th>
                    <th className="py-2 pr-2">Title</th>
                    <th className="py-2 pr-2">Type</th>
                    <th className="py-2 pr-2">Severity</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2">Submitter</th>
                    <th className="py-2 pr-2">Created</th>
                    <th className="py-2 pr-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr
                      key={t.id}
                      className="border-t hover:bg-accent/40 cursor-pointer"
                      onClick={() => setActiveId(t.id)}
                      data-testid={`row-feedback-${t.id}`}
                    >
                      <td className="py-2 pr-2">
                        {t.priority_fix ? <Star className="h-4 w-4 text-rose-600 fill-rose-600" /> : null}
                      </td>
                      <td className="py-2 pr-2 font-medium" data-testid={`text-feedback-title-${t.id}`}>{t.title}</td>
                      <td className="py-2 pr-2"><Badge variant="outline">{t.type}</Badge></td>
                      <td className="py-2 pr-2"><Badge variant="outline">{t.severity}</Badge></td>
                      <td className="py-2 pr-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[t.status] || ""}`}>
                          {statusLabel(t.status)}
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-muted-foreground">{t.submitter_name || "—"}</td>
                      <td className="py-2 pr-2 text-muted-foreground">{new Date(t.created_at).toLocaleString()}</td>
                      <td className="py-2 pr-2">
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setActiveId(t.id); }} data-testid={`button-open-feedback-${t.id}`}>
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
        onUpdate={(body) => activeTicket && updateMutation.mutate({ id: activeTicket.id, body })}
        updating={updateMutation.isPending}
      />
    </div>
  );
}

function FeedbackDetailDialog({
  ticket,
  open,
  onClose,
  onUpdate,
  updating,
}: {
  ticket: FeedbackTicket | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (body: Record<string, unknown>) => void;
  updating: boolean;
}) {
  const { toast } = useToast();
  const [commentBody, setCommentBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);

  const commentsQuery = useQuery<FeedbackComment[]>({
    queryKey: ["/api/feedback", ticket?.id, "comments"],
    enabled: !!ticket,
    queryFn: async () => {
      const r = await fetch(`/api/feedback/${ticket!.id}/comments`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load comments");
      return r.json();
    },
  });

  const addComment = useMutation({
    mutationFn: async () => {
      if (!ticket) return;
      return apiRequest("POST", `/api/feedback/${ticket.id}/comments`, {
        body: commentBody.trim(),
        isInternal,
      });
    },
    onSuccess: () => {
      setCommentBody("");
      setIsInternal(false);
      queryClient.invalidateQueries({ queryKey: ["/api/feedback", ticket?.id, "comments"] });
      toast({ title: "Comment added" });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Failed to add comment", description: msg, variant: "destructive" });
    },
  });

  if (!ticket) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-feedback-detail-title">{ticket.title}</DialogTitle>
          <DialogDescription>
            {ticket.type} • {ticket.severity} severity • submitted {new Date(ticket.created_at).toLocaleString()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs uppercase text-muted-foreground">Description</Label>
            <p className="whitespace-pre-wrap text-sm" data-testid="text-feedback-description">{ticket.description}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Submitter</Label>
              <p>{ticket.submitter_name || "—"}{ticket.submitter_email ? ` (${ticket.submitter_email})` : ""}</p>
            </div>
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Page</Label>
              <p className="truncate">{ticket.page_url || "—"}</p>
            </div>
          </div>
          {ticket.screenshot_path && (
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Screenshot</Label>
              <a href={ticket.screenshot_path} target="_blank" rel="noreferrer" className="block">
                <img src={ticket.screenshot_path} alt="Submitted screenshot" className="max-h-64 rounded border" />
              </a>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t pt-4">
            <div>
              <Label>Status</Label>
              <Select value={ticket.status} onValueChange={(v) => onUpdate({ status: v })}>
                <SelectTrigger data-testid="select-detail-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority Fix</Label>
              <div className="flex items-center gap-2 h-10">
                <Button
                  size="sm"
                  variant={ticket.priority_fix ? "default" : "outline"}
                  onClick={() => onUpdate({ priorityFix: !ticket.priority_fix })}
                  disabled={updating}
                  data-testid="button-toggle-priority-fix"
                >
                  <Star className={`h-4 w-4 mr-1 ${ticket.priority_fix ? "fill-current" : ""}`} />
                  {ticket.priority_fix ? "Marked" : "Mark"}
                </Button>
              </div>
            </div>
            <div>
              <Label>Assigned User ID</Label>
              <Input
                placeholder="user id"
                defaultValue={ticket.assigned_user_id || ""}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (ticket.assigned_user_id || "")) onUpdate({ assignedUserId: v || null });
                }}
                data-testid="input-detail-assigned"
              />
            </div>
          </div>

          <div className="border-t pt-4">
            <Label className="flex items-center gap-2 mb-2"><MessageSquare className="h-4 w-4" /> Comments</Label>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {commentsQuery.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (commentsQuery.data || []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No comments yet.</p>
              ) : (
                (commentsQuery.data || []).map((c) => (
                  <div key={c.id} className={`text-sm p-2 rounded border ${c.is_internal ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700" : "bg-muted/30"}`} data-testid={`comment-${c.id}`}>
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>{c.author_name || "User"}{c.is_internal ? " · internal" : ""}</span>
                      <span>{new Date(c.created_at).toLocaleString()}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{c.body}</p>
                  </div>
                ))
              )}
            </div>
            <div className="mt-3 space-y-2">
              <Textarea
                placeholder="Add a comment…"
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                rows={2}
                data-testid="input-comment-body"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={isInternal}
                    onChange={(e) => setIsInternal(e.target.checked)}
                    data-testid="checkbox-comment-internal"
                  />
                  Internal note (admins only)
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
