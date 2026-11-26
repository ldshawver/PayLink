/**
 * Per-company employee numbers (YYNN).
 *
 * Extracted from the unmerged company-scoped sign-in work so worker creation
 * can allocate numbers without that PR's PIN hashing or sign-in codes.
 * Existing numbers are never renumbered. A supplied number is stored as-is;
 * the unique index from migration 0041 rejects a duplicate in the same company.
 *
 * Call this inside the same transaction as the worker insert. The counter row
 * is locked (SELECT … FOR UPDATE) once migration 0041 has created
 * employee_number_counters. Before that migration, a transaction-scoped
 * advisory lock serializes allocation for the company. The value never goes
 * below the company's highest existing YYNN for that year. Numbers already
 * taken (for example entered manually) are skipped. Exhaustion (YY99) raises
 * — the format is never silently changed and numbers are never reused.
 */
import { sql } from "drizzle-orm";

type Exec = { execute: (q: any) => Promise<any> };
const first = <T,>(r: any): T | undefined => (Array.isArray(r) ? r[0] : r?.rows?.[0]);

export class EmployeeNumberExhaustedError extends Error {
  status = 409;
  constructor(yy: string) {
    super(`All employee numbers for 20${yy} are in use (${yy}01–${yy}99) for this company. Enter an employee number manually or contact support.`);
  }
}

export async function allocateEmployeeNumber(tx: Exec, companyId: string, now: Date = new Date()): Promise<string> {
  const yy = String(now.getUTCFullYear() % 100).padStart(2, "0");
  const pattern = `^${yy}\\d{2}$`;
  const hasCounters = first<{ ok: boolean }>(await tx.execute(sql`SELECT to_regclass('public.employee_number_counters') IS NOT NULL AS ok`))?.ok;
  if (!hasCounters) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"employee-number:" + companyId}))`);
  } else {
    await tx.execute(sql`
      INSERT INTO employee_number_counters (company_id, year_prefix, last_value)
      VALUES (${companyId}, ${yy}, 0) ON CONFLICT (company_id, year_prefix) DO NOTHING`);
  }
  const counter = hasCounters
    ? first<{ last_value: number }>(await tx.execute(sql`
        SELECT last_value FROM employee_number_counters WHERE company_id = ${companyId} AND year_prefix = ${yy} FOR UPDATE`))
    : { last_value: 0 };
  const maxExisting = first<{ m: number | null }>(await tx.execute(sql`
    SELECT max(substr(employee_number, 3, 2)::int) AS m FROM workers
     WHERE company_id = ${companyId} AND employee_number ~ ${pattern}`))?.m ?? 0;
  let next = Math.max(counter?.last_value ?? 0, maxExisting ?? 0) + 1;
  while (next <= 99) {
    const candidate = `${yy}${String(next).padStart(2, "0")}`;
    const taken = first(await tx.execute(sql`SELECT 1 FROM workers WHERE company_id = ${companyId} AND employee_number = ${candidate} LIMIT 1`));
    if (!taken) {
      if (hasCounters) {
        await tx.execute(sql`UPDATE employee_number_counters SET last_value = ${next}, updated_at = now() WHERE company_id = ${companyId} AND year_prefix = ${yy}`);
      }
      return candidate;
    }
    next++;
  }
  throw new EmployeeNumberExhaustedError(yy);
}

/** Postgres unique violation on the per-company employee-number index. */
export function isEmployeeNumberConflict(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string; message?: string; cause?: any };
  const c = err?.code ?? err?.cause?.code;
  const name = err?.constraint ?? err?.cause?.constraint ?? "";
  return c === "23505" && (name === "uq_workers_company_employee_number" || /uq_workers_company_employee_number/.test(String(err?.message ?? err?.cause?.message ?? "")));
}

export const EMPLOYEE_NUMBER_CONFLICT_MESSAGE = "That employee number is already in use in this company.";
