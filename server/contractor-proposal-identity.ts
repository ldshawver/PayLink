/**
 * Pure, dependency-free identity-reconciliation logic for the contractor
 * proposal and contract-signer flows. Extracted out of server/routes.ts so
 * this logic can be exercised directly by tests without standing up the
 * Express app (routes.ts handlers are not otherwise exported/importable).
 *
 * Background: a staging E2E test found that a proposal could silently
 * resolve to an unrelated existing contractor ("LUX Contractor") instead of
 * the contractor the operator actually selected, because the client-side
 * contractor list was not scoped to the selected company and the server
 * silently derived the proposal's company from whichever contractor ended
 * up selected, without checking that against what the operator saw in the
 * UI. The functions below make that reconciliation explicit and rejectable
 * instead of silent.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export interface WorkerLike {
  id: string;
  workerType: string | null;
  companyId: string | null;
}

export type ReconcileResult =
  | { ok: true; workerId: string; companyId: string }
  | { ok: false; status: number; message: string };

/**
 * Reconciles the client-supplied contractor selection (and, if present, the
 * client-supplied company selection) against the authoritative contractor
 * record. The contractor's own companyId is always the source of truth for
 * which company a proposal belongs to. If the client also sent a companyId
 * that disagrees with it, that is a client/server identity mismatch and
 * must be rejected rather than silently overridden.
 */
export function reconcileProposalContractor(
  requestedContractorId: unknown,
  requestedCompanyId: unknown,
  targetWorker: WorkerLike | undefined,
): ReconcileResult {
  if (!isValidUuid(requestedContractorId)) {
    return { ok: false, status: 400, message: "A valid contractor must be selected." };
  }
  if (!targetWorker) {
    return { ok: false, status: 404, message: "Contractor not found" };
  }
  if (targetWorker.workerType !== "contractor") {
    return { ok: false, status: 400, message: "Target worker is not a contractor" };
  }
  if (!targetWorker.companyId) {
    return { ok: false, status: 400, message: "Contractor has no company assigned" };
  }
  if (
    typeof requestedCompanyId === "string" &&
    requestedCompanyId.length > 0 &&
    requestedCompanyId !== targetWorker.companyId
  ) {
    return {
      ok: false,
      status: 409,
      message:
        "Selected contractor does not belong to the selected company. Refusing to create a proposal with mismatched contractor/company identity.",
    };
  }
  return { ok: true, workerId: targetWorker.id, companyId: targetWorker.companyId };
}

export interface ContractorProfileLike {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  workEmail: string | null;
}

export function normalizeEmailForCompare(email: string | null | undefined): string {
  return (email || "").trim().toLowerCase();
}

export type SignerIdentityResult =
  | { ok: true; name: string; email: string; workerId: string }
  | { ok: false; status: number; message: string };

/**
 * Enforces that a "contractor" role signer's identity always matches the
 * contract's own contractor profile. There is currently no authorized
 * override workflow (role + reason + audit record) for this identity, so
 * any mismatch is blocked outright rather than silently accepted or
 * "auto-corrected" — only call this when signerRole === "contractor".
 */
export function resolveContractorSignerIdentity(
  contractContractorId: string | null | undefined,
  requestedWorkerId: string | null | undefined,
  requestedEmail: string | null | undefined,
  contractorProfile: ContractorProfileLike | undefined,
): SignerIdentityResult {
  if (!contractContractorId || !contractorProfile) {
    return { ok: false, status: 400, message: "Contract has no linked contractor profile to derive a signer from." };
  }
  const profileEmail = contractorProfile.email || contractorProfile.workEmail || null;
  if (!profileEmail) {
    return {
      ok: false,
      status: 400,
      message: "The contractor profile has no email on file. Add one before requesting a signature.",
    };
  }
  if (requestedWorkerId && requestedWorkerId !== contractContractorId) {
    return {
      ok: false,
      status: 400,
      message: "Contractor signer must match this contract's own contractor. No authorized override is currently supported.",
    };
  }
  if (requestedEmail && normalizeEmailForCompare(requestedEmail) !== normalizeEmailForCompare(profileEmail)) {
    return {
      ok: false,
      status: 400,
      message:
        "Contractor signer email must match the contractor's profile email. No authorized override is currently supported for this field.",
    };
  }
  const name = `${contractorProfile.firstName || ""} ${contractorProfile.lastName || ""}`.trim();
  if (!name) {
    return { ok: false, status: 400, message: "The contractor profile has no name on file." };
  }
  return { ok: true, name, email: profileEmail, workerId: contractContractorId };
}
