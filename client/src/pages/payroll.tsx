import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Company, Worker, PayrollRun, PayrollItem, PayPeriod, TaxDeduction, RemittanceSource, RemittanceAgency, RemittanceAgencyEvent, PayStubAccount, PayStubAmendment, PayStubTransaction, PayPeriodSchedule, LegalEntity, CheckTemplate } from "@shared/schema";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "wouter";
import {
  DollarSign, Clock, Calendar, ChevronDown, ChevronUp, Plus, Download, Printer,
  Calculator, FileText, CreditCard, CalendarDays, Settings, Building, Receipt, Zap,
  ChevronLeft, ChevronRight, Check, AlertCircle, ArrowRight, Pencil, Trash2,
  Layout, Eye, EyeOff, Image, Save, Copy, ExternalLink
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

function useTabParam(): [string, (tab: string) => void] {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get("tab") || "process";
  const setTab = (newTab: string) => {
    setLocation(`/payroll?tab=${newTab}`);
  };
  return [tab, setTab];
}

function ProcessPayrollTab() {
  const { toast } = useToast();
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({ companyId: "", periodStart: "", periodEnd: "" });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: payrollRuns = [], isLoading } = useQuery<PayrollRun[]>({ queryKey: ["/api/payroll-runs"] });

  const createMutation = useMutation({
    mutationFn: async (data: { companyId: string; periodStart: string; periodEnd: string }) => {
      const res = await apiRequest("POST", "/api/payroll-runs", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs"] });
      toast({ title: "Payroll run created" });
      setDialogOpen(false);
      setFormData({ companyId: "", periodStart: "", periodEnd: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const totalRuns = payrollRuns.length;
  const totalPayroll = payrollRuns.reduce((sum, r) => sum + Number(r.totalGross || 0), 0);
  const lastRun = payrollRuns.length > 0
    ? payrollRuns.reduce((latest, r) => {
        const d = new Date(r.createdAt || 0);
        return d > new Date(latest.createdAt || 0) ? r : latest;
      })
    : null;

  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || id;
  const getWorkerName = (id: string) => {
    const w = workers.find(w => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  };

  const exportCSV = (run: PayrollRun, items: PayrollItem[]) => {
    const headers = ["Worker", "Type", "Rate", "Reg Hrs", "OT Hrs", "Reg Pay", "OT Pay", "Gross", "Deductions", "Net Pay", "Check #"];
    const rows = items.map(item => [
      getWorkerName(item.workerId),
      item.payType || "hourly",
      item.payRate,
      item.regularHours,
      item.overtimeHours,
      item.regularPay,
      item.overtimePay,
      item.grossPay,
      item.deductions,
      item.netPay,
      item.checkNumber || "",
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-run-${run.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="loading-process-payroll">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
        {[1, 2].map(i => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Runs</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-runs">{totalRuns}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Payroll</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-payroll">
              ${totalPayroll.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Last Run</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-last-run">
              {lastRun ? new Date(lastRun.createdAt!).toLocaleDateString() : "N/A"}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-run-payroll"><Plus className="mr-2 h-4 w-4" />Run Payroll</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Run Payroll</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={formData.companyId} onValueChange={v => setFormData(p => ({ ...p, companyId: v }))}>
                  <SelectTrigger data-testid="select-run-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Period Start</Label>
                <Input type="date" data-testid="input-period-start" value={formData.periodStart} onChange={e => setFormData(p => ({ ...p, periodStart: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Period End</Label>
                <Input type="date" data-testid="input-period-end" value={formData.periodEnd} onChange={e => setFormData(p => ({ ...p, periodEnd: e.target.value }))} />
              </div>
              <Button
                className="w-full"
                data-testid="button-submit-payroll"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate(formData)}
              >
                {createMutation.isPending ? "Creating..." : "Create Payroll Run"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-4">
        {payrollRuns.map(run => (
          <PayrollRunCard
            key={run.id}
            run={run}
            companyName={getCompanyName(run.companyId)}
            expanded={expandedRun === run.id}
            onToggle={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
            getWorkerName={getWorkerName}
            onExportCSV={exportCSV}
          />
        ))}
        {payrollRuns.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              No payroll runs yet. Click "Run Payroll" to get started.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function PayrollRunCard({
  run, companyName, expanded, onToggle, getWorkerName, onExportCSV,
}: {
  run: PayrollRun;
  companyName: string;
  expanded: boolean;
  onToggle: () => void;
  getWorkerName: (id: string) => string;
  onExportCSV: (run: PayrollRun, items: PayrollItem[]) => void;
}) {
  const { toast } = useToast();
  const { data: items = [], isLoading } = useQuery<PayrollItem[]>({
    queryKey: ["/api/payroll-runs", run.id, "items"],
    queryFn: async () => {
      const res = await fetch(`/api/payroll-runs/${run.id}/items`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch items");
      return res.json();
    },
    enabled: expanded,
  });

  const processMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/payroll-runs/${run.id}/process`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs", run.id, "items"] });
      toast({ title: "Payroll processed successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const statusVariant = run.status === "paid" ? "default" : run.status === "processed" ? "secondary" : "outline";

  return (
    <Card data-testid={`card-payroll-run-${run.id}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-4 flex-wrap">
          <CardTitle className="text-base">{companyName}</CardTitle>
          <span className="text-sm text-muted-foreground">
            {run.periodStart} — {run.periodEnd}
          </span>
          <Badge variant={statusVariant} data-testid={`badge-status-${run.id}`}>{run.status}</Badge>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">{run.workerCount} workers</span>
          <span className="text-sm font-medium">${Number(run.totalGross || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
          <span className="text-sm text-muted-foreground">{Number(run.totalHours || 0).toFixed(1)} hrs</span>
          <Button size="icon" variant="ghost" data-testid={`button-expand-${run.id}`} onClick={onToggle}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32 w-full" data-testid={`loading-items-${run.id}`} />
          ) : (
            <>
              <div className="flex gap-2 mb-4 flex-wrap">
                {run.status === "draft" && (
                  <Button
                    size="sm"
                    data-testid={`button-process-run-${run.id}`}
                    disabled={processMutation.isPending}
                    onClick={() => processMutation.mutate()}
                  >
                    <Zap className="mr-2 h-4 w-4" />
                    {processMutation.isPending ? "Processing..." : "Process Payroll"}
                  </Button>
                )}
                {run.status === "processed" && (
                  <Link href={`/print-check/${run.id}`}>
                    <Button variant="outline" size="sm" data-testid={`button-print-checks-${run.id}`}>
                      <Printer className="mr-2 h-4 w-4" />Print Checks
                    </Button>
                  </Link>
                )}
                <Button variant="outline" size="sm" data-testid={`button-export-csv-${run.id}`} onClick={() => onExportCSV(run, items)}>
                  <Download className="mr-2 h-4 w-4" />Export CSV
                </Button>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Worker</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Rate</TableHead>
                      <TableHead>Reg Hrs</TableHead>
                      <TableHead>OT Hrs</TableHead>
                      <TableHead>Reg Pay</TableHead>
                      <TableHead>OT Pay</TableHead>
                      <TableHead>Gross</TableHead>
                      <TableHead>Deductions</TableHead>
                      <TableHead>Net Pay</TableHead>
                      <TableHead>Check #</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map(item => (
                      <TableRow key={item.id} data-testid={`row-payroll-item-${item.id}`}>
                        <TableCell>{getWorkerName(item.workerId)}</TableCell>
                        <TableCell>{item.payType || "hourly"}</TableCell>
                        <TableCell>${Number(item.payRate || 0).toFixed(2)}</TableCell>
                        <TableCell>{Number(item.regularHours || 0).toFixed(1)}</TableCell>
                        <TableCell>{Number(item.overtimeHours || 0).toFixed(1)}</TableCell>
                        <TableCell>${Number(item.regularPay || 0).toFixed(2)}</TableCell>
                        <TableCell>${Number(item.overtimePay || 0).toFixed(2)}</TableCell>
                        <TableCell className="font-medium">${Number(item.grossPay || 0).toFixed(2)}</TableCell>
                        <TableCell>${Number(item.deductions || 0).toFixed(2)}</TableCell>
                        <TableCell className="font-medium">${Number(item.netPay || 0).toFixed(2)}</TableCell>
                        <TableCell>{item.checkNumber || "—"}</TableCell>
                      </TableRow>
                    ))}
                    {items.length === 0 && (
                      <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground">No items</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function PayStubsTab() {
  const { data: payrollRuns = [], isLoading: runsLoading } = useQuery<PayrollRun[]>({ queryKey: ["/api/payroll-runs"] });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });

  const allItemsQuery = useQuery<Array<PayrollItem & { _run: PayrollRun }>>({
    queryKey: ["/api/all-payroll-items", payrollRuns.map(r => r.id).join(",")],
    queryFn: async () => {
      const allItems: Array<PayrollItem & { _run: PayrollRun }> = [];
      for (const run of payrollRuns) {
        try {
          const res = await fetch(`/api/payroll-runs/${run.id}/items`, { credentials: "include" });
          if (res.ok) {
            const items: PayrollItem[] = await res.json();
            allItems.push(...items.map(item => ({ ...item, _run: run })));
          }
        } catch {}
      }
      return allItems;
    },
    enabled: payrollRuns.length > 0,
  });

  const items = allItemsQuery.data || [];
  const getWorkerName = (id: string) => {
    const w = workers.find(w => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  };

  if (runsLoading) {
    return <div data-testid="loading-pay-stubs"><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pay Stubs</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Gross Pay</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(item => (
                <TableRow key={item.id} data-testid={`row-pay-stub-${item.id}`}>
                  <TableCell>{getWorkerName(item.workerId)}</TableCell>
                  <TableCell>{item._run.periodStart} — {item._run.periodEnd}</TableCell>
                  <TableCell>${Number(item.grossPay || 0).toFixed(2)}</TableCell>
                  <TableCell><Badge variant="outline">{item._run.status || "draft"}</Badge></TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No pay stubs available</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function PayPeriodsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({ companyId: "", startDate: "", endDate: "", payDate: "" });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: payPeriods = [], isLoading } = useQuery<PayPeriod[]>({ queryKey: ["/api/pay-periods"] });

  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || id;

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/pay-periods", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-periods"] });
      toast({ title: "Pay period created" });
      setDialogOpen(false);
      setFormData({ companyId: "", startDate: "", endDate: "", payDate: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div data-testid="loading-pay-periods"><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-pay-period"><Plus className="mr-2 h-4 w-4" />Add Pay Period</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Pay Period</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={formData.companyId} onValueChange={v => setFormData(p => ({ ...p, companyId: v }))}>
                  <SelectTrigger data-testid="select-period-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" data-testid="input-period-start-date" value={formData.startDate} onChange={e => setFormData(p => ({ ...p, startDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" data-testid="input-period-end-date" value={formData.endDate} onChange={e => setFormData(p => ({ ...p, endDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Pay Date</Label>
                <Input type="date" data-testid="input-period-pay-date" value={formData.payDate} onChange={e => setFormData(p => ({ ...p, payDate: e.target.value }))} />
              </div>
              <Button
                className="w-full"
                data-testid="button-submit-pay-period"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate(formData)}
              >
                {createMutation.isPending ? "Creating..." : "Create Pay Period"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Pay Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payPeriods.map(pp => (
                  <TableRow key={pp.id} data-testid={`row-pay-period-${pp.id}`}>
                    <TableCell>{getCompanyName(pp.companyId)}</TableCell>
                    <TableCell>{pp.startDate}</TableCell>
                    <TableCell>{pp.endDate}</TableCell>
                    <TableCell>{pp.payDate || "—"}</TableCell>
                    <TableCell><Badge variant="outline" data-testid={`badge-period-status-${pp.id}`}>{pp.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {payPeriods.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No pay periods</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  mandatory_tax: "Mandatory Taxes",
  garnishment: "Garnishments & Court Orders",
  benefit_deduction: "Benefit Deductions",
  voluntary_deduction: "Voluntary Deductions",
};

const CATEGORY_ORDER = ["mandatory_tax", "garnishment", "benefit_deduction", "voluntary_deduction"];

const APPLIES_TO_LABELS: Record<string, string> = { all: "All Workers", employee: "Employees", contractor: "Contractors" };

function TaxesDeductionsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string>("all");
  const [formData, setFormData] = useState({
    companyId: "", name: "", type: "tax", category: "mandatory_tax", subcategory: "",
    calculationType: "percentage", rate: "", maxAmount: "", isEmployerPaid: false,
    isReferenceOnly: false, appliesTo: "all",
  });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: taxesDeductions = [], isLoading } = useQuery<TaxDeduction[]>({ queryKey: ["/api/taxes-deductions"] });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/taxes-deductions", {
        ...data,
        rate: data.rate ? String(data.rate) : "0",
        maxAmount: data.maxAmount ? String(data.maxAmount) : null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/taxes-deductions"] });
      toast({ title: "Tax/Deduction created" });
      setDialogOpen(false);
      setFormData({ companyId: "", name: "", type: "tax", category: "mandatory_tax", subcategory: "", calculationType: "percentage", rate: "", maxAmount: "", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "all" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const quickSetupMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await apiRequest("POST", "/api/taxes-deductions/quick-setup", { companyId });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/taxes-deductions"] });
      toast({ title: "Quick Setup Complete", description: `Created ${data.count} standard items` });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/taxes-deductions/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/taxes-deductions"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/taxes-deductions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/taxes-deductions"] });
      toast({ title: "Item deleted" });
    },
  });

  if (isLoading) return <div data-testid="loading-taxes-deductions"><Skeleton className="h-64 w-full" /></div>;

  const filteredItems = selectedCompany === "all"
    ? taxesDeductions
    : taxesDeductions.filter(td => td.companyId === selectedCompany);

  const groupedItems: Record<string, TaxDeduction[]> = {};
  for (const cat of CATEGORY_ORDER) groupedItems[cat] = [];
  for (const td of filteredItems) {
    const cat = td.category || "mandatory_tax";
    if (!groupedItems[cat]) groupedItems[cat] = [];
    groupedItems[cat].push(td);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Select value={selectedCompany} onValueChange={setSelectedCompany}>
            <SelectTrigger className="w-[200px]" data-testid="select-td-filter-company">
              <SelectValue placeholder="All companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          {selectedCompany !== "all" && (
            <Button
              variant="outline"
              data-testid="button-quick-setup"
              disabled={quickSetupMutation.isPending}
              onClick={() => quickSetupMutation.mutate(selectedCompany)}
            >
              <Zap className="mr-2 h-4 w-4" />
              {quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
            </Button>
          )}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-tax-deduction"><Plus className="mr-2 h-4 w-4" />Add Item</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Add Tax / Deduction / Benefit</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Company</Label>
                  <Select value={formData.companyId} onValueChange={v => setFormData(p => ({ ...p, companyId: v }))}>
                    <SelectTrigger data-testid="select-td-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                    <SelectContent>
                      {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input data-testid="input-td-name" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={formData.type} onValueChange={v => setFormData(p => ({ ...p, type: v }))}>
                      <SelectTrigger data-testid="select-td-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tax">Tax</SelectItem>
                        <SelectItem value="deduction">Deduction</SelectItem>
                        <SelectItem value="benefit">Benefit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select value={formData.category} onValueChange={v => setFormData(p => ({ ...p, category: v }))}>
                      <SelectTrigger data-testid="select-td-category"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORY_ORDER.map(c => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Calculation</Label>
                    <Select value={formData.calculationType} onValueChange={v => setFormData(p => ({ ...p, calculationType: v }))}>
                      <SelectTrigger data-testid="select-td-calc-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">Percentage</SelectItem>
                        <SelectItem value="fixed">Fixed Amount</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Applies To</Label>
                    <Select value={formData.appliesTo} onValueChange={v => setFormData(p => ({ ...p, appliesTo: v }))}>
                      <SelectTrigger data-testid="select-td-applies"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Workers</SelectItem>
                        <SelectItem value="employee">Employees Only</SelectItem>
                        <SelectItem value="contractor">Contractors Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Rate</Label>
                    <Input type="number" step="0.01" data-testid="input-td-rate" value={formData.rate} onChange={e => setFormData(p => ({ ...p, rate: e.target.value }))} placeholder={formData.calculationType === "percentage" ? "e.g. 6.2" : "e.g. 150.00"} />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Annual Amount</Label>
                    <Input type="number" step="0.01" data-testid="input-td-max-amount" value={formData.maxAmount} onChange={e => setFormData(p => ({ ...p, maxAmount: e.target.value }))} placeholder="Optional" />
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Checkbox id="isEmployerPaid" data-testid="checkbox-td-employer-paid" checked={formData.isEmployerPaid} onCheckedChange={(c) => setFormData(p => ({ ...p, isEmployerPaid: c === true }))} />
                    <Label htmlFor="isEmployerPaid">Employer Paid</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="isReferenceOnly" data-testid="checkbox-td-reference" checked={formData.isReferenceOnly} onCheckedChange={(c) => setFormData(p => ({ ...p, isReferenceOnly: c === true }))} />
                    <Label htmlFor="isReferenceOnly">Reference Only (not deducted)</Label>
                  </div>
                </div>
                <Button className="w-full" data-testid="button-submit-tax-deduction" disabled={createMutation.isPending || !formData.companyId || !formData.name} onClick={() => createMutation.mutate(formData)}>
                  {createMutation.isPending ? "Creating..." : "Create Item"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <DollarSign className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground mb-2">No taxes or deductions configured.</p>
            {selectedCompany !== "all" && (
              <p className="text-sm text-muted-foreground">Use Quick Setup to add standard US tax items for this company.</p>
            )}
          </CardContent>
        </Card>
      ) : (
        CATEGORY_ORDER.map(cat => {
          const items = groupedItems[cat];
          if (!items || items.length === 0) return null;
          return (
            <Card key={cat}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {CATEGORY_LABELS[cat]}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Applies To</TableHead>
                        <TableHead>Calc</TableHead>
                        <TableHead>Rate</TableHead>
                        <TableHead>Max</TableHead>
                        <TableHead>Flags</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-20">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map(td => (
                        <TableRow key={td.id} data-testid={`row-tax-deduction-${td.id}`} className={td.isReferenceOnly ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}>
                          <TableCell className="font-medium">{td.name}</TableCell>
                          <TableCell>
                            <Badge variant={td.type === "tax" ? "default" : td.type === "benefit" ? "secondary" : "outline"} className="text-xs">
                              {td.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{APPLIES_TO_LABELS[td.appliesTo || "all"] || "All"}</TableCell>
                          <TableCell className="text-xs">{td.calculationType === "percentage" ? "%" : "$"}</TableCell>
                          <TableCell>{td.calculationType === "percentage" ? `${Number(td.rate || 0)}%` : `$${Number(td.rate || 0).toFixed(2)}`}</TableCell>
                          <TableCell className="text-xs">{td.maxAmount ? `$${Number(td.maxAmount).toLocaleString()}` : "—"}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {td.isEmployerPaid && <Badge variant="outline" className="text-[10px]">Employer</Badge>}
                              {td.isReferenceOnly && <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-600">Ref Only</Badge>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <button
                              onClick={() => toggleActiveMutation.mutate({ id: td.id, isActive: !td.isActive })}
                              data-testid={`toggle-active-${td.id}`}
                              className="cursor-pointer"
                            >
                              <Badge variant={td.isActive ? "default" : "outline"} className="text-xs cursor-pointer">
                                {td.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </button>
                          </TableCell>
                          <TableCell>
                            <Button size="icon" variant="ghost" data-testid={`button-delete-td-${td.id}`} onClick={() => deleteMutation.mutate(td.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

function RemittanceSourcesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string>("all");
  const [formData, setFormData] = useState({
    companyId: "", name: "", type: "check", status: "enabled",
    country: "US", currency: "USD", routingNumber: "", accountNumber: "",
    institution: "", lastCheckNumber: 0,
  });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: remittanceSources = [], isLoading } = useQuery<RemittanceSource[]>({ queryKey: ["/api/remittance-sources"] });

  const quickSetupMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await apiRequest("POST", "/api/remittance-sources/quick-setup", { companyId });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/remittance-sources"] });
      toast({ title: "Quick Setup Complete", description: data.message || `Created ${data.count} remittance sources` });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/remittance-sources", {
        ...data,
        routingNumber: data.routingNumber || null,
        accountNumber: data.accountNumber || null,
        institution: data.institution || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/remittance-sources"] });
      toast({ title: "Remittance source created" });
      setDialogOpen(false);
      setFormData({ companyId: "", name: "", type: "check", status: "enabled", country: "US", currency: "USD", routingNumber: "", accountNumber: "", institution: "", lastCheckNumber: 0 });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <div data-testid="loading-remittance-sources"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Select value={selectedCompany} onValueChange={setSelectedCompany}>
            <SelectTrigger className="w-[200px]" data-testid="select-rs-filter-company">
              <SelectValue placeholder="All companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          {selectedCompany !== "all" && (
            <Button
              variant="secondary"
              data-testid="button-rs-quick-setup"
              disabled={quickSetupMutation.isPending}
              onClick={() => quickSetupMutation.mutate(selectedCompany)}
            >
              <Zap className="mr-2 h-4 w-4" />
              {quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
            </Button>
          )}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-remittance-source"><Plus className="mr-2 h-4 w-4" />Add Remittance Source</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Remittance Source</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={formData.companyId} onValueChange={v => setFormData(p => ({ ...p, companyId: v }))}>
                  <SelectTrigger data-testid="select-rs-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input data-testid="input-rs-name" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={formData.type} onValueChange={v => setFormData(p => ({ ...p, type: v }))}>
                  <SelectTrigger data-testid="select-rs-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="direct_deposit">Direct Deposit</SelectItem>
                    <SelectItem value="ach">ACH</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={v => setFormData(p => ({ ...p, status: v }))}>
                  <SelectTrigger data-testid="select-rs-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="enabled">Enabled</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Country</Label>
                <Input data-testid="input-rs-country" value={formData.country} onChange={e => setFormData(p => ({ ...p, country: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Input data-testid="input-rs-currency" value={formData.currency} onChange={e => setFormData(p => ({ ...p, currency: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Routing Number</Label>
                <Input data-testid="input-rs-routing" value={formData.routingNumber} onChange={e => setFormData(p => ({ ...p, routingNumber: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Account Number</Label>
                <Input data-testid="input-rs-account" value={formData.accountNumber} onChange={e => setFormData(p => ({ ...p, accountNumber: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Institution</Label>
                <Input data-testid="input-rs-institution" value={formData.institution} onChange={e => setFormData(p => ({ ...p, institution: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Last Check Number</Label>
                <Input type="number" data-testid="input-rs-last-check" value={formData.lastCheckNumber} onChange={e => setFormData(p => ({ ...p, lastCheckNumber: Number(e.target.value) }))} />
              </div>
              <Button
                className="w-full"
                data-testid="button-submit-remittance-source"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate(formData)}
              >
                {createMutation.isPending ? "Creating..." : "Create Remittance Source"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Institution</TableHead>
                  <TableHead>Last Check #</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remittanceSources.map(rs => (
                  <TableRow key={rs.id} data-testid={`row-remittance-source-${rs.id}`}>
                    <TableCell className="font-medium">{rs.name}</TableCell>
                    <TableCell>
                      <Badge variant={rs.type === "check" ? "default" : rs.type === "direct_deposit" ? "secondary" : "outline"} data-testid={`badge-rs-type-${rs.id}`}>
                        {rs.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={rs.status === "enabled" ? "default" : "outline"} data-testid={`badge-rs-status-${rs.id}`}>
                        {rs.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{rs.country || "—"}</TableCell>
                    <TableCell>{rs.currency || "—"}</TableCell>
                    <TableCell>{rs.institution || "—"}</TableCell>
                    <TableCell>{rs.lastCheckNumber || 0}</TableCell>
                  </TableRow>
                ))}
                {remittanceSources.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No remittance sources configured</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RemittanceAgenciesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string>("all");
  const [formData, setFormData] = useState({
    companyId: "", name: "", type: "federal", status: "enabled",
    country: "US", provinceState: "", agency: "", startDate: "", endDate: "",
  });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: remittanceAgencies = [], isLoading } = useQuery<RemittanceAgency[]>({ queryKey: ["/api/remittance-agencies"] });

  const quickSetupMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await apiRequest("POST", "/api/remittance-agencies/quick-setup", { companyId });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/remittance-agencies"] });
      toast({ title: "Quick Setup Complete", description: data.message || `Created ${data.count} remittance agencies` });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/remittance-agencies", {
        ...data,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        provinceState: data.provinceState || null,
        agency: data.agency || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/remittance-agencies"] });
      toast({ title: "Remittance agency created" });
      setDialogOpen(false);
      setFormData({ companyId: "", name: "", type: "federal", status: "enabled", country: "US", provinceState: "", agency: "", startDate: "", endDate: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <div data-testid="loading-remittance-agencies"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Select value={selectedCompany} onValueChange={setSelectedCompany}>
            <SelectTrigger className="w-[200px]" data-testid="select-ra-filter-company">
              <SelectValue placeholder="All companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          {selectedCompany !== "all" && (
            <Button
              variant="secondary"
              data-testid="button-ra-quick-setup"
              disabled={quickSetupMutation.isPending}
              onClick={() => quickSetupMutation.mutate(selectedCompany)}
            >
              <Zap className="mr-2 h-4 w-4" />
              {quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
            </Button>
          )}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-remittance-agency"><Plus className="mr-2 h-4 w-4" />Add Remittance Agency</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Remittance Agency</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={formData.companyId} onValueChange={v => setFormData(p => ({ ...p, companyId: v }))}>
                  <SelectTrigger data-testid="select-ra-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input data-testid="input-ra-name" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={formData.type} onValueChange={v => setFormData(p => ({ ...p, type: v }))}>
                  <SelectTrigger data-testid="select-ra-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="federal">Federal</SelectItem>
                    <SelectItem value="state">State</SelectItem>
                    <SelectItem value="local">Local</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={v => setFormData(p => ({ ...p, status: v }))}>
                  <SelectTrigger data-testid="select-ra-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="enabled">Enabled</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Country</Label>
                <Input data-testid="input-ra-country" value={formData.country} onChange={e => setFormData(p => ({ ...p, country: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Province/State</Label>
                <Input data-testid="input-ra-province" value={formData.provinceState} onChange={e => setFormData(p => ({ ...p, provinceState: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Agency</Label>
                <Input data-testid="input-ra-agency" value={formData.agency} onChange={e => setFormData(p => ({ ...p, agency: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" data-testid="input-ra-start-date" value={formData.startDate} onChange={e => setFormData(p => ({ ...p, startDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" data-testid="input-ra-end-date" value={formData.endDate} onChange={e => setFormData(p => ({ ...p, endDate: e.target.value }))} />
              </div>
              <Button
                className="w-full"
                data-testid="button-submit-remittance-agency"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate(formData)}
              >
                {createMutation.isPending ? "Creating..." : "Create Remittance Agency"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Province/State</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remittanceAgencies.map(ra => (
                  <TableRow key={ra.id} data-testid={`row-remittance-agency-${ra.id}`}>
                    <TableCell className="font-medium">{ra.name}</TableCell>
                    <TableCell>
                      <Badge variant={ra.type === "federal" ? "default" : ra.type === "state" ? "secondary" : "outline"} data-testid={`badge-ra-type-${ra.id}`}>
                        {ra.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={ra.status === "enabled" ? "default" : "outline"} data-testid={`badge-ra-status-${ra.id}`}>
                        {ra.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{ra.country || "—"}</TableCell>
                    <TableCell>{ra.provinceState || "—"}</TableCell>
                    <TableCell>{ra.startDate || "—"}</TableCell>
                    <TableCell>{ra.endDate || "—"}</TableCell>
                  </TableRow>
                ))}
                {remittanceAgencies.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No remittance agencies configured</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const TAX_WIZARD_STEPS = [
  { id: "configure", label: "Configure", icon: Settings },
  { id: "workers", label: "Workers & Summary", icon: Calculator },
  { id: "forms", label: "Generate Forms", icon: FileText },
  { id: "complete", label: "Review & Complete", icon: Check },
] as const;

type TaxWizardStepId = typeof TAX_WIZARD_STEPS[number]["id"];

const RUN_TYPE_OPTIONS = [
  { value: "quarterly_q1", label: "Q1 Quarterly (Jan-Mar)", description: "941, state withholding" },
  { value: "quarterly_q2", label: "Q2 Quarterly (Apr-Jun)", description: "941, state withholding" },
  { value: "quarterly_q3", label: "Q3 Quarterly (Jul-Sep)", description: "941, state withholding" },
  { value: "quarterly_q4", label: "Q4 Quarterly (Oct-Dec)", description: "941, state withholding" },
  { value: "annual", label: "Annual Year-End", description: "W-2s, 1099-NECs, 940, W-3" },
  { value: "audit", label: "Audit / Review", description: "Full tax summary for audit" },
];

const OFFICIAL_FORM_URLS: Record<string, string> = {
  w2: "https://www.irs.gov/pub/irs-pdf/fw2.pdf",
  "1099nec": "https://www.irs.gov/pub/irs-pdf/f1099nec.pdf",
  "941": "https://www.irs.gov/pub/irs-pdf/f941.pdf",
  "940": "https://www.irs.gov/pub/irs-pdf/f940.pdf",
  w3: "https://www.irs.gov/pub/irs-pdf/fw3.pdf",
  "1096": "https://www.irs.gov/pub/irs-pdf/f1096.pdf",
  de9: "https://edd.ca.gov/siteassets/files/pdf_pub_ctr/de9.pdf",
  de9c: "https://edd.ca.gov/siteassets/files/pdf_pub_ctr/de9c.pdf",
};

const TAX_FORMS = [
  { id: "w2", label: "W-2 (Wage & Tax Statement)", description: "For each employee — IRS", appliesTo: "employee", runTypes: ["annual"] },
  { id: "1099nec", label: "1099-NEC (Nonemployee Compensation)", description: "For each contractor paid $600+ — IRS", appliesTo: "contractor", runTypes: ["annual"] },
  { id: "941", label: "Form 941 (Quarterly Federal Tax Return)", description: "Federal employment taxes — IRS", appliesTo: "company", runTypes: ["quarterly_q1", "quarterly_q2", "quarterly_q3", "quarterly_q4"] },
  { id: "940", label: "Form 940 (Annual FUTA Tax Return)", description: "Federal unemployment tax — IRS", appliesTo: "company", runTypes: ["annual"] },
  { id: "w3", label: "W-3 (Transmittal of Wage Statements)", description: "Summary transmittal for all W-2s — IRS", appliesTo: "company", runTypes: ["annual"] },
  { id: "1096", label: "Form 1096 (Annual Summary & Transmittal)", description: "Transmittal for 1099 forms — IRS", appliesTo: "company", runTypes: ["annual"] },
  { id: "de9", label: "DE 9 (Quarterly Contribution Return)", description: "CA quarterly employment taxes — EDD", appliesTo: "company", runTypes: ["quarterly_q1", "quarterly_q2", "quarterly_q3", "quarterly_q4"] },
  { id: "de9c", label: "DE 9C (Quarterly Employee Detail)", description: "CA individual employee wage detail — EDD", appliesTo: "company", runTypes: ["quarterly_q1", "quarterly_q2", "quarterly_q3", "quarterly_q4"] },
  { id: "state_withholding", label: "State Withholding Return", description: "State income tax withholding", appliesTo: "company", runTypes: ["quarterly_q1", "quarterly_q2", "quarterly_q3", "quarterly_q4", "annual"] },
  { id: "tax_summary", label: "Tax Summary Report", description: "Complete tax liability summary", appliesTo: "company", runTypes: ["quarterly_q1", "quarterly_q2", "quarterly_q3", "quarterly_q4", "annual", "audit"] },
];

function TaxWizardTab() {
  const { toast } = useToast();
  const [wizardStep, setWizardStep] = useState<TaxWizardStepId>("configure");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [taxYear, setTaxYear] = useState<string>(String(new Date().getFullYear()));
  const [runType, setRunType] = useState<string>("");
  const [selectedForms, setSelectedForms] = useState<Set<string>>(new Set());

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: legalEntities = [] } = useQuery<LegalEntity[]>({ queryKey: ["/api/legal-entities"] });
  const { data: taxesDeductions = [] } = useQuery<TaxDeduction[]>({ queryKey: ["/api/taxes-deductions"] });
  const { data: payrollRuns = [] } = useQuery<PayrollRun[]>({ queryKey: ["/api/payroll-runs"] });

  const selectedCompany = companies.find(c => c.id === selectedCompanyId);
  const selectedLegalEntity = selectedCompany?.legalEntityId
    ? legalEntities.find(le => le.id === selectedCompany.legalEntityId)
    : null;

  const companyWorkers = workers.filter(w => w.companyId === selectedCompanyId);
  const employees = companyWorkers.filter(w => w.workerType === "employee" || !w.workerType);
  const contractors = companyWorkers.filter(w => w.workerType === "contractor");
  const companyDeductions = taxesDeductions.filter(td => td.companyId === selectedCompanyId);

  const companyPayrollRuns = payrollRuns.filter(pr => pr.companyId === selectedCompanyId && pr.status === "processed");

  const calcWorkerTax = (worker: Worker) => {
    const grossPay = Number(worker.payRate || 0) * 2080;
    const isContractor = worker.workerType === "contractor";
    const applicableDeductions = companyDeductions.filter(td => {
      if (!td.isActive) return false;
      const appliesTo = td.appliesTo || "all";
      if (appliesTo === "employee" && isContractor) return false;
      if (appliesTo === "contractor" && !isContractor) return false;
      return true;
    });
    let totalTax = 0;
    let totalRef = 0;
    const breakdown: { name: string; amount: number; isRef: boolean }[] = [];
    for (const td of applicableDeductions) {
      if (td.isEmployerPaid) continue;
      let amount = 0;
      if (td.calculationType === "percentage") {
        const base = td.maxAmount ? Math.min(grossPay, Number(td.maxAmount)) : grossPay;
        amount = base * (Number(td.rate || 0) / 100);
      } else {
        amount = Number(td.rate || 0) * 26;
      }
      const isRef = td.isReferenceOnly || false;
      breakdown.push({ name: td.name, amount, isRef });
      if (isRef) totalRef += amount;
      else totalTax += amount;
    }
    return { grossPay, totalTax, totalRef, netPay: grossPay - totalTax, breakdown, isContractor };
  };

  const availableForms = TAX_FORMS.filter(f => f.runTypes.includes(runType));

  const currentStepIndex = TAX_WIZARD_STEPS.findIndex(s => s.id === wizardStep);
  const canGoNext = () => {
    if (wizardStep === "configure") return !!selectedCompanyId && !!runType;
    if (wizardStep === "workers") return true;
    if (wizardStep === "forms") return selectedForms.size > 0;
    return true;
  };
  const goNext = () => {
    if (wizardStep === "configure") {
      const defaultForms = availableForms.map(f => f.id);
      setSelectedForms(new Set(defaultForms));
    }
    if (currentStepIndex < TAX_WIZARD_STEPS.length - 1) setWizardStep(TAX_WIZARD_STEPS[currentStepIndex + 1].id);
  };
  const goPrev = () => {
    if (currentStepIndex > 0) setWizardStep(TAX_WIZARD_STEPS[currentStepIndex - 1].id);
  };
  const resetWizard = () => {
    setWizardStep("configure");
    setSelectedCompanyId("");
    setRunType("");
    setSelectedForms(new Set());
  };

  const toggleForm = (formId: string) => {
    setSelectedForms(prev => {
      const next = new Set(prev);
      if (next.has(formId)) next.delete(formId);
      else next.add(formId);
      return next;
    });
  };

  const runTypeLabel = RUN_TYPE_OPTIONS.find(r => r.value === runType)?.label || runType;

  const w2Count = employees.length;
  const nec1099Count = contractors.filter(c => Number(c.payRate || 0) * 2080 >= 600).length;

  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6" data-testid="tax-wizard">
      <div className="flex items-center gap-2 flex-wrap">
        {TAX_WIZARD_STEPS.map((step, idx) => {
          const StepIcon = step.icon;
          const isActive = step.id === wizardStep;
          const isCompleted = idx < currentStepIndex;
          return (
            <div key={step.id} className="flex items-center gap-2">
              {idx > 0 && <div className={`h-px w-6 ${isCompleted ? "bg-primary" : "bg-border"}`} />}
              <button
                data-testid={`wizard-step-${step.id}`}
                onClick={() => { if (idx <= currentStepIndex) setWizardStep(step.id); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive ? "bg-primary text-primary-foreground" : isCompleted ? "bg-primary/10 text-primary" : "text-muted-foreground"
                }`}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : <StepIcon className="h-4 w-4" />}
                {step.label}
              </button>
            </div>
          );
        })}
      </div>

      {wizardStep === "configure" && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Configure Tax Run</h3>
            <p className="text-sm text-muted-foreground">Select the company, tax year, and type of tax run to process.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Company</Label>
              <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                <SelectTrigger data-testid="select-wizard-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>
                  {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {selectedCompany && selectedLegalEntity && (
                <p className="text-xs text-muted-foreground">Legal Entity: {selectedLegalEntity.legalName}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Tax Year</Label>
              <Select value={taxYear} onValueChange={setTaxYear}>
                <SelectTrigger data-testid="select-wizard-year"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[0, 1, 2].map(offset => {
                    const y = String(new Date().getFullYear() - offset);
                    return <SelectItem key={y} value={y}>{y}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Run Type</Label>
              <Select value={runType} onValueChange={setRunType}>
                <SelectTrigger data-testid="select-wizard-run-type"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {RUN_TYPE_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {selectedCompanyId && runType && (
            <Card>
              <CardContent className="p-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold">{employees.length}</p>
                    <p className="text-xs text-muted-foreground">Employees</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{contractors.length}</p>
                    <p className="text-xs text-muted-foreground">Contractors</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{companyDeductions.filter(d => d.isActive).length}</p>
                    <p className="text-xs text-muted-foreground">Active Tax Items</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{companyPayrollRuns.length}</p>
                    <p className="text-xs text-muted-foreground">Payroll Runs</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {selectedCompanyId && companyDeductions.length === 0 && (
            <Card className="border-amber-200 dark:border-amber-800">
              <CardContent className="p-4 flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium">No tax items configured for this company.</p>
                  <p className="text-xs text-muted-foreground">Go to Taxes & Deductions tab and use Quick Setup to add standard US tax items first.</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {wizardStep === "workers" && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Workers & Tax Summary</h3>
            <p className="text-sm text-muted-foreground">{selectedCompany?.name} — {taxYear} {runTypeLabel}. Estimated annual figures based on pay rates.</p>
          </div>
          {companyWorkers.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                No workers found for this company.
              </CardContent>
            </Card>
          ) : (
            <>
              {employees.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Employees ({employees.length})</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Employee</TableHead>
                            <TableHead className="text-right">Est. Gross</TableHead>
                            <TableHead className="text-right">Est. Taxes</TableHead>
                            <TableHead className="text-right">Est. Net</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {employees.map(w => {
                            const tax = calcWorkerTax(w);
                            return (
                              <TableRow key={w.id} data-testid={`row-worker-${w.id}`}>
                                <TableCell className="font-medium">{w.firstName} {w.lastName}<span className="text-xs text-muted-foreground ml-2">#{w.employeeNumber || "—"}</span></TableCell>
                                <TableCell className="text-right">${fmt(tax.grossPay)}</TableCell>
                                <TableCell className="text-right text-destructive">${fmt(tax.totalTax)}</TableCell>
                                <TableCell className="text-right font-medium">${fmt(tax.netPay)}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
              {contractors.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Contractors ({contractors.length})</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Contractor</TableHead>
                            <TableHead className="text-right">Est. Gross</TableHead>
                            <TableHead className="text-right">Est. Net (Paid)</TableHead>
                            <TableHead className="text-right">SE Tax (Reference)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {contractors.map(w => {
                            const tax = calcWorkerTax(w);
                            return (
                              <TableRow key={w.id} data-testid={`row-worker-${w.id}`}>
                                <TableCell className="font-medium">{w.firstName} {w.lastName}</TableCell>
                                <TableCell className="text-right">${fmt(tax.grossPay)}</TableCell>
                                <TableCell className="text-right font-medium">${fmt(tax.netPay)}</TableCell>
                                <TableCell className="text-right">
                                  {tax.totalRef > 0 ? (
                                    <span className="text-blue-600 dark:text-blue-400" title="Self-employment tax the contractor is responsible for paying independently">
                                      ${fmt(tax.totalRef)}
                                    </span>
                                  ) : "—"}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                  <CardContent className="pt-0 pb-3">
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      Self-Employment Tax is shown for reference only. Contractors are responsible for paying their own Social Security (12.4%) and Medicare (2.9%) taxes.
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {wizardStep === "forms" && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Generate Tax Forms</h3>
            <p className="text-sm text-muted-foreground">Select which forms to generate for {taxYear} {runTypeLabel}.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {availableForms.map(form => {
              const isSelected = selectedForms.has(form.id);
              let count = "";
              if (form.id === "w2") count = `${w2Count} form(s)`;
              else if (form.id === "1099nec") count = `${nec1099Count} form(s)`;
              return (
                <button
                  key={form.id}
                  data-testid={`form-option-${form.id}`}
                  onClick={() => toggleForm(form.id)}
                  className={`p-4 border rounded-lg text-left transition-all ${
                    isSelected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? "bg-primary border-primary" : "border-muted-foreground"}`}>
                        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                      <span className="font-medium text-sm">{form.label}</span>
                    </div>
                    {count && <Badge variant="secondary" className="text-xs">{count}</Badge>}
                  </div>
                  <div className="flex items-center gap-2 mt-1 ml-6">
                    <p className="text-xs text-muted-foreground">{form.description}</p>
                    {OFFICIAL_FORM_URLS[form.id] && (
                      <a
                        href={OFFICIAL_FORM_URLS[form.id]}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`link-official-form-${form.id}`}
                        onClick={e => e.stopPropagation()}
                        className="text-xs text-primary hover:underline flex items-center gap-0.5 flex-shrink-0"
                      >
                        Official PDF <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {availableForms.length === 0 && (
            <Card><CardContent className="p-6 text-center text-muted-foreground">No forms available for this run type.</CardContent></Card>
          )}
        </div>
      )}

      {wizardStep === "complete" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 mx-auto mb-4">
                <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-xl font-semibold text-center mb-2">Tax Run Complete</h3>
              <p className="text-center text-muted-foreground mb-6">
                {taxYear} {runTypeLabel} for {selectedCompany?.name}
              </p>

              <div className="space-y-4">
                <div className="border rounded-lg p-4">
                  <h4 className="font-semibold mb-3">Generated Forms</h4>
                  <div className="space-y-2">
                    {[...selectedForms].map(formId => {
                      const form = TAX_FORMS.find(f => f.id === formId);
                      if (!form) return null;
                      let count = 1;
                      if (formId === "w2") count = w2Count;
                      if (formId === "1099nec") count = nec1099Count;
                      return (
                        <div key={formId} className="flex items-center justify-between py-1" data-testid={`generated-form-${formId}`}>
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-primary" />
                            <span className="text-sm">{form.label}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">{count} form(s)</Badge>
                            {OFFICIAL_FORM_URLS[formId] && (
                              <a href={OFFICIAL_FORM_URLS[formId]} target="_blank" rel="noopener noreferrer" data-testid={`link-blank-form-${formId}`}>
                                <Button size="sm" variant="ghost" className="text-xs"><ExternalLink className="h-3 w-3 mr-1" />Blank Form</Button>
                              </a>
                            )}
                            <Button size="sm" variant="outline" data-testid={`button-download-${formId}`}>
                              <Download className="h-3 w-3 mr-1" />Print/Export
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {contractors.length > 0 && (
                  <div className="border rounded-lg p-4 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
                    <h4 className="font-semibold mb-2 text-blue-700 dark:text-blue-300">Contractor Self-Employment Tax Reference</h4>
                    <p className="text-xs text-muted-foreground mb-3">The following amounts are what contractors owe for self-employment tax (not deducted from their pay):</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Contractor</TableHead>
                          <TableHead className="text-right">Total Paid</TableHead>
                          <TableHead className="text-right">SE Tax (SS 12.4%)</TableHead>
                          <TableHead className="text-right">SE Tax (Medicare 2.9%)</TableHead>
                          <TableHead className="text-right">Total SE Tax</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {contractors.map(c => {
                          const gross = Number(c.payRate || 0) * 2080;
                          const ssBase = Math.min(gross, 168600);
                          const ssTax = ssBase * 0.124;
                          const medTax = gross * 0.029;
                          return (
                            <TableRow key={c.id}>
                              <TableCell className="font-medium">{c.firstName} {c.lastName}</TableCell>
                              <TableCell className="text-right">${fmt(gross)}</TableCell>
                              <TableCell className="text-right">${fmt(ssTax)}</TableCell>
                              <TableCell className="text-right">${fmt(medTax)}</TableCell>
                              <TableCell className="text-right font-medium text-blue-600">${fmt(ssTax + medTax)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                <div className="flex items-center justify-center gap-3 pt-4">
                  <Button data-testid="button-wizard-restart" onClick={resetWizard}>
                    Start New Tax Run
                  </Button>
                  <Button variant="outline" data-testid="button-wizard-print-all" onClick={() => window.print()}>
                    <Printer className="mr-2 h-4 w-4" />Print Summary
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {wizardStep !== "complete" && (
        <div className="flex items-center justify-between gap-4">
          <Button variant="outline" data-testid="button-wizard-prev" disabled={currentStepIndex === 0} onClick={goPrev}>
            <ChevronLeft className="mr-2 h-4 w-4" />Back
          </Button>
          <Button data-testid="button-wizard-next" disabled={!canGoNext()} onClick={goNext}>
            {wizardStep === "forms" ? "Generate & Complete" : "Next"}
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

const PSA_TYPE_LABELS: Record<string, string> = {
  earning: "Earnings",
  tax: "Taxes",
  deduction: "Deductions",
  employer_contribution: "Employer Contributions",
  employee_contribution: "Employee Contributions",
  benefit: "Benefits",
  other: "Other",
};
const PSA_TYPE_ORDER = ["earning", "tax", "deduction", "employer_contribution", "employee_contribution", "benefit", "other"];

function PayStubAccountsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string>("all");
  const [formData, setFormData] = useState({
    companyId: "", legalEntityId: "", name: "", type: "earning", status: "enabled",
    displayOrder: 0, debitAccount: "", creditAccount: "",
  });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: legalEntities = [] } = useQuery<LegalEntity[]>({ queryKey: ["/api/legal-entities"] });
  const { data: payStubAccounts = [], isLoading } = useQuery<PayStubAccount[]>({ queryKey: ["/api/pay-stub-accounts"] });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/pay-stub-accounts", {
        ...data,
        legalEntityId: data.legalEntityId && data.legalEntityId !== "none" ? data.legalEntityId : null,
        debitAccount: data.debitAccount || null,
        creditAccount: data.creditAccount || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-stub-accounts"] });
      toast({ title: "Pay stub account created" });
      setDialogOpen(false);
      setFormData({ companyId: "", legalEntityId: "", name: "", type: "earning", status: "enabled", displayOrder: 0, debitAccount: "", creditAccount: "" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const quickSetupMutation = useMutation({
    mutationFn: async ({ companyId, legalEntityId }: { companyId: string; legalEntityId: string }) => {
      const res = await apiRequest("POST", "/api/pay-stub-accounts/quick-setup", { companyId, legalEntityId: legalEntityId || null });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-stub-accounts"] });
      toast({ title: "Quick Setup Complete", description: data.message });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/pay-stub-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-stub-accounts"] });
      toast({ title: "Account deleted" });
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiRequest("PATCH", `/api/pay-stub-accounts/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-stub-accounts"] });
    },
  });

  if (isLoading) return <div data-testid="loading-pay-stub-accounts"><Skeleton className="h-64 w-full" /></div>;

  const getLegalEntityName = (leId: string | null | undefined) => {
    if (!leId) return null;
    return legalEntities.find(le => le.id === leId)?.legalName || null;
  };

  const selectedComp = companies.find(c => c.id === selectedCompany);
  const selectedCompLegalEntityId = selectedComp?.legalEntityId || "";

  const filteredAccounts = selectedCompany === "all"
    ? payStubAccounts
    : payStubAccounts.filter(a => a.companyId === selectedCompany);

  const sortedAccounts = [...filteredAccounts].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

  const groupedAccounts: Record<string, PayStubAccount[]> = {};
  for (const t of PSA_TYPE_ORDER) groupedAccounts[t] = [];
  for (const a of sortedAccounts) {
    const t = a.type || "other";
    if (!groupedAccounts[t]) groupedAccounts[t] = [];
    groupedAccounts[t].push(a);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Select value={selectedCompany} onValueChange={setSelectedCompany}>
          <SelectTrigger className="w-[200px]" data-testid="select-psa-filter-company">
            <SelectValue placeholder="All companies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          {selectedCompany !== "all" && (
            <Button
              variant="outline"
              data-testid="button-psa-quick-setup"
              disabled={quickSetupMutation.isPending}
              onClick={() => quickSetupMutation.mutate({ companyId: selectedCompany, legalEntityId: selectedCompLegalEntityId })}
            >
              <Zap className="mr-2 h-4 w-4" />
              {quickSetupMutation.isPending ? "Setting up..." : "Quick Setup"}
            </Button>
          )}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-pay-stub-account"><Plus className="mr-2 h-4 w-4" />Add Account</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Add Pay Stub Account</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Company</Label>
                    <Select value={formData.companyId} onValueChange={v => setFormData(p => ({ ...p, companyId: v }))}>
                      <SelectTrigger data-testid="select-psa-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                      <SelectContent>
                        {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Paid By (Legal Entity)</Label>
                    <Select value={formData.legalEntityId} onValueChange={v => setFormData(p => ({ ...p, legalEntityId: v }))}>
                      <SelectTrigger data-testid="select-psa-legal-entity"><SelectValue placeholder="Optional" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {legalEntities.map(le => <SelectItem key={le.id} value={le.id}>{le.legalName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input data-testid="input-psa-name" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={formData.type} onValueChange={v => setFormData(p => ({ ...p, type: v }))}>
                      <SelectTrigger data-testid="select-psa-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="earning">Earning</SelectItem>
                        <SelectItem value="tax">Tax</SelectItem>
                        <SelectItem value="deduction">Deduction</SelectItem>
                        <SelectItem value="employer_contribution">Employer Contribution</SelectItem>
                        <SelectItem value="employee_contribution">Employee Contribution</SelectItem>
                        <SelectItem value="benefit">Benefit</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={formData.status} onValueChange={v => setFormData(p => ({ ...p, status: v }))}>
                      <SelectTrigger data-testid="select-psa-status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="enabled">Enabled</SelectItem>
                        <SelectItem value="disabled">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Display Order</Label>
                    <Input type="number" data-testid="input-psa-display-order" value={formData.displayOrder} onChange={e => setFormData(p => ({ ...p, displayOrder: Number(e.target.value) }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Debit Account (GL)</Label>
                    <Input data-testid="input-psa-debit" value={formData.debitAccount} onChange={e => setFormData(p => ({ ...p, debitAccount: e.target.value }))} placeholder="Optional" />
                  </div>
                  <div className="space-y-2">
                    <Label>Credit Account (GL)</Label>
                    <Input data-testid="input-psa-credit" value={formData.creditAccount} onChange={e => setFormData(p => ({ ...p, creditAccount: e.target.value }))} placeholder="Optional" />
                  </div>
                </div>
                <Button
                  className="w-full"
                  data-testid="button-submit-pay-stub-account"
                  disabled={createMutation.isPending || !formData.companyId || !formData.name}
                  onClick={() => createMutation.mutate(formData)}
                >
                  {createMutation.isPending ? "Creating..." : "Create Account"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {filteredAccounts.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Receipt className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground mb-2">No pay stub accounts configured.</p>
            {selectedCompany !== "all" && (
              <p className="text-sm text-muted-foreground">Use Quick Setup to add standard earnings, taxes, deductions, and employer contributions.</p>
            )}
          </CardContent>
        </Card>
      ) : (
        PSA_TYPE_ORDER.map(type => {
          const items = groupedAccounts[type];
          if (!items || items.length === 0) return null;
          return (
            <Card key={type}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {PSA_TYPE_LABELS[type] || type}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Paid By (Legal Entity)</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Order</TableHead>
                        <TableHead>Debit</TableHead>
                        <TableHead>Credit</TableHead>
                        <TableHead className="w-20">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map(psa => {
                        const comp = companies.find(c => c.id === psa.companyId);
                        const leName = getLegalEntityName(psa.legalEntityId);
                        return (
                          <TableRow key={psa.id} data-testid={`row-pay-stub-account-${psa.id}`}>
                            <TableCell className="font-medium">{psa.name}</TableCell>
                            <TableCell className="text-sm">{comp?.name || "—"}</TableCell>
                            <TableCell className="text-sm">{leName || "—"}</TableCell>
                            <TableCell>
                              <button
                                onClick={() => toggleStatusMutation.mutate({ id: psa.id, status: psa.status === "enabled" ? "disabled" : "enabled" })}
                                className="cursor-pointer"
                                data-testid={`toggle-psa-status-${psa.id}`}
                              >
                                <Badge variant={psa.status === "enabled" ? "default" : "outline"} className="text-xs cursor-pointer">
                                  {psa.status}
                                </Badge>
                              </button>
                            </TableCell>
                            <TableCell>{psa.displayOrder ?? 0}</TableCell>
                            <TableCell className="text-xs">{psa.debitAccount || "—"}</TableCell>
                            <TableCell className="text-xs">{psa.creditAccount || "—"}</TableCell>
                            <TableCell>
                              <Button size="icon" variant="ghost" data-testid={`button-delete-psa-${psa.id}`} onClick={() => deleteMutation.mutate(psa.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

function PayStubAmendmentsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    companyId: "", workerId: "", payStubAccountId: "", amountType: "fixed",
    amount: "", rate: "", units: "", percent: "", effectiveDate: "", description: "",
  });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: payStubAccountsList = [] } = useQuery<PayStubAccount[]>({ queryKey: ["/api/pay-stub-accounts"] });
  const { data: amendments = [], isLoading } = useQuery<PayStubAmendment[]>({ queryKey: ["/api/pay-stub-amendments"] });

  const getWorkerName = (id: string) => { const w = workers.find(w => w.id === id); return w ? `${w.firstName} ${w.lastName}` : id; };
  const getAccountName = (id: string) => payStubAccountsList.find(a => a.id === id)?.name || id;
  const filteredWorkers = formData.companyId ? workers.filter(w => w.companyId === formData.companyId) : workers;

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/pay-stub-amendments", {
        ...data,
        amount: data.amount ? String(data.amount) : "0",
        rate: data.rate ? String(data.rate) : "0",
        units: data.units ? String(data.units) : "0",
        percent: data.percent ? String(data.percent) : "0",
        effectiveDate: data.effectiveDate || null,
        description: data.description || null,
        payStubAccountId: data.payStubAccountId || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-stub-amendments"] });
      toast({ title: "Pay stub amendment created" });
      setDialogOpen(false);
      setFormData({ companyId: "", workerId: "", payStubAccountId: "", amountType: "fixed", amount: "", rate: "", units: "", percent: "", effectiveDate: "", description: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <div data-testid="loading-pay-stub-amendments"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-pay-stub-amendment"><Plus className="mr-2 h-4 w-4" />Add Amendment</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Pay Stub Amendment</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={formData.companyId} onValueChange={v => setFormData(p => ({ ...p, companyId: v, workerId: "" }))}>
                  <SelectTrigger data-testid="select-psam-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Worker</Label>
                <Select value={formData.workerId} onValueChange={v => setFormData(p => ({ ...p, workerId: v }))}>
                  <SelectTrigger data-testid="select-psam-worker"><SelectValue placeholder="Select worker" /></SelectTrigger>
                  <SelectContent>
                    {filteredWorkers.map(w => <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Pay Stub Account</Label>
                <Select value={formData.payStubAccountId} onValueChange={v => setFormData(p => ({ ...p, payStubAccountId: v }))}>
                  <SelectTrigger data-testid="select-psam-account"><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    {payStubAccountsList.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount Type</Label>
                <Select value={formData.amountType} onValueChange={v => setFormData(p => ({ ...p, amountType: v }))}>
                  <SelectTrigger data-testid="select-psam-amount-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed</SelectItem>
                    <SelectItem value="percentage">Percentage</SelectItem>
                    <SelectItem value="units">Units</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input type="number" step="0.01" data-testid="input-psam-amount" value={formData.amount} onChange={e => setFormData(p => ({ ...p, amount: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Rate</Label>
                <Input type="number" step="0.01" data-testid="input-psam-rate" value={formData.rate} onChange={e => setFormData(p => ({ ...p, rate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Units</Label>
                <Input type="number" step="0.01" data-testid="input-psam-units" value={formData.units} onChange={e => setFormData(p => ({ ...p, units: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Percent</Label>
                <Input type="number" step="0.01" data-testid="input-psam-percent" value={formData.percent} onChange={e => setFormData(p => ({ ...p, percent: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Effective Date</Label>
                <Input type="date" data-testid="input-psam-effective-date" value={formData.effectiveDate} onChange={e => setFormData(p => ({ ...p, effectiveDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea data-testid="input-psam-description" value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} />
              </div>
              <Button
                className="w-full"
                data-testid="button-submit-pay-stub-amendment"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate(formData)}
              >
                {createMutation.isPending ? "Creating..." : "Create Amendment"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Amount Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Effective Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {amendments.map(am => (
                  <TableRow key={am.id} data-testid={`row-pay-stub-amendment-${am.id}`}>
                    <TableCell>{getWorkerName(am.workerId)}</TableCell>
                    <TableCell>{am.payStubAccountId ? getAccountName(am.payStubAccountId) : "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" data-testid={`badge-psam-type-${am.id}`}>{am.amountType}</Badge>
                    </TableCell>
                    <TableCell>${Number(am.amount || 0).toFixed(2)}</TableCell>
                    <TableCell>${Number(am.rate || 0).toFixed(2)}</TableCell>
                    <TableCell>{am.effectiveDate || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={am.status === "active" ? "default" : "outline"} data-testid={`badge-psam-status-${am.id}`}>
                        {am.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {amendments.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No pay stub amendments</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PayStubTransactionsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    companyId: "", workerId: "", status: "pending", paymentMethod: "check",
    amount: "", transactionDate: "", checkNumber: "", reference: "",
  });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: transactions = [], isLoading } = useQuery<PayStubTransaction[]>({ queryKey: ["/api/pay-stub-transactions"] });

  const getWorkerName = (id: string) => { const w = workers.find(w => w.id === id); return w ? `${w.firstName} ${w.lastName}` : id; };

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/pay-stub-transactions", {
        ...data,
        amount: data.amount ? String(data.amount) : "0",
        transactionDate: data.transactionDate || null,
        checkNumber: data.checkNumber || null,
        reference: data.reference || null,
        remittanceSourceId: data.remittanceSourceId || null,
        payrollItemId: data.payrollItemId || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-stub-transactions"] });
      toast({ title: "Transaction created" });
      setDialogOpen(false);
      setFormData({ companyId: "", workerId: "", status: "pending", paymentMethod: "check", amount: "", transactionDate: "", checkNumber: "", reference: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <div data-testid="loading-pay-stub-transactions"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-pay-stub-transaction"><Plus className="mr-2 h-4 w-4" />Add Transaction</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Pay Stub Transaction</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={formData.companyId} onValueChange={v => setFormData(p => ({ ...p, companyId: v }))}>
                  <SelectTrigger data-testid="select-pst-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Worker</Label>
                <Select value={formData.workerId} onValueChange={v => setFormData(p => ({ ...p, workerId: v }))}>
                  <SelectTrigger data-testid="select-pst-worker"><SelectValue placeholder="Select worker" /></SelectTrigger>
                  <SelectContent>
                    {workers.map(w => <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={v => setFormData(p => ({ ...p, status: v }))}>
                  <SelectTrigger data-testid="select-pst-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="voided">Voided</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={formData.paymentMethod} onValueChange={v => setFormData(p => ({ ...p, paymentMethod: v }))}>
                  <SelectTrigger data-testid="select-pst-payment-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="direct_deposit">Direct Deposit</SelectItem>
                    <SelectItem value="ach">ACH</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input type="number" step="0.01" data-testid="input-pst-amount" value={formData.amount} onChange={e => setFormData(p => ({ ...p, amount: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Transaction Date</Label>
                <Input type="date" data-testid="input-pst-date" value={formData.transactionDate} onChange={e => setFormData(p => ({ ...p, transactionDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Check Number</Label>
                <Input data-testid="input-pst-check-number" value={formData.checkNumber} onChange={e => setFormData(p => ({ ...p, checkNumber: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Reference</Label>
                <Input data-testid="input-pst-reference" value={formData.reference} onChange={e => setFormData(p => ({ ...p, reference: e.target.value }))} />
              </div>
              <Button
                className="w-full"
                data-testid="button-submit-pay-stub-transaction"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate(formData)}
              >
                {createMutation.isPending ? "Creating..." : "Create Transaction"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment Method</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Check #</TableHead>
                  <TableHead>Transaction Date</TableHead>
                  <TableHead>Reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map(tx => (
                  <TableRow key={tx.id} data-testid={`row-pay-stub-transaction-${tx.id}`}>
                    <TableCell>{getWorkerName(tx.workerId)}</TableCell>
                    <TableCell>
                      <Badge variant={tx.status === "completed" ? "default" : tx.status === "pending" ? "secondary" : "outline"} data-testid={`badge-pst-status-${tx.id}`}>
                        {tx.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" data-testid={`badge-pst-method-${tx.id}`}>{tx.paymentMethod}</Badge>
                    </TableCell>
                    <TableCell>${Number(tx.amount || 0).toFixed(2)}</TableCell>
                    <TableCell>{tx.checkNumber || "—"}</TableCell>
                    <TableCell>{tx.transactionDate || "—"}</TableCell>
                    <TableCell>{tx.reference || "—"}</TableCell>
                  </TableRow>
                ))}
                {transactions.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No pay stub transactions</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PayPeriodSchedulesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    companyId: "", name: "", description: "", type: "biweekly",
    anchorDate: "", transactionDayOffset: 3, semiMonthlyDay1: 1,
    semiMonthlyDay2: 15, isActive: true,
  });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: schedules = [], isLoading } = useQuery<PayPeriodSchedule[]>({ queryKey: ["/api/pay-period-schedules"] });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/pay-period-schedules", {
        ...data,
        anchorDate: data.anchorDate || null,
        description: data.description || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-period-schedules"] });
      toast({ title: "Pay period schedule created" });
      setDialogOpen(false);
      setFormData({ companyId: "", name: "", description: "", type: "biweekly", anchorDate: "", transactionDayOffset: 3, semiMonthlyDay1: 1, semiMonthlyDay2: 15, isActive: true });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <div data-testid="loading-pay-period-schedules"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-pay-period-schedule"><Plus className="mr-2 h-4 w-4" />Add Schedule</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Pay Period Schedule</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={formData.companyId} onValueChange={v => setFormData(p => ({ ...p, companyId: v }))}>
                  <SelectTrigger data-testid="select-pps-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input data-testid="input-pps-name" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea data-testid="input-pps-description" value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={formData.type} onValueChange={v => setFormData(p => ({ ...p, type: v }))}>
                  <SelectTrigger data-testid="select-pps-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Biweekly</SelectItem>
                    <SelectItem value="semi_monthly">Semi-Monthly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Anchor Date</Label>
                <Input type="date" data-testid="input-pps-anchor-date" value={formData.anchorDate} onChange={e => setFormData(p => ({ ...p, anchorDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Transaction Day Offset</Label>
                <Input type="number" data-testid="input-pps-offset" value={formData.transactionDayOffset} onChange={e => setFormData(p => ({ ...p, transactionDayOffset: Number(e.target.value) }))} />
              </div>
              {formData.type === "semi_monthly" && (
                <>
                  <div className="space-y-2">
                    <Label>Semi-Monthly Day 1</Label>
                    <Input type="number" data-testid="input-pps-semi-day1" value={formData.semiMonthlyDay1} onChange={e => setFormData(p => ({ ...p, semiMonthlyDay1: Number(e.target.value) }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Semi-Monthly Day 2</Label>
                    <Input type="number" data-testid="input-pps-semi-day2" value={formData.semiMonthlyDay2} onChange={e => setFormData(p => ({ ...p, semiMonthlyDay2: Number(e.target.value) }))} />
                  </div>
                </>
              )}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="isActivePPS"
                  data-testid="checkbox-pps-active"
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData(p => ({ ...p, isActive: checked === true }))}
                />
                <Label htmlFor="isActivePPS">Active</Label>
              </div>
              <Button
                className="w-full"
                data-testid="button-submit-pay-period-schedule"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate(formData)}
              >
                {createMutation.isPending ? "Creating..." : "Create Schedule"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Anchor Date</TableHead>
                  <TableHead>Transaction Day Offset</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map(s => (
                  <TableRow key={s.id} data-testid={`row-pay-period-schedule-${s.id}`}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      <Badge variant={s.type === "biweekly" ? "default" : s.type === "weekly" ? "secondary" : "outline"} data-testid={`badge-pps-type-${s.id}`}>
                        {s.type}
                      </Badge>
                    </TableCell>
                    <TableCell>{s.anchorDate || "—"}</TableCell>
                    <TableCell>{s.transactionDayOffset ?? 3}</TableCell>
                    <TableCell>
                      <Badge variant={s.isActive ? "default" : "outline"} data-testid={`badge-pps-active-${s.id}`}>
                        {s.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {schedules.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No pay period schedules configured</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PlaceholderTab({ icon: Icon, message }: { icon: typeof Calculator; message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center p-12 text-center">
        <Icon className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground" data-testid="text-placeholder-message">{message}</p>
      </CardContent>
    </Card>
  );
}

const DEFAULT_LAYOUT_CONFIG = {
  showCompanyLogo: true,
  showCompanyName: true,
  showCompanyAddress: true,
  showCheckNumber: true,
  showMicrLine: true,
  showEarningsDetail: true,
  showDeductionsDetail: true,
  showYtdTotals: true,
  showPayPeriod: true,
  showEmployeeAddress: true,
};

const TEMPLATE_PRESETS: Record<string, { label: string; description: string }> = {
  standard: { label: "Standard", description: "Check on top, pay stub on bottom" },
  voucher: { label: "Voucher", description: "Stub on top, check in middle, stub on bottom" },
  "three-part": { label: "3-Part Stub", description: "Three detachable stubs per page" },
};

function CheckPreview({ templateType, config, company }: {
  templateType: string;
  config: Record<string, boolean>;
  company?: Company;
}) {
  const stub = (key: string) => (
    <div key={key} className="border border-dashed border-muted-foreground/30 rounded p-3 bg-muted/30 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {config.showCompanyLogo && (
            company?.logoUrl ? (
              <img src={company.logoUrl} alt="" className="h-6 w-6 object-contain" />
            ) : (
              <div className="h-6 w-6 bg-muted rounded flex items-center justify-center"><Image className="h-3 w-3 text-muted-foreground" /></div>
            )
          )}
          {config.showCompanyName && <span className="text-xs font-semibold">{company?.name || "Company Name"}</span>}
        </div>
        {config.showPayPeriod && <span className="text-[10px] text-muted-foreground">Pay Period: 01/01 - 01/15</span>}
      </div>
      {config.showCompanyAddress && <p className="text-[10px] text-muted-foreground">{company?.address || "123 Main St"}, {company?.city || "City"}, {company?.state || "ST"} {company?.zip || "00000"}</p>}
      <div className="grid grid-cols-2 gap-2">
        {config.showEarningsDetail && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold">Earnings</p>
            <div className="text-[9px] text-muted-foreground space-y-0.5">
              <div className="flex justify-between"><span>Regular</span><span>$2,400.00</span></div>
              <div className="flex justify-between"><span>Overtime</span><span>$180.00</span></div>
            </div>
          </div>
        )}
        {config.showDeductionsDetail && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold">Deductions</p>
            <div className="text-[9px] text-muted-foreground space-y-0.5">
              <div className="flex justify-between"><span>Federal Tax</span><span>-$312.00</span></div>
              <div className="flex justify-between"><span>State Tax</span><span>-$96.00</span></div>
            </div>
          </div>
        )}
      </div>
      {config.showYtdTotals && (
        <div className="flex justify-between text-[9px] border-t pt-1">
          <span className="font-semibold">YTD Gross: $12,000.00</span>
          <span className="font-semibold">YTD Net: $9,180.00</span>
        </div>
      )}
    </div>
  );

  const checkPortion = (
    <div className="border-2 border-primary/40 rounded p-3 bg-background space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {config.showCompanyLogo && (
            company?.logoUrl ? (
              <img src={company.logoUrl} alt="" className="h-8 w-8 object-contain" />
            ) : (
              <div className="h-8 w-8 bg-muted rounded flex items-center justify-center"><Image className="h-4 w-4 text-muted-foreground" /></div>
            )
          )}
          <div>
            {config.showCompanyName && <p className="text-xs font-bold">{company?.name || "Company Name"}</p>}
            {config.showCompanyAddress && <p className="text-[9px] text-muted-foreground">{company?.address || "123 Main St"}</p>}
          </div>
        </div>
        {config.showCheckNumber && <span className="text-xs font-mono text-muted-foreground">Check #1001</span>}
      </div>
      <div className="flex justify-between items-end">
        <div>
          <p className="text-[10px] text-muted-foreground">Pay to the order of:</p>
          <p className="text-xs font-semibold">John Doe</p>
          {config.showEmployeeAddress && <p className="text-[9px] text-muted-foreground">456 Employee St, Town, ST 11111</p>}
        </div>
        <div className="text-right">
          <p className="text-[10px] text-muted-foreground">Date: 01/15/2026</p>
          <p className="text-sm font-bold">$2,172.00</p>
        </div>
      </div>
      {config.showMicrLine && (
        <div className="border-t pt-1">
          <p className="text-[9px] font-mono text-muted-foreground tracking-wider">⑈021000021⑈ ⑆123456789⑆ 1001</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-2 p-4 border rounded-lg bg-background max-w-md">
      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Preview</p>
      {templateType === "standard" && (
        <div className="space-y-2">
          {checkPortion}
          <div className="border-t border-dashed" />
          {stub("stub-1")}
        </div>
      )}
      {templateType === "voucher" && (
        <div className="space-y-2">
          {stub("stub-1")}
          <div className="border-t border-dashed" />
          {checkPortion}
          <div className="border-t border-dashed" />
          {stub("stub-2")}
        </div>
      )}
      {templateType === "three-part" && (
        <div className="space-y-2">
          {stub("stub-1")}
          <div className="border-t border-dashed" />
          {stub("stub-2")}
          <div className="border-t border-dashed" />
          {stub("stub-3")}
        </div>
      )}
    </div>
  );
}

function CheckLayoutTab() {
  const { toast } = useToast();
  const [selectedCompany, setSelectedCompany] = useState<string>("");
  const [editingTemplate, setEditingTemplate] = useState<CheckTemplate | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("standard");
  const [layoutConfig, setLayoutConfig] = useState<Record<string, boolean>>({ ...DEFAULT_LAYOUT_CONFIG });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const effectiveCompanyId = selectedCompany && selectedCompany !== "all" ? selectedCompany : undefined;
  const { data: templates = [], isLoading } = useQuery<CheckTemplate[]>({
    queryKey: ["/api/check-templates", effectiveCompanyId || "all"],
    queryFn: async () => {
      const url = effectiveCompanyId ? `/api/check-templates?companyId=${effectiveCompanyId}` : "/api/check-templates";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const invalidateTemplates = () => {
    queryClient.invalidateQueries({ predicate: (query) => (query.queryKey[0] as string)?.startsWith?.("/api/check-templates") || query.queryKey[0] === "/api/check-templates" });
  };

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; templateType: string; companyId: string; layoutConfig: string; isDefault: boolean }) => {
      await apiRequest("POST", "/api/check-templates", data);
    },
    onSuccess: () => {
      invalidateTemplates();
      setAddOpen(false);
      setNewName("");
      setNewType("standard");
      setLayoutConfig({ ...DEFAULT_LAYOUT_CONFIG });
      toast({ title: "Template created" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CheckTemplate> }) => {
      await apiRequest("PATCH", `/api/check-templates/${id}`, data);
    },
    onSuccess: () => {
      invalidateTemplates();
      setEditingTemplate(null);
      toast({ title: "Template updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/check-templates/${id}`);
    },
    onSuccess: () => {
      invalidateTemplates();
      toast({ title: "Template deleted" });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) => {
      const others = templates.filter(t => t.companyId === effectiveCompanyId && t.id !== id);
      for (const t of others) {
        if (t.isDefault) await apiRequest("PATCH", `/api/check-templates/${t.id}`, { isDefault: false });
      }
      await apiRequest("PATCH", `/api/check-templates/${id}`, { isDefault: true });
    },
    onSuccess: () => {
      invalidateTemplates();
      toast({ title: "Default template set" });
    },
  });

  const openEdit = (t: CheckTemplate) => {
    setEditingTemplate(t);
    try {
      setLayoutConfig(JSON.parse(t.layoutConfig || "{}"));
    } catch {
      setLayoutConfig({ ...DEFAULT_LAYOUT_CONFIG });
    }
  };

  const selectedCompanyObj = companies.find(c => c.id === effectiveCompanyId);

  const toggleField = (field: string) => {
    setLayoutConfig(prev => ({ ...prev, [field]: !prev[field] }));
  };

  const layoutFields = [
    { key: "showCompanyLogo", label: "Company Logo" },
    { key: "showCompanyName", label: "Company Name" },
    { key: "showCompanyAddress", label: "Company Address" },
    { key: "showCheckNumber", label: "Check Number" },
    { key: "showMicrLine", label: "MICR Line" },
    { key: "showEarningsDetail", label: "Earnings Detail" },
    { key: "showDeductionsDetail", label: "Deductions Detail" },
    { key: "showYtdTotals", label: "YTD Totals" },
    { key: "showPayPeriod", label: "Pay Period" },
    { key: "showEmployeeAddress", label: "Employee Address" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Check Layout Templates</h2>
        <div className="flex items-center gap-3">
          <Select value={selectedCompany} onValueChange={setSelectedCompany}>
            <SelectTrigger className="w-[200px]" data-testid="select-template-company">
              <SelectValue placeholder="All companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-template" disabled={!effectiveCompanyId}>
                <Plus className="mr-2 h-4 w-4" />New Template
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Create Check Template</DialogTitle></DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Template Name</Label>
                  <Input data-testid="input-template-name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Standard Paycheck" />
                </div>
                <div className="grid gap-2">
                  <Label>Template Type</Label>
                  <div className="grid grid-cols-3 gap-3">
                    {Object.entries(TEMPLATE_PRESETS).map(([key, preset]) => (
                      <button
                        key={key}
                        data-testid={`button-preset-${key}`}
                        onClick={() => setNewType(key)}
                        className={`p-3 border rounded-lg text-left transition-colors ${newType === key ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/50"}`}
                      >
                        <p className="text-sm font-medium">{preset.label}</p>
                        <p className="text-xs text-muted-foreground">{preset.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Layout Options</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {layoutFields.map(f => (
                      <div key={f.key} className="flex items-center justify-between rounded-md border px-3 py-2">
                        <span className="text-sm">{f.label}</span>
                        <Switch
                          data-testid={`switch-${f.key}`}
                          checked={layoutConfig[f.key] ?? true}
                          onCheckedChange={() => toggleField(f.key)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <CheckPreview templateType={newType} config={layoutConfig} company={selectedCompanyObj} />
                <Button
                  data-testid="button-create-template"
                  disabled={!newName || createMutation.isPending}
                  onClick={() => effectiveCompanyId && createMutation.mutate({
                    name: newName,
                    templateType: newType,
                    companyId: effectiveCompanyId,
                    layoutConfig: JSON.stringify(layoutConfig),
                    isDefault: templates.length === 0,
                  })}
                >
                  {createMutation.isPending ? "Creating..." : "Create Template"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map(i => <Card key={i}><CardContent className="p-6"><Skeleton className="h-32 w-full" /></CardContent></Card>)}
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Layout className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No check templates yet. Select a company and create one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map(t => {
            let config: Record<string, boolean>;
            try { config = JSON.parse(t.layoutConfig || "{}"); } catch { config = { ...DEFAULT_LAYOUT_CONFIG }; }
            const tCompany = companies.find(c => c.id === t.companyId);
            return (
              <Card key={t.id} data-testid={`card-template-${t.id}`} className={t.isDefault ? "ring-2 ring-primary" : ""}>
                <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      {t.name}
                      {t.isDefault && <Badge variant="secondary" className="text-xs">Default</Badge>}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">{TEMPLATE_PRESETS[t.templateType || "standard"]?.label || t.templateType} — {tCompany?.name || "Unknown"}</p>
                  </div>
                  <div className="flex gap-1">
                    {!t.isDefault && (
                      <Button size="sm" variant="outline" data-testid={`button-set-default-${t.id}`} onClick={() => setDefaultMutation.mutate(t.id)}>
                        <Check className="h-3 w-3 mr-1" />Set Default
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" data-testid={`button-edit-template-${t.id}`} onClick={() => openEdit(t)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" data-testid={`button-delete-template-${t.id}`} onClick={() => deleteMutation.mutate(t.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <CheckPreview templateType={t.templateType || "standard"} config={config} company={tCompany} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!editingTemplate} onOpenChange={(open) => !open && setEditingTemplate(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Template: {editingTemplate?.name}</DialogTitle></DialogHeader>
          {editingTemplate && (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Template Name</Label>
                <Input data-testid="input-edit-template-name" value={editingTemplate.name} onChange={e => setEditingTemplate({ ...editingTemplate, name: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Template Type</Label>
                <div className="grid grid-cols-3 gap-3">
                  {Object.entries(TEMPLATE_PRESETS).map(([key, preset]) => (
                    <button
                      key={key}
                      data-testid={`button-edit-preset-${key}`}
                      onClick={() => setEditingTemplate({ ...editingTemplate, templateType: key })}
                      className={`p-3 border rounded-lg text-left transition-colors ${editingTemplate.templateType === key ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/50"}`}
                    >
                      <p className="text-sm font-medium">{preset.label}</p>
                      <p className="text-xs text-muted-foreground">{preset.description}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Layout Options</Label>
                <div className="grid grid-cols-2 gap-2">
                  {layoutFields.map(f => (
                    <div key={f.key} className="flex items-center justify-between rounded-md border px-3 py-2">
                      <span className="text-sm">{f.label}</span>
                      <Switch
                        data-testid={`switch-edit-${f.key}`}
                        checked={layoutConfig[f.key] ?? true}
                        onCheckedChange={() => toggleField(f.key)}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <CheckPreview templateType={editingTemplate.templateType || "standard"} config={layoutConfig} company={companies.find(c => c.id === editingTemplate.companyId)} />
              <Button
                data-testid="button-save-template"
                disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate({
                  id: editingTemplate.id,
                  data: {
                    name: editingTemplate.name,
                    templateType: editingTemplate.templateType,
                    layoutConfig: JSON.stringify(layoutConfig),
                  },
                })}
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PayrollPage() {
  const [activeTab, setActiveTab] = useTabParam();

  const tabs = [
    { value: "process", label: "Process Payroll" },
    { value: "tax-wizard", label: "Tax Wizard" },
    { value: "pay-stubs", label: "Pay Stubs" },
    { value: "pay-stub-transactions", label: "Pay Stub Transactions" },
    { value: "pay-periods", label: "Pay Periods" },
    { value: "pay-stub-amendments", label: "Pay Stub Amendments" },
    { value: "pay-period-schedules", label: "Pay Period Schedules" },
    { value: "pay-stub-accounts", label: "Pay Stub Accounts" },
    { value: "taxes-deductions", label: "Taxes & Deductions" },
    { value: "remittance-agencies", label: "Remittance Agencies" },
    { value: "remittance-sources", label: "Remittance Sources" },
    { value: "check-layout", label: "Check Layout" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <DollarSign className="h-6 w-6 text-blue-accent" />
        <h1 className="text-2xl font-bold" data-testid="text-payroll-title">Payroll</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto">
          <TabsList className="inline-flex w-max" data-testid="tabs-payroll">
            {tabs.map(t => (
              <TabsTrigger key={t.value} value={t.value} data-testid={`tab-${t.value}`}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="process"><ProcessPayrollTab /></TabsContent>
        <TabsContent value="tax-wizard"><TaxWizardTab /></TabsContent>
        <TabsContent value="pay-stubs"><PayStubsTab /></TabsContent>
        <TabsContent value="pay-stub-transactions"><PayStubTransactionsTab /></TabsContent>
        <TabsContent value="pay-periods"><PayPeriodsTab /></TabsContent>
        <TabsContent value="pay-stub-amendments"><PayStubAmendmentsTab /></TabsContent>
        <TabsContent value="pay-period-schedules"><PayPeriodSchedulesTab /></TabsContent>
        <TabsContent value="pay-stub-accounts"><PayStubAccountsTab /></TabsContent>
        <TabsContent value="taxes-deductions"><TaxesDeductionsTab /></TabsContent>
        <TabsContent value="remittance-agencies"><RemittanceAgenciesTab /></TabsContent>
        <TabsContent value="remittance-sources"><RemittanceSourcesTab /></TabsContent>
        <TabsContent value="check-layout"><CheckLayoutTab /></TabsContent>
      </Tabs>
    </div>
  );
}
