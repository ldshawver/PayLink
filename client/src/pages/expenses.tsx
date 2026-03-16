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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Receipt as ReceiptIcon, Plus, Pencil, Trash2, MoreHorizontal, Upload, FileText, DollarSign, Filter, Printer } from "lucide-react";
import { Link } from "wouter";
import { Checkbox } from "@/components/ui/checkbox";

const CATEGORIES = [
  "general", "meals", "travel", "supplies", "equipment", "software",
  "utilities", "professional-services", "repairs", "other"
];

const STATUS_COLORS: Record<string, string> = {
  pending: "outline",
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

export default function ExpensesPage() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<Receipt | null>(null);
  const [form, setForm] = useState<ReceiptForm>(EMPTY_FORM);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterCompany, setFilterCompany] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const { data: receipts = [], isLoading } = useQuery<Receipt[]>({
    queryKey: ["/api/receipts"],
  });

  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: costCenters = [] } = useQuery<any[]>({ queryKey: ["/api/cost-centers"] });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"] });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/receipts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      setAddOpen(false);
      setForm(EMPTY_FORM);
      toast({ title: "Receipt added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/receipts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      setEditingReceipt(null);
      toast({ title: "Receipt updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/receipts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      toast({ title: "Receipt deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/receipts/${id}`, { status });
      return res.json();
    },
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
      const res = await fetch("/api/receipts/upload", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
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
      companyId: r.companyId || "",
      workerId: r.workerId || "",
      costCenterId: r.costCenterId || "",
      jobId: r.jobId || "",
      vendor: r.vendor || "",
      description: r.description || "",
      amount: r.amount?.toString() || "",
      receiptDate: r.receiptDate || new Date().toISOString().split("T")[0],
      category: r.category || "general",
      notes: r.notes || "",
      includeInJobCost: (r as any).includeInJobCost || false,
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
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(r => r.id)));
    }
  }

  function handleSubmit() {
    const data = {
      ...form,
      amount: parseFloat(form.amount) || 0,
      companyId: form.companyId || null,
      workerId: form.workerId || null,
      costCenterId: form.costCenterId || null,
      jobId: form.jobId || null,
    };
    if (editingReceipt) {
      updateMutation.mutate({ id: editingReceipt.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  function getWorkerName(id: string) {
    const w = workers.find(w => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  }

  function getCompanyName(id: string) {
    return companies.find(c => c.id === id)?.name || id;
  }

  function getCostCenterName(id: string) {
    return (costCenters as any[]).find(c => c.id === id)?.name || id;
  }

  function getJobName(id: string) {
    return (jobs as any[]).find(j => j.id === id)?.title || id;
  }

  const filtered = receipts.filter(r => {
    if (filterCompany !== "all" && r.companyId !== filterCompany) return false;
    if (filterCategory !== "all" && r.category !== filterCategory) return false;
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !r.vendor?.toLowerCase().includes(q) &&
        !r.description?.toLowerCase().includes(q) &&
        !r.notes?.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const totalAmount = filtered.reduce((sum, r) => sum + parseFloat(r.amount?.toString() || "0"), 0);
  const pendingAmount = filtered.filter(r => r.status === "pending").reduce((sum, r) => sum + parseFloat(r.amount?.toString() || "0"), 0);
  const approvedAmount = filtered.filter(r => r.status === "approved").reduce((sum, r) => sum + parseFloat(r.amount?.toString() || "0"), 0);

  const ReceiptFormContent = () => (
    <div className="space-y-3">
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
            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1).replace(/-/g, " ")}</SelectItem>)}
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
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Link href={`/print-expense-check?ids=${Array.from(selectedIds).join(",")}`}>
              <Button variant="outline" data-testid="button-print-selected">
                <Printer className="h-4 w-4 mr-2" />
                Print {selectedIds.size} Check{selectedIds.size !== 1 ? "s" : ""}
              </Button>
            </Link>
          )}
          <Button onClick={() => { setEditingReceipt(null); setForm(EMPTY_FORM); setAddOpen(true); }} data-testid="button-add-receipt">
            <Plus className="h-4 w-4 mr-2" />
            Add Receipt
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

      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-3 items-center">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search vendor, description..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="max-w-xs"
              data-testid="input-search-receipts"
            />
            <Select value={filterCompany} onValueChange={setFilterCompany}>
              <SelectTrigger className="w-40" data-testid="select-filter-company"><SelectValue placeholder="Company" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Companies</SelectItem>
                {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-40" data-testid="select-filter-category"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1).replace(/-/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-36" data-testid="select-filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
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
                      <Checkbox
                        checked={filtered.length > 0 && selectedIds.size === filtered.length}
                        onCheckedChange={toggleSelectAll}
                        data-testid="checkbox-select-all"
                      />
                    </TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Job Cost</TableHead>
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
                        <Checkbox
                          checked={selectedIds.has(r.id)}
                          onCheckedChange={() => toggleSelect(r.id)}
                          data-testid={`checkbox-select-${r.id}`}
                        />
                      </TableCell>
                      <TableCell className="text-sm">{r.receiptDate}</TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{r.vendor || "—"}</div>
                        {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-xs">
                          {r.category?.replace(/-/g, " ") || "general"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {(r as any).includeInJobCost
                          ? <Badge className="text-xs bg-emerald-600">Yes</Badge>
                          : <span className="text-xs text-muted-foreground">No</span>}
                      </TableCell>
                      <TableCell className="text-sm">{r.costCenterId ? getCostCenterName(r.costCenterId) : "—"}</TableCell>
                      <TableCell className="text-sm">{r.jobId ? getJobName(r.jobId) : "—"}</TableCell>
                      <TableCell className="text-sm">{r.workerId ? getWorkerName(r.workerId) : "—"}</TableCell>
                      <TableCell className="text-right font-medium text-sm">${parseFloat(r.amount?.toString() || "0").toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_COLORS[r.status || "pending"] as any} data-testid={`badge-status-${r.id}`}>
                          {r.status || "pending"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {r.receiptImagePath ? (
                          <a
                            href={r.receiptImagePath}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline"
                            data-testid={`link-receipt-image-${r.id}`}
                          >
                            View
                          </a>
                        ) : (
                          <label className="cursor-pointer">
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              className="hidden"
                              onChange={e => e.target.files?.[0] && handleUpload(r.id, e.target.files[0])}
                              data-testid={`input-upload-${r.id}`}
                            />
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
                            <Button size="icon" variant="ghost" data-testid={`button-menu-${r.id}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(r)} data-testid={`button-edit-${r.id}`}>
                              <Pencil className="mr-2 h-4 w-4" />Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild data-testid={`button-print-check-${r.id}`}>
                              <Link href={`/print-expense-check?ids=${r.id}`}>
                                <Printer className="mr-2 h-4 w-4" />Print Check
                              </Link>
                            </DropdownMenuItem>
                            {r.status === "pending" && (
                              <DropdownMenuItem onClick={() => approveMutation.mutate({ id: r.id, status: "approved" })} data-testid={`button-approve-${r.id}`}>
                                Approve
                              </DropdownMenuItem>
                            )}
                            {r.status === "pending" && (
                              <DropdownMenuItem onClick={() => approveMutation.mutate({ id: r.id, status: "rejected" })} className="text-destructive" data-testid={`button-reject-${r.id}`}>
                                Reject
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => confirm("Delete this receipt?") && deleteMutation.mutate(r.id)}
                              className="text-destructive"
                              data-testid={`button-delete-${r.id}`}
                            >
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
