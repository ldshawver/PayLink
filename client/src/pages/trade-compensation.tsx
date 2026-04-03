import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  ArrowLeft, Plus, Upload, Trash2, Eye, CheckCircle2, XCircle, Send,
  Flag, Clock, AlertTriangle, FileText, Paperclip, History, DollarSign,
  RefreshCw, ChevronRight, Download, BarChart3,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────
type TradeStatus = "draft" | "pending_review" | "approved" | "rejected" | "completed" | "cancelled";

interface TradeTransaction {
  id: string;
  companyId: string;
  title: string;
  transactionType: string;
  counterpartyType: string;
  counterpartyId: string | null;
  counterpartyName: string;
  description: string | null;
  fairMarketValue: string;
  currency: string;
  status: TradeStatus;
  isReportable: boolean;
  taxYear: number | null;
  reportingNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface TradeItem {
  id: string;
  tradeTransactionId: string;
  description: string;
  itemType: string;
  direction: string;
  fairMarketValue: string;
  quantity: string;
  unit: string | null;
  notes: string | null;
  createdAt: string;
}

interface TradeAttachment {
  id: string;
  tradeTransactionId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string | null;
  uploadedBy: string;
  createdAt: string;
}

interface TradeAuditLog {
  id: string;
  action: string;
  oldStatus: string | null;
  newStatus: string | null;
  note: string | null;
  userId: string;
  createdAt: string;
}

// ── Status helpers ─────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<TradeStatus, { label: string; color: string; icon: any }> = {
  draft: { label: "Draft", color: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200", icon: FileText },
  pending_review: { label: "Pending Review", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300", icon: Clock },
  approved: { label: "Approved", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300", icon: CheckCircle2 },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300", icon: XCircle },
  completed: { label: "Completed", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400", icon: XCircle },
};

function StatusBadge({ status }: { status: TradeStatus }) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: "bg-gray-100 text-gray-600", icon: FileText };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.color}`}>
      <cfg.icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function fmt(val: string | number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(val));
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const ACTION_LABELS: Record<string, string> = {
  created: "Created", updated: "Updated", submitted: "Submitted for review",
  approve: "Approved", reject: "Rejected", complete: "Marked complete",
  cancel: "Cancelled", attachment_added: "Attachment added",
};

// ── Create/Edit schema ─────────────────────────────────────────────────────
const txFormSchema = z.object({
  companyId: z.string().min(1, "Company required"),
  title: z.string().min(1, "Title required"),
  transactionType: z.string().min(1),
  counterpartyType: z.string().min(1),
  counterpartyName: z.string().min(1, "Counterparty name required"),
  description: z.string().optional(),
  fairMarketValue: z.coerce.number().min(0, "Must be ≥ 0"),
  isReportable: z.boolean().default(false),
  taxYear: z.coerce.number().optional(),
  reportingNotes: z.string().optional(),
});

type TxFormValues = z.infer<typeof txFormSchema>;

// ── Item form schema ───────────────────────────────────────────────────────
const itemSchema = z.object({
  description: z.string().min(1, "Description required"),
  itemType: z.string().min(1),
  direction: z.string().min(1),
  fairMarketValue: z.coerce.number().min(0),
  quantity: z.coerce.number().min(0.0001),
  unit: z.string().optional(),
  notes: z.string().optional(),
});
type ItemFormValues = z.infer<typeof itemSchema>;

// ══════════════════════════════════════════════════════════════════════════════
// Main Page
// ══════════════════════════════════════════════════════════════════════════════
export default function TradeCompensationPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>(String(new Date().getFullYear()));
  const [view, setView] = useState<"list" | "detail" | "create" | "edit">("list");
  const [selectedTx, setSelectedTx] = useState<TradeTransaction | null>(null);
  const [showReviewDialog, setShowReviewDialog] = useState<{ action: "approve" | "reject" | null }>({ action: null });
  const [reviewNotes, setReviewNotes] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: companies = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/companies"],
  });

  const { data: transactions = [], isLoading } = useQuery<TradeTransaction[]>({
    queryKey: ["/api/trade-transactions", selectedCompanyId, statusFilter, yearFilter],
    queryFn: () => {
      if (!selectedCompanyId) return Promise.resolve([]);
      const params = new URLSearchParams({ companyId: selectedCompanyId });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (yearFilter) params.set("year", yearFilter);
      return fetch(`/api/trade-transactions?${params}`, { credentials: "include" }).then(r => r.json());
    },
    enabled: !!selectedCompanyId,
  });

  const { data: txItems = [] } = useQuery<TradeItem[]>({
    queryKey: ["/api/trade-transactions", selectedTx?.id, "items"],
    queryFn: () => fetch(`/api/trade-transactions/${selectedTx!.id}/items`, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedTx,
  });

  const { data: txAttachments = [] } = useQuery<TradeAttachment[]>({
    queryKey: ["/api/trade-transactions", selectedTx?.id, "attachments"],
    queryFn: () => fetch(`/api/trade-transactions/${selectedTx!.id}/attachments`, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedTx,
  });

  const { data: txAuditLogs = [] } = useQuery<TradeAuditLog[]>({
    queryKey: ["/api/trade-transactions", selectedTx?.id, "audit-logs"],
    queryFn: () => fetch(`/api/trade-transactions/${selectedTx!.id}/audit-logs`, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedTx,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/trade-transactions", selectedCompanyId] });
    if (selectedTx) qc.invalidateQueries({ queryKey: ["/api/trade-transactions", selectedTx.id] });
  };

  // ── Create / Update mutation ───────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (data: TxFormValues) => {
      if (view === "edit" && selectedTx) {
        return apiRequest("PATCH", `/api/trade-transactions/${selectedTx.id}`, data);
      }
      return apiRequest("POST", "/api/trade-transactions", data);
    },
    onSuccess: async (res) => {
      const saved: TradeTransaction = await res.json();
      toast({ title: view === "edit" ? "Transaction updated" : "Transaction created" });
      invalidate();
      setSelectedTx(saved);
      setView("detail");
    },
    onError: () => toast({ title: "Error saving transaction", variant: "destructive" }),
  });

  // ── Delete mutation ────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/trade-transactions/${id}`),
    onSuccess: () => { toast({ title: "Transaction deleted" }); invalidate(); setView("list"); setSelectedTx(null); },
    onError: (e: any) => toast({ title: e.message || "Cannot delete", variant: "destructive" }),
  });

  // ── Status action mutation ─────────────────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: ({ action, notes }: { action: string; notes?: string }) =>
      apiRequest("POST", `/api/trade-transactions/${selectedTx!.id}/${action}`, { notes }),
    onSuccess: async (res) => {
      const updated: TradeTransaction = await res.json();
      toast({ title: "Status updated" });
      setSelectedTx(updated);
      setShowReviewDialog({ action: null });
      setReviewNotes("");
      invalidate();
    },
    onError: (e: any) => toast({ title: e.message || "Failed", variant: "destructive" }),
  });

  // ── Add item mutation ──────────────────────────────────────────────────
  const addItemMutation = useMutation({
    mutationFn: (data: ItemFormValues) => apiRequest("POST", `/api/trade-transactions/${selectedTx!.id}/items`, data),
    onSuccess: () => { toast({ title: "Item added" }); qc.invalidateQueries({ queryKey: ["/api/trade-transactions", selectedTx!.id, "items"] }); },
    onError: () => toast({ title: "Failed to add item", variant: "destructive" }),
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: string) => apiRequest("DELETE", `/api/trade-transactions/${selectedTx!.id}/items/${itemId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/trade-transactions", selectedTx!.id, "items"] }),
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attachId: string) => apiRequest("DELETE", `/api/trade-transactions/${selectedTx!.id}/attachments/${attachId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/trade-transactions", selectedTx!.id, "attachments"] }),
  });

  // ── Upload attachment ──────────────────────────────────────────────────
  const uploadAttachment = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`/api/trade-transactions/${selectedTx!.id}/attachments`, { method: "POST", credentials: "include", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      toast({ title: "Attachment uploaded" });
      qc.invalidateQueries({ queryKey: ["/api/trade-transactions", selectedTx!.id, "attachments"] });
      qc.invalidateQueries({ queryKey: ["/api/trade-transactions", selectedTx!.id, "audit-logs"] });
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    }
  };

  // ── Transaction form ───────────────────────────────────────────────────
  const txForm = useForm<TxFormValues>({
    resolver: zodResolver(txFormSchema),
    defaultValues: {
      companyId: selectedCompanyId,
      title: "",
      transactionType: "services",
      counterpartyType: "contractor",
      counterpartyName: "",
      description: "",
      fairMarketValue: 0,
      isReportable: false,
      taxYear: new Date().getFullYear(),
      reportingNotes: "",
    },
  });

  const openCreate = () => {
    txForm.reset({ companyId: selectedCompanyId, title: "", transactionType: "services", counterpartyType: "contractor", counterpartyName: "", description: "", fairMarketValue: 0, isReportable: false, taxYear: new Date().getFullYear(), reportingNotes: "" });
    setView("create");
  };

  const openEdit = (tx: TradeTransaction) => {
    txForm.reset({ companyId: tx.companyId, title: tx.title, transactionType: tx.transactionType, counterpartyType: tx.counterpartyType, counterpartyName: tx.counterpartyName, description: tx.description || "", fairMarketValue: parseFloat(tx.fairMarketValue), isReportable: tx.isReportable, taxYear: tx.taxYear || new Date().getFullYear(), reportingNotes: tx.reportingNotes || "" });
    setSelectedTx(tx);
    setView("edit");
  };

  // ── Item form ──────────────────────────────────────────────────────────
  const itemForm = useForm<ItemFormValues>({
    resolver: zodResolver(itemSchema),
    defaultValues: { description: "", itemType: "services", direction: "given", fairMarketValue: 0, quantity: 1, unit: "", notes: "" },
  });

  // ════════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ════════════════════════════════════════════════════════════════════════
  if (view === "list") {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-trade-title">Trade Compensation</h1>
            <p className="text-sm text-muted-foreground mt-1">Record non-cash compensation arrangements for contractors, vendors, and counterparties.</p>
          </div>
          <Button onClick={openCreate} disabled={!selectedCompanyId} data-testid="button-new-trade">
            <Plus className="h-4 w-4 mr-2" /> New Transaction
          </Button>
        </div>

        {/* Compliance Notice */}
        <Alert className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="text-amber-800 dark:text-amber-300 text-sm">
            <strong>Compliance notice:</strong> Non-cash compensation may still be taxable. Barter arrangements with contractors may need to be reported on year-end 1099 forms. Recorded values may affect eligibility for certain public benefit programs. This tool supports recordkeeping and compliance reporting only.
          </AlertDescription>
        </Alert>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="w-52">
            <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
              <SelectTrigger data-testid="select-company">
                <SelectValue placeholder="Select company…" />
              </SelectTrigger>
              <SelectContent>
                {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-44">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger data-testid="select-status-filter">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-28">
            <Input placeholder="Year" value={yearFilter} onChange={e => setYearFilter(e.target.value)} data-testid="input-year-filter" />
          </div>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {!selectedCompanyId ? (
              <div className="py-16 text-center text-muted-foreground">
                <DollarSign className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Select a company to view trade compensation records.</p>
              </div>
            ) : isLoading ? (
              <div className="py-16 text-center text-muted-foreground text-sm">Loading…</div>
            ) : transactions.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No trade compensation records yet</p>
                <p className="text-xs mt-1">Click "New Transaction" to record a non-cash compensation arrangement.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Counterparty</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>FMV</TableHead>
                    <TableHead>Year</TableHead>
                    <TableHead>Reportable</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map(tx => (
                    <TableRow key={tx.id} className="cursor-pointer hover:bg-muted/50" data-testid={`row-trade-${tx.id}`}
                      onClick={() => { setSelectedTx(tx); setView("detail"); }}>
                      <TableCell className="font-medium">{tx.title}</TableCell>
                      <TableCell>
                        <div className="text-sm">{tx.counterpartyName}</div>
                        <div className="text-xs text-muted-foreground capitalize">{tx.counterpartyType}</div>
                      </TableCell>
                      <TableCell className="capitalize text-sm">{tx.transactionType}</TableCell>
                      <TableCell className="font-mono text-sm">{fmt(tx.fairMarketValue)}</TableCell>
                      <TableCell className="text-sm">{tx.taxYear || "—"}</TableCell>
                      <TableCell>{tx.isReportable ? <Flag className="h-3.5 w-3.5 text-amber-500" /> : <span className="text-muted-foreground text-xs">—</span>}</TableCell>
                      <TableCell><StatusBadge status={tx.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(tx.createdAt)}</TableCell>
                      <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Summary row */}
        {transactions.length > 0 && (
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <span>{transactions.length} record{transactions.length !== 1 ? "s" : ""}</span>
            <span>Total FMV: <strong className="text-foreground">{fmt(transactions.reduce((s, t) => s + parseFloat(t.fairMarketValue), 0))}</strong></span>
            <span>Reportable: <strong className="text-amber-600">{fmt(transactions.filter(t => t.isReportable).reduce((s, t) => s + parseFloat(t.fairMarketValue), 0))}</strong></span>
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // CREATE / EDIT FORM
  // ════════════════════════════════════════════════════════════════════════
  if (view === "create" || view === "edit") {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { view === "edit" ? setView("detail") : setView("list"); }} data-testid="button-back-from-form">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h1 className="text-xl font-bold">{view === "edit" ? "Edit Transaction" : "New Trade Compensation"}</h1>
        </div>

        <Card>
          <CardContent className="pt-6">
            <Form {...txForm}>
              <form onSubmit={txForm.handleSubmit(d => saveMutation.mutate(d))} className="space-y-5">
                {/* Company */}
                <FormField control={txForm.control} name="companyId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger data-testid="select-form-company"><SelectValue placeholder="Select company" /></SelectTrigger></FormControl>
                      <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Title */}
                <FormField control={txForm.control} name="title" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl><Input placeholder="e.g. Web design services for logo work" {...field} data-testid="input-trade-title" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  {/* Type */}
                  <FormField control={txForm.control} name="transactionType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Transaction Type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger data-testid="select-tx-type"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="goods">Goods</SelectItem>
                          <SelectItem value="services">Services</SelectItem>
                          <SelectItem value="mixed">Mixed (Goods + Services)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {/* Counterparty type */}
                  <FormField control={txForm.control} name="counterpartyType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Counterparty Type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger data-testid="select-counterparty-type"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="contractor">Contractor</SelectItem>
                          <SelectItem value="vendor">Vendor</SelectItem>
                          <SelectItem value="customer">Customer</SelectItem>
                          <SelectItem value="manual">Manual / Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                {/* Counterparty name */}
                <FormField control={txForm.control} name="counterpartyName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Counterparty Name</FormLabel>
                    <FormControl><Input placeholder="Full name or company name" {...field} data-testid="input-counterparty-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Description */}
                <FormField control={txForm.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl><Textarea placeholder="Describe what was exchanged, why, and any relevant context…" rows={3} {...field} data-testid="textarea-description" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  {/* Fair market value */}
                  <FormField control={txForm.control} name="fairMarketValue" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fair Market Value (USD)</FormLabel>
                      <FormControl><Input type="number" min="0" step="0.01" {...field} data-testid="input-fmv" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {/* Tax year */}
                  <FormField control={txForm.control} name="taxYear" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tax Year</FormLabel>
                      <FormControl><Input type="number" min="2000" max="2099" {...field} data-testid="input-tax-year" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                {/* Reportable */}
                <FormField control={txForm.control} name="isReportable" render={({ field }) => (
                  <FormItem className="flex items-start gap-3 rounded-md border p-4">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} data-testid="checkbox-reportable" />
                    </FormControl>
                    <div className="space-y-1">
                      <FormLabel className="text-sm font-medium leading-none">Flag for year-end reporting</FormLabel>
                      <p className="text-xs text-muted-foreground">This transaction may need to be included in 1099-NEC or 1099-MISC year-end reporting for this counterparty.</p>
                    </div>
                  </FormItem>
                )} />

                {/* Reporting notes */}
                <FormField control={txForm.control} name="reportingNotes" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reporting Notes <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <FormControl><Textarea placeholder="Internal notes about reporting obligations or context…" rows={2} {...field} data-testid="textarea-reporting-notes" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <Alert className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-800 dark:text-amber-300 text-xs">
                    Non-cash compensation is generally taxable. The fair market value of goods or services received in exchange for work is ordinary income to the recipient. Consult a tax advisor if uncertain about reporting obligations.
                  </AlertDescription>
                </Alert>

                <div className="flex gap-3 pt-2">
                  <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-transaction">
                    {saveMutation.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
                    {view === "edit" ? "Save Changes" : "Create Transaction"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => view === "edit" ? setView("detail") : setView("list")}>
                    Cancel
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // DETAIL VIEW
  // ════════════════════════════════════════════════════════════════════════
  if (view === "detail" && selectedTx) {
    const tx = selectedTx;
    const canEdit = ["draft", "rejected"].includes(tx.status);
    const canSubmit = ["draft", "rejected"].includes(tx.status);
    const canApprove = tx.status === "pending_review";
    const canComplete = tx.status === "approved";
    const canCancel = !["completed", "cancelled"].includes(tx.status);

    return (
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setView("list")} data-testid="button-back-to-list">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold" data-testid="text-detail-title">{tx.title}</h1>
                <StatusBadge status={tx.status} />
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{tx.counterpartyName} · {tx.counterpartyType} · {tx.taxYear || "No year"}</p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 shrink-0">
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => openEdit(tx)} data-testid="button-edit-tx">
                Edit
              </Button>
            )}
            {canSubmit && (
              <Button size="sm" onClick={() => statusMutation.mutate({ action: "submit" })} disabled={statusMutation.isPending} data-testid="button-submit-tx">
                <Send className="h-3.5 w-3.5 mr-1.5" /> Submit for Review
              </Button>
            )}
            {canApprove && (
              <>
                <Button size="sm" variant="default" onClick={() => setShowReviewDialog({ action: "approve" })} data-testid="button-approve-tx" className="bg-green-600 hover:bg-green-700">
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Approve
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setShowReviewDialog({ action: "reject" })} data-testid="button-reject-tx">
                  <XCircle className="h-3.5 w-3.5 mr-1.5" /> Reject
                </Button>
              </>
            )}
            {canComplete && (
              <Button size="sm" onClick={() => statusMutation.mutate({ action: "complete" })} disabled={statusMutation.isPending} data-testid="button-complete-tx">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Mark Complete
              </Button>
            )}
            {canCancel && (
              <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/20" onClick={() => statusMutation.mutate({ action: "cancel" })} disabled={statusMutation.isPending} data-testid="button-cancel-tx">
                Cancel
              </Button>
            )}
          </div>
        </div>

        {/* Reportable banner */}
        {tx.isReportable && (
          <Alert className="border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20">
            <Flag className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800 dark:text-amber-300 text-sm">
              <strong>Flagged for year-end reporting.</strong> This transaction's fair market value ({fmt(tx.fairMarketValue)}) may need to be reported on a 1099-NEC or 1099-MISC for {tx.counterpartyName}.
              {tx.reportingNotes && <span className="block mt-1 text-xs">{tx.reportingNotes}</span>}
            </AlertDescription>
          </Alert>
        )}

        {/* Review notes */}
        {tx.reviewNotes && (
          <Alert className={tx.status === "rejected" ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20" : "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20"}>
            <AlertDescription className="text-sm">
              <strong>Review notes:</strong> {tx.reviewNotes}
            </AlertDescription>
          </Alert>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">Fair Market Value</p>
              <p className="text-2xl font-bold text-foreground mt-1" data-testid="text-detail-fmv">{fmt(tx.fairMarketValue)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">Transaction Type</p>
              <p className="text-base font-semibold capitalize mt-1">{tx.transactionType}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">Counterparty</p>
              <p className="text-base font-semibold mt-1">{tx.counterpartyName}</p>
              <p className="text-xs text-muted-foreground capitalize">{tx.counterpartyType}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">Tax Year</p>
              <p className="text-2xl font-bold mt-1">{tx.taxYear || "—"}</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="details">
          <TabsList data-testid="tabs-detail">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="items">Line Items ({txItems.length})</TabsTrigger>
            <TabsTrigger value="attachments">Attachments ({txAttachments.length})</TabsTrigger>
            <TabsTrigger value="audit">Audit Log ({txAuditLogs.length})</TabsTrigger>
          </TabsList>

          {/* Details tab */}
          <TabsContent value="details" className="mt-4">
            <Card>
              <CardContent className="pt-6 space-y-4">
                {tx.description && (
                  <div>
                    <Label className="text-muted-foreground text-xs uppercase tracking-wide">Description</Label>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{tx.description}</p>
                  </div>
                )}
                <Separator />
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Created:</span> {fmtDate(tx.createdAt)}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Last updated:</span> {fmtDate(tx.updatedAt)}
                  </div>
                  {tx.reviewedAt && (
                    <div>
                      <span className="text-muted-foreground">Reviewed:</span> {fmtDate(tx.reviewedAt)}
                    </div>
                  )}
                </div>
                {canEdit && (
                  <div className="pt-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(tx)} data-testid="button-edit-details">
                      Edit Details
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Line items tab */}
          <TabsContent value="items" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Line Items</CardTitle>
                <CardDescription className="text-xs">Break down the goods and services exchanged in this transaction.</CardDescription>
              </CardHeader>
              <CardContent>
                {txItems.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Direction</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>FMV</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {txItems.map(item => (
                        <TableRow key={item.id} data-testid={`row-item-${item.id}`}>
                          <TableCell>
                            <div className="font-medium text-sm">{item.description}</div>
                            {item.notes && <div className="text-xs text-muted-foreground">{item.notes}</div>}
                          </TableCell>
                          <TableCell className="capitalize text-sm">{item.itemType}</TableCell>
                          <TableCell>
                            <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${item.direction === "given" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"}`}>
                              {item.direction === "given" ? "↑ Given" : "↓ Received"}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">{item.quantity}{item.unit ? ` ${item.unit}` : ""}</TableCell>
                          <TableCell className="font-mono text-sm">{fmt(item.fairMarketValue)}</TableCell>
                          <TableCell>
                            {canEdit && (
                              <Button variant="ghost" size="sm" onClick={() => deleteItemMutation.mutate(item.id)} className="text-red-500 h-7 w-7 p-0" data-testid={`button-delete-item-${item.id}`}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground py-4 text-center">No line items added yet.</p>
                )}

                {txItems.length > 0 && (
                  <div className="flex justify-end pt-3 border-t mt-3">
                    <span className="text-sm font-medium">Items total: {fmt(txItems.reduce((s, i) => s + parseFloat(i.fairMarketValue) * parseFloat(i.quantity), 0))}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Add item form */}
            {canEdit && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Add Line Item</CardTitle>
                </CardHeader>
                <CardContent>
                  <Form {...itemForm}>
                    <form onSubmit={itemForm.handleSubmit(d => { addItemMutation.mutate(d); itemForm.reset(); })} className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={itemForm.control} name="description" render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Description</FormLabel>
                            <FormControl><Input placeholder="What was given or received?" {...field} data-testid="input-item-description" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={itemForm.control} name="itemType" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Item Type</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl><SelectTrigger data-testid="select-item-type"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="goods">Goods</SelectItem>
                                <SelectItem value="services">Services</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )} />
                        <FormField control={itemForm.control} name="direction" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Direction</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl><SelectTrigger data-testid="select-item-direction"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="given">Given (we provided)</SelectItem>
                                <SelectItem value="received">Received (we received)</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )} />
                        <FormField control={itemForm.control} name="fairMarketValue" render={({ field }) => (
                          <FormItem>
                            <FormLabel>FMV (USD)</FormLabel>
                            <FormControl><Input type="number" min="0" step="0.01" {...field} data-testid="input-item-fmv" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={itemForm.control} name="quantity" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Quantity</FormLabel>
                            <FormControl><Input type="number" min="0.0001" step="any" {...field} data-testid="input-item-qty" /></FormControl>
                          </FormItem>
                        )} />
                        <FormField control={itemForm.control} name="unit" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Unit <span className="text-muted-foreground">(optional)</span></FormLabel>
                            <FormControl><Input placeholder="hours, kg, units…" {...field} data-testid="input-item-unit" /></FormControl>
                          </FormItem>
                        )} />
                        <FormField control={itemForm.control} name="notes" render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Notes <span className="text-muted-foreground">(optional)</span></FormLabel>
                            <FormControl><Input placeholder="Optional notes" {...field} data-testid="input-item-notes" /></FormControl>
                          </FormItem>
                        )} />
                      </div>
                      <Button type="submit" size="sm" disabled={addItemMutation.isPending} data-testid="button-add-item">
                        <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Attachments tab */}
          <TabsContent value="attachments" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Attachments</CardTitle>
                  {canEdit && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-upload-attachment">
                        <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload File
                      </Button>
                      <input ref={fileInputRef} type="file" className="hidden" onChange={e => e.target.files?.[0] && uploadAttachment(e.target.files[0])} />
                    </>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {txAttachments.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No attachments yet. Upload contracts, invoices, or supporting documentation.</p>
                ) : (
                  <div className="space-y-2">
                    {txAttachments.map(att => (
                      <div key={att.id} className="flex items-center justify-between py-2 px-3 rounded-md border hover:bg-muted/30" data-testid={`row-attachment-${att.id}`}>
                        <div className="flex items-center gap-2">
                          <Paperclip className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">{att.fileName}</p>
                            <p className="text-xs text-muted-foreground">{att.fileSize ? `${Math.round(att.fileSize / 1024)} KB · ` : ""}{fmtDate(att.createdAt)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" asChild className="h-7 w-7 p-0">
                            <a href={att.fileUrl} target="_blank" rel="noopener noreferrer" download data-testid={`button-download-attachment-${att.id}`}>
                              <Download className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                          {canEdit && (
                            <Button variant="ghost" size="sm" onClick={() => deleteAttachmentMutation.mutate(att.id)} className="h-7 w-7 p-0 text-red-500" data-testid={`button-delete-attachment-${att.id}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Audit log tab */}
          <TabsContent value="audit" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Audit Log</CardTitle>
                <CardDescription className="text-xs">Full history of all actions taken on this transaction.</CardDescription>
              </CardHeader>
              <CardContent>
                {txAuditLogs.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No activity yet.</p>
                ) : (
                  <div className="space-y-3">
                    {txAuditLogs.map(log => (
                      <div key={log.id} className="flex gap-3" data-testid={`row-audit-${log.id}`}>
                        <div className="mt-0.5 h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <History className="h-3 w-3 text-muted-foreground" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{ACTION_LABELS[log.action] || log.action}</span>
                            {log.oldStatus && log.newStatus && log.oldStatus !== log.newStatus && (
                              <span className="text-xs text-muted-foreground">
                                <StatusBadge status={log.oldStatus as TradeStatus} /> → <StatusBadge status={log.newStatus as TradeStatus} />
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground ml-auto">{fmtDate(log.createdAt)}</span>
                          </div>
                          {log.note && <p className="text-xs text-muted-foreground mt-0.5">{log.note}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Delete (admin, draft/cancelled only) */}
        {["draft", "cancelled"].includes(tx.status) && (
          <div className="flex justify-end pt-2">
            <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => { if (confirm("Delete this transaction? This cannot be undone.")) deleteMutation.mutate(tx.id); }} data-testid="button-delete-tx">
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete Transaction
            </Button>
          </div>
        )}

        {/* Review dialog */}
        <Dialog open={!!showReviewDialog.action} onOpenChange={() => setShowReviewDialog({ action: null })}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{showReviewDialog.action === "approve" ? "Approve Transaction" : "Reject Transaction"}</DialogTitle>
              <DialogDescription>
                {showReviewDialog.action === "approve"
                  ? "Approve this trade compensation record. It can be marked complete afterward."
                  : "Reject this transaction and return it to draft status."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Label>Review Notes <span className="text-muted-foreground">(optional)</span></Label>
              <Textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} placeholder="Add notes for the submitter…" rows={3} data-testid="textarea-review-notes" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowReviewDialog({ action: null })}>Cancel</Button>
              <Button
                variant={showReviewDialog.action === "reject" ? "destructive" : "default"}
                className={showReviewDialog.action === "approve" ? "bg-green-600 hover:bg-green-700" : ""}
                onClick={() => statusMutation.mutate({ action: showReviewDialog.action!, notes: reviewNotes })}
                disabled={statusMutation.isPending}
                data-testid={`button-confirm-${showReviewDialog.action}`}
              >
                {showReviewDialog.action === "approve" ? "Approve" : "Reject"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return null;
}
