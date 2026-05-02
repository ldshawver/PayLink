import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Lock, ArrowLeft, ArrowRight, Eye, Search, Filter, Download } from "lucide-react";

const PAGE_SIZE = 50;

const ACTION_TYPE_LABELS: Record<string, string> = {
  data_export: "Data Export",
  data_anonymization: "Data Anonymization",
  consent_change: "Consent Change",
  retention_policy_change: "Retention Policy Change",
  mfa_enrolled: "MFA Enrolled",
  mfa_disabled: "MFA Disabled",
  breach_notification: "Breach Notification",
  data_access: "Data Access",
};

const ACTION_TYPE_COLORS: Record<string, string> = {
  data_export: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  data_anonymization: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  consent_change: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  retention_policy_change: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  mfa_enrolled: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  mfa_disabled: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  breach_notification: "bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-100",
  data_access: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

type PrivacyLog = {
  id: string;
  actorUserId: string;
  actionType: string;
  dataSubjectId?: string | null;
  tenantId?: string | null;
  detail?: string | null;
  createdAt?: string | null;
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function DetailSheet({ log }: { log: PrivacyLog }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" data-testid={`button-detail-${log.id}`}>
          <Eye className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Privacy Event Detail</SheetTitle>
          <SheetDescription>Full details for this privacy audit entry</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div><Label className="text-xs text-muted-foreground uppercase tracking-wide">Event ID</Label>
            <p className="font-mono text-sm mt-1 break-all">{log.id}</p></div>
          <div><Label className="text-xs text-muted-foreground uppercase tracking-wide">Timestamp</Label>
            <p className="text-sm mt-1">{formatDate(log.createdAt)}</p></div>
          <div><Label className="text-xs text-muted-foreground uppercase tracking-wide">Action Type</Label>
            <div className="mt-1">
              <Badge className={ACTION_TYPE_COLORS[log.actionType] || "bg-gray-100 text-gray-600"}>
                {ACTION_TYPE_LABELS[log.actionType] || log.actionType}
              </Badge>
            </div>
          </div>
          <div><Label className="text-xs text-muted-foreground uppercase tracking-wide">Actor</Label>
            <p className="font-mono text-sm mt-1 break-all">{log.actorUserId}</p></div>
          {log.dataSubjectId && (
            <div><Label className="text-xs text-muted-foreground uppercase tracking-wide">Data Subject (Worker ID)</Label>
              <p className="font-mono text-sm mt-1 break-all">{log.dataSubjectId}</p></div>
          )}
          {log.tenantId && (
            <div><Label className="text-xs text-muted-foreground uppercase tracking-wide">Tenant (Company ID)</Label>
              <p className="font-mono text-sm mt-1 break-all">{log.tenantId}</p></div>
          )}
          {log.detail && (
            <div><Label className="text-xs text-muted-foreground uppercase tracking-wide">Detail</Label>
              <pre className="text-xs mt-1 bg-muted p-2 rounded overflow-auto max-h-48 whitespace-pre-wrap">{log.detail}</pre></div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function PrivacyAuditLogPage() {
  const [page, setPage] = useState(0);
  const [actionTypeFilter, setActionTypeFilter] = useState("");
  const [dataSubjectSearch, setDataSubjectSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  });
  if (actionTypeFilter) params.set("actionType", actionTypeFilter);
  if (dataSubjectSearch) params.set("dataSubjectId", dataSubjectSearch);
  if (fromDate) params.set("fromDate", fromDate);
  if (toDate) params.set("toDate", toDate + "T23:59:59");

  const { data, isLoading } = useQuery<{ rows: PrivacyLog[]; total: number }>({
    queryKey: ["/api/privacy-audit-log", page, actionTypeFilter, dataSubjectSearch, fromDate, toDate],
    queryFn: async () => {
      const r = await fetch(`/api/privacy-audit-log?${params.toString()}`);
      if (!r.ok) throw new Error("Failed to fetch privacy audit log");
      return r.json();
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-privacy-audit-title">
          <Lock className="h-6 w-6 text-purple-600" />
          Privacy Actions Audit Log
        </h1>
        <Button
          variant="outline"
          onClick={() => window.open(`/api/privacy-audit-log/export-csv?${params.toString()}`, "_blank")}
          data-testid="button-export-privacy-csv"
        >
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
          <CardDescription>Filter by action type, data subject ID, or date range</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1">
              <Label>Data Subject ID</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Worker ID…"
                  value={dataSubjectSearch}
                  onChange={e => { setDataSubjectSearch(e.target.value); setPage(0); }}
                  className="pl-8"
                  data-testid="input-data-subject-search"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Action Type</Label>
              <Select value={actionTypeFilter || "all"} onValueChange={v => { setActionTypeFilter(v === "all" ? "" : v); setPage(0); }}>
                <SelectTrigger data-testid="select-action-type">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="data_export">Data Export</SelectItem>
                  <SelectItem value="data_anonymization">Data Anonymization</SelectItem>
                  <SelectItem value="consent_change">Consent Change</SelectItem>
                  <SelectItem value="retention_policy_change">Retention Policy Change</SelectItem>
                  <SelectItem value="mfa_enrolled">MFA Enrolled</SelectItem>
                  <SelectItem value="mfa_disabled">MFA Disabled</SelectItem>
                  <SelectItem value="breach_notification">Breach Notification</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>From Date</Label>
              <Input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(0); }} data-testid="input-from-date" />
            </div>
            <div className="space-y-1">
              <Label>To Date</Label>
              <Input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(0); }} data-testid="input-to-date" />
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
              <CardDescription className="mt-1 text-xs">Privacy-related actions only — data exports, anonymizations, consent changes, MFA, breach notifications</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} data-testid="button-prev-page">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground" data-testid="text-pagination">
                {totalPages === 0 ? "0 / 0" : `${page + 1} / ${totalPages}`}
              </span>
              <Button variant="outline" size="icon" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} data-testid="button-next-page">
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground" data-testid="text-empty-privacy">
              <Lock className="h-12 w-12 mb-3 opacity-20" />
              <p className="font-medium">No privacy events found</p>
              <p className="text-sm">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-privacy-audit">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Timestamp</TableHead>
                    <TableHead className="w-[170px]">Action Type</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Data Subject</TableHead>
                    <TableHead>Tenant</TableHead>
                    <TableHead className="w-[48px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(row => (
                    <TableRow key={row.id} data-testid={`row-privacy-${row.id}`}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(row.createdAt)}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${ACTION_TYPE_COLORS[row.actionType] || "bg-gray-100 text-gray-600"}`}>
                          {ACTION_TYPE_LABELS[row.actionType] || row.actionType}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[120px] truncate" title={row.actorUserId}>
                        {row.actorUserId === "system" ? <Badge variant="outline" className="text-xs">system</Badge> : row.actorUserId}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground max-w-[120px] truncate" title={row.dataSubjectId || undefined}>
                        {row.dataSubjectId || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground max-w-[120px] truncate" title={row.tenantId || undefined}>
                        {row.tenantId || "—"}
                      </TableCell>
                      <TableCell><DetailSheet log={row} /></TableCell>
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
