#!/usr/bin/env tsx
/**
 * Phase 0.5r deterministic guard: every route in the Phase 0.5-B target set
 * (low-confidence `authenticated global/self-service` routes, plus every
 * route flagged `clientSuppliedCompanyIdWithoutMembershipCheck`) must appear
 * exactly once in the storage-scope-trace manifest with a recorded, valid
 * disposition — and the trace must not have drifted from current source.
 *
 * Static/source-only: re-derives the target set from the committed Phase
 * 0.5-B route-security manifest and re-runs the tracer's own --check mode
 * (no database, no network, no live server).
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const ROUTE_MANIFEST_PATH = "docs/saas-readiness/route-security-manifest.json";
const TRACE_MANIFEST_PATH = "docs/saas-readiness/storage-scope-trace-manifest.json";
const TRACER = "scripts/storage-scope-trace/trace-routes.ts";

const KNOWN_DISPOSITIONS = new Set(["verified-safe", "needs-runtime-hardening", "needs-negative-test", "unresolved"]);

// 1. The trace manifest must be reproducible from current source.
const check = spawnSync("npx", ["tsx", TRACER, "--check"], { encoding: "utf8" });
if (check.status !== 0) {
  console.error(check.stdout);
  console.error(check.stderr);
}
assert.equal(check.status, 0, "storage-scope-trace-manifest.json is out of date — run: pnpm storage-scope-trace:generate");

// 2. Recompute the expected target set directly from the Phase 0.5-B manifest.
const routeManifest = JSON.parse(fs.readFileSync(ROUTE_MANIFEST_PATH, "utf8"));
const expectedIds = new Set<string>();
for (const e of routeManifest.entries) {
  const lowConfidenceGlobal = e.category === "authenticated global/self-service" && e.confidence === "low";
  const clientSupplied = e.findings.clientSuppliedCompanyIdWithoutMembershipCheck === true;
  if (lowConfidenceGlobal || clientSupplied) expectedIds.add(e.id);
}

const traceManifest = JSON.parse(fs.readFileSync(TRACE_MANIFEST_PATH, "utf8"));
assert.equal(traceManifest.targetCount, traceManifest.entries.length, "targetCount must match entries.length");

const tracedIds = new Set<string>(traceManifest.entries.map((e: { id: string }) => e.id));

const missingFromTrace = [...expectedIds].filter((id) => !tracedIds.has(id));
const extraInTrace = [...tracedIds].filter((id) => !expectedIds.has(id));

assert.equal(missingFromTrace.length, 0, `${missingFromTrace.length} target route(s) from the 0.5-B manifest have no trace entry: ${missingFromTrace.slice(0, 10).join(", ")}`);
assert.equal(extraInTrace.length, 0, `${extraInTrace.length} trace entries no longer correspond to a 0.5-B target route: ${extraInTrace.slice(0, 10).join(", ")}`);
assert.equal(tracedIds.size, expectedIds.size, "trace manifest must have exactly one entry per target route id (no duplicates)");

// 3. Every entry must carry a valid, non-empty disposition and reason.
const badDisposition: string[] = [];
const missingReason: string[] = [];
for (const entry of traceManifest.entries as Array<{ id: string; disposition: string; reason: string }>) {
  if (!KNOWN_DISPOSITIONS.has(entry.disposition)) badDisposition.push(entry.id);
  if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) missingReason.push(entry.id);
}
assert.equal(badDisposition.length, 0, `entries with an unrecognized disposition: ${badDisposition.slice(0, 10).join(", ")}`);
assert.equal(missingReason.length, 0, `entries missing a recorded reason: ${missingReason.slice(0, 10).join(", ")}`);

console.log(`storage-scope-trace-completeness: OK — ${traceManifest.targetCount} target routes, all traced with a recorded disposition, no drift.`);
