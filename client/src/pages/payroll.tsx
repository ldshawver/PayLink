import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Company, Worker, PayrollRun, PayrollItem, PayPeriod, TaxDeduction } from "@shared/schema";
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
  DollarSign, Clock, Calendar, ChevronDown, ChevronUp, Plus, Download, Printer,
  Calculator, FileText, CreditCard, CalendarDays, Settings, Building, Receipt
} from "lucide-react";

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
    const headers = ["Worker", "Type", "Rate", "Reg Hrs", "OT Hrs", "Reg Pay", "OT Pay", "Gross"];
    const rows = items.map(item => [
      getWorkerName(item.workerId),
      item.payType || "hourly",
      item.payRate,
      item.regularHours,
      item.overtimeHours,
      item.regularPay,
      item.overtimePay,
      item.grossPay,
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

  const handlePrint = () => {
    window.print();
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
            onPrint={handlePrint}
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
  run, companyName, expanded, onToggle, getWorkerName, onExportCSV, onPrint,
}: {
  run: PayrollRun;
  companyName: string;
  expanded: boolean;
  onToggle: () => void;
  getWorkerName: (id: string) => string;
  onExportCSV: (run: PayrollRun, items: PayrollItem[]) => void;
  onPrint: () => void;
}) {
  const { data: items = [], isLoading } = useQuery<PayrollItem[]>({
    queryKey: ["/api/payroll-runs", run.id, "items"],
    queryFn: async () => {
      const res = await fetch(`/api/payroll-runs/${run.id}/items`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch items");
      return res.json();
    },
    enabled: expanded,
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
                <Button variant="outline" size="sm" data-testid={`button-export-csv-${run.id}`} onClick={() => onExportCSV(run, items)}>
                  <Download className="mr-2 h-4 w-4" />Export CSV
                </Button>
                <Button variant="outline" size="sm" data-testid={`button-print-${run.id}`} onClick={onPrint}>
                  <Printer className="mr-2 h-4 w-4" />Print
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
                      </TableRow>
                    ))}
                    {items.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No items</TableCell></TableRow>
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

function TaxesDeductionsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    companyId: "", name: "", type: "tax", calculationType: "percentage",
    rate: "", maxAmount: "", isEmployerPaid: false,
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
      setFormData({ companyId: "", name: "", type: "tax", calculationType: "percentage", rate: "", maxAmount: "", isEmployerPaid: false });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div data-testid="loading-taxes-deductions"><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-tax-deduction"><Plus className="mr-2 h-4 w-4" />Add Tax/Deduction</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Tax/Deduction</DialogTitle></DialogHeader>
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
                <Label>Calculation Type</Label>
                <Select value={formData.calculationType} onValueChange={v => setFormData(p => ({ ...p, calculationType: v }))}>
                  <SelectTrigger data-testid="select-td-calc-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage</SelectItem>
                    <SelectItem value="fixed">Fixed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Rate</Label>
                <Input type="number" step="0.01" data-testid="input-td-rate" value={formData.rate} onChange={e => setFormData(p => ({ ...p, rate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Max Amount</Label>
                <Input type="number" step="0.01" data-testid="input-td-max-amount" value={formData.maxAmount} onChange={e => setFormData(p => ({ ...p, maxAmount: e.target.value }))} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="isEmployerPaid"
                  data-testid="checkbox-td-employer-paid"
                  checked={formData.isEmployerPaid}
                  onCheckedChange={(checked) => setFormData(p => ({ ...p, isEmployerPaid: checked === true }))}
                />
                <Label htmlFor="isEmployerPaid">Employer Paid</Label>
              </div>
              <Button
                className="w-full"
                data-testid="button-submit-tax-deduction"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate(formData)}
              >
                {createMutation.isPending ? "Creating..." : "Create Tax/Deduction"}
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
                  <TableHead>Calculation</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Max Amount</TableHead>
                  <TableHead>Employer Paid</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taxesDeductions.map(td => (
                  <TableRow key={td.id} data-testid={`row-tax-deduction-${td.id}`}>
                    <TableCell className="font-medium">{td.name}</TableCell>
                    <TableCell>
                      <Badge variant={td.type === "tax" ? "default" : td.type === "benefit" ? "secondary" : "outline"} data-testid={`badge-td-type-${td.id}`}>
                        {td.type}
                      </Badge>
                    </TableCell>
                    <TableCell>{td.calculationType}</TableCell>
                    <TableCell>{td.calculationType === "percentage" ? `${Number(td.rate || 0)}%` : `$${Number(td.rate || 0).toFixed(2)}`}</TableCell>
                    <TableCell>{td.maxAmount ? `$${Number(td.maxAmount).toLocaleString()}` : "—"}</TableCell>
                    <TableCell>{td.isEmployerPaid ? "Yes" : "No"}</TableCell>
                    <TableCell>
                      <Badge variant={td.isActive ? "default" : "outline"} data-testid={`badge-td-active-${td.id}`}>
                        {td.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {taxesDeductions.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No taxes or deductions configured</TableCell></TableRow>
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
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <DollarSign className="h-6 w-6" />
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
        <TabsContent value="tax-wizard">
          <PlaceholderTab icon={Calculator} message="Tax setup wizard helps configure federal, state, and local tax settings." />
        </TabsContent>
        <TabsContent value="pay-stubs"><PayStubsTab /></TabsContent>
        <TabsContent value="pay-stub-transactions">
          <PlaceholderTab icon={Receipt} message="Pay stub transaction history coming soon." />
        </TabsContent>
        <TabsContent value="pay-periods"><PayPeriodsTab /></TabsContent>
        <TabsContent value="pay-stub-amendments">
          <PlaceholderTab icon={FileText} message="Pay stub amendments for adjustments coming soon." />
        </TabsContent>
        <TabsContent value="pay-period-schedules">
          <PlaceholderTab icon={CalendarDays} message="Automated pay period schedule generation coming soon." />
        </TabsContent>
        <TabsContent value="pay-stub-accounts">
          <PlaceholderTab icon={CreditCard} message="Configure pay stub account categories coming soon." />
        </TabsContent>
        <TabsContent value="taxes-deductions"><TaxesDeductionsTab /></TabsContent>
        <TabsContent value="remittance-agencies">
          <PlaceholderTab icon={Building} message="Remittance agency configuration coming soon." />
        </TabsContent>
        <TabsContent value="remittance-sources">
          <PlaceholderTab icon={Settings} message="Remittance source configuration coming soon." />
        </TabsContent>
      </Tabs>
    </div>
  );
}
