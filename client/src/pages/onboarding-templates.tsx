import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, Search, Loader2, Edit, Trash2, GripVertical, FileText, BookOpen,
  Link2, ArrowUp, ArrowDown, X
} from "lucide-react";
import type { OnboardingTemplate, TemplateTask, TemplateResource, InsertOnboardingTemplate } from "@/lib/onboarding-types";
import { PRODUCTS } from "@/lib/onboarding-types";

function TemplateEditor({ template, onSave, onCancel }: {
  template?: OnboardingTemplate;
  onSave: (data: InsertOnboardingTemplate) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: template?.name || "",
    product: template?.product || "MyPayLink",
    description: template?.description || "",
  });
  const [tasks, setTasks] = useState<TemplateTask[]>(template?.tasks || []);
  const [resources, setResources] = useState<TemplateResource[]>(template?.trainingResources || []);
  const [docLinks, setDocLinks] = useState<TemplateResource[]>(template?.documentLinks || []);

  const addTask = () => {
    setTasks([...tasks, { title: "", description: "", category: "setup", order: tasks.length + 1 }]);
  };

  const updateTask = (index: number, field: keyof TemplateTask, value: string | number) => {
    const updated = [...tasks];
    updated[index] = { ...updated[index], [field]: value };
    setTasks(updated);
  };

  const removeTask = (index: number) => {
    const updated = tasks.filter((_, i) => i !== index).map((t, i) => ({ ...t, order: i + 1 }));
    setTasks(updated);
  };

  const moveTask = (index: number, direction: "up" | "down") => {
    if ((direction === "up" && index === 0) || (direction === "down" && index === tasks.length - 1)) return;
    const updated = [...tasks];
    const swapIdx = direction === "up" ? index - 1 : index + 1;
    [updated[index], updated[swapIdx]] = [updated[swapIdx], updated[index]];
    setTasks(updated.map((t, i) => ({ ...t, order: i + 1 })));
  };

  const addResource = () => {
    setResources([...resources, { title: "", url: "", type: "training" }]);
  };

  const updateResource = (index: number, field: keyof TemplateResource, value: string) => {
    const updated = [...resources];
    updated[index] = { ...updated[index], [field]: value };
    setResources(updated);
  };

  const removeResource = (index: number) => {
    setResources(resources.filter((_, i) => i !== index));
  };

  const addDocLink = () => {
    setDocLinks([...docLinks, { title: "", url: "", type: "document" }]);
  };

  const updateDocLink = (index: number, field: keyof TemplateResource, value: string) => {
    const updated = [...docLinks];
    updated[index] = { ...updated[index], [field]: value };
    setDocLinks(updated);
  };

  const removeDocLink = (index: number) => {
    setDocLinks(docLinks.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
      <div className="space-y-4">
        <div>
          <Label>Template Name *</Label>
          <Input data-testid="input-template-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Product</Label>
            <Select value={form.product} onValueChange={v => setForm({ ...form, product: v })}>
              <SelectTrigger data-testid="select-template-product">
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
            <Label>Description</Label>
            <Input data-testid="input-template-description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-base font-semibold">Tasks</Label>
          <Button variant="outline" size="sm" onClick={addTask} data-testid="button-add-template-task">
            <Plus className="h-3 w-3 mr-1" /> Add Task
          </Button>
        </div>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No tasks yet. Add your first task.</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((task, index) => (
              <Card key={index} data-testid={`template-task-${index}`}>
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col gap-0.5 mt-1">
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => moveTask(index, "up")}
                        disabled={index === 0} data-testid={`button-task-up-${index}`}>
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => moveTask(index, "down")}
                        disabled={index === tasks.length - 1} data-testid={`button-task-down-${index}`}>
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex-1 space-y-2">
                      <Input
                        placeholder="Task title"
                        value={task.title}
                        onChange={e => updateTask(index, "title", e.target.value)}
                        data-testid={`input-task-title-${index}`}
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Input
                          placeholder="Description"
                          value={task.description}
                          onChange={e => updateTask(index, "description", e.target.value)}
                          data-testid={`input-task-desc-${index}`}
                        />
                        <Select value={task.category} onValueChange={v => updateTask(index, "category", v)}>
                          <SelectTrigger data-testid={`select-task-category-${index}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="setup">Setup</SelectItem>
                            <SelectItem value="training">Training</SelectItem>
                            <SelectItem value="configuration">Configuration</SelectItem>
                            <SelectItem value="verification">Verification</SelectItem>
                            <SelectItem value="go_live">Go Live</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-500" onClick={() => removeTask(index)}
                      data-testid={`button-remove-task-${index}`}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-base font-semibold">Training Resources</Label>
          <Button variant="outline" size="sm" onClick={addResource} data-testid="button-add-resource">
            <Plus className="h-3 w-3 mr-1" /> Add Resource
          </Button>
        </div>
        {resources.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2 text-center">No training resources yet.</p>
        ) : (
          <div className="space-y-2">
            {resources.map((res, index) => (
              <div key={index} className="flex items-center gap-2" data-testid={`resource-${index}`}>
                <Input placeholder="Title" value={res.title} onChange={e => updateResource(index, "title", e.target.value)}
                  className="flex-1" data-testid={`input-resource-title-${index}`} />
                <Input placeholder="URL" value={res.url} onChange={e => updateResource(index, "url", e.target.value)}
                  className="flex-1" data-testid={`input-resource-url-${index}`} />
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-500" onClick={() => removeResource(index)}
                  data-testid={`button-remove-resource-${index}`}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-base font-semibold">Document Links</Label>
          <Button variant="outline" size="sm" onClick={addDocLink} data-testid="button-add-doc-link">
            <Plus className="h-3 w-3 mr-1" /> Add Link
          </Button>
        </div>
        {docLinks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2 text-center">No document links yet.</p>
        ) : (
          <div className="space-y-2">
            {docLinks.map((doc, index) => (
              <div key={index} className="flex items-center gap-2" data-testid={`doc-link-${index}`}>
                <Input placeholder="Title" value={doc.title} onChange={e => updateDocLink(index, "title", e.target.value)}
                  className="flex-1" data-testid={`input-doc-title-${index}`} />
                <Input placeholder="URL" value={doc.url} onChange={e => updateDocLink(index, "url", e.target.value)}
                  className="flex-1" data-testid={`input-doc-url-${index}`} />
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-500" onClick={() => removeDocLink(index)}
                  data-testid={`button-remove-doc-${index}`}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <DialogFooter className="sticky bottom-0 bg-background pt-4 border-t">
        <Button variant="outline" onClick={onCancel} data-testid="button-cancel-template">Cancel</Button>
        <Button
          onClick={() => onSave({ ...form, tasks, trainingResources: resources, documentLinks: docLinks })}
          disabled={!form.name}
          data-testid="button-save-template"
        >
          {template ? "Update" : "Create"} Template
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function OnboardingTemplatesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OnboardingTemplate | undefined>();

  const companyId = user?.companyId;

  const { data: templates = [], isLoading } = useQuery<OnboardingTemplate[]>({
    queryKey: [`/api/onboarding-templates?companyId=${companyId}`],
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertOnboardingTemplate) => apiRequest("POST", "/api/onboarding-templates", { ...data, companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith?.("/api/onboarding-templates") });
      toast({ title: "Template created" });
      setDialogOpen(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: InsertOnboardingTemplate }) => apiRequest("PATCH", `/api/onboarding-templates/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith?.("/api/onboarding-templates") });
      toast({ title: "Template updated" });
      setDialogOpen(false);
      setEditing(undefined);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/onboarding-templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith?.("/api/onboarding-templates") });
      toast({ title: "Template deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = templates.filter(t => {
    return !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.product.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Onboarding Templates</h1>
          <p className="text-muted-foreground">Create reusable onboarding templates for products</p>
        </div>
        <Button className="w-full sm:w-auto" onClick={() => { setEditing(undefined); setDialogOpen(true); }} data-testid="button-add-template">
          <Plus className="h-4 w-4 mr-2" /> New Template
        </Button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search templates..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-10" data-testid="input-search-templates" />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">No templates found</p>
            <Button variant="outline" className="mt-4" onClick={() => { setEditing(undefined); setDialogOpen(true); }}
              data-testid="button-add-first-template">
              <Plus className="h-4 w-4 mr-2" /> Create your first template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map(template => (
            <Card key={template.id} className="hover:shadow-md transition-shadow" data-testid={`card-template-${template.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base" data-testid={`text-template-name-${template.id}`}>{template.name}</CardTitle>
                    <Badge variant="outline" className="mt-1">{template.product}</Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(template); setDialogOpen(true); }}
                      data-testid={`button-edit-template-${template.id}`}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => {
                      if (confirm("Delete this template?")) deleteMutation.mutate(template.id);
                    }} data-testid={`button-delete-template-${template.id}`}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {template.description && (
                  <p className="text-sm text-muted-foreground mb-3">{template.description}</p>
                )}
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" /> {template.tasks.length} tasks
                  </span>
                  <span className="flex items-center gap-1">
                    <BookOpen className="h-3.5 w-3.5" /> {template.trainingResources.length} resources
                  </span>
                  <span className="flex items-center gap-1">
                    <Link2 className="h-3.5 w-3.5" /> {template.documentLinks.length} docs
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Template" : "New Onboarding Template"}</DialogTitle>
          </DialogHeader>
          <TemplateEditor
            template={editing}
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
