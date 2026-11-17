/**
 * Contractor Hub — Jobs section (job board UI).
 *
 * One posting model, two separate paths that never cross:
 *   CONTRACTOR WORK     → workers "Submit Proposal"; administrators compare and
 *                         award, which creates the existing contractor proposal.
 *   EMPLOYEE POSITION   → workers "Apply"; administrators review, interview,
 *                         offer and hire. Hiring never creates a proposal,
 *                         contract or invoice; a worker record is created only
 *                         by an explicit, final "Create employee record" action.
 *
 * All authorization is server-side (server/job-board/{service,employment}.ts);
 * this view mirrors the state machines so it only offers actions the server
 * accepts. Every mutation goes through jobSend(), which always echoes the CSRF
 * cookie — including multipart uploads and the award call (which also carries
 * an Idempotency-Key reused on retry so a double-click cannot create a second
 * proposal).
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
import { Checkbox } from "@/components/ui/checkbox";
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
  ChevronLeft, ChevronRight, Upload, Eye, CheckCircle, ShieldAlert, UserCheck, HardHat, BadgeCheck,
  CalendarClock, ListChecks, Trash2, Globe, KeyRound, Copy, Inbox,
} from "lucide-react";
import {
  ACTIVE_APPLICATION_STATUSES, ACTIVE_BID_STATUSES, APPLICANT_EDITABLE, APPLICANT_WITHDRAWABLE,
  APPLICATION_ACKNOWLEDGEMENTS, APPLICATION_STATUS_LABEL, AWARDED_STATUSES, BID_STATUS_LABEL, CLASSIFICATION_NOTICE,
  COMPENSATION_LABEL, CONTRACTOR_EDITABLE, CONTRACTOR_WITHDRAWABLE, EMPLOYMENT_INDICATOR_LABELS, EMPTY_FILTERS,
  FREQUENCY_LABEL, LOCATION_LABEL, OPPORTUNITY_LABEL, POST_ACTIONS, POST_STATUS_LABEL, PUBLIC_VISIBILITY_LABEL, SCHEDULE_LABEL,
  applicationFormFrom, applicationPayload, applicationSubmitProblem, applyJobFilters, bidFormFrom, bidPayload,
  bidSubmitProblem, canDo, canDoApplication, classificationBadge, clientEmploymentIndicators, compensationLabel,
  compensationTypesFor, defaultOpportunity, formFromPost, hoursLabel, jobBoardViewsFor, money, opportunityChoicesFor,
  postBadges, postPayload, schedulesFor, unacknowledgedIndicators,
  type ApplicationDocument, type ApplicationForm, type ApplicationStatus, type BidForm, type BidStatus,
  type JobApplication, type JobAttachment, type JobBid, type JobBoardNavigate, type JobEvent, type JobFilters,
  type JobInvitation, type JobPost, type JobQuestion, type PostForm, type PostStatus, type PublicVisibility, type ScheduleType,
  type ScreeningQuestion, type WorkerClassification,
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
const APPLICATION_STATUS_TONE: Record<ApplicationStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  under_review: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300",
  interviewing: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  offer_extended: "bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300",
  hired: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  withdrawn: "bg-muted text-muted-foreground",
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
const isEmployee = (p: Pick<JobPost, "workerClassification">) => p.workerClassification === "employee";

/** The prominent classification badge on every card and header. */
function ClassificationBadge({ post, size = "sm" }: { post: Pick<JobPost, "workerClassification">; size?: "sm" | "lg" }) {
  const b = classificationBadge(post);
  const Icon = isEmployee(post) ? BadgeCheck : HardHat;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md font-bold tracking-wide shrink-0", size === "lg" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[10px]", b.className)}
      data-testid={`badge-classification-${post.workerClassification}`}>
      <Icon className={size === "lg" ? "h-3.5 w-3.5" : "h-3 w-3"} />{b.label}
    </span>
  );
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
function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", APPLICATION_STATUS_TONE[status])} data-testid={`badge-application-status-${status}`}>{APPLICATION_STATUS_LABEL[status] ?? status}</span>;
}

