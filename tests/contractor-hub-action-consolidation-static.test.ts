/**
 * Static regression checks for consolidating duplicate contract action surfaces in the
 * Contractor Hub contract detail panel (see the action-location audit): Send via Documenso,
 * the Documenso launch link, and Resend were each rendered twice (header bar + overview panel);
 * Sign Internally was rendered twice (header bar + Signers tab footer); Void and legacy
 * Send/Sign-Internally now live in a single overflow menu.
 * Run: npx tsx tests/contractor-hub-action-consolidation-static.test.ts
 */
import fs from "node:fs";

const hub = fs.readFileSync("client/src/pages/contractor-hub.tsx", "utf8");

let passCount = 0;
function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  passCount++;
  console.log(`PASS: ${name}`);
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ── Send via Documenso: one render location ─────────────────────────────────
ok("btn-send-via-documenso is rendered exactly once (no overview-panel duplicate)", occurrences(hub, 'data-testid="btn-send-via-documenso"') === 1);
ok("the removed overview-panel Send duplicate (btn-documenso-panel-send) no longer exists", !hub.includes('data-testid="btn-documenso-panel-send"'));

// ── Sign with Documenso launch link: one render location ────────────────────
ok("link-sign-with-documenso is rendered exactly once", occurrences(hub, 'data-testid="link-sign-with-documenso"') === 1);
ok("the removed overview-panel launch duplicate (btn-documenso-panel-launch) no longer exists", !hub.includes('data-testid="btn-documenso-panel-launch"'));

// ── Resend: one render location for the bulk action ──────────────────────────
ok("btn-resend-signing-request is rendered exactly once", occurrences(hub, 'data-testid="btn-resend-signing-request"') === 1);
ok("the removed overview-panel Resend duplicate (btn-documenso-panel-resend) no longer exists", !hub.includes('data-testid="btn-documenso-panel-resend"'));

// ── Sign Internally (legacy/manual): one render location ────────────────────
ok("btn-sign-contract is rendered exactly once (moved into the overflow menu)", occurrences(hub, 'data-testid="btn-sign-contract"') === 1);
ok("the removed Signers-tab-footer duplicate (btn-sign-contract-tab) no longer exists", !hub.includes('data-testid="btn-sign-contract-tab"'));

// ── Void: moved into the overflow menu, still requires a reason client-side ─
ok("btn-void-contract is rendered exactly once, inside the overflow DropdownMenuItem", occurrences(hub, 'data-testid="btn-void-contract"') === 1);
ok(
  "btn-void-contract lives inside the DropdownMenuContent, not the primary header button row",
  (() => {
    const idx = hub.indexOf('data-testid="btn-void-contract"');
    const beforeIt = hub.slice(0, idx);
    return beforeIt.lastIndexOf("<DropdownMenuContent") > beforeIt.lastIndexOf("</DropdownMenuContent>");
  })()
);
ok("Void confirmation still disables submit until a reason is provided", hub.includes('disabled={voidMutation.isPending || !voidReason.trim()}'));

// ── Manual Activate requires confirmation + reason, and only for non-Documenso contracts ─
ok("Activate opens a confirmation dialog instead of firing immediately", hub.includes('onClick={() => setActivateOpen(true)}') && !hub.includes('onClick={() => activateMutation.mutate()}\n                  disabled={activateMutation.isPending} data-testid="btn-activate-contract"'));
ok("Activate confirmation disables submit until a reason is provided", hub.includes('disabled={activateMutation.isPending || !activateReason.trim()}'));
ok("canActivate is derived from canManuallyActivateContract (Documenso-managed contracts excluded)", hub.includes("const canActivate = canManuallyActivateContract({ role: currentUserRole, status: contract.status, documensoManaged: usesDocumenso })"));

// ── Legacy send requires confirmation + reason, and only for non-Documenso contracts ────
ok("legacy Send for Signing opens a confirmation dialog instead of firing immediately from the overflow item", hub.includes('onClick={() => setLegacySendOpen(true)}'));
ok("legacy send confirmation disables submit until a reason is provided", hub.includes('disabled={sendMutation.isPending || !legacySendReason.trim()}'));
ok("legacy/manual overflow items are gated to contracts with no Documenso data at all", hub.includes("const showLegacyActionsMenu = isAdmin && !usesDocumenso && (canSend || canSign);"));

// ── Header action bar contains exactly one primary signing action ──────────
{
  const headerStart = hub.indexOf('<div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">');
  const headerEnd = hub.indexOf("</div>\n          </div>\n        </SheetHeader>");
  const headerBlock = hub.slice(headerStart, headerEnd > 0 ? headerEnd : headerStart + 3000);
  const primarySigningActionTestIds = ["btn-send-via-documenso", "btn-sign-contract", "btn-send-contract"];
  const presentPrimaryActions = primarySigningActionTestIds.filter((id) => headerBlock.includes(`data-testid="${id}"`));
  ok(
    "the header action bar's directly-rendered buttons include at most one primary signing action (legacy send/sign now live behind the overflow menu, not as direct header buttons)",
    headerStart >= 0 && presentPrimaryActions.length <= 1
  );
}

console.log(`\ncontractor-hub-action-consolidation-static.test.ts: ${passCount} checks passed.`);
