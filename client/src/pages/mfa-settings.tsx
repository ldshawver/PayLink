import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Shield, ShieldCheck, ShieldOff, Smartphone, RefreshCw, Copy, ExternalLink, AlertTriangle } from "lucide-react";

type MfaStatus = { mfaEnabled: boolean; enrollmentPending: boolean };
type EnrollData = { otpauthUri: string; secret: string; accountName: string };

const codeSchema = z.object({
  token: z.string().min(6).max(6).regex(/^\d{6}$/, "Must be exactly 6 digits"),
});
type CodeValues = z.infer<typeof codeSchema>;

function QRCodeDisplay({ otpauthUri, secret }: { otpauthUri: string; secret: string }) {
  const [copied, setCopied] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);

  function copySecret() {
    navigator.clipboard.writeText(secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function copyUri() {
    navigator.clipboard.writeText(otpauthUri).then(() => {
      setCopiedUri(true);
      setTimeout(() => setCopiedUri(false), 2000);
    });
  }

  return (
    <div className="space-y-4 w-full">
      <div className="rounded-lg border bg-blue-50 dark:bg-blue-950 p-3 text-sm text-blue-800 dark:text-blue-200 space-y-1">
        <p className="font-medium">On your mobile device:</p>
        <ol className="list-decimal list-inside space-y-1 text-xs">
          <li>Open your authenticator app (Google Authenticator, Authy, 1Password, etc.)</li>
          <li>Tap "+" or "Add account"</li>
          <li>Choose "Enter setup key" and enter the key below</li>
        </ol>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Setup key (base32)</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm font-mono bg-muted px-3 py-2 rounded-lg break-all tracking-widest" data-testid="text-totp-secret">
            {secret}
          </code>
          <Button variant="outline" size="icon" onClick={copySecret} title="Copy setup key" data-testid="button-copy-secret">
            {copied ? <ShieldCheck className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Algorithm: TOTP · Digits: 6 · Period: 30 s</p>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Open in authenticator app (mobile)</p>
        <div className="flex items-center gap-2">
          <a
            href={otpauthUri}
            className="flex-1 text-xs font-mono bg-muted px-3 py-2 rounded-lg break-all text-blue-600 dark:text-blue-400 underline truncate"
            data-testid="link-otpauth-uri"
          >
            {otpauthUri.substring(0, 60)}…
          </a>
          <Button variant="outline" size="icon" onClick={copyUri} title="Copy full URI" data-testid="button-copy-uri">
            {copiedUri ? <ShieldCheck className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function MfaSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [enrollData, setEnrollData] = useState<EnrollData | null>(null);
  const [showDisableForm, setShowDisableForm] = useState(false);

  const { data: status, isLoading } = useQuery<MfaStatus>({
    queryKey: ["/api/auth/mfa/status"],
    queryFn: async () => {
      const r = await fetch("/api/auth/mfa/status");
      if (!r.ok) throw new Error("Failed to fetch MFA status");
      return r.json();
    },
  });

  const enrollMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auth/mfa/enroll"),
    onSuccess: (data: EnrollData) => {
      setEnrollData(data);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to start MFA enrollment.", variant: "destructive" });
    },
  });

  const confirmForm = useForm<CodeValues>({
    resolver: zodResolver(codeSchema),
    defaultValues: { token: "" },
  });

  const confirmMutation = useMutation({
    mutationFn: (values: CodeValues) => apiRequest("POST", "/api/auth/mfa/confirm", values),
    onSuccess: () => {
      toast({ title: "MFA enabled", description: "Two-factor authentication is now active on your account." });
      setEnrollData(null);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/mfa/status"] });
    },
    onError: (err: any) => {
      toast({ title: "Invalid code", description: err?.message ?? "The code was incorrect or expired. Try again.", variant: "destructive" });
    },
  });

  const disableForm = useForm<CodeValues>({
    resolver: zodResolver(codeSchema),
    defaultValues: { token: "" },
  });

  const disableMutation = useMutation({
    mutationFn: (values: CodeValues) => apiRequest("POST", "/api/auth/mfa/disable", values),
    onSuccess: () => {
      toast({ title: "MFA disabled", description: "Two-factor authentication has been removed from your account." });
      setShowDisableForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/mfa/status"] });
    },
    onError: (err: any) => {
      toast({ title: "Invalid code", description: err?.message ?? "Could not verify MFA code.", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6">
        <div className="h-48 bg-muted/30 rounded-lg animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-mfa-title">Two-Factor Authentication</h1>
          <p className="text-muted-foreground text-sm">Protect your account with TOTP-based MFA (Google Authenticator, Authy, etc.)</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">MFA Status</CardTitle>
            <Badge
              data-testid="status-mfa"
              className={
                status?.mfaEnabled
                  ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                  : status?.enrollmentPending
                  ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                  : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
              }
            >
              {status?.mfaEnabled ? "Enabled" : status?.enrollmentPending ? "Pending Confirmation" : "Disabled"}
            </Badge>
          </div>
          <CardDescription>
            {status?.mfaEnabled
              ? "Your account is protected with two-factor authentication."
              : status?.enrollmentPending
              ? "You've started enrollment but haven't confirmed your authenticator yet."
              : "Add an extra layer of security to your account."}
          </CardDescription>
        </CardHeader>
      </Card>

      {!status?.mfaEnabled && !enrollData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Smartphone className="h-4 w-4" />
              Enable Two-Factor Authentication
            </CardTitle>
            <CardDescription>
              You'll need an authenticator app like{" "}
              <a href="https://support.google.com/accounts/answer/1066447" target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">
                Google Authenticator <ExternalLink className="h-3 w-3" />
              </a>{" "}
              or{" "}
              <a href="https://authy.com" target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">
                Authy <ExternalLink className="h-3 w-3" />
              </a>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => enrollMutation.mutate()}
              disabled={enrollMutation.isPending}
              data-testid="button-start-mfa-enrollment"
            >
              {enrollMutation.isPending ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Generating…</>
              ) : (
                <><ShieldCheck className="h-4 w-4 mr-2" />Set Up Authenticator App</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {enrollData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 1 — Add to Authenticator App</CardTitle>
            <CardDescription>Enter the setup key below into your authenticator app.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <QRCodeDisplay otpauthUri={enrollData.otpauthUri} secret={enrollData.secret} />

            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-3">Step 2 — Enter the 6-digit code from your app</p>
              <Form {...confirmForm}>
                <form onSubmit={confirmForm.handleSubmit(v => confirmMutation.mutate(v))} className="flex items-end gap-3">
                  <FormField control={confirmForm.control} name="token" render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel>Verification Code</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="123456"
                          maxLength={6}
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          data-testid="input-totp-confirm"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" disabled={confirmMutation.isPending} data-testid="button-confirm-mfa">
                    {confirmMutation.isPending ? "Verifying…" : "Verify & Enable"}
                  </Button>
                </form>
              </Form>
            </div>

            <Button variant="ghost" size="sm" onClick={() => setEnrollData(null)} className="text-muted-foreground" data-testid="button-cancel-enrollment">
              Cancel enrollment
            </Button>
          </CardContent>
        </Card>
      )}

      {status?.mfaEnabled && (
        <Card className="border-red-200 dark:border-red-800">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-red-700 dark:text-red-400">
              <ShieldOff className="h-4 w-4" />
              Disable Two-Factor Authentication
            </CardTitle>
            <CardDescription>
              <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" />
                This will make your account less secure. You'll need your current authenticator code.
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!showDisableForm ? (
              <Button
                variant="destructive"
                onClick={() => setShowDisableForm(true)}
                data-testid="button-start-mfa-disable"
              >
                <ShieldOff className="h-4 w-4 mr-2" />
                Disable MFA
              </Button>
            ) : (
              <Form {...disableForm}>
                <form onSubmit={disableForm.handleSubmit(v => disableMutation.mutate(v))} className="flex items-end gap-3">
                  <FormField control={disableForm.control} name="token" render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel>Current MFA Code</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="123456"
                          maxLength={6}
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          data-testid="input-totp-disable"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" variant="destructive" disabled={disableMutation.isPending} data-testid="button-confirm-disable-mfa">
                    {disableMutation.isPending ? "Disabling…" : "Confirm Disable"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setShowDisableForm(false)} data-testid="button-cancel-disable-mfa">
                    Cancel
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">About TOTP MFA</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>PayLink uses Time-based One-Time Passwords (TOTP) per RFC 6238. Codes refresh every 30 seconds.</p>
          <p>Your TOTP secret is encrypted with AES-256-GCM and stored securely. It is never transmitted after enrollment.</p>
          <p>MFA enrollment and disable events are logged in the platform privacy audit trail for SOC 2 compliance.</p>
        </CardContent>
      </Card>
    </div>
  );
}
