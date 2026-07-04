/**
 * Static checks for GitHub Actions deployment validation and version reporting.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const stagingWorkflow = fs.readFileSync(".github/workflows/deploy-app.yml", "utf8");
const productionWorkflow = fs.readFileSync(".github/workflows/deploy-production.yml", "utf8");
const versionEndpoint = fs.readFileSync("server/index.ts", "utf8");
const smokeScript = fs.readFileSync("scripts/verify_documenso_signing.sh", "utf8");

assert(stagingWorkflow.includes("Signing route regression tests") && stagingWorkflow.includes("pnpm typecheck") && stagingWorkflow.includes("pnpm build"), "staging deploy workflow gates deployment on typecheck, tests, and build");
assert(productionWorkflow.includes("workflow_dispatch:") && productionWorkflow.includes("release_tag:") && !productionWorkflow.includes("\n  push:"), "production deploy workflow is manual-only and requires release tag input");
assert(stagingWorkflow.includes('PAYLINK_COMMIT="$NEW_COMMIT"') && stagingWorkflow.includes("PAYLINK_BUILD_TIME"), "staging workflow injects deployed commit and build time");
assert(productionWorkflow.includes('PAYLINK_COMMIT="$NEW_COMMIT"') && productionWorkflow.includes("PAYLINK_BUILD_TIME"), "production workflow injects deployed commit and build time");
assert(productionWorkflow.includes("pg_dump") && productionWorkflow.includes("DATABASE_URL"), "production workflow backs up DB before deploy");
assert(versionEndpoint.includes('app.get("/api/version"') && versionEndpoint.includes("PAYLINK_COMMIT") && versionEndpoint.includes("PAYLINK_BUILD_TIME"), "server exposes /api/version with commit and build time");
assert(smokeScript.includes("/app/contractor-hub/contracts/$AFFECTED_CONTRACT_ID/sign") && smokeScript.includes("/sign/contracts/test-invalid"), "smoke script checks affected contract and public signing routes");
assert(smokeScript.includes("EXPIRED_SIGNING_URL") && smokeScript.includes("ALREADY_SIGNED_URL") && smokeScript.includes("FULLY_SIGNED_URL") && smokeScript.includes("UNAUTHORIZED_SIGNING_URL"), "smoke script supports lifecycle state URLs");
assert(smokeScript.includes("/api/version") && smokeScript.includes("EXPECTED_COMMIT"), "smoke script verifies deployed version endpoint commit");

console.log("PASS: deployment validation static checks passed");
