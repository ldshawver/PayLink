/**
 * Static regression checks for blank external contract signing page.
 * Run: npx tsx tests/public-contract-signing-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("client/src/App.tsx", "utf8");
const page = fs.readFileSync("client/src/pages/contract-signing.tsx", "utf8");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const signingFlow = fs.readFileSync("server/contract-signing-flow.ts", "utf8");
const index = fs.readFileSync("server/index.ts", "utf8");

assert(app.includes('location.startsWith("/sign/contracts/")') && app.includes("<ContractSigningPage />"), "/sign/contracts/:token route is mounted before auth/login gate");
assert(page.includes('/api/public/sign/contracts/${encodeURIComponent(token)}') && !page.includes('/api/contractor-contracts/${encodeURIComponent(token)}'), "public signing page calls public endpoint, not authenticated contractor-contracts API");
assert(!page.includes('credentials: "include"'), "public signing fetches do not require session cookies");
assert(page.includes('Loading contract') && page.includes('Contract ready for signature'), "page renders loading and ready-to-sign states");
assert(page.includes('Invalid signing link') && page.includes('Signing link expired') && page.includes('Already signed') && page.includes('Contract fully signed') && page.includes('Signing service unavailable'), "page renders friendly invalid, expired, already-signed, completed, and server-error states");
assert(routes.includes('app.get("/api/public/sign/contracts/:token"') && routes.includes('app.get("/api/public/sign/contracts/:token/status"'), "public GET token endpoint and Documenso status return endpoint exist");
assert(routes.includes('app.post("/api/public/sign/contracts/:token/complete"') && routes.includes('completePublicContractSignature'), "public POST signing action uses token route");
assert(!routes.includes('app.get("/api/public/sign/contracts/:token", requireAuth') && !routes.includes('app.post("/api/public/sign/contracts/:token/complete", requireAuth'), "public signing endpoints do not require logged-in session middleware");
assert(routes.includes('JOIN contractor_contracts cc ON cc.id = cs.contract_id AND cc.company_id = cs.company_id') && routes.includes('dsr.company_id = cc.company_id'), "public token lookup remains tenant/company scoped");
assert(routes.includes('state: "invalid_link"') && routes.includes('state: "expired_link"') && routes.includes('state: "server_error"'), "public API returns safe error reasons for invalid, expired, and server failures");
assert(routes.includes('signingProviderUrl: row.documenso_signing_url') && routes.includes('embeddedSigningData: null'), "public API returns safe signing provider fields");
assert(signingFlow.includes('/sign/contracts/${encodeURIComponent(token)}') && signingFlow.includes('/sign/contracts/${encodeURIComponent(tokenOrContractId)}/status'), "Documenso and reminder URLs use canonical public signing URL");
assert(index.includes("req.path.startsWith('/api/public/sign/')") && index.includes("req.path.startsWith('/sign/')"), "app host masking permits public signing SPA and API routes");

console.log("PASS: public contract signing static checks passed");
