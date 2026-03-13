import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Company, Department, Branch, LegalEntity, Enterprise, Division, Position, CostCenter, Job, Role, RolePermission, UserRole, Station, SecondaryWageGroup, Currency } from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
  Globe, Briefcase, Target, CircleDot, FolderKanban, ChevronRight, Scale,
  UserPlus, Users, Lock, Eye, FilePlus, Edit3, Trash, Save, Upload, Image, X,
  FileUp, AlertCircle, ArrowRight, Check, Download
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

function FileUploadField({ label, value, onUpload, onClear, testId }: {
  label: string;
  value: string;
  onUpload: (url: string) => void;
  onClear: () => void;
  testId: string;
}) {
  const [uploading, setUploading] = useState(false);
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = await res.json();
      onUpload(url);
    } catch {
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {value ? (
        <div className="flex items-center gap-3">
          <img src={value} alt={label} className="h-12 w-12 rounded border object-contain bg-white" />
          <span className="text-sm text-muted-foreground truncate flex-1">{value.split("/").pop()}</span>
          <Button type="button" size="icon" variant="ghost" onClick={onClear} data-testid={`${testId}-clear`}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <label className="flex items-center gap-2 cursor-pointer border rounded-md px-3 py-2 hover:bg-accent/50 transition-colors">
          <Upload className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{uploading ? "Uploading..." : "Choose file"}</span>
          <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} data-testid={testId} />
        </label>
      )}
    </div>
  );
}

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
      <div className="grid grid-cols-2 gap-4">
        <FileUploadField
          label="Company Logo"
          value={form.logoUrl || ""}
          onUpload={(url) => setForm({ ...form, logoUrl: url })}
          onClear={() => setForm({ ...form, logoUrl: "" })}
          testId="upload-company-logo"
        />
        <FileUploadField
          label="Company Icon"
          value={form.iconUrl || ""}
          onUpload={(url) => setForm({ ...form, iconUrl: url })}
          onClear={() => setForm({ ...form, iconUrl: "" })}
          testId="upload-company-icon"
        />
      </div>
    </div>
  );
}

