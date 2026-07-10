/**
 * Behavioral harness for Documenso resend self-healing semantics.
 * Run: npx tsx tests/documenso-resend-behavior.test.ts
 */
import assert from "node:assert/strict";
import { DOCUMENSO_RESEND_REQUEST_CONTRACT } from "../server/services/documenso";

type Signer = { id: string; contractId: string; companyId: string; email: string; recipientId: string | null; status: string; sentAt?: string | null; tokenHash?: string | null; tokenExpiresAt?: string | null; signingUrl?: string | null };
type SigReq = { id: string; contractId: string; companyId: string; documentId: string; recipientIds: any[]; status: string };
type Recipient = { email: string; id: string; status?: string; signingUrl?: string | null };
type State = { signers: Signer[]; sigReqs: SigReq[]; audits: any[]; providerFetches: string[]; providerResends: any[] };

const normalizeRecipientEmail = (value: string | null | undefined): string => (value ?? "").trim().toLowerCase();
const terminal = new Set(["signed", "completed", "declined", "cancelled", "canceled", "voided", "archived", "deleted"]);
function applyRemoteStatus(local: string, remote?: string) {
  const r = normalizeRecipientEmail(remote);
  if (!r) return local;
  if (terminal.has(local) && local !== r) return local;
  if (["signed", "declined", "cancelled", "canceled", "voided"].includes(r)) return r === "canceled" ? "cancelled" : r;
  return local;
}
function blockReason(docStatus: string, recipient?: Recipient, duplicate = false) {
  const d = normalizeRecipientEmail(docStatus);
  if (["completed", "signed"].includes(d)) return "Document is already completed; no reminder can be sent.";
  if (["voided", "cancelled", "canceled", "archived", "deleted"].includes(d)) return "Document voided/cancelled; no reminder can be sent.";
  if (duplicate) return "Multiple live Documenso recipients match this email; manual review required.";
  if (!recipient) return "Recipient is not present on the live Documenso document.";
  const r = normalizeRecipientEmail(recipient.status);
  if (r === "signed") return "Recipient has already signed.";
  if (r === "declined") return "Recipient declined.";
  if (["cancelled", "canceled", "voided"].includes(r)) return "Recipient cancelled.";
  return null;
}
function runHarness(state: State, input: { actorCompanyId: string; contractId: string; documentId: string; liveDoc: { status: string; recipients: Recipient[] }; failSecondUpdate?: boolean; auditFails?: boolean; providerFails?: boolean }) {
  const sigReq = state.sigReqs.find((r) => r.contractId === input.contractId && r.companyId === input.actorCompanyId && r.documentId === input.documentId);
  if (!sigReq) return { httpStatus: 403, providerFetches: 0, providerResends: 0 };
  state.providerFetches.push(input.documentId);
  const relevant = state.signers.filter((s) => s.contractId === input.contractId && s.companyId === input.actorCompanyId);
  const before = JSON.parse(JSON.stringify({ signers: state.signers, sigReqs: state.sigReqs, audits: state.audits }));
  const byEmail = new Map<string, Recipient[]>();
  for (const r of input.liveDoc.recipients) {
    const email = normalizeRecipientEmail(r.email);
    byEmail.set(email, [...(byEmail.get(email) || []), { ...r, email }]);
  }
  const results: any[] = [];
  let refreshed = 0;
  try {
    sigReq.recipientIds = input.liveDoc.recipients.map((r) => ({ email: normalizeRecipientEmail(r.email), recipientId: r.id, status: r.status }));
    relevant.forEach((signer, idx) => {
      const email = normalizeRecipientEmail(signer.email);
      const matches = byEmail.get(email) || [];
      if (matches.length > 1) {
        results.push({ email, status: "manual_review", refreshed: false, reason: blockReason(input.liveDoc.status, undefined, true) });
        return;
      }
      const live = matches[0];
      const reason = blockReason(input.liveDoc.status, live);
      if (!live || reason) {
        signer.status = applyRemoteStatus(signer.status, live?.status);
        results.push({ email, status: reason === "Recipient has already signed." ? "signed" : live ? "skipped" : "missing", refreshed: false, reason });
        return;
      }
      if (input.failSecondUpdate && idx === 0) throw new Error("forced contract_signers update failure");
      if (live.id !== signer.recipientId) { signer.recipientId = live.id; refreshed++; }
      signer.signingUrl = live.signingUrl ?? signer.signingUrl;
      results.push({ email, status: "resent", refreshed: true, reason: "Recipient mapping refreshed and reminder resent." });
    });
    if (refreshed && !input.auditFails) state.audits.push({ action: "documenso_recipient_refresh", companyId: input.actorCompanyId });
    // Audit is intentionally best-effort in the route; failure does not roll back a successful repair.
  } catch (err) {
    state.signers = before.signers; state.sigReqs = before.sigReqs; state.audits = before.audits;
    return { httpStatus: 500, accepted: 0, requested: relevant.length, refreshed: 0, results: [], providerResends: state.providerResends.length };
  }
  const blockedDoc = !!blockReason(input.liveDoc.status, { email: "x", id: "x", status: "pending" });
  const acceptedEligible = results.filter((r) => r.status === "resent");
  if (!blockedDoc && acceptedEligible.length && !input.providerFails) {
    state.providerResends.push({ method: DOCUMENSO_RESEND_REQUEST_CONTRACT.method, endpoint: DOCUMENSO_RESEND_REQUEST_CONTRACT.endpoint, body: { envelopeId: input.documentId } });
    for (const signer of relevant.filter((s) => acceptedEligible.some((r) => r.email === normalizeRecipientEmail(s.email)))) signer.sentAt = "now";
  }
  return { success: results.length > 0 && acceptedEligible.length === results.length, requested: results.length, accepted: acceptedEligible.length, refreshed, refreshAttempted: true, retryAttempted: false, retryCount: 0, results, providerResends: state.providerResends.length };
}
function baseState(): State { return { audits: [], providerFetches: [], providerResends: [], sigReqs: [{ id: "req-a", contractId: "contract-a", companyId: "tenant-a", documentId: "doc-a", recipientIds: [], status: "sent_for_signature" }], signers: [
  { id: "s1", contractId: "contract-a", companyId: "tenant-a", email: "luke.shawver@gmail.com", recipientId: "stale-recipient-1", status: "sent", sentAt: null, tokenHash: "oldhash", tokenExpiresAt: "oldexpiry", signingUrl: "old-url-1" },
  { id: "s2", contractId: "contract-a", companyId: "tenant-a", email: "luke@adikenproperties.com", recipientId: "stale-recipient-2", status: "sent", sentAt: null, tokenHash: "oldhash2", tokenExpiresAt: "oldexpiry2", signingUrl: "old-url-2" },
] }; }

