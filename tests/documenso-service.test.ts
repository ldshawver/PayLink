/**
 * Documenso service regression tests.
 *
 * Run: npx tsx tests/documenso-service.test.ts
 */
import crypto from "crypto";
import { toLocalDocumensoStatus, verifyWebhookSignature, getDocumensoDocument, resendDocumensoDocument, DocumensoApiError } from "../server/services/documenso";

// Fake, non-real config so getApiKey()/getBaseUrl() don't throw — every
// network call in these tests is intercepted by the mock fetch below, so
// nothing ever reaches a real host regardless of these values.
process.env.DOCUMENSO_URL = "https://fake-mock-documenso.invalid/api/v2";
process.env.DOCUMENSO_API_KEY = "test-fake-key-not-real";

type MockHandler = (url: string, init?: RequestInit) => { status: number; body: any } | Promise<{ status: number; body: any }>;

async function withMockFetch<T>(handler: MockHandler, fn: () => Promise<T>): Promise<T> {
  const realFetch = global.fetch;
  const calledUrls: string[] = [];
  (global as any).fetch = async (url: string, init?: RequestInit) => {
    calledUrls.push(String(url));
    if (!String(url).includes("fake-mock-documenso.invalid")) {
      throw new Error(`SAFETY VIOLATION: attempted a real network call to ${url}`);
    }
    const { status, body } = await handler(String(url), init);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  };
  try {
    return await fn();
  } finally {
    global.fetch = realFetch;
  }
}

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

async function main() {
  // ── Root-cause regression: getDocumensoDocument must find recipients
  //    whether the live API returns them flat or wrapped in { data: {...} } ──
  await withMockFetch(
    (url) => {
      ok("getDocumensoDocument requests the expected envelope endpoint", url.endsWith("/envelope/env_flat"));
      return { status: 200, body: { id: "env_flat", status: "PENDING", recipients: [{ id: 1, email: "a@example.com", name: "A" }, { id: 2, email: "b@example.com", name: "B" }] } };
    },
    async () => {
      const doc = await getDocumensoDocument("env_flat");
      ok("flat (unwrapped) response: both recipients found", doc.recipients.length === 2, `got ${doc.recipients.length}`);
    },
  );

  await withMockFetch(
    () => ({ status: 200, body: { data: { id: "env_wrapped", status: "PENDING", recipients: [{ id: 1, email: "a@example.com", name: "A" }, { id: 2, email: "b@example.com", name: "B" }] } } }),
    async () => {
      const doc = await getDocumensoDocument("env_wrapped");
      ok("REGRESSION: { data: {...} }-wrapped response: both recipients found (this was the root cause of '0/2 recipients missing')", doc.recipients.length === 2, `got ${doc.recipients.length}`);
      ok("wrapped response: status correctly read from inside .data", doc.status === "sent");
    },
  );

  // ── Nested/paginated recipient discovery ──────────────────────────────
  await withMockFetch(
    (url) => {
      if (url.includes("cursor=")) {
        ok("pagination follow-up request carries the cursor", url.includes("cursor=page2token"));
        return { status: 200, body: { recipients: [{ id: 2, email: "b@example.com", name: "B" }], nextCursor: null } };
      }
      return { status: 200, body: { id: "env_paginated", status: "PENDING", recipients: [{ id: 1, email: "a@example.com", name: "A" }], nextCursor: "page2token" } };
    },
    async () => {
      const doc = await getDocumensoDocument("env_paginated");
      ok("paginated response: both recipients discovered across pages", doc.recipients.length === 2, `got ${doc.recipients.length}`);
    },
  );

  await withMockFetch(
    () => ({ status: 200, body: { recipients: [{ id: 1, email: "a@example.com" }], nextCursor: "cursor-that-never-changes" } }),
    async () => {
      const doc = await getDocumensoDocument("env_cyclic_cursor");
      ok("non-advancing cursor does not loop forever and returns what was collected", doc.recipients.length === 1);
    },
  );

  // ── resendDocumensoDocument: same unwrapping fix ──────────────────────
  await withMockFetch(
    () => ({ status: 200, body: { data: { status: "PENDING", recipients: [{ id: 1, email: "a@example.com" }, { id: 2, email: "b@example.com" }] } } }),
    async () => {
      const result = await resendDocumensoDocument("env_wrapped_resend");
      ok("resendDocumensoDocument: wrapped response recipients found", result.signingLinks.length === 2, `got ${result.signingLinks.length}`);
    },
  );

  // ── Failure categories must be distinguishable (DocumensoApiError.status) ──
  await withMockFetch(
    () => ({ status: 404, body: { message: "Envelope not found" } }),
    async () => {
      try {
        await getDocumensoDocument("env_deleted");
        ok("404 must throw", false);
      } catch (e: any) {
        ok("document-not-found is distinguishable via status 404", e instanceof DocumensoApiError && e.status === 404);
      }
    },
  );

  await withMockFetch(
    () => ({ status: 401, body: { message: "Unauthorized" } }),
    async () => {
      try {
        await getDocumensoDocument("env_wrong_account");
        ok("401 must throw", false);
      } catch (e: any) {
        ok("account-mismatch is distinguishable via status 401 (distinct from 404)", e instanceof DocumensoApiError && e.status === 401);
      }
    },
  );

  await withMockFetch(
    () => { throw new Error("simulated network timeout"); },
    async () => {
      try {
        await getDocumensoDocument("env_timeout");
        ok("network timeout must throw", false);
      } catch (e: any) {
        ok("temporary/network failure has no HTTP status (distinguishable from 404/401)", !(e instanceof DocumensoApiError));
      }
    },
  );

  // ── Malformed response causes no fabricated success value ─────────────
  await withMockFetch(
    () => ({ status: 200, body: null }),
    async () => {
      const doc = await getDocumensoDocument("env_malformed");
      ok("malformed (null) body degrades to zero recipients, not a crash or fabricated data", Array.isArray(doc.recipients) && doc.recipients.length === 0);
    },
  );

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
