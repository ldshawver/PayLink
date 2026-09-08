import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Mail, Check, X } from "lucide-react";

type PortalStatus = {
  accessEnabled: boolean;
  inviteStatus: "none" | "pending" | "accepted" | "expired";
  linkedUserId: string | null;
  linkedUserActive: boolean;
};
type Vendor = {
  id: string; businessName: string; contactName: string | null; email: string | null;
  phone: string | null; address: string | null; city: string | null; state: string | null;
  zip: string | null; serviceType: string | null; notes: string | null; status: string;
  portal?: PortalStatus;
};

const INVITE_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  none: "outline", pending: "secondary", accepted: "default", expired: "destructive",
};

const EMPTY = {
  businessName: "", contactName: "", email: "", phone: "",
  address: "", city: "", state: "", zip: "", serviceType: "", notes: "",
};

/** Admin/manager vendor management (PR 3). Create vendors, edit contact details,
 * invite a vendor portal user, enable/disable access, review submissions. */
export default function VendorManagementPage() {
  const { toast } = useToast();
  const [form, setForm] = useState({ ...EMPTY });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);

  const { data, isLoading } = useQuery<Vendor[]>({ queryKey: ["/api/vendors"] });
  const vendors = Array.isArray(data) ? data : [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });

  const create = useMutation({
    mutationFn: async (body: typeof EMPTY) => (await apiRequest("POST", "/api/vendors", body)).json(),
    onSuccess: () => { invalidate(); setForm({ ...EMPTY }); setCreating(false); toast({ title: "Vendor created" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const save = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Partial<typeof EMPTY> }) =>
      (await apiRequest("PATCH", `/api/vendors/${id}`, body)).json(),
    onSuccess: () => { invalidate(); setEditing(null); toast({ title: "Vendor updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const invite = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/vendors/${id}/invite`, {})).json(),
    onSuccess: (r: any) => { invalidate(); toast({ title: "Invite sent", description: r.email }); },
    onError: (e: Error) => toast({ title: "Could not invite", description: e.message, variant: "destructive" }),
  });

  const toggleAccess = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) =>
      (await apiRequest("POST", `/api/vendors/${id}/status`, { enabled })).json(),
    onSuccess: () => { invalidate(); toast({ title: "Access updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const field = (key: keyof typeof EMPTY, label: string, opts: { textarea?: boolean } = {}, src = form, set = setForm) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {opts.textarea ? (
        <Textarea data-testid={`input-vendor-${key}`} rows={2}
          value={(src as any)[key] ?? ""} onChange={e => set({ ...(src as any), [key]: e.target.value })} />
      ) : (
        <Input data-testid={`input-vendor-${key}`}
          value={(src as any)[key] ?? ""} onChange={e => set({ ...(src as any), [key]: e.target.value })} />
      )}
    </div>
  );

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Vendors</h1>
          <p className="text-muted-foreground text-sm">
            Service providers and suppliers. Invite a vendor to the portal so they can submit invoices and tax documents for review.
          </p>
        </div>
        <Button data-testid="button-new-vendor" onClick={() => setCreating(v => !v)}>
          <Plus className="h-4 w-4 mr-1" /> New vendor
        </Button>
      </div>

      {creating && (
        <Card>
          <CardHeader><CardTitle className="text-base">New vendor</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {field("businessName", "Business name *")}
            {field("contactName", "Contact name")}
            {field("email", "Email")}
            {field("phone", "Phone")}
            {field("serviceType", "Service type")}
            {field("address", "Address")}
            {field("city", "City")}
            {field("state", "State")}
            {field("zip", "ZIP")}
            <div className="sm:col-span-2">{field("notes", "Notes", { textarea: true })}</div>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setCreating(false); setForm({ ...EMPTY }); }}>Cancel</Button>
              <Button data-testid="button-create-vendor" disabled={create.isPending || !form.businessName.trim()}
                onClick={() => create.mutate(form)}>
                {create.isPending ? "Creating…" : "Create vendor"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">All vendors</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Portal</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead className="w-56"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No vendors yet</TableCell></TableRow>
                ) : vendors.map(v => (
                  <TableRow key={v.id} data-testid={`row-vendor-${v.id}`}>
                    <TableCell>
                      <div className="font-medium">{v.businessName}</div>
                      <div className="text-xs text-muted-foreground">{[v.serviceType, v.city && v.state ? `${v.city}, ${v.state}` : v.city].filter(Boolean).join(" · ")}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {v.contactName || "—"}<br />
                      <span className="text-xs text-muted-foreground">{v.email || "no email"}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={INVITE_VARIANT[v.portal?.inviteStatus || "none"]} className="text-xs"
                        data-testid={`badge-portal-${v.id}`}>
                        {v.portal?.inviteStatus || "none"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={v.status === "active" ? "default" : "outline"} className="text-xs">{v.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" data-testid={`button-edit-${v.id}`}
                          onClick={() => setEditing(v)}>Edit</Button>
                        <Button size="sm" variant="outline" data-testid={`button-invite-${v.id}`}
                          disabled={invite.isPending || !v.email || v.status !== "active"}
                          onClick={() => invite.mutate(v.id)}>
                          <Mail className="h-3.5 w-3.5 mr-1" />
                          {v.portal?.inviteStatus === "pending" ? "Resend" : "Invite"}
                        </Button>
                        <Button size="sm" variant="ghost"
                          className={v.status === "active" ? "text-red-600" : "text-emerald-600"}
                          data-testid={`button-toggle-access-${v.id}`}
                          disabled={toggleAccess.isPending}
                          onClick={() => toggleAccess.mutate({ id: v.id, enabled: v.status !== "active" })}>
                          {v.status === "active" ? <><X className="h-3.5 w-3.5 mr-1" />Disable</> : <><Check className="h-3.5 w-3.5 mr-1" />Enable</>}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={v => { if (!v) setEditing(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit {editing?.businessName}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              {field("contactName", "Contact name", {}, editing as any, (nv: any) => setEditing(nv))}
              {field("email", "Email", {}, editing as any, (nv: any) => setEditing(nv))}
              {field("phone", "Phone", {}, editing as any, (nv: any) => setEditing(nv))}
              {field("serviceType", "Service type", {}, editing as any, (nv: any) => setEditing(nv))}
              {field("address", "Address", {}, editing as any, (nv: any) => setEditing(nv))}
              {field("city", "City", {}, editing as any, (nv: any) => setEditing(nv))}
              {field("state", "State", {}, editing as any, (nv: any) => setEditing(nv))}
              {field("zip", "ZIP", {}, editing as any, (nv: any) => setEditing(nv))}
              <div className="sm:col-span-2">{field("notes", "Notes", { textarea: true }, editing as any, (nv: any) => setEditing(nv))}</div>
              <div className="sm:col-span-2 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                <Button data-testid="button-save-vendor" disabled={save.isPending}
                  onClick={() => editing && save.mutate({
                    id: editing.id,
                    body: {
                      contactName: editing.contactName ?? "", email: editing.email ?? "", phone: editing.phone ?? "",
                      serviceType: editing.serviceType ?? "", address: editing.address ?? "", city: editing.city ?? "",
                      state: editing.state ?? "", zip: editing.zip ?? "", notes: editing.notes ?? "",
                    },
                  })}>
                  {save.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <VendorSubmissionsReview />
    </div>
  );
}

type SubInvoice = {
  id: string; business_name: string; invoice_number: string | null; amount: string | null;
  currency: string | null; status: string; description: string | null; review_note: string | null; created_at: string | null;
};
type SubDoc = { id: string; business_name: string; document_type: string; file_name: string; notes: string | null; status: string; created_at: string | null };

function VendorSubmissionsReview() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ invoices: SubInvoice[]; documents: SubDoc[] }>({ queryKey: ["/api/vendor-submissions"] });
  const invoices = data?.invoices ?? [];
  const documents = data?.documents ?? [];

  const reviewInvoice = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      (await apiRequest("POST", `/api/vendor-invoices/${id}/review`, { action })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/vendor-submissions"] }); toast({ title: "Invoice updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const reviewDoc = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      (await apiRequest("POST", `/api/vendor-documents/${id}/review`, { action })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/vendor-submissions"] }); toast({ title: "Document updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Vendor submissions</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (
          <>
            <div>
              <div className="text-sm font-medium mb-2">Invoices</div>
              {invoices.length === 0 ? <p className="text-sm text-muted-foreground">No invoice submissions.</p> : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Vendor</TableHead><TableHead>Invoice #</TableHead><TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead><TableHead className="w-40"></TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {invoices.map(i => (
                        <TableRow key={i.id} data-testid={`row-sub-invoice-${i.id}`}>
                          <TableCell>{i.business_name}</TableCell>
                          <TableCell className="text-sm">{i.invoice_number || "—"}</TableCell>
                          <TableCell className="text-sm">{i.amount ? `${i.amount} ${i.currency || ""}` : "—"}</TableCell>
                          <TableCell><Badge variant={i.status === "approved" ? "default" : i.status === "rejected" ? "destructive" : "secondary"} className="text-xs">{i.status}</Badge></TableCell>
                          <TableCell>
                            {i.status === "submitted" && (
                              <div className="flex gap-2">
                                <Button size="sm" variant="outline" data-testid={`button-approve-invoice-${i.id}`}
                                  disabled={reviewInvoice.isPending} onClick={() => reviewInvoice.mutate({ id: i.id, action: "approve" })}>Approve</Button>
                                <Button size="sm" variant="ghost" className="text-red-600" data-testid={`button-reject-invoice-${i.id}`}
                                  disabled={reviewInvoice.isPending} onClick={() => reviewInvoice.mutate({ id: i.id, action: "reject" })}>Reject</Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
            <div>
              <div className="text-sm font-medium mb-2">Documents</div>
              {documents.length === 0 ? <p className="text-sm text-muted-foreground">No document submissions.</p> : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Vendor</TableHead><TableHead>Type</TableHead><TableHead>File</TableHead>
                      <TableHead>Status</TableHead><TableHead className="w-40"></TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {documents.map(d => (
                        <TableRow key={d.id} data-testid={`row-sub-doc-${d.id}`}>
                          <TableCell>{d.business_name}</TableCell>
                          <TableCell className="text-sm uppercase">{d.document_type}</TableCell>
                          <TableCell className="text-sm">{d.file_name}{d.notes ? ` · ${d.notes}` : ""}</TableCell>
                          <TableCell><Badge variant={d.status === "approved" ? "default" : d.status === "rejected" ? "destructive" : "secondary"} className="text-xs">{d.status || "received"}</Badge></TableCell>
                          <TableCell>
                            {(d.status === "received" || !d.status) && (
                              <div className="flex gap-2">
                                <Button size="sm" variant="outline" data-testid={`button-approve-doc-${d.id}`}
                                  disabled={reviewDoc.isPending} onClick={() => reviewDoc.mutate({ id: d.id, action: "approve" })}>Approve</Button>
                                <Button size="sm" variant="ghost" className="text-red-600" data-testid={`button-reject-doc-${d.id}`}
                                  disabled={reviewDoc.isPending} onClick={() => reviewDoc.mutate({ id: d.id, action: "reject" })}>Reject</Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
