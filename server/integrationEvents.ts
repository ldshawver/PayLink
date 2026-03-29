import crypto from "crypto";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import {
  integrationEvents,
  companyWebhookConfigs,
  type IntegrationEvent,
  type CompanyWebhookConfig,
} from "@shared/schema";

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("172.") ||
      hostname === "169.254.169.254" ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".local")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function getWebhookConfig(companyId: string): Promise<CompanyWebhookConfig | undefined> {
  const [config] = await db
    .select()
    .from(companyWebhookConfigs)
    .where(and(eq(companyWebhookConfigs.companyId, companyId), eq(companyWebhookConfigs.isActive, true)));
  return config;
}

async function dispatchWebhook(event: IntegrationEvent, config: CompanyWebhookConfig): Promise<void> {
  if (!isValidWebhookUrl(config.webhookUrl)) {
    await db
      .update(integrationEvents)
      .set({
        status: "failed",
        attempts: (event.attempts || 0) + 1,
        lastAttemptAt: new Date(),
        errorMessage: "Webhook URL must be HTTPS and not target private/internal networks",
      })
      .where(eq(integrationEvents.id, event.id));
    return;
  }

  const payloadStr = event.payload || "{}";
  const signature = signPayload(payloadStr, config.hmacSecret);

  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PayLink-Signature": signature,
        "X-PayLink-Event": event.eventType,
        "X-PayLink-Event-Id": event.id,
      },
      body: payloadStr,
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      await db
        .update(integrationEvents)
        .set({
          status: "delivered",
          attempts: (event.attempts || 0) + 1,
          lastAttemptAt: new Date(),
        })
        .where(eq(integrationEvents.id, event.id));
    } else {
      await db
        .update(integrationEvents)
        .set({
          status: "failed",
          attempts: (event.attempts || 0) + 1,
          lastAttemptAt: new Date(),
          errorMessage: `HTTP ${response.status}: ${response.statusText}`,
        })
        .where(eq(integrationEvents.id, event.id));
    }
  } catch (err) {
    await db
      .update(integrationEvents)
      .set({
        status: "failed",
        attempts: (event.attempts || 0) + 1,
        lastAttemptAt: new Date(),
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .where(eq(integrationEvents.id, event.id));
  }
}

export async function emitIntegrationEvent(
  companyId: string,
  eventType: string,
  payload: Record<string, any>
): Promise<IntegrationEvent | null> {
  try {
    const config = await getWebhookConfig(companyId);
    const destinationUrl = config?.webhookUrl || null;

    const [event] = await db
      .insert(integrationEvents)
      .values({
        companyId,
        eventType,
        payload: JSON.stringify(payload),
        status: config ? "pending" : "no_destination",
        destinationUrl,
      })
      .returning();

    if (config) {
      dispatchWebhook(event, config).catch((err) => {
        console.error(`[IntegrationEvent] dispatch error for event ${event.id}:`, err);
      });
    }

    return event;
  } catch (err) {
    console.error(`[IntegrationEvent] Failed to emit ${eventType} for company ${companyId}:`, err);
    return null;
  }
}

export async function retryIntegrationEvent(event: IntegrationEvent): Promise<void> {
  const config = await getWebhookConfig(event.companyId);
  if (!config) {
    await db
      .update(integrationEvents)
      .set({ status: "failed", errorMessage: "No active webhook config found for retry" })
      .where(eq(integrationEvents.id, event.id));
    return;
  }
  await dispatchWebhook(event, config);
}

export { isValidWebhookUrl };
