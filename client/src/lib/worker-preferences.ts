/**
 * Defensive parse for `worker.preferences` (My Profile crash hardening).
 *
 * `preferences` is a free-text column written by two paths: the dedicated
 * `PATCH /api/my/preferences` endpoint (JSON.parse/merge/JSON.stringify,
 * always a valid JSON object string) and, historically, `PATCH /api/my/worker`,
 * which passed a client-supplied `preferences` value straight to storage with
 * no JSON validation. Either an old bad write or `worker.preferences` being
 * null/blank/legacy plain text left `JSON.parse(worker.preferences || "{}")`
 * one bad record away from throwing during render. My Profile has no local
 * error boundary, and its default tab (`?tab=preferences`, or no `tab` at
 * all) is `PreferencesTab` — so that throw took out the whole page on load,
 * the same failure class as the employee-add-freeze bug
 * (see employee-lookup-guards.ts): a render-time throw with nothing local to
 * catch it reads to the user as the app freezing.
 *
 * Pure and dependency-free so it can be unit-tested directly.
 */
export function safeParseWorkerPreferences(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
