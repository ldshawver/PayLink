import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";
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
import { cn, normalizeTemplate } from "@/lib/utils";
import {
  FileText, Plus, Send, CheckCircle, XCircle, Clock, DollarSign, AlertTriangle,
  Edit, Trash2, Eye, ChevronRight, Sparkles, Paperclip, History, RotateCcw,
  Bell, Download, Upload, ArrowLeft, Bot, Loader2, TrendingUp, Users, Printer,
  Building2, Calendar, Tag, Shield, Lock, CheckCheck, FilePlus,
  LayoutDashboard, Receipt, FolderOpen, MessageSquare, Palette,
  Settings, FileSignature, CreditCard, Package, ChevronDown, ChevronUp,
  ExternalLink, Info, AlertCircle, ThumbsUp, ThumbsDown, MessageCircle,
  Briefcase, Layers, SlidersHorizontal, ArrowUpDown, Globe, Phone, Mail,
  Image, Paintbrush, CheckSquare, Search, Archive, X, Filter, BellOff,
  FileCheck, Banknote, ShieldCheck
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
  workType?: string; paymentType?: string; estimatedHours?: string; estimatedLaborBudget?: string;
  tradeOffered?: string; tradeValue?: string; tradeTerms?: string;
  templateId?: string; brandingId?: string;
  projectClass?: string; costCenter?: string; laborMaterialsSplit?: string; urgency?: string;
  siteNotes?: string; clientRequirements?: string; estimatedStartDate?: string; estimatedEndDate?: string;
  tradeCategory?: string;
}

interface ContractorBranding {
  id?: string; companyName?: string; tagline?: string; logoUrl?: string;
  accentColor?: string; contactEmail?: string; contactPhone?: string; website?: string;
}

interface ProposalVersion {
  id: string; proposalId: string; version: number; changeNotes?: string;
  snapshotJson: any; createdAt: string; createdByUserId?: string;
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

interface Negotiation {
  id: string; proposalId: string; direction: "company_to_contractor" | "contractor_to_company";
  status: "pending" | "accepted" | "rejected";
  proposedAmount?: string; proposedHours?: string; proposedTerms?: string; proposedTradeTerms?: string;
  counterNotes?: string; responseNotes?: string; respondedAt?: string; createdAt: string;
  initiatedByUserId?: string; initiatedByWorkerId?: string;
}

interface Signer {
  id: string;
  contractId: string;
  name: string;
  email?: string;
  role?: string;
  signerType?: string;
  workerId?: string;
  userId?: string;
  order?: number;
  status: "pending" | "signed" | "declined";
  signedAt?: string;
  signatureData?: string;
  createdAt?: string;
}

interface Contract {
  id: string;
  contractNumber?: string;
  title?: string;
  status: string;
  contractType?: string;
  contractorId: string;
  contractorName?: string;
  companyId?: string;
  proposalId?: string;
  startDate?: string;
  endDate?: string;
  totalValue?: string;
  value?: string;
  currency?: string;
  paymentType?: string;
  paymentTerms?: string;
  scopeOfWork?: string;
  description?: string;
  specialTerms?: string;
  bodyMarkdown?: string;
  tradeDetails?: string;
  tradeValue?: string;
  sentAt?: string;
  fullySignedAt?: string;
  voidedAt?: string;
  voidReason?: string;
  createdAt: string;
  updatedAt?: string;
  signers?: Signer[];
}

interface ContractorNotification {
  id: string;
  workerId?: string | null;
  userId?: string | null;
  companyId?: string | null;
  notificationType: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  isRead: boolean;
  readAt?: string | null;
  actionUrl?: string | null;
  createdAt: string;
}

interface ContractorReminder {
  id: string;
  workerId?: string | null;
  userId?: string | null;
  companyId?: string | null;
  entityType: string;
  entityId?: string | null;
  reminderType: string;
  title: string;
  notes?: string | null;
  scheduledAt: string;
  channel: string;
  status: string;
  sentAt?: string | null;
  dismissedAt?: string | null;
  createdAt: string;
}

// ─── Notification Helpers ─────────────────────────────────────────────────────

function getNotificationIcon(type: string) {
  if (type.startsWith("proposal")) return FileText;
  if (type.startsWith("contract")) return FileSignature;
  if (type.startsWith("invoice")) return Receipt;
  if (type.startsWith("payment")) return Banknote;
  if (type === "reminder") return Clock;
  return Bell;
}

function getNotificationColor(type: string): string {
  if (type === "proposal_approved" || type === "contract_signed" || type === "invoice_paid" || type === "payment_received") return "text-green-600";
  if (type === "proposal_rejected" || type === "invoice_rejected") return "text-red-600";
  if (type === "proposal_revision_requested" || type === "proposal_countered") return "text-amber-600";
  if (type === "proposal_submitted" || type === "invoice_submitted" || type === "contract_sent") return "text-blue-600";
  return "text-muted-foreground";
}

function fmtRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return fmtDate(dateStr);
}

// ─── Notification Bell ────────────────────────────────────────────────────────

