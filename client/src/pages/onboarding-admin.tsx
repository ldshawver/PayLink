import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  UserPlus, Search, Copy, RefreshCw, CheckCircle2, Clock, XCircle,
  ChevronRight, FileText, AlertTriangle, Eye, ThumbsUp, ThumbsDown,
  ClipboardList, Activity
} from "lucide-react";

type WorkerOnboarding = {
  id: string;
  companyId: string;
  workerId: string;
  packageKey: string;
  status: string;
  inviteEmail: string | null;
  inviteExpiresAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

type OnboardingStep = {
  id: string;
  onboardingId: string;
  stepKey: string;
  stepTitle: string;
  stepType: string;
  sequence: number;
  status: string;
  isRequired: boolean;
  completedAt: string | null;
};

type AgreementTemplate = {
  id: string;
  templateName: string;
  templateKey: string;
};

type Worker = {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  workerGroup: string;
};

function statusBadge(status: string) {
  const map: Record<string, { label: string; color: string }> = {
    pending: { label: "Pending", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
    invited: { label: "Invited", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
    in_progress: { label: "In Progress", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300" },
    submitted: { label: "Submitted", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
    approved: { label: "Approved", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
    rejected: { label: "Rejected", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  };
  const s = map[status] || { label: status, color: "bg-muted text-muted-foreground" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.color}`}>{s.label}</span>;
}

function stepIcon(status: string) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === "skipped") return <XCircle className="h-4 w-4 text-muted-foreground" />;
  return <Clock className="h-4 w-4 text-yellow-500" />;
}

export default function OnboardingAdminPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const companyId = user?.companyId;

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedOnboarding, setSelectedOnboarding] = useState<WorkerOnboarding | null>(null);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewAction, setReviewAction] = useState<"approve" | "reject">("approve");
  const [reviewNotes, setReviewNotes] = useState("");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState({
    workerId: "",
    packageKey: "contractor_standard",
    inviteEmail: "",
    agreementTemplateId: "",
  });

  const { data: onboardings = [], isLoading } = useQuery<WorkerOnboarding[]>({
    queryKey: ["/api/worker-onboarding", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const res = await fetch(`/api/worker-onboarding?companyId=${companyId}`);
      return res.json();
    },
    enabled: !!companyId,
  });

  const { data: workers = [] } = useQuery<Worker[]>({
    queryKey: ["/api/workers", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const res = await fetch(`/api/workers?companyId=${companyId}`);
      return res.json();
    },
    enabled: !!companyId,
  });

  const { data: templates = [] } = useQuery<AgreementTemplate[]>({
    queryKey: ["/api/agreement-templates", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/agreement-templates${companyId ? `?companyId=${companyId}` : ""}`);
      return res.json();
    },
    enabled: !!user,
  });

  const { data: selectedSteps = [] } = useQuery<OnboardingStep[]>({
    queryKey: ["/api/worker-onboarding", selectedOnboarding?.id, "steps"],
    queryFn: async () => {
      const res = await fetch(`/api/worker-onboarding/${selectedOnboarding!.id}/steps`);
      return res.json();
    },
    enabled: !!selectedOnboarding,
  });

  const createOnboarding = useMutation({
    mutationFn: (data: typeof createForm) =>
      apiRequest("POST", "/api/worker-onboarding", { ...data, companyId }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-onboarding"] });
      setShowCreate(false);
      resetCreateForm();
      const portalUrl = `${window.location.origin}/onboarding/${data.inviteToken}`;
      toast({
        title: "Onboarding created",
        description: `Portal link copied to clipboard.`,
      });
      navigator.clipboard.writeText(portalUrl).catch(() => {});
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const regenerateToken = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/worker-onboarding/${id}/regenerate-token`),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-onboarding"] });
      const portalUrl = `${window.location.origin}/onboarding/${data.inviteToken}`;
      navigator.clipboard.writeText(portalUrl).catch(() => {});
      setCopiedToken(data.inviteToken);
      toast({ title: "New invite link generated and copied to clipboard" });
      setTimeout(() => setCopiedToken(null), 3000);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reviewOnboarding = useMutation({
    mutationFn: ({ id, action, notes }: { id: string; action: string; notes: string }) =>
      apiRequest("POST", `/api/worker-onboarding/${id}/review`, { action, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-onboarding"] });
      setShowReviewDialog(false);
      setReviewNotes("");
      setSelectedOnboarding(null);
      toast({ title: `Onboarding ${reviewAction === "approve" ? "approved" : "rejected"}` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function resetCreateForm() {
    setCreateForm({ workerId: "", packageKey: "contractor_standard", inviteEmail: "", agreementTemplateId: "" });
  }

  const filtered = onboardings.filter(o => {
    const matchStatus = statusFilter === "all" || o.status === statusFilter;
    const matchSearch = !search ||
      o.workerId.toLowerCase().includes(search.toLowerCase()) ||
      o.packageKey.toLowerCase().includes(search.toLowerCase()) ||
      (o.inviteEmail || "").toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  function getWorkerName(workerId: string) {
    const w = workers.find(w => w.id === workerId);
    return w ? `${w.firstName} ${w.lastName} (${w.employeeNumber})` : workerId;
  }

  function buildPortalUrl(token?: string) {
    return token ? `${window.location.origin}/onboarding/${token}` : "";
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Contractor Onboarding</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage contractor onboarding packets and review submissions</p>
        </div>
        <Button data-testid="button-create-onboarding" onClick={() => { resetCreateForm(); setShowCreate(true); }}>
          <UserPlus className="h-4 w-4 mr-2" /> New Onboarding
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input data-testid="input-search-onboarding" placeholder="Search by worker, email…"
            value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" data-testid="select-status-filter"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="invited">Invited</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total", value: onboardings.length, color: "text-foreground" },
          { label: "In Progress", value: onboardings.filter(o => o.status === "in_progress" || o.status === "invited").length, color: "text-blue-600" },
          { label: "Submitted", value: onboardings.filter(o => o.status === "submitted").length, color: "text-purple-600" },
          { label: "Approved", value: onboardings.filter(o => o.status === "approved").length, color: "text-green-600" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="py-4 text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* List */}
      <div className="space-y-3">
        {isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
        {!isLoading && filtered.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-30" />
              No onboarding records found.
            </CardContent>
          </Card>
        )}
        {filtered.map(o => (
          <Card key={o.id} data-testid={`card-onboarding-${o.id}`} className="border border-border">
            <CardContent className="py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{getWorkerName(o.workerId)}</span>
                    {statusBadge(o.status)}
                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded capitalize">{o.packageKey.replace(/_/g, " ")}</span>
                  </div>
                  {o.inviteEmail && (
                    <p className="text-xs text-muted-foreground">{o.inviteEmail}</p>
                  )}
                  <p className="text-xs text-muted-foreground">Created {new Date(o.createdAt).toLocaleDateString()}{o.submittedAt ? ` · Submitted ${new Date(o.submittedAt).toLocaleDateString()}` : ""}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {o.status === "submitted" && (
                    <Button size="sm" variant="outline" className="text-purple-700 border-purple-300"
                      data-testid={`button-review-${o.id}`}
                      onClick={() => { setSelectedOnboarding(o); setShowReviewDialog(true); setReviewAction("approve"); setReviewNotes(""); }}>
                      <ThumbsUp className="h-3.5 w-3.5 mr-1" /> Review
                    </Button>
                  )}
                  <Button size="sm" variant="outline"
                    data-testid={`button-view-${o.id}`}
                    onClick={() => setSelectedOnboarding(selectedOnboarding?.id === o.id ? null : o)}>
                    <Eye className="h-3.5 w-3.5 mr-1" /> {selectedOnboarding?.id === o.id ? "Close" : "View"}
                  </Button>
                  {(o.status === "pending" || o.status === "invited" || o.status === "in_progress") && (
                    <Button size="sm" variant="outline"
                      data-testid={`button-regen-${o.id}`}
                      onClick={() => regenerateToken.mutate(o.id)}
                      disabled={regenerateToken.isPending}>
                      <RefreshCw className="h-3.5 w-3.5 mr-1" /> New Link
                    </Button>
                  )}
                </div>
              </div>

              {/* Expanded detail */}
              {selectedOnboarding?.id === o.id && (
                <div className="mt-4 pt-4 border-t border-border space-y-4">
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Steps</h4>
                    <div className="space-y-1">
                      {selectedSteps.length === 0 && <p className="text-xs text-muted-foreground">No steps found.</p>}
                      {selectedSteps.map(s => (
                        <div key={s.id} className="flex items-center gap-2 text-sm">
                          {stepIcon(s.status)}
                          <span className={s.status === "completed" ? "line-through text-muted-foreground" : ""}>{s.stepTitle}</span>
                          {s.isRequired && <span className="text-xs text-muted-foreground">(required)</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                  {o.reviewNotes && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Review Notes</h4>
                      <p className="text-sm text-muted-foreground bg-muted rounded p-2">{o.reviewNotes}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── CREATE DIALOG ─────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Start Contractor Onboarding</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Worker *</Label>
              <Select value={createForm.workerId} onValueChange={v => setCreateForm(f => ({ ...f, workerId: v }))}>
                <SelectTrigger data-testid="select-worker"><SelectValue placeholder="Select worker…" /></SelectTrigger>
                <SelectContent>
                  {workers.filter(w => w.workerGroup === "contractor" || w.workerGroup === "1099_contractor" || w.workerGroup === "independent_contractor").map(w => (
                    <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName} ({w.employeeNumber})</SelectItem>
                  ))}
                  {workers.filter(w => !["contractor", "1099_contractor", "independent_contractor"].includes(w.workerGroup || "")).map(w => (
                    <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName} ({w.employeeNumber}) — {w.workerGroup}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Onboarding Package</Label>
              <Select value={createForm.packageKey} onValueChange={v => setCreateForm(f => ({ ...f, packageKey: v }))}>
                <SelectTrigger data-testid="select-package"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contractor_standard">Standard Contractor</SelectItem>
                  <SelectItem value="contractor_1099">1099 Contractor</SelectItem>
                  <SelectItem value="employee_new_hire">Employee New Hire</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Agreement Template (optional)</Label>
              <Select value={createForm.agreementTemplateId} onValueChange={v => setCreateForm(f => ({ ...f, agreementTemplateId: v }))}>
                <SelectTrigger data-testid="select-agreement-template"><SelectValue placeholder="Use default template…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Use default</SelectItem>
                  {templates.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.templateName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Invite Email (optional)</Label>
              <Input data-testid="input-invite-email" type="email" placeholder="contractor@example.com"
                value={createForm.inviteEmail}
                onChange={e => setCreateForm(f => ({ ...f, inviteEmail: e.target.value }))} />
              <p className="text-xs text-muted-foreground">The portal link will be generated — copy it to share manually.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button data-testid="button-submit-create-onboarding"
              onClick={() => createOnboarding.mutate(createForm)}
              disabled={createOnboarding.isPending || !createForm.workerId}>
              {createOnboarding.isPending ? "Creating…" : "Create & Generate Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── REVIEW DIALOG ─────────────────────────────────────────── */}
      <Dialog open={showReviewDialog} onOpenChange={open => { if (!open) { setShowReviewDialog(false); setReviewNotes(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Onboarding Submission</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Decision</Label>
              <div className="flex gap-3">
                <Button size="sm" variant={reviewAction === "approve" ? "default" : "outline"}
                  data-testid="button-approve-action"
                  onClick={() => setReviewAction("approve")}>
                  <ThumbsUp className="h-4 w-4 mr-1" /> Approve
                </Button>
                <Button size="sm" variant={reviewAction === "reject" ? "destructive" : "outline"}
                  data-testid="button-reject-action"
                  onClick={() => setReviewAction("reject")}>
                  <ThumbsDown className="h-4 w-4 mr-1" /> Reject
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea data-testid="input-review-notes" value={reviewNotes}
                onChange={e => setReviewNotes(e.target.value)}
                placeholder="Add review notes or feedback for the contractor…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReviewDialog(false)}>Cancel</Button>
            <Button
              variant={reviewAction === "approve" ? "default" : "destructive"}
              data-testid="button-submit-review"
              onClick={() => selectedOnboarding && reviewOnboarding.mutate({
                id: selectedOnboarding.id, action: reviewAction, notes: reviewNotes,
              })}
              disabled={reviewOnboarding.isPending}>
              {reviewOnboarding.isPending ? "Submitting…" : reviewAction === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
