/**
 * pay_rate is NOT NULL at the DB layer (workers.pay_rate NUMERIC NOT NULL
 * DEFAULT '0'), but Postgres only applies that column default when the
 * column is omitted from an INSERT — never when it's present with an
 * explicit null. A blank Pay Rate field in the client becomes exactly that
 * explicit null, which previously reached storage.createWorker() unchanged
 * and crashed with a raw 23502 not-null violation (POST /api/workers 500).
 *
 * Only an invoiced 1099 contractor legitimately has no fixed rate (paid per
 * invoice, not a rate) — employees and hourly contractors must still supply
 * one, so a blank value for them is rejected rather than silently zeroed.
 */
export interface WorkerPayRateInput {
  workerType?: string | null;
  contractorType?: string | null;
  payRate?: string | number | null;
}

export type WorkerPayRateResult =
  | { ok: true; payRate: string }
  | { ok: false; message: string };

export function normalizeWorkerPayRate(input: WorkerPayRateInput): WorkerPayRateResult {
  const isInvoicedContractor = input.workerType === "contractor" && input.contractorType === "invoice";
  const isBlank = input.payRate === null || input.payRate === undefined || input.payRate === "";

  if (isBlank) {
    if (isInvoicedContractor) {
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
