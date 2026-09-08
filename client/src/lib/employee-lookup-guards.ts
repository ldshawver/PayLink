/**
 * Defensive guards for the Employee dialogs (employee-add freeze hardening).
 *
 * Two failure modes took out the whole page from inside the Add/Edit Employee
 * modal, because a throw during render in a modal with no local error boundary
 * unmounts the app shell:
 *
 *   1. A lookup query (`/api/employee-titles`, `/api/departments`, …) resolving
 *      to a non-array body — an error object served with a 200, a
 *      `{ rows: [...] }` envelope — reached `.map()` and threw
 *      "x.map is not a function".
 *   2. A lookup row with a missing / null / empty `id` reached
 *      `<SelectItem value="">`, which Radix rejects by throwing
 *      "A <Select.Item /> must have a value prop that is not an empty string".
 *
 * Pure and dependency-free so it can be unit-tested directly.
 */

/** Always return an array. A non-array input (object, null, undefined) becomes `[]`. */
export function asList<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

/**
 * Keep only entries that are safe to render as `<SelectItem value={o.id}>`:
 * a real, non-empty string `id`. Everything else (blank id, numeric id, null
 * entry, non-array input) is dropped rather than allowed to crash the dialog.
 */
export function selectableOptions<T extends { id?: unknown }>(data: unknown): T[] {
  return asList<T>(data).filter(
    (o): o is T => !!o && typeof (o as { id?: unknown }).id === "string" && (o as { id: string }).id.length > 0,
  );
}
