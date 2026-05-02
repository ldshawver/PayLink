import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, CheckCircle2, Clock, FileText, Shield,
  AlertOctagon, ChevronRight, Users, Bell, Database
} from "lucide-react";

const BREACH_STEPS = [
  {
    id: "detect",
    icon: AlertOctagon,
    label: "1. Detect & Assess",
    color: "text-red-600",
    bgColor: "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800",
    actions: [
      "Identify the nature and scope of the breach",
      "Determine which systems and data were affected",
      "Identify approximate number of affected data subjects",
      "Preserve evidence (logs, screenshots, system state)",
      "Determine if breach is still ongoing",
    ],
  },
  {
    id: "contain",
    icon: Shield,
    label: "2. Contain",
    color: "text-orange-600",
    bgColor: "bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800",
    actions: [
      "Isolate affected systems if still compromised",
      "Revoke exposed credentials, tokens, or API keys",
      "Block unauthorized access vectors",
      "Prevent further data exfiltration",
      "Apply emergency patches if a vulnerability was exploited",
    ],
  },
  {
    id: "notify_dpa",
    icon: Clock,
    label: "3. Notify DPA (72h)",
    color: "text-yellow-600",
    bgColor: "bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800",
    actions: [
      "GDPR Art. 33: Notify supervisory authority within 72 hours if breach risks rights/freedoms",
      "Prepare incident report with: nature, approximate subjects affected, likely consequences",
      "If notification delayed beyond 72h, document reasons for delay",
      "Contact: your local Data Protection Authority (DPA)",
    ],
  },
  {
    id: "notify_subjects",
    icon: Bell,
    label: "4. Notify Affected Users",
    color: "text-blue-600",
    bgColor: "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800",
    actions: [
      "GDPR Art. 34: Notify individuals if breach is likely to result in high risk to their rights",
      "Communicate in clear, plain language",
      "Describe nature of breach and approximate timing",
      "Provide name/contact of Data Protection Officer",
      "Describe likely consequences and measures taken/proposed",
    ],
  },
  {
    id: "document",
    icon: FileText,
    label: "5. Document & Close",
    color: "text-green-600",
    bgColor: "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800",
    actions: [
      "Complete the breach incident record below",
      "Document all remediation actions taken",
      "Conduct post-incident review",
      "Update security controls to prevent recurrence",
      "Retain incident documentation for at least 5 years",
    ],
  },
];

const breachSchema = z.object({
  discoveredAt: z.string().min(1, "Date/time of discovery is required"),
  nature: z.string().min(10, "Please describe the nature of the breach (at least 10 characters)"),
  dataCategories: z.string().min(3, "Please list the affected data categories"),
  approximateSubjects: z.coerce.number().min(0, "Must be 0 or greater"),
  responseActions: z.string().min(10, "Please describe the response actions taken"),
  dpaNotified: z.boolean().default(false),
  subjectsNotified: z.boolean().default(false),
  containmentComplete: z.boolean().default(false),
});

type BreachFormValues = z.infer<typeof breachSchema>;

