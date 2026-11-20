import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getCsrfToken, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, FileSignature, Loader2, Upload } from "lucide-react";

type Step = { key: string; title: string; status: string };
type Doc = { id: string; kind: string; label: string; mimeType: string; byteSize: number; uploadedAt: string };
type Mine = { onboardingId: string; status: string; employeeNumber: string | null; steps: Step[]; documents: Doc[] };

const STEP_STATUS: Record<string, string> = {
  completed: "Done", submitted: "Submitted for review", in_progress: "In progress", not_started: "To do",
};

/**
 * The contractor's own onboarding checklist. Government ID files are uploaded
 * straight to private, encrypted storage; nothing is shown back except the
 * document type, size and date.
 */
export default function MyOnboardingPage() {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<Mine>({ queryKey: ["/api/my-onboarding"], retry: false });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/my-onboarding"] });

  const sign = useMutation({
    mutationFn: async (kind: "contractor_agreement" | "w9") => {
      const h = { "x-csrf-token": getCsrfToken() ?? "" };
      const start = await fetch(`/api/my-onboarding/esign/${kind}`, { method: "POST", credentials: "include", headers: h });
      const sb = await start.json().catch(() => ({}));
      if (!start.ok) throw new Error(sb?.message || "Signing is not available right now.");
      const link = await fetch(`/api/my-onboarding/esign/${kind}/link`, { credentials: "include" });
      const lb = await link.json().catch(() => ({}));
      if (!link.ok || !lb?.signingUrl) throw new Error(lb?.message || "Your document is being prepared. Try again in a minute.");
      return lb.signingUrl as string;
    },
    onSuccess: (url) => { window.location.assign(url); },
    onError: (e: Error) => toast({ title: "Can't open the document", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (error || !data) {
    return (
      <div className="p-4 md:p-6 max-w-3xl">
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">My onboarding</h1>
        <p className="text-sm text-muted-foreground mt-2" data-testid="text-no-onboarding">There is no onboarding checklist for your account.</p>
      </div>
    );
  }
  const step = (k: string) => data.steps.find((s) => s.key === k);
  const done = data.steps.filter((s) => s.status === "completed").length;
  const docOf = (kind: string) => data.documents.find((d) => d.kind === kind);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">My onboarding</h1>
        <p className="text-sm text-muted-foreground">{done} of {data.steps.length} steps complete. You can bid and submit proposals once an administrator verifies everything.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Checklist</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2" data-testid="list-steps">
            {data.steps.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-sm" data-testid={`step-${s.key}`}>
                {s.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                <span className="flex-1">{s.title}</span>
                <Badge variant={s.status === "completed" ? "default" : "secondary"}>{STEP_STATUS[s.status] ?? s.status}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents to sign</CardTitle>
          <CardDescription>You'll sign in Documenso, then return here.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-2">
          {([["contractor_agreement", "Sign contractor agreement"], ["w9", "Complete and sign W-9"]] as const).map(([kind, label]) => (
            step(kind)?.status === "completed"
              ? <span key={kind} className="text-sm text-muted-foreground flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" />{label.replace(/^Sign |^Complete and sign /, "")} signed</span>
              : <Button key={kind} variant="outline" disabled={sign.isPending} onClick={() => sign.mutate(kind)} data-testid={`button-sign-${kind}`}>
                  <FileSignature className="h-4 w-4 mr-2" />{label}
                </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Government-issued ID</CardTitle>
          <CardDescription>A photo or scan of a driver's license, state ID or passport. JPEG, PNG, HEIC or PDF, up to 10 MB. Stored encrypted; only you and your company's administrators can open it.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <IdUpload side="front" label="Front" doc={docOf("government_id_front")} onDone={refresh} />
          <IdUpload side="back" label="Back (if your ID has one)" doc={docOf("government_id_back")} onDone={refresh} />
        </CardContent>
      </Card>
    </div>
  );
}

function IdUpload({ side, label, doc, onDone }: { side: "front" | "back"; label: string; doc?: Doc; onDone: () => void }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch(`/api/my-onboarding/government-id/${side}`, { method: "POST", credentials: "include", headers: { "x-csrf-token": getCsrfToken() ?? "" }, body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Upload failed.");
      toast({ title: "ID uploaded", description: "An administrator will review it." });
      onDone();
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="rounded-md border p-3 space-y-2" data-testid={`card-id-${side}`}>
      <div className="text-sm font-medium">{label}</div>
      {doc
        ? <div className="text-xs text-muted-foreground" data-testid={`text-id-${side}-uploaded`}>Uploaded {new Date(doc.uploadedAt).toLocaleDateString()} · {(doc.byteSize / 1024).toFixed(0)} KB · <a className="underline" href={`/api/private-documents/${doc.id}`} target="_blank" rel="noopener noreferrer" data-testid={`link-id-${side}`}>View</a></div>
        : <div className="text-xs text-muted-foreground">Not uploaded yet</div>}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/heic,application/pdf" className="hidden" data-testid={`input-id-${side}`}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
      <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()} data-testid={`button-upload-id-${side}`}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}{doc ? "Replace" : "Upload"}
      </Button>
    </div>
  );
}
