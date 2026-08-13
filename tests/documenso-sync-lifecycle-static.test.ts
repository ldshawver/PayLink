/**
 * Static regression checks for the Documenso sync/lifecycle repair:
 *  - verified completion (webhook OR reconciliation) auto-transitions fully_signed -> active and
 *    creates the invoice exactly once, without requiring a manual Activate click;
 *  - duplicate/out-of-order webhooks and repeated reconciliation calls cannot regress status or
 *    duplicate the invoice/activation side effects;
 *  - resend reconciles authoritative remote status first, and never fires for active/completed/void;
 *  - manual Activate is unavailable for Documenso-backed contracts;
 *  - Void requires a reason, is blocked after paid/posted downstream invoices, and attempts remote
 *    cancellation only when the envelope is still cancellable.
 * Run: npx tsx tests/documenso-sync-lifecycle-static.test.ts
 */
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");

let passCount = 0;
function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  passCount++;
  console.log(`PASS: ${name}`);
}

// ── One authoritative completion transition, shared by webhook and reconciliation ──
ok(
  "activateContractAfterVerifiedCompletion exists as the single completion transition",
  routes.includes("async function activateContractAfterVerifiedCompletion(contractId: string, source: string)")
);
ok(
  "the transition only matches a row still in 'fully_signed' (idempotent; replay/race-safe)",
  routes.includes("WHERE id = ${contractId} AND status = 'fully_signed'")
);
ok(
  "verified completion calls the exactly-once invoice helper",
  /activateContractAfterVerifiedCompletion[\s\S]{0,600}autoCreateContractInvoiceExactlyOnce\(activated\.id\)/.test(routes)
);
ok(
  "the Documenso webhook's completion branch calls the shared transition instead of inlining status/invoice logic",
  /if \(completed\) \{[\s\S]{0,1500}activateContractAfterVerifiedCompletion\(contract\.id, `webhook/.test(routes)
);
ok(
  "authoritative remote reconciliation (syncDocumensoContractStatus) also calls the shared transition when it detects fully-signed",
  /if \(effectiveStatus === "fully_signed"\) \{\s*\n\s*const activated = await activateContractAfterVerifiedCompletion\(contractId, "reconciliation"\)/.test(routes)
);

// ── No backward transitions from active/completed/void/terminated ──────────
ok(
  "webhook status update cannot regress an already active/completed/void/terminated contract",
  routes.includes("WHERE id = ${contract.id} AND status NOT IN ('active','completed','void','terminated')")
);
ok(
  "reconciliation status update also excludes active/completed/void/terminated from being overwritten",
  (routes.match(/AND status NOT IN \('active','completed','void','terminated'\)/g) || []).length >= 2
);
ok(
  "fileDocumensoFinalAgreementPacket no longer flips status itself (status is owned exclusively by activateContractAfterVerifiedCompletion)",
  !routes.includes("status = CASE WHEN status = 'fully_signed' THEN 'completed' ELSE status END")
);

// ── Stale signer reconciliation on webhook replay ───────────────────────────
ok(
  "webhook reconciles contract_signers to 'signed' outside the first-time-only guard, fixing stale viewed/sent state on replay",
  /UPDATE contract_signers SET status = 'signed', signed_at = COALESCE\(signed_at, NOW\(\)\) WHERE contract_id = \$\{contract\.id\} AND status IN \('pending','sent','viewed'\)/.test(routes)
);

// ── Resend reconciles remote status before acting, and blocks active contracts ─
{
  const resendStart = routes.indexOf('app.post("/api/contractor-contracts/:id/resend-signing-request"');
  const resendBody = routes.slice(resendStart, resendStart + 1500);
  ok(
    "resend-signing-request calls syncDocumensoContractStatus before selecting pending signers",
    resendStart >= 0 && resendBody.includes("await syncDocumensoContractStatus(req.params.id)") && resendBody.indexOf("await syncDocumensoContractStatus") < resendBody.indexOf("const pending = ")
  );
  ok(
    "resend-signing-request blocks 'active' contracts, not just fully_signed/completed/void/terminated",
    resendBody.includes('["fully_signed", "active", "completed", "void", "terminated"]')
  );
}

// ── Manual Activate is unavailable for Documenso-backed contracts ──────────
{
  const activateStart = routes.indexOf('app.post("/api/contractor-contracts/:id/activate"');
  const activateBody = routes.slice(activateStart, activateStart + 3200);
  ok(
    "activate route rejects Documenso-backed contracts before checking status",
    activateStart >= 0 && activateBody.includes("documensoBacked?.id") && activateBody.indexOf("documensoBacked?.id") < activateBody.indexOf('!["pending", "sent", "partially_signed", "fully_signed"]')
  );
  ok(
    "manual activate requires a non-empty reason",
    activateBody.includes('if (!reason || !String(reason).trim())')
  );
  ok(
    "manual activate records an audit trail entry with the reason and prior status",
    activateBody.includes('actionType: "contract_manually_activated"') && activateBody.includes("priorStatus: contract.status")
  );
}

// ── Void hardening ───────────────────────────────────────────────────────────
{
  const voidStart = routes.indexOf('app.post("/api/contractor-contracts/:id/void"');
  const voidBody = routes.slice(voidStart, voidStart + 5500);
  ok("void requires a non-empty reason", voidStart >= 0 && voidBody.includes('if (!reason || !String(reason).trim())'));
  ok(
    "void is blocked once a downstream invoice has been paid, has a recorded payment, or was posted",
    voidBody.includes("paid_at IS NOT NULL OR COALESCE(amount_paid, 0)::numeric > 0 OR export_status IN ('exported', 'posted')")
  );
  ok(
    "void attempts remote cancellation only while the envelope is still in a cancellable state",
    voidBody.includes('cancellableRemoteStatuses.includes(String(sigReq.status || "").toLowerCase())')
  );
  ok(
    "remote cancellation failure does not block the local void (best-effort, reported not fatal)",
    /catch \(remoteErr: any\) \{\s*remoteVoidResult\.error = remoteErr\?\.message/.test(voidBody)
  );
  ok(
    "void records actor, prior status, and remote document id in the audit trail",
    voidBody.includes('actionType: "contract_voided"') && voidBody.includes("priorStatus") && voidBody.includes("documensoDocumentId: sigReq?.documenso_document_id")
  );
  ok("void response reports the remote cancellation outcome to the caller", voidBody.includes("res.json({ ...result.rows[0], remoteVoidResult })"));
  ok("void never deletes the contract row (UPDATE only, no DELETE)", voidStart >= 0 && !voidBody.includes("DELETE FROM contractor_contracts"));
}

// ── Legacy/manual send is gated to non-Documenso contracts and requires a reason ─
{
  const legacySendStart = routes.indexOf('app.post("/api/contractor-contracts/:id/send",');
  const legacySendBody = routes.slice(legacySendStart, legacySendStart + 1200);
  ok(
    "legacy send is blocked once the contract is connected to Documenso",
    legacySendStart >= 0 && legacySendBody.includes("documensoBacked?.id) return res.status(400)")
  );
  ok("legacy send requires a non-empty reason", legacySendBody.includes('if (!reason || !String(reason).trim())'));
}

console.log(`\ndocumenso-sync-lifecycle-static.test.ts: ${passCount} checks passed.`);
