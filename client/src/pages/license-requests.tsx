import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, Building2, Users, Globe, Calendar, MessageSquare, Tag, Phone } from "lucide-react";
import type { LicenseRequest } from "@shared/schema";

const STATUS_OPTIONS = ["pending", "contacted", "fulfilled", "rejected"] as const;
type Status = typeof STATUS_OPTIONS[number];

const STATUS_COLORS: Record<Status, string> = {
  pending:   "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  contacted: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  fulfilled: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  rejected:  "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

function formatInterest(val: string | null) {
  if (!val) return "—";
  return val.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function formatDate(val: string | null) {
  if (!val) return "—";
  return new Date(val).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

interface UpdateDialogProps {
  request: LicenseRequest;
  onClose: () => void;
}

function UpdateDialog({ request, onClose }: UpdateDialogProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>((request.status as Status) || "pending");
  const [notes, setNotes] = useState(request.notes || "");

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/admin/license-requests/${request.id}/status`, { status, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/license-requests"] });
      toast({ title: "Request updated" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="dialog-update-request">
        <DialogHeader>
          <DialogTitle>Update Request — {request.email}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md border p-3 text-sm space-y-1 bg-muted/40">
            <div><span className="font-medium">Name:</span> {[request.firstName, request.lastName].filter(Boolean).join(" ") || "—"}</div>
            <div><span className="font-medium">Company:</span> {request.company || "—"}</div>
            <div><span className="font-medium">Interest:</span> {formatInterest(request.interest)}</div>
            {request.message && <div><span className="font-medium">Message:</span> {request.message}</div>}
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
              <SelectTrigger data-testid="select-request-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(s => (
                  <SelectItem key={s} value={s} data-testid={`option-status-${s}`}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Internal Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about this request..."
              rows={3}
              data-testid="textarea-request-notes"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            data-testid="button-save-request"
          >
            {mutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LicenseRequestsPage() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<LicenseRequest | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: requests = [], isLoading } = useQuery<LicenseRequest[]>({
    queryKey: ["/api/admin/license-requests"],
  });

  const filtered = statusFilter === "all"
    ? requests
    : requests.filter(r => r.status === statusFilter);

  const counts = STATUS_OPTIONS.reduce<Record<string, number>>((acc, s) => {
    acc[s] = requests.filter(r => r.status === s).length;
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">License Requests</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Inbound requests from the public contact form
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {["all", ...STATUS_OPTIONS].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              data-testid={`button-filter-${s}`}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {s === "all" ? `All (${requests.length})` : `${s.charAt(0).toUpperCase() + s.slice(1)} (${counts[s] ?? 0})`}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16" data-testid="div-loading">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No requests found</p>
            <p className="text-sm mt-1">
              {statusFilter === "all" ? "Requests submitted via the contact form will appear here." : `No ${statusFilter} requests.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((r) => (
            <Card
              key={r.id}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setSelected(r)}
              data-testid={`card-request-${r.id}`}
            >
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm" data-testid={`text-request-name-${r.id}`}>
                        {[r.firstName, r.lastName].filter(Boolean).join(" ") || "Anonymous"}
                      </span>
                      <Badge
                        className={`text-xs font-medium border-0 ${STATUS_COLORS[(r.status as Status) || "pending"]}`}
                        data-testid={`badge-status-${r.id}`}
                      >
                        {r.status || "pending"}
                      </Badge>
                      {r.interest && (
                        <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                          {formatInterest(r.interest)}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate" data-testid={`text-request-email-${r.id}`}>{r.email}</span>
                      </span>
                      {r.phone && (
                        <span className="flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 shrink-0" />
                          {r.phone}
                        </span>
                      )}
                      {r.company && (
                        <span className="flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 shrink-0" />
                          {r.company}
                        </span>
                      )}
                      {r.employees && (
                        <span className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 shrink-0" />
                          {r.employees} employees
                        </span>
                      )}
                      {r.sourcePage && (
                        <span className="flex items-center gap-1.5 min-w-0">
                          <Globe className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{r.sourcePage}</span>
                        </span>
                      )}
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 shrink-0" />
                        {formatDate(r.createdAt as unknown as string)}
                      </span>
                    </div>

                    {r.message && (
                      <p className="text-sm text-muted-foreground line-clamp-2 border-l-2 border-muted pl-2">
                        {r.message}
                      </p>
                    )}
                    {r.notes && (
                      <p className="text-xs text-muted-foreground italic flex items-center gap-1">
                        <Tag className="h-3 w-3" /> {r.notes}
                      </p>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => { e.stopPropagation(); setSelected(r); }}
                    data-testid={`button-edit-request-${r.id}`}
                    className="shrink-0 self-start"
                  >
                    Update
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <UpdateDialog request={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
