import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { MessageSquarePlus, Loader2, Camera, Info, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

// ── Global console-error capture buffer (set up once at module load) ──────────
const _errBuf: Array<{ msg: string; source?: string; ts: string; stack?: string }> = [];
if (typeof window !== "undefined") {
  const _orig = window.onerror;
  window.onerror = function (message, source, _ln, _col, error) {
    _errBuf.push({
      msg: String(message),
      source: source ?? undefined,
      stack: error?.stack?.slice(0, 400) ?? undefined,
      ts: new Date().toISOString(),
    });
    if (_errBuf.length > 12) _errBuf.shift();
    return typeof _orig === "function" ? (_orig as any).apply(this, arguments) : false;
  };
  window.addEventListener("unhandledrejection", (e) => {
    _errBuf.push({
      msg: "UnhandledRejection: " + (e.reason?.message ?? String(e.reason)),
      stack: e.reason?.stack?.slice(0, 400) ?? undefined,
      ts: new Date().toISOString(),
    });
    if (_errBuf.length > 12) _errBuf.shift();
  });
}


function scrubSensitiveText(value: string): string {
  return value
    .replace(/(password|passwd|pwd|token|secret|api[-_ ]?key|authorization|bearer)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted-number]");
}

function sanitizedErrorBuffer() {
  return _errBuf.map(error => ({
    ...error,
    msg: scrubSensitiveText(error.msg).slice(0, 500),
    source: error.source ? scrubSensitiveText(error.source).slice(0, 200) : undefined,
    stack: error.stack ? scrubSensitiveText(error.stack).slice(0, 400) : undefined,
  }));
}

const TYPE_OPTIONS = [
  { value: "bug", label: "Bug Report", icon: "🐛", desc: "Something isn't working correctly" },
  { value: "ux", label: "UX / Improvement", icon: "✨", desc: "The experience could be better" },
  { value: "feature", label: "Feature Request", icon: "💡", desc: "Suggest something new" },
  { value: "change_request", label: "Change Request", icon: "🔄", desc: "Request a change to existing behavior" },
  { value: "hr", label: "HR / Workplace Concern", icon: "🛡️", desc: "Harassment, employee issues, safety, or workplace concerns" },
  { value: "general", label: "General Feedback", icon: "💬", desc: "Other comments or suggestions" },
];

const SEVERITY_OPTIONS = [
  { value: "low", label: "Low — minor inconvenience" },
  { value: "medium", label: "Medium — affects workflow" },
  { value: "high", label: "High — significant impact" },
  { value: "critical", label: "Critical — blocks work entirely" },
];

export function FeedbackButton() {
  const { user } = useAuth();
  const [location] = useLocation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [type, setType] = useState("bug");
  const [severity, setSeverity] = useState("medium");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [stepsToReproduce, setStepsToReproduce] = useState("");
  const [expectedBehavior, setExpectedBehavior] = useState("");
  const [actualBehavior, setActualBehavior] = useState("");
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [capturedAt, setCapturedAt] = useState(() => new Date());
  const screenshotInputRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const isBug = type === "bug";
  const isHr = type === "hr";

  const reset = () => {
    setType("bug"); setSeverity("medium"); setTitle(""); setDescription("");
    setErrorCode(""); setStepsToReproduce(""); setExpectedBehavior(""); setActualBehavior("");
    setScreenshots([]);
  };

  const addScreenshots = (files: FileList | null) => {
    if (!files) return;
    const incoming = Array.from(files);
    setScreenshots(prev => [...prev, ...incoming].slice(0, 3));
  };

  const removeScreenshot = (idx: number) => setScreenshots(prev => prev.filter((_, i) => i !== idx));

  const openFeedbackForm = () => {
    setCapturedAt(new Date());
    setOpen(true);
  };

  const buildClientContext = () => {
    if (typeof window === "undefined") return {};
    return {
      capturedAt: capturedAt.toISOString(),
      url: window.location.href,
      path: window.location.pathname + window.location.search + window.location.hash,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      screen: typeof window.screen !== "undefined" ? { width: window.screen.width, height: window.screen.height, pixelRatio: window.devicePixelRatio } : null,
      scroll: { x: window.scrollX, y: window.scrollY },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
      platform: navigator.platform,
      online: navigator.onLine,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      toast({ title: "Title and description are required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("type", type);
      fd.append("severity", severity);
      fd.append("title", title.trim());
      fd.append("description", description.trim());
      fd.append("pageUrl", typeof window !== "undefined" ? window.location.href : location);
      if (errorCode.trim()) fd.append("errorCode", errorCode.trim());
      if (stepsToReproduce.trim()) fd.append("stepsToReproduce", stepsToReproduce.trim());
      if (expectedBehavior.trim()) fd.append("expectedBehavior", expectedBehavior.trim());
      if (actualBehavior.trim()) fd.append("actualBehavior", actualBehavior.trim());
      fd.append("consoleErrors", JSON.stringify({ recentErrors: sanitizedErrorBuffer(), clientContext: buildClientContext() }));
      screenshots.forEach(f => fd.append("screenshots", f));

      const r = await fetch("/api/feedback", { method: "POST", body: fd, credentials: "include" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || `Request failed (${r.status})`);
      }
      toast({ title: "Submitted!", description: "Your report is in. We'll review it soon." });
      reset();
      setOpen(false);
    } catch (err) {
      toast({ title: "Submission failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const pageDisplay = typeof window !== "undefined"
    ? (window.location.pathname + window.location.search).slice(0, 60) || "/"
    : location;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const browserDisplay = ua.includes("Firefox") ? "Firefox" : ua.includes("Edg") ? "Edge" : ua.includes("Chrome") ? "Chrome" : ua.includes("Safari") ? "Safari" : "Browser";
  const platform = typeof navigator !== "undefined" ? navigator.platform : "";

  return (
    <>
      <Button
        type="button"
        onClick={openFeedbackForm}
        data-testid="button-feedback-open"
        className="fixed bottom-5 left-5 sm:bottom-6 sm:left-6 z-[2147483647] shadow-xl rounded-full h-12 w-12 p-0 sm:h-auto sm:w-auto sm:px-4 sm:py-2 sm:rounded-full bg-gradient-to-br from-teal-600 to-blue-600 hover:from-teal-700 hover:to-blue-700 text-white"
        aria-label="Send feedback"
      >
        <MessageSquarePlus className="h-5 w-5 sm:mr-2" />
        <span className="hidden sm:inline">Feedback</span>
      </Button>

      <Dialog open={open} onOpenChange={v => { if (!v) setOpen(false); }}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto z-[2147483647]">
          <DialogHeader>
            <DialogTitle>Submit Feedback</DialogTitle>
            <DialogDescription>
              Share bugs, user experience feedback, feature requests, or HR/workplace concerns. Page URL, browser, timestamp, viewport, scroll position, and recent JS errors are captured automatically to reduce what you need to type. Your submission is visible in your Feedback tab and to authorized reviewers.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5 pt-1">

            {/* ── Report Type ── */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Report Type</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {TYPE_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setType(o.value)}
                    className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${type === o.value ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40"}`}
                    data-testid={`option-feedback-type-${o.value}`}
                  >
                    <span className="text-xl leading-none mt-0.5">{o.icon}</span>
                    <div>
                      <div className="text-sm font-medium leading-tight">{o.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{o.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Title + Severity ── */}
            <div className="grid grid-cols-3 gap-3 items-end">
              <div className="col-span-2 space-y-1">
                <Label htmlFor="fb-title">Title <span className="text-destructive">*</span></Label>
                <Input
                  id="fb-title"
                  data-testid="input-feedback-title"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={isBug ? "Short summary of the bug" : isHr ? "Short summary of the workplace concern" : "Short summary"}
                  maxLength={200}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fb-severity">Severity</Label>
                <Select value={severity} onValueChange={setSeverity}>
                  <SelectTrigger id="fb-severity" data-testid="select-feedback-severity"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEVERITY_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value} data-testid={`option-feedback-severity-${o.value}`}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* ── Description ── */}
            <div className="space-y-1">
              <Label htmlFor="fb-desc">Description <span className="text-destructive">*</span></Label>
              <Textarea
                id="fb-desc"
                data-testid="input-feedback-description"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={isBug
                  ? "Describe what happened. What were you doing when it occurred?"
                  : isHr
                    ? "Describe the concern, who was involved, dates/times, location, and any immediate safety needs."
                    : "Describe your feedback in detail."}
                rows={4}
                required
              />
            </div>

            {/* ── Error Code ── */}
            <div className="space-y-1">
              <Label htmlFor="fb-error-code">
                Error Code / Message <span className="text-muted-foreground text-xs font-normal">(optional)</span>
              </Label>
              <Input
                id="fb-error-code"
                data-testid="input-feedback-error-code"
                value={errorCode}
                onChange={e => setErrorCode(e.target.value)}
                placeholder="e.g. ERR_401, Cannot read properties of undefined, HTTP 500, etc."
              />
            </div>

            {/* ── Bug-specific fields ── */}
            {isBug && (
              <div className="space-y-3 p-4 bg-muted/30 rounded-lg border">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bug Details</p>
                <div className="space-y-1">
                  <Label htmlFor="fb-steps">Steps to Reproduce</Label>
                  <Textarea
                    id="fb-steps"
                    data-testid="input-feedback-steps"
                    value={stepsToReproduce}
                    onChange={e => setStepsToReproduce(e.target.value)}
                    placeholder={"1. Go to...\n2. Click on...\n3. Notice error / wrong behavior"}
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="fb-expected">Expected Behavior</Label>
                    <Textarea
                      id="fb-expected"
                      data-testid="input-feedback-expected"
                      value={expectedBehavior}
                      onChange={e => setExpectedBehavior(e.target.value)}
                      placeholder="What should have happened?"
                      rows={2}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="fb-actual">Actual Behavior</Label>
                    <Textarea
                      id="fb-actual"
                      data-testid="input-feedback-actual"
                      value={actualBehavior}
                      onChange={e => setActualBehavior(e.target.value)}
                      placeholder="What actually happened instead?"
                      rows={2}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── Screenshots ── */}
            <div className="space-y-2">
              <Label>Screenshots <span className="text-muted-foreground text-xs font-normal">(up to 3)</span></Label>
              {screenshots.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {screenshots.map((f, i) => (
                    <div key={i} className="relative group w-24 h-16">
                      <img
                        src={URL.createObjectURL(f)}
                        alt={`Screenshot ${i + 1}`}
                        className="w-full h-full object-cover rounded border"
                      />
                      <button
                        type="button"
                        onClick={() => removeScreenshot(i)}
                        className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        data-testid={`button-remove-screenshot-${i}`}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
              {screenshots.length < 3 && (
                <label
                  className="inline-flex items-center gap-2 cursor-pointer border rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
                  data-testid="upload-screenshot"
                >
                  <Camera className="h-4 w-4" />
                  {screenshots.length === 0 ? "Add screenshot" : "Add another"}
                  <input
                    ref={screenshotInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={e => addScreenshots(e.target.files)}
                    data-testid="input-feedback-screenshot"
                  />
                </label>
              )}
            </div>

            {/* ── Auto-captured info ── */}
            <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1.5">
              <p className="font-semibold text-foreground flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5" /> Automatically captured with this report
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-1">
                <span>📍 <span className="text-foreground font-mono">{pageDisplay}</span></span>
                <span>🕐 {capturedAt.toLocaleString()}</span>
                <span>🌐 {browserDisplay}{platform ? ` · ${platform}` : ""}</span>
                <span>📐 {typeof window !== "undefined" ? `${window.innerWidth}×${window.innerHeight}` : "Viewport"}</span>
                <span>⚠️ {_errBuf.length} recent JS error{_errBuf.length !== 1 ? "s" : ""} captured</span>
              </div>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 sm:items-center sm:justify-between">
              <a
                href="/app/my-feedback"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 order-last sm:order-first"
                onClick={() => setOpen(false)}
                data-testid="link-my-submissions"
              >
                <ExternalLink className="h-3 w-3" /> View my submissions
              </a>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting} data-testid="button-feedback-cancel">
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} data-testid="button-feedback-submit">
                  {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Submit Report
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
