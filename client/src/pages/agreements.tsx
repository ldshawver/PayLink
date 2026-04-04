import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText, Plus, Pencil, Trash2, Eye, CheckCircle2, Clock, XCircle,
  AlertTriangle, Download, Search, ChevronDown, ChevronRight
} from "lucide-react";

type AgreementTemplate = {
  id: string;
  templateKey: string;
  templateName: string;
  workerType: string;
  version: number;
  status: string;
  isDefault: boolean;
  htmlBody: string | null;
  description: string | null;
  companyId: string | null;
  createdAt: string;
  updatedAt: string;
};

type WorkerAgreement = {
  id: string;
  companyId: string;
  workerId: string;
  templateId: string | null;
  onboardingId: string | null;
  status: string;
  signedAt: string | null;
  signedByName: string | null;
  createdAt: string;
};

function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    active: { label: "Active", variant: "default" },
    draft: { label: "Draft", variant: "secondary" },
    archived: { label: "Archived", variant: "outline" },
    signed: { label: "Signed", variant: "default" },
    pending: { label: "Pending", variant: "secondary" },
    voided: { label: "Voided", variant: "destructive" },
  };
  const s = map[status] || { label: status, variant: "outline" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export default function AgreementsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const companyId = user?.companyId;
  const isAdmin = user?.role === "admin" || user?.role === "manager";

  const [tab, setTab] = useState("templates");
  const [searchTmpl, setSearchTmpl] = useState("");
  const [searchAgreement, setSearchAgreement] = useState("");
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [editTemplate, setEditTemplate] = useState<AgreementTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<AgreementTemplate | null>(null);
  const [deleteTemplate, setDeleteTemplate] = useState<AgreementTemplate | null>(null);
  const [showAgreementDetail, setShowAgreementDetail] = useState<WorkerAgreement | null>(null);

  // Template form state
  const [tmplForm, setTmplForm] = useState({
    templateKey: "", templateName: "", workerType: "contractor", description: "", htmlBody: "", status: "draft",
  });

  const { data: templates = [] } = useQuery<AgreementTemplate[]>({
    queryKey: ["/api/agreement-templates", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/agreement-templates${companyId ? `?companyId=${companyId}` : ""}`);
      return res.json();
    },
    enabled: !!user,
  });

  const { data: workerAgreements = [] } = useQuery<WorkerAgreement[]>({
    queryKey: ["/api/worker-agreements", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const res = await fetch(`/api/worker-agreements?companyId=${companyId}`);
      return res.json();
    },
    enabled: !!companyId,
  });

  const createTemplate = useMutation({
    mutationFn: (data: typeof tmplForm) => apiRequest("POST", "/api/agreement-templates", { ...data, version: 1, companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agreement-templates"] });
      setShowCreateTemplate(false);
      resetTmplForm();
      toast({ title: "Template created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateTemplate = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AgreementTemplate> }) =>
      apiRequest("PATCH", `/api/agreement-templates/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agreement-templates"] });
      setEditTemplate(null);
      toast({ title: "Template updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteTemplateMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/agreement-templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agreement-templates"] });
      setDeleteTemplate(null);
      toast({ title: "Template deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function resetTmplForm() {
    setTmplForm({ templateKey: "", templateName: "", workerType: "contractor", description: "", htmlBody: "", status: "draft" });
  }

  function openEdit(t: AgreementTemplate) {
    setTmplForm({
      templateKey: t.templateKey,
      templateName: t.templateName,
      workerType: t.workerType,
      description: t.description || "",
      htmlBody: t.htmlBody || "",
      status: t.status,
    });
    setEditTemplate(t);
  }

  const filteredTemplates = templates.filter(t =>
    t.templateName.toLowerCase().includes(searchTmpl.toLowerCase()) ||
    t.templateKey.toLowerCase().includes(searchTmpl.toLowerCase())
  );
  const filteredAgreements = workerAgreements.filter(a =>
    a.signedByName?.toLowerCase().includes(searchAgreement.toLowerCase()) ||
    a.status.toLowerCase().includes(searchAgreement.toLowerCase())
  );

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Agreements</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage agreement templates and signed worker agreements</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="templates" data-testid="tab-templates">Templates ({templates.length})</TabsTrigger>
          <TabsTrigger value="agreements" data-testid="tab-agreements">Signed Agreements ({workerAgreements.length})</TabsTrigger>
        </TabsList>

        {/* ── TEMPLATES TAB ─────────────────────────────────────────── */}
        <TabsContent value="templates" className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                data-testid="input-search-templates"
                placeholder="Search templates…"
                value={searchTmpl}
                onChange={e => setSearchTmpl(e.target.value)}
                className="pl-9"
              />
            </div>
            {isAdmin && (
              <Button data-testid="button-create-template" onClick={() => { resetTmplForm(); setShowCreateTemplate(true); }}>
                <Plus className="h-4 w-4 mr-2" /> New Template
              </Button>
            )}
          </div>

          <div className="grid gap-4">
            {filteredTemplates.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  No agreement templates found.
                </CardContent>
              </Card>
            )}
            {filteredTemplates.map(t => (
              <Card key={t.id} data-testid={`card-template-${t.id}`} className="border border-border">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <CardTitle className="text-base font-semibold">{t.templateName}</CardTitle>
                      <CardDescription className="text-xs">
                        Key: <code className="bg-muted px-1 rounded text-xs">{t.templateKey}</code>
                        {" · "}Version {t.version}
                        {" · "}<span className="capitalize">{t.workerType}</span>
                        {t.isDefault && <span className="ml-2 text-primary font-medium">★ Default</span>}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {statusBadge(t.status)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {t.description && <p className="text-sm text-muted-foreground mb-3">{t.description}</p>}
                  <div className="flex gap-2 mt-2">
                    <Button size="sm" variant="outline" data-testid={`button-preview-template-${t.id}`} onClick={() => setPreviewTemplate(t)}>
                      <Eye className="h-3.5 w-3.5 mr-1" /> Preview
                    </Button>
                    {isAdmin && (
                      <>
                        <Button size="sm" variant="outline" data-testid={`button-edit-template-${t.id}`} onClick={() => openEdit(t)}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                        </Button>
                        {!t.isDefault && (
                          <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10"
                            data-testid={`button-delete-template-${t.id}`} onClick={() => setDeleteTemplate(t)}>
                            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ── SIGNED AGREEMENTS TAB ─────────────────────────────────── */}
        <TabsContent value="agreements" className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                data-testid="input-search-agreements"
                placeholder="Search agreements…"
                value={searchAgreement}
                onChange={e => setSearchAgreement(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-3">
            {filteredAgreements.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  No signed agreements yet.
                </CardContent>
              </Card>
            )}
            {filteredAgreements.map(a => (
              <Card key={a.id} data-testid={`card-agreement-${a.id}`} className="border border-border">
                <CardContent className="py-4 flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <div className="font-medium text-sm">{a.signedByName || "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      Worker ID: {a.workerId} · {a.signedAt ? new Date(a.signedAt).toLocaleDateString() : "Pending"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(a.status)}
                    <Button size="sm" variant="outline" data-testid={`button-view-agreement-${a.id}`}
                      onClick={() => setShowAgreementDetail(a)}>
                      <Eye className="h-3.5 w-3.5 mr-1" /> View
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* ── CREATE TEMPLATE DIALOG ─────────────────────────────────── */}
      <Dialog open={showCreateTemplate} onOpenChange={setShowCreateTemplate}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Agreement Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tmpl-name">Template Name *</Label>
                <Input id="tmpl-name" data-testid="input-template-name" value={tmplForm.templateName}
                  onChange={e => setTmplForm(f => ({ ...f, templateName: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tmpl-key">Template Key *</Label>
                <Input id="tmpl-key" data-testid="input-template-key" value={tmplForm.templateKey}
                  onChange={e => setTmplForm(f => ({ ...f, templateKey: e.target.value.replace(/\s/g, "_").toLowerCase() }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Worker Type</Label>
                <Select value={tmplForm.workerType} onValueChange={v => setTmplForm(f => ({ ...f, workerType: v }))}>
                  <SelectTrigger data-testid="select-worker-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contractor">Contractor</SelectItem>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={tmplForm.status} onValueChange={v => setTmplForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tmpl-desc">Description</Label>
              <Input id="tmpl-desc" data-testid="input-template-description" value={tmplForm.description}
                onChange={e => setTmplForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tmpl-body">HTML Body</Label>
              <Textarea id="tmpl-body" data-testid="input-template-body" className="font-mono text-xs h-48"
                value={tmplForm.htmlBody}
                onChange={e => setTmplForm(f => ({ ...f, htmlBody: e.target.value }))}
                placeholder="Use {{merge_field}} placeholders, e.g. {{contractor_legal_name}}" />
              <p className="text-xs text-muted-foreground">
                Supports merge fields: {"{{"} contractor_legal_name {"}}"}, {"{{"} company_name {"}}"}, {"{{"} effective_date {"}}"}, etc.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateTemplate(false)}>Cancel</Button>
            <Button data-testid="button-submit-create-template" onClick={() => createTemplate.mutate(tmplForm)}
              disabled={createTemplate.isPending || !tmplForm.templateName || !tmplForm.templateKey}>
              {createTemplate.isPending ? "Creating…" : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── EDIT TEMPLATE DIALOG ───────────────────────────────────── */}
      <Dialog open={!!editTemplate} onOpenChange={open => !open && setEditTemplate(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Template — {editTemplate?.templateName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Template Name</Label>
                <Input data-testid="input-edit-template-name" value={tmplForm.templateName}
                  onChange={e => setTmplForm(f => ({ ...f, templateName: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={tmplForm.status} onValueChange={v => setTmplForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input data-testid="input-edit-description" value={tmplForm.description}
                onChange={e => setTmplForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>HTML Body</Label>
              <Textarea data-testid="input-edit-body" className="font-mono text-xs h-64"
                value={tmplForm.htmlBody}
                onChange={e => setTmplForm(f => ({ ...f, htmlBody: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTemplate(null)}>Cancel</Button>
            <Button data-testid="button-submit-edit-template"
              onClick={() => editTemplate && updateTemplate.mutate({ id: editTemplate.id, data: tmplForm })}
              disabled={updateTemplate.isPending}>
              {updateTemplate.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── PREVIEW TEMPLATE DIALOG ────────────────────────────────── */}
      <Dialog open={!!previewTemplate} onOpenChange={open => !open && setPreviewTemplate(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Preview — {previewTemplate?.templateName}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[60vh] border rounded p-4">
            {previewTemplate?.htmlBody ? (
              <div dangerouslySetInnerHTML={{ __html: previewTemplate.htmlBody }} />
            ) : (
              <p className="text-muted-foreground text-center py-8">No HTML content in this template.</p>
            )}
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewTemplate(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DELETE CONFIRM DIALOG ──────────────────────────────────── */}
      <Dialog open={!!deleteTemplate} onOpenChange={open => !open && setDeleteTemplate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Template
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{deleteTemplate?.templateName}</strong>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTemplate(null)}>Cancel</Button>
            <Button variant="destructive" data-testid="button-confirm-delete"
              onClick={() => deleteTemplate && deleteTemplateMut.mutate(deleteTemplate.id)}
              disabled={deleteTemplateMut.isPending}>
              {deleteTemplateMut.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── AGREEMENT DETAIL DIALOG ────────────────────────────────── */}
      <Dialog open={!!showAgreementDetail} onOpenChange={open => !open && setShowAgreementDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agreement Detail</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span>{statusBadge(showAgreementDetail?.status || "")}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Signed By</span><span>{showAgreementDetail?.signedByName || "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Signed At</span><span>{showAgreementDetail?.signedAt ? new Date(showAgreementDetail.signedAt).toLocaleString() : "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Worker ID</span><span className="font-mono text-xs">{showAgreementDetail?.workerId}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span>{showAgreementDetail?.createdAt ? new Date(showAgreementDetail.createdAt).toLocaleDateString() : "—"}</span></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAgreementDetail(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
