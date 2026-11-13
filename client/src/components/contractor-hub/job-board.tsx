/**
 * Contractor Hub — Jobs section (job board UI, Phase 3).
 *
 * Administrators/managers publish postings and review/award bids; eligible
 * contractors browse postings and manage their own bids. All authorization is
 * server-side (server/contractor-jobs/service.ts); this view only mirrors the
 * state machines so it offers the actions the server would accept.
 *
 * Every mutation goes through jobSend(), which always echoes the CSRF cookie —
 * including multipart uploads and the award call (which also carries an
 * Idempotency-Key that is reused on retry so a double-click or network retry
 * cannot create a second proposal).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, getCsrfToken, API_BASE_URL } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  Briefcase, Plus, Search, Paperclip, Download, X, Loader2, Send, Pause, Play, Lock, Archive,
  Award, Star, RotateCcw, Ban, MessageCircle, UserPlus, History, Clock, AlertCircle, FileText, Edit,
  ChevronLeft, ChevronRight, Upload, Eye, CheckCircle,
} from "lucide-react";
import {
  ACTIVE_BID_STATUSES, AWARDED_STATUSES, BID_REVIEW_FROM, BID_STATUS_LABEL, BidForm, BidStatus,
  CLOSING_SOON_MS, CONTRACTOR_EDITABLE, CONTRACTOR_WITHDRAWABLE, EMPTY_FILTERS, FREQUENCY_LABEL, JOB_ADMIN_ROLES,
  JobAttachment, JobBid, JobBoardNavigate, JobEvent, JobFilters, JobInvitation,
  JobPost, JobQuestion, LOCATION_LABEL, POST_ACTIONS, POST_STATUS_LABEL, PostForm,
  PostStatus, applyJobFilters, bidFormFrom, bidPayload, budgetLabel, canDo,
  closingSoon, formFromPost, jobBoardViewsFor, money, postBadges, postPayload,
  toLocalInput,
} from "@/lib/job-board";
export { jobBoardViewsFor } from "@/lib/job-board";
export type { JobBoardNavigate } from "@/lib/job-board";


// ─── Transport ───────────────────────────────────────────────────────────────

export class JobBoardError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function readError(res: Response): Promise<JobBoardError> {
  let message = res.statusText || "Request failed";
  try {
    const body = await res.json();
    if (typeof body?.message === "string") message = body.message;
  } catch { /* non-JSON */ }
  return new JobBoardError(res.status, message);
}

export async function jobGet<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${url}`, { credentials: "include", cache: "no-store" });
  } catch {
    throw new JobBoardError(0, "Network error: PayLink could not reach the server.");
  }
  if (!res.ok) throw await readError(res);
  return res.json();
}

/** Every job-board mutation: CSRF header always, JSON or multipart body, optional extra headers. */
export async function jobSend<T = any>(
  method: "POST" | "PATCH",
  url: string,
  opts: { json?: unknown; form?: FormData; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const csrf = getCsrfToken();
  if (csrf) headers["x-csrf-token"] = csrf;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.json); }
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${url}`, { method, headers, body, credentials: "include", cache: "no-store" });
  } catch {
    throw new JobBoardError(0, "Network error: PayLink could not reach the server.");
  }
  if (!res.ok) throw await readError(res);
  return res.json();
}

function refreshJobBoard() {
  queryClient.invalidateQueries({ queryKey: ["job-board"] });
}

