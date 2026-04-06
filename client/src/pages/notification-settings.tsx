import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useHaptics } from "@/hooks/use-native-platform";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Bell,
  BellOff,
  DollarSign,
  Calendar,
  Clock,
  FileText,
  Smartphone,
  Mail,
  MessageSquare,
  Loader2,
  CheckCircle2,
  XCircle,
  Send,
  Settings2,
  Info,
} from "lucide-react";
import { ResponsivePageHeader } from "@/components/responsive-page-header";

const NOTIFICATION_CATEGORIES = [
  {
    eventType: "payroll_processed",
    label: "Payroll Processed",
    description: "When a payroll run is completed and your pay stub is ready",
    icon: DollarSign,
  },
  {
    eventType: "schedule_published",
    label: "Schedule Changes",
    description: "When new schedules are published or shifts are modified",
    icon: Calendar,
  },
  {
    eventType: "time_off_approved",
    label: "Time-Off Approvals",
    description: "When your time-off requests are approved or denied",
    icon: Clock,
  },
  {
    eventType: "document_signature",
    label: "Document Signatures",
    description: "When documents require your signature or review",
    icon: FileText,
  },
  {
    eventType: "shift_offer",
    label: "Shift Offers",
    description: "When open shifts are available for you to pick up",
    icon: Calendar,
  },
  {
    eventType: "expense_approved",
    label: "Expense Updates",
    description: "When expense reports are approved or need attention",
    icon: DollarSign,
  },
];

type NotificationPref = {
  id: string;
  workerId: string;
  eventType: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  inAppEnabled: boolean;
  pushEnabled: boolean;
};

