import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Users,
  Plus,
  Search,
  Mail,
  Phone,
  Briefcase,
  MoreHorizontal,
  UserCheck,
  UserX,
  Pencil,
  Trash2,
  Building2,
  AlertTriangle,
  Shield,
  Eye,
  EyeOff,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Worker, Company } from "@shared/schema";

const workerFormSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email").or(z.literal("")).optional(),
  phone: z.string().optional(),
  workerType: z.enum(["employee", "contractor"]),
  contractorType: z.string().optional(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  payRate: z.string().min(1, "Pay rate is required"),
  payType: z.string().default("hourly"),
  hireDate: z.string().optional(),
  companyId: z.string().min(1, "Company is required"),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  ssn: z.string().optional(),
  employeeNumber: z.string().optional(),
  pin: z.string().optional(),
});

type WorkerFormValues = z.infer<typeof workerFormSchema>;

function WorkerFormFields({ form, companies }: { form: any; companies: Company[] | undefined }) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField
          control={form.control}
          name="firstName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>First Name</FormLabel>
              <FormControl>
                <Input {...field} data-testid="input-first-name" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="lastName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Last Name</FormLabel>
              <FormControl>
                <Input {...field} data-testid="input-last-name" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" {...field} data-testid="input-email" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone</FormLabel>
              <FormControl>
                <Input {...field} data-testid="input-phone" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="companyId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Company</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger data-testid="select-company">
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {companies?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="workerType"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Worker Type</FormLabel>
            <Select onValueChange={(v) => { field.onChange(v); if (v === "employee") form.setValue("contractorType", ""); }} value={field.value}>
              <FormControl>
                <SelectTrigger data-testid="select-worker-type">
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="contractor">Contractor</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      {form.watch("workerType") === "contractor" && (
        <FormField
          control={form.control}
          name="contractorType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Contractor Type</FormLabel>
              <Select onValueChange={field.onChange} value={field.value || "hourly"}>
                <FormControl>
                  <SelectTrigger data-testid="select-contractor-type">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="hourly">Hourly (Clocks In/Out)</SelectItem>
                  <SelectItem value="invoice">Invoice-Based</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField
          control={form.control}
          name="jobTitle"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Job Title</FormLabel>
              <FormControl>
                <Input {...field} data-testid="input-job-title" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="department"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Department</FormLabel>
              <FormControl>
                <Input {...field} data-testid="input-department" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField
          control={form.control}
          name="payRate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Pay Rate ($)</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" {...field} data-testid="input-pay-rate" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="payType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Pay Type</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-pay-type">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="salary">Salary</SelectItem>
                  <SelectItem value="commission">Commission</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="hireDate"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Hire Date</FormLabel>
            <FormControl>
              <Input type="date" {...field} data-testid="input-hire-date" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField
          control={form.control}
          name="employeeNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Employee Number <span className="text-muted-foreground text-xs">(auto-assigned if blank)</span></FormLabel>
              <FormControl>
                <Input {...field} placeholder="e.g. 1003" data-testid="input-employee-number" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="pin"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Time Clock PIN <span className="text-muted-foreground text-xs">(for clock-in)</span></FormLabel>
              <FormControl>
                <Input type="password" {...field} placeholder="4-digit PIN" maxLength={8} data-testid="input-pin-create" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address</FormLabel>
              <FormControl>
                <Input {...field} data-testid="input-worker-address" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="ssn"
          render={({ field }) => (
            <FormItem>
              <FormLabel>SSN</FormLabel>
              <FormControl>
                <Input placeholder="XXX-XX-XXXX" {...field} data-testid="input-ssn" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FormField
          control={form.control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormLabel>City</FormLabel>
              <FormControl>
                <Input {...field} data-testid="input-worker-city" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="state"
          render={({ field }) => (
            <FormItem>
              <FormLabel>State</FormLabel>
              <FormControl>
                <Input {...field} data-testid="input-worker-state" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="zip"
          render={({ field }) => (
            <FormItem>
              <FormLabel>ZIP</FormLabel>
              <FormControl>
                <Input {...field} data-testid="input-worker-zip" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </>
  );
}

function EditWorkerDialog({ worker, onClose }: { worker: Worker; onClose: () => void }) {
  const { toast } = useToast();
  const [tab, setTab] = useState("info");
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("employee");

  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: allUsers } = useQuery<any[]>({ queryKey: ["/api/users"] });

  const linkedAccount = allUsers?.find(u => u.workerId === worker.id) ?? null;

  // Login identifier = worker's employee number (set in Employee Info tab)
  const loginEmployeeNumber = worker.employeeNumber || "";

  const form = useForm<WorkerFormValues>({
    resolver: zodResolver(workerFormSchema),
    defaultValues: {
      firstName: worker.firstName,
      lastName: worker.lastName,
      email: worker.email || "",
      phone: worker.phone || "",
      workerType: worker.workerType as "employee" | "contractor",
      contractorType: worker.contractorType || "hourly",
      jobTitle: worker.jobTitle || "",
      department: worker.department || "",
      payRate: String(worker.payRate),
      payType: worker.payType || "hourly",
      hireDate: worker.hireDate || "",
      companyId: worker.companyId,
      address: worker.address || "",
      city: worker.city || "",
      state: worker.state || "",
      zip: worker.zip || "",
      ssn: worker.ssn || "",
      employeeNumber: worker.employeeNumber || "",
      pin: worker.pin || "",
    },
  });

  const updateWorker = useMutation({
    mutationFn: async (data: WorkerFormValues) => {
      await apiRequest("PATCH", `/api/workers/${worker.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      toast({ title: "Worker updated successfully" });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createAccount = useMutation({
    mutationFn: async () => {
      if (!newPassword) throw new Error("Password is required");
      if (!loginEmployeeNumber) throw new Error("Employee number must be set before creating a login account");
      await apiRequest("POST", "/api/users", {
        username: loginEmployeeNumber,
        password: newPassword,
        role: newRole,
        companyId: worker.companyId,
        workerId: worker.id,
        isActive: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setNewPassword("");
      toast({ title: "Account created", description: `Employee #${loginEmployeeNumber} can now log in` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resetPassword = useMutation({
    mutationFn: async () => {
      if (!linkedAccount) return;
      if (!newPassword) throw new Error("New password is required");
      await apiRequest("PATCH", `/api/users/${linkedAccount.id}`, { password: newPassword });
    },
    onSuccess: () => {
      setNewPassword("");
      toast({ title: "Password updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deactivateAccount = useMutation({
    mutationFn: async () => {
      if (!linkedAccount) return;
      await apiRequest("PATCH", `/api/users/${linkedAccount.id}`, { isActive: !linkedAccount.isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: linkedAccount?.isActive ? "Account deactivated" : "Account activated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const missingPin = !worker.pin;
  const missingEmpNum = !worker.employeeNumber;

  return (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{worker.firstName} {worker.lastName}</DialogTitle>
      </DialogHeader>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="info" className="flex-1" data-testid="tab-edit-info">Employee Info</TabsTrigger>
          <TabsTrigger value="account" className="flex-1" data-testid="tab-edit-account">
            <Shield className="h-3.5 w-3.5 mr-1" />User Account
            {linkedAccount && <CheckCircle2 className="h-3 w-3 ml-1 text-green-500" />}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="mt-4 space-y-4">
          {(missingPin || missingEmpNum) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 flex gap-2 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">This employee can't clock in yet</p>
                <ul className="mt-1 list-disc list-inside space-y-0.5 text-amber-700 dark:text-amber-400">
                  {missingEmpNum && <li>No employee number — will be auto-assigned on save</li>}
                  {missingPin && <li>No PIN set — required for time clock access</li>}
                </ul>
              </div>
            </div>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit((data) => updateWorker.mutate(data))} className="space-y-4">
              <WorkerFormFields form={form} companies={companies} />
              <Button type="submit" className="w-full" disabled={updateWorker.isPending} data-testid="button-submit-edit-worker">
                {updateWorker.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </form>
          </Form>
        </TabsContent>

        <TabsContent value="account" className="mt-4 space-y-4">
          {linkedAccount ? (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Employee Number</p>
                    <p className="text-lg font-mono font-semibold">{linkedAccount.username}</p>
                  </div>
                  <Badge variant={linkedAccount.isActive ? "default" : "secondary"}>
                    {linkedAccount.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground">Role: <span className="capitalize font-medium text-foreground">{linkedAccount.role}</span></div>
              </div>

              <div className="space-y-2">
                <Label>Reset Password</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="New password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      data-testid="input-reset-password"
                    />
                    <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full px-2"
                      onClick={() => setShowPassword(p => !p)}>
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <Button onClick={() => resetPassword.mutate()} disabled={resetPassword.isPending || !newPassword} data-testid="button-reset-password">
                    Update
                  </Button>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => deactivateAccount.mutate()}
                disabled={deactivateAccount.isPending}
                data-testid="button-toggle-account-active"
              >
                {linkedAccount.isActive ? "Deactivate Account" : "Reactivate Account"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                No login account exists for this employee yet.
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Employee Number <span className="text-muted-foreground text-xs">(login identifier)</span></Label>
                  {loginEmployeeNumber ? (
                    <Input value={loginEmployeeNumber} readOnly className="font-mono bg-muted/50" data-testid="input-suggested-username" />
                  ) : (
                    <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                      No employee number assigned yet. Set one in the Employee Info tab first.
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">Employee number is used as the login ID</p>
                </div>

                <div className="space-y-1">
                  <Label>Password</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Set initial password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      data-testid="input-account-password"
                    />
                    <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full px-2"
                      onClick={() => setShowPassword(p => !p)}>
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>Role</Label>
                  <Select value={newRole} onValueChange={setNewRole}>
                    <SelectTrigger data-testid="select-account-role"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">Employee</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  className="w-full"
                  onClick={() => createAccount.mutate()}
                  disabled={createAccount.isPending || !newPassword || !loginEmployeeNumber}
                  data-testid="button-create-account"
                >
                  {createAccount.isPending ? "Creating..." : "Create Login Account"}
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </DialogContent>
  );
}

function WorkerCard({ worker, onEdit, companies }: { worker: Worker; onEdit: (w: Worker) => void; companies?: Company[] }) {
  const { toast } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const toggleActive = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/workers/${worker.id}`, {
        isActive: !worker.isActive,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      toast({
        title: worker.isActive ? "Worker deactivated" : "Worker activated",
      });
    },
  });

  const deleteWorker = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/workers/${worker.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Worker deleted permanently" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <>
      <Card className="hover-elevate" data-testid={`card-worker-${worker.id}`}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
              {worker.firstName[0]}{worker.lastName[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold truncate">
                  {worker.firstName} {worker.lastName}
                </h3>
                <Badge variant={worker.workerType === "employee" ? "default" : "secondary"} className="text-xs">
                  {worker.workerType === "employee" ? "Employee" :
                   worker.contractorType === "invoice" ? "Contractor (Invoice)" : "Contractor (Hourly)"}
                </Badge>
                {!worker.isActive && (
                  <Badge variant="destructive" className="text-xs">Inactive</Badge>
                )}
              </div>
              {worker.jobTitle && (
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  <Briefcase className="h-3 w-3" />
                  {worker.jobTitle}
                  {worker.department && ` - ${worker.department}`}
                </p>
              )}
              {(() => {
                const company = companies?.find(c => c.id === worker.companyId);
                if (!company) return null;
                return (
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1" data-testid={`text-worker-company-${worker.id}`}>
                    {company.iconUrl ? (
                      <img src={company.iconUrl} alt="" className="h-3.5 w-3.5 rounded object-contain" />
                    ) : company.logoUrl ? (
                      <img src={company.logoUrl} alt="" className="h-3.5 w-3.5 rounded object-contain" />
                    ) : (
                      <Building2 className="h-3 w-3" />
                    )}
                    {company.name}
                  </p>
                );
              })()}
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {worker.email && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Mail className="h-3 w-3" /> {worker.email}
                  </span>
                )}
                {worker.phone && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {worker.phone}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs font-medium text-primary">
                  ${Number(worker.payRate).toFixed(2)}/{worker.payType === "salary" ? "yr" : "hr"}
                </span>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" data-testid={`button-worker-menu-${worker.id}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => onEdit(worker)}
                  data-testid={`button-edit-worker-${worker.id}`}
                >
                  <Pencil className="h-4 w-4 mr-2" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => toggleActive.mutate()}
                  data-testid={`button-toggle-active-${worker.id}`}
                >
                  {worker.isActive ? (
                    <>
                      <UserX className="h-4 w-4 mr-2" /> Deactivate
                    </>
                  ) : (
                    <>
                      <UserCheck className="h-4 w-4 mr-2" /> Activate
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-destructive focus:text-destructive"
                  data-testid={`button-delete-worker-${worker.id}`}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-delete-confirm-title">Delete Worker</AlertDialogTitle>
            <AlertDialogDescription data-testid="text-delete-confirm-description">
              Are you sure you want to permanently delete {worker.firstName} {worker.lastName}? This will remove all associated records including time entries, punches, schedules, payroll items, and documents. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteWorker.mutate()}
              className="bg-destructive text-destructive-foreground"
              disabled={deleteWorker.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteWorker.isPending ? "Deleting..." : "Delete Permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AddWorkerDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const form = useForm<WorkerFormValues>({
    resolver: zodResolver(workerFormSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      workerType: "employee",
      contractorType: "hourly",
      jobTitle: "",
      department: "",
      payRate: "",
      payType: "hourly",
      hireDate: "",
      companyId: companies?.[0]?.id || "",
      address: "",
      city: "",
      state: "",
      zip: "",
      ssn: "",
      employeeNumber: "",
      pin: "",
    },
  });

  const createWorker = useMutation({
    mutationFn: async (data: WorkerFormValues) => {
      await apiRequest("POST", "/api/workers", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Worker added successfully" });
      form.reset();
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-add-worker">
          <Plus className="h-4 w-4 mr-2" /> Add Worker
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Worker</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((data) => createWorker.mutate(data))} className="space-y-4">
            <WorkerFormFields form={form} companies={companies} />
            <Button
              type="submit"
              className="w-full"
              disabled={createWorker.isPending}
              data-testid="button-submit-worker"
            >
              {createWorker.isPending ? "Adding..." : "Add Worker"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function Employees() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "employee" | "contractor">("all");
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null);

  const { data: workers, isLoading } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const filtered = (workers || []).filter((w) => {
    const matchesSearch =
      `${w.firstName} ${w.lastName} ${w.email} ${w.jobTitle} ${w.department}`
        .toLowerCase()
        .includes(search.toLowerCase());
    const matchesFilter = filter === "all" || w.workerType === filter;
    return matchesSearch && matchesFilter;
  });

  const activeCount = filtered.filter((w) => w.isActive).length;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-employees-title">
            Workforce
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeCount} active / {filtered.length} total
          </p>
        </div>
        <AddWorkerDialog />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search workers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-workers"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "employee", "contractor"] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "ghost"}
              size="sm"
              onClick={() => setFilter(f)}
              data-testid={`button-filter-${f}`}
            >
              {f === "all" ? "All" : f === "employee" ? "Employees" : "Contractors"}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Users className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No workers found</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {search ? "Try adjusting your search" : "Add your first worker to get started"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((worker) => (
            <WorkerCard key={worker.id} worker={worker} onEdit={setEditingWorker} companies={companies} />
          ))}
        </div>
      )}

      <Dialog open={!!editingWorker} onOpenChange={(open) => !open && setEditingWorker(null)}>
        {editingWorker && (
          <EditWorkerDialog worker={editingWorker} onClose={() => setEditingWorker(null)} />
        )}
      </Dialog>
    </div>
  );
}
