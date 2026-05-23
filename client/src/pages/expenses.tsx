import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Receipt as ReceiptIcon, Plus, Trash2, Upload, FileText, DollarSign, Download,
  Camera, Loader2, CheckCircle2, XCircle, Clock, AlertTriangle, Send,
  CreditCard, BarChart3, RefreshCw, Eye, Building2, Printer, BanknoteIcon,
} from "lucide-react";
import { Link } from "wouter";

const EXPENSE_POLICY = "All expenses must be approved by a supervisor or manager before they are incurred, or they will not be reimbursed.";
const INVOICE_POLICY = "A proposal must be approved before the invoice will be accepted. No work should be performed by an independent contractor unless proposal has been approved.";

function statusBadge(status: string) {
  const map: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
    draft: "outline", submitted: "secondary", approved: "default", rejected: "destructive",
    paid: "default", queued: "secondary", exported: "default", closed: "default",
  };
  return <Badge variant={map[status] || "outline"}>{status}</Badge>;
}

function paymentStatusBadge(ps: string | null | undefined) {
  if (!ps || ps === "unpaid") return <Badge variant="outline" className="text-amber-600 border-amber-400">unpaid</Badge>;
  if (ps === "paid") return <Badge variant="default" className="bg-green-600">paid</Badge>;
  if (ps === "voided") return <Badge variant="destructive">voided</Badge>;
  if (ps === "scheduled") return <Badge variant="secondary">scheduled</Badge>;
  return <Badge variant="outline">{ps}</Badge>;
}

function formatCurrency(v: string | number | null | undefined) {
  if (v == null) return "$0.00";
  return `$${parseFloat(String(v)).toFixed(2)}`;
}

function extractedNumber(value: any): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : "";
}

function summarizeLineItems(items: any[] | undefined): string {
  if (!Array.isArray(items) || items.length === 0) return "";
  return items
    .map(item => item?.description)
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");
}

function normalizeExpensePaymentMethod(value: any): string {
  const raw = String(value || "").toLowerCase();
  if (!raw) return "";
  if (raw.includes("cash")) return "cash";
  if (raw.includes("check") || raw.includes("cheque")) return "check";
  if (raw.includes("company")) return "company_card";
  if (raw.includes("card") || raw.includes("visa") || raw.includes("mastercard") || raw.includes("amex") || raw.includes("debit") || raw.includes("credit")) return "personal_card";
  return "other";
}

