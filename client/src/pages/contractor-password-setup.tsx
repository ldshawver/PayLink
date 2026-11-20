import { useState } from "react";
import { useSearch, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

/**
 * Public password-setup page for the contractor welcome email. The raw token
 * in the query string is the credential; the server checks it only when the
 * form is submitted (one generic answer for every invalid link). Nothing about
 * the account is shown before that.
 */
export default function ContractorPasswordSetupPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const token = new URLSearchParams(search).get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setSubmitting(true);
    try {
      const r = await fetch("/api/contractor-onboarding/password-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setError(body.message || "This link is invalid or has expired."); setSubmitting(false); return; }
      setDone(true);
    } catch {
      setError("Could not reach the server. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Set your password</CardTitle>
        </CardHeader>
        <CardContent>
          {!token && (
            <div className="space-y-4 py-4" data-testid="password-setup-invalid">
              <div className="flex items-center gap-2 text-destructive text-sm">
                <XCircle className="h-4 w-4" /> This link is missing its token.
              </div>
              <Button variant="outline" onClick={() => setLocation("/login")}>Go to sign in</Button>
            </div>
          )}
          {token && done && (
            <div className="space-y-4 py-4" data-testid="password-setup-done">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-600" /> Your password is set. Sign in with your new password.
              </div>
              <Button onClick={() => setLocation("/login")} data-testid="button-password-setup-signin">Go to sign in</Button>
            </div>
          )}
          {token && !done && (
            <form onSubmit={submit} className="space-y-4" data-testid="password-setup-form">
              <div className="space-y-1.5">
                <Label htmlFor="ps-password">New password</Label>
                <Input id="ps-password" data-testid="input-password-setup-password" type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required placeholder="At least 8 characters" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ps-confirm">Confirm password</Label>
                <Input id="ps-confirm" data-testid="input-password-setup-confirm" type="password" value={confirm}
                  onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
              </div>
              {error && <p className="text-sm text-destructive" data-testid="text-password-setup-error">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting} data-testid="button-password-setup-submit">
                {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving…</> : "Set password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
