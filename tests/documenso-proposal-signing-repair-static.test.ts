/**
 * Documenso proposal/signing repair — static wiring checks.
 * Run: npx tsx tests/documenso-proposal-signing-repair-static.test.ts
 *
 * 1. POST /api/contractor-proposals/:id/send no longer uses `= ANY(${jsArray})`
 *    (drizzle renders it as `ANY(($2,$3,$4))` — a row constructor Postgres
 *    rejects — which threw on every /send and was swallowed as a generic 500).
 * 2. That catch now logs the real error.
 * 3. createDocumensoDocument merges recipient ids from /envelope/create.
 * 4. The public /sign/contracts/ route is wrapped in an error boundary
 *    (blank-page fix) and the status page hits the /status API variant.
 * 5. The Documenso contract diagnostic ignores email-less signer rows.
 */
import fs from "node:fs";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d?: string) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}${d ? ` — ${d}` : ""}`); } };

const routes = fs.readFileSync("server/routes.ts", "utf8");
const documenso = fs.readFileSync("server/services/documenso.ts", "utf8");
const app = fs.readFileSync("client/src/App.tsx", "utf8");
const page = fs.readFileSync("client/src/pages/contract-signing.tsx", "utf8");

console.log("1. proposal /send SQL fix");
{
  // the buggy pattern is gone from the /send transition
  const sendRoute = routes.slice(routes.indexOf('app.post("/api/contractor-proposals/:id/send"'), routes.indexOf('app.post("/api/contractor-proposals/:id/send"') + 4000);
  // ignore comment lines — the fix keeps an explanatory comment that names the old form
  const sendSql = sendRoute.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  ok("no executable `status = ANY(${PRE_SEND_STATUSES})` in the /send route", !/status\s*=\s*ANY\(\$\{PRE_SEND_STATUSES\}\)/.test(sendSql));
  ok("/send uses `status IN (${preSendList})` with sql.join", /sql\.join\(PRE_SEND_STATUSES\.map/.test(sendSql) && /status IN \(\$\{preSendList\}\)/.test(sendSql));
}
{
  // prove the NEW query renders valid SQL (IN with individual params), and the OLD one does not
  const PRE = ["draft", "internal_review", "submitted"];
  const d = new PgDialect();
  const good = d.sqlToQuery(sql`UPDATE contractor_proposals SET status='sent' WHERE id = ${"x"} AND status IN (${sql.join(PRE.map((s) => sql`${s}`), sql`, `)})`);
  ok("fixed query → `status in ($2, $3, $4)` (valid)", /status in \(\$2, \$3, \$4\)/i.test(good.sql), good.sql);
  const bad = d.sqlToQuery(sql`... AND status = ANY(${PRE})`);
  ok("(regression witness) old form → `ANY(($2, $3, $4))` — a row constructor", /ANY\(\(\$1, \$2, \$3\)\)/.test(bad.sql), bad.sql);
}
ok("2. the /send catch now logs the real error", /\[Proposals\] \/send failed for \$\{req\.params\.id\}:/.test(routes));
{
  // no `= ANY(${jsIdentifier})` bare-array interpolation in executable code.
  // `ANY(ARRAY[${sql.raw(...)}])` is the correct pattern and is allowed.
  const execLines = routes.split("\n").filter((l) => !l.trim().startsWith("//"));
  const bad = execLines.filter((l) => /=\s*ANY\(\$\{[A-Za-z_]/.test(l) && !/ANY\(ARRAY\[/.test(l));
  ok("no `= ANY(${jsArray})` bare interpolation anywhere in routes.ts", bad.length === 0, bad.join(" | "));
}

console.log("\n3. createDocumensoDocument recipient-id merge");
ok("mergeDocumensoRecipientSources is exported", /export function mergeDocumensoRecipientSources\(/.test(documenso));
ok("createDocumensoDocument uses the merge (distributed first, created fallback)",
  /signingLinks: mergeDocumensoRecipientSources\(distributed\?\.recipients, created\?\.recipients\)/.test(documenso));
ok("merge is pure — no fetch/apiJson inside the helper body",
  (() => {
    const body = documenso.slice(documenso.indexOf("export function mergeDocumensoRecipientSources"), documenso.indexOf("export async function createDocumensoDocument"));
    return !/fetch\(|apiJson\(/.test(body);
  })());

console.log("\n4. blank status page — error boundary + /status fetch");
ok("App.tsx wraps the /sign/contracts/ route in <AppErrorBoundary>",
  /location\.startsWith\("\/sign\/contracts\/"\)[\s\S]{0,400}<AppErrorBoundary area="public_contract_signing">/.test(app));
ok("status page fetches the /status API variant on a /status URL",
  /isStatusReturn\s*=\s*\/\\\/sign\\\/contracts\\\/\[\^\/\]\+\\\/status\//.test(page) || /isStatusReturn/.test(page));
ok("status page appends `/status` to the fetch URL when isStatusReturn",
  /\/api\/public\/sign\/contracts\/\$\{encodeURIComponent\(token\)\}\$\{isStatusReturn \? "\/status" : ""\}/.test(page));
ok("status page has a non-blank fallback for post-signing returns + unknown states",
  /if \(isPostDocumensoReturn && state[\s\S]{0,300}Signature received/.test(page)
  && /if \(state !== "pending_signature"\)/.test(page));
ok("documenso_unavailable / documenso_managed render an informational panel (not the sign form)",
  /state === "documenso_unavailable" \|\| state === "documenso_managed"/.test(page));

console.log("\n5. Documenso contract diagnostic ignores email-less signers");
ok("the /api/app-doctor/diagnostics contract-signers join excludes blank emails",
  /LEFT JOIN contract_signers cs ON cs\.contract_id = c\.id[\s\S]{0,240}cs\.email IS NOT NULL AND btrim\(cs\.email\) <> ''/.test(routes));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
