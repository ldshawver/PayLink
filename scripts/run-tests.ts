#!/usr/bin/env tsx
/**
 * Phase 0.5-A test-suite runner.
 *
 * Runs the file list for one named suite from scripts/test-suites.json, in the
 * same per-file style CI already uses (`npx tsx <file>`, each file owns its own
 * pass/fail reporting and exit code). This script never mutates a suite's file
 * list — that list is curated by direct classification, see
 * docs/saas-readiness/phase-0.5-a-ci-baseline-manifest.md.
 *
 * Usage: tsx scripts/run-tests.ts <required|db|e2e|external|live>
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const suiteName = process.argv[2];
const manifestPath = path.join(process.cwd(), "scripts", "test-suites.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (!suiteName || !manifest.suites[suiteName]) {
  console.error(`Usage: tsx scripts/run-tests.ts <${Object.keys(manifest.suites).join("|")}>`);
  process.exit(2);
}

const suite = manifest.suites[suiteName];
const files: string[] = suite.files;

console.log(`=== Suite: ${suiteName} (${files.length} file${files.length === 1 ? "" : "s"}) ===`);
console.log(suite.description);
if (suite.prerequisites?.length) {
  console.log(`Prerequisites: ${suite.prerequisites.join(", ")}`);
}
console.log("");

if (files.length === 0) {
  console.log(`No files defined in the "${suiteName}" suite yet. Nothing to run — this is not a failure.`);
  process.exit(0);
}

let failed = 0;
const results: Array<{ file: string; ok: boolean }> = [];

for (const file of files) {
  console.log(`--- ${file} ---`);
  const result = spawnSync("npx", ["tsx", file], { stdio: "inherit" });
  const ok = result.status === 0;
  results.push({ file, ok });
  if (!ok) failed++;
  console.log("");
}

console.log("=== Summary ===");
for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.file}`);
}
console.log(`\n${results.length - failed} passed, ${failed} failed (suite: ${suiteName})`);

process.exit(failed > 0 ? 1 : 0);
