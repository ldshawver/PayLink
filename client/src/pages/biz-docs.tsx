import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  FileText, Plus, Eye, Pencil, Trash2, Send, CheckCircle2, XCircle,
  RotateCcw, DollarSign, Printer, Upload, Loader2, ChevronRight,
  ChevronDown, History, Clock, Paperclip, Palette, LayoutTemplate,
  Package, FileCheck, AlertTriangle, Info, Building2, X, ArrowRight,
  RefreshCw, Lock, Briefcase, ArrowUpRight, Users, Mail,
} from "lucide-react";

type DocType = "invoice" | "proposal" | "estimate" | "quote" | "credit_memo";
type DocStatus = "draft" | "submitted" | "approved" | "rejected" | "revision_requested" | "paid" | "voided" | "sent";

interface LineItem {
  id?: string;
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  amount: number | string;
  taxable: boolean;
}

interface BizDoc {
  id: string;
  companyId: string;
  documentType: DocType;
  documentNumber: string;
  status: DocStatus;
  title?: string;
  assignedToName?: string;
  assignedToEmail?: string;
  issueDate?: string;
  dueDate?: string;
  expirationDate?: string;
  servicePeriodStart?: string;
  servicePeriodEnd?: string;
  subtotal?: string;
  taxRate?: string;
  taxTotal?: string;
  discountTotal?: string;
  total?: string;
  currency?: string;
  notes?: string;
  terms?: string;
  paymentInstructions?: string;
  poNumber?: string;
  templateSlug?: string;
  rejectionReason?: string;
  revisionNotes?: string;
  paidAt?: string;
  items?: LineItem[];
  attachments?: any[];
  history?: any[];
  createdAt?: string;
  ownerEntityId?: string;
}

interface Template {
  id: string;
  name: string;
  slug: string;
  documentType: string;
  description?: string;
  previewColor?: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: "Draft", color: "text-gray-700", bg: "bg-gray-100" },
  submitted: { label: "Submitted", color: "text-blue-700", bg: "bg-blue-100" },
  approved: { label: "Approved", color: "text-green-700", bg: "bg-green-100" },
  rejected: { label: "Rejected", color: "text-red-700", bg: "bg-red-100" },
  revision_requested: { label: "Needs Revision", color: "text-amber-700", bg: "bg-amber-100" },
  paid: { label: "Paid", color: "text-emerald-700", bg: "bg-emerald-100" },
  voided: { label: "Voided", color: "text-gray-500", bg: "bg-gray-100" },
  sent: { label: "Sent", color: "text-purple-700", bg: "bg-purple-100" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: "text-gray-700", bg: "bg-gray-100" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function docTypeLabel(type: string) {
  return type === "invoice" ? "Invoice" : type === "proposal" ? "Proposal" : type === "estimate" ? "Estimate" : type === "quote" ? "Quote" : type === "credit_memo" ? "Credit Memo" : type;
}

const EMPTY_ITEM: LineItem = { description: "", quantity: 1, unitPrice: 0, amount: 0, taxable: true };

function LineItemsEditor({ items, onChange, taxRate, onTaxRateChange }: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  taxRate: number;
  onTaxRateChange: (rate: number) => void;
}) {
  const updateItem = (idx: number, field: keyof LineItem, val: any) => {
    const updated = items.map((item, i) => {
      if (i !== idx) return item;
      const next = { ...item, [field]: val };
      if (field === "quantity" || field === "unitPrice") {
        next.amount = (Number(next.quantity || 0) * Number(next.unitPrice || 0)).toFixed(2);
      }
      return next;
    });
    onChange(updated);
  };

  const subtotal = items.reduce((s, i) => s + Number(i.amount || 0), 0);
  const taxable = items.filter(i => i.taxable).reduce((s, i) => s + Number(i.amount || 0), 0);
  const taxAmt = taxable * (taxRate / 100);
  const total = subtotal + taxAmt;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-2 font-medium">Description</th>
              <th className="pb-2 px-2 font-medium w-20">Qty</th>
              <th className="pb-2 px-2 font-medium w-28">Unit Price</th>
              <th className="pb-2 px-2 font-medium w-28">Amount</th>
              <th className="pb-2 px-2 font-medium w-16">Tax?</th>
              <th className="pb-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="space-y-2">
            {items.map((item, idx) => (
              <tr key={idx} className="border-b border-dashed">
                <td className="py-1 pr-2">
                  <Input
                    value={item.description}
                    onChange={e => updateItem(idx, "description", e.target.value)}
                    placeholder="Item description"
                    className="h-8"
                    data-testid={`input-item-desc-${idx}`}
                  />
                </td>
                <td className="py-1 px-2">
                  <Input
                    type="number"
                    value={item.quantity}
                    onChange={e => updateItem(idx, "quantity", e.target.value)}
                    className="h-8 w-20"
                    min="0"
                    step="0.01"
                    data-testid={`input-item-qty-${idx}`}
                  />
                </td>
                <td className="py-1 px-2">
                  <Input
                    type="number"
                    value={item.unitPrice}
                    onChange={e => updateItem(idx, "unitPrice", e.target.value)}
                    className="h-8 w-28"
                    min="0"
                    step="0.01"
                    data-testid={`input-item-price-${idx}`}
                  />
                </td>
                <td className="py-1 px-2">
                  <div className="h-8 flex items-center px-2 bg-muted/50 rounded text-sm font-mono">
                    ${Number(item.amount || 0).toFixed(2)}
                  </div>
                </td>
                <td className="py-1 px-2">
                  <input
                    type="checkbox"
                    checked={item.taxable}
                    onChange={e => updateItem(idx, "taxable", e.target.checked)}
                    className="h-4 w-4"
                    data-testid={`check-item-tax-${idx}`}
                  />
                </td>
                <td className="py-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => onChange(items.filter((_, i) => i !== idx))}
                    data-testid={`btn-remove-item-${idx}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...items, { ...EMPTY_ITEM }])}
        data-testid="btn-add-line-item"
      >
        <Plus className="h-4 w-4 mr-1" /> Add Line Item
      </Button>

      <div className="flex justify-end">
        <div className="w-64 space-y-1 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center text-muted-foreground">
            <span className="flex items-center gap-1">
              Tax (
              <input
                type="number"
                value={taxRate}
                onChange={e => onTaxRateChange(Number(e.target.value))}
                className="w-12 border rounded px-1 py-0.5 text-xs"
                min="0"
                max="100"
                step="0.1"
                data-testid="input-tax-rate"
              />
              %)
            </span>
            <span>${taxAmt.toFixed(2)}</span>
          </div>
          <Separator />
          <div className="flex justify-between font-semibold text-base">
            <span>Total</span><span>${total.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryTimeline({ history }: { history: any[] }) {
  return (
    <div className="space-y-3">
      {history.map((h, i) => (
        <div key={h.id || i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="w-2.5 h-2.5 rounded-full bg-primary mt-1 flex-shrink-0" />
            {i < history.length - 1 && <div className="w-0.5 bg-border flex-1 mt-1" />}
          </div>
          <div className="pb-3">
            <div className="flex items-center gap-2 flex-wrap">
              {h.fromStatus && <StatusBadge status={h.fromStatus} />}
              {h.fromStatus && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
              <StatusBadge status={h.toStatus} />
            </div>
            {h.note && <p className="text-xs text-muted-foreground mt-0.5">{h.note}</p>}
            <p className="text-xs text-muted-foreground mt-0.5">
              {h.changedByName || "System"} · {h.changedAt ? new Date(h.changedAt).toLocaleString() : ""}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function TemplateCard({ template, selected, onSelect }: { template: Template; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      data-testid={`btn-template-${template.slug}`}
      className={`border-2 rounded-lg p-4 text-left transition-all hover:shadow-md ${selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
    >
      <div className="h-20 rounded mb-3 flex items-center justify-center" style={{ background: `${template.previewColor || "#0d9488"}18` }}>
        <div className="w-16 h-12 rounded shadow-sm" style={{ background: template.previewColor || "#0d9488" }}>
          <div className="w-full h-1/3 rounded-t" style={{ background: "#ffffff30" }} />
          <div className="p-1 space-y-0.5">
            <div className="h-0.5 bg-white/60 rounded w-full" />
            <div className="h-0.5 bg-white/40 rounded w-3/4" />
          </div>
        </div>
      </div>
      <p className="font-semibold text-sm">{template.name}</p>
      {template.description && <p className="text-xs text-muted-foreground mt-0.5">{template.description}</p>}
      {selected && <CheckCircle2 className="h-4 w-4 text-primary mt-1" />}
    </button>
  );
}

function BrandingTab() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [formLoaded, setFormLoaded] = useState(false);

  const { data: branding, isLoading } = useQuery<any>({
    queryKey: ["/api/company-branding"],
  });

  useEffect(() => {
    if (branding && branding.id && !formLoaded) {
      setForm(branding);
      setFormLoaded(true);
    }
  }, [branding, formLoaded]);

  const saveMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", "/api/company-branding", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-branding"] });
      toast({ title: "Branding saved" });
    },
  });

  const logoMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/company-branding/logo", { method: "POST", body: fd });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-branding"] });
      toast({ title: "Logo uploaded" });
    },
  });

  const field = (k: string) => form[k] || branding?.[k] || "";
  const setField = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  if (isLoading) return <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader><CardTitle className="text-base">Company Identity</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-24 h-16 border rounded-lg flex items-center justify-center bg-muted overflow-hidden">
              {(branding?.logoPath || logoPreview) ? (
                <img src={logoPreview || branding.logoPath} alt="Logo" className="max-h-full max-w-full object-contain" />
              ) : (
                <Building2 className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} data-testid="btn-upload-logo">
                <Upload className="h-4 w-4 mr-1" /> Upload Logo
              </Button>
              <p className="text-xs text-muted-foreground mt-1">PNG, JPG up to 2MB</p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setLogoPreview(URL.createObjectURL(file));
                  logoMutation.mutate(file);
                }}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Legal Name</Label>
              <Input value={field("legalName")} onChange={e => setField("legalName", e.target.value)} data-testid="input-legal-name" />
            </div>
            <div className="space-y-1">
              <Label>DBA Name</Label>
              <Input value={field("dbaName")} onChange={e => setField("dbaName", e.target.value)} data-testid="input-dba-name" />
            </div>
            <div className="space-y-1">
              <Label>Tax ID / EIN</Label>
              <Input value={field("taxId")} onChange={e => setField("taxId", e.target.value)} data-testid="input-tax-id" />
            </div>
            <div className="space-y-1">
              <Label>Accent Color</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={field("accentColor") || "#0d9488"} onChange={e => setField("accentColor", e.target.value)} className="h-9 w-12 rounded border cursor-pointer" data-testid="input-accent-color" />
                <Input value={field("accentColor")} onChange={e => setField("accentColor", e.target.value)} placeholder="#0d9488" className="flex-1" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Contact & Address</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={field("phone")} onChange={e => setField("phone", e.target.value)} data-testid="input-brand-phone" />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input value={field("email")} onChange={e => setField("email", e.target.value)} data-testid="input-brand-email" />
            </div>
            <div className="space-y-1">
              <Label>Website</Label>
              <Input value={field("website")} onChange={e => setField("website", e.target.value)} data-testid="input-brand-website" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Billing Address</Label>
            <Input value={field("billingAddress")} onChange={e => setField("billingAddress", e.target.value)} data-testid="input-billing-address" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>City</Label>
              <Input value={field("billingCity")} onChange={e => setField("billingCity", e.target.value)} data-testid="input-billing-city" />
            </div>
            <div className="space-y-1">
              <Label>State</Label>
              <Input value={field("billingState")} onChange={e => setField("billingState", e.target.value)} data-testid="input-billing-state" />
            </div>
            <div className="space-y-1">
              <Label>ZIP</Label>
              <Input value={field("billingZip")} onChange={e => setField("billingZip", e.target.value)} data-testid="input-billing-zip" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Default Document Text</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Invoice Terms</Label>
            <Textarea value={field("defaultInvoiceTerms")} onChange={e => setField("defaultInvoiceTerms", e.target.value)} rows={2} data-testid="textarea-invoice-terms" />
          </div>
          <div className="space-y-1">
            <Label>Proposal Terms</Label>
            <Textarea value={field("defaultProposalTerms")} onChange={e => setField("defaultProposalTerms", e.target.value)} rows={2} data-testid="textarea-proposal-terms" />
          </div>
          <div className="space-y-1">
            <Label>Payment Instructions</Label>
            <Textarea value={field("defaultPaymentInstructions")} onChange={e => setField("defaultPaymentInstructions", e.target.value)} rows={2} data-testid="textarea-payment-instructions" />
          </div>
          <div className="space-y-1">
            <Label>Footer Text</Label>
            <Input value={field("footerText")} onChange={e => setField("footerText", e.target.value)} data-testid="input-footer-text" />
          </div>
        </CardContent>
      </Card>

      <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending} data-testid="btn-save-branding">
        {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
        Save Branding
      </Button>
    </div>
  );
}

