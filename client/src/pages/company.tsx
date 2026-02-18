import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Company, Department, Branch, LegalEntity } from "@shared/schema";
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
  Globe
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
}: {
  form: Record<string, string>;
  setForm: (f: Record<string, string>) => void;
}) {
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <div className="grid gap-4">
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
  name: "", legalName: "", ein: "", entityType: "llc",
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
            <CompanyFormFields form={form} setForm={setForm} />
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
          <CompanyFormFields form={form} setForm={setForm} />
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
                <TableHead>Company</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {legalEntities?.map((item) => {
                const company = companies?.find((c) => c.id === item.companyId);
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
                    <TableCell>{company?.name || "-"}</TableCell>
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
  const [form, setForm] = useState({ companyId: "", name: "", code: "", address: "", city: "", state: "", zip: "", phone: "" });

  const { data: branches, isLoading } = useQuery<Branch[]>({ queryKey: ["/api/branches"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/branches", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/branches"] });
      setAddOpen(false);
      setForm({ companyId: "", name: "", code: "", address: "", city: "", state: "", zip: "", phone: "" });
      toast({ title: "Branch added successfully" });
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

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  if (isLoading) {
    return <div data-testid="loading-branches"><Skeleton className="h-64 w-full" /></div>;
  }

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
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Company *</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger data-testid="select-branch-company">
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
                  <Input data-testid="input-branch-name" value={form.name} onChange={set("name")} />
                </div>
                <div className="grid gap-2">
                  <Label>Code</Label>
                  <Input data-testid="input-branch-code" value={form.code} onChange={set("code")} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Address</Label>
                <Input data-testid="input-branch-address" value={form.address} onChange={set("address")} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="grid gap-2">
                  <Label>City</Label>
                  <Input data-testid="input-branch-city" value={form.city} onChange={set("city")} />
                </div>
                <div className="grid gap-2">
                  <Label>State</Label>
                  <Input data-testid="input-branch-state" value={form.state} onChange={set("state")} />
                </div>
                <div className="grid gap-2">
                  <Label>Zip</Label>
                  <Input data-testid="input-branch-zip" value={form.zip} onChange={set("zip")} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Phone</Label>
                <Input data-testid="input-branch-phone" value={form.phone} onChange={set("phone")} />
              </div>
            </div>
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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>City</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches?.map((b) => (
                <TableRow key={b.id} data-testid={`row-branch-${b.id}`}>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell>{b.code || "-"}</TableCell>
                  <TableCell>{b.address || "-"}</TableCell>
                  <TableCell>{b.city || "-"}</TableCell>
                  <TableCell>{b.state || "-"}</TableCell>
                  <TableCell>{b.phone || "-"}</TableCell>
                  <TableCell>
                    <Badge variant={b.isActive ? "default" : "secondary"}>
                      {b.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
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
              ))}
              {branches?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No branches found.</TableCell>
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
  const [form, setForm] = useState({ companyId: "", name: "", code: "" });

  const { data: departments, isLoading } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/departments", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
      setAddOpen(false);
      setForm({ companyId: "", name: "", code: "" });
      toast({ title: "Department added successfully" });
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

  if (isLoading) {
    return <div data-testid="loading-departments"><Skeleton className="h-64 w-full" /></div>;
  }

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
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Company *</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger data-testid="select-department-company">
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
                  <Input data-testid="input-department-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Code</Label>
                  <Input data-testid="input-department-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                </div>
              </div>
            </div>
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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Manager</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments?.map((d) => (
                <TableRow key={d.id} data-testid={`row-department-${d.id}`}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell>{d.code || "-"}</TableCell>
                  <TableCell>{d.managerId || "-"}</TableCell>
                  <TableCell>
                    <Badge variant={d.isActive ? "default" : "secondary"}>
                      {d.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
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
              ))}
              {departments?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No departments found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
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
            <TabsTrigger value="legal" data-testid="tab-legal">Legal Entity</TabsTrigger>
            <TabsTrigger value="branches" data-testid="tab-branches">Branches</TabsTrigger>
            <TabsTrigger value="departments" data-testid="tab-departments">Departments</TabsTrigger>
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
        <TabsContent value="legal"><LegalEntityTab /></TabsContent>
        <TabsContent value="branches"><BranchesTab /></TabsContent>
        <TabsContent value="departments"><DepartmentsTab /></TabsContent>
        <TabsContent value="hierarchy">
          <PlaceholderTab icon={Network} message="Organization hierarchy viewer coming soon." />
        </TabsContent>
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
