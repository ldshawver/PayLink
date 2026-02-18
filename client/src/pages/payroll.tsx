import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  DollarSign,
  Play,
  Download,
  Printer,
  Clock,
  Users,
  FileText,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Company, PayrollRun, PayrollItem, Worker } from "@shared/schema";

function formatCurrency(val: string | number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(val));
}

function PayrollDetail({ run }: { run: PayrollRun }) {
  const [expanded, setExpanded] = useState(false);

  const { data: items } = useQuery<PayrollItem[]>({
    queryKey: ["/api/payroll-runs", run.id, "items"],
    queryFn: async () => {
      const res = await fetch(`/api/payroll-runs/${run.id}/items`);
      return res.json();
    },
    enabled: expanded,
  });

  const { data: workers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  const getWorkerName = (workerId: string) => {
    const w = workers?.find(w => w.id === workerId);
    return w ? `${w.firstName} ${w.lastName}` : "Unknown";
  };

  const handlePrint = () => {
    const printContent = document.getElementById(`payroll-detail-${run.id}`);
    if (!printContent) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>Payroll Report - ${run.periodStart} to ${run.periodEnd}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f5f5f5; }
        h1 { font-size: 18px; } h2 { font-size: 14px; color: #666; }
        .summary { display: flex; gap: 30px; margin: 15px 0; }
        .summary div { } .summary .label { font-size: 12px; color: #666; }
        .summary .value { font-size: 16px; font-weight: bold; }
      </style></head><body>
      ${printContent.innerHTML}
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handleExport = () => {
    if (!items || !workers) return;
    const headers = ["Worker", "Type", "Rate", "Reg Hours", "OT Hours", "Reg Pay", "OT Pay", "Gross Pay"];
    const rows = items.map(item => [
      getWorkerName(item.workerId),
      item.payType,
      Number(item.payRate).toFixed(2),
      Number(item.regularHours).toFixed(2),
      Number(item.overtimeHours).toFixed(2),
      Number(item.regularPay).toFixed(2),
      Number(item.overtimePay).toFixed(2),
      Number(item.grossPay).toFixed(2),
    ]);
    rows.push(["", "", "", "", "", "", "Total", formatCurrency(run.totalGross || 0)]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll_${run.periodStart}_${run.periodEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusVariant = run.status === "paid" ? "default" : run.status === "processed" ? "secondary" : "outline";

  return (
    <Card data-testid={`card-payroll-run-${run.id}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/10 p-2 shrink-0">
              <DollarSign className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">
                  {run.periodStart} to {run.periodEnd}
                </span>
                <Badge variant={statusVariant} className="text-xs capitalize">
                  {run.status}
                </Badge>
              </div>
              <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                <span>{run.workerCount} workers</span>
                <span>{Number(run.totalHours || 0).toFixed(1)} hrs</span>
                <span className="font-medium text-foreground">{formatCurrency(run.totalGross || 0)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={handleExport} data-testid={`button-export-payroll-${run.id}`}>
              <Download className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={handlePrint} data-testid={`button-print-payroll-${run.id}`}>
              <Printer className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setExpanded(!expanded)} data-testid={`button-expand-payroll-${run.id}`}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {expanded && (
          <div id={`payroll-detail-${run.id}`} className="mt-4">
            <h1 className="text-base font-semibold" style={{ display: "none" }}>Payroll Report</h1>
            <h2 className="text-xs text-muted-foreground mb-2" style={{ display: "none" }}>
              Period: {run.periodStart} to {run.periodEnd}
            </h2>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Worker</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Reg Hrs</TableHead>
                    <TableHead className="text-right">OT Hrs</TableHead>
                    <TableHead className="text-right">Reg Pay</TableHead>
                    <TableHead className="text-right">OT Pay</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items?.map((item) => (
                    <TableRow key={item.id} data-testid={`row-payroll-item-${item.id}`}>
                      <TableCell className="text-sm font-medium">{getWorkerName(item.workerId)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs capitalize">{item.payType}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatCurrency(item.payRate)}{item.payType === "salary" ? "/yr" : "/hr"}
                      </TableCell>
                      <TableCell className="text-right text-sm">{Number(item.regularHours).toFixed(2)}</TableCell>
                      <TableCell className="text-right text-sm">{Number(item.overtimeHours).toFixed(2)}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(item.regularPay)}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(item.overtimePay)}</TableCell>
                      <TableCell className="text-right text-sm font-semibold">{formatCurrency(item.grossPay)}</TableCell>
                    </TableRow>
                  )) || (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                        Loading...
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function PayrollPage() {
  const [selectedCompany, setSelectedCompany] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const { data: payrollRuns, isLoading } = useQuery<PayrollRun[]>({
    queryKey: ["/api/payroll-runs"],
  });

  const processPayroll = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/payroll-runs", {
        companyId: selectedCompany,
        periodStart,
        periodEnd,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs"] });
      toast({ title: "Payroll processed successfully" });
      setRunDialogOpen(false);
      setSelectedCompany("");
      setPeriodStart("");
      setPeriodEnd("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const getCompanyName = (id: string) => companies?.find(c => c.id === id)?.name || "Unknown";

  const totalProcessed = payrollRuns?.length || 0;
  const totalPaid = payrollRuns?.reduce((sum, r) => sum + Number(r.totalGross || 0), 0) || 0;
  const lastRun = payrollRuns?.[0];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-payroll-title">
            Payroll
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Process payroll, review history, and export reports.
          </p>
        </div>
        <Button onClick={() => setRunDialogOpen(true)} data-testid="button-run-payroll">
          <Play className="h-4 w-4 mr-2" /> Run Payroll
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-primary/10 p-2 shrink-0">
                <FileText className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Runs</p>
                <p className="text-lg font-bold" data-testid="text-total-runs">{totalProcessed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-primary/10 p-2 shrink-0">
                <DollarSign className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Payroll</p>
                <p className="text-lg font-bold" data-testid="text-total-payroll">{formatCurrency(totalPaid)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-primary/10 p-2 shrink-0">
                <Clock className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last Run</p>
                <p className="text-sm font-semibold" data-testid="text-last-run">
                  {lastRun ? `${lastRun.periodEnd}` : "None"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-md" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (payrollRuns || []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <DollarSign className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No payroll runs yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Click "Run Payroll" to process your first payroll.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(payrollRuns || []).map(run => (
            <div key={run.id}>
              <p className="text-xs text-muted-foreground mb-1">{getCompanyName(run.companyId)}</p>
              <PayrollDetail run={run} />
            </div>
          ))}
        </div>
      )}

      <Dialog open={runDialogOpen} onOpenChange={setRunDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run Payroll</DialogTitle>
            <DialogDescription>
              Select a company and pay period to process payroll. Only approved time entries will be included.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Company</label>
              <Select onValueChange={setSelectedCompany} value={selectedCompany}>
                <SelectTrigger data-testid="select-payroll-company">
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {companies?.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Period Start</label>
                <Input
                  type="date"
                  value={periodStart}
                  onChange={e => setPeriodStart(e.target.value)}
                  data-testid="input-period-start"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Period End</label>
                <Input
                  type="date"
                  value={periodEnd}
                  onChange={e => setPeriodEnd(e.target.value)}
                  data-testid="input-period-end"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRunDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => processPayroll.mutate()}
              disabled={!selectedCompany || !periodStart || !periodEnd || processPayroll.isPending}
              data-testid="button-process-payroll"
            >
              {processPayroll.isPending ? "Processing..." : "Process Payroll"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