const emptyCompanyForm = (): Record<string, string> => ({
  enterpriseId: "", legalEntityId: "", name: "", legalName: "", ein: "", entityType: "llc",
  address: "", city: "", state: "", zip: "", phone: "", payFrequency: "biweekly",
  logoUrl: "", iconUrl: "",
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
      logoUrl: company.logoUrl || "",
      iconUrl: company.iconUrl || "",
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
              <div className="flex items-center gap-3">
                {company.logoUrl ? (
                  <img src={company.logoUrl} alt="" className="h-10 w-10 rounded border object-contain bg-white shrink-0" />
                ) : company.iconUrl ? (
                  <img src={company.iconUrl} alt="" className="h-10 w-10 rounded border object-contain bg-white shrink-0" />
                ) : (
                  <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br from-teal-500 to-blue-600 text-white font-bold text-lg shadow-sm" data-testid={`icon-company-${company.id}`}>
                    {company.name?.charAt(0)?.toUpperCase() || "C"}
                  </div>
                )}
                <div className="space-y-1">
                  <CardTitle className="text-base">{company.name}</CardTitle>
                  {company.legalName && (
                    <CardDescription>{company.legalName}</CardDescription>
                  )}
                </div>
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
  const emptyLegalEntityForm = () => ({
    companyId: "",
    status: "active",
    type: "corporation",
    classificationCode: "",
    legalName: "",
    tradeName: "",
    ein: "",
    startDate: "",
    endDate: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    country: "US",
    phone: "",
  });
  const [form, setForm] = useState(emptyLegalEntityForm());

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
      setForm(emptyLegalEntityForm());
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
      setForm(emptyLegalEntityForm());
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
      ein: (item as any).ein || "",
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
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="legal-entity-ein">EIN</Label>
                  <Input
                    id="legal-entity-ein"
                    data-testid="input-legal-entity-ein"
                    value={form.ein}
                    onChange={set("ein")}
                    placeholder="XX-XXXXXXX"
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
              disabled={!form.legalName || addMutation.isPending}
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
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="legal-entity-ein-edit">EIN</Label>
                <Input
                  id="legal-entity-ein-edit"
                  data-testid="input-legal-entity-ein-edit"
                  value={form.ein}
                  onChange={set("ein")}
                  placeholder="XX-XXXXXXX"
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
            disabled={!form.legalName || editMutation.isPending}
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
                <TableHead>EIN</TableHead>
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
                    <TableCell>{(item as any).ein || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{item.type ? LEGAL_ENTITY_TYPES[item.type as string] || item.type : "-"}</Badge>
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
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
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
  const emptyForm = { companyId: "__universal__", divisionId: "", name: "", code: "", address: "", city: "", state: "", zip: "", phone: "" };
  const [form, setForm] = useState(emptyForm);

  const { data: branches, isLoading } = useQuery<Branch[]>({ queryKey: ["/api/branches"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: divisionsList } = useQuery<Division[]>({ queryKey: ["/api/divisions"] });

  const toPayload = (data: typeof form) => ({ ...data, companyId: data.companyId === "__universal__" ? null : (data.companyId || null) });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/branches", toPayload(data));
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
      await apiRequest("PATCH", `/api/branches/${id}`, toPayload(data));
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
      companyId: item.companyId || "__universal__",
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

  const filteredDivisions = (form.companyId && form.companyId !== "__universal__") ? divisionsList?.filter((d) => d.companyId === form.companyId) : divisionsList;

  const branchFormFields = (suffix: string) => {
    const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [key]: e.target.value });
    return (
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label>Company</Label>
          <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v, divisionId: "" })}>
            <SelectTrigger data-testid={`select-branch-company${suffix}`}>
              <SelectValue placeholder="Select company" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__universal__">All Companies (Universal)</SelectItem>
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
  const emptyForm = { companyId: "__universal__", divisionId: "", name: "", code: "" };
  const [form, setForm] = useState(emptyForm);

  const { data: departments, isLoading } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: divisionsList } = useQuery<Division[]>({ queryKey: ["/api/divisions"] });

  const toPayload = (data: typeof form) => ({ ...data, companyId: data.companyId === "__universal__" ? null : (data.companyId || null) });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/departments", toPayload(data));
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
      await apiRequest("PATCH", `/api/departments/${id}`, toPayload(data));
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
      companyId: item.companyId || "__universal__",
      divisionId: item.divisionId || "",
      name: item.name || "",
      code: item.code || "",
    });
    setEditOpen(true);
  };

  if (isLoading) {
    return <div data-testid="loading-departments"><Skeleton className="h-64 w-full" /></div>;
  }

  const filteredDivisions = (form.companyId && form.companyId !== "__universal__") ? divisionsList?.filter((d) => d.companyId === form.companyId) : divisionsList;

  const departmentFormFields = (suffix: string) => (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Company</Label>
        <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v, divisionId: "" })}>
          <SelectTrigger data-testid={`select-department-company${suffix}`}>
            <SelectValue placeholder="Select company" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__universal__">All Companies (Universal)</SelectItem>
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
  const emptyForm = { companyId: "__universal__", departmentId: "", title: "", description: "", reportsToPositionId: "", salaryRangeMin: "", salaryRangeMax: "" };
  const [form, setForm] = useState(emptyForm);

  const { data: positionsList, isLoading } = useQuery<Position[]>({ queryKey: ["/api/positions"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: departments } = useQuery<Department[]>({ queryKey: ["/api/departments"] });

  const toPayload = (data: typeof form) => ({ ...data, companyId: data.companyId === "__universal__" ? null : (data.companyId || null) });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/positions", toPayload(data));
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
      await apiRequest("PATCH", `/api/positions/${id}`, toPayload(data));
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
      companyId: item.companyId || "__universal__",
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

  const filteredDepts = (form.companyId && form.companyId !== "__universal__") ? departments?.filter((d) => d.companyId === form.companyId) : departments;

  const positionFormFields = (suffix: string) => (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Company *</Label>
        <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v, departmentId: "" })}>
          <SelectTrigger data-testid={`select-position-company${suffix}`}>
            <SelectValue placeholder="Select company" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__universal__">All Companies (Universal)</SelectItem>
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
  const emptyForm = { companyId: "__universal__", costCenterId: "", departmentId: "", name: "", description: "", payType: "hourly", defaultWage: "", startDate: "", endDate: "", status: "active" };
  const [form, setForm] = useState(emptyForm);

  const { data: jobsList, isLoading } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: costCentersList } = useQuery<CostCenter[]>({ queryKey: ["/api/cost-centers"] });
  const { data: departmentsList } = useQuery<Department[]>({ queryKey: ["/api/departments"] });

  const toPayload = (data: typeof form) => ({ ...data, companyId: data.companyId === "__universal__" ? null : (data.companyId || null) });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/jobs", toPayload(data));
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
      await apiRequest("PATCH", `/api/jobs/${id}`, toPayload(data));
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
      companyId: item.companyId || "__universal__",
      costCenterId: item.costCenterId || "",
      departmentId: (item as any).departmentId || "",
      name: item.name || "",
      description: item.description || "",
      payType: (item as any).payType || "hourly",
      defaultWage: (item as any).defaultWage || "",
      startDate: item.startDate || "",
      endDate: item.endDate || "",
      status: item.status || "active",
    });
    setEditOpen(true);
  };

  if (isLoading) {
    return <div data-testid="loading-jobs"><Skeleton className="h-64 w-full" /></div>;
  }

  const filteredCostCenters = (form.companyId && form.companyId !== "__universal__") ? costCentersList?.filter((cc) => cc.companyId === form.companyId) : costCentersList;
  const filteredDepartments = (form.companyId && form.companyId !== "__universal__") ? departmentsList?.filter((d) => d.companyId === form.companyId) : departmentsList;

  const jobFormFields = (suffix: string) => (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Company</Label>
        <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v, costCenterId: "", departmentId: "" })}>
          <SelectTrigger data-testid={`select-job-company${suffix}`}>
            <SelectValue placeholder="Select company" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__universal__">All Companies (Universal)</SelectItem>
            {companies?.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Department</Label>
          <Select value={form.departmentId} onValueChange={(v) => setForm({ ...form, departmentId: v })}>
            <SelectTrigger data-testid={`select-job-department${suffix}`}>
              <SelectValue placeholder="Select department" />
            </SelectTrigger>
            <SelectContent>
              {filteredDepartments?.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
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
          <Label>Pay Type</Label>
          <Select value={form.payType} onValueChange={(v) => setForm({ ...form, payType: v })}>
            <SelectTrigger data-testid={`select-job-pay-type${suffix}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hourly">Hourly</SelectItem>
              <SelectItem value="salary">Salary</SelectItem>
              <SelectItem value="commission">Commission</SelectItem>
              <SelectItem value="piece_rate">Piece Rate</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Default Wage ($)</Label>
          <Input data-testid={`input-job-wage${suffix}`} type="number" step="0.01" value={form.defaultWage} onChange={(e) => setForm({ ...form, defaultWage: e.target.value })} placeholder="0.00" />
        </div>
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
  const { toast } = useToast();
  const { data: enterprises } = useQuery<Enterprise[]>({ queryKey: ["/api/enterprises"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: legalEntities } = useQuery<LegalEntity[]>({ queryKey: ["/api/legal-entities"] });
  const { data: divisionsList } = useQuery<Division[]>({ queryKey: ["/api/divisions"] });
  const { data: branches } = useQuery<Branch[]>({ queryKey: ["/api/branches"] });
  const { data: departments } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: positionsList } = useQuery<Position[]>({ queryKey: ["/api/positions"] });

  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [editingDept, setEditingDept] = useState<Department | null>(null);

  const companyMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, string> }) => {
      await apiRequest("PATCH", `/api/companies/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setEditingCompany(null);
      toast({ title: "Company assignment updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const branchMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, string> }) => {
      await apiRequest("PATCH", `/api/branches/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/branches"] });
      setEditingBranch(null);
      toast({ title: "Branch assignment updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deptMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, string> }) => {
      await apiRequest("PATCH", `/api/departments/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
      setEditingDept(null);
      toast({ title: "Department assignment updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const isLoading = !enterprises || !companies || !legalEntities || !divisionsList || !branches || !departments || !positionsList;

  if (isLoading) {
    return <div data-testid="loading-hierarchy"><Skeleton className="h-64 w-full" /></div>;
  }

  const unassignedCompanies = companies.filter((c) => !c.enterpriseId && !c.legalEntityId);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Organization Hierarchy</h2>
      <p className="text-sm text-muted-foreground">Click the edit icon next to any item to reassign it within the hierarchy.</p>
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
                            <CompanyHierarchyNode
                              key={comp.id}
                              company={comp}
                              divisions={divisionsList}
                              branches={branches}
                              departments={departments}
                              positions={positionsList}
                              onEditCompany={setEditingCompany}
                              onEditBranch={setEditingBranch}
                              onEditDept={setEditingDept}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {entDirectCompanies.map((comp) => (
                    <CompanyHierarchyNode
                      key={comp.id}
                      company={comp}
                      divisions={divisionsList}
                      branches={branches}
                      departments={departments}
                      positions={positionsList}
                      onEditCompany={setEditingCompany}
                      onEditBranch={setEditingBranch}
                      onEditDept={setEditingDept}
                    />
                  ))}
                  {entLegalEntities.length === 0 && entDirectCompanies.length === 0 && (
                    <p className="text-xs text-muted-foreground py-1">No companies assigned</p>
                  )}
                </div>
              </div>
            );
          })}
          {unassignedCompanies.length > 0 && (
            <div>
              <div className="flex items-center gap-2 py-1.5 font-semibold text-sm text-muted-foreground">
                <span>Unassigned Companies</span>
              </div>
              <div className="ml-6 border-l pl-4 space-y-1">
                {unassignedCompanies.map((comp) => (
                  <CompanyHierarchyNode
                    key={comp.id}
                    company={comp}
                    divisions={divisionsList}
                    branches={branches}
                    departments={departments}
                    positions={positionsList}
                    onEditCompany={setEditingCompany}
                    onEditBranch={setEditingBranch}
                    onEditDept={setEditingDept}
                  />
                ))}
              </div>
            </div>
          )}
          {enterprises.length === 0 && unassignedCompanies.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Network className="h-10 w-10 mb-3" />
              <p>No organizational data yet. Add enterprises and companies to see the hierarchy.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingCompany} onOpenChange={(open) => !open && setEditingCompany(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Reassign Company: {editingCompany?.name}</DialogTitle></DialogHeader>
          {editingCompany && (
            <HierarchyCompanyEditor
              company={editingCompany}
              enterprises={enterprises}
              legalEntities={legalEntities}
              isPending={companyMutation.isPending}
              onSave={(data) => companyMutation.mutate({ id: editingCompany.id, data })}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingBranch} onOpenChange={(open) => !open && setEditingBranch(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Reassign Branch: {editingBranch?.name}</DialogTitle></DialogHeader>
          {editingBranch && (
            <HierarchyBranchEditor
              branch={editingBranch}
              companies={companies}
              isPending={branchMutation.isPending}
              onSave={(data) => branchMutation.mutate({ id: editingBranch.id, data })}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingDept} onOpenChange={(open) => !open && setEditingDept(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Reassign Department: {editingDept?.name}</DialogTitle></DialogHeader>
          {editingDept && (
            <HierarchyDeptEditor
              department={editingDept}
              companies={companies}
              isPending={deptMutation.isPending}
              onSave={(data) => deptMutation.mutate({ id: editingDept.id, data })}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HierarchyCompanyEditor({ company, enterprises, legalEntities, isPending, onSave }: {
  company: Company;
  enterprises: Enterprise[];
  legalEntities: LegalEntity[];
  isPending: boolean;
  onSave: (data: Record<string, string>) => void;
}) {
  const [enterpriseId, setEnterpriseId] = useState(company.enterpriseId || "");
  const [legalEntityId, setLegalEntityId] = useState(company.legalEntityId || "");

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Enterprise</Label>
        <Select value={enterpriseId || "__none__"} onValueChange={(v) => setEnterpriseId(v === "__none__" ? "" : v)}>
          <SelectTrigger data-testid="select-hierarchy-company-enterprise">
            <SelectValue placeholder="Select enterprise" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {enterprises.map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>Legal Entity</Label>
        <Select value={legalEntityId || "__none__"} onValueChange={(v) => setLegalEntityId(v === "__none__" ? "" : v)}>
          <SelectTrigger data-testid="select-hierarchy-company-legal-entity">
            <SelectValue placeholder="Select legal entity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {legalEntities.map((le) => (
              <SelectItem key={le.id} value={le.id}>{le.legalName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        data-testid="button-save-hierarchy-company"
        disabled={isPending}
        onClick={() => onSave({ enterpriseId, legalEntityId })}
      >
        {isPending ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}

function HierarchyBranchEditor({ branch, companies, isPending, onSave }: {
  branch: Branch;
  companies: Company[];
  isPending: boolean;
  onSave: (data: Record<string, string>) => void;
}) {
  const [companyId, setCompanyId] = useState(branch.companyId || "");

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Company</Label>
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger data-testid="select-hierarchy-branch-company">
            <SelectValue placeholder="Select company" />
          </SelectTrigger>
          <SelectContent>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        data-testid="button-save-hierarchy-branch"
        disabled={isPending || !companyId}
        onClick={() => onSave({ companyId })}
      >
        {isPending ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}

function HierarchyDeptEditor({ department, companies, isPending, onSave }: {
  department: Department;
  companies: Company[];
  isPending: boolean;
  onSave: (data: Record<string, string>) => void;
}) {
  const [companyId, setCompanyId] = useState(department.companyId || "");

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Company</Label>
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger data-testid="select-hierarchy-dept-company">
            <SelectValue placeholder="Select company" />
          </SelectTrigger>
          <SelectContent>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        data-testid="button-save-hierarchy-dept"
        disabled={isPending || !companyId}
        onClick={() => onSave({ companyId })}
      >
        {isPending ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}

function CompanyHierarchyNode({ company, divisions, branches, departments, positions, onEditCompany, onEditBranch, onEditDept }: {
  company: Company;
  divisions: Division[];
  branches: Branch[];
  departments: Department[];
  positions: Position[];
  onEditCompany: (c: Company) => void;
  onEditBranch: (b: Branch) => void;
  onEditDept: (d: Department) => void;
}) {
  const compDivisions = divisions.filter((d) => d.companyId === company.id);
  const compBranches = branches.filter((b) => b.companyId === company.id);
  const compDepts = departments.filter((d) => d.companyId === company.id);
  const compPositions = positions.filter((p) => p.companyId === company.id || p.companyId === null);

  return (
    <div data-testid={`hierarchy-company-${company.id}`}>
      <div className="flex items-center gap-2 py-1.5 text-sm group">
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium">{company.name}</span>
        <Badge variant="secondary" className="text-xs">Company</Badge>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          data-testid={`button-edit-hierarchy-company-${company.id}`}
          onClick={() => onEditCompany(company)}
        >
          <Pencil className="h-3 w-3" />
        </Button>
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
          <div key={br.id} className="flex items-center gap-2 py-0.5 text-sm text-muted-foreground group">
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span>{br.name}</span>
            <Badge variant="secondary" className="text-xs">Branch</Badge>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
              data-testid={`button-edit-hierarchy-branch-${br.id}`}
              onClick={() => onEditBranch(br)}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </div>
        ))}
        {compDepts.map((dept) => {
          const deptPositions = compPositions.filter((p) => p.departmentId === dept.id);
          return (
            <div key={dept.id}>
              <div className="flex items-center gap-2 py-0.5 text-sm text-muted-foreground group">
                <ChevronRight className="h-3 w-3 shrink-0" />
                <span>{dept.name}</span>
                <Badge variant="secondary" className="text-xs">Department</Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                  data-testid={`button-edit-hierarchy-dept-${dept.id}`}
                  onClick={() => onEditDept(dept)}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
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

const PERMISSION_RESOURCES = [
  { key: "dashboard", label: "Dashboard" },
  { key: "companies", label: "Companies" },
  { key: "workers", label: "Employees" },
  { key: "schedules", label: "Schedules" },
  { key: "payroll", label: "Payroll" },
  { key: "timesheets", label: "Timesheets" },
  { key: "departments", label: "Departments" },
  { key: "branches", label: "Branches" },
  { key: "divisions", label: "Divisions" },
  { key: "positions", label: "Positions" },
  { key: "policies", label: "Policies" },
  { key: "hr", label: "HR" },
  { key: "reports", label: "Reports" },
  { key: "timeclock", label: "Time Clock" },
  { key: "settings", label: "Settings" },
  { key: "permissions", label: "Permissions" },
  { key: "system_admin", label: "System Administration" },
];

function PermissionsTab() {
  const { toast } = useToast();
  const [permSection, setPermSection] = useState<"roles" | "matrix" | "assignments">("roles");
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);

  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [roleLevel, setRoleLevel] = useState("5");

  const [assignUserId, setAssignUserId] = useState("");
  const [assignRoleId, setAssignRoleId] = useState("");
  const [assignScopeType, setAssignScopeType] = useState("company");
  const [assignScopeId, setAssignScopeId] = useState("");

  const rolesQuery = useQuery<Role[]>({ queryKey: ["/api/roles"] });
  const permissionsQuery = useQuery<RolePermission[]>({
    queryKey: ["/api/role-permissions", selectedRoleId],
    enabled: !!selectedRoleId,
    queryFn: () => apiRequest("GET", `/api/role-permissions?roleId=${selectedRoleId}`).then(r => r.json()),
  });
  const userRolesQuery = useQuery<UserRole[]>({ queryKey: ["/api/user-roles"] });
  const usersQuery = useQuery<{ id: string; username: string; role: string }[]>({ queryKey: ["/api/users"] });
  const companiesQuery = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const enterprisesQuery = useQuery<Enterprise[]>({ queryKey: ["/api/enterprises"] });
  const departmentsQuery = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const branchesQuery = useQuery<Branch[]>({ queryKey: ["/api/branches"] });

  type PermState = { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport: boolean; canApprove: boolean };
  const emptyPerm: PermState = { canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false, canApprove: false };
  const [localPerms, setLocalPerms] = useState<Record<string, PermState>>({});
  const [permsDirty, setPermsDirty] = useState(false);

  useEffect(() => {
    if (permissionsQuery.data && selectedRoleId) {
      const map: Record<string, PermState> = {};
      for (const p of permissionsQuery.data) {
        map[p.resource] = { canView: !!p.canView, canCreate: !!p.canCreate, canEdit: !!p.canEdit, canDelete: !!p.canDelete, canExport: !!p.canExport, canApprove: !!p.canApprove };
      }
      setLocalPerms(map);
      setPermsDirty(false);
    }
  }, [permissionsQuery.data, selectedRoleId]);

  const createRoleMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; level: number }) => {
      const res = await apiRequest("POST", "/api/roles", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      setRoleDialogOpen(false);
      setRoleName(""); setRoleDescription(""); setRoleLevel("5");
      toast({ title: "Role created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Role> }) => {
      const res = await apiRequest("PATCH", `/api/roles/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      setRoleDialogOpen(false);
      setEditingRole(null);
      toast({ title: "Role updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/roles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      toast({ title: "Role deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const savePermsMutation = useMutation({
    mutationFn: async () => {
      const permissions = Object.entries(localPerms).map(([resource, perms]) => ({
        resource,
        ...perms,
      }));
      const res = await apiRequest("POST", "/api/role-permissions/bulk", { roleId: selectedRoleId, permissions });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/role-permissions", selectedRoleId] });
      setPermsDirty(false);
      toast({ title: "Permissions saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const assignRoleMutation = useMutation({
    mutationFn: async (data: { userId: string; roleId: string; scopeType: string; scopeId: string | null }) => {
      const res = await apiRequest("POST", "/api/user-roles", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-roles"] });
      setAssignDialogOpen(false);
      setAssignUserId(""); setAssignRoleId(""); setAssignScopeType("company"); setAssignScopeId("");
      toast({ title: "Role assigned" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeAssignmentMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/user-roles/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-roles"] });
      toast({ title: "Assignment removed" });
    },
  });

  const quickSetupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/permission-groups/quick-setup");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/role-permissions"] });
      toast({ title: "Permission groups configured", description: data.message });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const roles = rolesQuery.data || [];
  const userRolesList = userRolesQuery.data || [];
  const allUsers = usersQuery.data || [];
  const allCompanies = companiesQuery.data || [];
  const allEnterprises = enterprisesQuery.data || [];
  const allDepartments = departmentsQuery.data || [];
  const allBranches = branchesQuery.data || [];

  const getScopeName = (scopeType: string | null, scopeId: string | null) => {
    if (!scopeType || !scopeId) return "All";
    if (scopeType === "enterprise") return allEnterprises.find(e => e.id === scopeId)?.name || scopeId;
    if (scopeType === "company") return allCompanies.find(c => c.id === scopeId)?.name || scopeId;
    if (scopeType === "department") return allDepartments.find(d => d.id === scopeId)?.name || scopeId;
    if (scopeType === "branch") return allBranches.find(b => b.id === scopeId)?.name || scopeId;
    return scopeId;
  };

  if (rolesQuery.isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4" data-testid="permissions-tab">
      <div className="flex gap-2 mb-4">
        <Button
          variant={permSection === "roles" ? "default" : "outline"}
          size="sm"
          onClick={() => setPermSection("roles")}
          data-testid="btn-section-roles"
        >
          <Shield className="h-4 w-4 mr-1" /> Roles
        </Button>
        <Button
          variant={permSection === "matrix" ? "default" : "outline"}
          size="sm"
          onClick={() => setPermSection("matrix")}
          data-testid="btn-section-matrix"
        >
          <Lock className="h-4 w-4 mr-1" /> Permission Matrix
        </Button>
        <Button
          variant={permSection === "assignments" ? "default" : "outline"}
          size="sm"
          onClick={() => setPermSection("assignments")}
          data-testid="btn-section-assignments"
        >
          <Users className="h-4 w-4 mr-1" /> User Assignments
        </Button>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => quickSetupMutation.mutate()}
          disabled={quickSetupMutation.isPending}
          data-testid="btn-quick-setup-permissions"
        >
          <Rocket className="h-4 w-4 mr-1" /> {quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
        </Button>
      </div>

      {permSection === "roles" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" />Roles</CardTitle>
            <Dialog open={roleDialogOpen} onOpenChange={(o) => { setRoleDialogOpen(o); if (!o) setEditingRole(null); }}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={() => { setEditingRole(null); setRoleName(""); setRoleDescription(""); setRoleLevel("5"); }} data-testid="btn-add-role">
                  <Plus className="h-4 w-4 mr-1" /> Add Role
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{editingRole ? "Edit Role" : "Add Role"}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Name</Label>
                    <Input value={roleName} onChange={e => setRoleName(e.target.value)} placeholder="e.g. Branch Manager" data-testid="input-role-name" />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea value={roleDescription} onChange={e => setRoleDescription(e.target.value)} placeholder="What this role can do" data-testid="input-role-description" />
                  </div>
                  <div>
                    <Label>Level (1=highest, 5=lowest)</Label>
                    <Select value={roleLevel} onValueChange={setRoleLevel}>
                      <SelectTrigger data-testid="select-role-level"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 - Enterprise</SelectItem>
                        <SelectItem value="2">2 - Company</SelectItem>
                        <SelectItem value="3">3 - Manager</SelectItem>
                        <SelectItem value="4">4 - Supervisor</SelectItem>
                        <SelectItem value="5">5 - Employee</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={() => {
                      if (editingRole) {
                        updateRoleMutation.mutate({ id: editingRole.id, data: { name: roleName, description: roleDescription, level: parseInt(roleLevel) } });
                      } else {
                        createRoleMutation.mutate({ name: roleName, description: roleDescription, level: parseInt(roleLevel) });
                      }
                    }}
                    disabled={!roleName || createRoleMutation.isPending || updateRoleMutation.isPending}
                    data-testid="btn-save-role"
                  >
                    {editingRole ? "Update" : "Create"} Role
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map(role => (
                  <TableRow key={role.id} data-testid={`row-role-${role.id}`}>
                    <TableCell className="font-medium">{role.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{role.description}</TableCell>
                    <TableCell><Badge variant="outline">{role.level}</Badge></TableCell>
                    <TableCell>{role.isSystem ? <Badge>System</Badge> : <Badge variant="secondary">Custom</Badge>}</TableCell>
                    <TableCell>
                      {!role.isSystem && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => {
                              setEditingRole(role);
                              setRoleName(role.name);
                              setRoleDescription(role.description || "");
                              setRoleLevel(String(role.level));
                              setRoleDialogOpen(true);
                            }}>
                              <Pencil className="h-4 w-4 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => deleteRoleMutation.mutate(role.id)}>
                              <Trash2 className="h-4 w-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {roles.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No roles defined yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {permSection === "matrix" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Lock className="h-5 w-5" />Permission Matrix</CardTitle>
            <CardDescription>Select a role then toggle which resources it can access</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Label>Role:</Label>
              <Select value={selectedRoleId} onValueChange={(v) => { setSelectedRoleId(v); setPermsDirty(false); }}>
                <SelectTrigger className="w-[250px]" data-testid="select-matrix-role"><SelectValue placeholder="Select a role" /></SelectTrigger>
                <SelectContent>
                  {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {permsDirty && (
                <Button size="sm" onClick={() => savePermsMutation.mutate()} disabled={savePermsMutation.isPending} data-testid="btn-save-permissions">
                  <Save className="h-4 w-4 mr-1" /> Save Changes
                </Button>
              )}
            </div>

            {selectedRoleId && permissionsQuery.isLoading && <Skeleton className="h-48 w-full" />}

            {selectedRoleId && !permissionsQuery.isLoading && (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Resource</TableHead>
                      <TableHead className="text-center w-20"><Eye className="h-4 w-4 inline" /> View</TableHead>
                      <TableHead className="text-center w-20"><FilePlus className="h-4 w-4 inline" /> Create</TableHead>
                      <TableHead className="text-center w-20"><Edit3 className="h-4 w-4 inline" /> Edit</TableHead>
                      <TableHead className="text-center w-20"><Trash className="h-4 w-4 inline" /> Delete</TableHead>
                      <TableHead className="text-center w-20"><Download className="h-4 w-4 inline" /> Export</TableHead>
                      <TableHead className="text-center w-20"><CheckCircle2 className="h-4 w-4 inline" /> Approve</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {PERMISSION_RESOURCES.map(res => {
                      const perm = localPerms[res.key] || emptyPerm;
                      const togglePerm = (field: keyof PermState) => {
                        setLocalPerms(prev => ({
                          ...prev,
                          [res.key]: { ...(prev[res.key] || emptyPerm), [field]: !(prev[res.key]?.[field] ?? false) }
                        }));
                        setPermsDirty(true);
                      };
                      return (
                        <TableRow key={res.key} data-testid={`row-perm-${res.key}`}>
                          <TableCell className="font-medium">{res.label}</TableCell>
                          <TableCell className="text-center"><Checkbox checked={perm.canView} onCheckedChange={() => togglePerm("canView")} data-testid={`check-${res.key}-view`} /></TableCell>
                          <TableCell className="text-center"><Checkbox checked={perm.canCreate} onCheckedChange={() => togglePerm("canCreate")} data-testid={`check-${res.key}-create`} /></TableCell>
                          <TableCell className="text-center"><Checkbox checked={perm.canEdit} onCheckedChange={() => togglePerm("canEdit")} data-testid={`check-${res.key}-edit`} /></TableCell>
                          <TableCell className="text-center"><Checkbox checked={perm.canDelete} onCheckedChange={() => togglePerm("canDelete")} data-testid={`check-${res.key}-delete`} /></TableCell>
                          <TableCell className="text-center"><Checkbox checked={perm.canExport} onCheckedChange={() => togglePerm("canExport")} data-testid={`check-${res.key}-export`} /></TableCell>
                          <TableCell className="text-center"><Checkbox checked={perm.canApprove} onCheckedChange={() => togglePerm("canApprove")} data-testid={`check-${res.key}-approve`} /></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </>
            )}

            {!selectedRoleId && (
              <div className="text-center text-muted-foreground py-8">Select a role above to configure its permissions</div>
            )}
          </CardContent>
        </Card>
      )}

      {permSection === "assignments" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />User Role Assignments</CardTitle>
            <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="btn-assign-role"><UserPlus className="h-4 w-4 mr-1" /> Assign Role</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Assign Role to User</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>User</Label>
                    <Select value={assignUserId} onValueChange={setAssignUserId}>
                      <SelectTrigger data-testid="select-assign-user"><SelectValue placeholder="Select user" /></SelectTrigger>
                      <SelectContent>
                        {allUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Role</Label>
                    <Select value={assignRoleId} onValueChange={setAssignRoleId}>
                      <SelectTrigger data-testid="select-assign-role"><SelectValue placeholder="Select role" /></SelectTrigger>
                      <SelectContent>
                        {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Scope Type</Label>
                    <Select value={assignScopeType} onValueChange={(v) => { setAssignScopeType(v); setAssignScopeId(""); }}>
                      <SelectTrigger data-testid="select-assign-scope-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="enterprise">Enterprise</SelectItem>
                        <SelectItem value="company">Company</SelectItem>
                        <SelectItem value="department">Department</SelectItem>
                        <SelectItem value="branch">Branch</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Scope ({assignScopeType})</Label>
                    <Select value={assignScopeId} onValueChange={setAssignScopeId}>
                      <SelectTrigger data-testid="select-assign-scope-id"><SelectValue placeholder={`Select ${assignScopeType}`} /></SelectTrigger>
                      <SelectContent>
                        {assignScopeType === "enterprise" && allEnterprises.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                        {assignScopeType === "company" && allCompanies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        {assignScopeType === "department" && allDepartments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                        {assignScopeType === "branch" && allBranches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={() => assignRoleMutation.mutate({ userId: assignUserId, roleId: assignRoleId, scopeType: assignScopeType, scopeId: assignScopeId || null })}
                    disabled={!assignUserId || !assignRoleId || assignRoleMutation.isPending}
                    data-testid="btn-confirm-assign"
                  >
                    Assign Role
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {userRolesQuery.isLoading ? <Skeleton className="h-32 w-full" /> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Scope Type</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {userRolesList.map(ur => (
                    <TableRow key={ur.id} data-testid={`row-assignment-${ur.id}`}>
                      <TableCell className="font-medium">{allUsers.find(u => u.id === ur.userId)?.username || ur.userId}</TableCell>
                      <TableCell>{roles.find(r => r.id === ur.roleId)?.name || ur.roleId}</TableCell>
                      <TableCell><Badge variant="outline">{ur.scopeType || "all"}</Badge></TableCell>
                      <TableCell>{getScopeName(ur.scopeType, ur.scopeId)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => removeAssignmentMutation.mutate(ur.id)} data-testid={`btn-remove-assignment-${ur.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {userRolesList.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No role assignments yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StationsTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<Station | null>(null);
  const emptyForm = { companyId: "__all__", stationName: "", location: "", ipRestriction: "", description: "", status: "active", requiresSchedule: false };
  const [form, setForm] = useState(emptyForm);

  const { data: stationsList, isLoading } = useQuery<Station[]>({ queryKey: ["/api/stations"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const prepareData = (data: typeof form) => ({
    ...data,
    companyId: data.companyId === "__all__" ? null : data.companyId || null,
  });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => { await apiRequest("POST", "/api/stations", prepareData(data)); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/stations"] }); setAddOpen(false); setForm(emptyForm); toast({ title: "Station added" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof form }) => { await apiRequest("PATCH", `/api/stations/${id}`, prepareData(data)); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/stations"] }); setEditOpen(false); setEditItem(null); setForm(emptyForm); toast({ title: "Station updated" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/stations/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/stations"] }); toast({ title: "Station deleted" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleEdit = (item: Station) => {
    setEditItem(item);
    setForm({ companyId: item.companyId || "__all__", stationName: item.stationName || "", location: item.location || "", ipRestriction: item.ipRestriction || "", description: item.description || "", status: item.status || "active", requiresSchedule: item.requiresSchedule || false });
    setEditOpen(true);
  };

  if (isLoading) return <div data-testid="loading-stations"><Skeleton className="h-64 w-full" /></div>;

  const stationFormFields = (suffix: string) => (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Company</Label>
        <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
          <SelectTrigger data-testid={`select-station-company${suffix}`}><SelectValue placeholder="Select company" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Companies (Enterprise-wide)</SelectItem>
            {companies?.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Select "All Companies" to make this station available to every company.</p>
      </div>
      <div className="grid gap-2">
        <Label>Station Name *</Label>
        <Input data-testid={`input-station-name${suffix}`} value={form.stationName} onChange={(e) => setForm({ ...form, stationName: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Location</Label>
          <Input data-testid={`input-station-location${suffix}`} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Building A, Floor 2" />
        </div>
        <div className="grid gap-2">
          <Label>IP Restriction</Label>
          <Input data-testid={`input-station-ip${suffix}`} value={form.ipRestriction} onChange={(e) => setForm({ ...form, ipRestriction: e.target.value })} placeholder="e.g. 192.168.1.0/24" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Description</Label>
          <Input data-testid={`input-station-description${suffix}`} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
            <SelectTrigger data-testid={`select-station-status${suffix}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Switch
          checked={form.requiresSchedule}
          onCheckedChange={(v) => setForm({ ...form, requiresSchedule: v })}
          data-testid={`switch-station-requires-schedule${suffix}`}
        />
        <Label>Restrict clock-in to scheduled employees only</Label>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Stations</h2>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild><Button data-testid="button-add-station"><Plus className="mr-2 h-4 w-4" />Add Station</Button></DialogTrigger>
          <DialogContent><DialogHeader><DialogTitle>Add Station</DialogTitle></DialogHeader>
            {stationFormFields("")}
            <Button data-testid="button-submit-station" className="w-full mt-2" disabled={!form.stationName || addMutation.isPending} onClick={() => addMutation.mutate(form)}>
              {addMutation.isPending ? "Adding..." : "Add Station"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent><DialogHeader><DialogTitle>Edit Station</DialogTitle></DialogHeader>
          {stationFormFields("-edit")}
          <Button data-testid="button-update-station" className="w-full mt-2" disabled={!form.stationName || editMutation.isPending} onClick={() => editItem && editMutation.mutate({ id: editItem.id, data: form })}>
            {editMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogContent>
      </Dialog>
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Station Name</TableHead><TableHead>Company</TableHead><TableHead>Location</TableHead><TableHead>IP Restriction</TableHead><TableHead>Sched. Only</TableHead><TableHead>Status</TableHead><TableHead className="w-12"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(!stationsList || stationsList.length === 0) ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No stations configured</TableCell></TableRow>
            ) : stationsList.map((s) => (
              <TableRow key={s.id} data-testid={`row-station-${s.id}`}>
                <TableCell className="font-medium">{s.stationName}</TableCell>
                <TableCell className="text-sm">{s.companyId ? (companies?.find(c => c.id === s.companyId)?.name || "—") : <Badge variant="outline">All Companies</Badge>}</TableCell>
                <TableCell>{s.location || "—"}</TableCell>
                <TableCell className="font-mono text-sm">{s.ipRestriction || "—"}</TableCell>
                <TableCell>{s.requiresSchedule ? <Badge variant="secondary">Yes</Badge> : "—"}</TableCell>
                <TableCell><Badge variant={s.status === "active" ? "default" : "secondary"}>{s.status}</Badge></TableCell>
                <TableCell>
                  <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" data-testid={`menu-station-${s.id}`}><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEdit(s)} data-testid={`edit-station-${s.id}`}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                      <DropdownMenuItem className="text-red-600" onClick={() => deleteMutation.mutate(s.id)} data-testid={`delete-station-${s.id}`}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function SecondaryWageGroupsTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<SecondaryWageGroup | null>(null);
  const emptyForm = { companyId: "", name: "", hourlyRate: "", overtimeRate: "", description: "", isActive: true };
  const [form, setForm] = useState(emptyForm);

  const { data: wageGroupsList, isLoading } = useQuery<SecondaryWageGroup[]>({ queryKey: ["/api/secondary-wage-groups"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => { await apiRequest("POST", "/api/secondary-wage-groups", data); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/secondary-wage-groups"] }); setAddOpen(false); setForm(emptyForm); toast({ title: "Wage group added" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof form }) => { await apiRequest("PATCH", `/api/secondary-wage-groups/${id}`, data); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/secondary-wage-groups"] }); setEditOpen(false); setEditItem(null); setForm(emptyForm); toast({ title: "Wage group updated" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/secondary-wage-groups/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/secondary-wage-groups"] }); toast({ title: "Wage group deleted" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleEdit = (item: SecondaryWageGroup) => {
    setEditItem(item);
    setForm({ companyId: item.companyId || "", name: item.name || "", hourlyRate: item.hourlyRate || "0", overtimeRate: item.overtimeRate || "0", description: item.description || "", isActive: item.isActive !== false });
    setEditOpen(true);
  };

  if (isLoading) return <div data-testid="loading-wage-groups"><Skeleton className="h-64 w-full" /></div>;

  const wageFormFields = (suffix: string) => (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Company *</Label>
        <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
          <SelectTrigger data-testid={`select-wg-company${suffix}`}><SelectValue placeholder="Select company" /></SelectTrigger>
          <SelectContent>{companies?.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}</SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>Group Name *</Label>
        <Input data-testid={`input-wg-name${suffix}`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Hourly Rate ($)</Label>
          <Input data-testid={`input-wg-hourly${suffix}`} type="number" step="0.01" value={form.hourlyRate} onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label>Overtime Rate ($)</Label>
          <Input data-testid={`input-wg-overtime${suffix}`} type="number" step="0.01" value={form.overtimeRate} onChange={(e) => setForm({ ...form, overtimeRate: e.target.value })} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label>Description</Label>
        <Input data-testid={`input-wg-description${suffix}`} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Secondary Wage Groups</h2>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild><Button data-testid="button-add-wage-group"><Plus className="mr-2 h-4 w-4" />Add Wage Group</Button></DialogTrigger>
          <DialogContent><DialogHeader><DialogTitle>Add Secondary Wage Group</DialogTitle></DialogHeader>
            {wageFormFields("")}
            <Button data-testid="button-submit-wage-group" className="w-full mt-2" disabled={!form.name || !form.companyId || addMutation.isPending} onClick={() => addMutation.mutate(form)}>
              {addMutation.isPending ? "Adding..." : "Add Wage Group"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent><DialogHeader><DialogTitle>Edit Secondary Wage Group</DialogTitle></DialogHeader>
          {wageFormFields("-edit")}
          <Button data-testid="button-update-wage-group" className="w-full mt-2" disabled={!form.name || editMutation.isPending} onClick={() => editItem && editMutation.mutate({ id: editItem.id, data: form })}>
            {editMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogContent>
      </Dialog>
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Hourly Rate</TableHead><TableHead>OT Rate</TableHead><TableHead>Description</TableHead><TableHead>Status</TableHead><TableHead className="w-12"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(!wageGroupsList || wageGroupsList.length === 0) ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No secondary wage groups configured</TableCell></TableRow>
            ) : wageGroupsList.map((w) => (
              <TableRow key={w.id} data-testid={`row-wage-group-${w.id}`}>
                <TableCell className="font-medium">{w.name}</TableCell>
                <TableCell>${Number(w.hourlyRate || 0).toFixed(2)}</TableCell>
                <TableCell>${Number(w.overtimeRate || 0).toFixed(2)}</TableCell>
                <TableCell>{w.description || "—"}</TableCell>
                <TableCell><Badge variant={w.isActive ? "default" : "secondary"}>{w.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                <TableCell>
                  <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" data-testid={`menu-wg-${w.id}`}><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEdit(w)} data-testid={`edit-wg-${w.id}`}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                      <DropdownMenuItem className="text-red-600" onClick={() => deleteMutation.mutate(w.id)} data-testid={`delete-wg-${w.id}`}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function CurrenciesTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<Currency | null>(null);
  const emptyForm = { companyId: "", currencyCode: "", currencyName: "", symbol: "$", exchangeRate: "1", isBaseCurrency: false, status: "active" };
  const [form, setForm] = useState(emptyForm);

  const { data: currenciesList, isLoading } = useQuery<Currency[]>({ queryKey: ["/api/currencies"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => { await apiRequest("POST", "/api/currencies", data); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/currencies"] }); setAddOpen(false); setForm(emptyForm); toast({ title: "Currency added" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof form }) => { await apiRequest("PATCH", `/api/currencies/${id}`, data); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/currencies"] }); setEditOpen(false); setEditItem(null); setForm(emptyForm); toast({ title: "Currency updated" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/currencies/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/currencies"] }); toast({ title: "Currency deleted" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleEdit = (item: Currency) => {
    setEditItem(item);
    setForm({ companyId: item.companyId || "", currencyCode: item.currencyCode || "", currencyName: item.currencyName || "", symbol: item.symbol || "$", exchangeRate: item.exchangeRate || "1", isBaseCurrency: item.isBaseCurrency || false, status: item.status || "active" });
    setEditOpen(true);
  };

  if (isLoading) return <div data-testid="loading-currencies"><Skeleton className="h-64 w-full" /></div>;

  const currencyFormFields = (suffix: string) => (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Company</Label>
        <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
          <SelectTrigger data-testid={`select-currency-company${suffix}`}><SelectValue placeholder="Global (all companies)" /></SelectTrigger>
          <SelectContent>{companies?.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}</SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="grid gap-2">
          <Label>Currency Code *</Label>
          <Input data-testid={`input-currency-code${suffix}`} value={form.currencyCode} onChange={(e) => setForm({ ...form, currencyCode: e.target.value.toUpperCase() })} placeholder="USD" maxLength={3} />
        </div>
        <div className="grid gap-2">
          <Label>Currency Name *</Label>
          <Input data-testid={`input-currency-name${suffix}`} value={form.currencyName} onChange={(e) => setForm({ ...form, currencyName: e.target.value })} placeholder="US Dollar" />
        </div>
        <div className="grid gap-2">
          <Label>Symbol</Label>
          <Input data-testid={`input-currency-symbol${suffix}`} value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="$" maxLength={5} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Exchange Rate</Label>
          <Input data-testid={`input-currency-rate${suffix}`} type="number" step="0.0001" value={form.exchangeRate} onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
            <SelectTrigger data-testid={`select-currency-status${suffix}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox data-testid={`check-currency-base${suffix}`} checked={form.isBaseCurrency} onCheckedChange={(v) => setForm({ ...form, isBaseCurrency: !!v })} />
        <Label>Base Currency</Label>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Currencies</h2>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild><Button data-testid="button-add-currency"><Plus className="mr-2 h-4 w-4" />Add Currency</Button></DialogTrigger>
          <DialogContent><DialogHeader><DialogTitle>Add Currency</DialogTitle></DialogHeader>
            {currencyFormFields("")}
            <Button data-testid="button-submit-currency" className="w-full mt-2" disabled={!form.currencyCode || !form.currencyName || addMutation.isPending} onClick={() => addMutation.mutate(form)}>
              {addMutation.isPending ? "Adding..." : "Add Currency"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent><DialogHeader><DialogTitle>Edit Currency</DialogTitle></DialogHeader>
          {currencyFormFields("-edit")}
          <Button data-testid="button-update-currency" className="w-full mt-2" disabled={!form.currencyCode || editMutation.isPending} onClick={() => editItem && editMutation.mutate({ id: editItem.id, data: form })}>
            {editMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogContent>
      </Dialog>
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Symbol</TableHead><TableHead>Exchange Rate</TableHead><TableHead>Base</TableHead><TableHead>Status</TableHead><TableHead className="w-12"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(!currenciesList || currenciesList.length === 0) ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No currencies configured</TableCell></TableRow>
            ) : currenciesList.map((c) => (
              <TableRow key={c.id} data-testid={`row-currency-${c.id}`}>
                <TableCell className="font-medium">{c.currencyCode}</TableCell>
                <TableCell>{c.currencyName}</TableCell>
                <TableCell>{c.symbol}</TableCell>
                <TableCell>{Number(c.exchangeRate || 1).toFixed(4)}</TableCell>
                <TableCell>{c.isBaseCurrency ? <Badge variant="default">Base</Badge> : "—"}</TableCell>
                <TableCell><Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status}</Badge></TableCell>
                <TableCell>
                  <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" data-testid={`menu-currency-${c.id}`}><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEdit(c)} data-testid={`edit-currency-${c.id}`}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                      <DropdownMenuItem className="text-red-600" onClick={() => deleteMutation.mutate(c.id)} data-testid={`delete-currency-${c.id}`}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function ImportTab() {
  const { toast } = useToast();
  const [step, setStep] = useState<"upload" | "map" | "preview" | "result">("upload");
  const [importType, setImportType] = useState("workers");
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ imported: number; errors: string[]; total: number } | null>(null);
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const [selectedCompanyId, setSelectedCompanyId] = useState("");

  const targetFields: Record<string, { label: string; required: boolean }[]> = {
    workers: [
      { label: "firstName", required: true }, { label: "lastName", required: true },
      { label: "email", required: false }, { label: "phone", required: false },
      { label: "workerType", required: false }, { label: "status", required: false },
      { label: "hireDate", required: false }, { label: "hourlyRate", required: false },
      { label: "ssn", required: false }, { label: "address", required: false },
      { label: "city", required: false }, { label: "state", required: false }, { label: "zip", required: false },
    ],
    departments: [
      { label: "name", required: true }, { label: "code", required: false },
      { label: "description", required: false },
    ],
    jobs: [
      { label: "name", required: true }, { label: "description", required: false },
      { label: "status", required: false },
    ],
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { toast({ title: "CSV must have headers and at least one data row", variant: "destructive" }); return; }
      const parsed = lines.map(line => {
        const result: string[] = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          if (line[i] === '"') { inQuotes = !inQuotes; }
          else if (line[i] === ',' && !inQuotes) { result.push(current.trim()); current = ""; }
          else { current += line[i]; }
        }
        result.push(current.trim());
        return result;
      });
      const h = parsed[0];
      setHeaders(h);
      setCsvData(parsed.slice(1));
      const autoMap: Record<string, string> = {};
      const fields = targetFields[importType] || [];
      fields.forEach(f => {
        const match = h.findIndex(col => col.toLowerCase().replace(/[_\s]/g, "") === f.label.toLowerCase().replace(/[_\s]/g, ""));
        if (match >= 0) autoMap[f.label] = h[match];
      });
      setColumnMap(autoMap);
      setStep("map");
    };
    reader.readAsText(file);
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      const fields = targetFields[importType] || [];
      const records = csvData.map(row => {
        const record: Record<string, string> = {};
        if (selectedCompanyId) record.companyId = selectedCompanyId;
        fields.forEach(f => {
          const csvCol = columnMap[f.label];
          if (csvCol) {
            const idx = headers.indexOf(csvCol);
            if (idx >= 0 && row[idx]) record[f.label] = row[idx];
          }
        });
        return record;
      }).filter(r => Object.keys(r).length > 1 || (Object.keys(r).length === 1 && !r.companyId));
      const res = await apiRequest("POST", `/api/import/${importType}`, { records });
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      setStep("result");
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (err: Error) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const previewData = csvData.slice(0, 5).map(row => {
    const mapped: Record<string, string> = {};
    Object.entries(columnMap).forEach(([field, csvCol]) => {
      const idx = headers.indexOf(csvCol);
      if (idx >= 0) mapped[field] = row[idx] || "";
    });
    return mapped;
  });

  const reset = () => { setStep("upload"); setCsvData([]); setHeaders([]); setColumnMap({}); setResult(null); };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold flex items-center gap-2"><FileUp className="h-5 w-5" />CSV Import Wizard</h2>

      <Card>
        <CardContent className="pt-6">
          {step === "upload" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Import Type</Label>
                  <Select value={importType} onValueChange={setImportType}>
                    <SelectTrigger data-testid="select-import-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="workers">Employees</SelectItem>
                      <SelectItem value="departments">Departments</SelectItem>
                      <SelectItem value="jobs">Jobs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Company *</Label>
                  <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                    <SelectTrigger data-testid="select-import-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                    <SelectContent>{companies?.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <FileUp className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-3">Upload a CSV file to import {importType}</p>
                <Input type="file" accept=".csv" onChange={handleFileUpload} data-testid="input-csv-file" className="max-w-xs mx-auto" disabled={!selectedCompanyId} />
                {!selectedCompanyId && <p className="text-xs text-amber-600 mt-2">Select a company first</p>}
              </div>
              <div className="text-sm text-muted-foreground">
                <p className="font-medium mb-1">Expected columns for {importType}:</p>
                <p>{(targetFields[importType] || []).map(f => f.required ? `${f.label} *` : f.label).join(", ")}</p>
              </div>
            </div>
          )}

          {step === "map" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Map CSV columns to {importType} fields. {csvData.length} rows found.</p>
                <Button variant="outline" size="sm" onClick={reset} data-testid="button-import-reset">Start Over</Button>
              </div>
              <div className="grid gap-3 max-h-96 overflow-y-auto">
                {(targetFields[importType] || []).map(f => (
                  <div key={f.label} className="grid grid-cols-2 gap-3 items-center">
                    <Label className="text-sm">{f.label} {f.required && <span className="text-red-500">*</span>}</Label>
                    <Select value={columnMap[f.label] || "__skip__"} onValueChange={(v) => setColumnMap({ ...columnMap, [f.label]: v === "__skip__" ? "" : v })}>
                      <SelectTrigger data-testid={`select-map-${f.label}`}><SelectValue placeholder="Skip" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">— Skip —</SelectItem>
                        {headers.map((h) => (<SelectItem key={h} value={h}>{h}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <Button className="w-full" onClick={() => setStep("preview")} data-testid="button-import-preview">
                Preview <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Preview (first 5 rows of {csvData.length})</p>
                <Button variant="outline" size="sm" onClick={() => setStep("map")} data-testid="button-import-back">Back to Mapping</Button>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    {Object.keys(columnMap).filter(k => columnMap[k]).map(k => (<TableHead key={k}>{k}</TableHead>))}
                  </TableRow></TableHeader>
                  <TableBody>
                    {previewData.map((row, i) => (
                      <TableRow key={i}>
                        {Object.keys(columnMap).filter(k => columnMap[k]).map(k => (<TableCell key={k}>{row[k] || "—"}</TableCell>))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button className="w-full" onClick={() => importMutation.mutate()} disabled={importMutation.isPending} data-testid="button-import-execute">
                {importMutation.isPending ? "Importing..." : `Import ${csvData.length} Records`}
              </Button>
            </div>
          )}

          {step === "result" && result && (
            <div className="space-y-4">
              <div className="flex flex-col items-center py-6">
                <CheckCircle2 className="h-12 w-12 text-green-600 mb-3" />
                <h3 className="text-lg font-semibold">Import Complete</h3>
                <p className="text-muted-foreground">{result.imported} of {result.total} records imported successfully</p>
              </div>
              {result.errors.length > 0 && (
                <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
                  <p className="font-medium text-red-800 dark:text-red-300 flex items-center gap-2 mb-2"><AlertCircle className="h-4 w-4" />{result.errors.length} errors:</p>
                  <ul className="text-sm text-red-700 dark:text-red-400 space-y-1 max-h-40 overflow-y-auto">
                    {result.errors.map((e, i) => (<li key={i}>{e}</li>))}
                  </ul>
                </div>
              )}
              <Button className="w-full" onClick={reset} data-testid="button-import-new">Import Another File</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function QuickStartTab() {
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: departments } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: workers } = useQuery<any[]>({ queryKey: ["/api/workers"] });
  const { data: jobs } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: policyGroups } = useQuery<any[]>({ queryKey: ["/api/policy-groups"] });
  const { data: payPeriods } = useQuery<any[]>({ queryKey: ["/api/pay-periods"] });
  const { data: rolesData } = useQuery<Role[]>({ queryKey: ["/api/roles"] });
  const [, setLocation] = useLocation();

  const steps = [
    { label: "Add Company Information", done: (companies?.length || 0) > 0, link: "/company?tab=info", icon: Building2 },
    { label: "Set Up Departments", done: (departments?.length || 0) > 0, link: "/company?tab=departments", icon: FolderKanban },
    { label: "Configure Jobs", done: (jobs?.length || 0) > 0, link: "/company?tab=jobs", icon: Briefcase },
    { label: "Add Employees", done: (workers?.length || 0) > 0, link: "/employees", icon: Users },
    { label: "Set Pay Policies", done: (policyGroups?.length || 0) > 0, link: "/policy", icon: Shield },
    { label: "Configure Pay Periods", done: (payPeriods?.length || 0) > 0, link: "/payroll?tab=pay-periods", icon: DollarSign },
    { label: "Configure Permission Groups", done: (rolesData?.length || 0) >= 5, link: "/company?tab=permissions", icon: Lock },
  ];

  const completed = steps.filter(s => s.done).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Rocket className="h-5 w-5" />Quick Start Checklist</CardTitle>
          <CardDescription>{completed} of {steps.length} steps completed</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full bg-muted rounded-full h-2 mb-6">
            <div className="bg-primary rounded-full h-2 transition-all" style={{ width: `${(completed / steps.length) * 100}%` }} />
          </div>
          <ul className="space-y-3">
            {steps.map((step, i) => (
              <li key={i} className="flex items-center justify-between gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setLocation(step.link)} data-testid={`quickstart-step-${i}`}>
                <div className="flex items-center gap-3">
                  {step.done ? <Check className="h-5 w-5 text-green-600 shrink-0" /> : <CircleDot className="h-5 w-5 text-muted-foreground shrink-0" />}
                  <step.icon className="h-4 w-4 text-muted-foreground" />
                  <span className={step.done ? "line-through text-muted-foreground" : ""}>{step.label}</span>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
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
        <TabsContent value="wage-groups"><SecondaryWageGroupsTab /></TabsContent>
        <TabsContent value="stations"><StationsTab /></TabsContent>
        <TabsContent value="permissions"><PermissionsTab /></TabsContent>
        <TabsContent value="currencies"><CurrenciesTab /></TabsContent>
        <TabsContent value="import"><ImportTab /></TabsContent>
        <TabsContent value="quickstart"><QuickStartTab /></TabsContent>
      </Tabs>
    </div>
  );
}