function CreateEditModal({ open, onClose, editDoc }: { open: boolean; onClose: () => void; editDoc?: BizDoc | null }) {
  const { toast } = useToast();
  const isEdit = !!editDoc;

  const [form, setForm] = useState({
    documentType: editDoc?.documentType || "invoice",
    title: editDoc?.title || "",
    assignedToName: editDoc?.assignedToName || "",
    assignedToEmail: editDoc?.assignedToEmail || "",
    issueDate: editDoc?.issueDate || new Date().toISOString().split("T")[0],
    dueDate: editDoc?.dueDate || "",
    expirationDate: editDoc?.expirationDate || "",
    servicePeriodStart: editDoc?.servicePeriodStart || "",
    servicePeriodEnd: editDoc?.servicePeriodEnd || "",
    poNumber: editDoc?.poNumber || "",
    notes: editDoc?.notes || "",
    terms: editDoc?.terms || "",
    paymentInstructions: editDoc?.paymentInstructions || "",
    templateSlug: editDoc?.templateSlug || "modern_clean",
    currency: editDoc?.currency || "USD",
  });
  const [items, setItems] = useState<LineItem[]>(
    editDoc?.items?.map(i => ({ ...i, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), amount: Number(i.amount) })) || []
  );
  const [taxRate, setTaxRate] = useState(Number(editDoc?.taxRate || 0));
  const [tab, setTab] = useState<"details" | "items" | "template">("details");

  const { data: templates } = useQuery<Template[]>({ queryKey: ["/api/biz-document-templates"] });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (isEdit) {
        await apiRequest("PATCH", `/api/biz-documents/${editDoc!.id}`, data.doc);
        await apiRequest("POST", `/api/biz-documents/${editDoc!.id}/items/replace`, { items: data.items, taxRate: data.taxRate });
      } else {
        const doc = await apiRequest("POST", "/api/biz-documents", data.doc).then(r => r.json());
        await apiRequest("POST", `/api/biz-documents/${doc.id}/items/replace`, { items: data.items, taxRate: data.taxRate });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/biz-documents"] });
      toast({ title: isEdit ? "Document updated" : "Document created" });
      onClose();
    },
    onError: () => toast({ title: "Error saving document", variant: "destructive" }),
  });

  const isProposal = form.documentType === "proposal";
  const filteredTemplates = templates?.filter(t => t.documentType === form.documentType) || [];

  const handleSave = () => {
    saveMutation.mutate({
      doc: { ...form },
      items,
      taxRate,
    });
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Document" : "New Document"}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={v => setTab(v as any)}>
          <TabsList className="mb-4">
            <TabsTrigger value="details" data-testid="tab-doc-details">Details</TabsTrigger>
            <TabsTrigger value="items" data-testid="tab-doc-items">Line Items</TabsTrigger>
            <TabsTrigger value="template" data-testid="tab-doc-template">Template</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Document Type</Label>
                <Select value={form.documentType} onValueChange={v => setForm(p => ({ ...p, documentType: v }))}>
                  <SelectTrigger data-testid="select-doc-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="invoice">Invoice</SelectItem>
                    <SelectItem value="proposal">Proposal</SelectItem>
                    <SelectItem value="estimate">Estimate</SelectItem>
                    <SelectItem value="quote">Quote</SelectItem>
                    <SelectItem value="credit_memo">Credit Memo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Title / Subject</Label>
                <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Project summary..." data-testid="input-doc-title" />
              </div>
              <div className="space-y-1">
                <Label>{isProposal ? "Prepared For" : "Bill To"} (Name)</Label>
                <Input value={form.assignedToName} onChange={e => setForm(p => ({ ...p, assignedToName: e.target.value }))} data-testid="input-assigned-name" />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={form.assignedToEmail} onChange={e => setForm(p => ({ ...p, assignedToEmail: e.target.value }))} data-testid="input-assigned-email" />
              </div>
              <div className="space-y-1">
                <Label>Issue Date</Label>
                <Input type="date" value={form.issueDate} onChange={e => setForm(p => ({ ...p, issueDate: e.target.value }))} data-testid="input-issue-date" />
              </div>
              <div className="space-y-1">
                <Label>{isProposal ? "Expiration Date" : "Due Date"}</Label>
                <Input type="date" value={isProposal ? form.expirationDate : form.dueDate} onChange={e => setForm(p => isProposal ? ({ ...p, expirationDate: e.target.value }) : ({ ...p, dueDate: e.target.value }))} data-testid="input-due-date" />
              </div>
              <div className="space-y-1">
                <Label>Service Period Start</Label>
                <Input type="date" value={form.servicePeriodStart} onChange={e => setForm(p => ({ ...p, servicePeriodStart: e.target.value }))} data-testid="input-service-start" />
              </div>
              <div className="space-y-1">
                <Label>Service Period End</Label>
                <Input type="date" value={form.servicePeriodEnd} onChange={e => setForm(p => ({ ...p, servicePeriodEnd: e.target.value }))} data-testid="input-service-end" />
              </div>
              <div className="space-y-1">
                <Label>PO Number</Label>
                <Input value={form.poNumber} onChange={e => setForm(p => ({ ...p, poNumber: e.target.value }))} data-testid="input-po-number" />
              </div>
              <div className="space-y-1">
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={v => setForm(p => ({ ...p, currency: v }))}>
                  <SelectTrigger data-testid="select-currency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="CAD">CAD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} data-testid="textarea-notes" />
            </div>
            <div className="space-y-1">
              <Label>Terms & Conditions</Label>
              <Textarea value={form.terms} onChange={e => setForm(p => ({ ...p, terms: e.target.value }))} rows={2} data-testid="textarea-terms" />
            </div>
            {!isProposal && (
              <div className="space-y-1">
                <Label>Payment Instructions</Label>
                <Textarea value={form.paymentInstructions} onChange={e => setForm(p => ({ ...p, paymentInstructions: e.target.value }))} rows={2} data-testid="textarea-payment-instructions" />
              </div>
            )}
          </TabsContent>

          <TabsContent value="items">
            <LineItemsEditor items={items} onChange={setItems} taxRate={taxRate} onTaxRateChange={setTaxRate} />
          </TabsContent>

          <TabsContent value="template">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Choose a layout for your {docTypeLabel(form.documentType)}.</p>
              {filteredTemplates.length === 0 && (
                <p className="text-sm text-muted-foreground italic">No templates available for this document type.</p>
              )}
              <div className="grid grid-cols-3 gap-3">
                {filteredTemplates.map(t => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    selected={form.templateSlug === t.slug}
                    onSelect={() => setForm(p => ({ ...p, templateSlug: t.slug }))}
                  />
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="btn-cancel-doc">Cancel</Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="btn-save-doc">
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            {isEdit ? "Save Changes" : "Create Document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentDetailPanel({ doc, onClose, onRefresh, userRole }: { doc: BizDoc; onClose: () => void; onRefresh: () => void; userRole: string }) {
  const { toast } = useToast();
  const [actionNote, setActionNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [paidAmount, setPaidAmount] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailOverride, setEmailOverride] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const isAdmin = userRole === "admin" || userRole === "manager";

  const { data: detail, isLoading, refetch } = useQuery<BizDoc & { items: any[]; attachments: any[]; history: any[] }>({
    queryKey: ["/api/biz-documents", doc.id],
    queryFn: () => fetch(`/api/biz-documents/${doc.id}`).then(r => r.json()),
  });

  const actionMutation = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: any }) =>
      apiRequest("POST", `/api/biz-documents/${doc.id}/${action}`, body || {}),
    onSuccess: () => { refetch(); onRefresh(); setActionNote(""); toast({ title: "Updated" }); },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const attachMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/biz-documents/${doc.id}/attachments`, { method: "POST", body: fd });
      return res.json();
    },
    onSuccess: () => { refetch(); toast({ title: "File attached" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (attachId: string) => apiRequest("DELETE", `/api/biz-document-attachments/${attachId}`),
    onSuccess: () => { refetch(); toast({ title: "Attachment removed" }); },
  });

  const d = detail || doc;
  const status = d.status;

  const canSubmit = ["draft", "revision_requested"].includes(status);
  const canApprove = isAdmin && status === "submitted";
  const canReject = isAdmin && ["submitted", "approved"].includes(status);
  const canRevision = isAdmin && status === "submitted";
  const canMarkPaid = isAdmin && ["approved", "sent"].includes(status);
  const canVoid = isAdmin && status !== "paid" && status !== "voided";
  const canConvert = isAdmin && d.documentType === "proposal" && status === "approved";

  const convertMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/biz-documents/${doc.id}/convert-to-invoice`, {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/biz-documents"] }); onClose(); toast({ title: "Converted to invoice" }); },
  });

  const emailMutation = useMutation({
    mutationFn: (email: string) => apiRequest("POST", `/api/biz-documents/${doc.id}/send-email`, { email }),
    onSuccess: (_r, email) => {
      queryClient.invalidateQueries({ queryKey: ["/api/biz-documents"] });
      refetch();
      onRefresh();
      setEmailDialogOpen(false);
      toast({ title: "Email sent", description: `Sent to ${email}` });
    },
    onError: (e: any) => toast({ title: "Failed to send", description: e?.message || "Email could not be sent", variant: "destructive" }),
  });

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-background border-l shadow-2xl z-50 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b bg-muted/30">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{d.documentNumber}</span>
            <StatusBadge status={d.status} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{docTypeLabel(d.documentType)}{d.title ? ` — ${d.title}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && d.status !== "voided" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setEmailOverride(d.assignedToEmail || ""); setEmailDialogOpen(true); }}
              data-testid="btn-email-doc"
            >
              <Mail className="h-4 w-4 mr-1" /> Email
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(`/api/biz-documents/${doc.id}/print`, "_blank")}
            data-testid="btn-print-doc"
          >
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="btn-close-detail">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">To</p>
            <p className="font-medium">{d.assignedToName || "—"}</p>
            {d.assignedToEmail && <p className="text-xs text-muted-foreground">{d.assignedToEmail}</p>}
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Dates</p>
            <p>Issue: {d.issueDate || "—"}</p>
            {d.documentType !== "proposal" && <p>Due: {d.dueDate || "—"}</p>}
            {d.documentType === "proposal" && <p>Expires: {d.expirationDate || "—"}</p>}
          </div>
          {d.poNumber && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">PO Number</p>
              <p>{d.poNumber}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Total</p>
            <p className="font-semibold text-lg">${Number(d.total || 0).toFixed(2)} {d.currency || "USD"}</p>
          </div>
        </div>

        {/* Line items */}
        {isLoading ? (
          <div className="flex items-center justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : detail?.items && detail.items.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Line Items</p>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left p-2 text-xs font-medium">Description</th>
                    <th className="text-right p-2 text-xs font-medium">Qty</th>
                    <th className="text-right p-2 text-xs font-medium">Price</th>
                    <th className="text-right p-2 text-xs font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{item.description}</td>
                      <td className="p-2 text-right">{Number(item.quantity)}</td>
                      <td className="p-2 text-right">${Number(item.unitPrice).toFixed(2)}</td>
                      <td className="p-2 text-right">${Number(item.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t bg-muted/20 p-3 text-sm text-right space-y-1">
                <div className="text-muted-foreground">Subtotal: ${Number(d.subtotal || 0).toFixed(2)}</div>
                {Number(d.taxTotal) > 0 && <div className="text-muted-foreground">Tax ({d.taxRate}%): ${Number(d.taxTotal).toFixed(2)}</div>}
                <div className="font-semibold">Total: ${Number(d.total || 0).toFixed(2)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Notes */}
        {(d.notes || d.terms || d.rejectionReason || d.revisionNotes) && (
          <div className="space-y-2 text-sm">
            {d.rejectionReason && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs font-semibold text-red-700 mb-1">Rejection Reason</p>
                <p className="text-red-800">{d.rejectionReason}</p>
              </div>
            )}
            {d.revisionNotes && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-xs font-semibold text-amber-700 mb-1">Revision Requested</p>
                <p className="text-amber-800">{d.revisionNotes}</p>
              </div>
            )}
            {d.notes && <div><p className="text-xs text-muted-foreground font-medium">Notes</p><p className="mt-0.5">{d.notes}</p></div>}
            {d.terms && <div><p className="text-xs text-muted-foreground font-medium">Terms</p><p className="mt-0.5 text-xs">{d.terms}</p></div>}
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</p>

          {(canApprove || canReject || canRevision || canMarkPaid || canVoid || canConvert) && (
            <div className="space-y-2">
              <Textarea
                placeholder="Optional note..."
                value={actionNote}
                onChange={e => setActionNote(e.target.value)}
                rows={2}
                className="text-sm"
                data-testid="textarea-action-note"
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {canSubmit && (
              <Button size="sm" onClick={() => actionMutation.mutate({ action: "submit", body: { note: actionNote } })} disabled={actionMutation.isPending} data-testid="btn-submit-doc">
                <Send className="h-4 w-4 mr-1" /> Submit
              </Button>
            )}
            {canApprove && (
              <Button size="sm" variant="default" className="bg-green-600 hover:bg-green-700" onClick={() => actionMutation.mutate({ action: "approve", body: { note: actionNote } })} disabled={actionMutation.isPending} data-testid="btn-approve-doc">
                <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
              </Button>
            )}
            {canReject && (
              <Button size="sm" variant="destructive" onClick={() => actionMutation.mutate({ action: "reject", body: { rejectionReason: actionNote || "Rejected by reviewer" } })} disabled={actionMutation.isPending} data-testid="btn-reject-doc">
                <XCircle className="h-4 w-4 mr-1" /> Reject
              </Button>
            )}
            {canRevision && (
              <Button size="sm" variant="outline" onClick={() => actionMutation.mutate({ action: "request-revision", body: { revisionNotes: actionNote } })} disabled={actionMutation.isPending} data-testid="btn-revision-doc">
                <RotateCcw className="h-4 w-4 mr-1" /> Request Revision
              </Button>
            )}
            {canConvert && (
              <Button size="sm" variant="outline" onClick={() => convertMutation.mutate()} disabled={convertMutation.isPending} data-testid="btn-convert-doc">
                <RefreshCw className="h-4 w-4 mr-1" /> Convert to Invoice
              </Button>
            )}
          </div>

          {canMarkPaid && (
            <div className="border rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold">Mark as Paid</p>
              <div className="flex gap-2">
                <Input placeholder="Amount" type="number" value={paidAmount} onChange={e => setPaidAmount(e.target.value)} className="h-8 text-sm" data-testid="input-paid-amount" />
                <Input placeholder="Reference" value={paymentRef} onChange={e => setPaymentRef(e.target.value)} className="h-8 text-sm" data-testid="input-payment-ref" />
              </div>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => actionMutation.mutate({ action: "mark-paid", body: { paidAmount, paymentReference: paymentRef } })} disabled={actionMutation.isPending} data-testid="btn-mark-paid">
                <DollarSign className="h-4 w-4 mr-1" /> Mark Paid
              </Button>
            </div>
          )}

          {canVoid && (
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => actionMutation.mutate({ action: "void", body: { note: actionNote } })} disabled={actionMutation.isPending} data-testid="btn-void-doc">
              <XCircle className="h-4 w-4 mr-1" /> Void Document
            </Button>
          )}
        </div>

        {/* Attachments */}
        <div>
          <button
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2"
            onClick={() => setShowAttachments(!showAttachments)}
            data-testid="btn-toggle-attachments"
          >
            {showAttachments ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Paperclip className="h-3 w-3" /> Attachments ({detail?.attachments?.length || 0})
          </button>
          {showAttachments && (
            <div className="space-y-2">
              {detail?.attachments?.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between text-sm p-2 border rounded">
                  <a href={a.filePath} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">{a.fileName || a.filePath}</a>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => deleteMutation.mutate(a.id)} data-testid={`btn-delete-attachment-${a.id}`}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <div>
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} data-testid="btn-attach-file">
                  <Upload className="h-4 w-4 mr-1" /> Attach File
                </Button>
                <input ref={fileRef} type="file" className="hidden" onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) attachMutation.mutate(file);
                }} />
              </div>
            </div>
          )}
        </div>

        {/* History */}
        <div>
          <button
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2"
            onClick={() => setShowHistory(!showHistory)}
            data-testid="btn-toggle-history"
          >
            {showHistory ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <History className="h-3 w-3" /> Status History ({detail?.history?.length || 0})
          </button>
          {showHistory && detail?.history && <HistoryTimeline history={detail.history} />}
        </div>
      </div>

      {/* Email Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={v => !v && setEmailDialogOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Send {docTypeLabel(d.documentType)} by Email
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The {docTypeLabel(d.documentType).toLowerCase()} will be sent as a formatted HTML email. The status will be updated to <strong>Sent</strong>.
            </p>
            <div className="space-y-1">
              <Label htmlFor="email-recipient">Recipient Email</Label>
              <Input
                id="email-recipient"
                type="email"
                value={emailOverride}
                onChange={e => setEmailOverride(e.target.value)}
                placeholder="customer@example.com"
                data-testid="input-email-recipient"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => emailOverride && emailMutation.mutate(emailOverride)}
              disabled={!emailOverride || emailMutation.isPending}
              data-testid="btn-confirm-send-email"
            >
              {emailMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Mail className="h-4 w-4 mr-1" />}
              Send Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DocumentRow({ doc, onView, onEdit, onDelete, canEdit }: {
  doc: BizDoc;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between p-3 hover:bg-muted/40 border-b last:border-b-0 cursor-pointer"
      onClick={onView}
      data-testid={`row-doc-${doc.id}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <FileText className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{doc.documentNumber}</span>
            <StatusBadge status={doc.status} />
            <Badge variant="outline" className="text-xs">{docTypeLabel(doc.documentType)}</Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">{doc.assignedToName || doc.title || "—"}</p>
        </div>
      </div>
      <div className="flex items-center gap-4 flex-shrink-0 ml-4">
        <div className="text-right hidden sm:block">
          <p className="font-semibold text-sm">${Number(doc.total || 0).toFixed(2)}</p>
          <p className="text-xs text-muted-foreground">{doc.issueDate || "—"}</p>
        </div>
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {canEdit && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit} data-testid={`btn-edit-doc-${doc.id}`}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {canEdit && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onDelete} data-testid={`btn-delete-doc-${doc.id}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}

// ── Contractor Hub ─────────────────────────────────────────────────────────

interface ContractorProposal {
  id: string;
  company_id?: string;
  contractor_id: string;
  proposal_number?: string;
  title?: string;
  description?: string;
  issue_date: string;
  expiration_date?: string;
  amount?: string;
  tax_amount?: string;
  line_items?: string;
  notes?: string;
  terms?: string;
  status: string;
  rejection_reason?: string;
  converted_to_invoice_id?: string;
  currency?: string;
  first_name?: string;
  last_name?: string;
  contractor_email?: string;
  created_at?: string;
}

interface ContractorInvoice {
  id: string;
  company_id?: string;
  contractor_id: string;
  invoice_number?: string;
  invoice_date: string;
  due_date?: string;
  amount: string;
  description?: string;
  status: string;
  rejection_reason?: string;
  paid_at?: string;
  proposal_reference?: string;
}

const PROPOSAL_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: "Draft", color: "text-gray-700", bg: "bg-gray-100" },
  submitted: { label: "Submitted", color: "text-blue-700", bg: "bg-blue-100" },
  approved: { label: "Accepted", color: "text-green-700", bg: "bg-green-100" },
  rejected: { label: "Rejected", color: "text-red-700", bg: "bg-red-100" },
  revision_requested: { label: "Needs Revision", color: "text-amber-700", bg: "bg-amber-100" },
};

const INV_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: "Draft", color: "text-gray-700", bg: "bg-gray-100" },
  submitted: { label: "Submitted", color: "text-blue-700", bg: "bg-blue-100" },
  approved: { label: "Approved", color: "text-green-700", bg: "bg-green-100" },
  rejected: { label: "Rejected", color: "text-red-700", bg: "bg-red-100" },
  paid: { label: "Paid", color: "text-emerald-700", bg: "bg-emerald-100" },
};

function ProposalStatusBadge({ status }: { status: string }) {
  const cfg = PROPOSAL_STATUS_CONFIG[status] || { label: status, color: "text-gray-700", bg: "bg-gray-100" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>;
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const cfg = INV_STATUS_CONFIG[status] || { label: status, color: "text-gray-700", bg: "bg-gray-100" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>;
}

function ProposalFormModal({
  open, onClose, editProposal, isAdmin
}: {
  open: boolean;
  onClose: () => void;
  editProposal?: ContractorProposal | null;
  isAdmin: boolean;
}) {
  const { toast } = useToast();
  const isEdit = !!editProposal;
  const [form, setForm] = useState({
    companyId: editProposal?.company_id || "",
    title: editProposal?.title || "",
    description: editProposal?.description || "",
    issueDate: editProposal?.issue_date || new Date().toISOString().split("T")[0],
    expirationDate: editProposal?.expiration_date || "",
    notes: editProposal?.notes || "",
    terms: editProposal?.terms || "",
    currency: editProposal?.currency || "USD",
  });
  const [items, setItems] = useState<LineItem[]>(() => {
    if (!editProposal?.line_items) return [];
    try { return JSON.parse(editProposal.line_items); } catch { return []; }
  });
  const [taxRate, setTaxRate] = useState(0);

  const { data: companies = [] } = useQuery<any[]>({ queryKey: ["/api/contractor-proposals/companies"] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const subtotal = items.reduce((s, i) => s + Number(i.amount || 0), 0);
      const taxAmt = subtotal * (taxRate / 100);
      const body = {
        ...form,
        lineItems: items,
        amount: (subtotal + taxAmt).toFixed(2),
        taxAmount: taxAmt.toFixed(2),
      };
      if (isEdit) {
        return apiRequest("PATCH", `/api/contractor-proposals/${editProposal!.id}`, body);
      } else {
        return apiRequest("POST", "/api/contractor-proposals", body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] });
      toast({ title: isEdit ? "Proposal updated" : "Proposal created" });
      onClose();
    },
    onError: (e: any) => toast({ title: e?.message || "Error saving proposal", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Proposal" : "New Contractor Proposal"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Send To (Company)</Label>
              <Select value={form.companyId} onValueChange={v => setForm(p => ({ ...p, companyId: v }))}>
                <SelectTrigger data-testid="select-proposal-company"><SelectValue placeholder="Select company..." /></SelectTrigger>
                <SelectContent>
                  {companies.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.name || c.legal_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Title / Project Name</Label>
              <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Web redesign project..." data-testid="input-proposal-title" />
            </div>
            <div className="space-y-1">
              <Label>Issue Date</Label>
              <Input type="date" value={form.issueDate} onChange={e => setForm(p => ({ ...p, issueDate: e.target.value }))} data-testid="input-proposal-issue-date" />
            </div>
            <div className="space-y-1">
              <Label>Expiration Date</Label>
              <Input type="date" value={form.expirationDate} onChange={e => setForm(p => ({ ...p, expirationDate: e.target.value }))} data-testid="input-proposal-exp-date" />
            </div>
            <div className="space-y-1">
              <Label>Currency</Label>
              <Select value={form.currency} onValueChange={v => setForm(p => ({ ...p, currency: v }))}>
                <SelectTrigger data-testid="select-proposal-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="CAD">CAD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Description / Scope of Work</Label>
            <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={3} placeholder="Describe the work or services..." data-testid="textarea-proposal-description" />
          </div>
          <Separator />
          <div>
            <p className="text-sm font-semibold mb-2">Line Items</p>
            <LineItemsEditor items={items} onChange={setItems} taxRate={taxRate} onTaxRateChange={setTaxRate} />
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} data-testid="textarea-proposal-notes" />
          </div>
          <div className="space-y-1">
            <Label>Terms & Conditions</Label>
            <Textarea value={form.terms} onChange={e => setForm(p => ({ ...p, terms: e.target.value }))} rows={2} data-testid="textarea-proposal-terms" />
          </div>
        </div>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="btn-save-proposal">
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            {isEdit ? "Save Changes" : "Create Proposal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContractorInvoiceFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    companyId: "",
    description: "",
    amount: "",
    invoiceDate: new Date().toISOString().split("T")[0],
    dueDate: "",
    notes: "",
  });
  const [items, setItems] = useState<LineItem[]>([]);
  const [taxRate, setTaxRate] = useState(0);

  const { data: companies = [] } = useQuery<any[]>({ queryKey: ["/api/contractor-proposals/companies"] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const subtotal = items.length > 0 ? items.reduce((s, i) => s + Number(i.amount || 0), 0) : Number(form.amount || 0);
      const taxAmt = subtotal * (taxRate / 100);
      const total = subtotal + taxAmt;
      const body: any = {
        companyId: form.companyId || undefined,
        description: form.description,
        invoiceDate: form.invoiceDate,
        dueDate: form.dueDate || undefined,
        notes: form.notes || undefined,
        amount: total.toFixed(2),
        status: "draft",
      };
      if (items.length > 0) body.lineItems = JSON.stringify(items);
      return apiRequest("POST", "/api/contractor-invoices", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-invoices"] });
      toast({ title: "Invoice created", description: "Submit it when ready." });
      onClose();
    },
    onError: (e: any) => toast({ title: e?.message || "Error creating invoice", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Contractor Invoice</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Invoice To (Company)</Label>
              <Select value={form.companyId} onValueChange={v => setForm(p => ({ ...p, companyId: v === "__none__" ? "" : v }))}>
                <SelectTrigger data-testid="select-invoice-company"><SelectValue placeholder="Select company (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None / Self-employed</SelectItem>
                  {companies.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.name || c.legal_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Invoice Date *</Label>
              <Input type="date" value={form.invoiceDate} onChange={e => setForm(p => ({ ...p, invoiceDate: e.target.value }))} data-testid="input-invoice-date" />
            </div>
            <div className="space-y-1">
              <Label>Due Date</Label>
              <Input type="date" value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))} data-testid="input-invoice-due-date" />
            </div>
            <div className="space-y-1">
              <Label>Quick Amount (if no line items)</Label>
              <Input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" min="0" step="0.01" disabled={items.length > 0} data-testid="input-invoice-amount" />
              {items.length > 0 && <p className="text-xs text-muted-foreground">Calculated from line items</p>}
            </div>
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} placeholder="Services rendered for..." data-testid="textarea-invoice-description" />
          </div>
          <Separator />
          <div>
            <p className="text-sm font-semibold mb-2">Line Items (optional)</p>
            <LineItemsEditor items={items} onChange={setItems} taxRate={taxRate} onTaxRateChange={setTaxRate} />
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} data-testid="textarea-invoice-notes" />
          </div>
        </div>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || (!form.amount && items.length === 0) || !form.invoiceDate}
            data-testid="btn-save-contractor-invoice"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Create Invoice (Draft)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContractorHubTab({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useToast();
  const [activeSubTab, setActiveSubTab] = useState("proposals");
  const [createProposalOpen, setCreateProposalOpen] = useState(false);
  const [createInvoiceOpen, setCreateInvoiceOpen] = useState(false);
  const [editProposal, setEditProposal] = useState<ContractorProposal | null>(null);
  const [viewProposal, setViewProposal] = useState<ContractorProposal | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [revisionNotes, setRevisionNotes] = useState("");
  const [revisionTarget, setRevisionTarget] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payRef, setPayRef] = useState("");
  const [payTarget, setPayTarget] = useState<string | null>(null);

  const { data: proposals = [], isLoading: proposalsLoading, refetch: refetchProposals } = useQuery<ContractorProposal[]>({
    queryKey: ["/api/contractor-proposals"],
  });

  const { data: invoices = [], isLoading: invoicesLoading, refetch: refetchInvoices } = useQuery<ContractorInvoice[]>({
    queryKey: ["/api/contractor-invoices"],
  });

  const proposalMutation = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body?: any }) =>
      apiRequest("POST", `/api/contractor-proposals/${id}/${action}`, body || {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-invoices"] });
      setRejectTarget(null);
      setRevisionTarget(null);
      setViewProposal(null);
      toast({ title: "Done" });
    },
    onError: (e: any) => toast({ title: e?.message || "Action failed", variant: "destructive" }),
  });

  const deleteProposalMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/contractor-proposals/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-proposals"] });
      toast({ title: "Proposal deleted" });
    },
    onError: () => toast({ title: "Cannot delete this proposal", variant: "destructive" }),
  });

  const invoiceMutation = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body?: any }) =>
      apiRequest("POST", `/api/contractor-invoices/${id}/${action}`, body || {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-invoices"] });
      setPayTarget(null);
      toast({ title: "Done" });
    },
    onError: (e: any) => toast({ title: e?.message || "Action failed", variant: "destructive" }),
  });

  const pendingProposals = proposals.filter(p => p.status === "submitted");
  const pendingInvoices = invoices.filter(i => i.status === "submitted");

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-primary" />
            {isAdmin ? "Contractor Proposals & Invoices" : "My Proposals & Invoices"}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isAdmin
              ? "Review inbound proposals from contractors; accept and convert to payable invoices"
              : "Send proposals to companies; track acceptance and invoice payments"}
          </p>
        </div>
        {!isAdmin && (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setCreateProposalOpen(true)} data-testid="btn-new-proposal">
              <Plus className="h-4 w-4 mr-1" /> New Proposal
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCreateInvoiceOpen(true)} data-testid="btn-new-contractor-invoice">
              <Plus className="h-4 w-4 mr-1" /> New Invoice
            </Button>
          </div>
        )}
      </div>

      {isAdmin && (pendingProposals.length > 0 || pendingInvoices.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {pendingProposals.length > 0 && (
            <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                  <FileText className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-blue-700">{pendingProposals.length} Proposal{pendingProposals.length !== 1 ? "s" : ""} Awaiting Review</p>
                  <p className="text-xs text-blue-600">Click Proposals tab to review</p>
                </div>
              </CardContent>
            </Card>
          )}
          {pendingInvoices.length > 0 && (
            <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center">
                  <DollarSign className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-amber-700">{pendingInvoices.length} Invoice{pendingInvoices.length !== 1 ? "s" : ""} Awaiting Payment</p>
                  <p className="text-xs text-amber-600">Click Invoices tab to pay</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList>
          <TabsTrigger value="proposals" data-testid="subtab-contractor-proposals">
            Proposals
            {isAdmin && pendingProposals.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-500 text-white text-xs font-bold">{pendingProposals.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="invoices" data-testid="subtab-contractor-invoices">
            Invoices
            {isAdmin && pendingInvoices.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-xs font-bold">{pendingInvoices.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="proposals" className="mt-4">
          {proposalsLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : proposals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <p className="font-medium text-muted-foreground">{isAdmin ? "No contractor proposals yet" : "No proposals yet"}</p>
              {!isAdmin && (
                <Button className="mt-4" size="sm" onClick={() => setCreateProposalOpen(true)} data-testid="btn-create-first-proposal">
                  <Plus className="h-4 w-4 mr-1" /> Create Your First Proposal
                </Button>
              )}
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              {proposals.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 hover:bg-muted/30 border-b last:border-b-0" data-testid={`row-proposal-${p.id}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{p.proposal_number || "—"}</span>
                        <ProposalStatusBadge status={p.status} />
                        {p.converted_to_invoice_id && (
                          <Badge variant="outline" className="text-xs text-green-600 border-green-300">Converted to Invoice</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {isAdmin ? `${p.first_name || ""} ${p.last_name || ""}`.trim() || "Unknown Contractor" : p.title || "—"}
                        {p.title && isAdmin ? ` — ${p.title}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                    <div className="text-right hidden sm:block">
                      <p className="font-semibold text-sm">${Number(p.amount || 0).toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground">{p.issue_date}</p>
                    </div>
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setViewProposal(p)} data-testid={`btn-view-proposal-${p.id}`}>
                        <Eye className="h-3.5 w-3.5 mr-1" /> View
                      </Button>
                      {!isAdmin && ["draft", "revision_requested"].includes(p.status) && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditProposal(p)} data-testid={`btn-edit-proposal-${p.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {!isAdmin && ["draft", "rejected"].includes(p.status) && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => {
                          if (window.confirm("Delete this proposal?")) deleteProposalMutation.mutate(p.id);
                        }} data-testid={`btn-delete-proposal-${p.id}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {!isAdmin && ["draft", "revision_requested"].includes(p.status) && p.company_id && (
                        <Button size="sm" className="h-8 px-2 text-xs" onClick={() => proposalMutation.mutate({ id: p.id, action: "submit" })} disabled={proposalMutation.isPending} data-testid={`btn-submit-proposal-${p.id}`}>
                          <Send className="h-3.5 w-3.5 mr-1" /> Submit
                        </Button>
                      )}
                      {isAdmin && p.status === "submitted" && (
                        <>
                          <Button size="sm" className="h-8 px-2 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={() => proposalMutation.mutate({ id: p.id, action: "convert-to-invoice" })} disabled={proposalMutation.isPending} data-testid={`btn-accept-proposal-${p.id}`}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Accept & Invoice
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => { setRevisionTarget(p.id); setRevisionNotes(""); }} data-testid={`btn-revision-proposal-${p.id}`}>
                            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Revise
                          </Button>
                          <Button size="sm" variant="destructive" className="h-8 px-2 text-xs" onClick={() => { setRejectTarget(p.id); setRejectionReason(""); }} data-testid={`btn-reject-proposal-${p.id}`}>
                            <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="invoices" className="mt-4">
          {invoicesLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <DollarSign className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <p className="font-medium text-muted-foreground">{isAdmin ? "No contractor invoices yet" : "No invoices yet"}</p>
              {!isAdmin && (
                <Button className="mt-4" size="sm" onClick={() => setCreateInvoiceOpen(true)} data-testid="btn-create-first-invoice">
                  <Plus className="h-4 w-4 mr-1" /> Create Your First Invoice
                </Button>
              )}
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              {invoices.map(inv => (
                <div key={inv.id} className="flex items-center justify-between p-3 hover:bg-muted/30 border-b last:border-b-0" data-testid={`row-contractor-invoice-${inv.id}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <DollarSign className="h-4 w-4 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{inv.invoice_number || "—"}</span>
                        <InvoiceStatusBadge status={inv.status} />
                        {inv.proposal_reference && (
                          <Badge variant="outline" className="text-xs">{inv.proposal_reference}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{inv.description || "—"} · {inv.invoice_date}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                    <div className="text-right hidden sm:block">
                      <p className="font-semibold text-sm">${Number(inv.amount || 0).toFixed(2)}</p>
                      {inv.due_date && <p className="text-xs text-muted-foreground">Due {inv.due_date}</p>}
                    </div>
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      {!isAdmin && inv.status === "draft" && (
                        <Button size="sm" className="h-8 px-2 text-xs" onClick={() => invoiceMutation.mutate({ id: inv.id, action: "submit" })} disabled={invoiceMutation.isPending} data-testid={`btn-submit-invoice-${inv.id}`}>
                          <Send className="h-3.5 w-3.5 mr-1" /> Submit
                        </Button>
                      )}
                      {isAdmin && inv.status === "submitted" && (
                        <Button size="sm" onClick={() => { setPayTarget(inv.id); setPayAmount(inv.amount); setPayRef(""); }} className="h-8 px-2 text-xs" data-testid={`btn-pay-invoice-${inv.id}`}>
                          <DollarSign className="h-3.5 w-3.5 mr-1" /> Mark Paid
                        </Button>
                      )}
                      {isAdmin && inv.status === "submitted" && (
                        <Button size="sm" variant="outline" onClick={() => invoiceMutation.mutate({ id: inv.id, action: "approve" })} className="h-8 px-2 text-xs" data-testid={`btn-approve-invoice-${inv.id}`}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Reject Proposal Dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={v => !v && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Proposal</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Provide a reason for rejecting this proposal (optional).</p>
            <Textarea value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} placeholder="e.g. Budget constraints, different scope needed..." rows={3} data-testid="textarea-reject-reason" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => rejectTarget && proposalMutation.mutate({ id: rejectTarget, action: "reject", body: { rejectionReason } })} disabled={proposalMutation.isPending} data-testid="btn-confirm-reject">
              Reject Proposal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request Revision Dialog */}
      <Dialog open={!!revisionTarget} onOpenChange={v => !v && setRevisionTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request Revision</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Describe what changes are needed.</p>
            <Textarea value={revisionNotes} onChange={e => setRevisionNotes(e.target.value)} placeholder="e.g. Please break down the pricing by task..." rows={3} data-testid="textarea-revision-notes" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionTarget(null)}>Cancel</Button>
            <Button onClick={() => revisionTarget && proposalMutation.mutate({ id: revisionTarget, action: "request-revision", body: { revisionNotes } })} disabled={proposalMutation.isPending} data-testid="btn-confirm-revision">
              Send Back for Revision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Paid Dialog */}
      <Dialog open={!!payTarget} onOpenChange={v => !v && setPayTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark Invoice Paid</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Amount Paid</Label>
              <Input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} data-testid="input-pay-amount" />
            </div>
            <div className="space-y-1">
              <Label>Payment Reference (check #, transfer ID, etc.)</Label>
              <Input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="e.g. Check #1042" data-testid="input-pay-ref" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>Cancel</Button>
            <Button onClick={() => payTarget && invoiceMutation.mutate({ id: payTarget, action: "mark-paid", body: { paidAmount: payAmount, paymentReference: payRef } })} disabled={invoiceMutation.isPending} data-testid="btn-confirm-payment">
              <DollarSign className="h-4 w-4 mr-1" /> Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Proposal Detail Dialog */}
      <Dialog open={!!viewProposal} onOpenChange={v => !v && setViewProposal(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {viewProposal?.proposal_number || "Proposal"}
            </DialogTitle>
          </DialogHeader>
          {viewProposal && (
            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-2">
                <ProposalStatusBadge status={viewProposal.status} />
                <span className="text-muted-foreground">{viewProposal.issue_date}</span>
              </div>
              {viewProposal.title && <div><p className="text-xs text-muted-foreground">Title</p><p className="font-medium">{viewProposal.title}</p></div>}
              {viewProposal.description && <div><p className="text-xs text-muted-foreground">Description</p><p className="whitespace-pre-line">{viewProposal.description}</p></div>}
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">Amount</p><p className="font-semibold text-base">${Number(viewProposal.amount || 0).toFixed(2)} {viewProposal.currency || "USD"}</p></div>
                {viewProposal.expiration_date && <div><p className="text-xs text-muted-foreground">Expires</p><p>{viewProposal.expiration_date}</p></div>}
              </div>
              {viewProposal.line_items && (() => {
                try {
                  const items: LineItem[] = JSON.parse(viewProposal.line_items);
                  if (items.length === 0) return null;
                  return (
                    <div>
                      <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-2">Line Items</p>
                      <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/30">
                            <tr>
                              <th className="text-left p-2 text-xs font-medium">Description</th>
                              <th className="text-right p-2 text-xs font-medium">Qty</th>
                              <th className="text-right p-2 text-xs font-medium">Price</th>
                              <th className="text-right p-2 text-xs font-medium">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item, i) => (
                              <tr key={i} className="border-t">
                                <td className="p-2">{item.description}</td>
                                <td className="p-2 text-right">{Number(item.quantity)}</td>
                                <td className="p-2 text-right">${Number(item.unitPrice).toFixed(2)}</td>
                                <td className="p-2 text-right">${Number(item.amount).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                } catch { return null; }
              })()}
              {viewProposal.notes && <div><p className="text-xs text-muted-foreground">Notes</p><p className="whitespace-pre-line">{viewProposal.notes}</p></div>}
              {viewProposal.terms && <div><p className="text-xs text-muted-foreground">Terms</p><p className="whitespace-pre-line text-xs">{viewProposal.terms}</p></div>}
              {viewProposal.rejection_reason && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-xs font-semibold text-red-700 mb-1">
                    {viewProposal.status === "revision_requested" ? "Revision Requested" : "Rejection Reason"}
                  </p>
                  <p className="text-red-800">{viewProposal.rejection_reason}</p>
                </div>
              )}
              {viewProposal.converted_to_invoice_id && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <p className="text-green-800 text-sm font-medium">Accepted — Invoice has been created</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewProposal(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Proposal Modal */}
      {(createProposalOpen || editProposal) && (
        <ProposalFormModal
          open={true}
          onClose={() => { setCreateProposalOpen(false); setEditProposal(null); }}
          editProposal={editProposal}
          isAdmin={isAdmin}
        />
      )}

      {/* Create Contractor Invoice Modal */}
      {createInvoiceOpen && (
        <ContractorInvoiceFormModal
          open={true}
          onClose={() => setCreateInvoiceOpen(false)}
        />
      )}
    </div>
  );
}

function TemplatesTab() {
  const { data: templates, isLoading } = useQuery<Template[]>({ queryKey: ["/api/biz-document-templates"] });

  if (isLoading) return <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const invoiceTemplates = templates?.filter(t => t.documentType === "invoice") || [];
  const proposalTemplates = templates?.filter(t => t.documentType === "proposal") || [];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><FileCheck className="h-4 w-4" /> Invoice Templates</h3>
        <div className="grid grid-cols-3 gap-4">
          {invoiceTemplates.map(t => (
            <div key={t.id} className="border rounded-lg overflow-hidden">
              <div className="h-24 flex items-center justify-center" style={{ background: `${t.previewColor || "#0d9488"}18` }}>
                <div className="w-20 h-14 rounded shadow-md flex flex-col overflow-hidden" style={{ background: t.previewColor || "#0d9488" }}>
                  <div className="h-5 flex items-center px-2"><div className="w-8 h-1.5 bg-white/80 rounded" /></div>
                  <div className="flex-1 bg-white/95 p-1 space-y-0.5">
                    <div className="h-0.5 bg-gray-300 rounded w-full" />
                    <div className="h-0.5 bg-gray-200 rounded w-3/4" />
                    <div className="h-0.5 bg-gray-200 rounded w-2/3" />
                  </div>
                </div>
              </div>
              <div className="p-3">
                <p className="font-semibold text-sm">{t.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <Separator />
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Package className="h-4 w-4" /> Proposal Templates</h3>
        <div className="grid grid-cols-3 gap-4">
          {proposalTemplates.map(t => (
            <div key={t.id} className="border rounded-lg overflow-hidden">
              <div className="h-24 flex items-center justify-center" style={{ background: `${t.previewColor || "#059669"}18` }}>
                <div className="w-20 h-14 rounded shadow-md flex flex-col overflow-hidden" style={{ background: t.previewColor || "#059669" }}>
                  <div className="h-5 flex items-center px-2"><div className="w-10 h-1.5 bg-white/80 rounded" /></div>
                  <div className="flex-1 bg-white/95 p-1 space-y-0.5">
                    <div className="h-0.5 bg-gray-300 rounded w-full" />
                    <div className="h-0.5 bg-gray-200 rounded w-2/3" />
                  </div>
                </div>
              </div>
              <div className="p-3">
                <p className="font-semibold text-sm">{t.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function BizDocsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const urlSearch = useSearch();
  const isAdmin = user?.role === "admin" || user?.role === "manager";
  const urlTab = new URLSearchParams(urlSearch).get("tab");
  const [activeTab, setActiveTab] = useState(urlTab || "all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editDoc, setEditDoc] = useState<BizDoc | null>(null);
  const [viewDoc, setViewDoc] = useState<BizDoc | null>(null);
  const [search, setSearch] = useState("");

  const { data: docs = [], isLoading, refetch } = useQuery<BizDoc[]>({
    queryKey: ["/api/biz-documents"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/biz-documents/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/biz-documents"] }); toast({ title: "Document deleted" }); },
    onError: () => toast({ title: "Cannot delete this document", variant: "destructive" }),
  });

  const filterDocs = (docs: BizDoc[]) => {
    let filtered = docs;
    if (activeTab === "invoices") filtered = docs.filter(d => d.documentType === "invoice");
    else if (activeTab === "proposals") filtered = docs.filter(d => ["proposal", "estimate", "quote"].includes(d.documentType));
    else if (activeTab === "awaiting") filtered = docs.filter(d => d.status === "submitted");
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(d => (d.documentNumber || "").toLowerCase().includes(q) || (d.assignedToName || "").toLowerCase().includes(q) || (d.title || "").toLowerCase().includes(q));
    }
    return filtered;
  };

  const filtered = filterDocs(docs);
  const awaitingCount = docs.filter(d => d.status === "submitted").length;

  const handleDelete = (doc: BizDoc) => {
    if (!["draft", "revision_requested"].includes(doc.status)) {
      toast({ title: "Only draft documents can be deleted", variant: "destructive" });
      return;
    }
    if (window.confirm(`Delete ${doc.documentNumber}?`)) deleteMutation.mutate(doc.id);
  };

  const canEdit = (doc: BizDoc) => ["draft", "revision_requested"].includes(doc.status);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b bg-background">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Invoices & Proposals
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Create, submit, and track invoices and proposals</p>
        </div>
        {activeTab !== "contractor-hub" && (
          <Button onClick={() => setCreateOpen(true)} data-testid="btn-create-doc">
            <Plus className="h-4 w-4 mr-1" /> New Document
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
          <div className="px-4 pt-3 border-b bg-background">
            <TabsList>
              <TabsTrigger value="all" data-testid="tab-all-docs">All Documents</TabsTrigger>
              <TabsTrigger value="invoices" data-testid="tab-invoices">Invoices</TabsTrigger>
              <TabsTrigger value="proposals" data-testid="tab-proposals">Proposals</TabsTrigger>
              <TabsTrigger value="awaiting" data-testid="tab-awaiting">
                Awaiting Review
                {isAdmin && awaitingCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                    {awaitingCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="contractor-hub" data-testid="tab-contractor-hub">
                <Briefcase className="h-4 w-4 mr-1" /> Contractor Hub
              </TabsTrigger>
              <TabsTrigger value="templates" data-testid="tab-templates">
                <LayoutTemplate className="h-4 w-4 mr-1" /> Templates
              </TabsTrigger>
              <TabsTrigger value="branding" data-testid="tab-branding">
                <Palette className="h-4 w-4 mr-1" /> Branding
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto">
            {activeTab === "contractor-hub" ? (
              <ContractorHubTab isAdmin={isAdmin} />
            ) : activeTab === "templates" ? (
              isAdmin ? (
                <div className="p-4"><TemplatesTab /></div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Lock className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <p className="font-medium text-muted-foreground">Admin access required</p>
                  <p className="text-sm text-muted-foreground mt-1">Only admins and managers can manage templates.</p>
                </div>
              )
            ) : activeTab === "branding" ? (
              isAdmin ? (
                <div className="p-4"><BrandingTab /></div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Lock className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <p className="font-medium text-muted-foreground">Admin access required</p>
                  <p className="text-sm text-muted-foreground mt-1">Only admins and managers can configure branding.</p>
                </div>
              )
            ) : (
              <TabsContent value={activeTab} className="mt-0 h-full">
                <div className="p-4 pb-2">
                  <Input
                    placeholder="Search by number, name, or title..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="max-w-sm"
                    data-testid="input-search-docs"
                  />
                </div>

                {isLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <FileText className="h-12 w-12 text-muted-foreground/40 mb-3" />
                    <p className="text-muted-foreground font-medium">No documents found</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {activeTab === "awaiting" ? "No documents awaiting review." : "Create your first document to get started."}
                    </p>
                    {activeTab !== "awaiting" && (
                      <Button className="mt-4" onClick={() => setCreateOpen(true)} data-testid="btn-create-first-doc">
                        <Plus className="h-4 w-4 mr-1" /> Create Document
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="border rounded-lg mx-4 mb-4 overflow-hidden">
                    {filtered.map(doc => (
                      <DocumentRow
                        key={doc.id}
                        doc={doc}
                        onView={() => setViewDoc(doc)}
                        onEdit={() => setEditDoc(doc)}
                        onDelete={() => handleDelete(doc)}
                        canEdit={canEdit(doc)}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>
            )}
          </div>
        </Tabs>
      </div>

      {/* Create/Edit Modal */}
      {(createOpen || editDoc) && (
        <CreateEditModal
          open={true}
          onClose={() => { setCreateOpen(false); setEditDoc(null); }}
          editDoc={editDoc}
        />
      )}

      {/* Detail Panel */}
      {viewDoc && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setViewDoc(null)} />
          <DocumentDetailPanel
            doc={viewDoc}
            onClose={() => setViewDoc(null)}
            onRefresh={() => refetch()}
            userRole={user?.role || "employee"}
          />
        </>
      )}
    </div>
  );
}
