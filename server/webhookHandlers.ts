import { getStripeSync } from './stripeClient.js';
import { storage } from './storage.js';
import type { PayrollPaymentRecord, PayrollRun, TreasuryOutboundPayment } from '../shared/schema.js';

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

    // Match ALL treasury.outbound_payment.* events (including update / processing variants).
    // Stripe may emit progression through update-style events; we drive state from obj.status
    // rather than the event name to avoid missing transitions.
    if (type.startsWith("treasury.outbound_payment.")) {
      const stripeId: string = obj.id;
      const stripeStatus: string = obj.status;
      console.log(`[TREASURY] Outbound payment event ${type} → status=${stripeStatus} id=${stripeId}`);

      let internalStatus = "pending";
      if (stripeStatus === "posted") internalStatus = "completed";
      else if (stripeStatus === "failed") internalStatus = "failed";
      else if (stripeStatus === "returned") internalStatus = "returned";
      else if (stripeStatus === "canceled") internalStatus = "canceled";
      else if (stripeStatus === "processing") internalStatus = "processing";

      // Update treasury outbound payment record
      const existing = await storage.getTreasuryOutboundPaymentByStripeId(stripeId);
      if (existing) {
        const tpUpdate: Partial<TreasuryOutboundPayment> = {
          status: internalStatus,
          stripeRawStatus: stripeStatus,
          errorMessage: obj.returned_details?.reason || obj.failure_balance_transaction || null,
        };
        await storage.updateTreasuryOutboundPayment(existing.id, tpUpdate);
        console.log(`[TREASURY] Updated outbound payment ${stripeId} → ${internalStatus}`);
      }

      // ── Update payroll payment record linked to this stripe outbound payment ──
      try {
        // Try to find the payroll payment record by externalTransactionId = stripeId
        const paymentRecord = await storage.getPayrollPaymentRecordByExternalTransactionId(stripeId);
        if (paymentRecord) {
          const prevStatus = paymentRecord.status;
          let newStatus = paymentRecord.status;
          const updateData: Partial<PayrollPaymentRecord> = {};

          if (stripeStatus === "posted") {
            newStatus = "paid";
            updateData.status = "paid";
            updateData.paidAt = new Date();
            updateData.clearedAt = new Date();
          } else if (stripeStatus === "failed") {
            newStatus = "failed";
            updateData.status = "failed";
            updateData.failureCode = obj.failure_balance_transaction || "stripe_failed";
            updateData.failureReason = obj.returned_details?.reason || obj.description || "Payment failed";
          } else if (stripeStatus === "returned") {
            newStatus = "reversed";
            updateData.status = "reversed";
            updateData.reversedAt = new Date();
            updateData.failureCode = "returned";
            updateData.failureReason = obj.returned_details?.reason || "Payment returned";
          } else if (stripeStatus === "canceled") {
            newStatus = "voided";
            updateData.status = "voided";
            updateData.voidedAt = new Date();
          } else if (stripeStatus === "processing") {
            newStatus = "processing";
            updateData.status = "processing";
          } else if (stripeStatus === "pending") {
            // Treat pending the same as submitted (no transition needed if already submitted)
            if (paymentRecord.status === "submitted") {
              // no-op
            } else {
              newStatus = "submitted";
              updateData.status = "submitted";
            }
          }

          if (Object.keys(updateData).length > 0) {
            await storage.updatePayrollPaymentRecord(paymentRecord.id, updateData);

            // ── Worker-level notifications on paid/failed ─────────────────────
            try {
              if (newStatus === "paid" || newStatus === "failed") {
                const worker = await storage.getWorker(paymentRecord.workerId);
                if (worker) {
                  const periodLabel = paymentRecord.payDate || "your last pay period";
                  const amount = `$${Number(paymentRecord.netPayAmount || 0).toFixed(2)}`;
                  await storage.createNotification({
                    companyId: paymentRecord.companyId,
                    userId: null,
                    workerId: worker.id,
                    customerId: null,
                    type: newStatus === "paid" ? "payment_paid" : "payment_failed",
                    title: newStatus === "paid"
                      ? `Payment of ${amount} confirmed`
                      : `⚠ Payment of ${amount} failed`,
                    message: newStatus === "paid"
                      ? `Your direct deposit of ${amount} for pay date ${periodLabel} has been confirmed.`
                      : `Your direct deposit of ${amount} for pay date ${periodLabel} could not be processed${updateData.failureReason ? `: ${updateData.failureReason}` : ""}. Please contact your employer.`,
                    actionUrl: `/portal/paystubs`,
                    isRead: false,
                    readAt: null,
                  });
                  // Email if worker has one
                  if (worker.email) {
                    try {
                      const { sendGenericNotificationEmail } = await import("./notifications.js");
                      await sendGenericNotificationEmail({
                        recipientName: `${worker.firstName || ""} ${worker.lastName || ""}`.trim() || "Worker",
                        email: worker.email,
                        title: newStatus === "paid" ? `Direct deposit confirmed` : `Direct deposit failed`,
                        body: newStatus === "paid"
                          ? `Your direct deposit of ${amount} for pay date ${periodLabel} has been confirmed and should appear in your account shortly.`
                          : `Your direct deposit of ${amount} for pay date ${periodLabel} could not be processed${updateData.failureReason ? ` (${updateData.failureReason})` : ""}. Please contact your employer.`,
                      });
                    } catch (emailErr) {
                      console.error("[TREASURY] Worker email error:", emailErr);
                    }
                  }
                }
              }
            } catch (workerNotifErr) {
              console.error("[TREASURY] Worker notification error:", workerNotifErr);
            }

            // Write audit log entry for this record
            try {
              await storage.createPayrollPaymentAuditLog({
                companyId: paymentRecord.companyId,
                payrollRunId: paymentRecord.payrollRunId,
                payrollPaymentRecordId: paymentRecord.id,
                actorId: "stripe_webhook",
                event: stripeStatus === "posted" ? "paid" : stripeStatus === "failed" ? "failed" : stripeStatus === "returned" ? "reversed" : stripeStatus,
                previousStatus: prevStatus,
                newStatus,
                notes: `Stripe event: ${type} — status: ${stripeStatus}`,
              });
            } catch (auditErr) {
              console.error("[TREASURY] Audit log error:", auditErr);
            }

            // ── Recompute payroll run status from all its payment records ──────
            try {
              const allRecords = await storage.getPayrollPaymentRecords(paymentRecord.companyId!, paymentRecord.payrollRunId!);
              const run = await storage.getPayrollRun(paymentRecord.payrollRunId!);
              if (run && allRecords.length > 0) {
                const anyFailed = allRecords.some(r => r.status === "failed");
                const anyReversed = allRecords.some(r => r.status === "reversed");
                const allPaid = allRecords.every(r => r.status === "paid" || r.status === "cleared");
                const anyProcessing = allRecords.some(r => r.status === "processing" || r.status === "submitted");

                // Precedence: reversed > failed > paid > processing. ANY failed record fails the run.
                let newRunStatus = run.status;
                if (anyReversed) newRunStatus = "reversed";
                else if (anyFailed) newRunStatus = "failed";
                else if (allPaid) newRunStatus = "paid";
                else if (anyProcessing) newRunStatus = "processing";

                if (newRunStatus !== run.status) {
                  const runUpdate: Partial<PayrollRun> = { status: newRunStatus };
                  if (newRunStatus === "paid") {
                    runUpdate.achStatus = "settled";
                    runUpdate.achSettledAt = new Date();
                  }
                  await storage.updatePayrollRun(run.id, runUpdate);

                  await storage.createPayrollPaymentAuditLog({
                    companyId: run.companyId,
                    payrollRunId: run.id,
                    actorId: "stripe_webhook",
                    event: newRunStatus,
                    previousStatus: run.status,
                    newStatus: newRunStatus,
                    notes: `Run status updated from aggregated payment record statuses (stripe: ${type})`,
                  });

                  // Send notification on paid or failed
                  try {
                    if (newRunStatus === "paid") {
                      const { sendPaymentPaidNotification } = await import("./notifications.js");
                      const company = await storage.getCompany(run.companyId);
                      const adminUsers = (await storage.getUsers()).filter(u => u.companyId === run.companyId && (u.role === "admin" || u.role === "owner"));
                      for (const admin of adminUsers) {
                        if (admin.email) {
                          await sendPaymentPaidNotification({
                            toEmail: admin.email,
                            adminName: admin.firstName ? `${admin.firstName} ${admin.lastName || ""}`.trim() : admin.username,
                            companyName: company?.name || "Your Company",
                            periodStart: run.periodStart || "",
                            periodEnd: run.periodEnd || "",
                            runId: run.id,
                          });
                        }
                      }
                    } else if (newRunStatus === "failed") {
                      const { sendPaymentFailedNotification } = await import("./notifications.js");
                      const company = await storage.getCompany(run.companyId);
                      const adminUsers = (await storage.getUsers()).filter(u => u.companyId === run.companyId && (u.role === "admin" || u.role === "owner"));
                      for (const admin of adminUsers) {
                        if (admin.email) {
                          await sendPaymentFailedNotification({
                            toEmail: admin.email,
                            adminName: admin.firstName ? `${admin.firstName} ${admin.lastName || ""}`.trim() : admin.username,
                            companyName: company?.name || "Your Company",
                            periodStart: run.periodStart || "",
                            periodEnd: run.periodEnd || "",
                            reason: "Payment failed via Stripe",
                            runId: run.id,
                          });
                        }
                      }
                    }
                  } catch (notifErr) {
                    console.error("[TREASURY] Notification error:", notifErr);
                  }
                }
              }
            } catch (recomputeErr) {
              console.error("[TREASURY] Run status recompute error:", recomputeErr);
            }
          }
        }
      } catch (prErr) {
        console.error("[TREASURY] Payment record update error:", prErr);
      }
    }
  }
}