function NotificationBell({ onNavigate }: { onNavigate: (section: HubSection, entityId?: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: notifications = [], refetch } = useQuery<ContractorNotification[]>({
    queryKey: ["/api/contractor-notifications"],
    select: (data: any) => snakeToCamel(data) as ContractorNotification[],
    refetchInterval: 30000,
  });

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/contractor-notifications/${id}/read`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/contractor-notifications"] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/contractor-notifications/mark-all-read", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/contractor-notifications"] }),
  });

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const recent = notifications.slice(0, 12);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
        data-testid="btn-notification-bell"
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-0.5" data-testid="notification-unread-count">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-background border rounded-lg shadow-lg z-50" data-testid="notification-dropdown">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-sm font-semibold">Notifications</span>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllReadMutation.mutate()}
                  disabled={markAllReadMutation.isPending}
                  className="text-xs text-primary hover:underline disabled:opacity-50"
                  data-testid="btn-mark-all-read"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={() => { setOpen(false); onNavigate("messages"); }}
                className="text-xs text-muted-foreground hover:text-foreground ml-2"
                data-testid="btn-view-all-notifications"
              >
                View all
              </button>
            </div>
          </div>

          <ScrollArea className="max-h-96">
            {recent.length === 0 ? (
              <div className="py-8 text-center">
                <BellOff className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No notifications yet</p>
              </div>
            ) : (
              <div>
                {recent.map(n => {
                  const Icon = getNotificationIcon(n.notificationType);
                  const color = getNotificationColor(n.notificationType);
                  return (
                    <div
                      key={n.id}
                      className={cn(
                        "flex items-start gap-2.5 px-3 py-2.5 hover:bg-muted/40 cursor-pointer border-b last:border-b-0 transition-colors",
                        !n.isRead && "bg-primary/5"
                      )}
                      onClick={() => {
                        if (!n.isRead) markReadMutation.mutate(n.id);
                        if (n.actionUrl) {
                          const url = new URL(n.actionUrl, window.location.href);
                          const section = url.searchParams.get("section") as HubSection | null;
                          const entityId = url.searchParams.get("id") || n.entityId || undefined;
                          if (section) onNavigate(section, entityId);
                        }
                        setOpen(false);
                      }}
                      data-testid={`notification-item-${n.id}`}
                    >
                      <div className={cn("mt-0.5 h-6 w-6 shrink-0 rounded-full flex items-center justify-center", color.replace("text-", "bg-").replace("600", "100").replace("muted-foreground", "muted"))}>
                        <Icon className={cn("h-3.5 w-3.5", color)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-xs font-medium leading-tight", !n.isRead && "font-semibold")}>{n.title}</p>
                        {n.body && <p className="text-xs text-muted-foreground mt-0.5 truncate">{n.body}</p>}
                        <p className="text-[10px] text-muted-foreground mt-0.5">{fmtRelativeTime(n.createdAt)}</p>
                      </div>
                      {!n.isRead && <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

// ─── Status Helpers ───────────────────────────────────────────────────────────

const PROPOSAL_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:                 { label: "Draft",                color: "text-gray-600",   bg: "bg-gray-100 dark:bg-gray-800" },
  internal_review:       { label: "Internal Review",      color: "text-blue-600",   bg: "bg-blue-50 dark:bg-blue-950/30" },
  sent:                  { label: "Sent",                 color: "text-indigo-600", bg: "bg-indigo-50 dark:bg-indigo-950/30" },
  viewed:                { label: "Viewed",               color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-950/30" },
  revision_requested:    { label: "Revision Needed",      color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950/30" },
  submitted:             { label: "Under Review",          color: "text-blue-600",   bg: "bg-blue-50 dark:bg-blue-950/30" },
  countered:             { label: "Countered",            color: "text-amber-600",  bg: "bg-amber-50 dark:bg-amber-950/30" },
  negotiated:            { label: "Negotiated",           color: "text-teal-600",   bg: "bg-teal-50 dark:bg-teal-950/30" },
  approved:              { label: "Approved",             color: "text-green-600",  bg: "bg-green-50 dark:bg-green-950/30" },
  converted_to_contract: { label: "Converted to Contract",color: "text-emerald-700",bg: "bg-emerald-50 dark:bg-emerald-950/30" },
  declined:              { label: "Declined",             color: "text-red-600",    bg: "bg-red-50 dark:bg-red-950/30" },
  rejected:              { label: "Rejected",             color: "text-red-600",    bg: "bg-red-50 dark:bg-red-950/30" },
  expired:               { label: "Expired",              color: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-950/30" },
  superseded:            { label: "Superseded",           color: "text-gray-500",   bg: "bg-gray-50 dark:bg-gray-900/30" },
};

const INVOICE_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:            { label: "Draft",           color: "text-gray-600",   bg: "bg-gray-100 dark:bg-gray-800" },
  pending_approval: { label: "Pending Approval",color: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-950/30" },
  submitted:        { label: "Submitted",       color: "text-blue-600",   bg: "bg-blue-50 dark:bg-blue-950/30" },
  under_review:     { label: "Under Review",    color: "text-indigo-600", bg: "bg-indigo-50 dark:bg-indigo-950/30" },
  needs_correction: { label: "Needs Correction",color: "text-orange-700", bg: "bg-orange-50 dark:bg-orange-950/30" },
  approved:         { label: "Approved",        color: "text-teal-700",   bg: "bg-teal-50 dark:bg-teal-950/30" },
  rejected:         { label: "Rejected",        color: "text-red-700",    bg: "bg-red-50 dark:bg-red-950/30" },
  sent:             { label: "Sent",            color: "text-indigo-600", bg: "bg-indigo-50 dark:bg-indigo-950/30" },
  viewed:           { label: "Viewed",          color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-950/30" },
  disputed:         { label: "Disputed",        color: "text-rose-700",   bg: "bg-rose-50 dark:bg-rose-950/30" },
  partially_paid:   { label: "Partial",         color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950/30" },
  paid:             { label: "Paid",            color: "text-green-600",  bg: "bg-green-50 dark:bg-green-950/30" },
  overdue:          { label: "Overdue",         color: "text-red-600",    bg: "bg-red-50 dark:bg-red-950/30" },
  closed:           { label: "Closed",          color: "text-gray-500",   bg: "bg-gray-50 dark:bg-gray-900/30" },
  void:             { label: "Void",            color: "text-gray-400",   bg: "bg-gray-50 dark:bg-gray-900/30" },
  cancelled:        { label: "Cancelled",       color: "text-gray-400",   bg: "bg-gray-50 dark:bg-gray-900/30" },
};

const CONTRACT_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:            { label: "Draft",            color: "text-gray-600",   bg: "bg-gray-100 dark:bg-gray-800" },
  pending:          { label: "Pending",          color: "text-blue-600",   bg: "bg-blue-50 dark:bg-blue-950/30" },
  sent:             { label: "Sent",             color: "text-indigo-600", bg: "bg-indigo-50 dark:bg-indigo-950/30" },
  partially_signed: { label: "Partially Signed", color: "text-amber-700",  bg: "bg-amber-50 dark:bg-amber-950/30" },
  fully_signed:     { label: "Fully Signed",     color: "text-teal-700",   bg: "bg-teal-50 dark:bg-teal-950/30" },
  active:           { label: "Active",           color: "text-green-600",  bg: "bg-green-50 dark:bg-green-950/30" },
  expiring_soon:    { label: "Expiring Soon",    color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950/30" },
  renegotiation:    { label: "Renegotiation",    color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950/30" },
  completed:        { label: "Completed",        color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-950/30" },
  cancelled:        { label: "Cancelled",        color: "text-red-600",    bg: "bg-red-50 dark:bg-red-950/30" },
  expired:          { label: "Expired",          color: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-950/30" },
  superseded:       { label: "Superseded",       color: "text-gray-500",   bg: "bg-gray-50 dark:bg-gray-900/30" },
  terminated:       { label: "Terminated",       color: "text-red-700",    bg: "bg-red-50 dark:bg-red-950/30" },
  void:             { label: "Void",             color: "text-gray-400",   bg: "bg-gray-50 dark:bg-gray-900/30" },
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

function snakeToCamel(obj: any): any {
  if (Array.isArray(obj)) return obj.map(snakeToCamel);
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase()),
        v
      ])
    );
  }
  return obj;
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
  const { data: reminders = [] } = useQuery<ContractorReminder[]>({
    queryKey: ["/api/contractor-reminders", "pending"],
    queryFn: async () => {
      const r = await fetch("/api/contractor-reminders?status=pending", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    select: (data: any) => snakeToCamel(data) as ContractorReminder[],
  });
  const dismissReminderMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/contractor-reminders/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/contractor-reminders"] }),
  });
  const activeReminders = reminders.filter(r => r.status === "pending");

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

      {/* Needs Attention — reminders + action items */}
      {(activeReminders.length > 0 || revisionNeeded.length > 0 || awaitingApproval.length > 0) && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <p className="text-sm font-semibold text-amber-700">Needs Attention</p>
              {activeReminders.length > 0 && (
                <span className="ml-auto text-xs text-amber-600 font-medium">{activeReminders.length} reminder{activeReminders.length !== 1 ? "s" : ""}</span>
              )}
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
              {activeReminders.slice(0, 5).map(r => (
                <div key={r.id} className="flex items-center justify-between gap-2 py-1 border-t border-amber-200 first:border-t-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-amber-800 font-medium truncate">{r.title}</p>
                      {r.notes && <p className="text-xs text-amber-600 truncate">{r.notes}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {r.entityType === "contract" && (
                      <Button size="sm" variant="ghost" className="h-6 text-xs text-amber-700 px-1.5" onClick={() => onNavigate("contracts", r.entityId || undefined)} data-testid={`btn-reminder-view-${r.id}`}>View</Button>
                    )}
                    {r.entityType === "invoice" && (
                      <Button size="sm" variant="ghost" className="h-6 text-xs text-amber-700 px-1.5" onClick={() => onNavigate("invoices", r.entityId || undefined)} data-testid={`btn-reminder-view-${r.id}`}>View</Button>
                    )}
                    {r.entityType === "proposal" && (
                      <Button size="sm" variant="ghost" className="h-6 text-xs text-amber-700 px-1.5" onClick={() => onNavigate("proposals", r.entityId || undefined)} data-testid={`btn-reminder-view-${r.id}`}>View</Button>
                    )}
                    <button
                      onClick={() => dismissReminderMutation.mutate(r.id)}
                      className="h-5 w-5 flex items-center justify-center text-amber-500 hover:text-amber-700"
                      title="Dismiss"
                      data-testid={`btn-dismiss-reminder-${r.id}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
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

// ─── Convert to Contract Dialog ───────────────────────────────────────────────

function ConvertToContractDialog({
  open, onClose, proposal, onSuccess
}: { open: boolean; onClose: () => void; proposal: Proposal; onSuccess: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(proposal.title || "Service Contract");
  const [scopeOfWork, setScopeOfWork] = useState(proposal.scopeOfWork || "");
  const [paymentTerms, setPaymentTerms] = useState(proposal.paymentTerms || "");
  const [totalValue, setTotalValue] = useState(proposal.amount || "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [contractType, setContractType] = useState("service");
  const [specialTerms, setSpecialTerms] = useState("");

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/contractor-proposals/${proposal.id}/convert-to-contract`, {
      title, scopeOfWork, paymentTerms,
      totalValue: totalValue || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      contractType, specialTerms: specialTerms || undefined,
    }),
    onSuccess: () => onSuccess(),
    onError: (e: any) => toast({ title: e?.message || "Failed to convert", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg" data-testid="dialog-convert-to-contract">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-emerald-600" /> Convert to Contract
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg text-sm text-emerald-700 dark:text-emerald-400">
            Review and adjust the contract details below. The approved proposal values are pre-filled.
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ctc-title">Contract Title</Label>
            <Input id="ctc-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Service Contract" data-testid="input-ctc-title" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ctc-type">Contract Type</Label>
              <Select value={contractType} onValueChange={setContractType}>
                <SelectTrigger id="ctc-type" data-testid="select-ctc-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="service">Service</SelectItem>
                  <SelectItem value="project">Project</SelectItem>
                  <SelectItem value="retainer">Retainer</SelectItem>
                  <SelectItem value="milestone">Milestone</SelectItem>
                  <SelectItem value="trade">Trade/Non-Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ctc-value">Total Value ($)</Label>
              <Input id="ctc-value" type="number" value={totalValue} onChange={e => setTotalValue(e.target.value)} placeholder="0.00" data-testid="input-ctc-value" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ctc-start">Start Date</Label>
              <Input id="ctc-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} data-testid="input-ctc-start-date" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ctc-end">End Date</Label>
              <Input id="ctc-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} data-testid="input-ctc-end-date" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ctc-scope">Scope of Work</Label>
            <Textarea id="ctc-scope" value={scopeOfWork} onChange={e => setScopeOfWork(e.target.value)} rows={3} placeholder="Describe the scope of work..." data-testid="textarea-ctc-scope" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ctc-terms">Payment Terms</Label>
            <Input id="ctc-terms" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} placeholder="e.g. Net 30" data-testid="input-ctc-payment-terms" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ctc-special">Special Terms / Notes</Label>
            <Textarea id="ctc-special" value={specialTerms} onChange={e => setSpecialTerms(e.target.value)} rows={2} placeholder="Any special clauses or conditions..." data-testid="textarea-ctc-special-terms" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => mutation.mutate()} disabled={mutation.isPending || !title.trim()} data-testid="btn-confirm-convert-to-contract">
            {mutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileSignature className="h-4 w-4 mr-1" />}
            Create Contract (Draft)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [counterHours, setCounterHours] = useState("");
  const [counterTerms, setCounterTerms] = useState("");
  const [counterTradeTerms, setCounterTradeTerms] = useState("");
  const [counterNotes, setCounterNotes] = useState("");
  const [commentText, setCommentText] = useState("");
  const [convertToContractOpen, setConvertToContractOpen] = useState(false);

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

  const { data: versions = [] } = useQuery<ProposalVersion[]>({
    queryKey: ["/api/contractor-proposals", proposal.id, "versions"],
    queryFn: async () => {
      const r = await fetch(`/api/contractor-proposals/${proposal.id}/versions`, { credentials: "include" });
      if (!r.ok) return [];
      const rows: any[] = await r.json();
      return rows.map(row => ({
        id: row.id,
        proposalId: row.proposal_id,
        version: row.version,
        changeNotes: row.change_notes,
        createdAt: row.created_at,
        createdByUserId: row.created_by_user_id,
        snapshotJson: (() => {
          try {
            const parsed = typeof row.snapshot_json === "string" ? JSON.parse(row.snapshot_json) : row.snapshot_json;
            return parsed?.proposal ?? parsed ?? {};
          } catch { return {}; }
        })(),
      }));
    },
  });

  const { data: negotiations = [] } = useQuery<Negotiation[]>({
    queryKey: ["/api/contractor-proposals", proposal.id, "negotiations"],
    queryFn: async () => {
      const r = await fetch(`/api/contractor-proposals/${proposal.id}/negotiations`, { credentials: "include" });
      if (!r.ok) return [];
      const rows: Record<string, unknown>[] = await r.json();
      return rows.map(row => ({
        id: row.id as string,
        proposalId: row.proposal_id as string,
        direction: row.direction as Negotiation["direction"],
        status: row.status as Negotiation["status"],
        proposedAmount: row.proposed_amount as string | undefined,
        proposedHours: row.proposed_hours as string | undefined,
        proposedTerms: row.proposed_terms as string | undefined,
        proposedTradeTerms: row.proposed_trade_terms as string | undefined,
        counterNotes: row.counter_notes as string | undefined,
        responseNotes: row.response_notes as string | undefined,
        respondedAt: row.responded_at as string | undefined,
        createdAt: row.created_at as string,
        initiatedByUserId: row.initiated_by_user_id as string | undefined,
        initiatedByWorkerId: row.initiated_by_worker_id as string | undefined,
      }));
    },
  });

  const [selectedVersion, setSelectedVersion] = useState<ProposalVersion | null>(null);

  const latestCounter = negotiations.filter(n => n.status === "pending" && n.direction === "company_to_contractor").slice(-1)[0];

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
  const canAdminAction = isAdmin && ["submitted", "sent", "viewed", "countered"].includes(proposal.status);
  const canNegotiate = isAdmin && proposal.status === "countered";
  const canMarkNegotiated = isAdmin && ["countered", "negotiated"].includes(proposal.status);
  const canConvertToContract = isAdmin && ["approved", "negotiated"].includes(proposal.status);
  const canRevise = !isAdmin && ["draft", "revision_requested"].includes(proposal.status);
  const canCreateRevision = isAdmin && ["approved", "sent", "viewed"].includes(proposal.status);

  return (
    <Sheet open onOpenChange={() => onClose()}>
      <SheetContent side="right" className="w-screen sm:w-full sm:max-w-3xl p-0 flex flex-col overflow-hidden">
        <SheetHeader className="px-5 pt-4 pb-0 border-b shrink-0">
          {/* Row 1: title + meta */}
          <div className="flex items-start gap-3 pb-2">
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-base leading-tight">{proposal.title || "Proposal Detail"}</SheetTitle>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-xs text-muted-foreground">{proposal.proposalNumber}</span>
                <ProposalBadge status={proposal.status} />
                {proposal.isChangeOrder && <span className="text-xs bg-purple-100 text-purple-700 rounded px-1.5 py-0.5">Change Order</span>}
                {(proposal.version || 1) > 1 && <span className="text-xs text-muted-foreground">v{proposal.version}</span>}
              </div>
            </div>
          </div>
          {/* Row 2: action buttons — horizontally scrollable so nothing gets clipped */}
          {(canEdit || canSubmit || canAdminAction || canMarkNegotiated || canConvertToContract || (proposal.status === "approved" && isAdmin) || canCreateRevision) && (
            <div className="flex items-center gap-2 overflow-x-auto pb-3 pt-1 scrollbar-none" style={{ scrollbarWidth: "none" }}>
              {canEdit && (
                <Button size="sm" variant="outline" className="shrink-0" onClick={onEdit} data-testid="btn-edit-from-detail">
                  <Edit className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
              )}
              {canSubmit && (
                <Button size="sm" className="shrink-0" onClick={() => actionMutation.mutate({ action: "submit" })} disabled={actionMutation.isPending} data-testid="btn-submit-from-detail">
                  <Send className="h-3.5 w-3.5 mr-1" /> Submit
                </Button>
              )}
              {canAdminAction && (
                <>
                  <Button size="sm" className="shrink-0 bg-green-600 hover:bg-green-700 text-white" onClick={() => actionMutation.mutate({ action: "accept" })} disabled={actionMutation.isPending} data-testid="btn-approve-proposal">
                    <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" className="shrink-0 border-orange-300 text-orange-700" onClick={() => setRevisionOpen(true)} data-testid="btn-request-revision">
                    <RotateCcw className="h-3.5 w-3.5 mr-1" /> Request Revision
                  </Button>
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => setCounterOpen(true)} data-testid="btn-counter-offer">
                    <MessageCircle className="h-3.5 w-3.5 mr-1" /> Counter
                  </Button>
                  <Button size="sm" variant="destructive" className="shrink-0" onClick={() => setRejectOpen(true)} data-testid="btn-reject-proposal">
                    <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                  </Button>
                </>
              )}
              {canMarkNegotiated && (
                <Button size="sm" variant="outline" className="shrink-0 border-teal-300 text-teal-700" onClick={() => actionMutation.mutate({ action: "mark-negotiated" })} disabled={actionMutation.isPending} data-testid="btn-mark-negotiated">
                  <CheckCheck className="h-3.5 w-3.5 mr-1" /> Mark Negotiated
                </Button>
              )}
              {canConvertToContract && (
                <Button size="sm" className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setConvertToContractOpen(true)} data-testid="btn-convert-to-contract">
                  <FileSignature className="h-3.5 w-3.5 mr-1" /> Convert to Contract
                </Button>
              )}
              {proposal.status === "approved" && isAdmin && (
                <Button size="sm" variant="outline" className="shrink-0" onClick={() => actionMutation.mutate({ action: "convert-to-invoice" })} disabled={actionMutation.isPending} data-testid="btn-convert-invoice">
                  <FilePlus className="h-3.5 w-3.5 mr-1" /> Create Invoice
                </Button>
              )}
              {canCreateRevision && (
                <Button size="sm" variant="outline" className="shrink-0" onClick={() => revisionMutation.mutate()} disabled={revisionMutation.isPending} data-testid="btn-create-revision-from-detail">
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> New Revision
                </Button>
              )}
            </div>
          )}
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

              {latestCounter && (
                <div className="border-2 border-blue-400 rounded-lg p-4 bg-blue-50 dark:bg-blue-950/20">
                  <div className="flex items-center gap-2 mb-3">
                    <ArrowUpDown className="h-5 w-5 text-blue-600" />
                    <p className="font-semibold text-blue-700">Counter Offer Received</p>
                    <span className="text-xs text-blue-500 ml-auto">{fmtDate(latestCounter.createdAt)}</span>
                  </div>
                  {/* Field-by-field comparison table */}
                  <div className="space-y-2 mb-3">
                    {(proposal.amount || latestCounter.proposedAmount) && (
                      <div className="grid grid-cols-3 gap-2 text-xs items-center border-b border-blue-200 pb-1">
                        <span className="text-muted-foreground font-medium">Budget</span>
                        <span className="text-foreground">{proposal.amount ? fmt(proposal.amount) : "—"}</span>
                        <span className={`font-bold ${latestCounter.proposedAmount && proposal.amount && parseFloat(latestCounter.proposedAmount) < parseFloat(proposal.amount) ? "text-red-600" : "text-blue-700"}`}>
                          {latestCounter.proposedAmount ? fmt(latestCounter.proposedAmount) : "unchanged"}
                          {latestCounter.proposedAmount && proposal.amount && (
                            <span className="ml-1 font-normal opacity-70">
                              ({parseFloat(latestCounter.proposedAmount) < parseFloat(proposal.amount) ? "▼" : "▲"} {fmt(Math.abs(parseFloat(latestCounter.proposedAmount) - parseFloat(proposal.amount)))})
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                    {(proposal.estimatedHours || latestCounter.proposedHours) && (
                      <div className="grid grid-cols-3 gap-2 text-xs items-center border-b border-blue-200 pb-1">
                        <span className="text-muted-foreground font-medium">Hours</span>
                        <span className="text-foreground">{proposal.estimatedHours ? `${proposal.estimatedHours}h` : "—"}</span>
                        <span className="font-bold text-blue-700">{latestCounter.proposedHours ? `${latestCounter.proposedHours}h` : "unchanged"}</span>
                      </div>
                    )}
                    {(proposal.paymentTerms || latestCounter.proposedTerms) && (
                      <div className="grid grid-cols-3 gap-2 text-xs items-center border-b border-blue-200 pb-1">
                        <span className="text-muted-foreground font-medium">Payment Terms</span>
                        <span className="text-foreground truncate">{proposal.paymentTerms || "—"}</span>
                        <span className="font-bold text-blue-700 truncate">{latestCounter.proposedTerms || "unchanged"}</span>
                      </div>
                    )}
                    {(proposal.tradeTerms || latestCounter.proposedTradeTerms) && (
                      <div className="grid grid-cols-3 gap-2 text-xs items-center">
                        <span className="text-muted-foreground font-medium">Trade Terms</span>
                        <span className="text-foreground truncate">{proposal.tradeTerms || "—"}</span>
                        <span className="font-bold text-blue-700 truncate">{latestCounter.proposedTradeTerms || "unchanged"}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-3 text-xs text-muted-foreground pt-1">
                      <span />
                      <span className="italic">Original</span>
                      <span className="italic font-medium text-blue-600">Counter</span>
                    </div>
                  </div>
                  {latestCounter.counterNotes && (
                    <p className="text-sm text-blue-700 italic mb-3 border-t border-blue-200 pt-2">"{latestCounter.counterNotes}"</p>
                  )}
                  {!isAdmin && (
                    <div className="flex gap-2">
                      <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white"
                        onClick={async () => {
                          await apiRequest("PATCH", `/api/contractor-proposals/${proposal.id}/negotiations/${latestCounter.id}`, { status: "accepted" });
                          queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals", proposal.id, "negotiations"] });
                          queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] });
                          toast({ title: "Counter offer accepted" });
                          onRefresh();
                        }}
                        disabled={actionMutation.isPending}
                        data-testid="btn-accept-counter">
                        <CheckCircle className="h-3.5 w-3.5 mr-1" /> Accept Counter
                      </Button>
                      <Button size="sm" variant="outline" onClick={onEdit}
                        data-testid="btn-resubmit-revised">
                        <Edit className="h-3.5 w-3.5 mr-1" /> Submit Revised Proposal
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {proposal.internalNotes && (
                <div className="bg-yellow-50 dark:bg-yellow-950/20 rounded-lg p-3 border border-yellow-200">
                  <p className="text-xs font-medium text-yellow-700 mb-1">Internal Notes</p>
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">{proposal.internalNotes}</p>
                </div>
              )}

              {(proposal.workType || proposal.paymentType || proposal.estimatedHours) && (
                <div className="rounded-lg border p-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Work Details</p>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    {proposal.workType && (
                      <div>
                        <p className="text-xs text-muted-foreground">Type</p>
                        <p className="font-medium capitalize">{proposal.workType.replace(/_/g, " ")}</p>
                      </div>
                    )}
                    {proposal.paymentType && (
                      <div>
                        <p className="text-xs text-muted-foreground">Structure</p>
                        <p className="font-medium capitalize">{proposal.paymentType.replace(/_/g, " ")}</p>
                      </div>
                    )}
                    {proposal.estimatedHours && (
                      <div>
                        <p className="text-xs text-muted-foreground">Est. Hours</p>
                        <p className="font-medium">{proposal.estimatedHours}h</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {(proposal.projectClass || proposal.costCenter || proposal.urgency || proposal.laborMaterialsSplit) && (
                <div className="rounded-lg border p-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Project Intake</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {proposal.costCenter && (
                      <div>
                        <p className="text-xs text-muted-foreground">Cost Center</p>
                        <p className="font-medium">{proposal.costCenter}</p>
                      </div>
                    )}
                    {proposal.projectClass && (
                      <div>
                        <p className="text-xs text-muted-foreground">Project Type</p>
                        <p className="font-medium capitalize">{String(proposal.projectClass).replace(/_/g, " ")}</p>
                      </div>
                    )}
                    {proposal.urgency && (
                      <div>
                        <p className="text-xs text-muted-foreground">Urgency</p>
                        <p className="font-medium capitalize">{proposal.urgency}</p>
                      </div>
                    )}
                    {proposal.laborMaterialsSplit && (
                      <div>
                        <p className="text-xs text-muted-foreground">Labor/Materials</p>
                        <p className="font-medium capitalize">{String(proposal.laborMaterialsSplit).replace(/_/g, " ")}</p>
                      </div>
                    )}
                  </div>
                  {proposal.siteNotes && (
                    <div>
                      <p className="text-xs text-muted-foreground">Site Notes</p>
                      <p className="text-sm">{proposal.siteNotes}</p>
                    </div>
                  )}
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
            <TabsContent value="history" className="m-0 p-6 space-y-6">
              {versions.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-primary" /> Version Snapshots
                  </h3>
                  <div className="space-y-2">
                    {versions.map((v) => (
                      <div key={v.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                          v{v.version}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">Version {v.version}</p>
                          <p className="text-xs text-muted-foreground">{fmtDate(v.createdAt)}</p>
                          {v.changeNotes && <p className="text-xs text-muted-foreground italic truncate">"{v.changeNotes}"</p>}
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setSelectedVersion(v)} data-testid={`btn-view-version-${v.version}`}>
                          <Eye className="h-3.5 w-3.5 mr-1" /> View
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Separator className="mt-4" />
                </div>
              )}
              <div>
                {versions.length > 0 && <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><History className="h-4 w-4 text-primary" /> Activity Log</h3>}
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
              </div>
            </TabsContent>

            {/* Negotiation Thread */}
            <TabsContent value="thread" className="m-0 p-6 space-y-4">
              <div className="space-y-3">
                {(() => {
                  type ThreadItem = { id: string; ts: string; kind: "event" | "negotiation"; data: ProposalEvent | Negotiation };
                  const items: ThreadItem[] = [
                    ...events.filter(e => e.notes).map(e => ({ id: `evt-${e.id}`, ts: e.createdAt, kind: "event" as const, data: e })),
                    ...negotiations.map(n => ({ id: `neg-${n.id}`, ts: n.createdAt, kind: "negotiation" as const, data: n })),
                  ].sort((a, b) => {
                    const diff = new Date(a.ts).getTime() - new Date(b.ts).getTime();
                    if (diff !== 0) return diff;
                    if (a.kind !== b.kind) return a.kind === "event" ? -1 : 1;
                    return a.id.localeCompare(b.id);
                  });

                  if (items.length === 0) return (
                    <div className="text-center py-6 text-muted-foreground">
                      <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No messages yet</p>
                      <p className="text-xs">Notes from actions and counter-offers will appear here</p>
                    </div>
                  );

                  return items.map(item => {
                    if (item.kind === "event") {
                      const ev = item.data as ProposalEvent;
                      return (
                        <div key={item.id} className={cn(
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
                      );
                    } else {
                      const neg = item.data as Negotiation;
                      const fromLabel = neg.direction === "company_to_contractor" ? "Company → Contractor" : "Contractor → Company";
                      const statusColor = neg.status === "accepted" ? "bg-green-50 border-green-200 dark:bg-green-950/20" : neg.status === "rejected" ? "bg-red-50 border-red-200 dark:bg-red-950/20" : "bg-blue-50 border-blue-200 dark:bg-blue-950/20";
                      return (
                        <div key={item.id} className={cn("rounded-lg p-3 text-sm border", statusColor)}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">Counter Offer · {fromLabel}</span>
                            <span className="text-xs text-muted-foreground">{fmtDate(neg.createdAt)} · {neg.status}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
                            {neg.proposedAmount && <><span className="text-muted-foreground">Budget:</span><span className="font-medium">{fmt(neg.proposedAmount)}</span></>}
                            {neg.proposedHours && <><span className="text-muted-foreground">Hours:</span><span className="font-medium">{neg.proposedHours} hrs</span></>}
                            {neg.proposedTerms && <><span className="text-muted-foreground">Terms:</span><span className="font-medium">{neg.proposedTerms}</span></>}
                            {neg.proposedTradeTerms && <><span className="text-muted-foreground">Trade:</span><span className="font-medium">{neg.proposedTradeTerms}</span></>}
                          </div>
                          {neg.counterNotes && <p className="italic text-muted-foreground">"{neg.counterNotes}"</p>}
                          {neg.responseNotes && (
                            <div className="mt-2 pt-2 border-t border-current/10">
                              <span className="text-xs text-muted-foreground">Response: </span>
                              <span className="text-xs italic">"{neg.responseNotes}"</span>
                              {neg.respondedAt && <span className="text-xs text-muted-foreground ml-2">· {fmtDate(neg.respondedAt)}</span>}
                            </div>
                          )}
                        </div>
                      );
                    }
                  });
                })()}
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
                    <Button size="sm" variant="outline" onClick={() => actionMutation.mutate({ action: "request-revision", body: { revisionNotes: commentText } })} disabled={actionMutation.isPending || !commentText} data-testid="btn-thread-request-revision">
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
            <Button variant="destructive" onClick={() => actionMutation.mutate({ action: "reject", body: { rejectionReason: rejectReason } })} disabled={actionMutation.isPending} data-testid="btn-confirm-reject">
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
            <Button variant="outline" className="border-orange-300 text-orange-700" onClick={() => actionMutation.mutate({ action: "request-revision", body: { revisionNotes: revisionNotes } })} disabled={actionMutation.isPending} data-testid="btn-confirm-revision">
              {actionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Request Revision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Counter Offer Dialog */}
      <Dialog open={counterOpen} onOpenChange={setCounterOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Send Counter Offer</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="bg-muted/40 rounded p-3 border text-xs">
              <p className="font-medium mb-1 text-muted-foreground">Original proposal values</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {proposal.amount && <span>Budget: <strong>{fmt(proposal.amount)}</strong></span>}
                {proposal.estimatedHours && <span>Hours: <strong>{proposal.estimatedHours}h</strong></span>}
                {proposal.paymentTerms && <span className="col-span-2">Terms: {proposal.paymentTerms}</span>}
                {proposal.tradeTerms && <span className="col-span-2">Trade terms: {proposal.tradeTerms}</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Counter Budget ($)</Label>
                <Input type="number" value={counterAmount} onChange={e => setCounterAmount(e.target.value)} placeholder={proposal.amount || "0.00"} min="0" step="0.01" data-testid="input-counter-amount" />
              </div>
              <div>
                <Label className="text-xs">Counter Hours</Label>
                <Input type="number" value={counterHours} onChange={e => setCounterHours(e.target.value)} placeholder={proposal.estimatedHours || "e.g. 40"} min="0" step="0.5" data-testid="input-counter-hours" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Counter Payment Terms</Label>
              <Input value={counterTerms} onChange={e => setCounterTerms(e.target.value)} placeholder={proposal.paymentTerms || "e.g. Net-30, 50% upfront"} data-testid="input-counter-terms" />
            </div>
            {proposal.tradeTerms && (
              <div>
                <Label className="text-xs">Counter Trade Terms</Label>
                <Input value={counterTradeTerms} onChange={e => setCounterTradeTerms(e.target.value)} placeholder={proposal.tradeTerms || "e.g. materials at cost"} data-testid="input-counter-trade-terms" />
              </div>
            )}
            <div>
              <Label className="text-xs">Explanation / Notes</Label>
              <Textarea value={counterNotes} onChange={e => setCounterNotes(e.target.value)} placeholder="Explain your counter offer..." rows={3} data-testid="textarea-counter-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCounterOpen(false)}>Cancel</Button>
            <Button onClick={() => actionMutation.mutate({ action: "counter", body: { counterAmount: counterAmount ? parseFloat(counterAmount) : undefined, counterHours: counterHours ? parseFloat(counterHours) : undefined, counterTerms: counterTerms || undefined, counterTradeTerms: counterTradeTerms || undefined, notes: counterNotes } })} disabled={actionMutation.isPending || (!counterAmount && !counterHours && !counterTerms)} data-testid="btn-confirm-counter">
              {actionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Send Counter Offer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version Snapshot Dialog */}
      {selectedVersion && (
        <Dialog open={!!selectedVersion} onOpenChange={() => setSelectedVersion(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-primary" />
                Proposal — Version {selectedVersion.version} Snapshot
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-1">{fmtDate(selectedVersion.createdAt)} · Read-only historical view</p>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              {selectedVersion.changeNotes && (
                <div className="bg-muted/40 rounded p-3 text-sm italic text-muted-foreground border-l-2 border-primary/30">
                  Change notes: "{selectedVersion.changeNotes}"
                </div>
              )}
              {selectedVersion.snapshotJson && (
                <div className="space-y-3 text-sm">
                  {selectedVersion.snapshotJson.title && (
                    <div><p className="text-xs text-muted-foreground">Title</p><p className="font-medium">{selectedVersion.snapshotJson.title}</p></div>
                  )}
                  {selectedVersion.snapshotJson.amount && (
                    <div><p className="text-xs text-muted-foreground">Total Amount</p><p className="font-bold text-primary text-lg">{fmt(selectedVersion.snapshotJson.amount)}</p></div>
                  )}
                  {selectedVersion.snapshotJson.status && (
                    <div><p className="text-xs text-muted-foreground">Status at this version</p><ProposalBadge status={selectedVersion.snapshotJson.status} /></div>
                  )}
                  {selectedVersion.snapshotJson.scope_of_work && (
                    <div><p className="text-xs text-muted-foreground">Scope of Work</p><p className="whitespace-pre-wrap text-foreground/80">{selectedVersion.snapshotJson.scope_of_work}</p></div>
                  )}
                  {selectedVersion.snapshotJson.payment_terms && (
                    <div><p className="text-xs text-muted-foreground">Payment Terms</p><p className="whitespace-pre-wrap">{selectedVersion.snapshotJson.payment_terms}</p></div>
                  )}
                  {selectedVersion.snapshotJson.notes && (
                    <div><p className="text-xs text-muted-foreground">Notes</p><p>{selectedVersion.snapshotJson.notes}</p></div>
                  )}
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground mb-2">Full snapshot data:</p>
                    <pre className="text-xs bg-muted rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(selectedVersion.snapshotJson, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedVersion(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <ConvertToContractDialog
        open={convertToContractOpen}
        onClose={() => setConvertToContractOpen(false)}
        proposal={proposal}
        onSuccess={() => {
          setConvertToContractOpen(false);
          queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] });
          queryClient.invalidateQueries({ queryKey: ["/api/contractor-contracts"] });
          onRefresh();
          toast({ title: "Contract created successfully" });
        }}
      />
    </Sheet>
  );
}

// ─── Template Tab with Industry/Trade Filtering ───────────────────────────────

const INDUSTRY_OPTIONS = [
  { value: "all", label: "All Industries" },
  { value: "general_construction", label: "General Construction" },
  { value: "electrical", label: "Electrical" },
  { value: "plumbing", label: "Plumbing" },
  { value: "hvac", label: "HVAC" },
  { value: "landscaping", label: "Landscaping" },
  { value: "roofing", label: "Roofing" },
  { value: "painting", label: "Painting" },
  { value: "flooring", label: "Flooring" },
  { value: "carpentry", label: "Carpentry" },
  { value: "masonry", label: "Masonry" },
  { value: "it_services", label: "IT / Tech Services" },
  { value: "consulting", label: "Consulting" },
  { value: "cleaning", label: "Cleaning Services" },
  { value: "other", label: "Other" },
];

const TEMPLATE_ACCENT_COLORS = [
  "bg-teal-100 border-teal-300",
  "bg-blue-100 border-blue-300",
  "bg-amber-100 border-amber-300",
  "bg-emerald-100 border-emerald-300",
  "bg-purple-100 border-purple-300",
  "bg-rose-100 border-rose-300",
];

function TemplateTabContent({
  templates, selectedTemplateId, onSelect
}: {
  templates: any[]; selectedTemplateId?: string; onSelect: (t: any) => void;
}) {
  const [industryFilter, setIndustryFilter] = useState("all");
  const [workTypeFilter, setWorkTypeFilter] = useState("all");
  const [searchFilter, setSearchFilter] = useState("");

  const allWorkTypes = Array.from(new Set(
    templates.map(t => t.workType || t.work_type).filter(Boolean)
  ));

  const filtered = templates.filter(t => {
    const matchIndustry = industryFilter === "all" || (t.industry || "").toLowerCase().includes(industryFilter.replace("_", " ").toLowerCase()) || (t.industry === industryFilter);
    const matchWorkType = workTypeFilter === "all" || (t.workType || t.work_type) === workTypeFilter;
    const matchSearch = !searchFilter || t.name?.toLowerCase().includes(searchFilter.toLowerCase()) || t.description?.toLowerCase().includes(searchFilter.toLowerCase());
    return matchIndustry && matchWorkType && matchSearch;
  });

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search templates..."
          value={searchFilter}
          onChange={e => setSearchFilter(e.target.value)}
          className="h-8 text-xs max-w-[180px]"
          data-testid="input-template-search"
        />
        <Select value={industryFilter} onValueChange={setIndustryFilter}>
          <SelectTrigger className="h-8 text-xs w-[160px]" data-testid="select-template-industry">
            <SelectValue placeholder="All Industries" />
          </SelectTrigger>
          <SelectContent>
            {INDUSTRY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {allWorkTypes.length > 0 && (
          <Select value={workTypeFilter} onValueChange={setWorkTypeFilter}>
            <SelectTrigger className="h-8 text-xs w-[160px]" data-testid="select-template-work-type">
              <SelectValue placeholder="All Work Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Work Types</SelectItem>
              {allWorkTypes.map(wt => <SelectItem key={wt} value={wt}>{wt}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-10 border border-dashed rounded-lg">
          <Layers className="h-10 w-10 mx-auto mb-3 text-primary/30" />
          {templates.length === 0 ? (
            <>
              <p className="text-sm font-medium">No templates yet</p>
              <p className="text-xs text-muted-foreground mt-1">Create reusable proposal templates in Profile &amp; Branding → Templates</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">No matching templates</p>
              <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters</p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((t: any, idx: number) => {
            const accentClass = TEMPLATE_ACCENT_COLORS[idx % TEMPLATE_ACCENT_COLORS.length];
            const isSelected = selectedTemplateId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelect(t)}
                className={cn(
                  "text-left rounded-lg border-2 overflow-hidden hover:shadow-md transition-all",
                  isSelected ? "border-primary shadow-md" : "border-border hover:border-primary/50"
                )}
                data-testid={`btn-template-${t.id}`}
              >
                {/* Visual thumbnail header */}
                <div className={cn("h-12 flex items-center justify-between px-3 border-b", accentClass)}>
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 opacity-60" />
                    <span className="text-xs font-semibold truncate max-w-[120px]">{t.name}</span>
                  </div>
                  {isSelected && <CheckSquare className="h-4 w-4 text-primary shrink-0" />}
                </div>
                <div className="p-3 space-y-1.5">
                  {t.description && <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>}
                  <div className="flex flex-wrap gap-1">
                    {(t.workType || t.work_type) && (
                      <span className="px-1.5 py-0.5 rounded-sm bg-primary/10 text-primary text-xs">{t.workType || t.work_type}</span>
                    )}
                    {t.industry && (
                      <span className="px-1.5 py-0.5 rounded-sm bg-secondary/40 text-secondary-foreground text-xs">{t.industry}</span>
                    )}
                    {t.template_type && (
                      <span className="px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground text-xs">{t.template_type}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
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
  const [tab, setTab] = useState(proposal ? "details" : "intake");
  const [form, setForm] = useState<Partial<Proposal>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [aiAction, setAiAction] = useState("");

  const isNew = !proposal;
  const proposalId = proposal?.id;

  const { data: companies = [] } = useQuery<any[]>({ queryKey: ["/api/contractor-proposals/companies"] });
  const { data: templates = [] } = useQuery<any[]>({
    queryKey: ["/api/contractor-templates"],
    queryFn: async () => {
      const r = await fetch("/api/contractor-templates", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });
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
  const { data: contractorBranding } = useQuery<any>({
    queryKey: ["/api/contractor-branding"],
    queryFn: async () => {
      const r = await fetch("/api/contractor-branding", { credentials: "include" });
      return r.ok ? r.json() : null;
    },
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
    else if (aiAction === "suggest_warranty") setForm(f => ({ ...f, warrantyNotes: aiResult }));
    else if (aiAction === "generate_summary") setForm(f => ({ ...f, aiGeneratedSummary: aiResult }));
    toast({ title: "Applied to proposal" });
    setAiResult("");
    setDirty(true);
  }

  async function handleAiFillAll() {
    if (!proposalId) { toast({ title: "Save the proposal first before using AI" }); return; }
    setAiLoading(true); setAiAction("fill_all"); setAiResult("");
    try {
      const r = await fetch(`/api/contractor-proposals/${proposalId}/ai-assist`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fill_all", context: form.description || current.description || form.scopeOfWork || "" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message);
      if (d.parsed && typeof d.parsed === "object") {
        const p = d.parsed;
        setForm(f => ({
          ...f,
          scopeOfWork: p.scopeOfWork || f.scopeOfWork,
          assumptions: p.assumptions || f.assumptions,
          exclusions: p.exclusions || f.exclusions,
          paymentTerms: p.paymentTerms || f.paymentTerms,
          warrantyNotes: p.warrantyNotes || f.warrantyNotes,
        }));
        setDirty(true);
        toast({ title: "Proposal drafted — review and edit before sending" });
      } else {
        setAiResult(d.result || "");
        toast({ title: "AI returned text — review below and apply manually", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: e.message || "AI failed", variant: "destructive" });
    } finally { setAiLoading(false); }
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
          <TabsList className="shrink-0 w-full rounded-none border-b bg-transparent h-auto p-0 justify-start gap-0 overflow-x-auto">
            {[
              { value: "intake", label: "Intake" },
              { value: "template", label: "Template" },
              { value: "details", label: "Details" },
              { value: "work", label: "Work Details" },
              { value: "scope", label: "Scope" },
              { value: "pricing", label: "Pricing" },
              { value: "terms", label: "Terms" },
              { value: "attachments", label: "Attachments" },
              { value: "ai", label: "AI Assist" },
              { value: "history", label: "History" },
              { value: "preview", label: "Preview" },
            ].map(t => (
              <TabsTrigger key={t.value} value={t.value}
                className="shrink-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2.5 text-sm"
                data-testid={`tab-proposal-${t.value}`}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <ScrollArea className="flex-1">
            {/* ── Intake Questionnaire Tab ── */}
            <TabsContent value="intake" className="m-0 p-6 space-y-6">
              <div>
                <h3 className="font-semibold text-sm">Proposal Intake Questionnaire</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Answer a few questions to help scope and classify this proposal correctly before building it out.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-medium">Cost Center / Job Code</Label>
                  <Input
                    placeholder="e.g. CC-2024-001 or General"
                    value={form.costCenter || ""}
                    onChange={e => setForm(f => ({ ...f, costCenter: e.target.value }))}
                    className="mt-1"
                    data-testid="input-cost-center"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Used for job costing and internal reporting</p>
                </div>
                <div>
                  <Label className="text-xs font-medium">Project Classification</Label>
                  <Select value={form.projectClass || ""} onValueChange={v => setForm(f => ({ ...f, projectClass: v }))}>
                    <SelectTrigger className="mt-1" data-testid="select-project-class">
                      <SelectValue placeholder="Select classification" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new_construction">New Construction</SelectItem>
                      <SelectItem value="renovation">Renovation / Remodel</SelectItem>
                      <SelectItem value="maintenance">Maintenance & Repair</SelectItem>
                      <SelectItem value="service">Service Call</SelectItem>
                      <SelectItem value="consulting">Consulting / Advisory</SelectItem>
                      <SelectItem value="inspection">Inspection / Assessment</SelectItem>
                      <SelectItem value="installation">Installation</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-medium">Labor vs. Materials Split</Label>
                  <Select value={form.laborMaterialsSplit || ""} onValueChange={v => setForm(f => ({ ...f, laborMaterialsSplit: v }))}>
                    <SelectTrigger className="mt-1" data-testid="select-labor-materials-split">
                      <SelectValue placeholder="Estimated split" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="labor_only">Labor Only (100% / 0%)</SelectItem>
                      <SelectItem value="labor_heavy">Labor Heavy (70% / 30%)</SelectItem>
                      <SelectItem value="balanced">Balanced (50% / 50%)</SelectItem>
                      <SelectItem value="materials_heavy">Materials Heavy (30% / 70%)</SelectItem>
                      <SelectItem value="materials_only">Materials Only (0% / 100%)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-medium">Urgency / Priority</Label>
                  <Select value={form.urgency || ""} onValueChange={v => setForm(f => ({ ...f, urgency: v }))}>
                    <SelectTrigger className="mt-1" data-testid="select-urgency">
                      <SelectValue placeholder="Select urgency" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="emergency">Emergency (ASAP)</SelectItem>
                      <SelectItem value="urgent">Urgent (&lt; 1 week)</SelectItem>
                      <SelectItem value="standard">Standard (1–4 weeks)</SelectItem>
                      <SelectItem value="flexible">Flexible (&gt; 1 month)</SelectItem>
                      <SelectItem value="future">Future / Planning Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-medium">Estimated Start Date</Label>
                  <Input
                    type="date"
                    value={form.estimatedStartDate || ""}
                    onChange={e => setForm(f => ({ ...f, estimatedStartDate: e.target.value }))}
                    className="mt-1"
                    data-testid="input-estimated-start"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Estimated Completion Date</Label>
                  <Input
                    type="date"
                    value={form.estimatedEndDate || ""}
                    onChange={e => setForm(f => ({ ...f, estimatedEndDate: e.target.value }))}
                    className="mt-1"
                    data-testid="input-estimated-end"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs font-medium">Site / Location Notes</Label>
                <Textarea
                  placeholder="Address, access instructions, safety notes, special conditions..."
                  value={form.siteNotes || ""}
                  onChange={e => setForm(f => ({ ...f, siteNotes: e.target.value }))}
                  className="mt-1"
                  rows={3}
                  data-testid="textarea-site-notes"
                />
              </div>
              <div>
                <Label className="text-xs font-medium">Client Requirements / Special Instructions</Label>
                <Textarea
                  placeholder="Any specific requirements, certifications needed, union requirements, insurance minimums..."
                  value={form.clientRequirements || ""}
                  onChange={e => setForm(f => ({ ...f, clientRequirements: e.target.value }))}
                  className="mt-1"
                  rows={3}
                  data-testid="textarea-client-requirements"
                />
              </div>
              <div className="pt-2">
                <Button onClick={() => setTab("template")} data-testid="btn-intake-next">
                  Continue to Template Selection <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </TabsContent>

            {/* ── Template Tab ── */}
            <TabsContent value="template" className="m-0 p-6 space-y-4">
              <div>
                <h3 className="font-semibold text-sm mb-1">Start from a Template</h3>
                <p className="text-xs text-muted-foreground">Choose a template to pre-fill scope, terms, and pricing structure. You can still edit everything after applying.</p>
              </div>
              <TemplateTabContent
                templates={templates}
                selectedTemplateId={form.templateId ?? current.templateId}
                onSelect={t => {
                  setForm(f => ({
                    ...f,
                    templateId: t.id,
                    title: f.title || t.name,
                    scopeOfWork: f.scopeOfWork || t.scopeTemplate || t.scope_template,
                    paymentTerms: f.paymentTerms || t.paymentTermsTemplate || t.payment_terms_template,
                    assumptions: f.assumptions || t.assumptionsTemplate || t.assumptions_template,
                    exclusions: f.exclusions || t.exclusionsTemplate || t.exclusions_template,
                    workType: f.workType || t.workType || t.work_type,
                  }));
                  toast({ title: `Template "${t.name}" applied` });
                  setTab("details");
                }}
              />
            </TabsContent>

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

            {/* ── Work Details Tab ── */}
            <TabsContent value="work" className="m-0 p-6 space-y-5">
              <div>
                <h3 className="font-semibold text-sm mb-1 flex items-center gap-2"><Briefcase className="h-4 w-4 text-primary" /> Work Classification</h3>
                <p className="text-xs text-muted-foreground mb-3">Define the nature of the work for accurate quoting, reporting, and compliance.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Work Type</Label>
                  <Select value={form.workType ?? current.workType ?? ""} onValueChange={v => setForm(f => ({ ...f, workType: v }))} disabled={!canEdit}>
                    <SelectTrigger data-testid="select-work-type"><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      {["residential","commercial","industrial","renovation","new_construction","maintenance","consulting","other"].map(v => (
                        <SelectItem key={v} value={v}>{v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Payment Structure</Label>
                  <Select value={form.paymentType ?? current.paymentType ?? ""} onValueChange={v => setForm(f => ({ ...f, paymentType: v }))} disabled={!canEdit}>
                    <SelectTrigger data-testid="select-payment-type"><SelectValue placeholder="Select structure" /></SelectTrigger>
                    <SelectContent>
                      {[
                        { v: "fixed_price", l: "Fixed Price" },
                        { v: "hourly", l: "Hourly Rate" },
                        { v: "milestone", l: "Milestone-Based" },
                        { v: "time_and_materials", l: "Time & Materials" },
                        { v: "cost_plus", l: "Cost Plus" },
                        { v: "trade", l: "Trade / Non-Cash" },
                      ].map(o => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Estimated Hours</Label>
                  <Input type="number" min="0" step="0.5"
                    value={form.estimatedHours ?? current.estimatedHours ?? ""}
                    onChange={e => setForm(f => ({ ...f, estimatedHours: e.target.value }))}
                    placeholder="0.0" disabled={!canEdit} data-testid="input-estimated-hours" />
                </div>
                <div>
                  <Label>Estimated Labor Budget ($)</Label>
                  <Input type="number" min="0" step="0.01"
                    value={form.estimatedLaborBudget ?? current.estimatedLaborBudget ?? ""}
                    onChange={e => setForm(f => ({ ...f, estimatedLaborBudget: e.target.value }))}
                    placeholder="0.00" disabled={!canEdit} data-testid="input-labor-budget" />
                </div>
              </div>
              <Separator />
              <div>
                <h3 className="font-semibold text-sm mb-1 flex items-center gap-2"><ArrowUpDown className="h-4 w-4 text-primary" /> Trade / Non-Cash Compensation</h3>
                <p className="text-xs text-muted-foreground mb-3">If part of the compensation is non-cash (barter, trade, goods), specify it here.</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Trade Offered (what client provides)</Label>
                    <Input value={form.tradeOffered ?? current.tradeOffered ?? ""}
                      onChange={e => setForm(f => ({ ...f, tradeOffered: e.target.value }))}
                      placeholder="e.g. Equipment, Materials, Services" disabled={!canEdit} data-testid="input-trade-offered" />
                  </div>
                  <div>
                    <Label>Trade Value ($)</Label>
                    <Input type="number" min="0" step="0.01"
                      value={form.tradeValue ?? current.tradeValue ?? ""}
                      onChange={e => setForm(f => ({ ...f, tradeValue: e.target.value }))}
                      placeholder="0.00" disabled={!canEdit} data-testid="input-trade-value" />
                  </div>
                  <div className="col-span-2">
                    <Label>Trade Terms & Conditions</Label>
                    <Textarea value={form.tradeTerms ?? current.tradeTerms ?? ""}
                      onChange={e => setForm(f => ({ ...f, tradeTerms: e.target.value }))}
                      placeholder="Describe the trade arrangement, delivery timeline, quality standards..." rows={3}
                      disabled={!canEdit} data-testid="textarea-trade-terms" />
                  </div>
                </div>
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

                <Button
                  size="lg"
                  onClick={handleAiFillAll}
                  disabled={aiLoading || !proposalId}
                  className="w-full mb-4 bg-primary hover:bg-primary/90 text-primary-foreground"
                  data-testid="btn-ai-fill-all"
                >
                  {aiLoading && aiAction === "fill_all"
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <Sparkles className="h-4 w-4 mr-2" />}
                  Help me write this proposal
                </Button>
                <p className="text-[11px] text-muted-foreground -mt-2 mb-3">Drafts scope, assumptions, exclusions, payment terms, and warranty in one shot. You can edit everything before sending.</p>

                <div className="grid grid-cols-2 gap-2">
                  {[
                    { action: "draft_scope", label: "Draft Scope from Notes", icon: FileText },
                    { action: "improve_scope", label: "Improve Scope Quality", icon: TrendingUp },
                    { action: "suggest_assumptions", label: "Suggest Assumptions", icon: CheckCheck },
                    { action: "suggest_exclusions", label: "Suggest Exclusions", icon: XCircle },
                    { action: "suggest_payment_terms", label: "Draft Payment Terms", icon: DollarSign },
                    { action: "suggest_warranty", label: "Draft Warranty Terms", icon: ShieldCheck },
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
              <div className="flex items-center justify-between gap-2 px-6 pt-4 pb-2 border-b">
                <div className="text-xs text-muted-foreground">
                  This is an HTML preview using your saved branding. Click <strong>Preview PDF</strong> to see the exact PDF clients will receive.
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!proposalId}
                  onClick={() => proposalId && window.open(`/api/contractor-proposals/${proposalId}/pdf`, "_blank")}
                  data-testid="btn-preview-pdf"
                >
                  <FileText className="h-3.5 w-3.5 mr-1.5" /> Preview PDF
                </Button>
              </div>
              <ProposalPreview proposal={current as Proposal} lineItems={lineItems} subtotal={subtotal} tax={tax} discount={discount} total={total} branding={contractorBranding} />
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

function ProposalPreview({ proposal, lineItems, subtotal, tax, discount, total, branding }: {
  proposal: Proposal; lineItems: LineItem[]; subtotal: number; tax: number; discount: number; total: number; branding?: any;
}) {
  const accentColor = branding?.primary_color || "#0f766e";
  const businessName = branding?.business_name;
  const tagline = branding?.tagline;
  const websiteUrl = branding?.website_url;
  const licenseNumber = branding?.license_number;
  const coverNote = branding?.cover_note;
  const footerText = branding?.footer_text;
  const signatureText = branding?.signature_text;

  return (
    <div className="bg-white dark:bg-gray-950 min-h-full">
      {/* Branded Header Bar */}
      <div className="h-2" style={{ backgroundColor: accentColor }} />
      <div className="px-8 py-6 border-b" style={{ borderColor: accentColor + "30" }}>
        <div className="max-w-3xl mx-auto flex justify-between items-start">
          <div>
            {businessName ? (
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg" style={{ backgroundColor: accentColor }}>
                  {businessName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h2 className="font-bold text-lg text-gray-900 dark:text-white leading-tight">{businessName}</h2>
                  {tagline && <p className="text-xs text-muted-foreground">{tagline}</p>}
                </div>
              </div>
            ) : null}
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-2">{proposal.title || "Proposal"}</h1>
            <p className="text-sm text-muted-foreground mt-1">{proposal.proposalNumber}</p>
          </div>
          <div className="text-right text-sm text-muted-foreground space-y-0.5">
            <p>Date: {fmtDate(proposal.issueDate)}</p>
            {proposal.expirationDate && <p>Expires: {fmtDate(proposal.expirationDate)}</p>}
            {proposal.estimatorName && <p>Prepared by: {proposal.estimatorName}</p>}
            {websiteUrl && <p className="text-xs">{websiteUrl}</p>}
            {licenseNumber && <p className="text-xs">Lic. #{licenseNumber}</p>}
          </div>
        </div>
      </div>

      <div className="p-8 max-w-3xl mx-auto space-y-8">
        {(coverNote || proposal.clientMessage) && (
          <div className="rounded-lg p-4 italic text-sm text-muted-foreground border-l-4" style={{ borderColor: accentColor, backgroundColor: accentColor + "10" }}>
            "{coverNote || proposal.clientMessage}"
          </div>
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
        {signatureText && (
          <div className="mt-8 pt-4 border-t">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{signatureText}</p>
            {businessName && <p className="text-xs text-muted-foreground mt-0.5">{businessName}</p>}
          </div>
        )}
      </div>

      {/* Branded Footer */}
      {(footerText || businessName) && (
        <div className="px-8 py-4 border-t text-center" style={{ borderColor: accentColor + "30", backgroundColor: accentColor + "08" }}>
          <p className="text-xs text-muted-foreground">{footerText || businessName}</p>
        </div>
      )}
      <div className="h-2" style={{ backgroundColor: accentColor }} />
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
  const [submitting, setSubmitting] = useState(false);

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
              {!isAdmin && invoice.status === "draft" && !proposalBlocked && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                  <p className="text-sm font-medium mb-1">Ready to submit?</p>
                  <p className="text-xs text-muted-foreground mb-3">Once submitted, the company will review and approve or request changes.</p>
                  <Button className="w-full" onClick={async () => {
                    setSubmitting(true);
                    try {
                      await apiRequest("POST", `/api/contractor-invoices/${invoice.id}/submit`, {});
                      queryClient.invalidateQueries({ queryKey: ["/api/contractor-invoices"] });
                      toast({ title: "Invoice submitted for approval" });
                      onClose();
                    } catch {
                      toast({ title: "Failed to submit invoice", variant: "destructive" });
                    } finally { setSubmitting(false); }
                  }} disabled={submitting} data-testid="btn-panel-submit-invoice">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    Submit Invoice for Approval
                  </Button>
                </div>
              )}
              {!isAdmin && invoice.status === "draft" && !!proposalBlocked && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20 p-4 text-sm">
                  <p className="font-medium text-orange-700">Submission blocked</p>
                  <p className="text-xs text-muted-foreground mt-1">This invoice is linked to a proposal that has not been approved yet. Once the proposal is approved, you can submit this invoice.</p>
                </div>
              )}
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

// ─── Contract Detail Panel ─────────────────────────────────────────────────────

function ContractDetailPanel({
  contract: initialContract, onClose, isAdmin, onRefresh
}: { contract: Contract; onClose: () => void; isAdmin: boolean; onRefresh: () => void }) {
  const { toast } = useToast();
  const [tab, setTab] = useState("overview");
  const [signOpen, setSignOpen] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [addSignerOpen, setAddSignerOpen] = useState(false);
  const [newSignerName, setNewSignerName] = useState("");
  const [newSignerEmail, setNewSignerEmail] = useState("");
  const [newSignerRole, setNewSignerRole] = useState("reviewer");
  const [createInvoiceOpen, setCreateInvoiceOpen] = useState(false);

  const { data: contract, refetch } = useQuery<Contract>({
    queryKey: ["/api/contractor-contracts", initialContract.id],
    queryFn: async () => {
      const r = await fetch(`/api/contractor-contracts/${initialContract.id}`, { credentials: "include" });
      if (!r.ok) return initialContract;
      const raw = await r.json();
      return snakeToCamel(raw) as Contract;
    },
    initialData: initialContract,
    staleTime: 0,
  });

  const signers: Signer[] = (contract?.signers || []).map(snakeToCamel) as Signer[];
  const totalValue = contract?.totalValue || (contract as any)?.total_value;

  const daysUntilExpiry = contract?.endDate
    ? Math.round((new Date(contract.endDate).getTime() - Date.now()) / 86400000)
    : null;
  const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= 30;
  const hasUnsignedSigners = signers.some(s => s.status === "pending");

  const signMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/contractor-contracts/${contract.id}/sign`, { name: signerName, role: isAdmin ? "company_rep" : "contractor" }),
    onSuccess: () => { refetch(); setSignOpen(false); toast({ title: "Contract signed" }); onRefresh(); },
    onError: (e: any) => toast({ title: e?.message || "Failed to sign", variant: "destructive" }),
  });

  const sendMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/contractor-contracts/${contract.id}/send`, {}),
    onSuccess: () => { refetch(); toast({ title: "Contract sent for signing" }); onRefresh(); },
    onError: (e: any) => toast({ title: e?.message || "Failed to send", variant: "destructive" }),
  });

  const activateMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/contractor-contracts/${contract.id}/activate`, {}),
    onSuccess: () => { refetch(); toast({ title: "Contract activated" }); onRefresh(); },
    onError: (e: any) => toast({ title: e?.message || "Failed to activate", variant: "destructive" }),
  });

  const voidMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/contractor-contracts/${contract.id}/void`, { reason: voidReason }),
    onSuccess: () => { refetch(); setVoidOpen(false); toast({ title: "Contract voided" }); onRefresh(); },
    onError: (e: any) => toast({ title: e?.message || "Failed to void", variant: "destructive" }),
  });

  const addSignerMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/contractor-contracts/${contract.id}/add-signer`, { name: newSignerName, email: newSignerEmail, role: newSignerRole }),
    onSuccess: () => { refetch(); setAddSignerOpen(false); setNewSignerName(""); setNewSignerEmail(""); toast({ title: "Signer added" }); },
    onError: (e: any) => toast({ title: e?.message || "Failed to add signer", variant: "destructive" }),
  });

  const canSend = isAdmin && contract.status === "draft";
  const canActivate = isAdmin && ["pending", "sent", "partially_signed", "fully_signed"].includes(contract.status);
  const canVoid = isAdmin && !["void", "terminated"].includes(contract.status);
  const canSign = ["sent", "partially_signed"].includes(contract.status);
  const canCreateInvoice = ["active", "fully_signed"].includes(contract.status);

  return (
    <Sheet open onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col" data-testid="sheet-contract-detail">
        <SheetHeader className="shrink-0 px-6 py-4 border-b">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <SheetTitle className="text-base leading-tight">{contract.title || "Contract"}</SheetTitle>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {contract.contractNumber && <span className="text-xs text-muted-foreground font-mono">{contract.contractNumber}</span>}
                <ContractBadge status={contract.status} />
                {isExpiringSoon && <span className="text-xs bg-orange-100 text-orange-700 rounded px-1.5 py-0.5">Expiring in {daysUntilExpiry}d</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
              {canSign && (
                <Button size="sm" className="bg-teal-600 hover:bg-teal-700 text-white" onClick={() => setSignOpen(true)} data-testid="btn-sign-contract">
                  <CheckSquare className="h-3.5 w-3.5 mr-1" /> Sign
                </Button>
              )}
              {canSend && (
                <Button size="sm" onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending} data-testid="btn-send-contract">
                  <Send className="h-3.5 w-3.5 mr-1" /> Send for Signing
                </Button>
              )}
              {canActivate && (
                <Button size="sm" variant="outline" className="border-green-300 text-green-700" onClick={() => activateMutation.mutate()} disabled={activateMutation.isPending} data-testid="btn-activate-contract">
                  <CheckCircle className="h-3.5 w-3.5 mr-1" /> Activate
                </Button>
              )}
              {canCreateInvoice && (
                <Button size="sm" variant="outline" onClick={() => setCreateInvoiceOpen(true)} data-testid="btn-create-invoice-from-contract">
                  <FilePlus className="h-3.5 w-3.5 mr-1" /> Create Invoice
                </Button>
              )}
              {canVoid && (
                <Button size="sm" variant="outline" className="border-red-300 text-red-700" onClick={() => setVoidOpen(true)} data-testid="btn-void-contract">
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Void
                </Button>
              )}
              <a href={`/api/contractor-contracts/${contract.id}/download`} target="_blank" rel="noreferrer" data-testid="btn-download-contract">
                <Button size="sm" variant="ghost" title="Download contract as JSON">
                  <Download className="h-3.5 w-3.5 mr-1" /> Download
                </Button>
              </a>
            </div>
          </div>
        </SheetHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
          <TabsList className="shrink-0 w-full rounded-none border-b bg-transparent h-auto p-0 justify-start gap-0">
            {[["overview","Overview"],["signers","Signers"],["terms","Terms"]].map(([v, l]) => (
              <TabsTrigger key={v} value={v} className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-2.5 text-sm font-medium">{l}</TabsTrigger>
            ))}
          </TabsList>
          <ScrollArea className="flex-1">
            <TabsContent value="overview" className="m-0 p-6 space-y-5">
              {/* Reminders */}
              {isExpiringSoon && (
                <div className="p-3 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-600 shrink-0" />
                  <p className="text-sm text-orange-700 dark:text-orange-400">This contract expires in <strong>{daysUntilExpiry} day{daysUntilExpiry !== 1 ? "s" : ""}</strong>.</p>
                </div>
              )}
              {hasUnsignedSigners && ["sent","partially_signed"].includes(contract.status) && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-600 shrink-0" />
                  <p className="text-sm text-amber-700 dark:text-amber-400">Awaiting signatures from {signers.filter(s => s.status === "pending").length} signer(s).</p>
                </div>
              )}

              {/* Key fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Contract Value</p>
                  <p className="font-semibold text-lg">{fmt(totalValue)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Type</p>
                  <p className="text-sm capitalize">{contract.contractType || "Service"}</p>
                </div>
                {contract.startDate && (
                  <div>
                    <p className="text-xs text-muted-foreground">Start Date</p>
                    <p className="text-sm">{fmtDate(contract.startDate)}</p>
                  </div>
                )}
                {contract.endDate && (
                  <div>
                    <p className="text-xs text-muted-foreground">End Date</p>
                    <p className="text-sm">{fmtDate(contract.endDate)}</p>
                  </div>
                )}
                {contract.paymentTerms && (
                  <div>
                    <p className="text-xs text-muted-foreground">Payment Terms</p>
                    <p className="text-sm">{contract.paymentTerms}</p>
                  </div>
                )}
                {contract.currency && (
                  <div>
                    <p className="text-xs text-muted-foreground">Currency</p>
                    <p className="text-sm">{contract.currency}</p>
                  </div>
                )}
                {contract.sentAt && (
                  <div>
                    <p className="text-xs text-muted-foreground">Sent At</p>
                    <p className="text-sm">{fmtDate(contract.sentAt)}</p>
                  </div>
                )}
                {contract.fullySignedAt && (
                  <div>
                    <p className="text-xs text-muted-foreground">Fully Signed</p>
                    <p className="text-sm">{fmtDate(contract.fullySignedAt)}</p>
                  </div>
                )}
              </div>

              {contract.description && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Description</p>
                  <p className="text-sm whitespace-pre-wrap">{contract.description}</p>
                </div>
              )}
              {contract.scopeOfWork && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Scope of Work</p>
                  <div className="p-3 bg-muted/30 rounded-lg text-sm whitespace-pre-wrap">{contract.scopeOfWork}</div>
                </div>
              )}
              {contract.tradeDetails && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Trade / Non-Cash Details</p>
                  <p className="text-sm whitespace-pre-wrap">{contract.tradeDetails}</p>
                </div>
              )}
              {contract.voidReason && (
                <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800">
                  <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">Void Reason</p>
                  <p className="text-sm text-red-700 dark:text-red-400">{contract.voidReason}</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="signers" className="m-0 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Signers</h3>
                  <p className="text-xs text-muted-foreground">{signers.filter(s => s.status === "signed").length} of {signers.length} signed</p>
                </div>
                {isAdmin && !["void","fully_signed","terminated"].includes(contract.status) && (
                  <Button size="sm" variant="outline" onClick={() => setAddSignerOpen(true)} data-testid="btn-add-signer">
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Signer
                  </Button>
                )}
              </div>

              {signers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No signers registered yet</p>
                  {isAdmin && <p className="text-xs mt-1">Add signers or send the contract for signing</p>}
                </div>
              ) : (
                <div className="space-y-3">
                  {signers.map((signer, idx) => (
                    <div key={signer.id} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20" data-testid={`row-signer-${signer.id}`}>
                      <div className={cn(
                        "h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold",
                        signer.status === "signed" ? "bg-green-100 text-green-700" :
                        signer.status === "declined" ? "bg-red-100 text-red-700" :
                        "bg-gray-100 text-gray-500"
                      )}>
                        {signer.status === "signed" ? "✓" : signer.status === "declined" ? "✗" : idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{signer.name}</p>
                        {signer.email && <p className="text-xs text-muted-foreground">{signer.email}</p>}
                        <p className="text-xs text-muted-foreground capitalize">{signer.role?.replace(/_/g, " ") || "Reviewer"}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                          signer.status === "signed" ? "bg-green-100 text-green-700" :
                          signer.status === "declined" ? "bg-red-100 text-red-700" :
                          "bg-yellow-100 text-yellow-700"
                        )}>
                          {signer.status === "signed" ? "Signed" : signer.status === "declined" ? "Declined" : "Pending"}
                        </span>
                        {signer.signedAt && <p className="text-xs text-muted-foreground mt-1">{fmtDate(signer.signedAt)}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {canSign && (
                <div className="pt-2 border-t">
                  <Button onClick={() => setSignOpen(true)} className="w-full bg-teal-600 hover:bg-teal-700 text-white" data-testid="btn-sign-contract-tab">
                    <CheckSquare className="h-4 w-4 mr-2" /> Sign This Contract
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="terms" className="m-0 p-6 space-y-4">
              {contract.specialTerms && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Special Terms</p>
                  <div className="p-3 bg-muted/30 rounded-lg text-sm whitespace-pre-wrap">{contract.specialTerms}</div>
                </div>
              )}
              {contract.bodyMarkdown && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Contract Body</p>
                  <div className="p-3 bg-muted/30 rounded-lg text-sm whitespace-pre-wrap font-mono text-xs">{contract.bodyMarkdown}</div>
                </div>
              )}
              {!contract.specialTerms && !contract.bodyMarkdown && (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No additional terms added</p>
                </div>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>

        {/* Sign Dialog */}
        <Dialog open={signOpen} onOpenChange={v => !v && setSignOpen(false)}>
          <DialogContent data-testid="dialog-sign-contract">
            <DialogHeader><DialogTitle>Sign Contract</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">By signing, you agree to the terms of this contract.</p>
              <div className="p-4 border-2 border-dashed rounded-lg bg-muted/20">
                <p className="text-xs text-muted-foreground mb-2">Type your full legal name to sign</p>
                <Input
                  value={signerName}
                  onChange={e => setSignerName(e.target.value)}
                  placeholder="Your full name"
                  className="font-cursive text-lg"
                  data-testid="input-signer-name"
                />
                {signerName && (
                  <p className="mt-2 text-lg italic text-muted-foreground font-serif">{signerName}</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Signed electronically on {new Date().toLocaleDateString()}</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSignOpen(false)}>Cancel</Button>
              <Button className="bg-teal-600 hover:bg-teal-700 text-white" onClick={() => signMutation.mutate()} disabled={signMutation.isPending || !signerName.trim()} data-testid="btn-confirm-sign">
                {signMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckSquare className="h-4 w-4 mr-1" />}
                Confirm Signature
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Void Dialog */}
        <Dialog open={voidOpen} onOpenChange={v => !v && setVoidOpen(false)}>
          <DialogContent data-testid="dialog-void-contract">
            <DialogHeader><DialogTitle>Void Contract</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">This action cannot be undone. Please provide a reason for voiding this contract.</p>
              <Textarea value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="Reason for voiding..." rows={3} data-testid="textarea-void-reason" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setVoidOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => voidMutation.mutate()} disabled={voidMutation.isPending || !voidReason.trim()} data-testid="btn-confirm-void">
                {voidMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                Void Contract
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add Signer Dialog */}
        <Dialog open={addSignerOpen} onOpenChange={v => !v && setAddSignerOpen(false)}>
          <DialogContent data-testid="dialog-add-signer">
            <DialogHeader><DialogTitle>Add Signer</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input value={newSignerName} onChange={e => setNewSignerName(e.target.value)} placeholder="John Doe" data-testid="input-new-signer-name" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={newSignerEmail} onChange={e => setNewSignerEmail(e.target.value)} placeholder="john@example.com" data-testid="input-new-signer-email" />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={newSignerRole} onValueChange={setNewSignerRole}>
                  <SelectTrigger data-testid="select-new-signer-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contractor">Contractor</SelectItem>
                    <SelectItem value="company_rep">Company Representative</SelectItem>
                    <SelectItem value="reviewer">Reviewer</SelectItem>
                    <SelectItem value="witness">Witness</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddSignerOpen(false)}>Cancel</Button>
              <Button onClick={() => addSignerMutation.mutate()} disabled={addSignerMutation.isPending || !newSignerName.trim()} data-testid="btn-confirm-add-signer">
                {addSignerMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                Add Signer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Invoice from Contract */}
        {createInvoiceOpen && (
          <CreateInvoiceFromContractDialog
            contract={contract}
            isAdmin={isAdmin}
            onClose={() => setCreateInvoiceOpen(false)}
            onSuccess={() => {
              setCreateInvoiceOpen(false);
              queryClient.invalidateQueries({ queryKey: ["/api/contractor-invoices"] });
              toast({ title: "Invoice created" });
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Create Invoice from Contract Dialog ──────────────────────────────────────

function CreateInvoiceFromContractDialog({
  contract, isAdmin, onClose, onSuccess
}: { contract: Contract; isAdmin: boolean; onClose: () => void; onSuccess: () => void }) {
  const { toast } = useToast();
  const totalValue = parseFloat(String(contract.totalValue || (contract as any)?.total_value || "0"));
  const [invoiceTitle, setInvoiceTitle] = useState(`Invoice — ${contract.title || ""}`);
  const [amount, setAmount] = useState(String(totalValue || ""));
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [templateId, setTemplateId] = useState<string>("");

  const { data: templates = [] } = useQuery<any[]>({
    queryKey: ["/api/contractor-templates", "invoice"],
    queryFn: async () => {
      const r = await fetch("/api/contractor-templates?templateType=invoice", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });
  const invoiceTemplates = templates.filter(t => (t.template_type || t.templateType) === "invoice");

  // Default to first available invoice template once loaded
  useEffect(() => {
    if (!templateId && invoiceTemplates.length > 0) {
      const def = invoiceTemplates.find(t => t.is_default || t.isDefault) || invoiceTemplates[0];
      setTemplateId(def.id);
    }
  }, [invoiceTemplates, templateId]);

  const amountNum = parseFloat(amount || "0");
  const exceedsBudget = totalValue > 0 && amountNum > totalValue;

  const mutation = useMutation({
    mutationFn: async () => {
      if (isAdmin) {
        return apiRequest("POST", "/api/contractor-invoices/from-proposal", {
          contractId: contract.id,
          dueDate: dueDate || undefined,
          notes: notes || undefined,
          templateId: templateId || undefined,
        });
      } else {
        return apiRequest("POST", "/api/contractor-invoices", {
          contractId: contract.id,
          title: invoiceTitle,
          amount,
          invoiceDate,
          dueDate: dueDate || undefined,
          notes: notes || undefined,
          companyId: contract.companyId,
          templateId: templateId || undefined,
        });
      }
    },
    onSuccess: () => onSuccess(),
    onError: (e: any) => toast({ title: e?.message || "Failed to create invoice", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-create-invoice-from-contract">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" /> Create Invoice from Contract
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {totalValue > 0 && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-sm">
              <p className="text-blue-700 dark:text-blue-400 font-medium">Contract value: {fmt(totalValue)}</p>
              <p className="text-xs text-blue-600 dark:text-blue-500 mt-0.5">Invoice amount should not exceed the contract value.</p>
            </div>
          )}
          {exceedsBudget && !overrideMode && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-700 dark:text-red-400 font-medium flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" /> Amount exceeds contract value
              </p>
              <p className="text-xs text-red-600 dark:text-red-500 mt-1">You are requesting {fmt(amountNum)} against an approved value of {fmt(totalValue)}.</p>
              <Button size="sm" variant="outline" className="mt-2 border-red-300 text-red-700 text-xs" onClick={() => setOverrideMode(true)}>
                Request Override
              </Button>
            </div>
          )}
          {overrideMode && (
            <div className="space-y-2 p-3 bg-orange-50 dark:bg-orange-950/30 rounded-lg border border-orange-200 dark:border-orange-800">
              <p className="text-xs font-medium text-orange-700">Override Reason (required)</p>
              <Textarea value={overrideReason} onChange={e => setOverrideReason(e.target.value)} placeholder="Explain why the invoice exceeds the contract value..." rows={2} data-testid="textarea-override-reason" />
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => { setOverrideMode(false); setAmount(String(totalValue)); }}>
                Reset to contract value
              </Button>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Invoice Title</Label>
            <Input value={invoiceTitle} onChange={e => setInvoiceTitle(e.target.value)} data-testid="input-invoice-title" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount ($)</Label>
              <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} data-testid="input-invoice-amount" />
            </div>
            <div className="space-y-1.5">
              <Label>Invoice Date</Label>
              <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} data-testid="input-invoice-date" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Due Date</Label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} data-testid="input-invoice-due-date" />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Any notes for this invoice..." data-testid="textarea-invoice-notes" />
          </div>
          {invoiceTemplates.length > 0 && (
            <div className="space-y-1.5">
              <Label>Invoice Template &amp; Style</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger data-testid="select-invoice-template"><SelectValue placeholder="Choose template..." /></SelectTrigger>
                <SelectContent>
                  {invoiceTemplates.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}{t.layout_variant || t.layoutVariant ? ` — ${t.layout_variant || t.layoutVariant}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Controls the PDF layout. Your saved branding (logo, colors, footer) is applied automatically.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !amount || parseFloat(amount) <= 0 || (exceedsBudget && overrideMode && !overrideReason.trim()) || (exceedsBudget && !overrideMode)}
            data-testid="btn-confirm-create-invoice"
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FilePlus className="h-4 w-4 mr-1" />}
            Create Invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Contracts Section ────────────────────────────────────────────────────────

function ContractsSection({ isAdmin, reminderEntityIds = new Set(), initialSelectedId }: { isAdmin: boolean; reminderEntityIds?: Set<string | null | undefined>; initialSelectedId?: string | null }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);

  const { data: rawContracts = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/contractor-contracts"],
    queryFn: async () => {
      const r = await fetch("/api/contractor-contracts", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const contracts: Contract[] = rawContracts.map(c => snakeToCamel(c) as Contract);

  useEffect(() => {
    if (initialSelectedId && contracts.length > 0 && !selectedContract) {
      const found = contracts.find(c => c.id === initialSelectedId);
      if (found) setSelectedContract(found);
    }
  }, [initialSelectedId, contracts]);

  const now = Date.now();
  const reminders = contracts.filter(c => {
    const daysLeft = c.endDate ? Math.round((new Date(c.endDate).getTime() - now) / 86400000) : null;
    const expiring = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30 && ["active"].includes(c.status);
    const awaitingSig = ["sent","partially_signed"].includes(c.status);
    return expiring || awaitingSig;
  });

  const filtered = contracts.filter(c => {
    const matchSearch = !search || c.title?.toLowerCase().includes(search.toLowerCase()) || c.contractNumber?.toLowerCase().includes(search.toLowerCase()) || (c.contractorName as any)?.toLowerCase().includes(search.toLowerCase());
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

      {/* Reminder banners */}
      {reminders.length > 0 && (
        <div className="space-y-2">
          {reminders.map(c => {
            const daysLeft = c.endDate ? Math.round((new Date(c.endDate).getTime() - now) / 86400000) : null;
            const isExpiring = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30;
            return (
              <button
                key={c.id}
                className="w-full text-left p-3 rounded-lg border flex items-center gap-3 hover:bg-muted/30 transition-colors"
                style={{ borderColor: isExpiring ? "#f97316" : "#f59e0b", background: isExpiring ? "rgb(255,247,237)" : "rgb(255,251,235)" }}
                onClick={() => setSelectedContract(c)}
                data-testid={`banner-contract-${c.id}`}
              >
                {isExpiring
                  ? <AlertTriangle className="h-4 w-4 text-orange-600 shrink-0" />
                  : <Clock className="h-4 w-4 text-amber-600 shrink-0" />
                }
                <span className="text-sm text-foreground">
                  <strong>{c.title}</strong> —{" "}
                  {isExpiring ? `expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}` : "awaiting signature"}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 ml-auto" />
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contracts..." className="h-8 max-w-xs" data-testid="input-contract-search" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-40" data-testid="select-contract-status"><SelectValue placeholder="All Status" /></SelectTrigger>
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
          <p className="text-xs mt-1">Contracts are created when proposals are approved and converted to contracts</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => {
            const totalVal = c.totalValue || (c as any).total_value;
            const daysLeft = c.endDate ? Math.round((new Date(c.endDate).getTime() - now) / 86400000) : null;
            const isExpiring = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30 && ["active"].includes(c.status);
            return (
              <button
                key={c.id}
                className="w-full text-left border rounded-lg p-4 hover:bg-muted/30 transition-colors"
                onClick={() => setSelectedContract(c)}
                data-testid={`row-contract-${c.id}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm">{c.title || c.contractNumber || "Contract"}</p>
                      <ContractBadge status={c.status} />
                      {isExpiring && <span className="text-xs bg-orange-100 text-orange-700 rounded px-1.5 py-0.5">Exp. {daysLeft}d</span>}
                      {reminderEntityIds.has(c.id) && (
                        <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 rounded px-1.5 py-0.5" data-testid={`badge-reminder-contract-${c.id}`}>
                          <Clock className="h-3 w-3" /> Reminder
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      {c.contractNumber && <span className="font-mono">{c.contractNumber}</span>}
                      {(c as any).contractorName && <><span>·</span><span>{(c as any).contractorName}</span></>}
                      {c.startDate && <><span>·</span><span>Start {fmtDate(c.startDate)}</span></>}
                      {c.endDate && <><span>·</span><span>End {fmtDate(c.endDate)}</span></>}
                      {totalVal && <><span>·</span><span className="font-semibold text-foreground">{fmt(totalVal)}</span></>}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedContract && (
        <ContractDetailPanel
          contract={selectedContract}
          onClose={() => setSelectedContract(null)}
          isAdmin={isAdmin}
          onRefresh={() => { refetch(); setSelectedContract(null); }}
        />
      )}
    </div>
  );
}

// ─── Payments Section ─────────────────────────────────────────────────────────

function PaymentsSection({ invoices }: { invoices: Invoice[] }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateRange, setDateRange] = useState("all");

  const now = new Date();
  const filterDate = dateRange === "30d" ? new Date(now.getTime() - 30 * 86400000)
    : dateRange === "90d" ? new Date(now.getTime() - 90 * 86400000)
    : dateRange === "ytd" ? new Date(now.getFullYear(), 0, 1)
    : null;

  const filtered = invoices.filter(i => {
    const matchStatus = statusFilter === "all" || i.status === statusFilter;
    const matchDate = !filterDate || !i.createdAt || new Date(i.createdAt) >= filterDate;
    return matchStatus && matchDate;
  });

  const paidInvoices = filtered.filter(i => ["paid", "partially_paid"].includes(i.status));
  const outstandingInvoices = filtered.filter(i => !["paid", "void", "cancelled", "closed"].includes(i.status));
  const overdueInvoices = filtered.filter(i => i.status === "overdue");
  const totalPaid = paidInvoices.reduce((s, i) => s + parseFloat(i.amountPaid ?? "0"), 0);
  const totalOutstanding = outstandingInvoices.reduce((s, i) => s + parseFloat(i.balanceDue ?? i.amount ?? "0"), 0);
  const totalOverdue = overdueInvoices.reduce((s, i) => s + parseFloat(i.balanceDue ?? i.amount ?? "0"), 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Payments & Remittance</h2>
        <p className="text-sm text-muted-foreground">Track incoming and outgoing payments</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="h-8 w-36" data-testid="select-payment-date"><SelectValue placeholder="All Time" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Time</SelectItem>
            <SelectItem value="30d">Last 30 Days</SelectItem>
            <SelectItem value="90d">Last 90 Days</SelectItem>
            <SelectItem value="ytd">Year to Date</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-44" data-testid="select-payment-status"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="under_review">Under Review</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="partially_paid">Partially Paid</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xl font-bold text-green-600">{fmt(totalPaid)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Received</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xl font-bold text-orange-600">{fmt(totalOutstanding)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Outstanding</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xl font-bold text-red-600">{fmt(totalOverdue)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Overdue</p>
          </CardContent>
        </Card>
      </div>

      {/* Invoice list grouped by status */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
          <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No payments match your filter</p>
          <p className="text-xs mt-1">Try changing the date range or status filter</p>
        </div>
      ) : (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Invoice Breakdown ({filtered.length})</h3>
          {filtered.map(inv => {
            const balance = parseFloat(inv.balanceDue ?? inv.amount ?? "0");
            const paid = parseFloat(inv.amountPaid ?? "0");
            return (
              <div key={inv.id} className="border rounded-lg p-3" data-testid={`row-payment-inv-${inv.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">{inv.title || inv.invoiceNumber || "Invoice"}</p>
                      <InvoiceBadge status={inv.status} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {inv.invoiceNumber && <span>{inv.invoiceNumber} · </span>}
                      {inv.invoiceDate && <span>{fmtDate(inv.invoiceDate)}</span>}
                      {inv.dueDate && <span> · Due {fmtDate(inv.dueDate)}</span>}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold">{fmt(inv.amount)}</p>
                    {paid > 0 && <p className="text-xs text-green-600">Paid: {fmt(paid)}</p>}
                    {balance > 0 && paid > 0 && <p className="text-xs text-orange-600">Bal: {fmt(balance)}</p>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Documents Section ─────────────────────────────────────────────────────────

const DOC_TYPE_ICONS: Record<string, React.FC<{className?: string}>> = {
  proposal: FileText, contract: FileSignature, invoice: Receipt,
  payment: CreditCard, dam: FolderOpen,
};

const IMMUTABLE_STATUSES: Record<string, string[]> = {
  proposal: ["approved", "converted_to_contract"],
  contract: ["fully_signed", "active", "completed"],
  invoice: ["paid", "closed"],
};

function isImmutable(type: string, status: string) {
  return (IMMUTABLE_STATUSES[type] || []).includes(status);
}

function VersionHistoryDrawer({ open, onClose, entityType, entityId, entityTitle }: {
  open: boolean; onClose: () => void; entityType: string; entityId: string; entityTitle: string;
}) {
  const supportsVersions = entityType === "contract" || entityType === "proposal";
  const { data: versions = [], isLoading } = useQuery<any[]>({
    queryKey: [`/api/contractor-${entityType}s/${entityId}/versions`],
    enabled: open && !!entityId && supportsVersions,
    queryFn: async () => {
      const r = await fetch(`/api/contractor-${entityType}s/${entityId}/versions`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> Version History
          </SheetTitle>
          <p className="text-xs text-muted-foreground truncate">{entityTitle}</p>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-120px)] mt-4">
          {!supportsVersions ? (
            <div className="text-center py-8 text-muted-foreground">
              <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">No version history</p>
              <p className="text-xs mt-1">{entityType.charAt(0).toUpperCase() + entityType.slice(1)}s are single-revision documents. Each record represents a final artifact.</p>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : versions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No version history yet</p>
              <p className="text-xs mt-1">Versions are created on each status change</p>
            </div>
          ) : (
            <div className="space-y-3 pr-2">
              {versions.map((v: any, i: number) => (
                <div key={v.id || i} className={cn("border rounded-lg p-3", i === 0 ? "border-primary/30 bg-primary/5" : "")}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold">Version {v.version_number ?? v.version ?? (versions.length - i)}</span>
                    {i === 0 && <span className="text-xs bg-primary text-primary-foreground rounded px-1.5 py-0.5">Current</span>}
                    {i > 0 && <span className="text-xs bg-muted text-muted-foreground rounded px-1.5 py-0.5">Superseded</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{fmtDate(v.created_at || v.createdAt)}</p>
                  {(v.reason || v.change_notes) && <p className="text-xs mt-1 italic text-foreground/70">{v.reason || v.change_notes}</p>}
                  {v.changed_by && <p className="text-xs text-muted-foreground mt-0.5">By: {v.changed_by}</p>}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function DocumentsSection() {
  const { toast } = useToast();
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [versionDrawer, setVersionDrawer] = useState<{type: string; id: string; title: string} | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<{id: string; type: string; title: string} | null>(null);

  const { data: proposals = [] } = useQuery<Proposal[]>({
    queryKey: ["/api/contractor-proposals", showArchived],
    queryFn: async () => { const r = await fetch(`/api/contractor-proposals${showArchived ? "?showArchived=true" : ""}`, { credentials: "include" }); return r.ok ? r.json() : []; },
    select: (d: any) => snakeToCamel(d),
  });
  const { data: contracts = [] } = useQuery<Contract[]>({
    queryKey: ["/api/contractor-contracts", showArchived],
    queryFn: async () => { const r = await fetch(`/api/contractor-contracts${showArchived ? "?showArchived=true" : ""}`, { credentials: "include" }); return r.ok ? r.json() : []; },
    select: (d: any) => snakeToCamel(d),
  });
  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ["/api/contractor-invoices", showArchived],
    queryFn: async () => { const r = await fetch(`/api/contractor-invoices${showArchived ? "?showArchived=true" : ""}`, { credentials: "include" }); return r.ok ? r.json() : []; },
    select: (d: any) => snakeToCamel(d),
  });
  const { data: payments = [] } = useQuery<Payment[]>({
    queryKey: ["/api/contractor-payments"],
    queryFn: async () => { const r = await fetch("/api/contractor-payments", { credentials: "include" }); return r.ok ? r.json() : []; },
    select: (d: any) => snakeToCamel(d),
  });
  const { data: smtpCfg } = useQuery<{host?: string} | null>({
    queryKey: ["/api/admin/smtp-config"],
    queryFn: async () => { const r = await fetch("/api/admin/smtp-config", { credentials: "include" }); return r.ok ? r.json() : null; },
  });
  const emailProviderConfigured = !!(smtpCfg?.host);

  const { data: damDocs = [] } = useQuery<any[]>({
    queryKey: ["/api/dam-documents", "contractor-pdfs"],
    queryFn: async () => { const r = await fetch("/api/dam-documents", { credentials: "include" }); return r.ok ? r.json() : []; },
    select: (rows: any[]) => rows.filter(d =>
      ["proposal","invoice","contract","contractor_contract"].includes(d.linked_entity_type || "") &&
      d.mime_type === "application/pdf"
    ),
  });

  const [contractorFilter, setContractorFilter] = useState("all");
  const [costCenterFilter, setCostCenterFilter] = useState("all");
  const [jobFilter, setJobFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [emailSending, setEmailSending] = useState<string | null>(null);
  const [expandedAudit, setExpandedAudit] = useState<string | null>(null);
  const { data: docSectionUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const canArchive = docSectionUser?.role === "admin" || docSectionUser?.role === "manager" ||
    (docSectionUser?.role || "").startsWith("tenant_") || (docSectionUser?.role || "").startsWith("platform_");

  type DocRow = {
    id: string; type: string; title: string; status: string; date: string;
    amount?: string; immutable: boolean; hasVersions: boolean;
    contractorId?: string; contractorName?: string; costCenter?: string; workType?: string;
    companyId?: string; companyName?: string; versionNum?: number;
    signers?: Array<{name?: string; email?: string; signedAt?: string; role?: string}>;
  };

  const allDocs: DocRow[] = [
    ...proposals.map(p => ({
      id: p.id, type: "proposal", title: p.title || p.proposalNumber || "Proposal",
      status: p.status, date: p.createdAt, amount: p.amount,
      immutable: isImmutable("proposal", p.status), hasVersions: true,
      contractorId: p.contractorId,
      contractorName: (p as any).contractorName,
      costCenter: (p as any).costCenter,
      workType: (p as any).workType || (p as any).work_type,
      companyId: p.companyId,
      companyName: (p as any).companyName,
      versionNum: (p as any).version || (p as any).versionNumber || 1,
    })),
    ...contracts.map(c => ({
      id: c.id, type: "contract", title: c.title || c.contractNumber || "Contract",
      status: c.status, date: c.createdAt, amount: c.totalValue || c.value,
      immutable: isImmutable("contract", c.status), hasVersions: true,
      contractorId: c.contractorId, contractorName: c.contractorName,
      companyId: (c as any).companyId,
      companyName: (c as any).companyName,
      versionNum: (c as any).version || (c as any).versionNumber || 1,
      signers: c.signers?.map(s => ({
        name: (s as any).signerName || (s as any).name,
        email: (s as any).signerEmail || (s as any).email,
        signedAt: (s as any).signedAt || (s as any).signed_at,
        role: (s as any).role,
      })),
    })),
    ...invoices.map(i => ({
      id: i.id, type: "invoice", title: i.title || `Invoice #${i.invoiceNumber || i.id.slice(0,8)}`,
      status: i.status, date: i.createdAt, amount: i.amount,
      immutable: isImmutable("invoice", i.status), hasVersions: false,
      contractorId: i.contractorId,
      companyId: (i as any).companyId,
      companyName: (i as any).companyName,
    })),
    ...payments.map(p => ({
      id: p.id, type: "payment", title: `Payment — ${fmtDate(p.paidAt)}`,
      status: p.status || "completed", date: p.paidAt, amount: p.amount,
      immutable: true, hasVersions: false, contractorId: undefined,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const contractorOptions = [...new Set(allDocs.map(d => d.contractorId).filter(Boolean))].map(id => ({
    id: id!, name: allDocs.find(d => d.contractorId === id)?.contractorName || id!.slice(0, 8),
  }));
  const costCenterOptions = [...new Set(allDocs.map(d => d.costCenter).filter(Boolean))];
  const jobOptions = [...new Set(allDocs.map(d => d.workType).filter(Boolean))];
  const companyOptions = [...new Set(allDocs.map(d => d.companyId).filter(Boolean))].map(id => ({
    id: id!, name: allDocs.find(d => d.companyId === id)?.companyName || id!.slice(0, 8),
  }));

  const filtered = allDocs.filter(d => {
    if (typeFilter !== "all" && d.type !== typeFilter) return false;
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    if (contractorFilter !== "all" && d.contractorId !== contractorFilter) return false;
    if (costCenterFilter !== "all" && d.costCenter !== costCenterFilter) return false;
    if (jobFilter !== "all" && d.workType !== jobFilter) return false;
    if (companyFilter !== "all" && d.companyId !== companyFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchFields = [d.title, d.contractorName, d.companyName, d.costCenter, d.workType, d.status, d.type].filter(Boolean).map(f => f!.toLowerCase());
      if (!matchFields.some(f => f.includes(q))) return false;
    }
    if (dateFrom && new Date(d.date) < new Date(dateFrom)) return false;
    if (dateTo && new Date(d.date) > new Date(dateTo + "T23:59:59")) return false;
    return true;
  });

  async function handleEmailDoc(doc: DocRow) {
    setEmailSending(doc.id);
    try {
      const endpoint = doc.type === "invoice"
        ? `/api/contractor-invoices/${doc.id}/send-reminder`
        : doc.type === "proposal"
        ? `/api/contractor-proposals/${doc.id}/send`
        : doc.type === "contract"
        ? `/api/contractor-contracts/${doc.id}/send`
        : null;
      if (!endpoint) { toast({ title: "Email not available for this document type" }); return; }
      const r = await fetch(endpoint, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
      toast({ title: "Document sent via email" });
    } catch (e: any) {
      toast({ title: e?.message || "Email send failed", variant: "destructive" });
    } finally {
      setEmailSending(null);
    }
  }

  const DOC_DOWNLOAD_ENDPOINTS: Record<string, string> = {
    contract: "/api/contractor-contracts",
    invoice: "/api/contractor-invoices",
    proposal: "/api/contractor-proposals",
    payment: "/api/contractor-payments",
  };

  async function handleDownload(doc: DocRow) {
    try {
      const base = DOC_DOWNLOAD_ENDPOINTS[doc.type];
      if (!base) { toast({ title: "Download not available for this document type" }); return; }
      const r = await fetch(`${base}/${doc.id}/download`, { credentials: "include" });
      if (!r.ok) { toast({ title: "Download failed", variant: "destructive" }); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `paylink-${doc.type}-${doc.id.slice(0,8)}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast({ title: "Download failed", variant: "destructive" }); }
  }

  const archiveMutation = useMutation({
    mutationFn: async (doc: {id: string; type: string}) => {
      const base = doc.type === "contract"
        ? `/api/contractor-contracts/${doc.id}/archive`
        : doc.type === "proposal"
        ? `/api/contractor-proposals/${doc.id}/archive`
        : doc.type === "invoice"
        ? `/api/contractor-invoices/${doc.id}/archive`
        : null;
      if (!base) throw new Error("Archive not available for this document type");
      const r = await fetch(base, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.message || "Archive failed");
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Document archived" });
      setArchiveConfirm(null);
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-contracts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-invoices"] });
    },
    onError: (e: any) => toast({ title: e?.message || "Archive failed", variant: "destructive" }),
  });

  const statusOptions = [...new Set(allDocs.map(d => d.status))].sort();
  const DOC_TYPES = ["all", "proposal", "contract", "invoice", "payment"] as const;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Documents</h2>
        <p className="text-sm text-muted-foreground">{allDocs.length} total artifacts · {filtered.length} showing</p>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search documents..." className="h-8 pl-8" data-testid="input-search-docs" />
          </div>
          <div className="flex gap-1 flex-wrap">
            {DOC_TYPES.map(t => (
              <Button key={t} size="sm" variant={typeFilter === t ? "default" : "ghost"} className="h-8 text-xs"
                onClick={() => setTypeFilter(t)} data-testid={`btn-filter-type-${t}`}>
                {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1) + "s"}
              </Button>
            ))}
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-32 text-xs" data-testid="select-doc-status">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {statusOptions.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          {contractorOptions.length > 0 && (
            <Select value={contractorFilter} onValueChange={setContractorFilter}>
              <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-doc-contractor">
                <SelectValue placeholder="All Contractors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Contractors</SelectItem>
                {contractorOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {costCenterOptions.length > 0 && (
            <Select value={costCenterFilter} onValueChange={setCostCenterFilter}>
              <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-doc-cost-center">
                <SelectValue placeholder="All Cost Centers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Cost Centers</SelectItem>
                {costCenterOptions.map(cc => <SelectItem key={cc} value={cc!}>{cc}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {jobOptions.length > 0 && (
            <Select value={jobFilter} onValueChange={setJobFilter}>
              <SelectTrigger className="h-8 w-32 text-xs" data-testid="select-doc-job">
                <SelectValue placeholder="All Work Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Work Types</SelectItem>
                {jobOptions.map(j => <SelectItem key={j} value={j!}>{j}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {companyOptions.length > 1 && (
            <Select value={companyFilter} onValueChange={setCompanyFilter}>
              <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-doc-company">
                <SelectValue placeholder="All Companies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Companies</SelectItem>
                {companyOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" variant={showDateFilter ? "secondary" : "ghost"} className="h-8 text-xs" onClick={() => setShowDateFilter(v => !v)} data-testid="btn-toggle-date-filter">
            <Calendar className="h-3 w-3 mr-1" /> Date
          </Button>
          <Button size="sm" variant={showArchived ? "secondary" : "ghost"} className="h-8 text-xs" onClick={() => setShowArchived(v => !v)} data-testid="btn-toggle-archived">
            <Archive className="h-3 w-3 mr-1" /> {showArchived ? "Hide Archived" : "Show Archived"}
          </Button>
        </div>
        {showDateFilter && (
          <div className="flex items-center gap-2 px-1">
            <Label className="text-xs text-muted-foreground shrink-0">From</Label>
            <Input type="date" className="h-7 text-xs w-36" value={dateFrom} onChange={e => setDateFrom(e.target.value)} data-testid="input-date-from" />
            <Label className="text-xs text-muted-foreground shrink-0">To</Label>
            <Input type="date" className="h-7 text-xs w-36" value={dateTo} onChange={e => setDateTo(e.target.value)} data-testid="input-date-to" />
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setDateFrom(""); setDateTo(""); }} data-testid="btn-clear-dates">
              Clear
            </Button>
          </div>
        )}
      </div>

      {/* Document list */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 border border-dashed rounded-lg text-muted-foreground">
          <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">{allDocs.length === 0 ? "No documents yet" : "No documents match your filter"}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(doc => {
            const Icon = DOC_TYPE_ICONS[doc.type] || FileText;
            const statusCfg =
              doc.type === "proposal" ? PROPOSAL_STATUS_CONFIG[doc.status] :
              doc.type === "contract" ? CONTRACT_STATUS_CONFIG[doc.status] :
              INVOICE_STATUS_CONFIG[doc.status];
            return (
              <div key={`${doc.type}-${doc.id}`} className="space-y-0">
              <div className="border rounded-lg p-3 flex items-center gap-3 hover:bg-muted/30 transition-colors group" data-testid={`row-doc-${doc.id}`}>
                <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
                  doc.type === "proposal" ? "bg-blue-50 dark:bg-blue-950/30" :
                  doc.type === "contract" ? "bg-purple-50 dark:bg-purple-950/30" :
                  doc.type === "payment" ? "bg-teal-50 dark:bg-teal-950/30" :
                  "bg-green-50 dark:bg-green-950/30")}>
                  <Icon className={cn("h-4 w-4",
                    doc.type === "proposal" ? "text-blue-600" :
                    doc.type === "contract" ? "text-purple-600" :
                    doc.type === "payment" ? "text-teal-600" : "text-green-600")} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium truncate">{doc.title}</p>
                    {doc.immutable && (
                      <span className="inline-flex items-center gap-1 text-xs bg-amber-50 dark:bg-amber-950/30 text-amber-700 rounded px-1.5 py-0.5" title="Final — Immutable. Key fields locked to preserve audit integrity.">
                        <Lock className="h-3 w-3" /> Final — Immutable
                      </span>
                    )}
                    {statusCfg && (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${statusCfg.color} ${statusCfg.bg}`}>
                        {statusCfg.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                    <span className="capitalize">{doc.type}</span>
                    {doc.versionNum && doc.versionNum > 0 && (
                      <span className="inline-flex items-center px-1 py-0 rounded bg-muted text-muted-foreground text-[10px] font-mono">v{doc.versionNum}</span>
                    )}
                    <span>·</span>
                    <span>{fmtDate(doc.date)}</span>
                    {doc.amount && <><span>·</span><span className="font-medium text-foreground">{fmt(doc.amount)}</span></>}
                    {doc.companyName && <><span>·</span><span className="text-muted-foreground">{doc.companyName}</span></>}
                    {doc.contractorName && <><span>·</span><span>{doc.contractorName}</span></>}
                    {doc.costCenter && <><span>·</span><span>CC: {doc.costCenter}</span></>}
                    {doc.signers && doc.signers.length > 0 && (
                      <span className="flex items-center gap-1" title={doc.signers.map(s => `${s.name || s.email}${s.signedAt ? " (signed " + fmtDate(s.signedAt) + ")" : " (pending)"}`).join(", ")}>
                        · <CheckCheck className="h-3 w-3 text-green-600" />
                        {doc.signers.filter(s => s.signedAt).length}/{doc.signers.length} signed
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {doc.signers && doc.signers.length > 0 && (
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Audit trail"
                      onClick={() => setExpandedAudit(expandedAudit === doc.id ? null : doc.id)}
                      data-testid={`btn-audit-${doc.id}`}>
                      <Shield className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {doc.hasVersions && (
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Version history"
                      onClick={() => setVersionDrawer({ type: doc.type as "contract"|"proposal", id: doc.id, title: doc.title })}
                      data-testid={`btn-history-${doc.id}`}>
                      <History className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {/* View — opens download URL in new tab for all types */}
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="View document"
                    onClick={() => {
                      const base = DOC_DOWNLOAD_ENDPOINTS[doc.type];
                      if (base) window.open(`${base}/${doc.id}/download`, "_blank");
                    }}
                    data-testid={`btn-view-doc-${doc.id}`}>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                  {/* Download — all document types */}
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Download"
                    onClick={() => handleDownload(doc)} data-testid={`btn-download-doc-${doc.id}`}>
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  {/* Print — fetches doc data and renders a print-friendly HTML page */}
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Print document"
                    onClick={async () => {
                      const base = DOC_DOWNLOAD_ENDPOINTS[doc.type];
                      if (!base) return;
                      // HTML-escape helper to prevent XSS from user-controlled data
                      const esc = (s: unknown) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
                      try {
                        const r = await fetch(`${base}/${doc.id}/download`, { credentials: "include" });
                        const data = r.ok ? await r.json().catch(() => null) : null;
                        const win = window.open("", "_blank");
                        if (win) {
                          const d = data || {};
                          const rows = Object.entries(d)
                            .filter(([k]) => !["id","created_at","updated_at","body_json","line_items"].includes(k))
                            .map(([k,v]) => `<tr><th>${esc(k.replace(/_/g," "))}</th><td>${v != null && v !== "" ? esc(String(v).slice(0,200)) : "—"}</td></tr>`)
                            .join("");
                          win.document.write([
                            `<!DOCTYPE html><html><head><title>PayLink \u2014 ${esc(doc.title)}</title><style>`,
                            `body{font-family:sans-serif;max-width:800px;margin:40px auto;color:#111;padding:20px}`,
                            `h1{font-size:1.4rem;border-bottom:2px solid #0d9488;padding-bottom:8px;margin-bottom:20px}`,
                            `table{width:100%;border-collapse:collapse;margin:16px 0}`,
                            `th,td{text-align:left;padding:8px 12px;border:1px solid #ddd;font-size:.9rem}`,
                            `th{background:#f4f4f4;font-weight:600}.meta{color:#555;font-size:.85rem;margin:4px 0}`,
                            `@media print{body{margin:0}}`,
                            `</style></head><body>`,
                            `<h1>${esc(doc.title)}</h1>`,
                            `<p class="meta">Type: ${esc(doc.type)} &nbsp;|&nbsp; Status: ${esc(doc.status)} &nbsp;|&nbsp; Date: ${esc(new Date(doc.date).toLocaleDateString())}</p>`,
                            doc.amount ? `<p class="meta">Amount: ${esc(String(doc.amount))}</p>` : "",
                            doc.companyName ? `<p class="meta">Company: ${esc(String(doc.companyName))}</p>` : "",
                            (doc as any).contractorName ? `<p class="meta">Contractor: ${esc(String((doc as any).contractorName))}</p>` : "",
                            `<table><tbody>${rows}</tbody></table>`,
                            `<script>window.print();<\/script>`,
                            `</body></html>`,
                          ].join(""));
                          win.document.close();
                        }
                      } catch { toast({ title: "Print failed", variant: "destructive" }); }
                    }}
                    data-testid={`btn-print-doc-${doc.id}`}>
                    <Printer className="h-3.5 w-3.5" />
                  </Button>
                  {/* Email — gated by SMTP provider config; shown for sendable types */}
                  {(doc.type === "invoice" || doc.type === "proposal" || doc.type === "contract") && (
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                      title={emailProviderConfigured ? "Send via email" : "Email provider not configured"}
                      disabled={emailSending === doc.id || !emailProviderConfigured}
                      onClick={() => handleEmailDoc(doc)} data-testid={`btn-email-doc-${doc.id}`}>
                      {emailSending === doc.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Mail className={cn("h-3.5 w-3.5", !emailProviderConfigured && "opacity-40")} />}
                    </Button>
                  )}
                  {canArchive && !doc.immutable && (doc.type === "proposal" || doc.type === "contract" || doc.type === "invoice") && (
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" title="Archive"
                      onClick={() => setArchiveConfirm({ id: doc.id, type: doc.type, title: doc.title })}
                      data-testid={`btn-archive-doc-${doc.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {doc.immutable && (
                    <span className="h-7 w-7 flex items-center justify-center text-muted-foreground/40" title="Final — cannot be archived">
                      <Lock className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
              </div>
              {/* Audit trail expansion */}
              {expandedAudit === doc.id && doc.signers && doc.signers.length > 0 && (
                <div className="border-x border-b rounded-b-lg px-3 py-2 bg-muted/20 -mt-px" data-testid={`audit-trail-${doc.id}`}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Signature Audit Trail</p>
                  <div className="space-y-1.5">
                    {doc.signers.map((signer, idx) => (
                      <div key={idx} className="flex items-center gap-3 text-xs">
                        <div className={cn("h-5 w-5 rounded-full flex items-center justify-center shrink-0",
                          signer.signedAt ? "bg-green-500" : "bg-muted-foreground/20")}>
                          {signer.signedAt ? <CheckCheck className="h-3 w-3 text-white" /> : <Clock className="h-3 w-3 text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">{signer.name || signer.email || "Unknown"}</span>
                          {signer.role && <span className="text-muted-foreground ml-1">({signer.role})</span>}
                          {signer.email && signer.name && <span className="text-muted-foreground ml-1">— {signer.email}</span>}
                        </div>
                        <div className={cn("shrink-0 font-medium", signer.signedAt ? "text-green-600" : "text-muted-foreground")}>
                          {signer.signedAt ? `Signed ${fmtDate(signer.signedAt)}` : "Pending signature"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </div>
            );
          })}
        </div>
      )}

      {/* Generated PDF Documents (from DMS) */}
      {damDocs.length > 0 && (
        <div className="mt-6 space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Generated PDF Documents</h3>
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{damDocs.length}</span>
          </div>
          <div className="space-y-1.5">
            {damDocs.map((d: any) => (
              <div key={d.id} className="border rounded-lg p-3 flex items-center gap-3 hover:bg-muted/30 transition-colors group" data-testid={`row-dms-pdf-${d.id}`}>
                <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-rose-50 dark:bg-rose-950/30">
                  <FileText className="h-4 w-4 text-rose-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{d.title || d.file_name || "PDF Document"}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                    <span className="capitalize">{(d.linked_entity_type || "").replace("contractor_", "")}</span>
                    {d.description && <><span>·</span><span className="truncate max-w-[200px]">{d.description}</span></>}
                    {d.created_at && <><span>·</span><span>{new Date(d.created_at).toLocaleDateString()}</span></>}
                    {d.file_size && <><span>·</span><span>{(d.file_size / 1024).toFixed(1)} KB</span></>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1"
                    onClick={() => window.open(`/api/dam-documents/${d.id}/download`, "_blank")}
                    data-testid={`btn-view-pdf-${d.id}`} title="View PDF">
                    <ExternalLink className="h-3.5 w-3.5" /> View
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1"
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = `/api/dam-documents/${d.id}/download`;
                      a.download = d.file_name || "document.pdf";
                      a.click();
                    }}
                    data-testid={`btn-download-pdf-${d.id}`} title="Download PDF">
                    <Download className="h-3.5 w-3.5" /> PDF
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Archive confirm dialog */}
      <Dialog open={!!archiveConfirm} onOpenChange={v => !v && setArchiveConfirm(null)}>
        <DialogContent data-testid="dialog-archive-confirm">
          <DialogHeader>
            <DialogTitle>Archive Document?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This will archive <strong>{archiveConfirm?.title}</strong>. Archived documents are hidden from the active list but remain in the audit trail.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => archiveConfirm && archiveMutation.mutate(archiveConfirm)} disabled={archiveMutation.isPending} data-testid="btn-confirm-archive">
              {archiveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version history drawer */}
      {versionDrawer && (
        <VersionHistoryDrawer
          open={!!versionDrawer}
          onClose={() => setVersionDrawer(null)}
          entityType={versionDrawer.type}
          entityId={versionDrawer.id}
          entityTitle={versionDrawer.title}
        />
      )}
    </div>
  );
}

// ─── Messages Section ─────────────────────────────────────────────────────────

function MessagesSection({ onNavigate }: { onNavigate: (s: HubSection, entityId?: string) => void }) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [readFilter, setReadFilter] = useState("all");

  const { data: notifications = [], isLoading } = useQuery<ContractorNotification[]>({
    queryKey: ["/api/contractor-notifications"],
    select: (data: any) => snakeToCamel(data) as ContractorNotification[],
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/contractor-notifications/${id}/read`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/contractor-notifications"] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/contractor-notifications/mark-all-read", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/contractor-notifications"] }),
  });

  const filtered = notifications.filter(n => {
    const matchType = typeFilter === "all" ||
      (typeFilter === "proposal" && n.notificationType.startsWith("proposal")) ||
      (typeFilter === "contract" && n.notificationType.startsWith("contract")) ||
      (typeFilter === "invoice" && n.notificationType.startsWith("invoice")) ||
      (typeFilter === "payment" && n.notificationType.startsWith("payment"));
    const matchRead = readFilter === "all" ||
      (readFilter === "unread" && !n.isRead) ||
      (readFilter === "read" && n.isRead);
    return matchType && matchRead;
  });

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold">Messages & Notifications</h2>
          <p className="text-sm text-muted-foreground">All activity notifications for your workflow events</p>
        </div>
        {unreadCount > 0 && (
          <Button size="sm" variant="outline" onClick={() => markAllReadMutation.mutate()} disabled={markAllReadMutation.isPending} data-testid="btn-mark-all-read-messages">
            {markAllReadMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCheck className="h-3.5 w-3.5 mr-1" />}
            Mark all read ({unreadCount})
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-40" data-testid="select-notification-type">
            <Filter className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
            <SelectValue placeholder="Event Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Events</SelectItem>
            <SelectItem value="proposal">Proposals</SelectItem>
            <SelectItem value="contract">Contracts</SelectItem>
            <SelectItem value="invoice">Invoices</SelectItem>
            <SelectItem value="payment">Payments</SelectItem>
          </SelectContent>
        </Select>
        <Select value={readFilter} onValueChange={setReadFilter}>
          <SelectTrigger className="h-8 w-36" data-testid="select-notification-read-status">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="unread">Unread only</SelectItem>
            <SelectItem value="read">Read only</SelectItem>
          </SelectContent>
        </Select>
        {(typeFilter !== "all" || readFilter !== "all") && (
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setTypeFilter("all"); setReadFilter("all"); }}>
            <X className="h-3.5 w-3.5 mr-1" /> Clear filters
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 border border-dashed rounded-lg text-muted-foreground">
          <BellOff className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">{notifications.length === 0 ? "No notifications yet" : "No notifications match your filter"}</p>
          <p className="text-xs mt-1">Notifications are generated as you interact with proposals, contracts, and invoices</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(n => {
            const Icon = getNotificationIcon(n.notificationType);
            const color = getNotificationColor(n.notificationType);
            return (
              <div
                key={n.id}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer hover:bg-muted/30",
                  !n.isRead ? "bg-primary/5 border-primary/20" : "bg-background"
                )}
                data-testid={`notification-row-${n.id}`}
                onClick={() => {
                  if (!n.isRead) markReadMutation.mutate(n.id);
                  if (n.actionUrl) {
                    const url = new URL(n.actionUrl, window.location.href);
                    const section = url.searchParams.get("section") as HubSection | null;
                    const entityId = url.searchParams.get("id") || n.entityId || undefined;
                    if (section) onNavigate(section, entityId);
                  }
                }}
              >
                <div className={cn("mt-0.5 h-8 w-8 shrink-0 rounded-full flex items-center justify-center", !n.isRead ? "bg-primary/10" : "bg-muted")}>
                  <Icon className={cn("h-4 w-4", color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("text-sm leading-tight", !n.isRead && "font-semibold")}>{n.title}</p>
                    <span className="text-[10px] text-muted-foreground shrink-0">{fmtRelativeTime(n.createdAt)}</span>
                  </div>
                  {n.body && <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>}
                  <div className="flex items-center gap-2 mt-1.5">
                    {n.entityType && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">{n.entityType}</span>
                    )}
                    <span className="text-[10px] text-muted-foreground capitalize">{n.notificationType.replace(/_/g, " ")}</span>
                  </div>
                </div>
                {!n.isRead && (
                  <button
                    onClick={(e) => { e.stopPropagation(); markReadMutation.mutate(n.id); }}
                    className="text-xs text-primary hover:underline shrink-0 mt-0.5"
                    data-testid={`btn-mark-read-${n.id}`}
                  >
                    Mark read
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Branding Section ─────────────────────────────────────────────────────────

function BrandingSection() {
  const { toast } = useToast();
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const sectionIsAdmin = currentUser?.role === "admin" || currentUser?.role === "manager" ||
    (currentUser?.role || "").startsWith("tenant_") || (currentUser?.role || "").startsWith("platform_");

  const { data: branding, isLoading } = useQuery<any>({
    queryKey: ["/api/contractor-branding"],
    enabled: !sectionIsAdmin,
    queryFn: async () => {
      const r = await fetch("/api/contractor-branding", { credentials: "include" });
      if (r.status === 404) return null;
      return r.ok ? r.json() : null;
    },
  });

  useEffect(() => {
    if (branding && !dirty) {
      setForm({
        businessName: branding.business_name || "",
        contactName: branding.contact_name || "",
        tagline: branding.tagline || "",
        primaryColor: branding.primary_color || "#0f766e",
        secondaryColor: branding.secondary_color || "#64748b",
        websiteUrl: branding.website_url || "",
        licenseNumber: branding.license_number || "",
        signatureText: branding.signature_text || "",
        coverNote: branding.cover_note || "",
        footerText: branding.footer_text || "",
        insuranceInfo: branding.insurance_info || "",
        address: branding.address || "",
        phone: branding.phone || "",
        contactEmail: branding.contact_email || "",
      });
      if (branding.logo_url || branding.logo_path) setLogoPreview(branding.logo_url || branding.logo_path);
    }
  }, [branding, dirty]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => v && fd.append(k, v));
      if (logoFile) fd.append("logo", logoFile);
      // Explicitly signal logo removal — server MUST set logo_url/logo_path to NULL (not COALESCE)
      if (removeLogo) fd.append("removeLogo", "true");
      const r = await fetch("/api/contractor-branding", { method: "POST", credentials: "include", body: fd });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-branding"] });
      toast({ title: "Branding saved" });
      setDirty(false); setLogoFile(null); setRemoveLogo(false);
    },
    onError: (e: any) => toast({ title: e?.message || "Save failed", variant: "destructive" }),
  });

  function upd(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); setDirty(true); }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file); setRemoveLogo(false); setDirty(true);
    const reader = new FileReader();
    reader.onload = ev => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  if (sectionIsAdmin) return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3" data-testid="branding-admin-notice">
      <Briefcase className="h-10 w-10 text-muted-foreground/50" />
      <h3 className="font-medium text-base">Branding is a Contractor Feature</h3>
      <p className="text-sm text-muted-foreground max-w-sm">Profile & Branding lets contractors customize how proposals appear to clients. This section is only available for contractor accounts.</p>
    </div>
  );

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const accentColor = form.primaryColor || "#0f766e";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Profile & Branding</h2>
          <p className="text-sm text-muted-foreground">Customize how your proposals and invoices look to clients</p>
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !dirty} data-testid="btn-save-branding">
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
          Save Changes
        </Button>
      </div>

      {/* Logo Upload */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Image className="h-3.5 w-3.5" /> Logo</p>
          <div className="flex items-center gap-4">
            <div className="h-20 w-20 rounded-lg border-2 border-dashed flex items-center justify-center bg-muted/30 overflow-hidden shrink-0"
              style={{ borderColor: logoPreview ? accentColor : undefined }}>
              {logoPreview
                ? <img src={logoPreview} alt="Logo" className="h-full w-full object-contain" />
                : <Image className="h-8 w-8 text-muted-foreground/40" />}
            </div>
            <div className="space-y-2">
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} data-testid="input-logo-file" />
              <Button size="sm" variant="outline" onClick={() => logoInputRef.current?.click()} data-testid="btn-upload-logo">
                <Upload className="h-3.5 w-3.5 mr-1" /> {logoPreview ? "Change Logo" : "Upload Logo"}
              </Button>
              {logoPreview && (
                <Button size="sm" variant="ghost" className="text-red-500 text-xs" onClick={() => { setLogoPreview(null); setLogoFile(null); setRemoveLogo(true); setDirty(true); }} data-testid="btn-remove-logo">
                  Remove Logo
                </Button>
              )}
              <p className="text-xs text-muted-foreground">PNG, JPG or SVG · Max 2MB · Appears on proposals & invoices</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Business Identity */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Briefcase className="h-3.5 w-3.5" /> Business Identity</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <Label>Business / Company Name</Label>
              <Input value={form.businessName || ""} onChange={e => upd("businessName", e.target.value)} placeholder="Your business or trading name" data-testid="input-brand-name" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label>Contact Name</Label>
              <Input value={form.contactName || ""} onChange={e => upd("contactName", e.target.value)} placeholder="Your name or primary contact" data-testid="input-brand-contact-name" />
            </div>
            <div className="col-span-2">
              <Label>Tagline</Label>
              <Input value={form.tagline || ""} onChange={e => upd("tagline", e.target.value)} placeholder="Your professional tagline" data-testid="input-brand-tagline" />
            </div>
            <div className="col-span-2">
              <Label>Address</Label>
              <Input value={form.address || ""} onChange={e => upd("address", e.target.value)} placeholder="123 Main St, City, State ZIP" data-testid="input-brand-address" />
            </div>
            <div>
              <Label>Phone</Label>
              <div className="relative">
                <Phone className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" value={form.phone || ""} onChange={e => upd("phone", e.target.value)} placeholder="(555) 000-0000" data-testid="input-brand-phone" />
              </div>
            </div>
            <div>
              <Label>Email</Label>
              <div className="relative">
                <Mail className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" type="email" value={form.contactEmail || ""} onChange={e => upd("contactEmail", e.target.value)} placeholder="you@business.com" data-testid="input-brand-email" />
              </div>
            </div>
            <div>
              <Label>Website</Label>
              <div className="relative">
                <Globe className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" value={form.websiteUrl || ""} onChange={e => upd("websiteUrl", e.target.value)} placeholder="https://yoursite.com" data-testid="input-brand-website" />
              </div>
            </div>
            <div>
              <Label>License Number</Label>
              <Input value={form.licenseNumber || ""} onChange={e => upd("licenseNumber", e.target.value)} placeholder="Contractor license #" data-testid="input-brand-license" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Colors */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Paintbrush className="h-3.5 w-3.5" /> Brand Colors</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Primary Color</Label>
              <div className="flex items-center gap-2 mt-1">
                <input type="color" value={form.primaryColor || "#0f766e"} onChange={e => upd("primaryColor", e.target.value)} className="h-9 w-12 rounded border cursor-pointer" data-testid="input-brand-primary-color" />
                <Input value={form.primaryColor || "#0f766e"} onChange={e => upd("primaryColor", e.target.value)} className="flex-1 font-mono text-sm" data-testid="input-brand-primary-color-hex" />
              </div>
            </div>
            <div>
              <Label>Accent Color</Label>
              <div className="flex items-center gap-2 mt-1">
                <input type="color" value={form.secondaryColor || "#64748b"} onChange={e => upd("secondaryColor", e.target.value)} className="h-9 w-12 rounded border cursor-pointer" data-testid="input-brand-secondary-color" />
                <Input value={form.secondaryColor || "#64748b"} onChange={e => upd("secondaryColor", e.target.value)} className="flex-1 font-mono text-sm" data-testid="input-brand-secondary-color-hex" />
              </div>
            </div>
          </div>
          {/* Color swatch palette */}
          <div className="flex gap-2 flex-wrap">
            {["#0f766e","#0369a1","#7c3aed","#be123c","#b45309","#166534","#1e40af","#334155"].map(c => (
              <button key={c} className={cn("h-6 w-6 rounded-full border-2 transition-transform hover:scale-110", form.primaryColor === c ? "border-foreground scale-110" : "border-transparent")}
                style={{ background: c }} onClick={() => upd("primaryColor", c)} title={c} data-testid={`swatch-${c.replace("#","")}`} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Proposal Text */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Document Text</p>
          <div className="space-y-3">
            <div>
              <Label>Cover Note</Label>
              <Textarea value={form.coverNote || ""} onChange={e => upd("coverNote", e.target.value)} placeholder="Thank you for the opportunity to submit this proposal..." rows={3} data-testid="textarea-brand-cover" />
            </div>
            <div>
              <Label>Closing / Signature Text</Label>
              <Textarea value={form.signatureText || ""} onChange={e => upd("signatureText", e.target.value)} placeholder="Respectfully submitted..." rows={2} data-testid="textarea-brand-signature" />
            </div>
            <div>
              <Label>Footer Text</Label>
              <Input value={form.footerText || ""} onChange={e => upd("footerText", e.target.value)} placeholder="Footer displayed on proposals & invoices" data-testid="input-brand-footer" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Live Preview */}
      <div className="rounded-lg border-2 p-4" style={{ borderColor: accentColor }}>
        <p className="text-xs font-semibold mb-3 flex items-center gap-1.5 text-muted-foreground"><Eye className="h-3.5 w-3.5" /> Live Preview</p>
        <div className="rounded border bg-white dark:bg-background p-4 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {logoPreview && <img src={logoPreview} alt="Logo" className="h-10 w-10 object-contain rounded" />}
              <div>
                <p className="font-bold text-sm" style={{ color: accentColor }}>{form.businessName || "Your Business Name"}</p>
                {form.tagline && <p className="text-xs text-muted-foreground">{form.tagline}</p>}
                {form.contactName && <p className="text-xs text-muted-foreground">{form.contactName}</p>}
              </div>
            </div>
            <div className="text-right text-xs text-muted-foreground space-y-0.5">
              {form.address && <p>{form.address}</p>}
              {form.phone && <p>{form.phone}</p>}
              {form.contactEmail && <p>{form.contactEmail}</p>}
              {form.websiteUrl && <p>{form.websiteUrl}</p>}
              {form.licenseNumber && <p>Lic. #{form.licenseNumber}</p>}
            </div>
          </div>
          <div className="h-px w-full" style={{ background: accentColor, opacity: 0.3 }} />
          {form.coverNote && <p className="text-xs italic text-muted-foreground">{form.coverNote.slice(0,120)}{form.coverNote.length > 120 ? "..." : ""}</p>}
          {form.footerText && <p className="text-xs text-center text-muted-foreground border-t pt-2 mt-2">{form.footerText}</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Settings Section ─────────────────────────────────────────────────────────

const NOTIFICATION_EVENTS = [
  { key: "contract_sent", label: "Contract Sent", desc: "When a contract is sent to a contractor for review" },
  { key: "signature_requested", label: "Signature Requested", desc: "When a signer is added and signature is needed" },
  { key: "signature_complete", label: "Signature Complete", desc: "When all signers have signed a contract" },
  { key: "contract_activated", label: "Contract Activated", desc: "When a contract is marked active" },
  { key: "contract_expiring", label: "Contract Expiring Soon", desc: "When a contract is within the expiry warning window" },
  { key: "contract_voided", label: "Contract Voided", desc: "When a contract is voided or terminated" },
  { key: "invoice_submitted", label: "Invoice Submitted", desc: "When a contractor submits an invoice for approval" },
  { key: "invoice_approved", label: "Invoice Approved", desc: "When an invoice is approved" },
  { key: "invoice_rejected", label: "Invoice Rejected", desc: "When an invoice is rejected" },
  { key: "invoice_paid", label: "Invoice Paid", desc: "When payment is recorded against an invoice" },
  { key: "budget_override_requested", label: "Budget Override Requested", desc: "When an invoice exceeds contract budget" },
  { key: "proposal_approved", label: "Proposal Approved", desc: "When a proposal is approved by the company" },
];

const PERMISSION_ROLES = ["contractor", "reviewer", "finance_approver", "tenant_admin", "global_admin"];
const PERMISSION_ACTIONS = [
  { key: "create_proposal", label: "Create Proposal" },
  { key: "submit_proposal", label: "Submit Proposal" },
  { key: "approve_proposal", label: "Approve Proposal" },
  { key: "counter_proposal", label: "Counter Proposal" },
  { key: "generate_contract", label: "Generate Contract" },
  { key: "sign_contract", label: "Sign Contract" },
  { key: "create_invoice", label: "Create Invoice" },
  { key: "approve_invoice", label: "Approve Invoice" },
  { key: "record_payment", label: "Record Payment" },
  { key: "manage_templates", label: "Manage Templates" },
  { key: "configure_workflow", label: "Configure Workflow" },
];

const DEFAULT_MATRIX: Record<string, Record<string, boolean>> = {
  contractor: { create_proposal: true, submit_proposal: true, approve_proposal: false, counter_proposal: true, generate_contract: false, sign_contract: true, create_invoice: true, approve_invoice: false, record_payment: false, manage_templates: false, configure_workflow: false },
  reviewer: { create_proposal: false, submit_proposal: false, approve_proposal: true, counter_proposal: true, generate_contract: false, sign_contract: false, create_invoice: false, approve_invoice: false, record_payment: false, manage_templates: false, configure_workflow: false },
  finance_approver: { create_proposal: false, submit_proposal: false, approve_proposal: false, counter_proposal: false, generate_contract: false, sign_contract: false, create_invoice: false, approve_invoice: true, record_payment: true, manage_templates: false, configure_workflow: false },
  tenant_admin: { create_proposal: true, submit_proposal: true, approve_proposal: true, counter_proposal: true, generate_contract: true, sign_contract: true, create_invoice: true, approve_invoice: true, record_payment: true, manage_templates: true, configure_workflow: true },
  global_admin: { create_proposal: true, submit_proposal: true, approve_proposal: true, counter_proposal: true, generate_contract: true, sign_contract: true, create_invoice: true, approve_invoice: true, record_payment: true, manage_templates: true, configure_workflow: true },
};

function SettingsSection() {
  const { toast } = useToast();
  const [settingsTab, setSettingsTab] = useState("templates");
  const [tplDialog, setTplDialog] = useState<{open: boolean; tpl?: any}>({ open: false });
  const [tplForm, setTplForm] = useState<Record<string, any>>({});
  const [wfDirty, setWfDirty] = useState(false);
  const [wfForm, setWfForm] = useState<Record<string, any>>({});
  const [matrix, setMatrix] = useState<Record<string, Record<string, boolean>>>(DEFAULT_MATRIX);
  const [notifRules, setNotifRules] = useState<Record<string, {inApp: boolean; email: boolean; sms: boolean}>>({});
  const [matrixDirty, setMatrixDirty] = useState(false);
  const [notifDirty, setNotifDirty] = useState(false);

  const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "manager" || currentUser?.role === "supervisor" ||
    (currentUser?.role || "").startsWith("tenant_") || (currentUser?.role || "").startsWith("platform_");
  const isPlatformUser = (currentUser?.role || "").startsWith("platform_");
  const isPlatformAdmin = currentUser?.role === "platform_super_admin" || currentUser?.role === "platform_admin";

  const { data: smtpConfig } = useQuery<{host?: string; enabled?: boolean} | null>({
    queryKey: ["/api/admin/smtp-config"],
    enabled: isAdmin,
    queryFn: async () => { const r = await fetch("/api/admin/smtp-config", { credentials: "include" }); return r.ok ? r.json() : null; },
  });
  const { data: smsConfig } = useQuery<{sid?: string; enabled?: boolean} | null>({
    queryKey: ["/api/admin/sms-config"],
    enabled: isAdmin,
    queryFn: async () => { const r = await fetch("/api/admin/sms-config", { credentials: "include" }); return r.ok ? r.json() : null; },
  });
  const emailConfigured = !!(smtpConfig?.host);
  const smsConfigured = !!(smsConfig?.sid);

  const { data: templates = [], refetch: refetchTemplates } = useQuery<any[]>({
    queryKey: ["/api/contractor-templates/admin-all"],
    enabled: isAdmin,
    queryFn: async () => {
      const r = await fetch("/api/contractor-templates/admin-all", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const { data: wfSettings } = useQuery<any>({
    queryKey: ["/api/contractor-workflow-settings"],
    enabled: isAdmin,
    queryFn: async () => {
      const r = await fetch("/api/contractor-workflow-settings", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });

  useEffect(() => {
    if (wfSettings && !wfDirty) {
      setWfForm({
        minReviewers: wfSettings.minReviewers ?? 1,
        reviewMode: wfSettings.reviewMode ?? "parallel",
        tradeEnabled: wfSettings.tradeEnabled ?? true,
        contractSigOverdueDays: wfSettings.contractSigOverdueDays ?? 7,
        contractRenewalWarningDays: wfSettings.contractRenewalWarningDays ?? 30,
        contractExpiryWarningDays: wfSettings.contractExpiryWarningDays ?? 14,
        invoiceDueReminderDays: wfSettings.invoiceDueReminderDays ?? 3,
        invoiceOverdueReminderDays: wfSettings.invoiceOverdueReminderDays ?? 1,
        contractRenegotiationWarningDays: wfSettings.contractRenegotiationWarningDays ?? 14,
      });
      if (wfSettings.notificationRules && Object.keys(wfSettings.notificationRules).length > 0) {
        setNotifRules(wfSettings.notificationRules);
      } else {
        const defaults: Record<string, {inApp: boolean; email: boolean; sms: boolean}> = {};
        NOTIFICATION_EVENTS.forEach(e => { defaults[e.key] = { inApp: true, email: true, sms: false }; });
        setNotifRules(defaults);
      }
      if (wfSettings.permissionMatrix && Object.keys(wfSettings.permissionMatrix).length > 0) {
        setMatrix({ ...DEFAULT_MATRIX, ...wfSettings.permissionMatrix });
      }
    }
  }, [wfSettings, wfDirty]);

  // Template mutations
  const createTplMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/contractor-templates", tplForm),
    onSuccess: () => { refetchTemplates(); setTplDialog({ open: false }); toast({ title: "Template created" }); },
    onError: (e: any) => toast({ title: e?.message || "Failed", variant: "destructive" }),
  });
  const updateTplMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/contractor-templates/${tplDialog.tpl?.id}`, tplForm),
    onSuccess: () => { refetchTemplates(); setTplDialog({ open: false }); toast({ title: "Template updated" }); },
    onError: (e: any) => toast({ title: e?.message || "Failed", variant: "destructive" }),
  });
  const toggleTplMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/contractor-templates/${id}`, { isActive }),
    onSuccess: () => { refetchTemplates(); toast({ title: "Template updated" }); },
    onError: (e: any) => toast({ title: e?.message || "Failed", variant: "destructive" }),
  });
  const setDefaultTplMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/contractor-templates/${id}/set-default`, {}),
    onSuccess: () => { refetchTemplates(); toast({ title: "Default set" }); },
    onError: (e: any) => toast({ title: e?.message || "Failed", variant: "destructive" }),
  });

  // Workflow/reminder settings save
  const saveWfMutation = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/contractor-workflow-settings", {
      ...wfForm, notificationRules: notifRules, permissionMatrix: matrix,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-workflow-settings"] });
      setWfDirty(false); setMatrixDirty(false); setNotifDirty(false);
      toast({ title: "Settings saved" });
    },
    onError: (e: any) => toast({ title: e?.message || "Failed to save settings", variant: "destructive" }),
  });

  function updWf(k: string, v: any) { setWfForm(f => ({ ...f, [k]: v })); setWfDirty(true); }
  function toggleMatrix(role: string, action: string) {
    setMatrix(m => ({ ...m, [role]: { ...(m[role] || {}), [action]: !(m[role]?.[action]) } }));
    setMatrixDirty(true);
  }
  function toggleNotif(key: string, channel: "inApp"|"email"|"sms") {
    setNotifRules(r => ({ ...r, [key]: { ...(r[key] || { inApp: true, email: false, sms: false }), [channel]: !r[key]?.[channel] } }));
    setNotifDirty(true);
  }

  if (!isAdmin) return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <Settings className="h-10 w-10 text-muted-foreground/50" />
      <h3 className="font-medium">Settings are admin-only</h3>
      <p className="text-sm text-muted-foreground max-w-sm">Contact your administrator to change workflow settings.</p>
    </div>
  );

  const TABS = [
    { id: "templates", label: "Templates", icon: Layers },
    { id: "workflow", label: "Workflow", icon: SlidersHorizontal },
    { id: "reminders", label: "Reminders", icon: Bell },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "permissions", label: "Permissions", icon: Shield },
  ];

  const hasUnsaved = wfDirty || matrixDirty || notifDirty;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Settings</h2>
          <p className="text-sm text-muted-foreground">Templates, workflow rules, reminders, and permissions</p>
        </div>
        {hasUnsaved && (
          <Button onClick={() => saveWfMutation.mutate()} disabled={saveWfMutation.isPending} data-testid="btn-save-settings">
            {saveWfMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Save Settings
          </Button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b pb-0">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setSettingsTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors",
              settingsTab === t.id ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
            data-testid={`tab-settings-${t.id}`}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* ── TEMPLATES TAB ── */}
      {settingsTab === "templates" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{templates.length} template{templates.length !== 1 ? "s" : ""}</p>
            <Button size="sm" onClick={() => { setTplForm({ templateType: "proposal", isActive: true }); setTplDialog({ open: true }); }} data-testid="btn-new-template">
              <Plus className="h-4 w-4 mr-1" /> New Template
            </Button>
          </div>
          {templates.length === 0 ? (
            <div className="text-center py-10 border border-dashed rounded-lg text-muted-foreground">
              <Layers className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">No templates yet</p>
              <p className="text-xs mt-1">Create proposal or invoice templates for your team</p>
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((tpl: any) => (
                <div key={tpl.id} className={cn("border rounded-lg p-3 flex items-center gap-3", !tpl.is_active && "opacity-50")} data-testid={`row-template-${tpl.id}`}>
                  <div className={cn("h-8 w-8 rounded flex items-center justify-center shrink-0",
                    tpl.template_type === "proposal" ? "bg-blue-50 text-blue-600" : "bg-green-50 text-green-600")}>
                    {tpl.template_type === "proposal" ? <FileText className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">{tpl.name}</p>
                      <span className={cn("text-xs rounded px-1.5 py-0.5", tpl.is_active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500")}>
                        {tpl.is_active ? "Active" : "Disabled"}
                      </span>
                      {tpl.is_default && <span className="text-xs bg-primary/10 text-primary rounded px-1.5 py-0.5">Default</span>}
                      {tpl.is_global && <span className="text-xs bg-amber-50 text-amber-700 rounded px-1.5 py-0.5">Global</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex gap-2">
                      <span className="capitalize">{tpl.template_type}</span>
                      {tpl.industry && <><span>·</span><span>{tpl.industry}</span></>}
                      {tpl.layout_variant && <><span>·</span><span className="capitalize">{tpl.layout_variant}</span></>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {(tpl.is_global || !tpl.company_id) && !isPlatformAdmin ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground" title="Global template — read-only for tenant admins">Global</span>
                    ) : (
                      <>
                        {!tpl.is_default && tpl.is_active && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDefaultTplMutation.mutate(tpl.id)} data-testid={`btn-set-default-${tpl.id}`}>Set Default</Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                          setTplForm(normalizeTemplate(tpl));
                          setTplDialog({ open: true, tpl });
                        }} data-testid={`btn-edit-tpl-${tpl.id}`}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground"
                          onClick={() => toggleTplMutation.mutate({ id: tpl.id, isActive: !tpl.is_active })} data-testid={`btn-toggle-tpl-${tpl.id}`}>
                          {tpl.is_active ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle className="h-3.5 w-3.5" />}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── WORKFLOW TAB ── */}
      {settingsTab === "workflow" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-5 space-y-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Approval Settings</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Minimum Reviewers</Label>
                  <Input type="number" min={1} max={10} value={wfForm.minReviewers ?? 1}
                    onChange={e => updWf("minReviewers", parseInt(e.target.value) || 1)} data-testid="input-min-reviewers" />
                  <p className="text-xs text-muted-foreground mt-1">How many reviewers must approve before submission proceeds</p>
                </div>
                <div>
                  <Label>Review Mode</Label>
                  <Select value={wfForm.reviewMode ?? "parallel"} onValueChange={v => updWf("reviewMode", v)}>
                    <SelectTrigger data-testid="select-review-mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="parallel">Parallel (any reviewer can approve)</SelectItem>
                      <SelectItem value="sequential">Sequential (reviewers approve in order)</SelectItem>
                      <SelectItem value="committee">Committee (all must approve)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Separator />
              <div>
                <Label>Reviewer Pool — Authorized Approver Roles</Label>
                <p className="text-xs text-muted-foreground mb-2">Select the roles that are authorized to review and approve proposals and contracts. Users with these roles will be eligible reviewers.</p>
                <div className="flex flex-wrap gap-1.5" data-testid="reviewer-roles-multiselect">
                  {[
                    { value: "tenant_owner", label: "Owner" },
                    { value: "tenant_admin", label: "Admin" },
                    { value: "tenant_hr_admin", label: "HR Admin" },
                    { value: "tenant_payroll_admin", label: "Payroll Admin" },
                    { value: "tenant_finance_admin", label: "Finance Admin" },
                    { value: "tenant_manager", label: "Manager" },
                    { value: "tenant_supervisor", label: "Supervisor" },
                  ].map(role => {
                    const currentRoles = String(wfForm.reviewerPool || "").split(",").map(r => r.trim()).filter(Boolean);
                    const selected = currentRoles.includes(role.value);
                    return (
                      <button key={role.value} type="button"
                        onClick={() => {
                          const next = selected ? currentRoles.filter(r => r !== role.value) : [...currentRoles, role.value];
                          updWf("reviewerPool", next.join(", "));
                        }}
                        className={cn("text-xs px-2.5 py-1 rounded-full border transition-colors", selected ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground")}
                        data-testid={`role-reviewer-${role.value}`}>
                        <Users className="h-2.5 w-2.5 inline mr-1" />{role.label}
                      </button>
                    );
                  })}
                </div>
                {wfForm.reviewerPool && (
                  <p className="text-xs text-muted-foreground mt-2">Selected: {String(wfForm.reviewerPool).split(",").map(r => r.trim()).filter(Boolean).join(", ") || "None"}</p>
                )}
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Enable Trade / Non-Cash Compensation</p>
                  <p className="text-xs text-muted-foreground">Allow proposals and invoices to include trade or barter components</p>
                </div>
                <button onClick={() => updWf("tradeEnabled", !wfForm.tradeEnabled)}
                  className={cn("relative inline-flex h-6 w-11 rounded-full transition-colors", wfForm.tradeEnabled ? "bg-primary" : "bg-muted-foreground/30")}
                  data-testid="toggle-trade-enabled">
                  <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform mt-0.5",
                    wfForm.tradeEnabled ? "translate-x-5" : "translate-x-0.5")} />
                </button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5 space-y-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Document Archive & Retention</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Retention Period (months)</Label>
                  <Input type="number" min={1} max={120} value={wfForm.documentRetentionMonths ?? 84}
                    onChange={e => updWf("documentRetentionMonths", parseInt(e.target.value) || 84)}
                    data-testid="input-doc-retention-months" />
                  <p className="text-xs text-muted-foreground mt-1">Auto-archive documents older than this period (default: 84 months / 7 years)</p>
                </div>
                <div>
                  <Label>Archive After Inactivity (days)</Label>
                  <Input type="number" min={30} max={3650} value={wfForm.documentArchiveAfterDays ?? 365}
                    onChange={e => updWf("documentArchiveAfterDays", parseInt(e.target.value) || 365)}
                    data-testid="input-doc-archive-after-days" />
                  <p className="text-xs text-muted-foreground mt-1">Archive completed/voided docs after this many days of inactivity</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Auto-Archive Completed Contracts</p>
                  <p className="text-xs text-muted-foreground">Automatically move completed/voided contracts to the archive</p>
                </div>
                <button onClick={() => updWf("autoArchiveEnabled", !wfForm.autoArchiveEnabled)}
                  className={cn("relative inline-flex h-6 w-11 rounded-full transition-colors", wfForm.autoArchiveEnabled ? "bg-primary" : "bg-muted-foreground/30")}
                  data-testid="toggle-auto-archive">
                  <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform mt-0.5",
                    wfForm.autoArchiveEnabled ? "translate-x-5" : "translate-x-0.5")} />
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── REMINDERS TAB ── */}
      {settingsTab === "reminders" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-5 space-y-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contract Reminder Intervals</p>
              {[
                { key: "contractSigOverdueDays", label: "Signature Overdue Reminder", hint: "Days after sending before overdue warning" },
                { key: "contractRenewalWarningDays", label: "Renewal Warning", hint: "Days before contract end to warn of upcoming renewal" },
                { key: "contractExpiryWarningDays", label: "Expiry Warning", hint: "Days before expiry to send expiry warning" },
                { key: "contractRenegotiationWarningDays", label: "Renegotiation Warning", hint: "Days before renegotiation deadline to send alert" },
              ].map(({ key, label, hint }) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{hint}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Input type="number" min={1} max={365} className="w-20 text-center"
                      value={wfForm[key] ?? 7} onChange={e => updWf(key, parseInt(e.target.value) || 1)}
                      data-testid={`input-${key}`} />
                    <span className="text-xs text-muted-foreground w-8">days</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5 space-y-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Invoice Reminder Intervals</p>
              {[
                { key: "invoiceDueReminderDays", label: "Due Date Reminder", hint: "Days before due date to send reminder" },
                { key: "invoiceOverdueReminderDays", label: "Overdue Escalation", hint: "Days after due date before overdue escalation" },
              ].map(({ key, label, hint }) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{hint}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Input type="number" min={1} max={365} className="w-20 text-center"
                      value={wfForm[key] ?? 3} onChange={e => updWf(key, parseInt(e.target.value) || 1)}
                      data-testid={`input-${key}`} />
                    <span className="text-xs text-muted-foreground w-8">days</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── NOTIFICATIONS TAB ── */}
      {settingsTab === "notifications" && (
        <div className="space-y-3">
          {(!emailConfigured || !smsConfigured) && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-300">Some notification channels are unavailable</p>
                <p className="text-amber-700 dark:text-amber-400 mt-0.5">
                  {!emailConfigured && <span>Email (SMTP) is not configured — toggles disabled. </span>}
                  {!smsConfigured && <span>SMS (Twilio) is not configured — toggles disabled. </span>}
                  Contact your platform administrator to enable these channels.
                </p>
              </div>
            </div>
          )}
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-1 border-b text-xs font-semibold text-muted-foreground uppercase">
            <span>Event</span>
            <span className="w-14 text-center">In-App</span>
            <span className="w-14 text-center">
              Email {!emailConfigured && <span className="text-amber-500">⚠</span>}
            </span>
            <span className="w-14 text-center">
              SMS {!smsConfigured && <span className="text-amber-500">⚠</span>}
            </span>
          </div>
          {NOTIFICATION_EVENTS.map(ev => {
            const rule = notifRules[ev.key] || { inApp: true, email: false, sms: false };
            return (
              <div key={ev.key} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-2 border rounded-lg" data-testid={`row-notif-${ev.key}`}>
                <div>
                  <p className="text-sm font-medium">{ev.label}</p>
                  <p className="text-xs text-muted-foreground">{ev.desc}</p>
                </div>
                {(["inApp","email","sms"] as const).map(ch => {
                  const providerAvailable = ch === "email" ? emailConfigured : ch === "sms" ? smsConfigured : true;
                  const isOn = rule[ch] && providerAvailable;
                  return (
                    <div key={ch} className="w-14 flex justify-center" title={!providerAvailable ? `${ch === "email" ? "SMTP" : "SMS"} not configured` : undefined}>
                      <button onClick={() => providerAvailable && toggleNotif(ev.key, ch)}
                        disabled={!providerAvailable}
                        className={cn("h-5 w-9 rounded-full transition-colors",
                          !providerAvailable ? "opacity-30 cursor-not-allowed bg-muted-foreground/20" :
                          isOn ? "bg-primary" : "bg-muted-foreground/30")}
                        data-testid={`toggle-notif-${ev.key}-${ch}`}>
                        <span className={cn("block h-4 w-4 rounded-full bg-white shadow mx-auto transition-transform",
                          isOn ? "translate-x-2" : "-translate-x-2")} />
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* ── PERMISSIONS TAB ── */}
      {settingsTab === "permissions" && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Toggle cells to grant or revoke permissions per role. Changes apply to new sessions.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse" data-testid="permission-matrix">
              <thead>
                <tr>
                  <th className="text-left py-2 px-3 font-semibold text-muted-foreground border-b w-36">Role</th>
                  {PERMISSION_ACTIONS.map(a => (
                    <th key={a.key} className="py-2 px-1 font-medium text-muted-foreground border-b text-center" style={{ minWidth: 70 }}>
                      <span className="block leading-tight">{a.label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_ROLES.map(role => (
                  <tr key={role} className="border-b hover:bg-muted/30">
                    <td className="py-2 px-3 font-medium capitalize">{role.replace(/_/g, " ")}</td>
                    {PERMISSION_ACTIONS.map(action => {
                      const allowed = matrix[role]?.[action.key] ?? false;
                      return (
                        <td key={action.key} className="py-2 px-1 text-center">
                          <button onClick={() => toggleMatrix(role, action.key)}
                            className={cn("h-6 w-6 rounded mx-auto flex items-center justify-center transition-colors",
                              allowed ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}
                            data-testid={`perm-${role}-${action.key}`}>
                            {allowed ? <CheckSquare className="h-3.5 w-3.5" /> : <span className="h-3 w-3 rounded-sm border border-current" />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Template create/edit dialog */}
      <Dialog open={tplDialog.open} onOpenChange={v => !v && setTplDialog({ open: false })}>
        <DialogContent className="max-w-md" data-testid="dialog-template-form">
          <DialogHeader>
            <DialogTitle>{tplDialog.tpl ? "Edit Template" : "Create Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Template Name</Label>
              <Input value={tplForm.name || ""} onChange={e => setTplForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Standard Service Proposal" data-testid="input-tpl-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={tplForm.templateType || "proposal"} onValueChange={v => setTplForm(f => ({ ...f, templateType: v }))}>
                  <SelectTrigger data-testid="select-tpl-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="proposal">Proposal</SelectItem>
                    <SelectItem value="invoice">Invoice</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Layout</Label>
                <Select value={tplForm.layoutVariant || "standard"} onValueChange={v => setTplForm(f => ({ ...f, layoutVariant: v }))}>
                  <SelectTrigger data-testid="select-tpl-layout"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="minimal">Minimal</SelectItem>
                    <SelectItem value="detailed">Detailed</SelectItem>
                    <SelectItem value="branded">Branded</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Industry / Category Tags</Label>
              <p className="text-xs text-muted-foreground mb-2">Select all that apply</p>
              <div className="flex flex-wrap gap-1.5" data-testid="industry-tags-multiselect">
                {["construction","electrical","plumbing","landscaping","hvac","roofing","painting","flooring","consulting","technology","design","marketing","finance","legal","healthcare","retail","food_service","manufacturing","transportation","education","other"].map(tag => {
                  const selected = String(tplForm.industry || "").split(",").map(t => t.trim()).filter(Boolean).includes(tag);
                  return (
                    <button key={tag} type="button"
                      onClick={() => {
                        const current = String(tplForm.industry || "").split(",").map(t => t.trim()).filter(Boolean);
                        const next = selected ? current.filter(t => t !== tag) : [...current, tag];
                        setTplForm(f => ({ ...f, industry: next.join(", ") }));
                      }}
                      className={cn("text-xs px-2.5 py-1 rounded-full border transition-colors", selected ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground")}
                      data-testid={`tag-industry-${tag}`}>
                      {tag.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <Label>Work Type Tags</Label>
              <p className="text-xs text-muted-foreground mb-2">Select the work structures this template supports</p>
              <div className="flex flex-wrap gap-1.5" data-testid="work-type-tags-multiselect">
                {["hourly","fixed_price","milestone","time_and_materials","cost_plus","retainer","trade","subscription","project_based","ongoing"].map(tag => {
                  const selected = String(tplForm.workTypeTags || "").split(",").map(t => t.trim()).filter(Boolean).includes(tag);
                  return (
                    <button key={tag} type="button"
                      onClick={() => {
                        const current = String(tplForm.workTypeTags || "").split(",").map(t => t.trim()).filter(Boolean);
                        const next = selected ? current.filter(t => t !== tag) : [...current, tag];
                        setTplForm(f => ({ ...f, workTypeTags: next.join(", ") }));
                      }}
                      className={cn("text-xs px-2.5 py-1 rounded-full border transition-colors", selected ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground")}
                      data-testid={`tag-worktype-${tag}`}>
                      {tag.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={tplForm.description || ""} onChange={e => setTplForm(f => ({ ...f, description: e.target.value }))} rows={2} data-testid="textarea-tpl-desc" />
            </div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <button onClick={() => setTplForm(f => ({ ...f, isActive: !f.isActive }))}
                className={cn("relative inline-flex h-5 w-9 rounded-full transition-colors", tplForm.isActive !== false ? "bg-primary" : "bg-muted-foreground/30")}
                data-testid="toggle-tpl-active">
                <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5",
                  tplForm.isActive !== false ? "translate-x-4" : "translate-x-0.5")} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <Label>Set as Default</Label>
              <button onClick={() => setTplForm(f => ({ ...f, isDefault: !f.isDefault }))}
                className={cn("relative inline-flex h-5 w-9 rounded-full transition-colors", tplForm.isDefault ? "bg-primary" : "bg-muted-foreground/30")}
                data-testid="toggle-tpl-default">
                <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5",
                  tplForm.isDefault ? "translate-x-4" : "translate-x-0.5")} />
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTplDialog({ open: false })}>Cancel</Button>
            <Button onClick={() => tplDialog.tpl ? updateTplMutation.mutate() : createTplMutation.mutate()}
              disabled={createTplMutation.isPending || updateTplMutation.isPending} data-testid="btn-save-template">
              {(createTplMutation.isPending || updateTplMutation.isPending) ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {tplDialog.tpl ? "Save Changes" : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  const [location] = useLocation();
  const initialSection = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const s = params.get("section") as HubSection | null;
      const valid: HubSection[] = ["dashboard","proposals","contracts","invoices","payments","documents","messages","branding","settings"];
      return (s && valid.includes(s)) ? s : "dashboard";
    } catch { return "dashboard"; }
  })();
  const [section, setSection] = useState<HubSection>(initialSection);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [sortBy, setSortBy] = useState("date_desc");
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingProposal, setEditingProposal] = useState<Proposal | null>(null);
  const [newProposal, setNewProposal] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isAdmin = user?.role === "admin" || user?.role === "manager" || user?.role === "supervisor" ||
    user?.role?.startsWith("tenant_") || user?.role?.startsWith("platform_");

  const { data: proposals = [], isLoading: proposalsLoading } = useQuery<Proposal[]>({
    queryKey: ["/api/contractor-proposals"],
    select: (data: any) => snakeToCamel(data),
  });

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/contractor-invoices"],
    select: (data: any) => snakeToCamel(data),
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

  const allCompanies = Array.from(new Set(proposals.map(p => p.companyId).filter(Boolean)))
    .map(id => ({ id, name: (proposals.find(p => p.companyId === id) as any)?.companyName || id }));

  const filteredProposals = proposals
    .filter(p => {
      const matchSearch = !search || p.title?.toLowerCase().includes(search.toLowerCase()) || p.proposalNumber?.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "all" || p.status === statusFilter;
      const matchCompany = companyFilter === "all" || p.companyId === companyFilter;
      return matchSearch && matchStatus && matchCompany;
    })
    .sort((a, b) => {
      if (sortBy === "date_desc") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortBy === "date_asc") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (sortBy === "amount_desc") return parseFloat(b.amount || "0") - parseFloat(a.amount || "0");
      if (sortBy === "amount_asc") return parseFloat(a.amount || "0") - parseFloat(b.amount || "0");
      return 0;
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
  const { data: navNotifications = [] } = useQuery<ContractorNotification[]>({
    queryKey: ["/api/contractor-notifications"],
    select: (data: any) => snakeToCamel(data) as ContractorNotification[],
    refetchInterval: 30000,
  });
  const unreadMessages = navNotifications.filter((n: ContractorNotification) => !n.isRead).length;

  // Pending reminders for inline badges
  const { data: allPendingReminders = [] } = useQuery<ContractorReminder[]>({
    queryKey: ["/api/contractor-reminders", "pending"],
    queryFn: async () => {
      const r = await fetch("/api/contractor-reminders?status=pending", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    select: (data: any) => snakeToCamel(data) as ContractorReminder[],
    refetchInterval: 60000,
  });
  const reminderEntityIds = new Set(allPendingReminders.map(r => r.entityId).filter(Boolean));

  const [deepLinkContractId, setDeepLinkContractId] = useState<string | null>(null);

  function handleSectionChange(s: HubSection, entityId?: string) {
    setSection(s);
    setSearch("");
    setStatusFilter("all");
    setCompanyFilter("all");
    setSortBy("date_desc");
    if (entityId) {
      if (s === "proposals") {
        const found = proposals.find(p => p.id === entityId);
        if (found) setSelectedProposal(found);
      }
      if (s === "invoices") {
        const found = invoices.find(i => i.id === entityId);
        if (found) setSelectedInvoice(found);
      }
      if (s === "contracts") {
        setDeepLinkContractId(entityId);
      }
    } else {
      setDeepLinkContractId(null);
    }
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
                item.id === "messages" ? unreadMessages :
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
              {section === "messages" && "Activity notifications and workflow events"}
              {section === "branding" && "Profile and proposal templates"}
              {section === "settings" && "Hub configuration"}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <NotificationBell onNavigate={handleSectionChange} />
            {section === "proposals" && (
              <Button onClick={openBuilderForNew} data-testid="btn-new-proposal">
                <Plus className="h-4 w-4 mr-1" /> New Proposal
              </Button>
            )}
          </div>
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
                <div className="flex flex-wrap items-center gap-2">
                  <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search proposals..." className="h-8 max-w-xs flex-1 min-w-[160px]" data-testid="input-search-proposals" />
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-8 w-36" data-testid="select-proposal-status-filter"><SelectValue placeholder="All Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      {Object.entries(PROPOSAL_STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {isAdmin && allCompanies.length > 0 && (
                    <Select value={companyFilter} onValueChange={setCompanyFilter}>
                      <SelectTrigger className="h-8 w-40" data-testid="select-proposal-company-filter"><SelectValue placeholder="All Companies" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Companies</SelectItem>
                        {allCompanies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  <Select value={sortBy} onValueChange={setSortBy}>
                    <SelectTrigger className="h-8 w-36" data-testid="select-proposal-sort">
                      <ArrowUpDown className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                      <SelectValue placeholder="Sort" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="date_desc">Newest First</SelectItem>
                      <SelectItem value="date_asc">Oldest First</SelectItem>
                      <SelectItem value="amount_desc">Amount: High → Low</SelectItem>
                      <SelectItem value="amount_asc">Amount: Low → High</SelectItem>
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
            {section === "contracts" && <ContractsSection isAdmin={isAdmin} reminderEntityIds={reminderEntityIds} initialSelectedId={deepLinkContractId} />}

            {/* Invoices */}
            {section === "invoices" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoices..." className="h-8 max-w-xs" data-testid="input-search-invoices" />
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-8 w-40" data-testid="select-invoice-status-filter"><SelectValue placeholder="All Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      {Object.entries(INVOICE_STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {!isAdmin && invoices.some(i => i.status === "draft") && (
                    <p className="text-xs text-muted-foreground ml-auto">
                      Draft invoices can be submitted for approval using the Submit button on each row.
                    </p>
                  )}
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
                        <div key={invoice.id} className="border rounded-lg p-4 hover:bg-muted/30 transition-colors"
                          data-testid={`row-invoice-${invoice.id}`}>
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelectedInvoice(invoice)}>
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium text-sm">Invoice #{invoice.invoiceNumber || invoice.id.slice(0, 8)}</p>
                                {invoice.title && <p className="text-sm text-muted-foreground truncate">{invoice.title}</p>}
                                <InvoiceBadge status={isOverdue ? "overdue" : invoice.status} />
                                {isBlocked && (
                                  <span className="inline-flex items-center gap-1 text-xs text-orange-600 bg-orange-50 dark:bg-orange-950/20 rounded px-1.5 py-0.5">
                                    <Lock className="h-3 w-3" /> Proposal not approved
                                  </span>
                                )}
                                {reminderEntityIds.has(invoice.id) && (
                                  <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 rounded px-1.5 py-0.5" data-testid={`badge-reminder-invoice-${invoice.id}`}>
                                    <Clock className="h-3 w-3" /> Reminder
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
                            <div className="flex items-center gap-2 shrink-0">
                              {!isAdmin && invoice.status === "draft" && !isBlocked && (
                                <Button size="sm" variant="outline" className="h-7 text-xs border-primary text-primary hover:bg-primary/10"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      await apiRequest("POST", `/api/contractor-invoices/${invoice.id}/submit`, {});
                                      queryClient.invalidateQueries({ queryKey: ["/api/contractor-invoices"] });
                                      toast({ title: "Invoice submitted for approval" });
                                    } catch {
                                      toast({ title: "Failed to submit invoice", variant: "destructive" });
                                    }
                                  }}
                                  data-testid={`btn-submit-invoice-${invoice.id}`}>
                                  <Send className="h-3 w-3 mr-1" /> Submit
                                </Button>
                              )}
                              {!isAdmin && invoice.status === "draft" && isBlocked && (
                                <span className="text-xs text-muted-foreground italic">Awaiting proposal approval</span>
                              )}
                              <a href={`/api/contractor-invoices/${invoice.id}/download`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} data-testid={`btn-download-invoice-${invoice.id}`}>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Download invoice">
                                  <Download className="h-3.5 w-3.5 text-muted-foreground" />
                                </Button>
                              </a>
                              <ChevronRight className="h-4 w-4 text-muted-foreground mt-0.5 cursor-pointer" onClick={() => setSelectedInvoice(invoice)} />
                            </div>
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
            {section === "messages" && <MessagesSection onNavigate={handleSectionChange} />}

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
