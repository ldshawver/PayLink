import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import path from "path";
import fs from "fs";
import { runContractorReminderScheduler } from "./contractor-scheduler";

const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  const requiredVars = ["DATABASE_URL", "SESSION_SECRET"];
  const missing = requiredVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(`FATAL: Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (!process.env.APP_BASE_URL) {
    console.warn("WARNING: APP_BASE_URL is not set. Email/SMS links will fall back to request headers.");
  }
}

const app = express();
const httpServer = createServer(app);

if (isProduction) {
  app.set("trust proxy", 1);
}

const CAPACITOR_ORIGINS = [
  'capacitor://localhost',
  'http://localhost',
  'https://app.mypaylink.paylink',
];

/* ── URL masking: redirect app.mypaylink.app → mypaylink.app ────────────── */
app.use((req, res, next) => {
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(':')[0];
  if (host === 'app.mypaylink.app') {
    return res.redirect(301, `https://mypaylink.app${req.originalUrl}`);
  }
  next();
});

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CAPACITOR_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
  }
  next();
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    userId: string;
    username: string;
    role: string;
    isDemo: boolean;
  }
}

const uploadsDir = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log(`Created upload directory: ${uploadsDir}`);
  }
  fs.accessSync(uploadsDir, fs.constants.W_OK);
} catch (err: any) {
  console.error(`FATAL: Upload directory "${uploadsDir}" is not writable: ${err.message}`);
  if (isProduction) process.exit(1);
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/ready", async (_req, res) => {
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    res.json({ status: "ok", database: "connected" });
  } catch (err: any) {
    console.error("[Ready] Database check failed:", err.message);
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});

app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature' });
    }
    try {
      const { WebhookHandlers } = await import('./webhookHandlers');
      const sig = Array.isArray(signature) ? signature[0] : signature;
      if (!Buffer.isBuffer(req.body)) {
        console.error('STRIPE WEBHOOK ERROR: req.body is not a Buffer');
        return res.status(500).json({ error: 'Webhook processing error' });
      }
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);

      const event = JSON.parse(req.body.toString());
      const eventType = event?.type;
      const { db } = await import('./db');
      const { sql } = await import('drizzle-orm');

      if (eventType === "payment_intent.succeeded") {
        const pi = event.data.object;
        const invoiceId = pi.metadata?.paylink_invoice_id;
        if (invoiceId) {
          await db.execute(sql`
            UPDATE payments SET status = 'succeeded', paid_at = NOW(), processor_transaction_id = ${pi.id}, updated_at = NOW()
            WHERE stripe_payment_intent_id = ${pi.id}
          `);
          await db.execute(sql`
            UPDATE invoices SET status = 'paid', paid_at = NOW(), amount_paid = total_amount WHERE id = ${invoiceId}
          `);
        }
      } else if (eventType === "payment_intent.payment_failed") {
        const pi = event.data.object;
        const invoiceId = pi.metadata?.paylink_invoice_id;
        if (invoiceId) {
          const failReason = pi.last_payment_error?.message || "Payment failed";
          await db.execute(sql`
            UPDATE payments SET status = 'failed', failure_reason = ${failReason}, failed_at = NOW(), updated_at = NOW()
            WHERE stripe_payment_intent_id = ${pi.id}
          `);
          await db.execute(sql`UPDATE invoices SET status = 'overdue' WHERE id = ${invoiceId}`);
        }
      } else if (eventType === "charge.refunded" || eventType === "charge.dispute.created") {
        const charge = event.data.object;
        const piId = charge.payment_intent;
        if (piId) {
          await db.execute(sql`
            UPDATE payments SET status = 'failed', failure_reason = 'Payment returned/disputed', updated_at = NOW()
            WHERE stripe_payment_intent_id = ${piId}
          `);
          const paymentResult = await db.execute(sql`SELECT invoice_id FROM payments WHERE stripe_payment_intent_id = ${piId} LIMIT 1`);
          if (paymentResult.rows[0]?.invoice_id) {
            await db.execute(sql`UPDATE invoices SET status = 'overdue' WHERE id = ${paymentResult.rows[0].invoice_id}`);
          }
        }
      }

      // ── Tenant billing lifecycle events ────────────────────────────────
      if (
        eventType === "invoice.payment_failed" ||
        eventType === "customer.subscription.deleted" ||
        eventType === "invoice.payment_succeeded" ||
        eventType === "customer.subscription.updated"
      ) {
        try {
          const { handleTenantBillingEvent } = await import('./billingLifecycle');
          await handleTenantBillingEvent(eventType, event.data.object);
        } catch (be: any) {
          console.error('[BillingLifecycle] Handler error:', be.message);
        }
      }

      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error('Webhook error:', error.message);
      res.status(400).json({ error: 'Webhook processing error' });
    }
  }
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.use("/uploads", express.static(uploadsDir));
app.use("/docs", express.static(path.join(process.cwd(), "docs")));

const PgStore = connectPgSimple(session);
const sessionMiddleware = session({
  store: new PgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || "paylink-dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    domain: isProduction ? ".mypaylink.app" : undefined,
  },
});

app.use((req, res, next) => {
  sessionMiddleware(req, res, () => {
    const origin = req.headers.origin;
    const isCapacitor = origin !== undefined && CAPACITOR_ORIGINS.includes(origin);
    if (isCapacitor && isProduction && req.session?.cookie) {
      req.session.cookie.sameSite = "none";
      req.session.cookie.secure = true;
    }
    next();
  });
});

