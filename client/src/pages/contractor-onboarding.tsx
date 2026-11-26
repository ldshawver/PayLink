import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getCsrfToken, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EsignTemplatesCard } from "@/components/contractor-onboarding/esign-templates-card";
import { FileSignature, Loader2, Mail, UserPlus } from "lucide-react";

type Step = { key: string; title: string; status: string; assignedToRole: string };
type Row = {
  workerId: string; onboardingId: string; firstName: string; lastName: string; email: string | null;
  employeeNumber: string | null; status: string; createdAt: string; steps: Step[];
};

const STATUS_LABEL: Record<string, string> = {
  invite_pending: "Invitation not sent",
  invite_sending: "Sending invitation…",
  invite_failed: "Invitation failed — retry",
  invited: "Invited",
  in_progress: "In progress",
  in_review: "Awaiting review",
  verified: "Verified",
};

/**
 * Contractor onboarding (PR 1): an administrator adds a contractor with just
 * first name, last name and email. The company is the administrator's own and
 * the employee number is assigned by the server. Later PRs add the invitation,
 * agreement, ID, W-9 and review steps shown in the checklist.
 */
export default function ContractorOnboardingPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "" });
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<Row[]>({ queryKey: ["/api/contractor-onboarding"] });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/contractor-onboarding", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfToken() ?? "" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Could not add the contractor.");
      return body as { employeeNumber: string };
    },
    onSuccess: (r) => {
      setError(null);
      setForm({ firstName: "", lastName: "", email: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-onboarding"] });
      toast({ title: "Contractor added", description: `Employee number ${r.employeeNumber}. No email has been sent yet.` });
    },
    onError: (e: Error) => setError(e.message),
  });

  const invite = useMutation({
    mutationFn: async (onboardingId: string) => {
      const res = await fetch(`/api/contractor-onboarding/${encodeURIComponent(onboardingId)}/invite`, {
        method: "POST", credentials: "include", headers: { "x-csrf-token": getCsrfToken() ?? "" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Could not send the invitation.");
      return body as { outcome: "sent" | "already_sent" | "in_progress" };
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-onboarding"] });
      toast({
        title: r.outcome === "sent" ? "Invitation sent" : r.outcome === "already_sent" ? "Invitation already sent" : "Invitation is being sent",
        description: r.outcome === "sent" ? "The link expires in 7 days and works once." : "No second email was sent.",
      });
    },
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-onboarding"] });
      toast({ title: "Invitation not sent", description: e.message, variant: "destructive" });
    },
  });

  const { data: esignState } = useQuery<Record<string, Partial<Record<"contractor_agreement" | "w9", string>>>>({
    queryKey: ["/api/contractor-onboarding/esign-state"],
  });
  const esign = useMutation({
    mutationFn: async ({ onboardingId, kind }: { onboardingId: string; kind: "contractor_agreement" | "w9" }) => {
      const res = await fetch(`/api/contractor-onboarding/${encodeURIComponent(onboardingId)}/esign/${kind}`, {
        method: "POST", credentials: "include", headers: { "x-csrf-token": getCsrfToken() ?? "" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Could not send the document.");
      return body as { outcome: "sent" | "already_sent" | "in_progress" };
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-onboarding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-onboarding/esign-state"] });
      toast({ title: r.outcome === "sent" ? "Sent for signature" : "Already sent", description: r.outcome === "sent" ? "Documenso emailed the contractor a signing link." : "No second document was created." });
    },
    onError: (e: Error) => toast({ title: "Document not sent", description: e.message, variant: "destructive" }),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (create.isPending) return;
    create.mutate();
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Contractor onboarding</h1>
        <p className="text-sm text-muted-foreground">
          Add a contractor, then track each required step. Contractors cannot bid or submit proposals until onboarding is verified.
        </p>
      </div>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a contractor</CardTitle>
            <CardDescription>They are added to your company and get the next employee number automatically.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="co-first">First name</Label>
                <Input id="co-first" autoComplete="off" maxLength={100} value={form.firstName} data-testid="input-first-name"
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="co-last">Last name</Label>
                <Input id="co-last" autoComplete="off" maxLength={100} value={form.lastName} data-testid="input-last-name"
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="co-email">Email</Label>
                <Input id="co-email" type="email" autoComplete="off" maxLength={254} value={form.email} data-testid="input-email"
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              {error && <p role="alert" className="sm:col-span-3 text-sm text-destructive" data-testid="text-create-error">{error}</p>}
              <div className="sm:col-span-3">
                <Button type="submit" disabled={create.isPending} data-testid="button-add-contractor">
                  {create.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
                  Add contractor
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Onboarding</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : !data?.length ? (
            <p className="text-sm text-muted-foreground" data-testid="text-empty">No contractors are being onboarded.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Checklist</TableHead>{isAdmin && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((r) => {
                    const done = r.steps.filter((s) => s.status === "completed").length;
                    return (
                      <TableRow key={r.onboardingId} data-testid={`row-onboarding-${r.onboardingId}`}>
                        <TableCell className="font-mono">{r.employeeNumber}</TableCell>
                        <TableCell>{r.firstName} {r.lastName}<div className="text-xs text-muted-foreground">{r.email}</div></TableCell>
                        <TableCell><Badge variant="secondary">{STATUS_LABEL[r.status] ?? r.status}</Badge></TableCell>
                        <TableCell>
                          <span className="text-sm">{done} of {r.steps.length} complete</span>
                          <ul className="mt-1 text-xs text-muted-foreground space-y-0.5">
                            {r.steps.filter((s) => s.status !== "completed").map((s) => <li key={s.key}>• {s.title}</li>)}
                          </ul>
                        </TableCell>
                        {isAdmin && (
                          <TableCell>
                            {["invite_pending", "invite_failed", "invited"].includes(r.status) && (
                              <Button size="sm" variant="outline" disabled={invite.isPending} data-testid={`button-invite-${r.onboardingId}`}
                                onClick={() => invite.mutate(r.onboardingId)}>
                                <Mail className="h-4 w-4 mr-1.5" />{r.status === "invited" ? "Resend" : "Send invitation"}
                              </Button>
                            )}
                            {r.steps.some((s) => s.key === "account_setup" && s.status === "completed") && (
                              <div className="flex flex-col gap-1.5">
                                {([["contractor_agreement", "Agreement"], ["w9", "W-9"]] as const).map(([kind, label]) => {
                                  const st = esignState?.[r.onboardingId]?.[kind];
                                  const stepDone = r.steps.some((s) => s.key === kind && s.status === "completed");
                                  if (stepDone) return <span key={kind} className="text-xs text-muted-foreground">{label}: signed</span>;
                                  if (st) return <span key={kind} className="text-xs text-muted-foreground" data-testid={`text-esign-${kind}-${r.onboardingId}`}>{label}: {st === "creating" ? "sending…" : "sent"}</span>;
                                  return (
                                    <Button key={kind} size="sm" variant="outline" disabled={esign.isPending}
                                      data-testid={`button-esign-${kind}-${r.onboardingId}`}
                                      onClick={() => esign.mutate({ onboardingId: r.onboardingId, kind })}>
                                      <FileSignature className="h-4 w-4 mr-1.5" />Send {label}
                                    </Button>
                                  );
                                })}
                              </div>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {isAdmin && <EsignTemplatesCard />}
    </div>
  );
}
