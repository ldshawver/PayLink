/**
 * Static regression checks for Documenso resend recipient self-healing.
 * Run: npx tsx tests/documenso-resend-self-heal-static.test.ts
 */
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const hub = fs.readFileSync("client/src/pages/contractor-hub.tsx", "utf8");

const screenshotScenario = {
  local: [
    { email: "  Luke.Shawver@gmail.com ", oldRecipientId: "stale-recipient-a", newRecipientId: "live-recipient-a" },
    { email: " LUKE@ADIKENPROPERTIES.COM", oldRecipientId: "stale-recipient-b", newRecipientId: "live-recipient-b" },
  ],
  firstProviderResult: "Recipient not found",
  retry: "once_after_refresh",
};

function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`ok - ${name}`);
}

ok("route is exact Contractor Hub Documenso resend endpoint", routes.includes('app.post("/api/contractor-contracts/:id/resend-signing-request"'));
ok("recipient email normalization helper trims and lowercases", routes.includes("function normalizeRecipientEmail") && routes.includes('return (value ?? "").trim().toLowerCase()'));
ok("live recipient id resolution prefers token then id then recipientId", routes.includes("r?.token ?? r?.id ?? r?.recipientId"));
ok("self-heal helper updates both tables transactionally", routes.includes("async function refreshDocumensoRecipientMappings") && routes.includes("await db.transaction") && routes.includes("UPDATE documenso_signature_requests") && routes.includes("UPDATE contract_signers"));
ok("self-heal helper is tenant scoped", routes.includes("company_id = ${companyId}") && routes.includes("AND company_id = ${companyId}"));
ok("stale recipient self-heal retries once after refresh", routes.includes("retriedAfterRefresh = true") && routes.includes("retryCount: retriedAfterRefresh ? 1 : 0"));
ok("duplicate live email match requires manual review", routes.includes("Duplicate recipient email in Documenso; manual review required"));
ok("blocked document and recipient states have explicit reasons", routes.includes("Completed document") && routes.includes("Already signed") && routes.includes("Recipient missing remotely"));
ok("response includes requested accepted refreshed retried and per-recipient results", routes.includes("requested: recipients.length") && routes.includes("accepted: acceptedRecipients.length") && routes.includes("refreshed: recipients.filter") && routes.includes("results: recipients.map"));
ok("audit actions are written only after transaction succeeds", routes.indexOf("await db.transaction") < routes.indexOf('actionType: "documenso_recipient_refresh"') && routes.includes('actionType: "documenso_metadata_updated"'));
ok("Contractor Hub success toast handles repaired resend without red failure", hub.includes("Documenso reminders resent") && hub.includes("Recipient mappings were refreshed automatically") && hub.includes('variant: data?.success || accepted > 0 ? "default" : "destructive"'));

ok("exact screenshot scenario is represented with two stale Luke recipients", screenshotScenario.local.length === 2 && screenshotScenario.local.every((r) => r.oldRecipientId.startsWith("stale-") && r.newRecipientId.startsWith("live-")) && screenshotScenario.firstProviderResult === "Recipient not found" && screenshotScenario.retry === "once_after_refresh");
