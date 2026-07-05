import fs from "fs";
import assert from "node:assert/strict";

const index = fs.readFileSync("server/index.ts", "utf8");
const metadata = fs.readFileSync("server/app-metadata.ts", "utf8");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const appDoctor = fs.readFileSync("client/src/pages/app-doctor.tsx", "utf8");
const docs = fs.readFileSync("docs/deployment/staging-production-architecture.md", "utf8");
const refresh = fs.readFileSync("scripts/refresh-staging-db.sh", "utf8");

assert(metadata.includes('"production"') && metadata.includes('"staging"') && metadata.includes('"development"'), "APP_ENV supports production, staging, and development");
assert(metadata.includes("APP_VERSION") && metadata.includes("2.1.1"), "APP_VERSION is read with 2.1.1 fallback");
assert(index.includes('app.get("/health"') && metadata.includes("getHealthPayload") && metadata.includes("database: await getDatabaseHealth()"), "/health returns environment/version/commit/database/timestamp payload");
assert(index.includes('app.get("/api/version"') && index.includes("version: getAppVersion()") && index.includes("environment: getAppEnvironment()"), "/api/version reports environment and version");
assert(routes.includes("version: getAppVersion()") && routes.includes("environment: getAppEnvironment()"), "diagnostics API reports environment and version");
assert(appDoctor.includes("data-testid=\"card-environment-version\"") && appDoctor.includes("Version {diag.version}"), "diagnostics UI shows environment/version");
assert(docs.includes("paylink-staging") && docs.includes("PM2 process") && docs.includes("mypaylink_prod") && docs.includes("mypaylink_staging") && docs.includes("app.mypaylink.app") && docs.includes("staging.mypaylink.app") && docs.includes("`8000`") && docs.includes("`8010`") && docs.includes("/home/paylinkssh/paylink-app/PayLink"), "deployment docs define isolated prod/staging architecture");
assert(docs.includes("v2.1.1") && docs.includes("v2.1.2") && docs.includes("v2.2.0"), "deployment docs list release tag examples");
assert(docs.includes("Production deployment checklist") && docs.includes("Rollback checklist") && docs.includes("Migration safety"), "deployment docs include deployment, rollback, and migration safety checklists");
assert(refresh.includes('CONFIRM_TARGET_DB=$STAGING_DB_NAME') && refresh.includes('STAGING_DB_NAME" != "mypaylink_staging') && refresh.includes("pg_dump") && refresh.includes("pg_restore") && refresh.includes("UPDATE users") && refresh.includes("STAGING_DISABLED_"), "staging refresh script confirms target, dumps prod, restores staging, and sanitizes data");

console.log("staging deployment static checks passed");
