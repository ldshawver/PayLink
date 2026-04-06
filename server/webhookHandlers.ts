import { getStripeSync } from './stripeClient.js';
import { storage } from './storage.js';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    try {
      const eventRaw = JSON.parse(payload.toString());
      await WebhookHandlers.handleTreasuryEvent(eventRaw);
    } catch (e) {
      // Non-fatal: treasury event processing is best-effort
    }
  }

  static async handleTreasuryEvent(event: any): Promise<void> {
    const type: string = event.type || "";
    const obj = event.data?.object;
    if (!obj) return;

    if (type === "treasury.financial_account.created") {
      console.log(`[TREASURY] FinancialAccount created: ${obj.id}`);
    }

    if (type === "treasury.financial_account.features_status_updated") {
      console.log(`[TREASURY] FinancialAccount features updated: ${obj.id}`);
    }

    if (
      type === "treasury.outbound_payment.created" ||
      type === "treasury.outbound_payment.posted" ||
      type === "treasury.outbound_payment.failed" ||
      type === "treasury.outbound_payment.returned" ||
      type === "treasury.outbound_payment.canceled"
    ) {
      const stripeId: string = obj.id;
      const stripeStatus: string = obj.status;

      let internalStatus = "pending";
      if (stripeStatus === "posted") internalStatus = "completed";
      else if (stripeStatus === "failed") internalStatus = "failed";
      else if (stripeStatus === "returned") internalStatus = "returned";
      else if (stripeStatus === "canceled") internalStatus = "canceled";

      const existing = await storage.getTreasuryOutboundPaymentByStripeId(stripeId);
      if (existing) {
        await storage.updateTreasuryOutboundPayment(existing.id, {
          status: internalStatus,
          stripeRawStatus: stripeStatus,
          errorMessage: obj.returned_details?.reason || obj.failure_balance_transaction || null,
        } as any);
        console.log(`[TREASURY] Updated outbound payment ${stripeId} → ${internalStatus}`);
      }
    }
  }
}
