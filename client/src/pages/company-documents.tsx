import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch } from "wouter";
import {
  FolderOpen, FileText, Upload, Search, Plus, Trash2, Edit, Eye, Download,
  Shield, Clock, Filter, MoreVertical, ChevronRight, Tag, Lock, AlertTriangle,
  CheckCircle, XCircle, Users, FileUp, History, Activity, Settings, Archive,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  Document, DocumentFolder, DocumentVersion, DocumentAuditLog,
  DocumentRetentionPolicy, OnboardingPacket, OnboardingPacketStep,
  InvoiceApprovalWorkflow, Worker,
} from "@shared/schema";

const COLLECTIONS = [
  { key: "HR", label: "HR", color: "bg-blue-500", icon: Users },
  { key: "Accounting", label: "Accounting", color: "bg-green-500", icon: FileText },
  { key: "Legal", label: "Legal", color: "bg-purple-500", icon: Shield },
  { key: "Policies", label: "Policies / SOPs", color: "bg-amber-500", icon: FileText },
  { key: "Vendors", label: "Vendors / Contractors", color: "bg-orange-500", icon: Users },
  { key: "Executive", label: "Executive", color: "bg-red-500", icon: Lock },
];

const CLASSIFICATIONS = ["public", "internal", "confidential", "pii_payroll", "audit"];

const DOCUMENT_TYPES = [
  "Offer Letter", "Employment Contract", "W-4", "W-9", "I-9", "Direct Deposit Form",
  "Policy Acknowledgement", "NDA", "Employee Handbook", "Invoice", "Tax Record",
  "Benefits Enrollment", "Performance Review", "Termination Letter", "Vendor Agreement",
  "Board Resolution", "Financial Statement", "SOP", "Training Material", "Other",
];

