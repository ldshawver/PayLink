import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Worker, Company, EmployeeContact, PayMethod } from "@shared/schema";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Users, Plus, MoreHorizontal, Settings, DollarSign, CreditCard,
  Briefcase, UserPlus, Clock, Calendar, Building2
} from "lucide-react";

function useTabParam(defaultTab: string): [string, (tab: string) => void] {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get("tab") || defaultTab;
  const setTab = (newTab: string) => {
    setLocation(`/employee?tab=${newTab}`);
  };
  return [tab, setTab];
}

function EmployeeTab() {
  const { toast } = useToast();
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editWorker, setEditWorker] = useState<Worker | null>(null);

  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "",
    workerType: "employee" as "employee" | "contractor",
    jobTitle: "", department: "", payRate: "", payType: "hourly",
    hireDate: "", companyId: ""
  });

  const companiesQuery = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const workersQuery = useQuery<Worker[]>({
    queryKey: ["/api/workers", companyFilter !== "all" ? `?companyId=${companyFilter}` : ""],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/workers", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
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
      await apiRequest("PATCH", `/api/workers/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      toast({ title: "Employee updated successfully" });
      setEditOpen(false);
      setEditWorker(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  function resetForm() {
    setForm({
      firstName: "", lastName: "", email: "", phone: "",
      workerType: "employee", jobTitle: "", department: "",
      payRate: "", payType: "hourly", hireDate: "", companyId: ""
    });
  }

  function openEdit(worker: Worker) {
    setEditWorker(worker);
    setForm({
      firstName: worker.firstName,
      lastName: worker.lastName,
      email: worker.email || "",
      phone: worker.phone || "",
      workerType: worker.workerType,
      jobTitle: worker.jobTitle || "",
      department: worker.department || "",
      payRate: worker.payRate || "0",
      payType: worker.payType || "hourly",
      hireDate: worker.hireDate || "",
      companyId: worker.companyId
    });
    setEditOpen(true);
  }

  const workers = workersQuery.data || [];
  const companies = companiesQuery.data || [];

  function renderForm(isEdit: boolean) {
    return (
      <div className="grid gap-4 py-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>First Name</Label>
            <Input data-testid="input-firstName" value={form.firstName}
              onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Last Name</Label>
            <Input data-testid="input-lastName" value={form.lastName}
              onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input data-testid="input-email" type="email" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input data-testid="input-phone" value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Worker Type</Label>
            <Select value={form.workerType} onValueChange={v => setForm(f => ({ ...f, workerType: v as "employee" | "contractor" }))}>
              <SelectTrigger data-testid="select-workerType"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="contractor">Contractor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Job Title</Label>
            <Input data-testid="input-jobTitle" value={form.jobTitle}
              onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Department</Label>
            <Input data-testid="input-department" value={form.department}
              onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Pay Rate</Label>
            <Input data-testid="input-payRate" type="number" value={form.payRate}
              onChange={e => setForm(f => ({ ...f, payRate: e.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
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
          <div className="space-y-2">
            <Label>Hire Date</Label>
            <Input data-testid="input-hireDate" type="date" value={form.hireDate}
              onChange={e => setForm(f => ({ ...f, hireDate: e.target.value }))} />
          </div>
        </div>
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
        <Button data-testid={isEdit ? "button-update-employee" : "button-submit-employee"}
          onClick={() => {
            if (isEdit && editWorker) {
              updateMutation.mutate({ id: editWorker.id, data: form });
            } else {
              createMutation.mutate(form);
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
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Job Title</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Pay Rate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      No employees found
                    </TableCell>
                  </TableRow>
                ) : workers.map(w => (
                  <TableRow key={w.id} data-testid={`row-worker-${w.id}`}>
                    <TableCell data-testid={`text-worker-name-${w.id}`}>{w.firstName} {w.lastName}</TableCell>
                    <TableCell>{w.email || "—"}</TableCell>
                    <TableCell>{w.phone || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs" data-testid={`badge-type-${w.id}`}>
                        {w.workerType}
                      </Badge>
                    </TableCell>
                    <TableCell>{w.jobTitle || "—"}</TableCell>
                    <TableCell>{w.department || "—"}</TableCell>
                    <TableCell>${w.payRate}</TableCell>
                    <TableCell>
                      <Badge variant={w.isActive ? "default" : "secondary"} className="text-xs"
                        data-testid={`badge-status-${w.id}`}>
                        {w.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-menu-${w.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem data-testid={`button-edit-${w.id}`} onClick={() => openEdit(w)}>
                            Edit
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

      <Dialog open={editOpen} onOpenChange={v => { setEditOpen(v); if (!v) { setEditWorker(null); resetForm(); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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
              <div className="grid grid-cols-2 gap-4">
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
              <div className="grid grid-cols-2 gap-4">
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
          <CardContent className="p-0">
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
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Preferences
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground" data-testid="text-preferences-placeholder">
          Employee preferences configuration will be available here.
        </p>
      </CardContent>
    </Card>
  );
}

function WagesTab() {
  const workersQuery = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const companiesQuery = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const workers = workersQuery.data || [];
  const companyMap = new Map((companiesQuery.data || []).map(c => [c.id, c.name]));

  if (workersQuery.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Pay Type</TableHead>
              <TableHead>Pay Rate</TableHead>
              <TableHead>Hire Date</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Company</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No wage data found
                </TableCell>
              </TableRow>
            ) : workers.map(w => (
              <TableRow key={w.id} data-testid={`row-wage-${w.id}`}>
                <TableCell data-testid={`text-wage-name-${w.id}`}>{w.firstName} {w.lastName}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-xs">{w.payType}</Badge>
                </TableCell>
                <TableCell>${w.payRate}</TableCell>
                <TableCell>{w.hireDate || "—"}</TableCell>
                <TableCell>{w.department || "—"}</TableCell>
                <TableCell>{companyMap.get(w.companyId) || w.companyId}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PayMethodsTab() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    workerId: "", methodType: "direct_deposit", bankName: "",
    accountType: "checking", routingNumber: "", accountNumber: "", isPrimary: false
  });

  const payMethodsQuery = useQuery<PayMethod[]>({ queryKey: ["/api/pay-methods"] });
  const workersQuery = useQuery<Worker[]>({ queryKey: ["/api/workers"] });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      await apiRequest("POST", "/api/pay-methods", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-methods"] });
      toast({ title: "Pay method added successfully" });
      setAddOpen(false);
      setForm({ workerId: "", methodType: "direct_deposit", bankName: "", accountType: "checking", routingNumber: "", accountNumber: "", isPrimary: false });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const payMethods = payMethodsQuery.data || [];
  const workers = workersQuery.data || [];
  const workerMap = new Map(workers.map(w => [w.id, `${w.firstName} ${w.lastName}`]));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-pay-method"><Plus className="mr-2 h-4 w-4" />Add Pay Method</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Add Pay Method</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Employee</Label>
                <Select value={form.workerId} onValueChange={v => setForm(f => ({ ...f, workerId: v }))}>
                  <SelectTrigger data-testid="select-paymethod-workerId"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {workers.map(w => (
                      <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Method Type</Label>
                  <Select value={form.methodType} onValueChange={v => setForm(f => ({ ...f, methodType: v }))}>
                    <SelectTrigger data-testid="select-methodType"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="direct_deposit">Direct Deposit</SelectItem>
                      <SelectItem value="check">Check</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Bank Name</Label>
                  <Input data-testid="input-bankName" value={form.bankName}
                    onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Account Type</Label>
                  <Select value={form.accountType} onValueChange={v => setForm(f => ({ ...f, accountType: v }))}>
                    <SelectTrigger data-testid="select-accountType"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="checking">Checking</SelectItem>
                      <SelectItem value="savings">Savings</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Routing Number</Label>
                  <Input data-testid="input-routingNumber" value={form.routingNumber}
                    onChange={e => setForm(f => ({ ...f, routingNumber: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Account Number</Label>
                <Input data-testid="input-accountNumber" value={form.accountNumber}
                  onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox data-testid="checkbox-paymethod-isPrimary" checked={form.isPrimary}
                  onCheckedChange={v => setForm(f => ({ ...f, isPrimary: !!v }))} />
                <Label>Primary Method</Label>
              </div>
              <Button data-testid="button-submit-pay-method" onClick={() => createMutation.mutate(form)}
                disabled={createMutation.isPending}>
                Add Pay Method
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {payMethodsQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Method Type</TableHead>
                  <TableHead>Bank Name</TableHead>
                  <TableHead>Account Type</TableHead>
                  <TableHead>Primary</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payMethods.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
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
                    <TableCell>{pm.bankName || "—"}</TableCell>
                    <TableCell>{pm.accountType || "—"}</TableCell>
                    <TableCell>
                      {pm.isPrimary ? <Badge className="text-xs">Primary</Badge> : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={pm.isActive ? "default" : "secondary"} className="text-xs">
                        {pm.isActive ? "Active" : "Inactive"}
                      </Badge>
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
  const workersQuery = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const workers = workersQuery.data || [];
  const titles = Array.from(new Set(workers.map(w => w.jobTitle).filter(Boolean)));

  if (workersQuery.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {titles.length === 0 ? (
        <Card className="col-span-full">
          <CardContent className="py-8 text-center text-muted-foreground">
            No job titles found
          </CardContent>
        </Card>
      ) : titles.map((title, i) => (
        <Card key={i} data-testid={`card-title-${i}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Briefcase className="h-4 w-4" />
              {title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {workers.filter(w => w.jobTitle === title).length} employee(s)
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmployeeGroupsTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Employee Groups
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground" data-testid="text-employee-groups-placeholder">
          Employee group management coming soon.
        </p>
      </CardContent>
    </Card>
  );
}

function EthnicGroupsTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Ethnic Groups
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground" data-testid="text-ethnic-groups-placeholder">
          Ethnic group configuration coming soon.
        </p>
      </CardContent>
    </Card>
  );
}

