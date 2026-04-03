import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  ChevronRight,
  Building2,
  Loader2,
  ClipboardList,
  Zap,
  Shield,
  CreditCard,
  FileText,
  Play,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Gate = {
  id: string;
  companyId: string;
  agreementStatus: string;
  implementationFeeStatus: string;
  subscriptionStatus: string;
  paymentMethodStatus: string;
  lifecycleState: string;
  selectedTemplate: string | null;
  provisionedAt: string | null;
  notes: string | null;
  createdAt: string;
  company: {
    id: string;
    name: string;
    email: string | null;
    subscriptionStatus: string | null;
  };
};

type AuditLog = {
  id: string;
  companyId: string;
  eventType: string;
  step: string | null;
  status: string;
  details: string | null;
  triggeredBy: string | null;
  createdAt: string;
};

type ImplementationProject = {
  id: string;
  companyId: string;
  templateKey: string;
  templateName: string;
  status: string;
  completedSteps: number;
  totalSteps: number;
  checklistItems: string | null;
  internalTasks: string | null;
  startedAt: string | null;
};

type Template = {
  key: string;
  name: string;
  description: string;
  defaultDepartments: string[];
  enabledModules: string[];
  onboardingTasks: string[];
  checklistItems: string[];
};

type ProvisioningStatus = {
  gate: Gate | null;
  auditLogs: AuditLog[];
  implementationProject: ImplementationProject | null;
};

const LIFECYCLE_COLORS: Record<string, string> = {
  pending_activation: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  grace_period: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  suspended: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  reactivated: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
};

function GateIndicator({ passed, label }: { passed: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-sm" data-testid={`gate-indicator-${label.toLowerCase().replace(/\s/g, "-")}`}>
      {passed ? (
        <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
      ) : (
        <XCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
      )}
      <span className={passed ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}>
        {label}
      </span>
    </div>
  );
}

