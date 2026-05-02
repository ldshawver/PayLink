import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Shield,
  Download,
  Search,
  Filter,
  ArrowLeft,
  ArrowRight,
  Eye,
  Clock,
} from "lucide-react";

const PAGE_SIZE = 50;

const EVENT_TYPE_LABELS: Record<string, string> = {
  role_assigned: "Role Assigned",
  role_removed: "Role Removed",
  permission_changed: "Permission Changed",
  override_added: "Override Added",
  override_removed: "Override Removed",
  lifecycle_transition: "Lifecycle Transition",
  billing_event: "Billing Event",
  provisioning_step: "Provisioning Step",
  department_changed: "Department Changed",
  location_changed: "Location Changed",
  reporting_changed: "Reporting Changed",
  worker_created: "Worker Created",
  worker_updated: "Worker Updated",
  worker_deleted: "Worker Deleted",
  data_export: "PII Export (GDPR)",
  data_anonymization: "Anonymization (GDPR)",
  payroll_run_created: "Payroll Run Created",
  payroll_run_approved: "Payroll Run Approved",
  payroll_run_locked: "Payroll Run Locked",
  payroll_run_submitted: "Payroll Run Submitted",
  pay_method_created: "Pay Method Added",
  pay_method_updated: "Pay Method Updated",
  pay_method_deleted: "Pay Method Removed",
  breach_notification: "Breach Notification",
  mfa_enabled: "MFA Enabled",
  mfa_disabled: "MFA Disabled",
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  role_assigned: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  role_removed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  permission_changed: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  override_added: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  override_removed: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  lifecycle_transition: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  billing_event: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  provisioning_step: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
};

type AuditLog = {
  id: string;
  actorUserId: string;
  targetUserId?: string | null;
  targetRoleId?: string | null;
  targetResource?: string | null;
  changeType: string;
  beforeValue?: string | null;
  afterValue?: string | null;
  note?: string | null;
  companyId?: string | null;
  tenantId?: string | null;
  createdAt?: string | null;
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DiffDisplay({ before, after }: { before?: string | null; after?: string | null }) {
  if (!before && !after) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex items-center gap-1 text-xs">
      {before ? (
        <span className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded font-mono max-w-24 truncate" title={before}>
          {before}
        </span>
      ) : null}
      {before && after ? <span className="text-muted-foreground">→</span> : null}
      {after ? (
        <span className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded font-mono max-w-24 truncate" title={after}>
          {after}
        </span>
      ) : null}
    </div>
  );
}

