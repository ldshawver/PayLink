import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Shield, Database, Globe, FileText, ExternalLink, Download, Eraser, UserX } from "lucide-react";

const LEGAL_BASIS_COLORS: Record<string, string> = {
  legal_obligation: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  legitimate_interest: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  contract: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  consent: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
};

const LEGAL_BASIS_LABELS: Record<string, string> = {
  legal_obligation: "Legal Obligation",
  legitimate_interest: "Legitimate Interest",
  contract: "Contract Performance",
  consent: "Consent",
};

interface DataCategory {
  category: string;
  examples: string;
  storageLocation: string;
  retentionPeriod: string;
  legalBasis: string;
  sharedWithThirdParties: boolean;
  thirdParties?: string;
  specialCategory: boolean;
}

interface Subprocessor {
  name: string;
  role: string;
  dataCategories: string;
  country: string;
  dpaLink: string;
}

const DATA_INVENTORY: DataCategory[] = [
  {
    category: "Full Name",
    examples: "First name, last name, middle name, DBA name",
    storageLocation: "workers table, persons table (PostgreSQL on VPS)",
    retentionPeriod: "7 years after termination (employment records)",
    legalBasis: "contract",
    sharedWithThirdParties: true,
    thirdParties: "Stripe (payroll disbursement), DocuSign/Acrobat Sign (e-signatures)",
    specialCategory: false,
  },
  {
    category: "Social Security Number (SSN)",
    examples: "9-digit SSN stored at person level",
    storageLocation: "workers.ssn, persons.ssn (PostgreSQL on VPS)",
    retentionPeriod: "4 years after employment ends (IRS requirement)",
    legalBasis: "legal_obligation",
    sharedWithThirdParties: false,
    specialCategory: true,
  },
  {
    category: "Bank Account & Routing Numbers",
    examples: "Checking/savings account, routing number, bank name",
    storageLocation: "pay_methods table (PostgreSQL on VPS)",
    retentionPeriod: "7 years (financial record-keeping)",
    legalBasis: "contract",
    sharedWithThirdParties: true,
    thirdParties: "Stripe (ACH/direct deposit processing)",
    specialCategory: true,
  },
  {
    category: "Contact Information",
    examples: "Email, phone, home address, emergency contacts",
    storageLocation: "workers table, employee_contacts table (PostgreSQL on VPS)",
    retentionPeriod: "7 years after termination",
    legalBasis: "contract",
    sharedWithThirdParties: false,
    specialCategory: false,
  },
  {
    category: "Date of Birth",
    examples: "Birth date (used for age verification, W-2 reporting)",
    storageLocation: "workers.birth_date (PostgreSQL on VPS)",
    retentionPeriod: "7 years after termination",
    legalBasis: "legal_obligation",
    sharedWithThirdParties: false,
    specialCategory: false,
  },
  {
    category: "IP Address",
    examples: "Login IP addresses stored in audit log events",
    storageLocation: "authorization_audit_log, analytics_events (PostgreSQL on VPS)",
    retentionPeriod: "2 years (security and audit purposes)",
    legalBasis: "legitimate_interest",
    sharedWithThirdParties: false,
    specialCategory: false,
  },
  {
    category: "Employment & Payroll Records",
    examples: "Pay rate, hours worked, gross/net pay, tax withholdings, YTD totals",
    storageLocation: "payroll_items, payroll_runs, time_entries (PostgreSQL on VPS)",
    retentionPeriod: "4 years (IRS); 7 years (employment records)",
    legalBasis: "legal_obligation",
    sharedWithThirdParties: false,
    specialCategory: false,
  },
  {
    category: "HR Documents",
    examples: "I-9, W-4, W-9, offer letters, performance reviews",
    storageLocation: "documents table; files in /uploads/ (VPS disk)",
    retentionPeriod: "Per document type (I-9: 3yr/1yr; W-4: 4yr; general: 7yr)",
    legalBasis: "legal_obligation",
    sharedWithThirdParties: true,
    thirdParties: "DocuSign / Acrobat Sign (e-signatures only)",
    specialCategory: false,
  },
  {
    category: "Location / GPS",
    examples: "Clock-in location data (if station enforcement enabled)",
    storageLocation: "time_punches.station_id, stations table (PostgreSQL on VPS)",
    retentionPeriod: "2 years",
    legalBasis: "legitimate_interest",
    sharedWithThirdParties: false,
    specialCategory: false,
  },
  {
    category: "Biometric / Device Identifiers",
    examples: "Device push tokens, biometric auth flags (not raw biometrics)",
    storageLocation: "device_tokens table (PostgreSQL on VPS)",
    retentionPeriod: "Until device token revoked or user deletion",
    legalBasis: "consent",
    sharedWithThirdParties: false,
    specialCategory: false,
  },
];

