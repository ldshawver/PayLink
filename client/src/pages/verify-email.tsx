import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

type State =
  | { phase: "verifying" }
  | { phase: "success" }
  | { phase: "error"; message: string };

/**
 * Public email-verification landing page (Concierge Launch Option A,
 * blocker 5). The trial-signup emailed link lands here with a raw token in
 * the query string; on success the server establishes the session and this
 * redirects into the app, same shape as accept-invite.tsx.
 */
export default function VerifyEmailPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const token = new URLSearchParams(search).get("token") || "";

  const [state, setState] = useState<State>({ phase: "verifying" });
  const [resendEmail, setResendEmail] = useState("");
  const [resendSent, setResendSent] = useState(false);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!token) { setState({ phase: "error", message: "This link is missing its verification token." }); return; }
    let cancelled = false;
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok) {
          setState({ phase: "success" });
          setTimeout(() => { window.location.href = "/app"; }, 1200);
        } else {
          setState({ phase: "error", message: body.message || "This verification link is invalid or has expired." });
        }
      })
      .catch(() => { if (!cancelled) setState({ phase: "error", message: "Could not reach the server. Try again." }); });
    return () => { cancelled = true; };
  }, [token]);

  async function resend(e: React.FormEvent) {
    e.preventDefault();
    setResending(true);
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resendEmail }),
      });
    } finally {
      setResending(false);
      setResendSent(true);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Verify your email</CardTitle>
        </CardHeader>
        <CardContent>
          {state.phase === "verifying" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6" data-testid="verify-email-loading">
              <Loader2 className="h-4 w-4 animate-spin" /> Verifying your email…
            </div>
          )}

          {state.phase === "success" && (
            <div className="space-y-2 py-4" data-testid="verify-email-success">
              <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
                <CheckCircle2 className="h-4 w-4" /> Email verified — signing you in…
              </div>
            </div>
          )}

          {state.phase === "error" && (
            <div className="space-y-4 py-2" data-testid="verify-email-invalid">
              <div className="flex items-center gap-2 text-destructive text-sm">
                <XCircle className="h-4 w-4" /> {state.message}
              </div>
              {!resendSent ? (
                <form onSubmit={resend} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="resend-email">Resend the verification link</Label>
                    <Input id="resend-email" type="email" required value={resendEmail}
                      onChange={(e) => setResendEmail(e.target.value)} placeholder="you@company.com"
                      data-testid="input-resend-email" />
                  </div>
                  <Button type="submit" disabled={resending} data-testid="button-resend-verification">
                    {resending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending…</> : "Resend link"}
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-resend-sent">
                  If that email has a pending verification, a new link is on its way.
                </p>
              )}
              <Button variant="outline" onClick={() => setLocation("/login")}>Go to sign in</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