if (isProduction) {
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Auto-apply safe column additions so VPS stays in sync without manual migrations
  {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    const run = async (label: string, stmt: any) => {
      try { await db.execute(stmt); console.log(`Auto-migration OK: ${label}`); }
      catch (e: any) { console.log(`Auto-migration skipped (${label}):`, e.message); }
    };
    await run("schedules.job_id", sql`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS job_id VARCHAR`);
    await run("schedules.position_id", sql`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS position_id VARCHAR`);
    await run("schedules.cost_center_id", sql`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS cost_center_id VARCHAR`);
    await run("schedules.note", sql`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS note TEXT`);
    await run("recurring_schedules.job_id", sql`ALTER TABLE recurring_schedules ADD COLUMN IF NOT EXISTS job_id VARCHAR`);
    await run("recurring_schedules.position_id", sql`ALTER TABLE recurring_schedules ADD COLUMN IF NOT EXISTS position_id VARCHAR`);
    await run("recurring_schedules.cost_center_id", sql`ALTER TABLE recurring_schedules ADD COLUMN IF NOT EXISTS cost_center_id VARCHAR`);
    await run("recurring_schedules.note", sql`ALTER TABLE recurring_schedules ADD COLUMN IF NOT EXISTS note TEXT`);
    await run("recurring_schedules.department", sql`ALTER TABLE recurring_schedules ADD COLUMN IF NOT EXISTS department TEXT`);
    await run("employee_groups.company_id nullable", sql`ALTER TABLE employee_groups ALTER COLUMN company_id DROP NOT NULL`);
    await run("employee_titles.company_id nullable", sql`ALTER TABLE employee_titles ALTER COLUMN company_id DROP NOT NULL`);
    await run("pay_stub_amendments.amendment_type", sql`ALTER TABLE pay_stub_amendments ADD COLUMN IF NOT EXISTS amendment_type TEXT DEFAULT 'earning'`);
    // time_punches additions
    await run("time_punches.approval_status", sql`ALTER TABLE time_punches ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'approved'`);
    await run("time_punches.approved_by", sql`ALTER TABLE time_punches ADD COLUMN IF NOT EXISTS approved_by VARCHAR`);
    await run("time_punches.schedule_id", sql`ALTER TABLE time_punches ADD COLUMN IF NOT EXISTS schedule_id VARCHAR`);
    await run("time_punches.station_id", sql`ALTER TABLE time_punches ADD COLUMN IF NOT EXISTS station_id VARCHAR`);
    // time_entries additions
    await run("time_entries.double_time_hours", sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS double_time_hours NUMERIC DEFAULT 0`);
    await run("time_entries.wage_group_id", sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS wage_group_id VARCHAR`);
    await run("time_entries.schedule_id", sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS schedule_id VARCHAR`);
    await run("time_entries.scheduled_start", sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMP`);
    await run("time_entries.scheduled_end", sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMP`);
    await run("time_entries.scheduled_hours", sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS scheduled_hours NUMERIC`);
    await run("time_entries.late_minutes", sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS late_minutes INTEGER DEFAULT 0`);
    await run("time_entries.early_departure_minutes", sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS early_departure_minutes INTEGER DEFAULT 0`);
    await run("time_entries.is_unscheduled", sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS is_unscheduled BOOLEAN DEFAULT FALSE`);
    await run("time_entries.source", sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'`);
    await run("time_entries.tips_amount", sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS tips_amount NUMERIC DEFAULT 0`);
    await run("time_entries.pay_category", sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS pay_category TEXT DEFAULT 'regular'`);
    await run("time_entries.override_pay_rate", sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS override_pay_rate NUMERIC`);
    await run("payroll_items.commission_hours", sql`ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS commission_hours NUMERIC DEFAULT 0`);
    await run("payroll_items.commission_hourly_pay", sql`ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS commission_hourly_pay NUMERIC DEFAULT 0`);
    await run("payroll_items.volunteer_hours", sql`ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS volunteer_hours NUMERIC DEFAULT 0`);
    await run("payroll_items.special_event_hours", sql`ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS special_event_hours NUMERIC DEFAULT 0`);
    await run("payroll_items.special_event_pay", sql`ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS special_event_pay NUMERIC DEFAULT 0`);
    await run("payroll_items.is_manual_override", sql`ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN DEFAULT FALSE`);
    await run("payroll_items.manual_override_note", sql`ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS manual_override_note TEXT`);
    await run("payroll_runs.needs_recalculation", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS needs_recalculation BOOLEAN DEFAULT FALSE`);
    await run("jobs.is_special_event", sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_special_event BOOLEAN DEFAULT FALSE`);
    // shift_offers table + additions
    await run("shift_offers table", sql`CREATE TABLE IF NOT EXISTS shift_offers (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      schedule_id VARCHAR NOT NULL REFERENCES schedules(id),
      offered_by_worker_id VARCHAR NOT NULL REFERENCES workers(id),
      status TEXT DEFAULT 'open',
      claimed_by_worker_id VARCHAR REFERENCES workers(id),
      approved_by VARCHAR,
      notes TEXT,
      manager_note TEXT,
      offered_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await run("shift_offers.manager_note", sql`ALTER TABLE shift_offers ADD COLUMN IF NOT EXISTS manager_note TEXT`);
    await run("payroll_payment_methods table", sql`CREATE TABLE IF NOT EXISTS payroll_payment_methods (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR REFERENCES companies(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT DEFAULT 'other',
      is_digital_wallet BOOLEAN DEFAULT FALSE,
      is_bank_based BOOLEAN DEFAULT FALSE,
      requires_reference_number BOOLEAN DEFAULT FALSE,
      requires_account_selection BOOLEAN DEFAULT TRUE,
      active BOOLEAN DEFAULT TRUE,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await run("funding_accounts table", sql`CREATE TABLE IF NOT EXISTS funding_accounts (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR REFERENCES companies(id),
      name TEXT NOT NULL,
      account_type TEXT DEFAULT 'checking',
      bank_name TEXT,
      routing_number TEXT,
      account_number TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      is_default BOOLEAN DEFAULT FALSE,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await run("payroll_payment_records table", sql`CREATE TABLE IF NOT EXISTS payroll_payment_records (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      payroll_run_id VARCHAR REFERENCES payroll_runs(id),
      worker_id VARCHAR REFERENCES workers(id),
      company_id VARCHAR REFERENCES companies(id),
      payment_method_id VARCHAR REFERENCES payroll_payment_methods(id),
      funding_account_id VARCHAR REFERENCES funding_accounts(id),
      amount NUMERIC DEFAULT 0,
      reference_number TEXT,
      status TEXT DEFAULT 'pending',
      processed_at TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await run("time_off_requests table", sql`CREATE TABLE IF NOT EXISTS time_off_requests (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      worker_id VARCHAR NOT NULL REFERENCES workers(id),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      request_type TEXT NOT NULL DEFAULT 'vacation',
      start_date DATE NOT NULL,
      start_time TEXT,
      end_date DATE NOT NULL,
      end_time TEXT,
      total_days NUMERIC,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by VARCHAR,
      reviewed_at TIMESTAMP,
      review_note TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await run("stations.requires_schedule", sql`ALTER TABLE stations ADD COLUMN IF NOT EXISTS requires_schedule BOOLEAN DEFAULT FALSE`);
    await run("payroll_runs.pay_date", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS pay_date DATE`);
    await run("payroll_runs.use_direct_deposit", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS use_direct_deposit BOOLEAN NOT NULL DEFAULT TRUE`);
    await run("payroll_runs.approved_at", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP`);
    await run("payroll_runs.approved_by", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS approved_by VARCHAR`);
    await run("payroll_runs.ach_status", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS ach_status TEXT`);
    await run("payroll_runs.ach_submitted_at", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS ach_submitted_at TIMESTAMP`);
    await run("payroll_runs.ach_batch_id", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS ach_batch_id TEXT`);
    await run("payroll_runs.ach_settled_at", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS ach_settled_at TIMESTAMP`);
    await run("payroll_runs.locked_at", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP`);
    await run("payroll_runs.locked_by", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS locked_by VARCHAR`);
    await run("payroll_runs.funding_account_id", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS funding_account_id VARCHAR`);
    await run("payroll_runs.total_deductions", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_deductions NUMERIC DEFAULT 0`);
    await run("payroll_runs.total_employer_taxes", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_employer_taxes NUMERIC DEFAULT 0`);
    await run("payroll_runs.total_reimbursements", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_reimbursements NUMERIC DEFAULT 0`);
    await run("receipts.payment_method", sql`ALTER TABLE receipts ADD COLUMN IF NOT EXISTS payment_method TEXT`);
    await run("receipts.tax_amount", sql`ALTER TABLE receipts ADD COLUMN IF NOT EXISTS tax_amount NUMERIC`);
    await run("receipts.subtotal", sql`ALTER TABLE receipts ADD COLUMN IF NOT EXISTS subtotal NUMERIC`);
    await run("receipts.line_items", sql`ALTER TABLE receipts ADD COLUMN IF NOT EXISTS line_items TEXT`);
    await run("receipts.is_reimbursement", sql`ALTER TABLE receipts ADD COLUMN IF NOT EXISTS is_reimbursement BOOLEAN DEFAULT FALSE`);
    await run("receipts.approved_at", sql`ALTER TABLE receipts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP`);
    await run("pay_stub_amendments.approval_status", sql`ALTER TABLE pay_stub_amendments ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending'`);
    await run("pay_stub_amendments.approved_by", sql`ALTER TABLE pay_stub_amendments ADD COLUMN IF NOT EXISTS approved_by VARCHAR`);
    await run("pay_stub_amendments.approved_at", sql`ALTER TABLE pay_stub_amendments ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP`);
    await run("divisions.company_id nullable", sql`ALTER TABLE divisions ALTER COLUMN company_id DROP NOT NULL`);
    await run("cost_centers.company_id nullable", sql`ALTER TABLE cost_centers ALTER COLUMN company_id DROP NOT NULL`);
    await run("secondary_wage_groups.company_id nullable", sql`ALTER TABLE secondary_wage_groups ALTER COLUMN company_id DROP NOT NULL`);

    await run("employee_group_configs table", sql`CREATE TABLE IF NOT EXISTS employee_group_configs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      group_key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      tax_form TEXT NOT NULL DEFAULT 'W-2',
      payroll_taxes_withheld BOOLEAN NOT NULL DEFAULT TRUE,
      employer_taxes_apply BOOLEAN NOT NULL DEFAULT TRUE,
      time_tracking TEXT NOT NULL DEFAULT 'required',
      overtime_eligible BOOLEAN NOT NULL DEFAULT TRUE,
      invoice_workflow BOOLEAN NOT NULL DEFAULT FALSE,
      distributions BOOLEAN NOT NULL DEFAULT FALSE,
      volunteer_eligible BOOLEAN NOT NULL DEFAULT FALSE,
      payroll_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      year_end_doc_type TEXT NOT NULL DEFAULT 'W-2',
      description TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("workers.worker_group", sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS worker_group TEXT DEFAULT 'hourly_employee'`);

    await run("schedule_preferences table", sql`CREATE TABLE IF NOT EXISTS schedule_preferences (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      worker_id VARCHAR NOT NULL REFERENCES workers(id),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      preference_type TEXT NOT NULL DEFAULT 'day_off',
      day_of_week INTEGER,
      shift_time TEXT,
      prefer_not_to_work BOOLEAN NOT NULL DEFAULT FALSE,
      importance INTEGER NOT NULL DEFAULT 3,
      note TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("shift_marketplace_listings table", sql`CREATE TABLE IF NOT EXISTS shift_marketplace_listings (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      schedule_id VARCHAR NOT NULL REFERENCES schedules(id),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      listed_by_worker_id VARCHAR NOT NULL REFERENCES workers(id),
      listing_type TEXT NOT NULL DEFAULT 'offer',
      reason TEXT,
      urgency TEXT NOT NULL DEFAULT 'normal',
      emergency_coverage BOOLEAN NOT NULL DEFAULT FALSE,
      employee_acknowledged_responsibility BOOLEAN NOT NULL DEFAULT FALSE,
      eligibility_rule_set_id VARCHAR,
      status TEXT NOT NULL DEFAULT 'open',
      expires_at TIMESTAMP,
      filled_by_worker_id VARCHAR,
      filled_at TIMESTAMP,
      approved_by VARCHAR,
      approved_at TIMESTAMP,
      withdrawn_at TIMESTAMP,
      withdrawn_reason TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("shift_marketplace_requests table", sql`CREATE TABLE IF NOT EXISTS shift_marketplace_requests (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id VARCHAR NOT NULL REFERENCES shift_marketplace_listings(id),
      requesting_worker_id VARCHAR NOT NULL REFERENCES workers(id),
      request_type TEXT NOT NULL DEFAULT 'pickup',
      proposed_shift_id VARCHAR,
      note TEXT,
      eligibility_snapshot_json TEXT,
      conflict_snapshot_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by VARCHAR,
      reviewed_at TIMESTAMP,
      review_note TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("eligibility_rule_sets table", sql`CREATE TABLE IF NOT EXISTS eligibility_rule_sets (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR REFERENCES companies(id),
      name TEXT NOT NULL,
      description TEXT,
      require_same_company BOOLEAN NOT NULL DEFAULT TRUE,
      require_same_department BOOLEAN NOT NULL DEFAULT TRUE,
      require_same_branch BOOLEAN NOT NULL DEFAULT TRUE,
      require_same_employee_group BOOLEAN NOT NULL DEFAULT TRUE,
      require_same_position BOOLEAN NOT NULL DEFAULT FALSE,
      require_no_schedule_conflict BOOLEAN NOT NULL DEFAULT TRUE,
      require_no_leave_conflict BOOLEAN NOT NULL DEFAULT TRUE,
      require_active_status BOOLEAN NOT NULL DEFAULT TRUE,
      max_weekly_hours NUMERIC,
      min_rest_hours NUMERIC,
      require_certifications BOOLEAN NOT NULL DEFAULT FALSE,
      allow_overtime_pickup BOOLEAN NOT NULL DEFAULT FALSE,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("schedule_audit_logs table", sql`CREATE TABLE IF NOT EXISTS schedule_audit_logs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR REFERENCES companies(id),
      actor_user_id VARCHAR,
      actor_worker_id VARCHAR,
      action_type TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id VARCHAR,
      before_json TEXT,
      after_json TEXT,
      metadata_json TEXT,
      ip_address TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("notification_preferences table", sql`CREATE TABLE IF NOT EXISTS notification_preferences (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      worker_id VARCHAR NOT NULL REFERENCES workers(id),
      event_type TEXT NOT NULL,
      email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      sms_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("expense_categories table", sql`CREATE TABLE IF NOT EXISTS expense_categories (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      accounting_code TEXT,
      payroll_reimbursement_code TEXT,
      reimbursable_default BOOLEAN NOT NULL DEFAULT FALSE,
      receipt_required BOOLEAN NOT NULL DEFAULT TRUE,
      preapproval_required BOOLEAN NOT NULL DEFAULT FALSE,
      project_required BOOLEAN NOT NULL DEFAULT FALSE,
      cost_center_required BOOLEAN NOT NULL DEFAULT FALSE,
      allowed_worker_groups TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("expenses table", sql`CREATE TABLE IF NOT EXISTS expenses (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR REFERENCES companies(id),
      submitter_id VARCHAR NOT NULL REFERENCES workers(id),
      category_id VARCHAR,
      category_name TEXT,
      expense_date TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      tax_amount NUMERIC,
      subtotal NUMERIC,
      vendor TEXT,
      description TEXT,
      business_purpose TEXT,
      reimbursement_requested BOOLEAN NOT NULL DEFAULT FALSE,
      payment_method_used TEXT,
      project_id VARCHAR,
      job_id VARCHAR,
      cost_center_id VARCHAR,
      preapproval_status TEXT,
      preapproval_reference TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      approved_by VARCHAR,
      approved_at TIMESTAMP,
      rejected_by VARCHAR,
      rejected_at TIMESTAMP,
      rejection_reason TEXT,
      reimbursement_status TEXT,
      payroll_run_id VARCHAR,
      export_status TEXT DEFAULT 'pending',
      exported_at TIMESTAMP,
      line_items TEXT,
      ai_extracted_json TEXT,
      ai_confidence_score NUMERIC,
      duplicate_hash TEXT,
      recurring_template_id VARCHAR,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("expense_attachments table", sql`CREATE TABLE IF NOT EXISTS expense_attachments (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      expense_id VARCHAR NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT,
      file_type TEXT,
      file_size INTEGER,
      is_receipt BOOLEAN NOT NULL DEFAULT TRUE,
      uploaded_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("contractor_invoices table", sql`CREATE TABLE IF NOT EXISTS contractor_invoices (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR REFERENCES companies(id),
      contractor_id VARCHAR NOT NULL REFERENCES workers(id),
      invoice_number TEXT,
      invoice_date TEXT NOT NULL,
      due_date TEXT,
      amount NUMERIC NOT NULL,
      tax_amount NUMERIC,
      description TEXT,
      proposal_id VARCHAR,
      proposal_reference TEXT,
      project_id VARCHAR,
      job_id VARCHAR,
      cost_center_id VARCHAR,
      payment_terms TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      approved_by VARCHAR,
      approved_at TIMESTAMP,
      rejected_by VARCHAR,
      rejected_at TIMESTAMP,
      rejection_reason TEXT,
      paid_at TIMESTAMP,
      paid_amount NUMERIC,
      payment_reference TEXT,
      payment_method TEXT,
      export_status TEXT DEFAULT 'pending',
      exported_at TIMESTAMP,
      is_1099_reportable BOOLEAN NOT NULL DEFAULT TRUE,
      line_items TEXT,
      ai_extracted_json TEXT,
      ai_confidence_score NUMERIC,
      duplicate_hash TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("contractor_invoice_attachments table", sql`CREATE TABLE IF NOT EXISTS contractor_invoice_attachments (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id VARCHAR NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT,
      file_type TEXT,
      file_size INTEGER,
      uploaded_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("recurring_expense_templates table", sql`CREATE TABLE IF NOT EXISTS recurring_expense_templates (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR REFERENCES companies(id),
      submitter_id VARCHAR NOT NULL REFERENCES workers(id),
      category_id VARCHAR,
      category_name TEXT,
      vendor TEXT,
      description TEXT,
      amount NUMERIC NOT NULL,
      reimbursement_requested BOOLEAN NOT NULL DEFAULT FALSE,
      project_id VARCHAR,
      job_id VARCHAR,
      cost_center_id VARCHAR,
      frequency TEXT NOT NULL DEFAULT 'monthly',
      start_date TEXT NOT NULL,
      end_date TEXT,
      next_due_date TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_generated_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("expense_approval_actions table", sql`CREATE TABLE IF NOT EXISTS expense_approval_actions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      object_type TEXT NOT NULL,
      object_id VARCHAR NOT NULL,
      action_type TEXT NOT NULL,
      actor_user_id VARCHAR,
      actor_worker_id VARCHAR,
      company_id VARCHAR,
      previous_status TEXT,
      new_status TEXT,
      notes TEXT,
      metadata_json TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("payroll_reimbursement_items table", sql`CREATE TABLE IF NOT EXISTS payroll_reimbursement_items (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      expense_id VARCHAR NOT NULL,
      payroll_run_id VARCHAR,
      worker_id VARCHAR NOT NULL REFERENCES workers(id),
      company_id VARCHAR REFERENCES companies(id),
      amount NUMERIC NOT NULL,
      is_taxable BOOLEAN NOT NULL DEFAULT FALSE,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      included_in_payroll_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // Subscription / billing columns on companies
    await run("companies.subscription_status", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'active_paid'`);
    await run("companies.plan_name", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS plan_name TEXT DEFAULT 'starter'`);
    await run("companies.trial_start", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS trial_start TIMESTAMP`);
    await run("companies.trial_end", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS trial_end TIMESTAMP`);
    await run("companies.trial_used", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS trial_used BOOLEAN DEFAULT FALSE`);
    await run("companies.billing_active", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_active BOOLEAN DEFAULT FALSE`);
    await run("companies.payment_method_on_file", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS payment_method_on_file BOOLEAN DEFAULT FALSE`);
    await run("companies.is_demo", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE`);
    await run("companies.next_check_number", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS next_check_number INTEGER DEFAULT 1`);

    // Trial signups table
    await run("trial_signups table", sql`CREATE TABLE IF NOT EXISTS trial_signups (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_name TEXT NOT NULL,
      employee_count INTEGER,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      job_title TEXT,
      email TEXT NOT NULL,
      phone TEXT,
      company_id VARCHAR,
      user_id VARCHAR,
      trial_start TIMESTAMP DEFAULT NOW(),
      trial_end TIMESTAMP,
      subscription_status TEXT DEFAULT 'trial_active',
      billing_active BOOLEAN DEFAULT FALSE,
      payment_method_on_file BOOLEAN DEFAULT FALSE,
      terms_accepted_at TIMESTAMP,
      terms_version TEXT DEFAULT '1.0',
      privacy_version TEXT DEFAULT '1.0',
      signup_ip TEXT,
      canceled_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // Analytics events table
    await run("analytics_events table", sql`CREATE TABLE IF NOT EXISTS analytics_events (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      event_name TEXT NOT NULL,
      user_id VARCHAR,
      company_id VARCHAR,
      page_source TEXT,
      metadata TEXT,
      session_id TEXT,
      ip_address TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // Onboarding progress table
    await run("onboarding_progress table", sql`CREATE TABLE IF NOT EXISTS onboarding_progress (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL,
      user_id VARCHAR NOT NULL,
      step_company_details BOOLEAN DEFAULT FALSE,
      step_first_employee BOOLEAN DEFAULT FALSE,
      step_pay_schedule BOOLEAN DEFAULT FALSE,
      step_payroll_config BOOLEAN DEFAULT FALSE,
      step_time_clock BOOLEAN DEFAULT FALSE,
      step_payroll_preview BOOLEAN DEFAULT FALSE,
      completed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("onboarding_progress.step_bank_connected", sql`ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS step_bank_connected BOOLEAN DEFAULT FALSE`);
    await run("onboarding_progress.onboarding_wizard_completed", sql`ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS onboarding_wizard_completed BOOLEAN DEFAULT FALSE`);
    await run("onboarding_progress.business_type", sql`ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS business_type TEXT`);
    await run("onboarding_progress.employee_count", sql`ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS employee_count INTEGER`);

    // Customers table
    await run("customers table", sql`CREATE TABLE IF NOT EXISTS customers (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      customer_name TEXT NOT NULL,
      business_name TEXT,
      email TEXT,
      phone TEXT,
      billing_contact_name TEXT,
      billing_email TEXT,
      billing_address TEXT,
      billing_city TEXT,
      billing_state TEXT,
      billing_zip TEXT,
      billing_country TEXT,
      tax_id TEXT,
      default_payment_terms TEXT DEFAULT 'net_30',
      notes TEXT,
      status TEXT DEFAULT 'active',
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("customers.customer_type", sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_type TEXT DEFAULT 'customer'`);

    // Invoice templates table
    await run("invoice_templates table", sql`CREATE TABLE IF NOT EXISTS invoice_templates (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR REFERENCES companies(id),
      name TEXT NOT NULL,
      description TEXT,
      layout_key TEXT NOT NULL DEFAULT 'modern_clean',
      logo_url TEXT,
      brand_color TEXT DEFAULT '#0d9488',
      header_text TEXT,
      footer_text TEXT,
      payment_instructions TEXT,
      terms_and_conditions TEXT,
      is_default BOOLEAN DEFAULT FALSE,
      is_system BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // Invoices table
    await run("invoices table", sql`CREATE TABLE IF NOT EXISTS invoices (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      customer_id VARCHAR REFERENCES customers(id),
      template_id VARCHAR REFERENCES invoice_templates(id),
      invoice_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      issue_date DATE NOT NULL,
      due_date DATE NOT NULL,
      subtotal NUMERIC DEFAULT 0,
      tax_rate NUMERIC DEFAULT 0,
      tax_amount NUMERIC DEFAULT 0,
      discount_amount NUMERIC DEFAULT 0,
      discount_type TEXT DEFAULT 'fixed',
      total_amount NUMERIC DEFAULT 0,
      amount_paid NUMERIC DEFAULT 0,
      amount_due NUMERIC DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      notes TEXT,
      internal_notes TEXT,
      payment_terms TEXT DEFAULT 'net_30',
      recurring_billing_id VARCHAR,
      sent_at TIMESTAMP,
      viewed_at TIMESTAMP,
      paid_at TIMESTAMP,
      voided_at TIMESTAMP,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // Invoice line items table
    await run("invoice_line_items table", sql`CREATE TABLE IF NOT EXISTS invoice_line_items (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id VARCHAR NOT NULL REFERENCES invoices(id),
      description TEXT NOT NULL,
      quantity NUMERIC DEFAULT 1,
      unit_price NUMERIC DEFAULT 0,
      amount NUMERIC DEFAULT 0,
      taxable BOOLEAN DEFAULT TRUE,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // Payments table
    await run("payments table", sql`CREATE TABLE IF NOT EXISTS payments (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      invoice_id VARCHAR REFERENCES invoices(id),
      customer_id VARCHAR REFERENCES customers(id),
      payment_method TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      processor_fee NUMERIC DEFAULT 0,
      net_amount NUMERIC DEFAULT 0,
      payment_fee_charged NUMERIC DEFAULT 0,
      processor_transaction_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      paid_at TIMESTAMP,
      failed_at TIMESTAMP,
      failure_reason TEXT,
      receipt_url TEXT,
      notes TEXT,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // Saved payment methods table
    await run("saved_payment_methods table", sql`CREATE TABLE IF NOT EXISTS saved_payment_methods (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id VARCHAR NOT NULL REFERENCES customers(id),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      method_type TEXT NOT NULL,
      last_4 TEXT,
      brand TEXT,
      bank_name TEXT,
      expiry_month INTEGER,
      expiry_year INTEGER,
      processor_token TEXT,
      is_default BOOLEAN DEFAULT FALSE,
      is_auto_pay BOOLEAN DEFAULT FALSE,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // Recurring billing profiles table
    await run("recurring_billing_profiles table", sql`CREATE TABLE IF NOT EXISTS recurring_billing_profiles (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      customer_id VARCHAR NOT NULL REFERENCES customers(id),
      template_id VARCHAR REFERENCES invoice_templates(id),
      name TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'monthly',
      custom_interval_days INTEGER,
      amount NUMERIC NOT NULL,
      currency TEXT DEFAULT 'USD',
      line_items TEXT,
      tax_rate NUMERIC DEFAULT 0,
      start_date DATE NOT NULL,
      end_date DATE,
      next_invoice_date DATE,
      trial_end_date DATE,
      auto_pay_enabled BOOLEAN DEFAULT FALSE,
      retry_on_failure BOOLEAN DEFAULT TRUE,
      max_retries INTEGER DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'active',
      canceled_at TIMESTAMP,
      notes TEXT,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("recurring_billing_profiles.due_days", sql`ALTER TABLE recurring_billing_profiles ADD COLUMN IF NOT EXISTS due_days INTEGER DEFAULT 30`);
    await run("recurring_billing_profiles.notify_email", sql`ALTER TABLE recurring_billing_profiles ADD COLUMN IF NOT EXISTS notify_email BOOLEAN DEFAULT TRUE`);
    await run("recurring_billing_profiles.notify_sms", sql`ALTER TABLE recurring_billing_profiles ADD COLUMN IF NOT EXISTS notify_sms BOOLEAN DEFAULT FALSE`);
    await run("recurring_billing_profiles.notify_days_before", sql`ALTER TABLE recurring_billing_profiles ADD COLUMN IF NOT EXISTS notify_days_before INTEGER DEFAULT 7`);
    await run("recurring_billing_profiles.reminder_frequency_days", sql`ALTER TABLE recurring_billing_profiles ADD COLUMN IF NOT EXISTS reminder_frequency_days INTEGER DEFAULT 0`);

    // Document folders table
    await run("document_folders table", sql`CREATE TABLE IF NOT EXISTS document_folders (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      parent_id VARCHAR,
      category TEXT,
      color TEXT,
      sort_order INTEGER DEFAULT 0,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // Documents table
    await run("documents table", sql`CREATE TABLE IF NOT EXISTS documents (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      folder_id VARCHAR REFERENCES document_folders(id),
      title TEXT NOT NULL,
      description TEXT,
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      tags TEXT,
      category TEXT,
      status TEXT DEFAULT 'active',
      is_template BOOLEAN DEFAULT FALSE,
      template_merge_tags TEXT,
      expires_at TIMESTAMP,
      assigned_to_worker_id VARCHAR,
      assigned_to_customer_id VARCHAR,
      current_version_id VARCHAR,
      access_level TEXT DEFAULT 'company',
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // Document versions table
    await run("document_versions table", sql`CREATE TABLE IF NOT EXISTS document_versions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id VARCHAR NOT NULL REFERENCES documents(id),
      version_number INTEGER NOT NULL DEFAULT 1,
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_size INTEGER,
      change_note TEXT,
      uploaded_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // Document signature requests table
    await run("document_signature_requests table", sql`CREATE TABLE IF NOT EXISTS document_signature_requests (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id VARCHAR NOT NULL REFERENCES documents(id),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      status TEXT NOT NULL DEFAULT 'draft',
      sent_at TIMESTAMP,
      completed_at TIMESTAMP,
      expires_at TIMESTAMP,
      message TEXT,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // Document signers table
    await run("document_signers table", sql`CREATE TABLE IF NOT EXISTS document_signers (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      signature_request_id VARCHAR NOT NULL REFERENCES document_signature_requests(id),
      signer_name TEXT NOT NULL,
      signer_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      signed_at TIMESTAMP,
      ip_address TEXT,
      signature_data TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // Document audit logs table
    await run("document_audit_logs table", sql`CREATE TABLE IF NOT EXISTS document_audit_logs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id VARCHAR REFERENCES documents(id),
      signature_request_id VARCHAR,
      company_id VARCHAR NOT NULL,
      action TEXT NOT NULL,
      actor_name TEXT,
      actor_email TEXT,
      actor_id VARCHAR,
      ip_address TEXT,
      details TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // Automation rules table
    await run("automation_rules table", sql`CREATE TABLE IF NOT EXISTS automation_rules (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      description TEXT,
      trigger_type TEXT NOT NULL,
      trigger_config TEXT,
      action_type TEXT NOT NULL,
      action_config TEXT,
      is_enabled BOOLEAN DEFAULT TRUE,
      is_system BOOLEAN DEFAULT FALSE,
      category TEXT,
      last_triggered_at TIMESTAMP,
      trigger_count INTEGER DEFAULT 0,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // Automation events table
    await run("automation_events table", sql`CREATE TABLE IF NOT EXISTS automation_events (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_id VARCHAR NOT NULL REFERENCES automation_rules(id),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      trigger_type TEXT NOT NULL,
      action_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      trigger_data TEXT,
      action_result TEXT,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // Notifications table
    await run("notifications table", sql`CREATE TABLE IF NOT EXISTS notifications (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      user_id VARCHAR,
      worker_id VARCHAR,
      customer_id VARCHAR,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      action_url TEXT,
      is_read BOOLEAN DEFAULT FALSE,
      read_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // Portal access tokens table
    await run("payment_method_configs table", sql`CREATE TABLE IF NOT EXISTS payment_method_configs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      method_type TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      fee_type TEXT NOT NULL DEFAULT 'percentage',
      fee_percent NUMERIC DEFAULT 0,
      fee_flat NUMERIC DEFAULT 0,
      fee_cap NUMERIC,
      is_enabled BOOLEAN DEFAULT TRUE,
      is_recommended BOOLEAN DEFAULT FALSE,
      processing_time TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("payments.base_amount", sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS base_amount NUMERIC DEFAULT '0'`);
    await run("payments.fee_amount", sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS fee_amount NUMERIC DEFAULT '0'`);
    await run("payments.total_charged", sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS total_charged NUMERIC DEFAULT '0'`);
    await run("payments.stripe_payment_intent_id", sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT`);
    await run("payments.stripe_customer_id", sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`);
    await run("payments.mandate_accepted", sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS mandate_accepted BOOLEAN DEFAULT FALSE`);
    await run("payment_method_configs.fee_passed_to_customer", sql`ALTER TABLE payment_method_configs ADD COLUMN IF NOT EXISTS fee_passed_to_customer BOOLEAN DEFAULT TRUE`);

    await run("companies.station_enforcement_enabled", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS station_enforcement_enabled BOOLEAN DEFAULT FALSE`);

    await run("portal_access_tokens table", sql`CREATE TABLE IF NOT EXISTS portal_access_tokens (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      customer_id VARCHAR REFERENCES customers(id),
      invoice_id VARCHAR REFERENCES invoices(id),
      document_id VARCHAR REFERENCES documents(id),
      signature_request_id VARCHAR,
      token TEXT NOT NULL,
      token_type TEXT NOT NULL,
      expires_at TIMESTAMP,
      used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("document_folders.legal_hold", sql`ALTER TABLE document_folders ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN DEFAULT FALSE`);
    await run("document_folders.retention_policy_id", sql`ALTER TABLE document_folders ADD COLUMN IF NOT EXISTS retention_policy_id VARCHAR`);

    await run("documents.classification", sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS classification TEXT DEFAULT 'internal'`);
    await run("documents.document_type", sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_type TEXT`);
    await run("documents.department", sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS department TEXT`);
    await run("documents.owner", sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS owner TEXT`);
    await run("documents.effective_date", sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS effective_date TIMESTAMP`);
    await run("documents.retention_policy_id", sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS retention_policy_id VARCHAR`);
    await run("documents.disposition_date", sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS disposition_date TIMESTAMP`);
    await run("documents.disposition_status", sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS disposition_status TEXT`);
    await run("documents.legal_hold", sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN DEFAULT FALSE`);

    await run("document_acls table", sql`CREATE TABLE IF NOT EXISTS document_acls (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      document_id VARCHAR,
      folder_id VARCHAR,
      principal_type TEXT NOT NULL,
      principal_id VARCHAR NOT NULL,
      permission TEXT NOT NULL,
      inherited BOOLEAN DEFAULT FALSE,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("document_retention_policies table", sql`CREATE TABLE IF NOT EXISTS document_retention_policies (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      description TEXT,
      document_type TEXT,
      retention_years INTEGER,
      retention_months INTEGER,
      retention_rule TEXT,
      disposition_action TEXT DEFAULT 'archive',
      is_active BOOLEAN DEFAULT TRUE,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("onboarding_packets table", sql`CREATE TABLE IF NOT EXISTS onboarding_packets (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      worker_id VARCHAR NOT NULL,
      template_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      assigned_by VARCHAR,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      due_date TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("onboarding_packet_steps table", sql`CREATE TABLE IF NOT EXISTS onboarding_packet_steps (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      packet_id VARCHAR NOT NULL REFERENCES onboarding_packets(id),
      step_name TEXT NOT NULL,
      step_type TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      assigned_to VARCHAR,
      document_id VARCHAR,
      completed_at TIMESTAMP,
      completed_by VARCHAR,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("invoice_approval_workflows table", sql`CREATE TABLE IF NOT EXISTS invoice_approval_workflows (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      document_id VARCHAR,
      vendor_name TEXT,
      invoice_number TEXT,
      invoice_date TIMESTAMP,
      total_amount TEXT,
      extracted_data TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      current_approver_id VARCHAR,
      approval_chain TEXT,
      submitted_by VARCHAR,
      approved_at TIMESTAMP,
      approved_by VARCHAR,
      paid_at TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("deals table", sql`CREATE TABLE IF NOT EXISTS deals (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      customer_id VARCHAR NOT NULL REFERENCES customers(id),
      title TEXT NOT NULL,
      description TEXT,
      stage TEXT NOT NULL DEFAULT 'lead',
      product_name TEXT,
      value NUMERIC DEFAULT '0',
      currency TEXT DEFAULT 'USD',
      assigned_to VARCHAR,
      expected_close_date DATE,
      closed_at TIMESTAMP,
      lost_reason TEXT,
      notes TEXT,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("onboarding_templates table", sql`CREATE TABLE IF NOT EXISTS onboarding_templates (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      description TEXT,
      product_name TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("onboarding_template_tasks table", sql`CREATE TABLE IF NOT EXISTS onboarding_template_tasks (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id VARCHAR NOT NULL REFERENCES onboarding_templates(id),
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      sort_order INTEGER DEFAULT 0,
      is_mandatory BOOLEAN DEFAULT TRUE,
      estimated_minutes INTEGER,
      resource_url TEXT,
      resource_type TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("customer_onboarding_projects table", sql`CREATE TABLE IF NOT EXISTS customer_onboarding_projects (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      customer_id VARCHAR NOT NULL REFERENCES customers(id),
      deal_id VARCHAR REFERENCES deals(id),
      template_id VARCHAR REFERENCES onboarding_templates(id),
      product_name TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'not_started',
      progress_percentage INTEGER DEFAULT 0,
      assigned_to VARCHAR,
      start_date DATE,
      target_completion_date DATE,
      completed_at TIMESTAMP,
      notes TEXT,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("onboarding_tasks table", sql`CREATE TABLE IF NOT EXISTS onboarding_tasks (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id VARCHAR NOT NULL REFERENCES customer_onboarding_projects(id),
      template_task_id VARCHAR REFERENCES onboarding_template_tasks(id),
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      sort_order INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      is_mandatory BOOLEAN DEFAULT TRUE,
      assigned_to VARCHAR,
      due_date DATE,
      completed_at TIMESTAMP,
      completed_by VARCHAR,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("onboarding_documents table", sql`CREATE TABLE IF NOT EXISTS onboarding_documents (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id VARCHAR REFERENCES customer_onboarding_projects(id),
      template_id VARCHAR REFERENCES onboarding_templates(id),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      title TEXT NOT NULL,
      description TEXT,
      document_type TEXT NOT NULL DEFAULT 'document',
      url TEXT,
      file_size INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("engagement_events table", sql`CREATE TABLE IF NOT EXISTS engagement_events (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      customer_id VARCHAR NOT NULL REFERENCES customers(id),
      project_id VARCHAR REFERENCES customer_onboarding_projects(id),
      event_type TEXT NOT NULL,
      event_source TEXT NOT NULL DEFAULT 'internal',
      product_name TEXT,
      metadata TEXT,
      description TEXT,
      occurred_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("product_api_keys table", sql`CREATE TABLE IF NOT EXISTS product_api_keys (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      product_name TEXT NOT NULL,
      api_key TEXT NOT NULL,
      label TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      last_used_at TIMESTAMP,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("signature_packages table", sql`CREATE TABLE IF NOT EXISTS signature_packages (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      signature_request_id VARCHAR,
      provider TEXT NOT NULL,
      provider_envelope_id TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      document_ids TEXT,
      subject TEXT,
      message TEXT,
      metadata TEXT,
      sent_at TIMESTAMP,
      completed_at TIMESTAMP,
      expires_at TIMESTAMP,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await run("signature_packages.metadata", sql`ALTER TABLE signature_packages ADD COLUMN IF NOT EXISTS metadata TEXT`);
    await run("signature_packages.expires_at", sql`ALTER TABLE signature_packages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`);

    await run("webhook_events table", sql`CREATE TABLE IF NOT EXISTS webhook_events (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      provider TEXT NOT NULL,
      event_type TEXT NOT NULL,
      provider_event_id TEXT UNIQUE,
      envelope_id TEXT,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      processed_at TIMESTAMP,
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await run("webhook_events.provider_event_id unique", sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_provider_event_id ON webhook_events(provider_event_id) WHERE provider_event_id IS NOT NULL`);

    await run("license_requests table", sql`CREATE TABLE IF NOT EXISTS license_requests (
      id SERIAL PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      email TEXT NOT NULL,
      phone TEXT,
      company TEXT,
      employees TEXT,
      interest TEXT,
      message TEXT,
      ip_address TEXT,
      user_agent TEXT,
      source_page TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("document_signature_requests.provider", sql`ALTER TABLE document_signature_requests ADD COLUMN IF NOT EXISTS provider TEXT`);
    await run("document_signature_requests.provider_object_id", sql`ALTER TABLE document_signature_requests ADD COLUMN IF NOT EXISTS provider_object_id TEXT`);
    await run("document_signers.routing_order", sql`ALTER TABLE document_signers ADD COLUMN IF NOT EXISTS routing_order INTEGER DEFAULT 1`);

    // Set starting check number sequences for known companies (only if still at default 1 or null)
    try {
      await db.execute(sql`UPDATE companies SET next_check_number = 100  WHERE LOWER(TRIM(name)) = 'adiken'            AND (next_check_number IS NULL OR next_check_number <= 1)`);
      await db.execute(sql`UPDATE companies SET next_check_number = 300  WHERE LOWER(TRIM(name)) = 'adiken properties' AND (next_check_number IS NULL OR next_check_number <= 1)`);
      await db.execute(sql`UPDATE companies SET next_check_number = 700  WHERE LOWER(TRIM(name)) = 'lucifer cruz'      AND (next_check_number IS NULL OR next_check_number <= 1)`);
      await db.execute(sql`UPDATE companies SET next_check_number = 1000 WHERE LOWER(TRIM(name)) = 'refined mind'      AND (next_check_number IS NULL OR next_check_number <= 1)`);
      console.log("Auto-migration OK: company check number starting sequences");
    } catch (e: any) {
      console.log("Auto-migration skipped (company check numbers):", e.message);
    }

    // Add company_id to payroll_items and enforce unique check numbers per company
    await run("payroll_items.company_id", sql`ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS company_id VARCHAR`);
    try {
      await db.execute(sql`UPDATE payroll_items pi SET company_id = pr.company_id FROM payroll_runs pr WHERE pi.payroll_run_id = pr.id AND pi.company_id IS NULL`);
    } catch (e: any) {
      console.log("Auto-migration skipped (payroll_items company_id populate):", e.message);
    }
    await run("payroll_items.company_check_unique", sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_items_company_check ON payroll_items(company_id, check_number) WHERE check_number IS NOT NULL AND company_id IS NOT NULL`);

    await run("invoices.template_style", sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS template_style TEXT DEFAULT 'modern_clean'`);
    await run("invoices.reminder_enabled", sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN DEFAULT FALSE`);
    await run("invoices.reminder_frequency_days", sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reminder_frequency_days INTEGER DEFAULT 7`);
    await run("invoices.last_reminder_sent_at", sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMP`);
    await run("invoices.next_reminder_at", sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS next_reminder_at TIMESTAMP`);

    // Staff Messaging tables
    await run("staff_messages table", sql`CREATE TABLE IF NOT EXISTS staff_messages (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR REFERENCES companies(id),
      sender_id VARCHAR NOT NULL REFERENCES workers(id),
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'one',
      recipient_worker_id VARCHAR REFERENCES workers(id),
      delivery_channel TEXT NOT NULL DEFAULT 'app',
      parent_message_id VARCHAR,
      is_reply BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await run("staff_messages.sender_id nullable", sql`ALTER TABLE staff_messages ALTER COLUMN sender_id DROP NOT NULL`);
    await run("staff_messages.sender_name", sql`ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS sender_name TEXT`);
    await run("staff_messages.sender_user_id", sql`ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS sender_user_id VARCHAR`);
    await run("staff_message_recipients table", sql`CREATE TABLE IF NOT EXISTS staff_message_recipients (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id VARCHAR NOT NULL REFERENCES staff_messages(id) ON DELETE CASCADE,
      worker_id VARCHAR NOT NULL REFERENCES workers(id),
      read_at TIMESTAMP,
      delivered_at TIMESTAMP DEFAULT NOW()
    )`);
    await run("system_documents table", sql`CREATE TABLE IF NOT EXISTS system_documents (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0',
      category TEXT NOT NULL DEFAULT 'General',
      file_url TEXT,
      description TEXT,
      effective_date DATE,
      change_log TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    // Seed the canonical Payroll Processing Rules document if not already present
    await run("trade_transactions table", sql`CREATE TABLE IF NOT EXISTS trade_transactions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL,
      title TEXT NOT NULL,
      transaction_type TEXT NOT NULL DEFAULT 'services',
      counterparty_type TEXT NOT NULL DEFAULT 'manual',
      counterparty_id VARCHAR,
      counterparty_name TEXT NOT NULL,
      description TEXT,
      fair_market_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'draft',
      is_reportable BOOLEAN NOT NULL DEFAULT FALSE,
      tax_year INTEGER,
      reporting_notes TEXT,
      reviewed_by VARCHAR,
      reviewed_at TIMESTAMP,
      review_notes TEXT,
      created_by VARCHAR NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await run("trade_transaction_items table", sql`CREATE TABLE IF NOT EXISTS trade_transaction_items (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      trade_transaction_id VARCHAR NOT NULL,
      description TEXT NOT NULL,
      item_type TEXT NOT NULL DEFAULT 'services',
      direction TEXT NOT NULL DEFAULT 'given',
      fair_market_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      quantity NUMERIC(10,4) NOT NULL DEFAULT 1,
      unit TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await run("trade_attachments table", sql`CREATE TABLE IF NOT EXISTS trade_attachments (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      trade_transaction_id VARCHAR NOT NULL,
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_by VARCHAR NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await run("trade_audit_logs table", sql`CREATE TABLE IF NOT EXISTS trade_audit_logs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      trade_transaction_id VARCHAR NOT NULL,
      company_id VARCHAR NOT NULL,
      user_id VARCHAR NOT NULL,
      action TEXT NOT NULL,
      old_status TEXT,
      new_status TEXT,
      note TEXT,
      metadata TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await run("trade_transactions.included_in_1099", sql`ALTER TABLE trade_transactions ADD COLUMN IF NOT EXISTS included_in_1099 BOOLEAN NOT NULL DEFAULT FALSE`);
    await run("contractor_documents table", sql`CREATE TABLE IF NOT EXISTS contractor_documents (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL,
      worker_id VARCHAR NOT NULL,
      document_type TEXT NOT NULL DEFAULT 'w9',
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      notes TEXT,
      uploaded_by VARCHAR NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await run("contractor_1099_summaries table", sql`CREATE TABLE IF NOT EXISTS contractor_1099_summaries (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL,
      worker_id VARCHAR NOT NULL,
      tax_year INTEGER NOT NULL,
      cash_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      trade_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_compensation NUMERIC(12,2) NOT NULL DEFAULT 0,
      meets_threshold BOOLEAN NOT NULL DEFAULT FALSE,
      threshold NUMERIC(12,2) NOT NULL DEFAULT 600,
      missing_w9 BOOLEAN NOT NULL DEFAULT TRUE,
      status TEXT NOT NULL DEFAULT 'draft',
      filed_at TIMESTAMP,
      notes TEXT,
      last_calculated_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("payroll_summaries table", sql`CREATE TABLE IF NOT EXISTS payroll_summaries (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      payroll_run_id VARCHAR NOT NULL REFERENCES payroll_runs(id),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      total_gross NUMERIC DEFAULT '0',
      total_deductions NUMERIC DEFAULT '0',
      total_net NUMERIC DEFAULT '0',
      total_employer_taxes NUMERIC DEFAULT '0',
      total_reimbursements NUMERIC DEFAULT '0',
      total_funding_required NUMERIC DEFAULT '0',
      ach_count INTEGER DEFAULT 0,
      ach_amount NUMERIC DEFAULT '0',
      check_count INTEGER DEFAULT 0,
      check_amount NUMERIC DEFAULT '0',
      cash_count INTEGER DEFAULT 0,
      cash_amount NUMERIC DEFAULT '0',
      trade_count INTEGER DEFAULT 0,
      trade_amount NUMERIC DEFAULT '0',
      other_count INTEGER DEFAULT 0,
      other_amount NUMERIC DEFAULT '0',
      worker_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("ach_batches table", sql`CREATE TABLE IF NOT EXISTS ach_batches (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      payroll_run_id VARCHAR NOT NULL REFERENCES payroll_runs(id),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      batch_id TEXT,
      status TEXT DEFAULT 'submitted',
      submitted_at TIMESTAMP,
      settled_at TIMESTAMP,
      settlement_status TEXT,
      batch_file TEXT,
      entry_count INTEGER DEFAULT 0,
      total_amount NUMERIC DEFAULT '0',
      failure_code TEXT,
      failure_reason TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("payroll_transaction_runs table", sql`CREATE TABLE IF NOT EXISTS payroll_transaction_runs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      payroll_run_id VARCHAR NOT NULL REFERENCES payroll_runs(id),
      payroll_item_id VARCHAR REFERENCES payroll_items(id),
      worker_id VARCHAR NOT NULL REFERENCES workers(id),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      payment_method TEXT DEFAULT 'check',
      net_pay NUMERIC DEFAULT '0',
      pay_date DATE,
      status TEXT DEFAULT 'approved',
      funding_account_id VARCHAR,
      check_number TEXT,
      ach_batch_id VARCHAR,
      failure_reason TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("payroll_runs.is_locked", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE`);
    await run("payroll_runs.funding_account_id", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS funding_account_id VARCHAR`);
    await run("payroll_runs.ach_batch_id", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS ach_batch_id VARCHAR`);
    await run("payroll_runs.payroll_summary_id", sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS payroll_summary_id VARCHAR`);

    await run("companies.grace_period_end", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS grace_period_end TIMESTAMP`);
    await run("companies.grace_period_days", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS grace_period_days INTEGER DEFAULT 14`);
    await run("companies.stripe_customer_id", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`);
    await run("companies.stripe_subscription_id", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`);
    await run("companies.timezone", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York'`);
    await run("companies.timezone_confirmed", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS timezone_confirmed BOOLEAN NOT NULL DEFAULT FALSE`);
    await run("companies.clock_in_grace_minutes", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS clock_in_grace_minutes INTEGER NOT NULL DEFAULT 10`);
    await run("companies.notify_mgr_on_violations", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS notify_mgr_on_violations BOOLEAN NOT NULL DEFAULT TRUE`);
    await run("clock_in_requests.manager_notes", sql`ALTER TABLE clock_in_requests ADD COLUMN IF NOT EXISTS manager_notes TEXT`);
    await run("clock_in_requests.corrected_time", sql`ALTER TABLE clock_in_requests ADD COLUMN IF NOT EXISTS corrected_time TIMESTAMPTZ`);

    await run("authorization_audit_log table", sql`
      CREATE TABLE IF NOT EXISTS authorization_audit_log (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_user_id VARCHAR NOT NULL,
        target_user_id VARCHAR,
        target_role_id VARCHAR,
        target_resource TEXT,
        change_type TEXT NOT NULL,
        before_value TEXT,
        after_value TEXT,
        note TEXT,
        company_id VARCHAR,
        tenant_id VARCHAR,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await run("authorization_audit_log.company_id", sql`ALTER TABLE authorization_audit_log ADD COLUMN IF NOT EXISTS company_id VARCHAR`);
    await run("authorization_audit_log.tenant_id", sql`ALTER TABLE authorization_audit_log ADD COLUMN IF NOT EXISTS tenant_id VARCHAR`);

    await run("agreement_templates table", sql`CREATE TABLE IF NOT EXISTS agreement_templates (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR REFERENCES companies(id) ON DELETE CASCADE,
      template_key TEXT NOT NULL,
      template_name TEXT NOT NULL,
      worker_type TEXT NOT NULL DEFAULT 'contractor',
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      html_body TEXT NOT NULL,
      plain_text_body TEXT,
      schema_json TEXT,
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("worker_agreements table", sql`CREATE TABLE IF NOT EXISTS worker_agreements (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      worker_id VARCHAR NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      onboarding_id VARCHAR,
      template_id VARCHAR REFERENCES agreement_templates(id),
      template_version INTEGER NOT NULL DEFAULT 1,
      rendered_html TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_signature',
      signature_provider TEXT DEFAULT 'internal',
      signed_at TIMESTAMP,
      signed_by_name TEXT,
      signed_by_worker_id VARCHAR,
      voided_at TIMESTAMP,
      void_reason TEXT,
      merge_data TEXT,
      sent_at TIMESTAMP,
      viewed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("worker_onboarding table", sql`CREATE TABLE IF NOT EXISTS worker_onboarding (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      worker_id VARCHAR NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      worker_type TEXT NOT NULL DEFAULT 'contractor',
      package_key TEXT NOT NULL DEFAULT 'contractor_standard',
      status TEXT NOT NULL DEFAULT 'draft',
      invite_token_hash TEXT,
      invite_expires_at TIMESTAMP,
      started_at TIMESTAMP,
      submitted_at TIMESTAMP,
      approved_at TIMESTAMP,
      approved_by VARCHAR,
      completion_percent INTEGER DEFAULT 0,
      current_step_key TEXT,
      manager_notes TEXT,
      manager_data TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("onboarding_steps table", sql`CREATE TABLE IF NOT EXISTS onboarding_steps (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      onboarding_id VARCHAR NOT NULL REFERENCES worker_onboarding(id) ON DELETE CASCADE,
      company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      worker_id VARCHAR NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      step_key TEXT NOT NULL,
      step_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      sequence INTEGER NOT NULL DEFAULT 0,
      required BOOLEAN DEFAULT TRUE,
      status TEXT NOT NULL DEFAULT 'not_started',
      assigned_to_role TEXT NOT NULL DEFAULT 'worker',
      depends_on_step_keys TEXT,
      data_json TEXT,
      review_notes TEXT,
      submitted_at TIMESTAMP,
      reviewed_at TIMESTAMP,
      reviewed_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("worker_onboarding_documents table", sql`CREATE TABLE IF NOT EXISTS worker_onboarding_documents (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      worker_id VARCHAR NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      onboarding_id VARCHAR NOT NULL REFERENCES worker_onboarding(id) ON DELETE CASCADE,
      step_id VARCHAR REFERENCES onboarding_steps(id),
      document_type TEXT NOT NULL,
      file_url TEXT,
      storage_key TEXT,
      mime_type TEXT,
      document_status TEXT NOT NULL DEFAULT 'uploaded',
      template_id VARCHAR,
      worker_agreement_id VARCHAR,
      signature_completed_at TIMESTAMP,
      reviewed_at TIMESTAMP,
      reviewed_by VARCHAR,
      metadata_json TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("onboarding_audit_log table", sql`CREATE TABLE IF NOT EXISTS onboarding_audit_log (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      worker_id VARCHAR NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      onboarding_id VARCHAR NOT NULL REFERENCES worker_onboarding(id) ON DELETE CASCADE,
      step_id VARCHAR,
      actor_user_id VARCHAR,
      actor_type TEXT NOT NULL DEFAULT 'system',
      event_type TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // Seed default contractor agreement template using parameterized insert
    await (async () => {
      const label = "agreement_templates seed default contractor";
      try {
        const existing = await db.execute(sql`SELECT 1 FROM agreement_templates WHERE template_key = 'contractor_standard_v1' LIMIT 1`);
        if (existing.rows.length === 0) {
          const htmlBody = `<div style="font-family: Georgia, serif; max-width: 800px; margin: 0 auto; padding: 40px; line-height: 1.7; color: #1a1a1a;">
<h1 style="text-align:center; font-size:1.3em; font-weight:bold; margin-bottom:8px;">INDEPENDENT CONTRACTOR AGREEMENT</h1>
<p style="text-align:center; margin-bottom:24px; font-size:0.9em; color:#555;">MyPayLink Platform — Contractor Agreement Template v1.0</p>
<p>This Independent Contractor Agreement ("Agreement") is made effective as of <strong>{{effective_date}}</strong> by and between <strong>{{company_name}}</strong> ("Company"), located at {{company_address_line1}}, {{company_city}}, {{company_state}} {{company_zip}}, and <strong>{{contractor_legal_name}}</strong> ("Independent Contractor"), located at {{contractor_address_line1}}, {{contractor_city}}, {{contractor_state}} {{contractor_zip}}.</p>
<h2 style="font-size:1em; margin-top:24px; border-bottom:1px solid #ccc; padding-bottom:4px;">RECITALS</h2>
<p>The Company desires to engage Contractor to perform the services described in this Agreement. Contractor represents that Contractor is operating as an independent contractor and has complied with all applicable laws relating to business permits, licenses, registrations, tax reporting, and other legal requirements.</p>
<p>Tax ID Type: <strong>{{contractor_tax_id_type}}</strong><br/>Tax ID: <strong>{{contractor_tax_id_masked}}</strong></p>
<h2 style="font-size:1em; margin-top:24px; border-bottom:1px solid #ccc; padding-bottom:4px;">1. INDEPENDENT CONTRACTOR STATUS</h2>
<p>The parties intend that Contractor shall remain an independent contractor and not an employee of Company for any purpose, including federal and state tax purposes, unemployment insurance, workers compensation, employee benefits, or any other employment-related law or program.</p>
<h2 style="font-size:1em; margin-top:24px; border-bottom:1px solid #ccc; padding-bottom:4px;">2. SCOPE OF WORK</h2>
<p>Project / Role: <strong>{{project_name}}</strong><br/>Department / Team: <strong>{{department_name}}</strong><br/>Manager / Contact: <strong>{{manager_name}}</strong><br/>Work Location: {{work_location}}</p>
<p><strong>Scope Summary:</strong><br/>{{scope_of_work_summary}}</p>
<p><strong>Detailed Scope:</strong><br/>{{scope_of_work_details}}</p>
<p>Target Completion Date: {{completion_target_date}}</p>
<h2 style="font-size:1em; margin-top:24px; border-bottom:1px solid #ccc; padding-bottom:4px;">3. COMPENSATION</h2>
<p>Compensation Model: <strong>{{compensation_model}}</strong></p>
<ul><li>Hourly Rate: {{hourly_rate}}</li><li>Special Event Rate: {{special_event_rate}}</li><li>Fixed Project Amount: {{fixed_project_amount}}</li></ul>
<p>Payment Schedule: {{payment_schedule}}<br/>Submission Window: {{submission_window}}<br/>Pay Cycle: {{pay_cycle_description}}</p>
<p>All time tracking, invoicing, and payment processing must be conducted through <strong>{{platform_name}}</strong> at <strong>{{platform_url}}</strong>. Use of the platform is a condition of payment.</p>
<h2 style="font-size:1em; margin-top:24px; border-bottom:1px solid #ccc; padding-bottom:4px;">4. TAX DOCUMENTATION AND WITHHOLDING</h2>
<p>Contractor is responsible for all tax filings, self-employment taxes, and related reporting obligations. Contractor agrees to complete Form W-9 and any other required tax documentation. Company may issue Form 1099-NEC as applicable.</p>
<h2 style="font-size:1em; margin-top:24px; border-bottom:1px solid #ccc; padding-bottom:4px;">5. BENEFITS WAIVER</h2>
<p>Contractor is not eligible for employee benefits including health insurance, retirement benefits, paid time off, or any other employee benefit programs.</p>
<h2 style="font-size:1em; margin-top:24px; border-bottom:1px solid #ccc; padding-bottom:4px;">6. CONFIDENTIALITY AND PROPRIETARY INFORMATION</h2>
<p>Contractor shall not use or disclose Company confidential or proprietary information except as necessary to perform services under this Agreement. All work product created within the scope of this engagement shall be owned exclusively by Company unless otherwise stated in writing.</p>
<h2 style="font-size:1em; margin-top:24px; border-bottom:1px solid #ccc; padding-bottom:4px;">7. NON-SOLICITATION</h2>
<p>During the term and for {{non_solicit_months}} months after termination, Contractor shall not directly solicit Company customers with whom Contractor had material business contact through this engagement.</p>
<h2 style="font-size:1em; margin-top:24px; border-bottom:1px solid #ccc; padding-bottom:4px;">8. TERM AND TERMINATION</h2>
<p>This Agreement begins on <strong>{{start_date}}</strong> and continues until <strong>{{end_date}}</strong> unless earlier terminated. Either party may terminate for material breach not cured within {{cure_period_days}} days after written notice.</p>
<h2 style="font-size:1em; margin-top:24px; border-bottom:1px solid #ccc; padding-bottom:4px;">9. GOVERNING LAW</h2>
<p>This Agreement shall be governed by the laws of <strong>{{governing_state}}</strong>. Venue for any permitted court proceeding shall be in {{governing_county}} County, {{governing_state}}.</p>
<h2 style="font-size:1em; margin-top:24px; border-bottom:1px solid #ccc; padding-bottom:4px;">10. ELECTRONIC SIGNATURES</h2>
<p>The parties agree that electronic signatures and electronic records shall have the same force and effect as original signatures.</p>
<div style="margin-top:48px; display:flex; gap:60px;">
<div style="flex:1; border-top:1px solid #333; padding-top:12px;"><strong>COMPANY</strong><br/>{{company_signatory_name}}<br/>{{company_signatory_title}}<br/>Date: {{company_signature_date}}</div>
<div style="flex:1; border-top:1px solid #333; padding-top:12px;"><strong>CONTRACTOR</strong><br/>{{contractor_signature_name}}<br/>Date: {{contractor_signature_date}}<br/><em style="font-size:0.8em; color:#666;">Audit Ref: {{esign_audit_id}}</em></div>
</div></div>`;
          await db.execute(sql`
            INSERT INTO agreement_templates (template_key, template_name, worker_type, version, status, is_default, html_body)
            VALUES ('contractor_standard_v1', 'Independent Contractor Agreement', 'contractor', 1, 'active', TRUE, ${htmlBody})
          `);
          console.log(`Auto-migration OK: ${label}`);
        } else {
          console.log(`Auto-migration OK: ${label} (already exists)`);
        }
      } catch (e: any) {
        console.warn(`Auto-migration skipped (${label}): ${e.message}`);
      }
    })();

    await run("system_documents seed payroll rules", sql`
      INSERT INTO system_documents (title, version, category, file_url, description, effective_date, change_log, is_active)
      SELECT
        'MyPayLink Payroll Processing Rules',
        'v1.0',
        'Payroll',
        '/docs/paylink/payroll/MyPayLink_Payroll_Processing_Rules_v1.0.docx',
        'Official payroll processing rules, data integrity requirements, and system behaviors. Covers pay period calculation, YTD logic, duplicate prevention, reimbursement handling, and check/stub requirements.',
        '2026-04-02',
        'v1.0 (2026-04-02): Initial release. Covers payroll period schedule, run workflow, amendment rules, expense/reimbursement deduplication, duplicate-run prevention, YTD snapshot rules, and check/stub display requirements.',
        TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM system_documents WHERE title = 'MyPayLink Payroll Processing Rules' AND version = 'v1.0'
      )
    `);

    // ── Phase 1: Payroll Correctness ──────────────────────────────────────
    await run("pay_stub_amendments.applied_payroll_run_id", sql`ALTER TABLE pay_stub_amendments ADD COLUMN IF NOT EXISTS applied_payroll_run_id VARCHAR`);
    await run("pay_stub_amendments.applied_at", sql`ALTER TABLE pay_stub_amendments ADD COLUMN IF NOT EXISTS applied_at TIMESTAMP`);
    await run("pay_stub_amendments.end_date", sql`ALTER TABLE pay_stub_amendments ADD COLUMN IF NOT EXISTS end_date DATE`);
    await run("pay_stub_amendments.is_recurring", sql`ALTER TABLE pay_stub_amendments ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE`);

    // ── Phase 2: Source-of-truth wiring ──────────────────────────────────
    await run("taxes_deductions.remittance_agency_id", sql`ALTER TABLE taxes_deductions ADD COLUMN IF NOT EXISTS remittance_agency_id VARCHAR`);
    await run("taxes_deductions.effective_date", sql`ALTER TABLE taxes_deductions ADD COLUMN IF NOT EXISTS effective_date DATE`);
    await run("taxes_deductions.expiry_date", sql`ALTER TABLE taxes_deductions ADD COLUMN IF NOT EXISTS expiry_date DATE`);
    await run("funding_accounts.remittance_source_id", sql`ALTER TABLE funding_accounts ADD COLUMN IF NOT EXISTS remittance_source_id VARCHAR`);
    await run("funding_accounts.is_default", sql`ALTER TABLE funding_accounts ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE`);

    // ── Phase 3: Tax Filing Snapshots ─────────────────────────────────────
    await run("tax_filing_snapshots table", sql`CREATE TABLE IF NOT EXISTS tax_filing_snapshots (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      legal_entity_id VARCHAR,
      tax_year INTEGER NOT NULL,
      tax_period TEXT,
      form_type TEXT NOT NULL,
      period_start DATE,
      period_end DATE,
      status TEXT DEFAULT 'draft',
      generated_data_json TEXT,
      generated_at TIMESTAMP,
      generated_by_user_id VARCHAR,
      reviewed_at TIMESTAMP,
      reviewed_by_user_id VARCHAR,
      approved_at TIMESTAMP,
      approved_by_user_id VARCHAR,
      filed_at TIMESTAMP,
      filed_by_user_id VARCHAR,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── Unified Billing Documents Module ──────────────────────────────────────
    await run("company_branding table", sql`CREATE TABLE IF NOT EXISTS company_branding (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      logo_path TEXT,
      logo_url TEXT,
      legal_name TEXT,
      dba_name TEXT,
      billing_address TEXT,
      billing_city TEXT,
      billing_state TEXT,
      billing_zip TEXT,
      billing_country TEXT DEFAULT 'US',
      phone TEXT,
      email TEXT,
      website TEXT,
      tax_id TEXT,
      accent_color TEXT DEFAULT '#0d9488',
      footer_text TEXT,
      default_payment_instructions TEXT,
      default_invoice_terms TEXT DEFAULT 'Payment due within 30 days.',
      default_proposal_terms TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("biz_document_templates table", sql`CREATE TABLE IF NOT EXISTS biz_document_templates (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR REFERENCES companies(id),
      document_type TEXT NOT NULL DEFAULT 'invoice',
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      is_system BOOLEAN DEFAULT TRUE,
      is_active BOOLEAN DEFAULT TRUE,
      preview_color TEXT DEFAULT '#0d9488',
      config TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("biz_documents table", sql`CREATE TABLE IF NOT EXISTS biz_documents (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      document_type TEXT NOT NULL DEFAULT 'invoice',
      document_number TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by_user_id VARCHAR REFERENCES users(id),
      owner_entity_type TEXT DEFAULT 'company',
      owner_entity_id VARCHAR,
      submitted_by_user_id VARCHAR REFERENCES users(id),
      assigned_to_entity_type TEXT,
      assigned_to_entity_id VARCHAR,
      assigned_to_name TEXT,
      assigned_to_email TEXT,
      template_id VARCHAR REFERENCES biz_document_templates(id),
      template_slug TEXT DEFAULT 'modern_clean',
      issue_date DATE,
      due_date DATE,
      expiration_date DATE,
      service_period_start DATE,
      service_period_end DATE,
      subtotal NUMERIC DEFAULT 0,
      tax_rate NUMERIC DEFAULT 0,
      tax_total NUMERIC DEFAULT 0,
      discount_total NUMERIC DEFAULT 0,
      total NUMERIC DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      po_number TEXT,
      internal_reference TEXT,
      title TEXT,
      notes TEXT,
      terms TEXT,
      payment_instructions TEXT,
      reviewed_by_user_id VARCHAR REFERENCES users(id),
      reviewed_at TIMESTAMP,
      rejection_reason TEXT,
      revision_notes TEXT,
      paid_at TIMESTAMP,
      paid_amount NUMERIC,
      payment_reference TEXT,
      converted_from_id VARCHAR,
      converted_to_id VARCHAR,
      metadata TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("biz_document_items table", sql`CREATE TABLE IF NOT EXISTS biz_document_items (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id VARCHAR NOT NULL REFERENCES biz_documents(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      quantity NUMERIC DEFAULT 1,
      unit_price NUMERIC DEFAULT 0,
      amount NUMERIC DEFAULT 0,
      taxable BOOLEAN DEFAULT TRUE,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("biz_document_attachments table", sql`CREATE TABLE IF NOT EXISTS biz_document_attachments (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id VARCHAR NOT NULL REFERENCES biz_documents(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      file_name TEXT,
      file_type TEXT,
      file_size INTEGER,
      uploaded_by_user_id VARCHAR REFERENCES users(id),
      uploaded_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("biz_document_history table", sql`CREATE TABLE IF NOT EXISTS biz_document_history (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id VARCHAR NOT NULL REFERENCES biz_documents(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by_user_id VARCHAR REFERENCES users(id),
      changed_by_name TEXT,
      changed_at TIMESTAMP DEFAULT NOW(),
      note TEXT
    )`);
    await run("contractor_proposals table", sql`CREATE TABLE IF NOT EXISTS contractor_proposals (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR REFERENCES companies(id),
      contractor_id VARCHAR NOT NULL REFERENCES workers(id),
      proposal_number TEXT,
      title TEXT,
      description TEXT,
      issue_date TEXT NOT NULL,
      expiration_date TEXT,
      amount NUMERIC,
      tax_amount NUMERIC,
      line_items TEXT,
      notes TEXT,
      terms TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      submitted_at TIMESTAMP,
      reviewed_by_user_id VARCHAR,
      reviewed_at TIMESTAMP,
      rejection_reason TEXT,
      converted_to_invoice_id VARCHAR,
      job_id VARCHAR,
      cost_center_id VARCHAR,
      currency TEXT DEFAULT 'USD',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("notification_templates table", sql`CREATE TABLE IF NOT EXISTS notification_templates (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(100) NOT NULL UNIQUE,
      label VARCHAR(200) NOT NULL,
      description TEXT,
      email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      sms_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      email_subject VARCHAR(300) NOT NULL,
      email_body TEXT NOT NULL,
      sms_body TEXT NOT NULL,
      variables JSONB DEFAULT '[]',
      updated_at TIMESTAMP DEFAULT NOW(),
      updated_by VARCHAR(100)
    )`);

    // Seed default notification templates
    try {
      const tmplCount = await db.execute(sql`SELECT COUNT(*) as c FROM notification_templates`);
      const c = Number((tmplCount.rows[0] as any)?.c ?? 0);
      if (c === 0) {
        await db.execute(sql`INSERT INTO notification_templates (event_type, label, description, email_subject, email_body, sms_body, variables) VALUES
          ('schedule_published', 'Schedule Published', 'Sent when a manager publishes an employee schedule',
           'Your schedule has been posted — {{company}}',
           'Hi {{name}},

Your schedule has been published by {{company}}.

Your upcoming shifts:
{{shifts}}

View your full schedule online:
{{url}}

Thank you,
{{company}}',
           'Hi {{name}}, your schedule at {{company}} has been posted. Next shift: {{next_shift}}. View: {{url}}',
           '["{{name}}", "{{company}}", "{{shifts}}", "{{next_shift}}", "{{url}}"]'),
          ('approval_reminder', 'Approval Reminder', 'Sent to managers with pending items awaiting approval',
           'Action Required: Items pending your approval — {{company}}',
           'Hi {{name}},

You have items pending your approval at {{company}}:

{{items}}

Please review and approve or reject these items before payroll is processed.

View pending items: {{url}}

Thank you,
{{company}} via PayLink',
           'PayLink Reminder: {{name}}, you have pending approvals at {{company}}: {{items}}. Please review before payroll runs. {{url}}',
           '["{{name}}", "{{company}}", "{{items}}", "{{url}}"]'),
          ('shift_offer_available', 'Shift Available (Marketplace)', 'Sent when a new shift is posted to the shift marketplace',
           'New shift available — {{company}}',
           'Hi {{name}},

A new shift is available at {{company}}:

{{content}}

Log in to claim this shift before it is taken.

{{url}}

Thank you,
{{company}}',
           '{{name}}: New shift at {{company}} - {{content}}. Claim it: {{url}}',
           '["{{name}}", "{{company}}", "{{content}}", "{{url}}"]'),
          ('shift_offer_accepted', 'Shift Request Accepted', 'Sent when a shift swap/pickup request is approved',
           'Your shift request has been approved — {{company}}',
           'Hi {{name}},

Great news! Your shift request at {{company}} has been approved.

{{content}}

{{url}}

Thank you,
{{company}}',
           '{{name}}: Your shift request at {{company}} was APPROVED. {{content}}',
           '["{{name}}", "{{company}}", "{{content}}", "{{url}}"]'),
          ('shift_offer_rejected', 'Shift Request Rejected', 'Sent when a shift swap/pickup request is declined',
           'Your shift request was not approved — {{company}}',
           'Hi {{name}},

Your shift request at {{company}} was not approved at this time.

{{content}}

If you have questions, please contact your manager.

Thank you,
{{company}}',
           '{{name}}: Your shift request at {{company}} was not approved. {{content}}',
           '["{{name}}", "{{company}}", "{{content}}", "{{url}}"]')
        `);
        console.log("Auto-migration OK: notification_templates seed (5 default templates)");
      } else {
        console.log("Auto-migration OK: notification_templates seed (already exists)");
      }
    } catch (e: any) {
      console.log("Auto-migration skipped (notification_templates seed):", e.message);
    }

    await run("clock_in_requests table", sql`CREATE TABLE IF NOT EXISTS clock_in_requests (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      worker_id VARCHAR NOT NULL REFERENCES workers(id),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      request_type TEXT NOT NULL,
      requested_at TIMESTAMP DEFAULT NOW(),
      minutes_diff INTEGER,
      schedule_id VARCHAR,
      scheduled_start TIMESTAMP,
      scheduled_end TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'pending',
      approved_by VARCHAR,
      approved_at TIMESTAMP,
      denial_reason TEXT,
      time_punch_id VARCHAR
    )`);

    await run("inventory_items table", sql`CREATE TABLE IF NOT EXISTS inventory_items (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      quantity NUMERIC NOT NULL DEFAULT 0,
      unit TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // Seed 6 system document templates (3 invoice, 3 proposal)
    try {
      const templateCount = await db.execute(sql`SELECT COUNT(*) as c FROM biz_document_templates WHERE is_system = TRUE`);
      const count = Number((templateCount.rows[0] as any)?.c ?? 0);
      if (count === 0) {
        await db.execute(sql`INSERT INTO biz_document_templates (id, document_type, name, slug, description, is_system, is_active, preview_color) VALUES
          (gen_random_uuid(), 'invoice', 'Modern Clean', 'modern_clean', 'Clean, minimal layout with teal accent', TRUE, TRUE, '#0d9488'),
          (gen_random_uuid(), 'invoice', 'Classic Business', 'classic_business', 'Traditional professional invoice layout', TRUE, TRUE, '#1e40af'),
          (gen_random_uuid(), 'invoice', 'Compact Summary', 'compact_summary', 'Dense, compact layout for service summaries', TRUE, TRUE, '#7c3aed'),
          (gen_random_uuid(), 'proposal', 'Proposal Pro', 'proposal_pro', 'Professional proposal with cover section', TRUE, TRUE, '#0d9488'),
          (gen_random_uuid(), 'proposal', 'Statement of Work', 'statement_of_work', 'Detailed SOW-style proposal layout', TRUE, TRUE, '#059669'),
          (gen_random_uuid(), 'proposal', 'Quick Quote', 'quick_quote', 'Brief quote / estimate format', TRUE, TRUE, '#d97706')
        `);
        console.log("Auto-migration OK: biz_document_templates seed (6 system templates)");
      } else {
        console.log("Auto-migration OK: biz_document_templates seed (already exists)");
      }
    } catch (e: any) {
      console.log("Auto-migration skipped (biz_document_templates seed):", e.message);
    }

    await run("check_print_audit_logs table", sql`CREATE TABLE IF NOT EXISTS check_print_audit_logs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      payroll_run_id VARCHAR REFERENCES payroll_runs(id),
      company_id VARCHAR REFERENCES companies(id),
      initiated_by_user_id VARCHAR REFERENCES users(id),
      check_count INTEGER DEFAULT 0,
      total_amount NUMERIC,
      funding_account_id VARCHAR,
      micr_validation TEXT,
      validation_errors JSONB DEFAULT '[]',
      print_blocked BOOLEAN DEFAULT FALSE,
      template_id VARCHAR,
      render_engine TEXT DEFAULT 'browser-print',
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await run("check_print_audit_logs.event_type", sql`ALTER TABLE check_print_audit_logs ADD COLUMN IF NOT EXISTS event_type TEXT DEFAULT 'print'`);
    await run("check_print_audit_logs.worker_id", sql`ALTER TABLE check_print_audit_logs ADD COLUMN IF NOT EXISTS worker_id VARCHAR`);
    await run("check_print_audit_logs.check_number", sql`ALTER TABLE check_print_audit_logs ADD COLUMN IF NOT EXISTS check_number TEXT`);
    await run("check_print_audit_logs.notes", sql`ALTER TABLE check_print_audit_logs ADD COLUMN IF NOT EXISTS notes TEXT`);
    await run("remittance_sources.calibration_config", sql`ALTER TABLE remittance_sources ADD COLUMN IF NOT EXISTS calibration_config JSONB`);

    // ── Enhanced Contractor Proposals columns ─────────────────────────────────
    await run("contractor_proposals.scope_of_work", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS scope_of_work TEXT`);
    await run("contractor_proposals.assumptions", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS assumptions TEXT`);
    await run("contractor_proposals.exclusions", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS exclusions TEXT`);
    await run("contractor_proposals.allowances", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS allowances TEXT`);
    await run("contractor_proposals.materials", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS materials TEXT`);
    await run("contractor_proposals.warranty_notes", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS warranty_notes TEXT`);
    await run("contractor_proposals.schedule_notes", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS schedule_notes TEXT`);
    await run("contractor_proposals.internal_notes", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS internal_notes TEXT`);
    await run("contractor_proposals.client_message", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS client_message TEXT`);
    await run("contractor_proposals.estimator_name", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS estimator_name TEXT`);
    await run("contractor_proposals.version", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1`);
    await run("contractor_proposals.revision_of_id", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS revision_of_id VARCHAR`);
    await run("contractor_proposals.parent_proposal_id", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS parent_proposal_id VARCHAR`);
    await run("contractor_proposals.is_change_order", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS is_change_order BOOLEAN DEFAULT FALSE`);
    await run("contractor_proposals.sent_at", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP`);
    await run("contractor_proposals.viewed_at", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMP`);
    await run("contractor_proposals.declined_at", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS declined_at TIMESTAMP`);
    await run("contractor_proposals.subtotal", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS subtotal NUMERIC`);
    await run("contractor_proposals.discount_amount", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS discount_amount NUMERIC`);
    await run("contractor_proposals.payment_terms", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS payment_terms TEXT`);
    await run("contractor_proposals.change_order_terms", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS change_order_terms TEXT`);
    await run("contractor_proposals.approval_name", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS approval_name TEXT`);
    await run("contractor_proposals.approval_email", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS approval_email TEXT`);
    await run("contractor_proposals.approval_at", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS approval_at TIMESTAMP`);
    await run("contractor_proposals.approval_ip", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS approval_ip TEXT`);
    await run("contractor_proposals.approval_method", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS approval_method TEXT`);
    await run("contractor_proposals.approval_notes", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS approval_notes TEXT`);
    await run("contractor_proposals.ai_generated_summary", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS ai_generated_summary TEXT`);

    // ── Contractor Invoices new columns ────────────────────────────────────────
    await run("contractor_invoices.title", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS title TEXT`);
    await run("contractor_invoices.invoice_type", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS invoice_type TEXT DEFAULT 'standard'`);
    await run("contractor_invoices.discount_amount", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS discount_amount NUMERIC`);
    await run("contractor_invoices.amount_paid", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS amount_paid NUMERIC DEFAULT 0`);
    await run("contractor_invoices.balance_due", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS balance_due NUMERIC`);
    await run("contractor_invoices.reminder_enabled", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN DEFAULT TRUE`);
    await run("contractor_invoices.last_reminder_sent_at", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMP`);
    await run("contractor_invoices.next_reminder_at", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS next_reminder_at TIMESTAMP`);

    // ── Proposal Line Items ────────────────────────────────────────────────────
    await run("proposal_line_items table", sql`CREATE TABLE IF NOT EXISTS proposal_line_items (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      proposal_id VARCHAR NOT NULL,
      sort_order INTEGER DEFAULT 0,
      category TEXT,
      name TEXT NOT NULL,
      description TEXT,
      quantity NUMERIC DEFAULT 1,
      unit TEXT,
      unit_price NUMERIC DEFAULT 0,
      cost NUMERIC,
      markup_percent NUMERIC,
      taxable BOOLEAN DEFAULT FALSE,
      optional BOOLEAN DEFAULT FALSE,
      selected BOOLEAN DEFAULT TRUE,
      line_total NUMERIC DEFAULT 0,
      ai_generated BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── Proposal Attachments ──────────────────────────────────────────────────
    await run("proposal_attachments table", sql`CREATE TABLE IF NOT EXISTS proposal_attachments (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      proposal_id VARCHAR NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT,
      file_type TEXT,
      file_size INTEGER,
      attachment_type TEXT DEFAULT 'supporting_doc',
      ai_summary TEXT,
      uploaded_by_worker_id VARCHAR,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── Proposal Approval Events ──────────────────────────────────────────────
    await run("proposal_approval_events table", sql`CREATE TABLE IF NOT EXISTS proposal_approval_events (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      proposal_id VARCHAR NOT NULL,
      event_type TEXT NOT NULL,
      old_status TEXT,
      new_status TEXT,
      actor_user_id VARCHAR,
      actor_name TEXT,
      actor_email TEXT,
      notes TEXT,
      ip_address TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── Contractor Payments ──────────────────────────────────────────────────
    await run("contractor_payments table", sql`CREATE TABLE IF NOT EXISTS contractor_payments (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id VARCHAR NOT NULL,
      company_id VARCHAR,
      contractor_id VARCHAR,
      amount NUMERIC NOT NULL,
      payment_method TEXT,
      payment_provider TEXT,
      external_payment_id TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      paid_at TIMESTAMP DEFAULT NOW(),
      reference_number TEXT,
      notes TEXT,
      recorded_by_user_id VARCHAR,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── Contractor Reminder Logs ──────────────────────────────────────────────
    await run("contractor_reminder_logs table", sql`CREATE TABLE IF NOT EXISTS contractor_reminder_logs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type TEXT NOT NULL,
      entity_id VARCHAR NOT NULL,
      channel TEXT NOT NULL,
      recipient TEXT,
      template_key TEXT,
      subject TEXT,
      body TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      sent_at TIMESTAMP DEFAULT NOW(),
      error_message TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── contractor_proposals extended columns ──────────────────────────────────
    await run("contractor_proposals.work_type", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS work_type TEXT`);
    await run("contractor_proposals.estimated_hours", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC`);
    await run("contractor_proposals.estimated_labor_budget", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS estimated_labor_budget NUMERIC`);
    await run("contractor_proposals.payment_type", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'monetary'`);
    await run("contractor_proposals.trade_offered", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS trade_offered TEXT`);
    await run("contractor_proposals.trade_value", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS trade_value NUMERIC`);
    await run("contractor_proposals.trade_terms", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS trade_terms TEXT`);
    await run("contractor_proposals.template_id", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS template_id VARCHAR`);
    await run("contractor_proposals.branding_id", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS branding_id VARCHAR`);
    await run("contractor_proposals.cost_center", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS cost_center TEXT`);
    await run("contractor_proposals.project_class", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS project_class TEXT`);
    await run("contractor_proposals.labor_materials_split", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS labor_materials_split TEXT`);
    await run("contractor_proposals.urgency", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS urgency TEXT DEFAULT 'normal'`);
    await run("contractor_proposals.site_notes", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS site_notes TEXT`);
    await run("contractor_proposals.client_requirements", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS client_requirements TEXT`);
    await run("contractor_proposals.estimated_start_date", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS estimated_start_date TEXT`);
    await run("contractor_proposals.estimated_end_date", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS estimated_end_date TEXT`);
    await run("contractor_proposals.trade_category", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS trade_category TEXT`);

    // ── contractor_proposals.converted_to_contract_id ────────────────────────
    await run("contractor_proposals.converted_to_contract_id", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS converted_to_contract_id VARCHAR`);

    // ── proposal_negotiations extended counter fields ─────────────────────────
    await run("proposal_negotiations.proposed_hours", sql`ALTER TABLE proposal_negotiations ADD COLUMN IF NOT EXISTS proposed_hours NUMERIC`);
    await run("proposal_negotiations.proposed_trade_terms", sql`ALTER TABLE proposal_negotiations ADD COLUMN IF NOT EXISTS proposed_trade_terms TEXT`);

    // ── contractor_invoices extended columns ──────────────────────────────────
    await run("contractor_invoices.contract_id", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS contract_id VARCHAR`);
    await run("contractor_invoices.approved_budget", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS approved_budget NUMERIC`);
    await run("contractor_invoices.approved_hours", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS approved_hours NUMERIC`);
    await run("contractor_invoices.approved_terms", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS approved_terms TEXT`);
    await run("contractor_invoices.trade_component", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS trade_component TEXT`);
    await run("contractor_invoices.override_requested", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS override_requested BOOLEAN DEFAULT FALSE`);
    await run("contractor_invoices.override_reason", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS override_reason TEXT`);
    await run("contractor_invoices.override_amount", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS override_amount NUMERIC`);
    await run("contractor_invoices.override_requested_at", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS override_requested_at TIMESTAMP`);
    await run("contractor_invoices.override_approved", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS override_approved BOOLEAN`);
    await run("contractor_invoices.override_approved_by", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS override_approved_by VARCHAR`);

    // ── proposal_versions table ───────────────────────────────────────────────
    await run("proposal_versions table", sql`CREATE TABLE IF NOT EXISTS proposal_versions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      proposal_id VARCHAR NOT NULL,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      change_notes TEXT,
      created_by_user_id VARCHAR,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── proposal_negotiations table ───────────────────────────────────────────
    await run("proposal_negotiations table", sql`CREATE TABLE IF NOT EXISTS proposal_negotiations (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      proposal_id VARCHAR NOT NULL,
      initiated_by_worker_id VARCHAR,
      initiated_by_user_id VARCHAR,
      direction TEXT NOT NULL DEFAULT 'company_to_contractor',
      status TEXT NOT NULL DEFAULT 'pending',
      proposed_amount NUMERIC,
      proposed_terms TEXT,
      counter_notes TEXT,
      responded_at TIMESTAMP,
      responded_by_user_id VARCHAR,
      response_notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── contractor_contracts table ────────────────────────────────────────────
    await run("contractor_contracts table", sql`CREATE TABLE IF NOT EXISTS contractor_contracts (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR REFERENCES companies(id),
      contractor_id VARCHAR NOT NULL REFERENCES workers(id),
      proposal_id VARCHAR,
      contract_number TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      contract_type TEXT DEFAULT 'service',
      start_date TEXT,
      end_date TEXT,
      total_value NUMERIC,
      currency TEXT DEFAULT 'USD',
      payment_type TEXT DEFAULT 'monetary',
      trade_details TEXT,
      trade_value NUMERIC,
      payment_terms TEXT,
      scope_of_work TEXT,
      special_terms TEXT,
      governing_law TEXT,
      confidentiality BOOLEAN DEFAULT FALSE,
      non_compete BOOLEAN DEFAULT FALSE,
      body_html TEXT,
      body_markdown TEXT,
      signed_pdf_path TEXT,
      template_id VARCHAR,
      sent_at TIMESTAMP,
      fully_signed_at TIMESTAMP,
      voided_at TIMESTAMP,
      void_reason TEXT,
      created_by_user_id VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── contract_signers table ────────────────────────────────────────────────
    await run("contract_signers table", sql`CREATE TABLE IF NOT EXISTS contract_signers (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id VARCHAR NOT NULL,
      signer_type TEXT NOT NULL DEFAULT 'worker',
      worker_id VARCHAR,
      user_id VARCHAR,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT DEFAULT 'contractor',
      "order" INTEGER DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      signed_at TIMESTAMP,
      signature_data TEXT,
      ip_address TEXT,
      reminder_sent_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── contract_versions table ───────────────────────────────────────────────
    await run("contract_versions table", sql`CREATE TABLE IF NOT EXISTS contract_versions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id VARCHAR NOT NULL,
      version INTEGER NOT NULL,
      snapshot_html TEXT,
      snapshot_json TEXT,
      pdf_path TEXT,
      reason TEXT,
      created_by_user_id VARCHAR,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── dam_documents table ───────────────────────────────────────────────────
    await run("dam_documents table", sql`CREATE TABLE IF NOT EXISTS dam_documents (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR,
      worker_id VARCHAR,
      owner_type TEXT NOT NULL DEFAULT 'worker',
      document_type TEXT NOT NULL DEFAULT 'general',
      title TEXT NOT NULL,
      description TEXT,
      file_path TEXT NOT NULL,
      file_name TEXT,
      file_type TEXT,
      file_size INTEGER,
      mime_type TEXT,
      tags TEXT,
      is_archived BOOLEAN DEFAULT FALSE,
      is_public BOOLEAN DEFAULT FALSE,
      expires_at TIMESTAMP,
      linked_entity_type TEXT,
      linked_entity_id VARCHAR,
      uploaded_by_user_id VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── dam_document_access_logs table ────────────────────────────────────────
    await run("dam_document_access_logs table", sql`CREATE TABLE IF NOT EXISTS dam_document_access_logs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id VARCHAR NOT NULL,
      accessed_by_user_id VARCHAR,
      accessed_by_worker_id VARCHAR,
      action TEXT NOT NULL DEFAULT 'view',
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── contractor_templates table ────────────────────────────────────────────
    await run("contractor_templates table", sql`CREATE TABLE IF NOT EXISTS contractor_templates (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR,
      template_type TEXT NOT NULL DEFAULT 'proposal',
      name TEXT NOT NULL,
      description TEXT,
      industry TEXT,
      body_json TEXT,
      default_payment_terms TEXT,
      default_scope_template TEXT,
      default_assumptions TEXT,
      default_exclusions TEXT,
      default_warranty TEXT,
      is_global BOOLEAN DEFAULT FALSE,
      is_active BOOLEAN DEFAULT TRUE,
      usage_count INTEGER DEFAULT 0,
      created_by_user_id VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── contractor_branding table ─────────────────────────────────────────────
    await run("contractor_branding table", sql`CREATE TABLE IF NOT EXISTS contractor_branding (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      worker_id VARCHAR NOT NULL UNIQUE,
      business_name TEXT,
      tagline TEXT,
      logo_path TEXT,
      primary_color TEXT DEFAULT '#0f766e',
      secondary_color TEXT DEFAULT '#64748b',
      font_family TEXT DEFAULT 'Inter',
      cover_note TEXT,
      signature_text TEXT,
      website_url TEXT,
      license_number TEXT,
      insurance_info TEXT,
      footer_text TEXT,
      show_logo BOOLEAN DEFAULT TRUE,
      show_license_number BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── contractor_notifications table ────────────────────────────────────────
    await run("contractor_notifications table", sql`CREATE TABLE IF NOT EXISTS contractor_notifications (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      worker_id VARCHAR,
      user_id VARCHAR,
      company_id VARCHAR,
      notification_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      entity_type TEXT,
      entity_id VARCHAR,
      is_read BOOLEAN DEFAULT FALSE,
      read_at TIMESTAMP,
      action_url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── contractor_reminders table ────────────────────────────────────────────
    await run("contractor_reminders table", sql`CREATE TABLE IF NOT EXISTS contractor_reminders (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      worker_id VARCHAR,
      user_id VARCHAR,
      company_id VARCHAR,
      entity_type TEXT NOT NULL,
      entity_id VARCHAR,
      reminder_type TEXT NOT NULL DEFAULT 'follow_up',
      title TEXT NOT NULL,
      notes TEXT,
      scheduled_at TIMESTAMP NOT NULL,
      channel TEXT DEFAULT 'in_app',
      status TEXT NOT NULL DEFAULT 'pending',
      sent_at TIMESTAMP,
      dismissed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── Tenant enforcement columns ─────────────────────────────────────────────
    await run("companies.agreement_signed_at", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS agreement_signed_at TIMESTAMP`);
    await run("companies.agreement_signed_by_user_id", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS agreement_signed_by_user_id VARCHAR`);
    await run("companies.gate_override_reason", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS gate_override_reason TEXT`);

    // ── Stripe Treasury columns ────────────────────────────────────────────────
    await run("companies.stripe_financial_account_id", sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_financial_account_id TEXT`);
    await run("pay_methods.stripe_bank_account_id", sql`ALTER TABLE pay_methods ADD COLUMN IF NOT EXISTS stripe_bank_account_id TEXT`);
    await run("treasury_outbound_payments table", sql`CREATE TABLE IF NOT EXISTS treasury_outbound_payments (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      payroll_run_id VARCHAR REFERENCES payroll_runs(id),
      worker_id VARCHAR REFERENCES workers(id),
      stripe_outbound_payment_id TEXT UNIQUE,
      stripe_financial_account_id TEXT,
      amount INTEGER NOT NULL,
      currency TEXT DEFAULT 'usd',
      status TEXT NOT NULL DEFAULT 'pending',
      recipient_name TEXT,
      routing_number TEXT,
      account_number TEXT,
      memo TEXT,
      error_message TEXT,
      stripe_raw_status TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("smtp_config table", sql`CREATE TABLE IF NOT EXISTS smtp_config (
      id SERIAL PRIMARY KEY,
      host TEXT,
      port INTEGER DEFAULT 587,
      username TEXT,
      password_hash TEXT,
      has_password BOOLEAN DEFAULT FALSE,
      tls_mode TEXT DEFAULT 'starttls',
      from_name TEXT,
      from_email TEXT,
      is_configured BOOLEAN DEFAULT FALSE,
      last_tested_at TIMESTAMP,
      last_test_result TEXT,
      updated_at TIMESTAMP DEFAULT NOW(),
      updated_by TEXT
    )`);

    await run("sms_config table", sql`CREATE TABLE IF NOT EXISTS sms_config (
      id SERIAL PRIMARY KEY,
      provider TEXT DEFAULT 'twilio',
      account_sid TEXT,
      has_auth_token BOOLEAN DEFAULT FALSE,
      auth_token_hash TEXT,
      from_number TEXT,
      messaging_service_sid TEXT,
      is_configured BOOLEAN DEFAULT FALSE,
      last_tested_at TIMESTAMP,
      last_test_result TEXT,
      updated_at TIMESTAMP DEFAULT NOW(),
      updated_by TEXT
    )`);

    await run("roles.capabilities", sql`ALTER TABLE roles ADD COLUMN IF NOT EXISTS capabilities TEXT`);
    await run("role_permissions.can_configure", sql`ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_configure BOOLEAN DEFAULT FALSE`);

    await run("weekly_labor_goals table", sql`CREATE TABLE IF NOT EXISTS weekly_labor_goals (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      cost_center_id VARCHAR,
      job_id VARCHAR,
      week_start DATE NOT NULL,
      target_amount NUMERIC NOT NULL DEFAULT 0,
      auto_recur BOOLEAN DEFAULT FALSE,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await run("weekly_revenue_goals table", sql`CREATE TABLE IF NOT EXISTS weekly_revenue_goals (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL REFERENCES companies(id),
      cost_center_id VARCHAR,
      job_id VARCHAR,
      week_start DATE NOT NULL,
      target_amount NUMERIC NOT NULL DEFAULT 0,
      auto_recur BOOLEAN DEFAULT FALSE,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── Task #34: contractor workflow settings + branding contact fields ──────
    await run("contractor_workflow_settings table", sql`CREATE TABLE IF NOT EXISTS contractor_workflow_settings (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR UNIQUE,
      min_reviewers INTEGER DEFAULT 1,
      review_mode TEXT DEFAULT 'parallel',
      trade_enabled BOOLEAN DEFAULT TRUE,
      contract_sig_overdue_days INTEGER DEFAULT 7,
      contract_renewal_warning_days INTEGER DEFAULT 30,
      contract_expiry_warning_days INTEGER DEFAULT 14,
      invoice_due_reminder_days INTEGER DEFAULT 3,
      invoice_overdue_reminder_days INTEGER DEFAULT 1,
      notification_rules JSONB DEFAULT '{}',
      permission_matrix JSONB DEFAULT '{}',
      updated_by VARCHAR,
      updated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await run("contractor_branding.contact_name", sql`ALTER TABLE contractor_branding ADD COLUMN IF NOT EXISTS contact_name TEXT`);
    await run("contractor_branding.address", sql`ALTER TABLE contractor_branding ADD COLUMN IF NOT EXISTS address TEXT`);
    await run("contractor_branding.phone", sql`ALTER TABLE contractor_branding ADD COLUMN IF NOT EXISTS phone TEXT`);
    await run("contractor_branding.contact_email", sql`ALTER TABLE contractor_branding ADD COLUMN IF NOT EXISTS contact_email TEXT`);
    await run("contractor_branding.logo_url", sql`ALTER TABLE contractor_branding ADD COLUMN IF NOT EXISTS logo_url TEXT`);
    await run("contractor_templates.is_default", sql`ALTER TABLE contractor_templates ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE`);
    await run("contractor_templates.layout_variant", sql`ALTER TABLE contractor_templates ADD COLUMN IF NOT EXISTS layout_variant TEXT DEFAULT 'standard'`);
    await run("contractor_templates.work_type_tags", sql`ALTER TABLE contractor_templates ADD COLUMN IF NOT EXISTS work_type_tags TEXT`);
    await run("contractor_workflow_settings.contract_renegotiation_warning_days", sql`ALTER TABLE contractor_workflow_settings ADD COLUMN IF NOT EXISTS contract_renegotiation_warning_days INTEGER DEFAULT 7`);
    await run("contractor_workflow_settings.reviewer_pool", sql`ALTER TABLE contractor_workflow_settings ADD COLUMN IF NOT EXISTS reviewer_pool TEXT`);
    await run("contractor_workflow_settings.document_retention_months", sql`ALTER TABLE contractor_workflow_settings ADD COLUMN IF NOT EXISTS document_retention_months INTEGER DEFAULT 84`);
    await run("contractor_workflow_settings.document_archive_after_days", sql`ALTER TABLE contractor_workflow_settings ADD COLUMN IF NOT EXISTS document_archive_after_days INTEGER DEFAULT 365`);
    await run("contractor_workflow_settings.auto_archive_enabled", sql`ALTER TABLE contractor_workflow_settings ADD COLUMN IF NOT EXISTS auto_archive_enabled BOOLEAN DEFAULT FALSE`);
    await run("contractor_proposals.is_archived", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE`);
    await run("contractor_proposals.archived_at", sql`ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
    await run("contractor_contracts.is_archived", sql`ALTER TABLE contractor_contracts ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE`);
    await run("contractor_contracts.archived_at", sql`ALTER TABLE contractor_contracts ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
    await run("contractor_invoices.is_archived", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE`);
    await run("contractor_invoices.archived_at", sql`ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);

    await run("positions.is_volunteer", sql`ALTER TABLE positions ADD COLUMN IF NOT EXISTS is_volunteer BOOLEAN DEFAULT FALSE`);
    await run("positions.pay_type", sql`ALTER TABLE positions ADD COLUMN IF NOT EXISTS pay_type TEXT`);
    await run("positions.is_tipped", sql`ALTER TABLE positions ADD COLUMN IF NOT EXISTS is_tipped BOOLEAN DEFAULT FALSE`);

    // ── Feature Registry (Task #39) ──────────────────────────────────────────
    await run("feature_registry table", sql`CREATE TABLE IF NOT EXISTS feature_registry (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      feature_key TEXT NOT NULL UNIQUE,
      module TEXT NOT NULL,
      feature_name TEXT NOT NULL,
      layer TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'all',
      description TEXT,
      default_on BOOLEAN NOT NULL DEFAULT TRUE,
      is_beta BOOLEAN NOT NULL DEFAULT FALSE,
      billing_impact BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);

    await run("feature_overrides table", sql`CREATE TABLE IF NOT EXISTS feature_overrides (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL,
      feature_key TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      expires_at TIMESTAMPTZ,
      notes TEXT,
      enabled_by VARCHAR,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(company_id, feature_key)
    )`);

    await run("feature_activation_log table", sql`CREATE TABLE IF NOT EXISTS feature_activation_log (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR,
      company_name TEXT,
      feature_key TEXT NOT NULL,
      action TEXT NOT NULL,
      performed_by VARCHAR,
      performed_by_name TEXT,
      notes TEXT,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);

    // Seed core tenant features into feature_registry
    await run("feature_registry seed", sql`
      INSERT INTO feature_registry (feature_key, module, feature_name, layer, tier, description, default_on, is_beta, billing_impact, sort_order)
      VALUES
        ('tenant.home.dashboard',          'Home',                    'Dashboard',                 'tenant', 'all',          'Main dashboard with KPIs and activity feed',                              TRUE,  FALSE, FALSE, 10),
        ('tenant.home.messages',           'Home',                    'Message Center',            'tenant', 'starter',      'Internal messaging and broadcasts to workers',                            TRUE,  FALSE, FALSE, 20),
        ('tenant.attendance.timesheet',    'My Work',                 'Timesheets',                'tenant', 'starter',      'Employee timesheets and manager review workflows',                         TRUE,  FALSE, FALSE, 30),
        ('tenant.attendance.time-off',     'My Work',                 'Time Off',                  'tenant', 'starter',      'Time-off requests and approval flows',                                    TRUE,  FALSE, FALSE, 40),
        ('tenant.schedule.view',           'My Work',                 'Scheduling',                'tenant', 'starter',      'Employee schedules, shift publishing, and personal calendar',              TRUE,  FALSE, FALSE, 50),
        ('tenant.schedule.marketplace',    'My Work',                 'Shift Marketplace',         'tenant', 'professional', 'Shift swapping and open-shift bidding marketplace',                       TRUE,  FALSE, FALSE, 60),
        ('tenant.expenses.manage',         'My Work',                 'Expenses',                  'tenant', 'professional', 'Expense submission, photo receipts, AI scanning, and approval',           TRUE,  FALSE, FALSE, 70),
        ('tenant.employee.directory',      'Workforce',               'Employee Directory',        'tenant', 'starter',      'Full employee roster with profiles, pay, and custom fields',              TRUE,  FALSE, FALSE, 80),
        ('tenant.hr.reviews',              'HR',                      'Performance Reviews',       'tenant', 'professional', 'Structured performance review cycles with KPI tracking',                   FALSE, FALSE, FALSE, 90),
        ('tenant.hr.qualifications',       'HR',                      'Qualifications & Skills',   'tenant', 'professional', 'Track employee certifications, licenses, and skills',                      TRUE,  FALSE, FALSE, 100),
        ('tenant.payroll.process',         'Payroll',                 'Process Payroll',           'tenant', 'starter',      'Multi-step payroll wizard, direct deposit, and tax form generation',       TRUE,  FALSE, TRUE,  110),
        ('tenant.payroll.audit',           'Payroll',                 'Payroll Audit',             'tenant', 'professional', 'Payroll run audit trail and discrepancy reports',                          TRUE,  FALSE, FALSE, 120),
        ('tenant.finance.invoicing',       'Finance',                 'Business Invoicing',        'tenant', 'professional', 'Create and send invoices to customers',                                   TRUE,  FALSE, TRUE,  130),
        ('tenant.finance.biz-docs',        'Finance',                 'Proposals & Contracts',     'tenant', 'professional', 'Unified proposals, contracts, and document lifecycle management',          TRUE,  FALSE, TRUE,  140),
        ('tenant.finance.contractor-hub',  'Finance',                 'Contractor Hub',            'tenant', 'enterprise',   'Contractor proposals, contracts, invoices, and payment management',       TRUE,  FALSE, TRUE,  150),
        ('tenant.finance.trade-compensation','Finance',               'Trade Compensation',        'tenant', 'enterprise',   'Non-cash and barter compensation tracking and payroll integration',       FALSE, TRUE,  TRUE,  160),
        ('tenant.finance.treasury',        'Finance',                 'Stripe Treasury',           'tenant', 'enterprise',   'Embedded banking for payroll ACH disbursements via Stripe Treasury',      FALSE, TRUE,  TRUE,  170),
        ('tenant.finance.customers',       'Finance',                 'Customers & Vendors',       'tenant', 'starter',      'Customer and vendor contact management',                                  TRUE,  FALSE, FALSE, 180),
        ('tenant.docs.company-documents',  'Documents',               'Company Documents',         'tenant', 'professional', 'Centralized document storage with versioning and e-signatures',           TRUE,  FALSE, FALSE, 190),
        ('tenant.docs.e-signatures',       'Documents',               'E-Signatures',              'tenant', 'enterprise',   'Request and collect legally binding e-signatures on documents',           TRUE,  FALSE, FALSE, 200),
        ('tenant.reports.payroll',         'Reports',                 'Payroll Reports',           'tenant', 'starter',      'Pre-built payroll and labor cost reports with CSV export',                TRUE,  FALSE, FALSE, 210),
        ('tenant.reports.hr',              'Reports',                 'HR Reports',                'tenant', 'professional', 'Headcount, turnover, and workforce analytics reports',                    TRUE,  FALSE, FALSE, 220),
        ('tenant.system.settings',         'System Admin',            'System Settings',           'tenant', 'all',          'Tenant-level configuration: notifications, policies, integrations',       TRUE,  FALSE, FALSE, 230),
        ('tenant.system.alert-templates',  'System Admin',            'Alert Templates',           'tenant', 'professional', 'Customizable email and SMS notification templates',                        TRUE,  FALSE, FALSE, 240),
        ('tenant.kpi.goals',               'Reports',                 'KPI Goals',                 'tenant', 'professional', 'Set and track weekly labor and revenue goals against actuals',            TRUE,  FALSE, FALSE, 250),
        ('tenant.inventory.manage',        'Operations',              'Inventory',                 'tenant', 'enterprise',   'Basic inventory tracking and assignment per location',                    FALSE, TRUE,  FALSE, 260)
      ON CONFLICT (feature_key) DO NOTHING
    `);

    // ── Commission / Earning Types / Pay Stub Line Items ─────────────────────
    await run("workers.compensation_type", sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS compensation_type TEXT DEFAULT 'hourly'`);
    await run("payroll_items.commission_pay", sql`ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS commission_pay NUMERIC DEFAULT 0`);

    await run("earning_types table", sql`CREATE TABLE IF NOT EXISTS earning_types (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      is_taxable BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);

    await run("commissions table", sql`CREATE TABLE IF NOT EXISTS commissions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL,
      worker_id VARCHAR NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      description TEXT,
      source_type TEXT DEFAULT 'manual',
      source_id VARCHAR,
      earned_date DATE NOT NULL,
      status TEXT DEFAULT 'pending',
      payroll_run_id VARCHAR,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await run("commissions.hours", sql`ALTER TABLE commissions ADD COLUMN IF NOT EXISTS hours NUMERIC DEFAULT 0`);
    await run("commissions.paid_at", sql`ALTER TABLE commissions ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`);

    await run("pay_stub_line_items table", sql`CREATE TABLE IF NOT EXISTS pay_stub_line_items (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      payroll_item_id VARCHAR NOT NULL,
      earning_type_id VARCHAR,
      description TEXT,
      amount NUMERIC(12,2) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  }

  // Fix: ensure the platform 'admin' user is never scoped to a company.
  // If the production admin row has role='admin' or has a companyId set,
  // correct it so all workers are visible across all companies.
  try {
    const { db: dbFix } = await import("./db");
    await dbFix.$client.query(
      `UPDATE users SET role = 'platform_super_admin', company_id = NULL
       WHERE username = 'admin'
         AND (role = 'admin' OR (role = 'platform_super_admin' AND company_id IS NOT NULL))`
    );
    console.log("Auto-migration OK: admin user platform scope fix");
  } catch (e) {
    console.log("Auto-migration skipped (admin platform scope fix):", (e as Error).message);
  }

  const { seedDatabase } = await import("./seed");
  try {
    await seedDatabase();
  } catch (e) {
    console.log("Seed skipped or failed:", (e as Error).message);
  }

  try {
    const { seedCompanyLogos } = await import("./seedCompanyLogos");
    await seedCompanyLogos();
  } catch (e) {
    console.log("Company logo seed skipped or failed:", (e as Error).message);
  }

  try {
    const { runMigrations } = await import('stripe-replit-sync');
    const { getStripeSync } = await import('./stripeClient');
    console.log('Initializing Stripe schema...');
    await runMigrations({ databaseUrl: process.env.DATABASE_URL! });
    console.log('Stripe schema ready');

    const stripeSync = await getStripeSync();
    const replitDomains = process.env.REPLIT_DOMAINS;
    if (replitDomains) {
      const webhookBaseUrl = `https://${replitDomains.split(',')[0]}`;
      console.log('Setting up Stripe managed webhook...');
      await stripeSync.findOrCreateManagedWebhook(`${webhookBaseUrl}/api/stripe/webhook`);
      console.log('Stripe webhook configured');
    }

    stripeSync.syncBackfill()
      .then(() => console.log('Stripe data synced'))
      .catch((err: any) => console.error('Stripe sync error:', err.message));
  } catch (stripeErr: any) {
    console.warn('Stripe init skipped:', stripeErr.message);
  }

  await registerRoutes(httpServer, app);

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    console.error("Unhandled error:", isProduction ? err.message : err);

    if (res.headersSent) {
      return next(err);
    }

    const safeMessage = isProduction
      ? (status < 500 ? (err.message || "Bad request") : "Internal server error")
      : (err.message || "Internal Server Error");

    return res.status(status).json({ message: safeMessage });
  });

  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || (isProduction ? "127.0.0.1" : "0.0.0.0");
  httpServer.listen(
    {
      port,
      host,
      reusePort: true,
    },
    () => {
      log(`serving on ${host}:${port}`);

      // Run contractor reminder scheduler once at startup (with a short delay),
      // then periodically every 6 hours
      const SCHEDULER_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
      setTimeout(() => {
        runContractorReminderScheduler().catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn("[ContractorScheduler] Startup run error:", msg);
        });
        setInterval(() => {
          runContractorReminderScheduler().catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn("[ContractorScheduler] Periodic run error:", msg);
          });
        }, SCHEDULER_INTERVAL_MS);
      }, 10000); // 10s delay after startup to allow DB migrations to complete
    },
  );
})();
