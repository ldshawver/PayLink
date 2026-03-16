import nodemailer from "nodemailer";

export interface ScheduleNotificationPayload {
  workerName: string;
  email?: string | null;
  phone?: string | null;
  companyName: string;
  shifts: { date: string; startTime: string; endTime: string; department?: string | null }[];
  scheduleViewUrl: string;
}

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
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
    await client.messages.create({ body: message, from: fromNumber, to: phone });
    console.log(`[SMS] Sent schedule notification to ${phone}`);
    return { sent: true };
  } catch (err: any) {
    console.error(`[SMS] Failed to send to ${phone}:`, err.message);
    return { sent: false, error: err.message };
  }
}
