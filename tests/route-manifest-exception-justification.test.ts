#!/usr/bin/env tsx
/**
 * Phase 0.5-B deterministic guard: every route classified outside the two
 * "default" categories (authenticated tenant-scoped / authenticated
 * global-self-service) is, by definition, an exception to tenant scoping —
 * public, legacy, platform-only, or an integration callback — and must carry
 * a non-empty human-written justification in the manifest. An exception with
 * no justification is exactly the failure mode this test exists to catch:
 * scope creep into "public" or "platform-console" with no recorded reason.
 */
import fs from "node:fs";
import assert from "node:assert/strict";

const MANIFEST_PATH = "docs/saas-readiness/route-security-manifest.json";

const EXCEPTION_CATEGORIES = new Set([
  "public anonymous",
  "public token-protected",
  "platform-console only",
  "webhook/integration callback",
  "internal diagnostics/health",
  "deprecated/legacy",
]);

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

const missingJustification: string[] = [];
let exceptionCount = 0;

for (const entry of manifest.entries) {
  if (!EXCEPTION_CATEGORIES.has(entry.category)) continue;
  exceptionCount++;
  const justification = entry.justification;
  if (typeof justification !== "string" || justification.trim().length === 0) {
    missingJustification.push(`${entry.id} (${entry.category})`);
  }
}

assert.equal(
  missingJustification.length,
  0,
  `${missingJustification.length} exception route(s) missing a justification: ${missingJustification.slice(0, 10).join("; ")}`,
);

console.log(`route-manifest-exception-justification: OK — ${exceptionCount} exception routes, all justified.`);
