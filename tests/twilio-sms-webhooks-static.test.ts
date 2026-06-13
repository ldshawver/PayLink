import fs from "fs";

let pass = 0;
let fail = 0;
const log = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};
const includes = (file: string, needle: string) => fs.readFileSync(file, "utf8").includes(needle);
const matches = (file: string, pattern: RegExp) => pattern.test(fs.readFileSync(file, "utf8"));

console.log("=== Twilio SMS webhook static acceptance tests ===\n");

log("outbound prefers from number when useMessagingService is false", matches("server/twilio-sms-webhooks.ts", /if \(creds\.useMessagingService && creds\.messagingServiceSid\?\.trim\(\)\)[\s\S]*params\.from = normalizeSmsPhone\(creds\.fromNumber!\)/));
log("outbound does not require Messaging Service SID", includes("server/notifications.ts", "useMessagingService ? dbCfg.messagingServiceSid : dbCfg.fromNumber"));
log("outbound sends statusCallback", includes("server/twilio-sms-webhooks.ts", "statusCallback: creds.statusCallbackUrl"));
log("outbound blocks opted-out recipients", includes("server/notifications.ts", "SMS blocked: recipient opted out."));
log("primary inbound endpoint exists", includes("server/twilio-sms-webhooks.ts", 'app.post("/api/twilio/sms/inbound"'));
log("fallback endpoint exists and records ErrorUrl", includes("server/twilio-sms-webhooks.ts", 'app.post("/api/twilio/sms/fallback"') && includes("server/routes.ts", "payload.ErrorUrl"));
log("status callback updates by MessageSid", includes("server/twilio-sms-webhooks.ts", 'app.post("/api/twilio/sms/status"') && includes("server/routes.ts", "WHERE message_sid = ${payload.MessageSid"));
log("invalid Twilio signatures return 403", matches("server/twilio-sms-webhooks.ts", /validateTwilioWebhook[\s\S]*return res\.status\(403\)/));
log("STOP keywords opt out", includes("server/twilio-sms-webhooks.ts", "STOPALL") && includes("server/twilio-sms-webhooks.ts", "await deps.updateSmsConsent(from, true)"));
log("START keywords opt in", includes("server/twilio-sms-webhooks.ts", "UNSTOP") && includes("server/twilio-sms-webhooks.ts", "await deps.updateSmsConsent(from, false)"));
log("HELP returns support TwiML", includes("server/twilio-sms-webhooks.ts", "MyPayLink alerts: Reply STOP to opt out"));
log("urlencoded raw body capture is configured", includes("server/index.ts", "express.urlencoded") && includes("server/index.ts", "req.rawBody = buf"));
log("TwiML XML responses are used", includes("server/twilio-sms-webhooks.ts", "<Response><Message>") && includes("server/twilio-sms-webhooks.ts", 'res.type("text/xml")'));
log("admin UI has Messaging Service toggle default off", includes("client/src/pages/sms-settings.tsx", "useMessagingService: false") && includes("client/src/pages/sms-settings.tsx", "switch-use-messaging-service"));
log("webhook URLs are displayed in admin UI", includes("client/src/pages/sms-settings.tsx", "https://mypaylink.app/api/twilio/sms/inbound") && includes("client/src/pages/sms-settings.tsx", "https://mypaylink.app/api/twilio/sms/fallback") && includes("client/src/pages/sms-settings.tsx", "https://mypaylink.app/api/twilio/sms/status"));
log("additive SMS migration exists", includes("migrations/20260613_twilio_sms_webhooks.sql", "CREATE TABLE IF NOT EXISTS sms_messages") && includes("migrations/20260613_twilio_sms_webhooks.sql", "CREATE TABLE IF NOT EXISTS sms_consent"));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
