/**
 * PayPal REST client. Sandbox unless PAYPAL_ENV=live. Credentials come from
 * the environment only and are never logged.
 */
export interface PaypalConfig {
  clientId: string;
  clientSecret: string;
  apiBase: string;
  webhookId: string | null;
  planId: string | null;
  live: boolean;
}

export function readPaypalConfig(env: NodeJS.ProcessEnv = process.env): PaypalConfig | null {
  const clientId = (env.PAYPAL_CLIENT_ID || "").trim();
  const clientSecret = (env.PAYPAL_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) return null;
  const live = (env.PAYPAL_ENV || "").trim().toLowerCase() === "live";
  return {
    clientId,
    clientSecret,
    apiBase: live ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
    webhookId: (env.PAYPAL_WEBHOOK_ID || "").trim() || null,
    planId: (env.PAYPAL_PLAN_ID || "").trim() || null,
    live,
  };
}

export interface PaypalDeps {
  fetchImpl?: typeof fetch;
  config?: PaypalConfig;
}

async function accessToken(config: PaypalConfig, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(`${config.apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error(`PayPal token request failed (${response.status})`);
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("PayPal token response had no access token");
  return body.access_token;
}

export async function paypalRequest<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
  deps: PaypalDeps = {},
): Promise<T> {
  const config = deps.config ?? readPaypalConfig();
  if (!config) throw new Error("PayPal is not configured");
  const fetchImpl = deps.fetchImpl ?? fetch;
  const token = await accessToken(config, fetchImpl);
  const response = await fetchImpl(`${config.apiBase}${path}`, {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`PayPal ${init.method || "GET"} ${path} failed (${response.status})`);
  return text ? JSON.parse(text) as T : ({} as T);
}

export async function verifyPaypalWebhook(
  headers: Record<string, string | undefined>,
  event: unknown,
  deps: PaypalDeps = {},
): Promise<boolean> {
  const config = deps.config ?? readPaypalConfig();
  if (!config?.webhookId) return false;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const token = await accessToken(config, fetchImpl);
  const response = await fetchImpl(`${config.apiBase}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
      webhook_id: config.webhookId,
      webhook_event: event,
    }),
  });
  if (!response.ok) return false;
  const body = await response.json() as { verification_status?: string };
  return body.verification_status === "SUCCESS";
}
