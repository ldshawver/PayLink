import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  FileText, Plus, Send, CheckCircle, XCircle, Clock, DollarSign, AlertTriangle,
  Edit, Trash2, Eye, ChevronRight, Sparkles, Paperclip, History, RotateCcw,
  Bell, Download, Upload, ArrowLeft, Bot, Loader2, TrendingUp, Users,
  Building2, Calendar, Tag, Shield, Lock, CheckCheck, FilePlus,
  LayoutDashboard, Receipt, FolderOpen, MessageSquare, Palette,
  Settings, FileSignature, CreditCard, Package, ChevronDown, ChevronUp,
  ExternalLink, Info, AlertCircle, ThumbsUp, ThumbsDown, MessageCircle
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type HubSection = "dashboard" | "proposals" | "contracts" | "invoices" | "payments" | "documents" | "messages" | "branding" | "settings";

interface Proposal {
  id: string; proposalNumber: string; title: string; description: string;
  status: string; companyId: string; contractorId: string; issueDate: string;
  expirationDate?: string; amount?: string; subtotal?: string; taxAmount?: string;
  discountAmount?: string; currency?: string; scopeOfWork?: string; assumptions?: string;
  exclusions?: string; allowances?: string; materials?: string; warrantyNotes?: string;
  scheduleNotes?: string; internalNotes?: string; clientMessage?: string; estimatorName?: string;
  paymentTerms?: string; changeOrderTerms?: string; notes?: string; terms?: string;
  version?: number; revisionOfId?: string; isChangeOrder?: boolean;
  approvalName?: string; approvalEmail?: string; approvalAt?: string;
  aiGeneratedSummary?: string; sentAt?: string; viewedAt?: string; createdAt: string;
}

interface LineItem {
  id: string; proposalId: string; name: string; description?: string; category?: string;
  quantity: string; unit?: string; unitPrice: string; lineTotal: string;
  taxable: boolean; optional: boolean; selected: boolean; sortOrder: number; aiGenerated: boolean;
}

interface Invoice {
  id: string; invoiceNumber?: string; title?: string; invoiceType?: string;
  status: string; companyId?: string; contractorId: string;
  invoiceDate: string; dueDate?: string; amount: string; taxAmount?: string;
  discountAmount?: string; amountPaid?: string; balanceDue?: string;
  proposalId?: string; description?: string; paymentTerms?: string;
  paidAt?: string; createdAt: string; reminderEnabled?: boolean;
  lastReminderSentAt?: string;
}

interface Payment {
  id: string; invoiceId: string; amount: string; paymentMethod?: string;
  referenceNumber?: string; notes?: string; paidAt: string; status: string;
}

interface ProposalEvent {
  id: string; proposalId: string; eventType: string; oldStatus?: string;
  newStatus?: string; actorName?: string; actorEmail?: string; notes?: string; createdAt: string;
}

interface Contract {
  id: string; contractNumber?: string; title?: string; status: string;
  contractorId: string; companyId?: string; proposalId?: string;
  startDate?: string; endDate?: string; value?: string; createdAt: string;
}

// ─── Status Helpers ───────────────────────────────────────────────────────────

