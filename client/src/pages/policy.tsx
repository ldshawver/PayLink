import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Company, PolicyGroup, PayCode, AccrualAccount, Holiday } from "@shared/schema";
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
  AlertTriangle, Award, FileText, Briefcase, TreePine, Ban
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

function PolicyGroupsTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ companyId: "", name: "", description: "", isDefault: false });

  const { data: groups, isLoading } = useQuery<PolicyGroup[]>({ queryKey: ["/api/policy-groups"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/policy-groups", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policy-groups"] });
      toast({ title: "Policy group created" });
      setOpen(false);
      setForm({ companyId: "", name: "", description: "", isDefault: false });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

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
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-policy-group"><Plus className="w-4 h-4 mr-1" /> Add Policy Group</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Policy Group</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger data-testid="select-policy-group-company">
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
              <Button data-testid="button-submit-policy-group" disabled={mutation.isPending} onClick={() => mutation.mutate(form)}>
                {mutation.isPending ? "Creating..." : "Create"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Default</TableHead>
                <TableHead>Company</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups && groups.length > 0 ? groups.map((g) => (
                <TableRow key={g.id} data-testid={`row-policy-group-${g.id}`}>
                  <TableCell className="font-medium">{g.name}</TableCell>
                  <TableCell>{g.description || "—"}</TableCell>
                  <TableCell>{g.isDefault ? <Badge variant="secondary">Default</Badge> : null}</TableCell>
                  <TableCell>{companies?.find((c) => c.id === g.companyId)?.name || g.companyId}</TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">No policy groups yet</TableCell>
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
  const [form, setForm] = useState({ companyId: "", code: "", name: "", type: "regular", rate: "" });

  const { data: payCodes, isLoading } = useQuery<PayCode[]>({ queryKey: ["/api/pay-codes"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/pay-codes", { ...data, rate: data.rate || undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-codes"] });
      toast({ title: "Pay code created" });
      setOpen(false);
      setForm({ companyId: "", code: "", name: "", type: "regular", rate: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

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
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-pay-code"><Plus className="w-4 h-4 mr-1" /> Add Pay Code</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Pay Code</DialogTitle>
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
                {mutation.isPending ? "Creating..." : "Create"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
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
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No pay codes yet</TableCell>
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
  const [form, setForm] = useState({ companyId: "", name: "", type: "pto", accrualRate: "", accrualFrequency: "per_pay_period", maxBalance: "" });

  const { data: accounts, isLoading } = useQuery<AccrualAccount[]>({ queryKey: ["/api/accrual-accounts"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/accrual-accounts", {
        ...data,
        accrualRate: data.accrualRate || undefined,
        maxBalance: data.maxBalance || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accrual-accounts"] });
      toast({ title: "Accrual account created" });
      setOpen(false);
      setForm({ companyId: "", name: "", type: "pto", accrualRate: "", accrualFrequency: "per_pay_period", maxBalance: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

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
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-accrual-account"><Plus className="w-4 h-4 mr-1" /> Add Accrual Account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Accrual Account</DialogTitle>
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
                {mutation.isPending ? "Creating..." : "Create"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
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
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No accrual accounts yet</TableCell>
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
  const [form, setForm] = useState({ companyId: "", name: "", date: "", isRecurring: false });

  const { data: holidaysList, isLoading } = useQuery<Holiday[]>({ queryKey: ["/api/holidays"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/holidays", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/holidays"] });
      toast({ title: "Holiday created" });
      setOpen(false);
      setForm({ companyId: "", name: "", date: "", isRecurring: false });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

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
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-holiday"><Plus className="w-4 h-4 mr-1" /> Add Holiday</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Holiday</DialogTitle>
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
                {mutation.isPending ? "Creating..." : "Create"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {holidaysList && holidaysList.length > 0 ? holidaysList.map((h) => (
                <TableRow key={h.id} data-testid={`row-holiday-${h.id}`}>
                  <TableCell className="font-medium">{h.name}</TableCell>
                  <TableCell>{h.date}</TableCell>
                  <TableCell>{h.isRecurring ? <Badge variant="secondary">Recurring</Badge> : null}</TableCell>
                  <TableCell>{h.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">No holidays yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function PlaceholderTab({ icon: Icon, title, description }: { icon: typeof Shield; title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <Icon className="w-5 h-5 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground" data-testid={`text-placeholder-${title.toLowerCase().replace(/\s+/g, "-")}`}>{description}</p>
      </CardContent>
    </Card>
  );
}

const placeholderTabs = [
  { value: "pay-formulas", title: "Pay Formulas", description: "Pay formula configuration for complex wage calculations.", icon: Calculator },
  { value: "contributing-pay-codes", title: "Contributing Pay Codes", description: "Configure which pay codes contribute to overtime and other calculations.", icon: Layers },
  { value: "contributing-shifts", title: "Contributing Shifts", description: "Define contributing shift rules.", icon: Clock },
  { value: "schedule-policies", title: "Schedule Policies", description: "Schedule policy configuration for scheduling rules.", icon: CalendarDays },
  { value: "rounding-policies", title: "Rounding Policies", description: "Time rounding rules for punch data.", icon: RotateCcw },
  { value: "meal-policies", title: "Meal Policies", description: "Meal break policy configuration.", icon: UtensilsCrossed },
  { value: "break-policies", title: "Break Policies", description: "Break policy configuration and automatic deductions.", icon: Coffee },
  { value: "regular-time", title: "Regular Time Policies", description: "Regular time calculation policies.", icon: Timer },
  { value: "overtime", title: "Overtime Policies", description: "Overtime calculation rules and thresholds.", icon: Clock },
  { value: "premium", title: "Premium Policies", description: "Premium pay rules for special conditions.", icon: Award },
  { value: "exception", title: "Exception Policies", description: "Exception tracking and alert policies.", icon: AlertTriangle },
  { value: "accrual-policies", title: "Accrual Policies", description: "Accrual calculation rules and carryover policies.", icon: FileText },
  { value: "absence", title: "Absence Policies", description: "Absence tracking and notification policies.", icon: Ban },
  { value: "holiday-policies", title: "Holiday Policies", description: "Holiday pay rules and eligibility.", icon: TreePine },
];

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

        {placeholderTabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <PlaceholderTab icon={tab.icon} title={tab.title} description={tab.description} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
