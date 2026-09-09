import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, FileSignature, CheckCircle, Clock, AlertTriangle, ExternalLink } from "lucide-react";

function tokenFromPath(pathname: string): string {
  return decodeURIComponent(pathname.split("/sign/contracts/")[1]?.split("/")[0] || "");
}

interface RosterSigner { name: string; status: string; signedAt?: string | null }

export default function ContractSigningPage() {
  const [location] = useLocation();
  const token = tokenFromPath(location);
  const [signature, setSignature] = useState("");
  // A `/sign/contracts/<token>/status` URL is the redirect target after signing
  // in Documenso. Hit the matching `/status` API variant so the server runs its
  // Documenso status sync before returning — otherwise the page can show a
  // stale "ready to sign" state (or, previously, nothing) right after signing.
  const isStatusReturn = /\/sign\/contracts\/[^/]+\/status/.test(location);

  const contractQuery = useQuery<any>({
    queryKey: ["/api/signing/contracts", token, isStatusReturn ? "status" : "view"],
    queryFn: async () => {
      const res = await fetch(`/api/public/sign/contracts/${encodeURIComponent(token)}${isStatusReturn ? "/status" : ""}`);
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
    // On the post-signing return, briefly poll so a just-completed final signature
    // flips this page to the fully-signed state without a manual reload. Stops once
    // the contract is fully signed (or after react-query's default staleness window
    // via the callback returning false).
    refetchInterval: (query: any) => {
      const data = query?.state?.data;
      return isStatusReturn && data && data.state !== "fully_signed" && data.state !== "expired_or_canceled" ? 5000 : false;
    },
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

  const isPostDocumensoReturn = location.includes("/status") || location.includes("signed=1");

  if (contractQuery.isError) {
    const error = contractQuery.error as Error & { state?: string; status?: number };
    // A post-signing return that hit a transient error must NEVER be a blank page or a
    // scary "invalid link" — the signer very likely did sign; show a recoverable
    // "we're confirming" state instead.
    if (isPostDocumensoReturn && (error.status === undefined || error.status >= 500 || error.state === "server_error")) {
      return (
        <SigningShell>
          <Alert data-testid="public-contract-signing-status">
            <Clock className="h-4 w-4" />
            <AlertTitle>Signature received</AlertTitle>
            <AlertDescription>We are confirming completion with the signing provider. You can close this page — a copy of the signed contract is emailed to every signer once all parties have signed.</AlertDescription>
          </Alert>
        </SigningShell>
      );
    }
    const title = error.state === "expired_link" || error.state === "expired_or_canceled" ? "Signing link expired"
      : error.state === "already_signed" ? "Already signed"
      : error.state === "fully_signed" ? "Contract fully signed"
      : error.status && error.status >= 500 ? "Signing service unavailable"
      : "Invalid signing link";
    return <SigningShell><ErrorState title={title} message={error.message || "This signing link could not be loaded. Please contact the sender for a new link."} /></SigningShell>;
  }

  if (completeMutation.isSuccess) {
    return <SigningShell><Alert><CheckCircle className="h-4 w-4" /><AlertTitle>Signature received</AlertTitle><AlertDescription>Your contract signature has been recorded.</AlertDescription></Alert></SigningShell>;
  }

  const contract = contractQuery.data || {};
  const state = typeof contract.state === "string" ? contract.state : (isPostDocumensoReturn ? "pending_signature" : "missing_contract");
  const roster: RosterSigner[] = Array.isArray(contract.signers) ? contract.signers : [];
  const remaining: string[] = Array.isArray(contract.remainingSigners) ? contract.remainingSigners : [];
  const viewerSigned = !!contract.viewerSigned;
  const message = typeof contract.message === "string" ? contract.message : "Signature received. We are confirming completion.";

  // ── Fully signed ──────────────────────────────────────────────────────────
  if (state === "fully_signed") {
    return (
      <SigningShell>
        <Alert data-testid="public-contract-signing-status">
          <CheckCircle className="h-4 w-4" />
          <AlertTitle>This document is fully signed</AlertTitle>
          <AlertDescription>{message} A copy has been emailed to every signer.</AlertDescription>
        </Alert>
        {roster.length > 0 && <SignerRoster signers={roster} className="mt-4" />}
        {contract.completedDocumentUrl && (
          <Button asChild className="mt-4" data-testid="button-open-signed-document">
            <a href={contract.completedDocumentUrl} target="_blank" rel="noopener noreferrer">View signed document <ExternalLink className="ml-2 h-4 w-4" /></a>
          </Button>
        )}
      </SigningShell>
    );
  }

  // ── Viewer has signed, others still pending ───────────────────────────────
  if (viewerSigned || state === "already_signed") {
    return (
      <SigningShell>
        <Alert data-testid="public-contract-signing-status">
          <CheckCircle className="h-4 w-4" />
          <AlertTitle>You have signed this document</AlertTitle>
          <AlertDescription>
            {remaining.length > 0
              ? `Waiting on ${remaining.length} other signer${remaining.length === 1 ? "" : "s"}. You'll receive the fully signed contract by email once everyone has signed.`
              : "We are finalizing the fully signed contract. A copy will be emailed to every signer."}
          </AlertDescription>
        </Alert>
        {roster.length > 0 && <SignerRoster signers={roster} className="mt-4" />}
      </SigningShell>
    );
  }

  // ── Expired / canceled ───────────────────────────────────────────────────
  if (["expired_or_canceled", "expired_link", "invalid_link", "missing_contract"].includes(state)) {
    return <SigningShell><ErrorState title={state === "expired_link" ? "Signing link expired" : state === "invalid_link" || state === "missing_contract" ? "Invalid signing link" : "Signing link inactive"} message={message} /></SigningShell>;
  }

  // ── Documenso in-flight (provider handles the actual signing) ─────────────
  if (state === "documenso_unavailable" || state === "documenso_managed") {
    return (
      <SigningShell>
        <Alert data-testid="public-contract-signing-status">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Signing continues in Documenso</AlertTitle>
          <AlertDescription>
            {message || "Please complete signing in the Documenso email you received. This page will reflect the result once Documenso confirms."}
            {contract.documensoSigningUrl ? (
              <span className="mt-3 block"><a className="underline" href={contract.documensoSigningUrl} rel="noopener noreferrer">Open the Documenso signing page</a></span>
            ) : null}
          </AlertDescription>
        </Alert>
        {roster.length > 0 && <SignerRoster signers={roster} className="mt-4" />}
      </SigningShell>
    );
  }

  // ── Any post-signing return that didn't resolve to a terminal state above:
  //    neutral "confirming" message + the roster — never blank, never the form.
  if (isPostDocumensoReturn && state !== "pending_signature") {
    return (
      <SigningShell>
        <Alert data-testid="public-contract-signing-status"><Clock className="h-4 w-4" /><AlertTitle>Signature received</AlertTitle><AlertDescription>{message || "Signature received. We are confirming completion — you can close this page."}</AlertDescription></Alert>
        {roster.length > 0 && <SignerRoster signers={roster} className="mt-4" />}
      </SigningShell>
    );
  }
  if (isPostDocumensoReturn && state === "pending_signature" && !contract.canSign) {
    return (
      <SigningShell>
        <Alert data-testid="public-contract-signing-status"><Clock className="h-4 w-4" /><AlertTitle>Signature received</AlertTitle><AlertDescription>We are confirming completion.</AlertDescription></Alert>
        {roster.length > 0 && <SignerRoster signers={roster} className="mt-4" />}
      </SigningShell>
    );
  }

  // ── Documenso signing link available ─────────────────────────────────────
  if (contract.documensoSigningUrl && state === "pending_signature") {
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
          {roster.length > 0 && <SignerRoster signers={roster} />}
        </div>
      </SigningShell>
    );
  }

  // ── Only offer the manual signature form for a genuinely signable state ──
  if (state !== "pending_signature") {
    return (
      <SigningShell>
        <Alert data-testid="public-contract-signing-status"><FileSignature className="h-4 w-4" /><AlertTitle>{contract.title || "Contract signing"}</AlertTitle><AlertDescription>{message || "This signing link is not currently actionable. Please contact the sender if you expected to sign here."}</AlertDescription></Alert>
        {roster.length > 0 && <SignerRoster signers={roster} className="mt-4" />}
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
        {roster.length > 0 && <SignerRoster signers={roster} />}
      </div>
    </SigningShell>
  );
}

function SignerRoster({ signers, className }: { signers: RosterSigner[]; className?: string }) {
  return (
    <div className={`rounded-lg border p-3 ${className || ""}`} data-testid="public-contract-signer-roster">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Signers</p>
      <ul className="space-y-1.5">
        {signers.map((s, i) => {
          const signed = s.status === "signed";
          return (
            <li key={i} className="flex items-center justify-between text-sm" data-testid={`public-contract-signer-${i}`}>
              <span className="flex items-center gap-2">
                {signed ? <CheckCircle className="h-4 w-4 text-green-600" /> : <Clock className="h-4 w-4 text-muted-foreground" />}
                {s.name}
              </span>
              <span className={signed ? "text-green-600 text-xs font-medium" : "text-muted-foreground text-xs"}>
                {signed ? "Signed" : s.status === "pending" ? "Awaiting signature" : s.status}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SigningShell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-muted/30 p-4"><Card className="mx-auto mt-10 max-w-2xl"><CardHeader><CardTitle>MyPayLink Contract Signing</CardTitle></CardHeader><CardContent>{children}</CardContent></Card></main>;
}

function ErrorState({ title, message }: { title: string; message: string }) {
  return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>{title}</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>;
}
