import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, Search, Edit, Trash2, FileText, DollarSign, Send, Eye, Loader2,
  CalendarDays, Clock, CheckCircle, AlertCircle, XCircle, Copy,
} from "lucide-react";
import type { Invoice, Customer } from "@shared/schema";

type InvoiceWithItems = Invoice & { lineItems?: any[] };

function InvoiceForm({ invoice, customers, companyId, onSave, onCancel }: {
  invoice?: InvoiceWithItems;
  customers: Customer[];
  companyId: string;
  onSave: (data: any) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    customerId: invoice?.customerId || "",
    invoiceNumber: invoice?.invoiceNumber || `INV-${Date.now().toString(36).toUpperCase()}`,
    status: invoice?.status || "draft",
    issueDate: invoice?.issueDate || new Date().toISOString().split("T")[0],
    dueDate: invoice?.dueDate || "",
    notes: invoice?.notes || "",
    paymentTerms: invoice?.paymentTerms || "net_30",
  });

  const [lineItems, setLineItems] = useState<Array<{ description: string; quantity: string; unitPrice: string; taxable: boolean }>>(
    invoice?.lineItems?.map((li: any) => ({
      description: li.description || "",
      quantity: String(li.quantity || "1"),
      unitPrice: String(li.unitPrice || "0"),
      taxable: li.taxable !== false,
    })) || [{ description: "", quantity: "1", unitPrice: "0", taxable: true }]
  );

  const addLine = () => setLineItems([...lineItems, { description: "", quantity: "1", unitPrice: "0", taxable: true }]);
  const removeLine = (i: number) => setLineItems(lineItems.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: string, value: any) => {
    const updated = [...lineItems];
    updated[i] = { ...updated[i], [field]: value };
    setLineItems(updated);
  };

  const subtotal = lineItems.reduce((sum, li) => sum + (parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0), 0);
  const total = subtotal;

  const handleSave = () => {
    onSave({
      ...form,
      companyId,
      subtotal: subtotal.toFixed(2),
      taxAmount: "0",
      totalAmount: total.toFixed(2),
      amountDue: total.toFixed(2),
      lineItems: lineItems.filter(li => li.description).map((li, i) => ({
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        amount: ((parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0)).toFixed(2),
        taxable: li.taxable,
        sortOrder: i,
      })),
    });
  };

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Customer *</Label>
          <Select value={form.customerId} onValueChange={v => setForm({ ...form, customerId: v })}>
            <SelectTrigger data-testid="select-invoice-customer">
              <SelectValue placeholder="Select customer" />
            </SelectTrigger>
            <SelectContent>
              {customers.map(c => (
                <SelectItem key={c.id} value={c.id} data-testid={`option-customer-${c.id}`}>{c.customerName}{c.businessName ? ` (${c.businessName})` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Invoice Number *</Label>
          <Input data-testid="input-invoice-number" value={form.invoiceNumber} onChange={e => setForm({ ...form, invoiceNumber: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>Issue Date</Label>
          <Input data-testid="input-issue-date" type="date" value={form.issueDate} onChange={e => setForm({ ...form, issueDate: e.target.value })} />
        </div>
        <div>
          <Label>Due Date</Label>
          <Input data-testid="input-due-date" type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} />
        </div>
        <div>
          <Label>Status</Label>
          <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
            <SelectTrigger data-testid="select-invoice-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft" data-testid="option-draft">Draft</SelectItem>
              <SelectItem value="sent" data-testid="option-sent">Sent</SelectItem>
              <SelectItem value="viewed" data-testid="option-viewed">Viewed</SelectItem>
              <SelectItem value="paid" data-testid="option-paid">Paid</SelectItem>
              <SelectItem value="overdue" data-testid="option-overdue">Overdue</SelectItem>
              <SelectItem value="cancelled" data-testid="option-cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">Line Items</Label>
          <Button variant="outline" size="sm" onClick={addLine} data-testid="button-add-line">
            <Plus className="h-3 w-3 mr-1" /> Add Line
          </Button>
        </div>
        <div className="space-y-2">
          {lineItems.map((li, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-5">
                {i === 0 && <Label className="text-xs">Description</Label>}
                <Input placeholder="Description" value={li.description} onChange={e => updateLine(i, "description", e.target.value)}
                  data-testid={`input-line-desc-${i}`} />
              </div>
              <div className="col-span-2">
                {i === 0 && <Label className="text-xs">Qty</Label>}
                <Input type="number" value={li.quantity} onChange={e => updateLine(i, "quantity", e.target.value)}
                  data-testid={`input-line-qty-${i}`} />
              </div>
              <div className="col-span-2">
                {i === 0 && <Label className="text-xs">Price</Label>}
                <Input type="number" step="0.01" value={li.unitPrice} onChange={e => updateLine(i, "unitPrice", e.target.value)}
                  data-testid={`input-line-price-${i}`} />
              </div>
              <div className="col-span-2 flex items-center gap-1">
                {i === 0 && <Label className="text-xs block mb-1">Taxable</Label>}
                <input type="checkbox" checked={li.taxable} onChange={e => updateLine(i, "taxable", e.target.checked)}
                  data-testid={`input-line-taxable-${i}`} className="h-4 w-4" />
              </div>
              <div className="col-span-1">
                {lineItems.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeLine(i)} data-testid={`button-remove-line-${i}`}>
                    <Trash2 className="h-3 w-3 text-red-500" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <div className="text-right space-y-1 text-sm">
            <div>Subtotal: <span className="font-medium" data-testid="text-subtotal">${subtotal.toFixed(2)}</span></div>
            <div className="text-base font-bold">Total: <span data-testid="text-total">${total.toFixed(2)}</span></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Notes</Label>
          <Textarea data-testid="input-invoice-notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
        </div>
        <div>
          <Label>Payment Terms</Label>
          <Select value={form.paymentTerms} onValueChange={v => setForm({ ...form, paymentTerms: v })}>
            <SelectTrigger data-testid="select-payment-terms">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="due_on_receipt" data-testid="option-terms-receipt">Due on Receipt</SelectItem>
              <SelectItem value="net_15" data-testid="option-terms-15">Net 15</SelectItem>
              <SelectItem value="net_30" data-testid="option-terms-30">Net 30</SelectItem>
              <SelectItem value="net_60" data-testid="option-terms-60">Net 60</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} data-testid="button-cancel-invoice">Cancel</Button>
        <Button onClick={handleSave} disabled={!form.customerId || !form.invoiceNumber || !form.dueDate} data-testid="button-save-invoice">
          {invoice?.id ? "Update" : "Create"} Invoice
        </Button>
      </DialogFooter>
    </div>
  );
}

const statusConfig: Record<string, { icon: any; color: string }> = {
  draft: { icon: FileText, color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  sent: { icon: Send, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  viewed: { icon: Eye, color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  paid: { icon: CheckCircle, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  partially_paid: { icon: Clock, color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  overdue: { icon: AlertCircle, color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  cancelled: { icon: XCircle, color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500" },
};

export default function InvoicesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InvoiceWithItems | undefined>();
  const [activeTab, setActiveTab] = useState("invoices");

  const companyId = user?.companyId;

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: [`/api/invoices?companyId=${companyId}`],
    enabled: !!companyId,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: [`/api/customers?companyId=${companyId}`],
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/invoices", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/invoices?companyId=${companyId}`] });
      toast({ title: "Invoice created" });
      setDialogOpen(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/invoices/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/invoices?companyId=${companyId}`] });
      toast({ title: "Invoice updated" });
      setDialogOpen(false);
      setEditing(undefined);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/invoices/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/invoices?companyId=${companyId}`] });
      toast({ title: "Invoice deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleEdit = async (invoice: Invoice) => {
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, { credentials: "include" });
      const full = await res.json();
      setEditing(full);
      setDialogOpen(true);
    } catch {
      setEditing(invoice);
      setDialogOpen(true);
    }
  };

  const handleDuplicate = async (invoice: Invoice) => {
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, { credentials: "include" });
      const full = await res.json();
      setEditing({
        ...full,
        id: undefined as any,
        invoiceNumber: `INV-${Date.now().toString(36).toUpperCase()}`,
        status: "draft",
        amountPaid: "0",
      });
      setDialogOpen(true);
    } catch {
      toast({ title: "Error duplicating", variant: "destructive" });
    }
  };

  const filtered = invoices.filter(inv => {
    const matchesSearch = !search ||
      inv.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
      (inv.customerId && customers.find(c => c.id === inv.customerId)?.customerName.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = statusFilter === "all" || inv.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const customerMap = Object.fromEntries(customers.map(c => [c.id, c]));

  const stats = {
    total: invoices.length,
    outstanding: invoices.filter(i => ["sent", "viewed", "overdue"].includes(i.status)).reduce((s, i) => s + parseFloat(i.totalAmount || "0"), 0),
    paid: invoices.filter(i => i.status === "paid").reduce((s, i) => s + parseFloat(i.totalAmount || "0"), 0),
    overdue: invoices.filter(i => i.status === "overdue").length,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Invoicing</h1>
          <p className="text-muted-foreground">Create and manage invoices</p>
        </div>
        <Button onClick={() => { setEditing(undefined); setDialogOpen(true); }} data-testid="button-create-invoice">
          <Plus className="h-4 w-4 mr-2" /> New Invoice
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Total Invoices</div>
          <div className="text-2xl font-bold mt-1" data-testid="text-total-invoices">{stats.total}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Outstanding</div>
          <div className="text-2xl font-bold mt-1 text-amber-600" data-testid="text-outstanding">${stats.outstanding.toFixed(2)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Paid</div>
          <div className="text-2xl font-bold mt-1 text-emerald-600" data-testid="text-paid">${stats.paid.toFixed(2)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Overdue</div>
          <div className="text-2xl font-bold mt-1 text-red-600" data-testid="text-overdue">{stats.overdue}</div>
        </CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="invoices" data-testid="tab-invoices">Invoices</TabsTrigger>
          <TabsTrigger value="recurring" data-testid="tab-recurring">Recurring</TabsTrigger>
          <TabsTrigger value="payments" data-testid="tab-payments">Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="space-y-4">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search invoices..." value={search} onChange={e => setSearch(e.target.value)}
                className="pl-10" data-testid="input-search-invoices" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40" data-testid="select-invoice-filter">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="option-filter-all">All</SelectItem>
                <SelectItem value="draft" data-testid="option-filter-draft">Draft</SelectItem>
                <SelectItem value="sent" data-testid="option-filter-sent">Sent</SelectItem>
                <SelectItem value="paid" data-testid="option-filter-paid">Paid</SelectItem>
                <SelectItem value="overdue" data-testid="option-filter-overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">No invoices found</p>
                <Button variant="outline" className="mt-4" onClick={() => { setEditing(undefined); setDialogOpen(true); }}
                  data-testid="button-create-first-invoice">
                  <Plus className="h-4 w-4 mr-2" /> Create your first invoice
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filtered.map(invoice => {
                const sc = statusConfig[invoice.status] || statusConfig.draft;
                const StatusIcon = sc.icon;
                const customer = customerMap[invoice.customerId || ""];
                return (
                  <Card key={invoice.id} className="hover:shadow-md transition-shadow" data-testid={`card-invoice-${invoice.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4 flex-1">
                          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-teal-500 to-blue-500 flex items-center justify-center text-white">
                            <FileText className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold" data-testid={`text-invoice-number-${invoice.id}`}>{invoice.invoiceNumber}</span>
                              <Badge className={sc.color}>
                                <StatusIcon className="h-3 w-3 mr-1" />
                                {invoice.status}
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground flex items-center gap-3 mt-1">
                              {customer && <span>{customer.customerName}</span>}
                              {invoice.dueDate && (
                                <span className="flex items-center gap-1">
                                  <CalendarDays className="h-3 w-3" /> Due {new Date(invoice.dueDate).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="font-bold text-lg" data-testid={`text-invoice-total-${invoice.id}`}>${parseFloat(invoice.totalAmount || "0").toFixed(2)}</div>
                            {parseFloat(invoice.amountPaid || "0") > 0 && parseFloat(invoice.amountPaid || "0") < parseFloat(invoice.totalAmount || "0") && (
                              <div className="text-xs text-muted-foreground">Paid: ${parseFloat(invoice.amountPaid || "0").toFixed(2)}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => handleEdit(invoice)} data-testid={`button-edit-invoice-${invoice.id}`}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDuplicate(invoice)} data-testid={`button-duplicate-${invoice.id}`}>
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => {
                              if (confirm("Delete this invoice?")) deleteMutation.mutate(invoice.id);
                            }} data-testid={`button-delete-invoice-${invoice.id}`}>
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="recurring">
          <Card>
            <CardContent className="py-12 text-center">
              <Clock className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-lg font-medium">Recurring Billing</p>
              <p className="text-muted-foreground mt-1">Set up automatic recurring invoices for your customers</p>
              <Button variant="outline" className="mt-4" data-testid="button-setup-recurring">
                <Plus className="h-4 w-4 mr-2" /> Create Recurring Profile
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <PaymentsTab companyId={companyId || ""} />
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit Invoice" : "New Invoice"}</DialogTitle>
          </DialogHeader>
          <InvoiceForm
            invoice={editing}
            customers={customers}
            companyId={companyId || ""}
            onSave={data => {
              if (editing?.id) {
                updateMutation.mutate({ id: editing.id, data });
              } else {
                createMutation.mutate(data);
              }
            }}
            onCancel={() => { setDialogOpen(false); setEditing(undefined); }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaymentsTab({ companyId }: { companyId: string }) {
  const { data: payments = [], isLoading } = useQuery<any[]>({
    queryKey: [`/api/payments?companyId=${companyId}`],
    enabled: !!companyId,
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  if (payments.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <DollarSign className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-lg font-medium">No Payments Yet</p>
          <p className="text-muted-foreground mt-1">Payments will appear here when invoices are paid</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {payments.map((p: any) => (
        <Card key={p.id} data-testid={`card-payment-${p.id}`}>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium">${parseFloat(p.amount).toFixed(2)}</div>
              <div className="text-sm text-muted-foreground">{p.paymentMethod} - {new Date(p.createdAt).toLocaleDateString()}</div>
            </div>
            <Badge className={p.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-700"}>
              {p.status}
            </Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
