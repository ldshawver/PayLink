import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";
import {
  Mail,
  Save,
  Send,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  Lock,
} from "lucide-react";

interface SmtpConfig {
  id?: number;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  hasPassword?: boolean;
  tlsMode?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
  isConfigured?: boolean;
  lastTestedAt?: string | null;
  lastTestResult?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  canEdit?: boolean;
}

export default function EmailSettingsPage() {
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const { data: config, isLoading } = useQuery<SmtpConfig>({
    queryKey: ["/api/admin/smtp-config"],
  });

  const [form, setForm] = useState({
    host: "",
    port: "587",
    username: "",
    password: "",
    tlsMode: "starttls",
    fromName: "",
    fromEmail: "",
  });

  const [formInitialized, setFormInitialized] = useState(false);

  useEffect(() => {
    if (config && !formInitialized) {
      setForm({
        host: config.host ?? "",
        port: String(config.port ?? 587),
        username: config.username ?? "",
        password: "",
        tlsMode: config.tlsMode ?? "starttls",
        fromName: config.fromName ?? "",
        fromEmail: config.fromEmail ?? "",
      });
      setFormInitialized(true);
    }
  }, [config, formInitialized]);

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/admin/smtp-config", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/smtp-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/notification-status"] });
      setForm(f => ({ ...f, password: "" }));
      toast({ title: "SMTP settings saved", description: "Email configuration has been updated." });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/smtp-config/test", { toEmail: testEmail }),
    onSuccess: () => {
      setTestResult({ success: true, message: `Test email successfully sent to ${testEmail}` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/smtp-config"] });
      toast({ title: "Test email sent!", description: `Sent to ${testEmail}` });
    },
    onError: (err: any) => {
      setTestResult({ success: false, message: err.message ?? "Failed to send test email" });
    },
  });

  const isConfigured = config?.isConfigured ?? false;
  const canEdit = config?.canEdit ?? false;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground" aria-label="Breadcrumb" data-testid="breadcrumb-email-settings">
        <Link href="/app/settings" className="hover:text-foreground transition-colors">Settings</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">Email / SMTP</span>
      </nav>
      <div className="flex items-center gap-3">
        <Link href="/app/settings">
          <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-back-settings">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="h-6 w-6 text-teal-600" />
            Email / SMTP Settings
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Configure the outgoing email server for notifications and alerts.</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isConfigured ? (
          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800 gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />Configured
          </Badge>
        ) : (
          <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800 gap-1">
            <AlertCircle className="h-3.5 w-3.5" />Not Configured
          </Badge>
        )}
        {config?.lastTestedAt && (
          <span className="text-xs text-muted-foreground">
            Last tested: {new Date(config.lastTestedAt).toLocaleString()} —{" "}
            <span className={config.lastTestResult === "success" ? "text-emerald-600" : "text-destructive"}>
              {config.lastTestResult}
            </span>
          </span>
        )}
      </div>

      {isLoading ? (
        <Card className="h-48 animate-pulse bg-muted/30" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Server Configuration</CardTitle>
            <CardDescription>
              {canEdit
                ? "Enter your SMTP server details. Credentials are stored securely and never re-displayed."
                : "You have view-only access to this configuration. Contact an administrator to make changes."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="smtp-host">SMTP Host</Label>
                <Input
                  id="smtp-host"
                  placeholder="smtp.example.com"
                  value={form.host}
                  onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                  disabled={!canEdit}
                  data-testid="input-smtp-host"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="smtp-port">Port</Label>
                <Input
                  id="smtp-port"
                  type="number"
                  placeholder="587"
                  value={form.port}
                  onChange={e => setForm(f => ({ ...f, port: e.target.value }))}
                  disabled={!canEdit}
                  data-testid="input-smtp-port"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="smtp-tls">TLS / Security Mode</Label>
              <Select value={form.tlsMode} onValueChange={v => setForm(f => ({ ...f, tlsMode: v }))} disabled={!canEdit}>
                <SelectTrigger id="smtp-tls" data-testid="select-smtp-tls">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="starttls">STARTTLS (port 587, recommended)</SelectItem>
                  <SelectItem value="ssl">SSL/TLS (port 465)</SelectItem>
                  <SelectItem value="none">None (insecure)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-1.5">
              <Label htmlFor="smtp-username">Username / Email</Label>
              <Input
                id="smtp-username"
                type="email"
                placeholder="sender@yourcompany.com"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                disabled={!canEdit}
                data-testid="input-smtp-username"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="smtp-password">
                Password
                {config?.hasPassword && (
                  <span className="ml-2 text-xs text-muted-foreground inline-flex items-center gap-1">
                    <Lock className="h-3 w-3" />Saved — enter new value to change
                  </span>
                )}
              </Label>
              <div className="relative">
                <Input
                  id="smtp-password"
                  type={showPassword ? "text" : "password"}
                  placeholder={config?.hasPassword ? "••••••••••••" : "Enter password"}
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  disabled={!canEdit}
                  data-testid="input-smtp-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(s => !s)}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="smtp-from-name">From Name</Label>
                <Input
                  id="smtp-from-name"
                  placeholder="PayLink Notifications"
                  value={form.fromName}
                  onChange={e => setForm(f => ({ ...f, fromName: e.target.value }))}
                  disabled={!canEdit}
                  data-testid="input-smtp-from-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="smtp-from-email">From Email</Label>
                <Input
                  id="smtp-from-email"
                  type="email"
                  placeholder="noreply@yourcompany.com"
                  value={form.fromEmail}
                  onChange={e => setForm(f => ({ ...f, fromEmail: e.target.value }))}
                  disabled={!canEdit}
                  data-testid="input-smtp-from-email"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                onClick={() => { setTestResult(null); setTestDialogOpen(true); }}
                disabled={!isConfigured || !canEdit}
                data-testid="button-test-smtp"
              >
                <Send className="h-4 w-4 mr-2" />Send Test Email
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!canEdit || saveMutation.isPending}
                data-testid="button-save-smtp"
              >
                <Save className="h-4 w-4 mr-2" />
                {saveMutation.isPending ? "Saving…" : "Save Settings"}
              </Button>
            </div>

            {config?.updatedBy && config?.updatedAt && (
              <p className="text-xs text-muted-foreground">
                Last saved by {config.updatedBy} on {new Date(config.updatedAt).toLocaleDateString()}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={testDialogOpen} onOpenChange={open => { setTestDialogOpen(open); if (!open) setTestResult(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Test Email</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Send a test email to verify your SMTP configuration is working correctly.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="test-email-addr">Recipient Email</Label>
              <Input
                id="test-email-addr"
                type="email"
                placeholder="admin@example.com"
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                data-testid="input-test-email-addr"
              />
            </div>
            {testResult && (
              <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${testResult.success ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-destructive/10 text-destructive border border-destructive/20"}`}>
                {testResult.success ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                {testResult.message}
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" data-testid="button-cancel-test-smtp">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending || !testEmail}
              data-testid="button-confirm-test-smtp"
            >
              <Send className="h-4 w-4 mr-2" />
              {testMutation.isPending ? "Sending…" : "Send Test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
