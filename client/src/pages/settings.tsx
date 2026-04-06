import { useState } from "react";
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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { SystemDocument } from "@shared/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Company } from "@shared/schema";

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
      timezone: (company as any).timezone || "America/New_York",
    },
  });

  const timezoneConfirmed = (company as any).timezoneConfirmed ?? false;
  const currentTimezone = (company as any).timezone || "America/New_York";
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

export default function SettingsPage() {
  const { data: companies, isLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-settings-title">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure per-company policies, compliance rules, and system preferences.
        </p>
      </div>

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

      <SystemDocumentsSection />

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
