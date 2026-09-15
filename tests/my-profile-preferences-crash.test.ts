/**
 * My Profile "Preferences" crash hardening.
 *
 * `PreferencesTab` (client/src/pages/my-profile.tsx, the page's default tab)
 * did `JSON.parse(worker.preferences || "{}")` with no try/catch and no local
 * error boundary. Any worker whose `preferences` text column held a value
 * that isn't valid JSON — including a raw client-supplied value, since
 * `PATCH /api/my/worker` had `preferences` in its self-edit whitelist with no
 * JSON validation, unlike the dedicated `PATCH /api/my/preferences` — would
 * throw on every load of My Profile, read by the app-wide error boundary
 * (client/src/App.tsx `AppErrorBoundary area="tenant_app"`) as the whole app
 * having crashed. Same failure class as the employee-add-freeze bug (see
 * tests/employee-add-freeze-hardening.test.ts): a render-time throw with
 * nothing local to catch it.
 *
 * Run: npx tsx tests/my-profile-preferences-crash.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { safeParseWorkerPreferences } from "../client/src/lib/worker-preferences";

let pass = 0;
let fail = 0;
function ok(name: string, result: boolean, detail?: string) {
  if (result) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("safeParseWorkerPreferences");
ok("parses a valid JSON object string", safeParseWorkerPreferences('{"language":"es"}').language === "es");
ok("null becomes {}", Object.keys(safeParseWorkerPreferences(null)).length === 0);
ok("undefined becomes {}", Object.keys(safeParseWorkerPreferences(undefined)).length === 0);
ok("empty string becomes {}", Object.keys(safeParseWorkerPreferences("")).length === 0);
ok("malformed JSON becomes {} instead of throwing", (() => {
  try { return Object.keys(safeParseWorkerPreferences("not json")).length === 0; }
  catch { return false; }
})());
ok("plain legacy text becomes {} instead of throwing", (() => {
  try { return Object.keys(safeParseWorkerPreferences("Prefers morning shifts")).length === 0; }
  catch { return false; }
})());
ok("a JSON array becomes {} (an object is expected, not a list)", (() => {
  const out = safeParseWorkerPreferences("[1,2,3]");
  return !Array.isArray(out) && Object.keys(out).length === 0;
})());
ok("a bare JSON string literal becomes {}", (() => {
  const out = safeParseWorkerPreferences('"just a string"');
  return typeof out === "object" && !Array.isArray(out) && Object.keys(out).length === 0;
})());

console.log("\nclient wiring (client/src/pages/my-profile.tsx)");
const page = fs.readFileSync("client/src/pages/my-profile.tsx", "utf8");
ok("imports safeParseWorkerPreferences", /import \{ safeParseWorkerPreferences \} from "@\/lib\/worker-preferences"/.test(page));
ok("PreferencesTab uses the safe parser, not a raw JSON.parse", (() => {
  const tab = page.slice(page.indexOf("function PreferencesTab"), page.indexOf("function PreferencesTab") + 2000);
  return /safeParseWorkerPreferences\(worker\.preferences\)/.test(tab) && !/JSON\.parse\(worker\.preferences/.test(tab);
})());

console.log("\nserver wiring (server/routes.ts)");
const routes = fs.readFileSync("server/routes.ts", "utf8");
{
  const start = routes.indexOf('app.patch("/api/my/worker"');
  const end = routes.indexOf('app.patch("/api/my/preferences"');
  ok("found PATCH /api/my/worker", start > -1 && end > start);
  const block = routes.slice(start, end);
  ok("ALLOWED_SELF_EDIT no longer whitelists the raw, unvalidated preferences field",
    !/"preferences"/.test(block));
  ok("the dedicated, JSON-validated /api/my/preferences endpoint is unchanged and still present",
    /const existing = JSON\.parse\(worker\.preferences \|\| "\{\}"\);/.test(routes));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
