import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Settings as SettingsIcon,
  Shield,
  Clock,
  Building2,
  Save,
  AlertTriangle,
  Database,
  Globe,
  Bell,
  ChevronRight,
  FileText,
  Download,
  BookOpen,
  Printer,
  CheckCircle2,
  XCircle,
  Minus,
  Plus,
  Scale,
  MapPin,
  Eye,
  EyeOff,
  ServerCog,
  Kanban,
  CreditCard,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import type { SystemDocument, RemittanceSource, Company } from "@shared/schema";

const US_TIMEZONES = [
  { value: "America/New_York",    label: "Eastern (ET) — New York, Miami, Atlanta" },
  { value: "America/Chicago",     label: "Central (CT) — Chicago, Dallas, Houston" },
  { value: "America/Denver",      label: "Mountain (MT) — Denver, Phoenix, Salt Lake City" },
  { value: "America/Los_Angeles", label: "Pacific (PT) — Los Angeles, Seattle, Las Vegas" },
  { value: "America/Anchorage",   label: "Alaska (AKT) — Anchorage, Fairbanks" },
  { value: "Pacific/Honolulu",    label: "Hawaii (HT) — Honolulu, Maui" },
  { value: "America/Puerto_Rico", label: "Atlantic (AT) — Puerto Rico, US Virgin Islands" },
  { value: "UTC",                 label: "UTC — Coordinated Universal Time" },
];

const policyFormSchema = z.object({
  overtimeThreshold: z.number().min(0).max(168),
  overtimeMultiplier: z.string(),
  breakPolicyMinutes: z.number().min(0).max(120),
  breakAfterHours: z.number().min(0).max(24),
  timeRoundingMinutes: z.number(),
  payFrequency: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]),
  timezone: z.string().min(1),
});

type PolicyFormValues = z.infer<typeof policyFormSchema>;

