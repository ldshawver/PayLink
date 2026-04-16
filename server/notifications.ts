import nodemailer from "nodemailer";

/**
 * Normalize a phone number to E.164 format (+1XXXXXXXXXX) for Twilio.
 * Strips spaces, dashes, dots, parentheses.  If the result is 10 digits
 * it assumes a US number and prepends +1.  If it's 11 digits starting
 * with 1 it prepends +.  Already-formatted +1XXXXXXXXXX passes through.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export interface ShiftMarketplaceNotificationPayload {
  recipientName: string;
  email?: string | null;
  phone?: string | null;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
}

export interface ScheduleNotificationPayload {
  workerName: string;
  email?: string | null;
  phone?: string | null;
  companyName: string;
  shifts: { date: string; startTime: string; endTime: string; department?: string | null }[];
  scheduleViewUrl: string;
}

function deriveSmtpHost(email?: string): string | undefined {
  if (!email || !email.includes("@")) return undefined;
  const domain = email.split("@")[1].toLowerCase();
  const knownHosts: Record<string, string> = {
    "gmail.com": "smtp.gmail.com",
    "googlemail.com": "smtp.gmail.com",
    "outlook.com": "smtp.office365.com",
    "hotmail.com": "smtp.office365.com",
    "live.com": "smtp.office365.com",
    "yahoo.com": "smtp.mail.yahoo.com",
    "yahoo.co.uk": "smtp.mail.yahoo.co.uk",
    "sendgrid.net": "smtp.sendgrid.net",
    "mailgun.org": "smtp.mailgun.org",
    "icloud.com": "smtp.mail.me.com",
    "me.com": "smtp.mail.me.com",
    "zoho.com": "smtp.zoho.com",
  };
  return knownHosts[domain] ?? `smtp.${domain}`;
}

export function getTransporter() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const host = process.env.SMTP_HOST || deriveSmtpHost(user);
  const port = parseInt(process.env.SMTP_PORT || "587");
  const fromAddress = process.env.SMTP_FROM || user || "noreply@paylink.app";
  const useTls = process.env.SMTP_TLS === "true";

  if (!host || !user || !pass) return null;

  // Port 465 = implicit TLS (secure:true). Port 587 with SMTP_TLS=true = STARTTLS (secure:false + requireTLS:true).
  const secure = port === 465;
  const transportOptions: any = {
    host,
    port,
    secure,
    auth: { user, pass },
  };
  if (!secure && useTls) {
    transportOptions.requireTLS = true;
    transportOptions.tls = { ciphers: "SSLv3", rejectUnauthorized: false };
  }

  return { transporter: nodemailer.createTransport(transportOptions), fromAddress };
}

function formatShiftList(shifts: ScheduleNotificationPayload["shifts"]): string {
  return shifts
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(s => {
      const [year, month, day] = s.date.split("-").map(Number);
      const d = new Date(year, month - 1, day);
      const dayName = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
      const dept = s.department ? ` — ${s.department}` : "";
      return `  • ${dayName}: ${s.startTime} – ${s.endTime}${dept}`;
    })
    .join("\n");
}

export async function sendScheduleEmailNotification(payload: ScheduleNotificationPayload): Promise<{ sent: boolean; error?: string }> {
  if (!payload.email) return { sent: false, error: "No email address" };

  const smtp = getTransporter();
  if (!smtp) {
    console.warn("[Email] SMTP not configured — skipping email for", payload.workerName);
    return { sent: false, error: "SMTP not configured" };
  }

  const shiftList = formatShiftList(payload.shifts);
  const subject = `Your schedule has been posted — ${payload.companyName}`;
  const text = `Hi ${payload.workerName},\n\nYour schedule has been published by ${payload.companyName}.\n\nYour upcoming shifts:\n${shiftList}\n\nView your full schedule online:\n${payload.scheduleViewUrl}\n\nThank you,\n${payload.companyName}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #0d9488, #2563eb); padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 22px;">Schedule Published</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 4px 0 0;">${payload.companyName}</p>
      </div>
      <div style="background: #f9fafb; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="font-size: 16px; color: #111827;">Hi <strong>${payload.workerName}</strong>,</p>
        <p style="color: #374151;">Your schedule has been published. Here are your upcoming shifts:</p>
        <div style="background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin: 16px 0;">
          ${payload.shifts
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(s => {
              const [year, month, day] = s.date.split("-").map(Number);
              const d = new Date(year, month - 1, day);
              const dayName = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
              const dept = s.department ? `<span style="color:#6b7280; font-size:13px;"> — ${s.department}</span>` : "";
              return `<div style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; display: flex; justify-content: space-between;">
                <strong style="color:#111827;">${dayName}</strong>
                <span style="color:#374151;">${s.startTime} – ${s.endTime}${dept}</span>
              </div>`;
            }).join("")}
        </div>
        <a href="${payload.scheduleViewUrl}" style="display: inline-block; background: linear-gradient(135deg, #0d9488, #2563eb); color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 8px;">View Full Schedule</a>
        <p style="color: #9ca3af; font-size: 13px; margin-top: 24px;">This notification was sent by ${payload.companyName} via PayLink.</p>
      </div>
    </div>
  `;

  try {
    await smtp.transporter.sendMail({ from: smtp.fromAddress, to: payload.email, subject, text, html });
    console.log(`[Email] Sent schedule notification to ${payload.email}`);
    return { sent: true };
  } catch (err: any) {
    console.error(`[Email] Failed to send to ${payload.email}:`, err.message);
    return { sent: false, error: err.message };
  }
}

export async function sendShiftMarketplaceEmail(payload: ShiftMarketplaceNotificationPayload): Promise<{ sent: boolean; error?: string }> {
  if (!payload.email) return { sent: false, error: "No email address" };
  const smtp = getTransporter();
  if (!smtp) return { sent: false, error: "SMTP not configured" };
  const html = payload.bodyHtml || `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
    <div style="background:linear-gradient(135deg,#0d9488,#2563eb);padding:20px;border-radius:8px 8px 0 0;">
      <h1 style="color:white;margin:0;font-size:20px;">${payload.subject}</h1>
    </div>
    <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
      <p style="font-size:15px;color:#111827;">Hi <strong>${payload.recipientName}</strong>,</p>
      <p style="color:#374151;white-space:pre-line;">${payload.bodyText}</p>
      <p style="color:#9ca3af;font-size:13px;margin-top:24px;">PayLink Shift Marketplace</p>
    </div>
  </div>`;
  try {
    await smtp.transporter.sendMail({ from: smtp.fromAddress, to: payload.email, subject: payload.subject, text: payload.bodyText, html });
    console.log(`[Email] Shift marketplace notification sent to ${payload.email}`);
    return { sent: true };
  } catch (err: any) {
    console.error(`[Email] Failed shift marketplace email to ${payload.email}:`, err.message);
    return { sent: false, error: err.message };
  }
}

export async function sendShiftMarketplaceSms(payload: ShiftMarketplaceNotificationPayload): Promise<{ sent: boolean; error?: string }> {
  if (!payload.phone) return { sent: false, error: "No phone number" };
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) return { sent: false, error: "Twilio not configured" };
  try {
    const twilio = (await import("twilio")).default;
    const client = twilio(accountSid, authToken);
    await client.messages.create({ body: payload.bodyText, from: normalizePhone(fromNumber), to: normalizePhone(payload.phone) });
    console.log(`[SMS] Shift marketplace notification sent to ${payload.phone}`);
    return { sent: true };
  } catch (err: any) {
    console.error(`[SMS] Failed shift marketplace SMS to ${payload.phone}:`, err.message);
    return { sent: false, error: err.message };
  }
}

export interface ApprovalReminderPayload {
  recipientName: string;
  email?: string | null;
  phone?: string | null;
  companyName: string;
  pendingPunches: number;
  pendingTimecards: number;
  pendingAmendments: number;
  pendingExpenses: number;
  dashboardUrl: string;
}

export async function sendApprovalReminderEmail(payload: ApprovalReminderPayload): Promise<{ sent: boolean; error?: string }> {
  if (!payload.email) return { sent: false, error: "No email address" };
  const smtp = getTransporter();
  if (!smtp) return { sent: false, error: "SMTP not configured" };

  const items: string[] = [];
  if (payload.pendingPunches > 0) items.push(`${payload.pendingPunches} time punch${payload.pendingPunches > 1 ? "es" : ""}`);
  if (payload.pendingTimecards > 0) items.push(`${payload.pendingTimecards} timecard${payload.pendingTimecards > 1 ? "s" : ""}`);
  if (payload.pendingAmendments > 0) items.push(`${payload.pendingAmendments} pay stub amendment${payload.pendingAmendments > 1 ? "s" : ""}`);
  if (payload.pendingExpenses > 0) items.push(`${payload.pendingExpenses} employee expense${payload.pendingExpenses > 1 ? "s" : ""}`);

  if (items.length === 0) return { sent: false, error: "No pending items" };

  const itemList = items.join(", ");
  const subject = `Action Required: ${items.length} type${items.length > 1 ? "s" : ""} of items pending your approval — ${payload.companyName}`;
  const text = `Hi ${payload.recipientName},\n\nYou have items pending your approval at ${payload.companyName}:\n\n${items.map(i => `  • ${i}`).join("\n")}\n\nPlease review and approve or reject these items before payroll is processed.\n\nView pending items: ${payload.dashboardUrl}\n\nThank you,\n${payload.companyName} via PayLink`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #0d9488, #2563eb); padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 22px;">⏰ Approval Reminder</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 4px 0 0;">${payload.companyName}</p>
      </div>
      <div style="background: #f9fafb; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="font-size: 16px; color: #111827;">Hi <strong>${payload.recipientName}</strong>,</p>
        <p style="color: #374151;">You have items that need your approval before payroll is processed:</p>
        <div style="background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin: 16px 0;">
          ${items.map(i => `<div style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; display: flex; align-items: center;">
            <span style="color: #dc2626; font-size: 18px; margin-right: 10px;">●</span>
            <span style="color: #111827; font-size: 15px;">${i}</span>
          </div>`).join("")}
        </div>
        <a href="${payload.dashboardUrl}" style="display: inline-block; background: linear-gradient(135deg, #0d9488, #2563eb); color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 8px;">Review Pending Items</a>
        <p style="color: #9ca3af; font-size: 13px; margin-top: 24px;">This reminder was sent by ${payload.companyName} via PayLink.</p>
      </div>
    </div>
  `;

  try {
    await smtp.transporter.sendMail({ from: smtp.fromAddress, to: payload.email, subject, text, html });
    console.log(`[Email] Approval reminder sent to ${payload.email}`);
    return { sent: true };
  } catch (err: any) {
    console.error(`[Email] Failed approval reminder to ${payload.email}:`, err.message);
    return { sent: false, error: err.message };
  }
}

export async function sendApprovalReminderSms(payload: ApprovalReminderPayload): Promise<{ sent: boolean; error?: string }> {
  if (!payload.phone) return { sent: false, error: "No phone number" };
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) return { sent: false, error: "Twilio not configured" };

  const items: string[] = [];
  if (payload.pendingPunches > 0) items.push(`${payload.pendingPunches} punches`);
  if (payload.pendingTimecards > 0) items.push(`${payload.pendingTimecards} timecards`);
  if (payload.pendingAmendments > 0) items.push(`${payload.pendingAmendments} amendments`);
  if (payload.pendingExpenses > 0) items.push(`${payload.pendingExpenses} expenses`);
  if (items.length === 0) return { sent: false, error: "No pending items" };

  const message = `PayLink Reminder: ${payload.recipientName}, you have pending approvals at ${payload.companyName}: ${items.join(", ")}. Please review before payroll runs. ${payload.dashboardUrl}`;

  try {
    const twilio = (await import("twilio")).default;
    const client = twilio(accountSid, authToken);
    await client.messages.create({ body: message, from: normalizePhone(fromNumber), to: normalizePhone(payload.phone) });
    console.log(`[SMS] Approval reminder sent to ${payload.phone}`);
    return { sent: true };
  } catch (err: any) {
    console.error(`[SMS] Failed approval reminder to ${payload.phone}:`, err.message);
    return { sent: false, error: err.message };
  }
}

// ── Contract & Invoice lifecycle email notifications ──────────────────────────

export type ContractEventType =
  | "contract_sent"
  | "signature_requested"
  | "signature_complete"
  | "contract_activated"
  | "invoice_submitted"
  | "invoice_approved"
  | "invoice_rejected"
  | "invoice_paid"
  | "override_requested"
  | "override_approved"
  | "payment_due"
  | "payment_received";

const CONTRACT_EVENT_LABELS: Record<ContractEventType, string> = {
  contract_sent: "Contract Sent for Review",
  signature_requested: "Signature Requested",
  signature_complete: "Contract Fully Signed",
  contract_activated: "Contract Activated",
  invoice_submitted: "Invoice Submitted for Review",
  invoice_approved: "Invoice Approved",
  invoice_rejected: "Invoice Rejected",
  invoice_paid: "Invoice Marked Paid",
  override_requested: "Invoice Override Requested",
  override_approved: "Invoice Override Approved",
  payment_due: "Payment Due Reminder",
  payment_received: "Payment Received",
};

export interface ContractEventPayload {
  event: ContractEventType;
  recipientName: string;
  email?: string | null;
  phone?: string | null;
  contractTitle: string;
  entityId: string;
  entityType: "contract" | "invoice";
  companyName?: string;
  amount?: number | null;
  note?: string | null;
  actionUrl?: string;
}

export async function sendContractEventEmail(payload: ContractEventPayload): Promise<{ sent: boolean; error?: string }> {
  if (!payload.email) return { sent: false, error: "No email address" };
  const smtp = getTransporter();
  if (!smtp) return { sent: false, error: "SMTP not configured" };

  const label = CONTRACT_EVENT_LABELS[payload.event] || payload.event;
  const subject = `${label} — ${payload.contractTitle}`;
  const amountLine = payload.amount != null ? `<p style="color:#374151;">Amount: <strong>$${Number(payload.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></p>` : "";
  const noteLine = payload.note ? `<p style="color:#374151; background:#f3f4f6; padding:10px; border-radius:4px; font-style:italic;">${payload.note}</p>` : "";
  const actionBtn = payload.actionUrl ? `<a href="${payload.actionUrl}" style="display:inline-block;background:linear-gradient(135deg,#0d9488,#2563eb);color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin-top:12px;">View in PayLink</a>` : "";

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:linear-gradient(135deg,#0d9488,#2563eb);padding:20px;border-radius:8px 8px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">${label}</h1>
        ${payload.companyName ? `<p style="color:rgba(255,255,255,0.85);margin:4px 0 0;">${payload.companyName}</p>` : ""}
      </div>
      <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <p style="font-size:15px;color:#111827;">Hi <strong>${payload.recipientName}</strong>,</p>
        <p style="color:#374151;">There has been an update regarding your contract: <strong>${payload.contractTitle}</strong></p>
        ${amountLine}
        ${noteLine}
        ${actionBtn}
        <p style="color:#9ca3af;font-size:12px;margin-top:24px;">This notification was sent via PayLink. If you have questions, contact your administrator.</p>
      </div>
    </div>
  `;
  const text = `Hi ${payload.recipientName},\n\n${label}\n\nContract: ${payload.contractTitle}${payload.amount != null ? `\nAmount: $${Number(payload.amount).toFixed(2)}` : ""}${payload.note ? `\nNote: ${payload.note}` : ""}${payload.actionUrl ? `\n\nView: ${payload.actionUrl}` : ""}\n\nPayLink`;

  try {
    await smtp.transporter.sendMail({ from: smtp.fromAddress, to: payload.email, subject, text, html });
    console.log(`[Email] Contract event "${payload.event}" sent to ${payload.email}`);
    return { sent: true };
  } catch (err: any) {
    console.error(`[Email] Failed contract event email to ${payload.email}:`, err.message);
    return { sent: false, error: err.message };
  }
}

export async function sendContractEventSms(payload: ContractEventPayload): Promise<{ sent: boolean; error?: string }> {
  if (!payload.phone) return { sent: false, error: "No phone number" };
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) return { sent: false, error: "Twilio not configured" };
  const label = CONTRACT_EVENT_LABELS[payload.event] || payload.event;
  const message = `PayLink: ${label} — ${payload.contractTitle}${payload.amount != null ? ` ($${Number(payload.amount).toFixed(2)})` : ""}${payload.note ? `. ${payload.note}` : ""}${payload.actionUrl ? ` View: ${payload.actionUrl}` : ""}`;
  try {
    const twilio = (await import("twilio")).default;
    const client = twilio(accountSid, authToken);
    await client.messages.create({ body: message, from: normalizePhone(fromNumber), to: normalizePhone(payload.phone) });
    return { sent: true };
  } catch (err: any) {
    console.error(`[SMS] Failed contract event SMS to ${payload.phone}:`, err.message);
    return { sent: false, error: err.message };
  }
}

export async function sendScheduleSmsNotification(payload: ScheduleNotificationPayload): Promise<{ sent: boolean; error?: string }> {
  const phone = payload.phone;
  if (!phone) return { sent: false, error: "No phone number" };

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.warn("[SMS] Twilio not configured — skipping SMS for", payload.workerName);
    return { sent: false, error: "Twilio not configured" };
  }

  const nextShift = payload.shifts.sort((a, b) => a.date.localeCompare(b.date))[0];
  const [year, month, day] = nextShift.date.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  const dayName = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const message = `Hi ${payload.workerName}, your schedule at ${payload.companyName} has been posted. Next shift: ${dayName} ${nextShift.startTime}-${nextShift.endTime}. View: ${payload.scheduleViewUrl}`;

  try {
    const twilio = (await import("twilio")).default;
    const client = twilio(accountSid, authToken);
    await client.messages.create({ body: message, from: normalizePhone(fromNumber), to: normalizePhone(phone) });
    console.log(`[SMS] Sent schedule notification to ${phone}`);
    return { sent: true };
  } catch (err: any) {
    console.error(`[SMS] Failed to send to ${phone}:`, err.message);
    return { sent: false, error: err.message };
  }
}