const PROPOSAL_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:             { label: "Draft",              color: "text-gray-600",   bg: "bg-gray-100 dark:bg-gray-800" },
  internal_review:   { label: "Internal Review",    color: "text-blue-600",   bg: "bg-blue-50 dark:bg-blue-950/30" },
  sent:              { label: "Sent",               color: "text-indigo-600", bg: "bg-indigo-50 dark:bg-indigo-950/30" },
  viewed:            { label: "Viewed",             color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-950/30" },
  revision_requested:{ label: "Revision Needed",    color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950/30" },
  submitted:         { label: "Submitted",          color: "text-blue-600",   bg: "bg-blue-50 dark:bg-blue-950/30" },
  approved:          { label: "Approved",           color: "text-green-600",  bg: "bg-green-50 dark:bg-green-950/30" },
  declined:          { label: "Declined",           color: "text-red-600",    bg: "bg-red-50 dark:bg-red-950/30" },
  rejected:          { label: "Rejected",           color: "text-red-600",    bg: "bg-red-50 dark:bg-red-950/30" },
  expired:           { label: "Expired",            color: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-950/30" },
  superseded:        { label: "Superseded",         color: "text-gray-500",   bg: "bg-gray-50 dark:bg-gray-900/30" },
};

const INVOICE_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:            { label: "Draft",           color: "text-gray-600",   bg: "bg-gray-100 dark:bg-gray-800" },
  pending_approval: { label: "Pending Approval",color: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-950/30" },
  submitted:        { label: "Submitted",       color: "text-blue-600",   bg: "bg-blue-50 dark:bg-blue-950/30" },
  sent:             { label: "Sent",            color: "text-indigo-600", bg: "bg-indigo-50 dark:bg-indigo-950/30" },
  viewed:           { label: "Viewed",          color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-950/30" },
  partially_paid:   { label: "Partial",         color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950/30" },
  paid:             { label: "Paid",            color: "text-green-600",  bg: "bg-green-50 dark:bg-green-950/30" },
  overdue:          { label: "Overdue",         color: "text-red-600",    bg: "bg-red-50 dark:bg-red-950/30" },
  void:             { label: "Void",            color: "text-gray-400",   bg: "bg-gray-50 dark:bg-gray-900/30" },
};

const CONTRACT_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:     { label: "Draft",     color: "text-gray-600",  bg: "bg-gray-100 dark:bg-gray-800" },
  active:    { label: "Active",    color: "text-green-600", bg: "bg-green-50 dark:bg-green-950/30" },
  pending:   { label: "Pending",   color: "text-blue-600",  bg: "bg-blue-50 dark:bg-blue-950/30" },
  completed: { label: "Completed", color: "text-purple-600",bg: "bg-purple-50 dark:bg-purple-950/30" },
  cancelled: { label: "Cancelled", color: "text-red-600",   bg: "bg-red-50 dark:bg-red-950/30" },
  expired:   { label: "Expired",   color: "text-yellow-600",bg: "bg-yellow-50 dark:bg-yellow-950/30" },
};

function ProposalBadge({ status }: { status: string }) {
  const cfg = PROPOSAL_STATUS_CONFIG[status] || { label: status, color: "text-gray-600", bg: "bg-gray-100" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.color} ${cfg.bg}`}>{cfg.label}</span>;
}

function InvoiceBadge({ status }: { status: string }) {
  const cfg = INVOICE_STATUS_CONFIG[status] || { label: status, color: "text-gray-600", bg: "bg-gray-100" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.color} ${cfg.bg}`}>{cfg.label}</span>;
}

function ContractBadge({ status }: { status: string }) {
  const cfg = CONTRACT_STATUS_CONFIG[status] || { label: status, color: "text-gray-600", bg: "bg-gray-100" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.color} ${cfg.bg}`}>{cfg.label}</span>;
}

function fmt(n: string | number | undefined | null) {
  if (n == null || n === "") return "—";
  return `$${parseFloat(String(n)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(s?: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

function DashboardSection({ proposals, invoices, contracts, isAdmin, onNavigate }: {
  proposals: Proposal[]; invoices: Invoice[]; contracts: Contract[];
  isAdmin: boolean; onNavigate: (s: HubSection) => void;
}) {
  const awaitingApproval = proposals.filter(p => ["submitted", "sent", "viewed"].includes(p.status));
  const revisionNeeded = proposals.filter(p => p.status === "revision_requested");
  const approvedProposals = proposals.filter(p => p.status === "approved");
  const activeContracts = contracts.filter(c => c.status === "active");
  const overdueInvoices = invoices.filter(i => {
    if (["paid", "void"].includes(i.status)) return false;
    return i.dueDate && new Date(i.dueDate) < new Date();
  });
  const totalOutstanding = invoices
    .filter(i => !["paid", "void"].includes(i.status))
    .reduce((s, i) => s + parseFloat(i.balanceDue ?? i.amount ?? "0"), 0);
  const totalEarned = invoices
    .filter(i => i.status === "paid")
    .reduce((s, i) => s + parseFloat(i.amountPaid ?? i.amount ?? "0"), 0);

  const stats = [
    {
      label: isAdmin ? "Proposals Awaiting Review" : "Awaiting Approval",
      value: awaitingApproval.length,
      icon: Clock, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/20",
      section: "proposals" as HubSection,
    },
    {
      label: "Active Contracts",
      value: activeContracts.length,
      icon: FileSignature, color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-950/20",
      section: "contracts" as HubSection,
    },
    {
      label: "Overdue Invoices",
      value: overdueInvoices.length,
      icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50 dark:bg-red-950/20",
      section: "invoices" as HubSection,
    },
    {
      label: "Outstanding Balance",
      value: fmt(totalOutstanding),
      icon: DollarSign, color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950/20",
      section: "invoices" as HubSection,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">{isAdmin ? "Contractor Hub Overview" : "My Hub"}</h2>
        <p className="text-sm text-muted-foreground">
          {isAdmin ? "Monitor contractor proposals, contracts, and payments" : "Manage your proposals, contracts, and invoices"}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map(s => (
          <Card key={s.label} className={`${s.bg} border-0 cursor-pointer hover:opacity-80 transition-opacity`} onClick={() => onNavigate(s.section)}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${s.bg}`}>
                <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
              <div>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground leading-tight">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Proposals */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Recent Proposals</CardTitle>
            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => onNavigate("proposals")} data-testid="btn-view-all-proposals">
              View all <ChevronRight className="h-3 w-3 ml-0.5" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {proposals.slice(0, 4).map(p => (
              <div key={p.id} className="flex items-center justify-between py-1">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.title || p.proposalNumber}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(p.issueDate)} · {fmt(p.amount)}</p>
                </div>
                <ProposalBadge status={p.status} />
              </div>
            ))}
            {proposals.length === 0 && (
              <p className="text-center text-muted-foreground text-sm py-4">No proposals yet</p>
            )}
          </CardContent>
        </Card>

        {/* Recent Invoices */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Recent Invoices</CardTitle>
            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => onNavigate("invoices")} data-testid="btn-view-all-invoices">
              View all <ChevronRight className="h-3 w-3 ml-0.5" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {invoices.slice(0, 4).map(inv => {
              const isOverdue = !["paid", "void"].includes(inv.status) && inv.dueDate && new Date(inv.dueDate) < new Date();
              return (
                <div key={inv.id} className="flex items-center justify-between py-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">Invoice #{inv.invoiceNumber || inv.id.slice(0, 8)}</p>
                    <p className="text-xs text-muted-foreground">Due {fmtDate(inv.dueDate)} · {fmt(inv.amount)}</p>
                  </div>
                  <InvoiceBadge status={isOverdue ? "overdue" : inv.status} />
                </div>
              );
            })}
            {invoices.length === 0 && (
              <p className="text-center text-muted-foreground text-sm py-4">No invoices yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Action items */}
      {(revisionNeeded.length > 0 || awaitingApproval.length > 0) && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <p className="text-sm font-semibold text-amber-700">Action Required</p>
            </div>
            <div className="space-y-2">
              {revisionNeeded.length > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-amber-700">{revisionNeeded.length} proposal{revisionNeeded.length !== 1 ? "s" : ""} need{revisionNeeded.length === 1 ? "s" : ""} revision</p>
                  <Button size="sm" variant="outline" className="h-7 text-xs border-amber-300" onClick={() => onNavigate("proposals")} data-testid="btn-action-revisions">Review</Button>
                </div>
              )}
              {isAdmin && awaitingApproval.length > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-amber-700">{awaitingApproval.length} proposal{awaitingApproval.length !== 1 ? "s" : ""} awaiting your review</p>
                  <Button size="sm" variant="outline" className="h-7 text-xs border-amber-300" onClick={() => onNavigate("proposals")} data-testid="btn-action-review">Review</Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary row */}
      <div className="grid grid-cols-2 gap-4 text-center">
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold text-green-600">{fmt(totalEarned)}</p>
            <p className="text-xs text-muted-foreground mt-1">Total Earned (Paid)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold text-primary">{approvedProposals.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Approved Proposals</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Proposal Detail Panel ─────────────────────────────────────────────────────

function ProposalDetailPanel({
  proposal, onClose, isAdmin, onEdit, onRefresh
}: {
  proposal: Proposal; onClose: () => void; isAdmin: boolean;
  onEdit: () => void; onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState("overview");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionNotes, setRevisionNotes] = useState("");
  const [counterOpen, setCounterOpen] = useState(false);
  const [counterAmount, setCounterAmount] = useState("");
  const [counterNotes, setCounterNotes] = useState("");
  const [commentText, setCommentText] = useState("");

  const { data: lineItems = [] } = useQuery<LineItem[]>({
    queryKey: ["/api/contractor-proposals", proposal.id, "line-items"],
    queryFn: async () => {
      const r = await fetch(`/api/contractor-proposals/${proposal.id}/line-items`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const { data: events = [], refetch: refetchEvents } = useQuery<ProposalEvent[]>({
    queryKey: ["/api/contractor-proposals", proposal.id, "events"],
    queryFn: async () => {
      const r = await fetch(`/api/contractor-proposals/${proposal.id}/events`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const { data: attachments = [] } = useQuery<any[]>({
    queryKey: ["/api/contractor-proposals", proposal.id, "attachments"],
    queryFn: async () => {
      const r = await fetch(`/api/contractor-proposals/${proposal.id}/attachments`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const actionMutation = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: any }) =>
      apiRequest("POST", `/api/contractor-proposals/${proposal.id}/${action}`, body || {}),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-invoices"] });
      refetchEvents();
      setRejectOpen(false); setRevisionOpen(false); setCounterOpen(false);
      setCommentText("");
      toast({ title:
        vars.action === "accept" ? "Proposal approved" :
        vars.action === "reject" ? "Proposal rejected" :
        vars.action === "request-revision" ? "Revision requested" :
        vars.action === "counter" ? "Counter offer sent" :
        vars.action === "submit" ? "Proposal submitted" :
        "Done"
      });
      onRefresh();
    },
    onError: (e: any) => toast({ title: e?.message || "Action failed", variant: "destructive" }),
  });

  const revisionMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/contractor-proposals/${proposal.id}/create-revision`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] });
      toast({ title: "New revision created" });
      onClose();
    },
    onError: (e: any) => toast({ title: e?.message || "Failed", variant: "destructive" }),
  });

  const subtotal = lineItems.filter(i => i.selected).reduce((s, i) => s + parseFloat(i.lineTotal ?? "0"), 0);
  const tax = parseFloat(proposal.taxAmount ?? "0");
  const discount = parseFloat(proposal.discountAmount ?? "0");
  const total = subtotal + tax - discount;

  const canEdit = ["draft", "revision_requested"].includes(proposal.status);
  const canSubmit = ["draft", "revision_requested"].includes(proposal.status) && !isAdmin;
  const canAdminAction = isAdmin && ["submitted", "sent", "viewed"].includes(proposal.status);
  const canRevise = !isAdmin && ["draft", "revision_requested"].includes(proposal.status);
  const canCreateRevision = isAdmin && ["approved", "sent", "viewed"].includes(proposal.status);

  return (
    <Sheet open onOpenChange={() => onClose()}>
      <SheetContent side="right" className="w-full max-w-3xl p-0 flex flex-col">
        <SheetHeader className="px-6 py-4 border-b shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-base truncate">{proposal.title || "Proposal Detail"}</SheetTitle>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-xs text-muted-foreground">{proposal.proposalNumber}</span>
                <ProposalBadge status={proposal.status} />
                {proposal.isChangeOrder && <span className="text-xs bg-purple-100 text-purple-700 rounded px-1.5 py-0.5">Change Order</span>}
                {(proposal.version || 1) > 1 && <span className="text-xs text-muted-foreground">v{proposal.version}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
              {canEdit && (
                <Button size="sm" variant="outline" onClick={onEdit} data-testid="btn-edit-from-detail">
                  <Edit className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
              )}
              {canSubmit && (
                <Button size="sm" onClick={() => actionMutation.mutate({ action: "submit" })} disabled={actionMutation.isPending} data-testid="btn-submit-from-detail">
                  <Send className="h-3.5 w-3.5 mr-1" /> Submit
                </Button>
              )}
              {canAdminAction && (
                <>
                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => actionMutation.mutate({ action: "accept" })} disabled={actionMutation.isPending} data-testid="btn-approve-proposal">
                    <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" className="border-orange-300 text-orange-700" onClick={() => setRevisionOpen(true)} data-testid="btn-request-revision">
                    <RotateCcw className="h-3.5 w-3.5 mr-1" /> Request Revision
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setCounterOpen(true)} data-testid="btn-counter-offer">
                    <MessageCircle className="h-3.5 w-3.5 mr-1" /> Counter
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => setRejectOpen(true)} data-testid="btn-reject-proposal">
                    <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                  </Button>
                </>
              )}
              {proposal.status === "approved" && isAdmin && (
                <Button size="sm" variant="outline" onClick={() => actionMutation.mutate({ action: "convert-to-invoice" })} disabled={actionMutation.isPending} data-testid="btn-convert-invoice">
                  <FilePlus className="h-3.5 w-3.5 mr-1" /> Create Invoice
                </Button>
              )}
              {canCreateRevision && (
                <Button size="sm" variant="outline" onClick={() => revisionMutation.mutate()} disabled={revisionMutation.isPending} data-testid="btn-create-revision-from-detail">
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> New Revision
                </Button>
              )}
            </div>
          </div>
        </SheetHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
          <TabsList className="shrink-0 w-full rounded-none border-b bg-transparent h-auto p-0 justify-start gap-0 overflow-x-auto">
            {[
              { value: "overview", label: "Overview" },
              { value: "scope", label: "Scope & Pricing" },
              { value: "terms", label: "Terms" },
              { value: "attachments", label: `Attachments${attachments.length > 0 ? ` (${attachments.length})` : ""}` },
              { value: "history", label: `History${events.length > 0 ? ` (${events.length})` : ""}` },
              { value: "thread", label: "Thread" },
            ].map(t => (
              <TabsTrigger key={t.value} value={t.value}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2.5 text-sm whitespace-nowrap"
                data-testid={`tab-detail-${t.value}`}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <ScrollArea className="flex-1">
            {/* Overview */}
            <TabsContent value="overview" className="m-0 p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Issue Date</p>
                  <p className="font-medium">{fmtDate(proposal.issueDate)}</p>
                </div>
                {proposal.expirationDate && (
                  <div>
                    <p className="text-muted-foreground text-xs">Expires</p>
                    <p className="font-medium">{fmtDate(proposal.expirationDate)}</p>
                  </div>
                )}
                {proposal.estimatorName && (
                  <div>
                    <p className="text-muted-foreground text-xs">Prepared By</p>
                    <p className="font-medium">{proposal.estimatorName}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground text-xs">Total Value</p>
                  <p className="font-bold text-primary text-lg">{fmt(proposal.amount)}</p>
                </div>
              </div>

              {proposal.clientMessage && (
                <div className="bg-muted/40 rounded-lg p-4 italic text-sm text-muted-foreground border-l-2 border-primary/30">
                  "{proposal.clientMessage}"
                </div>
              )}

              {proposal.description && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Project Description</p>
                  <p className="text-sm">{proposal.description}</p>
                </div>
              )}

              {proposal.status === "approved" && proposal.approvalName && (
                <div className="border-2 border-green-500 rounded-lg p-4 bg-green-50 dark:bg-green-950/20">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <p className="font-semibold text-green-700">Approved</p>
                  </div>
                  <p className="text-sm text-green-700">By <strong>{proposal.approvalName}</strong> ({proposal.approvalEmail})</p>
                  <p className="text-xs text-green-600 mt-1">{fmtDate(proposal.approvalAt)}</p>
                </div>
              )}

              {proposal.internalNotes && (
                <div className="bg-yellow-50 dark:bg-yellow-950/20 rounded-lg p-3 border border-yellow-200">
                  <p className="text-xs font-medium text-yellow-700 mb-1">Internal Notes</p>
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">{proposal.internalNotes}</p>
                </div>
              )}
            </TabsContent>

            {/* Scope & Pricing */}
            <TabsContent value="scope" className="m-0 p-6 space-y-5">
              {proposal.scopeOfWork && (
                <div>
                  <h3 className="text-sm font-semibold mb-2 pb-1 border-b">Scope of Work</h3>
                  <p className="text-sm whitespace-pre-wrap text-foreground/80">{proposal.scopeOfWork}</p>
                </div>
              )}
              {proposal.assumptions && (
                <div>
                  <h3 className="text-sm font-semibold mb-2 pb-1 border-b">Assumptions</h3>
                  <p className="text-sm whitespace-pre-wrap text-foreground/80">{proposal.assumptions}</p>
                </div>
              )}
              {proposal.exclusions && (
                <div>
                  <h3 className="text-sm font-semibold mb-2 pb-1 border-b">Exclusions</h3>
                  <p className="text-sm whitespace-pre-wrap text-foreground/80">{proposal.exclusions}</p>
                </div>
              )}
              {proposal.scheduleNotes && (
                <div>
                  <h3 className="text-sm font-semibold mb-2 pb-1 border-b">Schedule</h3>
                  <p className="text-sm whitespace-pre-wrap text-foreground/80">{proposal.scheduleNotes}</p>
                </div>
              )}

              {lineItems.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2 pb-1 border-b">Pricing</h3>
                  <table className="w-full text-sm">
                    <thead><tr className="text-muted-foreground border-b">
                      <th className="text-left py-1 font-medium">Item</th>
                      <th className="text-right py-1 font-medium">Qty</th>
                      <th className="text-right py-1 font-medium">Unit $</th>
                      <th className="text-right py-1 font-medium">Total</th>
                    </tr></thead>
                    <tbody className="divide-y divide-border">
                      {lineItems.filter(i => i.selected).map(item => (
                        <tr key={item.id}>
                          <td className="py-1.5">
                            <p>{item.name}{item.optional ? " (Optional)" : ""}</p>
                            {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                          </td>
                          <td className="text-right py-1.5">{item.quantity}</td>
                          <td className="text-right py-1.5">{fmt(item.unitPrice)}</td>
                          <td className="text-right py-1.5 font-medium">{fmt(item.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-3 border-t pt-3 space-y-1 text-sm max-w-xs ml-auto">
                    <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmt(subtotal)}</span></div>
                    {tax > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{fmt(tax)}</span></div>}
                    {discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>-{fmt(discount)}</span></div>}
                    <div className="flex justify-between font-semibold border-t pt-1"><span>Total</span><span className="text-primary">{fmt(total || parseFloat(proposal.amount ?? "0"))}</span></div>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Terms */}
            <TabsContent value="terms" className="m-0 p-6 space-y-4">
              {[
                { label: "Payment Terms", value: proposal.paymentTerms },
                { label: "Warranty / Guarantee", value: proposal.warrantyNotes },
                { label: "Materials", value: proposal.materials },
                { label: "Change Order Terms", value: proposal.changeOrderTerms },
                { label: "Additional Notes", value: proposal.notes },
              ].map(({ label, value }) => value ? (
                <div key={label}>
                  <h3 className="text-sm font-semibold mb-1 text-muted-foreground">{label}</h3>
                  <p className="text-sm whitespace-pre-wrap">{value}</p>
                </div>
              ) : null)}
              {!proposal.paymentTerms && !proposal.warrantyNotes && !proposal.notes && (
                <p className="text-center text-muted-foreground text-sm py-8">No terms specified</p>
              )}
            </TabsContent>

            {/* Attachments */}
            <TabsContent value="attachments" className="m-0 p-6">
              {attachments.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8">No attachments</p>
              ) : (
                <div className="space-y-2">
                  {attachments.map((att: any) => (
                    <div key={att.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <Paperclip className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{att.file_name}</p>
                          <p className="text-xs text-muted-foreground capitalize">{att.attachment_type?.replace(/_/g, " ")}</p>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" asChild>
                        <a href={`/${att.file_path}`} target="_blank" rel="noreferrer" data-testid={`btn-download-att-${att.id}`}>
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* History / Version History */}
            <TabsContent value="history" className="m-0 p-6">
              {events.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8">No history yet.</p>
              ) : (
                <div className="space-y-3">
                  {events.map((ev, i) => (
                    <div key={ev.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={cn(
                          "h-7 w-7 rounded-full flex items-center justify-center shrink-0",
                          ev.eventType === "approved" ? "bg-green-100" :
                          ev.eventType === "rejected" ? "bg-red-100" :
                          ev.eventType === "submitted" ? "bg-blue-100" :
                          "bg-primary/10"
                        )}>
                          {ev.eventType === "approved" ? <CheckCircle className="h-3.5 w-3.5 text-green-600" /> :
                           ev.eventType === "rejected" ? <XCircle className="h-3.5 w-3.5 text-red-600" /> :
                           ev.eventType === "submitted" ? <Send className="h-3.5 w-3.5 text-blue-600" /> :
                           <History className="h-3.5 w-3.5 text-primary" />}
                        </div>
                        {i < events.length - 1 && <div className="w-0.5 flex-1 bg-border mt-1" />}
                      </div>
                      <div className="pb-4 flex-1">
                        <p className="text-sm font-medium capitalize">{ev.eventType.replace(/_/g, " ")}</p>
                        <p className="text-xs text-muted-foreground">{fmtDate(ev.createdAt)} — {ev.actorName || "System"}</p>
                        {ev.notes && <p className="text-xs text-muted-foreground mt-0.5 italic">"{ev.notes}"</p>}
                        {ev.oldStatus && ev.newStatus && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            <span className="capitalize">{ev.oldStatus.replace(/_/g, " ")}</span>
                            <ChevronRight className="h-3 w-3 inline mx-0.5" />
                            <span className="capitalize">{ev.newStatus.replace(/_/g, " ")}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Negotiation Thread */}
            <TabsContent value="thread" className="m-0 p-6 space-y-4">
              <div className="space-y-3">
                {events.filter(e => e.notes).map(ev => (
                  <div key={ev.id} className={cn(
                    "rounded-lg p-3 text-sm border",
                    ev.eventType === "approved" ? "bg-green-50 border-green-200 dark:bg-green-950/20" :
                    ev.eventType === "rejected" ? "bg-red-50 border-red-200 dark:bg-red-950/20" :
                    ev.eventType === "revision_requested" ? "bg-orange-50 border-orange-200 dark:bg-orange-950/20" :
                    ev.eventType === "counter" ? "bg-blue-50 border-blue-200 dark:bg-blue-950/20" :
                    "bg-muted/40"
                  )}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold capitalize text-muted-foreground">{ev.eventType.replace(/_/g, " ")}</span>
                      <span className="text-xs text-muted-foreground">{fmtDate(ev.createdAt)} · {ev.actorName || "System"}</span>
                    </div>
                    <p className="italic">"{ev.notes}"</p>
                  </div>
                ))}
                {events.filter(e => e.notes).length === 0 && (
                  <div className="text-center py-6 text-muted-foreground">
                    <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No messages yet</p>
                    <p className="text-xs">Notes from approve/reject/revision actions will appear here</p>
                  </div>
                )}
              </div>

              {canAdminAction && (
                <div className="border-t pt-4 space-y-2">
                  <Label className="text-xs text-muted-foreground">Add a note (visible to contractor)</Label>
                  <Textarea
                    value={commentText}
                    onChange={e => setCommentText(e.target.value)}
                    placeholder="Type a message or feedback..."
                    rows={3}
                    data-testid="textarea-thread-comment"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => actionMutation.mutate({ action: "request-revision", body: { notes: commentText } })} disabled={actionMutation.isPending || !commentText} data-testid="btn-thread-request-revision">
                      <RotateCcw className="h-3.5 w-3.5 mr-1" /> Request Revision
                    </Button>
                    <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => actionMutation.mutate({ action: "accept", body: { notes: commentText } })} disabled={actionMutation.isPending} data-testid="btn-thread-approve">
                      <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </SheetContent>

      {/* Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Proposal</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Please provide a reason for rejecting this proposal. The contractor will be notified.</p>
            <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Reason for rejection..." rows={4} data-testid="textarea-reject-reason" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => actionMutation.mutate({ action: "reject", body: { reason: rejectReason } })} disabled={actionMutation.isPending} data-testid="btn-confirm-reject">
              {actionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Reject Proposal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revision Dialog */}
      <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request Revision</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Describe what changes are needed. The contractor will revise and resubmit.</p>
            <Textarea value={revisionNotes} onChange={e => setRevisionNotes(e.target.value)} placeholder="What needs to be changed..." rows={4} data-testid="textarea-revision-notes" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionOpen(false)}>Cancel</Button>
            <Button variant="outline" className="border-orange-300 text-orange-700" onClick={() => actionMutation.mutate({ action: "request-revision", body: { notes: revisionNotes } })} disabled={actionMutation.isPending} data-testid="btn-confirm-revision">
              {actionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Request Revision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Counter Offer Dialog */}
      <Dialog open={counterOpen} onOpenChange={setCounterOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Counter Offer</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Current amount: <strong>{fmt(proposal.amount)}</strong>
            </p>
            <div>
              <Label>Counter Amount ($)</Label>
              <Input type="number" value={counterAmount} onChange={e => setCounterAmount(e.target.value)} placeholder="0.00" min="0" step="0.01" data-testid="input-counter-amount" />
            </div>
            <div>
              <Label>Notes / Explanation</Label>
              <Textarea value={counterNotes} onChange={e => setCounterNotes(e.target.value)} placeholder="Explain your counter offer..." rows={3} data-testid="textarea-counter-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCounterOpen(false)}>Cancel</Button>
            <Button onClick={() => actionMutation.mutate({ action: "counter", body: { counterAmount: parseFloat(counterAmount), notes: counterNotes } })} disabled={actionMutation.isPending || !counterAmount} data-testid="btn-confirm-counter">
              {actionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Send Counter Offer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}

// ─── Proposal Builder ─────────────────────────────────────────────────────────

function ProposalBuilder({
  open, onClose, proposal, isAdmin
}: {
  open: boolean; onClose: () => void; proposal?: Proposal | null; isAdmin: boolean;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState("details");
  const [form, setForm] = useState<Partial<Proposal>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [aiAction, setAiAction] = useState("");

  const isNew = !proposal;
  const proposalId = proposal?.id;

  const { data: companies = [] } = useQuery<any[]>({ queryKey: ["/api/contractor-proposals/companies"] });
  const { data: lineItems = [], refetch: refetchItems } = useQuery<LineItem[]>({
    queryKey: ["/api/contractor-proposals", proposalId, "line-items"],
    queryFn: async () => {
      if (!proposalId) return [];
      const r = await fetch(`/api/contractor-proposals/${proposalId}/line-items`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!proposalId,
  });
  const { data: events = [] } = useQuery<ProposalEvent[]>({
    queryKey: ["/api/contractor-proposals", proposalId, "events"],
    queryFn: async () => {
      if (!proposalId) return [];
      const r = await fetch(`/api/contractor-proposals/${proposalId}/events`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!proposalId,
  });
  const { data: attachments = [], refetch: refetchAttachments } = useQuery<any[]>({
    queryKey: ["/api/contractor-proposals", proposalId, "attachments"],
    queryFn: async () => {
      if (!proposalId) return [];
      const r = await fetch(`/api/contractor-proposals/${proposalId}/attachments`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!proposalId,
  });

  const current = { ...proposal, ...form };

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (isNew) return apiRequest("POST", "/api/contractor-proposals", data);
      return apiRequest("PATCH", `/api/contractor-proposals/${proposalId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] });
      toast({ title: isNew ? "Proposal created" : "Proposal saved" });
      if (isNew) onClose();
    },
    onError: (e: any) => toast({ title: e?.message || "Save failed", variant: "destructive" }),
  });

  const actionMutation = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: any }) =>
      apiRequest("POST", `/api/contractor-proposals/${proposalId}/${action}`, body || {}),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals", proposalId, "events"] });
      toast({ title: vars.action === "send" ? "Proposal marked as sent" : vars.action === "submit" ? "Proposal submitted for review" : "Done" });
    },
    onError: (e: any) => toast({ title: e?.message || "Action failed", variant: "destructive" }),
  });

  const addItemMutation = useMutation({
    mutationFn: (item: any) => apiRequest("POST", `/api/contractor-proposals/${proposalId}/line-items`, item),
    onSuccess: () => { refetchItems(); queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] }); },
    onError: (e: any) => toast({ title: e?.message || "Failed to add item", variant: "destructive" }),
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: string) => apiRequest("DELETE", `/api/proposal-line-items/${itemId}`),
    onSuccess: () => { refetchItems(); queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] }); },
  });

  const revisionMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/contractor-proposals/${proposalId}/create-revision`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] }); toast({ title: "New revision created" }); onClose(); },
    onError: (e: any) => toast({ title: e?.message || "Failed to create revision", variant: "destructive" }),
  });

  const canEdit = isNew || ["draft", "revision_requested"].includes(proposal?.status || "draft");
  const canSubmit = !isNew && ["draft", "revision_requested"].includes(proposal?.status || "");
  const canSend = !isNew && isAdmin && ["draft", "internal_review", "submitted"].includes(proposal?.status || "");
  const canRevise = !isNew && isAdmin && ["approved", "sent", "viewed"].includes(proposal?.status || "");

  async function handleAi(action: string) {
    if (!proposalId) { toast({ title: "Save the proposal first before using AI" }); return; }
    setAiLoading(true); setAiAction(action); setAiResult("");
    try {
      const r = await fetch(`/api/contractor-proposals/${proposalId}/ai-assist`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, context: form.scopeOfWork || current.scopeOfWork }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message);
      setAiResult(d.result || "");
    } catch (e: any) {
      toast({ title: e.message || "AI failed", variant: "destructive" });
    } finally { setAiLoading(false); }
  }

  function applyAiResult() {
    if (aiAction === "draft_scope" || aiAction === "improve_scope") setForm(f => ({ ...f, scopeOfWork: aiResult }));
    else if (aiAction === "suggest_exclusions") setForm(f => ({ ...f, exclusions: aiResult }));
    else if (aiAction === "suggest_assumptions") setForm(f => ({ ...f, assumptions: aiResult }));
    else if (aiAction === "suggest_payment_terms") setForm(f => ({ ...f, paymentTerms: aiResult }));
    else if (aiAction === "generate_summary") setForm(f => ({ ...f, aiGeneratedSummary: aiResult }));
    toast({ title: "Applied to proposal" });
    setAiResult("");
  }

  async function handleAiLineItems() {
    if (!proposalId) { toast({ title: "Save the proposal first" }); return; }
    setAiLoading(true); setAiAction("suggest_line_items");
    try {
      const r = await fetch(`/api/contractor-proposals/${proposalId}/ai-assist`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest_line_items" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message);
      if (d.parsed && Array.isArray(d.parsed)) {
        for (const item of d.parsed.slice(0, 10)) {
          await apiRequest("POST", `/api/contractor-proposals/${proposalId}/line-items`, {
            name: item.name || "Item", description: item.description, category: item.category,
            quantity: item.quantity || 1, unit: item.unit, unitPrice: item.unitPrice || 0, aiGenerated: true,
          });
        }
        refetchItems();
        queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] });
        toast({ title: `${d.parsed.length} AI line items added` });
      } else {
        setAiResult(d.result); setAiAction("suggest_line_items_text");
      }
    } catch (e: any) { toast({ title: e.message || "AI failed", variant: "destructive" }); }
    finally { setAiLoading(false); }
  }

  async function handleAttachmentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!proposalId || !e.target.files?.[0]) return;
    const fd = new FormData();
    fd.append("file", e.target.files[0]);
    fd.append("attachmentType", "supporting_doc");
    try {
      const r = await fetch(`/api/contractor-proposals/${proposalId}/attachments`, {
        method: "POST", credentials: "include", body: fd,
      });
      if (!r.ok) throw new Error("Upload failed");
      refetchAttachments();
      toast({ title: "File attached" });
    } catch { toast({ title: "Upload failed", variant: "destructive" }); }
  }

  const subtotal = lineItems.filter(i => i.selected).reduce((s, i) => s + parseFloat(i.lineTotal ?? "0"), 0);
  const tax = parseFloat(current.taxAmount ?? "0");
  const discount = parseFloat(current.discountAmount ?? "0");
  const total = subtotal + tax - discount;

  return (
    <Sheet open={open} onOpenChange={() => onClose()}>
      <SheetContent side="right" className="w-full max-w-4xl p-0 flex flex-col">
        <SheetHeader className="px-6 py-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle className="text-base">
                {isNew ? "New Proposal" : proposal?.proposalNumber || "Proposal"}
              </SheetTitle>
              {proposal && <div className="mt-1"><ProposalBadge status={proposal.status} /></div>}
            </div>
            <div className="flex items-center gap-2">
              {canEdit && (
                <Button size="sm" onClick={() => saveMutation.mutate({
                  ...form,
                  issueDate: form.issueDate || current.issueDate || new Date().toISOString().split("T")[0],
                  companyId: form.companyId || current.companyId,
                })} disabled={saveMutation.isPending} data-testid="btn-save-proposal">
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save
                </Button>
              )}
              {canSubmit && (
                <Button size="sm" variant="outline" onClick={() => actionMutation.mutate({ action: "submit" })} data-testid="btn-submit-proposal">
                  <Send className="h-4 w-4 mr-1" /> Submit for Review
                </Button>
              )}
              {canSend && (
                <Button size="sm" variant="outline" onClick={() => actionMutation.mutate({ action: "send" })} data-testid="btn-send-proposal">
                  <Send className="h-4 w-4 mr-1" /> Mark Sent
                </Button>
              )}
              {canRevise && (
                <Button size="sm" variant="outline" onClick={() => revisionMutation.mutate()} data-testid="btn-create-revision">
                  <RotateCcw className="h-4 w-4 mr-1" /> Create Revision
                </Button>
              )}
            </div>
          </div>
        </SheetHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
          <TabsList className="shrink-0 w-full rounded-none border-b bg-transparent h-auto p-0 justify-start gap-0">
            {[
              { value: "details", label: "Details" },
              { value: "scope", label: "Scope" },
              { value: "pricing", label: "Pricing" },
              { value: "terms", label: "Terms" },
              { value: "attachments", label: "Attachments" },
              { value: "ai", label: "AI Assist" },
              { value: "history", label: "History" },
              { value: "preview", label: "Preview" },
            ].map(t => (
              <TabsTrigger key={t.value} value={t.value}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2.5 text-sm"
                data-testid={`tab-proposal-${t.value}`}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <ScrollArea className="flex-1">
            {/* ── Details Tab ── */}
            <TabsContent value="details" className="m-0 p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>Proposal Title *</Label>
                  <Input value={form.title ?? current.title ?? ""} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. Kitchen Remodel — 123 Main St" disabled={!canEdit} data-testid="input-proposal-title" />
                </div>
                {isNew && (
                  <div className="col-span-2">
                    <Label>Client / Company</Label>
                    <Select value={form.companyId ?? current.companyId ?? ""} onValueChange={v => setForm(f => ({ ...f, companyId: v }))} disabled={!canEdit}>
                      <SelectTrigger data-testid="select-proposal-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                      <SelectContent>{companies.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <Label>Issue Date</Label>
                  <Input type="date" value={form.issueDate ?? current.issueDate ?? ""} onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))} disabled={!canEdit} data-testid="input-proposal-issue-date" />
                </div>
                <div>
                  <Label>Expiration Date</Label>
                  <Input type="date" value={form.expirationDate ?? current.expirationDate ?? ""} onChange={e => setForm(f => ({ ...f, expirationDate: e.target.value }))} disabled={!canEdit} data-testid="input-proposal-exp-date" />
                </div>
                <div>
                  <Label>Estimator / Salesperson</Label>
                  <Input value={form.estimatorName ?? current.estimatorName ?? ""} onChange={e => setForm(f => ({ ...f, estimatorName: e.target.value }))} placeholder="Estimator name" disabled={!canEdit} data-testid="input-estimator" />
                </div>
                <div>
                  <Label>Currency</Label>
                  <Select value={form.currency ?? current.currency ?? "USD"} onValueChange={v => setForm(f => ({ ...f, currency: v }))} disabled={!canEdit}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="USD">USD ($)</SelectItem><SelectItem value="CAD">CAD</SelectItem><SelectItem value="EUR">EUR (€)</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Project Description</Label>
                  <Textarea value={form.description ?? current.description ?? ""} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Brief project overview..." rows={3} disabled={!canEdit} data-testid="textarea-description" />
                </div>
                <div className="col-span-2">
                  <Label>Client Message (cover note)</Label>
                  <Textarea value={form.clientMessage ?? current.clientMessage ?? ""} onChange={e => setForm(f => ({ ...f, clientMessage: e.target.value }))}
                    placeholder="Personalized message to include with the proposal..." rows={2} disabled={!canEdit} data-testid="textarea-client-message" />
                </div>
                {!isNew && (
                  <div className="col-span-2">
                    <Label>Internal Notes</Label>
                    <Textarea value={form.internalNotes ?? current.internalNotes ?? ""} onChange={e => setForm(f => ({ ...f, internalNotes: e.target.value }))}
                      placeholder="Internal notes (not shown to client)..." rows={2} data-testid="textarea-internal-notes" />
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ── Scope Tab ── */}
            <TabsContent value="scope" className="m-0 p-6 space-y-4">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label>Scope of Work</Label>
                    <Button size="sm" variant="ghost" onClick={() => handleAi("improve_scope")} disabled={aiLoading || !canEdit} className="text-xs text-primary" data-testid="btn-ai-improve-scope">
                      <Sparkles className="h-3 w-3 mr-1" /> AI Improve
                    </Button>
                  </div>
                  <Textarea value={form.scopeOfWork ?? current.scopeOfWork ?? ""} onChange={e => setForm(f => ({ ...f, scopeOfWork: e.target.value }))}
                    placeholder="Describe all work to be performed in detail..." rows={6} disabled={!canEdit} data-testid="textarea-scope" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label>Assumptions</Label>
                    <Button size="sm" variant="ghost" onClick={() => handleAi("suggest_assumptions")} disabled={aiLoading || !canEdit} className="text-xs text-primary" data-testid="btn-ai-assumptions">
                      <Sparkles className="h-3 w-3 mr-1" /> AI Suggest
                    </Button>
                  </div>
                  <Textarea value={form.assumptions ?? current.assumptions ?? ""} onChange={e => setForm(f => ({ ...f, assumptions: e.target.value }))}
                    placeholder="Project assumptions..." rows={4} disabled={!canEdit} data-testid="textarea-assumptions" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label>Exclusions</Label>
                    <Button size="sm" variant="ghost" onClick={() => handleAi("suggest_exclusions")} disabled={aiLoading || !canEdit} className="text-xs text-primary" data-testid="btn-ai-exclusions">
                      <Sparkles className="h-3 w-3 mr-1" /> AI Suggest
                    </Button>
                  </div>
                  <Textarea value={form.exclusions ?? current.exclusions ?? ""} onChange={e => setForm(f => ({ ...f, exclusions: e.target.value }))}
                    placeholder="Items not included in this proposal..." rows={4} disabled={!canEdit} data-testid="textarea-exclusions" />
                </div>
                <div>
                  <Label>Allowances</Label>
                  <Textarea value={form.allowances ?? current.allowances ?? ""} onChange={e => setForm(f => ({ ...f, allowances: e.target.value }))}
                    placeholder="Budget allowances included in pricing..." rows={2} disabled={!canEdit} data-testid="textarea-allowances" />
                </div>
                <div>
                  <Label>Schedule / Estimated Duration</Label>
                  <Textarea value={form.scheduleNotes ?? current.scheduleNotes ?? ""} onChange={e => setForm(f => ({ ...f, scheduleNotes: e.target.value }))}
                    placeholder="Project timeline, start date, estimated completion..." rows={2} disabled={!canEdit} data-testid="textarea-schedule" />
                </div>
              </div>
            </TabsContent>

            {/* ── Pricing Tab ── */}
            <TabsContent value="pricing" className="m-0 p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-sm">Line Items</h3>
                  {canEdit && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={handleAiLineItems} disabled={aiLoading || !proposalId} data-testid="btn-ai-line-items">
                        {aiLoading && aiAction === "suggest_line_items" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
                        AI Suggest Items
                      </Button>
                      <Button size="sm" onClick={() => {
                        if (!proposalId) { toast({ title: "Save the proposal first" }); return; }
                        addItemMutation.mutate({ name: "New Item", quantity: 1, unitPrice: 0 });
                      }} data-testid="btn-add-line-item">
                        <Plus className="h-4 w-4 mr-1" /> Add Item
                      </Button>
                    </div>
                  )}
                </div>

                {lineItems.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No line items yet. Add items or use AI to suggest pricing.</p>
                  </div>
                )}

                <div className="space-y-2">
                  {lineItems.map(item => (
                    <LineItemRow key={item.id} item={item} canEdit={canEdit} onDelete={() => deleteItemMutation.mutate(item.id)} onRefresh={refetchItems} />
                  ))}
                </div>

                <Separator />
                <div className="space-y-2 max-w-xs ml-auto">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{fmt(subtotal)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Tax ($)</span>
                    <Input type="number" className="h-7 w-24 text-right" value={form.taxAmount ?? current.taxAmount ?? ""}
                      onChange={e => setForm(f => ({ ...f, taxAmount: e.target.value }))} disabled={!canEdit} placeholder="0.00" data-testid="input-tax" />
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Discount ($)</span>
                    <Input type="number" className="h-7 w-24 text-right" value={form.discountAmount ?? current.discountAmount ?? ""}
                      onChange={e => setForm(f => ({ ...f, discountAmount: e.target.value }))} disabled={!canEdit} placeholder="0.00" data-testid="input-discount" />
                  </div>
                  <Separator />
                  <div className="flex justify-between font-semibold">
                    <span>Total</span>
                    <span className="text-primary">{fmt(total)}</span>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ── Terms Tab ── */}
            <TabsContent value="terms" className="m-0 p-6 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>Payment Terms</Label>
                  <Button size="sm" variant="ghost" onClick={() => handleAi("suggest_payment_terms")} disabled={aiLoading || !canEdit} className="text-xs text-primary" data-testid="btn-ai-payment-terms">
                    <Sparkles className="h-3 w-3 mr-1" /> AI Suggest
                  </Button>
                </div>
                <Textarea value={form.paymentTerms ?? current.paymentTerms ?? ""} onChange={e => setForm(f => ({ ...f, paymentTerms: e.target.value }))}
                  placeholder="e.g. 30% deposit upon acceptance, 40% at project midpoint, 30% upon completion..." rows={4} disabled={!canEdit} data-testid="textarea-payment-terms" />
              </div>
              <div>
                <Label>Warranty / Guarantee</Label>
                <Textarea value={form.warrantyNotes ?? current.warrantyNotes ?? ""} onChange={e => setForm(f => ({ ...f, warrantyNotes: e.target.value }))}
                  placeholder="Warranty terms, coverage period, exclusions..." rows={3} disabled={!canEdit} data-testid="textarea-warranty" />
              </div>
              <div>
                <Label>Materials</Label>
                <Textarea value={form.materials ?? current.materials ?? ""} onChange={e => setForm(f => ({ ...f, materials: e.target.value }))}
                  placeholder="Key materials, brands, specifications..." rows={3} disabled={!canEdit} data-testid="textarea-materials" />
              </div>
              <div>
                <Label>Change Order Terms</Label>
                <Textarea value={form.changeOrderTerms ?? current.changeOrderTerms ?? ""} onChange={e => setForm(f => ({ ...f, changeOrderTerms: e.target.value }))}
                  placeholder="Terms for changes outside original scope..." rows={3} disabled={!canEdit} data-testid="textarea-change-order-terms" />
              </div>
              <div>
                <Label>Additional Notes</Label>
                <Textarea value={form.notes ?? current.notes ?? ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Any additional notes or terms..." rows={2} disabled={!canEdit} data-testid="textarea-notes" />
              </div>
            </TabsContent>

            {/* ── Attachments Tab ── */}
            <TabsContent value="attachments" className="m-0 p-6 space-y-4">
              {canEdit && (
                <label className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 cursor-pointer hover:border-primary/50 transition-colors" data-testid="upload-attachment">
                  <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Drop files here or click to upload</p>
                  <p className="text-xs text-muted-foreground mt-1">PDFs, images, spreadsheets, blueprints, quotes</p>
                  <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.doc,.docx"
                    onChange={handleAttachmentUpload} disabled={!proposalId} />
                </label>
              )}
              {attachments.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-4">No attachments yet.</p>
              ) : (
                <div className="space-y-2">
                  {attachments.map((att: any) => (
                    <div key={att.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <Paperclip className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{att.file_name}</p>
                          <p className="text-xs text-muted-foreground capitalize">{att.attachment_type?.replace(/_/g, " ")}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" asChild>
                          <a href={`/${att.file_path}`} target="_blank" rel="noreferrer" data-testid={`btn-download-att-${att.id}`}><Download className="h-4 w-4" /></a>
                        </Button>
                        {canEdit && (
                          <Button size="sm" variant="ghost" onClick={async () => {
                            await apiRequest("DELETE", `/api/proposal-attachments/${att.id}`);
                            refetchAttachments();
                          }} data-testid={`btn-delete-att-${att.id}`}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── AI Assist Tab ── */}
            <TabsContent value="ai" className="m-0 p-6 space-y-4">
              <div className="bg-gradient-to-br from-primary/5 to-blue-50 dark:to-blue-950/20 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Bot className="h-5 w-5 text-primary" />
                  <h3 className="font-medium text-sm">AI Proposal Assistant</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-4">AI helps you draft professional, accurate proposals. It will never invent facts — it flags missing information instead.</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { action: "draft_scope", label: "Draft Scope from Notes", icon: FileText },
                    { action: "improve_scope", label: "Improve Scope Quality", icon: TrendingUp },
                    { action: "suggest_assumptions", label: "Suggest Assumptions", icon: CheckCheck },
                    { action: "suggest_exclusions", label: "Suggest Exclusions", icon: XCircle },
                    { action: "suggest_payment_terms", label: "Draft Payment Terms", icon: DollarSign },
                    { action: "generate_summary", label: "Generate Summary", icon: Sparkles },
                    { action: "flag_missing", label: "Flag Missing Info", icon: AlertTriangle },
                  ].map(({ action, label, icon: Icon }) => (
                    <Button key={action} size="sm" variant="outline" onClick={() => handleAi(action)}
                      disabled={aiLoading || !proposalId} className="justify-start text-xs h-9" data-testid={`btn-ai-${action}`}>
                      {aiLoading && aiAction === action ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Icon className="h-3 w-3 mr-2" />}
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
              {aiResult && (
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">AI Result</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={applyAiResult} data-testid="btn-apply-ai">Apply to Proposal</Button>
                      <Button size="sm" variant="ghost" onClick={() => setAiResult("")}>Dismiss</Button>
                    </div>
                  </div>
                  <pre className="text-sm whitespace-pre-wrap font-sans text-foreground">{aiResult}</pre>
                </div>
              )}
              {!proposalId && (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  <Bot className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  Save the proposal first to use AI assistance.
                </div>
              )}
            </TabsContent>

            {/* ── History Tab ── */}
            <TabsContent value="history" className="m-0 p-6">
              {events.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8">No history yet.</p>
              ) : (
                <div className="space-y-3">
                  {events.map((ev, i) => (
                    <div key={ev.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <History className="h-3.5 w-3.5 text-primary" />
                        </div>
                        {i < events.length - 1 && <div className="w-0.5 flex-1 bg-border mt-1" />}
                      </div>
                      <div className="pb-4">
                        <p className="text-sm font-medium capitalize">{ev.eventType.replace(/_/g, " ")}</p>
                        <p className="text-xs text-muted-foreground">{fmtDate(ev.createdAt)} — {ev.actorName || "System"}</p>
                        {ev.notes && <p className="text-xs text-muted-foreground mt-0.5">{ev.notes}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Preview Tab ── */}
            <TabsContent value="preview" className="m-0">
              <ProposalPreview proposal={current as Proposal} lineItems={lineItems} subtotal={subtotal} tax={tax} discount={discount} total={total} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// ─── Line Item Row ────────────────────────────────────────────────────────────

function LineItemRow({ item, canEdit, onDelete, onRefresh }: { item: LineItem; canEdit: boolean; onDelete: () => void; onRefresh: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: item.name, description: item.description ?? "", quantity: item.quantity, unitPrice: item.unitPrice, category: item.category ?? "" });

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/proposal-line-items/${item.id}`, { ...form, unitPrice: form.unitPrice, quantity: form.quantity }),
    onSuccess: () => { onRefresh(); setEditing(false); },
    onError: (e: any) => toast({ title: e?.message || "Failed to save", variant: "destructive" }),
  });

  const lineTotal = (parseFloat(form.quantity || "1") || 1) * (parseFloat(form.unitPrice || "0") || 0);

  if (editing) {
    return (
      <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
        <div className="grid grid-cols-4 gap-2">
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Item name" className="col-span-2 h-8 text-sm" data-testid={`input-item-name-${item.id}`} />
          <Input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="Category" className="h-8 text-sm" />
          <div className="flex gap-1">
            <Button size="sm" className="h-8 flex-1" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid={`btn-save-item-${item.id}`}>Save</Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)}>✕</Button>
          </div>
        </div>
        <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Description" className="h-8 text-sm" />
        <div className="grid grid-cols-3 gap-2">
          <div className="flex items-center gap-1">
            <Label className="text-xs w-6 shrink-0">Qty</Label>
            <Input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} className="h-8 text-sm" />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-xs w-14 shrink-0">Unit $</Label>
            <Input type="number" value={form.unitPrice} onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))} className="h-8 text-sm" />
          </div>
          <div className="flex items-center justify-end text-sm font-medium">Total: {fmt(lineTotal)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{item.name}</p>
          {item.aiGenerated && <span className="text-xs text-primary bg-primary/10 rounded px-1">AI</span>}
          {item.optional && <span className="text-xs text-muted-foreground bg-muted rounded px-1">Optional</span>}
          {item.category && <span className="text-xs text-muted-foreground">{item.category}</span>}
        </div>
        {item.description && <p className="text-xs text-muted-foreground truncate mt-0.5">{item.description}</p>}
        <p className="text-xs text-muted-foreground">{item.quantity} × {fmt(item.unitPrice)}</p>
      </div>
      <div className="flex items-center gap-3 ml-4 shrink-0">
        <span className="text-sm font-semibold">{fmt(item.lineTotal)}</span>
        {canEdit && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(true)} data-testid={`btn-edit-item-${item.id}`}><Edit className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onDelete} data-testid={`btn-delete-item-${item.id}`}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Proposal Preview ─────────────────────────────────────────────────────────

function ProposalPreview({ proposal, lineItems, subtotal, tax, discount, total }: {
  proposal: Proposal; lineItems: LineItem[]; subtotal: number; tax: number; discount: number; total: number;
}) {
  return (
    <div className="p-8 bg-white dark:bg-gray-950 min-h-full">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{proposal.title || "Proposal"}</h1>
            <p className="text-sm text-muted-foreground mt-1">{proposal.proposalNumber}</p>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <p>Date: {fmtDate(proposal.issueDate)}</p>
            {proposal.expirationDate && <p>Expires: {fmtDate(proposal.expirationDate)}</p>}
            {proposal.estimatorName && <p>Prepared by: {proposal.estimatorName}</p>}
          </div>
        </div>
        {proposal.clientMessage && (
          <div className="bg-muted/40 rounded-lg p-4 italic text-sm text-muted-foreground">"{proposal.clientMessage}"</div>
        )}
        {proposal.scopeOfWork && (
          <div>
            <h2 className="text-base font-semibold mb-2 pb-1 border-b">Scope of Work</h2>
            <p className="text-sm whitespace-pre-wrap text-gray-700 dark:text-gray-300">{proposal.scopeOfWork}</p>
          </div>
        )}
        {lineItems.length > 0 && (
          <div>
            <h2 className="text-base font-semibold mb-3 pb-1 border-b">Pricing</h2>
            <table className="w-full text-sm">
              <thead><tr className="text-muted-foreground border-b">
                <th className="text-left py-1 font-medium">Item</th>
                <th className="text-right py-1 font-medium">Qty</th>
                <th className="text-right py-1 font-medium">Unit Price</th>
                <th className="text-right py-1 font-medium">Total</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {lineItems.filter(i => i.selected).map(item => (
                  <tr key={item.id}>
                    <td className="py-1.5">
                      <p>{item.name}{item.optional ? " (Optional)" : ""}</p>
                      {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                    </td>
                    <td className="text-right py-1.5">{item.quantity}</td>
                    <td className="text-right py-1.5">{fmt(item.unitPrice)}</td>
                    <td className="text-right py-1.5 font-medium">{fmt(item.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 border-t pt-3 space-y-1 text-sm max-w-xs ml-auto">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmt(subtotal)}</span></div>
              {tax > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{fmt(tax)}</span></div>}
              {discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>-{fmt(discount)}</span></div>}
              <div className="flex justify-between font-semibold border-t pt-1"><span>Total</span><span>{fmt(total)}</span></div>
            </div>
          </div>
        )}
        {proposal.assumptions && (
          <div>
            <h2 className="text-base font-semibold mb-2 pb-1 border-b">Assumptions</h2>
            <p className="text-sm whitespace-pre-wrap text-gray-700 dark:text-gray-300">{proposal.assumptions}</p>
          </div>
        )}
        {proposal.exclusions && (
          <div>
            <h2 className="text-base font-semibold mb-2 pb-1 border-b">Exclusions</h2>
            <p className="text-sm whitespace-pre-wrap text-gray-700 dark:text-gray-300">{proposal.exclusions}</p>
          </div>
        )}
        {proposal.paymentTerms && (
          <div>
            <h2 className="text-base font-semibold mb-2 pb-1 border-b">Payment Terms</h2>
            <p className="text-sm whitespace-pre-wrap text-gray-700 dark:text-gray-300">{proposal.paymentTerms}</p>
          </div>
        )}
        {proposal.warrantyNotes && (
          <div>
            <h2 className="text-base font-semibold mb-2 pb-1 border-b">Warranty</h2>
            <p className="text-sm whitespace-pre-wrap text-gray-700 dark:text-gray-300">{proposal.warrantyNotes}</p>
          </div>
        )}
        {proposal.status === "approved" && proposal.approvalName && (
          <div className="border-2 border-green-500 rounded-lg p-4 bg-green-50 dark:bg-green-950/20">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <h2 className="font-semibold text-green-700">Approved</h2>
            </div>
            <p className="text-sm text-green-700">Approved by <strong>{proposal.approvalName}</strong> ({proposal.approvalEmail})</p>
            <p className="text-xs text-green-600 mt-1">{fmtDate(proposal.approvalAt)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Invoice Detail Panel ─────────────────────────────────────────────────────

function InvoiceDetailPanel({
  invoice, onClose, isAdmin, proposalStatus
}: { invoice: Invoice; onClose: () => void; isAdmin: boolean; proposalStatus?: string }) {
  const { toast } = useToast();
  const [tab, setTab] = useState("summary");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("check");
  const [payRef, setPayRef] = useState("");

  const { data: payments = [], refetch: refetchPayments } = useQuery<Payment[]>({
    queryKey: ["/api/contractor-invoices", invoice.id, "payments"],
    queryFn: async () => {
      const r = await fetch(`/api/contractor-invoices/${invoice.id}/payments`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const { data: reminders = [] } = useQuery<any[]>({
    queryKey: ["/api/contractor-invoices", invoice.id, "reminder-logs"],
    queryFn: async () => {
      const r = await fetch(`/api/contractor-invoices/${invoice.id}/reminder-logs`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAdmin,
  });

  const proposalBlocked = invoice.proposalId && proposalStatus && proposalStatus !== "approved";
  const balance = parseFloat(invoice.balanceDue ?? invoice.amount ?? "0");

  const payMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/contractor-invoices/${invoice.id}/payments`, {
      amount: parseFloat(payAmount), paymentMethod: payMethod, referenceNumber: payRef,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-invoices"] });
      refetchPayments();
      setPayAmount(""); setPayRef("");
      toast({ title: "Payment recorded" });
    },
    onError: (e: any) => toast({ title: e?.message || "Payment failed", variant: "destructive" }),
  });

  const reminderMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/contractor-invoices/${invoice.id}/send-reminder`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-invoices"] });
      toast({ title: "Reminder sent" });
    },
  });

  return (
    <Sheet open onOpenChange={() => onClose()}>
      <SheetContent side="right" className="w-full max-w-2xl p-0 flex flex-col">
        <SheetHeader className="px-6 py-4 border-b shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle className="text-base">Invoice #{invoice.invoiceNumber || invoice.id.slice(0, 8)}</SheetTitle>
              {invoice.title && <p className="text-sm text-muted-foreground mt-0.5">{invoice.title}</p>}
              <div className="flex items-center gap-2 mt-1">
                <InvoiceBadge status={invoice.status} />
                {proposalBlocked && (
                  <span className="inline-flex items-center gap-1 text-xs text-orange-600 bg-orange-50 dark:bg-orange-950/20 rounded px-1.5 py-0.5">
                    <Lock className="h-3 w-3" /> Proposal not approved
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-primary">{fmt(invoice.amount)}</p>
              {balance > 0 && balance < parseFloat(invoice.amount || "0") && (
                <p className="text-xs text-orange-600">Balance: {fmt(balance)}</p>
              )}
              {balance <= 0 && <p className="text-xs text-green-600">Paid in full</p>}
            </div>
          </div>
        </SheetHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
          <TabsList className="shrink-0 w-full rounded-none border-b bg-transparent h-auto p-0 justify-start gap-0">
            {[
              { value: "summary", label: "Summary" },
              { value: "payments", label: "Payments" },
              { value: "linked", label: "Linked Proposal" },
              ...(isAdmin ? [{ value: "reminders", label: "Reminders" }] : []),
            ].map(t => (
              <TabsTrigger key={t.value} value={t.value}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2.5 text-sm"
                data-testid={`tab-invoice-${t.value}`}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <ScrollArea className="flex-1">
            <TabsContent value="summary" className="m-0 p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-muted-foreground text-xs">Invoice Date</p><p className="font-medium">{fmtDate(invoice.invoiceDate)}</p></div>
                <div><p className="text-muted-foreground text-xs">Due Date</p><p className="font-medium">{fmtDate(invoice.dueDate)}</p></div>
                <div><p className="text-muted-foreground text-xs">Amount</p><p className="font-bold text-lg text-primary">{fmt(invoice.amount)}</p></div>
                <div><p className="text-muted-foreground text-xs">Balance Due</p><p className="font-semibold">{fmt(invoice.balanceDue ?? invoice.amount)}</p></div>
              </div>
              {invoice.description && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Description</p>
                  <p className="text-sm">{invoice.description}</p>
                </div>
              )}
              {invoice.paymentTerms && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Payment Terms</p>
                  <p className="text-sm">{invoice.paymentTerms}</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="payments" className="m-0 p-6 space-y-4">
              {isAdmin && !["paid", "void"].includes(invoice.status) && !proposalBlocked && balance > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Record Payment</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Amount</Label>
                        <Input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                          placeholder={`Max: $${balance.toFixed(2)}`} data-testid="input-payment-amount" />
                      </div>
                      <div>
                        <Label className="text-xs">Method</Label>
                        <Select value={payMethod} onValueChange={setPayMethod}>
                          <SelectTrigger data-testid="select-payment-method"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="check">Check</SelectItem>
                            <SelectItem value="ach">ACH / Bank Transfer</SelectItem>
                            <SelectItem value="wire">Wire Transfer</SelectItem>
                            <SelectItem value="credit_card">Credit Card</SelectItem>
                            <SelectItem value="cash">Cash</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Reference # (optional)</Label>
                      <Input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="Check #, transaction ID..." data-testid="input-payment-ref" />
                    </div>
                    <Button onClick={() => payMutation.mutate()} disabled={payMutation.isPending || !payAmount} className="w-full" data-testid="btn-record-payment">
                      {payMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <DollarSign className="h-4 w-4 mr-2" />}
                      Record Payment
                    </Button>
                  </CardContent>
                </Card>
              )}
              <div>
                <h3 className="text-sm font-medium mb-3">Payment History</h3>
                {payments.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-4">No payments recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {payments.map(p => (
                      <div key={p.id} className="flex justify-between items-center p-3 border rounded-lg text-sm">
                        <div>
                          <p className="font-medium">{fmt(p.amount)}</p>
                          <p className="text-xs text-muted-foreground capitalize">{p.paymentMethod?.replace(/_/g, " ")} · {fmtDate(p.paidAt)}</p>
                          {p.referenceNumber && <p className="text-xs text-muted-foreground">Ref: {p.referenceNumber}</p>}
                        </div>
                        <Badge variant="outline" className="text-green-600">Recorded</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="linked" className="m-0 p-6">
              {!invoice.proposalId ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No linked proposal</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className={`flex items-center gap-3 p-4 rounded-lg border ${proposalStatus === "approved" ? "border-green-300 bg-green-50 dark:bg-green-950/20" : "border-orange-300 bg-orange-50 dark:bg-orange-950/20"}`}>
                    {proposalStatus === "approved" ? <CheckCircle className="h-5 w-5 text-green-600" /> : <AlertTriangle className="h-5 w-5 text-orange-600" />}
                    <div>
                      <p className={`font-medium text-sm ${proposalStatus === "approved" ? "text-green-700" : "text-orange-700"}`}>
                        Proposal {proposalStatus === "approved" ? "Approved" : `Status: ${proposalStatus}`}
                      </p>
                      <p className={`text-xs ${proposalStatus === "approved" ? "text-green-600" : "text-orange-600"}`}>
                        {proposalStatus === "approved" ? "Payment is authorized for this invoice." : "Payment is blocked until the proposal is approved."}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            {isAdmin && (
              <TabsContent value="reminders" className="m-0 p-6 space-y-4">
                {!["paid", "void"].includes(invoice.status) && (
                  <Button onClick={() => reminderMutation.mutate()} disabled={reminderMutation.isPending || !!proposalBlocked} className="w-full" variant="outline" data-testid="btn-send-reminder">
                    {reminderMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Bell className="h-4 w-4 mr-2" />}
                    Send Reminder Now
                  </Button>
                )}
                {invoice.lastReminderSentAt && (
                  <p className="text-xs text-muted-foreground text-center">Last reminder sent: {fmtDate(invoice.lastReminderSentAt)}</p>
                )}
                {reminders.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-4">No reminders sent yet.</p>
                ) : (
                  <div className="space-y-2">
                    {reminders.map((r: any) => (
                      <div key={r.id} className="p-3 border rounded-lg text-sm">
                        <div className="flex justify-between items-center mb-1">
                          <span className="capitalize font-medium">{r.channel} reminder</span>
                          <Badge variant={r.status === "sent" ? "default" : "destructive"} className="text-xs">{r.status}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{fmtDate(r.sent_at)} → {r.recipient}</p>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            )}
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// ─── Contracts Section ────────────────────────────────────────────────────────

function ContractsSection({ isAdmin }: { isAdmin: boolean }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: contracts = [], isLoading } = useQuery<Contract[]>({
    queryKey: ["/api/contractor-contracts"],
    queryFn: async () => {
      const r = await fetch("/api/contractor-contracts", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const filtered = contracts.filter(c => {
    const matchSearch = !search || c.title?.toLowerCase().includes(search.toLowerCase()) || c.contractNumber?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Contracts</h2>
          <p className="text-sm text-muted-foreground">Active and historical contracts</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contracts..." className="h-8 max-w-xs" data-testid="input-contract-search" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-36" data-testid="select-contract-status"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {Object.entries(CONTRACT_STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
          <FileSignature className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">{contracts.length === 0 ? "No contracts yet" : "No contracts match your filter"}</p>
          <p className="text-xs mt-1">Contracts are created when proposals are approved and converted</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <div key={c.id} className="border rounded-lg p-4 hover:bg-muted/30 transition-colors" data-testid={`row-contract-${c.id}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">{c.title || c.contractNumber || "Contract"}</p>
                    <ContractBadge status={c.status} />
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                    {c.contractNumber && <span>{c.contractNumber}</span>}
                    {c.startDate && <><span>·</span><span>Start {fmtDate(c.startDate)}</span></>}
                    {c.endDate && <><span>·</span><span>End {fmtDate(c.endDate)}</span></>}
                    {c.value && <><span>·</span><span className="font-semibold text-foreground">{fmt(c.value)}</span></>}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Payments Section ─────────────────────────────────────────────────────────

function PaymentsSection({ invoices }: { invoices: Invoice[] }) {
  const { data: allPayments = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/contractor-payments"],
    queryFn: async () => {
      const r = await fetch("/api/contractor-payments", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const totalPaid = allPayments.reduce((s: number, p: any) => s + parseFloat(p.amount ?? "0"), 0);
  const outstandingInvoices = invoices.filter(i => !["paid", "void"].includes(i.status));
  const totalOutstanding = outstandingInvoices.reduce((s, i) => s + parseFloat(i.balanceDue ?? i.amount ?? "0"), 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Payments & Remittance</h2>
        <p className="text-sm text-muted-foreground">Track incoming and outgoing payments</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold text-green-600">{fmt(totalPaid)}</p>
            <p className="text-xs text-muted-foreground mt-1">Total Payments Received</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold text-orange-600">{fmt(totalOutstanding)}</p>
            <p className="text-xs text-muted-foreground mt-1">Outstanding Balance</p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : allPayments.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
          <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No payments recorded yet</p>
          <p className="text-xs mt-1">Payments appear here when invoices are paid</p>
        </div>
      ) : (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Payment History</h3>
          {allPayments.map((p: any) => (
            <div key={p.id} className="border rounded-lg p-3 flex items-center justify-between" data-testid={`row-payment-${p.id}`}>
              <div>
                <p className="text-sm font-semibold text-green-600">+{fmt(p.amount)}</p>
                <p className="text-xs text-muted-foreground capitalize">{p.payment_method?.replace(/_/g, " ")} · {fmtDate(p.paid_at)}</p>
                {p.reference_number && <p className="text-xs text-muted-foreground">Ref: {p.reference_number}</p>}
              </div>
              <Badge variant="outline" className="text-green-600">Received</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Documents Section ────────────────────────────────────────────────────────

function DocumentsSection() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Documents</h2>
        <p className="text-sm text-muted-foreground">Access and manage your contractor documents</p>
      </div>
      <Card>
        <CardContent className="p-6 text-center">
          <FolderOpen className="h-12 w-12 mx-auto mb-3 text-primary/40" />
          <p className="font-medium mb-1">Document Library</p>
          <p className="text-sm text-muted-foreground mb-4">Your contractor documents, certificates, and files are managed in the Document Library.</p>
          <Button variant="outline" asChild data-testid="btn-open-documents">
            <a href="/app/documents">
              <ExternalLink className="h-4 w-4 mr-1" /> Open Document Library
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Messages Section ─────────────────────────────────────────────────────────

function MessagesSection() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Messages</h2>
        <p className="text-sm text-muted-foreground">Negotiations and communication threads</p>
      </div>
      <Card>
        <CardContent className="p-6 text-center">
          <MessageSquare className="h-12 w-12 mx-auto mb-3 text-primary/40" />
          <p className="font-medium mb-1">Proposal Threads</p>
          <p className="text-sm text-muted-foreground">Messages and negotiation notes are embedded within each proposal. Open a proposal and go to the Thread tab to view and reply.</p>
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            <span>Full standalone messaging coming in a future update</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Branding Section ─────────────────────────────────────────────────────────

function BrandingSection() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Profile & Branding</h2>
        <p className="text-sm text-muted-foreground">Customize how your proposals look to clients</p>
      </div>
      <Card>
        <CardContent className="p-6 text-center">
          <Palette className="h-12 w-12 mx-auto mb-3 text-primary/40" />
          <p className="font-medium mb-1">Proposal Templates & Branding</p>
          <p className="text-sm text-muted-foreground mb-4">Logo, brand colors, email signature, and proposal templates will be configurable here in the upcoming branding update.</p>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            <span>Branding settings coming in Task #34</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Settings Section ─────────────────────────────────────────────────────────

function SettingsSection() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">Notification preferences and hub configuration</p>
      </div>
      <Card>
        <CardContent className="p-6 text-center">
          <Settings className="h-12 w-12 mx-auto mb-3 text-primary/40" />
          <p className="font-medium mb-1">Hub Settings</p>
          <p className="text-sm text-muted-foreground mb-4">Invoice reminder frequency, notification preferences, and default payment terms will be configurable here.</p>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            <span>Settings coming in Task #35</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const NAV_ITEMS: { id: HubSection; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "proposals", label: "Proposals", icon: FileText },
  { id: "contracts", label: "Contracts", icon: FileSignature },
  { id: "invoices", label: "Invoices", icon: Receipt },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "documents", label: "Documents", icon: FolderOpen },
  { id: "messages", label: "Messages", icon: MessageSquare },
  { id: "branding", label: "Profile & Branding", icon: Palette },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function ContractorHubPage() {
  const { toast } = useToast();
  const [section, setSection] = useState<HubSection>("dashboard");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingProposal, setEditingProposal] = useState<Proposal | null>(null);
  const [newProposal, setNewProposal] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isAdmin = user?.role === "admin" || user?.role === "manager" ||
    user?.role?.startsWith("tenant_") || user?.role?.startsWith("platform_");

  const { data: proposals = [], isLoading: proposalsLoading } = useQuery<Proposal[]>({
    queryKey: ["/api/contractor-proposals"],
  });

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/contractor-invoices"],
  });

  const { data: contracts = [] } = useQuery<Contract[]>({
    queryKey: ["/api/contractor-contracts"],
    queryFn: async () => {
      const r = await fetch("/api/contractor-contracts", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/contractor-proposals/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] }); toast({ title: "Deleted" }); },
    onError: (e: any) => toast({ title: e?.message || "Cannot delete", variant: "destructive" }),
  });

  const proposalActionMutation = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body?: any }) =>
      apiRequest("POST", `/api/contractor-proposals/${id}/${action}`, body || {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-invoices"] });
      toast({ title: "Done" });
    },
    onError: (e: any) => toast({ title: e?.message || "Action failed", variant: "destructive" }),
  });

  const filteredProposals = proposals.filter(p => {
    const matchSearch = !search || p.title?.toLowerCase().includes(search.toLowerCase()) || p.proposalNumber?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const filteredInvoices = invoices.filter(i => {
    const matchSearch = !search || i.title?.toLowerCase().includes(search.toLowerCase()) || i.invoiceNumber?.toLowerCase().includes(search.toLowerCase()) || i.description?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || i.status === statusFilter;
    return matchSearch && matchStatus;
  });

  function getProposalStatus(proposalId?: string) {
    if (!proposalId) return undefined;
    return proposals.find(p => p.id === proposalId)?.status;
  }

  // Badge counts for nav items
  const pendingProposals = proposals.filter(p => ["submitted", "sent", "viewed"].includes(p.status)).length;
  const overdueInvoices = invoices.filter(i => !["paid", "void"].includes(i.status) && i.dueDate && new Date(i.dueDate) < new Date()).length;
  const revisionNeeded = proposals.filter(p => p.status === "revision_requested").length;

  function handleSectionChange(s: HubSection) {
    setSection(s);
    setSearch("");
    setStatusFilter("all");
  }

  function openBuilderForNew() {
    setEditingProposal(null);
    setNewProposal(true);
    setBuilderOpen(true);
  }

  function openBuilderForEdit(p: Proposal) {
    setEditingProposal(p);
    setNewProposal(false);
    setBuilderOpen(true);
    setSelectedProposal(null);
  }

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* ── Left Sidebar ── */}
      <div className={cn(
        "flex flex-col border-r bg-muted/20 shrink-0 transition-all duration-200",
        sidebarCollapsed ? "w-14" : "w-52"
      )}>
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-3 py-3 border-b">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2 min-w-0">
              <Package className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-semibold truncate">Contractor Hub</span>
            </div>
          )}
          <Button
            size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0 ml-auto"
            onClick={() => setSidebarCollapsed(v => !v)}
            data-testid="btn-collapse-sidebar"
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>

        {/* Nav items */}
        <ScrollArea className="flex-1">
          <nav className="p-2 space-y-0.5">
            {NAV_ITEMS.map(item => {
              const badge =
                item.id === "proposals" ? (isAdmin ? pendingProposals : revisionNeeded) :
                item.id === "invoices" ? overdueInvoices :
                0;
              return (
                <button
                  key={item.id}
                  onClick={() => handleSectionChange(item.id)}
                  className={cn(
                    "w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors text-left",
                    section === item.id
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  data-testid={`nav-${item.id}`}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!sidebarCollapsed && (
                    <>
                      <span className="flex-1 truncate">{item.label}</span>
                      {badge > 0 && (
                        <span className={cn(
                          "inline-flex items-center justify-center h-4 min-w-4 rounded-full text-xs font-bold px-1",
                          section === item.id ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground"
                        )}>{badge}</span>
                      )}
                    </>
                  )}
                  {sidebarCollapsed && badge > 0 && (
                    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </nav>
        </ScrollArea>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Content Header */}
        <div className="px-6 py-4 border-b shrink-0 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-base font-semibold truncate">
              {NAV_ITEMS.find(n => n.id === section)?.label}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {section === "dashboard" && (isAdmin ? "Review and manage all contractor activity" : "Your hub overview")}
              {section === "proposals" && (isAdmin ? `${proposals.length} total · ${pendingProposals} awaiting review` : `${proposals.length} total · ${revisionNeeded} need revision`)}
              {section === "contracts" && `${contracts.length} contract${contracts.length !== 1 ? "s" : ""}`}
              {section === "invoices" && `${invoices.length} invoice${invoices.length !== 1 ? "s" : ""} · ${overdueInvoices} overdue`}
              {section === "payments" && "Payment history and remittance"}
              {section === "documents" && "Document management"}
              {section === "messages" && "Negotiation threads"}
              {section === "branding" && "Profile and proposal templates"}
              {section === "settings" && "Hub configuration"}
            </p>
          </div>

          {section === "proposals" && !isAdmin && (
            <Button onClick={openBuilderForNew} data-testid="btn-new-proposal">
              <Plus className="h-4 w-4 mr-1" /> New Proposal
            </Button>
          )}
        </div>

        {/* Content Area */}
        <ScrollArea className="flex-1">
          <div className="p-6">
            {/* Dashboard */}
            {section === "dashboard" && (
              <DashboardSection
                proposals={proposals} invoices={invoices} contracts={contracts}
                isAdmin={isAdmin} onNavigate={handleSectionChange}
              />
            )}

            {/* Proposals */}
            {section === "proposals" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search proposals..." className="h-8 max-w-xs" data-testid="input-search-proposals" />
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-8 w-40" data-testid="select-proposal-status-filter"><SelectValue placeholder="All Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      {Object.entries(PROPOSAL_STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {proposalsLoading ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : filteredProposals.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
                    <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">{proposals.length === 0 ? "No proposals yet" : "No proposals match your filter"}</p>
                    {!isAdmin && proposals.length === 0 && (
                      <Button className="mt-3" onClick={openBuilderForNew} data-testid="btn-first-proposal">
                        <Plus className="h-4 w-4 mr-1" /> Create First Proposal
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredProposals.map(proposal => (
                      <div
                        key={proposal.id}
                        className="border rounded-lg p-4 hover:bg-muted/30 transition-colors cursor-pointer group"
                        onClick={() => setSelectedProposal(proposal)}
                        data-testid={`row-proposal-${proposal.id}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm truncate">{proposal.title || "Untitled Proposal"}</p>
                              <ProposalBadge status={proposal.status} />
                              {proposal.isChangeOrder && <span className="text-xs bg-purple-100 text-purple-700 rounded px-1.5 py-0.5">Change Order</span>}
                              {(proposal.version || 1) > 1 && <span className="text-xs text-muted-foreground">v{proposal.version}</span>}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                              <span>{proposal.proposalNumber}</span>
                              <span>·</span>
                              <span>Issued {fmtDate(proposal.issueDate)}</span>
                              {proposal.expirationDate && <><span>·</span><span>Expires {fmtDate(proposal.expirationDate)}</span></>}
                              <span>·</span>
                              <span className="font-semibold text-foreground">{fmt(proposal.amount)}</span>
                            </div>
                            {proposal.description && <p className="text-xs text-muted-foreground mt-1 truncate">{proposal.description}</p>}
                          </div>
                          <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                            {isAdmin && proposal.status === "submitted" && (
                              <>
                                <Button size="sm" variant="ghost" className="h-8 px-2 text-green-600 text-xs" onClick={() => proposalActionMutation.mutate({ id: proposal.id, action: "accept" })} data-testid={`btn-accept-proposal-${proposal.id}`}>
                                  <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                                </Button>
                                <Button size="sm" variant="ghost" className="h-8 px-2 text-orange-600 text-xs" onClick={() => proposalActionMutation.mutate({ id: proposal.id, action: "request-revision" })} data-testid={`btn-revision-proposal-${proposal.id}`}>
                                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Revise
                                </Button>
                              </>
                            )}
                            {isAdmin && proposal.status === "approved" && (
                              <Button size="sm" variant="ghost" className="h-8 px-2 text-primary text-xs" onClick={() => proposalActionMutation.mutate({ id: proposal.id, action: "convert-to-invoice" })} data-testid={`btn-convert-invoice-${proposal.id}`}>
                                <FilePlus className="h-3.5 w-3.5 mr-1" /> Invoice
                              </Button>
                            )}
                            {["draft", "revision_requested"].includes(proposal.status) && (
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100" onClick={() => openBuilderForEdit(proposal)} data-testid={`btn-edit-proposal-${proposal.id}`}>
                                <Edit className="h-4 w-4" />
                              </Button>
                            )}
                            {["draft", "rejected"].includes(proposal.status) && (
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-500 opacity-0 group-hover:opacity-100" onClick={() => { if (confirm("Delete this proposal?")) deleteMutation.mutate(proposal.id); }} data-testid={`btn-delete-proposal-${proposal.id}`}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Contracts */}
            {section === "contracts" && <ContractsSection isAdmin={isAdmin} />}

            {/* Invoices */}
            {section === "invoices" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoices..." className="h-8 max-w-xs" data-testid="input-search-invoices" />
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-8 w-40" data-testid="select-invoice-status-filter"><SelectValue placeholder="All Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      {Object.entries(INVOICE_STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {invoicesLoading ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : filteredInvoices.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
                    <Receipt className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">{invoices.length === 0 ? "No invoices yet" : "No invoices match your filter"}</p>
                    <p className="text-xs mt-1">Invoices are created from approved proposals or manually</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredInvoices.map(invoice => {
                      const proposalStatus = getProposalStatus(invoice.proposalId);
                      const isBlocked = !!invoice.proposalId && !!proposalStatus && proposalStatus !== "approved";
                      const balance = parseFloat(invoice.balanceDue ?? invoice.amount ?? "0");
                      const isOverdue = !["paid", "void"].includes(invoice.status) && invoice.dueDate && new Date(invoice.dueDate) < new Date();
                      return (
                        <div key={invoice.id} className="border rounded-lg p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={() => setSelectedInvoice(invoice)} data-testid={`row-invoice-${invoice.id}`}>
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium text-sm">Invoice #{invoice.invoiceNumber || invoice.id.slice(0, 8)}</p>
                                {invoice.title && <p className="text-sm text-muted-foreground truncate">{invoice.title}</p>}
                                <InvoiceBadge status={isOverdue ? "overdue" : invoice.status} />
                                {isBlocked && (
                                  <span className="inline-flex items-center gap-1 text-xs text-orange-600 bg-orange-50 dark:bg-orange-950/20 rounded px-1.5 py-0.5">
                                    <Lock className="h-3 w-3" /> Proposal not approved
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                                <span>Due {fmtDate(invoice.dueDate)}</span>
                                <span>·</span>
                                <span className="font-semibold text-foreground">{fmt(invoice.amount)}</span>
                                {balance > 0 && balance < parseFloat(invoice.amount || "0") && (
                                  <><span>·</span><span className="text-orange-600">Balance: {fmt(balance)}</span></>
                                )}
                                {balance <= 0 && <><span>·</span><span className="text-green-600">Paid in full</span></>}
                              </div>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Payments */}
            {section === "payments" && <PaymentsSection invoices={invoices} />}

            {/* Documents */}
            {section === "documents" && <DocumentsSection />}

            {/* Messages */}
            {section === "messages" && <MessagesSection />}

            {/* Branding */}
            {section === "branding" && <BrandingSection />}

            {/* Settings */}
            {section === "settings" && <SettingsSection />}
          </div>
        </ScrollArea>
      </div>

      {/* Proposal Detail Panel */}
      {selectedProposal && (
        <ProposalDetailPanel
          proposal={selectedProposal}
          onClose={() => setSelectedProposal(null)}
          isAdmin={isAdmin}
          onEdit={() => openBuilderForEdit(selectedProposal)}
          onRefresh={() => queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] })}
        />
      )}

      {/* Proposal Builder Sheet */}
      {builderOpen && (
        <ProposalBuilder
          open={builderOpen}
          onClose={() => { setBuilderOpen(false); setEditingProposal(null); setNewProposal(false); }}
          proposal={newProposal ? null : editingProposal}
          isAdmin={isAdmin}
        />
      )}

      {/* Invoice Detail Panel */}
      {selectedInvoice && (
        <InvoiceDetailPanel
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          isAdmin={isAdmin}
          proposalStatus={getProposalStatus(selectedInvoice.proposalId)}
        />
      )}
    </div>
  );
}
