#!/usr/bin/env tsx
/**
 * Phase 0.5-B deterministic guard: every registered server route must appear
 * in docs/saas-readiness/route-security-manifest.json with exactly one valid
 * classification, and the manifest must not have drifted from source.
 *
 * Static/source-only: re-parses server/routes.ts and server/feedback-routes.ts
 * via the same AST extractor the manifest was built from (no database, no
 * network, no live server), then diffs against the committed manifest. Fails
 * the moment a route is added/removed/renamed without regenerating the
 * manifest (`pnpm route-inventory:generate`), so drift is caught in CI
 * instead of silently going stale.
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const MANIFEST_PATH = "docs/saas-readiness/route-security-manifest.json";

const CLASSIFIER = "scripts/route-inventory/classify-routes.ts";

const KNOWN_CATEGORIES = new Set([
  "public anonymous",
  "public token-protected",
  "authenticated global/self-service",
  "authenticated tenant-scoped",
  "platform-console only",
  "webhook/integration callback",
  "internal diagnostics/health",
  "deprecated/legacy",
  "unclassified — merge-blocking",
]);

// 1. The manifest must be byte-for-byte reproducible from current source —
// same route set, no stale/missing entries. --check regenerates in-memory
// and diffs route ids against the committed file.
const check = spawnSync("npx", ["tsx", CLASSIFIER, "--check"], { encoding: "utf8" });
if (check.status !== 0) {
  console.error(check.stdout);
  console.error(check.stderr);
}
assert.equal(check.status, 0, "route-security-manifest.json is out of date with server/routes.ts and server/feedback-routes.ts — run: pnpm route-inventory:generate");

// 2. Structural checks on the committed manifest itself.
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
assert.ok(Array.isArray(manifest.entries) && manifest.entries.length > 0, "manifest must contain route entries");
assert.equal(manifest.routeCount, manifest.entries.length, "routeCount must match entries.length");

const seen = new Map<string, string>();
const duplicates: string[] = [];
const conflicting: string[] = [];
const unknownCategory: string[] = [];
const unclassified: string[] = [];

for (const entry of manifest.entries) {
  if (!KNOWN_CATEGORIES.has(entry.category)) unknownCategory.push(entry.id);
  if (entry.category === "unclassified — merge-blocking") unclassified.push(entry.id);

  const prevCategory = seen.get(entry.id);
  if (prevCategory === undefined) {
    seen.set(entry.id, entry.category);
  } else {
    duplicates.push(entry.id);
    if (prevCategory !== entry.category) conflicting.push(entry.id);
  }
}

assert.equal(unknownCategory.length, 0, `entries with a category outside the known set: ${unknownCategory.slice(0, 10).join(", ")}`);
assert.equal(unclassified.length, 0, `merge-blocking: ${unclassified.length} route(s) are unclassified — ${unclassified.slice(0, 10).join(", ")}`);
assert.equal(duplicates.length, 0, `duplicate route id(s) in manifest: ${duplicates.slice(0, 10).join(", ")}`);
assert.equal(conflicting.length, 0, `route id(s) with conflicting classifications across duplicate entries: ${conflicting.slice(0, 10).join(", ")}`);

console.log(`route-manifest-completeness: OK — ${manifest.routeCount} routes, all classified, no drift, no duplicates.`);
