import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useBiometricAuth } from "@/hooks/use-biometric-auth";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useHaptics } from "@/hooks/use-native-platform";
import type { Worker, WorkerDocument, Review, Qualification, WorkerLanguage, WorkerMembership } from "@shared/schema";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Settings,
  Receipt,
  FileText,
  Star,
  Zap,
  GraduationCap,
  IdCard,
  Languages,
  BadgeCheck,
  Plus,
  Trash2,
  Download,
  User,
  Phone,
  Mail,
  MapPin,
  KeyRound,
  Shield,
  Eye,
  EyeOff,
} from "lucide-react";

function useTabParam(defaultTab: string): [string, (tab: string) => void] {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get("tab") || defaultTab;
  const setTab = (newTab: string) => setLocation(`/app/my-profile?tab=${newTab}`);
  return [tab, setTab];
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

function RatingStars({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-muted-foreground">N/A</span>;
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`h-4 w-4 ${i <= rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
      ))}
    </div>
  );
}

// ─── Contact Info Tab (employee self-service) ───────────────────────────────

function ContactInfoTab({ worker }: { worker: Worker | null }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    phone: worker?.phone || "",
    mobilePhone: worker?.mobilePhone || "",
    homePhone: worker?.homePhone || "",
    workEmail: worker?.workEmail || "",
    homeEmail: worker?.homeEmail || "",
    address: worker?.address || "",
    address2: worker?.address2 || "",
    city: worker?.city || "",
    state: worker?.state || "",
    zip: worker?.zip || "",
    country: worker?.country || "US",
    emergencyContactName: worker?.emergencyContactName || "",
    emergencyContactRelationship: worker?.emergencyContactRelationship || "",
    emergencyContactPhone: worker?.emergencyContactPhone || "",
    emergencyContactEmail: worker?.emergencyContactEmail || "",
  });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("PATCH", "/api/my/worker", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my/worker"] });
      toast({ title: "Contact info saved" });
    },
    onError: () => toast({ title: "Failed to save contact info", variant: "destructive" }),
  });

  if (!worker) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          <User className="h-10 w-10 mx-auto mb-2" />
          <p>Your account is not linked to an employee record.</p>
          <p className="text-sm mt-1">Contact your administrator to link your account.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Phone className="h-4 w-4" />Phone Numbers</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Mobile / Cell</Label>
            <Input data-testid="input-mobile-phone" value={form.mobilePhone} onChange={e => setForm(p => ({ ...p, mobilePhone: e.target.value }))} placeholder="+1 (555) 000-0000" />
          </div>
          <div className="space-y-2">
            <Label>Home Phone</Label>
            <Input data-testid="input-home-phone" value={form.homePhone} onChange={e => setForm(p => ({ ...p, homePhone: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Primary Phone</Label>
            <Input data-testid="input-phone" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" />Email Addresses</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Work Email</Label>
            <Input type="email" data-testid="input-work-email" value={form.workEmail} onChange={e => setForm(p => ({ ...p, workEmail: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Personal Email</Label>
            <Input type="email" data-testid="input-home-email" value={form.homeEmail} onChange={e => setForm(p => ({ ...p, homeEmail: e.target.value }))} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><MapPin className="h-4 w-4" />Home Address</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Street Address</Label>
            <Input data-testid="input-address" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Apt / Suite</Label>
            <Input data-testid="input-address2" value={form.address2} onChange={e => setForm(p => ({ ...p, address2: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="col-span-2 sm:col-span-1 space-y-2">
              <Label>City</Label>
              <Input data-testid="input-city" value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>State</Label>
              <Input data-testid="input-state" value={form.state} onChange={e => setForm(p => ({ ...p, state: e.target.value }))} maxLength={2} placeholder="CA" />
            </div>
            <div className="space-y-2">
              <Label>ZIP</Label>
              <Input data-testid="input-zip" value={form.zip} onChange={e => setForm(p => ({ ...p, zip: e.target.value }))} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><User className="h-4 w-4" />Emergency Contact</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Full Name</Label>
            <Input data-testid="input-emergency-name" value={form.emergencyContactName} onChange={e => setForm(p => ({ ...p, emergencyContactName: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Relationship</Label>
            <Input data-testid="input-emergency-relationship" value={form.emergencyContactRelationship} onChange={e => setForm(p => ({ ...p, emergencyContactRelationship: e.target.value }))} placeholder="Spouse, Parent, etc." />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input data-testid="input-emergency-phone" value={form.emergencyContactPhone} onChange={e => setForm(p => ({ ...p, emergencyContactPhone: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" data-testid="input-emergency-email" value={form.emergencyContactEmail} onChange={e => setForm(p => ({ ...p, emergencyContactEmail: e.target.value }))} />
          </div>
        </CardContent>
      </Card>

      <Button onClick={() => mutation.mutate(form)} disabled={mutation.isPending} data-testid="button-save-contact-info">
        {mutation.isPending ? "Saving..." : "Save Contact Info"}
      </Button>
    </div>
  );
}

// ─── Preferences Tab ───────────────────────────────────────────────────────────

function PreferencesTab({ worker }: { worker: Worker | null }) {
  const { toast } = useToast();
  const prefs = worker ? JSON.parse(worker.preferences || "{}") : {};

  const [notifyScheduleEmail, setNotifyScheduleEmail] = useState<boolean>(prefs.notifyScheduleEmail !== false);
  const [notifyScheduleSms, setNotifyScheduleSms] = useState<boolean>(!!prefs.notifyScheduleSms);
  const [notifyPaydayEmail, setNotifyPaydayEmail] = useState<boolean>(prefs.notifyPaydayEmail !== false);
  const [notifyPaydaySms, setNotifyPaydaySms] = useState<boolean>(!!prefs.notifyPaydaySms);
  // "app" (in-app only) is no longer a valid option — employees must have at least email or text
  const [messagingChannel, setMessagingChannel] = useState<string>(
    (!prefs.messagingChannel || prefs.messagingChannel === "app") ? "email" : prefs.messagingChannel
  );
  const [language, setLanguage] = useState<string>(prefs.language || "en");
  const [timezone, setTimezone] = useState<string>(prefs.timezone || "America/Los_Angeles");
  const [dateFormat, setDateFormat] = useState<string>(prefs.dateFormat || "MM/DD/YYYY");
  const [timeFormat, setTimeFormat] = useState<string>(prefs.timeFormat || "12");

  const mutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", "/api/my/preferences", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data?.skipped) {
        toast({ title: "Display preferences", description: "Notification preferences are saved to your employee record. Your account is admin-only.", variant: "default" });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/my/worker"] });
        toast({ title: "Preferences saved" });
      }
    },
    onError: () => toast({ title: "Failed to save preferences", variant: "destructive" }),
  });

  const save = () => {
    mutation.mutate({ notifyScheduleEmail, notifyScheduleSms, notifyPaydayEmail, notifyPaydaySms, messagingChannel, language, timezone, dateFormat, timeFormat });
  };

  return (
    <div className="space-y-6 max-w-xl">
      <Card>
        <CardHeader><CardTitle className="text-base">Display Settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Language</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger data-testid="select-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="es">Spanish</SelectItem>
                <SelectItem value="fr">French</SelectItem>
                <SelectItem value="zh">Chinese</SelectItem>
                <SelectItem value="tl">Tagalog</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger data-testid="select-timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
                <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
                <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                <SelectItem value="America/Anchorage">Alaska Time (AKT)</SelectItem>
                <SelectItem value="Pacific/Honolulu">Hawaii Time (HT)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Date Format</Label>
            <Select value={dateFormat} onValueChange={setDateFormat}>
              <SelectTrigger data-testid="select-date-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Time Format</Label>
            <Select value={timeFormat} onValueChange={setTimeFormat} data-testid="select-time-format">
              <SelectTrigger data-testid="select-time-format-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="12">12-hour (1:30 PM)</SelectItem>
                <SelectItem value="24">24-hour (13:30)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Messaging Preferences</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">How would you like to receive staff messages from managers? You must have at least one channel enabled.</p>
          <Select value={messagingChannel} onValueChange={setMessagingChannel}>
            <SelectTrigger data-testid="select-messaging-channel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="sms">Text (SMS)</SelectItem>
              <SelectItem value="both">Email &amp; Text (SMS)</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Notification Preferences</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Schedule Alerts — Email</p>
              <p className="text-xs text-muted-foreground">Receive email when a schedule is published</p>
            </div>
            <Switch checked={notifyScheduleEmail} onCheckedChange={setNotifyScheduleEmail} data-testid="switch-notify-schedule-email" />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Schedule Alerts — SMS</p>
              <p className="text-xs text-muted-foreground">Receive text message when a schedule is published</p>
            </div>
            <Switch checked={notifyScheduleSms} onCheckedChange={setNotifyScheduleSms} data-testid="switch-notify-schedule-sms" />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Payday Alerts — Email</p>
              <p className="text-xs text-muted-foreground">Receive email when payroll is processed</p>
            </div>
            <Switch checked={notifyPaydayEmail} onCheckedChange={setNotifyPaydayEmail} data-testid="switch-notify-payday-email" />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Payday Alerts — SMS</p>
              <p className="text-xs text-muted-foreground">Receive text message when payroll is processed</p>
            </div>
            <Switch checked={notifyPaydaySms} onCheckedChange={setNotifyPaydaySms} data-testid="switch-notify-payday-sms" />
          </div>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={mutation.isPending} data-testid="button-save-preferences">
        {mutation.isPending ? "Saving..." : "Save Preferences"}
      </Button>

      <NativeSecuritySettings />
    </div>
  );
}

function NativeSecuritySettings() {
  const { toast } = useToast();
  const { user } = useAuth();
  const {
    isAvailable: biometricAvailable,
    isEnabled: biometricEnabled,
    biometricType,
    enableBiometric,
    disableBiometric,
    isNativeApp,
  } = useBiometricAuth();
  const {
    permissionState,
    requestPermission,
    registerToken,
  } = usePushNotifications();

  const haptics = useHaptics();

  const handleBiometricToggle = useCallback(async (enabled: boolean) => {
    haptics.impact("medium");
    if (enabled) {
      if (user?.id) {
        await enableBiometric(user.id);
        haptics.notification("success");
        toast({ title: `${biometricType} enabled`, description: "You can now use biometric unlock" });
      }
    } else {
      await disableBiometric();
      toast({ title: `${biometricType} disabled` });
    }
  }, [user, enableBiometric, disableBiometric, biometricType, toast, haptics]);

  const handlePushToggle = useCallback(async () => {
    const granted = await requestPermission();
    if (granted) {
      await registerToken();
      haptics.notification("success");
      toast({ title: "Push notifications enabled" });
    } else {
      haptics.notification("error");
      toast({ title: "Permission denied", variant: "destructive" });
    }
  }, [requestPermission, registerToken, toast, haptics]);

  if (!biometricAvailable && !isNativeApp && permissionState === "unsupported") return null;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Security & Native Features</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {(biometricAvailable || isNativeApp) && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{biometricType} Unlock</p>
              <p className="text-xs text-muted-foreground">
                {biometricAvailable
                  ? `Use ${biometricType} to unlock the app instead of entering your password`
                  : "Biometric authentication is not available on this device"}
              </p>
            </div>
            <Switch
              checked={biometricEnabled}
              onCheckedChange={handleBiometricToggle}
              disabled={!biometricAvailable}
              data-testid="switch-biometric"
            />
          </div>
        )}
        {permissionState !== "unsupported" && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Push Notifications</p>
              <p className="text-xs text-muted-foreground">
                {permissionState === "granted"
                  ? "Push notifications are enabled for this device"
                  : "Enable push notifications to stay informed in real-time"}
              </p>
            </div>
            {permissionState === "granted" ? (
              <Badge variant="outline" className="text-green-600 border-green-300 text-xs">Enabled</Badge>
            ) : (
              <Button size="sm" variant="outline" onClick={handlePushToggle} data-testid="button-enable-push-profile">
                Enable
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Pay Stubs Tab ─────────────────────────────────────────────────────────────

type MyPaystub = {
  id: string;
  payrollRunId: string;
  workerId: string;
  regularHours: string | null;
  overtimeHours: string | null;
  doubleTimeHours: string | null;
  regularPay: string | null;
  overtimePay: string | null;
  doubleTimePay: string | null;
  grossPay: string | null;
  netPay: string | null;
  totalDeductions: string | null;
  run: { id: string; periodStart: string; periodEnd: string; status: string; companyId: string };
  paymentStatus: string | null;
  paidAt: string | null;
  failureReason: string | null;
  reconciledAt: string | null;
};

function PaymentStatusBadge({ paymentStatus, runStatus, paidAt, failureReason }: { paymentStatus: string | null; runStatus: string; paidAt: string | null; failureReason: string | null }) {
  const status = paymentStatus || runStatus;
  const variant: "default" | "secondary" | "destructive" | "outline" =
    status === "paid" || status === "cleared" ? "default" :
    status === "failed" || status === "reversed" ? "destructive" :
    status === "voided" ? "outline" :
    "secondary";
  const label =
    status === "cleared" ? "Paid & Reconciled" :
    status === "paid" ? `Paid${paidAt ? ` ${new Date(paidAt).toLocaleDateString()}` : ""}` :
    status === "failed" ? `Failed${failureReason ? `: ${failureReason}` : ""}` :
    status === "reversed" ? "Reversed" :
    status === "voided" ? "Voided" :
    status === "submitted" || status === "processing" ? "Processing" :
    status;
  return <Badge variant={variant} data-testid={`badge-payment-status-${status}`}>{label}</Badge>;
}

function PaystubsTab() {
  const { data: paystubs, isLoading } = useQuery<MyPaystub[]>({
    queryKey: ["/api/my/paystubs"],
  });

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">My Pay Stubs</h3>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pay Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Regular Hrs</TableHead>
                <TableHead className="text-right">OT Hrs</TableHead>
                <TableHead className="text-right">Gross Pay</TableHead>
                <TableHead className="text-right">Deductions</TableHead>
                <TableHead className="text-right">Net Pay</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!paystubs || paystubs.length === 0) ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No pay stubs found</TableCell>
                </TableRow>
              ) : (
                paystubs.map((stub) => (
                  <TableRow key={stub.id} data-testid={`row-paystub-${stub.id}`}>
                    <TableCell>
                      <div className="font-medium">
                        {new Date(stub.run.periodStart + "T12:00:00").toLocaleDateString()} – {new Date(stub.run.periodEnd + "T12:00:00").toLocaleDateString()}
                      </div>
                    </TableCell>
                    <TableCell>
                      <PaymentStatusBadge
                        paymentStatus={stub.paymentStatus}
                        runStatus={stub.run.status}
                        paidAt={stub.paidAt}
                        failureReason={stub.failureReason}
                      />
                    </TableCell>
                    <TableCell className="text-right">{parseFloat(stub.regularHours || "0").toFixed(2)}</TableCell>
                    <TableCell className="text-right">{parseFloat(stub.overtimeHours || "0").toFixed(2)}</TableCell>
                    <TableCell className="text-right font-medium">${parseFloat(stub.grossPay || "0").toFixed(2)}</TableCell>
                    <TableCell className="text-right text-destructive">${parseFloat(stub.totalDeductions || "0").toFixed(2)}</TableCell>
                    <TableCell className="text-right font-semibold text-green-600 dark:text-green-400">${parseFloat(stub.netPay || "0").toFixed(2)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Documents Tab ─────────────────────────────────────────────────────────────

function DocumentsTab() {
  const { data: documents, isLoading } = useQuery<WorkerDocument[]>({
    queryKey: ["/api/my/documents"],
  });

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">My Documents</h3>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date Uploaded</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!documents || documents.length === 0) ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No documents found</TableCell>
                </TableRow>
              ) : (
                documents.map((doc) => (
                  <TableRow key={doc.id} data-testid={`row-document-${doc.id}`}>
                    <TableCell className="font-medium">{doc.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{doc.documentType || "other"}</Badge>
                    </TableCell>
                    <TableCell>{doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{doc.notes || "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" asChild data-testid={`button-download-document-${doc.id}`}>
                        <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer">
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Reviews Tab ───────────────────────────────────────────────────────────────

function ReviewsTab() {
  const { data: reviews, isLoading } = useQuery<Review[]>({
    queryKey: ["/api/my/reviews"],
  });

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">My Performance Reviews</h3>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Review Date</TableHead>
                <TableHead>Reviewer</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!reviews || reviews.length === 0) ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">No reviews found</TableCell>
                </TableRow>
              ) : (
                reviews.map((review) => (
                  <TableRow key={review.id} data-testid={`row-review-${review.id}`}>
                    <TableCell className="font-medium">
                      {review.reviewDate ? new Date(review.reviewDate + "T12:00:00").toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell>{review.reviewerName || "—"}</TableCell>
                    <TableCell><RatingStars rating={review.rating} /></TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-xs truncate">{review.notes || "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Qualifications / Skills / Education / Licenses Tab ────────────────────────

function QualificationsTab({ worker }: { worker: Worker | null }) {
  const { toast } = useToast();
  const [qualSubTab, setQualSubTab] = useState("skills");
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState("skill");
  const [form, setForm] = useState<Record<string, string>>({});

  const { data: qualifications, isLoading } = useQuery<Qualification[]>({
    queryKey: ["/api/my/qualifications"],
  });

  const skills = (qualifications || []).filter((q) => q.type === "skill");
  const education = (qualifications || []).filter((q) => q.type === "education");
  const licenses = (qualifications || []).filter((q) => q.type === "license" || q.type === "certification");

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, string>) =>
      apiRequest("POST", "/api/my/qualifications", { ...data, companyId: worker?.companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my/qualifications"] });
      setShowAdd(false);
      setForm({});
      toast({ title: "Added successfully" });
    },
    onError: () => toast({ title: "Failed to add", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/my/qualifications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my/qualifications"] });
      toast({ title: "Deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const openAdd = (type: string) => {
    setAddType(type);
    setForm({ type });
    setShowAdd(true);
  };

  const renderQualTable = (items: Qualification[], type: string) => (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => openAdd(type)} data-testid={`button-add-${type}`}>
          <Plus className="h-4 w-4 mr-1" /> Add {type.charAt(0).toUpperCase() + type.slice(1)}
        </Button>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Expiration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No {type}s found</TableCell>
                </TableRow>
              ) : (
                items.map((q) => (
                  <TableRow key={q.id} data-testid={`row-qualification-${q.id}`}>
                    <TableCell className="font-medium">{q.name}</TableCell>
                    <TableCell>{q.level || "—"}</TableCell>
                    <TableCell>{q.expirationDate ? new Date(q.expirationDate + "T12:00:00").toLocaleDateString() : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={q.isActive ? "default" : "secondary"}>{q.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(q.id)} data-testid={`button-delete-qualification-${q.id}`}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="space-y-4">
      <Tabs value={qualSubTab} onValueChange={setQualSubTab}>
        <TabsList>
          <TabsTrigger value="skills" data-testid="tab-skills"><Zap className="h-4 w-4 mr-1" />Skills</TabsTrigger>
          <TabsTrigger value="education" data-testid="tab-education"><GraduationCap className="h-4 w-4 mr-1" />Education</TabsTrigger>
          <TabsTrigger value="licenses" data-testid="tab-licenses"><BadgeCheck className="h-4 w-4 mr-1" />Licenses</TabsTrigger>
        </TabsList>
        <TabsContent value="skills">{renderQualTable(skills, "skill")}</TabsContent>
        <TabsContent value="education">{renderQualTable(education, "education")}</TabsContent>
        <TabsContent value="licenses">{renderQualTable(licenses, "license")}</TabsContent>
      </Tabs>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {addType.charAt(0).toUpperCase() + addType.slice(1)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input
                value={form.name || ""}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Name"
                data-testid="input-qual-name"
              />
            </div>
            <div className="space-y-1">
              <Label>Level</Label>
              <Input
                value={form.level || ""}
                onChange={(e) => setForm({ ...form, level: e.target.value })}
                placeholder="e.g. Intermediate, Expert"
                data-testid="input-qual-level"
              />
            </div>
            <div className="space-y-1">
              <Label>Expiration Date</Label>
              <Input
                type="date"
                value={form.expirationDate || ""}
                onChange={(e) => setForm({ ...form, expirationDate: e.target.value })}
                data-testid="input-qual-expiration"
              />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Input
                value={form.description || ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional description"
                data-testid="input-qual-description"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                onClick={() => createMutation.mutate(form)}
                disabled={!form.name || createMutation.isPending}
                data-testid="button-submit-qualification"
              >
                {createMutation.isPending ? "Adding..." : "Add"}
              </Button>
              <Button variant="outline" onClick={() => setShowAdd(false)} data-testid="button-cancel-qualification">Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Languages Tab ─────────────────────────────────────────────────────────────

function LanguagesTab({ worker }: { worker: Worker | null }) {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [language, setLanguage] = useState("");
  const [proficiency, setProficiency] = useState("basic");

  const { data: languages, isLoading } = useQuery<WorkerLanguage[]>({
    queryKey: ["/api/my/languages"],
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/my/languages", { language, proficiency, companyId: worker?.companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my/languages"] });
      setShowAdd(false);
      setLanguage("");
      setProficiency("basic");
      toast({ title: "Language added" });
    },
    onError: () => toast({ title: "Failed to add language", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/my/languages/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my/languages"] });
      toast({ title: "Deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAdd(true)} data-testid="button-add-language">
          <Plus className="h-4 w-4 mr-1" /> Add Language
        </Button>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Language</TableHead>
                <TableHead>Proficiency</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!languages || languages.length === 0) ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">No languages found</TableCell>
                </TableRow>
              ) : (
                languages.map((lang) => (
                  <TableRow key={lang.id} data-testid={`row-language-${lang.id}`}>
                    <TableCell className="font-medium">{lang.language}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{lang.proficiency || "basic"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(lang.id)} data-testid={`button-delete-language-${lang.id}`}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Language</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Language *</Label>
              <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. Spanish" data-testid="input-language-name" />
            </div>
            <div className="space-y-1">
              <Label>Proficiency</Label>
              <Select value={proficiency} onValueChange={setProficiency}>
                <SelectTrigger data-testid="select-language-proficiency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="basic">Basic</SelectItem>
                  <SelectItem value="conversational">Conversational</SelectItem>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="fluent">Fluent</SelectItem>
                  <SelectItem value="native">Native</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={() => createMutation.mutate()} disabled={!language || createMutation.isPending} data-testid="button-submit-language">
                {createMutation.isPending ? "Adding..." : "Add"}
              </Button>
              <Button variant="outline" onClick={() => setShowAdd(false)} data-testid="button-cancel-language">Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Memberships Tab ───────────────────────────────────────────────────────────

function MembershipsTab({ worker }: { worker: Worker | null }) {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ organization: "", membershipNumber: "", startDate: "", expirationDate: "" });

  const { data: memberships, isLoading } = useQuery<WorkerMembership[]>({
    queryKey: ["/api/my/memberships"],
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/my/memberships", { ...form, companyId: worker?.companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my/memberships"] });
      setShowAdd(false);
      setForm({ organization: "", membershipNumber: "", startDate: "", expirationDate: "" });
      toast({ title: "Membership added" });
    },
    onError: () => toast({ title: "Failed to add membership", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/my/memberships/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my/memberships"] });
      toast({ title: "Deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAdd(true)} data-testid="button-add-membership">
          <Plus className="h-4 w-4 mr-1" /> Add Membership
        </Button>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Member #</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>Expiration</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!memberships || memberships.length === 0) ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No memberships found</TableCell>
                </TableRow>
              ) : (
                memberships.map((m) => (
                  <TableRow key={m.id} data-testid={`row-membership-${m.id}`}>
                    <TableCell className="font-medium">{m.organization}</TableCell>
                    <TableCell>{m.membershipNumber || "—"}</TableCell>
                    <TableCell>{m.startDate ? new Date(m.startDate + "T12:00:00").toLocaleDateString() : "—"}</TableCell>
                    <TableCell>{m.expirationDate ? new Date(m.expirationDate + "T12:00:00").toLocaleDateString() : "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(m.id)} data-testid={`button-delete-membership-${m.id}`}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Membership</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Organization *</Label>
              <Input value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} placeholder="Organization name" data-testid="input-membership-org" />
            </div>
            <div className="space-y-1">
              <Label>Member Number</Label>
              <Input value={form.membershipNumber} onChange={(e) => setForm({ ...form, membershipNumber: e.target.value })} placeholder="Optional" data-testid="input-membership-number" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Start Date</Label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} data-testid="input-membership-start" />
              </div>
              <div className="space-y-1">
                <Label>Expiration</Label>
                <Input type="date" value={form.expirationDate} onChange={(e) => setForm({ ...form, expirationDate: e.target.value })} data-testid="input-membership-expiration" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={() => createMutation.mutate()} disabled={!form.organization || createMutation.isPending} data-testid="button-submit-membership">
                {createMutation.isPending ? "Adding..." : "Add"}
              </Button>
              <Button variant="outline" onClick={() => setShowAdd(false)} data-testid="button-cancel-membership">Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Security Tab ──────────────────────────────────────────────────────────────

function PasswordField({ label, id, value, onChange, testId }: { label: string; id: string; value: string; onChange: (v: string) => void; testId: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          className="pr-10"
          data-testid={testId}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          tabIndex={-1}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function SecurityTab({ worker }: { worker: Worker | null }) {
  const { toast } = useToast();

  const [pinForm, setPinForm] = useState({ currentPin: "", newPin: "", confirmPin: "" });
  const [passForm, setPassForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });

  function parseApiError(e: any): string {
    try {
      const match = e.message?.match(/^\d+: (.+)$/);
      if (match) {
        const parsed = JSON.parse(match[1]);
        return parsed.message || match[1];
      }
    } catch {}
    return e.message || "An error occurred";
  }

  const pinMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/my/change-pin", pinForm).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "PIN updated", description: "Your time clock PIN has been changed." });
      setPinForm({ currentPin: "", newPin: "", confirmPin: "" });
    },
    onError: (e: any) => toast({ title: "Failed to update PIN", description: parseApiError(e), variant: "destructive" }),
  });

  const passMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/my/change-password", passForm).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Password updated", description: "Your login password has been changed." });
      setPassForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    },
    onError: (e: any) => toast({ title: "Failed to update password", description: parseApiError(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6 max-w-lg">

      {/* ── Change PIN ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-teal-600" />
            Change Time Clock PIN
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Your PIN is used to clock in and out at the time clock kiosk (4–8 digits).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!worker ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Your account is not linked to an employee record. PIN change is not available.
            </p>
          ) : (
            <>
              <PasswordField label="Current PIN" id="currentPin" value={pinForm.currentPin} onChange={(v) => setPinForm((f) => ({ ...f, currentPin: v }))} testId="input-current-pin" />
              <PasswordField label="New PIN (4–8 digits)" id="newPin" value={pinForm.newPin} onChange={(v) => setPinForm((f) => ({ ...f, newPin: v }))} testId="input-new-pin" />
              <PasswordField label="Confirm New PIN" id="confirmPin" value={pinForm.confirmPin} onChange={(v) => setPinForm((f) => ({ ...f, confirmPin: v }))} testId="input-confirm-pin" />
              <Button
                onClick={() => pinMutation.mutate()}
                disabled={pinMutation.isPending || !pinForm.currentPin || !pinForm.newPin || !pinForm.confirmPin}
                className="bg-teal-600 hover:bg-teal-700 text-white"
                data-testid="button-change-pin"
              >
                {pinMutation.isPending ? "Updating…" : "Update PIN"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Change Password ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-teal-600" />
            Change Login Password
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Your password is used to log into the dashboard. Must be at least 8 characters.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <PasswordField label="Current Password" id="currentPassword" value={passForm.currentPassword} onChange={(v) => setPassForm((f) => ({ ...f, currentPassword: v }))} testId="input-current-password" />
          <PasswordField label="New Password" id="newPassword" value={passForm.newPassword} onChange={(v) => setPassForm((f) => ({ ...f, newPassword: v }))} testId="input-new-password" />
          <PasswordField label="Confirm New Password" id="confirmPassword" value={passForm.confirmPassword} onChange={(v) => setPassForm((f) => ({ ...f, confirmPassword: v }))} testId="input-confirm-password" />
          <Button
            onClick={() => passMutation.mutate()}
            disabled={passMutation.isPending || !passForm.currentPassword || !passForm.newPassword || !passForm.confirmPassword}
            className="bg-teal-600 hover:bg-teal-700 text-white"
            data-testid="button-change-password"
          >
            {passMutation.isPending ? "Updating…" : "Update Password"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function MyProfilePage() {
  const [tab, setTab] = useTabParam("preferences");
  const { user } = useAuth();

  const { data: worker, isLoading: workerLoading } = useQuery<Worker | null>({
    queryKey: ["/api/my/worker"],
  });

  if (workerLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <LoadingSkeleton />
      </div>
    );
  }

  const workerName = worker ? `${worker.firstName} ${worker.lastName}` : user?.username || "My Profile";

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="heading-my-profile">My Profile</h1>
        <p className="text-muted-foreground">{workerName}</p>
        {!worker && (
          <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
            Your account is not linked to an employee record. Some features may be unavailable.
          </p>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="contact" data-testid="tab-contact" className="flex items-center gap-1">
            <User className="h-4 w-4" />Contact Info
          </TabsTrigger>
          <TabsTrigger value="preferences" data-testid="tab-preferences" className="flex items-center gap-1">
            <Settings className="h-4 w-4" />Preferences
          </TabsTrigger>
          <TabsTrigger value="paystubs" data-testid="tab-paystubs" className="flex items-center gap-1">
            <Receipt className="h-4 w-4" />Pay Stubs
          </TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-documents" className="flex items-center gap-1">
            <FileText className="h-4 w-4" />Documents
          </TabsTrigger>
          <TabsTrigger value="reviews" data-testid="tab-reviews" className="flex items-center gap-1">
            <Star className="h-4 w-4" />Reviews
          </TabsTrigger>
          <TabsTrigger value="qualifications" data-testid="tab-qualifications" className="flex items-center gap-1">
            <Zap className="h-4 w-4" />Qualifications
          </TabsTrigger>
          <TabsTrigger value="languages" data-testid="tab-languages" className="flex items-center gap-1">
            <Languages className="h-4 w-4" />Languages
          </TabsTrigger>
          <TabsTrigger value="memberships" data-testid="tab-memberships" className="flex items-center gap-1">
            <IdCard className="h-4 w-4" />Memberships
          </TabsTrigger>
          <TabsTrigger value="security" data-testid="tab-security" className="flex items-center gap-1">
            <Shield className="h-4 w-4" />Security
          </TabsTrigger>
        </TabsList>

        <TabsContent value="contact" className="mt-4">
          <ContactInfoTab worker={worker || null} />
        </TabsContent>
        <TabsContent value="preferences" className="mt-4">
          <PreferencesTab worker={worker || null} />
        </TabsContent>
        <TabsContent value="paystubs" className="mt-4">
          <PaystubsTab />
        </TabsContent>
        <TabsContent value="documents" className="mt-4">
          <DocumentsTab />
        </TabsContent>
        <TabsContent value="reviews" className="mt-4">
          <ReviewsTab />
        </TabsContent>
        <TabsContent value="qualifications" className="mt-4">
          <QualificationsTab worker={worker || null} />
        </TabsContent>
        <TabsContent value="languages" className="mt-4">
          <LanguagesTab worker={worker || null} />
        </TabsContent>
        <TabsContent value="memberships" className="mt-4">
          <MembershipsTab worker={worker || null} />
        </TabsContent>
        <TabsContent value="security" className="mt-4">
          <SecurityTab worker={worker || null} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
