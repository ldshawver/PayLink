import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
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
} from "lucide-react";

function useTabParam(defaultTab: string): [string, (tab: string) => void] {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get("tab") || defaultTab;
  const setTab = (newTab: string) => setLocation(`/my-profile?tab=${newTab}`);
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

// ─── Preferences Tab ───────────────────────────────────────────────────────────

function PreferencesTab({ worker }: { worker: Worker | null }) {
  const { toast } = useToast();
  const prefs = worker ? JSON.parse(worker.preferences || "{}") : {};

  const [notifyScheduleEmail, setNotifyScheduleEmail] = useState<boolean>(prefs.notifyScheduleEmail !== false);
  const [notifyScheduleSms, setNotifyScheduleSms] = useState<boolean>(!!prefs.notifyScheduleSms);
  const [notifyPaydayEmail, setNotifyPaydayEmail] = useState<boolean>(prefs.notifyPaydayEmail !== false);
  const [notifyPaydaySms, setNotifyPaydaySms] = useState<boolean>(!!prefs.notifyPaydaySms);
  const [language, setLanguage] = useState<string>(prefs.language || "en");
  const [timezone, setTimezone] = useState<string>(prefs.timezone || "America/Los_Angeles");
  const [dateFormat, setDateFormat] = useState<string>(prefs.dateFormat || "MM/DD/YYYY");

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
    mutation.mutate({ notifyScheduleEmail, notifyScheduleSms, notifyPaydayEmail, notifyPaydaySms, language, timezone, dateFormat });
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
    </div>
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
};

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
                      <Badge variant={stub.run.status === "processed" ? "default" : "secondary"}>
                        {stub.run.status}
                      </Badge>
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
        </TabsList>

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
      </Tabs>
    </div>
  );
}
