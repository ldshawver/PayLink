import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Check, X } from "lucide-react";

type AccessRequest = {
  id: string; email: string; firstName: string; lastName: string;
  phone: string | null; businessName: string | null; tradeType: string | null;
  licenseNumber: string | null; requestedCompanyHint: string | null; message: string | null;
  status: string; reviewNote: string | null; rejectionReason: string | null; createdAt: string | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "secondary", approved: "default", rejected: "destructive", withdrawn: "outline",
};

/** Admin review queue for public contractor access requests (PR 2). */
export default function ContractorAccessRequestsPage() {
  const { toast } = useToast();
  const [rejecting, setRejecting] = useState<AccessRequest | null>(null);
  const [reason, setReason] = useState("");

  const { data, isLoading } = useQuery<AccessRequest[]>({ queryKey: ["/api/contractor-access-requests"] });
  const rows = Array.isArray(data) ? data : [];

  const approve = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/contractor-access-requests/${id}/approve`, {})).json(),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-access-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      toast({
        title: r.needsReview ? "Approved — needs manual review" : "Request approved",
        description: r.needsReview ? (r.reviewNote || "Issued a fresh invite; link the account manually.")
          : r.outcome === "linked" ? "Linked to the existing account." : "Contractor worker created and an invite was emailed.",
        variant: r.needsReview ? "destructive" : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reject = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      (await apiRequest("POST", `/api/contractor-access-requests/${id}/reject`, { reason })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-access-requests"] });
      toast({ title: "Request rejected" });
      setRejecting(null); setReason("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Contractor Access Requests</h1>
        <p className="text-muted-foreground">
          Public sign-up requests for Contractor Hub access. Approving creates or links the contractor and emails a login invite.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Requests</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Business / trade</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-40"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No access requests</TableCell></TableRow>
                ) : rows.map(r => (
                  <TableRow key={r.id} data-testid={`row-request-${r.id}`}>
                    <TableCell>{r.firstName} {r.lastName}</TableCell>
                    <TableCell className="text-sm">{r.email}</TableCell>
                    <TableCell className="text-sm">{[r.businessName, r.tradeType].filter(Boolean).join(" · ") || "—"}</TableCell>
                    <TableCell className="text-sm">{r.requestedCompanyHint || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status] || "secondary"} className="text-xs" data-testid={`badge-request-status-${r.id}`}>{r.status}</Badge>
                      {r.reviewNote && <p className="text-[11px] text-amber-600 mt-1 max-w-[16rem]">{r.reviewNote}</p>}
                      {r.rejectionReason && r.status === "rejected" && <p className="text-[11px] text-muted-foreground mt-1">{r.rejectionReason}</p>}
                    </TableCell>
                    <TableCell>
                      {r.status === "pending" && (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" data-testid={`button-approve-${r.id}`}
                            disabled={approve.isPending} onClick={() => approve.mutate(r.id)}>
                            <Check className="h-3.5 w-3.5 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-600" data-testid={`button-reject-${r.id}`}
                            onClick={() => { setRejecting(r); setReason(""); }}>
                            <X className="h-3.5 w-3.5 mr-1" /> Reject
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!rejecting} onOpenChange={v => { if (!v) { setRejecting(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {rejecting?.firstName} {rejecting?.lastName} · {rejecting?.email}. The request is kept for the record.
            </p>
            <Textarea data-testid="input-reject-reason" placeholder="Reason (optional)" value={reason} onChange={e => setReason(e.target.value)} rows={3} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setRejecting(null); setReason(""); }}>Cancel</Button>
              <Button variant="destructive" data-testid="button-confirm-reject" disabled={reject.isPending}
                onClick={() => rejecting && reject.mutate({ id: rejecting.id, reason })}>
                {reject.isPending ? "Rejecting…" : "Reject request"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
