import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Company, Department, Branch, LegalEntity, Enterprise, Division, Position, CostCenter, Job } from "@shared/schema";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Building2, Plus, MoreVertical, Pencil, Trash2, Phone, MapPin,
  DollarSign, Network, Shield, Monitor, Import, Rocket, CheckCircle2,
  Globe, Briefcase, Target, CircleDot, FolderKanban, ChevronRight, Scale
} from "lucide-react";

function useTabParam(defaultTab: string): [string, (tab: string) => void] {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get("tab") || defaultTab;
  const setTab = (newTab: string) => {
    setLocation(`/company?tab=${newTab}`);
  };
  return [tab, setTab];
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  c_corp: "C Corporation",
  s_corp: "S Corporation",
  llc: "LLC",
  sole_prop: "Sole Proprietorship",
  nonprofit_501c3: "501(c)(3) Nonprofit",
  partnership: "Partnership",
};

const PAY_FREQ_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Bi-Weekly",
  semimonthly: "Semi-Monthly",
  monthly: "Monthly",
};

const LEGAL_ENTITY_TYPES: Record<string, string> = {
  sole_proprietorship: "Sole Proprietorship",
  partnership: "Partnership",
  corporation: "Corporation",
  s_corporation: "S Corporation",
  llc: "LLC",
  nonprofit: "Nonprofit",
};

