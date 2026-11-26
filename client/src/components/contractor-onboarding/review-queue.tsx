import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getCsrfToken, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, Info, Loader2, ShieldCheck } from "lucide-react";
import { PrivateDocsButton } from "./private-docs-dialog";

type Counts = { blocking: number; review: number; info: number };
type QueueRow = { onboardingId: string; firstName: string; lastName: string; employeeNumber: string | null; status: string; ready: boolean; counts: Counts };
type Finding = { code: string; severity: "blocking" | "review" | "info"; step: string | null; message: string; guidance: string };
type Assessment = { ready: boolean; verified: boolean; findings: Finding[]; counts: Counts };

/** Must match APPROVAL_PHRASE in server/contractor-onboarding/review.ts. */
const APPROVAL_PHRASE = "APPROVE ONBOARDING";
const SEV_ICON = { blocking: AlertTriangle, review: ShieldCheck, info: Info } as const;
const SEV_CLASS = { blocking: "text-destructive", review: "text-amber-700", info: "text-muted-foreground" } as const;

/** ADI checklist + review queue. ADI is rule-based; it never sends anything to an AI service. */
export function ReviewQueueCard({ canApprove }: { canApprove: boolean }) {
  const { data, isLoading } = useQuery<QueueRow[]>({ queryKey: ["/api/contractor-onboarding/review-queue"] });
  const [open, setOpen] = useState<QueueRow | null>(null);
  return (
    <Card data-testid="card-review-queue">
      <CardHeader>
        <CardTitle className="text-base">Review queue</CardTitle>
        <CardDescription>ADI checks each contractor's records and lists what's missing, what disagrees, and what a person must check.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : !data?.length ? (
          <p className="text-sm text-muted-foreground" data-testid="text-queue-empty">Nothing to review.</p>
        ) : (
          <ul className="divide-y">
            {data.map((r) => (
              <li key={r.onboardingId} className="py-2 flex flex-wrap items-center gap-2 justify-between" data-testid={`row-queue-${r.onboardingId}`}>
                <div className="text-sm">
                  <span className="font-mono mr-2">{r.employeeNumber}</span>{r.firstName} {r.lastName}
                  <div className="text-xs text-muted-foreground">
                    {r.ready ? "Ready for review" : `${r.counts.blocking} item${r.counts.blocking === 1 ? "" : "s"} missing`}
                    {r.counts.review > 0 && ` · ${r.counts.review} to check`}
                    {r.status === "changes_requested" && " · changes requested"}
                  </div>
                </div>
                <Button size="sm" variant={r.ready ? "default" : "outline"} onClick={() => setOpen(r)} data-testid={`button-review-${r.onboardingId}`}>
                  {r.ready ? "Review" : "Details"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {open && <ReviewDialog row={open} canApprove={canApprove} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function ReviewDialog({ row, canApprove, onClose }: { row: QueueRow; canApprove: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Assessment>({ queryKey: [`/api/contractor-onboarding/${row.onboardingId}/assessment`], staleTime: 0 });
  const [idOk, setIdOk] = useState(false);
  const [w9Ok, setW9Ok] = useState(false);
  const [step, setStep] = useState<string>("government_id");
  const [note, setNote] = useState("");
  const [approveNote, setApproveNote] = useState("");
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const submit = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/contractor-onboarding/${encodeURIComponent(row.onboardingId)}/review`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfToken() ?? "" }, body: JSON.stringify(body),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b?.message || "Could not record the review.");
      return b as { outcome: string };
    },
    onSuccess: (r) => {
      for (const k of ["/api/contractor-onboarding/review-queue", "/api/contractor-onboarding", `/api/contractor-onboarding/${row.onboardingId}/assessment`]) queryClient.invalidateQueries({ queryKey: [k] });
      const redo = r.outcome === "changes_requested" || r.outcome === "already_changes_requested";
      toast({ title: redo ? "Changes requested" : "Onboarding verified", description: redo ? "The contractor will see your note on their checklist." : "All items are verified." });
      onClose();
    },
    onSettled: () => setPassword(""),
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row.firstName} {row.lastName}</DialogTitle>
          <DialogDescription>ADI reviewed the records below. It never opens the ID or reads the W-9 — those checks are yours.</DialogDescription>
        </DialogHeader>
        {isLoading || !data ? <Loader2 className="h-5 w-5 animate-spin" /> : (
          <div className="space-y-4">
            <ul className="space-y-2" data-testid="list-findings">
              {data.findings.length === 0 && <li className="text-sm flex gap-2"><CheckCircle2 className="h-4 w-4 text-green-600" />Nothing outstanding.</li>}
              {data.findings.map((f) => { const Icon = SEV_ICON[f.severity]; return (
                <li key={f.code} className="text-sm flex gap-2" data-testid={`finding-${f.code}`}>
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${SEV_CLASS[f.severity]}`} />
                  <div><div>{f.message}</div><div className="text-xs text-muted-foreground">{f.guidance}</div></div>
                </li>
              ); })}
            </ul>
            <PrivateDocsButton onboardingId={row.onboardingId} />
            {canApprove && data.ready && !data.verified && (
              <div className="space-y-2 border-t pt-3">
                <div className="flex items-start gap-2"><Checkbox id="c-id" checked={idOk} onCheckedChange={(v) => setIdOk(v === true)} data-testid="check-id-verified" /><Label htmlFor="c-id" className="text-sm font-normal">I checked the government ID: unexpired, and the name matches this contractor.</Label></div>
                <div className="flex items-start gap-2"><Checkbox id="c-w9" checked={w9Ok} onCheckedChange={(v) => setW9Ok(v === true)} data-testid="check-w9-reviewed" /><Label htmlFor="c-w9" className="text-sm font-normal">I reviewed the signed W-9 (name, tax classification, TIN present).</Label></div>
                <Label htmlFor="a-note">Reviewer note</Label>
                <Textarea id="a-note" maxLength={500} value={approveNote} onChange={(e) => setApproveNote(e.target.value)} placeholder="What you checked. (Don't include ID or tax numbers.)" data-testid="input-approve-note" />
                <Label htmlFor="a-phrase">Type <span className="font-mono">{APPROVAL_PHRASE}</span> to confirm</Label>
                <Input id="a-phrase" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" data-testid="input-approve-phrase" />
                <Label htmlFor="a-pw">Your password</Label>
                <Input id="a-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" data-testid="input-approve-password" />
                <Button disabled={!idOk || !w9Ok || !approveNote.trim() || phrase !== APPROVAL_PHRASE || !password || submit.isPending}
                  onClick={() => submit.mutate({ decision: "approve", confirmIdVerified: idOk, confirmW9Reviewed: w9Ok, note: approveNote, confirmationPhrase: phrase, currentPassword: password })} data-testid="button-approve">
                  {submit.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Approve onboarding
                </Button>
              </div>
            )}
            {canApprove && !data.verified && (
              <div className="space-y-2 border-t pt-3">
                <Label htmlFor="rc-step">Ask the contractor to redo</Label>
                <select id="rc-step" className="w-full rounded-md border bg-background p-2 text-sm" value={step} onChange={(e) => setStep(e.target.value)} data-testid="select-redo-step">
                  <option value="government_id">Government ID</option><option value="emergency_contact">Emergency contact</option>
                  <option value="contractor_agreement">Contractor agreement</option><option value="w9">W-9</option>
                </select>
                <Textarea maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should they fix? (Don't include ID or tax numbers.)" data-testid="input-redo-note" />
                <Button variant="outline" disabled={!note.trim() || submit.isPending} onClick={() => submit.mutate({ decision: "request_changes", step, note })} data-testid="button-request-changes">Request changes</Button>
              </div>
            )}
            {data.verified && <Badge>Verified</Badge>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
