import type { Express, Request } from "express";
import twilio from "twilio";

function normalizeSmsPhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export const TWILIO_SMS_URLS = {
  inbound: "https://mypaylink.app/api/twilio/sms/inbound",
  fallback: "https://mypaylink.app/api/twilio/sms/fallback",
  status: "https://mypaylink.app/api/twilio/sms/status",
};

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "YES", "UNSTOP"]);

export interface TwilioSmsWebhookDeps {
  getAuthToken(): Promise<string>;
  saveInboundSms(payload: Record<string, string>, source: "twilio_inbound" | "twilio_fallback"): Promise<void>;
  updateSmsConsent(phoneNumber: string, optedOut: boolean): Promise<void>;
  updateSmsStatus(payload: Record<string, string>): Promise<void>;
  getSupportContact(): string;
  notifyFallback(payload: Record<string, string>): void;
}

export interface TwilioSendCredentials {
  fromNumber: string | null;
  messagingServiceSid: string | null;
  useMessagingService: boolean;
  statusCallbackUrl: string;
}

export function buildTwilioMessageParams(creds: TwilioSendCredentials, to: string, body: string) {
  const params: { body: string; to: string; from?: string; messagingServiceSid?: string; statusCallback?: string } = {
    body,
    to: normalizeSmsPhone(to),
    statusCallback: creds.statusCallbackUrl,
  };
  if (creds.useMessagingService && creds.messagingServiceSid?.trim()) {
    params.messagingServiceSid = creds.messagingServiceSid.trim();
  } else {
    params.from = normalizeSmsPhone(creds.fromNumber!);
  }
  return params;
}

export function twiml(message?: string): string {
  return message ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message.replace(/[<>&'\"]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;","'":"&apos;",'"':"&quot;"}[c]!))}</Message></Response>` : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

export function formPayload(req: Request): Record<string, string> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "")]));
}

export function publicWebhookUrl(req: Request, fallbackUrl: string): string {
  const configuredBase = process.env.TWILIO_PUBLIC_BASE_URL || process.env.APP_BASE_URL;
  if (configuredBase) return `${configuredBase.replace(/\/+$/, "")}${req.originalUrl}`;
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https").toString().split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "mypaylink.app").toString().split(",")[0].trim();
  if (host) return `${proto}://${host}${req.originalUrl}`;
  return fallbackUrl;
}

export async function validateTwilioWebhook(req: Request, deps: Pick<TwilioSmsWebhookDeps, "getAuthToken">, fallbackUrl: string, allowMissingToken = false): Promise<boolean> {
  const signature = req.header("X-Twilio-Signature") || "";
  const token = await deps.getAuthToken();
  if (!token) return allowMissingToken;
  if (!signature) return false;
  return twilio.validateRequest(token, signature, publicWebhookUrl(req, fallbackUrl), formPayload(req));
}

export function registerTwilioSmsWebhookRoutes(app: Express, deps: TwilioSmsWebhookDeps) {
  app.post("/api/twilio/sms/inbound", async (req, res) => {
    if (!(await validateTwilioWebhook(req, deps, TWILIO_SMS_URLS.inbound))) return res.status(403).type("text/xml").send(twiml());
    const payload = formPayload(req);
    await deps.saveInboundSms(payload, "twilio_inbound");
    const from = payload.From ? normalizeSmsPhone(payload.From) : "";
    const keyword = (payload.Body || "").trim().toUpperCase();
    res.type("text/xml");
    if (STOP_KEYWORDS.has(keyword)) {
      await deps.updateSmsConsent(from, true);
      return res.send(twiml("You have opted out of MyPayLink SMS alerts. Reply START to opt back in."));
    }
    if (START_KEYWORDS.has(keyword)) {
      await deps.updateSmsConsent(from, false);
      return res.send(twiml("You have opted in to MyPayLink SMS alerts."));
    }
    if (keyword === "HELP") {
      return res.send(twiml(`MyPayLink alerts: Reply STOP to opt out. For help, contact support at ${deps.getSupportContact()}.`));
    }
    return res.send(twiml());
  });

  app.post("/api/twilio/sms/fallback", async (req, res) => {
    res.type("text/xml");
    try {
      const ok = await validateTwilioWebhook(req, deps, TWILIO_SMS_URLS.fallback, true);
      if (!ok) return res.status(403).send(twiml());
      const payload = formPayload(req);
      await deps.saveInboundSms(payload, "twilio_fallback");
      deps.notifyFallback(payload);
    } catch (err: any) {
      console.error("[Twilio SMS] Fallback logging failed:", err?.message || err);
    }
    return res.send(twiml("Thank you. Your message has been received by MyPayLink support."));
  });

  app.post("/api/twilio/sms/status", async (req, res) => {
    if (!(await validateTwilioWebhook(req, deps, TWILIO_SMS_URLS.status))) return res.status(403).end();
    await deps.updateSmsStatus(formPayload(req));
    return res.status(204).end();
  });
}
