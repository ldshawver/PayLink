import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Receipt, Worker, Company } from "@shared/schema";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Receipt as ReceiptIcon,
  Plus,
  Pencil,
  Trash2,
  MoreHorizontal,
  Upload,
  FileText,
  DollarSign,
  Filter,
  Printer,
  Download,
  BarChart3,
  ChevronDown,
} from "lucide-react";
import { Link } from "wouter";
import { Checkbox } from "@/components/ui/checkbox";
import * as XLSX from "xlsx";

const CATEGORIES = [
  { value: "general",              label: "General" },
  { value: "raw-materials",        label: "Raw Materials" },
  { value: "overhead",             label: "Overhead" },
  { value: "reimbursement",        label: "Reimbursement" },
  { value: "meals",                label: "Meals" },
  { value: "travel",               label: "Travel" },
  { value: "supplies",             label: "Supplies" },
  { value: "equipment",            label: "Equipment" },
  { value: "software",             label: "Software" },
  { value: "utilities",            label: "Utilities" },
  { value: "professional-services",label: "Professional Services" },
  { value: "repairs",              label: "Repairs" },
  { value: "other",                label: "Other" },
];

const CATEGORY_COLORS: Record<string, string> = {
  "raw-materials":        "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  "overhead":             "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  "reimbursement":        "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  "meals":                "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  "travel":               "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  "supplies":             "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  "equipment":            "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
};

const STATUS_COLORS: Record<string, string> = {
  pending:  "outline",
  approved: "default",
  rejected: "destructive",
};

type ReceiptForm = {
  companyId: string;
  workerId: string;
  costCenterId: string;
  jobId: string;
  vendor: string;
  description: string;
  amount: string;
  receiptDate: string;
  category: string;
  notes: string;
  includeInJobCost: boolean;
};

const EMPTY_FORM: ReceiptForm = {
  companyId: "",
  workerId: "",
  costCenterId: "",
  jobId: "",
  vendor: "",
  description: "",
  amount: "",
  receiptDate: new Date().toISOString().split("T")[0],
  category: "general",
  notes: "",
  includeInJobCost: false,
};

function catLabel(value: string) {
  return CATEGORIES.find(c => c.value === value)?.label ?? value.replace(/-/g, " ");
}

function catClass(value: string) {
  return CATEGORY_COLORS[value] ?? "bg-muted text-muted-foreground";
}

