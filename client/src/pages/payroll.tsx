import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Company, Worker, PayrollRun, PayrollItem, PayPeriod, TaxDeduction, RemittanceSource, RemittanceAgency, RemittanceAgencyEvent, PayStubAccount, PayStubAmendment, PayStubTransaction, PayPeriodSchedule } from "@shared/schema";
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
  Calculator, FileText, CreditCard, CalendarDays, Settings, Building, Receipt, Zap
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

function RemittanceSourcesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    companyId: "", name: "", type: "check", status: "enabled",
    country: "US", currency: "USD", routingNumber: "", accountNumber: "",
    institution: "", lastCheckNumber: 0,
  });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: remittanceSources = [], isLoading } = useQuery<RemittanceSource[]>({ queryKey: ["/api/remittance-sources"] });

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
      <div className="flex justify-end">
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
  const [formData, setFormData] = useState({
    companyId: "", name: "", type: "federal", status: "enabled",
    country: "US", provinceState: "", agency: "", startDate: "", endDate: "",
  });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: remittanceAgencies = [], isLoading } = useQuery<RemittanceAgency[]>({ queryKey: ["/api/remittance-agencies"] });

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
      <div className="flex justify-end">
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

function TaxWizardTab() {
  const { toast } = useToast();
  const [selectedAgencyId, setSelectedAgencyId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    agencyId: "", type: "payment", status: "enabled", frequency: "quarterly",
    dueDateDelayDays: 0, effectiveDate: "", reminderDays: 7,
  });

  const { data: agencies = [], isLoading: agenciesLoading } = useQuery<RemittanceAgency[]>({ queryKey: ["/api/remittance-agencies"] });
  const { data: events = [], isLoading: eventsLoading } = useQuery<RemittanceAgencyEvent[]>({
    queryKey: ["/api/remittance-agency-events", selectedAgencyId],
    queryFn: async () => {
      const res = await fetch(`/api/remittance-agency-events?agencyId=${selectedAgencyId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch events");
      return res.json();
    },
    enabled: !!selectedAgencyId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/remittance-agency-events", {
        ...data,
        effectiveDate: data.effectiveDate || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/remittance-agency-events", selectedAgencyId] });
      toast({ title: "Agency event created" });
      setDialogOpen(false);
      setFormData({ agencyId: "", type: "payment", status: "enabled", frequency: "quarterly", dueDateDelayDays: 0, effectiveDate: "", reminderDays: 7 });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (agenciesLoading) return <div data-testid="loading-tax-wizard"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="space-y-2">
          <Label>Select Agency</Label>
          <Select value={selectedAgencyId} onValueChange={setSelectedAgencyId}>
            <SelectTrigger data-testid="select-tw-agency" className="w-64"><SelectValue placeholder="Select an agency" /></SelectTrigger>
            <SelectContent>
              {agencies.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {selectedAgencyId && (
          <div className="ml-auto">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-agency-event"><Plus className="mr-2 h-4 w-4" />Add Event</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Agency Event</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={formData.type} onValueChange={v => setFormData(p => ({ ...p, type: v }))}>
                      <SelectTrigger data-testid="select-ae-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="payment">Payment</SelectItem>
                        <SelectItem value="filing">Filing</SelectItem>
                        <SelectItem value="reporting">Reporting</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={formData.status} onValueChange={v => setFormData(p => ({ ...p, status: v }))}>
                      <SelectTrigger data-testid="select-ae-status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="enabled">Enabled</SelectItem>
                        <SelectItem value="disabled">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Frequency</Label>
                    <Select value={formData.frequency} onValueChange={v => setFormData(p => ({ ...p, frequency: v }))}>
                      <SelectTrigger data-testid="select-ae-frequency"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="quarterly">Quarterly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="annually">Annually</SelectItem>
                        <SelectItem value="semi_annually">Semi-Annually</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Due Date Delay (Days)</Label>
                    <Input type="number" data-testid="input-ae-delay" value={formData.dueDateDelayDays} onChange={e => setFormData(p => ({ ...p, dueDateDelayDays: Number(e.target.value) }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Effective Date</Label>
                    <Input type="date" data-testid="input-ae-effective-date" value={formData.effectiveDate} onChange={e => setFormData(p => ({ ...p, effectiveDate: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Reminder Days</Label>
                    <Input type="number" data-testid="input-ae-reminder" value={formData.reminderDays} onChange={e => setFormData(p => ({ ...p, reminderDays: Number(e.target.value) }))} />
                  </div>
                  <Button
                    className="w-full"
                    data-testid="button-submit-agency-event"
                    disabled={createMutation.isPending}
                    onClick={() => createMutation.mutate({ ...formData, agencyId: selectedAgencyId })}
                  >
                    {createMutation.isPending ? "Creating..." : "Create Event"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>
      {selectedAgencyId && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              {eventsLoading ? (
                <div data-testid="loading-agency-events"><Skeleton className="h-32 w-full" /></div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Due Date Delay</TableHead>
                      <TableHead>Effective Date</TableHead>
                      <TableHead>Reminder Days</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map(ev => (
                      <TableRow key={ev.id} data-testid={`row-agency-event-${ev.id}`}>
                        <TableCell>
                          <Badge variant={ev.type === "payment" ? "default" : ev.type === "filing" ? "secondary" : "outline"} data-testid={`badge-ae-type-${ev.id}`}>
                            {ev.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={ev.status === "enabled" ? "default" : "outline"} data-testid={`badge-ae-status-${ev.id}`}>
                            {ev.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{ev.frequency || "—"}</TableCell>
                        <TableCell>{ev.dueDateDelayDays ?? 0} days</TableCell>
                        <TableCell>{ev.effectiveDate || "—"}</TableCell>
                        <TableCell>{ev.reminderDays ?? 7}</TableCell>
                      </TableRow>
                    ))}
                    {events.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No events for this agency</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      {!selectedAgencyId && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            Select an agency above to view and manage its events.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PayStubAccountsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    companyId: "", name: "", type: "earning", status: "enabled",
    displayOrder: 0, debitAccount: "", creditAccount: "",
  });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: payStubAccounts = [], isLoading } = useQuery<PayStubAccount[]>({ queryKey: ["/api/pay-stub-accounts"] });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/pay-stub-accounts", {
        ...data,
        debitAccount: data.debitAccount || null,
        creditAccount: data.creditAccount || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pay-stub-accounts"] });
      toast({ title: "Pay stub account created" });
      setDialogOpen(false);
      setFormData({ companyId: "", name: "", type: "earning", status: "enabled", displayOrder: 0, debitAccount: "", creditAccount: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <div data-testid="loading-pay-stub-accounts"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-pay-stub-account"><Plus className="mr-2 h-4 w-4" />Add Pay Stub Account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Pay Stub Account</DialogTitle></DialogHeader>
            <div className="space-y-4">
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
                <Label>Name</Label>
                <Input data-testid="input-psa-name" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={formData.type} onValueChange={v => setFormData(p => ({ ...p, type: v }))}>
                  <SelectTrigger data-testid="select-psa-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="earning">Earning</SelectItem>
                    <SelectItem value="deduction">Deduction</SelectItem>
                    <SelectItem value="benefit">Benefit</SelectItem>
                    <SelectItem value="employer_contribution">Employer Contribution</SelectItem>
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
              <div className="space-y-2">
                <Label>Debit Account</Label>
                <Input data-testid="input-psa-debit" value={formData.debitAccount} onChange={e => setFormData(p => ({ ...p, debitAccount: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Credit Account</Label>
                <Input data-testid="input-psa-credit" value={formData.creditAccount} onChange={e => setFormData(p => ({ ...p, creditAccount: e.target.value }))} />
              </div>
              <Button
                className="w-full"
                data-testid="button-submit-pay-stub-account"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate(formData)}
              >
                {createMutation.isPending ? "Creating..." : "Create Pay Stub Account"}
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
                  <TableHead>Status</TableHead>
                  <TableHead>Display Order</TableHead>
                  <TableHead>Debit Account</TableHead>
                  <TableHead>Credit Account</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payStubAccounts.map(psa => (
                  <TableRow key={psa.id} data-testid={`row-pay-stub-account-${psa.id}`}>
                    <TableCell className="font-medium">{psa.name}</TableCell>
                    <TableCell>
                      <Badge variant={psa.type === "earning" ? "default" : psa.type === "deduction" ? "secondary" : "outline"} data-testid={`badge-psa-type-${psa.id}`}>
                        {psa.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={psa.status === "enabled" ? "default" : "outline"} data-testid={`badge-psa-status-${psa.id}`}>
                        {psa.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{psa.displayOrder ?? 0}</TableCell>
                    <TableCell>{psa.debitAccount || "—"}</TableCell>
                    <TableCell>{psa.creditAccount || "—"}</TableCell>
                  </TableRow>
                ))}
                {payStubAccounts.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No pay stub accounts configured</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
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
      </Tabs>
    </div>
  );
}
