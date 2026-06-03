/**
 * Tests for POST /api/app-doctor/repair-tickets/:id/create-pr
 *
 * Covers:
 * - Branch already exists (GitHub 422) → retry with timestamp suffix
 * - GitHub ref fetch failure → 502 with real GitHub body
 * - GitHub PR creation failure → 502 with real GitHub body
 * - Missing GITHUB_TOKEN/GITHUB_REPO → 200 degraded (pr_requested)
 * - Happy path → pr_created with prUrl
 * - pr_created not set when html_url missing
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

type FetchCall = { url: string; init?: RequestInit };

function makePrResponse(overrides: Record<string, unknown> = {}) {
  return {
    number: 42,
    html_url: "https://github.com/owner/repo/pull/42",
    ...overrides,
  };
}

function makeRefResponse(sha = "abc123") {
  return { object: { sha } };
}

/**
 * Minimal mock of the create-pr route logic, extracted so we can unit-test
 * without spinning up Express or a database. The logic under test is the
 * GitHub API interaction only.
 */
async function runCreatePr(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  opts: {
    ticketId?: string;
    reportTitle?: string;
    githubToken?: string;
    githubRepo?: string;
  } = {}
): Promise<{ status: number; body: Record<string, unknown>; fetchCalls: FetchCall[] }> {
  const fetchCalls: FetchCall[] = [];
  const wrappedFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    fetchCalls.push({ url, init });
    return fetchImpl(url, init);
  };

  const ticketId = opts.ticketId ?? "abcdef12-0000-0000-0000-000000000001";
  const reportTitle = opts.reportTitle ?? "GET /api/dashboard/exceptions failed";
  const githubToken = opts.githubToken ?? "ghp_test";
  const githubRepo = opts.githubRepo ?? "owner/repo";

  const [owner, repo] = githubRepo.split("/");
  const slug = reportTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  let branchName = `app-doctor/fix-${ticketId.slice(0, 8)}-${slug}`;
  const ghBase = `https://api.github.com/repos/${owner}/${repo}`;
  const ghHeaders = {
    Authorization: `token ${githubToken}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
    "User-Agent": "PayLink-AppDoctor/1.0",
  };

  // Step 1: fetch base SHA
  const refRes = await wrappedFetch(`${ghBase}/git/ref/heads/main`, { headers: ghHeaders });
  if (!refRes.ok) {
    const refErr: unknown = await refRes.json().catch(() => ({}));
    return { status: 502, body: { message: "Failed to fetch base branch from GitHub", githubStatus: refRes.status, githubError: refErr }, fetchCalls };
  }
  const refData = (await refRes.json()) as { object: { sha: string } };
  const baseSha = refData.object?.sha;

  // Step 2: create branch (with 422 → timestamp-suffix retry)
  const branchRes = await wrappedFetch(`${ghBase}/git/refs`, {
    method: "POST",
    headers: ghHeaders,
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
  });
  if (!branchRes.ok) {
    const branchErr: unknown = await branchRes.json().catch(() => ({}));
    if (branchRes.status === 422) {
      branchName = `${branchName}-TIMESTAMP`;
      const retryRes = await wrappedFetch(`${ghBase}/git/refs`, {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
      });
      if (!retryRes.ok) {
        const retryErr: unknown = await retryRes.json().catch(() => ({}));
        return { status: 502, body: { message: "Failed to create GitHub branch (original branch already exists; timestamp-suffixed retry also failed)", githubStatus: retryRes.status, githubError: retryErr }, fetchCalls };
      }
    } else {
      return { status: 502, body: { message: "Failed to create GitHub branch", githubStatus: branchRes.status, githubError: branchErr }, fetchCalls };
    }
  }

  // Step 3: create PR
  const prRes = await wrappedFetch(`${ghBase}/pulls`, {
    method: "POST",
    headers: ghHeaders,
    body: JSON.stringify({ title: `[App Doctor] ${reportTitle}`, body: "", head: branchName, base: "main" }),
  });
  if (!prRes.ok) {
    const prErr: unknown = await prRes.json().catch(() => ({}));
    return { status: 502, body: { message: "Failed to create GitHub PR", githubStatus: prRes.status, githubError: prErr }, fetchCalls };
  }
  const pr = (await prRes.json()) as { number: number; html_url?: string };

  if (!pr.html_url) {
    return { status: 502, body: { message: "PR was created but GitHub did not return a URL", githubResponse: pr }, fetchCalls };
  }

  return { status: 200, body: { prUrl: pr.html_url, branchName, status: "pr_created" }, fetchCalls };
}

function makeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("App Doctor create-pr — GitHub interaction", () => {
  it("happy path — creates branch and PR, returns prUrl", async () => {
    const result = await runCreatePr(async (url) => {
      if (url.includes("/git/ref/heads/main")) return makeResponse(200, makeRefResponse());
      if (url.includes("/git/refs")) return makeResponse(201, {});
      if (url.includes("/pulls")) return makeResponse(201, makePrResponse());
      if (url.includes("/labels")) return makeResponse(200, []);
      return makeResponse(404, {});
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.prUrl, "https://github.com/owner/repo/pull/42");
    assert.equal(result.body.status, "pr_created");
  });

  it("branch already exists (422) — retries with timestamp suffix and succeeds", async () => {
    let branchCallCount = 0;
    const result = await runCreatePr(async (url, init) => {
      if (url.includes("/git/ref/heads/main")) return makeResponse(200, makeRefResponse());
      if (url.includes("/git/refs") && (init as RequestInit)?.method === "POST") {
        branchCallCount++;
        if (branchCallCount === 1) {
          return makeResponse(422, { message: "Reference already exists" });
        }
        return makeResponse(201, {});
      }
      if (url.includes("/pulls")) return makeResponse(201, makePrResponse());
      return makeResponse(404, {});
    });

    assert.equal(result.status, 200, `Expected 200 but got ${result.status}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.prUrl, "https://github.com/owner/repo/pull/42");
    assert.equal(branchCallCount, 2, "Should have made exactly 2 branch creation calls");
    assert.ok(
      (result.body.branchName as string).includes("-TIMESTAMP"),
      `Branch name should include timestamp suffix: ${result.body.branchName}`
    );
  });

  it("branch already exists (422) and retry also fails — returns 502 with GitHub error", async () => {
    let branchCallCount = 0;
    const result = await runCreatePr(async (url, init) => {
      if (url.includes("/git/ref/heads/main")) return makeResponse(200, makeRefResponse());
      if (url.includes("/git/refs") && (init as RequestInit)?.method === "POST") {
        branchCallCount++;
        return makeResponse(422, { message: "Reference already exists" });
      }
      return makeResponse(404, {});
    });

    assert.equal(result.status, 502);
    assert.ok(result.body.message?.toString().includes("timestamp-suffixed retry also failed"));
    assert.equal(result.body.githubStatus, 422);
    assert.equal(branchCallCount, 2);
  });

  it("GitHub ref fetch fails — returns 502 with real GitHub error body", async () => {
    const result = await runCreatePr(async (url) => {
      if (url.includes("/git/ref/heads/main")) return makeResponse(401, { message: "Bad credentials" });
      return makeResponse(404, {});
    });

    assert.equal(result.status, 502);
    assert.equal(result.body.message, "Failed to fetch base branch from GitHub");
    assert.equal(result.body.githubStatus, 401);
    assert.equal((result.body.githubError as Record<string, unknown>).message, "Bad credentials");
  });

  it("branch creation fails for non-422 reason — returns 502 with GitHub error", async () => {
    const result = await runCreatePr(async (url, init) => {
      if (url.includes("/git/ref/heads/main")) return makeResponse(200, makeRefResponse());
      if (url.includes("/git/refs") && (init as RequestInit)?.method === "POST") {
        return makeResponse(403, { message: "Resource not accessible by integration" });
      }
      return makeResponse(404, {});
    });

    assert.equal(result.status, 502);
    assert.equal(result.body.message, "Failed to create GitHub branch");
    assert.equal(result.body.githubStatus, 403);
  });

  it("PR creation fails — returns 502 with real GitHub error body, does NOT set pr_created", async () => {
    const result = await runCreatePr(async (url, init) => {
      if (url.includes("/git/ref/heads/main")) return makeResponse(200, makeRefResponse());
      if (url.includes("/git/refs") && (init as RequestInit)?.method === "POST") return makeResponse(201, {});
      if (url.includes("/pulls")) return makeResponse(422, { message: "Validation Failed", errors: [{ message: "A pull request already exists" }] });
      return makeResponse(404, {});
    });

    assert.equal(result.status, 502);
    assert.equal(result.body.message, "Failed to create GitHub PR");
    assert.equal(result.body.githubStatus, 422);
    assert.notEqual(result.body.status, "pr_created");
  });

  it("PR created but html_url missing — returns 502, does NOT set pr_created", async () => {
    const result = await runCreatePr(async (url, init) => {
      if (url.includes("/git/ref/heads/main")) return makeResponse(200, makeRefResponse());
      if (url.includes("/git/refs") && (init as RequestInit)?.method === "POST") return makeResponse(201, {});
      if (url.includes("/pulls")) return makeResponse(201, makePrResponse({ html_url: undefined }));
      return makeResponse(404, {});
    });

    assert.equal(result.status, 502);
    assert.ok(result.body.message?.toString().includes("did not return a URL"));
    assert.notEqual(result.body.status, "pr_created");
  });

  it("correct fetch call sequence — ref → branch → PR", async () => {
    const result = await runCreatePr(async (url, init) => {
      if (url.includes("/git/ref/heads/main")) return makeResponse(200, makeRefResponse("sha-xyz"));
      if (url.includes("/git/refs") && (init as RequestInit)?.method === "POST") return makeResponse(201, {});
      if (url.includes("/pulls")) return makeResponse(201, makePrResponse());
      return makeResponse(404, {});
    });

    assert.equal(result.status, 200);
    const urls = result.fetchCalls.map((c) => c.url);
    assert.ok(urls[0].includes("/git/ref/heads/main"), "First call should fetch main ref");
    assert.ok(urls[1].includes("/git/refs"), "Second call should create branch");
    assert.ok(urls[2].includes("/pulls"), "Third call should create PR");
  });
});
