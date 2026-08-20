/**
 * Single source of truth for worker/contractor type validity and the
 * pay-rate requirement rule, imported by BOTH the client (pre-submit
 * validation, so the user gets an immediate, type-specific message) and the
 * server (POST /api/workers, the authoritative enforcement) so the two can
 * never semantically diverge on what "blank Pay Rate is OK" means.
 *
 * Moved from server/worker-pay-rate.ts (PR #77) into shared/ during PR #77
 * staging validation, after a "Pay rate is required" rejection for an
 * Invoiced Contractor (1099) prompted an explicit audit of whether the UI
 * label and the server's accepted enum values actually agreed. They did —
 * this move doesn't change that mapping, it makes it structurally
 * impossible for client and server to drift apart on it in the future, and
 * adds independent server-side validation of worker_type/contractor_type
 * (previously only contractor_type was validated).
 *
 * pay_rate is NOT NULL at the DB layer (workers.pay_rate NUMERIC NOT NULL
 * DEFAULT '0'), but Postgres only applies that column default when the
 * column is omitted from an INSERT — never when it's present with an
 * explicit null. Only an invoiced 1099 contractor legitimately has no fixed
 * rate (paid per invoice, not a rate) — employees and hourly contractors
 * must still supply one.
 */

export const WORKER_TYPES = ["employee", "contractor"] as const;
export type WorkerType = (typeof WORKER_TYPES)[number];

export const CONTRACTOR_TYPES = ["hourly", "invoice"] as const;
export type ContractorType = (typeof CONTRACTOR_TYPES)[number];

export function isValidWorkerType(value: unknown): value is WorkerType {
  return typeof value === "string" && (WORKER_TYPES as readonly string[]).includes(value);
}

export function isValidContractorType(value: unknown): value is ContractorType {
  return typeof value === "string" && (CONTRACTOR_TYPES as readonly string[]).includes(value);
}

/** Only an invoiced 1099 contractor has no fixed rate — paid per invoice. */
export function isPayRateRequired(workerType: unknown, contractorType: unknown): boolean {
  return !(workerType === "contractor" && contractorType === "invoice");
}

export interface WorkerPayRateInput {
  workerType?: string | null;
  contractorType?: string | null;
  payRate?: string | number | null;
}

export type WorkerPayRateResult =
  | { ok: true; payRate: string }
  | { ok: false; message: string };

export function normalizeWorkerPayRate(input: WorkerPayRateInput): WorkerPayRateResult {
  const isBlank = input.payRate === null || input.payRate === undefined || input.payRate === "";

  if (isBlank) {
    if (!isPayRateRequired(input.workerType, input.contractorType)) {
      return { ok: true, payRate: "0" };
    }
    return { ok: false, message: "Pay rate is required" };
  }

  const parsed = Number(input.payRate);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, message: "Pay rate must be a valid non-negative number" };
  }
  return { ok: true, payRate: String(input.payRate) };
}
