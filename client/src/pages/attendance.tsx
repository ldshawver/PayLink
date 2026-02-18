import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import {
  Clock,
  Check,
  X,
  Plus,
  ClipboardList,
  Fingerprint,
  CalendarClock,
  BookOpen,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  TimeEntry,
  TimePunch,
  Worker,
  Company,
  AccrualBalance,
  AccrualAccount,
} from "@shared/schema";

function useTabParam(defaultTab: string): string {
  const search = useSearch();
  const params = new URLSearchParams(search);
  return params.get("tab") || defaultTab;
}

function formatTimestamp(dateStr: string | Date | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant={
        status === "approved"
          ? "default"
          : status === "rejected"
          ? "destructive"
          : "secondary"
      }
      data-testid={`badge-status-${status}`}
    >
      {status === "approved" && <Check className="h-3 w-3 mr-1" />}
      {status === "rejected" && <X className="h-3 w-3 mr-1" />}
      {status === "pending" && <Clock className="h-3 w-3 mr-1" />}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function PunchTypeBadge({ type }: { type: string }) {
  const label = type.replace(/_/g, " ");
  const variant = type === "clock_in" ? "default" : type === "clock_out" ? "destructive" : "secondary";
  return (
    <Badge variant={variant} data-testid={`badge-punch-type-${type}`}>
      {label.charAt(0).toUpperCase() + label.slice(1)}
    </Badge>
  );
}

function LoadingSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="p-6 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function TimesheetTab() {
  const { toast } = useToast();

  const { data: entries, isLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries"],
  });

  const { data: workers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  const workerMap = new Map(workers?.map((w) => [w.id, w]) || []);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiRequest("PATCH", `/api/time-entries/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      toast({ title: "Time entry updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const sortedEntries = (entries || []).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  if (isLoading) return <LoadingSkeleton />;

  if (sortedEntries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <ClipboardList className="h-12 w-12 text-muted-foreground/30 mb-3" />
        <p className="text-sm font-medium text-muted-foreground">No time entries found</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Clock In</TableHead>
            <TableHead>Clock Out</TableHead>
            <TableHead>Break</TableHead>
            <TableHead>Total Hours</TableHead>
            <TableHead>OT Hours</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedEntries.map((entry) => {
            const worker = workerMap.get(entry.workerId);
            return (
              <TableRow key={entry.id} data-testid={`row-timeentry-${entry.id}`}>
                <TableCell className="font-medium">
                  {worker ? `${worker.firstName} ${worker.lastName}` : "Unknown"}
                </TableCell>
                <TableCell className="text-sm">{entry.date}</TableCell>
                <TableCell className="text-sm">
                  {entry.clockIn ? formatTimestamp(entry.clockIn) : "-"}
                </TableCell>
                <TableCell className="text-sm">
                  {entry.clockOut ? formatTimestamp(entry.clockOut) : "-"}
                </TableCell>
                <TableCell className="text-sm">{entry.breakMinutes || 0}m</TableCell>
                <TableCell className="text-sm font-medium">
                  {Number(entry.totalHours || 0).toFixed(1)}
                </TableCell>
                <TableCell className="text-sm">
                  {Number(entry.overtimeHours || 0) > 0 ? (
                    <span className="font-medium">{Number(entry.overtimeHours).toFixed(1)}</span>
                  ) : (
                    "-"
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={entry.status || "pending"} />
                </TableCell>
                <TableCell className="text-right">
                  {entry.status === "pending" && (
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => updateStatus.mutate({ id: entry.id, status: "approved" })}
                        data-testid={`button-approve-${entry.id}`}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => updateStatus.mutate({ id: entry.id, status: "rejected" })}
                        data-testid={`button-reject-${entry.id}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function PunchesTab() {
  const { data: punches, isLoading } = useQuery<TimePunch[]>({
    queryKey: ["/api/time-punches"],
  });

  const { data: workers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  const workerMap = new Map(workers?.map((w) => [w.id, w]) || []);

  const sortedPunches = (punches || []).sort(
    (a, b) => new Date(b.punchTime).getTime() - new Date(a.punchTime).getTime()
  );

  if (isLoading) return <LoadingSkeleton />;

  if (sortedPunches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Fingerprint className="h-12 w-12 text-muted-foreground/30 mb-3" />
        <p className="text-sm font-medium text-muted-foreground">No punches found</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Punch Time</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedPunches.map((punch) => {
            const worker = workerMap.get(punch.workerId);
            return (
              <TableRow key={punch.id} data-testid={`row-punch-${punch.id}`}>
                <TableCell className="font-medium">
                  {worker ? `${worker.firstName} ${worker.lastName}` : "Unknown"}
                </TableCell>
                <TableCell>
                  <PunchTypeBadge type={punch.punchType} />
                </TableCell>
                <TableCell className="text-sm">
                  {formatTimestamp(punch.punchTime)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {punch.note || "-"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function AccrualBalancesTab() {
  const { data: balances, isLoading } = useQuery<AccrualBalance[]>({
    queryKey: ["/api/accrual-balances"],
  });

  const { data: workers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  const { data: accounts } = useQuery<AccrualAccount[]>({
    queryKey: ["/api/accrual-accounts"],
  });

  const workerMap = new Map(workers?.map((w) => [w.id, w]) || []);
  const accountMap = new Map(accounts?.map((a) => [a.id, a]) || []);

  if (isLoading) return <LoadingSkeleton />;

  if (!balances || balances.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <CalendarClock className="h-12 w-12 text-muted-foreground/30 mb-3" />
        <p className="text-sm font-medium text-muted-foreground">No accrual balances found</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Balance</TableHead>
            <TableHead>Used Hours</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {balances.map((bal) => {
            const worker = workerMap.get(bal.workerId);
            const account = accountMap.get(bal.accrualAccountId);
            return (
              <TableRow key={bal.id} data-testid={`row-balance-${bal.id}`}>
                <TableCell className="font-medium">
                  {worker ? `${worker.firstName} ${worker.lastName}` : "Unknown"}
                </TableCell>
                <TableCell className="text-sm">
                  {account ? account.name : bal.accrualAccountId}
                </TableCell>
                <TableCell className="text-sm font-medium">
                  {Number(bal.balance || 0).toFixed(1)}
                </TableCell>
                <TableCell className="text-sm">
                  {Number(bal.usedHours || 0).toFixed(1)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function AccrualsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    type: "pto",
    accrualRate: "",
    accrualFrequency: "per_pay_period",
    maxBalance: "",
    companyId: "",
  });

  const { data: accounts, isLoading } = useQuery<AccrualAccount[]>({
    queryKey: ["/api/accrual-accounts"],
  });

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const createAccount = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/accrual-accounts", {
        ...formData,
        accrualRate: formData.accrualRate || "0",
        maxBalance: formData.maxBalance || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accrual-accounts"] });
      toast({ title: "Accrual account created" });
      setDialogOpen(false);
      setFormData({
        name: "",
        type: "pto",
        accrualRate: "",
        accrualFrequency: "per_pay_period",
        maxBalance: "",
        companyId: "",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-accrual-account">
              <Plus className="h-4 w-4 mr-2" />
              Add Accrual Account
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Accrual Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label htmlFor="accrual-name">Name</Label>
                <Input
                  id="accrual-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Vacation Days"
                  data-testid="input-accrual-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v })}>
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
              <div className="space-y-2">
                <Label htmlFor="accrual-rate">Accrual Rate</Label>
                <Input
                  id="accrual-rate"
                  type="number"
                  value={formData.accrualRate}
                  onChange={(e) => setFormData({ ...formData, accrualRate: e.target.value })}
                  placeholder="e.g., 4"
                  data-testid="input-accrual-rate"
                />
              </div>
              <div className="space-y-2">
                <Label>Accrual Frequency</Label>
                <Select value={formData.accrualFrequency} onValueChange={(v) => setFormData({ ...formData, accrualFrequency: v })}>
                  <SelectTrigger data-testid="select-accrual-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_pay_period">Per Pay Period</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="annually">Annually</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-balance">Max Balance</Label>
                <Input
                  id="max-balance"
                  type="number"
                  value={formData.maxBalance}
                  onChange={(e) => setFormData({ ...formData, maxBalance: e.target.value })}
                  placeholder="e.g., 120"
                  data-testid="input-max-balance"
                />
              </div>
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={formData.companyId} onValueChange={(v) => setFormData({ ...formData, companyId: v })}>
                  <SelectTrigger data-testid="select-accrual-company">
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    {(companies || []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full"
                onClick={() => createAccount.mutate()}
                disabled={createAccount.isPending || !formData.name || !formData.companyId}
                data-testid="button-submit-accrual-account"
              >
                {createAccount.isPending ? "Creating..." : "Create Account"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {(!accounts || accounts.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-16">
          <BookOpen className="h-12 w-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No accrual accounts found</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Accrual Rate</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Max Balance</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id} data-testid={`row-accrual-${account.id}`}>
                  <TableCell className="font-medium">{account.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" data-testid={`badge-accrual-type-${account.id}`}>
                      {(account.type || "pto").toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {Number(account.accrualRate || 0)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {(account.accrualFrequency || "per_pay_period").replace(/_/g, " ")}
                  </TableCell>
                  <TableCell className="text-sm">
                    {account.maxBalance ? Number(account.maxBalance) : "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={account.isActive ? "default" : "secondary"} data-testid={`badge-active-${account.id}`}>
                      {account.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default function AttendancePage() {
  const currentTab = useTabParam("timesheet");

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-attendance-title">
          Attendance
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage timesheets, punches, and accrual balances.
        </p>
      </div>

      <Tabs value={currentTab} className="w-full">
        <TabsList data-testid="tabs-attendance">
          <Link href="/attendance?tab=timesheet">
            <TabsTrigger value="timesheet" data-testid="tab-timesheet" asChild>
              <span className="flex items-center gap-1.5">
                <ClipboardList className="h-4 w-4" />
                Timesheet
              </span>
            </TabsTrigger>
          </Link>
          <Link href="/attendance?tab=punches">
            <TabsTrigger value="punches" data-testid="tab-punches" asChild>
              <span className="flex items-center gap-1.5">
                <Fingerprint className="h-4 w-4" />
                Punches
              </span>
            </TabsTrigger>
          </Link>
          <Link href="/attendance?tab=accrual-balances">
            <TabsTrigger value="accrual-balances" data-testid="tab-accrual-balances" asChild>
              <span className="flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4" />
                Accrual Balances
              </span>
            </TabsTrigger>
          </Link>
          <Link href="/attendance?tab=accruals">
            <TabsTrigger value="accruals" data-testid="tab-accruals" asChild>
              <span className="flex items-center gap-1.5">
                <BookOpen className="h-4 w-4" />
                Accruals
              </span>
            </TabsTrigger>
          </Link>
        </TabsList>

        <TabsContent value="timesheet">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Time Entries</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <TimesheetTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="punches">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Time Punches</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <PunchesTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accrual-balances">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Accrual Balances</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <AccrualBalancesTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accruals">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Accrual Accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <AccrualsTab />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
