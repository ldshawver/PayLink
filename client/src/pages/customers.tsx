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
import { Plus, Search, Edit, Trash2, Building2, Mail, Phone, MapPin, Users, Loader2 } from "lucide-react";
import type { Customer } from "@shared/schema";

function CustomerForm({ customer, onSave, onCancel }: {
  customer?: Customer;
  onSave: (data: any) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    customerName: customer?.customerName || "",
    email: customer?.email || "",
    phone: customer?.phone || "",
    businessName: customer?.businessName || "",
    billingContactName: customer?.billingContactName || "",
    billingEmail: customer?.billingEmail || "",
    billingAddress: customer?.billingAddress || "",
    billingCity: customer?.billingCity || "",
    billingState: customer?.billingState || "",
    billingZip: customer?.billingZip || "",
    billingCountry: customer?.billingCountry || "US",
    status: customer?.status || "active",
    notes: customer?.notes || "",
    taxId: customer?.taxId || "",
    defaultPaymentTerms: customer?.defaultPaymentTerms || "net_30",
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Contact Name *</Label>
          <Input data-testid="input-customer-name" value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} />
        </div>
        <div>
          <Label>Business Name</Label>
          <Input data-testid="input-customer-company" value={form.businessName} onChange={e => setForm({ ...form, businessName: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Email</Label>
          <Input data-testid="input-customer-email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <Label>Phone</Label>
          <Input data-testid="input-customer-phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Billing Contact</Label>
          <Input data-testid="input-billing-contact" value={form.billingContactName} onChange={e => setForm({ ...form, billingContactName: e.target.value })} />
        </div>
        <div>
          <Label>Billing Email</Label>
          <Input data-testid="input-billing-email" type="email" value={form.billingEmail} onChange={e => setForm({ ...form, billingEmail: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Billing Address</Label>
          <Input data-testid="input-customer-address" value={form.billingAddress} onChange={e => setForm({ ...form, billingAddress: e.target.value })} />
        </div>
        <div>
          <Label>City</Label>
          <Input data-testid="input-customer-city" value={form.billingCity} onChange={e => setForm({ ...form, billingCity: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>State</Label>
          <Input data-testid="input-customer-state" value={form.billingState} onChange={e => setForm({ ...form, billingState: e.target.value })} />
        </div>
        <div>
          <Label>ZIP</Label>
          <Input data-testid="input-customer-zip" value={form.billingZip} onChange={e => setForm({ ...form, billingZip: e.target.value })} />
        </div>
        <div>
          <Label>Country</Label>
          <Input data-testid="input-customer-country" value={form.billingCountry} onChange={e => setForm({ ...form, billingCountry: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>Tax ID / EIN</Label>
          <Input data-testid="input-customer-taxid" value={form.taxId} onChange={e => setForm({ ...form, taxId: e.target.value })} />
        </div>
        <div>
          <Label>Payment Terms</Label>
          <Select value={form.defaultPaymentTerms} onValueChange={v => setForm({ ...form, defaultPaymentTerms: v })}>
            <SelectTrigger data-testid="select-customer-terms">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="due_on_receipt" data-testid="option-due-on-receipt">Due on Receipt</SelectItem>
              <SelectItem value="net_15" data-testid="option-net-15">Net 15</SelectItem>
              <SelectItem value="net_30" data-testid="option-net-30">Net 30</SelectItem>
              <SelectItem value="net_45" data-testid="option-net-45">Net 45</SelectItem>
              <SelectItem value="net_60" data-testid="option-net-60">Net 60</SelectItem>
              <SelectItem value="net_90" data-testid="option-net-90">Net 90</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
            <SelectTrigger data-testid="select-customer-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active" data-testid="option-active">Active</SelectItem>
              <SelectItem value="inactive" data-testid="option-inactive">Inactive</SelectItem>
              <SelectItem value="prospect" data-testid="option-prospect">Prospect</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Notes</Label>
        <Textarea data-testid="input-customer-notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} data-testid="button-cancel-customer">Cancel</Button>
        <Button onClick={() => onSave(form)} disabled={!form.customerName} data-testid="button-save-customer">
          {customer ? "Update" : "Create"} Customer
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function CustomersPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | undefined>();

  const companyId = user?.companyId;

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: [`/api/customers?companyId=${companyId}`],
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/customers", { ...data, companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers?companyId=${companyId}`] });
      toast({ title: "Customer created" });
      setDialogOpen(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/customers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers?companyId=${companyId}`] });
      toast({ title: "Customer updated" });
      setDialogOpen(false);
      setEditing(undefined);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/customers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers?companyId=${companyId}`] });
      toast({ title: "Customer deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = customers.filter(c => {
    const matchesSearch = !search || c.customerName.toLowerCase().includes(search.toLowerCase()) ||
      (c.businessName && c.businessName.toLowerCase().includes(search.toLowerCase())) ||
      (c.email && c.email.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusColors: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    inactive: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400",
    prospect: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  };

  const stats = {
    total: customers.length,
    active: customers.filter(c => c.status === "active").length,
    prospects: customers.filter(c => c.status === "prospect").length,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Customers</h1>
          <p className="text-muted-foreground">Manage your customer directory</p>
        </div>
        <Button onClick={() => { setEditing(undefined); setDialogOpen(true); }} data-testid="button-add-customer">
          <Plus className="h-4 w-4 mr-2" /> Add Customer
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
              <Users className="h-5 w-5 text-teal-600" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-total-customers">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total Customers</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-active-customers">{stats.active}</div>
              <div className="text-xs text-muted-foreground">Active</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Mail className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-prospect-customers">{stats.prospects}</div>
              <div className="text-xs text-muted-foreground">Prospects</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-10" data-testid="input-search-customers" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" data-testid="select-status-filter">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="option-all">All Statuses</SelectItem>
            <SelectItem value="active" data-testid="option-filter-active">Active</SelectItem>
            <SelectItem value="inactive" data-testid="option-filter-inactive">Inactive</SelectItem>
            <SelectItem value="prospect" data-testid="option-filter-prospect">Prospect</SelectItem>
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
            <Users className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">No customers found</p>
            <Button variant="outline" className="mt-4" onClick={() => { setEditing(undefined); setDialogOpen(true); }}
              data-testid="button-add-first-customer">
              <Plus className="h-4 w-4 mr-2" /> Add your first customer
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map(customer => (
            <Card key={customer.id} className="hover:shadow-md transition-shadow" data-testid={`card-customer-${customer.id}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-teal-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
                      {customer.customerName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold truncate" data-testid={`text-customer-name-${customer.id}`}>{customer.customerName}</span>
                        <Badge className={statusColors[customer.status || "active"]} data-testid={`badge-status-${customer.id}`}>
                          {customer.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                        {customer.businessName && (
                          <span className="flex items-center gap-1"><Building2 className="h-3 w-3" /> {customer.businessName}</span>
                        )}
                        {customer.email && (
                          <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {customer.email}</span>
                        )}
                        {customer.phone && (
                          <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {customer.phone}</span>
                        )}
                        {customer.billingCity && (
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {customer.billingCity}, {customer.billingState}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(customer); setDialogOpen(true); }}
                      data-testid={`button-edit-${customer.id}`}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => {
                      if (confirm("Delete this customer?")) deleteMutation.mutate(customer.id);
                    }} data-testid={`button-delete-${customer.id}`}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Customer" : "New Customer"}</DialogTitle>
          </DialogHeader>
          <CustomerForm
            customer={editing}
            onSave={data => {
              if (editing) {
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
