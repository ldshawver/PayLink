import assert from "node:assert/strict";
import fs from "node:fs";

const documenso = fs.readFileSync("server/services/documenso.ts", "utf8");
assert(documenso.includes("MYPAYLINK_DOCUMENSO_API_KEY") && documenso.includes("DOCUMENSO_API_KEY"), "Documenso API key supports production and legacy env names");
assert(documenso.includes("apiKeyConfigured") && documenso.includes("MISSING — e-signature disabled"), "Documenso config validation reports missing API key without printing secrets");
assert(documenso.includes("MYPAYLINK_DOCUMENSO_WEBHOOK_SECRET") && documenso.includes("timingSafeEqual"), "Documenso webhook secret verification supports configured secret names and constant-time compare");

const routes = fs.readFileSync("server/routes.ts", "utf8");
assert(!routes.includes("u.phone"), "Contract notification queries no longer select missing users.phone");
assert(routes.includes("COALESCE(w.phone, w.mobile_phone, NULL) AS phone"), "Contract notifications source phone from workers with safe null fallback");
assert(routes.includes("WHERE id = ${reportId}::varchar"), "AppDoctor report updates cast nullable report id parameter");
assert(routes.includes("INSERT INTO documenso_signature_requests") && routes.includes("documenso_document_id") && routes.includes("documenso_signing_url") && routes.includes("documenso_recipient_ids") && routes.includes("raw_response"), "Send-for-signature persists Documenso document id, signing URL, recipient ids, and raw response");
assert(routes.includes("UPDATE contract_signers") && routes.includes("documenso_recipient_id") && routes.includes("documenso_signing_url"), "Send-for-signature persists signer recipient ids and signing URLs without duplicate sends");

const index = fs.readFileSync("server/index.ts", "utf8");
assert(index.includes("ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS push_enabled"), "Startup schema repair adds push_enabled when older DBs drift");
assert(index.includes("ALTER TABLE documenso_signature_requests ADD COLUMN IF NOT EXISTS documenso_signing_url") && index.includes("ALTER TABLE contract_signers ADD COLUMN IF NOT EXISTS documenso_recipient_id"), "Startup schema repair adds missing Documenso metadata columns");
assert(index.includes("reusePort: false"), "Server does not enable SO_REUSEPORT for duplicate PayLink binders");

const migration = fs.readFileSync("migrations/0011_notification_preferences_push_enabled.sql", "utf8");
assert(migration.includes("ADD COLUMN IF NOT EXISTS push_enabled") && migration.includes("ADD COLUMN IF NOT EXISTS documenso_signing_url") && migration.includes("ADD COLUMN IF NOT EXISTS documenso_recipient_id"), "Idempotent migration adds only missing notification and Documenso metadata columns");

const guard = fs.readFileSync("server/middleware/api-json-guard.ts", "utf8");
assert(guard.includes("res.statusCode === 304") && guard.includes("application\\/pdf"), "API JSON guard ignores 304 and allowed binary/PDF responses");

const deploy = fs.readFileSync("scripts/deploy-paylink.sh", "utf8");
assert(deploy.includes("dist/public/index.html") && deploy.includes("Refusing PM2 restart"), "Deploy script verifies frontend index.html before PM2 restart");
assert(deploy.includes("pm2 delete paylink-app") && deploy.includes("non-PayLink process"), "Deploy script guards duplicate PM2 apps without killing unrelated port owners");

console.log("urgent production static regression checks passed");