function ExpenseSubmitForm({ categories, companies, jobs, costCenters, onClose }: any) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    companyId: "", categoryId: "", expenseDate: new Date().toISOString().split("T")[0],
    amount: "", vendor: "", description: "", businessPurpose: "", reimbursementRequested: false,
    paymentMethodUsed: "", jobId: "", costCenterId: "", preapprovalReference: "", notes: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch("/api/expenses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify(data),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: async (expense) => {
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        await fetch(`/api/expenses/${expense.id}/attachments`, { method: "POST", credentials: "include", body: fd });
      }
      toast({ title: "Expense created" });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleAiScan = async () => {
    if (!file) return;
    setAiLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/expenses/ai-scan", { method: "POST", credentials: "include", body: fd });
      if (!res.ok) throw new Error("AI scan failed");
      const data = await res.json();
      setAiResult(data.extracted);
      if (data.extracted) {
        const extracted = data.extracted;
        const lineItemSummary = summarizeLineItems(extracted.lineItems);
        setForm(f => ({
          ...f,
          vendor: extracted.vendor || f.vendor,
          amount: extractedNumber(extracted.totalAmount) || extractedNumber(extracted.amount) || f.amount,
          expenseDate: extracted.date || f.expenseDate,
          description: extracted.description || lineItemSummary || f.description,
          businessPurpose: extracted.businessPurpose || f.businessPurpose,
          paymentMethodUsed: normalizeExpensePaymentMethod(extracted.paymentMethod) || f.paymentMethodUsed,
          subtotal: extractedNumber(extracted.subtotal) || undefined,
          taxAmount: extractedNumber(extracted.taxAmount) || undefined,
          lineItems: Array.isArray(extracted.lineItems) ? JSON.stringify(extracted.lineItems) : undefined,
          aiExtractedJson: JSON.stringify(extracted),
          aiConfidenceScore: extractedNumber(extracted.confidence) || undefined,
        }));
        const matchCat = categories.find((c: any) => c.name.toLowerCase() === extracted.category?.toLowerCase());
        if (matchCat) setForm(f => ({ ...f, categoryId: matchCat.id }));
      }
      toast({ title: "AI extraction complete" });
    } catch { toast({ title: "AI scan failed", variant: "destructive" }); }
    setAiLoading(false);
  };

  const selectedCat = categories.find((c: any) => c.id === form.categoryId);

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-400">{EXPENSE_POLICY}</p>
        </div>
      </div>

      <div className="border border-dashed rounded-lg p-4 text-center space-y-2">
        <div className="flex items-center justify-center gap-3">
          <label className="cursor-pointer">
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} data-testid="input-expense-file" />
            <div className="flex items-center gap-2 px-4 py-2 rounded-md border hover:bg-muted transition">
              <Upload className="h-4 w-4" /> Upload Receipt
            </div>
          </label>
          <label className="cursor-pointer">
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} data-testid="input-expense-camera" />
            <div className="flex items-center gap-2 px-4 py-2 rounded-md border hover:bg-muted transition">
              <Camera className="h-4 w-4" /> Take Photo
            </div>
          </label>
        </div>
        {file && (
          <div className="flex items-center justify-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">{file.name}</span>
            <Button size="sm" variant="outline" onClick={handleAiScan} disabled={aiLoading} data-testid="button-ai-scan">
              {aiLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <BarChart3 className="h-3 w-3 mr-1" />}
              {aiLoading ? "Scanning..." : "AI Extract"}
            </Button>
          </div>
        )}
        {aiResult && (
          <div className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded p-2">
            AI extracted: {aiResult.vendor} | {formatCurrency(aiResult.totalAmount || aiResult.amount)} | {aiResult.date}
            {aiResult.confidence && ` (${Math.round(aiResult.confidence * 100)}% confidence)`}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Company</Label>
          <Select value={form.companyId} onValueChange={v => setForm(f => ({ ...f, companyId: v }))}>
            <SelectTrigger data-testid="select-expense-company"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{companies.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Category</Label>
          <Select value={form.categoryId} onValueChange={v => setForm(f => ({ ...f, categoryId: v }))}>
            <SelectTrigger data-testid="select-expense-category"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{categories.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {selectedCat?.preapprovalRequired && (
        <div className="bg-amber-50 dark:bg-amber-950/30 rounded p-2 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <AlertTriangle className="h-3 w-3" /> This category requires preapproval.
          <Input placeholder="Preapproval reference" value={form.preapprovalReference} onChange={e => setForm(f => ({ ...f, preapprovalReference: e.target.value }))} className="h-7 text-xs" data-testid="input-preapproval-ref" />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label>Date</Label>
          <Input type="date" value={form.expenseDate} onChange={e => setForm(f => ({ ...f, expenseDate: e.target.value }))} data-testid="input-expense-date" />
        </div>
        <div>
          <Label>Amount</Label>
          <Input type="number" step="0.01" min="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} data-testid="input-expense-amount" />
        </div>
        <div>
          <Label>Vendor</Label>
          <Input placeholder="Merchant name" value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} data-testid="input-expense-vendor" />
        </div>
      </div>

      <div>
        <Label>Description</Label>
        <Input placeholder="What was purchased?" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} data-testid="input-expense-description" />
      </div>
      <div>
        <Label>Business Purpose</Label>
        <Textarea placeholder="Why is this expense needed?" rows={2} value={form.businessPurpose} onChange={e => setForm(f => ({ ...f, businessPurpose: e.target.value }))} data-testid="input-expense-purpose" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label>Payment Method</Label>
          <Select value={form.paymentMethodUsed || "__none__"} onValueChange={v => setForm(f => ({ ...f, paymentMethodUsed: v === "__none__" ? "" : v }))}>
            <SelectTrigger data-testid="select-payment-method"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Not specified</SelectItem>
              <SelectItem value="company_card">Company Card</SelectItem>
              <SelectItem value="personal_card">Personal Card</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="check">Check</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Job</Label>
          <Select value={form.jobId || "__none__"} onValueChange={v => setForm(f => ({ ...f, jobId: v === "__none__" ? "" : v }))}>
            <SelectTrigger data-testid="select-expense-job"><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {jobs.map((j: any) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Cost Center</Label>
          <Select value={form.costCenterId || "__none__"} onValueChange={v => setForm(f => ({ ...f, costCenterId: v === "__none__" ? "" : v }))}>
            <SelectTrigger data-testid="select-expense-cost-center"><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {costCenters.map((cc: any) => <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={form.reimbursementRequested} onChange={e => setForm(f => ({ ...f, reimbursementRequested: e.target.checked }))} data-testid="checkbox-reimbursement" />
        <CreditCard className="h-4 w-4" /> Request reimbursement for this expense
      </label>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => createMutation.mutate({ ...form, status: "draft" })} disabled={createMutation.isPending || !form.amount || !form.expenseDate} data-testid="button-save-draft">
          Save as Draft
        </Button>
        <Button onClick={() => createMutation.mutate({ ...form, status: "submitted" })} disabled={createMutation.isPending || !form.amount || !form.expenseDate || !form.companyId} data-testid="button-submit-expense">
          {createMutation.isPending ? "Submitting..." : "Submit for Approval"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function InvoiceSubmitForm({ companies, jobs, costCenters, onClose }: any) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    companyId: "", invoiceNumber: "", invoiceDate: new Date().toISOString().split("T")[0],
    dueDate: "", amount: "", description: "", proposalReference: "", jobId: "", costCenterId: "",
    paymentTerms: "net30", notes: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch("/api/contractor-invoices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify(data),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: async (inv) => {
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        await fetch(`/api/contractor-invoices/${inv.id}/attachments`, { method: "POST", credentials: "include", body: fd });
      }
      toast({ title: "Invoice created" });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-invoices"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleAiScan = async () => {
    if (!file) return;
    setAiLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/expenses/ai-scan", { method: "POST", credentials: "include", body: fd });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      if (data.extracted) {
        const extracted = data.extracted;
        const lineItemSummary = summarizeLineItems(extracted.lineItems);
        setForm(f => ({
          ...f,
          amount: extractedNumber(extracted.totalAmount) || extractedNumber(extracted.amount) || f.amount,
          invoiceDate: extracted.date || f.invoiceDate,
          description: extracted.description || extracted.vendor || lineItemSummary || f.description,
          notes: lineItemSummary || f.notes,
          lineItems: Array.isArray(extracted.lineItems) ? JSON.stringify(extracted.lineItems) : undefined,
        }));
      }
      toast({ title: "AI extraction complete" });
    } catch { toast({ title: "AI scan failed", variant: "destructive" }); }
    setAiLoading(false);
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-700 dark:text-blue-400">{INVOICE_POLICY}</p>
        </div>
      </div>

      <div className="border border-dashed rounded-lg p-4 text-center space-y-2">
        <div className="flex items-center justify-center gap-3">
          <label className="cursor-pointer">
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} data-testid="input-invoice-file" />
            <div className="flex items-center gap-2 px-4 py-2 rounded-md border hover:bg-muted transition">
              <Upload className="h-4 w-4" /> Upload Invoice
            </div>
          </label>
          <label className="cursor-pointer">
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} data-testid="input-invoice-camera" />
            <div className="flex items-center gap-2 px-4 py-2 rounded-md border hover:bg-muted transition">
              <Camera className="h-4 w-4" /> Take Photo
            </div>
          </label>
        </div>
        {file && (
          <div className="flex items-center justify-center gap-2">
            <FileText className="h-4 w-4" /><span className="text-sm">{file.name}</span>
            <Button size="sm" variant="outline" onClick={handleAiScan} disabled={aiLoading} data-testid="button-invoice-ai-scan">
              {aiLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <BarChart3 className="h-3 w-3 mr-1" />}
              AI Extract
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><Label>Company</Label>
          <Select value={form.companyId} onValueChange={v => setForm(f => ({ ...f, companyId: v }))}>
            <SelectTrigger data-testid="select-invoice-company"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{companies.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Invoice Number</Label>
          <Input placeholder="INV-001" value={form.invoiceNumber} onChange={e => setForm(f => ({ ...f, invoiceNumber: e.target.value }))} data-testid="input-invoice-number" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div><Label>Invoice Date</Label>
          <Input type="date" value={form.invoiceDate} onChange={e => setForm(f => ({ ...f, invoiceDate: e.target.value }))} data-testid="input-invoice-date" />
        </div>
        <div><Label>Due Date</Label>
          <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} data-testid="input-invoice-due-date" />
        </div>
        <div><Label>Amount</Label>
          <Input type="number" step="0.01" min="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} data-testid="input-invoice-amount" />
        </div>
      </div>

      <div><Label>Description of Work</Label>
        <Textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} data-testid="input-invoice-description" />
      </div>
      <div><Label>Approved Proposal Reference</Label>
        <Input placeholder="Proposal # or reference" value={form.proposalReference} onChange={e => setForm(f => ({ ...f, proposalReference: e.target.value }))} data-testid="input-proposal-ref" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div><Label>Payment Terms</Label>
          <Select value={form.paymentTerms} onValueChange={v => setForm(f => ({ ...f, paymentTerms: v }))}>
            <SelectTrigger data-testid="select-payment-terms"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="net15">Net 15</SelectItem>
              <SelectItem value="net30">Net 30</SelectItem>
              <SelectItem value="net60">Net 60</SelectItem>
              <SelectItem value="due_on_receipt">Due on Receipt</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>Job</Label>
          <Select value={form.jobId || "__none__"} onValueChange={v => setForm(f => ({ ...f, jobId: v === "__none__" ? "" : v }))}>
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent><SelectItem value="__none__">None</SelectItem>{jobs.map((j: any) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Cost Center</Label>
          <Select value={form.costCenterId || "__none__"} onValueChange={v => setForm(f => ({ ...f, costCenterId: v === "__none__" ? "" : v }))}>
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent><SelectItem value="__none__">None</SelectItem>{costCenters.map((cc: any) => <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => createMutation.mutate({ ...form, status: "draft" })} disabled={createMutation.isPending || !form.amount || !form.invoiceDate} data-testid="button-save-invoice-draft">
          Save Draft
        </Button>
        <Button onClick={() => createMutation.mutate({ ...form, status: "submitted" })} disabled={createMutation.isPending || !form.amount || !form.companyId} data-testid="button-submit-invoice">
          {createMutation.isPending ? "Submitting..." : "Submit Invoice"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function ExpensesPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("my-expenses");
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<{ type: string; id: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [printCheckTarget, setPrintCheckTarget] = useState<any | null>(null);
  const [printCheckForm, setPrintCheckForm] = useState({ payeeName: "", payeeAddress: "", payeeCityStateZip: "", checkNumber: "", memo: "", amount: "" });
  const [invoicePrintTarget, setInvoicePrintTarget] = useState<any | null>(null);
  const [invoicePrintForm, setInvoicePrintForm] = useState({ payeeName: "", payeeAddress: "", payeeCityStateZip: "", checkNumber: "", memo: "", amount: "" });
  const [markPaidExpenseId, setMarkPaidExpenseId] = useState<string | null>(null);

  const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const { data: allExpenses = [], isLoading: loadingExpenses } = useQuery<any[]>({ queryKey: ["/api/expenses"], queryFn: async () => { const r = await fetch("/api/expenses", { credentials: "include" }); return r.ok ? r.json() : []; } });
  const { data: invoices = [], isLoading: loadingInvoices } = useQuery<any[]>({ queryKey: ["/api/contractor-invoices"], queryFn: async () => { const r = await fetch("/api/contractor-invoices", { credentials: "include" }); return r.ok ? r.json() : []; } });
  const { data: categories = [] } = useQuery<any[]>({ queryKey: ["/api/expense-categories"], queryFn: async () => { const r = await fetch("/api/expense-categories", { credentials: "include" }); return r.ok ? r.json() : []; } });
  const { data: companies = [] } = useQuery<any[]>({ queryKey: ["/api/companies"] });
  const { data: workers = [] } = useQuery<any[]>({ queryKey: ["/api/workers"] });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"] });
  const { data: costCenters = [] } = useQuery<any[]>({ queryKey: ["/api/cost-centers"] });
  const { data: reimbursements = [] } = useQuery<any[]>({ queryKey: ["/api/payroll-reimbursements"], queryFn: async () => { const r = await fetch("/api/payroll-reimbursements", { credentials: "include" }); return r.ok ? r.json() : []; } });
  const { data: recurringTemplates = [] } = useQuery<any[]>({ queryKey: ["/api/recurring-expenses"], queryFn: async () => { const r = await fetch("/api/recurring-expenses", { credentials: "include" }); return r.ok ? r.json() : []; } });

  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "manager" ||
    currentUser?.role === "owner" || currentUser?.role === "supervisor" ||
    (currentUser?.role || "").startsWith("tenant_") || (currentUser?.role || "").startsWith("platform_");
  const myWorkerId = currentUser?.workerId;
  const isContractor = currentUser?.workerType === "contractor";

  const myExpenses = allExpenses.filter(e => e.submitterId === myWorkerId);
  const pendingExpenseApprovals = allExpenses.filter(e => e.status === "submitted");
  const pendingInvoiceApprovals = invoices.filter(i => i.status === "submitted");
  const approvedInvoices = invoices.filter(i => i.status === "approved");

  const getWorkerName = (id: string) => { const w = workers.find((w: any) => w.id === id); return w ? `${w.firstName} ${w.lastName}` : "—"; };

  const approveMutation = useMutation({
    mutationFn: async ({ type, id }: { type: string; id: string }) => {
      const url = type === "expense" ? `/api/expenses/${id}/approve` : `/api/contractor-invoices/${id}/approve`;
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Approved" });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-reimbursements"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ type, id, reason }: { type: string; id: string; reason: string }) => {
      const url = type === "expense" ? `/api/expenses/${id}/reject` : `/api/contractor-invoices/${id}/reject`;
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ reason }) });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-invoices"] });
      setRejectDialogOpen(false);
    },
  });

  const submitMutation = useMutation({
    mutationFn: async ({ type, id }: { type: string; id: string }) => {
      const url = type === "expense" ? `/api/expenses/${id}/submit` : `/api/contractor-invoices/${id}/submit`;
      const res = await fetch(url, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Submitted for approval" });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-invoices"] });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/contractor-invoices/${id}/mark-paid`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Invoice marked as paid" });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-invoices"] });
    },
  });

  const markExpensePaidMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/expenses/${id}/mark-paid`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ paymentDate: new Date().toISOString() }) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Expense marked as paid" });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      setMarkPaidExpenseId(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const printCheckMutation = useMutation({
    mutationFn: async ({ id, form }: { id: string; form: typeof printCheckForm }) => {
      const res = await fetch(`/api/expenses/${id}/print-check`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({
          payeeName: form.payeeName,
          payeeAddress: form.payeeAddress,
          payeeCityStateZip: form.payeeCityStateZip,
          checkNumber: form.checkNumber || undefined,
          memo: form.memo,
          amount: parseFloat(form.amount),
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.blob();
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      toast({ title: "Check printed", description: "Expense marked as paid." });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      setPrintCheckTarget(null);
    },
    onError: (e: any) => toast({ title: "Print check failed", description: e.message, variant: "destructive" }),
  });

  function openPrintCheck(expense: any) {
    setPrintCheckForm({
      payeeName: expense.payeeName || expense.vendor || "",
      payeeAddress: expense.payeeAddress || "",
      payeeCityStateZip: expense.payeeCityStateZip || "",
      checkNumber: expense.checkNumber || "",
      memo: expense.memo || expense.description || "",
      amount: expense.amount || "",
    });
    setPrintCheckTarget(expense);
  }

  const invoicePrintMutation = useMutation({
    mutationFn: async ({ id, form }: { id: string; form: typeof invoicePrintForm }) => {
      const res = await fetch(`/api/contractor-invoices/${id}/print-check`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", cache: "no-store",
        body: JSON.stringify({
          payeeName: form.payeeName,
          payeeAddress: form.payeeAddress,
          payeeCityStateZip: form.payeeCityStateZip,
          checkNumber: form.checkNumber || undefined,
          memo: form.memo,
          amount: parseFloat(form.amount),
        }),
      });
      if (!res.ok) {
        let message = "Failed to print invoice check";
        try {
          const e = await res.json();
          message = e?.message || message;
        } catch {
          message = await res.text().catch(() => message);
        }
        if (res.status === 401) message = "Your session is not authenticated. Please refresh, sign in again, and retry printing the check.";
        throw new Error(message);
      }
      return res.blob();
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      toast({ title: "Check printed", description: "Invoice check generated." });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-invoices"] });
      setInvoicePrintTarget(null);
    },
    onError: (e: any) => toast({ title: "Print check failed", description: e.message, variant: "destructive" }),
  });

  function openInvoicePrintCheck(inv: any) {
    const contractorWorker = workers.find((w: any) => w.id === inv.contractorId);
    const resolvedPayeeName = inv.payeeName || inv.contractorName ||
      (contractorWorker ? `${contractorWorker.firstName || ""} ${contractorWorker.lastName || ""}`.trim() : "") ||
      "";
    setInvoicePrintForm({
      payeeName: resolvedPayeeName,
      payeeAddress: "",
      payeeCityStateZip: "",
      checkNumber: inv.paymentReference || "",
      memo: inv.description || inv.invoiceNumber || "",
      amount: inv.amount || "",
    });
    setInvoicePrintTarget(inv);
  }

  const totalExpenses = allExpenses.reduce((s: number, e: any) => s + parseFloat(e.amount || "0"), 0);
  const totalPendingReimb = reimbursements.filter((r: any) => r.status === "pending").reduce((s: number, r: any) => s + parseFloat(r.amount || "0"), 0);
  const totalInvoices = invoices.reduce((s: number, i: any) => s + parseFloat(i.amount || "0"), 0);

  if (loadingExpenses) return <div className="p-8"><Skeleton className="h-[500px] w-full" /></div>;

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <ReceiptIcon className="h-6 w-6" /> Expenses & Invoices
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage expenses, reimbursements, and contractor invoices</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button className="w-full sm:w-auto" onClick={() => setExpenseDialogOpen(true)} data-testid="button-new-expense">
            <Plus className="h-4 w-4 mr-1" /> New Expense
          </Button>
          {isContractor && (
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setInvoiceDialogOpen(true)} data-testid="button-new-invoice">
              <FileText className="h-4 w-4 mr-1" /> New Invoice
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setInvoiceDialogOpen(true)} data-testid="button-new-invoice-admin">
              <FileText className="h-4 w-4 mr-1" /> New Invoice
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card data-testid="card-total-expenses"><CardContent className="pt-4">
          <div className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-green-600" /><div>
            <p className="text-xs text-muted-foreground">Total Expenses</p>
            <p className="text-xl font-bold">{formatCurrency(totalExpenses)}</p>
          </div></div>
        </CardContent></Card>
        <Card data-testid="card-pending-approvals"><CardContent className="pt-4">
          <div className="flex items-center gap-2"><Clock className="h-5 w-5 text-amber-600" /><div>
            <p className="text-xs text-muted-foreground">Pending Approvals</p>
            <p className="text-xl font-bold">{pendingExpenseApprovals.length + pendingInvoiceApprovals.length}</p>
          </div></div>
        </CardContent></Card>
        <Card data-testid="card-reimbursements"><CardContent className="pt-4">
          <div className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-blue-600" /><div>
            <p className="text-xs text-muted-foreground">Pending Reimbursements</p>
            <p className="text-xl font-bold">{formatCurrency(totalPendingReimb)}</p>
          </div></div>
        </CardContent></Card>
        <Card data-testid="card-total-invoices"><CardContent className="pt-4">
          <div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-purple-600" /><div>
            <p className="text-xs text-muted-foreground">Total Invoices</p>
            <p className="text-xl font-bold">{formatCurrency(totalInvoices)}</p>
          </div></div>
        </CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="my-expenses" data-testid="tab-my-expenses">My Expenses</TabsTrigger>
          {isAdmin && <TabsTrigger value="all-expenses" data-testid="tab-all-expenses">All Expenses</TabsTrigger>}
          {isAdmin && <TabsTrigger value="pending-approvals" data-testid="tab-pending-approvals">
            Pending Approvals {(pendingExpenseApprovals.length + pendingInvoiceApprovals.length) > 0 && <Badge className="ml-1" variant="destructive">{pendingExpenseApprovals.length + pendingInvoiceApprovals.length}</Badge>}
          </TabsTrigger>}
          <TabsTrigger value="invoices" data-testid="tab-invoices">Contractor Invoices</TabsTrigger>
          {isAdmin && <TabsTrigger value="reimbursements" data-testid="tab-reimbursements">Reimbursement Queue</TabsTrigger>}
          {isAdmin && <TabsTrigger value="ap-queue" data-testid="tab-ap-queue">AP Queue</TabsTrigger>}
          {isAdmin && <TabsTrigger value="recurring" data-testid="tab-recurring">Recurring</TabsTrigger>}
          {isAdmin && <TabsTrigger value="export" data-testid="tab-export">Export</TabsTrigger>}
        </TabsList>

        <TabsContent value="my-expenses" className="space-y-4">
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-2">
            <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {EXPENSE_POLICY}
            </p>
          </div>
          {myExpenses.length === 0 ? (
            <Card><CardContent className="text-center py-12 text-muted-foreground">
              <ReceiptIcon className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No expenses yet</p>
              <p className="text-sm mt-1">Click "New Expense" to submit your first expense.</p>
            </CardContent></Card>
          ) : (
            <>
              <div className="space-y-3 sm:hidden">
                {myExpenses.map((e: any) => (
                  <Card key={e.id} data-testid={`card-expense-${e.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-medium">{e.vendor || "—"}</p>
                          <p className="text-xs text-muted-foreground">{e.expenseDate} · {e.categoryName || "—"}</p>
                        </div>
                        <p className="font-mono font-semibold">{formatCurrency(e.amount)}</p>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {statusBadge(e.status)}
                          {e.reimbursementRequested && <Badge variant="secondary">Reimb.</Badge>}
                        </div>
                        {e.status === "draft" && (
                          <Button size="sm" variant="outline" onClick={() => submitMutation.mutate({ type: "expense", id: e.id })} data-testid={`button-submit-mobile-${e.id}`}>
                            <Send className="h-3 w-3 mr-1" /> Submit
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="hidden sm:block overflow-x-auto">
                <Table data-testid="table-my-expenses">
                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Vendor</TableHead><TableHead>Category</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Reimb.</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {myExpenses.map((e: any) => (
                      <TableRow key={e.id} data-testid={`row-expense-${e.id}`}>
                        <TableCell>{e.expenseDate}</TableCell>
                        <TableCell className="font-medium">{e.vendor || "—"}</TableCell>
                        <TableCell>{e.categoryName || "—"}</TableCell>
                        <TableCell className="font-mono">{formatCurrency(e.amount)}</TableCell>
                        <TableCell>{statusBadge(e.status)}</TableCell>
                        <TableCell>{e.reimbursementRequested ? <Badge variant="secondary">Yes</Badge> : "—"}</TableCell>
                        <TableCell>
                          {e.status === "draft" && (
                            <Button size="sm" variant="outline" onClick={() => submitMutation.mutate({ type: "expense", id: e.id })} data-testid={`button-submit-${e.id}`}>
                              <Send className="h-3 w-3 mr-1" /> Submit
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </TabsContent>

        {isAdmin && (
          <TabsContent value="all-expenses" className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">All Expenses</h3>
              <Button variant="outline" size="sm" onClick={() => window.open("/api/expenses/export/csv", "_blank")} data-testid="button-export-expenses-csv">
                <Download className="h-4 w-4 mr-1" /> Export CSV
              </Button>
            </div>
            <div className="space-y-3 sm:hidden">
              {allExpenses.map((e: any) => (
                <Card key={e.id} data-testid={`card-all-expense-${e.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-1">
                      <div>
                        <p className="font-medium">{e.vendor || "—"}</p>
                        <p className="text-xs text-muted-foreground">{getWorkerName(e.submitterId)} · {e.expenseDate}</p>
                      </div>
                      <p className="font-mono font-semibold">{formatCurrency(e.amount)}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      {statusBadge(e.status)}
                      <span className="text-xs text-muted-foreground">{e.categoryName || "—"}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="hidden sm:block overflow-x-auto">
              <Table data-testid="table-all-expenses">
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Submitter</TableHead><TableHead>Vendor</TableHead><TableHead>Category</TableHead><TableHead>Company</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Payment</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {allExpenses.map((e: any) => (
                    <TableRow key={e.id} data-testid={`row-all-expense-${e.id}`}>
                      <TableCell>{e.expenseDate}</TableCell>
                      <TableCell>{getWorkerName(e.submitterId)}</TableCell>
                      <TableCell>{e.vendor || "—"}</TableCell>
                      <TableCell>{e.categoryName || "—"}</TableCell>
                      <TableCell>{companies.find((c: any) => c.id === e.companyId)?.name || "—"}</TableCell>
                      <TableCell className="font-mono">{formatCurrency(e.amount)}</TableCell>
                      <TableCell>{statusBadge(e.status)}</TableCell>
                      <TableCell>{paymentStatusBadge(e.paymentStatus)}{e.checkNumber && <span className="text-xs text-muted-foreground ml-1">#{e.checkNumber}</span>}</TableCell>
                      <TableCell>
                        {isAdmin && e.status === "approved" && e.paymentStatus !== "paid" && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => openPrintCheck(e)} data-testid={`button-print-check-${e.id}`}>
                              <Printer className="h-3 w-3 mr-1" /> Print Check
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setMarkPaidExpenseId(e.id)} data-testid={`button-mark-paid-expense-${e.id}`}>
                              <BanknoteIcon className="h-3 w-3 mr-1" /> Mark Paid
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="pending-approvals" className="space-y-6">
            {pendingExpenseApprovals.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-3">Pending Expense Approvals</h3>
                <div className="space-y-3">
                  {pendingExpenseApprovals.map((e: any) => (
                    <Card key={e.id} data-testid={`card-approval-expense-${e.id}`}>
                      <CardContent className="pt-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium">{getWorkerName(e.submitterId)} — {formatCurrency(e.amount)}</p>
                            <p className="text-sm text-muted-foreground">{e.expenseDate} | {e.vendor || "No vendor"} | {e.categoryName || "Uncategorized"}</p>
                            {e.businessPurpose && <p className="text-sm mt-1">{e.businessPurpose}</p>}
                            {e.reimbursementRequested && <Badge variant="secondary" className="mt-1">Reimbursement Requested</Badge>}
                            {e.preapprovalStatus === "required" && !e.preapprovalReference && (
                              <div className="mt-1 flex items-center gap-1 text-amber-600 text-xs"><AlertTriangle className="h-3 w-3" /> Missing preapproval</div>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => approveMutation.mutate({ type: "expense", id: e.id })} data-testid={`button-approve-expense-${e.id}`}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => { setRejectTarget({ type: "expense", id: e.id }); setRejectReason(""); setRejectDialogOpen(true); }} data-testid={`button-reject-expense-${e.id}`}>
                              <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {pendingInvoiceApprovals.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-3">Pending Invoice Approvals</h3>
                <div className="space-y-3">
                  {pendingInvoiceApprovals.map((inv: any) => (
                    <Card key={inv.id} data-testid={`card-approval-invoice-${inv.id}`}>
                      <CardContent className="pt-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium">{getWorkerName(inv.contractorId)} — {formatCurrency(inv.amount)}</p>
                            <p className="text-sm text-muted-foreground">Invoice #{inv.invoiceNumber || "—"} | {inv.invoiceDate}</p>
                            {inv.description && <p className="text-sm mt-1">{inv.description}</p>}
                            {!inv.proposalReference && (
                              <div className="mt-1 flex items-center gap-1 text-amber-600 text-xs"><AlertTriangle className="h-3 w-3" /> No proposal reference</div>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => approveMutation.mutate({ type: "contractor_invoice", id: inv.id })} data-testid={`button-approve-invoice-${inv.id}`}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => { setRejectTarget({ type: "contractor_invoice", id: inv.id }); setRejectReason(""); setRejectDialogOpen(true); }} data-testid={`button-reject-invoice-${inv.id}`}>
                              <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {pendingExpenseApprovals.length === 0 && pendingInvoiceApprovals.length === 0 && (
              <Card><CardContent className="text-center py-12 text-muted-foreground">
                <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No pending approvals</p>
              </CardContent></Card>
            )}
          </TabsContent>
        )}

        <TabsContent value="invoices" className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-2">
            <p className="text-xs text-blue-700 dark:text-blue-400 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {INVOICE_POLICY}
            </p>
          </div>
          {invoices.length === 0 ? (
            <Card><CardContent className="text-center py-12 text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No contractor invoices</p>
            </CardContent></Card>
          ) : (
            <Table data-testid="table-invoices">
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Invoice #</TableHead><TableHead>Contractor</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Proposal</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {invoices.map((inv: any) => (
                  <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                    <TableCell>{inv.invoiceDate}</TableCell>
                    <TableCell>{inv.invoiceNumber || "—"}</TableCell>
                    <TableCell>{getWorkerName(inv.contractorId)}</TableCell>
                    <TableCell className="font-mono">{formatCurrency(inv.amount)}</TableCell>
                    <TableCell>{statusBadge(inv.status)}</TableCell>
                    <TableCell>{inv.proposalReference || "—"}</TableCell>
                    <TableCell>
                      {inv.status === "draft" && (
                        <Button size="sm" variant="outline" onClick={() => submitMutation.mutate({ type: "contractor_invoice", id: inv.id })} data-testid={`button-submit-invoice-${inv.id}`}>
                          <Send className="h-3 w-3 mr-1" /> Submit
                        </Button>
                      )}
                      {isAdmin && (inv.status === "approved" || inv.status === "paid") && (
                        <Button size="sm" variant="outline" onClick={() => openInvoicePrintCheck(inv)} data-testid={`button-print-check-invoice-${inv.id}`}>
                          <Printer className="h-3 w-3 mr-1" /> Print Check
                        </Button>
                      )}
                      {inv.status === "approved" && isAdmin && (
                        <Button size="sm" variant="ghost" onClick={() => markPaidMutation.mutate(inv.id)} data-testid={`button-mark-paid-${inv.id}`}>
                          <DollarSign className="h-3 w-3 mr-1" /> Mark Paid
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {isAdmin && (
          <TabsContent value="reimbursements" className="space-y-4">
            <h3 className="text-lg font-semibold">Payroll Reimbursement Queue</h3>
            {reimbursements.length === 0 ? (
              <Card><CardContent className="text-center py-12 text-muted-foreground">No reimbursement items.</CardContent></Card>
            ) : (
              <Table data-testid="table-reimbursements">
                <TableHeader><TableRow><TableHead>Worker</TableHead><TableHead>Amount</TableHead><TableHead>Description</TableHead><TableHead>Taxable</TableHead><TableHead>Status</TableHead><TableHead>Payroll Run</TableHead></TableRow></TableHeader>
                <TableBody>
                  {reimbursements.map((r: any) => (
                    <TableRow key={r.id} data-testid={`row-reimb-${r.id}`}>
                      <TableCell>{getWorkerName(r.workerId)}</TableCell>
                      <TableCell className="font-mono">{formatCurrency(r.amount)}</TableCell>
                      <TableCell className="text-sm">{r.description || "—"}</TableCell>
                      <TableCell>{r.isTaxable ? <Badge variant="destructive">Taxable</Badge> : <Badge variant="outline">Non-taxable</Badge>}</TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell>{r.payrollRunId || "Not assigned"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="ap-queue" className="space-y-4">
            <h3 className="text-lg font-semibold">Accounts Payable Queue</h3>
            {approvedInvoices.length === 0 ? (
              <Card><CardContent className="text-center py-12 text-muted-foreground">No approved invoices awaiting payment.</CardContent></Card>
            ) : (
              <Table data-testid="table-ap-queue">
                <TableHeader><TableRow><TableHead>Invoice #</TableHead><TableHead>Contractor</TableHead><TableHead>Amount</TableHead><TableHead>Due Date</TableHead><TableHead>Terms</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {approvedInvoices.map((inv: any) => (
                    <TableRow key={inv.id} data-testid={`row-ap-${inv.id}`}>
                      <TableCell>{inv.invoiceNumber || "—"}</TableCell>
                      <TableCell>{getWorkerName(inv.contractorId)}</TableCell>
                      <TableCell className="font-mono">{formatCurrency(inv.amount)}</TableCell>
                      <TableCell>{inv.dueDate || "—"}</TableCell>
                      <TableCell>{inv.paymentTerms || "—"}</TableCell>
                      <TableCell>
                        <Button size="sm" onClick={() => markPaidMutation.mutate(inv.id)} data-testid={`button-pay-${inv.id}`}>
                          <DollarSign className="h-3 w-3 mr-1" /> Mark Paid
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="recurring" className="space-y-4">
            <h3 className="text-lg font-semibold">Recurring Expense Templates</h3>
            {recurringTemplates.length === 0 ? (
              <Card><CardContent className="text-center py-12 text-muted-foreground">
                <RefreshCw className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No recurring expenses configured</p>
              </CardContent></Card>
            ) : (
              <Table data-testid="table-recurring">
                <TableHeader><TableRow><TableHead>Vendor</TableHead><TableHead>Amount</TableHead><TableHead>Frequency</TableHead><TableHead>Next Due</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {recurringTemplates.map((t: any) => (
                    <TableRow key={t.id} data-testid={`row-recurring-${t.id}`}>
                      <TableCell>{t.vendor || t.description || "—"}</TableCell>
                      <TableCell className="font-mono">{formatCurrency(t.amount)}</TableCell>
                      <TableCell><Badge variant="outline">{t.frequency}</Badge></TableCell>
                      <TableCell>{t.nextDueDate || "—"}</TableCell>
                      <TableCell>{t.isActive ? <Badge variant="default">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="export" className="space-y-4">
            <h3 className="text-lg font-semibold">Accounting Export</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" /> Expense Export</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3">Export all expenses to CSV for accounting import.</p>
                  <Button onClick={() => window.open("/api/expenses/export/csv", "_blank")} data-testid="button-export-expenses">
                    <Download className="h-4 w-4 mr-1" /> Download Expenses CSV
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" /> Invoice Export</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3">Export all contractor invoices to CSV.</p>
                  <Button onClick={() => window.open("/api/contractor-invoices/export/csv", "_blank")} data-testid="button-export-invoices">
                    <Download className="h-4 w-4 mr-1" /> Download Invoices CSV
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={expenseDialogOpen} onOpenChange={setExpenseDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Submit Expense</DialogTitle></DialogHeader>
          <ExpenseSubmitForm categories={categories} companies={companies} jobs={jobs} costCenters={costCenters} onClose={() => setExpenseDialogOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={invoiceDialogOpen} onOpenChange={setInvoiceDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Submit Contractor Invoice</DialogTitle></DialogHeader>
          <InvoiceSubmitForm companies={companies} jobs={jobs} costCenters={costCenters} onClose={() => setInvoiceDialogOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={rejectDialogOpen} onOpenChange={(v) => { setRejectDialogOpen(v); if (!v) setRejectTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject {rejectTarget?.type === "expense" ? "Expense" : "Invoice"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Reason for Rejection</Label>
            <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Provide a reason..." data-testid="input-reject-reason" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { if (rejectTarget) rejectMutation.mutate({ ...rejectTarget, reason: rejectReason }); }} data-testid="button-confirm-reject">
              {rejectMutation.isPending ? "Rejecting..." : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Mark Expense Paid (quick confirm) ─────────────────────────────── */}
      <Dialog open={!!markPaidExpenseId} onOpenChange={(v) => { if (!v) setMarkPaidExpenseId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark Expense as Paid</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This records the expense as paid without printing a check. Use <strong>Print Check</strong> instead if you want to generate a vendor check PDF at the same time.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkPaidExpenseId(null)} data-testid="button-cancel-mark-paid">Cancel</Button>
            <Button
              onClick={() => { if (markPaidExpenseId) markExpensePaidMutation.mutate(markPaidExpenseId); }}
              disabled={markExpensePaidMutation.isPending}
              data-testid="button-confirm-mark-paid"
            >
              {markExpensePaidMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Saving…</> : <><BanknoteIcon className="h-4 w-4 mr-1" />Mark Paid</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Print Check for Expense ────────────────────────────────────────── */}
      <Dialog open={!!printCheckTarget} onOpenChange={(v) => { if (!v) setPrintCheckTarget(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Printer className="h-5 w-5" /> Print Vendor Check</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <p className="text-sm text-muted-foreground">
              Generates a check PDF and marks the expense as paid. Payee details are printed on the check — ensure they match the pre-printed check stock.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label>Payee Name <span className="text-destructive">*</span></Label>
                <Input
                  value={printCheckForm.payeeName}
                  onChange={e => setPrintCheckForm(f => ({ ...f, payeeName: e.target.value }))}
                  placeholder="Acme Supplies LLC"
                  data-testid="input-check-payee-name"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Street Address</Label>
                <Input
                  value={printCheckForm.payeeAddress}
                  onChange={e => setPrintCheckForm(f => ({ ...f, payeeAddress: e.target.value }))}
                  placeholder="123 Main St"
                  data-testid="input-check-payee-address"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>City, State, ZIP</Label>
                <Input
                  value={printCheckForm.payeeCityStateZip}
                  onChange={e => setPrintCheckForm(f => ({ ...f, payeeCityStateZip: e.target.value }))}
                  placeholder="Springfield, IL 62701"
                  data-testid="input-check-payee-csz"
                />
              </div>
              <div className="space-y-1">
                <Label>Check Amount ($) <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  step="0.01"
                  value={printCheckForm.amount}
                  onChange={e => setPrintCheckForm(f => ({ ...f, amount: e.target.value }))}
                  data-testid="input-check-amount"
                />
              </div>
              <div className="space-y-1">
                <Label>Check Number <span className="text-xs text-muted-foreground">(optional)</span></Label>
                <Input
                  value={printCheckForm.checkNumber}
                  onChange={e => setPrintCheckForm(f => ({ ...f, checkNumber: e.target.value }))}
                  placeholder="auto"
                  data-testid="input-check-number"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Memo</Label>
                <Input
                  value={printCheckForm.memo}
                  onChange={e => setPrintCheckForm(f => ({ ...f, memo: e.target.value }))}
                  placeholder="Invoice / purpose description"
                  data-testid="input-check-memo"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintCheckTarget(null)} data-testid="button-cancel-print-check">Cancel</Button>
            <Button
              onClick={() => { if (printCheckTarget) printCheckMutation.mutate({ id: String(printCheckTarget.id), form: printCheckForm }); }}
              disabled={printCheckMutation.isPending || !printCheckForm.payeeName || !printCheckForm.amount}
              data-testid="button-confirm-print-check"
            >
              {printCheckMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Generating…</>
                : <><Printer className="h-4 w-4 mr-1" />Print Check &amp; Mark Paid</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Print Check for Contractor Invoice ───────────────────────────────── */}
      <Dialog open={!!invoicePrintTarget} onOpenChange={(v) => { if (!v) setInvoicePrintTarget(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Printer className="h-5 w-5" /> Print Invoice Check</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <p className="text-sm text-muted-foreground">
              Generates a check PDF for this contractor invoice. You can reprint at any time — this does not change the payment status.
            </p>
            {invoicePrintTarget?.status === "paid" && (
              <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                This invoice is already marked <strong>paid</strong>. Printing will generate a duplicate check — ensure you void the original if reissuing.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label>Payee Name <span className="text-destructive">*</span></Label>
                <Input
                  value={invoicePrintForm.payeeName}
                  onChange={e => setInvoicePrintForm(f => ({ ...f, payeeName: e.target.value }))}
                  placeholder="Contractor full name or company"
                  data-testid="input-inv-check-payee-name"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Street Address</Label>
                <Input
                  value={invoicePrintForm.payeeAddress}
                  onChange={e => setInvoicePrintForm(f => ({ ...f, payeeAddress: e.target.value }))}
                  placeholder="123 Main St"
                  data-testid="input-inv-check-payee-address"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>City, State, ZIP</Label>
                <Input
                  value={invoicePrintForm.payeeCityStateZip}
                  onChange={e => setInvoicePrintForm(f => ({ ...f, payeeCityStateZip: e.target.value }))}
                  placeholder="Springfield, IL 62701"
                  data-testid="input-inv-check-payee-csz"
                />
              </div>
              <div className="space-y-1">
                <Label>Check Amount ($) <span className="text-destructive">*</span></Label>
                <Input
                  type="number" step="0.01"
                  value={invoicePrintForm.amount}
                  onChange={e => setInvoicePrintForm(f => ({ ...f, amount: e.target.value }))}
                  data-testid="input-inv-check-amount"
                />
              </div>
              <div className="space-y-1">
                <Label>Check Number <span className="text-xs text-muted-foreground">(optional)</span></Label>
                <Input
                  value={invoicePrintForm.checkNumber}
                  onChange={e => setInvoicePrintForm(f => ({ ...f, checkNumber: e.target.value }))}
                  placeholder="auto"
                  data-testid="input-inv-check-number"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Memo</Label>
                <Input
                  value={invoicePrintForm.memo}
                  onChange={e => setInvoicePrintForm(f => ({ ...f, memo: e.target.value }))}
                  placeholder="Invoice number / purpose"
                  data-testid="input-inv-check-memo"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoicePrintTarget(null)} data-testid="button-cancel-inv-print-check">Cancel</Button>
            <Button
              onClick={() => { if (invoicePrintTarget) invoicePrintMutation.mutate({ id: String(invoicePrintTarget.id), form: invoicePrintForm }); }}
              disabled={invoicePrintMutation.isPending || !invoicePrintForm.payeeName || !invoicePrintForm.amount}
              data-testid="button-confirm-inv-print-check"
            >
              {invoicePrintMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Generating…</>
                : <><Printer className="h-4 w-4 mr-1" />Print Check</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
