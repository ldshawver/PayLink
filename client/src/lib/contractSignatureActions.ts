export const CONTRACT_SIGNATURE_ACTION_STATUSES = ["draft", "pending", "awaiting_signatures", "sent", "partially_signed"] as const;
export const CONTRACT_SIGNATURE_TERMINAL_STATUSES = ["active", "completed", "fully_signed", "void", "terminated"] as const;

const CONTRACT_SIGNATURE_ACTION_STATUS_SET = new Set<string>(CONTRACT_SIGNATURE_ACTION_STATUSES);

export function isContractSignatureActionRole(role: string | null | undefined): boolean {
  const normalized = String(role || "").toLowerCase();
  return normalized === "admin"
    || normalized === "owner"
    || normalized === "manager"
    || normalized === "global_admin"
    || normalized === "platform_super_admin"
    || normalized === "platform_admin"
    || normalized.startsWith("tenant_")
    || normalized.startsWith("platform_");
}

export function canShowContractSignatureActions(role: string | null | undefined, status: string | null | undefined): boolean {
  return isContractSignatureActionRole(role) && CONTRACT_SIGNATURE_ACTION_STATUS_SET.has(String(status || "").toLowerCase());
}

// Mirrors the server-side `usesDocumenso` check in contractor-hub.tsx: true once any Documenso
// signing data exists for this contract, regardless of current status.
export function isDocumensoManagedContract(contract: {
  documensoSigningUrl?: string | null;
  documensoDocumentId?: string | null;
} | null | undefined, signers: ReadonlyArray<{ documensoSigningUrl?: string | null; documenso_signing_url?: string | null; documensoRecipientId?: string | null; documenso_recipient_id?: string | null }> = []): boolean {
  if (!contract) return false;
  if (contract.documensoSigningUrl || contract.documensoDocumentId) return true;
  return signers.some((s) => !!s.documensoSigningUrl || !!s.documenso_signing_url || !!s.documensoRecipientId || !!s.documenso_recipient_id);
}

// Manual "Activate" is reserved for imported/manual contracts. A Documenso-backed contract
// activates automatically once signing is verified — offering manual Activate as a workaround
// would bypass that verification instead of fixing the underlying sync gap.
export function canManuallyActivateContract(params: { role: string | null | undefined; status: string | null | undefined; documensoManaged: boolean }): boolean {
  if (!isContractSignatureActionRole(params.role)) return false;
  if (params.documensoManaged) return false;
  return ["pending", "sent", "partially_signed", "fully_signed"].includes(String(params.status || "").toLowerCase());
}

export function getDocumensoDisabledReason(params: {
  role: string | null | undefined;
  signerCount: number;
  signerEmailCount?: number;
  isPending?: boolean;
}): string | null {
  if (!isContractSignatureActionRole(params.role)) return "Only admins, managers, and global admins can send contracts for Documenso signature";
  if (params.signerCount === 0 || params.signerEmailCount === 0) return "Add at least one signer with an email before sending.";
  if (params.isPending) return "Sending Documenso request...";
  return null;
}


export function buildContractorHubProposalRoute(proposalId: string): string {
  return `/app/contractor-hub?section=proposals&id=${encodeURIComponent(proposalId)}`;
}

export function buildContractorHubInvoiceRoute(invoiceId: string): string {
  return `/app/contractor-hub?section=invoices&id=${encodeURIComponent(invoiceId)}`;
}

export function buildContractSigningTokenRoute(token: string): string {
  return `/sign/contracts/${encodeURIComponent(token)}`;
}
