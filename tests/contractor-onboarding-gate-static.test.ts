/**
 * Static guard for the contractor onboarding gate (PR 8). No database.
 *
 * Every mutating route in the contractor marketplace families must be either
 * GATED (its middleware chain contains contractorGate("<action>", …) from the
 * one shared service) or EXEMPT with a written reason. A new route in these
 * families that is neither fails this test, so the gate cannot silently be
 * skipped. Also checks the gate service is read-only, value-free and shared.
 */
import fs from "node:fs";
import ts from "typescript";

let passed = 0, failed = 0;
const check = (n: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ✓ ${n}`); }
  else { failed++; console.error(`  ✗ ${n}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`); }
};
const routes = fs.readFileSync("server/routes.ts", "utf8");
const gateSrc = fs.readFileSync("server/contractor-onboarding/gate.ts", "utf8");

/** route → gate action. */
const GATED: Record<string, string> = {
  "POST /api/job-posts/:id/bids": "bid_create",
  "PATCH /api/contractor-job-bids/:bidId": "bid_update",
  "POST /api/contractor-job-bids/:bidId/submit": "bid_submit",
  "POST /api/contractor-job-bids/:bidId/attachments": "bid_attachment",
  "POST /api/contractor-job-bids/:bidId/award": "bid_award",
  "POST /api/contractor-proposals": "proposal_create",
  "POST /api/contractor-proposals/:id/submit": "proposal_submit",
  "POST /api/contractor-proposals/:id/send": "proposal_send",
  "POST /api/contractor-proposals/:id/accept": "proposal_accept",
  "POST /api/contractor-proposals/:id/accept-counteroffer": "proposal_accept_counteroffer",
  "POST /api/contractor-proposals/:id/request-signature": "proposal_request_signature",
  "POST /api/contractor-proposals/:id/convert-to-contract": "proposal_convert_to_contract",
  "POST /api/contractor-proposals/:id/convert-to-invoice": "proposal_convert_to_invoice",
  "POST /api/contractor-proposals/:id/repair-contract": "proposal_repair_contract",
  "POST /api/contractor-proposals/:id/mark-negotiated": "proposal_mark_negotiated",
  "POST /api/contractor-proposals/:id/create-revision": "proposal_create_revision",
  "POST /api/contractor-proposals/:id/negotiate": "proposal_negotiate",
  "PATCH /api/contractor-proposals/:id/negotiations/:negId": "proposal_negotiation_respond",
  "POST /api/contractor-contracts": "contract_create",
  "POST /api/contractor-contracts/:id/send": "contract_send",
  "POST /api/contractor-contracts/:id/send-for-signature": "contract_send_for_signature",
  "POST /api/contractor-contracts/:id/sign": "contract_sign",
  "POST /api/contractor-contracts/:id/activate": "contract_activate",
  "POST /api/contractor-contracts/:id/reconcile-signing": "contract_reconcile_signing",
  "POST /api/contractor-contracts/:id/resend-signing-request": "contract_resend_signing",
  "POST /api/contractor-contracts/:id/replace-signing-request": "contract_replace_signing",
  "POST /api/contractor-contracts/:contractId/signers/:signerId/resend": "contract_signer_resend",
  "POST /api/contractor-invoices": "invoice_create",
  "POST /api/contractor-invoices/:id/submit": "invoice_submit",
  "POST /api/contractor-invoices/from-proposal": "invoice_from_proposal",
  "POST /api/contractor-invoices/:id/approve": "invoice_approve",
  "POST /api/contractor-invoices/:id/payments": "invoice_payment",
  "POST /api/contractor-invoices/:id/cut-check": "invoice_cut_check",
  "POST /api/contractor-invoices/:id/mark-paid": "invoice_mark_paid",
  "POST /api/contractor-invoices/:id/stripe-checkout-session": "invoice_checkout",
  "POST /api/contractor-invoices/:id/restore": "invoice_restore",
  "POST /api/contractor-invoices/:id/request-override": "invoice_request_override",
  "POST /api/contractor-payments/:id/reissue": "payment_reissue",
  "POST /api/contractor-hub/contracts/:id/send-signing-email": "contract_send_signing_email",
};
/** Routes gated inside a shared handler (no session — the client share-token portal). */
const GATED_IN_HANDLER = ["POST /api/contractor-proposals/:id/client-approve", "POST /api/portal/proposals/:id/approve"];

const REVERSAL = "reversal / archive / rejection — must stay available; never progresses work";
const DRAFT = "edits draft content only; the submit / send / accept / pay step is gated";
const SIGNER = "signer bookkeeping on an existing contract; sending and signing are gated";
const RESEND = "re-delivers something whose original send was gated";
const EXEMPT: Record<string, string> = {
  "DELETE /api/contractor-proposals/:id": REVERSAL,
  "POST /api/contractor-proposals/:id/archive": REVERSAL, "POST /api/contractor-proposals/:id/restore": "un-archive only; any further progress is gated",
  "POST /api/contractor-proposals/:id/purge": REVERSAL, "POST /api/contractor-proposals/:id/reject": REVERSAL,
  "POST /api/contractor-proposals/:id/request-revision": REVERSAL, "POST /api/contractor-proposals/:id/reject-counteroffer": REVERSAL,
  "POST /api/contractor-contracts/:id/archive": REVERSAL, "POST /api/contractor-contracts/:id/void": REVERSAL,
  "POST /api/contractor-invoices/:id/archive": REVERSAL, "POST /api/contractor-invoices/:id/void": REVERSAL,
  "POST /api/contractor-invoices/:id/reject": REVERSAL, "POST /api/contractor-invoices/:id/mark-duplicate": REVERSAL,
  "POST /api/contractor-payments/:id/void": REVERSAL,
  "POST /api/contractor-job-bids/:bidId/withdraw": REVERSAL, "POST /api/contractor-job-bids/:bidId/reject": REVERSAL,
  "POST /api/contractor-job-bids/:bidId/request-revision": REVERSAL,
  "POST /api/contractor-job-bids/:bidId/review": "administrator pre-award review state; the award is gated",
  "POST /api/contractor-job-bids/:bidId/shortlist": "administrator pre-award review state; the award is gated",
  "PATCH /api/contractor-proposals/:id": DRAFT, "POST /api/contractor-proposals/:id/line-items": DRAFT,
  "POST /api/contractor-proposals/:id/attachments": DRAFT, "PATCH /api/contractor-invoices/:id": DRAFT,
  "POST /api/contractor-invoices/:id/attachments": DRAFT, "PATCH /api/contractor-contracts/:id": DRAFT,
  "POST /api/contractor-proposals/:id/reply": "message thread only",
  "POST /api/contractor-proposals/:id/ai-assist": "drafting assistance only; changes no workflow state",
  "POST /api/contractor-proposals/:id/snapshot": "record-keeping snapshot", "POST /api/contractor-contracts/:id/snapshot": "record-keeping snapshot",
  "POST /api/contractor-proposals/:id/counter": "administrator counter-offer; the contractor's acceptance is gated",
  "POST /api/contractor-proposals/:id/counteroffer": "administrator counter-offer; the contractor's acceptance is gated",
  "POST /api/contractor-proposals/:id/share-token": "creates the client link; client approval through it is gated",
  "POST /api/contractor-proposals/:id/resend-email": RESEND,
  "POST /api/contractor-contracts/:id/signing-reminders/send-now": RESEND, "PATCH /api/contractor-contracts/:id/signing-reminders": "reminder settings",
  "POST /api/contractor-invoices/:id/send-reminder": RESEND,
  "POST /api/contractor-invoices/:id/print-check": "read-only check preview (no write)",
  "POST /api/contractor-proposals/repair-superseded": "administrator data repair of superseded flags",
  "POST /api/contractor-contracts/:id/add-signer": SIGNER, "POST /api/contractor-contracts/:contractId/signers": SIGNER,
  "PATCH /api/contractor-contracts/:contractId/signers/:signerId": SIGNER, "DELETE /api/contractor-contracts/:contractId/signers/:signerId": SIGNER,
  "POST /api/contractor-contracts/:contractId/signers/:signerId/replace": SIGNER,
  "POST /api/contractor-proposals/:id/client-approve": "gated inside approveProposalViaShareToken (no session)",
  "POST /api/contractor-hub/contracts/:id/signers": SIGNER,
  "POST /api/contractor-hub/contracts/:id/delegate-signer": "signer delegation on an existing contract; the delegate's signature completion is gated in completePublicContractSignature",
  "POST /api/contractor-hub/contracts/:id/documenso/create": "configuration probe only (answers 202 with guidance, writes nothing)",
  "POST /api/contractor-hub/repair-proposal-contracts": "administrator batch repair; gated per record inside the handler (skips unverified contractors)",
  "POST /api/contractor-hub/backfill-documents": "administrator batch repair; contract + invoice creation gated per record inside the handler",
  "POST /api/public/sign/contracts/:token/complete": "public signing link (no session); gated inside completePublicContractSignature",
  "POST /api/signing/contracts/:token/complete": "public signing link (no session); gated inside completePublicContractSignature",
};

// ─── collect every mutating route in the families, with its middleware chain ──
const sf = ts.createSourceFile("routes.ts", routes, ts.ScriptTarget.Latest, true);
const FAMILY = /^\/api\/(job-posts\/:id\/bids$|contractor-job-bids|contractor-proposals|contractor-contracts|contractor-invoices|contractor-payments|contractor-hub\/(contracts|repair-proposal-contracts|backfill-documents)|public\/sign\/contracts|signing\/contracts)/;
const found = new Map<string, string[]>(); // route → middleware texts (all args but the last)
(function walk(n: ts.Node) {
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.expression.getText(sf) === "app"
    && ["post", "put", "patch", "delete"].includes(n.expression.name.text) && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
    const p = n.arguments[0].text;
    if (FAMILY.test(p)) {
      const key = `${n.expression.name.text.toUpperCase()} ${p}`;
      found.set(key, n.arguments.slice(1, -1).map((a) => a.getText(sf)));
    }
  }
  ts.forEachChild(n, walk);
})(sf);

check(`found the marketplace routes (${found.size})`, found.size >= 80, found.size);
const unclassified = [...found.keys()].filter((k) => !(k in GATED) && !(k in EXEMPT));
check("every mutating marketplace route is gated or exempt with a reason", unclassified.length === 0, unclassified);
const both = Object.keys(GATED).filter((k) => k in EXEMPT);
check("no route is both gated and exempt", both.length === 0, both);
const missingRoutes = Object.keys(GATED).filter((k) => !found.has(k));
check("every gated route exists", missingRoutes.length === 0, missingRoutes);
const ungated = Object.entries(GATED).filter(([k, action]) => {
  const mw = found.get(k) ?? [];
  return !mw.some((m) => m.startsWith(`contractorGate("${action}"`));
});
check(`all ${Object.keys(GATED).length} gated routes use the shared contractorGate with their action`, ungated.length === 0, ungated.map(([k]) => k));
const late = Object.keys(GATED).filter((k) => {
  const mw = found.get(k) ?? []; const i = mw.findIndex((m) => m.startsWith("contractorGate("));
  // auth (and role / CSRF where present) run first; the gate runs before upload parsing and the handler.
  return i < 0 || mw.slice(0, i).every((m) => m !== "requireAuth") || mw.slice(i + 1).some((m) => /^(requireAuth|requireRole|requireCsrfToken)/.test(m));
});
check("the gate runs after authentication/role/CSRF and before upload parsing and the handler", late.length === 0, late);
const exemptGated = Object.keys(EXEMPT).filter((k) => (found.get(k) ?? []).some((m) => m.startsWith("contractorGate(")));
check("exempt routes really carry no gate (list is accurate)", exemptGated.length === 0, exemptGated);
check("exempt reasons are written out", Object.values(EXEMPT).every((r) => r.length > 10));

const selfOnly = ["POST /api/job-posts/:id/bids", "POST /api/contractor-invoices"];
check("contractor-created records take the subject from the session (GATE_SELF), never the body",
  selfOnly.every((k) => (found.get(k) ?? []).some((m) => m === `contractorGate("${GATED[k]}", GATE_SELF)`)));
check("record routes resolve the contractor from the STORED record named by the URL",
  Object.entries(GATED).filter(([k]) => /:(id|bidId|contractId)/.test(k) && !selfOnly.includes(k)).every(([k, a]) => (found.get(k) ?? []).some((m) => m.startsWith(`contractorGate("${a}", { record: "contractor_`))));

// ─── portal (no session) ───────────────────────────────────────────────────
const portalFn = routes.slice(routes.indexOf("async function approveProposalViaShareToken"), routes.indexOf('app.post("/api/portal/proposals/:id/approve"'));
check("share-token approval runs the shared gate after the token check and before any write",
  /validatePortalToken[\s\S]{0,200}gateAllowsStoredContractor\("proposal_client_approve", proposal\.contractor_id, proposal\.company_id\)[\s\S]{0,1200}UPDATE contractor_proposals/.test(portalFn));
check("both share-token routes call that one function", GATED_IN_HANDLER.every((k) => {
  const p = k.split(" ")[1]; const i = routes.indexOf(`app.post("${p}"`); return i > 0 && routes.slice(i, i + 300).includes("approveProposalViaShareToken(req, res)");
}));
// ─── public signing link + administrator batch repairs (gated in the handler) ──
const signFn = routes.slice(routes.indexOf("const completePublicContractSignature"), routes.indexOf('app.post("/api/public/sign/contracts/:token/complete"'));
check("public signing completion runs the shared gate after the token checks and before any write",
  /Signing link has expired[\s\S]{0,800}gateAllowsStoredContractor\("contract_public_sign_complete"[\s\S]{0,400}res\.status\(409\)\.json\(\{ code: GATE_ERROR_CODE, message: "[^"]+" \}\)/.test(signFn)
  && signFn.indexOf("gateAllowsStoredContractor") < signFn.indexOf("UPDATE contract_signers") && signFn.indexOf("gateAllowsStoredContractor") < signFn.indexOf("syncDocumensoContractStatus"));
const fnOf = (route: string) => { const i = routes.indexOf(`app.post("${route}"`); return routes.slice(i, routes.indexOf("\n  });", i)); };
const repairFn = fnOf("/api/contractor-hub/repair-proposal-contracts");
check("batch repair gates each proposal before creating its contract",
  /gateAllowsStoredContractor\("proposal_repair_contracts_batch", p\.contractor_id, p\.company_id/.test(repairFn) && repairFn.indexOf("gateAllowsStoredContractor") < repairFn.indexOf("INSERT INTO contractor_contracts"));
const backfillFn = fnOf("/api/contractor-hub/backfill-documents");
check("backfill gates contract creation and invoice creation per record",
  backfillFn.indexOf('gateAllowsStoredContractor("backfill_contract"') > 0 && backfillFn.indexOf('gateAllowsStoredContractor("backfill_contract"') < backfillFn.indexOf("INSERT INTO contractor_contracts")
  && backfillFn.indexOf('gateAllowsStoredContractor("backfill_invoice"') > 0 && backfillFn.indexOf('gateAllowsStoredContractor("backfill_invoice"') < backfillFn.indexOf("autoCreateContractInvoiceExactlyOnce"));
check("the portal refusal carries no step codes", /res\.status\(409\)\.json\(\{ code: GATE_ERROR_CODE, message: "[^"]+" \}\)/.test(portalFn));

// ─── one shared, read-only, value-free service ─────────────────────────────
check("one gate instance in routes.ts, built from the shared service", (routes.match(/makeContractorGate\(/g) || []).length === 1 && !/function evaluateContractorGate|async function contractorGate/.test(routes));
const evalBody = gateSrc.slice(gateSrc.indexOf("export async function evaluateContractorGate"), gateSrc.indexOf("export async function auditGateDenial"));
check("the evaluation is read-only (SELECT only)", evalBody.length > 500 && !/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER)\b/.test(evalBody));
check("the evaluation never reads document contents, tax values or reviewer notes",
  !/\b(ciphertext|enc_key_id|enc_iv|enc_tag|storage_key|metadata_json|data_json|review_notes|ssn|tax_id|tin|birth_date|phone|first_name|last_name|email)\b/i.test(evalBody));
check("all nine requirements are evaluated", ["worker_status", "company_access", "tenant_access", "contractor_agreement", "w9", "government_id", "emergency_contact", "review_pending", "admin_review"].every((c) => evalBody.includes(`missing.add("${c}")`)));
check("legacy contractors with no onboarding are denied (not grandfathered)", /if \(!o\) \{\s*missing\.add\("onboarding_not_started"\)/.test(evalBody));
check("denial body is exactly code, message, missing, guidance; guidance is fixed text",
  /res\.status\(403\)\.json\(\{\s*code: GATE_ERROR_CODE,\s*message:[\s\S]{0,200}missing: result\.missing,\s*guidance: result\.missing\.map\(\(c\) => GATE_GUIDANCE\[c\]\),\s*\}\)/.test(gateSrc)
  && !/GATE_GUIDANCE[\s\S]{0,1500}\$\{/.test(gateSrc.slice(gateSrc.indexOf("export const GATE_GUIDANCE"), gateSrc.indexOf("export interface GateResult"))));
check("audit stores only action, actor kind and codes", /JSON\.stringify\(\{ action: a\.action, actor: a\.actor, missing: a\.missing \}\)/.test(gateSrc));
check("record lookups are fixed queries (no SQL built from input)", !/sql\.raw/.test(gateSrc));
check("gate fails closed on error (503, never next())", /catch \(e\) \{[\s\S]{0,200}res\.status\(503\)/.test(gateSrc));

// ─── employee applications stay separate ───────────────────────────────────
const appRoutes = [...routes.matchAll(/app\.(post|patch)\("(\/api\/(job-posts\/:id\/applications|employment-applications[^"]*))"[^\n]*/g)];
check("employee application routes exist and never use the contractor gate", appRoutes.length >= 2 && appRoutes.every((m) => !m[0].includes("contractorGate(")), appRoutes.map((m) => m[2]));

console.log(`\ngate static: ${passed} passed${failed ? `, ${failed} failed` : ""}`);
process.exit(failed ? 1 : 0);
