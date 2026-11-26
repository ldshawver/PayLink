/**
 * Verified, idempotent PayPal webhook processing. The raw payload is not stored.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";
import { applyExternalBillingSignal } from "./billingLifecycle";
import { verifyPaypalWebhook, type PaypalDeps } from "./paypal-client";
import { mapPaypalEvent } from "./paypal-pricing";

export interface PaypalEvent {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    status?: string;
    custom_id?: string;
    custom?: string;
    billing_agreement_id?: string;
    billing_info?: { next_billing_time?: string };
  };
}

export function paypalCompanyHint(resource: PaypalEvent["resource"]): { companyId: string | null; subscriptionId: string | null } {
  const companyId = resource?.custom_id || resource?.custom || null;
  const subscriptionId = resource?.billing_agreement_id
    || (resource?.id && resource.id.startsWith("I-") ? resource.id : null);
  return { companyId, subscriptionId };
}

async function findCompanyId(hint: { companyId: string | null; subscriptionId: string | null }): Promise<string | null> {
  if (hint.companyId) {
    const byId = await db.execute(sql`SELECT id FROM companies WHERE id = ${hint.companyId} LIMIT 1`);
    if (byId.rows[0]) return String((byId.rows[0] as { id: string }).id);
  }
  if (hint.subscriptionId) {
    const bySub = await db.execute(sql`SELECT id FROM companies WHERE paypal_subscription_id = ${hint.subscriptionId} LIMIT 1`);
    if (bySub.rows[0]) return String((bySub.rows[0] as { id: string }).id);
  }
  return null;
}

export async function processPaypalWebhook(
  headers: Record<string, string | undefined>,
  event: PaypalEvent,
  deps: PaypalDeps = {},
): Promise<{ ok: boolean; status: number; duplicate?: boolean; ignored?: boolean }> {
  const verified = await verifyPaypalWebhook(headers, event, deps);
  if (!verified) return { ok: false, status: 400 };
  const eventId = event.id || "";
  const eventType = event.event_type || "";
  if (!eventId || !eventType) return { ok: false, status: 400 };
  const hint = paypalCompanyHint(event.resource);
  const companyId = await findCompanyId(hint);
  const inserted = await db.execute(sql`
    INSERT INTO paypal_webhook_events (event_id, event_type, company_id, resource_id)
    VALUES (${eventId}, ${eventType}, ${companyId}, ${hint.subscriptionId})
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id
  `);
  if (!inserted.rows.length) return { ok: true, status: 200, duplicate: true };
  const signal = mapPaypalEvent(eventType, event.resource?.status);
  if (companyId && signal) {
    await applyExternalBillingSignal(companyId, signal, `PayPal ${eventType}`);
    const next = event.resource?.billing_info?.next_billing_time || null;
    if (hint.subscriptionId || next) {
      await db.execute(sql`
        UPDATE companies
        SET paypal_subscription_id = COALESCE(${hint.subscriptionId}, paypal_subscription_id),
            paypal_next_billing_at = COALESCE(${next}, paypal_next_billing_at)
        WHERE id = ${companyId}
      `);
    }
  }
  return { ok: true, status: 200, ignored: !signal || !companyId };
}
