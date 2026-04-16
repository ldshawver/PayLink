import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";
import {
  MessageSquare,
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

interface SmsConfig {
  id?: number;
  provider?: string | null;
  accountSid?: string | null;
  hasAuthToken?: boolean;
  fromNumber?: string | null;
  messagingServiceSid?: string | null;
  isConfigured?: boolean;
  lastTestedAt?: string | null;
  lastTestResult?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  canEdit?: boolean;
}

export default function SmsSettingsPage() {
  const { toast } = useToast();
  const [showAuthToken, setShowAuthToken] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const { data: config, isLoading } = useQuery<SmsConfig>({
    queryKey: ["/api/admin/sms-config"],
  });

  const [form, setForm] = useState({
    provider: "twilio",
    accountSid: "",
    authToken: "",
    fromNumber: "",
    messagingServiceSid: "",
  });

  const [formInitialized, setFormInitialized] = useState(false);

  useEffect(() => {
    if (config && !formInitialized) {
      setForm({
        provider: config.provider ?? "twilio",
        accountSid: config.accountSid ?? "",
        authToken: "",
        fromNumber: config.fromNumber ?? "",
        messagingServiceSid: config.messagingServiceSid ?? "",
      });
      setFormInitialized(true);
    }
  }, [config, formInitialized]);

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/admin/sms-config", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sms-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/notification-status"] });
      setForm(f => ({ ...f, authToken: "" }));
      toast({ title: "SMS settings saved", description: "Twilio configuration has been updated." });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/sms-config/test", { toPhone: testPhone }),
    onSuccess: () => {
      setTestResult({ success: true, message: `Test SMS successfully sent to ${testPhone}` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sms-config"] });
      toast({ title: "Test SMS sent!", description: `Sent to ${testPhone}` });
    },
    onError: (err: any) => {
      setTestResult({ success: false, message: err.message ?? "Failed to send test SMS" });
    },
  });

  const isConfigured = config?.isConfigured ?? false;
  const canEdit = config?.canEdit ?? false;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground" aria-label="Breadcrumb" data-testid="breadcrumb-sms-settings">
        <Link href="/app/settings" className="hover:text-foreground transition-colors">Settings</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">SMS / Twilio</span>
      </nav>
      <div className="flex items-center gap-3">
        <Link href="/app/settings">
          <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-back-settings">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-blue-600" />
            SMS Settings
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Configure Twilio for sending text message notifications.</p>
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
            <CardTitle className="text-base">Twilio Configuration</CardTitle>
            <CardDescription>
              {canEdit ? (
                <>
                  Enter your Twilio account credentials. Auth tokens are stored securely and never re-displayed.
                  {" "}<a href="https://console.twilio.com" target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline text-xs">Open Twilio Console →</a>
                </>
              ) : (
                "You have view-only access to this configuration. Contact an administrator to make changes."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sms-provider">Provider</Label>
              <div className="h-9 px-3 rounded-md border bg-muted/40 flex items-center text-sm font-medium text-muted-foreground" data-testid="text-sms-provider">
                Twilio
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sms-account-sid">Account SID</Label>
              <Input
                id="sms-account-sid"
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={form.accountSid}
                onChange={e => setForm(f => ({ ...f, accountSid: e.target.value }))}
                disabled={!canEdit}
                data-testid="input-sms-account-sid"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sms-auth-token">
                Auth Token
                {config?.hasAuthToken && (
                  <span className="ml-2 text-xs text-muted-foreground inline-flex items-center gap-1">
                    <Lock className="h-3 w-3" />Saved — enter new value to change
                  </span>
                )}
              </Label>
              <div className="relative">
                <Input
                  id="sms-auth-token"
                  type={showAuthToken ? "text" : "password"}
                  placeholder={config?.hasAuthToken ? "••••••••••••••••••••••••••••••••" : "Enter Auth Token"}
                  value={form.authToken}
                  onChange={e => setForm(f => ({ ...f, authToken: e.target.value }))}
                  disabled={!canEdit}
                  data-testid="input-sms-auth-token"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowAuthToken(s => !s)}
                  data-testid="button-toggle-auth-token"
                >
                  {showAuthToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Separator />

            <div className="space-y-1.5">
              <Label htmlFor="sms-from-number">Sending Phone Number</Label>
              <Input
                id="sms-from-number"
                placeholder="+15551234567"
                value={form.fromNumber}
                onChange={e => setForm(f => ({ ...f, fromNumber: e.target.value }))}
                disabled={!canEdit}
                data-testid="input-sms-from-number"
              />
              <p className="text-xs text-muted-foreground">Your Twilio phone number in E.164 format (+1XXXXXXXXXX)</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sms-messaging-sid">
                Messaging Service SID{" "}
                <span className="text-muted-foreground text-xs">(optional — overrides From Number)</span>
              </Label>
              <Input
                id="sms-messaging-sid"
                placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={form.messagingServiceSid}
                onChange={e => setForm(f => ({ ...f, messagingServiceSid: e.target.value }))}
                disabled={!canEdit}
                data-testid="input-sms-messaging-sid"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                onClick={() => { setTestResult(null); setTestDialogOpen(true); }}
                disabled={!isConfigured || !canEdit}
                data-testid="button-test-sms"
              >
                <Send className="h-4 w-4 mr-2" />Send Test SMS
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!canEdit || saveMutation.isPending}
                data-testid="button-save-sms"
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
            <DialogTitle>Send Test SMS</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Send a test text message to verify your Twilio configuration is working correctly.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="test-phone-num">Recipient Phone Number</Label>
              <Input
                id="test-phone-num"
                type="tel"
                placeholder="+1 (555) 000-0000"
                value={testPhone}
                onChange={e => setTestPhone(e.target.value)}
                data-testid="input-test-phone-num"
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
              <Button variant="ghost" data-testid="button-cancel-test-sms">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending || !testPhone}
              data-testid="button-confirm-test-sms"
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