function AuditLogDetailSheet({ log }: { log: AuditLog }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" data-testid={`button-detail-${log.id}`}>
          <Eye className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Audit Event Detail</SheetTitle>
          <SheetDescription>Full details for this audit log entry</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Event ID</Label>
            <p className="font-mono text-sm mt-1 break-all">{log.id}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Timestamp</Label>
            <p className="text-sm mt-1">{formatDate(log.createdAt)}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Event Type</Label>
            <div className="mt-1">
              <Badge className={EVENT_TYPE_COLORS[log.changeType] || "bg-gray-100 text-gray-600"}>
                {EVENT_TYPE_LABELS[log.changeType] || log.changeType}
              </Badge>
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Actor</Label>
            <p className="font-mono text-sm mt-1 break-all">{log.actorUserId}</p>
          </div>
          {log.targetUserId && (
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Target User</Label>
              <p className="font-mono text-sm mt-1 break-all">{log.targetUserId}</p>
            </div>
          )}
          {log.targetRoleId && (
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Target Role</Label>
              <p className="font-mono text-sm mt-1 break-all">{log.targetRoleId}</p>
            </div>
          )}
          {log.targetResource && (
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Target Resource</Label>
              <p className="font-mono text-sm mt-1">{log.targetResource}</p>
            </div>
          )}
          {log.companyId && (
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Company</Label>
              <p className="font-mono text-sm mt-1 break-all">{log.companyId}</p>
            </div>
          )}
          {log.beforeValue && (
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Before Value</Label>
              <pre className="text-xs mt-1 bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200 p-2 rounded overflow-auto max-h-40">{log.beforeValue}</pre>
            </div>
          )}
          {log.afterValue && (
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">After Value</Label>
              <pre className="text-xs mt-1 bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200 p-2 rounded overflow-auto max-h-40">{log.afterValue}</pre>
            </div>
          )}
          {log.note && (
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Note</Label>
              <p className="text-sm mt-1 text-muted-foreground">{log.note}</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function AuditLogPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [changeTypeFilter, setChangeTypeFilter] = useState<string>("");
  const [resourceFilter, setResourceFilter] = useState<string>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  });
  if (changeTypeFilter) params.set("changeType", changeTypeFilter);
  if (resourceFilter) params.set("targetResource", resourceFilter);
  if (fromDate) params.set("fromDate", fromDate);
  if (toDate) params.set("toDate", toDate + "T23:59:59");

  const { data, isLoading } = useQuery<{ rows: AuditLog[]; total: number }>({
    queryKey: ["/api/audit-log", page, changeTypeFilter, resourceFilter, fromDate, toDate],
    queryFn: async () => {
      const r = await fetch(`/api/audit-log?${params.toString()}`);
      if (!r.ok) throw new Error("Failed to fetch audit log");
      return r.json();
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const filteredRows = search
    ? rows.filter(r =>
        [r.changeType, r.actorUserId, r.targetUserId, r.targetResource, r.note, r.companyId]
          .some(v => v?.toLowerCase().includes(search.toLowerCase()))
      )
    : rows;

  const handleExport = useCallback(() => {
    const exportParams = new URLSearchParams(params);
    exportParams.set("limit", "10000");
    exportParams.set("offset", "0");
    window.open(`/api/audit-log/export-csv?${exportParams.toString()}`, "_blank");
  }, [params]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-audit-log-title">
          <Shield className="h-6 w-6 text-blue-600" />
          Audit Log
        </h1>
        <Button variant="outline" onClick={handleExport} data-testid="button-export-csv">
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
          <CardDescription>Filter audit events by type, date range, or search by keyword</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            <div className="space-y-1">
              <Label htmlFor="search">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Actor, resource, note…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8"
                  data-testid="input-search"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="event-type">Event Type</Label>
              <Select
                value={changeTypeFilter || "all"}
                onValueChange={v => { setChangeTypeFilter(v === "all" ? "" : v); setPage(0); }}
              >
                <SelectTrigger id="event-type" data-testid="select-event-type">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="role_assigned">Role Assigned</SelectItem>
                  <SelectItem value="role_removed">Role Removed</SelectItem>
                  <SelectItem value="permission_changed">Permission Changed</SelectItem>
                  <SelectItem value="override_added">Override Added</SelectItem>
                  <SelectItem value="override_removed">Override Removed</SelectItem>
                  <SelectItem value="lifecycle_transition">Lifecycle Transition</SelectItem>
                  <SelectItem value="billing_event">Billing Event</SelectItem>
                  <SelectItem value="department_changed">Department Changed</SelectItem>
                  <SelectItem value="location_changed">Location Changed</SelectItem>
                  <SelectItem value="reporting_changed">Reporting Changed</SelectItem>
                  <SelectItem value="worker_created">Worker Created</SelectItem>
                  <SelectItem value="worker_updated">Worker Updated</SelectItem>
                  <SelectItem value="worker_deleted">Worker Deleted</SelectItem>
                  <SelectItem value="data_export">PII Export (GDPR)</SelectItem>
                  <SelectItem value="data_anonymization">Anonymization (GDPR)</SelectItem>
                  <SelectItem value="payroll_run_created">Payroll Run Created</SelectItem>
                  <SelectItem value="payroll_run_approved">Payroll Run Approved</SelectItem>
                  <SelectItem value="payroll_run_locked">Payroll Run Locked</SelectItem>
                  <SelectItem value="pay_method_created">Pay Method Added</SelectItem>
                  <SelectItem value="pay_method_updated">Pay Method Updated</SelectItem>
                  <SelectItem value="pay_method_deleted">Pay Method Removed</SelectItem>
                  <SelectItem value="breach_notification">Breach Notification</SelectItem>
                  <SelectItem value="mfa_enabled">MFA Enabled</SelectItem>
                  <SelectItem value="mfa_disabled">MFA Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="resource-filter">Resource Type</Label>
              <Select
                value={resourceFilter || "all"}
                onValueChange={v => { setResourceFilter(v === "all" ? "" : v); setPage(0); }}
              >
                <SelectTrigger id="resource-filter" data-testid="select-resource-filter">
                  <SelectValue placeholder="All resources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All resources</SelectItem>
                  <SelectItem value="workers">Workers</SelectItem>
                  <SelectItem value="payroll_runs">Payroll Runs</SelectItem>
                  <SelectItem value="payroll_items">Payroll Items</SelectItem>
                  <SelectItem value="pay_methods">Pay Methods</SelectItem>
                  <SelectItem value="companies">Companies</SelectItem>
                  <SelectItem value="users">Users</SelectItem>
                  <SelectItem value="breach_incidents">Breach Incidents</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="from-date">From Date</Label>
              <Input
                id="from-date"
                type="date"
                value={fromDate}
                onChange={e => { setFromDate(e.target.value); setPage(0); }}
                data-testid="input-from-date"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="to-date">To Date</Label>
              <Input
                id="to-date"
                type="date"
                value={toDate}
                onChange={e => { setToDate(e.target.value); setPage(0); }}
                data-testid="input-to-date"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">
                {isLoading ? "Loading…" : `${total.toLocaleString()} event${total !== 1 ? "s" : ""}`}
              </CardTitle>
              <CardDescription className="flex items-center gap-1 mt-1">
                <Clock className="h-3 w-3" />
                Most recent events first
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                data-testid="button-prev-page"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground" data-testid="text-pagination">
                {totalPages === 0 ? "0 / 0" : `${page + 1} / ${totalPages}`}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                data-testid="button-next-page"
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground" data-testid="text-empty-audit">
              <Shield className="h-12 w-12 mb-3 opacity-20" />
              <p className="font-medium">No audit events found</p>
              <p className="text-sm">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-audit-log">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Timestamp</TableHead>
                    <TableHead className="w-[150px]">Event Type</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Before → After</TableHead>
                    <TableHead className="w-[180px]">Note</TableHead>
                    <TableHead className="w-[48px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map(row => (
                    <TableRow key={row.id} data-testid={`row-audit-${row.id}`}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(row.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`text-xs ${EVENT_TYPE_COLORS[row.changeType] || "bg-gray-100 text-gray-600"}`}
                        >
                          {EVENT_TYPE_LABELS[row.changeType] || row.changeType}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[120px] truncate" title={row.actorUserId}>
                        {row.actorUserId === "system" ? (
                          <Badge variant="outline" className="text-xs">system</Badge>
                        ) : row.actorUserId}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[120px]">
                        <div className="truncate" title={row.targetResource || row.targetUserId || undefined}>
                          {row.targetResource || row.targetUserId || "—"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DiffDisplay before={row.beforeValue} after={row.afterValue} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate" title={row.note || undefined}>
                        {row.note || "—"}
                      </TableCell>
                      <TableCell>
                        <AuditLogDetailSheet log={row} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