const SUBPROCESSORS: Subprocessor[] = [
  {
    name: "Stripe, Inc.",
    role: "Payment processing, ACH disbursement, Treasury / financial accounts",
    dataCategories: "Name, bank account numbers, routing numbers, employer EIN, payout amounts",
    country: "United States",
    dpaLink: "https://stripe.com/legal/dpa",
  },
  {
    name: "DocuSign, Inc.",
    role: "Electronic signature collection for HR documents and agreements",
    dataCategories: "Name, email address, document contents, signature events",
    country: "United States",
    dpaLink: "https://www.docusign.com/company/privacy-policy",
  },
  {
    name: "Adobe Acrobat Sign",
    role: "Electronic signature collection (alternative to DocuSign)",
    dataCategories: "Name, email address, document contents, signature events",
    country: "United States",
    dpaLink: "https://www.adobe.com/privacy/general-data-protection-regulation.html",
  },
  {
    name: "SendGrid (Twilio)",
    role: "Transactional email delivery (notifications, pay stubs, onboarding emails)",
    dataCategories: "Email address, message content",
    country: "United States",
    dpaLink: "https://www.twilio.com/legal/data-protection-addendum",
  },
  {
    name: "Twilio (SMS)",
    role: "SMS notifications (schedule alerts, clock-in reminders)",
    dataCategories: "Phone number, message content",
    country: "United States",
    dpaLink: "https://www.twilio.com/legal/data-protection-addendum",
  },
  {
    name: "VPS Hosting Provider",
    role: "Infrastructure hosting — database, application server, file storage",
    dataCategories: "All data stored in the PayLink database and file system",
    country: "United States",
    dpaLink: "(See your hosting provider's DPA)",
  },
];

function WorkerPiiActionsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [workerId, setWorkerId] = useState("");
  const [exported, setExported] = useState<any>(null);

  const exportMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/workers/${id}/data-export`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "Export failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setExported(data);
      queryClient.invalidateQueries({ queryKey: ["/api/privacy-audit-log"] });
      toast({ title: "PII export complete", description: "Worker data exported and logged to the privacy audit trail." });
    },
    onError: (e: any) => toast({ title: "Export failed", description: e.message, variant: "destructive" }),
  });

  const anonymizeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/workers/${id}/anonymize`);
      return res;
    },
    onSuccess: () => {
      setExported(null);
      setWorkerId("");
      queryClient.invalidateQueries({ queryKey: ["/api/privacy-audit-log"] });
      toast({ title: "Worker anonymized", description: "PII fields have been cleared and the action logged to the privacy audit trail." });
    },
    onError: (e: any) => toast({ title: "Anonymization failed", description: String(e?.message ?? e), variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserX className="h-4 w-4" />
            Worker PII Actions (GDPR Art. 15 &amp; 17)
          </CardTitle>
          <CardDescription>
            Export a worker's personal data (Right of Access) or anonymize their record (Right to Erasure).
            All actions are written to the privacy audit log.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label htmlFor="input-worker-id">Worker ID</Label>
              <Input
                id="input-worker-id"
                data-testid="input-worker-id"
                value={workerId}
                onChange={e => { setWorkerId(e.target.value); setExported(null); }}
                placeholder="e.g. 3f2a1b0c-…"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => exportMutation.mutate(workerId)}
              disabled={!workerId || exportMutation.isPending}
              data-testid="button-export-worker-pii"
            >
              <Download className="h-4 w-4 mr-2" />
              {exportMutation.isPending ? "Exporting…" : "Export PII"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (window.confirm("This will permanently erase PII fields for this worker. Continue?")) {
                  anonymizeMutation.mutate(workerId);
                }
              }}
              disabled={!workerId || anonymizeMutation.isPending}
              data-testid="button-anonymize-worker"
            >
              <Eraser className="h-4 w-4 mr-2" />
              {anonymizeMutation.isPending ? "Anonymizing…" : "Anonymize"}
            </Button>
          </div>

          {exported && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Exported PII — {exported.worker?.firstName} {exported.worker?.lastName}</span>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => {
                  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = `worker-pii-${workerId}.json`; a.click();
                  URL.revokeObjectURL(url);
                }} data-testid="button-download-exported-pii">
                  <Download className="h-3.5 w-3.5 mr-1" />Download JSON
                </Button>
              </div>
              <pre className="text-xs overflow-auto max-h-64 font-mono">{JSON.stringify(exported, null, 2)}</pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function GdprInventoryPage() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-gdpr-title">GDPR Data Inventory</h1>
          <p className="text-muted-foreground text-sm">Platform administrator view — data categories, retention, legal basis, and subprocessors</p>
        </div>
      </div>

      <Tabs defaultValue="inventory">
        <TabsList>
          <TabsTrigger value="inventory" data-testid="tab-data-inventory">
            <Database className="h-4 w-4 mr-2" />
            Data Inventory
          </TabsTrigger>
          <TabsTrigger value="subprocessors" data-testid="tab-subprocessors">
            <Globe className="h-4 w-4 mr-2" />
            Subprocessors
          </TabsTrigger>
          <TabsTrigger value="pii-actions" data-testid="tab-pii-actions">
            <UserX className="h-4 w-4 mr-2" />
            Worker PII Actions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Personal Data Categories
              </CardTitle>
              <CardDescription>
                All categories of personal data processed by PayLink, their storage location, retention period, and legal basis.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table data-testid="table-data-inventory">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[160px]">Data Category</TableHead>
                      <TableHead>Examples</TableHead>
                      <TableHead className="w-[200px]">Storage Location</TableHead>
                      <TableHead className="w-[160px]">Retention Period</TableHead>
                      <TableHead className="w-[140px]">Legal Basis</TableHead>
                      <TableHead className="w-[100px]">3rd Parties</TableHead>
                      <TableHead className="w-[80px]">Special Cat.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {DATA_INVENTORY.map((row, idx) => (
                      <TableRow key={idx} data-testid={`row-data-category-${idx}`}>
                        <TableCell className="font-medium text-sm">{row.category}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{row.examples}</TableCell>
                        <TableCell className="text-xs font-mono">{row.storageLocation}</TableCell>
                        <TableCell className="text-xs">{row.retentionPeriod}</TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${LEGAL_BASIS_COLORS[row.legalBasis] || "bg-gray-100 text-gray-700"}`}>
                            {LEGAL_BASIS_LABELS[row.legalBasis] || row.legalBasis}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {row.sharedWithThirdParties ? (
                            <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">
                              Yes
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-emerald-700 border-emerald-300">
                              No
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.specialCategory ? (
                            <Badge variant="destructive" className="text-xs">Yes</Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">No</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Third-Party Sharing Details</CardTitle>
              <CardDescription>Where data is shared with third parties, the specific recipients and data categories</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {DATA_INVENTORY.filter(d => d.sharedWithThirdParties && d.thirdParties).map((row, idx) => (
                  <div key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border">
                    <div className="flex-1">
                      <p className="text-sm font-medium">{row.category}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Shared with: {row.thirdParties}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="subprocessors" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Subprocessors List
              </CardTitle>
              <CardDescription>
                Third-party processors that may receive or process personal data on behalf of PayLink tenants.
                All listed processors are covered by a Data Processing Agreement (DPA).
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table data-testid="table-subprocessors">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[180px]">Processor</TableHead>
                      <TableHead>Role / Purpose</TableHead>
                      <TableHead>Data Categories Received</TableHead>
                      <TableHead className="w-[120px]">Country</TableHead>
                      <TableHead className="w-[100px]">DPA</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {SUBPROCESSORS.map((sp, idx) => (
                      <TableRow key={idx} data-testid={`row-subprocessor-${idx}`}>
                        <TableCell className="font-medium text-sm">{sp.name}</TableCell>
                        <TableCell className="text-sm">{sp.role}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{sp.dataCategories}</TableCell>
                        <TableCell className="text-sm">{sp.country}</TableCell>
                        <TableCell>
                          <a
                            href={sp.dpaLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                            data-testid={`link-dpa-${idx}`}
                          >
                            DPA <ExternalLink className="h-3 w-3" />
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">International Transfers</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                All listed subprocessors are based in the United States and process data under Standard Contractual Clauses (SCCs)
                or equivalent mechanisms where required for EU/EEA data subjects. Review each subprocessor's DPA link above for
                their specific transfer mechanism documentation.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pii-actions" className="space-y-4 mt-4">
          <WorkerPiiActionsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