function classificationBadge(c: string | null) {
  const map: Record<string, { label: string; variant: string }> = {
    public: { label: "Public", variant: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
    internal: { label: "Internal", variant: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
    confidential: { label: "Confidential", variant: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
    pii_payroll: { label: "PII/Payroll", variant: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
    audit: { label: "Audit", variant: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  };
  const info = map[c || "internal"] || map.internal;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${info.variant}`}>{info.label}</span>;
}

function formatDate(d: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(d: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatFileSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

export default function CompanyDocumentsPage() {
  const search = useSearch();
  const activeTab = new URLSearchParams(search).get("tab") || "documents";
  const { user } = useAuth();
  const { toast } = useToast();
  const companyId = user?.companyId;

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Company Document Center</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage company documents, policies, and compliance records</p>
        </div>
      </div>

      <Tabs value={activeTab} className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1" data-testid="tabs-company-docs">
          <TabsTrigger value="documents" onClick={() => window.history.replaceState(null, "", "/company-documents?tab=documents")} data-testid="tab-documents">All Documents</TabsTrigger>
          <TabsTrigger value="collections" onClick={() => window.history.replaceState(null, "", "/company-documents?tab=collections")} data-testid="tab-collections">Collections</TabsTrigger>
          <TabsTrigger value="onboarding" onClick={() => window.history.replaceState(null, "", "/company-documents?tab=onboarding")} data-testid="tab-onboarding">Onboarding</TabsTrigger>
          <TabsTrigger value="invoice-approval" onClick={() => window.history.replaceState(null, "", "/company-documents?tab=invoice-approval")} data-testid="tab-invoice-approval">Invoice Approval</TabsTrigger>
          <TabsTrigger value="retention" onClick={() => window.history.replaceState(null, "", "/company-documents?tab=retention")} data-testid="tab-retention">Retention</TabsTrigger>
          <TabsTrigger value="audit" onClick={() => window.history.replaceState(null, "", "/company-documents?tab=audit")} data-testid="tab-audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="documents"><DocumentsTab companyId={companyId} /></TabsContent>
        <TabsContent value="collections"><CollectionsTab companyId={companyId} /></TabsContent>
        <TabsContent value="onboarding"><OnboardingTab companyId={companyId} /></TabsContent>
        <TabsContent value="invoice-approval"><InvoiceApprovalTab companyId={companyId} /></TabsContent>
        <TabsContent value="retention"><RetentionTab companyId={companyId} userRole={user?.role} /></TabsContent>
        <TabsContent value="audit"><AuditTab companyId={companyId} userRole={user?.role} /></TabsContent>
      </Tabs>
    </div>
  );
}

function DocumentsTab({ companyId }: { companyId?: string }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterClassification, setFilterClassification] = useState("all");
  const [filterDepartment, setFilterDepartment] = useState("all");
  const [showUpload, setShowUpload] = useState(false);
  const [showDetail, setShowDetail] = useState<Document | null>(null);
  const [editDoc, setEditDoc] = useState<Document | null>(null);
  const [uploadForm, setUploadForm] = useState({
    title: "", description: "", category: "HR", classification: "internal",
    documentType: "Other", department: "HR", tags: "", effectiveDate: "",
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { data: documents = [], isLoading } = useQuery<Document[]>({
    queryKey: ["/api/documents", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/documents?companyId=${companyId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!companyId,
  });

  const { data: folders = [] } = useQuery<DocumentFolder[]>({
    queryKey: ["/api/document-folders", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/document-folders?companyId=${companyId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!companyId,
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("No file selected");
      const formData = new FormData();
      formData.append("file", selectedFile);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { url } = await uploadRes.json();
      await apiRequest("POST", "/api/documents", {
        companyId,
        title: uploadForm.title || selectedFile.name,
        description: uploadForm.description,
        fileName: selectedFile.name,
        fileUrl: url,
        fileSize: selectedFile.size,
        mimeType: selectedFile.type,
        category: uploadForm.category,
        classification: uploadForm.classification,
        documentType: uploadForm.documentType,
        department: uploadForm.department,
        tags: uploadForm.tags,
        effectiveDate: uploadForm.effectiveDate || null,
        createdBy: user?.username || "",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents", companyId] });
      setShowUpload(false);
      setSelectedFile(null);
      setUploadForm({ title: "", description: "", category: "HR", classification: "internal", documentType: "Other", department: "HR", tags: "", effectiveDate: "" });
      toast({ title: "Document uploaded successfully" });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/documents/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents", companyId] });
      toast({ title: "Document deleted" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Document> }) => {
      await apiRequest("PATCH", `/api/documents/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents", companyId] });
      setEditDoc(null);
      toast({ title: "Document updated" });
    },
  });

  const filtered = documents.filter(d => {
    if (searchQuery && !d.title.toLowerCase().includes(searchQuery.toLowerCase()) && !(d.tags || "").toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterCategory !== "all" && d.category !== filterCategory) return false;
    if (filterClassification !== "all" && d.classification !== filterClassification) return false;
    if (filterDepartment !== "all" && d.department !== filterDepartment) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search documents..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9" data-testid="input-search-docs" />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[160px]" data-testid="select-filter-category"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Collections</SelectItem>
            {COLLECTIONS.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterClassification} onValueChange={setFilterClassification}>
          <SelectTrigger className="w-[160px]" data-testid="select-filter-classification"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classifications</SelectItem>
            {CLASSIFICATIONS.map(c => <SelectItem key={c} value={c}>{c.replace("_", "/").replace(/\b\w/g, l => l.toUpperCase())}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={() => setShowUpload(true)} data-testid="button-upload-doc"><Upload className="h-4 w-4 mr-2" />Upload Document</Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">Loading documents...</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">No documents found</p>
          <p className="text-sm mt-1">Upload your first company document to get started.</p>
        </CardContent></Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="text-left p-3 font-medium">Document</th>
              <th className="text-left p-3 font-medium hidden md:table-cell">Collection</th>
              <th className="text-left p-3 font-medium hidden md:table-cell">Type</th>
              <th className="text-left p-3 font-medium hidden lg:table-cell">Classification</th>
              <th className="text-left p-3 font-medium hidden lg:table-cell">Size</th>
              <th className="text-left p-3 font-medium hidden lg:table-cell">Updated</th>
              <th className="text-right p-3 font-medium">Actions</th>
            </tr></thead>
            <tbody>
              {filtered.map(doc => (
                <tr key={doc.id} className="border-b hover:bg-muted/30 transition-colors" data-testid={`row-document-${doc.id}`}>
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded bg-primary/10 flex items-center justify-center">
                        <FileText className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <button className="font-medium hover:underline text-left" onClick={() => setShowDetail(doc)} data-testid={`link-doc-${doc.id}`}>{doc.title}</button>
                        {doc.tags && <p className="text-xs text-muted-foreground">{doc.tags}</p>}
                      </div>
                      {doc.legalHold && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Legal Hold</Badge>}
                    </div>
                  </td>
                  <td className="p-3 hidden md:table-cell">
                    <Badge variant="secondary" className="text-xs">{doc.category || "—"}</Badge>
                  </td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground">{doc.documentType || "—"}</td>
                  <td className="p-3 hidden lg:table-cell">{classificationBadge(doc.classification)}</td>
                  <td className="p-3 hidden lg:table-cell text-muted-foreground">{formatFileSize(doc.fileSize)}</td>
                  <td className="p-3 hidden lg:table-cell text-muted-foreground">{formatDate(doc.updatedAt)}</td>
                  <td className="p-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" data-testid={`button-doc-menu-${doc.id}`}><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setShowDetail(doc)}><Eye className="h-4 w-4 mr-2" />View Details</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => window.open(doc.fileUrl, "_blank")}><Download className="h-4 w-4 mr-2" />Download</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setEditDoc(doc)}><Edit className="h-4 w-4 mr-2" />Edit Metadata</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => { if (doc.legalHold) { toast({ title: "Cannot delete", description: "Document is on legal hold", variant: "destructive" }); return; } deleteMutation.mutate(doc.id); }}><Trash2 className="h-4 w-4 mr-2" />Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>File</Label>
              <input type="file" ref={fileInputRef} onChange={e => { setSelectedFile(e.target.files?.[0] || null); if (e.target.files?.[0] && !uploadForm.title) setUploadForm(p => ({...p, title: e.target.files![0].name.replace(/\.[^.]+$/, "")})); }} className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 mt-1" data-testid="input-file-upload" />
            </div>
            <div><Label>Title</Label><Input value={uploadForm.title} onChange={e => setUploadForm(p => ({...p, title: e.target.value}))} data-testid="input-doc-title" /></div>
            <div><Label>Description</Label><Textarea value={uploadForm.description} onChange={e => setUploadForm(p => ({...p, description: e.target.value}))} rows={2} data-testid="input-doc-desc" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Collection</Label>
                <Select value={uploadForm.category} onValueChange={v => setUploadForm(p => ({...p, category: v}))}>
                  <SelectTrigger data-testid="select-doc-category"><SelectValue /></SelectTrigger>
                  <SelectContent>{COLLECTIONS.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Classification</Label>
                <Select value={uploadForm.classification} onValueChange={v => setUploadForm(p => ({...p, classification: v}))}>
                  <SelectTrigger data-testid="select-doc-classification"><SelectValue /></SelectTrigger>
                  <SelectContent>{CLASSIFICATIONS.map(c => <SelectItem key={c} value={c}>{c.replace("_", "/").replace(/\b\w/g, l => l.toUpperCase())}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Document Type</Label>
                <Select value={uploadForm.documentType} onValueChange={v => setUploadForm(p => ({...p, documentType: v}))}>
                  <SelectTrigger data-testid="select-doc-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{DOCUMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Department</Label>
                <Select value={uploadForm.department} onValueChange={v => setUploadForm(p => ({...p, department: v}))}>
                  <SelectTrigger data-testid="select-doc-dept"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["HR", "Accounting", "Legal", "Operations", "IT", "Executive", "Sales", "Marketing"].map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Tags (comma separated)</Label><Input value={uploadForm.tags} onChange={e => setUploadForm(p => ({...p, tags: e.target.value}))} placeholder="e.g. onboarding, 2025, compliance" data-testid="input-doc-tags" /></div>
            <div><Label>Effective Date</Label><Input type="date" value={uploadForm.effectiveDate} onChange={e => setUploadForm(p => ({...p, effectiveDate: e.target.value}))} data-testid="input-doc-effective-date" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button onClick={() => uploadMutation.mutate()} disabled={!selectedFile || uploadMutation.isPending} data-testid="button-submit-upload">
              {uploadMutation.isPending ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showDetail && <DocumentDetailDialog doc={showDetail} companyId={companyId!} onClose={() => setShowDetail(null)} />}

      <Dialog open={!!editDoc} onOpenChange={() => setEditDoc(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Document Metadata</DialogTitle></DialogHeader>
          {editDoc && <EditDocForm doc={editDoc} onSave={(data) => updateMutation.mutate({ id: editDoc.id, data })} isPending={updateMutation.isPending} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditDocForm({ doc, onSave, isPending }: { doc: Document; onSave: (d: Partial<Document>) => void; isPending: boolean }) {
  const [form, setForm] = useState({
    title: doc.title, description: doc.description || "", category: doc.category || "HR",
    classification: doc.classification || "internal", documentType: doc.documentType || "Other",
    department: doc.department || "HR", tags: doc.tags || "", legalHold: doc.legalHold || false,
  });
  return (
    <div className="space-y-4">
      <div><Label>Title</Label><Input value={form.title} onChange={e => setForm(p => ({...p, title: e.target.value}))} data-testid="input-edit-title" /></div>
      <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(p => ({...p, description: e.target.value}))} rows={2} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Collection</Label>
          <Select value={form.category} onValueChange={v => setForm(p => ({...p, category: v}))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{COLLECTIONS.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Classification</Label>
          <Select value={form.classification} onValueChange={v => setForm(p => ({...p, classification: v}))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CLASSIFICATIONS.map(c => <SelectItem key={c} value={c}>{c.replace("_", "/").replace(/\b\w/g, l => l.toUpperCase())}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Type</Label>
          <Select value={form.documentType} onValueChange={v => setForm(p => ({...p, documentType: v}))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{DOCUMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Department</Label>
          <Select value={form.department} onValueChange={v => setForm(p => ({...p, department: v}))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["HR", "Accounting", "Legal", "Operations", "IT", "Executive", "Sales", "Marketing"].map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div><Label>Tags</Label><Input value={form.tags} onChange={e => setForm(p => ({...p, tags: e.target.value}))} /></div>
      <div className="flex items-center gap-3">
        <Switch checked={form.legalHold} onCheckedChange={v => setForm(p => ({...p, legalHold: v}))} data-testid="switch-legal-hold" />
        <Label className="flex items-center gap-1"><Lock className="h-3.5 w-3.5" /> Legal Hold</Label>
      </div>
      <DialogFooter>
        <Button onClick={() => onSave(form)} disabled={isPending} data-testid="button-save-edit">{isPending ? "Saving..." : "Save Changes"}</Button>
      </DialogFooter>
    </div>
  );
}

function DocumentDetailDialog({ doc, companyId, onClose }: { doc: Document; companyId: string; onClose: () => void }) {
  const { data: versions = [] } = useQuery<DocumentVersion[]>({
    queryKey: ["/api/document-versions", doc.id],
    queryFn: async () => {
      const res = await fetch(`/api/document-versions?documentId=${doc.id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: auditLogs = [] } = useQuery<DocumentAuditLog[]>({
    queryKey: ["/api/document-audit-logs", doc.id],
    queryFn: async () => {
      const res = await fetch(`/api/document-audit-logs?documentId=${doc.id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [changeNote, setChangeNote] = useState("");

  const uploadVersionMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("changeNote", changeNote);
      const res = await fetch(`/api/documents/${doc.id}/upload`, { method: "POST", body: formData });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Upload failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-versions", doc.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents", companyId] });
      setChangeNote("");
      toast({ title: "New version uploaded" });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />{doc.title}</DialogTitle></DialogHeader>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted-foreground">Collection:</span> <Badge variant="secondary">{doc.category || "—"}</Badge></div>
            <div><span className="text-muted-foreground">Classification:</span> {classificationBadge(doc.classification)}</div>
            <div><span className="text-muted-foreground">Type:</span> {doc.documentType || "—"}</div>
            <div><span className="text-muted-foreground">Department:</span> {doc.department || "—"}</div>
            <div><span className="text-muted-foreground">File:</span> {doc.fileName}</div>
            <div><span className="text-muted-foreground">Size:</span> {formatFileSize(doc.fileSize)}</div>
            <div><span className="text-muted-foreground">Created:</span> {formatDateTime(doc.createdAt)}</div>
            <div><span className="text-muted-foreground">Updated:</span> {formatDateTime(doc.updatedAt)}</div>
            {doc.tags && <div className="col-span-2"><span className="text-muted-foreground">Tags:</span> {doc.tags.split(",").map(t => <Badge key={t} variant="outline" className="mr-1 text-xs">{t.trim()}</Badge>)}</div>}
            {doc.description && <div className="col-span-2"><span className="text-muted-foreground">Description:</span> {doc.description}</div>}
            {doc.legalHold && <div className="col-span-2"><Badge variant="destructive"><Lock className="h-3 w-3 mr-1" />Legal Hold Active</Badge></div>}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => window.open(doc.fileUrl, "_blank")} data-testid="button-download-doc"><Download className="h-4 w-4 mr-1" />Download</Button>
            {doc.mimeType?.startsWith("image/") || doc.mimeType === "application/pdf" ? (
              <Button variant="outline" size="sm" onClick={() => window.open(doc.fileUrl, "_blank")} data-testid="button-preview-doc"><Eye className="h-4 w-4 mr-1" />Preview</Button>
            ) : null}
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><History className="h-4 w-4" />Version History</h3>
            <div className="space-y-1">
              <div className="flex gap-2 mb-2">
                <Input placeholder="Change note..." value={changeNote} onChange={e => setChangeNote(e.target.value)} className="flex-1 text-sm" data-testid="input-change-note" />
                <input type="file" ref={fileInputRef} onChange={e => { if (e.target.files?.[0]) uploadVersionMutation.mutate(e.target.files[0]); }} className="hidden" />
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploadVersionMutation.isPending} data-testid="button-upload-version">
                  <FileUp className="h-4 w-4 mr-1" />{uploadVersionMutation.isPending ? "..." : "Upload New Version"}
                </Button>
              </div>
              {versions.length === 0 ? <p className="text-sm text-muted-foreground">No version history</p> : versions.map(v => (
                <div key={v.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm" data-testid={`row-version-${v.id}`}>
                  <div className="flex items-center gap-2">
                    <Badge variant={v.id === doc.currentVersionId ? "default" : "outline"} className="text-xs">v{v.versionNumber}</Badge>
                    <span>{v.fileName}</span>
                    {v.changeNote && <span className="text-muted-foreground text-xs">- {v.changeNote}</span>}
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <span>{v.uploadedBy}</span>
                    <span>{formatDate(v.createdAt)}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => window.open(v.fileUrl, "_blank")}><Download className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><Activity className="h-4 w-4" />Audit Trail</h3>
            {auditLogs.length === 0 ? <p className="text-sm text-muted-foreground">No audit records</p> : (
              <div className="max-h-48 overflow-y-auto space-y-1">
                {auditLogs.map(log => (
                  <div key={log.id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-xs" data-testid={`row-audit-${log.id}`}>
                    <div><span className="font-medium">{log.action}</span> by {log.actorName || "system"}</div>
                    <span className="text-muted-foreground">{formatDateTime(log.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CollectionsTab({ companyId }: { companyId?: string }) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newFolder, setNewFolder] = useState({ name: "", category: "HR", color: "" });

  const { data: folders = [] } = useQuery<DocumentFolder[]>({
    queryKey: ["/api/document-folders", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/document-folders?companyId=${companyId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!companyId,
  });

  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: ["/api/documents", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/documents?companyId=${companyId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/document-folders", { companyId, ...newFolder });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-folders", companyId] });
      setShowCreate(false);
      setNewFolder({ name: "", category: "HR", color: "" });
      toast({ title: "Collection created" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/document-folders/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-folders", companyId] });
      toast({ title: "Collection deleted" });
    },
  });

  const toggleLegalHold = useMutation({
    mutationFn: async ({ id, legalHold }: { id: string; legalHold: boolean }) => {
      await apiRequest("PATCH", `/api/document-folders/${id}`, { legalHold });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-folders", companyId] });
      toast({ title: "Legal hold updated" });
    },
  });

  const collectionCounts: Record<string, number> = {};
  COLLECTIONS.forEach(c => { collectionCounts[c.key] = documents.filter(d => d.category === c.key).length; });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Document Collections</h2>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-collection"><Plus className="h-4 w-4 mr-2" />New Collection</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {COLLECTIONS.map(col => (
          <Card key={col.key} className="hover:shadow-md transition-shadow" data-testid={`card-collection-${col.key}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-lg ${col.color} flex items-center justify-center`}>
                    <col.icon className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{col.label}</CardTitle>
                    <p className="text-xs text-muted-foreground">{collectionCounts[col.key] || 0} documents</p>
                  </div>
                </div>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>

      {folders.length > 0 && (
        <>
          <h3 className="text-sm font-semibold mt-6">Custom Folders</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {folders.map(f => (
              <Card key={f.id} className="hover:shadow-md transition-shadow" data-testid={`card-folder-${f.id}`}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FolderOpen className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium text-sm">{f.name}</p>
                      <p className="text-xs text-muted-foreground">{f.category}</p>
                    </div>
                    {f.legalHold && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Legal Hold</Badge>}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => toggleLegalHold.mutate({ id: f.id, legalHold: !f.legalHold })}><Lock className="h-4 w-4 mr-2" />{f.legalHold ? "Remove" : "Apply"} Legal Hold</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => deleteMutation.mutate(f.id)}><Trash2 className="h-4 w-4 mr-2" />Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Collection</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={newFolder.name} onChange={e => setNewFolder(p => ({...p, name: e.target.value}))} data-testid="input-folder-name" /></div>
            <div><Label>Category</Label>
              <Select value={newFolder.category} onValueChange={v => setNewFolder(p => ({...p, category: v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{COLLECTIONS.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!newFolder.name || createMutation.isPending} data-testid="button-save-collection">{createMutation.isPending ? "Creating..." : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OnboardingTab({ companyId }: { companyId?: string }) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedPacket, setSelectedPacket] = useState<string | null>(null);
  const [newPacket, setNewPacket] = useState({ workerId: "", templateName: "Standard Onboarding", dueDate: "" });

  const { data: packets = [] } = useQuery<OnboardingPacket[]>({
    queryKey: ["/api/onboarding-packets", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/onboarding-packets?companyId=${companyId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!companyId,
  });

  const { data: workers = [] } = useQuery<Worker[]>({
    queryKey: ["/api/workers", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/workers?companyId=${companyId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/onboarding-packets", { companyId, ...newPacket, dueDate: newPacket.dueDate || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding-packets", companyId] });
      setShowCreate(false);
      setNewPacket({ workerId: "", templateName: "Standard Onboarding", dueDate: "" });
      toast({ title: "Onboarding packet created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const workerMap: Record<string, Worker> = {};
  workers.forEach(w => { workerMap[w.id] = w; });

  const statusColor = (s: string) => {
    if (s === "completed") return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    if (s === "in_progress") return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">HR Onboarding Packets</h2>
          <p className="text-sm text-muted-foreground">Manage employee onboarding document workflows</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-packet"><Plus className="h-4 w-4 mr-2" />New Packet</Button>
      </div>

      {packets.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">No onboarding packets</p>
          <p className="text-sm mt-1">Create a packet to start an employee onboarding workflow.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {packets.map(p => {
            const w = workerMap[p.workerId];
            return (
              <Card key={p.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedPacket(p.id)} data-testid={`card-packet-${p.id}`}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Users className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{w ? `${w.firstName} ${w.lastName}` : "Unknown Worker"}</p>
                      <p className="text-xs text-muted-foreground">{p.templateName}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusColor(p.status)}`}>{p.status.replace("_", " ")}</span>
                    {p.dueDate && <span className="text-xs text-muted-foreground">Due: {formatDate(p.dueDate)}</span>}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {selectedPacket && <OnboardingPacketDetail packetId={selectedPacket} onClose={() => setSelectedPacket(null)} />}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Onboarding Packet</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Employee</Label>
              <Select value={newPacket.workerId} onValueChange={v => setNewPacket(p => ({...p, workerId: v}))}>
                <SelectTrigger data-testid="select-packet-worker"><SelectValue placeholder="Select employee..." /></SelectTrigger>
                <SelectContent>{workers.filter(w => w.isActive).map(w => <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Template</Label>
              <Select value={newPacket.templateName} onValueChange={v => setNewPacket(p => ({...p, templateName: v}))}>
                <SelectTrigger data-testid="select-packet-template"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Standard Onboarding">Standard Onboarding</SelectItem>
                  <SelectItem value="Contractor Onboarding">Contractor Onboarding</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Due Date</Label><Input type="date" value={newPacket.dueDate} onChange={e => setNewPacket(p => ({...p, dueDate: e.target.value}))} data-testid="input-packet-due" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!newPacket.workerId || createMutation.isPending} data-testid="button-save-packet">{createMutation.isPending ? "Creating..." : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OnboardingPacketDetail({ packetId, onClose }: { packetId: string; onClose: () => void }) {
  const { toast } = useToast();
  const { data: packet } = useQuery<OnboardingPacket & { steps: OnboardingPacketStep[] }>({
    queryKey: ["/api/onboarding-packets", packetId],
    queryFn: async () => {
      const res = await fetch(`/api/onboarding-packets/${packetId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const updateStepMutation = useMutation({
    mutationFn: async ({ stepId, status }: { stepId: string; status: string }) => {
      await apiRequest("PATCH", `/api/onboarding-packet-steps/${stepId}`, {
        status, completedAt: status === "completed" ? new Date().toISOString() : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding-packets", packetId] });
      toast({ title: "Step updated" });
    },
  });

  if (!packet) return null;

  const steps = packet.steps || [];
  const completedCount = steps.filter(s => s.status === "completed").length;
  const progress = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Onboarding: {packet.templateName}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between text-sm mb-1">
                <span>{completedCount}/{steps.length} steps completed</span>
                <span className="font-medium">{progress}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {steps.map((step, i) => (
              <div key={step.id} className={`flex items-center gap-3 p-3 rounded-lg border ${step.status === "completed" ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-900" : "bg-card"}`} data-testid={`row-step-${step.id}`}>
                <button
                  onClick={() => updateStepMutation.mutate({ stepId: step.id, status: step.status === "completed" ? "pending" : "completed" })}
                  className="shrink-0"
                  data-testid={`button-toggle-step-${step.id}`}
                >
                  {step.status === "completed" ?
                    <CheckCircle className="h-5 w-5 text-green-600" /> :
                    <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />
                  }
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${step.status === "completed" ? "line-through text-muted-foreground" : ""}`}>{step.stepName}</p>
                  {step.description && <p className="text-xs text-muted-foreground">{step.description}</p>}
                </div>
                <Badge variant="outline" className="text-xs shrink-0">{step.stepType.replace("_", " ")}</Badge>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceApprovalTab({ companyId }: { companyId?: string }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [newInvoice, setNewInvoice] = useState({ vendorName: "", invoiceNumber: "", totalAmount: "", notes: "" });
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);

  const { data: workflows = [] } = useQuery<InvoiceApprovalWorkflow[]>({
    queryKey: ["/api/invoice-approval-workflows", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/invoice-approval-workflows?companyId=${companyId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      if (invoiceFile) formData.append("file", invoiceFile);
      formData.append("companyId", companyId!);
      formData.append("vendorName", newInvoice.vendorName);
      formData.append("invoiceNumber", newInvoice.invoiceNumber);
      formData.append("totalAmount", newInvoice.totalAmount);
      formData.append("notes", newInvoice.notes);
      const res = await fetch("/api/invoice-approval-workflows", { method: "POST", body: formData });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-approval-workflows", companyId] });
      setShowCreate(false);
      setNewInvoice({ vendorName: "", invoiceNumber: "", totalAmount: "", notes: "" });
      setInvoiceFile(null);
      toast({ title: "Invoice submitted for approval" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InvoiceApprovalWorkflow> }) => {
      await apiRequest("PATCH", `/api/invoice-approval-workflows/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-approval-workflows", companyId] });
      toast({ title: "Workflow updated" });
    },
  });

  const statusConfig: Record<string, { label: string; color: string }> = {
    received: { label: "Received", color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200" },
    in_review: { label: "In Review", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
    approved: { label: "Approved", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
    ready_to_pay: { label: "Ready to Pay", color: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
    paid: { label: "Paid", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" },
    rejected: { label: "Rejected", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  };

  const nextStatus: Record<string, string> = { received: "in_review", in_review: "approved", approved: "ready_to_pay", ready_to_pay: "paid" };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Invoice Approval Workflows</h2>
          <p className="text-sm text-muted-foreground">Submit and track invoice approvals</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-submit-invoice"><Plus className="h-4 w-4 mr-2" />Submit Invoice</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {["received", "in_review", "approved", "ready_to_pay", "paid"].map(s => {
          const count = workflows.filter(w => w.status === s).length;
          const cfg = statusConfig[s];
          return (
            <Card key={s}><CardContent className="p-3 text-center">
              <p className="text-2xl font-bold">{count}</p>
              <p className="text-xs text-muted-foreground">{cfg.label}</p>
            </CardContent></Card>
          );
        })}
      </div>

      {workflows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">No invoice workflows</p>
          <p className="text-sm mt-1">Submit an invoice to start the approval process.</p>
        </CardContent></Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="text-left p-3 font-medium">Vendor</th>
              <th className="text-left p-3 font-medium hidden md:table-cell">Invoice #</th>
              <th className="text-left p-3 font-medium hidden md:table-cell">Amount</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="text-left p-3 font-medium hidden lg:table-cell">Submitted</th>
              <th className="text-right p-3 font-medium">Actions</th>
            </tr></thead>
            <tbody>
              {workflows.map(wf => (
                <tr key={wf.id} className="border-b hover:bg-muted/30" data-testid={`row-invoice-${wf.id}`}>
                  <td className="p-3 font-medium">{wf.vendorName || "—"}</td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground">{wf.invoiceNumber || "—"}</td>
                  <td className="p-3 hidden md:table-cell">{wf.totalAmount ? `$${Number(wf.totalAmount).toFixed(2)}` : "—"}</td>
                  <td className="p-3"><span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusConfig[wf.status]?.color || ""}`}>{statusConfig[wf.status]?.label || wf.status}</span></td>
                  <td className="p-3 hidden lg:table-cell text-muted-foreground">{formatDate(wf.createdAt)}</td>
                  <td className="p-3 text-right">
                    {nextStatus[wf.status] && (
                      <Button size="sm" variant="outline" onClick={() => {
                        const ns = nextStatus[wf.status];
                        const updates: any = { status: ns };
                        if (ns === "approved") { updates.approvedAt = new Date().toISOString(); updates.approvedBy = user?.id; }
                        if (ns === "paid") { updates.paidAt = new Date().toISOString(); }
                        updateMutation.mutate({ id: wf.id, data: updates });
                      }} data-testid={`button-advance-${wf.id}`}>
                        <ChevronRight className="h-3 w-3 mr-1" />{statusConfig[nextStatus[wf.status]]?.label}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Submit Invoice for Approval</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Invoice File</Label>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onChange={e => setInvoiceFile(e.target.files?.[0] || null)} className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-primary/10 file:text-primary mt-1" data-testid="input-invoice-file" />
            </div>
            <div><Label>Vendor Name</Label><Input value={newInvoice.vendorName} onChange={e => setNewInvoice(p => ({...p, vendorName: e.target.value}))} data-testid="input-invoice-vendor" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Invoice #</Label><Input value={newInvoice.invoiceNumber} onChange={e => setNewInvoice(p => ({...p, invoiceNumber: e.target.value}))} data-testid="input-invoice-number" /></div>
              <div><Label>Total Amount</Label><Input type="number" step="0.01" value={newInvoice.totalAmount} onChange={e => setNewInvoice(p => ({...p, totalAmount: e.target.value}))} data-testid="input-invoice-amount" /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={newInvoice.notes} onChange={e => setNewInvoice(p => ({...p, notes: e.target.value}))} rows={2} data-testid="input-invoice-notes" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} data-testid="button-save-invoice">{createMutation.isPending ? "Submitting..." : "Submit"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RetentionTab({ companyId, userRole }: { companyId?: string; userRole?: string }) {
  const isAdmin = userRole === "admin";
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newPolicy, setNewPolicy] = useState({ name: "", description: "", documentType: "I-9", retentionYears: 3, retentionMonths: 0, retentionRule: "", dispositionAction: "archive" });

  const { data: policies = [] } = useQuery<DocumentRetentionPolicy[]>({
    queryKey: ["/api/document-retention-policies", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/document-retention-policies?companyId=${companyId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/document-retention-policies", { companyId, ...newPolicy });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-retention-policies", companyId] });
      setShowCreate(false);
      setNewPolicy({ name: "", description: "", documentType: "I-9", retentionYears: 3, retentionMonths: 0, retentionRule: "", dispositionAction: "archive" });
      toast({ title: "Retention policy created" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/document-retention-policies/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-retention-policies", companyId] });
      toast({ title: "Policy deleted" });
    },
  });

  const builtInPolicies = [
    { name: "I-9 Employment Verification", type: "I-9", years: 3, rule: "3 years after hire OR 1 year after termination, whichever is later", action: "archive" },
    { name: "Employment Tax Records", type: "Tax Record", years: 4, rule: "Keep >= 4 years per IRS guidance", action: "archive" },
    { name: "OSHA Records", type: "Other", years: 5, rule: "5 years after end of calendar year", action: "archive" },
    { name: "FMLA Records", type: "Other", years: 3, rule: "3 years from creation date", action: "archive" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Document Retention Policies</h2>
          <p className="text-sm text-muted-foreground">Configure how long documents must be retained for compliance</p>
        </div>
        {isAdmin && <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-retention"><Plus className="h-4 w-4 mr-2" />New Policy</Button>}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4 text-primary" />Built-in Compliance Rules</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {builtInPolicies.map((p, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <p className="font-medium text-sm">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.rule}</p>
                </div>
                <div className="text-right">
                  <Badge variant="secondary">{p.years} years</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {policies.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Settings className="h-4 w-4" />Custom Policies</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {policies.map(p => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b last:border-0" data-testid={`row-retention-${p.id}`}>
                  <div>
                    <p className="font-medium text-sm">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.description || `${p.retentionYears || 0}y ${p.retentionMonths || 0}m - ${p.documentType || "All types"}`}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{p.retentionYears || 0}y {p.retentionMonths || 0}m</Badge>
                    <Badge variant="outline" className="capitalize">{p.dispositionAction}</Badge>
                    {isAdmin && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(p.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Retention Policy</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Policy Name</Label><Input value={newPolicy.name} onChange={e => setNewPolicy(p => ({...p, name: e.target.value}))} data-testid="input-retention-name" /></div>
            <div><Label>Description</Label><Textarea value={newPolicy.description} onChange={e => setNewPolicy(p => ({...p, description: e.target.value}))} rows={2} /></div>
            <div><Label>Document Type</Label>
              <Select value={newPolicy.documentType} onValueChange={v => setNewPolicy(p => ({...p, documentType: v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DOCUMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Retention Years</Label><Input type="number" min={0} value={newPolicy.retentionYears} onChange={e => setNewPolicy(p => ({...p, retentionYears: parseInt(e.target.value) || 0}))} /></div>
              <div><Label>Retention Months</Label><Input type="number" min={0} max={11} value={newPolicy.retentionMonths} onChange={e => setNewPolicy(p => ({...p, retentionMonths: parseInt(e.target.value) || 0}))} /></div>
            </div>
            <div><Label>Retention Rule</Label><Input value={newPolicy.retentionRule} onChange={e => setNewPolicy(p => ({...p, retentionRule: e.target.value}))} placeholder="e.g. 3 years after hire date" /></div>
            <div><Label>Disposition Action</Label>
              <Select value={newPolicy.dispositionAction} onValueChange={v => setNewPolicy(p => ({...p, dispositionAction: v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="archive">Archive</SelectItem>
                  <SelectItem value="delete">Delete</SelectItem>
                  <SelectItem value="review">Manual Review</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!newPolicy.name || createMutation.isPending} data-testid="button-save-retention">{createMutation.isPending ? "Creating..." : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AuditTab({ companyId, userRole }: { companyId?: string; userRole?: string }) {
  const isAdmin = userRole === "admin";
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const { data: logs = [], isLoading } = useQuery<DocumentAuditLog[]>({
    queryKey: ["/api/document-audit-logs", companyId, "company"],
    queryFn: async () => {
      const res = await fetch(`/api/document-audit-logs?companyId=${companyId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!companyId,
  });

  const filtered = logs.filter(l => {
    if (startDate && l.createdAt && new Date(l.createdAt) < new Date(startDate)) return false;
    if (endDate && l.createdAt && new Date(l.createdAt) > new Date(endDate + "T23:59:59")) return false;
    return true;
  });

  const handleExport = () => {
    let url = `/api/document-audit-logs/export?companyId=${companyId}`;
    if (startDate) url += `&startDate=${startDate}`;
    if (endDate) url += `&endDate=${endDate}`;
    window.open(url, "_blank");
  };

  const actionIcon = (a: string) => {
    if (a.includes("upload") || a.includes("create")) return <Upload className="h-3.5 w-3.5 text-green-500" />;
    if (a.includes("view") || a.includes("download")) return <Eye className="h-3.5 w-3.5 text-blue-500" />;
    if (a.includes("edit") || a.includes("update")) return <Edit className="h-3.5 w-3.5 text-amber-500" />;
    if (a.includes("delete")) return <Trash2 className="h-3.5 w-3.5 text-red-500" />;
    if (a.includes("sign") || a.includes("approv")) return <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />;
    return <Activity className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">Document Audit Log</h2>
          <p className="text-sm text-muted-foreground">Immutable record of all document actions</p>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-[150px]" data-testid="input-audit-start" />
          <span className="text-muted-foreground text-sm">to</span>
          <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-[150px]" data-testid="input-audit-end" />
          {isAdmin && <Button size="sm" variant="outline" onClick={handleExport} data-testid="button-export-audit"><Download className="h-4 w-4 mr-2" />Export CSV</Button>}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">Loading audit log...</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Activity className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">No audit records</p>
          <p className="text-sm mt-1">Document actions will be recorded here automatically.</p>
        </CardContent></Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="text-left p-3 font-medium">Action</th>
              <th className="text-left p-3 font-medium hidden md:table-cell">Actor</th>
              <th className="text-left p-3 font-medium hidden md:table-cell">Document</th>
              <th className="text-left p-3 font-medium hidden lg:table-cell">IP Address</th>
              <th className="text-left p-3 font-medium hidden lg:table-cell">Details</th>
              <th className="text-left p-3 font-medium">Timestamp</th>
            </tr></thead>
            <tbody>
              {filtered.slice(0, 100).map(log => (
                <tr key={log.id} className="border-b hover:bg-muted/30" data-testid={`row-audit-log-${log.id}`}>
                  <td className="p-3"><div className="flex items-center gap-2">{actionIcon(log.action)}<span className="capitalize">{log.action.replace(/_/g, " ")}</span></div></td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground">{log.actorName || "—"}</td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground truncate max-w-[150px]">{log.documentId ? log.documentId.slice(0, 8) + "..." : "—"}</td>
                  <td className="p-3 hidden lg:table-cell text-muted-foreground font-mono text-xs">{log.ipAddress || "—"}</td>
                  <td className="p-3 hidden lg:table-cell text-muted-foreground truncate max-w-[200px]">{log.details || "—"}</td>
                  <td className="p-3 text-muted-foreground whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
