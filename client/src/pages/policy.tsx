import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type {
  Company, PolicyGroup, PayCode, AccrualAccount, Holiday,
  PayFormula, ContributingPayCode, ContributingShift, RegularTimePolicy,
  OvertimePolicy, PremiumPolicy, MealPolicy, BreakPolicy, SchedulePolicy,
  ExceptionPolicy, AccrualPolicy, AbsencePolicy, HolidayPolicy, RoundingPolicy
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Shield, Plus, Code, Calculator, Layers, Clock, Calendar,
  CalendarDays, RotateCcw, UtensilsCrossed, Coffee, Timer,
  AlertTriangle, Award, FileText, Briefcase, TreePine, Ban,
  Pencil, Trash2, Zap
} from "lucide-react";

function useTabParam(defaultTab: string): [string, (tab: string) => void] {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get("tab") || defaultTab;
  const setTab = (newTab: string) => {
    setLocation(`/policy?tab=${newTab}`);
  };
  return [tab, setTab];
}

function PolicyLinkSelect({ label, value, onChange, items, testId }: { label: string; value: string; onChange: (v: string) => void; items: { id: string; name: string }[]; testId: string }) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value || "_none_"} onValueChange={(v) => onChange(v === "_none_" ? "" : v)}>
        <SelectTrigger data-testid={testId} className="h-8 text-xs">
          <SelectValue placeholder="None" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_none_">None</SelectItem>
          {items.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function PolicyGroupsTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<PolicyGroup | null>(null);
  const defaultForm = {
    name: "", description: "", isDefault: false,
    regularTimePolicyId: "", overtimePolicyId: "", premiumPolicyId: "",
    mealPolicyId: "", breakPolicyId: "", schedulePolicyId: "",
    exceptionPolicyId: "", accrualPolicyId: "", absencePolicyId: "",
    holidayPolicyId: "", roundingPolicyId: "",
  };
  const [form, setForm] = useState(defaultForm);

  const { data: groups, isLoading } = useQuery<PolicyGroup[]>({ queryKey: ["/api/policy-groups"] });
  const { data: regularTimePolicies } = useQuery<RegularTimePolicy[]>({ queryKey: ["/api/regular-time-policies"] });
  const { data: overtimePolicies } = useQuery<OvertimePolicy[]>({ queryKey: ["/api/overtime-policies"] });
  const { data: premiumPolicies } = useQuery<PremiumPolicy[]>({ queryKey: ["/api/premium-policies"] });
  const { data: mealPolicies } = useQuery<MealPolicy[]>({ queryKey: ["/api/meal-policies"] });
  const { data: breakPolicies } = useQuery<BreakPolicy[]>({ queryKey: ["/api/break-policies"] });
  const { data: schedulePolicies } = useQuery<SchedulePolicy[]>({ queryKey: ["/api/schedule-policies"] });
  const { data: exceptionPolicies } = useQuery<ExceptionPolicy[]>({ queryKey: ["/api/exception-policies"] });
  const { data: accrualPolicies } = useQuery<AccrualPolicy[]>({ queryKey: ["/api/accrual-policies"] });
  const { data: absencePolicies } = useQuery<AbsencePolicy[]>({ queryKey: ["/api/absence-policies"] });
  const { data: holidayPolicies } = useQuery<HolidayPolicy[]>({ queryKey: ["/api/holiday-policies"] });
  const { data: roundingPolicies } = useQuery<RoundingPolicy[]>({ queryKey: ["/api/rounding-policies"] });

  const quickSetupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/policy-groups/quick-setup", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/policy-groups"] });
      toast({ title: data.message || "Policy groups created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = { ...data, companyId: null };
      if (editItem) {
        await apiRequest("PATCH", `/api/policy-groups/${editItem.id}`, payload);
      } else {
        await apiRequest("POST", "/api/policy-groups", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policy-groups"] });
      toast({ title: editItem ? "Policy group updated" : "Policy group created" });
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
      await apiRequest("DELETE", `/api/policy-groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policy-groups"] });
      toast({ title: "Policy group deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: PolicyGroup) => {
    setEditItem(item);
    setForm({
      name: item.name, description: item.description || "", isDefault: item.isDefault ?? false,
      regularTimePolicyId: item.regularTimePolicyId || "", overtimePolicyId: item.overtimePolicyId || "",
      premiumPolicyId: item.premiumPolicyId || "", mealPolicyId: item.mealPolicyId || "",
      breakPolicyId: item.breakPolicyId || "", schedulePolicyId: item.schedulePolicyId || "",
      exceptionPolicyId: item.exceptionPolicyId || "", accrualPolicyId: item.accrualPolicyId || "",
      absencePolicyId: item.absencePolicyId || "", holidayPolicyId: item.holidayPolicyId || "",
      roundingPolicyId: item.roundingPolicyId || "",
    });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  const countLinkedPolicies = (g: PolicyGroup) => {
    let count = 0;
    if (g.regularTimePolicyId) count++;
    if (g.overtimePolicyId) count++;
    if (g.premiumPolicyId) count++;
    if (g.mealPolicyId) count++;
    if (g.breakPolicyId) count++;
    if (g.schedulePolicyId) count++;
    if (g.exceptionPolicyId) count++;
    if (g.accrualPolicyId) count++;
    if (g.absencePolicyId) count++;
    if (g.holidayPolicyId) count++;
    if (g.roundingPolicyId) count++;
    return count;
  };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-policy-groups">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Policy Groups</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            data-testid="button-quick-setup-policy-groups"
            disabled={quickSetupMutation.isPending}
            onClick={() => quickSetupMutation.mutate()}
          >
            <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
          </Button>
          <Dialog open={open} onOpenChange={handleDialogChange}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-policy-group"><Plus className="w-4 h-4 mr-1" /> Add Policy Group</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editItem ? "Edit Policy Group" : "Add Policy Group"}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Name</Label>
                  <Input data-testid="input-policy-group-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Description</Label>
                  <Input data-testid="input-policy-group-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="policy-group-default"
                    data-testid="checkbox-policy-group-default"
                    checked={form.isDefault}
                    onCheckedChange={(v) => setForm({ ...form, isDefault: !!v })}
                  />
                  <Label htmlFor="policy-group-default">Default</Label>
                </div>
                <div className="border-t pt-3">
                  <Label className="text-sm font-medium mb-2 block">Linked Policies</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <PolicyLinkSelect label="Regular Time" value={form.regularTimePolicyId} onChange={(v) => setForm({ ...form, regularTimePolicyId: v })} items={regularTimePolicies || []} testId="select-pg-regular-time" />
                    <PolicyLinkSelect label="Overtime" value={form.overtimePolicyId} onChange={(v) => setForm({ ...form, overtimePolicyId: v })} items={overtimePolicies || []} testId="select-pg-overtime" />
                    <PolicyLinkSelect label="Premium" value={form.premiumPolicyId} onChange={(v) => setForm({ ...form, premiumPolicyId: v })} items={premiumPolicies || []} testId="select-pg-premium" />
                    <PolicyLinkSelect label="Meal" value={form.mealPolicyId} onChange={(v) => setForm({ ...form, mealPolicyId: v })} items={mealPolicies || []} testId="select-pg-meal" />
                    <PolicyLinkSelect label="Break" value={form.breakPolicyId} onChange={(v) => setForm({ ...form, breakPolicyId: v })} items={breakPolicies || []} testId="select-pg-break" />
                    <PolicyLinkSelect label="Schedule" value={form.schedulePolicyId} onChange={(v) => setForm({ ...form, schedulePolicyId: v })} items={schedulePolicies || []} testId="select-pg-schedule" />
                    <PolicyLinkSelect label="Exception" value={form.exceptionPolicyId} onChange={(v) => setForm({ ...form, exceptionPolicyId: v })} items={exceptionPolicies || []} testId="select-pg-exception" />
                    <PolicyLinkSelect label="Accrual" value={form.accrualPolicyId} onChange={(v) => setForm({ ...form, accrualPolicyId: v })} items={accrualPolicies || []} testId="select-pg-accrual" />
                    <PolicyLinkSelect label="Absence" value={form.absencePolicyId} onChange={(v) => setForm({ ...form, absencePolicyId: v })} items={absencePolicies || []} testId="select-pg-absence" />
                    <PolicyLinkSelect label="Holiday" value={form.holidayPolicyId} onChange={(v) => setForm({ ...form, holidayPolicyId: v })} items={holidayPolicies || []} testId="select-pg-holiday" />
                    <PolicyLinkSelect label="Rounding" value={form.roundingPolicyId} onChange={(v) => setForm({ ...form, roundingPolicyId: v })} items={roundingPolicies || []} testId="select-pg-rounding" />
                  </div>
                </div>
                <Button data-testid="button-submit-policy-group" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                  {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Linked Policies</TableHead>
                <TableHead>Default</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups && groups.length > 0 ? groups.map((g) => (
                <TableRow key={g.id} data-testid={`row-policy-group-${g.id}`}>
                  <TableCell className="font-medium">{g.name}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{g.description || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" data-testid={`badge-linked-policies-${g.id}`}>{countLinkedPolicies(g)}/11</Badge>
                  </TableCell>
                  <TableCell>{g.isDefault ? <Badge variant="secondary">Default</Badge> : null}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-policy-group-${g.id}`} onClick={() => handleEdit(g)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-policy-group-${g.id}`} onClick={() => deleteMutation.mutate(g.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No policy groups yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function PayCodesTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<PayCode | null>(null);
  const defaultForm = { companyId: "", code: "", name: "", type: "regular", rate: "" };
  const [form, setForm] = useState(defaultForm);
  const [quickSetupCompanyId, setQuickSetupCompanyId] = useState("");

  const { data: payCodes, isLoading } = useQuery<PayCode[]>({ queryKey: ["/api/pay-codes"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const quickSetupMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await apiRequest("POST", "/api/pay-codes/quick-setup", { companyId });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-codes"] });
      toast({ title: data.message || "Pay codes created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      if (editItem) {
        await apiRequest("PATCH", `/api/pay-codes/${editItem.id}`, { ...data, rate: data.rate || undefined });
      } else {
        await apiRequest("POST", "/api/pay-codes", { ...data, rate: data.rate || undefined });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-codes"] });
      toast({ title: editItem ? "Pay code updated" : "Pay code created" });
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
      await apiRequest("DELETE", `/api/pay-codes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-codes"] });
      toast({ title: "Pay code deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: PayCode) => {
    setEditItem(item);
    setForm({ companyId: item.companyId, code: item.code, name: item.name, type: item.type || "regular", rate: item.rate || "" });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  const typeColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    regular: "default",
    overtime: "secondary",
    premium: "outline",
    holiday: "secondary",
    sick: "destructive",
    vacation: "outline",
  };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-pay-codes">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Pay Codes</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={quickSetupCompanyId} onValueChange={setQuickSetupCompanyId}>
            <SelectTrigger data-testid="select-pay-code-quick-company" className="w-[180px]">
              <SelectValue placeholder="Select company" />
            </SelectTrigger>
            <SelectContent>
              {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            data-testid="button-quick-setup-pay-codes"
            disabled={!quickSetupCompanyId || quickSetupMutation.isPending}
            onClick={() => quickSetupMutation.mutate(quickSetupCompanyId)}
          >
            <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
          </Button>
          <Dialog open={open} onOpenChange={handleDialogChange}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-pay-code"><Plus className="w-4 h-4 mr-1" /> Add Pay Code</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editItem ? "Edit Pay Code" : "Add Pay Code"}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Company</Label>
                  <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                    <SelectTrigger data-testid="select-pay-code-company">
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
                    <Label>Code</Label>
                    <Input data-testid="input-pay-code-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Name</Label>
                    <Input data-testid="input-pay-code-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Type</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                      <SelectTrigger data-testid="select-pay-code-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="regular">Regular</SelectItem>
                        <SelectItem value="overtime">Overtime</SelectItem>
                        <SelectItem value="premium">Premium</SelectItem>
                        <SelectItem value="holiday">Holiday</SelectItem>
                        <SelectItem value="sick">Sick</SelectItem>
                        <SelectItem value="vacation">Vacation</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Rate</Label>
                    <Input data-testid="input-pay-code-rate" type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
                  </div>
                </div>
                <Button data-testid="button-submit-pay-code" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                  {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payCodes && payCodes.length > 0 ? payCodes.map((pc) => (
                <TableRow key={pc.id} data-testid={`row-pay-code-${pc.id}`}>
                  <TableCell className="font-mono font-medium">{pc.code}</TableCell>
                  <TableCell>{pc.name}</TableCell>
                  <TableCell><Badge variant={typeColors[pc.type || "regular"] || "default"}>{pc.type}</Badge></TableCell>
                  <TableCell>{pc.rate ? `$${pc.rate}` : "—"}</TableCell>
                  <TableCell>{pc.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-pay-code-${pc.id}`} onClick={() => handleEdit(pc)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-pay-code-${pc.id}`} onClick={() => deleteMutation.mutate(pc.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No pay codes yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function AccrualAccountsTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<AccrualAccount | null>(null);
  const defaultForm = { companyId: "", name: "", type: "pto", accrualRate: "", accrualFrequency: "per_pay_period", maxBalance: "" };
  const [form, setForm] = useState(defaultForm);
  const [quickSetupCompanyId, setQuickSetupCompanyId] = useState("");

  const { data: accounts, isLoading } = useQuery<AccrualAccount[]>({ queryKey: ["/api/accrual-accounts"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const quickSetupMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await apiRequest("POST", "/api/accrual-accounts/quick-setup", { companyId });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/accrual-accounts"] });
      toast({ title: data.message || "Accrual accounts created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = { ...data, accrualRate: data.accrualRate || undefined, maxBalance: data.maxBalance || undefined };
      if (editItem) {
        await apiRequest("PATCH", `/api/accrual-accounts/${editItem.id}`, payload);
      } else {
        await apiRequest("POST", "/api/accrual-accounts", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accrual-accounts"] });
      toast({ title: editItem ? "Accrual account updated" : "Accrual account created" });
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
      await apiRequest("DELETE", `/api/accrual-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accrual-accounts"] });
      toast({ title: "Accrual account deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: AccrualAccount) => {
    setEditItem(item);
    setForm({ companyId: item.companyId, name: item.name, type: item.type || "pto", accrualRate: item.accrualRate || "", accrualFrequency: item.accrualFrequency || "per_pay_period", maxBalance: item.maxBalance || "" });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  const freqLabels: Record<string, string> = {
    per_pay_period: "Per Pay Period",
    monthly: "Monthly",
    annually: "Annually",
  };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-accrual-accounts">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Accrual Accounts</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={quickSetupCompanyId} onValueChange={setQuickSetupCompanyId}>
            <SelectTrigger data-testid="select-accrual-quick-company" className="w-[180px]">
              <SelectValue placeholder="Select company" />
            </SelectTrigger>
            <SelectContent>
              {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            data-testid="button-quick-setup-accrual-accounts"
            disabled={!quickSetupCompanyId || quickSetupMutation.isPending}
            onClick={() => quickSetupMutation.mutate(quickSetupCompanyId)}
          >
            <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
          </Button>
          <Dialog open={open} onOpenChange={handleDialogChange}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-accrual-account"><Plus className="w-4 h-4 mr-1" /> Add Accrual Account</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editItem ? "Edit Accrual Account" : "Add Accrual Account"}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Company</Label>
                  <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                    <SelectTrigger data-testid="select-accrual-company">
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
                  <Label>Name</Label>
                  <Input data-testid="input-accrual-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Type</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                      <SelectTrigger data-testid="select-accrual-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pto">PTO</SelectItem>
                        <SelectItem value="sick">Sick</SelectItem>
                        <SelectItem value="vacation">Vacation</SelectItem>
                        <SelectItem value="personal">Personal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Accrual Rate</Label>
                    <Input data-testid="input-accrual-rate" type="number" step="0.01" value={form.accrualRate} onChange={(e) => setForm({ ...form, accrualRate: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Frequency</Label>
                    <Select value={form.accrualFrequency} onValueChange={(v) => setForm({ ...form, accrualFrequency: v })}>
                      <SelectTrigger data-testid="select-accrual-frequency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="per_pay_period">Per Pay Period</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="annually">Annually</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Max Balance</Label>
                    <Input data-testid="input-accrual-max-balance" type="number" step="0.01" value={form.maxBalance} onChange={(e) => setForm({ ...form, maxBalance: e.target.value })} />
                  </div>
                </div>
                <Button data-testid="button-submit-accrual-account" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                  {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Max Balance</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts && accounts.length > 0 ? accounts.map((a) => (
                <TableRow key={a.id} data-testid={`row-accrual-account-${a.id}`}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell><Badge variant="secondary">{a.type?.toUpperCase()}</Badge></TableCell>
                  <TableCell>{a.accrualRate || "—"}</TableCell>
                  <TableCell>{freqLabels[a.accrualFrequency || ""] || a.accrualFrequency}</TableCell>
                  <TableCell>{a.maxBalance || "—"}</TableCell>
                  <TableCell>{a.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-accrual-account-${a.id}`} onClick={() => handleEdit(a)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-accrual-account-${a.id}`} onClick={() => deleteMutation.mutate(a.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No accrual accounts yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function HolidaysTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<Holiday | null>(null);
  const defaultForm = { companyId: "", name: "", date: "", isRecurring: false };
  const [form, setForm] = useState(defaultForm);
    const [quickSetupCompanyId, setQuickSetupCompanyId] = useState("");

  const { data: holidaysList, isLoading } = useQuery<Holiday[]>({ queryKey: ["/api/holidays"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const quickSetupMutation = useMutation({
      mutationFn: async (companyId: string) => {
        const res = await apiRequest("POST", "/api/holidays/quick-setup", { companyId });
        return res.json();
      },
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ["/api/holidays"] });
        toast({ title: data.message || "Holidays created" });
      },
      onError: (err: Error) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    });

    const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      if (editItem) {
        await apiRequest("PATCH", `/api/holidays/${editItem.id}`, data);
      } else {
        await apiRequest("POST", "/api/holidays", data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/holidays"] });
      toast({ title: editItem ? "Holiday updated" : "Holiday created" });
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
      await apiRequest("DELETE", `/api/holidays/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/holidays"] });
      toast({ title: "Holiday deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: Holiday) => {
    setEditItem(item);
    setForm({ companyId: item.companyId, name: item.name, date: item.date || "", isRecurring: item.isRecurring ?? false });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-holidays">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Recurring Holidays</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={quickSetupCompanyId} onValueChange={setQuickSetupCompanyId}>
              <SelectTrigger data-testid="select-holidays-quick-company" className="w-[180px]">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              data-testid="button-quick-setup-holidays"
              disabled={!quickSetupCompanyId || quickSetupMutation.isPending}
              onClick={() => quickSetupMutation.mutate(quickSetupCompanyId)}
            >
              <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
            </Button>
            <Dialog open={open} onOpenChange={handleDialogChange}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-holiday"><Plus className="w-4 h-4 mr-1" /> Add Holiday</Button>
              </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editItem ? "Edit Holiday" : "Add Holiday"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger data-testid="select-holiday-company">
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
                <Label>Name</Label>
                <Input data-testid="input-holiday-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Date</Label>
                <Input data-testid="input-holiday-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="holiday-recurring"
                  data-testid="checkbox-holiday-recurring"
                  checked={form.isRecurring}
                  onCheckedChange={(v) => setForm({ ...form, isRecurring: !!v })}
                />
                <Label htmlFor="holiday-recurring">Recurring</Label>
              </div>
              <Button data-testid="button-submit-holiday" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
              </Button>
            </div>
          </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Recurring</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holidaysList && holidaysList.length > 0 ? holidaysList.map((h) => (
                <TableRow key={h.id} data-testid={`row-holiday-${h.id}`}>
                  <TableCell className="font-medium">{h.name}</TableCell>
                  <TableCell>{h.date}</TableCell>
                  <TableCell>{h.isRecurring ? <Badge variant="secondary">Recurring</Badge> : null}</TableCell>
                  <TableCell>{h.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-holiday-${h.id}`} onClick={() => handleEdit(h)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-holiday-${h.id}`} onClick={() => deleteMutation.mutate(h.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No holidays yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function PayFormulasTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<PayFormula | null>(null);
  const defaultForm = { companyId: "", name: "", payType: "pay_multiplied_by_factor", wageSourceType: "hourly_rate", accrualRate: "", wageGroup: "" };
  const [form, setForm] = useState(defaultForm);
  const [quickSetupCompanyId, setQuickSetupCompanyId] = useState("");

  const { data: items, isLoading } = useQuery<PayFormula[]>({ queryKey: ["/api/pay-formulas"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const quickSetupMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await apiRequest("POST", "/api/pay-formulas/quick-setup", { companyId });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-formulas"] });
      toast({ title: data.message || "Pay formulas created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = { ...data, accrualRate: data.accrualRate || undefined };
      if (editItem) {
        await apiRequest("PATCH", `/api/pay-formulas/${editItem.id}`, payload);
      } else {
        await apiRequest("POST", "/api/pay-formulas", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-formulas"] });
      toast({ title: editItem ? "Pay formula updated" : "Pay formula created" });
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
      await apiRequest("DELETE", `/api/pay-formulas/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-formulas"] });
      toast({ title: "Pay formula deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: PayFormula) => {
    setEditItem(item);
    setForm({ companyId: item.companyId, name: item.name, payType: item.payType || "pay_multiplied_by_factor", wageSourceType: item.wageSourceType || "hourly_rate", accrualRate: item.accrualRate || "", wageGroup: item.wageGroup || "" });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  const payTypeLabels: Record<string, string> = {
    pay_multiplied_by_factor: "Pay Multiplied by Factor",
    flat_rate: "Flat Rate",
    hourly_rate: "Hourly Rate",
    annual_salary: "Annual Salary",
  };

  const wageSourceLabels: Record<string, string> = {
    hourly_rate: "Hourly Rate",
    annual_salary: "Annual Salary",
    contributing_shift: "Contributing Shift",
  };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-pay-formulas">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Pay Formulas</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={quickSetupCompanyId} onValueChange={setQuickSetupCompanyId}>
            <SelectTrigger data-testid="select-pay-formula-quick-company" className="w-[180px]">
              <SelectValue placeholder="Select company" />
            </SelectTrigger>
            <SelectContent>
              {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            data-testid="button-quick-setup-pay-formulas"
            disabled={!quickSetupCompanyId || quickSetupMutation.isPending}
            onClick={() => quickSetupMutation.mutate(quickSetupCompanyId)}
          >
            <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
          </Button>
          <Dialog open={open} onOpenChange={handleDialogChange}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-pay-formula"><Plus className="w-4 h-4 mr-1" /> Add Pay Formula</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editItem ? "Edit Pay Formula" : "Add Pay Formula"}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Company</Label>
                  <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                    <SelectTrigger data-testid="select-pay-formula-company">
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
                  <Label>Name</Label>
                  <Input data-testid="input-pay-formula-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Pay Type</Label>
                    <Select value={form.payType} onValueChange={(v) => setForm({ ...form, payType: v })}>
                      <SelectTrigger data-testid="select-pay-formula-pay-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pay_multiplied_by_factor">Pay Multiplied by Factor</SelectItem>
                        <SelectItem value="flat_rate">Flat Rate</SelectItem>
                        <SelectItem value="hourly_rate">Hourly Rate</SelectItem>
                        <SelectItem value="annual_salary">Annual Salary</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Wage Source</Label>
                    <Select value={form.wageSourceType} onValueChange={(v) => setForm({ ...form, wageSourceType: v })}>
                      <SelectTrigger data-testid="select-pay-formula-wage-source">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hourly_rate">Hourly Rate</SelectItem>
                        <SelectItem value="annual_salary">Annual Salary</SelectItem>
                        <SelectItem value="contributing_shift">Contributing Shift</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Accrual Rate</Label>
                    <Input data-testid="input-pay-formula-accrual-rate" type="number" step="0.01" value={form.accrualRate} onChange={(e) => setForm({ ...form, accrualRate: e.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Wage Group</Label>
                    <Input data-testid="input-pay-formula-wage-group" value={form.wageGroup} onChange={(e) => setForm({ ...form, wageGroup: e.target.value })} />
                  </div>
                </div>
                <Button data-testid="button-submit-pay-formula" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                  {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Pay Type</TableHead>
                <TableHead>Wage Source</TableHead>
                <TableHead>Accrual Rate</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items && items.length > 0 ? items.map((item) => (
                <TableRow key={item.id} data-testid={`row-pay-formula-${item.id}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell><Badge variant="secondary">{payTypeLabels[item.payType || ""] || item.payType}</Badge></TableCell>
                  <TableCell>{wageSourceLabels[item.wageSourceType || ""] || item.wageSourceType}</TableCell>
                  <TableCell>{item.accrualRate || "—"}</TableCell>
                  <TableCell>{item.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-pay-formula-${item.id}`} onClick={() => handleEdit(item)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-pay-formula-${item.id}`} onClick={() => deleteMutation.mutate(item.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No pay formulas yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ContributingPayCodesTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<ContributingPayCode | null>(null);
  const defaultForm = { companyId: "", name: "", payCodeIds: "" };
  const [form, setForm] = useState(defaultForm);
  const [quickSetupCompanyId, setQuickSetupCompanyId] = useState("");

  const { data: items, isLoading } = useQuery<ContributingPayCode[]>({ queryKey: ["/api/contributing-pay-codes"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const quickSetupMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await apiRequest("POST", "/api/contributing-pay-codes/quick-setup", { companyId });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contributing-pay-codes"] });
      toast({ title: data.message || "Contributing pay codes created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      if (editItem) {
        await apiRequest("PATCH", `/api/contributing-pay-codes/${editItem.id}`, data);
      } else {
        await apiRequest("POST", "/api/contributing-pay-codes", data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contributing-pay-codes"] });
      toast({ title: editItem ? "Contributing pay code updated" : "Contributing pay code created" });
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
      await apiRequest("DELETE", `/api/contributing-pay-codes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contributing-pay-codes"] });
      toast({ title: "Contributing pay code deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: ContributingPayCode) => {
    setEditItem(item);
    setForm({ companyId: item.companyId, name: item.name, payCodeIds: item.payCodeIds || "" });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-contributing-pay-codes">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Contributing Pay Codes</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={quickSetupCompanyId} onValueChange={setQuickSetupCompanyId}>
            <SelectTrigger data-testid="select-contributing-pay-code-quick-company" className="w-[180px]">
              <SelectValue placeholder="Select company" />
            </SelectTrigger>
            <SelectContent>
              {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            data-testid="button-quick-setup-contributing-pay-codes"
            disabled={!quickSetupCompanyId || quickSetupMutation.isPending}
            onClick={() => quickSetupMutation.mutate(quickSetupCompanyId)}
          >
            <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
          </Button>
          <Dialog open={open} onOpenChange={handleDialogChange}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-contributing-pay-code"><Plus className="w-4 h-4 mr-1" /> Add Contributing Pay Code</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editItem ? "Edit Contributing Pay Code" : "Add Contributing Pay Code"}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Company</Label>
                  <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                    <SelectTrigger data-testid="select-contributing-pay-code-company">
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
                  <Label>Name</Label>
                  <Input data-testid="input-contributing-pay-code-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Pay Code IDs (comma-separated)</Label>
                  <Input data-testid="input-contributing-pay-code-ids" value={form.payCodeIds} onChange={(e) => setForm({ ...form, payCodeIds: e.target.value })} />
                </div>
                <Button data-testid="button-submit-contributing-pay-code" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                  {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Pay Code IDs</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items && items.length > 0 ? items.map((item) => (
                <TableRow key={item.id} data-testid={`row-contributing-pay-code-${item.id}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>{item.payCodeIds || "—"}</TableCell>
                  <TableCell>{item.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-contributing-pay-code-${item.id}`} onClick={() => handleEdit(item)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-contributing-pay-code-${item.id}`} onClick={() => deleteMutation.mutate(item.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">No contributing pay codes yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ContributingShiftsTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<ContributingShift | null>(null);
  const defaultForm = {
    companyId: "", name: "", shiftTypeCode: "", filterType: "date", includeHolidayType: "no_effect",
    contributesToOvertime: true, contributesToAccrual: true, contributesToPremium: true, contributesToCompliance: true,
    sunFilter: true, monFilter: true, tueFilter: true, wedFilter: true, thuFilter: true, friFilter: true, satFilter: true,
  };
  const [form, setForm] = useState(defaultForm);
  const [quickSetupCompanyId, setQuickSetupCompanyId] = useState("");

  const { data: items, isLoading } = useQuery<ContributingShift[]>({ queryKey: ["/api/contributing-shifts"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const quickSetupMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await apiRequest("POST", "/api/contributing-shifts/quick-setup", { companyId });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contributing-shifts"] });
      toast({ title: data.message || "Contributing shifts created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      if (editItem) {
        await apiRequest("PATCH", `/api/contributing-shifts/${editItem.id}`, data);
      } else {
        await apiRequest("POST", "/api/contributing-shifts", data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contributing-shifts"] });
      toast({ title: editItem ? "Contributing shift updated" : "Contributing shift created" });
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
      await apiRequest("DELETE", `/api/contributing-shifts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contributing-shifts"] });
      toast({ title: "Contributing shift deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: ContributingShift) => {
    setEditItem(item);
    setForm({
      companyId: item.companyId, name: item.name, shiftTypeCode: item.shiftTypeCode || "",
      filterType: item.filterType || "date", includeHolidayType: item.includeHolidayType || "no_effect",
      contributesToOvertime: item.contributesToOvertime ?? true, contributesToAccrual: item.contributesToAccrual ?? true,
      contributesToPremium: item.contributesToPremium ?? true, contributesToCompliance: item.contributesToCompliance ?? true,
      sunFilter: item.sunFilter ?? true, monFilter: item.monFilter ?? true, tueFilter: item.tueFilter ?? true, wedFilter: item.wedFilter ?? true,
      thuFilter: item.thuFilter ?? true, friFilter: item.friFilter ?? true, satFilter: item.satFilter ?? true,
    });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  const filterTypeLabels: Record<string, string> = { date: "Date", time: "Time", branch: "Branch", department: "Department" };
  const holidayTypeLabels: Record<string, string> = { no_effect: "No Effect", always_on_holidays: "Always on Holidays", never_on_holidays: "Never on Holidays" };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-contributing-shifts">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Contributing Shifts</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={quickSetupCompanyId} onValueChange={setQuickSetupCompanyId}>
            <SelectTrigger data-testid="select-contributing-shift-quick-company" className="w-[180px]">
              <SelectValue placeholder="Select company" />
            </SelectTrigger>
            <SelectContent>
              {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            data-testid="button-quick-setup-contributing-shifts"
            disabled={!quickSetupCompanyId || quickSetupMutation.isPending}
            onClick={() => quickSetupMutation.mutate(quickSetupCompanyId)}
          >
            <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
          </Button>
          <Dialog open={open} onOpenChange={handleDialogChange}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-contributing-shift"><Plus className="w-4 h-4 mr-1" /> Add Contributing Shift</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editItem ? "Edit Contributing Shift" : "Add Contributing Shift"}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Company</Label>
                    <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                      <SelectTrigger data-testid="select-contributing-shift-company">
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
                    <Label>Shift Type Code</Label>
                    <Input data-testid="input-contributing-shift-type-code" placeholder="e.g. DAY_SHIFT" value={form.shiftTypeCode} onChange={(e) => setForm({ ...form, shiftTypeCode: e.target.value.toUpperCase() })} />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Name</Label>
                  <Input data-testid="input-contributing-shift-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">Contributes To</Label>
                  <div className="flex flex-wrap gap-4">
                    {([
                      { key: "contributesToOvertime", label: "Overtime" },
                      { key: "contributesToAccrual", label: "PTO Accrual" },
                      { key: "contributesToPremium", label: "Shift Premium" },
                      { key: "contributesToCompliance", label: "Compliance" },
                    ] as const).map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-1">
                        <Checkbox
                          id={`shift-${key}`}
                          data-testid={`checkbox-contributing-shift-${key}`}
                          checked={form[key] as boolean}
                          onCheckedChange={(v) => setForm({ ...form, [key]: !!v })}
                        />
                        <Label htmlFor={`shift-${key}`}>{label}</Label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Filter Type</Label>
                    <Select value={form.filterType} onValueChange={(v) => setForm({ ...form, filterType: v })}>
                      <SelectTrigger data-testid="select-contributing-shift-filter-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="date">Date</SelectItem>
                        <SelectItem value="time">Time</SelectItem>
                        <SelectItem value="branch">Branch</SelectItem>
                        <SelectItem value="department">Department</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Holiday Type</Label>
                    <Select value={form.includeHolidayType} onValueChange={(v) => setForm({ ...form, includeHolidayType: v })}>
                      <SelectTrigger data-testid="select-contributing-shift-holiday-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="no_effect">No Effect</SelectItem>
                        <SelectItem value="always_on_holidays">Always on Holidays</SelectItem>
                        <SelectItem value="never_on_holidays">Never on Holidays</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">Active Days</Label>
                  <div className="flex flex-wrap gap-4">
                    {(["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const).map((day) => {
                      const key = `${day}Filter` as keyof typeof form;
                      return (
                        <div key={day} className="flex items-center gap-1">
                          <Checkbox
                            id={`shift-${day}`}
                            data-testid={`checkbox-contributing-shift-${day}`}
                            checked={form[key] as boolean}
                            onCheckedChange={(v) => setForm({ ...form, [key]: !!v })}
                          />
                          <Label htmlFor={`shift-${day}`}>{day.charAt(0).toUpperCase() + day.slice(1)}</Label>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <Button data-testid="button-submit-contributing-shift" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                  {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Shift Code</TableHead>
                <TableHead>Contributes To</TableHead>
                <TableHead>Filter</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items && items.length > 0 ? items.map((item) => (
                <TableRow key={item.id} data-testid={`row-contributing-shift-${item.id}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell><Badge variant="outline" className="font-mono text-xs">{item.shiftTypeCode || "—"}</Badge></TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {item.contributesToOvertime && <Badge variant="secondary" className="text-xs">OT</Badge>}
                      {item.contributesToAccrual && <Badge variant="secondary" className="text-xs">Accrual</Badge>}
                      {item.contributesToPremium && <Badge variant="secondary" className="text-xs">Premium</Badge>}
                      {item.contributesToCompliance && <Badge variant="secondary" className="text-xs">Compliance</Badge>}
                      {!item.contributesToOvertime && !item.contributesToAccrual && !item.contributesToPremium && !item.contributesToCompliance && <span className="text-muted-foreground text-xs">None</span>}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{filterTypeLabels[item.filterType || ""] || item.filterType}</Badge></TableCell>
                  <TableCell>{item.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-contributing-shift-${item.id}`} onClick={() => handleEdit(item)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-contributing-shift-${item.id}`} onClick={() => deleteMutation.mutate(item.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No contributing shifts yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function RegularTimePoliciesTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<RegularTimePolicy | null>(null);
  const defaultForm = { companyId: "__universal__", name: "", calculationOrder: "", payCodeId: "", payFormulaId: "", maxTime: "" };
  const [form, setForm] = useState(defaultForm);
    const [quickSetupCompanyId, setQuickSetupCompanyId] = useState("");

  const { data: items, isLoading } = useQuery<RegularTimePolicy[]>({ queryKey: ["/api/regular-time-policies"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const quickSetupMutation = useMutation({
      mutationFn: async (companyId: string) => {
        const res = await apiRequest("POST", "/api/regular-time-policies/quick-setup", { companyId });
        return res.json();
      },
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ["/api/regular-time-policies"] });
        toast({ title: data.message || "Regular time policies created" });
      },
      onError: (err: Error) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    });

    const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = { ...data, companyId: data.companyId === "__universal__" ? null : data.companyId, calculationOrder: data.calculationOrder ? parseInt(data.calculationOrder) : undefined, maxTime: data.maxTime || undefined };
      if (editItem) {
        await apiRequest("PATCH", `/api/regular-time-policies/${editItem.id}`, payload);
      } else {
        await apiRequest("POST", "/api/regular-time-policies", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/regular-time-policies"] });
      toast({ title: editItem ? "Regular time policy updated" : "Regular time policy created" });
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
      await apiRequest("DELETE", `/api/regular-time-policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/regular-time-policies"] });
      toast({ title: "Regular time policy deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: RegularTimePolicy) => {
    setEditItem(item);
    setForm({ companyId: item.companyId || "__universal__", name: item.name, calculationOrder: item.calculationOrder?.toString() || "", payCodeId: item.payCodeId || "", payFormulaId: item.payFormulaId || "", maxTime: item.maxTime || "" });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-regular-time-policies">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Regular Time Policies</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={quickSetupCompanyId} onValueChange={setQuickSetupCompanyId}>
              <SelectTrigger data-testid="select-regular-time-quick-company" className="w-[180px]">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              data-testid="button-quick-setup-regular-time-policies"
              disabled={!quickSetupCompanyId || quickSetupMutation.isPending}
              onClick={() => quickSetupMutation.mutate(quickSetupCompanyId)}
            >
              <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
            </Button>
            <Dialog open={open} onOpenChange={handleDialogChange}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-regular-time-policy"><Plus className="w-4 h-4 mr-1" /> Add Regular Time Policy</Button>
              </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editItem ? "Edit Regular Time Policy" : "Add Regular Time Policy"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger data-testid="select-regular-time-company">
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
                <Label>Name</Label>
                <Input data-testid="input-regular-time-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Calculation Order</Label>
                  <Input data-testid="input-regular-time-order" type="number" value={form.calculationOrder} onChange={(e) => setForm({ ...form, calculationOrder: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Max Time (hours)</Label>
                  <Input data-testid="input-regular-time-max" type="number" step="0.01" value={form.maxTime} onChange={(e) => setForm({ ...form, maxTime: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Pay Code ID</Label>
                  <Input data-testid="input-regular-time-pay-code" value={form.payCodeId} onChange={(e) => setForm({ ...form, payCodeId: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Pay Formula ID</Label>
                  <Input data-testid="input-regular-time-pay-formula" value={form.payFormulaId} onChange={(e) => setForm({ ...form, payFormulaId: e.target.value })} />
                </div>
              </div>
              <Button data-testid="button-submit-regular-time-policy" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
              </Button>
            </div>
          </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Max Time</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items && items.length > 0 ? items.map((item) => (
                <TableRow key={item.id} data-testid={`row-regular-time-policy-${item.id}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>{item.calculationOrder ?? "—"}</TableCell>
                  <TableCell>{item.maxTime ? `${item.maxTime}h` : "—"}</TableCell>
                  <TableCell>{item.companyId ? (companies?.find(c => c.id === item.companyId)?.name ?? "—") : <Badge variant="outline" className="text-xs">Universal</Badge>}</TableCell>
                  <TableCell>{item.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-regular-time-policy-${item.id}`} onClick={() => handleEdit(item)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-regular-time-policy-${item.id}`} onClick={() => deleteMutation.mutate(item.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No regular time policies yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function OvertimePoliciesTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<OvertimePolicy | null>(null);
  const defaultForm = { companyId: "__universal__", name: "", type: "daily", triggerTime: "8", rate: "1.5", payCodeId: "" };
  const [form, setForm] = useState(defaultForm);
    const [quickSetupCompanyId, setQuickSetupCompanyId] = useState("");

  const { data: items, isLoading } = useQuery<OvertimePolicy[]>({ queryKey: ["/api/overtime-policies"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const quickSetupMutation = useMutation({
      mutationFn: async (companyId: string) => {
        const res = await apiRequest("POST", "/api/overtime-policies/quick-setup", { companyId });
        return res.json();
      },
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ["/api/overtime-policies"] });
        toast({ title: data.message || "Overtime policies created" });
      },
      onError: (err: Error) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    });

    const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = { ...data, companyId: data.companyId === "__universal__" ? null : data.companyId, triggerTime: data.triggerTime || undefined, rate: data.rate || undefined };
      if (editItem) {
        await apiRequest("PATCH", `/api/overtime-policies/${editItem.id}`, payload);
      } else {
        await apiRequest("POST", "/api/overtime-policies", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overtime-policies"] });
      toast({ title: editItem ? "Overtime policy updated" : "Overtime policy created" });
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
      await apiRequest("DELETE", `/api/overtime-policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overtime-policies"] });
      toast({ title: "Overtime policy deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: OvertimePolicy) => {
    setEditItem(item);
    setForm({ companyId: item.companyId || "__universal__", name: item.name, type: item.type || "daily", triggerTime: item.triggerTime || "8", rate: item.rate || "1.5", payCodeId: item.payCodeId || "" });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  const typeLabels: Record<string, string> = { daily: "Daily", weekly: "Weekly", biweekly: "Biweekly", consecutive_days: "Consecutive Days" };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-overtime-policies">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Overtime Policies</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={quickSetupCompanyId} onValueChange={setQuickSetupCompanyId}>
              <SelectTrigger data-testid="select-overtime-quick-company" className="w-[180px]">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              data-testid="button-quick-setup-overtime-policies"
              disabled={!quickSetupCompanyId || quickSetupMutation.isPending}
              onClick={() => quickSetupMutation.mutate(quickSetupCompanyId)}
            >
              <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
            </Button>
            <Dialog open={open} onOpenChange={handleDialogChange}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-overtime-policy"><Plus className="w-4 h-4 mr-1" /> Add Overtime Policy</Button>
              </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editItem ? "Edit Overtime Policy" : "Add Overtime Policy"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger data-testid="select-overtime-company">
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
                <Label>Name</Label>
                <Input data-testid="input-overtime-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger data-testid="select-overtime-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Biweekly</SelectItem>
                      <SelectItem value="consecutive_days">Consecutive Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Pay Code ID</Label>
                  <Input data-testid="input-overtime-pay-code" value={form.payCodeId} onChange={(e) => setForm({ ...form, payCodeId: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Trigger Time (hours)</Label>
                  <Input data-testid="input-overtime-trigger" type="number" step="0.01" value={form.triggerTime} onChange={(e) => setForm({ ...form, triggerTime: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Rate (multiplier)</Label>
                  <Input data-testid="input-overtime-rate" type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
                </div>
              </div>
              <Button data-testid="button-submit-overtime-policy" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
              </Button>
            </div>
          </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Trigger Time</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items && items.length > 0 ? items.map((item) => (
                <TableRow key={item.id} data-testid={`row-overtime-policy-${item.id}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell><Badge variant="secondary">{typeLabels[item.type || ""] || item.type}</Badge></TableCell>
                  <TableCell>{item.triggerTime ? `${item.triggerTime}h` : "—"}</TableCell>
                  <TableCell>{item.rate ? `${item.rate}x` : "—"}</TableCell>
                  <TableCell>{item.companyId ? (companies?.find(c => c.id === item.companyId)?.name ?? "—") : <Badge variant="outline" className="text-xs">Universal</Badge>}</TableCell>
                  <TableCell>{item.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-overtime-policy-${item.id}`} onClick={() => handleEdit(item)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-overtime-policy-${item.id}`} onClick={() => deleteMutation.mutate(item.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No overtime policies yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function PremiumPoliciesTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<PremiumPolicy | null>(null);
  const defaultForm = { companyId: "__universal__", name: "", type: "date_time", holidayHandling: "no_effect", dailyTriggerHours: "", weeklyTriggerHours: "", includePartialPunches: false };
  const [form, setForm] = useState(defaultForm);
    const [quickSetupCompanyId, setQuickSetupCompanyId] = useState("");

  const { data: items, isLoading } = useQuery<PremiumPolicy[]>({ queryKey: ["/api/premium-policies"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const quickSetupMutation = useMutation({
      mutationFn: async (companyId: string) => {
        const res = await apiRequest("POST", "/api/premium-policies/quick-setup", { companyId });
        return res.json();
      },
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ["/api/premium-policies"] });
        toast({ title: data.message || "Premium policies created" });
      },
      onError: (err: Error) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    });

    const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = { ...data, companyId: data.companyId === "__universal__" ? null : data.companyId, dailyTriggerHours: data.dailyTriggerHours || undefined, weeklyTriggerHours: data.weeklyTriggerHours || undefined };
      if (editItem) {
        await apiRequest("PATCH", `/api/premium-policies/${editItem.id}`, payload);
      } else {
        await apiRequest("POST", "/api/premium-policies", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/premium-policies"] });
      toast({ title: editItem ? "Premium policy updated" : "Premium policy created" });
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
      await apiRequest("DELETE", `/api/premium-policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/premium-policies"] });
      toast({ title: "Premium policy deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: PremiumPolicy) => {
    setEditItem(item);
    setForm({ companyId: item.companyId || "__universal__", name: item.name, type: item.type || "date_time", holidayHandling: item.holidayHandling || "no_effect", dailyTriggerHours: item.dailyTriggerHours || "", weeklyTriggerHours: item.weeklyTriggerHours || "", includePartialPunches: item.includePartialPunches ?? false });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  const typeLabels: Record<string, string> = {
    date_time: "Date/Time", shift_differential: "Shift Differential", meal_break: "Meal Break",
    callback: "Callback", minimum_shift_time: "Minimum Shift Time", holiday: "Holiday", advanced: "Advanced",
  };
  const holidayLabels: Record<string, string> = { no_effect: "No Effect", always_on_holidays: "Always on Holidays", never_on_holidays: "Never on Holidays" };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-premium-policies">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Premium Policies</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={quickSetupCompanyId} onValueChange={setQuickSetupCompanyId}>
              <SelectTrigger data-testid="select-premium-quick-company" className="w-[180px]">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              data-testid="button-quick-setup-premium-policies"
              disabled={!quickSetupCompanyId || quickSetupMutation.isPending}
              onClick={() => quickSetupMutation.mutate(quickSetupCompanyId)}
            >
              <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
            </Button>
            <Dialog open={open} onOpenChange={handleDialogChange}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-premium-policy"><Plus className="w-4 h-4 mr-1" /> Add Premium Policy</Button>
              </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editItem ? "Edit Premium Policy" : "Add Premium Policy"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger data-testid="select-premium-company">
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
                <Label>Name</Label>
                <Input data-testid="input-premium-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger data-testid="select-premium-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="date_time">Date/Time</SelectItem>
                      <SelectItem value="shift_differential">Shift Differential</SelectItem>
                      <SelectItem value="meal_break">Meal Break</SelectItem>
                      <SelectItem value="callback">Callback</SelectItem>
                      <SelectItem value="minimum_shift_time">Minimum Shift Time</SelectItem>
                      <SelectItem value="holiday">Holiday</SelectItem>
                      <SelectItem value="advanced">Advanced</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Holiday Handling</Label>
                  <Select value={form.holidayHandling} onValueChange={(v) => setForm({ ...form, holidayHandling: v })}>
                    <SelectTrigger data-testid="select-premium-holiday">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no_effect">No Effect</SelectItem>
                      <SelectItem value="always_on_holidays">Always on Holidays</SelectItem>
                      <SelectItem value="never_on_holidays">Never on Holidays</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Daily Trigger Hours</Label>
                  <Input data-testid="input-premium-daily-hours" type="number" step="0.01" value={form.dailyTriggerHours} onChange={(e) => setForm({ ...form, dailyTriggerHours: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Weekly Trigger Hours</Label>
                  <Input data-testid="input-premium-weekly-hours" type="number" step="0.01" value={form.weeklyTriggerHours} onChange={(e) => setForm({ ...form, weeklyTriggerHours: e.target.value })} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="premium-partial"
                  data-testid="checkbox-premium-partial"
                  checked={form.includePartialPunches}
                  onCheckedChange={(v) => setForm({ ...form, includePartialPunches: !!v })}
                />
                <Label htmlFor="premium-partial">Include Partial Punches</Label>
              </div>
              <Button data-testid="button-submit-premium-policy" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
              </Button>
            </div>
          </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Holiday Handling</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items && items.length > 0 ? items.map((item) => (
                <TableRow key={item.id} data-testid={`row-premium-policy-${item.id}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell><Badge variant="secondary">{typeLabels[item.type || ""] || item.type}</Badge></TableCell>
                  <TableCell>{holidayLabels[item.holidayHandling || ""] || item.holidayHandling}</TableCell>
                  <TableCell>{item.companyId ? (companies?.find(c => c.id === item.companyId)?.name ?? "—") : <Badge variant="outline" className="text-xs">Universal</Badge>}</TableCell>
                  <TableCell>{item.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-premium-policy-${item.id}`} onClick={() => handleEdit(item)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-premium-policy-${item.id}`} onClick={() => deleteMutation.mutate(item.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No premium policies yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function MealPoliciesTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<MealPolicy | null>(null);
  const defaultForm = { companyId: "__universal__", name: "", type: "normal", activeAfter: "5", mealTime: "0.5", autoDetectBy: "time_window" };
  const [form, setForm] = useState(defaultForm);
    const [quickSetupCompanyId, setQuickSetupCompanyId] = useState("");

  const { data: items, isLoading } = useQuery<MealPolicy[]>({ queryKey: ["/api/meal-policies"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const quickSetupMutation = useMutation({
      mutationFn: async (companyId: string) => {
        const res = await apiRequest("POST", "/api/meal-policies/quick-setup", { companyId });
        return res.json();
      },
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ["/api/meal-policies"] });
        toast({ title: data.message || "Meal policies created" });
      },
      onError: (err: Error) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    });

    const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = { ...data, companyId: data.companyId === "__universal__" ? null : data.companyId, activeAfter: data.activeAfter || undefined, mealTime: data.mealTime || undefined };
      if (editItem) {
        await apiRequest("PATCH", `/api/meal-policies/${editItem.id}`, payload);
      } else {
        await apiRequest("POST", "/api/meal-policies", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meal-policies"] });
      toast({ title: editItem ? "Meal policy updated" : "Meal policy created" });
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
      await apiRequest("DELETE", `/api/meal-policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meal-policies"] });
      toast({ title: "Meal policy deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: MealPolicy) => {
    setEditItem(item);
    setForm({ companyId: item.companyId || "__universal__", name: item.name, type: item.type || "normal", activeAfter: item.activeAfter || "5", mealTime: item.mealTime || "0.5", autoDetectBy: item.autoDetectBy || "time_window" });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  const typeLabels: Record<string, string> = { normal: "Normal", auto_deduct: "Auto Deduct", auto_add: "Auto Add" };
  const detectLabels: Record<string, string> = { time_window: "Time Window", punch_time_proactive: "Punch Time Proactive", punch_time_reactive: "Punch Time Reactive" };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-meal-policies">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Meal Policies</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={quickSetupCompanyId} onValueChange={setQuickSetupCompanyId}>
              <SelectTrigger data-testid="select-meal-quick-company" className="w-[180px]">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              data-testid="button-quick-setup-meal-policies"
              disabled={!quickSetupCompanyId || quickSetupMutation.isPending}
              onClick={() => quickSetupMutation.mutate(quickSetupCompanyId)}
            >
              <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
            </Button>
            <Dialog open={open} onOpenChange={handleDialogChange}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-meal-policy"><Plus className="w-4 h-4 mr-1" /> Add Meal Policy</Button>
              </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editItem ? "Edit Meal Policy" : "Add Meal Policy"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger data-testid="select-meal-company">
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
                <Label>Name</Label>
                <Input data-testid="input-meal-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger data-testid="select-meal-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="auto_deduct">Auto Deduct</SelectItem>
                      <SelectItem value="auto_add">Auto Add</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Auto Detect By</Label>
                  <Select value={form.autoDetectBy} onValueChange={(v) => setForm({ ...form, autoDetectBy: v })}>
                    <SelectTrigger data-testid="select-meal-detect">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="time_window">Time Window</SelectItem>
                      <SelectItem value="punch_time_proactive">Punch Time Proactive</SelectItem>
                      <SelectItem value="punch_time_reactive">Punch Time Reactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Active After (hours)</Label>
                  <Input data-testid="input-meal-active-after" type="number" step="0.01" value={form.activeAfter} onChange={(e) => setForm({ ...form, activeAfter: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Meal Time (hours)</Label>
                  <Input data-testid="input-meal-time" type="number" step="0.01" value={form.mealTime} onChange={(e) => setForm({ ...form, mealTime: e.target.value })} />
                </div>
              </div>
              <Button data-testid="button-submit-meal-policy" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
              </Button>
            </div>
          </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Active After</TableHead>
                <TableHead>Meal Time</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items && items.length > 0 ? items.map((item) => (
                <TableRow key={item.id} data-testid={`row-meal-policy-${item.id}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell><Badge variant="secondary">{typeLabels[item.type || ""] || item.type}</Badge></TableCell>
                  <TableCell>{item.activeAfter ? `${item.activeAfter}h` : "—"}</TableCell>
                  <TableCell>{item.mealTime ? `${item.mealTime}h` : "—"}</TableCell>
                  <TableCell>{item.companyId ? (companies?.find(c => c.id === item.companyId)?.name ?? "—") : <Badge variant="outline" className="text-xs">Universal</Badge>}</TableCell>
                  <TableCell>{item.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-meal-policy-${item.id}`} onClick={() => handleEdit(item)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-meal-policy-${item.id}`} onClick={() => deleteMutation.mutate(item.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No meal policies yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function BreakPoliciesTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<BreakPolicy | null>(null);
  const defaultForm = { companyId: "__universal__", name: "", type: "normal", activeAfter: "4", breakTime: "0.25", autoDetectBy: "time_window" };
  const [form, setForm] = useState(defaultForm);
    const [quickSetupCompanyId, setQuickSetupCompanyId] = useState("");

  const { data: items, isLoading } = useQuery<BreakPolicy[]>({ queryKey: ["/api/break-policies"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const quickSetupMutation = useMutation({
      mutationFn: async (companyId: string) => {
        const res = await apiRequest("POST", "/api/break-policies/quick-setup", { companyId });
        return res.json();
      },
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ["/api/break-policies"] });
        toast({ title: data.message || "Break policies created" });
      },
      onError: (err: Error) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    });

    const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = { ...data, companyId: data.companyId === "__universal__" ? null : data.companyId, activeAfter: data.activeAfter || undefined, breakTime: data.breakTime || undefined };
      if (editItem) {
        await apiRequest("PATCH", `/api/break-policies/${editItem.id}`, payload);
      } else {
        await apiRequest("POST", "/api/break-policies", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/break-policies"] });
      toast({ title: editItem ? "Break policy updated" : "Break policy created" });
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
      await apiRequest("DELETE", `/api/break-policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/break-policies"] });
      toast({ title: "Break policy deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: BreakPolicy) => {
    setEditItem(item);
    setForm({ companyId: item.companyId || "__universal__", name: item.name, type: item.type || "normal", activeAfter: item.activeAfter || "4", breakTime: item.breakTime || "0.25", autoDetectBy: item.autoDetectBy || "time_window" });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  const typeLabels: Record<string, string> = { normal: "Normal", auto_deduct: "Auto Deduct", auto_add: "Auto Add" };
  const detectLabels: Record<string, string> = { time_window: "Time Window", punch_time_proactive: "Punch Time Proactive", punch_time_reactive: "Punch Time Reactive" };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-break-policies">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Break Policies</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={quickSetupCompanyId} onValueChange={setQuickSetupCompanyId}>
              <SelectTrigger data-testid="select-break-quick-company" className="w-[180px]">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              data-testid="button-quick-setup-break-policies"
              disabled={!quickSetupCompanyId || quickSetupMutation.isPending}
              onClick={() => quickSetupMutation.mutate(quickSetupCompanyId)}
            >
              <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
            </Button>
            <Dialog open={open} onOpenChange={handleDialogChange}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-break-policy"><Plus className="w-4 h-4 mr-1" /> Add Break Policy</Button>
              </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editItem ? "Edit Break Policy" : "Add Break Policy"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger data-testid="select-break-company">
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
                <Label>Name</Label>
                <Input data-testid="input-break-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger data-testid="select-break-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="auto_deduct">Auto Deduct</SelectItem>
                      <SelectItem value="auto_add">Auto Add</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Auto Detect By</Label>
                  <Select value={form.autoDetectBy} onValueChange={(v) => setForm({ ...form, autoDetectBy: v })}>
                    <SelectTrigger data-testid="select-break-detect">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="time_window">Time Window</SelectItem>
                      <SelectItem value="punch_time_proactive">Punch Time Proactive</SelectItem>
                      <SelectItem value="punch_time_reactive">Punch Time Reactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Active After (hours)</Label>
                  <Input data-testid="input-break-active-after" type="number" step="0.01" value={form.activeAfter} onChange={(e) => setForm({ ...form, activeAfter: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Break Time (hours)</Label>
                  <Input data-testid="input-break-time" type="number" step="0.01" value={form.breakTime} onChange={(e) => setForm({ ...form, breakTime: e.target.value })} />
                </div>
              </div>
              <Button data-testid="button-submit-break-policy" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
              </Button>
            </div>
          </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Active After</TableHead>
                <TableHead>Break Time</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items && items.length > 0 ? items.map((item) => (
                <TableRow key={item.id} data-testid={`row-break-policy-${item.id}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell><Badge variant="secondary">{typeLabels[item.type || ""] || item.type}</Badge></TableCell>
                  <TableCell>{item.activeAfter ? `${item.activeAfter}h` : "—"}</TableCell>
                  <TableCell>{item.breakTime ? `${item.breakTime}h` : "—"}</TableCell>
                  <TableCell>{item.companyId ? (companies?.find(c => c.id === item.companyId)?.name ?? "—") : <Badge variant="outline" className="text-xs">Universal</Badge>}</TableCell>
                  <TableCell>{item.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-break-policy-${item.id}`} onClick={() => handleEdit(item)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-break-policy-${item.id}`} onClick={() => deleteMutation.mutate(item.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No break policies yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SchedulePoliciesTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<SchedulePolicy | null>(null);
  const defaultForm = { companyId: "__universal__", name: "", regularTimePolicyAction: "include", overtimePolicyAction: "include", premiumPolicyAction: "include", startStopWindow: "1" };
  const [form, setForm] = useState(defaultForm);
    const [quickSetupCompanyId, setQuickSetupCompanyId] = useState("");

  const { data: items, isLoading } = useQuery<SchedulePolicy[]>({ queryKey: ["/api/schedule-policies"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const quickSetupMutation = useMutation({
      mutationFn: async (companyId: string) => {
        const res = await apiRequest("POST", "/api/schedule-policies/quick-setup", { companyId });
        return res.json();
      },
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ["/api/schedule-policies"] });
        toast({ title: data.message || "Schedule policies created" });
      },
      onError: (err: Error) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    });

    const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = { ...data, companyId: data.companyId === "__universal__" ? null : data.companyId, startStopWindow: data.startStopWindow || undefined };
      if (editItem) {
        await apiRequest("PATCH", `/api/schedule-policies/${editItem.id}`, payload);
      } else {
        await apiRequest("POST", "/api/schedule-policies", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-policies"] });
      toast({ title: editItem ? "Schedule policy updated" : "Schedule policy created" });
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
      await apiRequest("DELETE", `/api/schedule-policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-policies"] });
      toast({ title: "Schedule policy deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: SchedulePolicy) => {
    setEditItem(item);
    setForm({ companyId: item.companyId || "__universal__", name: item.name, regularTimePolicyAction: item.regularTimePolicyAction || "include", overtimePolicyAction: item.overtimePolicyAction || "include", premiumPolicyAction: item.premiumPolicyAction || "include", startStopWindow: item.startStopWindow || "1" });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  const actionLabels: Record<string, string> = { include: "Include", exclude: "Exclude" };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-schedule-policies">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Schedule Policies</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={quickSetupCompanyId} onValueChange={setQuickSetupCompanyId}>
              <SelectTrigger data-testid="select-schedule-policy-quick-company" className="w-[180px]">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              data-testid="button-quick-setup-schedule-policies"
              disabled={!quickSetupCompanyId || quickSetupMutation.isPending}
              onClick={() => quickSetupMutation.mutate(quickSetupCompanyId)}
            >
              <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
            </Button>
            <Dialog open={open} onOpenChange={handleDialogChange}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-schedule-policy"><Plus className="w-4 h-4 mr-1" /> Add Schedule Policy</Button>
              </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editItem ? "Edit Schedule Policy" : "Add Schedule Policy"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger data-testid="select-schedule-company">
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
                <Label>Name</Label>
                <Input data-testid="input-schedule-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Regular Time Action</Label>
                  <Select value={form.regularTimePolicyAction} onValueChange={(v) => setForm({ ...form, regularTimePolicyAction: v })}>
                    <SelectTrigger data-testid="select-schedule-regular-action">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="include">Include</SelectItem>
                      <SelectItem value="exclude">Exclude</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Overtime Action</Label>
                  <Select value={form.overtimePolicyAction} onValueChange={(v) => setForm({ ...form, overtimePolicyAction: v })}>
                    <SelectTrigger data-testid="select-schedule-overtime-action">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="include">Include</SelectItem>
                      <SelectItem value="exclude">Exclude</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Premium Action</Label>
                  <Select value={form.premiumPolicyAction} onValueChange={(v) => setForm({ ...form, premiumPolicyAction: v })}>
                    <SelectTrigger data-testid="select-schedule-premium-action">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="include">Include</SelectItem>
                      <SelectItem value="exclude">Exclude</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Start/Stop Window (hours)</Label>
                  <Input data-testid="input-schedule-window" type="number" step="0.01" value={form.startStopWindow} onChange={(e) => setForm({ ...form, startStopWindow: e.target.value })} />
                </div>
              </div>
              <Button data-testid="button-submit-schedule-policy" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
              </Button>
            </div>
          </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Regular Time</TableHead>
                <TableHead>Overtime</TableHead>
                <TableHead>Premium</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items && items.length > 0 ? items.map((item) => (
                <TableRow key={item.id} data-testid={`row-schedule-policy-${item.id}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell><Badge variant="secondary">{actionLabels[item.regularTimePolicyAction || ""] || item.regularTimePolicyAction}</Badge></TableCell>
                  <TableCell><Badge variant="secondary">{actionLabels[item.overtimePolicyAction || ""] || item.overtimePolicyAction}</Badge></TableCell>
                  <TableCell><Badge variant="secondary">{actionLabels[item.premiumPolicyAction || ""] || item.premiumPolicyAction}</Badge></TableCell>
                  <TableCell>{item.startStopWindow ? `${item.startStopWindow}h` : "—"}</TableCell>
                  <TableCell>{item.companyId ? (companies?.find(c => c.id === item.companyId)?.name ?? "—") : <Badge variant="outline" className="text-xs">Universal</Badge>}</TableCell>
                  <TableCell>{item.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-schedule-policy-${item.id}`} onClick={() => handleEdit(item)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-schedule-policy-${item.id}`} onClick={() => deleteMutation.mutate(item.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No schedule policies yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ExceptionPoliciesTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<ExceptionPolicy | null>(null);
  const defaultForm = { companyId: "__universal__", name: "", exceptionType: "missed_punch", severity: "medium", grace: "", watchWindow: "", emailNotification: false };
  const [form, setForm] = useState(defaultForm);
    const [quickSetupCompanyId, setQuickSetupCompanyId] = useState("");

  const { data: items, isLoading } = useQuery<ExceptionPolicy[]>({ queryKey: ["/api/exception-policies"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const quickSetupMutation = useMutation({
      mutationFn: async (companyId: string) => {
        const res = await apiRequest("POST", "/api/exception-policies/quick-setup", { companyId });
        return res.json();
      },
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ["/api/exception-policies"] });
        toast({ title: data.message || "Exception policies created" });
      },
      onError: (err: Error) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    });

    const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = { ...data, companyId: data.companyId === "__universal__" ? null : data.companyId, grace: data.grace || undefined, watchWindow: data.watchWindow || undefined };
      if (editItem) {
        await apiRequest("PATCH", `/api/exception-policies/${editItem.id}`, payload);
      } else {
        await apiRequest("POST", "/api/exception-policies", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exception-policies"] });
      toast({ title: editItem ? "Exception policy updated" : "Exception policy created" });
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
      await apiRequest("DELETE", `/api/exception-policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exception-policies"] });
      toast({ title: "Exception policy deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: ExceptionPolicy) => {
    setEditItem(item);
    setForm({ companyId: item.companyId || "__universal__", name: item.name, exceptionType: item.exceptionType || "missed_punch", severity: item.severity || "medium", grace: item.grace || "", watchWindow: item.watchWindow || "", emailNotification: item.emailNotification ?? false });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  const exceptionTypeLabels: Record<string, string> = {
    missed_punch: "Missed Punch", pre_mature: "Pre-Mature", unscheduled_absence: "Unscheduled Absence",
    late_start: "Late Start", early_end: "Early End", long_break: "Long Break", short_break: "Short Break",
    over_daily_time: "Over Daily Time", over_weekly_time: "Over Weekly Time", under_daily_time: "Under Daily Time",
  };
  const severityLabels: Record<string, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
  const severityColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    low: "outline", medium: "secondary", high: "default", critical: "destructive",
  };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-exception-policies">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Exception Policies</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={quickSetupCompanyId} onValueChange={setQuickSetupCompanyId}>
              <SelectTrigger data-testid="select-exception-quick-company" className="w-[180px]">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              data-testid="button-quick-setup-exception-policies"
              disabled={!quickSetupCompanyId || quickSetupMutation.isPending}
              onClick={() => quickSetupMutation.mutate(quickSetupCompanyId)}
            >
              <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
            </Button>
            <Dialog open={open} onOpenChange={handleDialogChange}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-exception-policy"><Plus className="w-4 h-4 mr-1" /> Add Exception Policy</Button>
              </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editItem ? "Edit Exception Policy" : "Add Exception Policy"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger data-testid="select-exception-company">
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
                <Label>Name</Label>
                <Input data-testid="input-exception-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Exception Type</Label>
                  <Select value={form.exceptionType} onValueChange={(v) => setForm({ ...form, exceptionType: v })}>
                    <SelectTrigger data-testid="select-exception-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="missed_punch">Missed Punch</SelectItem>
                      <SelectItem value="pre_mature">Pre-Mature</SelectItem>
                      <SelectItem value="unscheduled_absence">Unscheduled Absence</SelectItem>
                      <SelectItem value="late_start">Late Start</SelectItem>
                      <SelectItem value="early_end">Early End</SelectItem>
                      <SelectItem value="long_break">Long Break</SelectItem>
                      <SelectItem value="short_break">Short Break</SelectItem>
                      <SelectItem value="over_daily_time">Over Daily Time</SelectItem>
                      <SelectItem value="over_weekly_time">Over Weekly Time</SelectItem>
                      <SelectItem value="under_daily_time">Under Daily Time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Severity</Label>
                  <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                    <SelectTrigger data-testid="select-exception-severity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Grace (minutes)</Label>
                  <Input data-testid="input-exception-grace" type="number" value={form.grace} onChange={(e) => setForm({ ...form, grace: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Watch Window (minutes)</Label>
                  <Input data-testid="input-exception-watch" type="number" value={form.watchWindow} onChange={(e) => setForm({ ...form, watchWindow: e.target.value })} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="exception-email"
                  data-testid="checkbox-exception-email"
                  checked={form.emailNotification}
                  onCheckedChange={(v) => setForm({ ...form, emailNotification: !!v })}
                />
                <Label htmlFor="exception-email">Email Notification</Label>
              </div>
              <Button data-testid="button-submit-exception-policy" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
              </Button>
            </div>
          </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Grace</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items && items.length > 0 ? items.map((item) => (
                <TableRow key={item.id} data-testid={`row-exception-policy-${item.id}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>{exceptionTypeLabels[item.exceptionType || ""] || item.exceptionType}</TableCell>
                  <TableCell><Badge variant={severityColors[item.severity || ""] || "secondary"}>{severityLabels[item.severity || ""] || item.severity}</Badge></TableCell>
                  <TableCell>{item.grace ? `${item.grace}m` : "—"}</TableCell>
                  <TableCell>{item.companyId ? (companies?.find(c => c.id === item.companyId)?.name ?? "—") : <Badge variant="outline" className="text-xs">Universal</Badge>}</TableCell>
                  <TableCell>{item.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-exception-policy-${item.id}`} onClick={() => handleEdit(item)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-exception-policy-${item.id}`} onClick={() => deleteMutation.mutate(item.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No exception policies yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function AccrualPoliciesTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<AccrualPolicy | null>(null);
  const defaultForm = { companyId: "__universal__", name: "", type: "standard", lengthOfServiceUnit: "years", applyFrequency: "per_pay_period", minimumEmployedDays: "" };
  const [form, setForm] = useState(defaultForm);
    const [quickSetupCompanyId, setQuickSetupCompanyId] = useState("");

  const { data: items, isLoading } = useQuery<AccrualPolicy[]>({ queryKey: ["/api/accrual-policies"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const quickSetupMutation = useMutation({
      mutationFn: async (companyId: string) => {
        const res = await apiRequest("POST", "/api/accrual-policies/quick-setup", { companyId });
        return res.json();
      },
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ["/api/accrual-policies"] });
        toast({ title: data.message || "Accrual policies created" });
      },
      onError: (err: Error) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    });

    const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = { ...data, companyId: data.companyId === "__universal__" ? null : data.companyId, minimumEmployedDays: data.minimumEmployedDays ? parseInt(data.minimumEmployedDays) : undefined };
      if (editItem) {
        await apiRequest("PATCH", `/api/accrual-policies/${editItem.id}`, payload);
      } else {
        await apiRequest("POST", "/api/accrual-policies", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accrual-policies"] });
      toast({ title: editItem ? "Accrual policy updated" : "Accrual policy created" });
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
      await apiRequest("DELETE", `/api/accrual-policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accrual-policies"] });
      toast({ title: "Accrual policy deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: AccrualPolicy) => {
    setEditItem(item);
    setForm({ companyId: item.companyId || "__universal__", name: item.name, type: item.type || "standard", lengthOfServiceUnit: item.lengthOfServiceUnit || "years", applyFrequency: item.applyFrequency || "per_pay_period", minimumEmployedDays: item.minimumEmployedDays?.toString() || "" });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  const typeLabels: Record<string, string> = { standard: "Standard", calendar_year: "Calendar Year", hour_based: "Hour Based" };
  const serviceLabels: Record<string, string> = { days: "Days", months: "Months", years: "Years" };
  const freqLabels: Record<string, string> = { per_pay_period: "Per Pay Period", annually: "Annually", monthly: "Monthly", weekly: "Weekly" };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-accrual-policies">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Accrual Policies</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={quickSetupCompanyId} onValueChange={setQuickSetupCompanyId}>
              <SelectTrigger data-testid="select-accrual-policy-quick-company" className="w-[180px]">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              data-testid="button-quick-setup-accrual-policies"
              disabled={!quickSetupCompanyId || quickSetupMutation.isPending}
              onClick={() => quickSetupMutation.mutate(quickSetupCompanyId)}
            >
              <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
            </Button>
            <Dialog open={open} onOpenChange={handleDialogChange}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-accrual-policy"><Plus className="w-4 h-4 mr-1" /> Add Accrual Policy</Button>
              </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editItem ? "Edit Accrual Policy" : "Add Accrual Policy"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger data-testid="select-accrual-policy-company">
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
                <Label>Name</Label>
                <Input data-testid="input-accrual-policy-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger data-testid="select-accrual-policy-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="calendar_year">Calendar Year</SelectItem>
                      <SelectItem value="hour_based">Hour Based</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Service Unit</Label>
                  <Select value={form.lengthOfServiceUnit} onValueChange={(v) => setForm({ ...form, lengthOfServiceUnit: v })}>
                    <SelectTrigger data-testid="select-accrual-policy-service-unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="days">Days</SelectItem>
                      <SelectItem value="months">Months</SelectItem>
                      <SelectItem value="years">Years</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Apply Frequency</Label>
                  <Select value={form.applyFrequency} onValueChange={(v) => setForm({ ...form, applyFrequency: v })}>
                    <SelectTrigger data-testid="select-accrual-policy-frequency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="per_pay_period">Per Pay Period</SelectItem>
                      <SelectItem value="annually">Annually</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Min Employed Days</Label>
                  <Input data-testid="input-accrual-policy-min-days" type="number" value={form.minimumEmployedDays} onChange={(e) => setForm({ ...form, minimumEmployedDays: e.target.value })} />
                </div>
              </div>
              <Button data-testid="button-submit-accrual-policy" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
              </Button>
            </div>
          </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Service Unit</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items && items.length > 0 ? items.map((item) => (
                <TableRow key={item.id} data-testid={`row-accrual-policy-${item.id}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell><Badge variant="secondary">{typeLabels[item.type || ""] || item.type}</Badge></TableCell>
                  <TableCell>{freqLabels[item.applyFrequency || ""] || item.applyFrequency}</TableCell>
                  <TableCell>{serviceLabels[item.lengthOfServiceUnit || ""] || item.lengthOfServiceUnit}</TableCell>
                  <TableCell>{item.companyId ? (companies?.find(c => c.id === item.companyId)?.name ?? "—") : <Badge variant="outline" className="text-xs">Universal</Badge>}</TableCell>
                  <TableCell>{item.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-accrual-policy-${item.id}`} onClick={() => handleEdit(item)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-accrual-policy-${item.id}`} onClick={() => deleteMutation.mutate(item.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No accrual policies yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function AbsencePoliciesTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<AbsencePolicy | null>(null);
  const defaultForm = { companyId: "__universal__", name: "", type: "accrual_based", rateType: "multiplied_by_factor", rateFactor: "1.0", payCodeId: "" };
  const [form, setForm] = useState(defaultForm);
    const [quickSetupCompanyId, setQuickSetupCompanyId] = useState("");

  const { data: items, isLoading } = useQuery<AbsencePolicy[]>({ queryKey: ["/api/absence-policies"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const quickSetupMutation = useMutation({
      mutationFn: async (companyId: string) => {
        const res = await apiRequest("POST", "/api/absence-policies/quick-setup", { companyId });
        return res.json();
      },
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ["/api/absence-policies"] });
        toast({ title: data.message || "Absence policies created" });
      },
      onError: (err: Error) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    });

    const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = { ...data, companyId: data.companyId === "__universal__" ? null : data.companyId, rateFactor: data.rateFactor || undefined };
      if (editItem) {
        await apiRequest("PATCH", `/api/absence-policies/${editItem.id}`, payload);
      } else {
        await apiRequest("POST", "/api/absence-policies", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/absence-policies"] });
      toast({ title: editItem ? "Absence policy updated" : "Absence policy created" });
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
      await apiRequest("DELETE", `/api/absence-policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/absence-policies"] });
      toast({ title: "Absence policy deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: AbsencePolicy) => {
    setEditItem(item);
    setForm({ companyId: item.companyId || "__universal__", name: item.name, type: item.type || "accrual_based", rateType: item.rateType || "multiplied_by_factor", rateFactor: item.rateFactor || "1.0", payCodeId: item.payCodeId || "" });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  const typeLabels: Record<string, string> = { accrual_based: "Accrual Based", non_accrual: "Non-Accrual" };
  const rateTypeLabels: Record<string, string> = { multiplied_by_factor: "Multiplied by Factor", flat_rate: "Flat Rate" };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-absence-policies">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Absence Policies</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={quickSetupCompanyId} onValueChange={setQuickSetupCompanyId}>
              <SelectTrigger data-testid="select-absence-quick-company" className="w-[180px]">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              data-testid="button-quick-setup-absence-policies"
              disabled={!quickSetupCompanyId || quickSetupMutation.isPending}
              onClick={() => quickSetupMutation.mutate(quickSetupCompanyId)}
            >
              <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
            </Button>
            <Dialog open={open} onOpenChange={handleDialogChange}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-absence-policy"><Plus className="w-4 h-4 mr-1" /> Add Absence Policy</Button>
              </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editItem ? "Edit Absence Policy" : "Add Absence Policy"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger data-testid="select-absence-company">
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
                <Label>Name</Label>
                <Input data-testid="input-absence-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger data-testid="select-absence-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="accrual_based">Accrual Based</SelectItem>
                      <SelectItem value="non_accrual">Non-Accrual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Rate Type</Label>
                  <Select value={form.rateType} onValueChange={(v) => setForm({ ...form, rateType: v })}>
                    <SelectTrigger data-testid="select-absence-rate-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="multiplied_by_factor">Multiplied by Factor</SelectItem>
                      <SelectItem value="flat_rate">Flat Rate</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Rate Factor</Label>
                  <Input data-testid="input-absence-rate-factor" type="number" step="0.01" value={form.rateFactor} onChange={(e) => setForm({ ...form, rateFactor: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Pay Code ID</Label>
                  <Input data-testid="input-absence-pay-code" value={form.payCodeId} onChange={(e) => setForm({ ...form, payCodeId: e.target.value })} />
                </div>
              </div>
              <Button data-testid="button-submit-absence-policy" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
              </Button>
            </div>
          </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Rate Type</TableHead>
                <TableHead>Rate Factor</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items && items.length > 0 ? items.map((item) => (
                <TableRow key={item.id} data-testid={`row-absence-policy-${item.id}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell><Badge variant="secondary">{typeLabels[item.type || ""] || item.type}</Badge></TableCell>
                  <TableCell>{rateTypeLabels[item.rateType || ""] || item.rateType}</TableCell>
                  <TableCell>{item.rateFactor || "—"}</TableCell>
                  <TableCell>{item.companyId ? (companies?.find(c => c.id === item.companyId)?.name ?? "—") : <Badge variant="outline" className="text-xs">Universal</Badge>}</TableCell>
                  <TableCell>{item.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-absence-policy-${item.id}`} onClick={() => handleEdit(item)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-absence-policy-${item.id}`} onClick={() => deleteMutation.mutate(item.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No absence policies yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function HolidayPoliciesTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<HolidayPolicy | null>(null);
  const defaultForm = { companyId: "__universal__", name: "", defaultSchedule: "none", eligibleAfterDays: "", workedOnHolidayType: "paid", averageTimeMethod: "daily", forceOverTimePolicy: false };
  const [form, setForm] = useState(defaultForm);
  const [quickSetupCompanyId, setQuickSetupCompanyId] = useState("");

  const { data: items, isLoading } = useQuery<HolidayPolicy[]>({ queryKey: ["/api/holiday-policies"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const quickSetupMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await apiRequest("POST", "/api/holiday-policies/quick-setup", { companyId });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/holiday-policies"] });
      toast({ title: data.message || "Holiday policies created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = { ...data, companyId: data.companyId === "__universal__" ? null : data.companyId, eligibleAfterDays: data.eligibleAfterDays ? parseInt(data.eligibleAfterDays) : undefined };
      if (editItem) {
        await apiRequest("PATCH", `/api/holiday-policies/${editItem.id}`, payload);
      } else {
        await apiRequest("POST", "/api/holiday-policies", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/holiday-policies"] });
      toast({ title: editItem ? "Holiday policy updated" : "Holiday policy created" });
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
      await apiRequest("DELETE", `/api/holiday-policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/holiday-policies"] });
      toast({ title: "Holiday policy deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: HolidayPolicy) => {
    setEditItem(item);
    setForm({ companyId: item.companyId || "__universal__", name: item.name, defaultSchedule: item.defaultSchedule || "none", eligibleAfterDays: item.eligibleAfterDays?.toString() || "", workedOnHolidayType: item.workedOnHolidayType || "paid", averageTimeMethod: item.averageTimeMethod || "daily", forceOverTimePolicy: item.forceOverTimePolicy ?? false });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  const scheduleLabels: Record<string, string> = { none: "None", all_scheduled: "All Scheduled", only_scheduled: "Only Scheduled" };
  const workedLabels: Record<string, string> = { paid: "Paid", unpaid: "Unpaid", overtime: "Overtime" };
  const avgLabels: Record<string, string> = { daily: "Daily", weekly: "Weekly", pay_period: "Pay Period" };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-holiday-policies">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Holiday Policies</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={quickSetupCompanyId} onValueChange={setQuickSetupCompanyId}>
            <SelectTrigger data-testid="select-holiday-policy-quick-company" className="w-[180px]">
              <SelectValue placeholder="Select company" />
            </SelectTrigger>
            <SelectContent>
              {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            data-testid="button-quick-setup-holiday-policies"
            disabled={!quickSetupCompanyId || quickSetupMutation.isPending}
            onClick={() => quickSetupMutation.mutate(quickSetupCompanyId)}
          >
            <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
          </Button>
          <Dialog open={open} onOpenChange={handleDialogChange}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-holiday-policy"><Plus className="w-4 h-4 mr-1" /> Add Holiday Policy</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editItem ? "Edit Holiday Policy" : "Add Holiday Policy"}</DialogTitle>
              </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger data-testid="select-holiday-policy-company">
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
                <Label>Name</Label>
                <Input data-testid="input-holiday-policy-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Default Schedule</Label>
                  <Select value={form.defaultSchedule} onValueChange={(v) => setForm({ ...form, defaultSchedule: v })}>
                    <SelectTrigger data-testid="select-holiday-policy-schedule">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="all_scheduled">All Scheduled</SelectItem>
                      <SelectItem value="only_scheduled">Only Scheduled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Eligible After (days)</Label>
                  <Input data-testid="input-holiday-policy-eligible" type="number" value={form.eligibleAfterDays} onChange={(e) => setForm({ ...form, eligibleAfterDays: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Worked on Holiday</Label>
                  <Select value={form.workedOnHolidayType} onValueChange={(v) => setForm({ ...form, workedOnHolidayType: v })}>
                    <SelectTrigger data-testid="select-holiday-policy-worked">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="unpaid">Unpaid</SelectItem>
                      <SelectItem value="overtime">Overtime</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Avg Time Method</Label>
                  <Select value={form.averageTimeMethod} onValueChange={(v) => setForm({ ...form, averageTimeMethod: v })}>
                    <SelectTrigger data-testid="select-holiday-policy-avg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="pay_period">Pay Period</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="holiday-policy-force-ot"
                  data-testid="checkbox-holiday-policy-force-ot"
                  checked={form.forceOverTimePolicy}
                  onCheckedChange={(v) => setForm({ ...form, forceOverTimePolicy: !!v })}
                />
                <Label htmlFor="holiday-policy-force-ot">Force Overtime Policy</Label>
              </div>
              <Button data-testid="button-submit-holiday-policy" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
              </Button>
            </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Worked on Holiday</TableHead>
                <TableHead>Avg Method</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items && items.length > 0 ? items.map((item) => (
                <TableRow key={item.id} data-testid={`row-holiday-policy-${item.id}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell><Badge variant="secondary">{scheduleLabels[item.defaultSchedule || ""] || item.defaultSchedule}</Badge></TableCell>
                  <TableCell>{workedLabels[item.workedOnHolidayType || ""] || item.workedOnHolidayType}</TableCell>
                  <TableCell>{avgLabels[item.averageTimeMethod || ""] || item.averageTimeMethod}</TableCell>
                  <TableCell>{item.companyId ? (companies?.find(c => c.id === item.companyId)?.name ?? "—") : <Badge variant="outline" className="text-xs">Universal</Badge>}</TableCell>
                  <TableCell>{item.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-holiday-policy-${item.id}`} onClick={() => handleEdit(item)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-holiday-policy-${item.id}`} onClick={() => deleteMutation.mutate(item.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No holiday policies yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function RoundingPoliciesTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<RoundingPolicy | null>(null);
  const defaultForm = { companyId: "__universal__", name: "", roundType: "day_total", punchType: "", interval: "15", grace: "3" };
  const [form, setForm] = useState(defaultForm);
  const [quickSetupCompanyId, setQuickSetupCompanyId] = useState("");

  const { data: items, isLoading } = useQuery<RoundingPolicy[]>({ queryKey: ["/api/rounding-policies"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const quickSetupMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await apiRequest("POST", "/api/rounding-policies/quick-setup", { companyId });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rounding-policies"] });
      toast({ title: data.message || "Rounding policies created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = {
        ...data,
        companyId: data.companyId === "__universal__" ? null : data.companyId,
        interval: data.interval ? parseInt(data.interval) : 15,
        grace: data.grace ? parseInt(data.grace) : 3,
        punchType: data.roundType === "punch" ? data.punchType : undefined,
      };
      if (editItem) {
        await apiRequest("PATCH", `/api/rounding-policies/${editItem.id}`, payload);
      } else {
        await apiRequest("POST", "/api/rounding-policies", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rounding-policies"] });
      toast({ title: editItem ? "Rounding policy updated" : "Rounding policy created" });
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
      await apiRequest("DELETE", `/api/rounding-policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rounding-policies"] });
      toast({ title: "Rounding policy deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (item: RoundingPolicy) => {
    setEditItem(item);
    setForm({ companyId: item.companyId || "__universal__", name: item.name, roundType: item.roundType || "day_total", punchType: item.punchType || "", interval: item.interval?.toString() || "15", grace: item.grace?.toString() || "3" });
    setOpen(true);
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setEditItem(null);
      setForm(defaultForm);
    }
  };

  const roundTypeLabels: Record<string, string> = { day_total: "Day Total", punch: "Punch" };
  const punchTypeLabels: Record<string, string> = { clock_in: "Clock In", clock_out: "Clock Out", break_start: "Break Start", break_end: "Break End" };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="skeleton-rounding-policies">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Rounding Policies</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={quickSetupCompanyId} onValueChange={setQuickSetupCompanyId}>
            <SelectTrigger data-testid="select-rounding-quick-company" className="w-[180px]">
              <SelectValue placeholder="Select company" />
            </SelectTrigger>
            <SelectContent>
              {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            data-testid="button-quick-setup-rounding-policies"
            disabled={!quickSetupCompanyId || quickSetupMutation.isPending}
            onClick={() => quickSetupMutation.mutate(quickSetupCompanyId)}
          >
            <Zap className="w-4 h-4 mr-1" />{quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
          </Button>
          <Dialog open={open} onOpenChange={handleDialogChange}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-rounding-policy"><Plus className="w-4 h-4 mr-1" /> Add Rounding Policy</Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editItem ? "Edit Rounding Policy" : "Add Rounding Policy"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger data-testid="select-rounding-company">
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
                <Label>Name</Label>
                <Input data-testid="input-rounding-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Round Type</Label>
                  <Select value={form.roundType} onValueChange={(v) => setForm({ ...form, roundType: v })}>
                    <SelectTrigger data-testid="select-rounding-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day_total">Day Total</SelectItem>
                      <SelectItem value="punch">Punch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.roundType === "punch" && (
                  <div className="grid gap-2">
                    <Label>Punch Type</Label>
                    <Select value={form.punchType} onValueChange={(v) => setForm({ ...form, punchType: v })}>
                      <SelectTrigger data-testid="select-rounding-punch-type">
                        <SelectValue placeholder="Select punch type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="clock_in">Clock In</SelectItem>
                        <SelectItem value="clock_out">Clock Out</SelectItem>
                        <SelectItem value="break_start">Break Start</SelectItem>
                        <SelectItem value="break_end">Break End</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Interval (minutes)</Label>
                  <Input data-testid="input-rounding-interval" type="number" value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Grace (minutes)</Label>
                  <Input data-testid="input-rounding-grace" type="number" value={form.grace} onChange={(e) => setForm({ ...form, grace: e.target.value })} />
                </div>
              </div>
              <Button data-testid="button-submit-rounding-policy" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                {mutation.isPending ? (editItem ? "Updating..." : "Creating...") : (editItem ? "Update" : "Create")}
              </Button>
            </div>
          </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Round Type</TableHead>
                <TableHead>Punch Type</TableHead>
                <TableHead>Interval</TableHead>
                <TableHead>Grace</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items && items.length > 0 ? items.map((item) => (
                <TableRow key={item.id} data-testid={`row-rounding-policy-${item.id}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell><Badge variant="secondary">{roundTypeLabels[item.roundType || ""] || item.roundType}</Badge></TableCell>
                  <TableCell>{item.punchType ? punchTypeLabels[item.punchType] || item.punchType : "—"}</TableCell>
                  <TableCell>{item.interval ? `${item.interval}m` : "—"}</TableCell>
                  <TableCell>{item.grace ? `${item.grace}m` : "—"}</TableCell>
                  <TableCell>{item.companyId ? (companies?.find(c => c.id === item.companyId)?.name ?? "—") : <Badge variant="outline" className="text-xs">Universal</Badge>}</TableCell>
                  <TableCell>{item.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" data-testid={`button-edit-rounding-policy-${item.id}`} onClick={() => handleEdit(item)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-rounding-policy-${item.id}`} onClick={() => deleteMutation.mutate(item.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No rounding policies yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PolicyPage() {
  const [activeTab, setActiveTab] = useTabParam("groups");

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <Shield className="w-6 h-6 text-blue-accent" />
        <h1 className="text-2xl font-bold" data-testid="text-policy-title">Policy</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1 mb-4">
          <TabsTrigger value="groups" className="text-xs" data-testid="tab-groups">Policy Groups</TabsTrigger>
          <TabsTrigger value="pay-codes" className="text-xs" data-testid="tab-pay-codes">Pay Codes</TabsTrigger>
          <TabsTrigger value="pay-formulas" className="text-xs" data-testid="tab-pay-formulas">Pay Formulas</TabsTrigger>
          <TabsTrigger value="contributing-pay-codes" className="text-xs" data-testid="tab-contributing-pay-codes">Contributing Pay Codes</TabsTrigger>
          <TabsTrigger value="contributing-shifts" className="text-xs" data-testid="tab-contributing-shifts">Contributing Shifts</TabsTrigger>
          <TabsTrigger value="accrual-accounts" className="text-xs" data-testid="tab-accrual-accounts">Accrual Accounts</TabsTrigger>
          <TabsTrigger value="holidays" className="text-xs" data-testid="tab-holidays">Recurring Holidays</TabsTrigger>
          <TabsTrigger value="schedule-policies" className="text-xs" data-testid="tab-schedule-policies">Schedule Policies</TabsTrigger>
          <TabsTrigger value="rounding-policies" className="text-xs" data-testid="tab-rounding-policies">Rounding Policies</TabsTrigger>
          <TabsTrigger value="meal-policies" className="text-xs" data-testid="tab-meal-policies">Meal Policies</TabsTrigger>
          <TabsTrigger value="break-policies" className="text-xs" data-testid="tab-break-policies">Break Policies</TabsTrigger>
          <TabsTrigger value="regular-time" className="text-xs" data-testid="tab-regular-time">Regular Time Policies</TabsTrigger>
          <TabsTrigger value="overtime" className="text-xs" data-testid="tab-overtime">Overtime Policies</TabsTrigger>
          <TabsTrigger value="premium" className="text-xs" data-testid="tab-premium">Premium Policies</TabsTrigger>
          <TabsTrigger value="exception" className="text-xs" data-testid="tab-exception">Exception Policies</TabsTrigger>
          <TabsTrigger value="accrual-policies" className="text-xs" data-testid="tab-accrual-policies">Accrual Policies</TabsTrigger>
          <TabsTrigger value="absence" className="text-xs" data-testid="tab-absence">Absence Policies</TabsTrigger>
          <TabsTrigger value="holiday-policies" className="text-xs" data-testid="tab-holiday-policies">Holiday Policies</TabsTrigger>
        </TabsList>

        <TabsContent value="groups"><PolicyGroupsTab /></TabsContent>
        <TabsContent value="pay-codes"><PayCodesTab /></TabsContent>
        <TabsContent value="accrual-accounts"><AccrualAccountsTab /></TabsContent>
        <TabsContent value="holidays"><HolidaysTab /></TabsContent>
        <TabsContent value="pay-formulas"><PayFormulasTab /></TabsContent>
        <TabsContent value="contributing-pay-codes"><ContributingPayCodesTab /></TabsContent>
        <TabsContent value="contributing-shifts"><ContributingShiftsTab /></TabsContent>
        <TabsContent value="regular-time"><RegularTimePoliciesTab /></TabsContent>
        <TabsContent value="overtime"><OvertimePoliciesTab /></TabsContent>
        <TabsContent value="premium"><PremiumPoliciesTab /></TabsContent>
        <TabsContent value="meal-policies"><MealPoliciesTab /></TabsContent>
        <TabsContent value="break-policies"><BreakPoliciesTab /></TabsContent>
        <TabsContent value="schedule-policies"><SchedulePoliciesTab /></TabsContent>
        <TabsContent value="exception"><ExceptionPoliciesTab /></TabsContent>
        <TabsContent value="accrual-policies"><AccrualPoliciesTab /></TabsContent>
        <TabsContent value="absence"><AbsencePoliciesTab /></TabsContent>
        <TabsContent value="holiday-policies"><HolidayPoliciesTab /></TabsContent>
        <TabsContent value="rounding-policies"><RoundingPoliciesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
