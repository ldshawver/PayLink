/**
 * Static guards for contractor onboarding PR 3 (Documenso templates).
 * Runs without a database.
 */
import fs from "node:fs";

let passed = 0, failed = 0;
function check(name: string, ok: boolean) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.error(`  ✗ ${name}`); }
}
const svc = fs.readFileSync("server/contractor-onboarding/esign.ts", "utf8");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const mig = fs.readFileSync("migrations/0042_contractor_onboarding_esign.sql", "utf8");
const doc = fs.readFileSync("server/services/documenso.ts", "utf8");
const block = (start: string, len = 1600) => { const i = routes.indexOf(start); return i < 0 ? "" : routes.slice(i, i + len); };

check("sending is OFF unless CONTRACTOR_ONBOARDING_ESIGN_ENABLED is exactly 'true'", /CONTRACTOR_ONBOARDING_ESIGN_ENABLED[\s\S]{0,80}=== "true"/.test(svc));
check("no hard-coded template id: the template comes from the company's enabled + approved mapping", /FROM contractor_onboarding_esign_templates[\s\S]{0,200}company_id = \$\{o\.company_id\}[\s\S]{0,120}enabled AND approved_at IS NOT NULL/.test(svc) && !/templateId:\s*["'\d]/.test(svc));
check("fail-closed order: 0042 → flag → Documenso config before any lookup", (() => { const a = svc.indexOf("esignTablesReady()))", svc.indexOf("startOnboardingSignature")); const b = svc.indexOf("isEsignSendingEnabled())", a); const c = svc.indexOf("validateDocumensoConfig().ok", b); const d = svc.indexOf("db.transaction", c); return a > 0 && b > a && c > b && d > c; })());
check("step row locked, then active request read in a later statement", /step_key = \$\{k\.stepKey\} FOR UPDATE`\)\);[\s\S]*FROM documenso_signature_requests[\s\S]{0,200}status NOT IN/.test(svc));
check("Documenso failure logs status code only (no error message/body)", /console\.warn\(`\[contractor-onboarding\] Documenso template send failed \(kind=\$\{args\.kind\}, status=\$\{e\?\.status \?\? "n\/a"\}\)`\)/.test(svc) && !/console\.(log|warn|error)\([^)]*e\.message/.test(svc));
check("raw response / signing URL / signer email are never written", !/raw_response|documenso_signing_url|signer_email/.test(svc));
check("template client sends only templateId, recipients (id,email,name), distributeDocument", /"\/template\/use", \{\s*templateId:[\s\S]{0,400}distributeDocument: req\.distribute,\s*\}\)/.test(doc));
check("admin routes: admin role + CSRF + demo block on writes", /app\.put\("\/api\/contractor-onboarding\/esign-templates\/:kind", requireAuth, requireRole\("admin"\), requireCsrfToken, blockDemoWrites/.test(routes) && /app\.post\("\/api\/contractor-onboarding\/:id\/esign\/:kind", requireAuth, requireRole\("admin"\), requireCsrfToken, blockDemoWrites/.test(routes));
check("company always from the acting user (resolveTenantCompanyId), never the request", /resolveTenantCompanyId\(actingUser\)/.test(block('app.post("/api/contractor-onboarding/:id/esign/:kind"')) && !/req\.body\??\.companyId/.test(block('app.post("/api/contractor-onboarding/:id/esign/:kind"')));
check("contractor routes take company + worker from the session user only", /u\.role !== "contractor" \|\| !u\.workerId \|\| !u\.companyId/.test(routes) && /app\.post\("\/api\/my-onboarding\/esign\/:kind", requireAuth, requireCsrfToken/.test(routes));
check("signing link response is no-store", /res\.setHeader\("Cache-Control", "no-store"\);\s*res\.json\(\{ signingUrl/.test(routes));
check("0042 is additive (no DROP/TRUNCATE/DELETE/RENAME) and ledger-gated", !/\b(DROP|TRUNCATE|DELETE FROM|RENAME)\b/i.test(mig.replace(/--.*$/gm, "")) && /INSERT INTO paylink_migrations\.applied[\s\S]*'0042'/.test(mig) && /apply 0041 first/.test(mig));
check("0042: enabled requires approval (CHECK) and only two document kinds", /ck_coet_enabled_needs_approval CHECK \(NOT enabled OR \(approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL\)\)/.test(mig) && /document_kind IN \('contractor_agreement','w9'\)/.test(mig));
check("0042: one live request per step, only for the new document types", /uq_documenso_req_onboarding_active[\s\S]{0,200}WHERE document_type IN \('contractor_onboarding_agreement','contractor_onboarding_w9'\)/.test(mig));
check("existing contract code paths never read the new document types", !/document_type IN \([^)]*contractor_onboarding/.test(routes));

console.log(`\ncontractor onboarding e-sign static: ${passed} passed${failed ? `, ${failed} failed` : ""}`);
process.exit(failed ? 1 : 0);