function newIdempotencyKey(): string {
  try { if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID(); } catch { /* fall through */ }
  return `award-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}


// ─── Labels & formatting ─────────────────────────────────────────────────────

const BID_STATUS_TONE: Record<BidStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  under_review: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300",
  shortlisted: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  revision_requested: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  withdrawn: "bg-muted text-muted-foreground",
  awarded: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  converted_to_proposal: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  converted_to_contract: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
};
function dateLabel(v?: string | null) {
  if (!v) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function dateTimeLabel(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
function fileSize(n?: number) {
  if (!n) return "";
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}


function PostBadges({ post }: { post: JobPost }) {
  return (
    <div className="flex flex-wrap gap-1">
      {postBadges(post).map((b) => (
        <span key={b.label} className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", b.className)}>{b.label}</span>
      ))}
    </div>
  );
}

function BidStatusBadge({ status }: { status: BidStatus }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", BID_STATUS_TONE[status])} data-testid={`badge-bid-status-${status}`}>{BID_STATUS_LABEL[status] ?? status}</span>;
}

function capacityLabel(p: JobPost) {
  const max = p.maximumAwards ?? (p.workType === "one_time" ? 1 : null);
  const made = p.awardsMade ?? 0;
  return max == null ? `${made} awarded · unlimited` : `${made} of ${max} awarded`;
}

function TextBlock({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function AttachmentList({ items, onRemove }: { items: JobAttachment[]; onRemove?: (id: string) => void }) {
  if (!items.length) return <p className="text-xs text-muted-foreground">No files attached.</p>;
  return (
    <ul className="space-y-1">
      {items.map((a) => (
        <li key={a.id} className="flex items-center gap-2 text-sm">
          <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <a className="truncate hover:underline" href={`${API_BASE_URL}/api/contractor-job-attachments/${a.id}/download`} data-testid={`link-job-attachment-${a.id}`}>{a.fileName}</a>
          <span className="text-xs text-muted-foreground shrink-0">{fileSize(a.fileSize)}</span>
          <a href={`${API_BASE_URL}/api/contractor-job-attachments/${a.id}/download`} aria-label={`Download ${a.fileName}`} className="ml-auto text-muted-foreground hover:text-foreground">
            <Download className="h-3.5 w-3.5" />
          </a>
          {onRemove && (
            <button type="button" aria-label={`Remove ${a.fileName}`} className="text-muted-foreground hover:text-destructive" onClick={() => onRemove(a.id)}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function UploadButton({ label, onFile, disabled }: { label: string; onFile: (f: File) => Promise<void>; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input ref={ref} type="file" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        setBusy(true);
        try { await onFile(f); } finally { setBusy(false); }
      }} />
      <Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => ref.current?.click()}>
        {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}{label}
      </Button>
    </>
  );
}

function useUpload(urlFor: () => string) {
  const { toast } = useToast();
  return async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      await jobSend("POST", urlFor(), { form: fd });
      refreshJobBoard();
      toast({ title: "File attached" });
    } catch (e: any) {
      toast({ title: e?.message || "Upload failed", variant: "destructive" });
    }
  };
}

function useRemoveAttachment() {
  const { toast } = useToast();
  return async (id: string) => {
    try {
      await jobSend("POST", `/api/contractor-job-attachments/${id}/remove`);
      refreshJobBoard();
    } catch (e: any) {
      toast({ title: e?.message || "Could not remove file", variant: "destructive" });
    }
  };
}

/** Friendly states for feature-off (503), no access (401/403) and other load errors. */
function LoadProblem({ error }: { error: unknown }) {
  const status = error instanceof JobBoardError ? error.status : 0;
  const message = error instanceof Error ? error.message : "Could not load jobs.";
  if (status === 503) {
    return (
      <Card data-testid="card-job-board-disabled">
        <CardContent className="py-10 text-center space-y-1">
          <Briefcase className="h-8 w-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm font-medium">The job board isn't enabled yet</p>
          <p className="text-xs text-muted-foreground">Your administrator will turn it on once it's ready for your company.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-destructive/30" data-testid="card-job-board-error">
      <CardContent className="py-6 flex items-start gap-2 text-sm">
        <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
        <span>{status === 401 || status === 403 ? "You don't have access to the job board." : message}</span>
      </CardContent>
    </Card>
  );
}


function FilterBar({ value, onChange }: { value: JobFilters; onChange: (f: JobFilters) => void }) {
  const set = <K extends keyof JobFilters>(k: K, v: JobFilters[K]) => onChange({ ...value, [k]: v });
  const active = JSON.stringify(value) !== JSON.stringify(EMPTY_FILTERS);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8 h-9" placeholder="Search jobs" value={value.search} onChange={(e) => set("search", e.target.value)} data-testid="input-job-search" />
      </div>
      <Select value={value.workType} onValueChange={(v) => set("workType", v as JobFilters["workType"])}>
        <SelectTrigger className="h-9 w-[140px]" data-testid="select-job-filter-worktype"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All work types</SelectItem>
          <SelectItem value="one_time">One-time</SelectItem>
          <SelectItem value="recurring">Recurring</SelectItem>
        </SelectContent>
      </Select>
      <Select value={value.location} onValueChange={(v) => set("location", v as JobFilters["location"])}>
        <SelectTrigger className="h-9 w-[140px]" data-testid="select-job-filter-location"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any location</SelectItem>
          <SelectItem value="onsite">On-site</SelectItem>
          <SelectItem value="remote">Remote</SelectItem>
          <SelectItem value="hybrid">Hybrid</SelectItem>
        </SelectContent>
      </Select>
      <Select value={value.budget} onValueChange={(v) => set("budget", v as JobFilters["budget"])}>
        <SelectTrigger className="h-9 w-[150px]" data-testid="select-job-filter-budget"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any budget</SelectItem>
          <SelectItem value="stated">Budget stated</SelectItem>
          <SelectItem value="quote">Quote / undisclosed</SelectItem>
        </SelectContent>
      </Select>
      <Select value={value.deadline} onValueChange={(v) => set("deadline", v as JobFilters["deadline"])}>
        <SelectTrigger className="h-9 w-[150px]" data-testid="select-job-filter-deadline"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any deadline</SelectItem>
          <SelectItem value="soon">Closing soon</SelectItem>
          <SelectItem value="none">No deadline</SelectItem>
        </SelectContent>
      </Select>
      {active && <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>Clear</Button>}
    </div>
  );
}

function PostCard({ post, onOpen, footer }: { post: JobPost; onOpen: () => void; footer?: React.ReactNode }) {
  return (
    <button type="button" onClick={onOpen} className="w-full text-left" data-testid={`card-job-${post.id}`}>
      <Card className="hover:border-primary/40 transition-colors">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium truncate">{post.title}</p>
              {post.summary && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{post.summary}</p>}
            </div>
            <p className="text-sm font-semibold shrink-0">{budgetLabel(post)}</p>
          </div>
          <PostBadges post={post} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{LOCATION_LABEL[post.locationType]}{post.locationText ? ` · ${post.locationText}` : ""}</span>
            {post.submissionDeadline && <span>Bids due {dateTimeLabel(post.submissionDeadline)}</span>}
            {post.estimatedStartDate && <span>Starts {dateLabel(post.estimatedStartDate)}</span>}
          </div>
          {footer}
        </CardContent>
      </Card>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Section entry
// ═══════════════════════════════════════════════════════════════════════════

export function JobBoardSection({ user, initialJobId, onNavigate }: {
  user: any;
  initialJobId?: string | null;
  onNavigate: JobBoardNavigate;
}) {
  const { canManage, canBid } = jobBoardViewsFor(user);
  const [view, setView] = useState<"admin" | "contractor">(canManage ? "admin" : "contractor");
  useEffect(() => { if (!canManage && canBid) setView("contractor"); }, [canManage, canBid]);

  if (!canManage && !canBid) {
    return (
      <Card data-testid="card-job-board-no-access">
        <CardContent className="py-10 text-center space-y-1">
          <Briefcase className="h-8 w-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm font-medium">Jobs are available to contractors and company administrators</p>
          <p className="text-xs text-muted-foreground">Ask your administrator if you expected to see job postings here.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="section-jobs">
      {canManage && canBid && (
        <Tabs value={view} onValueChange={(v) => setView(v as "admin" | "contractor")}>
          <TabsList>
            <TabsTrigger value="admin" data-testid="tab-jobs-view-admin">Manage postings</TabsTrigger>
            <TabsTrigger value="contractor" data-testid="tab-jobs-view-contractor">My bids</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {view === "admin" && canManage
        ? <AdminJobBoard initialJobId={initialJobId} onNavigate={onNavigate} />
        : <ContractorJobBoard initialJobId={initialJobId} onNavigate={onNavigate} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Administrator
// ═══════════════════════════════════════════════════════════════════════════

const ADMIN_TABS: { id: PostStatus | "all"; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "published", label: "Published" },
  { id: "paused", label: "Paused" },
  { id: "closed", label: "Closed" },
  { id: "archived", label: "Archived" },
];

function companyQs(companyId: string | null, first = true) {
  return companyId ? `${first ? "?" : "&"}companyId=${encodeURIComponent(companyId)}` : "";
}

function AdminJobBoard({ initialJobId, onNavigate }: { initialJobId?: string | null; onNavigate: JobBoardNavigate }) {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [tab, setTab] = useState<PostStatus>("published");
  const [filters, setFilters] = useState<JobFilters>(EMPTY_FILTERS);
  const [openId, setOpenId] = useState<string | null>(initialJobId ?? null);
  const [editor, setEditor] = useState<{ post: JobPost | null } | null>(null);
  useEffect(() => { if (initialJobId) setOpenId(initialJobId); }, [initialJobId]);

  // Every status in one request so tab counts are accurate; the server excludes
  // archived unless status=all, so archived is fetched with "all".
  const list = useQuery<JobPost[], JobBoardError>({
    queryKey: ["job-board", "admin-list", companyId],
    queryFn: () => jobGet<JobPost[]>(`/api/contractor-jobs?status=all${companyQs(companyId, false)}`),
  });
  const needsCompany = list.error?.status === 400;
  const companies = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/companies"],
    queryFn: () => jobGet<{ id: string; name: string }[]>("/api/companies"),
    enabled: needsCompany || !!companyId,
  });

  const posts = list.data ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of posts) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [posts]);
  const visible = applyJobFilters(posts.filter((p) => p.status === tab), filters);

  const companyPicker = (needsCompany || companyId) && (companies.data?.length ?? 0) > 0 && (
    <Select value={companyId ?? ""} onValueChange={(v) => setCompanyId(v)}>
      <SelectTrigger className="h-9 w-[220px]" data-testid="select-job-company"><SelectValue placeholder="Choose a company" /></SelectTrigger>
      <SelectContent>
        {companies.data!.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-4">
      <JobBoardSummaryCard mode="admin" companyId={companyId} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {companyPicker}
          <FilterBar value={filters} onChange={setFilters} />
        </div>
        <Button onClick={() => setEditor({ post: null })} disabled={needsCompany && !companyId} data-testid="btn-new-job">
          <Plus className="h-4 w-4 mr-1" />New job
        </Button>
      </div>

      {list.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : list.error && !needsCompany ? (
        <LoadProblem error={list.error} />
      ) : needsCompany && !companyId ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Choose a company to manage its job postings.</CardContent></Card>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as PostStatus)}>
          <TabsList className="flex-wrap h-auto">
            {ADMIN_TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} data-testid={`tab-jobs-${t.id}`}>
                {t.label}{counts[t.id] ? <span className="ml-1.5 text-xs text-muted-foreground">{counts[t.id]}</span> : null}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="mt-3 space-y-2">
            {visible.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
                {posts.length === 0 ? "No job postings yet. Create one to start collecting bids." : `No ${POST_STATUS_LABEL[tab].toLowerCase()} postings${JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS) ? " match these filters" : ""}.`}
              </CardContent></Card>
            ) : visible.map((p) => (
              <PostCard key={p.id} post={p} onOpen={() => setOpenId(p.id)} footer={
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-1 border-t">
                  <span><strong>{p.bidCounts?.total ?? 0}</strong> bids</span>
                  {(p.bidCounts?.awaitingReview ?? 0) > 0 && <span className="text-blue-700 dark:text-blue-300"><strong>{p.bidCounts!.awaitingReview}</strong> awaiting review</span>}
                  {(p.bidCounts?.shortlisted ?? 0) > 0 && <span><strong>{p.bidCounts!.shortlisted}</strong> shortlisted</span>}
                  <span className="text-muted-foreground">{capacityLabel(p)}</span>
                </div>
              } />
            ))}
          </div>
        </Tabs>
      )}

      {openId && (
        <AdminPostSheet postId={openId} onClose={() => setOpenId(null)} onEdit={(p) => setEditor({ post: p })} onNavigate={onNavigate} />
      )}
      {editor && (
        <PostEditorDialog
          post={editor.post}
          companyId={companyId}
          onClose={() => setEditor(null)}
          onSaved={(p) => { setEditor(null); setTab(p.status); setOpenId(p.id); }}
        />
      )}
    </div>
  );
}


const WIZARD_STEPS = ["Details", "Location & schedule", "Budget & audience"] as const;

function PostEditorDialog({ post, companyId, onClose, onSaved }: {
  post: JobPost | null; companyId: string | null; onClose: () => void; onSaved: (p: JobPost) => void;
}) {
  const { toast } = useToast();
  const initial = useMemo(() => (post ? formFromPost(post) : null), [post]);
  const [form, setForm] = useState<PostForm>(() => formFromPost(post));
  const [step, setStep] = useState(0);
  const set = <K extends keyof PostForm>(k: K, v: PostForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const isPublished = post?.status === "published";

  const save = useMutation({
    mutationFn: async () => {
      const payload = postPayload(form, initial);
      if (post) {
        if (!Object.keys(payload).length) return post;
        return jobSend<JobPost>("PATCH", `/api/contractor-jobs/${post.id}`, { json: payload });
      }
      return jobSend<JobPost>("POST", "/api/contractor-jobs", { json: { ...payload, ...(companyId ? { companyId } : {}) } });
    },
    onSuccess: (p) => {
      refreshJobBoard();
      toast({ title: post ? "Posting updated" : "Draft posting created", description: post ? undefined : "Publish it when you're ready for bids." });
      onSaved(p);
    },
    onError: (e: any) => toast({ title: e?.message || "Could not save posting", variant: "destructive" }),
  });

  const stepValid = step === 0 ? form.title.trim().length > 0 : true;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-job-editor">
        <DialogHeader>
          <DialogTitle>{post ? "Edit posting" : "New job posting"}</DialogTitle>
          <DialogDescription>Step {step + 1} of {WIZARD_STEPS.length}: {WIZARD_STEPS[step]}</DialogDescription>
        </DialogHeader>
        {isPublished && (
          <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-2.5 text-xs">
            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>This posting is live. Changes to scope, schedule, budget or award limit are recorded and contractors who already bid are notified.</span>
          </div>
        )}

        {step === 0 && (
          <div className="space-y-3">
            <div><Label>Title *</Label><Input value={form.title} maxLength={200} onChange={(e) => set("title", e.target.value)} data-testid="input-job-title" /></div>
            <div><Label>Summary</Label><Textarea rows={2} value={form.summary} onChange={(e) => set("summary", e.target.value)} placeholder="One or two sentences contractors see in the list" data-testid="input-job-summary" /></div>
            <div><Label>Scope of work</Label><Textarea rows={5} value={form.scopeOfWork} onChange={(e) => set("scopeOfWork", e.target.value)} data-testid="input-job-scope" /></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label>Requirements</Label><Textarea rows={3} value={form.requirements} onChange={(e) => set("requirements", e.target.value)} /></div>
              <div><Label>Deliverables</Label><Textarea rows={3} value={form.deliverables} onChange={(e) => set("deliverables", e.target.value)} /></div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>Location</Label>
                <Select value={form.locationType} onValueChange={(v) => set("locationType", v)}>
                  <SelectTrigger data-testid="select-job-location"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="onsite">On-site</SelectItem>
                    <SelectItem value="remote">Remote</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Location details</Label><Input value={form.locationText} onChange={(e) => set("locationText", e.target.value)} placeholder="City, site or address" /></div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>Work type</Label>
                <Select value={form.workType} onValueChange={(v) => set("workType", v)}>
                  <SelectTrigger data-testid="select-job-worktype"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_time">One-time — closes when awarded</SelectItem>
                    <SelectItem value="recurring">Recurring — stays open after awards</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.workType === "recurring" && (
                <div>
                  <Label>Frequency *</Label>
                  <Select value={form.recurrenceFrequency} onValueChange={(v) => set("recurrenceFrequency", v)}>
                    <SelectTrigger data-testid="select-job-frequency"><SelectValue placeholder="Choose" /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(FREQUENCY_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {form.workType === "recurring" && (
              <div><Label>Recurrence details</Label><Input value={form.recurrenceDescription} onChange={(e) => set("recurrenceDescription", e.target.value)} placeholder="e.g. first Monday of each month" /></div>
            )}
            <div className="grid sm:grid-cols-3 gap-3">
              <div><Label>Estimated start</Label><Input type="date" value={form.estimatedStartDate} onChange={(e) => set("estimatedStartDate", e.target.value)} /></div>
              <div>
                <Label>{form.workType === "recurring" ? "End date (closes posting)" : "Estimated end"}</Label>
                <Input type="date" value={form.estimatedEndDate} onChange={(e) => set("estimatedEndDate", e.target.value)} data-testid="input-job-end-date" />
              </div>
              <div><Label>Bids due</Label><Input type="datetime-local" value={form.submissionDeadline} onChange={(e) => set("submissionDeadline", e.target.value)} data-testid="input-job-deadline" /></div>
            </div>
            {form.workType === "recurring" && <p className="text-xs text-muted-foreground">Leave the end date blank for an ongoing posting that stays open until you pause or close it.</p>}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <Label>Budget</Label>
                <Select value={form.budgetType} onValueChange={(v) => set("budgetType", v)}>
                  <SelectTrigger data-testid="select-job-budget-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed price</SelectItem>
                    <SelectItem value="hourly">Hourly rate</SelectItem>
                    <SelectItem value="range">Range</SelectItem>
                    <SelectItem value="contractor_quote">Contractor quotes</SelectItem>
                    <SelectItem value="undisclosed">Undisclosed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.budgetType === "range" && (
                <div><Label>Minimum *</Label><Input inputMode="decimal" value={form.budgetMin} onChange={(e) => set("budgetMin", e.target.value)} /></div>
              )}
              {["fixed", "hourly", "range"].includes(form.budgetType) && (
                <div>
                  <Label>{form.budgetType === "range" ? "Maximum *" : form.budgetType === "hourly" ? "Rate per hour *" : "Amount *"}</Label>
                  <Input inputMode="decimal" value={form.budgetMax} onChange={(e) => set("budgetMax", e.target.value)} data-testid="input-job-budget" />
                </div>
              )}
              <div><Label>Currency</Label><Input value={form.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></div>
            </div>
            <div><Label>Payment terms</Label><Input value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} placeholder="e.g. Net 30 after approved invoice" /></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>Award limit</Label>
                <Input inputMode="numeric" value={form.maximumAwards} onChange={(e) => set("maximumAwards", e.target.value.replace(/\D/g, ""))}
                  placeholder={form.workType === "one_time" ? "1 (default)" : "Unlimited"} data-testid="input-job-max-awards" />
                <p className="text-xs text-muted-foreground mt-1">The posting closes automatically when this many bids are awarded.</p>
              </div>
              <div>
                <Label>Who can see it</Label>
                <Select value={form.visibility} onValueChange={(v) => set("visibility", v)}>
                  <SelectTrigger data-testid="select-job-visibility"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_eligible">All active contractors</SelectItem>
                    <SelectItem value="selected_groups">Selected contractor groups</SelectItem>
                    <SelectItem value="invited_only">Invited contractors only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.visibility === "selected_groups" && (
              <div>
                <Label>Contractor groups *</Label>
                <Input value={form.eligibleGroups} onChange={(e) => set("eligibleGroups", e.target.value)} placeholder="hourly_contractor, invoiced_contractor" />
                <p className="text-xs text-muted-foreground mt-1">Comma-separated worker group codes.</p>
              </div>
            )}
            {form.visibility === "invited_only" && <p className="text-xs text-muted-foreground">After saving, invite contractors from the posting's Invitations tab.</p>}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)}><ChevronLeft className="h-4 w-4 mr-1" />Back</Button>}
          <div className="flex-1" />
          {step < WIZARD_STEPS.length - 1 && (
            <Button variant={post ? "outline" : "default"} disabled={!stepValid} onClick={() => setStep(step + 1)} data-testid="btn-job-editor-next">
              Next<ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
          {(post || step === WIZARD_STEPS.length - 1) && (
            <Button disabled={!form.title.trim() || save.isPending} onClick={() => save.mutate()} data-testid="btn-job-editor-save">
              {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}{post ? "Save changes" : "Save draft"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Administrator posting detail ────────────────────────────────────────────

const POST_ACTION_ICON = { publish: Send, pause: Pause, reopen: Play, close: Lock, archive: Archive } as const;

function AdminPostSheet({ postId, onClose, onEdit, onNavigate }: {
  postId: string; onClose: () => void; onEdit: (p: JobPost) => void; onNavigate: JobBoardNavigate;
}) {
  const { toast } = useToast();
  const post = useQuery<JobPost, JobBoardError>({
    queryKey: ["job-board", "post", postId],
    queryFn: () => jobGet<JobPost>(`/api/contractor-jobs/${postId}`),
  });
  const [confirm, setConfirm] = useState<null | "close" | "archive">(null);
  const transition = useMutation({
    mutationFn: (action: string) => jobSend<JobPost>("POST", `/api/contractor-jobs/${postId}/${action}`, { json: {} }),
    onSuccess: (p, action) => {
      refreshJobBoard();
      setConfirm(null);
      toast({ title: `Posting ${p.status === "published" && action === "reopen" ? "reopened" : POST_STATUS_LABEL[p.status].toLowerCase()}` });
    },
    onError: (e: any) => toast({ title: e?.message || "Action failed", variant: "destructive" }),
  });
  const upload = useUpload(() => `/api/contractor-jobs/${postId}/attachments`);
  const remove = useRemoveAttachment();

  const p = post.data;
  const editable = p && (p.status === "draft" || p.status === "paused" || p.status === "published");

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto" data-testid="sheet-job-admin">
        {!post.data && <SheetTitle className="sr-only">Job posting</SheetTitle>}
        {post.isLoading && <div className="space-y-3 mt-6"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-40 w-full" /></div>}
        {post.error && <div className="mt-6"><LoadProblem error={post.error} /></div>}
        {p && (
          <div className="space-y-4">
            <SheetHeader className="text-left space-y-2">
              <SheetTitle className="pr-8">{p.title}</SheetTitle>
              <PostBadges post={p} />
            </SheetHeader>

            <div className="flex flex-wrap gap-2">
              {editable && <Button size="sm" variant="outline" onClick={() => onEdit(p)} data-testid="btn-job-edit"><Edit className="h-3.5 w-3.5 mr-1" />Edit</Button>}
              {POST_ACTIONS.filter((a) => a.from.includes(p.status)).map((a) => {
                const Icon = POST_ACTION_ICON[a.action];
                return (
                  <Button key={a.action} size="sm" variant={a.action === "publish" || a.action === "reopen" ? "default" : "outline"}
                    disabled={transition.isPending}
                    onClick={() => (a.action === "close" || a.action === "archive") ? setConfirm(a.action) : transition.mutate(a.action)}
                    data-testid={`btn-job-${a.action}`}>
                    <Icon className="h-3.5 w-3.5 mr-1" />{a.label}
                  </Button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-md border p-3">
              <Fact label="Budget" value={budgetLabel(p)} />
              <Fact label="Awards" value={capacityLabel(p)} />
              <Fact label="Bids due" value={dateTimeLabel(p.submissionDeadline)} />
              <Fact label="Visibility" value={p.visibility === "invited_only" ? "Invited only" : p.visibility === "selected_groups" ? `Groups: ${(p.eligibleGroups ?? []).join(", ")}` : "All contractors"} />
            </div>
            {p.status === "closed" && p.closeReason && (
              <p className="text-xs text-muted-foreground">Closed {dateTimeLabel(p.closedAt)} · {p.closeReason.replace(/_/g, " ")}</p>
            )}

            <Tabs defaultValue="bids">
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="bids" data-testid="tab-job-admin-bids">Bids{p.bidCounts?.total ? ` (${p.bidCounts.total})` : ""}</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="questions" data-testid="tab-job-admin-questions">Questions</TabsTrigger>
                <TabsTrigger value="invitations" data-testid="tab-job-admin-invitations">Invitations</TabsTrigger>
                <TabsTrigger value="activity" data-testid="tab-job-admin-activity">Activity</TabsTrigger>
              </TabsList>
              <TabsContent value="bids"><AdminBidsPanel post={p} onNavigate={onNavigate} /></TabsContent>
              <TabsContent value="details" className="space-y-3">
                <PostDetailBody post={p} />
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">Attachments</p>
                    {editable && <UploadButton label="Attach file" onFile={upload} />}
                  </div>
                  <AttachmentList items={p.attachments ?? []} onRemove={editable ? remove : undefined} />
                </div>
              </TabsContent>
              <TabsContent value="questions"><AdminQuestionsPanel postId={p.id} /></TabsContent>
              <TabsContent value="invitations"><InvitationsPanel post={p} /></TabsContent>
              <TabsContent value="activity"><ActivityPanel postId={p.id} /></TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>

      {confirm && p && (
        <Dialog open onOpenChange={(o) => { if (!o) setConfirm(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirm === "close" ? "Close this posting?" : "Archive this posting?"}</DialogTitle>
              <DialogDescription>
                {confirm === "close"
                  ? "Contractors can no longer submit bids. Contractors with open bids are notified. You can reopen it later."
                  : "Archived postings are hidden from the active lists. Bids and history are kept."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button disabled={transition.isPending} onClick={() => transition.mutate(confirm)} data-testid="btn-job-confirm-transition">
                {transition.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}{confirm === "close" ? "Close posting" : "Archive"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Sheet>
  );
}

function PostDetailBody({ post }: { post: JobPost }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Fact label="Location" value={`${LOCATION_LABEL[post.locationType]}${post.locationText ? ` · ${post.locationText}` : ""}`} />
        <Fact label="Work type" value={post.workType === "recurring" ? `Recurring${post.recurrenceFrequency ? ` · ${FREQUENCY_LABEL[post.recurrenceFrequency] ?? post.recurrenceFrequency}` : ""}` : "One-time"} />
        <Fact label="Start" value={dateLabel(post.estimatedStartDate)} />
        <Fact label={post.workType === "recurring" ? "Ends" : "Est. end"} value={post.estimatedEndDate ? dateLabel(post.estimatedEndDate) : post.workType === "recurring" ? "Ongoing" : "—"} />
      </div>
      <TextBlock label="Summary" value={post.summary} />
      <TextBlock label="Scope of work" value={post.scopeOfWork} />
      <TextBlock label="Requirements" value={post.requirements} />
      <TextBlock label="Deliverables" value={post.deliverables} />
      <TextBlock label="Recurrence" value={post.recurrenceDescription} />
      <TextBlock label="Payment terms" value={post.paymentTerms} />
    </div>
  );
}

// ─── Bid comparison + review ─────────────────────────────────────────────────


function bidPrice(b: JobBid, currency = "USD") {
  if (b.rateType === "hourly" || (!b.proposedAmount && b.hourlyRate)) {
    const est = b.hourlyRate && b.estimatedHours ? ` · ≈${money(Number(b.hourlyRate) * Number(b.estimatedHours), currency)}` : "";
    return `${money(b.hourlyRate, currency)}/hr${b.estimatedHours ? ` × ${b.estimatedHours}h` : ""}${est}`;
  }
  return `${money(b.proposedAmount, currency)}${b.rateType === "recurring" ? " / period" : ""}`;
}

function AdminBidsPanel({ post, onNavigate }: { post: JobPost; onNavigate: JobBoardNavigate }) {
  const { toast } = useToast();
  const bids = useQuery<JobBid[], JobBoardError>({
    queryKey: ["job-board", "bids", post.id],
    queryFn: () => jobGet<JobBid[]>(`/api/contractor-jobs/${post.id}/bids`),
  });
  const [showClosed, setShowClosed] = useState(false);
  const [detail, setDetail] = useState<JobBid | null>(null);
  const [noteFor, setNoteFor] = useState<{ bid: JobBid; action: "request_revision" | "reject" } | null>(null);
  const [awardFor, setAwardFor] = useState<JobBid | null>(null);

  const review = useMutation({
    mutationFn: ({ bid, action, note }: { bid: JobBid; action: "review" | "shortlist" | "request_revision" | "reject"; note?: string }) =>
      jobSend<JobBid>("POST", `/api/contractor-job-bids/${bid.id}/${action.replace("_", "-")}`, { json: note ? { note } : {} }),
    onSuccess: (_b, v) => {
      refreshJobBoard();
      setNoteFor(null);
      toast({ title: { review: "Marked under review", shortlist: "Bid shortlisted", request_revision: "Revision requested", reject: "Bid declined" }[v.action] });
    },
    onError: (e: any) => toast({ title: e?.message || "Action failed", variant: "destructive" }),
  });

  const all = bids.data ?? [];
  const rows = showClosed ? all : all.filter((b) => !["withdrawn", "rejected"].includes(b.status));
  const hidden = all.length - rows.length;
  const canAwardPost = post.status === "published" || post.status === "paused";

  if (bids.isLoading) return <Skeleton className="h-32 w-full mt-3" />;
  if (bids.error) return <div className="mt-3"><LoadProblem error={bids.error} /></div>;
  if (!all.length) return <p className="text-sm text-muted-foreground py-6 text-center">No bids yet.{post.status === "draft" ? " Publish the posting so contractors can bid." : ""}</p>;

  return (
    <div className="space-y-2 mt-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{capacityLabel(post)}{post.workType === "recurring" && post.status === "published" ? " · stays open after each award" : ""}</span>
        {(hidden > 0 || showClosed) && (
          <button type="button" className="underline" onClick={() => setShowClosed(!showClosed)}>{showClosed ? "Hide declined/withdrawn" : `Show ${hidden} declined/withdrawn`}</button>
        )}
      </div>
      <div className="rounded-md border overflow-x-auto">
        <Table data-testid="table-job-bids">
          <TableHeader>
            <TableRow>
              <TableHead>Contractor</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Timeline</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b) => (
              <TableRow key={b.id} data-testid={`row-job-bid-${b.id}`}>
                <TableCell>
                  <button type="button" className="font-medium hover:underline text-left" onClick={() => setDetail(b)}>{b.contractorName || "Contractor"}</button>
                  <p className="text-xs text-muted-foreground">Rev {b.revisionNumber ?? 1} · {dateLabel(b.submittedAt)}{b.attachmentCount ? ` · ${b.attachmentCount} file${b.attachmentCount > 1 ? "s" : ""}` : ""}</p>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">{bidPrice(b, post.currency || "USD")}</TableCell>
                <TableCell className="whitespace-nowrap text-xs">{dateLabel(b.estimatedStartDate)} → {dateLabel(b.estimatedCompletionDate)}</TableCell>
                <TableCell><BidStatusBadge status={b.status} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 flex-wrap">
                    <Button size="sm" variant="ghost" onClick={() => setDetail(b)} aria-label="View bid"><Eye className="h-3.5 w-3.5" /></Button>
                    {canDo("shortlist", b.status) && b.status !== "shortlisted" && (
                      <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate({ bid: b, action: "shortlist" })} data-testid={`btn-bid-shortlist-${b.id}`}>
                        <Star className="h-3.5 w-3.5 mr-1" />Shortlist
                      </Button>
                    )}
                    {canDo("award", b.status) && canAwardPost && (
                      <Button size="sm" onClick={() => setAwardFor(b)} data-testid={`btn-bid-award-${b.id}`}><Award className="h-3.5 w-3.5 mr-1" />Award</Button>
                    )}
                    {b.convertedProposalId && (
                      <Button size="sm" variant="outline" onClick={() => onNavigate("proposals", b.convertedProposalId!)} data-testid={`btn-bid-open-proposal-${b.id}`}>
                        <FileText className="h-3.5 w-3.5 mr-1" />Proposal
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {detail && (
        <BidDetailDialog bid={all.find((b) => b.id === detail.id) ?? detail} currency={post.currency || "USD"} onClose={() => setDetail(null)}
          actions={(b) => (
            <>
              {canDo("review", b.status) && <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate({ bid: b, action: "review" })}><Eye className="h-3.5 w-3.5 mr-1" />Mark under review</Button>}
              {canDo("shortlist", b.status) && <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate({ bid: b, action: "shortlist" })}><Star className="h-3.5 w-3.5 mr-1" />Shortlist</Button>}
              {canDo("request_revision", b.status) && <Button size="sm" variant="outline" onClick={() => setNoteFor({ bid: b, action: "request_revision" })} data-testid="btn-bid-request-revision"><RotateCcw className="h-3.5 w-3.5 mr-1" />Request revision</Button>}
              {canDo("reject", b.status) && <Button size="sm" variant="outline" className="text-destructive" onClick={() => setNoteFor({ bid: b, action: "reject" })} data-testid="btn-bid-reject"><Ban className="h-3.5 w-3.5 mr-1" />Decline</Button>}
              {canDo("award", b.status) && canAwardPost && <Button size="sm" onClick={() => setAwardFor(b)}><Award className="h-3.5 w-3.5 mr-1" />Award</Button>}
            </>
          )}
        />
      )}

      {noteFor && (
        <NoteDialog
          title={noteFor.action === "reject" ? "Decline this bid?" : "Request a revision"}
          description={noteFor.action === "reject"
            ? "The contractor is told their bid was not selected. Your note is shown to them."
            : "The contractor can edit and resubmit. Your note is shown to them."}
          required={noteFor.action === "request_revision"}
          confirmLabel={noteFor.action === "reject" ? "Decline bid" : "Request revision"}
          pending={review.isPending}
          onCancel={() => setNoteFor(null)}
          onConfirm={(note) => review.mutate({ bid: noteFor.bid, action: noteFor.action, note })}
        />
      )}

      {awardFor && (
        <AwardDialog post={post} bid={awardFor} onClose={() => setAwardFor(null)}
          onAwarded={(proposalId) => { setAwardFor(null); setDetail(null); if (proposalId) onNavigate("proposals", proposalId); }} />
      )}
    </div>
  );
}

function NoteDialog({ title, description, required, confirmLabel, pending, onCancel, onConfirm }: {
  title: string; description: string; required: boolean; confirmLabel: string; pending: boolean;
  onCancel: () => void; onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <Textarea rows={4} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder={required ? "What should the contractor change?" : "Optional note"} data-testid="input-bid-review-note" />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={pending || (required && !note.trim())} onClick={() => onConfirm(note.trim())} data-testid="btn-bid-review-confirm">
            {pending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}{confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AwardDialog({ post, bid, onClose, onAwarded }: { post: JobPost; bid: JobBid; onClose: () => void; onAwarded: (proposalId: string | null) => void }) {
  const { toast } = useToast();
  // One key per dialog: a retry (double click, flaky network) replays the same award, never a second proposal.
  const [key] = useState(newIdempotencyKey);
  const max = post.maximumAwards ?? (post.workType === "one_time" ? 1 : null);
  const willClose = max != null && (post.awardsMade ?? 0) + 1 >= max;
  const award = useMutation({
    mutationFn: () => jobSend<{ replayed: boolean; proposalId: string | null; post: JobPost }>(
      "POST", `/api/contractor-job-bids/${bid.id}/award`, { json: {}, headers: { "Idempotency-Key": key } }),
    onSuccess: (r) => {
      refreshJobBoard();
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] });
      toast({
        title: r.replayed ? "Already awarded" : "Bid awarded",
        description: `A draft proposal was created for ${bid.contractorName || "the contractor"}.${r.post?.status === "closed" ? " The posting is now closed." : ""}`,
      });
      onAwarded(r.proposalId);
    },
    onError: (e: any) => toast({ title: e?.message || "Award failed", variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !award.isPending) onClose(); }}>
      <DialogContent data-testid="dialog-job-award">
        <DialogHeader>
          <DialogTitle>Award to {bid.contractorName || "this contractor"}?</DialogTitle>
          <DialogDescription>
            This creates a draft proposal in Proposals from the bid's terms ({bidPrice(bid, post.currency || "USD")}). Contract and invoicing follow the normal proposal workflow.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border p-3 text-sm space-y-1">
          <p>{capacityLabel(post)} → {(post.awardsMade ?? 0) + 1}{max != null ? ` of ${max}` : ""}</p>
          <p className={cn("text-xs", willClose ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
            {willClose ? "The posting will close after this award and other bidders will be notified." : "The posting stays open for additional awards."}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={award.isPending} onClick={onClose}>Cancel</Button>
          <Button disabled={award.isPending} onClick={() => award.mutate()} data-testid="btn-job-award-confirm">
            {award.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}<Award className="h-4 w-4 mr-1" />Award bid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BidDetailDialog({ bid, currency, onClose, actions }: {
  bid: JobBid; currency: string; onClose: () => void; actions?: (b: JobBid) => React.ReactNode;
}) {
  const attachments = useQuery<JobAttachment[]>({
    queryKey: ["job-board", "bid-attachments", bid.id],
    queryFn: () => jobGet<JobAttachment[]>(`/api/contractor-job-bids/${bid.id}/attachments`),
  });
  const versions = useQuery<{ revisionNumber: number; createdAt: string }[]>({
    queryKey: ["job-board", "bid-versions", bid.id],
    queryFn: () => jobGet(`/api/contractor-job-bids/${bid.id}/versions`),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-job-bid-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">{bid.contractorName || "Bid"} <BidStatusBadge status={bid.status} /></DialogTitle>
          <DialogDescription>Revision {bid.revisionNumber ?? 1} · submitted {dateTimeLabel(bid.submittedAt)}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-md border p-3">
          <Fact label="Price" value={bidPrice(bid, currency)} />
          <Fact label="Rate type" value={bid.rateType ?? "—"} />
          <Fact label="Start" value={dateLabel(bid.estimatedStartDate)} />
          <Fact label="Completion" value={dateLabel(bid.estimatedCompletionDate)} />
        </div>
        <div className="space-y-3">
          <TextBlock label="Cover message" value={bid.coverMessage} />
          <TextBlock label="Proposed scope" value={bid.proposedScope} />
          <TextBlock label="Recurrence terms" value={bid.recurrenceTerms} />
          <TextBlock label="Assumptions" value={bid.assumptions} />
          <TextBlock label="Exclusions" value={bid.exclusions} />
          <TextBlock label="Revision requested" value={bid.revisionRequestNote} />
          <TextBlock label="Decline note" value={bid.rejectionReason} />
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Files</p>
            <AttachmentList items={attachments.data ?? []} />
          </div>
          {(versions.data?.length ?? 0) > 1 && (
            <p className="text-xs text-muted-foreground"><History className="h-3 w-3 inline mr-1" />{versions.data!.length} submitted revisions on record</p>
          )}
        </div>
        {actions && <DialogFooter className="flex-wrap gap-2 sm:gap-2">{actions(bid)}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

// ─── Questions / invitations / activity ──────────────────────────────────────

function AdminQuestionsPanel({ postId }: { postId: string }) {
  const { toast } = useToast();
  const qs = useQuery<JobQuestion[], JobBoardError>({
    queryKey: ["job-board", "questions", postId],
    queryFn: () => jobGet<JobQuestion[]>(`/api/contractor-jobs/${postId}/questions`),
  });
  const [drafts, setDrafts] = useState<Record<string, { answer: string; isPublic: boolean }>>({});
  const answer = useMutation({
    mutationFn: ({ id, answer, isPublic }: { id: string; answer: string; isPublic: boolean }) =>
      jobSend("POST", `/api/contractor-job-questions/${id}/answer`, { json: { answer, isPublic } }),
    onSuccess: (_r, v) => { refreshJobBoard(); setDrafts((d) => { const n = { ...d }; delete n[v.id]; return n; }); toast({ title: "Answer posted" }); },
    onError: (e: any) => toast({ title: e?.message || "Could not post answer", variant: "destructive" }),
  });
  if (qs.isLoading) return <Skeleton className="h-24 w-full mt-3" />;
  if (qs.error) return <div className="mt-3"><LoadProblem error={qs.error} /></div>;
  if (!qs.data?.length) return <p className="text-sm text-muted-foreground py-6 text-center">No questions from contractors.</p>;
  return (
    <div className="space-y-3 mt-3">
      {qs.data.map((q) => {
        const d = drafts[q.id] ?? { answer: q.answer ?? "", isPublic: q.isPublic };
        return (
          <Card key={q.id}><CardContent className="p-3 space-y-2">
            <div className="flex items-start gap-2">
              <MessageCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm">{q.question}</p>
                <p className="text-xs text-muted-foreground">{q.contractorName || "Contractor"} · {dateTimeLabel(q.createdAt)}</p>
              </div>
            </div>
            <Textarea rows={2} value={d.answer} onChange={(e) => setDrafts({ ...drafts, [q.id]: { ...d, answer: e.target.value } })} placeholder="Answer" />
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={d.isPublic} onCheckedChange={(v) => setDrafts({ ...drafts, [q.id]: { ...d, isPublic: v } })} />
                Share question and answer with every bidder (asker stays anonymous)
              </label>
              <Button size="sm" disabled={!d.answer.trim() || answer.isPending} onClick={() => answer.mutate({ id: q.id, answer: d.answer.trim(), isPublic: d.isPublic })}>
                {q.answeredAt ? "Update" : "Answer"}
              </Button>
            </div>
          </CardContent></Card>
        );
      })}
    </div>
  );
}

function InvitationsPanel({ post }: { post: JobPost }) {
  const { toast } = useToast();
  const invites = useQuery<JobInvitation[], JobBoardError>({
    queryKey: ["job-board", "invitations", post.id],
    queryFn: () => jobGet<JobInvitation[]>(`/api/contractor-jobs/${post.id}/invitations`),
  });
  const workers = useQuery<any[]>({
    queryKey: ["job-board", "contractors", post.companyId],
    queryFn: () => jobGet<any[]>(`/api/workers?companyId=${encodeURIComponent(post.companyId)}`),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const invite = useMutation({
    mutationFn: () => jobSend<{ invited: number }>("POST", `/api/contractor-jobs/${post.id}/invitations`, { json: { contractorIds: Array.from(selected) } }),
    onSuccess: (r) => { refreshJobBoard(); setSelected(new Set()); toast({ title: `${r.invited} contractor${r.invited === 1 ? "" : "s"} invited` }); },
    onError: (e: any) => toast({ title: e?.message || "Could not send invitations", variant: "destructive" }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => jobSend("POST", `/api/contractor-job-invitations/${id}/revoke`, { json: {} }),
    onSuccess: () => { refreshJobBoard(); toast({ title: "Invitation revoked" }); },
    onError: (e: any) => toast({ title: e?.message || "Could not revoke", variant: "destructive" }),
  });

  const active = (invites.data ?? []).filter((i) => i.status !== "revoked");
  const invitedIds = new Set(active.map((i) => i.contractorId));
  const candidates = (workers.data ?? [])
    .filter((w) => (w.workerType ?? w.worker_type) === "contractor" && (w.status ?? "active") === "active" && (w.companyId ?? w.company_id) === post.companyId && !invitedIds.has(w.id))
    .map((w) => ({ id: w.id as string, name: `${w.firstName ?? w.first_name ?? ""} ${w.lastName ?? w.last_name ?? ""}`.trim() || "Contractor" }))
    .filter((w) => !filter || w.name.toLowerCase().includes(filter.toLowerCase()));
  const canInvite = ["draft", "published", "paused"].includes(post.status);

  return (
    <div className="space-y-4 mt-3">
      {post.visibility !== "invited_only" && (
        <p className="text-xs text-muted-foreground">This posting is visible to {post.visibility === "selected_groups" ? "the selected groups" : "all active contractors"}. Invitations add contractors who would not otherwise see it and send them a notification.</p>
      )}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">Invited</p>
        {invites.isLoading ? <Skeleton className="h-10 w-full" /> : invites.error ? <LoadProblem error={invites.error} /> : active.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one invited yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {active.map((i) => (
              <li key={i.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{i.contractorName || "Contractor"} <span className="text-xs text-muted-foreground">· {dateLabel(i.invitedAt)}</span></span>
                <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(i.id)}>Revoke</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {canInvite && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input className="h-9" placeholder="Find contractors" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <Button size="sm" disabled={!selected.size || invite.isPending} onClick={() => invite.mutate()} data-testid="btn-job-invite">
              <UserPlus className="h-3.5 w-3.5 mr-1" />Invite{selected.size ? ` ${selected.size}` : ""}
            </Button>
          </div>
          <div className="max-h-56 overflow-y-auto rounded-md border divide-y">
            {workers.isLoading ? <Skeleton className="h-10 w-full" /> : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground p-3">No other active contractors in this company.</p>
            ) : candidates.map((w) => (
              <label key={w.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                <input type="checkbox" checked={selected.has(w.id)} onChange={(e) => {
                  const n = new Set(selected); if (e.target.checked) n.add(w.id); else n.delete(w.id); setSelected(n);
                }} />
                {w.name}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  post_created: "Posting created", post_updated: "Posting edited", post_material_change: "Material change (bidders notified)",
  post_published: "Published", post_paused: "Paused", post_reopened: "Reopened", post_closed: "Closed", post_archived: "Archived",
  post_attachment_added: "File attached to posting", attachment_removed: "File removed",
  bid_created: "Bid started", bid_draft_updated: "Draft bid edited", bid_submitted: "Bid submitted", bid_resubmitted: "Bid resubmitted",
  bid_revised: "Bid revised", bid_withdrawn: "Bid withdrawn", bid_attachment_added: "File attached to bid",
  bid_under_review: "Bid under review", bid_shortlisted: "Bid shortlisted", bid_revision_requested: "Revision requested",
  bid_rejected: "Bid declined", bid_awarded: "Bid awarded", bid_converted_to_proposal: "Proposal created",
  bid_converted_to_contract: "Contract linked", contractor_invited: "Contractor invited", contractor_invitation_revoked: "Invitation revoked",
  question_asked: "Question asked", question_answered: "Question answered", question_answer_updated: "Answer updated",
  deadline_reminder_sent: "Deadline reminder sent",
};

function ActivityPanel({ postId }: { postId: string }) {
  const events = useQuery<JobEvent[], JobBoardError>({
    queryKey: ["job-board", "events", postId],
    queryFn: () => jobGet<JobEvent[]>(`/api/contractor-jobs/${postId}/events`),
  });
  if (events.isLoading) return <Skeleton className="h-24 w-full mt-3" />;
  if (events.error) return <div className="mt-3"><LoadProblem error={events.error} /></div>;
  const rows = [...(events.data ?? [])].reverse();
  if (!rows.length) return <p className="text-sm text-muted-foreground py-6 text-center">No activity yet.</p>;
  return (
    <ol className="mt-3 space-y-2" data-testid="list-job-activity">
      {rows.map((e) => (
        <li key={e.id} className="flex items-start gap-2 text-sm">
          <Clock className="h-3.5 w-3.5 text-muted-foreground mt-1 shrink-0" />
          <div className="min-w-0">
            <p>{EVENT_LABEL[e.eventType] ?? e.eventType.replace(/_/g, " ")}
              {e.oldStatus && e.newStatus && e.oldStatus !== e.newStatus ? <span className="text-muted-foreground"> · {e.oldStatus.replace(/_/g, " ")} → {e.newStatus.replace(/_/g, " ")}</span> : null}
            </p>
            <p className="text-xs text-muted-foreground">{dateTimeLabel(e.createdAt)}{e.details?.proposalNumber ? ` · ${e.details.proposalNumber}` : ""}{e.details?.reason ? ` · ${String(e.details.reason).replace(/_/g, " ")}` : ""}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Contractor
// ═══════════════════════════════════════════════════════════════════════════

type ContractorTab = "available" | "bids" | "awarded" | "closed";

function ContractorJobBoard({ initialJobId, onNavigate }: { initialJobId?: string | null; onNavigate: JobBoardNavigate }) {
  const [tab, setTab] = useState<ContractorTab>("available");
  const [filters, setFilters] = useState<JobFilters>(EMPTY_FILTERS);
  const [openId, setOpenId] = useState<string | null>(initialJobId ?? null);
  useEffect(() => { if (initialJobId) setOpenId(initialJobId); }, [initialJobId]);

  const available = useQuery<JobPost[], JobBoardError>({
    queryKey: ["job-board", "available"],
    queryFn: () => jobGet<JobPost[]>("/api/contractor-jobs/available"),
  });
  const mine = useQuery<JobBid[], JobBoardError>({
    queryKey: ["job-board", "my-bids"],
    queryFn: () => jobGet<JobBid[]>("/api/contractor-job-bids/mine"),
  });

  const bids = mine.data ?? [];
  const activeBids = bids.filter((b) => ACTIVE_BID_STATUSES.includes(b.status) && b.jobStatus !== "archived");
  const awarded = bids.filter((b) => AWARDED_STATUSES.includes(b.status));
  const closed = bids.filter((b) => b.status === "rejected" || b.status === "withdrawn" || (ACTIVE_BID_STATUSES.includes(b.status) && b.jobStatus === "archived"));
  const openPosts = applyJobFilters((available.data ?? []).filter((p) => p.acceptingBids), filters);
  const error = available.error ?? mine.error;

  return (
    <div className="space-y-4">
      <JobBoardSummaryCard mode="contractor" />
      {error ? <LoadProblem error={error} /> : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as ContractorTab)}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="available" data-testid="tab-jobs-available">Available jobs{openPosts.length ? ` (${openPosts.length})` : ""}</TabsTrigger>
            <TabsTrigger value="bids" data-testid="tab-jobs-my-bids">My bids{activeBids.length ? ` (${activeBids.length})` : ""}</TabsTrigger>
            <TabsTrigger value="awarded" data-testid="tab-jobs-awarded">Awarded work{awarded.length ? ` (${awarded.length})` : ""}</TabsTrigger>
            <TabsTrigger value="closed" data-testid="tab-jobs-closed">Closed</TabsTrigger>
          </TabsList>

          <TabsContent value="available" className="space-y-3">
            <FilterBar value={filters} onChange={setFilters} />
            {available.isLoading ? <Skeleton className="h-24 w-full" /> : openPosts.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No open jobs right now. You'll get a notification when a new job is posted for you.</CardContent></Card>
            ) : openPosts.map((p) => (
              <PostCard key={p.id} post={p} onOpen={() => setOpenId(p.id)} footer={
                p.myBidStatus ? <div className="pt-1 border-t flex items-center gap-2 text-xs">Your bid: <BidStatusBadge status={p.myBidStatus} /></div>
                  : p.invited ? <div className="pt-1 border-t text-xs text-primary">You were invited to bid</div> : null
              } />
            ))}
          </TabsContent>

          <TabsContent value="bids"><MyBidList bids={activeBids} loading={mine.isLoading} empty="You have no open bids." onOpen={setOpenId} /></TabsContent>
          <TabsContent value="awarded">
            <MyBidList bids={awarded} loading={mine.isLoading} empty="No awarded work yet." onOpen={setOpenId}
              extra={(b) => b.convertedProposalId ? (
                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onNavigate(b.convertedContractId ? "contracts" : "proposals", b.convertedContractId ?? b.convertedProposalId!); }}>
                  <FileText className="h-3.5 w-3.5 mr-1" />{b.convertedContractId ? "Open contract" : "Review proposal"}
                </Button>
              ) : null} />
          </TabsContent>
          <TabsContent value="closed"><MyBidList bids={closed} loading={mine.isLoading} empty="Nothing here." onOpen={setOpenId} /></TabsContent>
        </Tabs>
      )}
      {openId && <ContractorPostSheet postId={openId} onClose={() => setOpenId(null)} onNavigate={onNavigate} />}
    </div>
  );
}

function MyBidList({ bids, loading, empty, onOpen, extra }: {
  bids: JobBid[]; loading: boolean; empty: string; onOpen: (postId: string) => void; extra?: (b: JobBid) => React.ReactNode;
}) {
  if (loading) return <Skeleton className="h-24 w-full mt-3" />;
  if (!bids.length) return <Card className="mt-3"><CardContent className="py-8 text-center text-sm text-muted-foreground">{empty}</CardContent></Card>;
  return (
    <div className="space-y-2 mt-3">
      {bids.map((b) => (
        // div (not <button>): the card can hold its own action button ("Review proposal").
        <div key={b.id} role="button" tabIndex={0} className="w-full text-left cursor-pointer" onClick={() => onOpen(b.jobPostId)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(b.jobPostId); } }} data-testid={`card-my-bid-${b.id}`}>
          <Card className="hover:border-primary/40 transition-colors">
            <CardContent className="p-3 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{b.jobTitle ?? "Job"}</p>
                <p className="text-xs text-muted-foreground">{bidPrice(b)} · updated {dateLabel(b.updatedAt)}{b.jobStatus && b.jobStatus !== "published" ? ` · posting ${POST_STATUS_LABEL[b.jobStatus].toLowerCase()}` : ""}</p>
                {b.status === "revision_requested" && b.revisionRequestNote && <p className="text-xs text-orange-700 dark:text-orange-300 mt-1 line-clamp-2">“{b.revisionRequestNote}”</p>}
              </div>
              <BidStatusBadge status={b.status} />
              {extra?.(b)}
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}

function ContractorPostSheet({ postId, onClose, onNavigate }: { postId: string; onClose: () => void; onNavigate: JobBoardNavigate }) {
  const post = useQuery<JobPost, JobBoardError>({
    queryKey: ["job-board", "post", postId],
    queryFn: () => jobGet<JobPost>(`/api/contractor-jobs/${postId}`),
  });
  const p = post.data;
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto" data-testid="sheet-job-contractor">
        {!post.data && <SheetTitle className="sr-only">Job posting</SheetTitle>}
        {post.isLoading && <div className="space-y-3 mt-6"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-40 w-full" /></div>}
        {post.error && <div className="mt-6">{post.error.status === 404
          ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">This job is no longer available.</CardContent></Card>
          : <LoadProblem error={post.error} />}</div>}
        {p && (
          <div className="space-y-4">
            <SheetHeader className="text-left space-y-2">
              <SheetTitle className="pr-8">{p.title}</SheetTitle>
              {p.companyName && <p className="text-xs text-muted-foreground">{p.companyName}</p>}
              <PostBadges post={p} />
            </SheetHeader>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-md border p-3">
              <Fact label="Budget" value={budgetLabel(p)} />
              <Fact label="Bids due" value={dateTimeLabel(p.submissionDeadline)} />
              <Fact label="Openings" value={p.capacityRemaining == null ? "Open" : `${p.capacityRemaining} remaining`} />
            </div>
            <Tabs defaultValue={p.myBid && p.myBid.status !== "withdrawn" ? "bid" : "details"}>
              <TabsList>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="bid" data-testid="tab-job-my-bid">{p.myBid && p.myBid.status !== "withdrawn" ? "My bid" : "Bid"}</TabsTrigger>
                <TabsTrigger value="questions" data-testid="tab-job-questions">Questions</TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="space-y-3">
                <PostDetailBody post={p} />
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Attachments</p>
                  <AttachmentList items={p.attachments ?? []} />
                </div>
              </TabsContent>
              <TabsContent value="bid"><ContractorBidPanel post={p} onNavigate={onNavigate} /></TabsContent>
              <TabsContent value="questions"><ContractorQuestionsPanel post={p} /></TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Contractor bid form ─────────────────────────────────────────────────────

function ContractorBidPanel({ post, onNavigate }: { post: JobPost; onNavigate: JobBoardNavigate }) {
  const { toast } = useToast();
  const existing = post.myBid && post.myBid.status !== "withdrawn" ? post.myBid : null;
  const [form, setForm] = useState<BidForm>(() => bidFormFrom(existing, post));
  const [baseline, setBaseline] = useState<string>(() => JSON.stringify(bidPayload(bidFormFrom(existing, post))));
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  useEffect(() => {
    const f = bidFormFrom(existing, post);
    setForm(f);
    setBaseline(JSON.stringify(bidPayload(f)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id, existing?.updatedAt]);
  const set = <K extends keyof BidForm>(k: K, v: BidForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(bidPayload(form)) !== baseline;
  const upload = useUpload(() => `/api/contractor-job-bids/${existing!.id}/attachments`);
  const remove = useRemoveAttachment();
  const files = useQuery<JobAttachment[]>({
    queryKey: ["job-board", "bid-attachments", existing?.id],
    queryFn: () => jobGet<JobAttachment[]>(`/api/contractor-job-bids/${existing!.id}/attachments`),
    enabled: !!existing,
  });

  const save = useMutation({
    mutationFn: async (mode: "draft" | "submit" | "revise") => {
      const payload = bidPayload(form);
      let bid = existing;
      if (!bid) bid = await jobSend<JobBid>("POST", `/api/contractor-jobs/${post.id}/bids`, { json: payload });
      else if (dirty || mode === "draft") bid = await jobSend<JobBid>("PATCH", `/api/contractor-job-bids/${bid.id}`, { json: payload });
      // PATCH on a submitted/under-review bid already records a new revision; only drafts and
      // revision-requested bids need the explicit submit transition.
      if (mode === "submit" && (bid.status === "draft" || bid.status === "revision_requested")) {
        bid = await jobSend<JobBid>("POST", `/api/contractor-job-bids/${bid.id}/submit`, { json: {} });
      }
      return { bid, mode };
    },
    onSuccess: ({ mode }) => {
      refreshJobBoard();
      toast({ title: mode === "draft" ? "Draft saved" : mode === "revise" ? "Revised bid submitted" : "Bid submitted" });
    },
    onError: (e: any) => { refreshJobBoard(); toast({ title: e?.message || "Could not save bid", variant: "destructive" }); },
  });
  const withdraw = useMutation({
    mutationFn: () => jobSend<JobBid>("POST", `/api/contractor-job-bids/${existing!.id}/withdraw`, { json: {} }),
    onSuccess: () => { refreshJobBoard(); setConfirmWithdraw(false); toast({ title: "Bid withdrawn" }); },
    onError: (e: any) => toast({ title: e?.message || "Could not withdraw", variant: "destructive" }),
  });

  const status = existing?.status;
  const editable = post.acceptingBids && (!existing || CONTRACTOR_EDITABLE.includes(existing.status));
  const hourly = form.rateType === "hourly";
  const priced = hourly ? !!form.hourlyRate : !!form.proposedAmount;

  if (existing && AWARDED_STATUSES.includes(existing.status)) {
    return (
      <Card className="mt-3 border-green-300"><CardContent className="p-4 space-y-2">
        <p className="flex items-center gap-2 font-medium"><CheckCircle className="h-4 w-4 text-green-600" />You were awarded this job</p>
        <p className="text-sm text-muted-foreground">Your bid became a proposal. Review and accept it to move to a contract.</p>
        {existing.convertedProposalId && (
          <Button size="sm" onClick={() => onNavigate(existing.convertedContractId ? "contracts" : "proposals", existing.convertedContractId ?? existing.convertedProposalId!)} data-testid="btn-my-bid-open-proposal">
            <FileText className="h-3.5 w-3.5 mr-1" />{existing.convertedContractId ? "Open contract" : "Review proposal"}
          </Button>
        )}
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-3 mt-3">
      {existing && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <BidStatusBadge status={existing.status} />
          {existing.revisionNumber ? <span className="text-xs text-muted-foreground">Revision {existing.revisionNumber}</span> : null}
          {existing.submittedAt && <span className="text-xs text-muted-foreground">· submitted {dateTimeLabel(existing.submittedAt)}</span>}
        </div>
      )}
      {status === "revision_requested" && existing?.revisionRequestNote && (
        <div className="rounded-md border border-orange-300 bg-orange-50 dark:bg-orange-950/20 p-3 text-sm">
          <p className="text-xs font-medium text-orange-800 dark:text-orange-300 mb-0.5">The company asked for changes</p>
          <p className="whitespace-pre-wrap">{existing.revisionRequestNote}</p>
        </div>
      )}
      {status === "rejected" && (
        <div className="rounded-md border p-3 text-sm">
          <p className="font-medium">This bid was not selected.</p>
          {existing?.rejectionReason && <p className="text-muted-foreground whitespace-pre-wrap mt-1">{existing.rejectionReason}</p>}
        </div>
      )}
      {status === "shortlisted" && <p className="text-sm text-muted-foreground">You're on the shortlist. The bid is locked while the company decides; you can still withdraw it.</p>}
      {!post.acceptingBids && !existing && (
        <p className="text-sm text-muted-foreground py-4 text-center">This posting is not accepting bids{post.status === "paused" ? " right now (paused)" : ""}.</p>
      )}
      {post.myBid?.status === "withdrawn" && post.acceptingBids && <p className="text-xs text-muted-foreground">You withdrew an earlier bid. You can submit a new one.</p>}

      {(editable || (existing && !CONTRACTOR_EDITABLE.includes(existing.status))) && (existing || post.acceptingBids) && (
        <fieldset disabled={!editable} className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label>Pricing</Label>
              <Select value={form.rateType} onValueChange={(v) => set("rateType", v)}>
                <SelectTrigger data-testid="select-bid-rate-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed price</SelectItem>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="recurring">Per period (recurring)</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {hourly ? (
              <>
                <div><Label>Hourly rate *</Label><Input inputMode="decimal" value={form.hourlyRate} onChange={(e) => set("hourlyRate", e.target.value)} data-testid="input-bid-hourly-rate" /></div>
                <div><Label>Estimated hours</Label><Input inputMode="decimal" value={form.estimatedHours} onChange={(e) => set("estimatedHours", e.target.value)} /></div>
              </>
            ) : (
              <>
                <div><Label>{form.rateType === "recurring" ? "Amount per period *" : "Amount *"}</Label><Input inputMode="decimal" value={form.proposedAmount} onChange={(e) => set("proposedAmount", e.target.value)} data-testid="input-bid-amount" /></div>
                <div><Label>Estimated hours</Label><Input inputMode="decimal" value={form.estimatedHours} onChange={(e) => set("estimatedHours", e.target.value)} /></div>
              </>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label>Can start</Label><Input type="date" value={form.estimatedStartDate} onChange={(e) => set("estimatedStartDate", e.target.value)} /></div>
            <div><Label>Estimated completion</Label><Input type="date" value={form.estimatedCompletionDate} onChange={(e) => set("estimatedCompletionDate", e.target.value)} /></div>
          </div>
          <div><Label>Message to the company</Label><Textarea rows={3} value={form.coverMessage} onChange={(e) => set("coverMessage", e.target.value)} data-testid="input-bid-cover" /></div>
          <div><Label>Proposed scope</Label><Textarea rows={3} value={form.proposedScope} onChange={(e) => set("proposedScope", e.target.value)} placeholder="Leave blank to accept the posted scope" /></div>
          {post.workType === "recurring" && <div><Label>Recurring terms</Label><Textarea rows={2} value={form.recurrenceTerms} onChange={(e) => set("recurrenceTerms", e.target.value)} /></div>}
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label>Assumptions</Label><Textarea rows={2} value={form.assumptions} onChange={(e) => set("assumptions", e.target.value)} /></div>
            <div><Label>Exclusions</Label><Textarea rows={2} value={form.exclusions} onChange={(e) => set("exclusions", e.target.value)} /></div>
          </div>
        </fieldset>
      )}

      {existing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Files (visible only to the company)</p>
            {editable && <UploadButton label="Attach file" onFile={upload} />}
          </div>
          <AttachmentList items={files.data ?? []} onRemove={editable ? remove : undefined} />
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {editable && (!existing || status === "draft" || status === "revision_requested") && (
          <>
            <Button variant="outline" disabled={save.isPending || (!!existing && !dirty)} onClick={() => save.mutate("draft")} data-testid="btn-bid-save-draft">Save draft</Button>
            <Button disabled={save.isPending || !priced} onClick={() => save.mutate("submit")} data-testid="btn-bid-submit">
              {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}<Send className="h-4 w-4 mr-1" />{status === "revision_requested" ? "Resubmit bid" : "Submit bid"}
            </Button>
          </>
        )}
        {editable && (status === "submitted" || status === "under_review") && (
          <Button disabled={save.isPending || !dirty || !priced} onClick={() => save.mutate("revise")} data-testid="btn-bid-revise">
            {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Submit revision
          </Button>
        )}
        {existing && CONTRACTOR_WITHDRAWABLE.includes(existing.status) && (
          <Button variant="ghost" className="text-destructive" onClick={() => setConfirmWithdraw(true)} data-testid="btn-bid-withdraw">Withdraw</Button>
        )}
      </div>
      {editable && !existing && <p className="text-xs text-muted-foreground">Save a draft to attach files before submitting. Other contractors never see your bid.</p>}

      {confirmWithdraw && (
        <Dialog open onOpenChange={(o) => { if (!o) setConfirmWithdraw(false); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Withdraw your bid?</DialogTitle><DialogDescription>The company will no longer consider it. You can submit a new bid while the posting is open.</DialogDescription></DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmWithdraw(false)}>Keep bid</Button>
              <Button variant="destructive" disabled={withdraw.isPending} onClick={() => withdraw.mutate()} data-testid="btn-bid-withdraw-confirm">Withdraw</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ContractorQuestionsPanel({ post }: { post: JobPost }) {
  const { toast } = useToast();
  const qs = useQuery<JobQuestion[], JobBoardError>({
    queryKey: ["job-board", "questions", post.id],
    queryFn: () => jobGet<JobQuestion[]>(`/api/contractor-jobs/${post.id}/questions`),
  });
  const [text, setText] = useState("");
  const ask = useMutation({
    mutationFn: () => jobSend("POST", `/api/contractor-jobs/${post.id}/questions`, { json: { question: text.trim() } }),
    onSuccess: () => { refreshJobBoard(); setText(""); toast({ title: "Question sent" }); },
    onError: (e: any) => toast({ title: e?.message || "Could not send question", variant: "destructive" }),
  });
  return (
    <div className="space-y-3 mt-3">
      {post.status === "published" && (
        <div className="space-y-2">
          <Textarea rows={2} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="Ask the company about this job" data-testid="input-job-question" />
          <div className="flex justify-between items-center gap-2">
            <p className="text-xs text-muted-foreground">Only the company sees your question unless they choose to share the answer with all bidders.</p>
            <Button size="sm" disabled={!text.trim() || ask.isPending} onClick={() => ask.mutate()} data-testid="btn-job-ask">Ask</Button>
          </div>
        </div>
      )}
      {qs.isLoading ? <Skeleton className="h-16 w-full" /> : qs.error ? <LoadProblem error={qs.error} /> : !qs.data?.length ? (
        <p className="text-sm text-muted-foreground text-center py-4">No questions yet.</p>
      ) : qs.data.map((q) => (
        <Card key={q.id}><CardContent className="p-3 space-y-1">
          <p className="text-sm"><MessageCircle className="h-3.5 w-3.5 inline mr-1 text-muted-foreground" />{q.question}</p>
          <p className="text-xs text-muted-foreground">{q.mine ? "You asked" : "Shared by the company"} · {dateTimeLabel(q.createdAt)}</p>
          {q.answer ? <p className="text-sm border-l-2 pl-2 mt-1 whitespace-pre-wrap">{q.answer}</p> : <p className="text-xs text-muted-foreground italic">Awaiting answer</p>}
        </CardContent></Card>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard summary (also used on the hub Overview)
// ═══════════════════════════════════════════════════════════════════════════

interface AdminSummary { publishedJobs: number; bidsAwaitingReview: number; closingSoon: number; awardsThisMonth: number }
interface ContractorSummary { availableJobs: number; activeBids: number; revisionRequested: number; awardedBids: number }

export function JobBoardSummaryCard({ mode, companyId, onOpen }: { mode: "admin" | "contractor"; companyId?: string | null; onOpen?: () => void }) {
  const summary = useQuery<AdminSummary | ContractorSummary, JobBoardError>({
    queryKey: ["job-board", "summary", mode, companyId ?? null],
    queryFn: () => jobGet(`/api/contractor-jobs/summary?view=${mode}${companyQs(companyId ?? null, false)}`),
  });
  // Feature off (503), no default company (400) or no access: the Overview simply omits the card.
  if (!summary.data) return null;
  const tiles = mode === "admin"
    ? (() => { const s = summary.data as AdminSummary; return [
        { label: "Published jobs", value: s.publishedJobs, tone: "text-blue-600" },
        { label: "Bids awaiting review", value: s.bidsAwaitingReview, tone: "text-indigo-600" },
        { label: "Closing soon", value: s.closingSoon, tone: "text-amber-600" },
        { label: "Awards this month", value: s.awardsThisMonth, tone: "text-green-600" },
      ]; })()
    : (() => { const s = summary.data as ContractorSummary; return [
        { label: "Jobs not yet bid on", value: s.availableJobs, tone: "text-blue-600" },
        { label: "Active bids", value: s.activeBids, tone: "text-indigo-600" },
        { label: "Revisions requested", value: s.revisionRequested, tone: "text-orange-600" },
        { label: "Awarded", value: s.awardedBids, tone: "text-green-600" },
      ]; })();
  return (
    <Card data-testid={`card-job-summary-${mode}`}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold flex items-center gap-2"><Briefcase className="h-4 w-4 text-primary" />Job board</CardTitle>
        {onOpen && <Button size="sm" variant="ghost" onClick={onOpen} data-testid="btn-job-summary-open">Open jobs<ChevronRight className="h-4 w-4 ml-1" /></Button>}
      </CardHeader>
      <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-md border p-2.5">
            <p className={cn("text-xl font-bold", t.tone)}>{Number(t.value ?? 0)}</p>
            <p className="text-xs text-muted-foreground">{t.label}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
