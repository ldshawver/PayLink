/**
 * Static checks for GitHub Actions deployment validation and version reporting.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/deploy-app.yml", "utf8");
const versionEndpoint = fs.readFileSync("server/index.ts", "utf8");
const smokeScript = fs.readFileSync("scripts/verify_documenso_signing.sh", "utf8");

assert(workflow.includes("Signing route regression tests") && workflow.includes("pnpm typecheck") && workflow.includes("pnpm build"), "deploy workflow gates deployment on typecheck, tests, and build");
assert(workflow.includes("Production signing smoke tests") && workflow.includes("./scripts/verify_documenso_signing.sh"), "deploy workflow runs production signing smoke tests after deployment");
assert(workflow.includes("actions/upload-artifact@v4") && workflow.includes("retention-days: 30"), "deploy workflow uploads smoke artifacts retained for 30 days");
assert(workflow.includes('PAYLINK_COMMIT="$NEW_COMMIT"') && workflow.includes("PAYLINK_BUILD_TIME"), "deploy workflow injects deployed commit and build time into PM2 process");
assert(versionEndpoint.includes('app.get("/api/version"') && versionEndpoint.includes("PAYLINK_COMMIT") && versionEndpoint.includes("PAYLINK_BUILD_TIME"), "server exposes /api/version with commit and build time");
assert(smokeScript.includes("/app/contractor-hub/contracts/$AFFECTED_CONTRACT_ID/sign") && smokeScript.includes("/sign/test-invalid"), "smoke script checks affected contract and public signing routes");
assert(smokeScript.includes("EXPIRED_SIGNING_URL") && smokeScript.includes("ALREADY_SIGNED_URL") && smokeScript.includes("FULLY_SIGNED_URL") && smokeScript.includes("UNAUTHORIZED_SIGNING_URL"), "smoke script supports lifecycle state URLs");
assert(smokeScript.includes("/api/version") && smokeScript.includes("EXPECTED_COMMIT"), "smoke script verifies deployed version endpoint commit");

console.log("PASS: deployment validation static checks passed");
