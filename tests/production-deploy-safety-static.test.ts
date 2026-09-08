import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/deploy-production.yml", "utf8");
const script = fs.readFileSync("scripts/deploy-paylink.sh", "utf8");
const stagingWorkflow = fs.readFileSync(".github/workflows/deploy-app.yml", "utf8");

for (const [file, content] of [["deploy-production.yml", workflow], ["deploy-app.yml", stagingWorkflow]] as const) {
  assert(!/^(<<<<<<<|=======|>>>>>>>)$/m.test(content), `${file} has no unresolved merge conflict markers`);
  assert(!content.includes("luxit") && !content.includes("/root/lux-email-bot") && !content.includes("luxit-prod") && !content.includes("luxit-staging") && !content.includes("systemd"), `${file} does not contain unrelated luxit/systemd deployment references`);
}
assert(workflow.includes("ref: refs/tags/${{ inputs.release_tag }}") && workflow.includes('refs/tags/$RELEASE_TAG') && workflow.includes("branch names like main are not deployable"), "production workflow checks out exact existing tag refs and rejects branches");
assert(!workflow.includes("set -a") && !workflow.includes("source $ENV_FILE") && !workflow.includes("source /etc/paylink/" + "production" + ".env"), "production workflow does not broadly source production env before install/build");
assert(workflow.includes("dotenv_get") && workflow.includes("DATABASE_URL") && workflow.includes("pg_dump") && workflow.includes("umask 077") && workflow.includes("chmod 600 \"$BACKUP_FILE\"") && workflow.includes("chmod 700 \"$BACKUP_DIR\""), "production workflow privately extracts DATABASE_URL only for backups");
assert(workflow.includes("PRIOR_COMMIT") && workflow.includes("PRIOR_VERSION") && workflow.includes("CANDIDATE_PM2") && workflow.includes("restore_prior_release") && workflow.includes("trap 'restore_prior_release' ERR"), "production workflow preserves prior release and restores it on failure");
assert(workflow.includes("https://mypaylink.app/health") && workflow.includes("https://app.mypaylink.app/health"), "production workflow validates apex and app-subdomain public HTTPS health");
assert(script.includes('git rev-parse -q --verify "refs/tags/$RELEASE_TAG"') && script.includes('git checkout --force "refs/tags/$RELEASE_TAG"'), "deploy script validates and checks out exact production tag refs");
assert(!script.includes('\nsource "$ENV_FILE"') && !script.includes("set -a"), "deploy script does not globally source production env");
assert(script.includes("DATABASE_URL_FOR_BACKUP") && script.includes("umask 077") && script.includes("chmod 600 \"$BACKUP_FILE\"") && script.includes("chmod 700 \"$BACKUP_DIR\""), "deploy script creates private DB backups using narrow DATABASE_URL parsing");
assert(script.includes("CANDIDATE_PM2_PROCESS") && script.includes("without deleting current production") && script.includes("rollback"), "deploy script starts candidate before PM2 swap and retains rollback path");

console.log("PASS: production deploy safety static checks passed");
