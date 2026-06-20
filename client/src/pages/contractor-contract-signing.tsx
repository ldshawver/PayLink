import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle, FileSignature, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function contractIdFromPath(pathname: string): string {
  return decodeURIComponent(pathname.split("/app/contractor-hub/contracts/")[1]?.split("/sign")[0] || "");
}

function confirmationMessage(status?: string | null) {
  return status === "fully_signed"
    ? "Contract fully signed."
    : "Your signature was submitted. Waiting for other signer(s).";
}

function stateMessage(state?: string | null) {
  switch (state) {
    case "pending_signature": return "This contract is ready for your signature.";
    case "already_signed": return "You already signed this contract. Waiting for other signer(s).";
    case "fully_signed": return "Contract fully signed.";
    case "expired_or_canceled": return "This signing link is expired or no longer active. Please request a new signing link.";
    case "not_authorized": return "You do not have access to this contract.";
    case "malformed_contract_id":
    case "missing_contract":
    default: return "We could not find this contract.";
  }
}

export default function ContractorContractSigningPage() {
  const [location, navigate] = useLocation();
  const contractId = useMemo(() => contractIdFromPath(location), [location]);
  const [signature, setSignature] = useState("");
  const [completionStatus, setCompletionStatus] = useState<string | null>(null);

  const signingQuery = useQuery<any>({
    queryKey: ["/api/contractor-contracts", contractId, "signing-status"],
    queryFn: async () => {
      const res = await fetch(`/api/contractor-contracts/${encodeURIComponent(contractId)}/signing-status`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Contract signing page is unavailable");
      return body;
    },
    enabled: !!contractId,
    retry: false,
  });

  const signMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/contractor-contracts/${encodeURIComponent(contractId)}/sign`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: signature, signatureData: signature }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Unable to submit signature");
      return body;
    },
    onSuccess: (body: any) => setCompletionStatus(body?.contractStatus || "partially_signed"),
  });

  if (!contractId) {
    return <SigningShell><FriendlyNotFound /></SigningShell>;
  }

  if (signingQuery.isLoading) {
    return <SigningShell><div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading signing page…</div></SigningShell>;
  }

  if (signingQuery.isError) {
    return <SigningShell><FriendlyNotFound message={(signingQuery.error as Error).message} /></SigningShell>;
  }

  const data = signingQuery.data || {};
  const status = completionStatus || (data.state === "fully_signed" ? "fully_signed" : data.state === "already_signed" ? "partially_signed" : null);
  const terminalState = ["missing_contract", "malformed_contract_id", "not_authorized", "expired_or_canceled"].includes(data.state);

  if (terminalState) {
    return (
      <SigningShell>
        <ErrorState
          title={data.state === "not_authorized" ? "Not authorized" : data.state === "expired_or_canceled" ? "Signing link inactive" : "Contract not found"}
          message={data.message || stateMessage(data.state)}
        />
      </SigningShell>
    );
  }

  if (status) {
    return (
      <SigningShell>
        <Alert data-testid="contract-signing-confirmation">
          <CheckCircle className="h-4 w-4" />
          <AlertTitle>Signature received</AlertTitle>
          <AlertDescription>{data.message || confirmationMessage(status)}</AlertDescription>
        </Alert>
        <div className="mt-4">
          <Button variant="outline" onClick={() => navigate(`/app/contractor-hub?section=contracts&id=${encodeURIComponent(contractId)}`)} data-testid="btn-return-to-contract">
            Return to contract
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
            <h1 className="text-2xl font-semibold">{data.title || "Contract ready for signature"}</h1>
            <p className="text-sm text-muted-foreground" data-testid="text-contract-ready-for-signature">{data.message || stateMessage("pending_signature")}</p>
            <p className="text-sm text-muted-foreground">Signer: {data.signerName || data.signerEmail || "Authenticated signer"}</p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="contract-signature">Type your legal signature</Label>
          <Input id="contract-signature" value={signature} onChange={(event) => setSignature(event.target.value)} placeholder="Full legal name" data-testid="input-auth-contract-signature" />
        </div>
        {signMutation.isError && <ErrorState title="Signature failed" message={(signMutation.error as Error).message} />}
        <Button onClick={() => signMutation.mutate()} disabled={!signature.trim() || signMutation.isPending} data-testid="btn-submit-auth-contract-signature">
          {signMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Submit signature
        </Button>
      </div>
    </SigningShell>
  );
}

function SigningShell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-muted/30 p-4"><Card className="mx-auto mt-10 max-w-2xl"><CardHeader><CardTitle>MyPayLink Contract Signing</CardTitle></CardHeader><CardContent>{children}</CardContent></Card></main>;
}

function FriendlyNotFound({ message = "We could not find a contract signing page for this link." }: { message?: string }) {
  return <ErrorState title="Contract signing page not found" message={message} />;
}

function ErrorState({ title, message }: { title: string; message: string }) {
  return <Alert variant="destructive" data-testid="contract-signing-friendly-not-found"><AlertTriangle className="h-4 w-4" /><AlertTitle>{title}</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>;
}

export { confirmationMessage, stateMessage };