function NewHireDefaultsTab() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card data-testid="card-default-pay-type">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-4 w-4" />
            Default Pay Type
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            New hires will default to hourly pay type. This can be changed per employee during onboarding.
          </p>
        </CardContent>
      </Card>
      <Card data-testid="card-default-department">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            Default Department
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No default department assigned. New hires will need a department selected during setup.
          </p>
        </CardContent>
      </Card>
      <Card data-testid="card-default-schedule">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4" />
            Default Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Standard 40-hour work week, Monday through Friday. Adjustable per employee after hire.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function EmployeePage() {
  const [activeTab, handleTabChange] = useTabParam("employee");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Employee</h1>
        <p className="text-muted-foreground" data-testid="text-page-subtitle">
          Manage employees, contacts, wages, and more
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="flex flex-wrap" data-testid="tabs-employee">
          <TabsTrigger value="employee" data-testid="tab-employee">
            <Users className="mr-2 h-4 w-4" />Employee
          </TabsTrigger>
          <TabsTrigger value="contacts" data-testid="tab-contacts">
            <UserPlus className="mr-2 h-4 w-4" />Employee Contacts
          </TabsTrigger>
          <TabsTrigger value="preferences" data-testid="tab-preferences">
            <Settings className="mr-2 h-4 w-4" />Preferences
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
            <Users className="mr-2 h-4 w-4" />Ethnic Groups
          </TabsTrigger>
          <TabsTrigger value="new-hire-defaults" data-testid="tab-new-hire-defaults">
            <Clock className="mr-2 h-4 w-4" />New Hire Defaults
          </TabsTrigger>
        </TabsList>

        <TabsContent value="employee"><EmployeeTab /></TabsContent>
        <TabsContent value="contacts"><EmployeeContactsTab /></TabsContent>
        <TabsContent value="preferences"><PreferencesTab /></TabsContent>
        <TabsContent value="wages"><WagesTab /></TabsContent>
        <TabsContent value="pay-methods"><PayMethodsTab /></TabsContent>
        <TabsContent value="titles"><TitlesTab /></TabsContent>
        <TabsContent value="employee-groups"><EmployeeGroupsTab /></TabsContent>
        <TabsContent value="ethnic-groups"><EthnicGroupsTab /></TabsContent>
        <TabsContent value="new-hire-defaults"><NewHireDefaultsTab /></TabsContent>
      </Tabs>
    </div>
  );
}