import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Mail,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Send,
  Save,
  Info,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

interface NotificationTemplate {
  id: number;
  event_type: string;
  label: string;
  description: string | null;
  email_enabled: boolean;
  sms_enabled: boolean;
  email_subject: string;
  email_body: string;
  sms_body: string;
  variables: string[];
  updated_at: string | null;
  updated_by: string | null;
}

interface NotifStatus {
  email: { configured: boolean; from: string | null; missing?: string[]; derivedHost?: string | null };
  sms: { configured: boolean; fromNumber: string | null; missing?: string[] };
}

function VariableBadge({ v }: { v: string }) {
  return (
    <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-teal-700 dark:text-teal-400 border border-teal-200 dark:border-teal-800">
      {v}
    </code>
  );
}

function TemplateCard({ template, status }: { template: NotificationTemplate; status: NotifStatus | undefined }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    emailEnabled: template.email_enabled,
    smsEnabled: template.sms_enabled,
    emailSubject: template.email_subject,
    emailBody: template.email_body,
    smsBody: template.sms_body,
  });
  const [testOpen, setTestOpen] = useState(false);
  const [testChannel, setTestChannel] = useState<"email" | "sms">("email");
  const [testEmail, setTestEmail] = useState("");
  const [testPhone, setTestPhone] = useState("");

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("PUT", `/api/admin/notification-templates/${template.event_type}`, {
        emailEnabled: form.emailEnabled,
        smsEnabled: form.smsEnabled,
        emailSubject: form.emailSubject,
        emailBody: form.emailBody,
        smsBody: form.smsBody,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/notification-templates"] });
      toast({ title: "Template saved", description: `${template.label} has been updated.` });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/admin/test-notification", {
        eventType: template.event_type,
        channel: testChannel,
        toEmail: testChannel === "email" ? testEmail : undefined,
        toPhone: testChannel === "sms" ? testPhone : undefined,
      }),
    onSuccess: (data: any) => {
      toast({ title: "Test sent!", description: `Test ${data.channel} sent to ${data.to}` });
      setTestOpen(false);
    },
    onError: (err: any) => toast({ title: "Send failed", description: err.message, variant: "destructive" }),
  });

  const vars = Array.isArray(template.variables) ? template.variables : [];

  return (
    <Card className="overflow-hidden">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <div className="min-w-0">
                  <CardTitle className="text-base">{template.label}</CardTitle>
                  {template.description && (
                    <CardDescription className="mt-0.5 text-xs">{template.description}</CardDescription>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {form.emailEnabled ? (
                  <Badge variant="outline" className="text-xs gap-1 text-teal-700 border-teal-300 bg-teal-50 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-800">
                    <Mail className="h-3 w-3" />Email On
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
                    <Mail className="h-3 w-3" />Email Off
                  </Badge>
                )}
                {form.smsEnabled ? (
                  <Badge variant="outline" className="text-xs gap-1 text-blue-700 border-blue-300 bg-blue-50 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
                    <MessageSquare className="h-3 w-3" />SMS On
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
                    <MessageSquare className="h-3 w-3" />SMS Off
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <Separator />
          <CardContent className="pt-5 space-y-6">
            {/* Available variables */}
            {vars.length > 0 && (
              <div className="flex items-start gap-2 bg-muted/40 rounded-lg p-3 text-sm">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Available merge variables:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {vars.map(v => <VariableBadge key={v} v={v} />)}
                  </div>
                </div>
              </div>
            )}

            {/* Email section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-teal-600" />
                  <h3 className="text-sm font-semibold">Email Alert</h3>
                  {status && !status.email.configured && (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50">
                      SMTP not configured
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`email-toggle-${template.event_type}`} className="text-xs text-muted-foreground">
                    {form.emailEnabled ? "Enabled" : "Disabled"}
                  </Label>
                  <Switch
                    id={`email-toggle-${template.event_type}`}
                    checked={form.emailEnabled}
                    onCheckedChange={v => setForm(f => ({ ...f, emailEnabled: v }))}
                    data-testid={`switch-email-${template.event_type}`}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Subject line</Label>
                <Input
                  value={form.emailSubject}
                  onChange={e => setForm(f => ({ ...f, emailSubject: e.target.value }))}
                  placeholder="Email subject..."
                  data-testid={`input-email-subject-${template.event_type}`}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Email body (plain text — use variables above)</Label>
                <Textarea
                  value={form.emailBody}
                  onChange={e => setForm(f => ({ ...f, emailBody: e.target.value }))}
                  rows={8}
                  className="font-mono text-xs resize-y"
                  placeholder="Email body..."
                  data-testid={`textarea-email-body-${template.event_type}`}
                />
              </div>
            </div>

            <Separator />

            {/* SMS section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-blue-600" />
                  <h3 className="text-sm font-semibold">SMS / Text Message</h3>
                  {status && !status.sms.configured && (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50">
                      Twilio not configured
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`sms-toggle-${template.event_type}`} className="text-xs text-muted-foreground">
                    {form.smsEnabled ? "Enabled" : "Disabled"}
                  </Label>
                  <Switch
                    id={`sms-toggle-${template.event_type}`}
                    checked={form.smsEnabled}
                    onCheckedChange={v => setForm(f => ({ ...f, smsEnabled: v }))}
                    data-testid={`switch-sms-${template.event_type}`}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Message body (160 char target — use variables above)</Label>
                <Textarea
                  value={form.smsBody}
                  onChange={e => setForm(f => ({ ...f, smsBody: e.target.value }))}
                  rows={3}
                  className="font-mono text-xs resize-y"
                  placeholder="SMS message..."
                  data-testid={`textarea-sms-body-${template.event_type}`}
                />
                <p className="text-xs text-muted-foreground">
                  Estimated length: ~{form.smsBody.length} chars
                  {form.smsBody.length > 160 && (
                    <span className="text-amber-600 ml-1">(may split into multiple messages)</span>
                  )}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTestOpen(true)}
                data-testid={`button-test-${template.event_type}`}
              >
                <Send className="h-4 w-4 mr-2" />Send Test
              </Button>
              <div className="flex items-center gap-2">
                {template.updated_by && (
                  <p className="text-xs text-muted-foreground">
                    Last saved by {template.updated_by}
                  </p>
                )}
                <Button
                  size="sm"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  data-testid={`button-save-${template.event_type}`}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saveMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>

      {/* Test dialog */}
      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Test Notification</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Send a test message using the current template with sample data filled in for all variables.
            </p>
            <div className="flex rounded-md border overflow-hidden">
              <button
                className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${testChannel === "email" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                onClick={() => setTestChannel("email")}
                data-testid="button-test-channel-email"
              >
                <Mail className="h-4 w-4" />Email
              </button>
              <button
                className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${testChannel === "sms" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                onClick={() => setTestChannel("sms")}
                data-testid="button-test-channel-sms"
              >
                <MessageSquare className="h-4 w-4" />SMS
              </button>
            </div>
            {testChannel === "email" ? (
              <div className="space-y-2">
                <Label>Send test to email address</Label>
                <Input
                  type="email"
                  placeholder="admin@example.com"
                  value={testEmail}
                  onChange={e => setTestEmail(e.target.value)}
                  data-testid="input-test-email"
                />
                {status && !status.email.configured && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />SMTP is not configured — email will not send
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Send test to phone number</Label>
                <Input
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={testPhone}
                  onChange={e => setTestPhone(e.target.value)}
                  data-testid="input-test-phone"
                />
                {status && !status.sms.configured && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />Twilio is not configured — SMS will not send
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" data-testid="button-cancel-test">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending || (testChannel === "email" ? !testEmail : !testPhone)}
              data-testid="button-confirm-test-send"
            >
              <Send className="h-4 w-4 mr-2" />
              {testMutation.isPending ? "Sending..." : "Send Test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function NotificationTemplatesPage() {
  const { data: templates, isLoading } = useQuery<NotificationTemplate[]>({
    queryKey: ["/api/admin/notification-templates"],
  });

  const { data: status } = useQuery<NotifStatus>({
    queryKey: ["/api/admin/notification-status"],
  });

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Notification Templates</h1>
        <p className="text-muted-foreground mt-1">
          Edit the email and text message alerts that are sent to employees and managers. Use{" "}
          <code className="text-xs bg-muted px-1 rounded">{"{{variable}}"}</code> placeholders which will be filled in automatically.
        </p>
      </div>

      {/* Channel status */}
      {status && (
        <div className="flex flex-col gap-2">
          <div className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm border ${status.email.configured ? "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-300" : "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-300"}`}>
            {status.email.configured ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            <span className="font-medium">Email (SMTP):</span>
            {status.email.configured
              ? <span>Configured — from {status.email.from}{status.email.derivedHost ? ` (host auto-derived: ${status.email.derivedHost})` : ""}</span>
              : <span className="flex flex-wrap items-center gap-1">
                  Not configured — missing:&nbsp;
                  {(status.email.missing ?? ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]).map((v: string) => (
                    <code key={v} className="text-xs bg-amber-200/60 dark:bg-amber-900/60 px-1.5 py-0.5 rounded font-mono">{v}</code>
                  ))}
                </span>
            }
          </div>
          <div className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm border ${status.sms.configured ? "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-300" : "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-300"}`}>
            {status.sms.configured ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            <span className="font-medium">SMS (Twilio):</span>
            {status.sms.configured
              ? <span>Configured</span>
              : <span className="flex flex-wrap items-center gap-1">
                  Not configured — missing:&nbsp;
                  {(status.sms.missing ?? ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"]).map((v: string) => (
                    <code key={v} className="text-xs bg-amber-200/60 dark:bg-amber-900/60 px-1.5 py-0.5 rounded font-mono">{v}</code>
                  ))}
                </span>
            }
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Card key={i} className="h-20 animate-pulse bg-muted/40" />
          ))}
        </div>
      ) : !templates?.length ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Mail className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">No notification templates found.</p>
            <p className="text-xs text-muted-foreground mt-1">Templates are seeded automatically on startup.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {templates.map(t => (
            <TemplateCard key={t.event_type} template={t} status={status} />
          ))}
        </div>
      )}
    </div>
  );
}
