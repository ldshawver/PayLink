import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useSearch, useLocation } from "wouter";
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
import { Progress } from "@/components/ui/progress";
import { Plus, Search, Edit, Trash2, Building2, Mail, Phone, MapPin, Users, Loader2, Store, Truck, Activity, ClipboardList, Calendar, User, CheckCircle2 } from "lucide-react";
import type { Customer } from "@shared/schema";
import type { OnboardingProject, EngagementEvent } from "@/lib/onboarding-types";
import { PROJECT_STATUSES, EVENT_TYPES } from "@/lib/onboarding-types";

function CustomerForm({ customer, onSave, onCancel }: {
  customer?: Customer;
  onSave: (data: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    customerType: customer?.customerType || "customer",
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

  const isVendor = form.customerType === "vendor";

  return (
    <div className="space-y-4">
      <div>
        <Label>Type *</Label>
        <Select value={form.customerType} onValueChange={v => setForm({ ...form, customerType: v })}>
          <SelectTrigger data-testid="select-customer-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="customer" data-testid="option-type-customer">Customer</SelectItem>
            <SelectItem value="vendor" data-testid="option-type-vendor">Vendor</SelectItem>
            <SelectItem value="contractor" data-testid="option-type-contractor">Contractor</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>Contact Name *</Label>
          <Input data-testid="input-customer-name" value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} />
        </div>
        <div>
          <Label>Business Name</Label>
          <Input data-testid="input-customer-company" value={form.businessName} onChange={e => setForm({ ...form, businessName: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>Email</Label>
          <Input data-testid="input-customer-email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <Label>Phone</Label>
          <Input data-testid="input-customer-phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>Billing Contact</Label>
          <Input data-testid="input-billing-contact" value={form.billingContactName} onChange={e => setForm({ ...form, billingContactName: e.target.value })} />
        </div>
        <div>
          <Label>Billing Email</Label>
          <Input data-testid="input-billing-email" type="email" value={form.billingEmail} onChange={e => setForm({ ...form, billingEmail: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>{isVendor ? "Remit-To Address" : "Billing Address"}</Label>
          <Input data-testid="input-customer-address" value={form.billingAddress} onChange={e => setForm({ ...form, billingAddress: e.target.value })} />
        </div>
        <div>
          <Label>City</Label>
          <Input data-testid="input-customer-city" value={form.billingCity} onChange={e => setForm({ ...form, billingCity: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
          {customer ? "Update" : "Create"} {form.customerType === "vendor" ? "Vendor" : "Customer"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function CustomerOnboardingTab({ customerId, companyId }: { customerId: string; companyId: string }) {
  const { data: projects = [], isLoading: loadingProjects } = useQuery<OnboardingProject[]>({
    queryKey: [`/api/onboarding-projects?customerId=${customerId}`],
    enabled: !!customerId,
  });

  const { data: events = [], isLoading: loadingEvents } = useQuery<EngagementEvent[]>({
    queryKey: [`/api/engagement-events?customerId=${customerId}`],
    enabled: !!customerId,
  });

  if (loadingProjects || loadingEvents) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <ClipboardList className="h-5 w-5" /> Onboarding Projects
        </h3>
        {projects.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground">
              No onboarding projects for this customer
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {projects.map(project => {
              const statusInfo = PROJECT_STATUSES.find(s => s.value === project.status);
              return (
                <Card key={project.id} data-testid={`card-customer-project-${project.id}`}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div>
                        <p className="font-medium text-sm">{project.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge className={statusInfo?.color} variant="secondary">{statusInfo?.label}</Badge>
                          <Badge variant="outline" className="text-xs">{project.product}</Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="w-20">
                        <Progress value={project.progress} className="h-2" />
                        <span className="text-xs text-muted-foreground">{project.progress}%</span>
                      </div>
                      {project.assignedTo && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <User className="h-3 w-3" /> {project.assignedTo}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Activity className="h-5 w-5" /> Engagement Timeline
        </h3>
        {events.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground">
              No engagement events for this customer
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {events.slice(0, 20).map(event => {
              const eventTypeLabel = EVENT_TYPES.find(t => t.value === event.eventType)?.label || event.eventType;
              return (
                <Card key={event.id} data-testid={`card-customer-event-${event.id}`}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{event.title}</p>
                      {event.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
                      )}
                      <Badge variant="outline" className="text-xs mt-1">{eventTypeLabel}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(event.createdAt).toLocaleDateString()}
                    </span>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CustomerDetailView({ customer, companyId, onBack, onEdit }: {
  customer: Customer;
  companyId: string;
  onBack: () => void;
  onEdit: (c: Customer) => void;
}) {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Button variant="ghost" onClick={onBack} data-testid="button-back-customers">
          <MapPin className="h-4 w-4 mr-2" /> Back to Directory
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate" data-testid="text-customer-detail-name">{customer.customerName}</h1>
          <p className="text-muted-foreground truncate">{customer.businessName || "No business name"}</p>
        </div>
        <Button variant="outline" onClick={() => onEdit(customer)} data-testid="button-edit-customer-detail" className="w-full sm:w-auto">
          <Edit className="h-4 w-4 mr-2" /> Edit
        </Button>
      </div>

      <Tabs defaultValue="info">
        <TabsList data-testid="tabs-customer-detail">
          <TabsTrigger value="info" data-testid="tab-customer-info">Info</TabsTrigger>
          <TabsTrigger value="onboarding" data-testid="tab-customer-onboarding">Onboarding</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold">Contact Information</h3>
                {customer.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>{customer.email}</span>
                  </div>
                )}
                {customer.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{customer.phone}</span>
                  </div>
                )}
                {customer.billingContactName && (
                  <div className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span>Billing: {customer.billingContactName}</span>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold">Billing Address</h3>
                <p className="text-sm text-muted-foreground">
                  {customer.billingAddress || "No address"}<br />
                  {customer.billingCity && `${customer.billingCity}, `}{customer.billingState} {customer.billingZip}<br />
                  {customer.billingCountry}
                </p>
              </CardContent>
            </Card>
          </div>
          {customer.notes && (
            <Card className="mt-4">
              <CardContent className="p-4">
                <h3 className="font-semibold mb-2">Notes</h3>
                <p className="text-sm text-muted-foreground">{customer.notes}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="onboarding" className="mt-4">
          <CustomerOnboardingTab customerId={customer.id} companyId={companyId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function CustomersPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const searchParams = useSearch();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  // Sync typeFilter with ?tab= URL param (customers / vendors / contractors)
  const tabParam = new URLSearchParams(searchParams).get("tab") || "all";
  const [typeFilter, setTypeFilter] = useState(tabParam !== "all" ? tabParam.replace(/s$/, "") : "all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | undefined>();
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const deepLinkHandled = useRef(false);

  // A tenant user's company comes from the session. A platform admin has no
  // company and must explicitly pick an acting company (validated server-side)
  // before viewing or adding directory records.
  const sessionCompanyId = user?.companyId;
  const isPlatformActor = !sessionCompanyId;
  const [actingCompanyId, setActingCompanyId] = useState("");
  const { data: actingCompanyOptions = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/companies"],
    enabled: isPlatformActor,
  });
  const companyId = sessionCompanyId || actingCompanyId || undefined;

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: [`/api/customers?companyId=${companyId}`],
    enabled: !!companyId,
  });

  useEffect(() => {
    if (deepLinkHandled.current || customers.length === 0 || !searchParams) return;
    const params = new URLSearchParams(searchParams);
    const deepLinkId = params.get("id");
    if (deepLinkId) {
      const target = customers.find(c => c.id === deepLinkId);
      if (target) {
        setSelectedCustomer(target);
        deepLinkHandled.current = true;
        navigate("/app/customers", { replace: true });
      }
    }
  }, [customers, searchParams, navigate]);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, string>) => apiRequest("POST", "/api/customers", { ...data, companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers?companyId=${companyId}`] });
      toast({ title: "Record created" });
      setDialogOpen(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, string> }) => apiRequest("PATCH", `/api/customers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers?companyId=${companyId}`] });
      toast({ title: "Record updated" });
      setDialogOpen(false);
      setEditing(undefined);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/customers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers?companyId=${companyId}`] });
      toast({ title: "Record deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = customers.filter(c => {
    const matchesSearch = !search || c.customerName.toLowerCase().includes(search.toLowerCase()) ||
      (c.businessName && c.businessName.toLowerCase().includes(search.toLowerCase())) ||
      (c.email && c.email.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    const matchesType = typeFilter === "all" || (c.customerType || "customer") === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  const statusColors: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    inactive: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400",
    prospect: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  };

  const typeColors: Record<string, string> = {
    customer: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
    vendor: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    contractor: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  };

  const stats = {
    total: customers.length,
    customerCount: customers.filter(c => (c.customerType || "customer") === "customer").length,
    vendorCount: customers.filter(c => c.customerType === "vendor").length,
    contractorCount: customers.filter(c => c.customerType === "contractor").length,
    active: customers.filter(c => c.status === "active").length,
  };

  if (selectedCustomer && companyId) {
    return (
      <>
        <CustomerDetailView
          customer={selectedCustomer}
          companyId={companyId}
          onBack={() => setSelectedCustomer(null)}
          onEdit={(c) => { setEditing(c); setDialogOpen(true); }}
        />
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Record</DialogTitle>
            </DialogHeader>
            <CustomerForm
              customer={editing}
              onSave={data => {
                if (editing) {
                  updateMutation.mutate({ id: editing.id, data });
                  setSelectedCustomer({ ...selectedCustomer, ...data });
                }
              }}
              onCancel={() => { setDialogOpen(false); setEditing(undefined); }}
            />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Directory</h1>
          <p className="text-muted-foreground">Customers, vendors, and contractors</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          {isPlatformActor && (
            <Select value={actingCompanyId} onValueChange={setActingCompanyId}>
              <SelectTrigger className="w-full sm:w-64" data-testid="select-acting-company">
                <SelectValue placeholder="Select a company…" />
              </SelectTrigger>
              <SelectContent>
                {actingCompanyOptions.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            onClick={() => { setEditing(undefined); setDialogOpen(true); }}
            data-testid="button-add-customer"
            className="w-full sm:w-auto"
            disabled={!companyId}
            title={!companyId ? "Select a company first" : undefined}
          >
            <Plus className="h-4 w-4 mr-2" /> Add to Directory
          </Button>
        </div>
      </div>

      {isPlatformActor && !companyId && (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid="text-select-company-hint">
          Select a company above to view or add its customers, vendors, and contractors.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
              <Users className="h-5 w-5 text-teal-600" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-total-customers">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Store className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-customer-count">{stats.customerCount}</div>
              <div className="text-xs text-muted-foreground">Customers</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
              <Truck className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-vendor-count">{stats.vendorCount}</div>
              <div className="text-xs text-muted-foreground">Vendors</div>
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
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search customers & vendors..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-10" data-testid="input-search-customers" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-40" data-testid="select-type-filter">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="option-all-types">All Types</SelectItem>
            <SelectItem value="customer" data-testid="option-filter-customer">Customers</SelectItem>
            <SelectItem value="vendor" data-testid="option-filter-vendor">Vendors</SelectItem>
            <SelectItem value="contractor" data-testid="option-filter-contractor">Contractors</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40" data-testid="select-status-filter">
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
            <p className="text-muted-foreground">No records found</p>
            <Button variant="outline" className="mt-4" onClick={() => { setEditing(undefined); setDialogOpen(true); }}
              data-testid="button-add-first-customer">
              <Plus className="h-4 w-4 mr-2" /> Add your first customer or vendor
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map(customer => (
            <Card key={customer.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedCustomer(customer)} data-testid={`card-customer-${customer.id}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 ${
                      (customer.customerType || "customer") === "vendor"
                        ? "bg-gradient-to-br from-orange-500 to-amber-500"
                        : (customer.customerType || "customer") === "contractor"
                        ? "bg-gradient-to-br from-purple-500 to-indigo-500"
                        : "bg-gradient-to-br from-teal-500 to-blue-500"
                    }`}>
                      {customer.customerName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold truncate" data-testid={`text-customer-name-${customer.id}`}>{customer.customerName}</span>
                        <Badge className={typeColors[customer.customerType || "customer"]} data-testid={`badge-type-${customer.id}`}>
                          {(customer.customerType || "customer") === "vendor" ? "Vendor" : (customer.customerType || "customer") === "contractor" ? "Contractor" : "Customer"}
                        </Badge>
                        <Badge className={statusColors[customer.status || "active"]} data-testid={`badge-status-${customer.id}`}>
                          {customer.status}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mt-1">
                        {customer.businessName && (
                          <span className="flex items-center gap-1"><Building2 className="h-3 w-3" /> {customer.businessName}</span>
                        )}
                        {customer.email && (
                          <span className="flex items-center gap-1 hidden sm:flex"><Mail className="h-3 w-3" /> {customer.email}</span>
                        )}
                        {customer.phone && (
                          <span className="flex items-center gap-1 hidden sm:flex"><Phone className="h-3 w-3" /> {customer.phone}</span>
                        )}
                        {customer.billingCity && (
                          <span className="flex items-center gap-1 hidden sm:flex"><MapPin className="h-3 w-3" /> {customer.billingCity}, {customer.billingState}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditing(customer); setDialogOpen(true); }}
                      data-testid={`button-edit-${customer.id}`}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Delete this record?")) deleteMutation.mutate(customer.id);
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
            <DialogTitle>{editing ? "Edit Record" : "New Customer / Vendor"}</DialogTitle>
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
