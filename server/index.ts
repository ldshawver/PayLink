import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import path from "path";
import fs from "fs";

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
    await run("recurring_schedules.job_id", sql`ALTER TABLE recurring_schedules ADD COLUMN IF NOT EXISTS job_id VARCHAR`);
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
    await run("system_documents seed payroll rules", sql`
      INSERT INTO system_documents (title, version, category, file_url, description, effective_date, change_log, is_active)
      SELECT
        'MyPayLink Payroll Processing Rules',
        'v1.0',
        'Payroll',
        '/docs/payroll/MyPayLink_Payroll_Processing_Rules_v1.0.docx',
        'Official payroll processing rules, data integrity requirements, and system behaviors. Covers pay period calculation, YTD logic, duplicate prevention, reimbursement handling, and check/stub requirements.',
        '2026-04-02',
        'v1.0 (2026-04-02): Initial release. Covers payroll period schedule, run workflow, amendment rules, expense/reimbursement deduplication, duplicate-run prevention, YTD snapshot rules, and check/stub display requirements.',
        TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM system_documents WHERE title = 'MyPayLink Payroll Processing Rules' AND version = 'v1.0'
      )
    `);
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
    },
  );
})();
