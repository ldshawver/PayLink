/**
 * Builds the post-create confirmation shown after POST /api/workers succeeds.
 * Must be derived only from the server's persisted response (never a
 * client-side draft/temp value) so the user gets authoritative proof a real
 * row was created: its real UUID, and its company resolved from the
 * authoritative /api/companies list rather than any locally-typed value.
 *
 * There is no per-worker profile route in this UI (workers are viewed/edited
 * via an in-page dialog, not a navigable URL), so the UUID is surfaced in the
 * toast text itself rather than as a link.
 */
export interface CreatedWorkerSummary {
  id: string;
  firstName: string;
  lastName: string;
  companyId: string | null;
  workerType: string | null;
}

export interface CompanyRef {
  id: string;
  name: string;
}

export interface WorkerCreatedConfirmation {
  title: string;
  description: string;
}

export function buildWorkerCreatedConfirmation(
  worker: CreatedWorkerSummary,
  companies: CompanyRef[],
): WorkerCreatedConfirmation {
  const company = companies.find((c) => c.id === worker.companyId);
  const typeLabel = worker.workerType === "employee" ? "Employee" : "Contractor";
  return {
    title: "Worker created",
    description: `${worker.firstName} ${worker.lastName} · ${company?.name ?? "Unknown company"} · ${typeLabel} · ID ${worker.id}`,
  };
}
