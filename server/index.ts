import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

const app = express();
const httpServer = createServer(app);

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    userId: string;
    username: string;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

import path from "path";
import fs from "fs";
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));

const isProduction = process.env.NODE_ENV === "production";
const PgStore = connectPgSimple(session);
app.use(
  session({
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
      secure: false,
      sameSite: "lax",
    },
  }),
);

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
    // shift_offers additions
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
  }

  const { seedDatabase } = await import("./seed");
  try {
    await seedDatabase();
  } catch (e) {
    console.log("Seed skipped or failed:", (e as Error).message);
  }

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
