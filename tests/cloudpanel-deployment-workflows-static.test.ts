import assert from "node:assert/strict";
import fs from "node:fs";

const stagingWorkflow = fs.readFileSync(".github/workflows/deploy-app.yml", "utf8");
const productionWorkflow = fs.readFileSync(".github/workflows/deploy-production.yml", "utf8");
const marketingWorkflow = fs.readFileSync(".github/workflows/deploy-marketing.yml", "utf8");
const appSidebar = fs.readFileSync("client/src/components/app-sidebar.tsx", "utf8");
const platformSidebar = fs.readFileSync("client/src/components/platform-sidebar.tsx", "utf8");
const versionLabel = fs.readFileSync("client/src/components/app-version-label.tsx", "utf8");

assert(stagingWorkflow.includes("Deploy MyPayLink Staging"), "staging workflow is the automatic deploy workflow");
assert(stagingWorkflow.includes("staging.mypaylink.app"), "staging workflow uses staging.mypaylink.app");
assert(stagingWorkflow.includes("http://127.0.0.1:8010/health") && stagingWorkflow.includes('DEPLOY_PORT: "8010"'), "staging workflow checks local port 8010 health");
assert(stagingWorkflow.includes("https://staging.mypaylink.app/health"), "staging workflow checks public staging health");
assert(stagingWorkflow.includes("/etc/paylink/.env.staging") && stagingWorkflow.includes("PM2_PROCESS: paylink-staging") && stagingWorkflow.includes("/home/paylinkssh/paylink-staging/PayLink"), "staging workflow uses staging env and service");

assert(productionWorkflow.includes("workflow_dispatch:") && !productionWorkflow.includes("\n  push:"), "production workflow is manual-only with no push trigger");
assert(marketingWorkflow.includes("workflow_dispatch:") && !marketingWorkflow.includes("\n  push:"), "marketing production workflow has no push trigger");
assert(productionWorkflow.includes("release_tag:") && productionWorkflow.includes("required: true"), "production workflow requires release tag/version input");
assert(productionWorkflow.includes("app.mypaylink.app"), "production workflow uses app.mypaylink.app");
assert(productionWorkflow.includes("http://127.0.0.1:8000/health") && productionWorkflow.includes('DEPLOY_PORT: "8000"'), "production workflow checks local port 8000 health");
assert(productionWorkflow.includes("https://app.mypaylink.app/health"), "production workflow checks public production health");
assert(productionWorkflow.includes("/etc/paylink/.env") && productionWorkflow.includes("PM2_PROCESS: paylink") && productionWorkflow.includes("/home/paylinkssh/paylink-app/PayLink"), "production workflow uses production env and service");
assert(productionWorkflow.includes("pg_dump") && productionWorkflow.includes("refusing production deploy without DB backup"), "production workflow backs up DB before deploy");
assert(stagingWorkflow.includes("CloudPanel owns nginx reverse proxy") && productionWorkflow.includes("CloudPanel owns nginx reverse proxy"), "workflows do not require nginx access when CloudPanel owns reverse proxy");

assert(!appSidebar.includes("PayLink v2.0") && !platformSidebar.includes("PayLink Platform v2.0"), "left nav/footer no longer hardcodes v2.0 labels");
assert(appSidebar.includes("<AppVersionLabel />") && platformSidebar.includes("<AppVersionLabel />"), "sidebars render dynamic app version label");
assert(versionLabel.includes("/api/version") && versionLabel.includes("MyPayLink v{version}"), "dynamic label fetches /api/version and renders MyPayLink v{APP_VERSION}");
assert(!`${stagingWorkflow}
${productionWorkflow}`.includes("luxit") && !`${stagingWorkflow}
${productionWorkflow}`.includes("/root/lux-email-bot") && !`${stagingWorkflow}
${productionWorkflow}`.includes("systemctl"), "MyPayLink deployment workflows do not reference luxit, /root/lux-email-bot, or systemd");

console.log("CloudPanel deployment workflow static checks passed");
