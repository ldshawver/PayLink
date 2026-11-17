/**
 * Public job board (migration 0030) — no session.
 *
 *   /jobs           enter a company board code → public postings (allowlisted
 *                   fields only) → request contractor or employment access
 *   /jobs/activate  one-time activation link → choose username + password
 *
 * The board code is discovery only. Nothing on this page can submit a
 * proposal or an application: that always requires an approved,
 * authenticated identity. The code is sent only in POST bodies (never in a
 * URL) and kept only in memory (no browser storage).
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Briefcase, HardHat, BadgeCheck, ArrowLeft, CheckCircle, KeyRound } from "lucide-react";
import { API_BASE_URL } from "@/lib/queryClient";
import { SCHEDULE_LABEL, LOCATION_LABEL, money, type ScheduleType } from "@/lib/job-board";

interface PublicPosting {
  ref: string; title: string; description: string | null; workerClassification: "contractor" | "employee"; cta: string;
  scheduleType: ScheduleType; workLocationType: "onsite" | "remote" | "hybrid";
  compensation: { type: string; min: string | null; max: string | null; currency: string } | null;
  applicationDeadline: string | null; requiredSkills: string[]; startDate: string | null;
}
interface Branding { displayName: string; tagline: string | null; brandColor: string | null; acceptsContractorRequests: boolean; acceptsApplicantRequests: boolean }

async function post<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: T | null; message: string | null }> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "omit", cache: "no-store" });
    let data: any = null;
    try { data = await res.json(); } catch { /* empty */ }
    return { ok: res.ok, status: res.status, data: res.ok ? data : null, message: data?.message ?? null };
  } catch {
    return { ok: false, status: 0, data: null, message: "Network error. Please try again." };
  }
}

function payLabel(c: PublicPosting["compensation"]) {
  if (!c) return null;
  const cur = c.currency || "USD";
  const range = c.min && c.max && c.min !== c.max ? `${money(c.min, cur)}–${money(c.max, cur)}` : money(c.max ?? c.min, cur);
  return c.type === "hourly" ? `${range}/hr` : c.type === "salary" ? `${range}/yr` : c.type === "fixed_bid" ? `Budget up to ${money(c.max ?? c.min, cur)}` : range;
}

function Shell({ children, brand }: { children: React.ReactNode; brand?: Branding | null }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b" style={brand?.brandColor ? { borderTopWidth: 4, borderTopColor: brand.brandColor } : undefined}>
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-primary" />
          <div>
            <p className="font-semibold" data-testid="text-board-name">{brand?.displayName ?? "Job board"}</p>
            {brand?.tagline && <p className="text-xs text-muted-foreground">{brand.tagline}</p>}
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">{children}</main>
    </div>
  );
}

