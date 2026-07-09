import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, FileSignature, CheckCircle, AlertTriangle, ExternalLink } from "lucide-react";

function tokenFromPath(pathname: string): string {
  return decodeURIComponent(pathname.split("/sign/contracts/")[1]?.split("/")[0] || "");
}

export default function ContractSigningPage() {
  const [location] = useLocation();
  const token = tokenFromPath(location);
  const [signature, setSignature] = useState("");

  const contractQuery = useQuery<any>({
    queryKey: ["/api/signing/contracts", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/sign/contracts/${encodeURIComponent(token)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error(body.message || body.safeErrorReason || "Unable to load signing link") as Error & { state?: string; status?: number };
        error.state = body.state || body.reason;
        error.status = res.status;
        throw error;
      }
      return body;
    },
    enabled: !!token,
    retry: false,
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/public/sign/contracts/${encodeURIComponent(token)}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureData: signature }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Unable to complete signature");
      return body;
    },
  });

  if (!token) {
    return <SigningShell><ErrorState title="Invalid signing link" message="This contract signing link is missing its secure token." /></SigningShell>;
  }

  if (contractQuery.isLoading) {
    return <SigningShell><div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading contract…</div></SigningShell>;
  }

  if (contractQuery.isError) {
    const error = contractQuery.error as Error & { state?: string; status?: number };
    const title = error.state === "expired_link" || error.state === "expired_or_canceled" ? "Signing link expired"
      : error.state === "already_signed" ? "Already signed"
      : error.state === "fully_signed" ? "Contract fully signed"
      : error.status && error.status >= 500 ? "Signing service unavailable"
      : "Invalid signing link";
    return <SigningShell><ErrorState title={title} message={error.message || "This signing link could not be loaded. Please contact the sender for a new link."} /></SigningShell>;
  }

  const isPostDocumensoReturn = location.includes("/status") || location.includes("signed=1");

  if (completeMutation.isSuccess) {
    return <SigningShell><Alert><CheckCircle className="h-4 w-4" /><AlertTitle>Signature received</AlertTitle><AlertDescription>Your contract signature has been recorded.</AlertDescription></Alert></SigningShell>;
  }

  const contract = contractQuery.data || {};
  const state = typeof contract.state === "string" ? contract.state : (isPostDocumensoReturn ? "pending_signature" : "missing_contract");
  const message = typeof contract.message === "string" ? contract.message : (
    state === "fully_signed" ? "Contract fully signed." :
    state === "already_signed" ? "You already signed this contract. Waiting for other signer(s)." :
    state === "expired_or_canceled" ? "This signing link is expired or no longer active." :
    "Signature received. We are confirming completion."
  );

  if (isPostDocumensoReturn && state === "pending_signature") {
    return <SigningShell><Alert data-testid="public-contract-signing-status"><CheckCircle className="h-4 w-4" /><AlertTitle>Signature received</AlertTitle><AlertDescription>Signature received. We are confirming completion.</AlertDescription></Alert></SigningShell>;
  }
  if (["already_signed", "fully_signed"].includes(state)) {
    return <SigningShell><Alert data-testid="public-contract-signing-status"><CheckCircle className="h-4 w-4" /><AlertTitle>{state === "fully_signed" ? "Contract fully signed" : "Already signed"}</AlertTitle><AlertDescription>{message}</AlertDescription></Alert></SigningShell>;
  }
  if (["expired_or_canceled", "expired_link", "invalid_link", "missing_contract", "server_error"].includes(state)) {
    return <SigningShell><ErrorState title={state === "expired_link" ? "Signing link expired" : state === "invalid_link" || state === "missing_contract" ? "Invalid signing link" : state === "server_error" ? "Signing service unavailable" : "Signing link inactive"} message={message} /></SigningShell>;
  }
  if (contract.documensoSigningUrl) {
    return (
      <SigningShell>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-3"><FileSignature className="h-6 w-6 text-primary" /></div>
            <div>
              <h1 className="text-2xl font-semibold">{contract.title || "Contract ready for signature"}</h1>
              <p className="text-sm text-muted-foreground">{message || "This contract is ready for your signature."}</p>
              <p className="text-sm text-muted-foreground">Signer: {contract.signerName || contract.signerEmail || "External signer"}</p>
            </div>
          </div>
          <Button asChild data-testid="button-open-documenso-signing">
            <a href={contract.documensoSigningUrl} rel="noopener noreferrer">Open Documenso signing <ExternalLink className="ml-2 h-4 w-4" /></a>
          </Button>
        </div>
      </SigningShell>
    );
  }
  return (
    <SigningShell>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-primary/10 p-3"><FileSignature className="h-6 w-6 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-semibold">{contract.title || "Contract ready for signature"}</h1>
            <p className="text-sm text-muted-foreground">Signer: {contract.signerName || contract.signerEmail || "External signer"}</p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="signature">Type your legal signature</Label>
          <Input id="signature" data-testid="input-contract-signature" value={signature} onChange={(event) => setSignature(event.target.value)} placeholder="Full legal name" />
        </div>
        {completeMutation.isError && <ErrorState title="Signature failed" message={(completeMutation.error as Error).message} />}
        <Button data-testid="button-complete-contract-signature" disabled={!signature.trim() || completeMutation.isPending} onClick={() => completeMutation.mutate()}>
          {completeMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Complete signature
        </Button>
      </div>
    </SigningShell>
  );
}

function SigningShell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-muted/30 p-4"><Card className="mx-auto mt-10 max-w-2xl"><CardHeader><CardTitle>MyPayLink Contract Signing</CardTitle></CardHeader><CardContent>{children}</CardContent></Card></main>;
}

function ErrorState({ title, message }: { title: string; message: string }) {
  return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>{title}</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>;
}
