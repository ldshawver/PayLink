import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2 } from "lucide-react";

/**
 * Public "Request Contractor Access" page (PR 2). Submitting only creates a
 * pending request — no account is created here. A company admin reviews it and,
 * on approval, an invite to set up a Contractor Hub login is emailed.
 */
export default function ContractorSignupPage() {
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "",
    businessName: "", tradeType: "", licenseNumber: "", requestedCompany: "", message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.firstName.trim() || !form.lastName.trim()) { setError("Please enter your first and last name."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { setError("Please enter a valid email address."); return; }
    setSubmitting(true);
    try {
      const r = await fetch("/api/contractor-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await r.json().catch(() => ({}));
      if (r.status === 429) { setError("Too many requests from your network. Please try again later."); setSubmitting(false); return; }
      if (!r.ok) { setError(body.message || "Could not submit your request."); setSubmitting(false); return; }
      setDone(true);
    } catch {
      setError("Could not reach the server. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Request Contractor Access</CardTitle>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="py-8 text-center space-y-3" data-testid="contractor-signup-done">
              <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto" />
              <p className="font-medium">Request submitted</p>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                A company administrator will review your request. If it's approved you'll get an email with a link to set up your
                Contractor Hub login.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" data-testid="contractor-signup-form">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cs-first">First name</Label>
                  <Input id="cs-first" data-testid="input-cs-firstName" value={form.firstName} onChange={set("firstName")} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cs-last">Last name</Label>
                  <Input id="cs-last" data-testid="input-cs-lastName" value={form.lastName} onChange={set("lastName")} required />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cs-email">Email</Label>
                <Input id="cs-email" type="email" data-testid="input-cs-email" value={form.email} onChange={set("email")} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cs-phone">Phone <span className="text-xs text-muted-foreground">(optional)</span></Label>
                  <Input id="cs-phone" data-testid="input-cs-phone" value={form.phone} onChange={set("phone")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cs-biz">Business name <span className="text-xs text-muted-foreground">(optional)</span></Label>
                  <Input id="cs-biz" data-testid="input-cs-businessName" value={form.businessName} onChange={set("businessName")} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cs-trade">Trade / service <span className="text-xs text-muted-foreground">(optional)</span></Label>
                  <Input id="cs-trade" data-testid="input-cs-tradeType" value={form.tradeType} onChange={set("tradeType")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cs-lic">License # <span className="text-xs text-muted-foreground">(optional)</span></Label>
                  <Input id="cs-lic" data-testid="input-cs-licenseNumber" value={form.licenseNumber} onChange={set("licenseNumber")} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cs-req">Company you're requesting access to <span className="text-xs text-muted-foreground">(optional)</span></Label>
                <Input id="cs-req" data-testid="input-cs-requestedCompany" value={form.requestedCompany} onChange={set("requestedCompany")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cs-msg">Message / services offered <span className="text-xs text-muted-foreground">(optional)</span></Label>
                <Textarea id="cs-msg" data-testid="input-cs-message" value={form.message} onChange={set("message")} rows={3} />
              </div>
              {error && <p className="text-sm text-destructive" data-testid="text-cs-error">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting} data-testid="button-cs-submit">
                {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Submitting…</> : "Submit request"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                No account is created now. Already have a login? <a href="/login" className="underline">Sign in</a>.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
