import { useRef, useState } from "react";
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
import { Loader2, Upload } from "lucide-react";

type Vendor = {
  id: string; businessName: string; contactName: string | null; email: string | null;
  phone: string | null; address: string | null; city: string | null; state: string | null; zip: string | null;
  serviceType: string | null; status: string;
};
type Profile = { vendor: Vendor; company: { id: string; name: string } | null };
type Invoice = {
  id: string; invoice_number: string | null; amount: string | null; currency: string | null;
  status: string; description: string | null; review_note: string | null; created_at: string | null;
};
type Doc = { id: string; document_type: string; file_name: string; notes: string | null; status: string | null; review_note: string | null; created_at: string | null };

/** Logged-in vendor's own portal (PR 3). Shows only this vendor's records. */
export default function VendorPortalPage() {
  const { toast } = useToast();
  const invoiceFile = useRef<HTMLInputElement>(null);
  const docFile = useRef<HTMLInputElement>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [docType, setDocType] = useState("w9");
  const [busy, setBusy] = useState(false);

  const { data: profile, isLoading, error } = useQuery<Profile>({ queryKey: ["/api/vendor-portal/profile"] });
  const { data: subs } = useQuery<{ invoices: Invoice[]; documents: Doc[] }>({ queryKey: ["/api/vendor-portal/submissions"] });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/vendor-portal/submissions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/vendor-portal/profile"] });
  };

  async function upload(kind: "invoices" | "documents") {
    const input = kind === "invoices" ? invoiceFile.current : docFile.current;
    const file = input?.files?.[0];
    if (kind === "documents" && !file) { toast({ title: "Attach a file first", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      if (file) fd.append("file", file);
      if (kind === "invoices") {
        fd.append("invoiceNumber", invoiceNumber);
        fd.append("amount", amount);
        fd.append("description", description);
      } else {
        fd.append("documentType", docType);
      }
      const r = await fetch(`/api/vendor-portal/${kind}`, { method: "POST", credentials: "include", body: fd });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message || "Upload failed");
      }
      toast({ title: kind === "invoices" ? "Invoice submitted" : "Document uploaded" });
      if (input) input.value = "";
      setInvoiceNumber(""); setAmount(""); setDescription("");
      refresh();
    } catch (e: any) {
      toast({ title: "Could not submit", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  const saveProfile = useMutation({
    mutationFn: async (body: Partial<Vendor>) => (await apiRequest("PATCH", "/api/vendor-portal/profile", body)).json(),
    onSuccess: () => { refresh(); toast({ title: "Profile updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const [edit, setEdit] = useState<Partial<Vendor> | null>(null);

  if (isLoading) return <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (error || !profile) {
    return (
      <div className="p-6 max-w-md mx-auto text-center space-y-2">
        <h1 className="text-lg font-semibold">Vendor portal unavailable</h1>
        <p className="text-sm text-muted-foreground">This account is not linked to an active vendor. Contact the company that invited you.</p>
      </div>
    );
  }

  const v = edit ?? profile.vendor;
  const invoices = subs?.invoices ?? [];
  const documents = subs?.documents ?? [];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">{profile.vendor.businessName}</h1>
        <p className="text-muted-foreground text-sm">
          Vendor portal{profile.company ? ` · ${profile.company.name}` : ""}. Submit invoices and tax documents for review.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {(["contactName", "email", "phone", "serviceType", "address", "city", "state", "zip"] as const).map(k => (
            <div key={k} className="space-y-1">
              <Label className="text-xs capitalize">{k.replace(/([A-Z])/g, " $1")}</Label>
              <Input data-testid={`input-profile-${k}`} value={(v as any)[k] ?? ""}
                onChange={e => setEdit({ ...(v as any), [k]: e.target.value })} />
            </div>
          ))}
          <div className="sm:col-span-2 flex justify-end gap-2">
            {edit && <Button variant="ghost" onClick={() => setEdit(null)}>Reset</Button>}
            <Button data-testid="button-save-profile" disabled={!edit || saveProfile.isPending}
              onClick={() => edit && saveProfile.mutate(edit)}>
              {saveProfile.isPending ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Submit an invoice</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Invoice number</Label>
            <Input data-testid="input-invoice-number" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Amount</Label>
            <Input data-testid="input-invoice-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div className="sm:col-span-2 space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea data-testid="input-invoice-description" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="sm:col-span-2 space-y-1">
            <Label className="text-xs">Invoice file (PDF or image, optional)</Label>
            <Input data-testid="input-invoice-file" type="file" ref={invoiceFile} accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button data-testid="button-submit-invoice" disabled={busy} onClick={() => upload("invoices")}>
              <Upload className="h-4 w-4 mr-1" /> {busy ? "Submitting…" : "Submit invoice"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Upload a document</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <select data-testid="select-doc-type" className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={docType} onChange={e => setDocType(e.target.value)}>
              <option value="w9">W-9</option>
              <option value="tax">Tax</option>
              <option value="insurance">Insurance</option>
              <option value="license">License</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">File (PDF or image)</Label>
            <Input data-testid="input-doc-file" type="file" ref={docFile} accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button data-testid="button-upload-doc" disabled={busy} onClick={() => upload("documents")}>
              <Upload className="h-4 w-4 mr-1" /> {busy ? "Uploading…" : "Upload document"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">My submissions</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Item</TableHead><TableHead>Detail</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {invoices.length === 0 && documents.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">Nothing submitted yet</TableCell></TableRow>
              ) : (
                <>
                  {invoices.map(i => (
                    <TableRow key={i.id} data-testid={`row-my-invoice-${i.id}`}>
                      <TableCell>Invoice {i.invoice_number || ""}</TableCell>
                      <TableCell className="text-sm">{i.amount ? `${i.amount} ${i.currency || ""}` : "—"}{i.review_note ? ` · ${i.review_note}` : ""}</TableCell>
                      <TableCell><Badge variant={i.status === "approved" ? "default" : i.status === "rejected" ? "destructive" : "secondary"} className="text-xs">{i.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {documents.map(d => (
                    <TableRow key={d.id} data-testid={`row-my-doc-${d.id}`}>
                      <TableCell className="uppercase">{d.document_type}</TableCell>
                      <TableCell className="text-sm">{d.file_name}{d.review_note ? ` · ${d.review_note}` : d.notes ? ` · ${d.notes}` : ""}</TableCell>
                      <TableCell><Badge variant={d.status === "approved" ? "default" : d.status === "rejected" ? "destructive" : "outline"} className="text-xs">{d.status || "received"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
