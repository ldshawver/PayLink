import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Building2, Plus, ChevronRight, Users, Calendar, Edit2,
  CheckCircle2, Clock, FlaskConical, Pause, XCircle, RefreshCw,
  Link2, ArrowLeft,
} from "lucide-react";

type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
  primaryAdminUserId?: string;
  billingContactName?: string;
  billingContactEmail?: string;
  stripeCustomerId?: string;
  defaultTimezone?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  companyCount: number;
};

type TenantDetail = Tenant & {
  companies: Array<{
    id: string;
    name: string;
    status: string;
    isPrimary: boolean;
    assignedAt: string;
  }>;
};

type Company = {
  id: string;
  name: string;
  status?: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  active:    { label: "Active",    color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",    icon: CheckCircle2 },
  trial:     { label: "Trial",     color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",        icon: Clock },
  demo:      { label: "Demo",      color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400", icon: FlaskConical },
  suspended: { label: "Suspended", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",    icon: Pause },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",            icon: XCircle },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-slate-100 text-slate-700", icon: Building2 };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function CreateTenantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", slug: "", status: "trial", billingContactName: "", billingContactEmail: "", defaultTimezone: "America/Los_Angeles", notes: "" });

  const mutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest("POST", "/api/tenants", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      toast({ title: "Tenant created", description: `${form.name} has been provisioned.` });
      onClose();
      setForm({ name: "", slug: "", status: "trial", billingContactName: "", billingContactEmail: "", defaultTimezone: "America/Los_Angeles", notes: "" });
    },
    onError: (e: any) => toast({ title: "Failed to create tenant", description: e.message, variant: "destructive" }),
  });

  const autoSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Tenant</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="tenant-name">Tenant Name *</Label>
            <Input
              id="tenant-name"
              data-testid="input-tenant-name"
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value, slug: autoSlug(e.target.value) }))}
              placeholder="Acme Corporation"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tenant-slug">Slug *</Label>
            <Input
              id="tenant-slug"
              data-testid="input-tenant-slug"
              value={form.slug}
              onChange={(e) => setForm(f => ({ ...f, slug: e.target.value }))}
              placeholder="acme-corporation"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label>Initial Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm(f => ({ ...f, status: v }))}>
              <SelectTrigger data-testid="select-tenant-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="trial">Trial</SelectItem>
                <SelectItem value="demo">Demo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="tenant-contact-name">Billing Contact Name</Label>
              <Input id="tenant-contact-name" data-testid="input-tenant-billing-name" value={form.billingContactName} onChange={(e) => setForm(f => ({ ...f, billingContactName: e.target.value }))} placeholder="Jane Smith" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tenant-contact-email">Billing Email</Label>
              <Input id="tenant-contact-email" data-testid="input-tenant-billing-email" type="email" value={form.billingContactEmail} onChange={(e) => setForm(f => ({ ...f, billingContactEmail: e.target.value }))} placeholder="billing@acme.com" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tenant-notes">Notes</Label>
            <Textarea id="tenant-notes" data-testid="input-tenant-notes" value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Internal notes..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="button-create-tenant-submit"
            onClick={() => mutation.mutate(form)}
            disabled={!form.name || !form.slug || mutation.isPending}
          >
            {mutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Create Tenant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignCompanyDialog({ tenantId, open, onClose }: { tenantId: string; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const { data: allCompanies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: tenant } = useQuery<TenantDetail>({ queryKey: ["/api/tenants", tenantId] });
  const assignedIds = new Set((tenant?.companies ?? []).map(c => c.id));
  const available = allCompanies.filter(c => !assignedIds.has(c.id));
  const [companyId, setCompanyId] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/tenants/${tenantId}/companies`, { companyId, isPrimary }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenantId] });
      toast({ title: "Company assigned" });
      onClose();
      setCompanyId("");
      setIsPrimary(false);
    },
    onError: (e: any) => toast({ title: "Failed to assign company", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign Company</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger data-testid="select-assign-company">
                <SelectValue placeholder="Select a company..." />
              </SelectTrigger>
              <SelectContent>
                {available.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              className="rounded"
              checked={isPrimary}
              onChange={e => setIsPrimary(e.target.checked)}
              data-testid="checkbox-is-primary-company"
            />
            Mark as primary (billing) company
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="button-assign-company-submit"
            onClick={() => mutation.mutate()}
            disabled={!companyId || mutation.isPending}
          >
            {mutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTenantDialog({ tenant, open, onClose }: { tenant: TenantDetail; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: tenant.name,
    status: tenant.status,
    billingContactName: tenant.billingContactName ?? "",
    billingContactEmail: tenant.billingContactEmail ?? "",
    defaultTimezone: tenant.defaultTimezone ?? "America/Los_Angeles",
    stripeCustomerId: tenant.stripeCustomerId ?? "",
    notes: tenant.notes ?? "",
  });

  const mutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest("PATCH", `/api/tenants/${tenant.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenant.id] });
      toast({ title: "Tenant updated" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed to update tenant", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Tenant — {tenant.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input data-testid="input-edit-tenant-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
              <SelectTrigger data-testid="select-edit-tenant-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_CONFIG).map(([val, cfg]) => (
                  <SelectItem key={val} value={val}>{cfg.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Billing Contact Name</Label>
              <Input data-testid="input-edit-billing-name" value={form.billingContactName} onChange={e => setForm(f => ({ ...f, billingContactName: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Billing Email</Label>
              <Input data-testid="input-edit-billing-email" type="email" value={form.billingContactEmail} onChange={e => setForm(f => ({ ...f, billingContactEmail: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Stripe Customer ID</Label>
            <Input data-testid="input-edit-stripe-id" value={form.stripeCustomerId} onChange={e => setForm(f => ({ ...f, stripeCustomerId: e.target.value }))} className="font-mono text-sm" placeholder="cus_..." />
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea data-testid="input-edit-tenant-notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="button-edit-tenant-submit"
            onClick={() => mutation.mutate(form)}
            disabled={!form.name || mutation.isPending}
          >
            {mutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TenantDetailPanel({
  tenantId,
  onBack,
}: {
  tenantId: string;
  onBack: () => void;
}) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "platform_super_admin";
  const { toast } = useToast();
  const [showAssign, setShowAssign] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const { data: tenant, isLoading } = useQuery<TenantDetail>({
    queryKey: ["/api/tenants", tenantId],
    queryFn: () => apiRequest("GET", `/api/tenants/${tenantId}`),
  });

  const removeCompany = useMutation({
    mutationFn: (companyId: string) => apiRequest("DELETE", `/api/tenants/${tenantId}/companies/${companyId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenantId] });
      toast({ title: "Company removed from tenant" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="p-6 flex items-center gap-3 text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Loading tenant details…
      </div>
    );
  }
  if (!tenant) return <div className="p-6 text-muted-foreground">Tenant not found.</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md hover:bg-muted transition-colors"
          data-testid="button-tenant-detail-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-base truncate" data-testid="text-tenant-detail-name">{tenant.name}</h2>
          <p className="text-xs text-muted-foreground font-mono">{tenant.slug}</p>
        </div>
        <StatusBadge status={tenant.status} />
        {isSuperAdmin && (
          <Button size="sm" variant="outline" onClick={() => setShowEdit(true)} data-testid="button-edit-tenant">
            <Edit2 className="h-3.5 w-3.5 mr-1" />
            Edit
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-5">
        {/* Details */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm">Details</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span className="text-muted-foreground">Status</span>
              <StatusBadge status={tenant.status} />
              <span className="text-muted-foreground">Billing Contact</span>
              <span data-testid="text-tenant-billing-name">{tenant.billingContactName || <span className="text-muted-foreground/50 italic">—</span>}</span>
              <span className="text-muted-foreground">Billing Email</span>
              <span data-testid="text-tenant-billing-email" className="truncate">{tenant.billingContactEmail || <span className="text-muted-foreground/50 italic">—</span>}</span>
              <span className="text-muted-foreground">Stripe Customer</span>
              <span data-testid="text-tenant-stripe-id" className="font-mono text-xs">{tenant.stripeCustomerId || <span className="text-muted-foreground/50 italic">—</span>}</span>
              <span className="text-muted-foreground">Timezone</span>
              <span>{tenant.defaultTimezone}</span>
              <span className="text-muted-foreground">Created</span>
              <span>{new Date(tenant.createdAt).toLocaleDateString()}</span>
            </div>
            {tenant.notes && (
              <p className="text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1.5 mt-1">{tenant.notes}</p>
            )}
          </CardContent>
        </Card>

        {/* Companies */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Building2 className="h-4 w-4 text-amber-500" />
              Companies ({tenant.companies.length})
            </h3>
            {isSuperAdmin && (
              <Button size="sm" variant="outline" onClick={() => setShowAssign(true)} data-testid="button-assign-company">
                <Link2 className="h-3.5 w-3.5 mr-1" />
                Assign Company
              </Button>
            )}
          </div>

          {tenant.companies.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm border rounded-lg border-dashed">
              No companies assigned to this tenant yet.
            </div>
          ) : (
            <div className="space-y-2">
              {tenant.companies.map(c => (
                <div
                  key={c.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                  data-testid={`card-tenant-company-${c.id}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate">{c.name}</span>
                    {c.isPrimary && (
                      <Badge variant="secondary" className="text-xs shrink-0">Primary</Badge>
                    )}
                  </div>
                  {isSuperAdmin && (
                    <button
                      onClick={() => removeCompany.mutate(c.id)}
                      disabled={removeCompany.isPending}
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors shrink-0 ml-2"
                      data-testid={`button-remove-company-${c.id}`}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showEdit && <EditTenantDialog tenant={tenant} open={showEdit} onClose={() => setShowEdit(false)} />}
      {showAssign && <AssignCompanyDialog tenantId={tenantId} open={showAssign} onClose={() => setShowAssign(false)} />}
    </div>
  );
}

export default function PlatformTenantsPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "platform_super_admin";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: tenants = [], isLoading, refetch } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
  });

  const filtered = tenants.filter(t => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.slug.includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const counts: Record<string, number> = {};
  for (const t of tenants) counts[t.status] = (counts[t.status] ?? 0) + 1;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-amber-900 text-white px-6 py-5 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="h-5 w-5 text-amber-400" />
              <span className="text-xs text-amber-300 font-semibold uppercase tracking-widest">Platform Console</span>
            </div>
            <h1 className="text-xl font-bold">Tenant Management</h1>
            <p className="text-sm text-slate-300 mt-0.5">Manage all SaaS tenants, company assignments, and billing relationships</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-2xl font-bold">{tenants.length}</p>
              <p className="text-xs text-amber-300">Total Tenants</p>
            </div>
            {isSuperAdmin && (
              <Button
                onClick={() => setShowCreate(true)}
                size="sm"
                className="bg-amber-500 hover:bg-amber-600 text-white border-0"
                data-testid="button-new-tenant"
              >
                <Plus className="h-4 w-4 mr-1" />
                New Tenant
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Status summary chips */}
      <div className="border-b bg-muted/20 px-4 py-2 flex items-center gap-2 flex-wrap shrink-0">
        <button
          onClick={() => setStatusFilter("all")}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${statusFilter === "all" ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
          data-testid="filter-tenant-status-all"
        >
          All ({tenants.length})
        </button>
        {Object.entries(STATUS_CONFIG).map(([val, cfg]) => counts[val] != null && (
          <button
            key={val}
            onClick={() => setStatusFilter(val)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${statusFilter === val ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
            data-testid={`filter-tenant-status-${val}`}
          >
            {cfg.label} ({counts[val]})
          </button>
        ))}
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tenants…"
          className="ml-auto w-48 h-7 text-sm"
          data-testid="input-tenant-search"
        />
        <button onClick={() => refetch()} className="p-1.5 rounded hover:bg-muted transition-colors" data-testid="button-refresh-tenants">
          <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Tenant list */}
        <div className={`flex flex-col border-r ${selectedId ? "hidden md:flex md:w-72 lg:w-80 shrink-0" : "flex-1"}`}>
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="p-6 flex items-center gap-3 text-muted-foreground text-sm">
                <RefreshCw className="h-4 w-4 animate-spin" /> Loading tenants…
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                {search || statusFilter !== "all" ? "No tenants match your filters." : "No tenants provisioned yet."}
              </div>
            ) : (
              <div className="divide-y">
                {filtered.map(tenant => (
                  <button
                    key={tenant.id}
                    onClick={() => setSelectedId(tenant.id)}
                    className={`w-full text-left p-4 hover:bg-muted/40 transition-colors ${selectedId === tenant.id ? "bg-muted/60 border-l-2 border-amber-500" : ""}`}
                    data-testid={`card-tenant-${tenant.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate" data-testid={`text-tenant-name-${tenant.id}`}>{tenant.name}</p>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">{tenant.slug}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <StatusBadge status={tenant.status} />
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {tenant.companyCount ?? 0} {tenant.companyCount === 1 ? "company" : "companies"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(tenant.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Detail panel */}
        {selectedId ? (
          <div className="flex-1 min-w-0">
            <TenantDetailPanel
              tenantId={selectedId}
              onBack={() => setSelectedId(null)}
            />
          </div>
        ) : (
          <div className="hidden md:flex flex-1 items-center justify-center text-muted-foreground text-sm flex-col gap-2">
            <Building2 className="h-8 w-8 opacity-20" />
            <span>Select a tenant to view details</span>
          </div>
        )}
      </div>

      <CreateTenantDialog open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
