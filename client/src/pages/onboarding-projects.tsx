import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, Search, Loader2, ArrowLeft, User, Calendar, CheckCircle2, Clock,
  FileText, ExternalLink, Mail, Phone, MessageSquare, Activity,
  ClipboardList, Link2
} from "lucide-react";
import type {
  OnboardingProject, OnboardingProjectStatus,
  OnboardingTask, EngagementEvent, OnboardingTemplate
} from "@/lib/onboarding-types";
import { PROJECT_STATUSES, PRODUCTS, EVENT_TYPES } from "@/lib/onboarding-types";
import type { Customer } from "@shared/schema";

interface ProjectFormData {
  customerId: string;
  title: string;
  product: string;
  status: OnboardingProjectStatus;
  assignedTo: string;
  startDate: string;
  targetDate: string;
}

function ProjectForm({ project, customers, onSave, onCancel }: {
  project?: OnboardingProject;
  customers: Customer[];
  onSave: (data: ProjectFormData) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    customerId: project?.customerId?.toString() || "",
    title: project?.title || "",
    product: project?.product || "MyPayLink",
    status: project?.status || "not_started" as OnboardingProjectStatus,
    assignedTo: project?.assignedTo || "",
    startDate: project?.startDate || "",
    targetDate: project?.targetDate || "",
  });

  return (
    <div className="space-y-4">
      <div>
        <Label>Customer *</Label>
        <Select value={form.customerId} onValueChange={v => setForm({ ...form, customerId: v })}>
          <SelectTrigger data-testid="select-project-customer">
            <SelectValue placeholder="Select customer" />
          </SelectTrigger>
          <SelectContent>
            {customers.map(c => (
              <SelectItem key={c.id} value={c.id.toString()}>{c.customerName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Project Title *</Label>
        <Input data-testid="input-project-title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Product</Label>
          <Select value={form.product} onValueChange={v => setForm({ ...form, product: v })}>
            <SelectTrigger data-testid="select-project-product">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRODUCTS.map(p => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <Select value={form.status} onValueChange={v => setForm({ ...form, status: v as OnboardingProjectStatus })}>
            <SelectTrigger data-testid="select-project-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROJECT_STATUSES.map(s => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Assigned To</Label>
        <Input data-testid="input-project-assigned" value={form.assignedTo} onChange={e => setForm({ ...form, assignedTo: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Start Date</Label>
          <Input data-testid="input-project-start" type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
        </div>
        <div>
          <Label>Target Date</Label>
          <Input data-testid="input-project-target" type="date" value={form.targetDate} onChange={e => setForm({ ...form, targetDate: e.target.value })} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} data-testid="button-cancel-project">Cancel</Button>
        <Button
          onClick={() => onSave({ ...form, customerId: form.customerId })}
          disabled={!form.title || !form.customerId}
          data-testid="button-save-project"
        >
          {project ? "Update" : "Create"} Project
        </Button>
      </DialogFooter>
    </div>
  );
}

function ProjectDetailView({ projectId, onBack }: { projectId: number; onBack: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const companyId = user?.companyId;

  const { data: project, isLoading: loadingProject } = useQuery<OnboardingProject>({
    queryKey: [`/api/onboarding-projects/${projectId}`],
    enabled: !!projectId,
  });

  const { data: tasks = [], isLoading: loadingTasks } = useQuery<OnboardingTask[]>({
    queryKey: [`/api/onboarding-tasks?projectId=${projectId}`],
    enabled: !!projectId,
  });

  const { data: events = [] } = useQuery<EngagementEvent[]>({
    queryKey: [`/api/engagement-events?projectId=${projectId}`],
    enabled: !!projectId,
  });

  const { data: template } = useQuery<OnboardingTemplate>({
    queryKey: [`/api/onboarding-templates/${project?.templateId}`],
    enabled: !!project?.templateId,
  });

  const toggleTaskMutation = useMutation({
    mutationFn: ({ id, completed }: { id: number; completed: boolean }) =>
      apiRequest("PATCH", `/api/onboarding-tasks/${id}`, { completed }),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith?.("/api/onboarding-tasks") });
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith?.("/api/onboarding-projects") });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) => apiRequest("PATCH", `/api/onboarding-projects/${projectId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith?.("/api/onboarding-projects") });
      toast({ title: "Status updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (loadingProject || loadingTasks) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={onBack} data-testid="button-back-projects">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Projects
        </Button>
        <p className="mt-4 text-muted-foreground">Project not found.</p>
      </div>
    );
  }

  const statusInfo = PROJECT_STATUSES.find(s => s.value === project.status);
  const completedTasks = tasks.filter(t => t.completed).length;
  const progress = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0;

  const getEventIcon = (type: string) => {
    switch (type) {
      case "email": return <Mail className="h-4 w-4" />;
      case "call": return <Phone className="h-4 w-4" />;
      case "meeting": return <MessageSquare className="h-4 w-4" />;
      case "task_completed": return <CheckCircle2 className="h-4 w-4" />;
      case "document_signed": return <FileText className="h-4 w-4" />;
      default: return <Activity className="h-4 w-4" />;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={onBack} data-testid="button-back-projects">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold" data-testid="text-project-title">{project.title}</h1>
          <p className="text-muted-foreground">{project.customerName} • {project.product}</p>
        </div>
        <Select value={project.status} onValueChange={v => updateStatusMutation.mutate(v)}>
          <SelectTrigger className="w-40" data-testid="select-update-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROJECT_STATUSES.map(s => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Status</div>
            <Badge className={statusInfo?.color} data-testid="badge-project-status">{statusInfo?.label}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Progress</div>
            <div className="flex items-center gap-2 mt-1">
              <Progress value={progress} className="flex-1" data-testid="progress-bar" />
              <span className="text-sm font-medium" data-testid="text-progress">{progress}%</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Assigned To</div>
            <div className="flex items-center gap-1 mt-1">
              <User className="h-4 w-4" />
              <span className="text-sm font-medium" data-testid="text-assigned">{project.assignedTo || "Unassigned"}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Target Date</div>
            <div className="flex items-center gap-1 mt-1">
              <Calendar className="h-4 w-4" />
              <span className="text-sm font-medium" data-testid="text-target-date">{project.targetDate || "Not set"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="tasks">
        <TabsList data-testid="tabs-project-detail">
          <TabsTrigger value="tasks" data-testid="tab-tasks">Tasks ({tasks.length})</TabsTrigger>
          <TabsTrigger value="resources" data-testid="tab-resources">Resources</TabsTrigger>
          <TabsTrigger value="timeline" data-testid="tab-timeline">Timeline ({events.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="space-y-2 mt-4">
          {tasks.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <ClipboardList className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-muted-foreground">No tasks yet</p>
              </CardContent>
            </Card>
          ) : (
            tasks.sort((a, b) => a.order - b.order).map(task => (
              <Card key={task.id} data-testid={`card-task-${task.id}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  <Checkbox
                    checked={task.completed}
                    onCheckedChange={(checked) => toggleTaskMutation.mutate({ id: task.id, completed: !!checked })}
                    data-testid={`checkbox-task-${task.id}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${task.completed ? "line-through text-muted-foreground" : ""}`}
                      data-testid={`text-task-title-${task.id}`}>
                      {task.title}
                    </p>
                    {task.description && (
                      <p className="text-xs text-muted-foreground truncate">{task.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {task.category && <Badge variant="outline" className="text-xs">{task.category}</Badge>}
                    {task.dueDate && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />{task.dueDate}
                      </span>
                    )}
                    {task.completed && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="resources" className="mt-4 space-y-6">
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4" /> Training Resources
            </h3>
            {template?.trainingResources && template.trainingResources.length > 0 ? (
              <div className="space-y-2">
                {template.trainingResources.map((resource, idx) => (
                  <Card key={idx} data-testid={`card-training-resource-${idx}`}>
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{resource.title}</p>
                        <p className="text-xs text-muted-foreground">{resource.type}</p>
                      </div>
                      <a
                        href={resource.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-1 text-sm shrink-0"
                        data-testid={`link-training-resource-${idx}`}
                      >
                        <ExternalLink className="h-3 w-3" /> Open
                      </a>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-6 text-center">
                  <FileText className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {project?.templateId ? "No training resources in template" : "No template linked to this project"}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Document Links
            </h3>
            {template?.documentLinks && template.documentLinks.length > 0 ? (
              <div className="space-y-2">
                {template.documentLinks.map((doc, idx) => (
                  <Card key={idx} data-testid={`card-document-link-${idx}`}>
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{doc.title}</p>
                        <p className="text-xs text-muted-foreground">{doc.type}</p>
                      </div>
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-1 text-sm shrink-0"
                        data-testid={`link-document-${idx}`}
                      >
                        <ExternalLink className="h-3 w-3" /> Open
                      </a>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-6 text-center">
                  <Link2 className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {project?.templateId ? "No document links in template" : "No template linked to this project"}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          {events.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Activity className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-muted-foreground">No engagement events yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {events.map(event => (
                <Card key={event.id} data-testid={`card-event-${event.id}`}>
                  <CardContent className="p-3 flex items-start gap-3">
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                      {getEventIcon(event.eventType)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" data-testid={`text-event-title-${event.id}`}>{event.title}</p>
                      {event.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {EVENT_TYPES.find(t => t.value === event.eventType)?.label || event.eventType}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(event.createdAt).toLocaleDateString()} {new Date(event.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function OnboardingProjectsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OnboardingProject | undefined>();
  const [viewingId, setViewingId] = useState<number | null>(null);

  const companyId = user?.companyId;

  const { data: projects = [], isLoading } = useQuery<OnboardingProject[]>({
    queryKey: [`/api/onboarding-projects?companyId=${companyId}`],
    enabled: !!companyId,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: [`/api/customers?companyId=${companyId}`],
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: (data: ProjectFormData) => apiRequest("POST", "/api/onboarding-projects", { ...data, companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith?.("/api/onboarding-projects") });
      toast({ title: "Project created" });
      setDialogOpen(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ProjectFormData> }) => apiRequest("PATCH", `/api/onboarding-projects/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith?.("/api/onboarding-projects") });
      toast({ title: "Project updated" });
      setDialogOpen(false);
      setEditing(undefined);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (viewingId !== null) {
    return <ProjectDetailView projectId={viewingId} onBack={() => setViewingId(null)} />;
  }

  const filtered = projects.filter(p => {
    const matchesSearch = !search || p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.customerName.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || p.status === statusFilter;
    const matchesProduct = productFilter === "all" || p.product === productFilter;
    return matchesSearch && matchesStatus && matchesProduct;
  });

  const stats = {
    total: projects.length,
    inProgress: projects.filter(p => p.status === "in_progress").length,
    completed: projects.filter(p => p.status === "completed").length,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Onboarding Projects</h1>
          <p className="text-muted-foreground">Manage customer onboarding projects</p>
        </div>
        <Button onClick={() => { setEditing(undefined); setDialogOpen(true); }} data-testid="button-add-project">
          <Plus className="h-4 w-4 mr-2" /> New Project
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <ClipboardList className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-total-projects">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total Projects</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-in-progress">{stats.inProgress}</div>
              <div className="text-xs text-muted-foreground">In Progress</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-completed-projects">{stats.completed}</div>
              <div className="text-xs text-muted-foreground">Completed</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search projects..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-10" data-testid="input-search-projects" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" data-testid="select-filter-status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {PROJECT_STATUSES.map(s => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={productFilter} onValueChange={setProductFilter}>
          <SelectTrigger className="w-40" data-testid="select-filter-product">
            <SelectValue placeholder="All products" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Products</SelectItem>
            {PRODUCTS.map(p => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">No onboarding projects found</p>
            <Button variant="outline" className="mt-4" onClick={() => { setEditing(undefined); setDialogOpen(true); }}
              data-testid="button-add-first-project">
              <Plus className="h-4 w-4 mr-2" /> Create your first project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map(project => {
            const statusInfo = PROJECT_STATUSES.find(s => s.value === project.status);
            return (
              <Card
                key={project.id}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => setViewingId(project.id)}
                data-testid={`card-project-${project.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="h-10 w-10 rounded-full bg-gradient-to-br from-teal-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
                        {project.title.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold truncate" data-testid={`text-project-name-${project.id}`}>{project.title}</span>
                          <Badge className={statusInfo?.color} data-testid={`badge-project-status-${project.id}`}>
                            {statusInfo?.label}
                          </Badge>
                          <Badge variant="outline">{project.product}</Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                          <span>{project.customerName}</span>
                          {project.assignedTo && (
                            <span className="flex items-center gap-1"><User className="h-3 w-3" /> {project.assignedTo}</span>
                          )}
                          {project.targetDate && (
                            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {project.targetDate}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="w-24">
                        <Progress value={project.progress} className="h-2" data-testid={`progress-project-${project.id}`} />
                        <span className="text-xs text-muted-foreground">{project.progress}%</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Project" : "New Onboarding Project"}</DialogTitle>
          </DialogHeader>
          <ProjectForm
            project={editing}
            customers={customers}
            onSave={data => {
              if (editing) {
                updateMutation.mutate({ id: editing.id, data });
              } else {
                createMutation.mutate(data);
              }
            }}
            onCancel={() => { setDialogOpen(false); setEditing(undefined); }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
