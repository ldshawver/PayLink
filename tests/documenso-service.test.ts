/**
 * Documenso service regression tests.
 *
 * Run: npx tsx tests/documenso-service.test.ts
 */
import crypto from "crypto";
import { toLocalDocumensoStatus, verifyWebhookSignature } from "../server/services/documenso";

let pass = 0;
let fail = 0;
function ok(name: string, result: boolean, detail?: string) {
  if (result) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("=== Documenso Service Tests ===\n");

ok("maps Documenso PENDING to local sent", toLocalDocumensoStatus("PENDING") === "sent");
ok("maps Documenso COMPLETED to local completed", toLocalDocumensoStatus("COMPLETED") === "completed");
ok("maps Documenso REJECTED to local rejected", toLocalDocumensoStatus("REJECTED") === "rejected");

const body = Buffer.from(JSON.stringify({ event: "document.completed", data: { id: "env_123" } }));
const secret = "test-webhook-secret";
const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
ok("accepts valid Documenso webhook signature", verifyWebhookSignature(body, signature, secret));
ok("accepts sha256-prefixed webhook signature", verifyWebhookSignature(body, `sha256=${signature}`, secret));
ok("rejects invalid Documenso webhook signature", !verifyWebhookSignature(body, "bad-signature", secret));
ok("rejects missing Documenso webhook secret", !verifyWebhookSignature(body, signature, ""));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
