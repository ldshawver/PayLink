export const CONTRACT_SIGNATURE_ACTION_STATUSES = ["draft", "pending", "awaiting_signatures"] as const;

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

export function getDocumensoDisabledReason(params: {
  role: string | null | undefined;
  signerCount: number;
  isPending?: boolean;
}): string | null {
  if (!isContractSignatureActionRole(params.role)) return "Only admins, managers, and global admins can send contracts for Documenso signature";
  if (params.signerCount === 0) return "Add at least one signer with an email before sending via Documenso";
  if (params.isPending) return "Sending Documenso request...";
  return null;
}
