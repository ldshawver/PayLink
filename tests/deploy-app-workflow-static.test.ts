/**
 * Static regression checks for MyPayLink staging/production workflow isolation.
 * Run: npx tsx tests/deploy-app-workflow-static.test.ts
 */
import fs from "node:fs";

const staging = fs.readFileSync(".github/workflows/deploy-app.yml", "utf8");
const production = fs.readFileSync(".github/workflows/deploy-production.yml", "utf8");
const marketing = fs.readFileSync(".github/workflows/deploy-marketing.yml", "utf8");
const audit = fs.readFileSync(".github/workflows/vps-mypaylink-audit.yml", "utf8");
const workflows = [staging, production, marketing, audit].join("\n---\n");
function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

ok("push to main deploys staging workflow only", staging.includes("push:") && staging.includes("paylink-staging") && staging.includes("/home/paylinkssh/paylink-staging/PayLink") && staging.includes('APP_PORT="8010"'));
ok("production deploy is manual only", production.includes("workflow_dispatch:") && !production.includes("push:"));
ok("production requires explicit release_tag", production.includes("release_tag:") && production.includes("required: true") && production.includes('test -n "$RELEASE_TAG"'));
ok("production runs pg_dump before PM2 restart", production.indexOf('pg_dump "$DATABASE_URL"') > -1 && production.indexOf('pm2 delete "$PM2_NAME"') > production.indexOf('pg_dump "$DATABASE_URL"'));
ok("staging and production env files differ", staging.includes('/etc/paylink/staging.env') && production.includes('/etc/paylink/production.env'));
ok("staging and production ports differ", staging.includes('APP_PORT="8010"') && production.includes('APP_PORT="8000"'));
ok("staging workflow does not mutate nginx", !/apply_mypaylink_nginx|nginx -t|nginx -s|reload nginx/i.test(staging));
ok("workflows do not reference disallowed Luxit/systemctl targets", !/luxit|\/root\/lux-email-bot|systemctl|luxit-prod|luxit-staging/i.test(workflows));
ok("marketing production deploy is manual, not push-to-main", marketing.includes("workflow_dispatch:") && !marketing.includes("push:"));

console.log("\nDeploy workflow isolation checks passed.");
