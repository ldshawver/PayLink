import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type {
  Worker, Company, EmployeeContact, PayMethod,
  EmployeeTitle, EmployeeGroup, WageHistory, NewHireDefault,
  RemittanceSource, Branch, Department, PolicyGroup, PayPeriodSchedule,
  WorkerDocument, EmployeeWageGroup, SecondaryWageGroup
} from "@shared/schema";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Users, Plus, MoreHorizontal, Settings, DollarSign, CreditCard,
  Briefcase, UserPlus, Clock, Calendar, Building2,
  Pencil, Trash2, ChevronRight, Hash, Globe, Phone, Mail, MapPin, FileText,
  Upload, Download, ExternalLink, Shield, Eye, EyeOff, Scale, CheckCircle2,
  XCircle, AlertCircle, Info
} from "lucide-react";

function useTabParam(defaultTab: string): [string, (tab: string) => void] {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get("tab") || defaultTab;
  const setTab = (newTab: string) => {
    setLocation(`/app/employee?tab=${newTab}`);
  };
  return [tab, setTab];
}

function cleanFormData(data: Record<string, any>) {
  const cleaned = { ...data };
  Object.entries(cleaned).forEach(([k, v]) => {
    if (v === "") cleaned[k] = null;
  });
  return cleaned;
}

const WORKER_GROUP_LABELS: Record<string, string> = {
  hourly_employee: "Hourly Employee (W-2)",
  salaried_employee: "Salaried Employee (W-2)",
  hourly_contractor: "Hourly Contractor (1099)",
  invoiced_contractor: "Invoiced Contractor (1099)",
  shareholder_employee: "S-Corp Shareholder (W-2)",
  owner_distribution: "Owner Distribution (K-1)",
  volunteer: "Volunteer",
};

function getStatusBadgeVariant(status: string | null | undefined): "default" | "destructive" | "secondary" | "outline" {
  if (status === "active") return "default";
  if (status === "terminated") return "destructive";
  return "secondary";
}

function EmployeeTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editWorker, setEditWorker] = useState<Worker | null>(null);
  const [piiActionPending, setPiiActionPending] = useState<string | null>(null);

  const canPii = user?.role === "admin" || user?.role === "tenant_admin" || user?.role === "tenant_owner";

  async function handleExportPii(workerId: string, workerName: string) {
    setPiiActionPending(workerId);
    try {
      const res = await fetch(`/api/workers/${workerId}/data-export`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `pii-export-${workerName.replace(/\s+/g, "-")}.json`;
      a.click(); URL.revokeObjectURL(url);
      toast({ title: "PII exported", description: `${workerName}'s data downloaded.` });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally { setPiiActionPending(null); }
  }

  async function handleAnonymize(workerId: string, workerName: string) {
    if (!window.confirm(`Permanently anonymize all personal data for ${workerName}? This cannot be undone.`)) return;
    setPiiActionPending(workerId);
    try {
      await apiRequest("POST", `/api/workers/${workerId}/anonymize`);
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      toast({ title: "Worker anonymized", description: `${workerName}'s personal data has been removed.` });
    } catch {
      toast({ title: "Anonymization failed", variant: "destructive" });
    } finally { setPiiActionPending(null); }
  }

  const emptyForm = {
    firstName: "", middleName: "", lastName: "", email: "", phone: "",
    workerType: "employee" as "employee" | "contractor",
    contractorType: "hourly",
    workerGroup: "hourly_employee",
    jobTitle: "", department: "", payRate: "", payType: "hourly",
    hireDate: "", companyId: "",
    status: "active", gender: "unspecified", birthDate: "", terminationDate: "",
    country: "US", address: "", address2: "", city: "", state: "", zip: "",
    ssn: "", ethnicity: "", employeeNumber: "", pin: "",
    currency: "USD", workPhone: "", workPhoneExt: "", homePhone: "",
    mobilePhone: "", fax: "", workEmail: "", homeEmail: "",
    note: "", tags: "", isShareholder: false,
    defaultBranchId: "", defaultDepartmentId: "", policyGroupId: "",
    payPeriodScheduleId: "", groupId: "", titleId: "",
    emergencyContactName: "", emergencyContactRelationship: "",
    emergencyContactPhone: "", emergencyContactEmail: ""
  };

  const [form, setForm] = useState(emptyForm);

  const companiesQuery = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const workersQuery = useQuery<Worker[]>({
    queryKey: ["/api/workers", companyFilter],
    queryFn: async () => {
      const url = companyFilter !== "all" ? `/api/workers?companyId=${companyFilter}` : "/api/workers";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });
  const branchesQuery = useQuery<Branch[]>({ queryKey: ["/api/branches"] });
  const departmentsQuery = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const titlesQuery = useQuery<EmployeeTitle[]>({ queryKey: ["/api/employee-titles"] });
  const groupsQuery = useQuery<EmployeeGroup[]>({ queryKey: ["/api/employee-groups"] });
  const policyGroupsQuery = useQuery<PolicyGroup[]>({ queryKey: ["/api/policy-groups"] });
  const payPeriodSchedulesQuery = useQuery<PayPeriodSchedule[]>({ queryKey: ["/api/pay-period-schedules"] });

  async function saveEmergencyContact(workerId: string, data: typeof form) {
    if (!data.emergencyContactName) return;
    try {
      const res = await fetch(`/api/employee-contacts?workerId=${workerId}`);
      const existing: EmployeeContact[] = res.ok ? await res.json() : [];
      const primary = existing.find(c => c.isPrimary) || existing[0];
      const contactData = {
        workerId, contactType: "emergency", name: data.emergencyContactName,
        relationship: data.emergencyContactRelationship || null,
        phone: data.emergencyContactPhone || null,
        email: data.emergencyContactEmail || null, isPrimary: true
      };
      if (primary) {
        await apiRequest("PATCH", `/api/employee-contacts/${primary.id}`, contactData);
      } else {
        await apiRequest("POST", "/api/employee-contacts", contactData);
      }
    } catch {}
  }

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const { isShareholder, emergencyContactName, emergencyContactRelationship,
        emergencyContactPhone, emergencyContactEmail, ...rest } = data;
      const resp = await apiRequest("POST", "/api/workers", cleanFormData({ ...rest, isShareholder }));
      const newWorker = await resp.json();
      if (emergencyContactName && newWorker?.id) {
        await saveEmergencyContact(newWorker.id, data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employee-contacts"] });
      toast({ title: "Employee added successfully" });
      setAddOpen(false);
      resetForm();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof form> }) => {
      const { emergencyContactName, emergencyContactRelationship,
        emergencyContactPhone, emergencyContactEmail, ...rest } = data as typeof form;
      await apiRequest("PATCH", `/api/workers/${id}`, cleanFormData(rest as Record<string, any>));
      await saveEmergencyContact(id, data as typeof form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employee-contacts"] });
      toast({ title: "Employee updated successfully" });
      setEditOpen(false);
      setEditWorker(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  function resetForm() {
    setForm({ ...emptyForm });
  }

  async function openEdit(worker: Worker) {
    setEditWorker(worker);
    let ecName = "", ecRelationship = "", ecPhone = "", ecEmail = "";
    try {
      const res = await fetch(`/api/employee-contacts?workerId=${worker.id}`);
      if (res.ok) {
        const contacts: EmployeeContact[] = await res.json();
        const primary = contacts.find(c => c.isPrimary) || contacts[0];
        if (primary) {
          ecName = primary.name || "";
          ecRelationship = primary.relationship || "";
          ecPhone = primary.phone || "";
          ecEmail = primary.email || "";
        }
      }
    } catch {}
    setForm({
      firstName: worker.firstName,
      middleName: worker.middleName || "",
      lastName: worker.lastName,
      email: worker.email || "",
      phone: worker.phone || "",
      workerType: worker.workerType,
      contractorType: worker.contractorType || "hourly",
      workerGroup: (worker as any).workerGroup || "hourly_employee",
      jobTitle: worker.jobTitle || "",
      department: worker.department || "",
      payRate: worker.payRate || "0",
      payType: worker.payType || "hourly",
      hireDate: worker.hireDate || "",
      companyId: worker.companyId,
      status: worker.status || "active",
      gender: worker.gender || "unspecified",
      birthDate: worker.birthDate || "",
      terminationDate: worker.terminationDate || "",
      country: worker.country || "US",
      address: worker.address || "",
      address2: worker.address2 || "",
      city: worker.city || "",
      state: worker.state || "",
      zip: worker.zip || "",
      ssn: worker.ssn || "",
      ethnicity: worker.ethnicity || "",
      employeeNumber: worker.employeeNumber || "",
      pin: worker.pin || "",
      currency: worker.currency || "USD",
      workPhone: worker.workPhone || "",
      workPhoneExt: worker.workPhoneExt || "",
      homePhone: worker.homePhone || "",
      mobilePhone: worker.mobilePhone || "",
      fax: worker.fax || "",
      workEmail: worker.workEmail || "",
      homeEmail: worker.homeEmail || "",
      note: worker.note || "",
      tags: worker.tags || "",
      isShareholder: worker.isShareholder || false,
      defaultBranchId: worker.defaultBranchId || "",
      defaultDepartmentId: worker.defaultDepartmentId || "",
      policyGroupId: worker.policyGroupId || "",
      payPeriodScheduleId: worker.payPeriodScheduleId || "",
      groupId: worker.groupId || "",
      titleId: worker.titleId || "",
      emergencyContactName: ecName,
      emergencyContactRelationship: ecRelationship,
      emergencyContactPhone: ecPhone,
      emergencyContactEmail: ecEmail
    });
    setEditOpen(true);
  }

  const workers = workersQuery.data || [];
  const companies = companiesQuery.data || [];
  const branches = branchesQuery.data || [];
  const deptList = departmentsQuery.data || [];
  const titlesList = titlesQuery.data || [];
  const groupsList = groupsQuery.data || [];
  const policyGroupsList = policyGroupsQuery.data || [];
  const payPeriodSchedulesList = payPeriodSchedulesQuery.data || [];

  function renderForm(isEdit: boolean) {
    return (
      <div className="grid gap-6 py-4">
        <div className="space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
            <Briefcase className="h-4 w-4" /> Employment
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Company</Label>
              <Select value={form.companyId} onValueChange={v => setForm(f => ({ ...f, companyId: v }))}>
                <SelectTrigger data-testid="select-companyId"><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>
                  {companies.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive_temporary">Inactive (Temporary)</SelectItem>
                  <SelectItem value="leave_illness">Leave - Illness</SelectItem>
                  <SelectItem value="leave_maternity">Leave - Maternity</SelectItem>
                  <SelectItem value="leave_other">Leave - Other</SelectItem>
                  <SelectItem value="terminated">Terminated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Worker Group</Label>
              <Select value={form.workerGroup || "hourly_employee"} onValueChange={v => {
                const isContractor = v === "hourly_contractor" || v === "invoiced_contractor";
                const wType = isContractor ? "contractor" as const : "employee" as const;
                const cType = v === "invoiced_contractor" ? "invoice" : "hourly";
                setForm(f => ({ ...f, workerGroup: v, workerType: wType, contractorType: cType }));
              }}>
                <SelectTrigger data-testid="select-workerGroup"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly_employee">Hourly Employee (W-2)</SelectItem>
                  <SelectItem value="salaried_employee">Salaried Employee (W-2)</SelectItem>
                  <SelectItem value="hourly_contractor">Hourly Contractor (1099)</SelectItem>
                  <SelectItem value="invoiced_contractor">Invoiced Contractor (1099)</SelectItem>
                  <SelectItem value="shareholder_employee">Shareholder-Employee (S-Corp W-2)</SelectItem>
                  <SelectItem value="owner_distribution">Owner Distribution (K-1)</SelectItem>
                  <SelectItem value="volunteer">Volunteer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Employee Number</Label>
              <Input data-testid="input-employeeNumber" value={form.employeeNumber}
                onChange={e => setForm(f => ({ ...f, employeeNumber: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>PIN (Time Clock)</Label>
              <Input data-testid="input-pin" type="password" placeholder="4-digit PIN" value={form.pin}
                onChange={e => setForm(f => ({ ...f, pin: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Hire Date</Label>
              <Input data-testid="input-hireDate" type="date" value={form.hireDate}
                onChange={e => setForm(f => ({ ...f, hireDate: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Termination Date</Label>
              <Input data-testid="input-terminationDate" type="date" value={form.terminationDate}
                onChange={e => setForm(f => ({ ...f, terminationDate: e.target.value }))} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox data-testid="checkbox-isShareholder" checked={form.isShareholder}
              onCheckedChange={v => setForm(f => ({ ...f, isShareholder: !!v }))} />
            <Label>Shareholder</Label>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
            <Users className="h-4 w-4" /> Identity
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>First Name</Label>
              <Input data-testid="input-firstName" value={form.firstName}
                onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Middle Name</Label>
              <Input data-testid="input-middleName" value={form.middleName}
                onChange={e => setForm(f => ({ ...f, middleName: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Last Name</Label>
              <Input data-testid="input-lastName" value={form.lastName}
                onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Gender</Label>
              <Select value={form.gender} onValueChange={v => setForm(f => ({ ...f, gender: v }))}>
                <SelectTrigger data-testid="select-gender"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unspecified">Unspecified</SelectItem>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Birth Date</Label>
              <Input data-testid="input-birthDate" type="date" value={form.birthDate}
                onChange={e => setForm(f => ({ ...f, birthDate: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>SSN</Label>
              <Input data-testid="input-ssn" value={form.ssn}
                onChange={e => setForm(f => ({ ...f, ssn: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Ethnicity</Label>
              <Input data-testid="input-ethnicity" value={form.ethnicity}
                onChange={e => setForm(f => ({ ...f, ethnicity: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Select value={form.titleId} onValueChange={v => setForm(f => ({ ...f, titleId: v }))}>
                <SelectTrigger data-testid="select-titleId"><SelectValue placeholder="Select title" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {titlesList.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Group</Label>
              <Select value={form.groupId} onValueChange={v => setForm(f => ({ ...f, groupId: v }))}>
                <SelectTrigger data-testid="select-groupId"><SelectValue placeholder="Select group" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {groupsList.map(g => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Job Title <span className="text-xs text-muted-foreground font-normal">(displayed on schedule)</span></Label>
            <Input data-testid="input-jobTitle" value={form.jobTitle}
              onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))}
              placeholder="e.g. Handyman, Senior Developer" />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
            <Mail className="h-4 w-4" /> Contact
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Work Email</Label>
              <Input data-testid="input-workEmail" type="email" value={form.workEmail}
                onChange={e => setForm(f => ({ ...f, workEmail: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Home Email</Label>
              <Input data-testid="input-homeEmail" type="email" value={form.homeEmail}
                onChange={e => setForm(f => ({ ...f, homeEmail: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-2 col-span-2">
              <Label>Work Phone</Label>
              <Input data-testid="input-workPhone" value={form.workPhone}
                onChange={e => setForm(f => ({ ...f, workPhone: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Ext</Label>
              <Input data-testid="input-workPhoneExt" value={form.workPhoneExt}
                onChange={e => setForm(f => ({ ...f, workPhoneExt: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Home Phone</Label>
              <Input data-testid="input-homePhone" value={form.homePhone}
                onChange={e => setForm(f => ({ ...f, homePhone: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Mobile Phone</Label>
              <Input data-testid="input-mobilePhone" value={form.mobilePhone}
                onChange={e => setForm(f => ({ ...f, mobilePhone: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Fax</Label>
              <Input data-testid="input-fax" value={form.fax}
                onChange={e => setForm(f => ({ ...f, fax: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Address</Label>
              <Input data-testid="input-address" value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Address 2</Label>
              <Input data-testid="input-address2" value={form.address2}
                onChange={e => setForm(f => ({ ...f, address2: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>City</Label>
              <Input data-testid="input-city" value={form.city}
                onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>State</Label>
              <Input data-testid="input-state" value={form.state}
                onChange={e => setForm(f => ({ ...f, state: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>ZIP</Label>
              <Input data-testid="input-zip" value={form.zip}
                onChange={e => setForm(f => ({ ...f, zip: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Country</Label>
            <Input data-testid="input-country" value={form.country}
              onChange={e => setForm(f => ({ ...f, country: e.target.value }))} />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
            <DollarSign className="h-4 w-4" /> Payroll
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Pay Rate</Label>
              <Input data-testid="input-payRate" type="number" value={form.payRate}
                onChange={e => setForm(f => ({ ...f, payRate: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Pay Type</Label>
              <Select value={form.payType} onValueChange={v => setForm(f => ({ ...f, payType: v }))}>
                <SelectTrigger data-testid="select-payType"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="salary">Salary</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger data-testid="select-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="CAD">CAD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="AUD">AUD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Branch</Label>
              <Select value={form.defaultBranchId} onValueChange={v => setForm(f => ({ ...f, defaultBranchId: v }))}>
                <SelectTrigger data-testid="select-defaultBranchId"><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {branches.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Department</Label>
              <Select value={form.defaultDepartmentId} onValueChange={v => setForm(f => ({ ...f, defaultDepartmentId: v }))}>
                <SelectTrigger data-testid="select-defaultDepartmentId"><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {deptList.map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Policy Group</Label>
              <Select value={form.policyGroupId} onValueChange={v => setForm(f => ({ ...f, policyGroupId: v }))}>
                <SelectTrigger data-testid="select-policyGroupId"><SelectValue placeholder="Select policy group" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {policyGroupsList.map(pg => (
                    <SelectItem key={pg.id} value={pg.id}>{pg.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Pay Period Schedule</Label>
            <Select value={form.payPeriodScheduleId} onValueChange={v => setForm(f => ({ ...f, payPeriodScheduleId: v }))}>
              <SelectTrigger data-testid="select-payPeriodScheduleId"><SelectValue placeholder="Select schedule" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {payPeriodSchedulesList.map(ps => (
                  <SelectItem key={ps.id} value={ps.id}>{ps.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
            <UserPlus className="h-4 w-4" /> Emergency Contact
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Contact Name</Label>
              <Input data-testid="input-emergencyContactName" value={form.emergencyContactName}
                onChange={e => setForm(f => ({ ...f, emergencyContactName: e.target.value }))}
                placeholder="Full name" />
            </div>
            <div className="space-y-2">
              <Label>Relationship</Label>
              <Input data-testid="input-emergencyContactRelationship" value={form.emergencyContactRelationship}
                onChange={e => setForm(f => ({ ...f, emergencyContactRelationship: e.target.value }))}
                placeholder="e.g. Spouse, Parent" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input data-testid="input-emergencyContactPhone" value={form.emergencyContactPhone}
                onChange={e => setForm(f => ({ ...f, emergencyContactPhone: e.target.value }))}
                placeholder="Phone number" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input data-testid="input-emergencyContactEmail" type="email" value={form.emergencyContactEmail}
                onChange={e => setForm(f => ({ ...f, emergencyContactEmail: e.target.value }))}
                placeholder="Email address" />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
            <FileText className="h-4 w-4" /> Notes
          </h3>
          <div className="space-y-2">
            <Label>Note</Label>
            <Textarea data-testid="input-note" value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Tags</Label>
            <Input data-testid="input-tags" value={form.tags}
              onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} />
          </div>
        </div>

        <Button data-testid={isEdit ? "button-update-employee" : "button-submit-employee"}
          onClick={() => {
            const submitData = { ...form };
            if (submitData.titleId === "none") submitData.titleId = "";
            if (submitData.groupId === "none") submitData.groupId = "";
            if (submitData.defaultBranchId === "none") submitData.defaultBranchId = "";
            if (submitData.defaultDepartmentId === "none") submitData.defaultDepartmentId = "";
            if (submitData.policyGroupId === "none") submitData.policyGroupId = "";
            if (submitData.payPeriodScheduleId === "none") submitData.payPeriodScheduleId = "";
            if (isEdit && editWorker) {
              updateMutation.mutate({ id: editWorker.id, data: submitData });
            } else {
              createMutation.mutate(submitData);
            }
          }}
          disabled={createMutation.isPending || updateMutation.isPending}>
          {isEdit ? "Update Employee" : "Add Employee"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger data-testid="select-company-filter" className="w-[200px]">
              <SelectValue placeholder="Filter by company" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Dialog open={addOpen} onOpenChange={v => { setAddOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-employee"><Plus className="mr-2 h-4 w-4" />Add Employee</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Employee</DialogTitle></DialogHeader>
            {renderForm(false)}
          </DialogContent>
        </Dialog>
      </div>

      {workersQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Employee #</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Job Title</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Pay Rate</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No employees found
                    </TableCell>
                  </TableRow>
                ) : workers.map(w => (
                  <TableRow key={w.id} data-testid={`row-worker-${w.id}`}>
                    <TableCell data-testid={`text-worker-name-${w.id}`}>{w.firstName} {w.lastName}</TableCell>
                    <TableCell>{w.employeeNumber || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(w.status)} className="text-xs"
                        data-testid={`badge-status-${w.id}`}>
                        {w.status || "active"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs" data-testid={`badge-type-${w.id}`}>
                        {WORKER_GROUP_LABELS[(w as any).workerGroup] || (w.workerType === "employee" ? "Hourly Employee" : "Hourly Contractor")}
                      </Badge>
                    </TableCell>
                    <TableCell>{w.jobTitle || "—"}</TableCell>
                    <TableCell>{w.department || "—"}</TableCell>
                    <TableCell>${w.payRate}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-menu-${w.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem data-testid={`button-edit-${w.id}`} onClick={() => openEdit(w)}>
                            <Pencil className="mr-2 h-4 w-4" /> Edit
                          </DropdownMenuItem>
                          {canPii && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                data-testid={`button-export-pii-${w.id}`}
                                disabled={piiActionPending === w.id}
                                onClick={() => handleExportPii(w.id, `${w.firstName} ${w.lastName}`)}
                              >
                                <Download className="mr-2 h-4 w-4" /> Export PII (GDPR)
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                data-testid={`button-anonymize-${w.id}`}
                                disabled={piiActionPending === w.id}
                                className="text-red-600 focus:text-red-600"
                                onClick={() => handleAnonymize(w.id, `${w.firstName} ${w.lastName}`)}
                              >
                                <Shield className="mr-2 h-4 w-4" /> Anonymize Worker
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={editOpen} onOpenChange={v => { setEditOpen(v); if (!v) { setEditWorker(null); resetForm(); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Employee</DialogTitle></DialogHeader>
          {renderForm(true)}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmployeeContactsTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    workerId: "", contactType: "emergency", name: "", relationship: "",
    phone: "", email: "", isPrimary: false
  });

  const contactsQuery = useQuery<EmployeeContact[]>({ queryKey: ["/api/employee-contacts"] });
  const workersQuery = useQuery<Worker[]>({ queryKey: ["/api/workers"] });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/employee-contacts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-contacts"] });
      toast({ title: "Contact added successfully" });
      setAddOpen(false);
      setForm({ workerId: "", contactType: "emergency", name: "", relationship: "", phone: "", email: "", isPrimary: false });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const contacts = contactsQuery.data || [];
  const workers = workersQuery.data || [];
  const workerMap = new Map(workers.map(w => [w.id, `${w.firstName} ${w.lastName}`]));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-contact"><Plus className="mr-2 h-4 w-4" />Add Contact</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Add Employee Contact</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Employee</Label>
                <Select value={form.workerId} onValueChange={v => setForm(f => ({ ...f, workerId: v }))}>
                  <SelectTrigger data-testid="select-contact-workerId"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {workers.map(w => (
                      <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Contact Type</Label>
                  <Select value={form.contactType} onValueChange={v => setForm(f => ({ ...f, contactType: v }))}>
                    <SelectTrigger data-testid="select-contactType"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="emergency">Emergency</SelectItem>
                      <SelectItem value="personal">Personal</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input data-testid="input-contact-name" value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Relationship</Label>
                  <Input data-testid="input-contact-relationship" value={form.relationship}
                    onChange={e => setForm(f => ({ ...f, relationship: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input data-testid="input-contact-phone" value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input data-testid="input-contact-email" type="email" value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox data-testid="checkbox-isPrimary" checked={form.isPrimary}
                  onCheckedChange={v => setForm(f => ({ ...f, isPrimary: !!v }))} />
                <Label>Primary Contact</Label>
              </div>
              <Button data-testid="button-submit-contact" onClick={() => createMutation.mutate(form)}
                disabled={createMutation.isPending}>
                Add Contact
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {contactsQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Contact Name</TableHead>
                  <TableHead>Relationship</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Primary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No contacts found
                    </TableCell>
                  </TableRow>
                ) : contacts.map(c => (
                  <TableRow key={c.id} data-testid={`row-contact-${c.id}`}>
                    <TableCell>{workerMap.get(c.workerId) || c.workerId}</TableCell>
                    <TableCell data-testid={`text-contact-name-${c.id}`}>{c.name}</TableCell>
                    <TableCell>{c.relationship || "—"}</TableCell>
                    <TableCell>{c.phone || "—"}</TableCell>
                    <TableCell>{c.email || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{c.contactType}</Badge>
                    </TableCell>
                    <TableCell>
                      {c.isPrimary ? <Badge className="text-xs">Primary</Badge> : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PreferencesTab() {
  const { toast } = useToast();
  const workersQuery = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const workers = workersQuery.data || [];
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [prefData, setPrefData] = useState({
    language: "English", dateFormat: "MM/DD/YYYY", timeFormat: "12-hour", timezone: "America/New_York"
  });
  const [noteText, setNoteText] = useState("");

  const selectedWorker = workers.find(w => w.id === selectedWorkerId);

  function loadWorkerPrefs(worker: Worker) {
    setNoteText(worker.preferences || "");
    try {
      const parsed = JSON.parse(worker.preferences || "{}");
      setPrefData({
        language: parsed.language || "English",
        dateFormat: parsed.dateFormat || "MM/DD/YYYY",
        timeFormat: parsed.timeFormat || "12-hour",
        timezone: parsed.timezone || "America/New_York"
      });
    } catch {
      setPrefData({ language: "English", dateFormat: "MM/DD/YYYY", timeFormat: "12-hour", timezone: "America/New_York" });
    }
  }

  const updateMutation = useMutation({
    mutationFn: async () => {
      const prefsJson = JSON.stringify(prefData);
      await apiRequest("PATCH", `/api/workers/${selectedWorkerId}`, { preferences: prefsJson });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      toast({ title: "Preferences saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Preferences
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Select Employee</Label>
          <Select value={selectedWorkerId} onValueChange={v => {
            setSelectedWorkerId(v);
            const w = workers.find(w => w.id === v);
            if (w) loadWorkerPrefs(w);
          }}>
            <SelectTrigger data-testid="select-pref-worker"><SelectValue placeholder="Select employee" /></SelectTrigger>
            <SelectContent>
              {workers.map(w => (
                <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedWorker && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Language</Label>
                <Select value={prefData.language} onValueChange={v => setPrefData(p => ({ ...p, language: v }))}>
                  <SelectTrigger data-testid="select-pref-language"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="English">English</SelectItem>
                    <SelectItem value="French">French</SelectItem>
                    <SelectItem value="Spanish">Spanish</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Date Format</Label>
                <Select value={prefData.dateFormat} onValueChange={v => setPrefData(p => ({ ...p, dateFormat: v }))}>
                  <SelectTrigger data-testid="select-pref-dateFormat"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                    <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                    <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Time Format</Label>
                <Select value={prefData.timeFormat} onValueChange={v => setPrefData(p => ({ ...p, timeFormat: v }))}>
                  <SelectTrigger data-testid="select-pref-timeFormat"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="12-hour">12-hour</SelectItem>
                    <SelectItem value="24-hour">24-hour</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Timezone</Label>
                <Select value={prefData.timezone} onValueChange={v => setPrefData(p => ({ ...p, timezone: v }))}>
                  <SelectTrigger data-testid="select-pref-timezone"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="America/New_York">Eastern (New York)</SelectItem>
                    <SelectItem value="America/Chicago">Central (Chicago)</SelectItem>
                    <SelectItem value="America/Denver">Mountain (Denver)</SelectItem>
                    <SelectItem value="America/Los_Angeles">Pacific (Los Angeles)</SelectItem>
                    <SelectItem value="America/Anchorage">Alaska (Anchorage)</SelectItem>
                    <SelectItem value="Pacific/Honolulu">Hawaii (Honolulu)</SelectItem>
                    <SelectItem value="America/Toronto">Eastern (Toronto)</SelectItem>
                    <SelectItem value="America/Vancouver">Pacific (Vancouver)</SelectItem>
                    <SelectItem value="America/Edmonton">Mountain (Edmonton)</SelectItem>
                    <SelectItem value="America/Winnipeg">Central (Winnipeg)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button data-testid="button-save-preferences" onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save Preferences"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DocumentsTab() {
  const { toast } = useToast();
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [workerFilter, setWorkerFilter] = useState<string>("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [docName, setDocName] = useState("");
  const [docType, setDocType] = useState("Other");
  const [docNotes, setDocNotes] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const companiesQuery = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const workersQuery = useQuery<Worker[]>({
    queryKey: ["/api/workers", companyFilter],
    queryFn: async () => {
      const url = companyFilter !== "all" ? `/api/workers?companyId=${companyFilter}` : "/api/workers";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });
  const documentsQuery = useQuery<WorkerDocument[]>({
    queryKey: ["/api/worker-documents", `?workerId=${workerFilter}`],
    enabled: !!workerFilter,
  });

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch("/api/worker-documents", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-documents"] });
      toast({ title: "Document uploaded successfully" });
      setUploadOpen(false);
      resetUploadForm();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/worker-documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-documents"] });
      toast({ title: "Document deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function resetUploadForm() {
    setDocName("");
    setDocType("Other");
    setDocNotes("");
    setSelectedFile(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    setSelectedFile(file);
    if (file && !docName) {
      setDocName(file.name.replace(/\.[^/.]+$/, ""));
    }
  }

  function handleUpload() {
    if (!selectedFile || !workerFilter || !docName) return;
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("workerId", workerFilter);
    formData.append("name", docName);
    formData.append("documentType", docType);
    if (docNotes) formData.append("notes", docNotes);
    uploadMutation.mutate(formData);
  }

  const companies = companiesQuery.data || [];
  const workers = workersQuery.data || [];
  const documents = documentsQuery.data || [];

  const documentTypeOptions = [
    "W-4 Tax Withholding",
    "W-9 Taxpayer ID (Contractor)",
    "I-9 Employment Eligibility",
    "DE 4 (CA Withholding)",
    "Photo ID",
    "Tax Forms",
    "Employment Agreement",
    "Contractor Agreement",
    "Other",
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          <Select value={companyFilter} onValueChange={v => { setCompanyFilter(v); setWorkerFilter(""); }}>
            <SelectTrigger data-testid="select-doc-company-filter" className="w-[200px]">
              <SelectValue placeholder="Filter by company" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={workerFilter} onValueChange={setWorkerFilter}>
            <SelectTrigger data-testid="select-doc-worker-filter" className="w-[200px]">
              <SelectValue placeholder="Select employee" />
            </SelectTrigger>
            <SelectContent>
              {workers.map(w => (
                <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Dialog open={uploadOpen} onOpenChange={v => { setUploadOpen(v); if (!v) resetUploadForm(); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-upload-document" disabled={!workerFilter}>
              <Upload className="mr-2 h-4 w-4" />Upload Document
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>File</Label>
                <Input
                  data-testid="input-doc-file"
                  type="file"
                  accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx"
                  onChange={handleFileChange}
                />
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  data-testid="input-doc-name"
                  value={docName}
                  onChange={e => setDocName(e.target.value)}
                  placeholder="Document name"
                />
              </div>
              <div className="space-y-2">
                <Label>Document Type</Label>
                <Select value={docType} onValueChange={setDocType}>
                  <SelectTrigger data-testid="select-doc-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {documentTypeOptions.map(opt => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea
                  data-testid="input-doc-notes"
                  value={docNotes}
                  onChange={e => setDocNotes(e.target.value)}
                  placeholder="Additional notes"
                />
              </div>
              <Button
                data-testid="button-submit-document"
                onClick={handleUpload}
                disabled={uploadMutation.isPending || !selectedFile || !docName}
              >
                {uploadMutation.isPending ? "Uploading..." : "Upload"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />Official Government Forms
          </CardTitle>
          <p className="text-xs text-muted-foreground">Download official blank forms from IRS, USCIS, and California EDD. Print, complete, and upload the signed copies above.</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <a href="https://www.irs.gov/pub/irs-pdf/fw4.pdf" target="_blank" rel="noopener noreferrer" data-testid="link-form-w4" className="flex items-center gap-3 p-3 border rounded-lg hover:bg-accent/50 transition-colors">
              <div className="flex-shrink-0 w-10 h-10 rounded-md bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm flex items-center gap-1">Form W-4 <ExternalLink className="h-3 w-3" /></div>
                <p className="text-xs text-muted-foreground">Federal tax withholding — IRS</p>
              </div>
            </a>
            <a href="https://edd.ca.gov/siteassets/files/pdf_pub_ctr/de4.pdf" target="_blank" rel="noopener noreferrer" data-testid="link-form-de4" className="flex items-center gap-3 p-3 border rounded-lg hover:bg-accent/50 transition-colors">
              <div className="flex-shrink-0 w-10 h-10 rounded-md bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <FileText className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm flex items-center gap-1">Form DE-4 <ExternalLink className="h-3 w-3" /></div>
                <p className="text-xs text-muted-foreground">CA state tax withholding — EDD</p>
              </div>
            </a>
            <a href="https://www.uscis.gov/sites/default/files/document/forms/i-9-paper-version.pdf" target="_blank" rel="noopener noreferrer" data-testid="link-form-i9" className="flex items-center gap-3 p-3 border rounded-lg hover:bg-accent/50 transition-colors">
              <div className="flex-shrink-0 w-10 h-10 rounded-md bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <FileText className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm flex items-center gap-1">Form I-9 <ExternalLink className="h-3 w-3" /></div>
                <p className="text-xs text-muted-foreground">Employment eligibility — USCIS</p>
              </div>
            </a>
            <a href="https://www.irs.gov/pub/irs-pdf/fw9.pdf" target="_blank" rel="noopener noreferrer" data-testid="link-form-w9" className="flex items-center gap-3 p-3 border rounded-lg hover:bg-accent/50 transition-colors">
              <div className="flex-shrink-0 w-10 h-10 rounded-md bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm flex items-center gap-1">Form W-9 <ExternalLink className="h-3 w-3" /></div>
                <p className="text-xs text-muted-foreground">Taxpayer ID request — IRS (contractors)</p>
              </div>
            </a>
          </div>
        </CardContent>
      </Card>

      {!workerFilter ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Select an employee to view their documents
          </CardContent>
        </Card>
      ) : documentsQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Upload Date</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No documents found
                    </TableCell>
                  </TableRow>
                ) : documents.map(doc => (
                  <TableRow key={doc.id} data-testid={`row-document-${doc.id}`}>
                    <TableCell data-testid={`text-doc-name-${doc.id}`}>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        {doc.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{doc.documentType || "Other"}</Badge>
                    </TableCell>
                    <TableCell data-testid={`text-doc-date-${doc.id}`}>
                      {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell>{doc.notes || "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          data-testid={`button-download-doc-${doc.id}`}
                          onClick={() => window.open(doc.fileUrl, "_blank")}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          data-testid={`button-delete-doc-${doc.id}`}
                          onClick={() => {
                            if (confirm("Delete this document?")) deleteMutation.mutate(doc.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function WagesTab() {
  const { toast } = useToast();
  const [workerFilter, setWorkerFilter] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<WageHistory | null>(null);

  const emptyWageForm = {
    workerId: "", companyId: "", wageType: "hourly", wage: "",
    effectiveDate: "", averageHoursPerWeek: "40", laborBurdenPercent: "0", note: ""
  };
  const [form, setForm] = useState(emptyWageForm);

  const wageHistoryQuery = useQuery<WageHistory[]>({ queryKey: ["/api/wage-history"] });
  const workersQuery = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const companiesQuery = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/wage-history", cleanFormData(data as Record<string, any>));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wage-history"] });
      toast({ title: "Wage entry added" });
      setAddOpen(false);
      setForm({ ...emptyWageForm });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof form }) => {
      await apiRequest("PATCH", `/api/wage-history/${id}`, cleanFormData(data as Record<string, any>));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wage-history"] });
      toast({ title: "Wage entry updated" });
      setEditOpen(false);
      setEditEntry(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/wage-history/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wage-history"] });
      toast({ title: "Wage entry deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const wages = wageHistoryQuery.data || [];
  const workers = workersQuery.data || [];
  const companies = companiesQuery.data || [];
  const workerMap = new Map(workers.map(w => [w.id, `${w.firstName} ${w.lastName}`]));
  const filteredWages = workerFilter === "all" ? wages : wages.filter(w => w.workerId === workerFilter);

  function openEditWage(entry: WageHistory) {
    setEditEntry(entry);
    setForm({
      workerId: entry.workerId,
      companyId: entry.companyId,
      wageType: entry.wageType || "hourly",
      wage: entry.wage || "0",
      effectiveDate: entry.effectiveDate || "",
      averageHoursPerWeek: entry.averageHoursPerWeek || "40",
      laborBurdenPercent: entry.laborBurdenPercent || "0",
      note: entry.note || ""
    });
    setEditOpen(true);
  }

  function renderWageForm(isEdit: boolean) {
    return (
      <div className="grid gap-4 py-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Employee</Label>
            <Select value={form.workerId} onValueChange={v => setForm(f => ({ ...f, workerId: v }))}>
              <SelectTrigger data-testid="select-wage-workerId"><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {workers.map(w => (
                  <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Company</Label>
            <Select value={form.companyId} onValueChange={v => setForm(f => ({ ...f, companyId: v }))}>
              <SelectTrigger data-testid="select-wage-companyId"><SelectValue placeholder="Select company" /></SelectTrigger>
              <SelectContent>
                {companies.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Wage Type</Label>
            <Select value={form.wageType} onValueChange={v => setForm(f => ({ ...f, wageType: v }))}>
              <SelectTrigger data-testid="select-wageType"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="salary">Salary</SelectItem>
                <SelectItem value="commission">Commission</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Wage Amount</Label>
            <Input data-testid="input-wage" type="number" value={form.wage}
              onChange={e => setForm(f => ({ ...f, wage: e.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Effective Date</Label>
            <Input data-testid="input-wage-effectiveDate" type="date" value={form.effectiveDate}
              onChange={e => setForm(f => ({ ...f, effectiveDate: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Avg Hours/Week</Label>
            <Input data-testid="input-averageHoursPerWeek" type="number" value={form.averageHoursPerWeek}
              onChange={e => setForm(f => ({ ...f, averageHoursPerWeek: e.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Labor Burden %</Label>
            <Input data-testid="input-laborBurdenPercent" type="number" value={form.laborBurdenPercent}
              onChange={e => setForm(f => ({ ...f, laborBurdenPercent: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Note</Label>
            <Input data-testid="input-wage-note" value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
          </div>
        </div>
        <Button data-testid={isEdit ? "button-update-wage" : "button-submit-wage"}
          onClick={() => {
            if (isEdit && editEntry) {
              updateMutation.mutate({ id: editEntry.id, data: form });
            } else {
              createMutation.mutate(form);
            }
          }}
          disabled={createMutation.isPending || updateMutation.isPending}>
          {isEdit ? "Update Wage Entry" : "Add Wage Entry"}
        </Button>
      </div>
    );
  }

  if (wageHistoryQuery.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Select value={workerFilter} onValueChange={setWorkerFilter}>
          <SelectTrigger data-testid="select-wage-filter" className="w-[200px]">
            <SelectValue placeholder="Filter by employee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Employees</SelectItem>
            {workers.map(w => (
              <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Dialog open={addOpen} onOpenChange={v => { setAddOpen(v); if (!v) setForm({ ...emptyWageForm }); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-wage"><Plus className="mr-2 h-4 w-4" />Add Wage Entry</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Wage Entry</DialogTitle></DialogHeader>
            {renderWageForm(false)}
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Wage Type</TableHead>
                <TableHead>Wage Amount</TableHead>
                <TableHead>Effective Date</TableHead>
                <TableHead>Avg Hrs/Wk</TableHead>
                <TableHead>Labor Burden %</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredWages.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No wage entries found
                  </TableCell>
                </TableRow>
              ) : filteredWages.map(wh => (
                <TableRow key={wh.id} data-testid={`row-wage-${wh.id}`}>
                  <TableCell data-testid={`text-wage-name-${wh.id}`}>{workerMap.get(wh.workerId) || wh.workerId}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">{wh.wageType}</Badge>
                  </TableCell>
                  <TableCell>${wh.wage}</TableCell>
                  <TableCell>{wh.effectiveDate || "—"}</TableCell>
                  <TableCell>{wh.averageHoursPerWeek || "40"}</TableCell>
                  <TableCell>{wh.laborBurdenPercent || "0"}%</TableCell>
                  <TableCell>{wh.note || "—"}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-wage-menu-${wh.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem data-testid={`button-edit-wage-${wh.id}`} onClick={() => openEditWage(wh)}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem data-testid={`button-delete-wage-${wh.id}`}
                          className="text-destructive" onClick={() => {
                            if (confirm("Delete this wage entry?")) deleteMutation.mutate(wh.id);
                          }}>
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={v => { setEditOpen(v); if (!v) { setEditEntry(null); setForm({ ...emptyWageForm }); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Wage Entry</DialogTitle></DialogHeader>
          {renderWageForm(true)}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const BLANK_PAY_METHOD_FORM = {
  workerId: "", methodType: "direct_deposit", bankName: "",
  accountType: "checking", routingNumber: "", accountNumber: "", isPrimary: false,
  remittanceSourceId: "", priority: "1", amountType: "remainder", amountValue: "",
  platform: "", handle: "", isActive: true,
};

function PayMethodForm({ form, setForm, workers, remittanceSources, testPrefix = "" }: {
  form: typeof BLANK_PAY_METHOD_FORM;
  setForm: (fn: (f: typeof BLANK_PAY_METHOD_FORM) => typeof BLANK_PAY_METHOD_FORM) => void;
  workers: Worker[];
  remittanceSources: RemittanceSource[];
  testPrefix?: string;
}) {
  return (
    <div className="grid gap-4 py-4">
      <div className="space-y-2">
        <Label>Employee</Label>
        <Select value={form.workerId} onValueChange={v => setForm(f => ({ ...f, workerId: v }))}>
          <SelectTrigger data-testid={`${testPrefix}select-paymethod-workerId`}><SelectValue placeholder="Select employee" /></SelectTrigger>
          <SelectContent>
            {workers.map(w => (
              <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Method Type</Label>
          <Select value={form.methodType} onValueChange={v => setForm(f => ({ ...f, methodType: v }))}>
            <SelectTrigger data-testid={`${testPrefix}select-methodType`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="direct_deposit">Direct Deposit</SelectItem>
              <SelectItem value="check">Check</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Bank Name</Label>
          <Input data-testid={`${testPrefix}input-bankName`} value={form.bankName}
            onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Account Type</Label>
          <Select value={form.accountType} onValueChange={v => setForm(f => ({ ...f, accountType: v }))}>
            <SelectTrigger data-testid={`${testPrefix}select-accountType`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="checking">Checking</SelectItem>
              <SelectItem value="savings">Savings</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Routing Number</Label>
          <Input data-testid={`${testPrefix}input-routingNumber`} value={form.routingNumber}
            onChange={e => setForm(f => ({ ...f, routingNumber: e.target.value }))} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Account Number</Label>
        <Input data-testid={`${testPrefix}input-accountNumber`} value={form.accountNumber}
          onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Digital Platform (Optional)</Label>
          <Select value={form.platform || "none"} onValueChange={v => setForm(f => ({ ...f, platform: v === "none" ? "" : v }))}>
            <SelectTrigger data-testid={`${testPrefix}select-platform`}><SelectValue placeholder="Select platform" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="apple_pay">Apple Pay</SelectItem>
              <SelectItem value="cash_app">Cash App</SelectItem>
              <SelectItem value="paypal">PayPal</SelectItem>
              <SelectItem value="venmo">Venmo</SelectItem>
              <SelectItem value="zelle">Zelle</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {form.platform && form.platform !== "" && (
          <div className="space-y-2">
            <Label>Account Handle / Email / Phone</Label>
            <Input data-testid={`${testPrefix}input-handle`} value={form.handle} placeholder="@username or email"
              onChange={e => setForm(f => ({ ...f, handle: e.target.value }))} />
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Remittance Source</Label>
          <Select value={form.remittanceSourceId || "none"} onValueChange={v => setForm(f => ({ ...f, remittanceSourceId: v === "none" ? "" : v }))}>
            <SelectTrigger data-testid={`${testPrefix}select-remittanceSourceId`}><SelectValue placeholder="Select source" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {remittanceSources.map(rs => (
                <SelectItem key={rs.id} value={rs.id}>{rs.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Priority</Label>
          <Input data-testid={`${testPrefix}input-priority`} type="number" value={form.priority}
            onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Amount Type</Label>
          <Select value={form.amountType} onValueChange={v => setForm(f => ({ ...f, amountType: v }))}>
            <SelectTrigger data-testid={`${testPrefix}select-amountType`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="remainder">Remainder</SelectItem>
              <SelectItem value="percent_net">Percent of Net</SelectItem>
              <SelectItem value="percent_gross">Percent of Gross</SelectItem>
              <SelectItem value="fixed">Fixed Amount</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {form.amountType !== "remainder" && (
          <div className="space-y-2">
            <Label>Amount Value</Label>
            <Input data-testid={`${testPrefix}input-amountValue`} type="number" value={form.amountValue}
              onChange={e => setForm(f => ({ ...f, amountValue: e.target.value }))} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Checkbox data-testid={`${testPrefix}checkbox-paymethod-isPrimary`} checked={form.isPrimary}
            onCheckedChange={v => setForm(f => ({ ...f, isPrimary: !!v }))} />
          <Label>Primary Method</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox data-testid={`${testPrefix}checkbox-paymethod-isActive`} checked={form.isActive}
            onCheckedChange={v => setForm(f => ({ ...f, isActive: !!v }))} />
          <Label>Active</Label>
        </div>
      </div>
    </div>
  );
}

function PayMethodsTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<typeof BLANK_PAY_METHOD_FORM>({ ...BLANK_PAY_METHOD_FORM });
  const [editForm, setEditForm] = useState<typeof BLANK_PAY_METHOD_FORM>({ ...BLANK_PAY_METHOD_FORM });

  const payMethodsQuery = useQuery<PayMethod[]>({ queryKey: ["/api/pay-methods"] });
  const workersQuery = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const remittanceSourcesQuery = useQuery<RemittanceSource[]>({ queryKey: ["/api/remittance-sources"] });

  const cleanForm = (data: typeof BLANK_PAY_METHOD_FORM) => {
    const d: Record<string, any> = { ...data, priority: parseInt(data.priority) || 1 };
    if (!d.remittanceSourceId || d.remittanceSourceId === "none") d.remittanceSourceId = null;
    if (!d.amountValue) d.amountValue = null;
    if (!d.platform || d.platform === "none") d.platform = null;
    if (!d.bankName) d.bankName = null;
    if (!d.handle) d.handle = null;
    return d;
  };

  const createMutation = useMutation({
    mutationFn: async (data: typeof BLANK_PAY_METHOD_FORM) => {
      await apiRequest("POST", "/api/pay-methods", cleanForm(data));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-methods"] });
      toast({ title: "Pay method added successfully" });
      setAddOpen(false);
      setForm({ ...BLANK_PAY_METHOD_FORM });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof BLANK_PAY_METHOD_FORM }) => {
      await apiRequest("PATCH", `/api/pay-methods/${id}`, cleanForm(data));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-methods"] });
      toast({ title: "Pay method updated" });
      setEditOpen(false);
      setEditId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/pay-methods/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-methods"] });
      toast({ title: "Pay method deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const payMethods = payMethodsQuery.data || [];
  const workers = workersQuery.data || [];
  const remittanceSources = remittanceSourcesQuery.data || [];
  const workerMap = new Map(workers.map(w => [w.id, `${w.firstName} ${w.lastName}`]));
  const rsMap = new Map(remittanceSources.map(r => [r.id, r.name]));

  const openEdit = (pm: PayMethod) => {
    setEditId(pm.id);
    setEditForm({
      workerId: pm.workerId || "",
      methodType: pm.methodType || "direct_deposit",
      bankName: pm.bankName || "",
      accountType: pm.accountType || "checking",
      routingNumber: pm.routingNumber || "",
      accountNumber: pm.accountNumber || "",
      isPrimary: pm.isPrimary ?? false,
      remittanceSourceId: pm.remittanceSourceId || "",
      priority: String(pm.priority ?? 1),
      amountType: pm.amountType || "remainder",
      amountValue: pm.amountValue ? String(pm.amountValue) : "",
      platform: pm.platform || "",
      handle: pm.handle || "",
      isActive: pm.isActive ?? true,
    });
    setEditOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-pay-method"><Plus className="mr-2 h-4 w-4" />Add Pay Method</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Pay Method</DialogTitle></DialogHeader>
            <PayMethodForm form={form} setForm={setForm} workers={workers} remittanceSources={remittanceSources} testPrefix="add-" />
            <Button data-testid="button-submit-pay-method" onClick={() => createMutation.mutate(form)}
              disabled={createMutation.isPending}>
              Add Pay Method
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={editOpen} onOpenChange={open => { setEditOpen(open); if (!open) setEditId(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Pay Method</DialogTitle></DialogHeader>
          <PayMethodForm form={editForm} setForm={setEditForm} workers={workers} remittanceSources={remittanceSources} testPrefix="edit-" />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button data-testid="button-save-pay-method" onClick={() => editId && updateMutation.mutate({ id: editId, data: editForm })}
              disabled={updateMutation.isPending}>
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {payMethodsQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Method Type</TableHead>
                  <TableHead>Bank / Platform</TableHead>
                  <TableHead>Account Type</TableHead>
                  <TableHead>Routing</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Handle</TableHead>
                  <TableHead>Remittance Source</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Amount Type</TableHead>
                  <TableHead>Amount Value</TableHead>
                  <TableHead>Primary</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payMethods.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} className="text-center text-muted-foreground py-8">
                      No pay methods found
                    </TableCell>
                  </TableRow>
                ) : payMethods.map(pm => (
                  <TableRow key={pm.id} data-testid={`row-paymethod-${pm.id}`}>
                    <TableCell>{workerMap.get(pm.workerId) || pm.workerId}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {pm.methodType === "direct_deposit" ? "Direct Deposit" : pm.methodType === "check" ? "Check" : "Cash"}
                      </Badge>
                    </TableCell>
                    <TableCell>{pm.platform ? pm.platform.replace(/_/g, ' ') : (pm.bankName || "—")}</TableCell>
                    <TableCell>{pm.accountType || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{pm.routingNumber || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{pm.accountNumber || "—"}</TableCell>
                    <TableCell>{pm.handle || "—"}</TableCell>
                    <TableCell>{pm.remittanceSourceId ? (rsMap.get(pm.remittanceSourceId) || pm.remittanceSourceId) : "—"}</TableCell>
                    <TableCell>{pm.priority || 1}</TableCell>
                    <TableCell>{pm.amountType || "remainder"}</TableCell>
                    <TableCell>{pm.amountValue ? `$${pm.amountValue}` : "—"}</TableCell>
                    <TableCell>
                      {pm.isPrimary ? <Badge className="text-xs">Primary</Badge> : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={pm.isActive ? "default" : "secondary"} className="text-xs">
                        {pm.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" data-testid={`button-edit-paymethod-${pm.id}`}
                          onClick={() => openEdit(pm)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" data-testid={`button-delete-paymethod-${pm.id}`}
                          className="text-destructive hover:text-destructive"
                          onClick={() => { if (confirm("Delete this pay method?")) deleteMutation.mutate(pm.id); }}
                          disabled={deleteMutation.isPending}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TitlesTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState<EmployeeTitle | null>(null);
  const [form, setForm] = useState({ companyId: "", name: "" });

  const titlesQuery = useQuery<EmployeeTitle[]>({ queryKey: ["/api/employee-titles"] });
  const companiesQuery = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const workersQuery = useQuery<Worker[]>({ queryKey: ["/api/workers"] });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/employee-titles", { ...data, companyId: data.companyId || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-titles"] });
      toast({ title: "Title created" });
      setAddOpen(false);
      setForm({ companyId: "", name: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof form }) => {
      await apiRequest("PATCH", `/api/employee-titles/${id}`, { ...data, companyId: data.companyId || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-titles"] });
      toast({ title: "Title updated" });
      setEditOpen(false);
      setEditTitle(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/employee-titles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-titles"] });
      toast({ title: "Title deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const titles = titlesQuery.data || [];
  const companies = companiesQuery.data || [];
  const workers = workersQuery.data || [];
  const companyMap = new Map(companies.map(c => [c.id, c.name]));

  if (titlesQuery.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={addOpen} onOpenChange={v => { setAddOpen(v); if (!v) setForm({ companyId: "", name: "" }); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-title"><Plus className="mr-2 h-4 w-4" />Add Title</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Add Title</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={form.companyId || "__universal__"} onValueChange={v => setForm(f => ({ ...f, companyId: v === "__universal__" ? "" : v }))}>
                  <SelectTrigger data-testid="select-title-companyId"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__universal__">All Companies (Universal)</SelectItem>
                    {companies.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input data-testid="input-title-name" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <Button data-testid="button-submit-title" onClick={() => createMutation.mutate(form)}
                disabled={createMutation.isPending}>
                Add Title
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead># Employees</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {titles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No titles found
                  </TableCell>
                </TableRow>
              ) : titles.map(t => (
                <TableRow key={t.id} data-testid={`row-title-${t.id}`}>
                  <TableCell data-testid={`text-title-name-${t.id}`}>{t.name}</TableCell>
                  <TableCell>{t.companyId ? (companyMap.get(t.companyId) || t.companyId) : <span className="text-muted-foreground italic text-xs">All Companies</span>}</TableCell>
                  <TableCell>{workers.filter(w => w.titleId === t.id).length}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-title-menu-${t.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem data-testid={`button-edit-title-${t.id}`} onClick={() => {
                          setEditTitle(t);
                          setForm({ companyId: t.companyId || "", name: t.name });
                          setEditOpen(true);
                        }}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem data-testid={`button-delete-title-${t.id}`}
                          className="text-destructive" onClick={() => {
                            if (confirm("Delete this title?")) deleteMutation.mutate(t.id);
                          }}>
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={v => { setEditOpen(v); if (!v) { setEditTitle(null); setForm({ companyId: "", name: "" }); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Title</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Company</Label>
              <Select value={form.companyId || "__universal__"} onValueChange={v => setForm(f => ({ ...f, companyId: v === "__universal__" ? "" : v }))}>
                <SelectTrigger data-testid="select-edit-title-companyId"><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__universal__">All Companies (Universal)</SelectItem>
                  {companies.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input data-testid="input-edit-title-name" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <Button data-testid="button-update-title"
              onClick={() => { if (editTitle) updateMutation.mutate({ id: editTitle.id, data: form }); }}
              disabled={updateMutation.isPending}>
              Update Title
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmployeeGroupsTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<EmployeeGroup | null>(null);
  const [form, setForm] = useState({ companyId: "", name: "", parentId: "" });

  const groupsQuery = useQuery<EmployeeGroup[]>({ queryKey: ["/api/employee-groups"] });
  const companiesQuery = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const workersQuery = useQuery<Worker[]>({ queryKey: ["/api/workers"] });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const cleanData: Record<string, any> = { ...data };
      if (cleanData.parentId === "" || cleanData.parentId === "none") cleanData.parentId = null;
      if (cleanData.companyId === "" || cleanData.companyId === "__universal__") cleanData.companyId = null;
      await apiRequest("POST", "/api/employee-groups", cleanData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-groups"] });
      toast({ title: "Group created" });
      setAddOpen(false);
      setForm({ companyId: "", name: "", parentId: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof form }) => {
      const cleanData: Record<string, any> = { ...data };
      if (cleanData.parentId === "" || cleanData.parentId === "none") cleanData.parentId = null;
      if (cleanData.companyId === "" || cleanData.companyId === "__universal__") cleanData.companyId = null;
      await apiRequest("PATCH", `/api/employee-groups/${id}`, cleanData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-groups"] });
      toast({ title: "Group updated" });
      setEditOpen(false);
      setEditGroup(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/employee-groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-groups"] });
      toast({ title: "Group deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const groups = groupsQuery.data || [];
  const companies = companiesQuery.data || [];
  const workers = workersQuery.data || [];
  const companyMap = new Map(companies.map(c => [c.id, c.name]));
  const groupMap = new Map(groups.map(g => [g.id, g.name]));

  if (groupsQuery.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  function renderGroupForm(isEdit: boolean) {
    return (
      <div className="grid gap-4 py-4">
        <div className="space-y-2">
          <Label>Company</Label>
          <Select value={form.companyId || "__universal__"} onValueChange={v => setForm(f => ({ ...f, companyId: v }))}>
            <SelectTrigger data-testid={isEdit ? "select-edit-group-companyId" : "select-group-companyId"}>
              <SelectValue placeholder="Select company" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__universal__">All Companies (Universal)</SelectItem>
              {companies.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Name</Label>
          <Input data-testid={isEdit ? "input-edit-group-name" : "input-group-name"} value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Parent Group</Label>
          <Select value={form.parentId || "none"} onValueChange={v => setForm(f => ({ ...f, parentId: v }))}>
            <SelectTrigger data-testid={isEdit ? "select-edit-group-parentId" : "select-group-parentId"}>
              <SelectValue placeholder="Select parent group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {groups.filter(g => !editGroup || g.id !== editGroup.id).map(g => (
                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button data-testid={isEdit ? "button-update-group" : "button-submit-group"}
          onClick={() => {
            if (isEdit && editGroup) {
              updateMutation.mutate({ id: editGroup.id, data: form });
            } else {
              createMutation.mutate(form);
            }
          }}
          disabled={createMutation.isPending || updateMutation.isPending}>
          {isEdit ? "Update Group" : "Add Group"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={addOpen} onOpenChange={v => { setAddOpen(v); if (!v) setForm({ companyId: "", name: "", parentId: "" }); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-group"><Plus className="mr-2 h-4 w-4" />Add Group</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Add Employee Group</DialogTitle></DialogHeader>
            {renderGroupForm(false)}
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Parent Group</TableHead>
                <TableHead>Company</TableHead>
                <TableHead># Members</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No groups found
                  </TableCell>
                </TableRow>
              ) : groups.map(g => (
                <TableRow key={g.id} data-testid={`row-group-${g.id}`}>
                  <TableCell data-testid={`text-group-name-${g.id}`}>{g.name}</TableCell>
                  <TableCell>{g.parentId ? (groupMap.get(g.parentId) || g.parentId) : "—"}</TableCell>
                  <TableCell>{g.companyId ? (companyMap.get(g.companyId) || g.companyId) : <span className="text-xs text-muted-foreground italic">All Companies</span>}</TableCell>
                  <TableCell>{workers.filter(w => w.groupId === g.id).length}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-group-menu-${g.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem data-testid={`button-edit-group-${g.id}`} onClick={() => {
                          setEditGroup(g);
                          setForm({ companyId: g.companyId || "__universal__", name: g.name, parentId: g.parentId || "" });
                          setEditOpen(true);
                        }}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem data-testid={`button-delete-group-${g.id}`}
                          className="text-destructive" onClick={() => {
                            if (confirm("Delete this group?")) deleteMutation.mutate(g.id);
                          }}>
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={v => { setEditOpen(v); if (!v) { setEditGroup(null); setForm({ companyId: "", name: "", parentId: "" }); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Employee Group</DialogTitle></DialogHeader>
          {renderGroupForm(true)}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EthnicGroupsTab() {
  const workersQuery = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const workers = workersQuery.data || [];
  const ethnicities = Array.from(new Set(workers.map(w => w.ethnicity).filter(Boolean)));

  if (workersQuery.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {ethnicities.length === 0 ? (
        <Card className="col-span-full">
          <CardContent className="py-8 text-center text-muted-foreground">
            No ethnic groups found. Add ethnicity data to employees to see groups here.
          </CardContent>
        </Card>
      ) : ethnicities.map((ethnicity, i) => (
        <Card key={i} data-testid={`card-ethnicity-${i}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4" />
              {ethnicity}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground" data-testid={`text-ethnicity-count-${i}`}>
              {workers.filter(w => w.ethnicity === ethnicity).length} employee(s)
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function NewHireDefaultsTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<NewHireDefault | null>(null);

  const emptyForm = {
    companyId: "", name: "", defaultWorkerType: "employee", defaultPayType: "hourly",
    defaultDepartment: "", defaultBranchId: "", defaultPolicyGroupId: "",
    defaultPayPeriodScheduleId: "", defaultCurrency: "USD", defaultCountry: "US"
  };
  const [form, setForm] = useState(emptyForm);

  const defaultsQuery = useQuery<NewHireDefault[]>({ queryKey: ["/api/new-hire-defaults"] });
  const companiesQuery = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const branchesQuery = useQuery<Branch[]>({ queryKey: ["/api/branches"] });
  const policyGroupsQuery = useQuery<PolicyGroup[]>({ queryKey: ["/api/policy-groups"] });
  const payPeriodSchedulesQuery = useQuery<PayPeriodSchedule[]>({ queryKey: ["/api/pay-period-schedules"] });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const cleanData: Record<string, any> = { ...data };
      if (cleanData.defaultBranchId === "" || cleanData.defaultBranchId === "none") cleanData.defaultBranchId = null;
      if (cleanData.defaultPolicyGroupId === "" || cleanData.defaultPolicyGroupId === "none") cleanData.defaultPolicyGroupId = null;
      if (cleanData.defaultPayPeriodScheduleId === "" || cleanData.defaultPayPeriodScheduleId === "none") cleanData.defaultPayPeriodScheduleId = null;
      await apiRequest("POST", "/api/new-hire-defaults", cleanData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/new-hire-defaults"] });
      toast({ title: "Default created" });
      setAddOpen(false);
      setForm({ ...emptyForm });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof form }) => {
      const cleanData: Record<string, any> = { ...data };
      if (cleanData.defaultBranchId === "" || cleanData.defaultBranchId === "none") cleanData.defaultBranchId = null;
      if (cleanData.defaultPolicyGroupId === "" || cleanData.defaultPolicyGroupId === "none") cleanData.defaultPolicyGroupId = null;
      if (cleanData.defaultPayPeriodScheduleId === "" || cleanData.defaultPayPeriodScheduleId === "none") cleanData.defaultPayPeriodScheduleId = null;
      await apiRequest("PATCH", `/api/new-hire-defaults/${id}`, cleanData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/new-hire-defaults"] });
      toast({ title: "Default updated" });
      setEditOpen(false);
      setEditEntry(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/new-hire-defaults/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/new-hire-defaults"] });
      toast({ title: "Default deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const defaults = defaultsQuery.data || [];
  const companies = companiesQuery.data || [];
  const branches = branchesQuery.data || [];
  const policyGroups = policyGroupsQuery.data || [];
  const payPeriodSchedules = payPeriodSchedulesQuery.data || [];
  const companyMap = new Map(companies.map(c => [c.id, c.name]));

  function renderDefaultForm(isEdit: boolean) {
    return (
      <div className="grid gap-4 py-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Company</Label>
            <Select value={form.companyId} onValueChange={v => setForm(f => ({ ...f, companyId: v }))}>
              <SelectTrigger data-testid={isEdit ? "select-edit-default-companyId" : "select-default-companyId"}>
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companies.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input data-testid={isEdit ? "input-edit-default-name" : "input-default-name"} value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Default Worker Type</Label>
            <Select value={form.defaultWorkerType} onValueChange={v => setForm(f => ({ ...f, defaultWorkerType: v }))}>
              <SelectTrigger data-testid="select-defaultWorkerType"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="contractor">Contractor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Default Pay Type</Label>
            <Select value={form.defaultPayType} onValueChange={v => setForm(f => ({ ...f, defaultPayType: v }))}>
              <SelectTrigger data-testid="select-defaultPayType"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="salary">Salary</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Default Department</Label>
            <Input data-testid="input-defaultDepartment" value={form.defaultDepartment}
              onChange={e => setForm(f => ({ ...f, defaultDepartment: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Default Branch</Label>
            <Select value={form.defaultBranchId || "none"} onValueChange={v => setForm(f => ({ ...f, defaultBranchId: v }))}>
              <SelectTrigger data-testid="select-defaultBranchId"><SelectValue placeholder="Select branch" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {branches.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Default Policy Group</Label>
            <Select value={form.defaultPolicyGroupId || "none"} onValueChange={v => setForm(f => ({ ...f, defaultPolicyGroupId: v }))}>
              <SelectTrigger data-testid="select-defaultPolicyGroupId"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {policyGroups.map(pg => (
                  <SelectItem key={pg.id} value={pg.id}>{pg.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Default Pay Period Schedule</Label>
            <Select value={form.defaultPayPeriodScheduleId || "none"} onValueChange={v => setForm(f => ({ ...f, defaultPayPeriodScheduleId: v }))}>
              <SelectTrigger data-testid="select-defaultPayPeriodScheduleId"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {payPeriodSchedules.map(ps => (
                  <SelectItem key={ps.id} value={ps.id}>{ps.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Default Currency</Label>
            <Select value={form.defaultCurrency} onValueChange={v => setForm(f => ({ ...f, defaultCurrency: v }))}>
              <SelectTrigger data-testid="select-defaultCurrency"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="CAD">CAD</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
                <SelectItem value="GBP">GBP</SelectItem>
                <SelectItem value="AUD">AUD</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Default Country</Label>
            <Input data-testid="input-defaultCountry" value={form.defaultCountry}
              onChange={e => setForm(f => ({ ...f, defaultCountry: e.target.value }))} />
          </div>
        </div>
        <Button data-testid={isEdit ? "button-update-default" : "button-submit-default"}
          onClick={() => {
            if (isEdit && editEntry) {
              updateMutation.mutate({ id: editEntry.id, data: form });
            } else {
              createMutation.mutate(form);
            }
          }}
          disabled={createMutation.isPending || updateMutation.isPending}>
          {isEdit ? "Update Default" : "Add Default"}
        </Button>
      </div>
    );
  }

  if (defaultsQuery.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={addOpen} onOpenChange={v => { setAddOpen(v); if (!v) setForm({ ...emptyForm }); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-default"><Plus className="mr-2 h-4 w-4" />Add Default</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add New Hire Default</DialogTitle></DialogHeader>
            {renderDefaultForm(false)}
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Worker Type</TableHead>
                <TableHead>Pay Type</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Country</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {defaults.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No new hire defaults found
                  </TableCell>
                </TableRow>
              ) : defaults.map(d => (
                <TableRow key={d.id} data-testid={`row-default-${d.id}`}>
                  <TableCell data-testid={`text-default-name-${d.id}`}>{d.name}</TableCell>
                  <TableCell>{companyMap.get(d.companyId) || d.companyId}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">{d.defaultWorkerType || "employee"}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">{d.defaultPayType || "hourly"}</Badge>
                  </TableCell>
                  <TableCell>{d.defaultDepartment || "—"}</TableCell>
                  <TableCell>{d.defaultCurrency || "USD"}</TableCell>
                  <TableCell>{d.defaultCountry || "US"}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-default-menu-${d.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem data-testid={`button-edit-default-${d.id}`} onClick={() => {
                          setEditEntry(d);
                          setForm({
                            companyId: d.companyId,
                            name: d.name,
                            defaultWorkerType: d.defaultWorkerType || "employee",
                            defaultPayType: d.defaultPayType || "hourly",
                            defaultDepartment: d.defaultDepartment || "",
                            defaultBranchId: d.defaultBranchId || "",
                            defaultPolicyGroupId: d.defaultPolicyGroupId || "",
                            defaultPayPeriodScheduleId: d.defaultPayPeriodScheduleId || "",
                            defaultCurrency: d.defaultCurrency || "USD",
                            defaultCountry: d.defaultCountry || "US"
                          });
                          setEditOpen(true);
                        }}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem data-testid={`button-delete-default-${d.id}`}
                          className="text-destructive" onClick={() => {
                            if (confirm("Delete this default?")) deleteMutation.mutate(d.id);
                          }}>
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={v => { setEditOpen(v); if (!v) { setEditEntry(null); setForm({ ...emptyForm }); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit New Hire Default</DialogTitle></DialogHeader>
          {renderDefaultForm(true)}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WageGroupsTab() {
  const { toast } = useToast();
  const search = useSearch();
  const urlWorkerId = new URLSearchParams(search).get("id") || "";
  const [selectedWorkerId, setSelectedWorkerId] = useState(urlWorkerId);
  const workerId = selectedWorkerId;
  const workersQuery = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const workers = workersQuery.data || [];
  const { data: assignments, isLoading } = useQuery<EmployeeWageGroup[]>({
    queryKey: ["/api/employee-wage-groups", workerId],
    queryFn: async () => {
      const res = await fetch(`/api/employee-wage-groups?workerId=${workerId}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!workerId,
  });
  const { data: allWageGroups } = useQuery<SecondaryWageGroup[]>({ queryKey: ["/api/secondary-wage-groups"] });
  const [selectedWgId, setSelectedWgId] = useState("");

  const addMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/employee-wage-groups", { workerId, wageGroupId: selectedWgId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-wage-groups", workerId] });
      setSelectedWgId("");
      toast({ title: "Wage group assigned" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const removeMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/employee-wage-groups/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-wage-groups", workerId] });
      toast({ title: "Wage group removed" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const assignedIds = new Set(assignments?.map(a => a.wageGroupId) || []);
  const availableGroups = allWageGroups?.filter(wg => !assignedIds.has(wg.id) && wg.isActive) || [];
  const wgLookup: Record<string, SecondaryWageGroup> = {};
  allWageGroups?.forEach(wg => { wgLookup[wg.id] = wg; });

  if (isLoading && workerId) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5" />Assigned Wage Groups</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Select Employee</Label>
            <Select value={selectedWorkerId} onValueChange={setSelectedWorkerId}>
              <SelectTrigger className="w-72" data-testid="select-wg-worker"><SelectValue placeholder="Select an employee" /></SelectTrigger>
              <SelectContent>
                {workers.map(w => (
                  <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!workerId ? (
            <p className="text-sm text-muted-foreground py-4">Select an employee above to manage their wage group assignments.</p>
          ) : <>
          <div className="flex items-center gap-3">
            <Select value={selectedWgId} onValueChange={setSelectedWgId}>
              <SelectTrigger className="w-64" data-testid="select-assign-wage-group"><SelectValue placeholder="Select wage group to assign" /></SelectTrigger>
              <SelectContent>
                {availableGroups.map(wg => (
                  <SelectItem key={wg.id} value={wg.id}>{wg.name} (${Number(wg.hourlyRate || 0).toFixed(2)}/hr)</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button disabled={!selectedWgId || addMutation.isPending} onClick={() => addMutation.mutate()} data-testid="button-assign-wage-group">
              <Plus className="mr-2 h-4 w-4" />{addMutation.isPending ? "Assigning..." : "Assign"}
            </Button>
          </div>

          <Table>
            <TableHeader><TableRow>
              <TableHead>Wage Group</TableHead><TableHead>Hourly Rate</TableHead><TableHead>OT Rate</TableHead><TableHead>Description</TableHead><TableHead className="w-12"></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(!assignments || assignments.length === 0) ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No wage groups assigned. Use the dropdown above to assign one.</TableCell></TableRow>
              ) : assignments.map(a => {
                const wg = wgLookup[a.wageGroupId];
                return (
                  <TableRow key={a.id} data-testid={`row-ewg-${a.id}`}>
                    <TableCell className="font-medium">{wg?.name || a.wageGroupId}</TableCell>
                    <TableCell>${Number(wg?.hourlyRate || 0).toFixed(2)}</TableCell>
                    <TableCell>${Number(wg?.overtimeRate || 0).toFixed(2)}</TableCell>
                    <TableCell>{wg?.description || "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="text-red-600" onClick={() => removeMutation.mutate(a.id)} data-testid={`remove-ewg-${a.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </>}
        </CardContent>
      </Card>
    </div>
  );
}

interface UserAccount {
  id: string;
  username: string;
  role: string;
  companyId: string | null;
  workerId: string | null;
  isActive: boolean | null;
  createdAt: string | null;
}

function WorkerComplianceTab() {
  const { toast } = useToast();
  const workersQuery = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const workers = workersQuery.data || [];
  const [selectedWorkerId, setSelectedWorkerId] = useState("");

  const { data: complianceData, isLoading } = useQuery<any>({
    queryKey: ["/api/compliance/worker", selectedWorkerId],
    queryFn: async () => {
      const res = await fetch(`/api/compliance/worker/${selectedWorkerId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: !!selectedWorkerId,
  });

  const profileMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/compliance/worker/${selectedWorkerId}/profile`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/compliance/worker", selectedWorkerId] });
      toast({ title: "Compliance profile saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const profile = complianceData?.profile;
  const events: any[] = complianceData?.events ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Scale className="h-4 w-4" />
            Worker Compliance Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Select Worker</Label>
            <Select value={selectedWorkerId} onValueChange={setSelectedWorkerId}>
              <SelectTrigger data-testid="select-compliance-worker">
                <SelectValue placeholder="Select worker" />
              </SelectTrigger>
              <SelectContent>
                {workers.map(w => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.firstName} {w.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!selectedWorkerId && (
            <p className="text-xs text-muted-foreground py-4 text-center">Select a worker to view their compliance profile.</p>
          )}

          {selectedWorkerId && isLoading && (
            <p className="text-xs text-muted-foreground py-4 text-center">Loading…</p>
          )}

          {selectedWorkerId && !isLoading && (
            <div className="space-y-4">
              {/* Exempt status */}
              <div className="space-y-2">
                <Label className="text-xs">Exempt Status</Label>
                <Select
                  value={profile?.exemptStatus ?? "nonexempt"}
                  onValueChange={v => profileMutation.mutate({ exemptStatus: v })}
                >
                  <SelectTrigger className="h-8 text-xs" data-testid="select-exempt-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nonexempt">Non-Exempt (hourly OT applies)</SelectItem>
                    <SelectItem value="exempt_executive">Exempt – Executive</SelectItem>
                    <SelectItem value="exempt_administrative">Exempt – Administrative</SelectItem>
                    <SelectItem value="exempt_professional">Exempt – Professional</SelectItem>
                    <SelectItem value="exempt_computer">Exempt – Computer Professional</SelectItem>
                    <SelectItem value="exempt_outside_sales">Exempt – Outside Sales</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* ABC contractor test */}
              {complianceData?.worker?.workerType === "contractor" && (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">CA ABC Contractor Test</Label>
                  <p className="text-[11px] text-muted-foreground">All three prongs must pass for independent contractor classification under CA AB5.</p>
                  {[
                    { field: "abcTestA", label: "Prong A", description: "Free from control/direction (in contract and in fact)" },
                    { field: "abcTestB", label: "Prong B", description: "Work is outside the usual course of the hiring entity's business" },
                    { field: "abcTestC", label: "Prong C", description: "Customarily engaged in independently established trade/occupation" },
                  ].map(({ field, label, description }) => {
                    const val = profile?.[field] ?? null;
                    return (
                      <div key={field} className="flex items-center justify-between gap-2 p-2 rounded border border-border">
                        <div>
                          <p className="text-xs font-medium">{label}: {description}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {val === true ? (
                            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 text-xs" data-testid={`badge-abc-${field}`}>Pass</Badge>
                          ) : val === false ? (
                            <Badge variant="destructive" className="text-xs" data-testid={`badge-abc-${field}`}>Fail</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs" data-testid={`badge-abc-${field}`}>Not Set</Badge>
                          )}
                          <Select
                            value={val === true ? "true" : val === false ? "false" : "null"}
                            onValueChange={v => profileMutation.mutate({ [field]: v === "true" ? true : v === "false" ? false : null })}
                          >
                            <SelectTrigger className="h-7 w-24 text-xs" data-testid={`select-abc-${field}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="null">Not Set</SelectItem>
                              <SelectItem value="true">Pass</SelectItem>
                              <SelectItem value="false">Fail</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    );
                  })}
                  {profile && (
                    <div className={`flex items-center gap-2 p-2 rounded ${
                      profile.abcTestA && profile.abcTestB && profile.abcTestC
                        ? "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800"
                        : profile.abcTestA === false || profile.abcTestB === false || profile.abcTestC === false
                        ? "bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800"
                        : "bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800"
                    }`} data-testid="badge-abc-overall">
                      {profile.abcTestA && profile.abcTestB && profile.abcTestC ? (
                        <><CheckCircle2 className="h-4 w-4 text-emerald-500" /><span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">ABC Test: All prongs pass — contractor classification valid</span></>
                      ) : (profile.abcTestA === false || profile.abcTestB === false || profile.abcTestC === false) ? (
                        <><XCircle className="h-4 w-4 text-red-500" /><span className="text-xs text-red-700 dark:text-red-400 font-medium">ABC Test: One or more prongs fail — worker may be misclassified</span></>
                      ) : (
                        <><AlertCircle className="h-4 w-4 text-amber-500" /><span className="text-xs text-amber-700 dark:text-amber-400 font-medium">ABC Test: Incomplete — all prongs must be evaluated</span></>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Compliance event history */}
              {events.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Recent Compliance Events</Label>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {events.slice(0, 20).map((e: any, i: number) => (
                      <div key={e.id ?? i} className={`flex items-start gap-2 p-2 rounded text-xs border ${
                        e.severity === "block" ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20" :
                        e.severity === "warn"  ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20" :
                        "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20"
                      }`} data-testid={`row-compliance-event-${e.id ?? i}`}>
                        {e.severity === "block" ? <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" /> :
                         e.severity === "warn"  ? <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" /> :
                                                  <Info className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />}
                        <div className="min-w-0">
                          <p className="font-medium">{e.ruleType?.replace(/_/g, " ")}</p>
                          <p className="text-muted-foreground">{e.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {events.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">No compliance events on record for this worker.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UserAccountsTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<UserAccount | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const defaultForm = { username: "", password: "", role: "employee", companyId: "", workerId: "", isActive: true };
  const [form, setForm] = useState(defaultForm);

  const { data: userAccounts, isLoading } = useQuery<UserAccount[]>({ queryKey: ["/api/users"] });
  const { data: allWorkers } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload: any = { ...data };
      if (!payload.companyId) delete payload.companyId;
      if (!payload.workerId) delete payload.workerId;
      if (editItem && !payload.password) delete payload.password;
      if (editItem) {
        await apiRequest("PATCH", `/api/users/${editItem.id}`, payload);
      } else {
        await apiRequest("POST", "/api/users", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: editItem ? "User account updated" : "User account created" });
      setOpen(false);
      setEditItem(null);
      setForm(defaultForm);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User account deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: UserAccount) => {
    setEditItem(item);
    setForm({
      username: item.username,
      password: "",
      role: item.role || "employee",
      companyId: item.companyId || "",
      workerId: item.workerId || "",
      isActive: item.isActive !== false,
    });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
      setShowPassword(false);
    }
  };

  const getWorkerName = (workerId: string | null) => {
    if (!workerId || !allWorkers) return "—";
    const w = allWorkers.find(w => w.id === workerId);
    return w ? `${w.firstName} ${w.lastName}` : "—";
  };

  const getCompanyName = (companyId: string | null) => {
    if (!companyId || !companies) return "—";
    const c = companies.find(c => c.id === companyId);
    return c ? c.name : "—";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">User Accounts</h3>
        <Dialog open={open} onOpenChange={handleDialogChange}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-user-account"><Plus className="w-4 h-4 mr-1" /> Add User Account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editItem ? "Edit User Account" : "Create User Account"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Username</Label>
                <Input data-testid="input-user-username" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="e.g. john.smith" />
              </div>
              <div className="grid gap-2">
                <Label>{editItem ? "New Password (leave blank to keep current)" : "Password"}</Label>
                <div className="relative">
                  <Input data-testid="input-user-password" type={showPassword ? "text" : "password"} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={editItem ? "Leave blank to keep current" : "Enter password"} />
                  <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full" onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                  <SelectTrigger data-testid="select-user-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="employee">Employee</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={v => setForm(f => ({ ...f, companyId: v }))}>
                  <SelectTrigger data-testid="select-user-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Link to Employee/Worker</Label>
                <Select value={form.workerId} onValueChange={v => setForm(f => ({ ...f, workerId: v }))}>
                  <SelectTrigger data-testid="select-user-worker"><SelectValue placeholder="Select worker (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No linked worker</SelectItem>
                    {allWorkers?.filter(w => w.isActive).map(w => (
                      <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName} ({w.employeeNumber || "no #"})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {editItem && (
                <div className="flex items-center gap-2">
                  <Checkbox data-testid="checkbox-user-active" checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: !!v }))} />
                  <Label>Active</Label>
                </div>
              )}
              <Button data-testid="button-save-user-account" disabled={mutation.isPending} onClick={() => {
                if (!form.username) return toast({ title: "Username is required", variant: "destructive" });
                if (!editItem && !form.password) return toast({ title: "Password is required", variant: "destructive" });
                const submitData = { ...form };
                if (submitData.workerId === "none") submitData.workerId = "";
                mutation.mutate(submitData);
              }}>
                {mutation.isPending ? "Saving..." : editItem ? "Update Account" : "Create Account"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Linked Worker</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!userAccounts?.length ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No user accounts found</TableCell></TableRow>
                ) : userAccounts.map(u => (
                  <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                    <TableCell className="font-medium">{u.username}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "admin" ? "default" : u.role === "manager" ? "secondary" : "outline"}>
                        {u.role}
                      </Badge>
                    </TableCell>
                    <TableCell>{getWorkerName(u.workerId)}</TableCell>
                    <TableCell>{getCompanyName(u.companyId)}</TableCell>
                    <TableCell>
                      <Badge variant={u.isActive !== false ? "default" : "destructive"}>
                        {u.isActive !== false ? "Active" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`menu-user-${u.id}`}><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem data-testid={`edit-user-${u.id}`} onClick={() => handleEdit(u)}>
                            <Pencil className="mr-2 h-4 w-4" />Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem data-testid={`delete-user-${u.id}`} className="text-red-600" onClick={() => {
                            if (confirm("Delete this user account? This cannot be undone.")) deleteMutation.mutate(u.id);
                          }}>
                            <Trash2 className="mr-2 h-4 w-4" />Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function EmployeePage() {
  const [activeTab, handleTabChange] = useTabParam("employee");

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Employee</h1>
        <p className="text-muted-foreground" data-testid="text-page-subtitle">
          Manage employees, wages, and more
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="overflow-x-auto -mx-1 px-1">
        <TabsList className="inline-flex w-max" data-testid="tabs-employee">
          <TabsTrigger value="employee" data-testid="tab-employee">
            <Users className="mr-2 h-4 w-4" />Employee
          </TabsTrigger>
          <TabsTrigger value="preferences" data-testid="tab-preferences">
            <Settings className="mr-2 h-4 w-4" />Preferences
          </TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-documents">
            <FileText className="mr-2 h-4 w-4" />Documents
          </TabsTrigger>
          <TabsTrigger value="wages" data-testid="tab-wages">
            <DollarSign className="mr-2 h-4 w-4" />Wages
          </TabsTrigger>
          <TabsTrigger value="pay-methods" data-testid="tab-pay-methods">
            <CreditCard className="mr-2 h-4 w-4" />Pay Methods
          </TabsTrigger>
          <TabsTrigger value="titles" data-testid="tab-titles">
            <Briefcase className="mr-2 h-4 w-4" />Titles
          </TabsTrigger>
          <TabsTrigger value="employee-groups" data-testid="tab-employee-groups">
            <Users className="mr-2 h-4 w-4" />Employee Groups
          </TabsTrigger>
          <TabsTrigger value="ethnic-groups" data-testid="tab-ethnic-groups">
            <Globe className="mr-2 h-4 w-4" />Ethnic Groups
          </TabsTrigger>
          <TabsTrigger value="new-hire-defaults" data-testid="tab-new-hire-defaults">
            <Clock className="mr-2 h-4 w-4" />New Hire Defaults
          </TabsTrigger>
          <TabsTrigger value="wage-groups" data-testid="tab-wage-groups">
            <DollarSign className="mr-2 h-4 w-4" />Wage Groups
          </TabsTrigger>
          <TabsTrigger value="user-accounts" data-testid="tab-user-accounts">
            <Shield className="mr-2 h-4 w-4" />User Accounts
          </TabsTrigger>
          <TabsTrigger value="compliance" data-testid="tab-compliance">
            <Scale className="mr-2 h-4 w-4" />Compliance
          </TabsTrigger>
        </TabsList>
        </div>

        <TabsContent value="employee"><EmployeeTab /></TabsContent>
        <TabsContent value="preferences"><PreferencesTab /></TabsContent>
        <TabsContent value="documents"><DocumentsTab /></TabsContent>
        <TabsContent value="wages"><WagesTab /></TabsContent>
        <TabsContent value="pay-methods"><PayMethodsTab /></TabsContent>
        <TabsContent value="titles"><TitlesTab /></TabsContent>
        <TabsContent value="employee-groups"><EmployeeGroupsTab /></TabsContent>
        <TabsContent value="ethnic-groups"><EthnicGroupsTab /></TabsContent>
        <TabsContent value="new-hire-defaults"><NewHireDefaultsTab /></TabsContent>
        <TabsContent value="wage-groups"><WageGroupsTab /></TabsContent>
        <TabsContent value="user-accounts"><UserAccountsTab /></TabsContent>
        <TabsContent value="compliance"><WorkerComplianceTab /></TabsContent>
      </Tabs>
    </div>
  );
}
