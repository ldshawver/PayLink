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
  CalendarOff,
  CalendarCheck,
  CalendarX,
  Clock,
  Check,
  X,
  Info,
} from "lucide-react";
import type { TimeOffRequest, SchedulePreference } from "@shared/schema";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
        <CardContent className="p-0">
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
        <CardContent className="p-0">
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
        <CardContent className="p-0">
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
        <CardContent className="p-0">
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
        <CardContent className="p-0">
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
        <CardContent className="p-0">
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
            <div className="grid grid-cols-2 gap-3">
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

// ─── Time Off Tab ────────────────────────────────────────────────────────────────

const REQUEST_TYPES = [
  { value: "vacation", label: "Vacation" },
  { value: "personal", label: "Personal Day" },
  { value: "sick", label: "Sick Leave" },
  { value: "unpaid", label: "Unpaid Leave" },
  { value: "bereavement", label: "Bereavement" },
  { value: "jury_duty", label: "Jury Duty" },
  { value: "medical", label: "Medical Appointment" },
  { value: "other", label: "Other" },
];

const SHIFT_TIMES = [
  { value: "early_morning", label: "Early Morning (4 AM – 8 AM)" },
  { value: "morning", label: "Morning (8 AM – 12 PM)" },
  { value: "midday", label: "Midday (11 AM – 2 PM)" },
  { value: "afternoon", label: "Afternoon (2 PM – 6 PM)" },
  { value: "evening", label: "Evening (6 PM – 10 PM)" },
  { value: "graveyard", label: "Graveyard (10 PM – 4 AM)" },
];

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function statusBadge(status: string) {
  if (status === "approved") return <Badge className="bg-green-100 text-green-800 border-green-200"><Check className="h-3 w-3 mr-1" />Approved</Badge>;
  if (status === "rejected") return <Badge className="bg-red-100 text-red-800 border-red-200"><X className="h-3 w-3 mr-1" />Rejected</Badge>;
  return <Badge className="bg-amber-100 text-amber-800 border-amber-200"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
}

function importanceLabel(n: number) {
  const labels: Record<number, string> = { 1: "Critical", 2: "High", 3: "Medium", 4: "Low", 5: "Lowest" };
  return labels[n] || n.toString();
}