type BreachRecord = {
  id: string;
  discoveredAt: string;
  nature: string;
  dataCategories: string;
  approximateSubjects: number;
  responseActions: string;
  dpaNotified: boolean;
  subjectsNotified: boolean;
  containmentComplete: boolean;
  createdAt: string;
  actorUserId: string;
};

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function BreachResponsePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: incidents, isLoading } = useQuery<BreachRecord[]>({
    queryKey: ["/api/breach-incidents"],
    queryFn: async () => {
      const r = await fetch("/api/breach-incidents");
      if (!r.ok) throw new Error("Failed to load breach incidents");
      return r.json();
    },
  });

  const form = useForm<BreachFormValues>({
    resolver: zodResolver(breachSchema),
    defaultValues: {
      discoveredAt: "",
      nature: "",
      dataCategories: "",
      approximateSubjects: 0,
      responseActions: "",
      dpaNotified: false,
      subjectsNotified: false,
      containmentComplete: false,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: BreachFormValues) =>
      apiRequest("POST", "/api/breach-incidents", values),
    onSuccess: () => {
      toast({ title: "Breach incident recorded", description: "The incident has been logged to the privacy audit trail." });
      form.reset();
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/breach-incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/privacy-audit-log"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to record breach incident.", variant: "destructive" });
    },
  });

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-6 w-6 text-red-600" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-breach-title">Breach Response Workflow</h1>
          <p className="text-muted-foreground text-sm">Step-by-step guide for detecting, containing, and documenting data breaches</p>
        </div>
      </div>

      <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-red-800 dark:text-red-200 flex items-center gap-2">
            <AlertOctagon className="h-4 w-4" />
            GDPR Breach Notification Requirement
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-700 dark:text-red-300">
            Under GDPR Art. 33, personal data breaches must be reported to the supervisory authority within <strong>72 hours</strong> of
            becoming aware, unless the breach is unlikely to result in a risk to individuals' rights and freedoms.
            Document everything — even if no notification is required, you must be able to demonstrate why.
          </p>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {BREACH_STEPS.map((step) => {
          const Icon = step.icon;
          return (
            <Card key={step.id} className={`border ${step.bgColor}`}>
              <CardHeader className="pb-2">
                <CardTitle className={`text-base flex items-center gap-2 ${step.color}`}>
                  <Icon className="h-4 w-4" />
                  {step.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5">
                  {step.actions.map((action, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="h-4 w-4" />
                Breach Incident Records
              </CardTitle>
              <CardDescription>All recorded breach incidents, written to the privacy audit log</CardDescription>
            </div>
            <Button
              onClick={() => setShowForm(!showForm)}
              variant={showForm ? "outline" : "default"}
              data-testid="button-record-breach"
            >
              {showForm ? "Cancel" : "Record New Incident"}
            </Button>
          </div>
        </CardHeader>

        {showForm && (
          <CardContent className="border-t">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(v => mutation.mutate(v))} className="space-y-4 pt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField control={form.control} name="discoveredAt" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date/Time Discovered</FormLabel>
                      <FormControl><Input type="datetime-local" {...field} data-testid="input-discovered-at" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="approximateSubjects" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Approximate Subjects Affected</FormLabel>
                      <FormControl><Input type="number" min={0} {...field} data-testid="input-approximate-subjects" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="dataCategories" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data Categories Affected</FormLabel>
                    <FormControl><Input placeholder="e.g. names, email addresses, SSNs" {...field} data-testid="input-data-categories" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="nature" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nature of the Breach</FormLabel>
                    <FormControl><Textarea rows={3} placeholder="Describe what happened, how it was discovered, and what data was affected..." {...field} data-testid="input-nature" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="responseActions" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Response Actions Taken</FormLabel>
                    <FormControl><Textarea rows={3} placeholder="Describe containment steps, notifications sent, remediation actions..." {...field} data-testid="input-response-actions" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Checklist</Label>
                  <FormField control={form.control} name="containmentComplete" render={({ field }) => (
                    <FormItem className="flex items-center gap-2">
                      <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} data-testid="checkbox-containment" /></FormControl>
                      <FormLabel className="font-normal cursor-pointer">Breach has been contained</FormLabel>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="dpaNotified" render={({ field }) => (
                    <FormItem className="flex items-center gap-2">
                      <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} data-testid="checkbox-dpa-notified" /></FormControl>
                      <FormLabel className="font-normal cursor-pointer">Supervisory authority (DPA) notified</FormLabel>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="subjectsNotified" render={({ field }) => (
                    <FormItem className="flex items-center gap-2">
                      <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} data-testid="checkbox-subjects-notified" /></FormControl>
                      <FormLabel className="font-normal cursor-pointer">Affected data subjects notified</FormLabel>
                    </FormItem>
                  )} />
                </div>
                <Button type="submit" disabled={mutation.isPending} data-testid="button-submit-breach">
                  {mutation.isPending ? "Recording…" : "Record Breach Incident"}
                </Button>
              </form>
            </Form>
          </CardContent>
        )}

        <CardContent className={showForm ? "" : ""}>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-muted/30 rounded animate-pulse" />)}</div>
          ) : !incidents || incidents.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-muted-foreground" data-testid="text-no-incidents">
              <CheckCircle2 className="h-10 w-10 mb-2 text-green-500 opacity-60" />
              <p className="font-medium">No breach incidents recorded</p>
              <p className="text-sm">This is the expected state for a secure system</p>
            </div>
          ) : (
            <div className="space-y-3 mt-4">
              {incidents.map(incident => (
                <div key={incident.id} className="border rounded-lg p-4 space-y-2" data-testid={`card-incident-${incident.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                      <span className="font-medium text-sm">{formatDate(incident.discoveredAt)} — Discovered</span>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {incident.containmentComplete && <Badge className="text-xs bg-green-100 text-green-800">Contained</Badge>}
                      {incident.dpaNotified && <Badge className="text-xs bg-blue-100 text-blue-800">DPA Notified</Badge>}
                      {incident.subjectsNotified && <Badge className="text-xs bg-purple-100 text-purple-800">Subjects Notified</Badge>}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Nature:</span> {incident.nature}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" /> ~{incident.approximateSubjects} subjects</span>
                    <span>Data: {incident.dataCategories}</span>
                    <span>Recorded: {formatDate(incident.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
