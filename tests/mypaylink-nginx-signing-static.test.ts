/**
 * Static checks for MyPayLink signing deep-link nginx and validation runbook coverage.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const nginx = fs.readFileSync("scripts/nginx-mypaylink.conf", "utf8");
const deployWorkflow = fs.readFileSync(".github/workflows/deploy-app.yml", "utf8");
const applyNginxScript = fs.readFileSync("scripts/apply_mypaylink_nginx.sh", "utf8");
const runbook = fs.readFileSync("DOCUMENSO_SIGNING_LIVE_VALIDATION.md", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

assert(nginx.includes("server_name mypaylink.app app.mypaylink.app;"), "apex and app subdomain share the HTTPS app proxy server block");
assert(nginx.includes("proxy_pass http://127.0.0.1:8000;"), "nginx proxies signing deep links to the PayLink Node app");
assert(!nginx.includes("server_name app.mypaylink.app;\n\n    ssl_certificate") || !nginx.includes("return 301 https://mypaylink.app$request_uri;"), "app subdomain is not isolated in a redirect-only HTTPS server block");
assert(!deployWorkflow.includes("scripts/apply_mypaylink_nginx.sh"), "staging deployment workflow does not mutate nginx config");
assert(applyNginxScript.includes("nginx -T"), "nginx deployment script inspects active production nginx config");
assert(applyNginxScript.includes("Disabling conflicting enabled nginx vhost"), "nginx deployment script disables stale app subdomain vhosts before reload");
assert(applyNginxScript.includes("proxy_pass $APP_UPSTREAM"), "nginx deployment script verifies active app subdomain proxy routing");
assert(runbook.includes("Code-level partial fix complete. Production/live verification and completion lifecycle still required."), "runbook documents non-production-ready status until live validation passes");
assert(runbook.includes("pnpm typecheck") && runbook.includes("tests/contract-signing-redirect-static.test.ts"), "runbook documents correct repo validation commands");
assert(!pkg.scripts?.["lint:ratchet"], "package.json currently has no lint:ratchet script, matching runbook explanation");

console.log("PASS: MyPayLink nginx signing deep-link static checks passed");
