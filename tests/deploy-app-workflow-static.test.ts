/**
 * Static regression checks for MyPayLink deployment safety.
 * Run: npx tsx tests/deploy-app-workflow-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/deploy-app.yml", "utf8");

function ok(name: string, condition: boolean) {
  assert.ok(condition, `FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

ok("push/main deploys staging only", workflow.includes("on:\n  push:\n    branches:\n      - main") && workflow.includes("TARGET_ENV: ${{ github.event_name == 'push' && 'staging' || github.event.inputs.target_environment }}") && workflow.includes("Push to main deploys staging only."));
ok("production deploy is workflow_dispatch-gated", workflow.includes("workflow_dispatch:") && workflow.includes("target_environment:") && workflow.includes("- production"));
ok("production requires release_tag", workflow.includes("release_tag:") && workflow.includes("Production deployment requires release_tag.") && workflow.includes("production deployments require a Git release tag"));
ok("staging uses required env/domain/port", workflow.includes("APP_ENV: ${{ (github.event_name == 'push' || github.event.inputs.target_environment == 'staging') && 'staging' || 'production' }}") && workflow.includes("/etc/paylink/.env.staging") && workflow.includes("PM2_PROCESS: ${{ (github.event_name == 'push' || github.event.inputs.target_environment == 'staging') && 'paylink-staging' || 'paylink' }}") && workflow.includes("DEPLOY_PORT: ${{ (github.event_name == 'push' || github.event.inputs.target_environment == 'staging') && '8010' || '8000' }}") && workflow.includes("https://staging.mypaylink.app/health"));
ok("production uses required env/domain/port", workflow.includes("/etc/paylink/.env") && workflow.includes("PROD_PM2_PROCESS: paylink") && workflow.includes('PROD_PORT: "8000"') && workflow.includes("https://app.mypaylink.app/health"));
ok("staging health checks local and public CloudPanel routes", workflow.includes("http://127.0.0.1:8010/health") && workflow.includes("https://staging.mypaylink.app/health"));
ok("production health checks local and public routes", workflow.includes("http://127.0.0.1:8000/health") && workflow.includes("https://app.mypaylink.app/health"));
ok("workflow gates deployment on typecheck, signing static tests, CloudPanel static tests, and build", workflow.includes("pnpm typecheck") && workflow.includes("Signing route regression tests") && workflow.includes("tests/cloudpanel-deployment-workflows-static.test.ts") && workflow.includes("pnpm build"));
ok("workflow has no luxit or systemd targets", !workflow.includes("luxit") && !workflow.includes("/root/lux-email-bot") && !workflow.includes("systemctl"));

console.log("\nDeploy app workflow safety checks passed.");
