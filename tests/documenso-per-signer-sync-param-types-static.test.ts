/**
 * Static regression for the per-signer Documenso sync UPDATE parameter typing.
 *
 * Bug: syncDocumensoContractStatus's per-signer UPDATE bound `${recipientId}` /
 * `${email}` / `${signedAt}` as bare, un-anchored parameters
 * (`${recipientId} IS NOT NULL`, `COALESCE(signed_at, ${signedAt})`). Postgres
 * cannot infer a type for those ("could not determine data type of parameter"),
 * the statement threw, and the throw was swallowed by a bare `.catch(() => ({rows:[]}))`
 * — so pull-sync silently never advanced any signer's status. Every match/insert
 * param is now explicitly cast, and the catch logs instead of swallowing blind.
 *
 * Run: npx tsx tests/documenso-per-signer-sync-param-types-static.test.ts
 */
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
let pass = 0;
const ok = (name: string, cond: boolean) => { if (!cond) throw new Error(`FAIL: ${name}`); pass++; console.log(`PASS: ${name}`); };

// Isolate the per-signer sync UPDATE.
const start = routes.indexOf("async function syncDocumensoContractStatus");
const body = routes.slice(start, routes.indexOf("async function", start + 40));
const updIdx = body.indexOf("UPDATE contract_signers");
const upd = body.slice(updIdx, body.indexOf("RETURNING id", updIdx) + 40);

ok("recipient/email match params are cast to ::text (not bare `IS NOT NULL`)",
  /\$\{recipientIdParam\}::text IS NOT NULL/.test(upd) &&
  /\$\{emailParam\}::text IS NOT NULL/.test(upd) &&
  !/\$\{recipientId\} IS NOT NULL/.test(upd) &&
  !/\$\{email\} IS NOT NULL/.test(upd));
ok("signed_at COALESCE param is cast to ::timestamptz",
  /COALESCE\(signed_at, \$\{signedAtParam\}::timestamptz\)/.test(upd) &&
  !/COALESCE\(signed_at, \$\{signedAt\}\)/.test(upd));
ok("recipient-id / signing-url COALESCE params are cast to ::text",
  /COALESCE\(documenso_recipient_id, \$\{recipientIdParam\}::text\)/.test(upd) &&
  /COALESCE\(documenso_signing_url, \$\{signingUrlParam\}::text\)/.test(upd));
ok("the per-signer update failure is logged, not silently swallowed",
  /per-signer sync update failed/.test(body));
ok("params are normalised to nullable strings/ISO before binding",
  /const recipientIdParam = recipientId != null \? String\(recipientId\) : null;/.test(body) &&
  /const signedAtParam = signedAt != null \? new Date\(signedAt as any\)\.toISOString\(\) : null;/.test(body));

// Public "viewed" transition also records viewed_at (parity with the Documenso sync path).
ok("public status-page 'viewed' transition sets viewed_at",
  /SET status = CASE WHEN status IN \('pending','sent'\) THEN 'viewed' ELSE status END, viewed_at = COALESCE\(viewed_at, NOW\(\)\)/.test(routes));

console.log(`\n${pass} checks passed.`);
