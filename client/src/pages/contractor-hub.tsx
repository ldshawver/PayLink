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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText, Plus, Send, CheckCircle, XCircle, Clock, DollarSign, AlertTriangle,
  Edit, Trash2, Eye, ChevronRight, Sparkles, Paperclip, History, RotateCcw,
  Bell, Download, Upload, ArrowLeft, Bot, Loader2, TrendingUp, Users,
  Building2, Calendar, Tag, Shield, Lock, CheckCheck, FilePlus
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

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

function ProposalBadge({ status }: { status: string }) {
  const cfg = PROPOSAL_STATUS_CONFIG[status] || { label: status, color: "text-gray-600", bg: "bg-gray-100" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.color} ${cfg.bg}`}>{cfg.label}</span>;
}

function InvoiceBadge({ status }: { status: string }) {
  const cfg = INVOICE_STATUS_CONFIG[status] || { label: status, color: "text-gray-600", bg: "bg-gray-100" };
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

function DashboardStats({ proposals, invoices, isAdmin }: { proposals: Proposal[]; invoices: Invoice[]; isAdmin: boolean }) {
  const awaitingApproval = proposals.filter(p => ["submitted", "sent", "viewed", "revision_requested"].includes(p.status));
  const approvedNotBilled = proposals.filter(p => p.status === "approved");
  const overdue = invoices.filter(i => {
    if (i.status === "paid" || i.status === "void") return false;
    if (!i.dueDate) return false;
    return new Date(i.dueDate) < new Date();
  });
  const totalUnpaid = invoices
    .filter(i => !["paid", "void"].includes(i.status))
    .reduce((s, i) => s + parseFloat(i.balanceDue ?? i.amount ?? "0"), 0);

  const stats = [
    { label: isAdmin ? "Proposals Awaiting Review" : "Proposals Awaiting Approval", value: awaitingApproval.length, icon: Clock, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/20" },
    { label: "Approved Proposals", value: approvedNotBilled.length, icon: CheckCircle, color: "text-green-600", bg: "bg-green-50 dark:bg-green-950/20" },
    { label: "Overdue Invoices", value: overdue.length, icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50 dark:bg-red-950/20" },
    { label: "Outstanding Balance", value: fmt(totalUnpaid), icon: DollarSign, color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950/20" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      {stats.map(s => (
        <Card key={s.label} className={`${s.bg} border-0`}>
          <CardContent className="p-3 flex items-center gap-3">
            <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${s.bg}`}>
              <s.icon className={`h-5 w-5 ${s.color}`} />
            </div>
            <div>
              <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground leading-tight">{s.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
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
                    placeholder="Project assumptions (access, existing conditions, client responsibilities)..." rows={4} disabled={!canEdit} data-testid="textarea-assumptions" />
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
    onError: (e: any) => toast({ title: e?.message || "Reminder failed", variant: "destructive" }),
  });

  const balance = parseFloat(invoice.balanceDue ?? invoice.amount ?? "0");
  const paid = parseFloat(invoice.amountPaid ?? "0");

  return (
    <Sheet open={true} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full max-w-2xl p-0 flex flex-col">
        <SheetHeader className="px-6 py-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle className="text-base">Invoice #{invoice.invoiceNumber || invoice.id.slice(0, 8)}</SheetTitle>
              {invoice.title && <p className="text-xs text-muted-foreground mt-0.5">{invoice.title}</p>}
              <div className="mt-1"><InvoiceBadge status={invoice.status} /></div>
            </div>
            {proposalBlocked && (
              <div className="flex items-center gap-1.5 text-orange-600 bg-orange-50 dark:bg-orange-950/20 px-3 py-1.5 rounded-lg text-xs">
                <Lock className="h-3.5 w-3.5" />
                Proposal not approved
              </div>
            )}
          </div>
        </SheetHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
          <TabsList className="shrink-0 w-full rounded-none border-b bg-transparent h-auto p-0 justify-start gap-0">
            {["summary", "payment", "linked", "reminders"].map(t => (
              <TabsTrigger key={t} value={t}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2.5 text-sm capitalize"
                data-testid={`tab-invoice-${t}`}>{t}</TabsTrigger>
            ))}
          </TabsList>

          <ScrollArea className="flex-1">
            {/* Summary */}
            <TabsContent value="summary" className="m-0 p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-muted-foreground text-xs">Invoice Date</p><p className="font-medium">{fmtDate(invoice.invoiceDate)}</p></div>
                <div><p className="text-muted-foreground text-xs">Due Date</p><p className="font-medium">{fmtDate(invoice.dueDate)}</p></div>
                <div><p className="text-muted-foreground text-xs">Invoice Type</p><p className="font-medium capitalize">{(invoice.invoiceType || "standard").replace(/_/g, " ")}</p></div>
                <div><p className="text-muted-foreground text-xs">Status</p><InvoiceBadge status={invoice.status} /></div>
              </div>
              <Separator />
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Invoice Total</span><span>{fmt(invoice.amount)}</span></div>
                {parseFloat(invoice.taxAmount || "0") > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{fmt(invoice.taxAmount)}</span></div>}
                {parseFloat(invoice.discountAmount || "0") > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>-{fmt(invoice.discountAmount)}</span></div>}
                <div className="flex justify-between text-green-600"><span>Amount Paid</span><span>{fmt(paid)}</span></div>
                <div className="flex justify-between font-semibold border-t pt-2 text-base">
                  <span>Balance Due</span>
                  <span className={balance > 0 ? "text-red-600" : "text-green-600"}>{fmt(balance)}</span>
                </div>
              </div>
              {invoice.description && <div><p className="text-muted-foreground text-xs mb-1">Description</p><p className="text-sm">{invoice.description}</p></div>}
            </TabsContent>

            {/* Payment */}
            <TabsContent value="payment" className="m-0 p-6 space-y-4">
              {proposalBlocked && isAdmin && (
                <div className="flex items-start gap-3 p-4 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 rounded-lg">
                  <Lock className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-orange-700">Payment Blocked</p>
                    <p className="text-xs text-orange-600 mt-0.5">The linked proposal must be approved before payment can be recorded. Current status: <strong>{proposalStatus}</strong>.</p>
                  </div>
                </div>
              )}

              {isAdmin && !proposalBlocked && !["paid", "void"].includes(invoice.status) && balance > 0 && (
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-sm">Record Payment</CardTitle></CardHeader>
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

            {/* Linked Proposal */}
            <TabsContent value="linked" className="m-0 p-6">
              {!invoice.proposalId ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No linked proposal</p>
                  <p className="text-xs mt-1">Invoices linked to approved proposals are protected from unauthorized payment.</p>
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
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Linked Proposal</span>
                    </div>
                    <ProposalBadge status={proposalStatus || "unknown"} />
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Reminders */}
            <TabsContent value="reminders" className="m-0 p-6 space-y-4">
              {isAdmin && !["paid", "void"].includes(invoice.status) && (
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
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ContractorHubPage() {
  const { toast } = useToast();
  const [mainTab, setMainTab] = useState("proposals");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingProposal, setEditingProposal] = useState<Proposal | null>(null);
  const [newProposal, setNewProposal] = useState(false);

  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isAdmin = user?.role === "admin" || user?.role === "manager";

  const { data: proposals = [], isLoading: proposalsLoading } = useQuery<Proposal[]>({
    queryKey: ["/api/contractor-proposals"],
  });

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/contractor-invoices"],
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

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              {isAdmin ? "Contractor Proposals & Invoices" : "My Proposals & Invoices"}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isAdmin ? "Review, approve, and pay contractor proposals and invoices" : "Build proposals, track approvals, and manage billing"}
            </p>
          </div>
          {!isAdmin && (
            <Button onClick={() => { setEditingProposal(null); setNewProposal(true); setBuilderOpen(true); }} data-testid="btn-new-proposal">
              <Plus className="h-4 w-4 mr-1" /> New Proposal
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <DashboardStats proposals={proposals} invoices={invoices} isAdmin={isAdmin} />

        {/* Tabs + Search */}
        <Tabs value={mainTab} onValueChange={v => { setMainTab(v); setStatusFilter("all"); setSearch(""); }}>
          <div className="flex items-center justify-between gap-4 mb-3">
            <TabsList>
              <TabsTrigger value="proposals" data-testid="tab-main-proposals">Proposals</TabsTrigger>
              <TabsTrigger value="invoices" data-testid="tab-main-invoices">Invoices</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${mainTab}...`} className="h-8" data-testid="input-search" />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 w-36" data-testid="select-status-filter"><SelectValue placeholder="All Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  {mainTab === "proposals"
                    ? Object.entries(PROPOSAL_STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)
                    : Object.entries(INVOICE_STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)
                  }
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Proposals List */}
          <TabsContent value="proposals" className="mt-0">
            {proposalsLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : filteredProposals.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
                <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">{proposals.length === 0 ? "No proposals yet" : "No proposals match your filter"}</p>
                {!isAdmin && proposals.length === 0 && (
                  <Button className="mt-3" onClick={() => { setEditingProposal(null); setNewProposal(true); setBuilderOpen(true); }} data-testid="btn-first-proposal">
                    <Plus className="h-4 w-4 mr-1" /> Create First Proposal
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredProposals.map(proposal => (
                  <div key={proposal.id} className="border rounded-lg p-4 hover:bg-muted/30 transition-colors group" data-testid={`row-proposal-${proposal.id}`}>
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
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => { setEditingProposal(proposal); setNewProposal(false); setBuilderOpen(true); }} data-testid={`btn-view-proposal-${proposal.id}`}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        {["draft", "revision_requested"].includes(proposal.status) && (
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => { setEditingProposal(proposal); setNewProposal(false); setBuilderOpen(true); }} data-testid={`btn-edit-proposal-${proposal.id}`}>
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                        {isAdmin && proposal.status === "submitted" && (
                          <>
                            <Button size="sm" variant="ghost" className="h-8 px-2 text-green-600" onClick={() => proposalActionMutation.mutate({ id: proposal.id, action: "accept" })} data-testid={`btn-accept-proposal-${proposal.id}`}>
                              <CheckCircle className="h-4 w-4 mr-1" /> Accept
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8 px-2 text-orange-600" onClick={() => proposalActionMutation.mutate({ id: proposal.id, action: "request-revision" })} data-testid={`btn-revision-proposal-${proposal.id}`}>
                              <RotateCcw className="h-4 w-4 mr-1" /> Revise
                            </Button>
                          </>
                        )}
                        {isAdmin && proposal.status === "approved" && (
                          <Button size="sm" variant="ghost" className="h-8 px-2 text-primary" onClick={() => proposalActionMutation.mutate({ id: proposal.id, action: "convert-to-invoice" })} data-testid={`btn-convert-invoice-${proposal.id}`}>
                            <FilePlus className="h-4 w-4 mr-1" /> Invoice
                          </Button>
                        )}
                        {["draft", "rejected"].includes(proposal.status) && (
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-500" onClick={() => { if (confirm("Delete this proposal?")) deleteMutation.mutate(proposal.id); }} data-testid={`btn-delete-proposal-${proposal.id}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Invoices List */}
          <TabsContent value="invoices" className="mt-0">
            {invoicesLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : filteredInvoices.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
                <DollarSign className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">{invoices.length === 0 ? "No invoices yet" : "No invoices match your filter"}</p>
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
          </TabsContent>
        </Tabs>
      </div>

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