function CompanyPolicyEditor({ company }: { company: Company }) {
  const { toast } = useToast();

  const form = useForm<PolicyFormValues>({
    resolver: zodResolver(policyFormSchema),
    defaultValues: {
      overtimeThreshold: company.overtimeThreshold ?? 40,
      overtimeMultiplier: String(company.overtimeMultiplier ?? "1.5"),
      breakPolicyMinutes: company.breakPolicyMinutes ?? 30,
      breakAfterHours: company.breakAfterHours ?? 6,
      timeRoundingMinutes: company.timeRoundingMinutes ?? 15,
      payFrequency: (company.payFrequency as any) || "biweekly",
      timezone: (company as any).timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles",
    },
  });

  const timezoneConfirmed = (company as any).timezoneConfirmed ?? false;
  const currentTimezone = (company as any).timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";
  const tzLabel = US_TIMEZONES.find(t => t.value === currentTimezone)?.label || currentTimezone;

  const confirmTimezoneMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/companies/${company.id}`, { timezoneConfirmed: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Timezone confirmed", description: `Company timezone set to ${tzLabel}.` });
    },
  });

  const updatePolicies = useMutation({
    mutationFn: async (data: PolicyFormValues) => {
      await apiRequest("PATCH", `/api/companies/${company.id}`, { ...data, timezoneConfirmed: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: `Policies updated for ${company.name}` });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <>
    {!timezoneConfirmed && (
      <div
        className="flex items-start gap-3 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-4 mb-4"
        data-testid={`banner-tz-unconfirmed-${company.id}`}
      >
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Timezone needs confirmation — {company.name}
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
            Currently set to <strong>{tzLabel}</strong>. Confirm this is correct before processing schedules or payroll.
            An incorrect timezone causes punches, timecards, and overtime to be assigned to the wrong workday.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 border-amber-500 text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
          onClick={() => confirmTimezoneMutation.mutate()}
          disabled={confirmTimezoneMutation.isPending}
          data-testid={`button-confirm-tz-${company.id}`}
        >
          {confirmTimezoneMutation.isPending ? "Confirming…" : "Confirm timezone"}
        </Button>
      </div>
    )}
    <Card data-testid={`card-policy-${company.id}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          {company.name}
          <Badge variant="secondary" className="text-xs ml-auto capitalize">
            {company.payFrequency || "biweekly"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((data) => updatePolicies.mutate(data))} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="payFrequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pay Frequency</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid={`select-pay-freq-${company.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="biweekly">Biweekly</SelectItem>
                        <SelectItem value="semimonthly">Semimonthly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="overtimeThreshold"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>OT Threshold (hrs/week)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={e => field.onChange(Number(e.target.value))}
                        data-testid={`input-ot-thresh-${company.id}`}
                      />
                    </FormControl>
                    <FormDescription className="text-xs">FLSA standard: 40 hours</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="overtimeMultiplier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>OT Multiplier</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.1"
                        {...field}
                        data-testid={`input-ot-mult-${company.id}`}
                      />
                    </FormControl>
                    <FormDescription className="text-xs">FLSA minimum: 1.5x</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="breakPolicyMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Break Duration (min)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={e => field.onChange(Number(e.target.value))}
                        data-testid={`input-break-min-${company.id}`}
                      />
                    </FormControl>
                    <FormDescription className="text-xs">Meal break length</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="breakAfterHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Break After (hrs)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={e => field.onChange(Number(e.target.value))}
                        data-testid={`input-break-after-${company.id}`}
                      />
                    </FormControl>
                    <FormDescription className="text-xs">Hours before required break</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="timeRoundingMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time Rounding</FormLabel>
                    <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                      <FormControl>
                        <SelectTrigger data-testid={`select-rounding-${company.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="5">5 minutes</SelectItem>
                        <SelectItem value="6">6 minutes (1/10th hour)</SelectItem>
                        <SelectItem value="15">15 minutes (quarter-hour)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-xs">7-minute rule applied</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2 lg:col-span-2">
                    <FormLabel>Company Timezone</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid={`select-timezone-${company.id}`}>
                          <SelectValue placeholder="Select timezone" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {US_TIMEZONES.map(tz => (
                          <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-xs">
                      Controls which local date is assigned to punches and timecards. Critical for overnight shifts.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={updatePolicies.isPending}
                data-testid={`button-save-policy-${company.id}`}
              >
                <Save className="h-4 w-4 mr-2" />
                {updatePolicies.isPending ? "Saving..." : "Save Policies"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
    </>
  );
}

const complianceInfo = [
  {
    title: "Data Retention",
    description: "Payroll records retained 3 years, time cards 2 years per FLSA requirements.",
    icon: Database,
    status: "Active",
  },
  {
    title: "Tax Configuration",
    description: "FICA, FUTA, state unemployment tax setup. 501(c)(3) FUTA exemptions automatically applied.",
    icon: Globe,
    status: "Coming Soon",
  },
  {
    title: "Notifications",
    description: "Alerts for missed punches, overtime warnings, timesheet approvals, and filing deadlines.",
    icon: Bell,
    status: "Coming Soon",
  },
];

function JurisdictionComplianceSection() {
  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: jurisdictions = [] } = useQuery<any[]>({ queryKey: ["/api/compliance/jurisdictions"] });
  const { data: wageOrders = [] } = useQuery<{ number: string; name: string }[]>({ queryKey: ["/api/compliance/wage-orders"] });
  const { toast } = useToast();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");

  const _selectedCompany = companies.find(c => c.id === selectedCompanyId); void _selectedCompany;

  const { data: complianceSummary, isLoading: summaryLoading } = useQuery<any>({
    queryKey: ["/api/compliance/company", selectedCompanyId],
    queryFn: async () => {
      const res = await fetch(`/api/compliance/company/${selectedCompanyId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: !!selectedCompanyId,
  });

  const profileMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/compliance/company/${selectedCompanyId}/profile`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/compliance/company", selectedCompanyId] });
      toast({ title: "Compliance profile saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const profile = complianceSummary?.profile;

  const toggleField = (field: string, current: boolean) => {
    profileMutation.mutate({ [field]: !current });
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Scale className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Jurisdiction & Compliance</h2>
        <p className="text-xs text-muted-foreground ml-2">California labor law compliance settings per company</p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <Label className="shrink-0 text-xs">Company</Label>
            <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-compliance-company">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companies.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!selectedCompanyId && (
            <p className="text-xs text-muted-foreground py-4 text-center">Select a company to view its compliance profile.</p>
          )}

          {selectedCompanyId && summaryLoading && (
            <p className="text-xs text-muted-foreground py-4 text-center">Loading compliance data…</p>
          )}

          {selectedCompanyId && !summaryLoading && (
            <div className="space-y-4">
              {/* Jurisdiction badge */}
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Jurisdiction:</span>
                <Badge variant="outline" className="text-xs" data-testid="badge-jurisdiction">
                  {jurisdictions.find(j => j.id === profile?.jurisdictionId)?.name ?? "California (default)"}
                </Badge>
              </div>

              {/* IWC Wage Order selector */}
              <div className="flex items-center gap-3">
                <Label className="shrink-0 text-xs whitespace-nowrap">IWC Wage Order</Label>
                <Select
                  value={profile?.wageOrderNumber ?? ""}
                  onValueChange={(val) => profileMutation.mutate({ wageOrderNumber: val || null })}
                  disabled={profileMutation.isPending}
                >
                  <SelectTrigger className="h-8 text-xs" data-testid="select-wage-order">
                    <SelectValue placeholder="Select applicable wage order…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Not set</SelectItem>
                    {wageOrders.map(wo => (
                      <SelectItem key={wo.number} value={wo.number}>
                        Order {wo.number} — {wo.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Enforcement toggles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { field: "enforceMealBreaks",    label: "Meal Break Enforcement",    description: "Require 30-min break after 5 h" },
                  { field: "enforceRestBreaks",    label: "Rest Break Enforcement",    description: "10-min break per 4 h worked" },
                  { field: "enforceDailyOt",       label: "Daily OT (1.5×/2×)",        description: "CA daily overtime thresholds" },
                  { field: "enforceWeeklyOt",      label: "Weekly OT (>40 h)",         description: "Federal & CA weekly threshold" },
                  { field: "enforceSeventhDay",    label: "7th-Day Rule",              description: "All hours OT on 7th consecutive day" },
                  { field: "enforceMinWage",       label: "Min Wage Check ($16.50)",   description: "Flag workers paid below CA min wage" },
                  { field: "enforceFinalPaycheck", label: "Final Paycheck Timing",     description: "Discharge=same day, Resign=72 h" },
                  { field: "preflightRequired",    label: "Preflight Required",        description: "Block approval until compliance passes" },
                ].map(({ field, label, description }) => {
                  const snake = field.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`);
                  const current = profile ? !!(profile[field] ?? profile[snake] ?? true) : true;
                  return (
                    <div key={field} className="flex items-center justify-between gap-2 p-2 rounded border border-border">
                      <div>
                        <p className="text-xs font-medium">{label}</p>
                        <p className="text-[11px] text-muted-foreground">{description}</p>
                      </div>
                      <Switch
                        checked={current}
                        onCheckedChange={() => toggleField(field, current)}
                        disabled={profileMutation.isPending}
                        data-testid={`switch-compliance-${field}`}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Recent violations summary */}
              {complianceSummary && (
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-2" data-testid="summary-compliance-blocks">
                    <p className="text-lg font-bold text-red-600 dark:text-red-400">{complianceSummary.blocks?.length ?? 0}</p>
                    <p className="text-[10px] text-red-600/70 dark:text-red-400/70">Blocks</p>
                  </div>
                  <div className="rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-2" data-testid="summary-compliance-warnings">
                    <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{complianceSummary.warnings?.length ?? 0}</p>
                    <p className="text-[10px] text-amber-600/70 dark:text-amber-400/70">Warnings</p>
                  </div>
                  <div className="rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 p-2" data-testid="summary-compliance-infos">
                    <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{complianceSummary.infos?.length ?? 0}</p>
                    <p className="text-[10px] text-blue-600/70 dark:text-blue-400/70">Info</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SystemDocumentsSection() {
  const { data: docs = [], isLoading } = useQuery<SystemDocument[]>({
    queryKey: ["/api/system-documents"],
  });

  if (isLoading) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <BookOpen className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">System Documents</h2>
        <p className="text-xs text-muted-foreground ml-2">Canonical source-of-truth policies and rules</p>
      </div>
      {docs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <FileText className="h-8 w-8 text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">No system documents found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {docs.map(doc => (
            <Card key={doc.id} data-testid={`card-system-doc-${doc.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="rounded-md bg-primary/10 p-2 shrink-0 mt-0.5">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold">{doc.title}</h3>
                        <Badge variant="outline" className="text-xs">{doc.version}</Badge>
                        <Badge variant="secondary" className="text-xs">{doc.category}</Badge>
                        {doc.isActive && <Badge className="text-xs">Active</Badge>}
                      </div>
                      {doc.description && (
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{doc.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        {doc.effectiveDate && <span>Effective: {doc.effectiveDate}</span>}
                        {doc.updatedAt && <span>Updated: {new Date(doc.updatedAt).toLocaleDateString()}</span>}
                      </div>
                      {doc.changeLog && (
                        <p className="text-xs text-muted-foreground/70 mt-1 italic">{doc.changeLog}</p>
                      )}
                    </div>
                  </div>
                  {doc.fileUrl && (
                    <a
                      href={doc.fileUrl}
                      download
                      data-testid={`link-download-doc-${doc.id}`}
                      className="shrink-0"
                    >
                      <Button variant="outline" size="sm" className="gap-1.5">
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </Button>
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CheckPrintCalibrationSection() {
  const { toast } = useToast();
  const { data: remittanceSources = [], isLoading } = useQuery<RemittanceSource[]>({
    queryKey: ["/api/remittance-sources"],
  });
  const [micrStatus, setMicrStatus] = useState<"checking" | "ok" | "missing">("checking");
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  useEffect(() => {
    document.fonts.ready.then(async () => {
      try {
        const loaded = await document.fonts.load("12px MICRNumeric", "1234567890");
        setMicrStatus(loaded.length > 0 ? "ok" : "missing");
      } catch {
        setMicrStatus("missing");
      }
    });
  }, []);

  const updateAlignment = useMutation({
    mutationFn: async ({ id, verticalAlignment, horizontalAlignment }: { id: string; verticalAlignment: string; horizontalAlignment: string }) =>
      apiRequest("PATCH", `/api/remittance-sources/${id}`, { verticalAlignment, horizontalAlignment }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/remittance-sources"] });
      toast({ title: "Alignment saved", description: "Check print offset updated." });
    },
    onError: () => toast({ title: "Error", description: "Could not save alignment.", variant: "destructive" }),
  });

  const [localOffsets, setLocalOffsets] = useState<Record<string, { v: string; h: string }>>({});

  const getOffset = (src: RemittanceSource) => {
    if (localOffsets[src.id]) return localOffsets[src.id];
    return { v: String(src.verticalAlignment ?? "0"), h: String(src.horizontalAlignment ?? "0") };
  };

  const adjust = (id: string, field: "v" | "h", delta: number) => {
    const current = localOffsets[id] || { v: String(remittanceSources.find(s => s.id === id)?.verticalAlignment ?? "0"), h: String(remittanceSources.find(s => s.id === id)?.horizontalAlignment ?? "0") };
    const newVal = Math.round((parseFloat(current[field] || "0") + delta) * 100) / 100;
    setLocalOffsets(prev => ({ ...prev, [id]: { ...current, [field]: String(newVal) } }));
  };

  const checkSources = remittanceSources.filter(s => s.type === "check" || !s.type);

  return (
    <div id="calibration">
      <div className="flex items-center gap-2 mb-4">
        <Printer className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Check Print Calibration</h2>
        <p className="text-xs text-muted-foreground ml-2">Adjust vertical/horizontal offsets for check stock alignment</p>
        <Badge
          variant={micrStatus === "ok" ? "default" : micrStatus === "missing" ? "destructive" : "secondary"}
          className="ml-auto text-xs"
          data-testid="badge-micr-font-status"
        >
          {micrStatus === "ok" ? <><CheckCircle2 className="h-3 w-3 mr-1" />MICR font ready</> : micrStatus === "missing" ? <><XCircle className="h-3 w-3 mr-1" />MICR font not detected</> : "Checking…"}
        </Badge>
      </div>

      {micrStatus === "missing" && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2" data-testid="banner-micr-missing">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>MICR E-13B font not detected.</strong> The font file is installed at <code className="text-xs bg-black/10 px-1 rounded">/fonts/micr-e13b.ttf</code>.
            If checks still show "MICR not detected", try a hard-refresh (Ctrl+Shift+R) or clear the browser cache. Non-MICR printing is still allowed but checks will not be bank-scannable.
          </div>
        </div>
      )}

      {isLoading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading remittance sources…</CardContent></Card>
      ) : checkSources.length === 0 ? (
        <Card>
          <CardContent className="p-6 flex flex-col items-center text-center gap-2">
            <Printer className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No check remittance sources configured.</p>
            <p className="text-xs text-muted-foreground/70">Add a remittance source under Payroll → Remittance Sources, then return here to calibrate alignment.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {checkSources.map(src => {
            const off = getOffset(src);
            return (
              <Card key={src.id} data-testid={`card-calibration-${src.id}`}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-sm">{src.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {src.institution || "No institution"} · Routing: {src.routingNumber ? `****${src.routingNumber.slice(-4)}` : "—"} · Account: {src.accountNumber ? `****${src.accountNumber.slice(-4)}` : "—"}
                      </div>
                      <div className="text-xs mt-1">
                        <Badge variant={src.status === "enabled" ? "default" : "secondary"} className="text-xs">{src.status || "enabled"}</Badge>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-6">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs text-muted-foreground font-medium">Vertical (in)</span>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => adjust(src.id, "v", -0.01)} data-testid={`button-v-down-${src.id}`}><Minus className="h-3 w-3" /></Button>
                          <Input
                            type="number"
                            step="0.01"
                            className="h-7 w-20 text-center text-xs"
                            value={off.v}
                            onChange={e => setLocalOffsets(prev => ({ ...prev, [src.id]: { ...getOffset(src), v: e.target.value } }))}
                            data-testid={`input-v-offset-${src.id}`}
                          />
                          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => adjust(src.id, "v", 0.01)} data-testid={`button-v-up-${src.id}`}><Plus className="h-3 w-3" /></Button>
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs text-muted-foreground font-medium">Horizontal (in)</span>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => adjust(src.id, "h", -0.01)} data-testid={`button-h-left-${src.id}`}><Minus className="h-3 w-3" /></Button>
                          <Input
                            type="number"
                            step="0.01"
                            className="h-7 w-20 text-center text-xs"
                            value={off.h}
                            onChange={e => setLocalOffsets(prev => ({ ...prev, [src.id]: { ...getOffset(src), h: e.target.value } }))}
                            data-testid={`input-h-offset-${src.id}`}
                          />
                          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => adjust(src.id, "h", 0.01)} data-testid={`button-h-right-${src.id}`}><Plus className="h-3 w-3" /></Button>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={updateAlignment.isPending}
                        onClick={() => updateAlignment.mutate({ id: src.id, verticalAlignment: off.v, horizontalAlignment: off.h })}
                        data-testid={`button-save-alignment-${src.id}`}
                      >
                        <Save className="h-3.5 w-3.5 mr-1.5" />Save Offset
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPreviewingId(previewingId === src.id ? null : src.id)}
                        data-testid={`button-preview-check-${src.id}`}
                      >
                        {previewingId === src.id
                          ? <><EyeOff className="h-3.5 w-3.5 mr-1.5" />Hide Preview</>
                          : <><Eye className="h-3.5 w-3.5 mr-1.5" />Preview</>}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const url = `/api/checks/calibration-pdf?remittanceSourceId=${src.id}`;
                          const win = window.open(url, "_blank");
                          if (win) { win.onload = () => { try { win.print(); } catch { /* non-fatal */ } }; }
                        }}
                        data-testid={`button-test-check-${src.id}`}
                      >
                        <Printer className="h-3.5 w-3.5 mr-1.5" />Print Test Check
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground/70 mt-3 leading-relaxed">
                    Positive vertical = shift down · Negative = shift up · Positive horizontal = shift right · Negative = shift left.
                    Print a test check on plain paper, overlay on check stock to measure the offset, then enter the difference here.
                  </p>
                  {previewingId === src.id && (
                    <div className="mt-3 rounded-md border bg-muted/30 overflow-hidden" data-testid={`preview-frame-${src.id}`}>
                      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/50">
                        <span className="text-xs font-medium text-muted-foreground">Test Check Preview — {src.name}</span>
                        <Button
                          size="sm" variant="ghost" className="h-6 text-xs px-2"
                          onClick={() => {
                            const url = `/api/checks/calibration-pdf?remittanceSourceId=${src.id}`;
                            const win = window.open(url, "_blank");
                            if (win) { win.onload = () => { try { win.print(); } catch { /* non-fatal */ } }; }
                          }}
                          data-testid={`button-print-from-preview-${src.id}`}
                        >
                          <Printer className="h-3 w-3 mr-1" />Print
                        </Button>
                      </div>
                      <iframe
                        key={src.id}
                        src={`/api/checks/calibration-pdf?remittanceSourceId=${src.id}`}
                        className="w-full border-0"
                        style={{ height: "500px" }}
                        title={`Calibration preview — ${src.name}`}
                        data-testid={`iframe-preview-${src.id}`}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SaasPlatformSection() {
  const links = [
    { title: "SaaS Console", description: "Provisioning, billing, feature flags, and tenant operations.", href: "/platform", icon: ServerCog },
    { title: "Sales Pipeline", description: "Manage deals and license opportunities from lead to close.", href: "/app/deal-pipeline", icon: Kanban },
    { title: "Billing", description: "Review subscription billing and account status.", href: "/platform/billing", icon: CreditCard },
    { title: "Customer Onboarding", description: "Track sold customer implementation projects.", href: "/app/onboarding-projects", icon: Users },
  ];

  return (
    <div id="saas-platform">
      <div className="flex items-center gap-2 mb-4">
        <ServerCog className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">SaaS & Platform</h2>
        <p className="text-xs text-muted-foreground ml-2">Operational controls live here, outside the sales and marketing workspace</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {links.map((link) => (
          <a key={link.title} href={link.href} data-testid={`link-settings-${link.title.toLowerCase().replace(/\s+/g, "-")}`}>
            <Card className="h-full transition-colors hover:bg-muted/40">
              <CardContent className="p-4 flex items-start gap-3">
                <div className="rounded-md bg-primary/10 p-2 shrink-0">
                  <link.icon className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{link.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{link.description}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
              </CardContent>
            </Card>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { data: companies, isLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-settings-title">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure the SaaS, platform, and company-level controls that support the growth workspace.
        </p>
      </div>

      <SaasPlatformSection />

      <div>
        <div className="flex items-center gap-2 mb-4">
          <Shield className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Company Policies</h2>
          <p className="text-xs text-muted-foreground ml-2">Overtime, breaks, and time rounding per company</p>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="p-6">
              <div className="h-32 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Loading companies...</p>
              </div>
            </CardContent>
          </Card>
        ) : (companies || []).length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Building2 className="h-10 w-10 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No companies to configure.</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Add a company first.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {(companies || []).map((company) => (
              <CompanyPolicyEditor key={company.id} company={company} />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-4">
          <SettingsIcon className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Compliance & System</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {complianceInfo.map((section) => (
            <Card key={section.title} data-testid={`card-setting-${section.title.toLowerCase().replace(/\s/g, "-")}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-md bg-primary/10 p-2 shrink-0">
                    <section.icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-xs font-semibold">{section.title}</h3>
                      <Badge
                        variant={section.status === "Active" ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {section.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {section.description}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <JurisdictionComplianceSection />

      <SystemDocumentsSection />

      <CheckPrintCalibrationSection />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <SettingsIcon className="h-4 w-4" /> VPS Deployment Guide
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm space-y-3 text-muted-foreground leading-relaxed">
            <p>
              To deploy PayLink to your VPS via GitHub:
            </p>
            <ol className="list-decimal list-inside space-y-2 pl-2">
              <li>Push this Replit project to a GitHub repository using the Git pane.</li>
              <li>SSH into your VPS and clone the repository.</li>
              <li>Install Node.js 20+ and PostgreSQL on the VPS.</li>
              <li>Set environment variables: <code className="text-xs bg-muted px-1 py-0.5 rounded">DATABASE_URL</code>, <code className="text-xs bg-muted px-1 py-0.5 rounded">SESSION_SECRET</code>, <code className="text-xs bg-muted px-1 py-0.5 rounded">PORT</code>.</li>
              <li>Run <code className="text-xs bg-muted px-1 py-0.5 rounded">npm install</code> then <code className="text-xs bg-muted px-1 py-0.5 rounded">npm run build</code>.</li>
              <li>Push the database schema: <code className="text-xs bg-muted px-1 py-0.5 rounded">npm run db:push</code>.</li>
              <li>Start with <code className="text-xs bg-muted px-1 py-0.5 rounded">NODE_ENV=production node dist/index.js</code>.</li>
              <li>Use NGINX as reverse proxy with SSL (Let's Encrypt) and PM2 for process management.</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
