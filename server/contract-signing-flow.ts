export interface ContractSigningAuthInput {
  isContractor: boolean;
  isAdmin: boolean;
  isPlatformAdmin: boolean;
  userCompanyMatches: boolean;
  hasExplicitCompanyAccess: boolean;
  hasRegisteredSigner: boolean;
}

export function canSignContract(input: ContractSigningAuthInput): boolean {
  const isCompanyAdmin = input.isAdmin && (
    input.isPlatformAdmin || input.userCompanyMatches || input.hasExplicitCompanyAccess
  );
  return input.isContractor || isCompanyAdmin || input.hasRegisteredSigner;
}

export function buildContractSigningUrl(baseUrl: string, token: string): string {
  const safeBase = String(baseUrl || "").replace(/\/+$/, "");
  return `${safeBase}/sign/contracts/${encodeURIComponent(token)}`;
}

export function buildAuthenticatedContractSigningUrl(baseUrl: string, contractId: string): string {
  const safeBase = String(baseUrl || "").replace(/\/+$/, "");
  return `${safeBase}/app/contractor-hub/contracts/${encodeURIComponent(contractId)}/sign`;
}

export function buildContractDocumensoReturnUrl(baseUrl: string, tokenOrContractId: string): string {
  const safeBase = String(baseUrl || "").replace(/\/+$/, "");
  return `${safeBase}/sign/contracts/${encodeURIComponent(tokenOrContractId)}/status`;
}

export interface DocumensoSenderIdentityInput {
  user?: { firstName?: string | null; lastName?: string | null; username?: string | null; email?: string | null } | null;
  worker?: { firstName?: string | null; lastName?: string | null; email?: string | null; workEmail?: string | null } | null;
  company?: { name?: string | null; email?: string | null } | null;
}

export interface DocumensoSenderIdentity {
  name: string;
  email: string | null;
  source: "worker" | "user" | "company" | "fallback";
}

function joinedName(firstName?: string | null, lastName?: string | null): string {
  return [firstName, lastName].map(value => String(value || "").trim()).filter(Boolean).join(" ");
}

function normalizedEmail(value?: string | null): string | null {
  const email = String(value || "").trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

export function resolveDocumensoSenderIdentity(input: DocumensoSenderIdentityInput): DocumensoSenderIdentity {
  const workerName = joinedName(input.worker?.firstName, input.worker?.lastName);
  const workerEmail = normalizedEmail(input.worker?.workEmail) || normalizedEmail(input.worker?.email);
  if (workerName || workerEmail) {
    return { name: workerName || input.company?.name?.trim() || "MyPayLink sender", email: workerEmail || normalizedEmail(input.user?.email) || normalizedEmail(input.company?.email), source: "worker" };
  }

  const userName = joinedName(input.user?.firstName, input.user?.lastName) || String(input.user?.username || "").trim();
  const userEmail = normalizedEmail(input.user?.email);
  if (userName || userEmail) {
    return { name: userName || input.company?.name?.trim() || "MyPayLink sender", email: userEmail || normalizedEmail(input.company?.email), source: "user" };
  }

  const companyName = String(input.company?.name || "").trim();
  const companyEmail = normalizedEmail(input.company?.email);
  if (companyName || companyEmail) {
    return { name: companyName || "MyPayLink sender", email: companyEmail, source: "company" };
  }

  return { name: "MyPayLink sender", email: null, source: "fallback" };
}

export interface DocumensoSigningLink {
  email?: string | null;
  token?: string | null;
  recipientId?: string | null;
  signingUrl?: string | null;
}

export function findSignerSpecificDocumensoLink<T extends DocumensoSigningLink>(
  links: readonly T[],
  signer: { email?: string | null; recipientId?: string | null },
): T | null {
  const recipientId = String(signer.recipientId || "").trim();
  if (recipientId) {
    const matches = links.filter(link => String(link.token || link.recipientId || "").trim() === recipientId);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return null;
  }

  const email = normalizedEmail(signer.email);
  if (!email) return null;
  const matches = links.filter(link => normalizedEmail(link.email) === email);
  return matches.length === 1 ? matches[0] : null;
}

export interface ProposalForInvoice {
  id: string;
  contractor_id: string;
  converted_to_invoice_id?: string | null;
  amount?: string | number | null;
  description?: string | null;
  title?: string | null;
  proposal_number?: string | null;
  expiration_date?: string | null;
  line_items?: unknown;
  notes?: string | null;
  job_id?: string | null;
  cost_center_id?: string | null;
  branding_id?: string | null;
}

export interface ContractForInvoice {
  id: string;
  company_id: string;
  contractor_id?: string | null;
  proposal_id?: string | null;
  status?: string | null;
}

export interface AutoInvoiceDeps<TInvoice = { id: string }> {
  countInvoicesForContractor(contractorId: string): Promise<number>;
  findExistingInvoice?(contract: ContractForInvoice, proposal: ProposalForInvoice): Promise<TInvoice | null | undefined>;
  createInvoice(values: Record<string, unknown>): Promise<TInvoice>;
  markProposalConverted(proposalId: string, invoiceId: string): Promise<void>;
}

export async function autoCreateProposalBackedInvoice<TInvoice extends { id?: string }>(
  contract: ContractForInvoice,
  proposal: ProposalForInvoice | null | undefined,
  deps: AutoInvoiceDeps<TInvoice>,
  now = new Date(),
): Promise<TInvoice | null> {
  if (!contract.proposal_id || !proposal || proposal.id !== contract.proposal_id) return null;
  if (proposal.converted_to_invoice_id) return null;
  const existingInvoice = await deps.findExistingInvoice?.(contract, proposal);
  if (existingInvoice?.id) {
    await deps.markProposalConverted(proposal.id, existingInvoice.id);
    return null;
  }

  const invCount = await deps.countInvoicesForContractor(proposal.contractor_id);
  const invoiceNumber = `INV-${String(proposal.contractor_id ?? "").slice(-4).toUpperCase()}-${String(invCount + 1).padStart(4, "0")}`;
  const today = now.toISOString().split("T")[0];
  const invoice = await deps.createInvoice({
    company_id: contract.company_id,
    contractor_id: proposal.contractor_id,
    invoice_number: invoiceNumber,
    invoice_date: today,
    due_date: proposal.expiration_date || null,
    amount: proposal.amount || 0,
    description: proposal.description || proposal.title || null,
    proposal_id: proposal.id,
    contract_id: contract.id,
    proposal_reference: proposal.proposal_number || null,
    line_items: proposal.line_items || null,
    notes: proposal.notes || null,
    status: "submitted",
    is_1099_reportable: true,
    job_id: proposal.job_id || null,
    cost_center_id: proposal.cost_center_id || null,
    branding_id: proposal.branding_id || null,
  });
  if (invoice?.id) await deps.markProposalConverted(proposal.id, invoice.id);
  return invoice ?? null;
}