export default function NotificationSettingsPage() {
  const { toast } = useToast();
  const {
    permissionState,
    isNativeApp,
    requestPermission,
    registerToken,
  } = usePushNotifications();
  const [pushPermissionGranted, setPushPermissionGranted] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testSending, setTestSending] = useState(false);

  const { data: me } = useQuery<{ role: string; workerId: string | null }>({ queryKey: ["/api/auth/me"] });
  const isAdmin = me?.role === "admin";
  const hasNoWorkerProfile = me !== undefined && !me.workerId;

  const { data: notifStatus } = useQuery<{
    sms: { configured: boolean; fromNumber: string | null };
    email: { configured: boolean; from: string | null };
  }>({
    queryKey: ["/api/admin/notification-status"],
    enabled: isAdmin,
  });

  const { data: preferences = [], isLoading } = useQuery<NotificationPref[]>({
    queryKey: ["/api/notification-preferences"],
  });

  const handleTestSms = async () => {
    if (!testPhone.trim()) return;
    setTestSending(true);
    try {
      const res = await apiRequest("POST", "/api/admin/test-sms", { phone: testPhone.trim() });
      const data = await res.json();
      if (data.sent) {
        toast({ title: "Test SMS sent!", description: `Message delivered to ${data.to}` });
      } else {
        toast({ title: "SMS failed", description: data.error || "Unknown error", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "SMS failed", description: e.message, variant: "destructive" });
    } finally {
      setTestSending(false);
    }
  };

  useEffect(() => {
    setPushPermissionGranted(permissionState === "granted");
  }, [permissionState]);

  const updatePrefMutation = useMutation({
    mutationFn: async (data: {
      eventType: string;
      emailEnabled: boolean;
      smsEnabled: boolean;
      inAppEnabled: boolean;
      pushEnabled: boolean;
    }) => {
      const res = await apiRequest("PUT", "/api/notification-preferences", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data?.skipped) {
        toast({
          title: "Notification preferences",
          description: "These settings apply to employee accounts linked to a worker profile. Your admin account does not have a linked worker.",
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/notification-preferences"] });
      }
    },
    onError: () => {
      toast({ title: "Failed to update preference", variant: "destructive" });
    },
  });

  const haptics = useHaptics();

  const handleEnablePush = async () => {
    const granted = await requestPermission();
    if (granted) {
      setPushPermissionGranted(true);
      await registerToken();
      haptics.notification("success");
      toast({ title: "Push notifications enabled" });
    } else {
      haptics.notification("error");
      toast({ title: "Push notification permission denied", variant: "destructive" });
    }
  };

  const getPref = (eventType: string): NotificationPref | undefined => {
    return preferences.find((p) => p.eventType === eventType);
  };

  const toggleChannel = (
    eventType: string,
    channel: "emailEnabled" | "smsEnabled" | "inAppEnabled" | "pushEnabled",
    value: boolean
  ) => {
    haptics.impact("light");
    const existing = getPref(eventType);
    updatePrefMutation.mutate({
      eventType,
      emailEnabled: channel === "emailEnabled" ? value : (existing?.emailEnabled ?? true),
      smsEnabled: channel === "smsEnabled" ? value : (existing?.smsEnabled ?? true),
      inAppEnabled: channel === "inAppEnabled" ? value : (existing?.inAppEnabled ?? true),
      pushEnabled: channel === "pushEnabled" ? value : (existing?.pushEnabled ?? true),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <ResponsivePageHeader
        title="Notification Preferences"
        subtitle="Control how you receive notifications for different events"
      />

      {hasNoWorkerProfile && (
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-4">
          <Info className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Admin account — notification preferences apply to employee accounts</p>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
              These settings are saved to an employee worker profile. Your account is not linked to a worker record, so changes here won't be stored. To set preferences, use an employee account or link this account to a worker profile.
            </p>
          </div>
        </div>
      )}

      <Card data-testid="card-push-status">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-5 w-5 text-teal-500" />
            Push Notifications
          </CardTitle>
          <CardDescription>
            Receive real-time push notifications on your device
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {pushPermissionGranted ? (
                <Badge variant="outline" className="gap-1 text-green-600 border-green-300">
                  <CheckCircle2 className="h-3 w-3" />
                  Enabled
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300">
                  <XCircle className="h-3 w-3" />
                  Not enabled
                </Badge>
              )}
              <span className="text-sm text-muted-foreground">
                {isNativeApp ? "Native push notifications" : "Browser notifications"}
              </span>
            </div>
            {!pushPermissionGranted && (
              <Button
                onClick={handleEnablePush}
                size="sm"
                data-testid="button-enable-push"
              >
                <Bell className="h-4 w-4 mr-2" />
                Enable
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card data-testid="card-admin-notification-config">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-5 w-5 text-teal-500" />
              Notification Config (Admin)
            </CardTitle>
            <CardDescription>Integration status and test tools for SMS and email</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 text-sm">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <span>SMS (Twilio):</span>
                {notifStatus ? (
                  notifStatus.sms.configured ? (
                    <Badge variant="outline" className="gap-1 text-green-600 border-green-300">
                      <CheckCircle2 className="h-3 w-3" /> Configured
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 text-red-500 border-red-300">
                      <XCircle className="h-3 w-3" /> Not configured
                    </Badge>
                  )
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">Checking…</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>Email (SMTP):</span>
                {notifStatus ? (
                  notifStatus.email.configured ? (
                    <Badge variant="outline" className="gap-1 text-green-600 border-green-300">
                      <CheckCircle2 className="h-3 w-3" /> Configured
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 text-red-500 border-red-300">
                      <XCircle className="h-3 w-3" /> Not configured
                    </Badge>
                  )
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">Checking…</Badge>
                )}
              </div>
            </div>
            <Separator />
            <div>
              <p className="text-sm font-medium mb-2">Send a test SMS</p>
              <p className="text-xs text-muted-foreground mb-3">
                Enter a phone number to verify SMS delivery is working end-to-end.
              </p>
              <div className="flex gap-2">
                <Input
                  value={testPhone}
                  onChange={e => setTestPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="max-w-xs"
                  data-testid="input-test-sms-phone"
                />
                <Button
                  onClick={handleTestSms}
                  disabled={testSending || !testPhone.trim()}
                  size="sm"
                  data-testid="button-send-test-sms"
                >
                  {testSending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                  Send Test
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Note: Workers must have a phone number on their profile to receive SMS alerts. SMS alerts are sent when you publish a schedule or send a message with the SMS channel.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-notification-categories">
        <CardHeader>
          <CardTitle className="text-base">Notification Categories</CardTitle>
          <CardDescription>
            Choose which notifications you want to receive and how
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {NOTIFICATION_CATEGORIES.map((category, idx) => {
            const pref = getPref(category.eventType);
            const Icon = category.icon;
            return (
              <div key={category.eventType}>
                {idx > 0 && <Separator className="my-4" />}
                <div className="space-y-3" data-testid={`pref-${category.eventType}`}>
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 p-2 rounded-lg bg-teal-50 dark:bg-teal-950/30">
                      <Icon className="h-4 w-4 text-teal-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{category.label}</p>
                      <p className="text-xs text-muted-foreground">{category.description}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pl-11">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={pref?.pushEnabled ?? true}
                        onCheckedChange={(v) => toggleChannel(category.eventType, "pushEnabled", v)}
                        data-testid={`switch-push-${category.eventType}`}
                      />
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Smartphone className="h-3 w-3" />
                        Push
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={pref?.emailEnabled ?? true}
                        onCheckedChange={(v) => toggleChannel(category.eventType, "emailEnabled", v)}
                        data-testid={`switch-email-${category.eventType}`}
                      />
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3" />
                        Email
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={pref?.smsEnabled ?? true}
                        onCheckedChange={(v) => toggleChannel(category.eventType, "smsEnabled", v)}
                        data-testid={`switch-sms-${category.eventType}`}
                      />
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MessageSquare className="h-3 w-3" />
                        SMS
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={pref?.inAppEnabled ?? true}
                        onCheckedChange={(v) => toggleChannel(category.eventType, "inAppEnabled", v)}
                        data-testid={`switch-inapp-${category.eventType}`}
                      />
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Bell className="h-3 w-3" />
                        In-App
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
