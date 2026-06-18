import express from "express";
import http from "http";
import twilio from "twilio";
import { registerTwilioSmsWebhookRoutes, buildTwilioMessageParams } from "../server/twilio-sms-webhooks";

let pass = 0, fail = 0;
const log = (name: string, ok: boolean, detail?: string) => ok ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`));
const assert = (name: string, ok: boolean, detail?: string) => log(name, ok, detail);

const token = "test_auth_token";
const saved: Array<{ payload: Record<string, string>; source: string }> = [];
const consents: Array<{ phone: string; optedOut: boolean }> = [];
const statuses: Record<string, string>[] = [];
let fallbackThrows = false;

const app = express();
app.use(express.urlencoded({ extended: false, verify: (req, _res, buf) => { req.rawBody = buf; } }));
registerTwilioSmsWebhookRoutes(app, {
  getAuthToken: async () => token,
  saveInboundSms: async (payload, source) => {
    if (fallbackThrows && source === "twilio_fallback") throw new Error("db down");
    saved.push({ payload, source });
  },
  updateSmsConsent: async (phone, optedOut) => { consents.push({ phone, optedOut }); },
  updateSmsStatus: async (payload) => { statuses.push(payload); },
  getSupportContact: () => "support@example.com",
  notifyFallback: () => undefined,
});

const server = http.createServer(app);
function listen(): Promise<number> {
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve((server.address() as any).port)));
}
function close(): Promise<void> { return new Promise(resolve => server.close(() => resolve())); }
function body(params: Record<string, string>) { return new URLSearchParams(params).toString(); }
async function post(port: number, path: string, params: Record<string, string>, valid = true) {
  const url = `http://127.0.0.1:${port}${path}`;
  const sig = valid ? twilio.getExpectedTwilioSignature(token, url, params) : "bad-signature";
  return fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sig }, body: body(params) });
}

(async () => {
  console.log("=== Twilio SMS webhook integration tests ===\n");
  const port = await listen();

  const outbound = buildTwilioMessageParams({ fromNumber: "+18885550123", messagingServiceSid: "", useMessagingService: false, statusCallbackUrl: "https://mypaylink.app/api/twilio/sms/status" }, "5552223333", "hello");
  assert("outbound disabled Messaging Service uses from number", outbound.from === "+18885550123" && !outbound.messagingServiceSid, JSON.stringify(outbound));
  assert("outbound disabled Messaging Service includes status callback", outbound.statusCallback === "https://mypaylink.app/api/twilio/sms/status");

  let r = await post(port, "/api/twilio/sms/inbound", { MessageSid: "SM1", AccountSid: "AC1", From: "5551112222", To: "+18885550123", Body: "hello", NumMedia: "0", SmsStatus: "received" });
  assert("normal inbound form-urlencoded reply returns TwiML", r.status === 200 && (await r.text()).includes("<Response>"));
  assert("normal inbound is logged", saved.some(s => s.source === "twilio_inbound" && s.payload.MessageSid === "SM1"));

  r = await post(port, "/api/twilio/sms/inbound", { MessageSid: "SM2", From: "5551112222", To: "+18885550123", Body: "STOP" });
  assert("STOP marks opted out", r.status === 200 && consents.some(c => c.phone === "+15551112222" && c.optedOut === true));

  r = await post(port, "/api/twilio/sms/inbound", { MessageSid: "SM3", From: "5551112222", To: "+18885550123", Body: "START" });
  assert("START restores opt in", r.status === 200 && consents.some(c => c.phone === "+15551112222" && c.optedOut === false));

  r = await post(port, "/api/twilio/sms/inbound", { MessageSid: "SM4", From: "5551112222", To: "+18885550123", Body: "HELP" });
  const helpXml = await r.text();
  assert("HELP returns support TwiML", helpXml.includes("Reply STOP to opt out") && helpXml.includes("support@example.com"));

  r = await post(port, "/api/twilio/sms/fallback", { MessageSid: "SM5", From: "5551112222", To: "+18885550123", Body: "fallback", ErrorCode: "11200", ErrorUrl: "https://example.test/bad" });
  assert("fallback logs ErrorCode and ErrorUrl", r.status === 200 && saved.some(s => s.source === "twilio_fallback" && s.payload.ErrorCode === "11200" && s.payload.ErrorUrl === "https://example.test/bad"));

  fallbackThrows = true;
  r = await post(port, "/api/twilio/sms/fallback", { MessageSid: "SM6", From: "5551112222", To: "+18885550123", Body: "fallback", ErrorCode: "11201", ErrorUrl: "https://example.test/down" });
  assert("fallback still returns TwiML if DB logging fails", r.status === 200 && (await r.text()).includes("received by MyPayLink support"));

  r = await post(port, "/api/twilio/sms/status", { MessageSid: "SMOUT1", MessageStatus: "delivered", SmsStatus: "delivered", To: "5551112222", From: "+18885550123" });
  assert("status callback delivered updates MessageSid", r.status === 204 && statuses.some(s => s.MessageSid === "SMOUT1" && s.MessageStatus === "delivered"));

  r = await post(port, "/api/twilio/sms/status", { MessageSid: "SMOUT2", MessageStatus: "failed", ErrorCode: "30007", ErrorMessage: "Carrier violation", To: "5551112222", From: "+18885550123" });
  assert("status callback failed stores error details", r.status === 204 && statuses.some(s => s.MessageSid === "SMOUT2" && s.ErrorCode === "30007" && s.ErrorMessage === "Carrier violation"));

  r = await post(port, "/api/twilio/sms/inbound", { MessageSid: "SMBAD", From: "5551112222", To: "+18885550123", Body: "bad" }, false);
  assert("invalid signature rejected", r.status === 403);

  await close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(async e => { console.error(e); await close().catch(() => undefined); process.exit(1); });