function TimeOffTab({ worker }: { worker: any | null }) {
  const { toast } = useToast();

  const [requestOpen, setRequestOpen] = useState(false);
  const [prefOpen, setPrefOpen] = useState(false);

  const [reqType, setReqType] = useState("vacation");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [totalDays, setTotalDays] = useState("1");
  const [reason, setReason] = useState("");

  const [prefType, setPrefType] = useState<"day_off" | "shift">("day_off");
  const [dayOfWeek, setDayOfWeek] = useState<string>("");
  const [shiftTime, setShiftTime] = useState("");
  const [preferNotToWork, setPreferNotToWork] = useState(false);
  const [importance, setImportance] = useState("3");
  const [prefNote, setPrefNote] = useState("");

  const { data: requests = [], isLoading: reqLoading } = useQuery<TimeOffRequest[]>({
    queryKey: ["/api/my/time-off-requests"],
  });
  const { data: prefs = [], isLoading: prefLoading } = useQuery<SchedulePreference[]>({
    queryKey: ["/api/my/schedule-preferences"],
  });

  const submitRequest = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiRequest("POST", "/api/my/time-off-requests", data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my/time-off-requests"] });
      toast({ title: "Request submitted", description: "Your manager will be notified." });
      setRequestOpen(false);
      setReqType("vacation"); setStartDate(""); setStartTime(""); setEndDate(""); setEndTime(""); setTotalDays("1"); setReason("");
    },
    onError: (e: Error) => toast({ title: "Failed to submit", description: e.message, variant: "destructive" }),
  });

  const cancelRequest = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/my/time-off-requests/${id}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my/time-off-requests"] });
      toast({ title: "Request cancelled" });
    },
    onError: () => toast({ title: "Failed to cancel", variant: "destructive" }),
  });

  const addPref = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiRequest("POST", "/api/my/schedule-preferences", data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my/schedule-preferences"] });
      toast({ title: "Preference saved" });
      setPrefOpen(false);
      setPrefType("day_off"); setDayOfWeek(""); setShiftTime(""); setPreferNotToWork(false); setImportance("3"); setPrefNote("");
    },
    onError: (e: Error) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const deletePref = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/my/schedule-preferences/${id}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my/schedule-preferences"] });
      toast({ title: "Preference removed" });
    },
    onError: () => toast({ title: "Failed to remove", variant: "destructive" }),
  });

  if (!worker) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm">
        This feature requires your account to be linked to an employee record.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Time-Off Requests ─────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold flex items-center gap-2"><CalendarOff className="h-5 w-5 text-primary" />Time-Off Requests</h3>
          <Button size="sm" onClick={() => setRequestOpen(true)} data-testid="button-new-time-off-request">
            <Plus className="h-4 w-4 mr-1" />New Request
          </Button>
        </div>

        {reqLoading ? (
          <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : requests.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 border rounded-lg">No time-off requests yet.</div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map(r => (
                  <TableRow key={r.id} data-testid={`row-time-off-${r.id}`}>
                    <TableCell className="font-medium capitalize">{REQUEST_TYPES.find(t => t.value === r.requestType)?.label ?? r.requestType}</TableCell>
                    <TableCell className="text-sm">
                      {r.startDate}{r.startTime ? ` ${r.startTime}` : ""}<br />
                      <span className="text-muted-foreground">to {r.endDate}{r.endTime ? ` ${r.endTime}` : ""}</span>
                    </TableCell>
                    <TableCell>{r.totalDays}</TableCell>
                    <TableCell className="max-w-[160px] truncate text-muted-foreground text-sm">{r.reason || "—"}</TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.reviewNote || "—"}</TableCell>
                    <TableCell>
                      {r.status === "pending" && (
                        <Button size="sm" variant="ghost" className="text-destructive h-8 px-2" onClick={() => cancelRequest.mutate(r.id)} data-testid={`button-cancel-request-${r.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* New Request Dialog */}
        <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><CalendarOff className="h-5 w-5 text-primary" />Request Time Off</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Request Type</Label>
                <Select value={reqType} onValueChange={setReqType}>
                  <SelectTrigger data-testid="select-time-off-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REQUEST_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Start Date</Label>
                  <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} data-testid="input-start-date" />
                </div>
                <div>
                  <Label>Start Time <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} data-testid="input-start-time" />
                </div>
                <div>
                  <Label>End Date</Label>
                  <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} data-testid="input-end-date" />
                </div>
                <div>
                  <Label>End Time <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} data-testid="input-end-time" />
                </div>
              </div>
              <div>
                <Label>Total Days</Label>
                <Input type="number" min="0.5" step="0.5" value={totalDays} onChange={e => setTotalDays(e.target.value)} data-testid="input-total-days" />
              </div>
              <div>
                <Label>Reason <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Brief explanation..." rows={3} data-testid="textarea-reason" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setRequestOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => submitRequest.mutate({ requestType: reqType, startDate, startTime: startTime || null, endDate, endTime: endTime || null, totalDays, reason: reason || null })}
                  disabled={!startDate || !endDate || submitRequest.isPending}
                  data-testid="button-submit-time-off"
                >
                  {submitRequest.isPending ? "Submitting…" : "Submit Request"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* ── Schedule Preferences ───────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold flex items-center gap-2"><Clock className="h-5 w-5 text-primary" />Schedule Preferences</h3>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Let your manager know which days or shifts you prefer or prefer not to work. Importance 1 = most important to you, 5 = least important.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Button size="sm" onClick={() => setPrefOpen(true)} data-testid="button-add-schedule-preference">
            <Plus className="h-4 w-4 mr-1" />Add Preference
          </Button>
        </div>

        {prefLoading ? (
          <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : prefs.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 border rounded-lg">No schedule preferences set.</div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Day / Shift</TableHead>
                  <TableHead>Preference</TableHead>
                  <TableHead>Importance</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prefs.map(p => (
                  <TableRow key={p.id} data-testid={`row-sched-pref-${p.id}`}>
                    <TableCell className="capitalize">{p.preferenceType === "day_off" ? "Day Off" : "Shift Time"}</TableCell>
                    <TableCell>
                      {p.preferenceType === "day_off" && p.dayOfWeek !== null && p.dayOfWeek !== undefined
                        ? DAYS_OF_WEEK[p.dayOfWeek]
                        : SHIFT_TIMES.find(s => s.value === p.shiftTime)?.label ?? p.shiftTime ?? "—"}
                    </TableCell>
                    <TableCell>
                      {p.preferNotToWork
                        ? <Badge variant="outline" className="text-red-700 border-red-200 bg-red-50"><X className="h-3 w-3 mr-1" />Prefer NOT to work</Badge>
                        : <Badge variant="outline" className="text-green-700 border-green-200 bg-green-50"><Check className="h-3 w-3 mr-1" />Prefer to work</Badge>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{p.importance} — {importanceLabel(p.importance)}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[160px] truncate">{p.note || "—"}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" className="text-destructive h-8 px-2" onClick={() => deletePref.mutate(p.id)} data-testid={`button-delete-pref-${p.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Add Preference Dialog */}
        <Dialog open={prefOpen} onOpenChange={setPrefOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-primary" />Add Schedule Preference</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Preference Type</Label>
                <Select value={prefType} onValueChange={(v) => { setPrefType(v as "day_off" | "shift"); setDayOfWeek(""); setShiftTime(""); }}>
                  <SelectTrigger data-testid="select-pref-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day_off">Day Off Preference</SelectItem>
                    <SelectItem value="shift">Shift Time Preference</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {prefType === "day_off" ? (
                <div>
                  <Label>Day of Week</Label>
                  <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                    <SelectTrigger data-testid="select-day-of-week"><SelectValue placeholder="Select day…" /></SelectTrigger>
                    <SelectContent>
                      {DAYS_OF_WEEK.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div>
                  <Label>Shift Time</Label>
                  <Select value={shiftTime} onValueChange={setShiftTime}>
                    <SelectTrigger data-testid="select-shift-time"><SelectValue placeholder="Select shift…" /></SelectTrigger>
                    <SelectContent>
                      {SHIFT_TIMES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex items-center gap-3 rounded-lg border p-3">
                <Switch checked={preferNotToWork} onCheckedChange={setPreferNotToWork} data-testid="switch-prefer-not-to-work" />
                <div>
                  <p className="text-sm font-medium">{preferNotToWork ? "Prefer NOT to work" : "Prefer to work"}</p>
                  <p className="text-xs text-muted-foreground">{preferNotToWork ? "You would rather not be scheduled for this." : "You would like to be scheduled for this."}</p>
                </div>
              </div>

              <div>
                <Label className="flex items-center gap-1">
                  Importance
                  <span className="text-muted-foreground text-xs ml-1">(1 = most important, 5 = least important)</span>
                </Label>
                <div className="flex gap-2 mt-2">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setImportance(String(n))}
                      data-testid={`button-importance-${n}`}
                      className={`flex-1 py-2 rounded-md border text-sm font-medium transition-colors ${importance === String(n) ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted border-input"}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1 text-center">{importanceLabel(Number(importance))}</p>
              </div>

              <div>
                <Label>Note <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Textarea value={prefNote} onChange={e => setPrefNote(e.target.value)} placeholder="Any additional context…" rows={2} data-testid="textarea-pref-note" />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPrefOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => addPref.mutate({
                    preferenceType: prefType,
                    dayOfWeek: prefType === "day_off" && dayOfWeek !== "" ? Number(dayOfWeek) : null,
                    shiftTime: prefType === "shift" ? shiftTime || null : null,
                    preferNotToWork,
                    importance: Number(importance),
                    note: prefNote || null,
                  })}
                  disabled={(prefType === "day_off" && dayOfWeek === "") || (prefType === "shift" && !shiftTime) || addPref.isPending}
                  data-testid="button-save-preference"
                >
                  {addPref.isPending ? "Saving…" : "Save Preference"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
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
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <LoadingSkeleton />
      </div>
    );
  }

  const workerName = worker ? `${worker.firstName} ${worker.lastName}` : user?.username || "My Profile";

  return (
    <div className="p-6 space-y-6">
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
          <TabsTrigger value="time-off" data-testid="tab-time-off" className="flex items-center gap-1">
            <CalendarOff className="h-4 w-4" />Time Off
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
        <TabsContent value="time-off" className="mt-4">
          <TimeOffTab worker={worker || null} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
