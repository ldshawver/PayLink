import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

type ValidateState =
  | { phase: "loading" }
  | { phase: "invalid"; message: string }
  | { phase: "valid"; email: string; companyName: string | null; relationshipKind: string };

/**
 * Public invite-acceptance page (PR 1 — SaaS identity/onboarding). The invitee
 * arrives via an emailed link carrying a raw token; they choose a username and
 * password here — no admin ever types a password for them. On success the
 * server establishes the session and this redirects into the app.
 */
export default function AcceptInvitePage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const token = new URLSearchParams(search).get("token") || "";

  const [state, setState] = useState<ValidateState>({ phase: "loading" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) { setState({ phase: "invalid", message: "This link is missing its invite token." }); return; }
    let cancelled = false;
    fetch(`/api/account-invites/validate?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok && body.valid) {
          setState({ phase: "valid", email: body.email, companyName: body.companyName ?? null, relationshipKind: body.relationshipKind });
          setUsername((body.email || "").split("@")[0].replace(/[^a-zA-Z0-9._-]/g, ""));
        } else {
          setState({ phase: "invalid", message: body.message || "This invite link is invalid or has expired." });
        }
      })
      .catch(() => { if (!cancelled) setState({ phase: "invalid", message: "Could not reach the server. Try again." }); });
    return () => { cancelled = true; };
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setSubmitting(true);
    try {
      const r = await fetch("/api/account-invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, username, password }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setError(body.message || "Could not complete sign-up."); setSubmitting(false); return; }
      window.location.href = body.redirect || "/app";
    } catch {
      setError("Could not complete sign-up. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Set up your account</CardTitle>
        </CardHeader>
        <CardContent>
          {state.phase === "loading" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6" data-testid="accept-invite-loading">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking your invite…
            </div>
          )}

          {state.phase === "invalid" && (
            <div className="space-y-4 py-4" data-testid="accept-invite-invalid">
              <div className="flex items-center gap-2 text-destructive text-sm">
                <XCircle className="h-4 w-4" /> {state.message}
              </div>
              <Button variant="outline" onClick={() => setLocation("/login")}>Go to sign in</Button>
            </div>
          )}

          {state.phase === "valid" && (
            <form onSubmit={submit} className="space-y-4" data-testid="accept-invite-form">
              <div className="rounded-md bg-muted/50 p-3 text-sm">
                <div className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-4 w-4 text-green-600" /> Invite confirmed</div>
                <p className="mt-1 text-muted-foreground">
                  {state.companyName ? <><span className="font-medium">{state.companyName}</span> · </> : null}
                  {state.email}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-username">Username</Label>
                <Input id="ai-username" data-testid="input-accept-username" value={username}
                  onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-password">Password</Label>
                <Input id="ai-password" data-testid="input-accept-password" type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required placeholder="At least 8 characters" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-confirm">Confirm password</Label>
                <Input id="ai-confirm" data-testid="input-accept-confirm" type="password" value={confirm}
                  onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
              </div>
              {error && <p className="text-sm text-destructive" data-testid="text-accept-error">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting} data-testid="button-accept-submit">
                {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Creating account…</> : "Create account & sign in"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
