/**
 * Static regression checks for CloudPanel staging deployment validation.
 * Run: npx tsx tests/deploy-app-workflow-static.test.ts
 */
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/deploy-app.yml", "utf8");
function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

ok("deploy-app is staging-only", workflow.includes("Deploy MyPayLink Staging") && workflow.includes("APP_ENV: staging") && workflow.includes("PM2_PROCESS: paylink-staging"));
ok("staging uses required env/domain/port", workflow.includes("/etc/paylink/.env.staging") && workflow.includes("staging.mypaylink.app") && workflow.includes('DEPLOY_PORT: "8010"'));
ok("staging health checks local and public CloudPanel routes", workflow.includes("http://127.0.0.1:8010/health") && workflow.includes("https://staging.mypaylink.app/health"));
ok("workflow gates deployment on typecheck, signing static tests, CloudPanel static tests, and build", workflow.includes("pnpm typecheck") && workflow.includes("Signing route regression tests") && workflow.includes("tests/cloudpanel-deployment-workflows-static.test.ts") && workflow.includes("pnpm build"));
ok("workflow does not apply nginx because CloudPanel owns nginx reverse proxy", workflow.includes("CloudPanel owns nginx reverse proxy; workflow expects") && !workflow.includes("scripts/apply_mypaylink_nginx.sh"));

console.log("\nDeploy app staging workflow checks passed.");