export default function ExpensesPage() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<Receipt | null>(null);
  const [form, setForm] = useState<ReceiptForm>(EMPTY_FORM);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterCompany, setFilterCompany] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const { data: receipts = [], isLoading } = useQuery<Receipt[]>({ queryKey: ["/api/receipts"] });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: costCenters = [] } = useQuery<any[]>({ queryKey: ["/api/cost-centers"] });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"] });

  const createMutation = useMutation({
    mutationFn: async (data: any) => (await apiRequest("POST", "/api/receipts", data)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      setAddOpen(false);
      setForm(EMPTY_FORM);
      toast({ title: "Receipt added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) =>
      (await apiRequest("PATCH", `/api/receipts/${id}`, data)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      setEditingReceipt(null);
      toast({ title: "Receipt updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/receipts/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      toast({ title: "Receipt deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      (await apiRequest("PATCH", `/api/receipts/${id}`, { status })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      toast({ title: "Status updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  async function handleUpload(receiptId: string, file: File) {
    setUploadingFor(receiptId);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/receipts/upload", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error("Upload failed");
      const { filePath } = await res.json();
      await apiRequest("PATCH", `/api/receipts/${receiptId}`, { receiptImagePath: filePath });
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      toast({ title: "Receipt image uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploadingFor(null);
    }
  }

  function openEdit(r: Receipt) {
    setEditingReceipt(r);
    setForm({
      companyId:       r.companyId || "",
      workerId:        r.workerId || "",
      costCenterId:    r.costCenterId || "",
      jobId:           r.jobId || "",
      vendor:          r.vendor || "",
      description:     r.description || "",
      amount:          r.amount?.toString() || "",
      receiptDate:     r.receiptDate || new Date().toISOString().split("T")[0],
      category:        r.category || "general",
      notes:           r.notes || "",
      includeInJobCost:(r as any).includeInJobCost || false,
    });
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(r => r.id)));
  }

  function handleSubmit() {
    const data = {
      ...form,
      amount:       parseFloat(form.amount) || 0,
      companyId:    form.companyId    || null,
      workerId:     form.workerId     || null,
      costCenterId: form.costCenterId || null,
      jobId:        form.jobId        || null,
    };
    if (editingReceipt) updateMutation.mutate({ id: editingReceipt.id, data });
    else createMutation.mutate(data);
  }

  function getWorkerName(id: string) {
    const w = workers.find(w => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  }
  function getCompanyName(id: string) { return companies.find(c => c.id === id)?.name || id; }
  function getCostCenterName(id: string) { return (costCenters as any[]).find(c => c.id === id)?.name || id; }
  function getJobName(id: string) { return (jobs as any[]).find(j => j.id === id)?.title || id; }

  const filtered = receipts.filter(r => {
    if (filterCompany !== "all" && r.companyId !== filterCompany) return false;
    if (filterCategory !== "all" && r.category !== filterCategory) return false;
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (filterDateFrom && r.receiptDate < filterDateFrom) return false;
    if (filterDateTo && r.receiptDate > filterDateTo) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!r.vendor?.toLowerCase().includes(q) && !r.description?.toLowerCase().includes(q) && !r.notes?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const totalAmount    = filtered.reduce((s, r) => s + parseFloat(r.amount?.toString() || "0"), 0);
  const pendingAmount  = filtered.filter(r => r.status === "pending").reduce((s, r) => s + parseFloat(r.amount?.toString() || "0"), 0);
  const approvedAmount = filtered.filter(r => r.status === "approved").reduce((s, r) => s + parseFloat(r.amount?.toString() || "0"), 0);

  function buildExportRows() {
    return filtered.map(r => ({
      Date:          r.receiptDate,
      Vendor:        r.vendor || "",
      Description:   r.description || "",
      Category:      catLabel(r.category || "general"),
      Amount:        parseFloat(r.amount?.toString() || "0"),
      Status:        r.status || "pending",
      Company:       r.companyId ? getCompanyName(r.companyId) : "",
      Employee:      r.workerId ? getWorkerName(r.workerId) : "",
      "Cost Center": r.costCenterId ? getCostCenterName(r.costCenterId) : "",
      Job:           r.jobId ? getJobName(r.jobId) : "",
      "Job Cost":    (r as any).includeInJobCost ? "Yes" : "No",
      Notes:         r.notes || "",
    }));
  }

  function exportCSV() {
    const rows = buildExportRows();
    if (rows.length === 0) { toast({ title: "No data to export" }); return; }
    const headers = Object.keys(rows[0]);
    const lines = [
      headers.join(","),
      ...rows.map(r =>
        headers.map(h => {
          const v = String((r as any)[h] ?? "");
          return v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v;
        }).join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `expenses_${new Date().toISOString().split("T")[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  function exportExcel() {
    const rows = buildExportRows();
    if (rows.length === 0) { toast({ title: "No data to export" }); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Expenses");

    const colWidths = Object.keys(rows[0]).map(key => ({
      wch: Math.max(key.length, ...rows.map(r => String((r as any)[key] ?? "").length)) + 2,
    }));
    ws["!cols"] = colWidths;

    XLSX.writeFile(wb, `expenses_${new Date().toISOString().split("T")[0]}.xlsx`);
  }

  const budgetByCostCenter: Record<string, { name: string; total: number; approved: number; pending: number; items: number }> = {};
  const budgetByJob: Record<string, { name: string; total: number; approved: number; pending: number; items: number }> = {};

  for (const r of filtered) {
    const amt = parseFloat(r.amount?.toString() || "0");
    if (r.costCenterId) {
      if (!budgetByCostCenter[r.costCenterId]) budgetByCostCenter[r.costCenterId] = { name: getCostCenterName(r.costCenterId), total: 0, approved: 0, pending: 0, items: 0 };
      budgetByCostCenter[r.costCenterId].total   += amt;
      budgetByCostCenter[r.costCenterId].items   += 1;
      if (r.status === "approved") budgetByCostCenter[r.costCenterId].approved += amt;
      if (r.status === "pending")  budgetByCostCenter[r.costCenterId].pending  += amt;
    }
    if (r.jobId) {
      if (!budgetByJob[r.jobId]) budgetByJob[r.jobId] = { name: getJobName(r.jobId), total: 0, approved: 0, pending: 0, items: 0 };
      budgetByJob[r.jobId].total   += amt;
      budgetByJob[r.jobId].items   += 1;
      if (r.status === "approved") budgetByJob[r.jobId].approved += amt;
      if (r.status === "pending")  budgetByJob[r.jobId].pending  += amt;
    }
  }

  const budgetByCategory: Record<string, number> = {};
  for (const r of filtered) {
    const cat = r.category || "general";
    budgetByCategory[cat] = (budgetByCategory[cat] || 0) + parseFloat(r.amount?.toString() || "0");
  }
  const sortedCatBudget = Object.entries(budgetByCategory).sort((a, b) => b[1] - a[1]);

  const ReceiptFormContent = () => (
    <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label>Company</Label>
          <Select value={form.companyId || "__none__"} onValueChange={v => setForm(f => ({ ...f, companyId: v === "__none__" ? "" : v }))}>
            <SelectTrigger data-testid="select-company"><SelectValue placeholder="Select company" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label>Employee</Label>
          <Select value={form.workerId || "__none__"} onValueChange={v => setForm(f => ({ ...f, workerId: v === "__none__" ? "" : v }))}>
            <SelectTrigger data-testid="select-worker"><SelectValue placeholder="Select employee" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {workers.filter(w => w.isActive).map(w => <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label>Cost Center</Label>
          <Select value={form.costCenterId || "__none__"} onValueChange={v => setForm(f => ({ ...f, costCenterId: v === "__none__" ? "" : v }))}>
            <SelectTrigger data-testid="select-cost-center"><SelectValue placeholder="Select cost center" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {(costCenters as any[]).map(cc => <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label>Job</Label>
          <Select value={form.jobId || "__none__"} onValueChange={v => setForm(f => ({ ...f, jobId: v === "__none__" ? "" : v }))}>
            <SelectTrigger data-testid="select-job"><SelectValue placeholder="Select job" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {(jobs as any[]).map(j => <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1">
        <Label>Vendor / Merchant <span className="text-destructive">*</span></Label>
        <Input value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} placeholder="e.g. Home Depot" data-testid="input-vendor" />
      </div>
      <div className="grid gap-1">
        <Label>Description</Label>
        <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description" data-testid="input-description" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label>Amount <span className="text-destructive">*</span></Label>
          <Input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" data-testid="input-amount" />
        </div>
        <div className="grid gap-1">
          <Label>Date <span className="text-destructive">*</span></Label>
          <Input type="date" value={form.receiptDate} onChange={e => setForm(f => ({ ...f, receiptDate: e.target.value }))} data-testid="input-date" />
        </div>
      </div>
      <div className="grid gap-1">
        <Label>Category</Label>
        <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
          <SelectTrigger data-testid="select-category"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <Label>Notes</Label>
        <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional notes" data-testid="input-notes" />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="includeInJobCost"
          checked={form.includeInJobCost}
          onCheckedChange={v => setForm(f => ({ ...f, includeInJobCost: !!v }))}
          data-testid="checkbox-includeInJobCost"
        />
        <Label htmlFor="includeInJobCost" className="cursor-pointer">Include in Job Costs</Label>
      </div>
      <Button
        className="w-full"
        onClick={handleSubmit}
        disabled={createMutation.isPending || updateMutation.isPending || !form.vendor || !form.amount || !form.receiptDate}
        data-testid="button-submit-receipt"
      >
        {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : editingReceipt ? "Update Receipt" : "Add Receipt"}
      </Button>
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-expenses-title">
          <ReceiptIcon className="h-6 w-6 text-teal-accent" />
          Expenses & Receipts
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          {selectedIds.size > 0 && (
            <Link href={`/print-expense-check?ids=${Array.from(selectedIds).join(",")}`}>
              <Button variant="outline" data-testid="button-print-selected">
                <Printer className="h-4 w-4 mr-2" />
                Print {selectedIds.size} Check{selectedIds.size !== 1 ? "s" : ""}
              </Button>
            </Link>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="button-export">
                <Download className="h-4 w-4 mr-2" />Export
                <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportCSV} data-testid="button-export-csv">
                <FileText className="mr-2 h-4 w-4" />Export as CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportExcel} data-testid="button-export-excel">
                <FileText className="mr-2 h-4 w-4 text-green-600" />Export as Excel (.xlsx)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => { setEditingReceipt(null); setForm(EMPTY_FORM); setAddOpen(true); }} data-testid="button-add-receipt">
            <Plus className="h-4 w-4 mr-2" />Add Receipt
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />Total Expenses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-total-amount">${totalAmount.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">{filtered.length} receipt{filtered.length !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <FileText className="h-4 w-4" />Pending
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-amber-600" data-testid="text-pending-amount">${pendingAmount.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">{filtered.filter(r => r.status === "pending").length} pending</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <ReceiptIcon className="h-4 w-4" />Approved
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-emerald-600" data-testid="text-approved-amount">${approvedAmount.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">{filtered.filter(r => r.status === "approved").length} approved</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="receipts">
        <TabsList>
          <TabsTrigger value="receipts" data-testid="tab-receipts">
            <ReceiptIcon className="h-4 w-4 mr-1.5" />Receipts
          </TabsTrigger>
          <TabsTrigger value="budget" data-testid="tab-budget">
            <BarChart3 className="h-4 w-4 mr-1.5" />Budget Summary
          </TabsTrigger>
        </TabsList>

        <TabsContent value="receipts" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex items-center gap-2 flex-wrap flex-1">
                  <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Input
                    placeholder="Search vendor, description..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="max-w-[200px]"
                    data-testid="input-search-receipts"
                  />
                  <Select value={filterCompany} onValueChange={setFilterCompany}>
                    <SelectTrigger className="w-36" data-testid="select-filter-company"><SelectValue placeholder="Company" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Companies</SelectItem>
                      {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filterCategory} onValueChange={setFilterCategory}>
                    <SelectTrigger className="w-44" data-testid="select-filter-category"><SelectValue placeholder="Category" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-32" data-testid="select-filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <div className="grid gap-0.5">
                    <Label className="text-xs text-muted-foreground">From</Label>
                    <Input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="w-36 h-8 text-sm" data-testid="input-date-from" />
                  </div>
                  <div className="grid gap-0.5">
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <Input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="w-36 h-8 text-sm" data-testid="input-date-to" />
                  </div>
                  {(filterDateFrom || filterDateTo) && (
                    <Button size="sm" variant="ghost" className="mt-4" onClick={() => { setFilterDateFrom(""); setFilterDateTo(""); }} data-testid="button-clear-dates">
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <ReceiptIcon className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No receipts found</p>
                  <p className="text-sm mt-1">Add expense receipts to track costs by cost center and job.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table data-testid="table-receipts">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox checked={filtered.length > 0 && selectedIds.size === filtered.length} onCheckedChange={toggleSelectAll} data-testid="checkbox-select-all" />
                        </TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Cost Center</TableHead>
                        <TableHead>Job</TableHead>
                        <TableHead>Employee</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Receipt</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map(r => (
                        <TableRow key={r.id} data-testid={`row-receipt-${r.id}`} className={selectedIds.has(r.id) ? "bg-muted/50" : ""}>
                          <TableCell>
                            <Checkbox checked={selectedIds.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} data-testid={`checkbox-select-${r.id}`} />
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{r.receiptDate}</TableCell>
                          <TableCell>
                            <div className="font-medium text-sm">{r.vendor || "—"}</div>
                            {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                          </TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${catClass(r.category || "general")}`}>
                              {catLabel(r.category || "general")}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">{r.costCenterId ? getCostCenterName(r.costCenterId) : "—"}</TableCell>
                          <TableCell className="text-sm">{r.jobId ? getJobName(r.jobId) : "—"}</TableCell>
                          <TableCell className="text-sm">{r.workerId ? getWorkerName(r.workerId) : "—"}</TableCell>
                          <TableCell className="text-right font-medium text-sm whitespace-nowrap">${parseFloat(r.amount?.toString() || "0").toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant={STATUS_COLORS[r.status || "pending"] as any} data-testid={`badge-status-${r.id}`}>
                              {r.status || "pending"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {r.receiptImagePath ? (
                              <a href={r.receiptImagePath} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline" data-testid={`link-receipt-image-${r.id}`}>View</a>
                            ) : (
                              <label className="cursor-pointer">
                                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => e.target.files?.[0] && handleUpload(r.id, e.target.files[0])} data-testid={`input-upload-${r.id}`} />
                                <span className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
                                  <Upload className="h-3 w-3" />
                                  {uploadingFor === r.id ? "Uploading..." : "Upload"}
                                </span>
                              </label>
                            )}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon" variant="ghost" data-testid={`button-menu-${r.id}`}><MoreHorizontal className="h-4 w-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEdit(r)} data-testid={`button-edit-${r.id}`}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                                <DropdownMenuItem asChild data-testid={`button-print-check-${r.id}`}>
                                  <Link href={`/print-expense-check?ids=${r.id}`}><Printer className="mr-2 h-4 w-4" />Print Check</Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {r.status === "pending" && (
                                  <DropdownMenuItem onClick={() => approveMutation.mutate({ id: r.id, status: "approved" })} data-testid={`button-approve-${r.id}`}>Approve</DropdownMenuItem>
                                )}
                                {r.status === "pending" && (
                                  <DropdownMenuItem onClick={() => approveMutation.mutate({ id: r.id, status: "rejected" })} className="text-destructive" data-testid={`button-reject-${r.id}`}>Reject</DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => confirm("Delete this receipt?") && deleteMutation.mutate(r.id)} className="text-destructive" data-testid={`button-delete-${r.id}`}>
                                  <Trash2 className="mr-2 h-4 w-4" />Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="budget" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="md:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">By Category</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {sortedCatBudget.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4">No data</p>
                ) : (
                  <div className="divide-y">
                    {sortedCatBudget.map(([cat, amt]) => (
                      <div key={cat} className="flex items-center justify-between px-4 py-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${catClass(cat)}`}>{catLabel(cat)}</span>
                        <span className="text-sm font-semibold tabular-nums">${amt.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">By Cost Center</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {Object.keys(budgetByCostCenter).length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4">No receipts assigned to a cost center yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cost Center</TableHead>
                        <TableHead className="text-right">Items</TableHead>
                        <TableHead className="text-right">Approved</TableHead>
                        <TableHead className="text-right">Pending</TableHead>
                        <TableHead className="text-right font-semibold">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.values(budgetByCostCenter).sort((a, b) => b.total - a.total).map(cc => (
                        <TableRow key={cc.name}>
                          <TableCell className="font-medium text-sm">{cc.name}</TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">{cc.items}</TableCell>
                          <TableCell className="text-right text-sm text-emerald-600">${cc.approved.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-sm text-amber-600">${cc.pending.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-semibold text-sm">${cc.total.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card className="md:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">By Job</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {Object.keys(budgetByJob).length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4">No receipts assigned to a job yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Job</TableHead>
                        <TableHead className="text-right">Items</TableHead>
                        <TableHead className="text-right">Approved</TableHead>
                        <TableHead className="text-right">Pending</TableHead>
                        <TableHead className="text-right font-semibold">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.values(budgetByJob).sort((a, b) => b.total - a.total).map(job => (
                        <TableRow key={job.name}>
                          <TableCell className="font-medium text-sm">{job.name}</TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">{job.items}</TableCell>
                          <TableCell className="text-right text-sm text-emerald-600">${job.approved.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-sm text-amber-600">${job.pending.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-semibold text-sm">${job.total.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add Expense Receipt</DialogTitle></DialogHeader>
          <ReceiptFormContent />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingReceipt} onOpenChange={v => !v && setEditingReceipt(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Receipt</DialogTitle></DialogHeader>
          <ReceiptFormContent />
        </DialogContent>
      </Dialog>
    </div>
  );
}
