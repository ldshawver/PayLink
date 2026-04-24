import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Building2, CheckCircle2, AlertCircle, Loader2, RefreshCw,
  DollarSign, ArrowUpRight, ArrowDownLeft, Clock, XCircle,
  Landmark, Zap, ShieldCheck, Send,
} from "lucide-react";

interface TreasuryBalance {
  cash: number;
  inboundPending: number;
  outboundPending: number;
}

interface TreasuryFinancialAccount {
  id: string;
  status: string;
  routingNumber: string | null;
  accountNumber: string | null;
  features: Record<string, string>;
  balance: TreasuryBalance | null;
}

interface TreasuryStatus {
  connected: boolean;
  financialAccount?: TreasuryFinancialAccount;
  company: { id: string; name: string };
}

interface TreasuryTransaction {
  id: string;
  companyId: string;
  payrollRunId: string | null;
  workerId: string | null;
  stripeOutboundPaymentId: string | null;
  amount: number;
  currency: string;
  status: string;
  recipientName: string | null;
  routingNumber: string | null;
  accountNumber: string | null;
  memo: string | null;
  errorMessage: string | null;
  stripeRawStatus: string | null;
  createdAt: string;
}

function FeatureStatus({ label, status }: { label: string; status: string | undefined }) {
  if (!status) return null;
  const isActive = status === "active";
  const isPending = status === "pending";
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Badge
        variant={isActive ? "default" : isPending ? "secondary" : "outline"}
        className={`text-xs ${isActive ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100" : isPending ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100" : ""}`}
      >
        {isActive ? <CheckCircle2 className="mr-1 h-3 w-3" /> : isPending ? <Clock className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending:   { label: "Pending",   className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
    completed: { label: "Completed", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
    failed:    { label: "Failed",    className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
    returned:  { label: "Returned",  className: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
    canceled:  { label: "Canceled",  className: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300" },
  };
  const s = map[status] || { label: status, className: "" };
  return <Badge variant="outline" className={`text-xs ${s.className}`}>{s.label}</Badge>;
}

interface PayrollRun {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalGross: string | null;
  totalNet: string | null;
  approvedAt: string | null;
  achStatus: string | null;
}

// Parse a raw fetch error (which may be "400: {\"message\":\"...\"}") into a clean string
function parseApiError(err: Error): string {
  const raw = err.message || "";
  const jsonMatch = raw.match(/^\d+:\s*(\{.*\})\s*$/s);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.message) return parsed.message;
    } catch {}
  }
  return raw;
}

export default function TreasuryPage() {
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [disburseResult, setDisburseResult] = useState<any>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const statusQuery = useQuery<TreasuryStatus>({
    queryKey: ["/api/treasury/status"],
    retry: false,
  });
  const txQuery = useQuery<TreasuryTransaction[]>({
    queryKey: ["/api/treasury/transactions"],
    retry: false,
  });
  const runsQuery = useQuery<PayrollRun[]>({ queryKey: ["/api/payroll-runs"] });

  const setupMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/treasury/setup").then(r => r.json());
    },
    onSuccess: (data) => {
      setSetupError(null);
      queryClient.invalidateQueries({ queryKey: ["/api/treasury/status"] });
      toast({ title: "Treasury set up successfully", description: `Financial Account: ${data.financialAccount?.id}` });
    },
    onError: (err: Error) => {
      const msg = parseApiError(err);
      setSetupError(msg);
      toast({ title: "Setup failed", description: msg, variant: "destructive" });
    },
  });

  const disburseMutation = useMutation({
    mutationFn: async (runId: string) => {
      return apiRequest("POST", `/api/payroll-runs/${runId}/disburse-stripe`).then(r => r.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/treasury/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/treasury/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-runs"] });
      setDisburseResult(data);
      if (data.success) {
        toast({ title: "Payroll disbursed successfully", description: data.message });
      } else {
        toast({ title: "Partial disbursement", description: data.message, variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Disbursement failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await apiRequest("POST", "/api/treasury/sync").then(r => r.json());
      queryClient.invalidateQueries({ queryKey: ["/api/treasury/transactions"] });
      toast({ title: `Sync complete — ${result.updated} transactions updated` });
    } catch (err: any) {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const fa = statusQuery.data?.financialAccount;
  const balance = fa?.balance;
  const connected = statusQuery.data?.connected;

  return (
    <div className="space-y-6 p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Landmark className="h-6 w-6 text-primary" />
            Stripe Treasury
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time ACH direct deposit for employee payroll using Stripe Treasury
          </p>
        </div>
        {connected && (
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing} data-testid="button-treasury-sync">
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Sync Status
          </Button>
        )}
      </div>

      {statusQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : !connected ? (
        <Card className="border-dashed">
          <CardContent className="pt-10 pb-10 flex flex-col items-center gap-4 text-center">
            <div className="rounded-full bg-primary/10 p-4">
              <Landmark className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Connect Stripe Treasury</h3>
              <p className="text-muted-foreground text-sm mt-1 max-w-md">
                Set up a Stripe Treasury Financial Account to enable real-time ACH direct deposit payroll disbursements.
                Requires Stripe Treasury to be enabled on your Stripe account.
              </p>
            </div>
            <Alert className="text-left max-w-md">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Stripe Treasury must be enabled on your platform Stripe account before setup. Contact Stripe support or check your Stripe Dashboard under Treasury.
              </AlertDescription>
            </Alert>
            {statusQuery.isError && (
              <Alert variant="destructive" className="text-left max-w-md" data-testid="alert-treasury-status-error">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  {parseApiError(statusQuery.error as Error)}
                </AlertDescription>
              </Alert>
            )}
            {setupError && (
              <Alert variant="destructive" className="text-left max-w-md" data-testid="alert-treasury-setup-error">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm font-medium">
                  {setupError}
                </AlertDescription>
              </Alert>
            )}
            <Button onClick={() => { setSetupError(null); setupMutation.mutate(); }} disabled={setupMutation.isPending} data-testid="button-treasury-setup" size="lg">
              {setupMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
              Set Up Treasury Financial Account
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card data-testid="card-treasury-balance">
              <CardHeader className="pb-2">
                <CardDescription>Available Balance</CardDescription>
                <CardTitle className="text-3xl font-bold text-green-600 dark:text-green-400">
                  ${balance ? balance.cash.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground space-y-1">
                  <div className="flex justify-between">
                    <span className="flex items-center gap-1"><ArrowDownLeft className="h-3 w-3 text-blue-500" />Inbound Pending</span>
                    <span>${balance ? balance.inboundPending.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="flex items-center gap-1"><ArrowUpRight className="h-3 w-3 text-orange-500" />Outbound Pending</span>
                    <span>${balance ? balance.outboundPending.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—"}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-treasury-account">
              <CardHeader className="pb-2">
                <CardDescription>Financial Account</CardDescription>
                <CardTitle className="text-base font-mono">{fa?.id}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant={fa?.status === "open" ? "default" : "secondary"} className={`text-xs ${fa?.status === "open" ? "bg-green-100 text-green-800" : ""}`}>
                    {fa?.status}
                  </Badge>
                </div>
                {fa?.routingNumber && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Routing</span>
                    <span className="font-mono">{fa.routingNumber}</span>
                  </div>
                )}
                {fa?.accountNumber && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Account</span>
                    <span className="font-mono">{fa.accountNumber}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-treasury-features">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />ACH Features</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  <FeatureStatus label="Inbound ACH" status={fa?.features["inbound_transfers.ach"]} />
                  <FeatureStatus label="Outbound ACH" status={fa?.features["outbound_transfers.ach"]} />
                  <FeatureStatus label="Outbound Payments ACH" status={fa?.features["outbound_payments.ach"]} />
                  <FeatureStatus label="ABA Address" status={fa?.features["financial_addresses.aba"]} />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="h-4 w-4" />
                Disburse Payroll via Stripe Treasury
              </CardTitle>
              <CardDescription>Select an approved payroll run to send ACH direct deposits to all eligible employees</CardDescription>
            </CardHeader>
            <CardContent>
              {fa?.features["outbound_payments.ach"] !== "active" && (
                <Alert className="mb-3">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Outbound Payments ACH feature is not yet active. It may take a few minutes after setup for features to become active.
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex gap-3 flex-wrap items-end">
                <div className="flex-1 min-w-[240px] space-y-1.5">
                  <label className="text-sm font-medium">Payroll Run</label>
                  <Select value={selectedRunId} onValueChange={v => { setSelectedRunId(v); setDisburseResult(null); }}>
                    <SelectTrigger data-testid="select-payroll-run-disburse">
                      <SelectValue placeholder="Select approved payroll run…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(runsQuery.data || [])
                        .filter(r => r.approvedAt && (r.status === "processed" || r.status === "approved"))
                        .map(r => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.periodStart} – {r.periodEnd}
                            {r.totalNet && ` · Net: $${parseFloat(r.totalNet).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
                            {r.achStatus === "submitted" && " (ACH submitted)"}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  data-testid="button-disburse-treasury"
                  disabled={!selectedRunId || disburseMutation.isPending || fa?.features["outbound_payments.ach"] !== "active"}
                  onClick={() => selectedRunId && disburseMutation.mutate(selectedRunId)}
                >
                  {disburseMutation.isPending
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Disbursing…</>
                    : <><Send className="mr-2 h-4 w-4" />Disburse via Stripe</>}
                </Button>
              </div>

              {disburseResult && (
                <div className="mt-4 space-y-2">
                  <Alert variant={disburseResult.success ? "default" : "destructive"}>
                    <AlertDescription className="text-xs">{disburseResult.message}</AlertDescription>
                  </Alert>
                  {disburseResult.results && disburseResult.results.length > 0 && (
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Employee</TableHead>
                            <TableHead className="text-xs">Amount</TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                            <TableHead className="text-xs">Error</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {disburseResult.results.map((r: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs">{r.workerName}</TableCell>
                              <TableCell className="text-xs font-mono">${r.amount?.toFixed(2)}</TableCell>
                              <TableCell><StatusBadge status={r.status === "processing" || r.status === "pending" ? "pending" : r.status} /></TableCell>
                              <TableCell className="text-xs text-red-500">{r.error || "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Outbound Payment History
                  </CardTitle>
                  <CardDescription>ACH direct deposit transactions initiated via Stripe Treasury</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {txQuery.isLoading ? (
                <div className="p-4 space-y-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : (txQuery.data?.length ?? 0) === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <DollarSign className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No transactions yet. Disburse a payroll run via Stripe Treasury to see transactions here.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Memo</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Stripe ID</TableHead>
                        <TableHead>Error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {txQuery.data!.map(tx => (
                        <TableRow key={tx.id} data-testid={`row-treasury-tx-${tx.id}`}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(tx.createdAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="font-medium">{tx.recipientName || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{tx.memo || "—"}</TableCell>
                          <TableCell className="font-mono">${(tx.amount / 100).toFixed(2)}</TableCell>
                          <TableCell><StatusBadge status={tx.status} /></TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {tx.stripeOutboundPaymentId ? tx.stripeOutboundPaymentId.substring(0, 20) + "…" : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-red-500 max-w-[160px] truncate">
                            {tx.errorMessage || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start gap-3">
                <Building2 className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                  <p className="font-medium">How to fund your Financial Account</p>
                  <p className="text-blue-700 dark:text-blue-300 text-xs">
                    To disburse payroll, your Stripe Financial Account must have sufficient funds.
                    Fund it by initiating an ACH debit from your business bank account via the Stripe Dashboard
                    (Treasury → Financial Account → Add funds). Allow 1–3 business days for ACH to settle.
                  </p>
                  <p className="text-blue-700 dark:text-blue-300 text-xs">
                    Routing: <span className="font-mono">{fa?.routingNumber || "—"}</span> ·
                    Account: <span className="font-mono">{fa?.accountNumber || "—"}</span>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