function Badge({ cls }: { cls: "contractor" | "employee" }) {
  const employee = cls === "employee";
  const Icon = employee ? BadgeCheck : HardHat;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide ${employee ? "bg-sky-600 text-white" : "bg-orange-600 text-white"}`} data-testid={`badge-public-classification-${cls}`}>
      <Icon className="h-3 w-3" />{employee ? "EMPLOYEE POSITION" : "CONTRACTOR WORK"}
    </span>
  );
}

function RequestAccessForm({ code, brand, posting, onDone }: { code: string; brand: Branding; posting: PublicPosting | null; onDone: () => void }) {
  const kinds = [brand.acceptsApplicantRequests && "applicant", brand.acceptsContractorRequests && "contractor"].filter(Boolean) as ("applicant" | "contractor")[];
  const preferred = posting ? (posting.workerClassification === "employee" ? "applicant" : "contractor") : kinds[0];
  const [kind, setKind] = useState<"applicant" | "contractor" | undefined>(kinds.includes(preferred as any) ? preferred : kinds[0]);
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", phone: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!kinds.length) return <p className="text-sm text-muted-foreground" data-testid="text-requests-closed">This board is not accepting access requests right now.</p>;
  if (done) return <p className="text-sm flex items-center gap-2" data-testid="text-request-ack"><CheckCircle className="h-4 w-4 text-green-600" />{done}</p>;
  return (
    <form className="space-y-3" data-testid="form-request-access" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null);
      const r = await post<{ message: string }>("/api/public/job-board/access-requests", { code, kind, ...f, postingRef: posting?.ref });
      setBusy(false);
      if (r.status === 202) { setDone((r.data as any)?.message ?? "Request received."); onDone(); } else setErr(r.message ?? "Could not send your request.");
    }}>
      {kinds.length > 1 && (
        <div className="flex gap-2">
          {kinds.map((k) => (
            <Button key={k} type="button" size="sm" variant={kind === k ? "default" : "outline"} onClick={() => setKind(k)} data-testid={`btn-request-kind-${k}`}>
              {k === "applicant" ? "Employment access" : "Contractor access"}
            </Button>
          ))}
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <div><Label>First name</Label><Input required value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} data-testid="input-request-first" /></div>
        <div><Label>Last name</Label><Input required value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} data-testid="input-request-last" /></div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><Label>Email</Label><Input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="input-request-email" /></div>
        <div><Label>Phone (optional)</Label><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
      </div>
      <div><Label>Message (optional)</Label><Textarea rows={3} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button type="submit" disabled={busy} data-testid="btn-request-access-submit">{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Request access</Button>
      <p className="text-xs text-muted-foreground">Requesting access does not submit a proposal or an application. If approved, you'll receive an invitation to create a secure account.</p>
    </form>
  );
}

export function PublicJobBoardPage() {
  const [code, setCode] = useState("");
  const [board, setBoard] = useState<{ branding: Branding; postings: PublicPosting[] } | null>(null);
  const [open, setOpen] = useState<PublicPosting | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!board) {
    return (
      <Shell>
        <Card>
          <CardHeader><CardTitle>Find a company job board</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={async (e) => {
              e.preventDefault(); setBusy(true); setErr(null);
              const r = await post<{ branding: Branding; postings: PublicPosting[] }>("/api/public/job-board/board", { code });
              setBusy(false);
              if (r.ok && r.data) setBoard(r.data); else setErr(r.message ?? "This job board is not available.");
            }}>
              <Label htmlFor="board-code">Board code</Label>
              <Input id="board-code" value={code} autoComplete="off" onChange={(e) => setCode(e.target.value)} placeholder="e.g. K7QM-2PXR-HT" data-testid="input-board-code" />
              {err && <p className="text-sm text-destructive" data-testid="text-board-error">{err}</p>}
              <Button type="submit" disabled={busy || code.trim().length < 6} data-testid="btn-board-lookup">{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Open board</Button>
              <p className="text-xs text-muted-foreground">The company gives you this code. It only shows their public board — it doesn't sign you in.</p>
            </form>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const { branding, postings } = board;
  if (open) {
    const pay = payLabel(open.compensation);
    return (
      <Shell brand={branding}>
        <Button variant="ghost" size="sm" onClick={() => { setOpen(null); setRequesting(false); }} data-testid="btn-public-back"><ArrowLeft className="h-4 w-4 mr-1" />All opportunities</Button>
        <Card data-testid="card-public-posting-detail">
          <CardContent className="p-5 space-y-3">
            <Badge cls={open.workerClassification} />
            <h1 className="text-xl font-semibold">{open.title}</h1>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>{SCHEDULE_LABEL[open.scheduleType]}</span><span>{LOCATION_LABEL[open.workLocationType]}</span>
              {pay && <span>{pay}</span>}
              {open.applicationDeadline && <span>Deadline {new Date(open.applicationDeadline).toLocaleDateString()}</span>}
            </div>
            {open.description && <p className="text-sm whitespace-pre-wrap">{open.description}</p>}
            {open.requiredSkills.length > 0 && <div className="flex flex-wrap gap-1">{open.requiredSkills.map((s) => <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-xs">{s}</span>)}</div>}
            <div className="rounded-md border p-3 space-y-2">
              <p className="text-sm font-medium">To {open.cta === "Apply" ? "apply" : "submit a proposal"}, request access first</p>
              {requesting ? <RequestAccessForm code={code} brand={branding} posting={open} onDone={() => undefined} />
                : <Button onClick={() => setRequesting(true)} data-testid="btn-public-request-access">Request access to {open.cta === "Apply" ? "apply" : "submit a proposal"}</Button>}
            </div>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell brand={branding}>
      <h1 className="text-lg font-semibold">Open opportunities</h1>
      {postings.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="text-no-public-postings">No public opportunities right now.</p> : postings.map((p) => (
        <button key={p.ref} type="button" className="w-full text-left" onClick={() => setOpen(p)} data-testid={`card-public-posting-${p.ref}`}>
          <Card className="hover:border-primary/40"><CardContent className="p-4 space-y-1.5">
            <Badge cls={p.workerClassification} />
            <p className="font-medium">{p.title}</p>
            <p className="text-xs text-muted-foreground">{SCHEDULE_LABEL[p.scheduleType]} · {LOCATION_LABEL[p.workLocationType]}{payLabel(p.compensation) ? ` · ${payLabel(p.compensation)}` : ""}</p>
          </CardContent></Card>
        </button>
      ))}
      <Card>
        <CardHeader><CardTitle className="text-base">Want to see more?</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">Some opportunities are only shown to approved people. Request access and the company will review it.</p>
          <RequestAccessForm code={code} brand={branding} posting={null} onDone={() => undefined} />
        </CardContent>
      </Card>
    </Shell>
  );
}

export function ActivateApplicantPage() {
  const [, setLocation] = useLocation();
  const token = (() => { try { return new URLSearchParams(window.location.search).get("token") ?? ""; } catch { return ""; } })();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  return (
    <Shell>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />Create your applicant account</CardTitle></CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-3" data-testid="panel-activation-done">
              <p className="text-sm flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-600" />Your account is ready. Sign in as <strong>{done}</strong>.</p>
              <Button onClick={() => setLocation("/login")} data-testid="btn-activation-login">Sign in</Button>
            </div>
          ) : (
            <form className="space-y-3" onSubmit={async (e) => {
              e.preventDefault(); setErr(null);
              if (password !== confirm) { setErr("Passwords do not match"); return; }
              setBusy(true);
              const r = await post<{ username: string }>("/api/public/job-board/activate", { token, username, password });
              setBusy(false);
              if (r.ok && r.data) setDone(r.data.username); else setErr(r.message ?? "This link is invalid or has expired.");
            }}>
              <div><Label>Username</Label><Input value={username} autoComplete="username" onChange={(e) => setUsername(e.target.value)} data-testid="input-activate-username" /></div>
              <div><Label>Password (12+ characters)</Label><Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-activate-password" /></div>
              <div><Label>Confirm password</Label><Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="input-activate-confirm" /></div>
              {err && <p className="text-sm text-destructive" data-testid="text-activation-error">{err}</p>}
              <Button type="submit" disabled={busy || !token} data-testid="btn-activate-submit">{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Create account</Button>
              <p className="text-xs text-muted-foreground">This link works once and expires. An applicant account can view the positions shared with you and your own applications — nothing else.</p>
            </form>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}

export default function JobBoardPublicRoute() {
  const [location] = useLocation();
  return location === "/jobs/activate" ? <ActivateApplicantPage /> : <PublicJobBoardPage />;
}
