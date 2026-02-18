import { useQuery, useMutation } from "@tanstack/react-query";
import {
  FileText,
  Check,
  X,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import type { TimeEntry, Worker } from "@shared/schema";

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

export default function Timesheets() {
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
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Timesheet updated" });
    },
  });

  const sortedEntries = (entries || []).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const totalHours = sortedEntries.reduce(
    (sum, e) => sum + Number(e.totalHours || 0),
    0
  );
  const pendingCount = sortedEntries.filter((e) => e.status === "pending").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-timesheets-title">
          Timesheets
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review and approve employee time entries.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Entries</p>
            <p className="text-2xl font-bold mt-1">{sortedEntries.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Hours</p>
            <p className="text-2xl font-bold mt-1">{totalHours.toFixed(1)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pending Review</p>
            <p className="text-2xl font-bold mt-1 text-primary">{pendingCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : sortedEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <FileText className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No timesheets found</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Time entries will appear here when workers clock in.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Worker</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Clock In</TableHead>
                    <TableHead>Clock Out</TableHead>
                    <TableHead>Break</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>OT</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedEntries.map((entry) => {
                    const worker = workerMap.get(entry.workerId);
                    return (
                      <TableRow key={entry.id} data-testid={`row-timesheet-${entry.id}`}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                              {worker ? `${worker.firstName[0]}${worker.lastName[0]}` : "??"}
                            </div>
                            <span className="text-sm">
                              {worker ? `${worker.firstName} ${worker.lastName}` : "Unknown"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{entry.date}</TableCell>
                        <TableCell className="text-sm">
                          {entry.clockIn
                            ? new Date(entry.clockIn).toLocaleTimeString("en-US", {
                                hour: "numeric",
                                minute: "2-digit",
                              })
                            : "-"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {entry.clockOut
                            ? new Date(entry.clockOut).toLocaleTimeString("en-US", {
                                hour: "numeric",
                                minute: "2-digit",
                              })
                            : "-"}
                        </TableCell>
                        <TableCell className="text-sm">{entry.breakMinutes || 0}m</TableCell>
                        <TableCell className="text-sm font-medium">
                          {Number(entry.totalHours || 0).toFixed(1)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {Number(entry.overtimeHours || 0) > 0 ? (
                            <span className="text-primary font-medium">
                              {Number(entry.overtimeHours).toFixed(1)}
                            </span>
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
                                onClick={() =>
                                  updateStatus.mutate({
                                    id: entry.id,
                                    status: "approved",
                                  })
                                }
                                data-testid={`button-approve-${entry.id}`}
                              >
                                <Check className="h-4 w-4 text-primary" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() =>
                                  updateStatus.mutate({
                                    id: entry.id,
                                    status: "rejected",
                                  })
                                }
                                data-testid={`button-reject-${entry.id}`}
                              >
                                <X className="h-4 w-4 text-destructive" />
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