function capacityLabel(p: JobPost) {
  const max = p.numberOfOpenings ?? null;
  const made = p.filledCount ?? 0;
  const verb = isEmployee(p) ? "hired" : "awarded";
  return max == null ? `${made} ${verb} · unlimited` : `${made} of ${max} ${verb}`;
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
          <a className="truncate hover:underline" href={`${API_BASE_URL}/api/job-post-attachments/${a.id}/download`} data-testid={`link-job-attachment-${a.id}`}>{a.fileName}</a>
          <span className="text-xs text-muted-foreground shrink-0">{fileSize(a.fileSize)}</span>
          <a href={`${API_BASE_URL}/api/job-post-attachments/${a.id}/download`} aria-label={`Download ${a.fileName}`} className="ml-auto text-muted-foreground hover:text-foreground">
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

/** Private HR documents (résumé etc.) — their own download route; admin reads are logged server-side. */
function HrDocumentList({ items, onRemove }: { items: ApplicationDocument[]; onRemove?: (id: string) => void }) {
  if (!items.length) return <p className="text-xs text-muted-foreground">No documents.</p>;
  return (
    <ul className="space-y-1">
      {items.map((d) => (
        <li key={d.id} className="flex items-center gap-2 text-sm">
          <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <a className="truncate hover:underline" href={`${API_BASE_URL}/api/employment-application-documents/${d.id}/download`} data-testid={`link-hr-document-${d.id}`}>{d.fileName}</a>
          <span className="text-xs text-muted-foreground shrink-0">{d.documentType.replace(/_/g, " ")} · {fileSize(d.fileSize)}</span>
          {onRemove && (
            <button type="button" aria-label={`Remove ${d.fileName}`} className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => onRemove(d.id)}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function UploadButton({ label, onFile, disabled, accept }: { label: string; onFile: (f: File) => Promise<void>; disabled?: boolean; accept?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input ref={ref} type="file" className="hidden" accept={accept} onChange={async (e) => {
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

function useUpload(urlFor: () => string, extra?: Record<string, string>) {
  const { toast } = useToast();
  return async (file: File) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(extra ?? {})) fd.append(k, v);
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

function useRemove(urlFor: (id: string) => string) {
  const { toast } = useToast();
  return async (id: string) => {
    try {
      await jobSend("POST", urlFor(id));
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

/** Advisory classification indicators — never a legal conclusion. */
function ClassificationWarning({ indicators, className }: { indicators: string[]; className?: string }) {
  if (!indicators.length) return null;
  return (
    <div className={cn("rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs space-y-1.5", className)} data-testid="warning-classification">
      <p className="flex items-center gap-1.5 font-medium text-amber-900 dark:text-amber-200"><ShieldAlert className="h-4 w-4" />This contractor work has features that often resemble employment</p>
      <ul className="list-disc pl-5 space-y-0.5">
        {indicators.map((i) => <li key={i}>{EMPLOYMENT_INDICATOR_LABELS[i] ?? i}</li>)}
      </ul>
      <p className="text-muted-foreground">{CLASSIFICATION_NOTICE} If this is really an employee role, choose Employee Position instead.</p>
    </div>
  );
}


function FilterBar({ value, onChange, showClassification }: { value: JobFilters; onChange: (f: JobFilters) => void; showClassification?: boolean }) {
  const set = <K extends keyof JobFilters>(k: K, v: JobFilters[K]) => onChange({ ...value, [k]: v });
  const active = JSON.stringify(value) !== JSON.stringify(EMPTY_FILTERS);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-56">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8 h-9" placeholder="Search jobs or skills" value={value.search} onChange={(e) => set("search", e.target.value)} data-testid="input-job-search" />
      </div>
      {showClassification && (
        <Select value={value.classification} onValueChange={(v) => set("classification", v as JobFilters["classification"])}>
          <SelectTrigger className="h-9 w-[150px]" data-testid="select-job-filter-classification"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Contractor + employee</SelectItem>
            <SelectItem value="contractor">Contractor work</SelectItem>
            <SelectItem value="employee">Employee positions</SelectItem>
          </SelectContent>
        </Select>
      )}
      <Select value={value.opportunity} onValueChange={(v) => set("opportunity", v as JobFilters["opportunity"])}>
        <SelectTrigger className="h-9 w-[140px]" data-testid="select-job-filter-opportunity"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any type</SelectItem>
          <SelectItem value="project">Projects</SelectItem>
          <SelectItem value="recurring_work">Recurring work</SelectItem>
          <SelectItem value="position">Positions</SelectItem>
        </SelectContent>
      </Select>
      <Select value={value.schedule} onValueChange={(v) => set("schedule", v as JobFilters["schedule"])}>
        <SelectTrigger className="h-9 w-[130px]" data-testid="select-job-filter-schedule"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any schedule</SelectItem>
          {(["one_time", "recurring", "part_time", "full_time"] as ScheduleType[]).map((s) => <SelectItem key={s} value={s}>{SCHEDULE_LABEL[s]}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={value.location} onValueChange={(v) => set("location", v as JobFilters["location"])}>
        <SelectTrigger className="h-9 w-[130px]" data-testid="select-job-filter-location"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any location</SelectItem>
          <SelectItem value="onsite">On-site</SelectItem>
          <SelectItem value="remote">Remote</SelectItem>
          <SelectItem value="hybrid">Hybrid</SelectItem>
        </SelectContent>
      </Select>
      <Select value={value.compensation} onValueChange={(v) => set("compensation", v as JobFilters["compensation"])}>
        <SelectTrigger className="h-9 w-[140px]" data-testid="select-job-filter-compensation"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any pay type</SelectItem>
          {Object.entries(COMPENSATION_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={value.deadline} onValueChange={(v) => set("deadline", v as JobFilters["deadline"])}>
        <SelectTrigger className="h-9 w-[140px]" data-testid="select-job-filter-deadline"><SelectValue /></SelectTrigger>
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

function PostCard({ post, onOpen, footer, showCta }: { post: JobPost; onOpen: () => void; footer?: React.ReactNode; showCta?: boolean }) {
  const hours = hoursLabel(post);
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className="w-full text-left cursor-pointer" data-testid={`card-job-${post.id}`}>
      <Card className={cn("hover:border-primary/40 transition-colors border-l-4", isEmployee(post) ? "border-l-sky-500" : "border-l-orange-500")}>
        <CardContent className="p-4 space-y-2">
          <ClassificationBadge post={post} />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium truncate">{post.title}</p>
              {post.summary && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{post.summary}</p>}
            </div>
            <p className="text-sm font-semibold shrink-0 text-right">{compensationLabel(post)}</p>
          </div>
          <PostBadges post={post} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{LOCATION_LABEL[post.workLocationType]}{post.locationText ? ` · ${post.locationText}` : ""}</span>
            {hours && <span>{hours}</span>}
            {post.applicationDeadline && <span>{isEmployee(post) ? "Apply by" : "Proposals due"} {dateTimeLabel(post.applicationDeadline)}</span>}
            {post.startDate && <span>Starts {dateLabel(post.startDate)}</span>}
            {post.openingsRemaining != null && post.openingsRemaining > 1 && <span>{post.openingsRemaining} openings</span>}
          </div>
          {showCta && (
            <div className="flex justify-end">
              <Button size="sm" variant={isEmployee(post) ? "default" : "secondary"} onClick={(e) => { e.stopPropagation(); onOpen(); }}
                data-testid={`btn-job-cta-${post.id}`}>
                {isEmployee(post) ? <UserCheck className="h-3.5 w-3.5 mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}{post.cta}
              </Button>
            </div>
          )}
          {footer}
        </CardContent>
      </Card>
    </div>
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
  const { canManage, canBrowse } = jobBoardViewsFor(user);
  const [view, setView] = useState<"admin" | "worker">(canManage ? "admin" : "worker");
  useEffect(() => { if (!canManage && canBrowse) setView("worker"); }, [canManage, canBrowse]);

  if (!canManage && !canBrowse) {
    return (
      <Card data-testid="card-job-board-no-access">
        <CardContent className="py-10 text-center space-y-1">
          <Briefcase className="h-8 w-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm font-medium">The job board is available to company workers and administrators</p>
          <p className="text-xs text-muted-foreground">Ask your administrator if you expected to see opportunities here.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="section-jobs">
      {canManage && canBrowse && (
        <Tabs value={view} onValueChange={(v) => setView(v as "admin" | "worker")}>
          <TabsList>
            <TabsTrigger value="admin" data-testid="tab-jobs-view-admin">Manage postings</TabsTrigger>
            <TabsTrigger value="worker" data-testid="tab-jobs-view-worker">Job board</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {view === "admin" && canManage
        ? <AdminJobBoard initialJobId={initialJobId} onNavigate={onNavigate} />
        : <WorkerJobBoard user={user} initialJobId={initialJobId} onNavigate={onNavigate} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Administrator
// ═══════════════════════════════════════════════════════════════════════════

const ADMIN_TABS: { id: PostStatus; label: string }[] = [
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
  const [kind, setKind] = useState<"all" | WorkerClassification>("all");
  const [filters, setFilters] = useState<JobFilters>(EMPTY_FILTERS);
  const [openId, setOpenId] = useState<string | null>(initialJobId ?? null);
  const [editor, setEditor] = useState<{ post: JobPost | null } | null>(null);
  const [publicBoardOpen, setPublicBoardOpen] = useState(false);
  useEffect(() => { if (initialJobId) setOpenId(initialJobId); }, [initialJobId]);

  // Every status in one request so tab counts are accurate; the server excludes
  // archived unless status=all, so archived is fetched with "all".
  const list = useQuery<JobPost[], JobBoardError>({
    queryKey: ["job-board", "admin-list", companyId],
    queryFn: () => jobGet<JobPost[]>(`/api/job-posts?status=all${companyQs(companyId, false)}`),
  });
  const needsCompany = list.error?.status === 400;
  const companies = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/companies"],
    queryFn: () => jobGet<{ id: string; name: string }[]>("/api/companies"),
    enabled: needsCompany || !!companyId,
  });

  const posts = (list.data ?? []).filter((p) => kind === "all" || p.workerClassification === kind);
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
          <Tabs value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <TabsList>
              <TabsTrigger value="all" data-testid="tab-jobs-kind-all">All</TabsTrigger>
              <TabsTrigger value="contractor" data-testid="tab-jobs-kind-contractor"><HardHat className="h-3.5 w-3.5 mr-1" />Contractor work</TabsTrigger>
              <TabsTrigger value="employee" data-testid="tab-jobs-kind-employee"><BadgeCheck className="h-3.5 w-3.5 mr-1" />Employee positions</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPublicBoardOpen(true)} disabled={needsCompany && !companyId} data-testid="btn-public-board">
            <Globe className="h-4 w-4 mr-1" />Public board
          </Button>
          <Button onClick={() => setEditor({ post: null })} disabled={needsCompany && !companyId} data-testid="btn-new-job">
            <Plus className="h-4 w-4 mr-1" />Create Posting
          </Button>
        </div>
      </div>
      <FilterBar value={filters} onChange={setFilters} />

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
                {(list.data ?? []).length === 0 ? "No postings yet. Create one for contractor work or an employee position." : `No ${POST_STATUS_LABEL[tab].toLowerCase()} postings${JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS) || kind !== "all" ? " match these filters" : ""}.`}
              </CardContent></Card>
            ) : visible.map((p) => {
              const sc = p.submissionCounts;
              const noun = isEmployee(p) ? "applications" : "proposals";
              return (
                <PostCard key={p.id} post={p} onOpen={() => setOpenId(p.id)} footer={
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-1 border-t">
                    <span><strong>{sc?.total ?? 0}</strong> {noun}</span>
                    {(sc?.awaitingReview ?? 0) > 0 && <span className="text-blue-700 dark:text-blue-300"><strong>{sc!.awaitingReview}</strong> awaiting review</span>}
                    {(sc?.shortlisted ?? 0) > 0 && <span><strong>{sc!.shortlisted}</strong> {isEmployee(p) ? "interviewing / offered" : "shortlisted"}</span>}
                    <span className="text-muted-foreground">{capacityLabel(p)}</span>
                  </div>
                } />
              );
            })}
          </div>
        </Tabs>
      )}

      {openId && (
        <AdminPostSheet postId={openId} onClose={() => setOpenId(null)} onEdit={(p) => setEditor({ post: p })} onNavigate={onNavigate} />
      )}
      {publicBoardOpen && <PublicBoardSheet companyId={companyId} posts={list.data ?? []} onClose={() => setPublicBoardOpen(false)} />}
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


const WIZARD_STEPS = ["Type", "Details", "Schedule & location", "Pay, openings & audience"] as const;

function ChoiceCard({ selected, disabled, onClick, title, body, icon: Icon, testId }: {
  selected: boolean; disabled?: boolean; onClick: () => void; title: string; body: string; icon: React.FC<{ className?: string }>; testId: string;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} data-testid={testId}
      className={cn("text-left rounded-md border p-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        selected ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "hover:border-primary/40")}>
      <p className="flex items-center gap-2 font-medium text-sm"><Icon className="h-4 w-4" />{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{body}</p>
    </button>
  );
}

const SCHEDULE_HELP: Record<WorkerClassification, Partial<Record<ScheduleType, string>>> = {
  contractor: {
    one_time: "A single project. Closes when its award capacity is reached.",
    recurring: "Repeating service work. Can stay open after multiple awards.",
    part_time: "A part-time contractor engagement. Multiple awards if you set more than one opening.",
    full_time: "A full-time contractor engagement. Multiple awards if you set more than one opening.",
  },
  employee: {
    part_time: "A part-time employee position. Stays open until every opening is filled.",
    full_time: "A full-time employee position. Stays open until every opening is filled.",
  },
};

function PostEditorDialog({ post, companyId, onClose, onSaved }: {
  post: JobPost | null; companyId: string | null; onClose: () => void; onSaved: (p: JobPost) => void;
}) {
  const { toast } = useToast();
  const initial = useMemo(() => (post ? formFromPost(post) : null), [post]);
  const [form, setForm] = useState<PostForm>(() => formFromPost(post));
  const [step, setStep] = useState(post ? 1 : 0);
  const [ack, setAck] = useState(false);
  const set = <K extends keyof PostForm>(k: K, v: PostForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const isLive = post?.status === "published";
  const classificationLocked = !!post && post.status !== "draft";
  const cls = form.workerClassification;
  const employee = cls === "employee";
  const recurring = form.scheduleType === "recurring" || form.opportunityType === "recurring_work";
  const indicators = clientEmploymentIndicators({
    workerClassification: cls, scheduleType: form.scheduleType, durationType: form.durationType || (post ? post.durationType : undefined),
    hoursPerWeekMin: form.hoursPerWeekMin, hoursPerWeekMax: form.hoursPerWeekMax, compensationType: form.compensationType,
  });
  const newOnLive = isLive && indicators.some((i) => !(post?.acknowledgedIndicators ?? []).includes(i));

  const chooseClassification = (c: WorkerClassification) => setForm((f) => {
    const sched = schedulesFor(c).includes(f.scheduleType as ScheduleType) ? f.scheduleType : "";
    const comp = compensationTypesFor(c).includes(f.compensationType as any) ? f.compensationType : "undisclosed";
    return { ...f, workerClassification: c, scheduleType: sched, opportunityType: defaultOpportunity(c, sched), compensationType: comp,
      visibility: c === "employee" && f.visibility === "invited_only" ? "all_eligible" : f.visibility };
  });
  const chooseSchedule = (s: ScheduleType) => setForm((f) => ({ ...f, scheduleType: s, opportunityType: defaultOpportunity(f.workerClassification, s),
    durationType: f.durationType || (s === "one_time" ? "fixed_term" : f.workerClassification === "employee" ? "ongoing" : "") }));

  const save = useMutation({
    mutationFn: async () => {
      const payload = postPayload(form, initial, { status: post?.status });
      if (post) {
        if (!Object.keys(payload).length) return post;
        return jobSend<JobPost>("PATCH", `/api/job-posts/${post.id}`, { json: { ...payload, ...(newOnLive ? { acknowledgeClassification: ack } : {}) } });
      }
      return jobSend<JobPost>("POST", "/api/job-posts", { json: { ...payload, ...(companyId ? { companyId } : {}) } });
    },
    onSuccess: (p) => {
      refreshJobBoard();
      toast({ title: post ? "Posting updated" : "Draft posting created", description: post ? undefined : `Publish it when you're ready for ${p.workerClassification === "employee" ? "applications" : "proposals"}.` });
      onSaved(p);
    },
    onError: (e: any) => toast({ title: e?.message || "Could not save posting", variant: "destructive" }),
  });

  const stepValid = step === 0 ? !!cls && !!form.scheduleType
    : step === 1 ? form.title.trim().length > 0
    : true;
  const lastStep = step === WIZARD_STEPS.length - 1;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-job-editor">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">{post ? "Edit posting" : "Create Posting"}{cls && <ClassificationBadge post={{ workerClassification: cls }} />}</DialogTitle>
          <DialogDescription>Step {step + 1} of {WIZARD_STEPS.length}: {WIZARD_STEPS[step]}</DialogDescription>
        </DialogHeader>
        {isLive && (
          <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-2.5 text-xs">
            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>This posting is live. Changes to scope, schedule, pay or openings are recorded and current {employee ? "applicants" : "bidders"} are notified.</span>
          </div>
        )}

        {step === 0 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>1. What are you posting?</Label>
              <div className="grid sm:grid-cols-2 gap-2">
                <ChoiceCard selected={cls === "contractor"} disabled={classificationLocked} onClick={() => chooseClassification("contractor")} icon={HardHat}
                  title="Contractor Work" body="Independent contractors send proposals. Awarding creates a contractor proposal, then a contract." testId="choice-classification-contractor" />
                <ChoiceCard selected={cls === "employee"} disabled={classificationLocked} onClick={() => chooseClassification("employee")} icon={BadgeCheck}
                  title="Employee Position" body="People apply. You review, interview and hire. No proposals, contracts or contractor invoices." testId="choice-classification-employee" />
              </div>
              {classificationLocked && <p className="text-xs text-muted-foreground">Classification can't change after a posting is published. Close it and create a new posting instead.</p>}
            </div>
            {cls && (
              <div className="space-y-2">
                <Label>2. Schedule</Label>
                <div className="grid sm:grid-cols-2 gap-2">
                  {schedulesFor(cls).map((s) => (
                    <ChoiceCard key={s} selected={form.scheduleType === s} onClick={() => chooseSchedule(s)} icon={CalendarClock}
                      title={SCHEDULE_LABEL[s]} body={SCHEDULE_HELP[cls][s] ?? ""} testId={`choice-schedule-${s}`} />
                  ))}
                </div>
              </div>
            )}
            {cls === "contractor" && form.scheduleType && opportunityChoicesFor(cls, form.scheduleType).length > 1 && (
              <div className="space-y-1">
                <Label>Post as</Label>
                <Select value={form.opportunityType || "project"} onValueChange={(v) => set("opportunityType", v as PostForm["opportunityType"])}>
                  <SelectTrigger data-testid="select-job-opportunity"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="project">Project — closes at its award capacity</SelectItem>
                    <SelectItem value="recurring_work">Recurring work — can stay open after awards</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{CLASSIFICATION_NOTICE}</p>
            <ClassificationWarning indicators={indicators} />
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <div><Label>Title *</Label><Input value={form.title} maxLength={200} onChange={(e) => set("title", e.target.value)} data-testid="input-job-title" /></div>
            <div><Label>Summary</Label><Textarea rows={2} value={form.summary} onChange={(e) => set("summary", e.target.value)} placeholder="One or two sentences shown in the list" data-testid="input-job-summary" /></div>
            <div><Label>{employee ? "Role description" : "Scope of work"}</Label><Textarea rows={5} value={form.scopeOfWork} onChange={(e) => set("scopeOfWork", e.target.value)} data-testid="input-job-scope" /></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label>{employee ? "Responsibilities & requirements" : "Requirements"}</Label><Textarea rows={3} value={form.requirements} onChange={(e) => set("requirements", e.target.value)} /></div>
              {employee
                ? <div><Label>Experience requirements</Label><Textarea rows={3} value={form.experienceRequirements} onChange={(e) => set("experienceRequirements", e.target.value)} data-testid="input-job-experience" /></div>
                : <div><Label>Deliverables</Label><Textarea rows={3} value={form.deliverables} onChange={(e) => set("deliverables", e.target.value)} /></div>}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label>Required skills</Label><Input value={form.requiredSkills} onChange={(e) => set("requiredSkills", e.target.value)} placeholder="Comma-separated, e.g. QuickBooks, Payroll" data-testid="input-job-skills" /></div>
              {!employee && <div><Label>Experience requirements</Label><Input value={form.experienceRequirements} onChange={(e) => set("experienceRequirements", e.target.value)} /></div>}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>Work location</Label>
                <Select value={form.workLocationType} onValueChange={(v) => set("workLocationType", v)}>
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
            {recurring && (
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>Frequency{form.scheduleType === "recurring" ? " *" : ""}</Label>
                  <Select value={form.recurrenceFrequency} onValueChange={(v) => set("recurrenceFrequency", v)}>
                    <SelectTrigger data-testid="select-job-frequency"><SelectValue placeholder="Choose" /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(FREQUENCY_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Recurrence details</Label><Input value={form.recurrenceDescription} onChange={(e) => set("recurrenceDescription", e.target.value)} placeholder="e.g. first Monday of each month" /></div>
              </div>
            )}
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <Label>Duration</Label>
                <Select value={form.durationType || (form.scheduleType === "one_time" ? "fixed_term" : "ongoing")} onValueChange={(v) => set("durationType", v)}>
                  <SelectTrigger data-testid="select-job-duration"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed_term">Fixed term</SelectItem>
                    <SelectItem value="ongoing">Ongoing</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Hours / week (min)</Label><Input inputMode="decimal" value={form.hoursPerWeekMin} onChange={(e) => set("hoursPerWeekMin", e.target.value)} data-testid="input-job-hours-min" /></div>
              <div><Label>Hours / week (max)</Label><Input inputMode="decimal" value={form.hoursPerWeekMax} onChange={(e) => set("hoursPerWeekMax", e.target.value)} data-testid="input-job-hours-max" /></div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div><Label>Start date</Label><Input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} /></div>
              <div>
                <Label>{form.opportunityType === "recurring_work" ? "End date (closes posting)" : "End date"}</Label>
                <Input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} data-testid="input-job-end-date" />
              </div>
              <div><Label>{employee ? "Application deadline" : "Proposals due"}</Label><Input type="datetime-local" value={form.applicationDeadline} onChange={(e) => set("applicationDeadline", e.target.value)} data-testid="input-job-deadline" /></div>
            </div>
            <ClassificationWarning indicators={indicators} />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <Label>Compensation</Label>
                <Select value={form.compensationType} onValueChange={(v) => set("compensationType", v)}>
                  <SelectTrigger data-testid="select-job-compensation-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {compensationTypesFor(cls).map((c) => <SelectItem key={c} value={c}>{COMPENSATION_LABEL[c]}{c === "fixed_bid" ? " (contractors quote)" : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {form.compensationType !== "undisclosed" && (
                <>
                  <div><Label>{form.compensationType === "range" ? "Minimum *" : "Minimum"}</Label><Input inputMode="decimal" value={form.compensationMin} onChange={(e) => set("compensationMin", e.target.value)} data-testid="input-job-comp-min" /></div>
                  <div><Label>{form.compensationType === "range" ? "Maximum *" : form.compensationType === "fixed_bid" ? "Budget (max)" : "Maximum"}</Label><Input inputMode="decimal" value={form.compensationMax} onChange={(e) => set("compensationMax", e.target.value)} data-testid="input-job-comp-max" /></div>
                </>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label>Currency</Label><Input value={form.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></div>
              {!employee && <div><Label>Payment terms</Label><Input value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} placeholder="e.g. Net 30 after approved invoice" /></div>}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>Number of openings</Label>
                <Input inputMode="numeric" value={form.numberOfOpenings} onChange={(e) => set("numberOfOpenings", e.target.value.replace(/\D/g, ""))}
                  placeholder={form.opportunityType === "recurring_work" ? "Unlimited" : "1"} data-testid="input-job-openings" />
                <p className="text-xs text-muted-foreground mt-1">
                  {employee ? "The position closes when this many applicants are hired." : form.opportunityType === "recurring_work" ? "Leave blank to keep accepting awards." : "The posting closes when this many proposals are awarded."}
                </p>
              </div>
              <div>
                <Label>Who can see it</Label>
                <Select value={form.visibility} onValueChange={(v) => set("visibility", v)}>
                  <SelectTrigger data-testid="select-job-visibility"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_eligible">{employee ? "All active workers" : "All active contractors"}</SelectItem>
                    <SelectItem value="selected_groups">Selected worker groups</SelectItem>
                    {!employee && <SelectItem value="invited_only">Invited contractors only</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.visibility === "selected_groups" && (
              <div>
                <Label>Worker groups *</Label>
                <Input value={form.eligibleGroups} onChange={(e) => set("eligibleGroups", e.target.value)} placeholder="hourly_contractor, invoiced_contractor" />
                <p className="text-xs text-muted-foreground mt-1">Comma-separated worker group codes.</p>
              </div>
            )}
            {employee && <p className="text-xs text-muted-foreground">Add screening questions from the posting's Screening tab after saving.</p>}
            <div className="rounded-md border p-3 space-y-2" data-testid="section-job-public-board">
              <p className="text-sm font-medium flex items-center gap-1.5"><Globe className="h-4 w-4" />Public job board</p>
              <div>
                <Label>Who can see this posting on the public board</Label>
                <Select value={form.publicVisibility} onValueChange={(v) => set("publicVisibility", v as PublicVisibility)}>
                  <SelectTrigger data-testid="select-job-public-visibility"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PUBLIC_VISIBILITY_LABEL) as PublicVisibility[]).map((v) => <SelectItem key={v} value={v}>{PUBLIC_VISIBILITY_LABEL[v]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Public description</Label>
                <Textarea rows={3} value={form.publicDescription} onChange={(e) => set("publicDescription", e.target.value)} placeholder="Only this text is shown publicly — never the internal description" data-testid="input-job-public-description" />
              </div>
              <label className="flex items-center gap-2 text-xs"><Switch checked={form.publicShowCompensation} onCheckedChange={(v) => set("publicShowCompensation", v)} data-testid="switch-job-public-compensation" />Show compensation publicly</label>
              <p className="text-xs text-muted-foreground">Publicly visible: title, public description, classification, schedule, location type, deadline, skills{form.publicShowCompensation ? ", compensation" : ""}. Never shown: internal details, submissions, files or company settings.</p>
            </div>
            <ClassificationWarning indicators={indicators} />
            {newOnLive && (
              <label className="flex items-start gap-2 text-xs rounded-md border p-2.5">
                <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} data-testid="checkbox-classification-ack" />
                <span>I have reviewed these indicators and confirm this work is offered to independent contractors.</span>
              </label>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {step > (post ? 1 : 0) && <Button variant="outline" onClick={() => setStep(step - 1)}><ChevronLeft className="h-4 w-4 mr-1" />Back</Button>}
          <div className="flex-1" />
          {!lastStep && (
            <Button variant={post ? "outline" : "default"} disabled={!stepValid} onClick={() => setStep(step + 1)} data-testid="btn-job-editor-next">
              Next<ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
          {(post || lastStep) && (
            <Button disabled={!form.title.trim() || !cls || !form.scheduleType || save.isPending || (newOnLive && !ack)} onClick={() => save.mutate()} data-testid="btn-job-editor-save">
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
    queryFn: () => jobGet<JobPost>(`/api/job-posts/${postId}`),
  });
  const [confirm, setConfirm] = useState<null | "close" | "archive" | "ack-publish" | "ack-reopen">(null);
  const [ack, setAck] = useState(false);
  const transition = useMutation({
    mutationFn: ({ action, acknowledge }: { action: string; acknowledge?: boolean }) =>
      jobSend<JobPost>("POST", `/api/job-posts/${postId}/${action}`, { json: acknowledge ? { acknowledgeClassification: true } : {} }),
    onSuccess: (p, v) => {
      refreshJobBoard();
      setConfirm(null);
      setAck(false);
      toast({ title: `Posting ${p.status === "published" && v.action === "reopen" ? "reopened" : POST_STATUS_LABEL[p.status].toLowerCase()}` });
    },
    onError: (e: any) => toast({ title: e?.message || "Action failed", variant: "destructive" }),
  });
  const upload = useUpload(() => `/api/job-posts/${postId}/attachments`);
  const remove = useRemove((id) => `/api/job-post-attachments/${id}/remove`);

  const p = post.data;
  const editable = p && (p.status === "draft" || p.status === "paused" || p.status === "published");
  const pending = p ? unacknowledgedIndicators(p) : [];
  const runAction = (action: "publish" | "pause" | "reopen" | "close" | "archive") => {
    if (action === "close" || action === "archive") return setConfirm(action);
    if ((action === "publish" || action === "reopen") && pending.length) return setConfirm(action === "publish" ? "ack-publish" : "ack-reopen");
    transition.mutate({ action });
  };
  const employee = p ? isEmployee(p) : false;

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto" data-testid="sheet-job-admin">
        {!post.data && <SheetTitle className="sr-only">Job posting</SheetTitle>}
        {post.isLoading && <div className="space-y-3 mt-6"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-40 w-full" /></div>}
        {post.error && <div className="mt-6"><LoadProblem error={post.error} /></div>}
        {p && (
          <div className="space-y-4">
            <SheetHeader className="text-left space-y-2">
              <ClassificationBadge post={p} size="lg" />
              <SheetTitle className="pr-8">{p.title}</SheetTitle>
              <PostBadges post={p} />
            </SheetHeader>

            <div className="flex flex-wrap gap-2">
              {editable && <Button size="sm" variant="outline" onClick={() => onEdit(p)} data-testid="btn-job-edit"><Edit className="h-3.5 w-3.5 mr-1" />Edit</Button>}
              {POST_ACTIONS.filter((a) => a.from.includes(p.status)).map((a) => {
                const Icon = POST_ACTION_ICON[a.action];
                return (
                  <Button key={a.action} size="sm" variant={a.action === "publish" || a.action === "reopen" ? "default" : "outline"}
                    disabled={transition.isPending} onClick={() => runAction(a.action)} data-testid={`btn-job-${a.action}`}>
                    <Icon className="h-3.5 w-3.5 mr-1" />{a.label}
                  </Button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-md border p-3">
              <Fact label="Classification" value={`${employee ? "Employee" : "Contractor"} · ${p.workerClassification === "employee" ? "Position" : OPPORTUNITY_LABEL[p.opportunityType]}`} />
              <Fact label="Compensation" value={compensationLabel(p)} />
              <Fact label={employee ? "Hires" : "Awards"} value={capacityLabel(p)} />
              <Fact label={employee ? "Apply by" : "Proposals due"} value={dateTimeLabel(p.applicationDeadline)} />
            </div>
            {!employee && (p.acknowledgedIndicators?.length ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground flex items-center gap-1" data-testid="text-classification-acknowledged">
                <ShieldAlert className="h-3.5 w-3.5" />Classification indicators acknowledged {dateTimeLabel(p.classificationAcknowledgedAt)}: {(p.acknowledgedIndicators ?? []).map((i) => EMPLOYMENT_INDICATOR_LABELS[i] ?? i).join(", ")}
              </p>
            )}
            {p.status === "draft" && <ClassificationWarning indicators={pending} />}
            {p.status === "closed" && p.closeReason && (
              <p className="text-xs text-muted-foreground">Closed {dateTimeLabel(p.closedAt)} · {p.closeReason.replace(/_/g, " ")}</p>
            )}

            <Tabs defaultValue="submissions">
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="submissions" data-testid={employee ? "tab-job-admin-applications" : "tab-job-admin-proposals"}>
                  {employee ? "Applications" : "Proposals"}{p.submissionCounts?.total ? ` (${p.submissionCounts.total})` : ""}
                </TabsTrigger>
                {employee && <TabsTrigger value="screening" data-testid="tab-job-admin-screening">Screening</TabsTrigger>}
                {employee && <TabsTrigger value="applicant-access" data-testid="tab-job-admin-applicant-access">Applicant access</TabsTrigger>}
                <TabsTrigger value="details">Details</TabsTrigger>
                {!employee && <TabsTrigger value="questions" data-testid="tab-job-admin-questions">Questions</TabsTrigger>}
                {!employee && <TabsTrigger value="invitations" data-testid="tab-job-admin-invitations">Invitations</TabsTrigger>}
                <TabsTrigger value="activity" data-testid="tab-job-admin-activity">Activity</TabsTrigger>
              </TabsList>
              <TabsContent value="submissions">
                {employee ? <AdminApplicationsPanel post={p} /> : <AdminBidsPanel post={p} onNavigate={onNavigate} />}
              </TabsContent>
              {employee && <TabsContent value="screening"><ScreeningQuestionsPanel post={p} /></TabsContent>}
              {employee && <TabsContent value="applicant-access"><ApplicantAccessPanel post={p} /></TabsContent>}
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
              {!employee && <TabsContent value="questions"><AdminQuestionsPanel postId={p.id} /></TabsContent>}
              {!employee && <TabsContent value="invitations"><InvitationsPanel post={p} /></TabsContent>}
              <TabsContent value="activity"><ActivityPanel postId={p.id} /></TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>

      {(confirm === "close" || confirm === "archive") && p && (
        <Dialog open onOpenChange={(o) => { if (!o) setConfirm(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirm === "close" ? "Close this posting?" : "Archive this posting?"}</DialogTitle>
              <DialogDescription>
                {confirm === "close"
                  ? `No new ${employee ? "applications" : "proposals"} can be submitted. People with open submissions are notified. You can reopen it later.`
                  : `Archived postings are hidden from the active lists. ${employee ? "Applications" : "Proposals"} and history are kept.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button disabled={transition.isPending} onClick={() => transition.mutate({ action: confirm })} data-testid="btn-job-confirm-transition">
                {transition.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}{confirm === "close" ? "Close posting" : "Archive"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {(confirm === "ack-publish" || confirm === "ack-reopen") && p && (
        <Dialog open onOpenChange={(o) => { if (!o) { setConfirm(null); setAck(false); } }}>
          <DialogContent data-testid="dialog-classification-ack">
            <DialogHeader>
              <DialogTitle>Confirm contractor classification</DialogTitle>
              <DialogDescription>Review these indicators before {confirm === "ack-publish" ? "publishing" : "reopening"}. Your confirmation is recorded with your name and the time.</DialogDescription>
            </DialogHeader>
            <ClassificationWarning indicators={pending} />
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} data-testid="checkbox-classification-ack" />
              <span>I have reviewed these indicators and confirm this work is offered to independent contractors.</span>
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setConfirm(null); setAck(false); }}>Cancel</Button>
              <Button disabled={!ack || transition.isPending} onClick={() => transition.mutate({ action: confirm === "ack-publish" ? "publish" : "reopen", acknowledge: true })} data-testid="btn-classification-ack-confirm">
                {transition.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}{confirm === "ack-publish" ? "Publish" : "Reopen"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Sheet>
  );
}

function PostDetailBody({ post }: { post: JobPost }) {
  const employee = isEmployee(post);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Fact label="Location" value={`${LOCATION_LABEL[post.workLocationType]}${post.locationText ? ` · ${post.locationText}` : ""}`} />
        <Fact label="Schedule" value={`${SCHEDULE_LABEL[post.scheduleType]}${post.recurrenceFrequency ? ` · ${FREQUENCY_LABEL[post.recurrenceFrequency] ?? post.recurrenceFrequency}` : ""}`} />
        <Fact label="Hours" value={hoursLabel(post) ?? "—"} />
        <Fact label="Duration" value={post.durationType === "ongoing" ? "Ongoing" : "Fixed term"} />
        <Fact label="Start" value={dateLabel(post.startDate)} />
        <Fact label="End" value={post.endDate ? dateLabel(post.endDate) : post.durationType === "ongoing" ? "Ongoing" : "—"} />
        <Fact label="Openings" value={post.numberOfOpenings == null ? "Unlimited" : String(post.numberOfOpenings)} />
        {post.visibility && <Fact label="Visibility" value={post.visibility === "invited_only" ? "Invited only" : post.visibility === "selected_groups" ? `Groups: ${(post.eligibleGroups ?? []).join(", ")}` : employee ? "All workers" : "All contractors"} />}
      </div>
      {(post.requiredSkills?.length ?? 0) > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Required skills</p>
          <div className="flex flex-wrap gap-1">{post.requiredSkills!.map((s) => <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-xs">{s}</span>)}</div>
        </div>
      )}
      <TextBlock label="Summary" value={post.summary} />
      <TextBlock label={employee ? "Role description" : "Scope of work"} value={post.scopeOfWork} />
      <TextBlock label="Requirements" value={post.requirements} />
      <TextBlock label="Experience" value={post.experienceRequirements} />
      <TextBlock label="Deliverables" value={post.deliverables} />
      <TextBlock label="Recurrence" value={post.recurrenceDescription} />
      <TextBlock label="Payment terms" value={post.paymentTerms} />
    </div>
  );
}

// ─── Contractor proposal comparison + award ──────────────────────────────────

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
    queryFn: () => jobGet<JobBid[]>(`/api/job-posts/${post.id}/bids`),
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
      toast({ title: { review: "Marked under review", shortlist: "Proposal shortlisted", request_revision: "Revision requested", reject: "Proposal declined" }[v.action] });
    },
    onError: (e: any) => toast({ title: e?.message || "Action failed", variant: "destructive" }),
  });

  const all = bids.data ?? [];
  const rows = showClosed ? all : all.filter((b) => !["withdrawn", "rejected"].includes(b.status));
  const hidden = all.length - rows.length;
  const canAwardPost = post.status === "published" || post.status === "paused";

  if (bids.isLoading) return <Skeleton className="h-32 w-full mt-3" />;
  if (bids.error) return <div className="mt-3"><LoadProblem error={bids.error} /></div>;
  if (!all.length) return <p className="text-sm text-muted-foreground py-6 text-center">No proposals yet.{post.status === "draft" ? " Publish the posting so contractors can send proposals." : ""}</p>;

  return (
    <div className="space-y-2 mt-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{capacityLabel(post)}{post.opportunityType === "recurring_work" && post.status === "published" ? " · can stay open after each award" : ""}</span>
        {(hidden > 0 || showClosed) && (
          <button type="button" className="underline" onClick={() => setShowClosed(!showClosed)}>{showClosed ? "Hide declined/withdrawn" : `Show ${hidden} declined/withdrawn`}</button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Contractors never see each other's proposals.</p>
      <div className="rounded-md border overflow-x-auto">
        <Table data-testid="table-job-bids">
          <TableHeader>
            <TableRow>
              <TableHead>Contractor</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Schedule / timeline</TableHead>
              <TableHead>Availability</TableHead>
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
                <TableCell className="text-xs max-w-[180px]">
                  {b.proposedSchedule ? <p className="line-clamp-2">{b.proposedSchedule}</p> : null}
                  <p className="whitespace-nowrap text-muted-foreground">{dateLabel(b.estimatedStartDate)} → {dateLabel(b.estimatedCompletionDate)}</p>
                </TableCell>
                <TableCell className="text-xs max-w-[140px]"><p className="line-clamp-2">{b.availability || "—"}</p></TableCell>
                <TableCell><BidStatusBadge status={b.status} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 flex-wrap">
                    <Button size="sm" variant="ghost" onClick={() => setDetail(b)} aria-label="View proposal"><Eye className="h-3.5 w-3.5" /></Button>
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
          title={noteFor.action === "reject" ? "Decline this proposal?" : "Request a revision"}
          description={noteFor.action === "reject"
            ? "The contractor is told their proposal was not selected. Your note is shown to them."
            : "The contractor can edit and resubmit. Your note is shown to them."}
          required={noteFor.action === "request_revision"}
          confirmLabel={noteFor.action === "reject" ? "Decline proposal" : "Request revision"}
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

function NoteDialog({ title, description, required, confirmLabel, pending, onCancel, onConfirm, placeholder }: {
  title: string; description: string; required: boolean; confirmLabel: string; pending: boolean;
  onCancel: () => void; onConfirm: (note: string) => void; placeholder?: string;
}) {
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <Textarea rows={4} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder={placeholder ?? (required ? "What should the contractor change?" : "Optional note")} data-testid="input-review-note" />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={pending || (required && !note.trim())} onClick={() => onConfirm(note.trim())} data-testid="btn-review-confirm">
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
  const max = post.numberOfOpenings ?? null;
  const willClose = max != null && (post.filledCount ?? 0) + 1 >= max;
  const award = useMutation({
    mutationFn: () => jobSend<{ replayed: boolean; proposalId: string | null; post: JobPost }>(
      "POST", `/api/contractor-job-bids/${bid.id}/award`, { json: {}, headers: { "Idempotency-Key": key } }),
    onSuccess: (r) => {
      refreshJobBoard();
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] });
      toast({
        title: r.replayed ? "Already awarded" : "Proposal awarded",
        description: `A draft contractor proposal was created for ${bid.contractorName || "the contractor"}.${r.post?.status === "closed" ? " The posting is now closed." : ""}`,
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
            This creates a draft contractor proposal in Proposals from the submitted terms ({bidPrice(bid, post.currency || "USD")}). Contract and invoicing follow the normal proposal workflow.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border p-3 text-sm space-y-1">
          <p>{capacityLabel(post)} → {(post.filledCount ?? 0) + 1}{max != null ? ` of ${max}` : ""}</p>
          <p className={cn("text-xs", willClose ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
            {willClose ? "The posting will close after this award and other contractors will be notified." : "The posting stays open for additional awards."}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={award.isPending} onClick={onClose}>Cancel</Button>
          <Button disabled={award.isPending} onClick={() => award.mutate()} data-testid="btn-job-award-confirm">
            {award.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}<Award className="h-4 w-4 mr-1" />Award
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
          <DialogTitle className="flex items-center gap-2 flex-wrap">{bid.contractorName || "Proposal"} <BidStatusBadge status={bid.status} /></DialogTitle>
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
          <TextBlock label="Scope & deliverables" value={bid.scopeAndDeliverables} />
          <TextBlock label="Proposed schedule" value={bid.proposedSchedule} />
          <TextBlock label="Availability" value={bid.availability} />
          <TextBlock label="Recurrence terms" value={bid.recurrenceTerms} />
          <TextBlock label="Assumptions" value={bid.assumptions} />
          <TextBlock label="Exclusions" value={bid.exclusions} />
          <TextBlock label="Revision requested" value={bid.revisionRequestNote} />
          <TextBlock label="Decline note" value={bid.rejectionReason} />
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Supporting documents</p>
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

// ─── Employee applications: comparison, hiring, conversion ───────────────────

type ApplicationStep = "review" | "interview" | "offer" | "hire" | "reject";
const APPLICATION_STEP_LABEL: Record<ApplicationStep, string> = { review: "Mark under review", interview: "Move to interview", offer: "Extend offer", hire: "Mark hired", reject: "Not selected" };

function AdminApplicationsPanel({ post }: { post: JobPost }) {
  const { toast } = useToast();
  const apps = useQuery<JobApplication[], JobBoardError>({
    queryKey: ["job-board", "applications", post.id],
    queryFn: () => jobGet<JobApplication[]>(`/api/job-posts/${post.id}/applications`),
  });
  const [showClosed, setShowClosed] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<JobApplication | null>(null);
  const [hireFor, setHireFor] = useState<JobApplication | null>(null);

  const step = useMutation({
    mutationFn: ({ app, action, note }: { app: JobApplication; action: ApplicationStep; note?: string }) =>
      jobSend<JobApplication>("POST", `/api/employment-applications/${app.id}/${action}`, { json: note ? { note } : {} }),
    onSuccess: (_a, v) => {
      refreshJobBoard();
      setRejectFor(null);
      setHireFor(null);
      toast({ title: { review: "Marked under review", interview: "Moved to interview", offer: "Offer extended", hire: "Applicant hired", reject: "Marked not selected" }[v.action] });
    },
    onError: (e: any) => toast({ title: e?.message || "Action failed", variant: "destructive" }),
  });

  const all = apps.data ?? [];
  const rows = showClosed ? all : all.filter((a) => !["withdrawn", "rejected"].includes(a.status));
  const hidden = all.length - rows.length;
  const canHirePost = post.status === "published" || post.status === "paused";

  if (apps.isLoading) return <Skeleton className="h-32 w-full mt-3" />;
  if (apps.error) return <div className="mt-3"><LoadProblem error={apps.error} /></div>;
  if (!all.length) return <p className="text-sm text-muted-foreground py-6 text-center">No applications yet.{post.status === "draft" ? " Publish the position so people can apply." : ""}</p>;

  const stepButtons = (a: JobApplication, compact: boolean) => (["review", "interview", "offer"] as const).filter((s) => canDoApplication(s, a.status)).map((s) => (
    <Button key={s} size="sm" variant="outline" disabled={step.isPending} onClick={() => step.mutate({ app: a, action: s })} data-testid={`btn-application-${s}-${a.id}`}>
      {compact ? APPLICATION_STEP_LABEL[s].split(" ").slice(-1)[0].replace(/^./, (c) => c.toUpperCase()) : APPLICATION_STEP_LABEL[s]}
    </Button>
  ));

  return (
    <div className="space-y-2 mt-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{capacityLabel(post)} · stays open until every opening is filled</span>
        {(hidden > 0 || showClosed) && (
          <button type="button" className="underline" onClick={() => setShowClosed(!showClosed)}>{showClosed ? "Hide not selected/withdrawn" : `Show ${hidden} not selected/withdrawn`}</button>
        )}
      </div>
      <p className="text-xs text-muted-foreground flex items-center gap-1"><Lock className="h-3 w-3" />Applications and résumés are private HR records. Applicants never see each other; every résumé download is logged.</p>
      <div className="rounded-md border overflow-x-auto">
        <Table data-testid="table-job-applications">
          <TableHeader>
            <TableRow>
              <TableHead>Applicant</TableHead>
              <TableHead>Availability</TableHead>
              <TableHead>Desired pay</TableHead>
              <TableHead>Docs</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.id} data-testid={`row-job-application-${a.id}`}>
                <TableCell>
                  <button type="button" className="font-medium hover:underline text-left" onClick={() => setDetailId(a.id)}>{a.applicantName || "Applicant"}</button>
                  <p className="text-xs text-muted-foreground">Applied {dateLabel(a.submittedAt)}</p>
                </TableCell>
                <TableCell className="text-xs max-w-[160px]"><p className="line-clamp-2">{a.availability || "—"}</p></TableCell>
                <TableCell className="text-xs whitespace-nowrap">{a.desiredCompensation || "—"}</TableCell>
                <TableCell className="text-xs">{a.documentCount ?? 0}</TableCell>
                <TableCell><ApplicationStatusBadge status={a.status} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 flex-wrap">
                    <Button size="sm" variant="ghost" onClick={() => setDetailId(a.id)} aria-label="View application"><Eye className="h-3.5 w-3.5" /></Button>
                    {stepButtons(a, true)}
                    {canDoApplication("hire", a.status) && canHirePost && (
                      <Button size="sm" onClick={() => setHireFor(a)} data-testid={`btn-application-hire-${a.id}`}><UserCheck className="h-3.5 w-3.5 mr-1" />Hire</Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {detailId && (
        <ApplicationDetailDialog applicationId={detailId} onClose={() => setDetailId(null)}
          actions={(a) => (
            <>
              {stepButtons(a, false)}
              {canDoApplication("reject", a.status) && <Button size="sm" variant="outline" className="text-destructive" onClick={() => setRejectFor(a)} data-testid="btn-application-reject"><Ban className="h-3.5 w-3.5 mr-1" />Not selected</Button>}
              {canDoApplication("hire", a.status) && canHirePost && <Button size="sm" onClick={() => setHireFor(a)}><UserCheck className="h-3.5 w-3.5 mr-1" />Hire</Button>}
            </>
          )} />
      )}
      {rejectFor && (
        <NoteDialog title="Mark as not selected?" description="The applicant is told they were not selected. Your note is kept in the HR record and is not shown to the applicant."
          required={false} confirmLabel="Not selected" pending={step.isPending} placeholder="Internal note (optional)"
          onCancel={() => setRejectFor(null)} onConfirm={(note) => step.mutate({ app: rejectFor, action: "reject", note })} />
      )}
      {hireFor && (
        <Dialog open onOpenChange={(o) => { if (!o && !step.isPending) setHireFor(null); }}>
          <DialogContent data-testid="dialog-application-hire">
            <DialogHeader>
              <DialogTitle>Hire {hireFor.applicantName || "this applicant"}?</DialogTitle>
              <DialogDescription>
                This fills one opening ({capacityLabel(post)} → {(post.filledCount ?? 0) + 1}{post.numberOfOpenings != null ? ` of ${post.numberOfOpenings}` : ""}). It does not create a contractor proposal, contract or invoice, and it does not create a worker record — you'll do that as a separate step.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" disabled={step.isPending} onClick={() => setHireFor(null)}>Cancel</Button>
              <Button disabled={step.isPending} onClick={() => step.mutate({ app: hireFor, action: "hire" })} data-testid="btn-application-hire-confirm">
                {step.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}<UserCheck className="h-4 w-4 mr-1" />Mark hired
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ApplicationDetailDialog({ applicationId, onClose, actions }: { applicationId: string; onClose: () => void; actions: (a: JobApplication) => React.ReactNode }) {
  const app = useQuery<JobApplication, JobBoardError>({
    queryKey: ["job-board", "application", applicationId],
    queryFn: () => jobGet<JobApplication>(`/api/employment-applications/${applicationId}`),
  });
  const [convert, setConvert] = useState(false);
  const a = app.data;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-job-application-detail">
        {!a ? (
          <>
            <DialogHeader><DialogTitle>Application</DialogTitle></DialogHeader>
            {app.error ? <LoadProblem error={app.error} /> : <Skeleton className="h-40 w-full" />}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">{a.applicantName || "Applicant"} <ApplicationStatusBadge status={a.status} /></DialogTitle>
              <DialogDescription>Applied {dateTimeLabel(a.submittedAt)}{a.consentAcceptedAt ? ` · acknowledgements accepted (${a.consentVersion})` : ""}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
              <Fact label="Availability" value={a.availability || "—"} />
              <Fact label="Desired compensation" value={a.desiredCompensation || "—"} />
            </div>
            <div className="space-y-3">
              <TextBlock label="Cover message" value={a.coverMessage} />
              <TextBlock label="Employment history & qualifications" value={a.qualifications} />
              {(a.answers?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Screening answers</p>
                  <dl className="space-y-1 text-sm">
                    {a.answers!.map((x) => <div key={x.questionId}><dt className="text-xs text-muted-foreground">{x.prompt}</dt><dd>{x.answer ?? "—"}</dd></div>)}
                  </dl>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Résumé & documents (private — downloads are logged)</p>
                <HrDocumentList items={a.documents ?? []} />
              </div>
              {a.rejectionReason && <TextBlock label="Internal note" value={a.rejectionReason} />}
              {a.status === "hired" && (
                <div className="rounded-md border border-green-300 p-3 text-sm space-y-2" data-testid="panel-application-hired">
                  <p className="flex items-center gap-2 font-medium"><CheckCircle className="h-4 w-4 text-green-600" />Hired {dateLabel(a.hiredAt)}</p>
                  {a.convertedWorkerId ? (
                    <p className="text-xs text-muted-foreground">Employee worker record created {dateLabel(a.convertedAt)}. Complete onboarding from Workers to activate it.</p>
                  ) : (
                    <Button size="sm" onClick={() => setConvert(true)} data-testid="btn-application-convert"><UserPlus className="h-3.5 w-3.5 mr-1" />Create employee record</Button>
                  )}
                </div>
              )}
            </div>
            <DialogFooter className="flex-wrap gap-2 sm:gap-2">{actions(a)}</DialogFooter>
          </>
        )}
      </DialogContent>
      {convert && a && <ConvertToWorkerDialog app={a} onClose={() => setConvert(false)} />}
    </Dialog>
  );
}

/** Explicit, final step: creates an EMPLOYEE worker record. The classification is fixed by the posting. */
function ConvertToWorkerDialog({ app, onClose }: { app: JobApplication; onClose: () => void }) {
  const { toast } = useToast();
  const [confirmed, setConfirmed] = useState(false);
  const convert = useMutation({
    mutationFn: () => jobSend<{ workerId: string }>("POST", `/api/employment-applications/${app.id}/convert-to-worker`, { json: { confirm: true, workerType: "employee" } }),
    onSuccess: () => { refreshJobBoard(); toast({ title: "Employee record created", description: "It starts inactive. Complete onboarding to activate it." }); onClose(); },
    onError: (e: any) => toast({ title: e?.message || "Could not create the worker record", variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !convert.isPending) onClose(); }}>
      <DialogContent data-testid="dialog-application-convert">
        <DialogHeader>
          <DialogTitle>Create an employee record?</DialogTitle>
          <DialogDescription>This is the final step and can't be undone from here.</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border p-3 text-sm space-y-1">
          <p><span className="text-muted-foreground">Name:</span> {app.applicantName || "Applicant"}</p>
          <p className="flex items-center gap-2"><span className="text-muted-foreground">Classification:</span> <ClassificationBadge post={{ workerClassification: "employee" }} /> <span className="text-xs text-muted-foreground">(fixed by the posting)</span></p>
          <p className="text-xs text-muted-foreground">The record starts inactive and is not included in payroll until you complete onboarding. No contractor proposal, contract or invoice is created.</p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} data-testid="checkbox-convert-confirm" />
          <span>Create an employee worker record for this hired applicant.</span>
        </label>
        <DialogFooter>
          <Button variant="outline" disabled={convert.isPending} onClick={onClose}>Cancel</Button>
          <Button disabled={!confirmed || convert.isPending} onClick={() => convert.mutate()} data-testid="btn-application-convert-confirm">
            {convert.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Create employee record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScreeningQuestionsPanel({ post }: { post: JobPost }) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [answerType, setAnswerType] = useState<ScreeningQuestion["answerType"]>("text");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);
  const add = useMutation({
    mutationFn: () => jobSend("POST", `/api/job-posts/${post.id}/screening-questions`, {
      json: { prompt: prompt.trim(), answerType, options: answerType === "choice" ? options.split(",").map((s) => s.trim()).filter(Boolean) : [], required, position: (post.screeningQuestions?.length ?? 0) },
    }),
    onSuccess: () => { refreshJobBoard(); setPrompt(""); setOptions(""); setRequired(false); toast({ title: "Question added" }); },
    onError: (e: any) => toast({ title: e?.message || "Could not add question", variant: "destructive" }),
  });
  const archive = useMutation({
    mutationFn: (id: string) => jobSend("POST", `/api/job-screening-questions/${id}/archive`, { json: {} }),
    onSuccess: () => { refreshJobBoard(); toast({ title: "Question removed" }); },
    onError: (e: any) => toast({ title: e?.message || "Could not remove question", variant: "destructive" }),
  });
  const editable = ["draft", "published", "paused"].includes(post.status);
  const qs = post.screeningQuestions ?? [];
  return (
    <div className="space-y-3 mt-3">
      {qs.length === 0 ? <p className="text-sm text-muted-foreground">No screening questions.</p> : (
        <ul className="divide-y rounded-md border">
          {qs.map((q) => (
            <li key={q.id} className="flex items-start gap-2 px-3 py-2 text-sm">
              <ListChecks className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p>{q.prompt}{q.required && <span className="text-destructive"> *</span>}</p>
                <p className="text-xs text-muted-foreground">{q.answerType === "yes_no" ? "Yes / No" : q.answerType === "choice" ? `Choice: ${q.options.join(", ")}` : q.answerType === "number" ? "Number" : "Text"}</p>
              </div>
              {editable && <Button size="sm" variant="ghost" aria-label="Remove question" disabled={archive.isPending} onClick={() => archive.mutate(q.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <Card><CardContent className="p-3 space-y-2">
          <Label>Add a question</Label>
          <Input value={prompt} maxLength={1000} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Are you available on weekends?" data-testid="input-screening-prompt" />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={answerType} onValueChange={(v) => setAnswerType(v as ScreeningQuestion["answerType"])}>
              <SelectTrigger className="h-9 w-[140px]" data-testid="select-screening-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="yes_no">Yes / No</SelectItem>
                <SelectItem value="choice">Choice</SelectItem>
                <SelectItem value="number">Number</SelectItem>
              </SelectContent>
            </Select>
            {answerType === "choice" && <Input className="h-9 flex-1 min-w-[160px]" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Options, comma-separated" />}
            <label className="flex items-center gap-2 text-xs"><Switch checked={required} onCheckedChange={setRequired} />Required</label>
            <Button size="sm" disabled={!prompt.trim() || add.isPending} onClick={() => add.mutate()} data-testid="btn-screening-add"><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}

// ─── Public board (administrator) ────────────────────────────────────────────

interface BoardSettings {
  boardEnabled: boolean; codeHint: string | null; codeRotatedAt: string | null; displayName: string | null; tagline: string | null;
  brandColor: string | null; acceptContractorRequests: boolean; acceptApplicantRequests: boolean;
}
interface AccessRequestRow {
  id: string; kind: "contractor" | "applicant"; status: string; firstName: string; lastName: string; email: string; phone?: string | null;
  message?: string | null; jobPostId?: string | null; jobTitle?: string | null; createdAt: string; decisionNote?: string | null;
}
interface ApplicantRow { id: string; email: string; firstName?: string | null; lastName?: string | null; status: string; activatedAt?: string | null; activeGrants?: number }

function OneTimeSecret({ label, value, notice, testId }: { label: string; value: string; notice: string; testId: string }) {
  const { toast } = useToast();
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2" data-testid={testId}>
      <p className="text-xs font-medium flex items-center gap-1"><KeyRound className="h-3.5 w-3.5" />{label}</p>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} data-testid={`${testId}-value`} />
        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(value).then(() => toast({ title: "Copied" }), () => {}); }}><Copy className="h-3.5 w-3.5" /></Button>
      </div>
      <p className="text-xs text-muted-foreground">{notice}</p>
    </div>
  );
}

function PublicBoardSheet({ companyId, posts, onClose }: { companyId: string | null; posts: JobPost[]; onClose: () => void }) {
  const { toast } = useToast();
  const qs = companyQs(companyId);
  const settings = useQuery<BoardSettings, JobBoardError>({ queryKey: ["job-board", "public-settings", companyId], queryFn: () => jobGet(`/api/job-board/settings${qs}`) });
  const requests = useQuery<AccessRequestRow[], JobBoardError>({ queryKey: ["job-board", "access-requests", companyId], queryFn: () => jobGet(`/api/job-board/access-requests${qs}`) });
  const applicants = useQuery<ApplicantRow[], JobBoardError>({ queryKey: ["job-board", "applicants", companyId], queryFn: () => jobGet(`/api/job-board/applicants${qs}`) });
  const [draft, setDraft] = useState<Partial<BoardSettings>>({});
  const [newCode, setNewCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ url: string; notice: string } | null>(null);
  const [approveFor, setApproveFor] = useState<AccessRequestRow | null>(null);
  const [denyFor, setDenyFor] = useState<AccessRequestRow | null>(null);
  const s = { ...(settings.data ?? {}), ...draft } as BoardSettings;
  const withCo = (b: Record<string, unknown>) => (companyId ? { ...b, companyId } : b);

  const save = useMutation({
    mutationFn: (b: Partial<BoardSettings>) => jobSend<BoardSettings>("PATCH", "/api/job-board/settings", { json: withCo(b) }),
    onSuccess: () => { refreshJobBoard(); setDraft({}); toast({ title: "Board settings saved" }); },
    onError: (e: any) => toast({ title: e?.message || "Could not save", variant: "destructive" }),
  });
  const rotate = useMutation({
    mutationFn: () => jobSend<{ code: string }>("POST", "/api/job-board/settings/rotate-code", { json: withCo({}) }),
    onSuccess: (r) => { refreshJobBoard(); setNewCode(r.code); },
    onError: (e: any) => toast({ title: e?.message || "Could not generate a code", variant: "destructive" }),
  });
  const approve = useMutation({
    mutationFn: ({ req, postingIds }: { req: AccessRequestRow; postingIds: string[] }) =>
      jobSend<{ kind: string; activationUrl?: string | null; deliveryNotice?: string | null; nextStep?: string }>("POST", `/api/job-board/access-requests/${req.id}/approve`, { json: { postingIds } }),
    onSuccess: (r) => {
      refreshJobBoard(); setApproveFor(null);
      if (r.activationUrl) setSecret({ url: r.activationUrl, notice: r.deliveryNotice || "" });
      toast({ title: "Request approved", description: r.kind === "contractor" ? r.nextStep : undefined });
    },
    onError: (e: any) => toast({ title: e?.message || "Could not approve", variant: "destructive" }),
  });
  const deny = useMutation({
    mutationFn: ({ req, note }: { req: AccessRequestRow; note: string }) => jobSend("POST", `/api/job-board/access-requests/${req.id}/deny`, { json: { note } }),
    onSuccess: () => { refreshJobBoard(); setDenyFor(null); toast({ title: "Request denied" }); },
    onError: (e: any) => toast({ title: e?.message || "Could not deny", variant: "destructive" }),
  });
  const applicantAction = useMutation({
    mutationFn: ({ a, action }: { a: ApplicantRow; action: "disable" | "reissue-activation" }) =>
      jobSend<{ activationUrl?: string; deliveryNotice?: string }>("POST", `/api/job-board/applicants/${a.id}/${action}`, { json: {} }),
    onSuccess: (r, v) => {
      refreshJobBoard();
      if (r.activationUrl) setSecret({ url: r.activationUrl, notice: r.deliveryNotice || "" });
      toast({ title: v.action === "disable" ? "Applicant access disabled" : "New activation link created" });
    },
    onError: (e: any) => toast({ title: e?.message || "Action failed", variant: "destructive" }),
  });
  const pending = (requests.data ?? []).filter((r) => r.status === "pending");
  const decided = (requests.data ?? []).filter((r) => r.status !== "pending").slice(0, 20);
  const dirty = Object.keys(draft).length > 0;

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto" data-testid="sheet-public-board">
        <SheetHeader className="text-left"><SheetTitle className="flex items-center gap-2"><Globe className="h-5 w-5" />Public job board</SheetTitle></SheetHeader>
        {settings.error ? <div className="mt-4"><LoadProblem error={settings.error} /></div> : (
          <Tabs defaultValue="requests" className="mt-4">
            <TabsList>
              <TabsTrigger value="requests" data-testid="tab-public-requests"><Inbox className="h-3.5 w-3.5 mr-1" />Access requests{pending.length ? ` (${pending.length})` : ""}</TabsTrigger>
              <TabsTrigger value="applicants" data-testid="tab-public-applicants">Applicants</TabsTrigger>
              <TabsTrigger value="settings" data-testid="tab-public-settings">Settings</TabsTrigger>
            </TabsList>

            {secret && <div className="mt-3"><OneTimeSecret label="One-time activation link" value={secret.url} notice={secret.notice} testId="secret-activation-link" /></div>}

            <TabsContent value="settings" className="space-y-4">
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-sm font-medium">Board code</p>
                <p className="text-xs text-muted-foreground">The code only helps people find your board — it never signs anyone in or lets them submit. Rotating it immediately retires the old one.</p>
                <p className="text-sm">{s.codeHint ? <>Current code ends in <span className="font-mono">…{s.codeHint}</span> · set {dateLabel(s.codeRotatedAt)}</> : "No code yet."}</p>
                <Button size="sm" variant="outline" disabled={rotate.isPending} onClick={() => rotate.mutate()} data-testid="btn-rotate-board-code"><KeyRound className="h-3.5 w-3.5 mr-1" />{s.codeHint ? "Rotate code" : "Generate code"}</Button>
                {newCode && <OneTimeSecret label="New board code" value={newCode} notice="Copy this code now — it is shown only once. Share it with people you want to find your board at /jobs." testId="secret-board-code" />}
              </div>
              <div className="rounded-md border p-3 space-y-3">
                <label className="flex items-center gap-2 text-sm"><Switch checked={!!s.boardEnabled} onCheckedChange={(v) => setDraft({ ...draft, boardEnabled: v })} data-testid="switch-board-enabled" />Board enabled</label>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div><Label>Display name</Label><Input value={s.displayName ?? ""} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} data-testid="input-board-display-name" /></div>
                  <div><Label>Brand colour</Label><Input value={s.brandColor ?? ""} placeholder="#1A2B3C" onChange={(e) => setDraft({ ...draft, brandColor: e.target.value })} /></div>
                </div>
                <div><Label>Tagline</Label><Input value={s.tagline ?? ""} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} /></div>
                <label className="flex items-center gap-2 text-sm"><Switch checked={!!s.acceptApplicantRequests} onCheckedChange={(v) => setDraft({ ...draft, acceptApplicantRequests: v })} data-testid="switch-accept-applicants" />Accept employment access requests</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={!!s.acceptContractorRequests} onCheckedChange={(v) => setDraft({ ...draft, acceptContractorRequests: v })} data-testid="switch-accept-contractors" />Accept contractor access requests</label>
                <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)} data-testid="btn-save-board-settings">Save settings</Button>
              </div>
            </TabsContent>

            <TabsContent value="requests" className="space-y-3">
              {requests.isLoading ? <Skeleton className="h-20 w-full" /> : pending.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">No pending requests.</p> : (
                <div className="rounded-md border overflow-x-auto">
                  <Table data-testid="table-access-requests">
                    <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Wants</TableHead><TableHead>Posting</TableHead><TableHead>Received</TableHead><TableHead className="text-right">Decision</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {pending.map((r) => (
                        <TableRow key={r.id} data-testid={`row-access-request-${r.id}`}>
                          <TableCell><p className="font-medium">{r.firstName} {r.lastName}</p><p className="text-xs text-muted-foreground">{r.email}</p>{r.message && <p className="text-xs mt-1 line-clamp-2">“{r.message}”</p>}</TableCell>
                          <TableCell><ClassificationBadge post={{ workerClassification: r.kind === "contractor" ? "contractor" : "employee" }} /></TableCell>
                          <TableCell className="text-xs">{r.jobTitle ?? "—"}</TableCell>
                          <TableCell className="text-xs">{dateLabel(r.createdAt)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDenyFor(r)} data-testid={`btn-deny-request-${r.id}`}><Ban className="h-3.5 w-3.5 mr-1" />Deny</Button>
                              <Button size="sm" onClick={() => setApproveFor(r)} data-testid={`btn-approve-request-${r.id}`}><CheckCircle className="h-3.5 w-3.5 mr-1" />Approve</Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {decided.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Recent decisions</p>
                  <ul className="divide-y rounded-md border text-sm">
                    {decided.map((r) => <li key={r.id} className="px-3 py-1.5 flex justify-between gap-2"><span>{r.firstName} {r.lastName} · {r.kind}</span><span className="text-xs text-muted-foreground">{r.status}</span></li>)}
                  </ul>
                </div>
              )}
            </TabsContent>

            <TabsContent value="applicants">
              {applicants.isLoading ? <Skeleton className="h-20 w-full" /> : !(applicants.data ?? []).length ? <p className="text-sm text-muted-foreground py-4 text-center">No applicant accounts yet.</p> : (
                <ul className="divide-y rounded-md border" data-testid="list-applicants">
                  {applicants.data!.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1"><p className="font-medium">{`${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() || a.email}</p><p className="text-xs text-muted-foreground">{a.email} · {a.status.replace(/_/g, " ")}{a.activeGrants ? ` · ${a.activeGrants} granted posting${a.activeGrants > 1 ? "s" : ""}` : ""}</p></div>
                      {a.status === "pending_activation" && <Button size="sm" variant="outline" disabled={applicantAction.isPending} onClick={() => applicantAction.mutate({ a, action: "reissue-activation" })}>New activation link</Button>}
                      {a.status !== "disabled" && <Button size="sm" variant="ghost" className="text-destructive" disabled={applicantAction.isPending} onClick={() => applicantAction.mutate({ a, action: "disable" })} data-testid={`btn-disable-applicant-${a.id}`}>Disable</Button>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground mt-2">Applicant accounts can only see postings you make available and their own applications. They are not workers; a worker record is created only when you hire and explicitly convert an applicant.</p>
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
      {approveFor && (
        <ApproveRequestDialog req={approveFor} posts={posts} pending={approve.isPending} onCancel={() => setApproveFor(null)}
          onConfirm={(postingIds) => approve.mutate({ req: approveFor, postingIds })} />
      )}
      {denyFor && (
        <NoteDialog title="Deny this request?" description="The person is not told the reason. Your note stays internal." required={false} confirmLabel="Deny" pending={deny.isPending}
          placeholder="Internal note (optional)" onCancel={() => setDenyFor(null)} onConfirm={(note) => deny.mutate({ req: denyFor, note })} />
      )}
    </Sheet>
  );
}

function ApproveRequestDialog({ req, posts, pending, onCancel, onConfirm }: { req: AccessRequestRow; posts: JobPost[]; pending: boolean; onCancel: () => void; onConfirm: (postingIds: string[]) => void }) {
  const employeePosts = posts.filter((p) => p.workerClassification === "employee" && p.status === "published");
  const [selected, setSelected] = useState<Set<string>>(new Set(req.jobPostId ? [req.jobPostId] : []));
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent data-testid="dialog-approve-request">
        <DialogHeader>
          <DialogTitle>Approve {req.firstName} {req.lastName}?</DialogTitle>
          <DialogDescription>
            {req.kind === "applicant"
              ? "Creates a limited applicant account (no worker record). You'll get a one-time activation link to send to their email address. They can see public and access-required positions, plus any invite-only positions you select."
              : "Forwards this contractor into Access Requests, where approving them sends their contractor account invitation. Nothing is created yet."}
          </DialogDescription>
        </DialogHeader>
        {req.kind === "applicant" && employeePosts.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
            {employeePosts.map((p) => (
              <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                <input type="checkbox" checked={selected.has(p.id)} onChange={(e) => { const n = new Set(selected); if (e.target.checked) n.add(p.id); else n.delete(p.id); setSelected(n); }} />
                {p.title}<span className="text-xs text-muted-foreground ml-auto">{(p.publicVisibility ?? "access_required").replace(/_/g, " ")}</span>
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={pending} onClick={() => onConfirm(Array.from(selected))} data-testid="btn-approve-request-confirm">{pending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Approve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApplicantAccessPanel({ post }: { post: JobPost }) {
  const { toast } = useToast();
  const grants = useQuery<{ id: string; applicantId: string; name: string; email: string; source: string; grantedAt: string }[], JobBoardError>({
    queryKey: ["job-board", "grants", post.id], queryFn: () => jobGet(`/api/job-posts/${post.id}/applicant-grants`),
  });
  const applicants = useQuery<ApplicantRow[]>({ queryKey: ["job-board", "applicants", post.companyId], queryFn: () => jobGet(`/api/job-board/applicants?companyId=${encodeURIComponent(post.companyId)}`) });
  const [pick, setPick] = useState("");
  const grant = useMutation({
    mutationFn: () => jobSend("POST", `/api/job-posts/${post.id}/applicant-grants`, { json: { applicantId: pick } }),
    onSuccess: () => { refreshJobBoard(); setPick(""); toast({ title: "Access granted" }); },
    onError: (e: any) => toast({ title: e?.message || "Could not grant access", variant: "destructive" }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => jobSend("POST", `/api/job-post-access-grants/${id}/revoke`, { json: {} }),
    onSuccess: () => { refreshJobBoard(); toast({ title: "Access revoked" }); },
    onError: (e: any) => toast({ title: e?.message || "Could not revoke", variant: "destructive" }),
  });
  const granted = new Set((grants.data ?? []).map((g) => g.applicantId));
  const candidates = (applicants.data ?? []).filter((a) => a.status !== "disabled" && !granted.has(a.id));
  return (
    <div className="space-y-3 mt-3">
      <p className="text-xs text-muted-foreground">Public board visibility: <strong>{(post.publicVisibility ?? "access_required").replace(/_/g, " ")}</strong>. Grants matter for invite-only positions; approved applicants already see public and access-required positions.</p>
      {grants.isLoading ? <Skeleton className="h-10 w-full" /> : grants.error ? <LoadProblem error={grants.error} /> : (grants.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No applicant has been granted this posting.</p> : (
        <ul className="divide-y rounded-md border">
          {grants.data!.map((g) => <li key={g.id} className="flex items-center justify-between px-3 py-2 text-sm"><span>{g.name || g.email} <span className="text-xs text-muted-foreground">· {dateLabel(g.grantedAt)}</span></span><Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(g.id)}>Revoke</Button></li>)}
        </ul>
      )}
      {candidates.length > 0 && (
        <div className="flex gap-2">
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger className="h-9" data-testid="select-grant-applicant"><SelectValue placeholder="Choose an applicant" /></SelectTrigger>
            <SelectContent>{candidates.map((a) => <SelectItem key={a.id} value={a.id}>{`${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() || a.email}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" disabled={!pick || grant.isPending} onClick={() => grant.mutate()} data-testid="btn-grant-applicant"><UserPlus className="h-3.5 w-3.5 mr-1" />Grant</Button>
        </div>
      )}
    </div>
  );
}

// ─── Questions / invitations / activity (contractor postings) ────────────────

function AdminQuestionsPanel({ postId }: { postId: string }) {
  const { toast } = useToast();
  const qs = useQuery<JobQuestion[], JobBoardError>({
    queryKey: ["job-board", "questions", postId],
    queryFn: () => jobGet<JobQuestion[]>(`/api/job-posts/${postId}/questions`),
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
                Share question and answer with every contractor (asker stays anonymous)
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
    queryFn: () => jobGet<JobInvitation[]>(`/api/job-posts/${post.id}/invitations`),
  });
  const workers = useQuery<any[]>({
    queryKey: ["job-board", "contractors", post.companyId],
    queryFn: () => jobGet<any[]>(`/api/workers?companyId=${encodeURIComponent(post.companyId)}`),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const invite = useMutation({
    mutationFn: () => jobSend<{ invited: number }>("POST", `/api/job-posts/${post.id}/invitations`, { json: { contractorIds: Array.from(selected) } }),
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
  post_created: "Posting created", classification_declared: "Classification declared", classification_changed: "Classification changed",
  classification_indicators_acknowledged: "Classification indicators acknowledged",
  post_updated: "Posting edited", post_material_change: "Material change (candidates notified)",
  post_published: "Published", post_paused: "Paused", post_reopened: "Reopened", post_closed: "Closed", post_archived: "Archived",
  post_attachment_added: "File attached to posting", attachment_removed: "File removed",
  screening_question_added: "Screening question added", screening_question_archived: "Screening question removed",
  bid_created: "Proposal started", bid_draft_updated: "Draft proposal edited", bid_submitted: "Proposal submitted", bid_resubmitted: "Proposal resubmitted",
  bid_revised: "Proposal revised", bid_withdrawn: "Proposal withdrawn", bid_attachment_added: "File attached to proposal",
  bid_under_review: "Proposal under review", bid_shortlisted: "Proposal shortlisted", bid_revision_requested: "Revision requested",
  bid_rejected: "Proposal declined", bid_awarded: "Proposal awarded", bid_converted_to_proposal: "Contractor proposal created",
  bid_converted_to_contract: "Contract linked", contractor_invited: "Contractor invited", contractor_invitation_revoked: "Invitation revoked",
  question_asked: "Question asked", question_answered: "Question answered", question_answer_updated: "Answer updated",
  deadline_reminder_sent: "Deadline reminder sent",
  application_created: "Application started", application_draft_updated: "Draft application edited", application_submitted: "Application submitted",
  application_withdrawn: "Application withdrawn", application_under_review: "Application under review", application_interviewing: "Interview stage",
  application_offer_extended: "Offer extended", application_hired: "Applicant hired", application_rejected: "Application not selected",
  application_converted_to_worker: "Employee record created", document_added: "Document added", document_removed: "Document removed",
  document_viewed: "Private document viewed",
};

function ActivityPanel({ postId }: { postId: string }) {
  const events = useQuery<JobEvent[], JobBoardError>({
    queryKey: ["job-board", "events", postId],
    queryFn: () => jobGet<JobEvent[]>(`/api/job-posts/${postId}/events`),
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
            <p className="text-xs text-muted-foreground">{dateTimeLabel(e.createdAt)}{e.details?.proposalNumber ? ` · ${e.details.proposalNumber}` : ""}{e.details?.reason ? ` · ${String(e.details.reason).replace(/_/g, " ")}` : ""}{e.details?.workerClassification && e.eventType.startsWith("classification") ? ` · ${e.details.workerClassification}` : ""}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Worker (contractors + employees)
// ═══════════════════════════════════════════════════════════════════════════

type WorkerTab = "available" | "proposals" | "applications";

function WorkerJobBoard({ user, initialJobId, onNavigate }: { user: any; initialJobId?: string | null; onNavigate: JobBoardNavigate }) {
  const { canPropose } = jobBoardViewsFor(user);
  const [tab, setTab] = useState<WorkerTab>("available");
  const [filters, setFilters] = useState<JobFilters>(EMPTY_FILTERS);
  const [openId, setOpenId] = useState<string | null>(initialJobId ?? null);
  useEffect(() => { if (initialJobId) setOpenId(initialJobId); }, [initialJobId]);

  const available = useQuery<JobPost[], JobBoardError>({
    queryKey: ["job-board", "available"],
    queryFn: () => jobGet<JobPost[]>("/api/job-posts/available"),
  });
  const mine = useQuery<JobBid[], JobBoardError>({
    queryKey: ["job-board", "my-bids"],
    queryFn: () => jobGet<JobBid[]>("/api/contractor-job-bids/mine"),
    enabled: canPropose,
  });
  const myApps = useQuery<JobApplication[], JobBoardError>({
    queryKey: ["job-board", "my-applications"],
    queryFn: () => jobGet<JobApplication[]>("/api/employment-applications/mine"),
  });

  const bids = mine.data ?? [];
  const apps = myApps.data ?? [];
  const activeBidCount = bids.filter((b) => ACTIVE_BID_STATUSES.includes(b.status)).length;
  const activeAppCount = apps.filter((a) => ACTIVE_APPLICATION_STATUSES.includes(a.status)).length;
  const openPosts = applyJobFilters((available.data ?? []).filter((p) => p.acceptingSubmissions), filters);
  const error = available.error ?? (canPropose ? mine.error : null) ?? myApps.error;

  return (
    <div className="space-y-4">
      <JobBoardSummaryCard mode="worker" />
      {error ? <LoadProblem error={error} /> : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as WorkerTab)}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="available" data-testid="tab-jobs-available">Available Opportunities{openPosts.length ? ` (${openPosts.length})` : ""}</TabsTrigger>
            {canPropose && <TabsTrigger value="proposals" data-testid="tab-jobs-my-proposals">My Proposals{activeBidCount ? ` (${activeBidCount})` : ""}</TabsTrigger>}
            <TabsTrigger value="applications" data-testid="tab-jobs-my-applications">My Applications{activeAppCount ? ` (${activeAppCount})` : ""}</TabsTrigger>
          </TabsList>

          <TabsContent value="available" className="space-y-3">
            <FilterBar value={filters} onChange={setFilters} showClassification={canPropose} />
            {available.isLoading ? <Skeleton className="h-24 w-full" /> : openPosts.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No open opportunities right now. You'll get a notification when something new is posted for you.</CardContent></Card>
            ) : openPosts.map((p) => (
              <PostCard key={p.id} post={p} onOpen={() => setOpenId(p.id)} showCta={!p.myBidStatus && !p.myApplicationStatus} footer={
                p.myBidStatus ? <div className="pt-1 border-t flex items-center gap-2 text-xs">Your proposal: <BidStatusBadge status={p.myBidStatus} /></div>
                  : p.myApplicationStatus ? <div className="pt-1 border-t flex items-center gap-2 text-xs">Your application: <ApplicationStatusBadge status={p.myApplicationStatus} /></div>
                  : p.invited ? <div className="pt-1 border-t text-xs text-primary">You were invited to send a proposal</div> : null
              } />
            ))}
          </TabsContent>

          {canPropose && (
            <TabsContent value="proposals">
              <MyBidList bids={bids} loading={mine.isLoading} empty="You haven't sent any proposals." onOpen={setOpenId}
                extra={(b) => b.convertedProposalId ? (
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onNavigate(b.convertedContractId ? "contracts" : "proposals", b.convertedContractId ?? b.convertedProposalId!); }}>
                    <FileText className="h-3.5 w-3.5 mr-1" />{b.convertedContractId ? "Open contract" : "Review proposal"}
                  </Button>
                ) : null} />
            </TabsContent>
          )}
          <TabsContent value="applications"><MyApplicationList apps={apps} loading={myApps.isLoading} onOpen={setOpenId} /></TabsContent>
        </Tabs>
      )}
      {openId && <WorkerPostSheet postId={openId} onClose={() => setOpenId(null)} onNavigate={onNavigate} />}
    </div>
  );
}

function MyBidList({ bids, loading, empty, onOpen, extra }: {
  bids: JobBid[]; loading: boolean; empty: string; onOpen: (postId: string) => void; extra?: (b: JobBid) => React.ReactNode;
}) {
  if (loading) return <Skeleton className="h-24 w-full mt-3" />;
  if (!bids.length) return <Card className="mt-3"><CardContent className="py-8 text-center text-sm text-muted-foreground">{empty}</CardContent></Card>;
  return (
    <div className="space-y-2 mt-3" data-testid="list-my-proposals">
      {bids.map((b) => (
        // div (not <button>): the card can hold its own action button ("Review proposal").
        <div key={b.id} role="button" tabIndex={0} className="w-full text-left cursor-pointer" onClick={() => onOpen(b.jobPostId)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(b.jobPostId); } }} data-testid={`card-my-bid-${b.id}`}>
          <Card className="hover:border-primary/40 transition-colors border-l-4 border-l-orange-500">
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

function MyApplicationList({ apps, loading, onOpen }: { apps: JobApplication[]; loading: boolean; onOpen: (postId: string) => void }) {
  if (loading) return <Skeleton className="h-24 w-full mt-3" />;
  if (!apps.length) return <Card className="mt-3"><CardContent className="py-8 text-center text-sm text-muted-foreground">You haven't applied to any positions.</CardContent></Card>;
  return (
    <div className="space-y-2 mt-3" data-testid="list-my-applications">
      {apps.map((a) => (
        <div key={a.id} role="button" tabIndex={0} className="w-full text-left cursor-pointer" onClick={() => onOpen(a.jobPostId)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(a.jobPostId); } }} data-testid={`card-my-application-${a.id}`}>
          <Card className="hover:border-primary/40 transition-colors border-l-4 border-l-sky-500">
            <CardContent className="p-3 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{a.jobTitle ?? "Position"}</p>
                <p className="text-xs text-muted-foreground">{a.submittedAt ? `Applied ${dateLabel(a.submittedAt)}` : "Not submitted yet"}{a.jobStatus && a.jobStatus !== "published" ? ` · position ${POST_STATUS_LABEL[a.jobStatus].toLowerCase()}` : ""}</p>
              </div>
              <ApplicationStatusBadge status={a.status} />
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}

function WorkerPostSheet({ postId, onClose, onNavigate }: { postId: string; onClose: () => void; onNavigate: JobBoardNavigate }) {
  const post = useQuery<JobPost, JobBoardError>({
    queryKey: ["job-board", "post", postId],
    queryFn: () => jobGet<JobPost>(`/api/job-posts/${postId}`),
  });
  const p = post.data;
  const employee = p ? isEmployee(p) : false;
  const mineActive = p ? (employee ? p.myApplication && p.myApplication.status !== "withdrawn" : p.myBid && p.myBid.status !== "withdrawn") : false;
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto" data-testid="sheet-job-worker">
        {!post.data && <SheetTitle className="sr-only">Job posting</SheetTitle>}
        {post.isLoading && <div className="space-y-3 mt-6"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-40 w-full" /></div>}
        {post.error && <div className="mt-6">{post.error.status === 404
          ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">This opportunity is no longer available.</CardContent></Card>
          : <LoadProblem error={post.error} />}</div>}
        {p && (
          <div className="space-y-4">
            <SheetHeader className="text-left space-y-2">
              <ClassificationBadge post={p} size="lg" />
              <SheetTitle className="pr-8">{p.title}</SheetTitle>
              {p.companyName && <p className="text-xs text-muted-foreground">{p.companyName}</p>}
              <PostBadges post={p} />
            </SheetHeader>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-md border p-3">
              <Fact label="Compensation" value={compensationLabel(p)} />
              <Fact label={employee ? "Apply by" : "Proposals due"} value={dateTimeLabel(p.applicationDeadline)} />
              <Fact label="Openings" value={p.openingsRemaining == null ? "Open" : `${p.openingsRemaining} remaining`} />
            </div>
            <Tabs defaultValue={mineActive ? "submit" : "details"}>
              <TabsList>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="submit" data-testid={employee ? "tab-job-apply" : "tab-job-proposal"}>
                  {employee ? (mineActive ? "My application" : "Apply") : (mineActive ? "My proposal" : "Submit Proposal")}
                </TabsTrigger>
                {!employee && <TabsTrigger value="questions" data-testid="tab-job-questions">Questions</TabsTrigger>}
              </TabsList>
              <TabsContent value="details" className="space-y-3">
                <PostDetailBody post={p} />
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Attachments</p>
                  <AttachmentList items={p.attachments ?? []} />
                </div>
              </TabsContent>
              <TabsContent value="submit">
                {employee ? <ApplicationPanel post={p} /> : <ContractorBidPanel post={p} onNavigate={onNavigate} />}
              </TabsContent>
              {!employee && <TabsContent value="questions"><ContractorQuestionsPanel post={p} /></TabsContent>}
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Contractor proposal form ────────────────────────────────────────────────

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
  const remove = useRemove((id) => `/api/job-post-attachments/${id}/remove`);
  const files = useQuery<JobAttachment[]>({
    queryKey: ["job-board", "bid-attachments", existing?.id],
    queryFn: () => jobGet<JobAttachment[]>(`/api/contractor-job-bids/${existing!.id}/attachments`),
    enabled: !!existing,
  });

  const save = useMutation({
    mutationFn: async (mode: "draft" | "submit" | "revise") => {
      const payload = bidPayload(form);
      let bid = existing;
      if (!bid) bid = await jobSend<JobBid>("POST", `/api/job-posts/${post.id}/bids`, { json: payload });
      else if (dirty || mode === "draft") bid = await jobSend<JobBid>("PATCH", `/api/contractor-job-bids/${bid.id}`, { json: payload });
      // PATCH on a submitted/under-review proposal already records a new revision; only drafts and
      // revision-requested proposals need the explicit submit transition.
      if (mode === "submit" && (bid.status === "draft" || bid.status === "revision_requested")) {
        bid = await jobSend<JobBid>("POST", `/api/contractor-job-bids/${bid.id}/submit`, { json: {} });
      }
      return { bid, mode };
    },
    onSuccess: ({ mode }) => {
      refreshJobBoard();
      toast({ title: mode === "draft" ? "Draft saved" : mode === "revise" ? "Revised proposal submitted" : "Proposal submitted" });
    },
    onError: (e: any) => { refreshJobBoard(); toast({ title: e?.message || "Could not save proposal", variant: "destructive" }); },
  });
  const withdraw = useMutation({
    mutationFn: () => jobSend<JobBid>("POST", `/api/contractor-job-bids/${existing!.id}/withdraw`, { json: {} }),
    onSuccess: () => { refreshJobBoard(); setConfirmWithdraw(false); toast({ title: "Proposal withdrawn" }); },
    onError: (e: any) => toast({ title: e?.message || "Could not withdraw", variant: "destructive" }),
  });

  const status = existing?.status;
  const editable = post.acceptingSubmissions && (!existing || CONTRACTOR_EDITABLE.includes(existing.status));
  const hourly = form.rateType === "hourly";
  const problem = bidSubmitProblem(form);

  if (existing && AWARDED_STATUSES.includes(existing.status)) {
    return (
      <Card className="mt-3 border-green-300"><CardContent className="p-4 space-y-2">
        <p className="flex items-center gap-2 font-medium"><CheckCircle className="h-4 w-4 text-green-600" />You were awarded this work</p>
        <p className="text-sm text-muted-foreground">Your submission became a contractor proposal. Review and accept it to move to a contract.</p>
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
          <p className="font-medium">This proposal was not selected.</p>
          {existing?.rejectionReason && <p className="text-muted-foreground whitespace-pre-wrap mt-1">{existing.rejectionReason}</p>}
        </div>
      )}
      {status === "shortlisted" && <p className="text-sm text-muted-foreground">You're on the shortlist. The proposal is locked while the company decides; you can still withdraw it.</p>}
      {!post.acceptingSubmissions && !existing && (
        <p className="text-sm text-muted-foreground py-4 text-center">This posting is not accepting proposals{post.status === "paused" ? " right now (paused)" : ""}.</p>
      )}
      {post.myBid?.status === "withdrawn" && post.acceptingSubmissions && <p className="text-xs text-muted-foreground">You withdrew an earlier proposal. You can submit a new one.</p>}

      {(editable || (existing && !CONTRACTOR_EDITABLE.includes(existing.status))) && (existing || post.acceptingSubmissions) && (
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
            {hourly
              ? <div><Label>Proposed rate (per hour) *</Label><Input inputMode="decimal" value={form.hourlyRate} onChange={(e) => set("hourlyRate", e.target.value)} data-testid="input-bid-hourly-rate" /></div>
              : <div><Label>{form.rateType === "recurring" ? "Price per period *" : "Proposed price *"}</Label><Input inputMode="decimal" value={form.proposedAmount} onChange={(e) => set("proposedAmount", e.target.value)} data-testid="input-bid-amount" /></div>}
            <div><Label>Estimated hours</Label><Input inputMode="decimal" value={form.estimatedHours} onChange={(e) => set("estimatedHours", e.target.value)} data-testid="input-bid-hours" /></div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label>Can start</Label><Input type="date" value={form.estimatedStartDate} onChange={(e) => set("estimatedStartDate", e.target.value)} /></div>
            <div><Label>Estimated completion</Label><Input type="date" value={form.estimatedCompletionDate} onChange={(e) => set("estimatedCompletionDate", e.target.value)} data-testid="input-bid-completion" /></div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label>Proposed schedule</Label><Input value={form.proposedSchedule} onChange={(e) => set("proposedSchedule", e.target.value)} placeholder="e.g. Mon–Wed mornings" data-testid="input-bid-schedule" /></div>
            <div><Label>Availability</Label><Input value={form.availability} onChange={(e) => set("availability", e.target.value)} placeholder="e.g. Available from June 1" data-testid="input-bid-availability" /></div>
          </div>
          <div><Label>Scope & deliverables *</Label><Textarea rows={3} value={form.scopeAndDeliverables} onChange={(e) => set("scopeAndDeliverables", e.target.value)} placeholder="What you'll do and what you'll hand over" data-testid="input-bid-scope" /></div>
          {(post.opportunityType === "recurring_work") && <div><Label>Recurring terms</Label><Textarea rows={2} value={form.recurrenceTerms} onChange={(e) => set("recurrenceTerms", e.target.value)} /></div>}
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label>Assumptions</Label><Textarea rows={2} value={form.assumptions} onChange={(e) => set("assumptions", e.target.value)} /></div>
            <div><Label>Exclusions</Label><Textarea rows={2} value={form.exclusions} onChange={(e) => set("exclusions", e.target.value)} /></div>
          </div>
          <div><Label>Cover message</Label><Textarea rows={3} value={form.coverMessage} onChange={(e) => set("coverMessage", e.target.value)} data-testid="input-bid-cover" /></div>
        </fieldset>
      )}

      {existing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Supporting documents (visible only to the company)</p>
            {editable && <UploadButton label="Attach file" onFile={upload} />}
          </div>
          <AttachmentList items={files.data ?? []} onRemove={editable ? remove : undefined} />
        </div>
      )}

      {editable && problem && (form.proposedAmount || form.hourlyRate || existing) && <p className="text-xs text-muted-foreground">{problem} to submit.</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        {editable && (!existing || status === "draft" || status === "revision_requested") && (
          <>
            <Button variant="outline" disabled={save.isPending || (!!existing && !dirty)} onClick={() => save.mutate("draft")} data-testid="btn-bid-save-draft">Save draft</Button>
            <Button disabled={save.isPending || !!problem} onClick={() => save.mutate("submit")} data-testid="btn-bid-submit">
              {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}<Send className="h-4 w-4 mr-1" />{status === "revision_requested" ? "Resubmit Proposal" : "Submit Proposal"}
            </Button>
          </>
        )}
        {editable && (status === "submitted" || status === "under_review") && (
          <Button disabled={save.isPending || !dirty || !!problem} onClick={() => save.mutate("revise")} data-testid="btn-bid-revise">
            {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Submit revision
          </Button>
        )}
        {existing && CONTRACTOR_WITHDRAWABLE.includes(existing.status) && (
          <Button variant="ghost" className="text-destructive" onClick={() => setConfirmWithdraw(true)} data-testid="btn-bid-withdraw">Withdraw</Button>
        )}
      </div>
      {editable && !existing && <p className="text-xs text-muted-foreground">Save a draft to attach supporting documents before submitting. Other contractors never see your proposal.</p>}

      {confirmWithdraw && (
        <Dialog open onOpenChange={(o) => { if (!o) setConfirmWithdraw(false); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Withdraw your proposal?</DialogTitle><DialogDescription>The company will no longer consider it. You can submit a new proposal while the posting is open.</DialogDescription></DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmWithdraw(false)}>Keep proposal</Button>
              <Button variant="destructive" disabled={withdraw.isPending} onClick={() => withdraw.mutate()} data-testid="btn-bid-withdraw-confirm">Withdraw</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Employee application form ───────────────────────────────────────────────

function ApplicationPanel({ post }: { post: JobPost }) {
  const { toast } = useToast();
  const existing = post.myApplication && post.myApplication.status !== "withdrawn" ? post.myApplication : null;
  const detail = useQuery<JobApplication>({
    queryKey: ["job-board", "application", existing?.id],
    queryFn: () => jobGet<JobApplication>(`/api/employment-applications/${existing!.id}`),
    enabled: !!existing,
  });
  const full = detail.data ?? existing;
  const questions = post.screeningQuestions ?? [];
  const [form, setForm] = useState<ApplicationForm>(() => applicationFormFrom(full));
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  useEffect(() => { setForm(applicationFormFrom(full)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [full?.id, full?.updatedAt, detail.dataUpdatedAt]);
  const set = <K extends keyof ApplicationForm>(k: K, v: ApplicationForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setAnswer = (id: string, v: string) => setForm((f) => ({ ...f, answers: { ...f.answers, [id]: v } }));
  const upload = useUpload(() => `/api/employment-applications/${existing!.id}/documents`, { documentType: "resume" });
  const remove = useRemove((id) => `/api/employment-application-documents/${id}/remove`);

  const save = useMutation({
    mutationFn: async (mode: "draft" | "submit") => {
      let app = existing;
      const payload = applicationPayload(form);
      if (!app) app = await jobSend<JobApplication>("POST", `/api/job-posts/${post.id}/applications`, { json: payload });
      else app = await jobSend<JobApplication>("PATCH", `/api/employment-applications/${app.id}`, { json: payload });
      if (mode === "submit") app = await jobSend<JobApplication>("POST", `/api/employment-applications/${app.id}/submit`, { json: { acknowledgements: acks, answers: form.answers } });
      return { mode };
    },
    onSuccess: ({ mode }) => { refreshJobBoard(); toast({ title: mode === "draft" ? "Draft saved" : "Application submitted" }); },
    onError: (e: any) => { refreshJobBoard(); toast({ title: e?.message || "Could not save application", variant: "destructive" }); },
  });
  const withdraw = useMutation({
    mutationFn: () => jobSend("POST", `/api/employment-applications/${existing!.id}/withdraw`, { json: {} }),
    onSuccess: () => { refreshJobBoard(); setConfirmWithdraw(false); toast({ title: "Application withdrawn" }); },
    onError: (e: any) => toast({ title: e?.message || "Could not withdraw", variant: "destructive" }),
  });

  const status = existing?.status;
  const editable = post.acceptingSubmissions && (!existing || APPLICANT_EDITABLE.includes(existing.status));
  const problem = applicationSubmitProblem(form, questions, acks);

  if (status === "hired") {
    return (
      <Card className="mt-3 border-green-300"><CardContent className="p-4 space-y-1">
        <p className="flex items-center gap-2 font-medium"><CheckCircle className="h-4 w-4 text-green-600" />You were hired for this position</p>
        <p className="text-sm text-muted-foreground">The company will contact you about onboarding.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-3 mt-3">
      {existing && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <ApplicationStatusBadge status={existing.status} />
          {existing.submittedAt && <span className="text-xs text-muted-foreground">Submitted {dateTimeLabel(existing.submittedAt)}</span>}
        </div>
      )}
      {status === "rejected" && <div className="rounded-md border p-3 text-sm"><p className="font-medium">You were not selected for this position.</p><p className="text-muted-foreground mt-1">Thank you for applying.</p></div>}
      {existing && !editable && status !== "rejected" && <p className="text-sm text-muted-foreground">Your application has been submitted. The company will update its status here.</p>}
      {!post.acceptingSubmissions && !existing && (
        <p className="text-sm text-muted-foreground py-4 text-center">This position is not accepting applications{post.status === "paused" ? " right now (paused)" : ""}.</p>
      )}
      {post.myApplication?.status === "withdrawn" && post.acceptingSubmissions && <p className="text-xs text-muted-foreground">You withdrew an earlier application. You can apply again.</p>}

      {(editable || existing) && (existing || post.acceptingSubmissions) && (
        <fieldset disabled={!editable} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label>Availability</Label><Input value={form.availability} onChange={(e) => set("availability", e.target.value)} placeholder="e.g. Two weeks' notice; weekdays" data-testid="input-application-availability" /></div>
            <div><Label>Desired compensation</Label><Input value={form.desiredCompensation} maxLength={200} onChange={(e) => set("desiredCompensation", e.target.value)} placeholder="e.g. $24/hr" data-testid="input-application-compensation" /></div>
          </div>
          <div><Label>Cover message</Label><Textarea rows={3} value={form.coverMessage} onChange={(e) => set("coverMessage", e.target.value)} data-testid="input-application-cover" /></div>
          <div><Label>Employment history & qualifications</Label><Textarea rows={4} value={form.qualifications} onChange={(e) => set("qualifications", e.target.value)} data-testid="input-application-qualifications" /></div>
          {questions.length > 0 && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">Screening questions</p>
              {questions.map((q) => (
                <div key={q.id} className="space-y-1">
                  <Label className="text-sm">{q.prompt}{q.required && <span className="text-destructive"> *</span>}</Label>
                  {q.answerType === "yes_no" || q.answerType === "choice" ? (
                    <Select value={form.answers[q.id] ?? ""} onValueChange={(v) => setAnswer(q.id, v)}>
                      <SelectTrigger data-testid={`select-screening-answer-${q.id}`}><SelectValue placeholder="Choose" /></SelectTrigger>
                      <SelectContent>
                        {(q.answerType === "yes_no" ? ["yes", "no"] : q.options).map((o) => <SelectItem key={o} value={o}>{q.answerType === "yes_no" ? (o === "yes" ? "Yes" : "No") : o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input inputMode={q.answerType === "number" ? "decimal" : undefined} value={form.answers[q.id] ?? ""} onChange={(e) => setAnswer(q.id, e.target.value)} data-testid={`input-screening-answer-${q.id}`} />
                  )}
                </div>
              ))}
            </div>
          )}
        </fieldset>
      )}

      {existing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Lock className="h-3 w-3" />Résumé / CV (private HR record)</p>
            {editable && <UploadButton label="Upload résumé" onFile={upload} accept=".pdf,.doc,.docx,.rtf,.txt,.png,.jpg,.jpeg" />}
          </div>
          <HrDocumentList items={full?.documents ?? []} onRemove={editable ? remove : undefined} />
        </div>
      )}

      {editable && (
        <div className="space-y-2 rounded-md border p-3" data-testid="panel-application-acknowledgements">
          {APPLICATION_ACKNOWLEDGEMENTS.map((a) => (
            <label key={a.key} className="flex items-start gap-2 text-xs">
              <Checkbox checked={!!acks[a.key]} onCheckedChange={(v) => setAcks({ ...acks, [a.key]: v === true })} data-testid={`checkbox-ack-${a.key}`} />
              <span>{a.label}</span>
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {editable && (
          <>
            <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate("draft")} data-testid="btn-application-save-draft">Save draft</Button>
            <Button disabled={save.isPending || !!problem} onClick={() => save.mutate("submit")} data-testid="btn-application-submit">
              {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}<UserCheck className="h-4 w-4 mr-1" />Apply
            </Button>
          </>
        )}
        {existing && APPLICANT_WITHDRAWABLE.includes(existing.status) && (
          <Button variant="ghost" className="text-destructive" onClick={() => setConfirmWithdraw(true)} data-testid="btn-application-withdraw">Withdraw</Button>
        )}
      </div>
      {editable && problem && <p className="text-xs text-muted-foreground">{problem}.</p>}
      {editable && !existing && <p className="text-xs text-muted-foreground">Save a draft to upload your résumé before applying. Other applicants never see your application.</p>}

      {confirmWithdraw && (
        <Dialog open onOpenChange={(o) => { if (!o) setConfirmWithdraw(false); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Withdraw your application?</DialogTitle><DialogDescription>The company will no longer consider it. You can apply again while the position is open.</DialogDescription></DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmWithdraw(false)}>Keep application</Button>
              <Button variant="destructive" disabled={withdraw.isPending} onClick={() => withdraw.mutate()} data-testid="btn-application-withdraw-confirm">Withdraw</Button>
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
    queryFn: () => jobGet<JobQuestion[]>(`/api/job-posts/${post.id}/questions`),
  });
  const [text, setText] = useState("");
  const ask = useMutation({
    mutationFn: () => jobSend("POST", `/api/job-posts/${post.id}/questions`, { json: { question: text.trim() } }),
    onSuccess: () => { refreshJobBoard(); setText(""); toast({ title: "Question sent" }); },
    onError: (e: any) => toast({ title: e?.message || "Could not send question", variant: "destructive" }),
  });
  return (
    <div className="space-y-3 mt-3">
      {post.status === "published" && (
        <div className="space-y-2">
          <Textarea rows={2} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="Ask the company about this work" data-testid="input-job-question" />
          <div className="flex justify-between items-center gap-2">
            <p className="text-xs text-muted-foreground">Only the company sees your question unless they choose to share the answer with all contractors.</p>
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

interface AdminSummary { publishedJobs: number; proposalsAwaitingReview: number; applicationsAwaitingReview: number; closingSoon: number; awardsThisMonth: number; hiresThisMonth: number }
interface WorkerSummary { availableJobs: number; activeProposals: number; revisionRequested: number; awardedProposals: number; activeApplications: number }

export function JobBoardSummaryCard({ mode, companyId, onOpen }: { mode: "admin" | "worker"; companyId?: string | null; onOpen?: () => void }) {
  const summary = useQuery<AdminSummary | WorkerSummary, JobBoardError>({
    queryKey: ["job-board", "summary", mode, companyId ?? null],
    queryFn: () => jobGet(`/api/job-posts/summary?view=${mode}${companyQs(companyId ?? null, false)}`),
  });
  // Feature off (503), no default company (400) or no access: the Overview simply omits the card.
  if (!summary.data) return null;
  const tiles = mode === "admin"
    ? (() => { const s = summary.data as AdminSummary; return [
        { label: "Published", value: s.publishedJobs, tone: "text-blue-600" },
        { label: "Proposals to review", value: s.proposalsAwaitingReview, tone: "text-orange-600" },
        { label: "Applications to review", value: s.applicationsAwaitingReview, tone: "text-sky-600" },
        { label: "Awards · hires this month", value: `${Number(s.awardsThisMonth ?? 0)} · ${Number(s.hiresThisMonth ?? 0)}`, tone: "text-green-600" },
      ]; })()
    : (() => { const s = summary.data as WorkerSummary; return [
        { label: "Open opportunities", value: s.availableJobs, tone: "text-blue-600" },
        { label: "Active proposals", value: s.activeProposals, tone: "text-orange-600" },
        { label: "Active applications", value: s.activeApplications, tone: "text-sky-600" },
        { label: "Revisions requested", value: s.revisionRequested, tone: "text-amber-600" },
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
            <p className={cn("text-xl font-bold", t.tone)}>{typeof t.value === "number" ? Number(t.value ?? 0) : t.value}</p>
            <p className="text-xs text-muted-foreground">{t.label}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
