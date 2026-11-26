import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IdCard, Loader2 } from "lucide-react";

type Doc = { id: string; kind: string; label: string; mimeType: string; byteSize: number; uploadedAt: string };

/** Lists a contractor's private documents. Each open is audited server-side. */
export function PrivateDocsButton({ onboardingId }: { onboardingId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery<{ available: boolean; message: string | null; documents: Doc[] }>({
    queryKey: [`/api/contractor-onboarding/${onboardingId}/private-documents`], enabled: open, staleTime: 0,
  });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid={`button-private-docs-${onboardingId}`}>
        <IdCard className="h-4 w-4 mr-1.5" />View ID
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Private documents</DialogTitle>
            <DialogDescription>Opening a document is recorded in the access log.</DialogDescription>
          </DialogHeader>
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
            <div className="space-y-2" data-testid="list-private-docs">
              {data?.message && <p className="text-sm text-amber-700">{data.message}</p>}
              {!data?.documents.length && <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>}
              {data?.documents.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-2 text-sm border-t pt-2 first:border-t-0 first:pt-0">
                  <div>
                    <div>{d.label}</div>
                    <div className="text-xs text-muted-foreground">{new Date(d.uploadedAt).toLocaleDateString()} · {(d.byteSize / 1024).toFixed(0)} KB</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" asChild><a href={`/api/private-documents/${d.id}`} target="_blank" rel="noopener noreferrer" data-testid={`link-view-${d.id}`}>View</a></Button>
                    <Button size="sm" variant="ghost" asChild><a href={`/api/private-documents/${d.id}?download=1`} data-testid={`link-download-${d.id}`}>Download</a></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
