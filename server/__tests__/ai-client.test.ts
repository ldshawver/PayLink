/**
 * Self-hosted AI client. Proves OpenAI and xAI are never called.
 * Run: npx tsx server/__tests__/ai-client.test.ts
 */
import assert from "node:assert/strict";
import { aiHostIsBlocked, completeChat, readAiEndpoint } from "../ai-client.js";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${err?.message || err}`);
    failed++;
  }
}

function calls() {
  const seen: string[] = [];
  const fetchImpl = (async (url: string) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  }) as typeof fetch;
  return { seen, fetchImpl };
}

async function run() {
  await test("no endpoint means no request is made", async () => {
    const { seen, fetchImpl } = calls();
    const read = readAiEndpoint({ AI_MODEL: "llama3.1" });
    assert.equal(read.endpoint, null);
    assert.match(read.reason || "", /AI_BASE_URL/);
    assert.equal(seen.length, 0);
    void fetchImpl;
  });

  await test("OpenAI and xAI hosts are refused before fetch", async () => {
    for (const base of ["https://api.openai.com/v1", "https://api.openai.com", "https://api.x.ai/v1", "https://sub.api.openai.com"]) {
      const { seen, fetchImpl } = calls();
      const read = readAiEndpoint({ AI_BASE_URL: base, AI_MODEL: "gpt-4o", OPENAI_API_KEY: "sk-should-not-be-used", XAI_API_KEY: "xai-should-not-be-used" });
      assert.equal(read.endpoint, null, base);
      assert.match(read.reason || "", /not allowed/);
      assert.equal(seen.length, 0);
      void fetchImpl;
    }
    assert.equal(aiHostIsBlocked("api.openai.com"), true);
    assert.equal(aiHostIsBlocked("api.x.ai"), true);
    assert.equal(aiHostIsBlocked("gpu.internal"), false);
  });

  await test("a configured local endpoint is the only host that is called", async () => {
    const { seen, fetchImpl } = calls();
    const read = readAiEndpoint({
      AI_BASE_URL: "http://gpu.internal:11434/v1",
      AI_MODEL: "llama3.1",
      AI_VISION_MODEL: "llava",
      AI_API_KEY: "local-token",
      OPENAI_API_KEY: "sk-ignored",
    });
    assert.ok(read.endpoint);
    assert.equal(read.endpoint?.baseUrl, "http://gpu.internal:11434");
    assert.equal(read.endpoint?.model, "llama3.1");
    assert.equal(read.endpoint?.visionModel, "llava");
    const text = await completeChat({
      endpoint: read.endpoint!,
      messages: [{ role: "user", content: "hello" }],
      fetchImpl,
    });
    assert.equal(text, "ok");
    assert.deepEqual(seen, ["http://gpu.internal:11434/v1/chat/completions"]);
  });

  await test("AI_MODEL is required and credentials are not taken from the URL", () => {
    assert.equal(readAiEndpoint({ AI_BASE_URL: "http://gpu.internal:11434" }).endpoint, null);
    const embedded = readAiEndpoint({ AI_BASE_URL: "http://user:secret@gpu.internal:11434", AI_MODEL: "llama3.1" });
    assert.equal(embedded.endpoint, null);
    assert.match(embedded.reason || "", /AI_AUTH_HEADER/);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