function CompanyFormFields({
  form,
  setForm,
  enterprises,
  legalEntities,
}: {
  form: Record<string, string>;
  setForm: (f: Record<string, string>) => void;
  enterprises?: Enterprise[];
  legalEntities?: LegalEntity[];
}) {
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Enterprise</Label>
        <Select value={form.enterpriseId} onValueChange={(v) => setForm({ ...form, enterpriseId: v === "__none__" ? "" : v })}>
          <SelectTrigger data-testid="select-company-enterprise">
            <SelectValue placeholder="Select enterprise (optional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {enterprises?.map((ent) => (
              <SelectItem key={ent.id} value={ent.id}>{ent.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>Legal Entity</Label>
        <Select value={form.legalEntityId} onValueChange={(v) => setForm({ ...form, legalEntityId: v === "__none__" ? "" : v })}>
          <SelectTrigger data-testid="select-company-legal-entity">
            <SelectValue placeholder="Select legal entity (optional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {legalEntities?.map((le) => (
              <SelectItem key={le.id} value={le.id}>{le.legalName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="company-name">Company Name *</Label>
        <Input id="company-name" data-testid="input-company-name" value={form.name} onChange={set("name")} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="company-legalName">Legal Name</Label>
        <Input id="company-legalName" data-testid="input-company-legalName" value={form.legalName} onChange={set("legalName")} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="company-ein">EIN</Label>
          <Input id="company-ein" data-testid="input-company-ein" value={form.ein} onChange={set("ein")} />
        </div>
        <div className="grid gap-2">
          <Label>Entity Type</Label>
          <Select value={form.entityType} onValueChange={(v) => setForm({ ...form, entityType: v })}>
            <SelectTrigger data-testid="select-entity-type">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ENTITY_TYPE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="company-address">Address</Label>
        <Input id="company-address" data-testid="input-company-address" value={form.address} onChange={set("address")} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="company-city">City</Label>
          <Input id="company-city" data-testid="input-company-city" value={form.city} onChange={set("city")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="company-state">State</Label>
          <Input id="company-state" data-testid="input-company-state" value={form.state} onChange={set("state")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="company-zip">Zip</Label>
          <Input id="company-zip" data-testid="input-company-zip" value={form.zip} onChange={set("zip")} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="company-phone">Phone</Label>
          <Input id="company-phone" data-testid="input-company-phone" value={form.phone} onChange={set("phone")} />
        </div>
        <div className="grid gap-2">
          <Label>Pay Frequency</Label>
          <Select value={form.payFrequency} onValueChange={(v) => setForm({ ...form, payFrequency: v })}>
            <SelectTrigger data-testid="select-pay-frequency">
              <SelectValue placeholder="Select frequency" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PAY_FREQ_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

const emptyCompanyForm = (): Record<string, string> => ({
  enterpriseId: "", legalEntityId: "", name: "", legalName: "", ein: "", entityType: "llc",
  address: "", city: "", state: "", zip: "", phone: "", payFrequency: "biweekly",
});

function CompanyInfoTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState(emptyCompanyForm());
  const [editId, setEditId] = useState<string | null>(null);

  const { data: companies, isLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });
  const { data: enterprises } = useQuery<Enterprise[]>({
    queryKey: ["/api/enterprises"],
  });
  const { data: legalEntities } = useQuery<LegalEntity[]>({
    queryKey: ["/api/legal-entities"],
  });

  const addMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      await apiRequest("POST", "/api/companies", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setAddOpen(false);
      setForm(emptyCompanyForm());
      toast({ title: "Company added successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, string> }) => {
      await apiRequest("PATCH", `/api/companies/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setEditOpen(false);
      setEditId(null);
      setForm(emptyCompanyForm());
      toast({ title: "Company updated successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleEdit = (company: Company) => {
    setEditId(company.id);
    setForm({
      enterpriseId: company.enterpriseId || "",
      legalEntityId: company.legalEntityId || "",
      name: company.name || "",
      legalName: company.legalName || "",
      ein: company.ein || "",
      entityType: company.entityType || "llc",
      address: company.address || "",
      city: company.city || "",
      state: company.state || "",
      zip: company.zip || "",
      phone: company.phone || "",
      payFrequency: company.payFrequency || "biweekly",
    });
    setEditOpen(true);
  };

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="loading-companies">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
            <CardContent><Skeleton className="h-20 w-full" /></CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Companies</h2>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-company"><Plus className="mr-2 h-4 w-4" />Add Company</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Company</DialogTitle></DialogHeader>
            <CompanyFormFields form={form} setForm={setForm} enterprises={enterprises} legalEntities={legalEntities} />
            <Button
              data-testid="button-submit-company"
              className="w-full mt-2"
              disabled={!form.name || addMutation.isPending}
              onClick={() => addMutation.mutate(form)}
            >
              {addMutation.isPending ? "Adding..." : "Add Company"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Company</DialogTitle></DialogHeader>
          <CompanyFormFields form={form} setForm={setForm} enterprises={enterprises} legalEntities={legalEntities} />
          <Button
            data-testid="button-save-company"
            className="w-full mt-2"
            disabled={!form.name || editMutation.isPending}
            onClick={() => editId && editMutation.mutate({ id: editId, data: form })}
          >
            {editMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {companies?.map((company) => (
          <Card key={company.id} data-testid={`card-company-${company.id}`}>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div className="space-y-1">
                <CardTitle className="text-base">{company.name}</CardTitle>
                {company.legalName && (
                  <CardDescription>{company.legalName}</CardDescription>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" data-testid={`button-menu-company-${company.id}`}>
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleEdit(company)} data-testid={`button-edit-company-${company.id}`}>
                    <Pencil className="mr-2 h-4 w-4" />Edit
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {(() => {
                const le = legalEntities?.find((l) => l.id === company.legalEntityId);
                return le ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">Legal Entity: {le.legalName}</Badge>
                  </div>
                ) : null;
              })()}
              {company.ein && <div className="flex items-center gap-2">EIN: {company.ein}</div>}
              {company.entityType && (
                <div><Badge variant="secondary" className="text-xs">{ENTITY_TYPE_LABELS[company.entityType] || company.entityType}</Badge></div>
              )}
              {(company.address || company.city || company.state) && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  {[company.address, company.city, company.state, company.zip].filter(Boolean).join(", ")}
                </div>
              )}
              {company.phone && (
                <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 shrink-0" />{company.phone}</div>
              )}
              {company.payFrequency && (
                <div className="flex items-center gap-2">
                  <DollarSign className="h-3.5 w-3.5 shrink-0" />
                  {PAY_FREQ_LABELS[company.payFrequency] || company.payFrequency}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {companies?.length === 0 && (
          <Card className="col-span-full">
            <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Building2 className="h-10 w-10 mb-3" />
              <p>No companies yet. Add your first company to get started.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function LegalEntityTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<LegalEntity | null>(null);
  const [form, setForm] = useState({
    companyId: "",
    status: "active",
    type: "corporation",
    classificationCode: "",
    legalName: "",
    tradeName: "",
    startDate: "",
    endDate: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    country: "US",
    phone: "",
  });

  const { data: legalEntities, isLoading } = useQuery<LegalEntity[]>({
    queryKey: ["/api/legal-entities"],
  });
  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/legal-entities", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/legal-entities"] });
      setAddOpen(false);
      setForm({
        companyId: "",
        status: "active",
        type: "corporation",
        classificationCode: "",
        legalName: "",
        tradeName: "",
        startDate: "",
        endDate: "",
        address: "",
        city: "",
        state: "",
        zip: "",
        country: "US",
        phone: "",
      });
      toast({ title: "Legal entity added successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof form }) => {
      await apiRequest("PATCH", `/api/legal-entities/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/legal-entities"] });
      setEditOpen(false);
      setEditItem(null);
      setForm({
        companyId: "",
        status: "active",
        type: "corporation",
        classificationCode: "",
        legalName: "",
        tradeName: "",
        startDate: "",
        endDate: "",
        address: "",
        city: "",
        state: "",
        zip: "",
        country: "US",
        phone: "",
      });
      toast({ title: "Legal entity updated successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/legal-entities/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/legal-entities"] });
      toast({ title: "Legal entity deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const handleEdit = (item: LegalEntity) => {
    setEditItem(item);
    setForm({
      companyId: item.companyId || "",
      status: item.status || "active",
      type: item.type || "corporation",
      classificationCode: item.classificationCode || "",
      legalName: item.legalName || "",
      tradeName: item.tradeName || "",
      startDate: item.startDate || "",
      endDate: item.endDate || "",
      address: item.address || "",
      city: item.city || "",
      state: item.state || "",
      zip: item.zip || "",
      country: item.country || "US",
      phone: item.phone || "",
    });
    setEditOpen(true);
  };

  if (isLoading) {
    return (
      <div data-testid="loading-legal-entity">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Legal Entities</h2>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-legal-entity"><Plus className="mr-2 h-4 w-4" />Add Legal Entity</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Legal Entity</DialogTitle></DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Company *</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger data-testid="select-legal-entity-company">
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger data-testid="select-legal-entity-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger data-testid="select-legal-entity-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(LEGAL_ENTITY_TYPES).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="legal-entity-legalName">Legal Name *</Label>
                <Input
                  id="legal-entity-legalName"
                  data-testid="input-legal-entity-legalName"
                  value={form.legalName}
                  onChange={set("legalName")}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="legal-entity-tradeName">Trade Name (DBA)</Label>
                <Input
                  id="legal-entity-tradeName"
                  data-testid="input-legal-entity-tradeName"
                  value={form.tradeName}
                  onChange={set("tradeName")}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="legal-entity-classificationCode">NAICS Code</Label>
                <Input
                  id="legal-entity-classificationCode"
                  data-testid="input-legal-entity-classificationCode"
                  value={form.classificationCode}
                  onChange={set("classificationCode")}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="legal-entity-startDate">Start Date</Label>
                  <Input
                    id="legal-entity-startDate"
                    data-testid="input-legal-entity-startDate"
                    type="date"
                    value={form.startDate}
                    onChange={set("startDate")}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="legal-entity-endDate">End Date</Label>
                  <Input
                    id="legal-entity-endDate"
                    data-testid="input-legal-entity-endDate"
                    type="date"
                    value={form.endDate}
                    onChange={set("endDate")}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="legal-entity-address">Address</Label>
                <Input
                  id="legal-entity-address"
                  data-testid="input-legal-entity-address"
                  value={form.address}
                  onChange={set("address")}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="legal-entity-city">City</Label>
                  <Input
                    id="legal-entity-city"
                    data-testid="input-legal-entity-city"
                    value={form.city}
                    onChange={set("city")}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="legal-entity-state">State</Label>
                  <Input
                    id="legal-entity-state"
                    data-testid="input-legal-entity-state"
                    value={form.state}
                    onChange={set("state")}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="legal-entity-zip">Zip</Label>
                  <Input
                    id="legal-entity-zip"
                    data-testid="input-legal-entity-zip"
                    value={form.zip}
                    onChange={set("zip")}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="legal-entity-country">Country</Label>
                  <Input
                    id="legal-entity-country"
                    data-testid="input-legal-entity-country"
                    value={form.country}
                    onChange={set("country")}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="legal-entity-phone">Phone</Label>
                  <Input
                    id="legal-entity-phone"
                    data-testid="input-legal-entity-phone"
                    value={form.phone}
                    onChange={set("phone")}
                  />
                </div>
              </div>
            </div>
            <Button
              data-testid="button-submit-legal-entity"
              className="w-full mt-2"
              disabled={!form.legalName || !form.companyId || addMutation.isPending}
              onClick={() => addMutation.mutate(form)}
            >
              {addMutation.isPending ? "Adding..." : "Add Legal Entity"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Legal Entity</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Company *</Label>
              <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                <SelectTrigger data-testid="select-legal-entity-company-edit">
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {companies?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger data-testid="select-legal-entity-status-edit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger data-testid="select-legal-entity-type-edit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(LEGAL_ENTITY_TYPES).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="legal-entity-legalName-edit">Legal Name *</Label>
              <Input
                id="legal-entity-legalName-edit"
                data-testid="input-legal-entity-legalName-edit"
                value={form.legalName}
                onChange={set("legalName")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="legal-entity-tradeName-edit">Trade Name (DBA)</Label>
              <Input
                id="legal-entity-tradeName-edit"
                data-testid="input-legal-entity-tradeName-edit"
                value={form.tradeName}
                onChange={set("tradeName")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="legal-entity-classificationCode-edit">NAICS Code</Label>
              <Input
                id="legal-entity-classificationCode-edit"
                data-testid="input-legal-entity-classificationCode-edit"
                value={form.classificationCode}
                onChange={set("classificationCode")}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="legal-entity-startDate-edit">Start Date</Label>
                <Input
                  id="legal-entity-startDate-edit"
                  data-testid="input-legal-entity-startDate-edit"
                  type="date"
                  value={form.startDate}
                  onChange={set("startDate")}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="legal-entity-endDate-edit">End Date</Label>
                <Input
                  id="legal-entity-endDate-edit"
                  data-testid="input-legal-entity-endDate-edit"
                  type="date"
                  value={form.endDate}
                  onChange={set("endDate")}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="legal-entity-address-edit">Address</Label>
              <Input
                id="legal-entity-address-edit"
                data-testid="input-legal-entity-address-edit"
                value={form.address}
                onChange={set("address")}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="legal-entity-city-edit">City</Label>
                <Input
                  id="legal-entity-city-edit"
                  data-testid="input-legal-entity-city-edit"
                  value={form.city}
                  onChange={set("city")}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="legal-entity-state-edit">State</Label>
                <Input
                  id="legal-entity-state-edit"
                  data-testid="input-legal-entity-state-edit"
                  value={form.state}
                  onChange={set("state")}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="legal-entity-zip-edit">Zip</Label>
                <Input
                  id="legal-entity-zip-edit"
                  data-testid="input-legal-entity-zip-edit"
                  value={form.zip}
                  onChange={set("zip")}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="legal-entity-country-edit">Country</Label>
                <Input
                  id="legal-entity-country-edit"
                  data-testid="input-legal-entity-country-edit"
                  value={form.country}
                  onChange={set("country")}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="legal-entity-phone-edit">Phone</Label>
                <Input
                  id="legal-entity-phone-edit"
                  data-testid="input-legal-entity-phone-edit"
                  value={form.phone}
                  onChange={set("phone")}
                />
              </div>
            </div>
          </div>
          <Button
            data-testid="button-save-legal-entity"
            className="w-full mt-2"
            disabled={!form.legalName || !form.companyId || editMutation.isPending}
            onClick={() => editItem && editMutation.mutate({ id: editItem.id, data: form })}
          >
            {editMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Legal Name</TableHead>
                <TableHead>Trade Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned Companies</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {legalEntities?.map((item) => {
                const assignedCompanies = companies?.filter((c) => c.legalEntityId === item.id) || [];
                return (
                  <TableRow key={item.id} data-testid={`row-legal-entity-${item.id}`}>
                    <TableCell className="font-medium">{item.legalName}</TableCell>
                    <TableCell>{item.tradeName || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{LEGAL_ENTITY_TYPES[item.type] || item.type}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.status === "active" ? "default" : "secondary"}>
                        {item.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {assignedCompanies.length > 0
                        ? assignedCompanies.map((c) => c.name).join(", ")
                        : <span className="text-muted-foreground">None</span>
                      }
                    </TableCell>
                    <TableCell className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        data-testid={`button-edit-legal-entity-${item.id}`}
                        onClick={() => handleEdit(item)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        data-testid={`button-delete-legal-entity-${item.id}`}
                        onClick={() => deleteMutation.mutate(item.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {legalEntities?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No legal entities found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function BranchesTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<Branch | null>(null);
  const emptyForm = { companyId: "", divisionId: "", name: "", code: "", address: "", city: "", state: "", zip: "", phone: "" };
  const [form, setForm] = useState(emptyForm);

  const { data: branches, isLoading } = useQuery<Branch[]>({ queryKey: ["/api/branches"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: divisionsList } = useQuery<Division[]>({ queryKey: ["/api/divisions"] });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/branches", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/branches"] });
      setAddOpen(false);
      setForm(emptyForm);
      toast({ title: "Branch added successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof form }) => {
      await apiRequest("PATCH", `/api/branches/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/branches"] });
      setEditOpen(false);
      setEditItem(null);
      setForm(emptyForm);
      toast({ title: "Branch updated successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/branches/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/branches"] });
      toast({ title: "Branch deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleEdit = (item: Branch) => {
    setEditItem(item);
    setForm({
      companyId: item.companyId || "",
      divisionId: item.divisionId || "",
      name: item.name || "",
      code: item.code || "",
      address: item.address || "",
      city: item.city || "",
      state: item.state || "",
      zip: item.zip || "",
      phone: item.phone || "",
    });
    setEditOpen(true);
  };

  if (isLoading) {
    return <div data-testid="loading-branches"><Skeleton className="h-64 w-full" /></div>;
  }

  const filteredDivisions = form.companyId ? divisionsList?.filter((d) => d.companyId === form.companyId) : divisionsList;

  const branchFormFields = (suffix: string) => {
    const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [key]: e.target.value });
    return (
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label>Company *</Label>
          <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v, divisionId: "" })}>
            <SelectTrigger data-testid={`select-branch-company${suffix}`}>
              <SelectValue placeholder="Select company" />
            </SelectTrigger>
            <SelectContent>
              {companies?.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Division</Label>
          <Select value={form.divisionId} onValueChange={(v) => setForm({ ...form, divisionId: v === "__none__" ? "" : v })}>
            <SelectTrigger data-testid={`select-branch-division${suffix}`}>
              <SelectValue placeholder="Select division (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {filteredDivisions?.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>Name *</Label>
            <Input data-testid={`input-branch-name${suffix}`} value={form.name} onChange={set("name")} />
          </div>
          <div className="grid gap-2">
            <Label>Code</Label>
            <Input data-testid={`input-branch-code${suffix}`} value={form.code} onChange={set("code")} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label>Address</Label>
          <Input data-testid={`input-branch-address${suffix}`} value={form.address} onChange={set("address")} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="grid gap-2">
            <Label>City</Label>
            <Input data-testid={`input-branch-city${suffix}`} value={form.city} onChange={set("city")} />
          </div>
          <div className="grid gap-2">
            <Label>State</Label>
            <Input data-testid={`input-branch-state${suffix}`} value={form.state} onChange={set("state")} />
          </div>
          <div className="grid gap-2">
            <Label>Zip</Label>
            <Input data-testid={`input-branch-zip${suffix}`} value={form.zip} onChange={set("zip")} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label>Phone</Label>
          <Input data-testid={`input-branch-phone${suffix}`} value={form.phone} onChange={set("phone")} />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Branches</h2>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-branch"><Plus className="mr-2 h-4 w-4" />Add Branch</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Branch</DialogTitle></DialogHeader>
            {branchFormFields("")}
            <Button
              data-testid="button-submit-branch"
              className="w-full mt-2"
              disabled={!form.name || !form.companyId || addMutation.isPending}
              onClick={() => addMutation.mutate(form)}
            >
              {addMutation.isPending ? "Adding..." : "Add Branch"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Branch</DialogTitle></DialogHeader>
          {branchFormFields("-edit")}
          <Button
            data-testid="button-save-branch"
            className="w-full mt-2"
            disabled={!form.name || !form.companyId || editMutation.isPending}
            onClick={() => editItem && editMutation.mutate({ id: editItem.id, data: form })}
          >
            {editMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Division</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>City</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches?.map((b) => {
                const division = divisionsList?.find((d) => d.id === b.divisionId);
                return (
                  <TableRow key={b.id} data-testid={`row-branch-${b.id}`}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell>{b.code || "-"}</TableCell>
                    <TableCell>{division?.name || "-"}</TableCell>
                    <TableCell>{b.address || "-"}</TableCell>
                    <TableCell>{b.city || "-"}</TableCell>
                    <TableCell>{b.state || "-"}</TableCell>
                    <TableCell>{b.phone || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={b.isActive ? "default" : "secondary"}>
                        {b.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-branch-${b.id}`} onClick={() => handleEdit(b)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        data-testid={`button-delete-branch-${b.id}`}
                        onClick={() => deleteMutation.mutate(b.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {branches?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">No branches found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function DepartmentsTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<Department | null>(null);
  const emptyForm = { companyId: "", divisionId: "", name: "", code: "" };
  const [form, setForm] = useState(emptyForm);

  const { data: departments, isLoading } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: divisionsList } = useQuery<Division[]>({ queryKey: ["/api/divisions"] });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/departments", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
      setAddOpen(false);
      setForm(emptyForm);
      toast({ title: "Department added successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof form }) => {
      await apiRequest("PATCH", `/api/departments/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
      setEditOpen(false);
      setEditItem(null);
      setForm(emptyForm);
      toast({ title: "Department updated successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/departments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
      toast({ title: "Department deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleEdit = (item: Department) => {
    setEditItem(item);
    setForm({
      companyId: item.companyId || "",
      divisionId: item.divisionId || "",
      name: item.name || "",
      code: item.code || "",
    });
    setEditOpen(true);
  };

  if (isLoading) {
    return <div data-testid="loading-departments"><Skeleton className="h-64 w-full" /></div>;
  }

  const filteredDivisions = form.companyId ? divisionsList?.filter((d) => d.companyId === form.companyId) : divisionsList;

  const departmentFormFields = (suffix: string) => (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Company *</Label>
        <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v, divisionId: "" })}>
          <SelectTrigger data-testid={`select-department-company${suffix}`}>
            <SelectValue placeholder="Select company" />
          </SelectTrigger>
          <SelectContent>
            {companies?.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>Division</Label>
        <Select value={form.divisionId} onValueChange={(v) => setForm({ ...form, divisionId: v === "__none__" ? "" : v })}>
          <SelectTrigger data-testid={`select-department-division${suffix}`}>
            <SelectValue placeholder="Select division (optional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {filteredDivisions?.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Name *</Label>
          <Input data-testid={`input-department-name${suffix}`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label>Code</Label>
          <Input data-testid={`input-department-code${suffix}`} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Departments</h2>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-department"><Plus className="mr-2 h-4 w-4" />Add Department</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Department</DialogTitle></DialogHeader>
            {departmentFormFields("")}
            <Button
              data-testid="button-submit-department"
              className="w-full mt-2"
              disabled={!form.name || !form.companyId || addMutation.isPending}
              onClick={() => addMutation.mutate(form)}
            >
              {addMutation.isPending ? "Adding..." : "Add Department"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Department</DialogTitle></DialogHeader>
          {departmentFormFields("-edit")}
          <Button
            data-testid="button-save-department"
            className="w-full mt-2"
            disabled={!form.name || !form.companyId || editMutation.isPending}
            onClick={() => editItem && editMutation.mutate({ id: editItem.id, data: form })}
          >
            {editMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Division</TableHead>
                <TableHead>Manager</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments?.map((d) => {
                const division = divisionsList?.find((div) => div.id === d.divisionId);
                return (
                  <TableRow key={d.id} data-testid={`row-department-${d.id}`}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{d.code || "-"}</TableCell>
                    <TableCell>{division?.name || "-"}</TableCell>
                    <TableCell>{d.managerId || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={d.isActive ? "default" : "secondary"}>
                        {d.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-department-${d.id}`} onClick={() => handleEdit(d)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        data-testid={`button-delete-department-${d.id}`}
                        onClick={() => deleteMutation.mutate(d.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {departments?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No departments found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function EnterprisesTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<Enterprise | null>(null);
  const [form, setForm] = useState({ name: "", description: "", website: "" });

  const { data: enterprises, isLoading } = useQuery<Enterprise[]>({ queryKey: ["/api/enterprises"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/enterprises", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/enterprises"] });
      setAddOpen(false);
      setForm({ name: "", description: "", website: "" });
      toast({ title: "Enterprise added successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof form }) => {
      await apiRequest("PATCH", `/api/enterprises/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/enterprises"] });
      setEditOpen(false);
      setEditItem(null);
      setForm({ name: "", description: "", website: "" });
      toast({ title: "Enterprise updated successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/enterprises/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/enterprises"] });
      toast({ title: "Enterprise deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleEdit = (item: Enterprise) => {
    setEditItem(item);
    setForm({
      name: item.name || "",
      description: item.description || "",
      website: item.website || "",
    });
    setEditOpen(true);
  };

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  if (isLoading) {
    return <div data-testid="loading-enterprises"><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Enterprises</h2>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-enterprise"><Plus className="mr-2 h-4 w-4" />Add Enterprise</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Enterprise</DialogTitle></DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Name *</Label>
                <Input data-testid="input-enterprise-name" value={form.name} onChange={set("name")} />
              </div>
              <div className="grid gap-2">
                <Label>Description</Label>
                <Input data-testid="input-enterprise-description" value={form.description} onChange={set("description")} />
              </div>
              <div className="grid gap-2">
                <Label>Website</Label>
                <Input data-testid="input-enterprise-website" value={form.website} onChange={set("website")} />
              </div>
            </div>
            <Button
              data-testid="button-submit-enterprise"
              className="w-full mt-2"
              disabled={!form.name || addMutation.isPending}
              onClick={() => addMutation.mutate(form)}
            >
              {addMutation.isPending ? "Adding..." : "Add Enterprise"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Enterprise</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Name *</Label>
              <Input data-testid="input-enterprise-name-edit" value={form.name} onChange={set("name")} />
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <Input data-testid="input-enterprise-description-edit" value={form.description} onChange={set("description")} />
            </div>
            <div className="grid gap-2">
              <Label>Website</Label>
              <Input data-testid="input-enterprise-website-edit" value={form.website} onChange={set("website")} />
            </div>
          </div>
          <Button
            data-testid="button-save-enterprise"
            className="w-full mt-2"
            disabled={!form.name || editMutation.isPending}
            onClick={() => editItem && editMutation.mutate({ id: editItem.id, data: form })}
          >
            {editMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Website</TableHead>
                <TableHead>Companies</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enterprises?.map((ent) => {
                const assignedCompanies = companies?.filter((c) => c.enterpriseId === ent.id) || [];
                return (
                  <TableRow key={ent.id} data-testid={`row-enterprise-${ent.id}`}>
                    <TableCell className="font-medium">{ent.name}</TableCell>
                    <TableCell>{ent.description || "-"}</TableCell>
                    <TableCell>{ent.website || "-"}</TableCell>
                    <TableCell>
                      {assignedCompanies.length > 0 ? (
                        <div className="flex gap-1 flex-wrap">
                          {assignedCompanies.map((c) => (
                            <Badge key={c.id} variant="secondary">{c.name}</Badge>
                          ))}
                        </div>
                      ) : "-"}
                    </TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-enterprise-${ent.id}`} onClick={() => handleEdit(ent)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-enterprise-${ent.id}`} onClick={() => deleteMutation.mutate(ent.id)} disabled={deleteMutation.isPending}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {enterprises?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No enterprises found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function DivisionsTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<Division | null>(null);
  const [form, setForm] = useState({ companyId: "", name: "", description: "" });

  const { data: divisionsList, isLoading } = useQuery<Division[]>({ queryKey: ["/api/divisions"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/divisions", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/divisions"] });
      setAddOpen(false);
      setForm({ companyId: "", name: "", description: "" });
      toast({ title: "Division added successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof form }) => {
      await apiRequest("PATCH", `/api/divisions/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/divisions"] });
      setEditOpen(false);
      setEditItem(null);
      setForm({ companyId: "", name: "", description: "" });
      toast({ title: "Division updated successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/divisions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/divisions"] });
      toast({ title: "Division deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleEdit = (item: Division) => {
    setEditItem(item);
    setForm({
      companyId: item.companyId || "",
      name: item.name || "",
      description: item.description || "",
    });
    setEditOpen(true);
  };

  if (isLoading) {
    return <div data-testid="loading-divisions"><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Divisions</h2>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-division"><Plus className="mr-2 h-4 w-4" />Add Division</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Division</DialogTitle></DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Company *</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger data-testid="select-division-company">
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Name *</Label>
                <Input data-testid="input-division-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Description</Label>
                <Input data-testid="input-division-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
            <Button
              data-testid="button-submit-division"
              className="w-full mt-2"
              disabled={!form.name || !form.companyId || addMutation.isPending}
              onClick={() => addMutation.mutate(form)}
            >
              {addMutation.isPending ? "Adding..." : "Add Division"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Division</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Company *</Label>
              <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                <SelectTrigger data-testid="select-division-company-edit">
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {companies?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Name *</Label>
              <Input data-testid="input-division-name-edit" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <Input data-testid="input-division-description-edit" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <Button
            data-testid="button-save-division"
            className="w-full mt-2"
            disabled={!form.name || !form.companyId || editMutation.isPending}
            onClick={() => editItem && editMutation.mutate({ id: editItem.id, data: form })}
          >
            {editMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {divisionsList?.map((d) => {
                const company = companies?.find((c) => c.id === d.companyId);
                return (
                  <TableRow key={d.id} data-testid={`row-division-${d.id}`}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{d.description || "-"}</TableCell>
                    <TableCell>{company?.name || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={d.isActive ? "default" : "secondary"}>
                        {d.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-division-${d.id}`} onClick={() => handleEdit(d)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-division-${d.id}`} onClick={() => deleteMutation.mutate(d.id)} disabled={deleteMutation.isPending}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {divisionsList?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No divisions found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function PositionsTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<Position | null>(null);
  const emptyForm = { companyId: "", departmentId: "", title: "", description: "", reportsToPositionId: "", salaryRangeMin: "", salaryRangeMax: "" };
  const [form, setForm] = useState(emptyForm);

  const { data: positionsList, isLoading } = useQuery<Position[]>({ queryKey: ["/api/positions"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: departments } = useQuery<Department[]>({ queryKey: ["/api/departments"] });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/positions", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
      setAddOpen(false);
      setForm(emptyForm);
      toast({ title: "Position added successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof form }) => {
      await apiRequest("PATCH", `/api/positions/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
      setEditOpen(false);
      setEditItem(null);
      setForm(emptyForm);
      toast({ title: "Position updated successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/positions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
      toast({ title: "Position deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleEdit = (item: Position) => {
    setEditItem(item);
    setForm({
      companyId: item.companyId || "",
      departmentId: item.departmentId || "",
      title: item.title || "",
      description: item.description || "",
      reportsToPositionId: item.reportsToPositionId || "",
      salaryRangeMin: item.salaryRangeMin || "",
      salaryRangeMax: item.salaryRangeMax || "",
    });
    setEditOpen(true);
  };

  if (isLoading) {
    return <div data-testid="loading-positions"><Skeleton className="h-64 w-full" /></div>;
  }

  const filteredDepts = form.companyId ? departments?.filter((d) => d.companyId === form.companyId) : departments;

  const positionFormFields = (suffix: string) => (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Company *</Label>
        <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v, departmentId: "" })}>
          <SelectTrigger data-testid={`select-position-company${suffix}`}>
            <SelectValue placeholder="Select company" />
          </SelectTrigger>
          <SelectContent>
            {companies?.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>Department</Label>
        <Select value={form.departmentId} onValueChange={(v) => setForm({ ...form, departmentId: v })}>
          <SelectTrigger data-testid={`select-position-department${suffix}`}>
            <SelectValue placeholder="Select department" />
          </SelectTrigger>
          <SelectContent>
            {filteredDepts?.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>Title *</Label>
        <Input data-testid={`input-position-title${suffix}`} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </div>
      <div className="grid gap-2">
        <Label>Description</Label>
        <Input data-testid={`input-position-description${suffix}`} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
      <div className="grid gap-2">
        <Label>Reports To</Label>
        <Select value={form.reportsToPositionId} onValueChange={(v) => setForm({ ...form, reportsToPositionId: v })}>
          <SelectTrigger data-testid={`select-position-reports-to${suffix}`}>
            <SelectValue placeholder="Select position" />
          </SelectTrigger>
          <SelectContent>
            {positionsList?.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Salary Min</Label>
          <Input data-testid={`input-position-salary-min${suffix}`} type="number" value={form.salaryRangeMin} onChange={(e) => setForm({ ...form, salaryRangeMin: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label>Salary Max</Label>
          <Input data-testid={`input-position-salary-max${suffix}`} type="number" value={form.salaryRangeMax} onChange={(e) => setForm({ ...form, salaryRangeMax: e.target.value })} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Positions</h2>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-position"><Plus className="mr-2 h-4 w-4" />Add Position</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Position</DialogTitle></DialogHeader>
            {positionFormFields("")}
            <Button
              data-testid="button-submit-position"
              className="w-full mt-2"
              disabled={!form.title || !form.companyId || addMutation.isPending}
              onClick={() => addMutation.mutate(form)}
            >
              {addMutation.isPending ? "Adding..." : "Add Position"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Position</DialogTitle></DialogHeader>
          {positionFormFields("-edit")}
          <Button
            data-testid="button-save-position"
            className="w-full mt-2"
            disabled={!form.title || !form.companyId || editMutation.isPending}
            onClick={() => editItem && editMutation.mutate({ id: editItem.id, data: form })}
          >
            {editMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Reports To</TableHead>
                <TableHead>Salary Range</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positionsList?.map((p) => {
                const dept = departments?.find((d) => d.id === p.departmentId);
                const reportsTo = positionsList?.find((pos) => pos.id === p.reportsToPositionId);
                return (
                  <TableRow key={p.id} data-testid={`row-position-${p.id}`}>
                    <TableCell className="font-medium">{p.title}</TableCell>
                    <TableCell>{p.description || "-"}</TableCell>
                    <TableCell>{dept?.name || "-"}</TableCell>
                    <TableCell>{reportsTo?.title || "-"}</TableCell>
                    <TableCell>
                      {p.salaryRangeMin || p.salaryRangeMax
                        ? `$${p.salaryRangeMin || "0"} - $${p.salaryRangeMax || "0"}`
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.isActive ? "default" : "secondary"}>
                        {p.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-position-${p.id}`} onClick={() => handleEdit(p)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-position-${p.id}`} onClick={() => deleteMutation.mutate(p.id)} disabled={deleteMutation.isPending}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {positionsList?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No positions found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function CostCentersTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<CostCenter | null>(null);
  const emptyForm = { companyId: "", name: "", code: "", description: "" };
  const [form, setForm] = useState(emptyForm);

  const { data: costCentersList, isLoading } = useQuery<CostCenter[]>({ queryKey: ["/api/cost-centers"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/cost-centers", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cost-centers"] });
      setAddOpen(false);
      setForm(emptyForm);
      toast({ title: "Cost center added successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof form }) => {
      await apiRequest("PATCH", `/api/cost-centers/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cost-centers"] });
      setEditOpen(false);
      setEditItem(null);
      setForm(emptyForm);
      toast({ title: "Cost center updated successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/cost-centers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cost-centers"] });
      toast({ title: "Cost center deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleEdit = (item: CostCenter) => {
    setEditItem(item);
    setForm({
      companyId: item.companyId || "",
      name: item.name || "",
      code: item.code || "",
      description: item.description || "",
    });
    setEditOpen(true);
  };

  if (isLoading) {
    return <div data-testid="loading-cost-centers"><Skeleton className="h-64 w-full" /></div>;
  }

  const costCenterFormFields = (suffix: string) => (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Company *</Label>
        <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
          <SelectTrigger data-testid={`select-cost-center-company${suffix}`}>
            <SelectValue placeholder="Select company" />
          </SelectTrigger>
          <SelectContent>
            {companies?.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Name *</Label>
          <Input data-testid={`input-cost-center-name${suffix}`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label>Code</Label>
          <Input data-testid={`input-cost-center-code${suffix}`} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label>Description</Label>
        <Input data-testid={`input-cost-center-description${suffix}`} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Cost Centers</h2>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-cost-center"><Plus className="mr-2 h-4 w-4" />Add Cost Center</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Cost Center</DialogTitle></DialogHeader>
            {costCenterFormFields("")}
            <Button
              data-testid="button-submit-cost-center"
              className="w-full mt-2"
              disabled={!form.name || !form.companyId || addMutation.isPending}
              onClick={() => addMutation.mutate(form)}
            >
              {addMutation.isPending ? "Adding..." : "Add Cost Center"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Cost Center</DialogTitle></DialogHeader>
          {costCenterFormFields("-edit")}
          <Button
            data-testid="button-save-cost-center"
            className="w-full mt-2"
            disabled={!form.name || !form.companyId || editMutation.isPending}
            onClick={() => editItem && editMutation.mutate({ id: editItem.id, data: form })}
          >
            {editMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {costCentersList?.map((cc) => {
                const company = companies?.find((c) => c.id === cc.companyId);
                return (
                  <TableRow key={cc.id} data-testid={`row-cost-center-${cc.id}`}>
                    <TableCell className="font-medium">{cc.name}</TableCell>
                    <TableCell>{cc.code || "-"}</TableCell>
                    <TableCell>{cc.description || "-"}</TableCell>
                    <TableCell>{company?.name || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={cc.isActive ? "default" : "secondary"}>
                        {cc.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-cost-center-${cc.id}`} onClick={() => handleEdit(cc)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-cost-center-${cc.id}`} onClick={() => deleteMutation.mutate(cc.id)} disabled={deleteMutation.isPending}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {costCentersList?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No cost centers found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

const JOB_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
  on_hold: "On Hold",
};

function JobsTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<Job | null>(null);
  const emptyForm = { companyId: "", costCenterId: "", name: "", description: "", startDate: "", endDate: "", status: "active" };
  const [form, setForm] = useState(emptyForm);

  const { data: jobsList, isLoading } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: costCentersList } = useQuery<CostCenter[]>({ queryKey: ["/api/cost-centers"] });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/jobs", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      setAddOpen(false);
      setForm(emptyForm);
      toast({ title: "Job added successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof form }) => {
      await apiRequest("PATCH", `/api/jobs/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      setEditOpen(false);
      setEditItem(null);
      setForm(emptyForm);
      toast({ title: "Job updated successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/jobs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Job deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleEdit = (item: Job) => {
    setEditItem(item);
    setForm({
      companyId: item.companyId || "",
      costCenterId: item.costCenterId || "",
      name: item.name || "",
      description: item.description || "",
      startDate: item.startDate || "",
      endDate: item.endDate || "",
      status: item.status || "active",
    });
    setEditOpen(true);
  };

  if (isLoading) {
    return <div data-testid="loading-jobs"><Skeleton className="h-64 w-full" /></div>;
  }

  const filteredCostCenters = form.companyId ? costCentersList?.filter((cc) => cc.companyId === form.companyId) : costCentersList;

  const jobFormFields = (suffix: string) => (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Company *</Label>
        <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v, costCenterId: "" })}>
          <SelectTrigger data-testid={`select-job-company${suffix}`}>
            <SelectValue placeholder="Select company" />
          </SelectTrigger>
          <SelectContent>
            {companies?.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>Cost Center</Label>
        <Select value={form.costCenterId} onValueChange={(v) => setForm({ ...form, costCenterId: v })}>
          <SelectTrigger data-testid={`select-job-cost-center${suffix}`}>
            <SelectValue placeholder="Select cost center" />
          </SelectTrigger>
          <SelectContent>
            {filteredCostCenters?.map((cc) => (
              <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>Name *</Label>
        <Input data-testid={`input-job-name${suffix}`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="grid gap-2">
        <Label>Description</Label>
        <Input data-testid={`input-job-description${suffix}`} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Start Date</Label>
          <Input data-testid={`input-job-start-date${suffix}`} type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label>End Date</Label>
          <Input data-testid={`input-job-end-date${suffix}`} type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label>Status</Label>
        <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
          <SelectTrigger data-testid={`select-job-status${suffix}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(JOB_STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Jobs</h2>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-job"><Plus className="mr-2 h-4 w-4" />Add Job</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Job</DialogTitle></DialogHeader>
            {jobFormFields("")}
            <Button
              data-testid="button-submit-job"
              className="w-full mt-2"
              disabled={!form.name || !form.companyId || addMutation.isPending}
              onClick={() => addMutation.mutate(form)}
            >
              {addMutation.isPending ? "Adding..." : "Add Job"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Job</DialogTitle></DialogHeader>
          {jobFormFields("-edit")}
          <Button
            data-testid="button-save-job"
            className="w-full mt-2"
            disabled={!form.name || !form.companyId || editMutation.isPending}
            onClick={() => editItem && editMutation.mutate({ id: editItem.id, data: form })}
          >
            {editMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Cost Center</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobsList?.map((j) => {
                const cc = costCentersList?.find((c) => c.id === j.costCenterId);
                return (
                  <TableRow key={j.id} data-testid={`row-job-${j.id}`}>
                    <TableCell className="font-medium">{j.name}</TableCell>
                    <TableCell>{j.description || "-"}</TableCell>
                    <TableCell>{cc?.name || "-"}</TableCell>
                    <TableCell>{j.startDate || "-"}</TableCell>
                    <TableCell>{j.endDate || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={j.status === "active" ? "default" : "secondary"}>
                        {JOB_STATUS_LABELS[j.status || "active"] || j.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-job-${j.id}`} onClick={() => handleEdit(j)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-job-${j.id}`} onClick={() => deleteMutation.mutate(j.id)} disabled={deleteMutation.isPending}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {jobsList?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No jobs found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function HierarchyTab() {
  const { data: enterprises } = useQuery<Enterprise[]>({ queryKey: ["/api/enterprises"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: legalEntities } = useQuery<LegalEntity[]>({ queryKey: ["/api/legal-entities"] });
  const { data: divisionsList } = useQuery<Division[]>({ queryKey: ["/api/divisions"] });
  const { data: branches } = useQuery<Branch[]>({ queryKey: ["/api/branches"] });
  const { data: departments } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: positionsList } = useQuery<Position[]>({ queryKey: ["/api/positions"] });

  const isLoading = !enterprises || !companies || !legalEntities || !divisionsList || !branches || !departments || !positionsList;

  if (isLoading) {
    return <div data-testid="loading-hierarchy"><Skeleton className="h-64 w-full" /></div>;
  }

  const unassignedCompanies = companies.filter((c) => !c.enterpriseId && !c.legalEntityId);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Organization Hierarchy</h2>
      <Card>
        <CardContent className="p-4 space-y-2">
          {enterprises.map((ent) => {
            const entLegalEntities = legalEntities.filter((le) => {
              const leCompanies = companies.filter((c) => c.legalEntityId === le.id);
              return leCompanies.some((c) => c.enterpriseId === ent.id);
            });
            const entDirectCompanies = companies.filter((c) => c.enterpriseId === ent.id && !c.legalEntityId);
            return (
              <div key={ent.id} data-testid={`hierarchy-enterprise-${ent.id}`}>
                <div className="flex items-center gap-2 py-1.5 font-semibold text-sm">
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{ent.name}</span>
                  <Badge variant="secondary" className="text-xs">Enterprise</Badge>
                </div>
                <div className="ml-6 border-l pl-4 space-y-1">
                  {entLegalEntities.map((le) => {
                    const leCompanies = companies.filter((c) => c.legalEntityId === le.id && c.enterpriseId === ent.id);
                    return (
                      <div key={le.id} data-testid={`hierarchy-legal-entity-${le.id}`}>
                        <div className="flex items-center gap-2 py-1.5 font-medium text-sm">
                          <Scale className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span>{le.legalName}</span>
                          <Badge variant="outline" className="text-xs">Legal Entity</Badge>
                        </div>
                        <div className="ml-6 border-l pl-4 space-y-1">
                          {leCompanies.map((comp) => (
                            <CompanyHierarchyNode key={comp.id} company={comp} divisions={divisionsList} branches={branches} departments={departments} positions={positionsList} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {entDirectCompanies.map((comp) => (
                    <CompanyHierarchyNode key={comp.id} company={comp} divisions={divisionsList} branches={branches} departments={departments} positions={positionsList} />
                  ))}
                  {entLegalEntities.length === 0 && entDirectCompanies.length === 0 && (
                    <p className="text-xs text-muted-foreground py-1">No companies assigned</p>
                  )}
                </div>
              </div>
            );
          })}
          {unassignedCompanies.map((comp) => (
            <CompanyHierarchyNode key={comp.id} company={comp} divisions={divisionsList} branches={branches} departments={departments} positions={positionsList} />
          ))}
          {enterprises.length === 0 && unassignedCompanies.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Network className="h-10 w-10 mb-3" />
              <p>No organizational data yet. Add enterprises and companies to see the hierarchy.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CompanyHierarchyNode({ company, divisions, branches, departments, positions }: {
  company: Company;
  divisions: Division[];
  branches: Branch[];
  departments: Department[];
  positions: Position[];
}) {
  const compDivisions = divisions.filter((d) => d.companyId === company.id);
  const compBranches = branches.filter((b) => b.companyId === company.id);
  const compDepts = departments.filter((d) => d.companyId === company.id);
  const compPositions = positions.filter((p) => p.companyId === company.id);

  return (
    <div data-testid={`hierarchy-company-${company.id}`}>
      <div className="flex items-center gap-2 py-1.5 text-sm">
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium">{company.name}</span>
        <Badge variant="secondary" className="text-xs">Company</Badge>
      </div>
      <div className="ml-6 border-l pl-4 space-y-0.5">
        {compDivisions.map((div) => (
          <div key={div.id} className="flex items-center gap-2 py-0.5 text-sm text-muted-foreground">
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span>{div.name}</span>
            <Badge variant="secondary" className="text-xs">Division</Badge>
          </div>
        ))}
        {compBranches.map((br) => (
          <div key={br.id} className="flex items-center gap-2 py-0.5 text-sm text-muted-foreground">
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span>{br.name}</span>
            <Badge variant="secondary" className="text-xs">Branch</Badge>
          </div>
        ))}
        {compDepts.map((dept) => {
          const deptPositions = compPositions.filter((p) => p.departmentId === dept.id);
          return (
            <div key={dept.id}>
              <div className="flex items-center gap-2 py-0.5 text-sm text-muted-foreground">
                <ChevronRight className="h-3 w-3 shrink-0" />
                <span>{dept.name}</span>
                <Badge variant="secondary" className="text-xs">Department</Badge>
              </div>
              {deptPositions.length > 0 && (
                <div className="ml-5 border-l pl-3 space-y-0.5">
                  {deptPositions.map((pos) => (
                    <div key={pos.id} className="flex items-center gap-2 py-0.5 text-sm text-muted-foreground">
                      <ChevronRight className="h-3 w-3 shrink-0" />
                      <span>{pos.title}</span>
                      <Badge variant="secondary" className="text-xs">Position</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {compDivisions.length === 0 && compBranches.length === 0 && compDepts.length === 0 && (
          <p className="text-xs text-muted-foreground py-0.5">No sub-units</p>
        )}
      </div>
    </div>
  );
}

function PlaceholderTab({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Icon className="h-10 w-10 mb-4" />
        <p>{message}</p>
      </CardContent>
    </Card>
  );
}

function CurrenciesTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Globe className="h-5 w-5" />Currencies</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Badge variant="default">USD</Badge>
          <div>
            <p className="font-medium">United States Dollar</p>
            <p className="text-sm text-muted-foreground">Default currency</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QuickStartTab() {
  const items = [
    "Add Company info",
    "Add Departments",
    "Add Employees",
    "Set Pay Policies",
    "Configure Payroll",
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Rocket className="h-5 w-5" />Quick Start Checklist</CardTitle>
        <CardDescription>Follow these steps to set up your payroll system.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {items.map((item, i) => (
            <li key={i} className="flex items-center gap-3" data-testid={`checklist-item-${i}`}>
              <CheckCircle2 className="h-5 w-5 text-muted-foreground shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default function CompanyPage() {
  const [activeTab, setActiveTab] = useTabParam("info");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Building2 className="h-6 w-6 text-blue-accent" />
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Company</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="overflow-x-auto">
          <TabsList className="inline-flex w-auto">
            <TabsTrigger value="info" data-testid="tab-info">Company Information</TabsTrigger>
            <TabsTrigger value="enterprise" data-testid="tab-enterprise">Enterprise</TabsTrigger>
            <TabsTrigger value="legal" data-testid="tab-legal">Legal Entity</TabsTrigger>
            <TabsTrigger value="divisions" data-testid="tab-divisions">Divisions</TabsTrigger>
            <TabsTrigger value="branches" data-testid="tab-branches">Branches</TabsTrigger>
            <TabsTrigger value="departments" data-testid="tab-departments">Departments</TabsTrigger>
            <TabsTrigger value="positions" data-testid="tab-positions">Positions</TabsTrigger>
            <TabsTrigger value="cost-centers" data-testid="tab-cost-centers">Cost Centers</TabsTrigger>
            <TabsTrigger value="jobs" data-testid="tab-jobs">Jobs</TabsTrigger>
            <TabsTrigger value="hierarchy" data-testid="tab-hierarchy">Hierarchy</TabsTrigger>
            <TabsTrigger value="wage-groups" data-testid="tab-wage-groups">Secondary Wage Groups</TabsTrigger>
            <TabsTrigger value="stations" data-testid="tab-stations">Stations</TabsTrigger>
            <TabsTrigger value="permissions" data-testid="tab-permissions">Permission Groups</TabsTrigger>
            <TabsTrigger value="currencies" data-testid="tab-currencies">Currencies</TabsTrigger>
            <TabsTrigger value="import" data-testid="tab-import">Import</TabsTrigger>
            <TabsTrigger value="quickstart" data-testid="tab-quickstart">Quick Start</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="info"><CompanyInfoTab /></TabsContent>
        <TabsContent value="enterprise"><EnterprisesTab /></TabsContent>
        <TabsContent value="legal"><LegalEntityTab /></TabsContent>
        <TabsContent value="divisions"><DivisionsTab /></TabsContent>
        <TabsContent value="branches"><BranchesTab /></TabsContent>
        <TabsContent value="departments"><DepartmentsTab /></TabsContent>
        <TabsContent value="positions"><PositionsTab /></TabsContent>
        <TabsContent value="cost-centers"><CostCentersTab /></TabsContent>
        <TabsContent value="jobs"><JobsTab /></TabsContent>
        <TabsContent value="hierarchy"><HierarchyTab /></TabsContent>
        <TabsContent value="wage-groups">
          <PlaceholderTab icon={DollarSign} message="Secondary wage group configuration coming soon." />
        </TabsContent>
        <TabsContent value="stations">
          <PlaceholderTab icon={Monitor} message="Work station management coming soon." />
        </TabsContent>
        <TabsContent value="permissions">
          <PlaceholderTab icon={Shield} message="Permission group management coming soon." />
        </TabsContent>
        <TabsContent value="currencies"><CurrenciesTab /></TabsContent>
        <TabsContent value="import">
          <PlaceholderTab icon={Import} message="Data import wizard coming soon." />
        </TabsContent>
        <TabsContent value="quickstart"><QuickStartTab /></TabsContent>
      </Tabs>
    </div>
  );
}