function LifecycleBadge({ state }: { state: string }) {
  const colorClass = LIFECYCLE_COLORS[state] || LIFECYCLE_COLORS.pending_activation;
  const label = state.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`} data-testid="badge-lifecycle-state">
      {label}
    </span>
  );
}

function ProvisioningDetailDrawer({
  companyId,
  open,
  onClose,
}: {
  companyId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [selectedEvent, setSelectedEvent] = useState<string>("");

  const { data, isLoading } = useQuery<ProvisioningStatus>({
    queryKey: ["/api/provisioning/tenants", companyId],
    enabled: open && !!companyId,
  });

  const { data: templates } = useQuery<Template[]>({
    queryKey: ["/api/provisioning/templates"],
  });

  const eventMutation = useMutation({
    mutationFn: (vars: { event: string; payload?: Record<string, any> }) =>
      apiRequest("POST", "/api/provisioning/event", { companyId, event: vars.event, payload: vars.payload }),
    onSuccess: async (res: any) => {
      const json = await res.json();
      toast({ title: "Event sent", description: json.message });
      queryClient.invalidateQueries({ queryKey: ["/api/provisioning/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/provisioning/tenants", companyId] });
    },
    onError: () => toast({ title: "Error", description: "Failed to send event", variant: "destructive" }),
  });

  const retryMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/provisioning/tenants/${companyId}/retry`),
    onSuccess: async (res: any) => {
      const json = await res.json();
      toast({ title: "Provisioning retried", description: json.message });
      queryClient.invalidateQueries({ queryKey: ["/api/provisioning/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/provisioning/tenants", companyId] });
    },
    onError: () => toast({ title: "Error", description: "Failed to retry provisioning", variant: "destructive" }),
  });

  const events = [
    { value: "agreement.signed", label: "Agreement Signed" },
    { value: "implementation_fee.paid", label: "Implementation Fee Paid" },
    { value: "subscription.activated", label: "Subscription Activated" },
    { value: "payment_method.verified", label: "Payment Method Verified" },
    { value: "go_live.approved", label: "Go Live Approved" },
    { value: "subscription.payment_failed", label: "Payment Failed" },
    { value: "tenant.suspended", label: "Suspend Tenant" },
  ];

  const gate = data?.gate;
  const project = data?.implementationProject;
  const auditLogs = data?.auditLogs || [];
  let checklistItems: any[] = [];
  let internalTasks: any[] = [];
  try { checklistItems = project?.checklistItems ? JSON.parse(project.checklistItems) : []; } catch {}
  try { internalTasks = project?.internalTasks ? JSON.parse(project.internalTasks) : []; } catch {}

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Provisioning Details
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {gate && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Commercial Gates
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <GateIndicator passed={gate.agreementStatus === "signed"} label="Agreement Signed" />
                  <GateIndicator passed={gate.implementationFeeStatus === "paid"} label="Implementation Fee" />
                  <GateIndicator passed={gate.subscriptionStatus === "active"} label="Subscription Active" />
                  <GateIndicator passed={gate.paymentMethodStatus === "verified"} label="Payment Method" />
                </CardContent>
              </Card>
            )}

            {project && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <ClipboardList className="h-4 w-4" />
                    Implementation Project — {project.templateName}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="text-sm text-muted-foreground">Progress:</div>
                    <div className="flex-1 bg-secondary rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{ width: project.totalSteps ? `${(project.completedSteps / project.totalSteps) * 100}%` : "0%" }}
                      />
                    </div>
                    <div className="text-sm font-medium">{project.completedSteps}/{project.totalSteps}</div>
                  </div>
                  {checklistItems.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Checklist</p>
                      <ul className="space-y-1">
                        {checklistItems.map((item: any) => (
                          <li key={item.id} className="flex items-center gap-2 text-sm" data-testid={`checklist-item-${item.id}`}>
                            {item.completed ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                            ) : (
                              <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground flex-shrink-0" />
                            )}
                            <span className={item.completed ? "line-through text-muted-foreground" : ""}>{item.label}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {internalTasks.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Internal Tasks</p>
                      <ul className="space-y-1">
                        {internalTasks.map((task: any) => (
                          <li key={task.id} className="flex items-center gap-2 text-sm" data-testid={`internal-task-${task.id}`}>
                            <Badge variant={task.status === "done" ? "default" : "secondary"} className="text-xs">
                              {task.status}
                            </Badge>
                            {task.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Send Provisioning Event
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Select value={selectedEvent} onValueChange={setSelectedEvent}>
                    <SelectTrigger className="flex-1" data-testid="select-provisioning-event">
                      <SelectValue placeholder="Select event..." />
                    </SelectTrigger>
                    <SelectContent>
                      {events.map((e) => (
                        <SelectItem key={e.value} value={e.value} data-testid={`option-event-${e.value}`}>
                          {e.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => selectedEvent && eventMutation.mutate({ event: selectedEvent })}
                    disabled={!selectedEvent || eventMutation.isPending}
                    data-testid="button-send-event"
                  >
                    {eventMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    Send
                  </Button>
                </div>
                <Button
                  variant="outline"
                  onClick={() => retryMutation.mutate()}
                  disabled={retryMutation.isPending}
                  className="w-full"
                  data-testid="button-retry-provisioning"
                >
                  {retryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Retry Provisioning
                </Button>
              </CardContent>
            </Card>

            {auditLogs.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Audit Trail ({auditLogs.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-start gap-3 py-2 border-b last:border-0"
                        data-testid={`audit-log-${log.id}`}
                      >
                        <div className={`h-2 w-2 rounded-full mt-1.5 flex-shrink-0 ${
                          log.status === "success" ? "bg-green-500" :
                          log.status === "failed" ? "bg-red-500" : "bg-yellow-500"
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium">{log.eventType}</span>
                            {log.step && (
                              <span className="text-xs text-muted-foreground">→ {log.step}</span>
                            )}
                            <Badge variant={log.status === "success" ? "default" : "destructive"} className="text-xs py-0">
                              {log.status}
                            </Badge>
                          </div>
                          {log.details && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.details}</p>
                          )}
                          <p className="text-xs text-muted-foreground/70 mt-0.5">
                            {new Date(log.createdAt).toLocaleString()} · by {log.triggeredBy || "system"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function ProvisioningPage() {
  const { toast } = useToast();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [addTenantOpen, setAddTenantOpen] = useState(false);
  const [newTenantCompanyId, setNewTenantCompanyId] = useState("");
  const [newTenantTemplate, setNewTenantTemplate] = useState("");

  const { data: tenants = [], isLoading } = useQuery<Gate[]>({
    queryKey: ["/api/provisioning/tenants"],
  });

  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ["/api/companies"],
  });

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["/api/provisioning/templates"],
  });

  const initMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/provisioning/tenants/${newTenantCompanyId}/gates`, {
        selectedTemplate: newTenantTemplate || "small_business_payroll_only",
      }),
    onSuccess: () => {
      toast({ title: "Tenant initialized", description: "Provisioning record created." });
      setAddTenantOpen(false);
      setNewTenantCompanyId("");
      setNewTenantTemplate("");
      queryClient.invalidateQueries({ queryKey: ["/api/provisioning/tenants"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to initialize tenant", variant: "destructive" }),
  });

  const existingCompanyIds = new Set(tenants.map((t) => t.companyId));
  const availableCompanies = (companies as any[]).filter((c: any) => !existingCompanyIds.has(c.id));

  const allGatesPassed = (gate: Gate) =>
    gate.agreementStatus === "signed" &&
    gate.implementationFeeStatus === "paid" &&
    gate.subscriptionStatus === "active" &&
    gate.paymentMethodStatus === "verified";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="heading-provisioning">
            Tenant Provisioning
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Monitor commercial gate status and manage implementation progress for all tenants.
          </p>
        </div>
        <Button onClick={() => setAddTenantOpen(true)} data-testid="button-add-tenant">
          + Add Tenant
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{tenants.length}</div>
            <div className="text-sm text-muted-foreground">Total Tenants</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600">
              {tenants.filter((t) => t.lifecycleState === "active").length}
            </div>
            <div className="text-sm text-muted-foreground">Active</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-yellow-600">
              {tenants.filter((t) => t.lifecycleState === "pending_activation").length}
            </div>
            <div className="text-sm text-muted-foreground">Pending Activation</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : tenants.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="empty-provisioning">
              <Building2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>No tenants provisioned yet.</p>
              <p className="text-sm mt-1">Click "Add Tenant" to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        <FileText className="h-3.5 w-3.5" />
                        Agreement
                      </div>
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        <CreditCard className="h-3.5 w-3.5" />
                        Impl. Fee
                      </div>
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        <Zap className="h-3.5 w-3.5" />
                        Subscription
                      </div>
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        <Shield className="h-3.5 w-3.5" />
                        Payment Method
                      </div>
                    </TableHead>
                    <TableHead>Lifecycle State</TableHead>
                    <TableHead>Template</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map((gate) => (
                    <TableRow
                      key={gate.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedCompanyId(gate.companyId)}
                      data-testid={`row-tenant-${gate.companyId}`}
                    >
                      <TableCell>
                        <div>
                          <div className="font-medium">{gate.company?.name || gate.companyId}</div>
                          {gate.company?.email && (
                            <div className="text-xs text-muted-foreground">{gate.company.email}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {gate.agreementStatus === "signed" ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-400" />
                          )}
                          <span className="text-xs capitalize">{gate.agreementStatus}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {gate.implementationFeeStatus === "paid" ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-400" />
                          )}
                          <span className="text-xs capitalize">{gate.implementationFeeStatus}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {gate.subscriptionStatus === "active" ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-400" />
                          )}
                          <span className="text-xs capitalize">{gate.subscriptionStatus}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {gate.paymentMethodStatus === "verified" ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-400" />
                          )}
                          <span className="text-xs capitalize">{gate.paymentMethodStatus}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <LifecycleBadge state={gate.lifecycleState} />
                      </TableCell>
                      <TableCell>
                        {gate.selectedTemplate ? (
                          <span className="text-xs text-muted-foreground">
                            {templates.find((t) => t.key === gate.selectedTemplate)?.name || gate.selectedTemplate}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">Not set</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ProvisioningDetailDrawer
        companyId={selectedCompanyId}
        open={!!selectedCompanyId}
        onClose={() => setSelectedCompanyId(null)}
      />

      <Dialog open={addTenantOpen} onOpenChange={setAddTenantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Initialize Tenant Provisioning</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Company</label>
              <Select value={newTenantCompanyId} onValueChange={setNewTenantCompanyId}>
                <SelectTrigger data-testid="select-new-tenant-company" className="mt-1">
                  <SelectValue placeholder="Select company..." />
                </SelectTrigger>
                <SelectContent>
                  {availableCompanies.map((c: any) => (
                    <SelectItem key={c.id} value={c.id} data-testid={`option-company-${c.id}`}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Implementation Template</label>
              <Select value={newTenantTemplate} onValueChange={setNewTenantTemplate}>
                <SelectTrigger data-testid="select-new-tenant-template" className="mt-1">
                  <SelectValue placeholder="Select template..." />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.key} value={t.key} data-testid={`option-template-${t.key}`}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => initMutation.mutate()}
              disabled={!newTenantCompanyId || initMutation.isPending}
              className="w-full"
              data-testid="button-init-tenant"
            >
              {initMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Initialize Provisioning
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