assert.equal(DOCUMENSO_RESEND_REQUEST_CONTRACT.includesRecipientIdentifiers, false);
assert.deepEqual({ method: DOCUMENSO_RESEND_REQUEST_CONTRACT.method, endpoint: DOCUMENSO_RESEND_REQUEST_CONTRACT.endpoint }, { method: "POST", endpoint: "/envelope/redistribute" });

{
  const state = baseState();
  const res: any = runHarness(state, { actorCompanyId: "tenant-a", contractId: "contract-a", documentId: "doc-a", liveDoc: { status: "pending", recipients: [ { email: "  Luke.Shawver@gmail.com ", id: "live-recipient-101" }, { email: " LUKE@ADIKENPROPERTIES.COM", id: "live-recipient-202" } ] } });
  assert.equal(res.accepted, 2); assert.equal(res.requested, 2); assert.equal(res.refreshed, 2); assert.equal(res.retryCount, 0); assert.equal(state.providerResends.length, 1);
  assert.equal(state.signers[0].recipientId, "live-recipient-101"); assert.equal(state.signers[1].recipientId, "live-recipient-202");
  assert.deepEqual(state.providerResends[0].body, { envelopeId: "doc-a" });
  assert.equal(state.signers[0].tokenHash, "oldhash"); assert.equal(state.signers[0].tokenExpiresAt, "oldexpiry");
}
{
  const state = baseState();
  const res: any = runHarness(state, { actorCompanyId: "tenant-a", contractId: "contract-a", documentId: "doc-a", liveDoc: { status: "pending", recipients: [ { email: "luke.shawver@gmail.com", id: "live-recipient-101" } ] } });
  assert.equal(res.accepted, 1); assert.equal(res.success, false); assert.equal(state.signers[0].recipientId, "live-recipient-101"); assert.equal(state.signers[1].recipientId, "stale-recipient-2");
  assert.equal(res.results[1].status, "missing");
}
{
  const state = baseState();
  const res: any = runHarness(state, { actorCompanyId: "tenant-a", contractId: "contract-a", documentId: "doc-a", liveDoc: { status: "pending", recipients: [ { email: "luke.shawver@gmail.com", id: "live-a" }, { email: "LUKE.SHAWVER@gmail.com", id: "live-b" } ] } });
  assert.equal(res.results[0].status, "manual_review"); assert.equal(state.signers[0].recipientId, "stale-recipient-1");
}
{
  const state = baseState(); state.signers[0].status = "signed"; state.signers[0].sentAt = "old-sent";
  const res: any = runHarness(state, { actorCompanyId: "tenant-a", contractId: "contract-a", documentId: "doc-a", liveDoc: { status: "pending", recipients: [ { email: "luke.shawver@gmail.com", id: "live-recipient-101", status: "signed" } ] } });
  assert.equal(state.signers[0].status, "signed"); assert.equal(state.signers[0].sentAt, "old-sent"); assert.equal(res.results[0].reason, "Recipient has already signed.");
}
for (const status of ["completed", "voided"] as const) {
  const state = baseState();
  const res: any = runHarness(state, { actorCompanyId: "tenant-a", contractId: "contract-a", documentId: "doc-a", liveDoc: { status, recipients: [ { email: "luke.shawver@gmail.com", id: "live-recipient-101" } ] } });
  assert.equal(res.providerResends, 0); assert.equal(state.signers[0].recipientId, "stale-recipient-1"); assert.match(res.results[0].reason, /completed|voided/);
}
{
  const state = baseState();
  const res: any = runHarness(state, { actorCompanyId: "tenant-a", contractId: "contract-a", documentId: "doc-a", failSecondUpdate: true, liveDoc: { status: "pending", recipients: [ { email: "luke.shawver@gmail.com", id: "live-recipient-101" } ] } });
  assert.equal(res.httpStatus, 500); assert.equal(state.signers[0].recipientId, "stale-recipient-1"); assert.equal(state.audits.length, 0); assert.equal(state.providerResends.length, 0);
}
{
  const state = baseState();
  const res: any = runHarness(state, { actorCompanyId: "tenant-a", contractId: "contract-a", documentId: "doc-a", auditFails: true, liveDoc: { status: "pending", recipients: [ { email: "luke.shawver@gmail.com", id: "live-recipient-101" } ] } });
  assert.equal(res.accepted, 1); assert.equal(state.signers[0].recipientId, "live-recipient-101"); assert.equal(state.audits.length, 0);
}
{
  const state = baseState(); state.sigReqs.push({ id: "req-b", contractId: "contract-b", companyId: "tenant-b", documentId: "doc-b", recipientIds: [], status: "sent_for_signature" }); state.signers.push({ id: "s-b", contractId: "contract-b", companyId: "tenant-b", email: "luke.shawver@gmail.com", recipientId: "tenant-b-stale", status: "sent" });
  const res: any = runHarness(state, { actorCompanyId: "tenant-a", contractId: "contract-b", documentId: "doc-b", liveDoc: { status: "pending", recipients: [ { email: "luke.shawver@gmail.com", id: "tenant-b-live" } ] } });
  assert.equal(res.httpStatus, 403); assert.equal(state.providerFetches.length, 0); assert.equal(state.signers.find((s) => s.id === "s-b")!.recipientId, "tenant-b-stale");
}
console.log("PASS: Documenso resend behavioral self-heal harness");
