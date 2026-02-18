import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, numeric, date, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const workerTypeEnum = pgEnum("worker_type", ["employee", "contractor"]);
export const payFrequencyEnum = pgEnum("pay_frequency", ["weekly", "biweekly", "semimonthly", "monthly"]);
export const entityTypeEnum = pgEnum("entity_type", ["c_corp", "s_corp", "llc", "sole_prop", "nonprofit_501c3", "partnership"]);
export const punchTypeEnum = pgEnum("punch_type", ["clock_in", "clock_out", "break_start", "break_end"]);
export const scheduleStatusEnum = pgEnum("schedule_status", ["draft", "published"]);
export const timesheetStatusEnum = pgEnum("timesheet_status", ["pending", "approved", "rejected"]);
export const payrollStatusEnum = pgEnum("payroll_status", ["draft", "processed", "paid"]);

export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  dba: text("dba"),
  ein: text("ein"),
  taxId: text("tax_id"),
  entityNumber: text("entity_number"),
  entityType: entityTypeEnum("entity_type").default("llc"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  phone: text("phone"),
  website: text("website"),
  email: text("email"),
  logoUrl: text("logo_url"),
  tagline: text("tagline"),
  payFrequency: payFrequencyEnum("pay_frequency").default("biweekly"),
  overtimeThreshold: integer("overtime_threshold").default(40),
  overtimeMultiplier: numeric("overtime_multiplier").default("1.5"),
  breakPolicyMinutes: integer("break_policy_minutes").default(30),
  breakAfterHours: integer("break_after_hours").default(6),
  timeRoundingMinutes: integer("time_rounding_minutes").default(15),
  createdAt: timestamp("created_at").defaultNow(),
});

export const workers = pgTable("workers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  workerType: workerTypeEnum("worker_type").notNull().default("employee"),
  jobTitle: text("job_title"),
  department: text("department"),
  payRate: numeric("pay_rate").notNull().default("0"),
  payType: text("pay_type").default("hourly"),
  hireDate: date("hire_date"),
  isActive: boolean("is_active").default(true),
  isShareholder: boolean("is_shareholder").default(false),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  ssn: text("ssn"),
  ethnicity: text("ethnicity"),
  employeeNumber: text("employee_number"),
  pin: text("pin"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const timePunches = pgTable("time_punches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  punchType: punchTypeEnum("punch_type").notNull(),
  punchTime: timestamp("punch_time").notNull().defaultNow(),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const timeEntries = pgTable("time_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  date: date("date").notNull(),
  clockIn: timestamp("clock_in"),
  clockOut: timestamp("clock_out"),
  breakMinutes: integer("break_minutes").default(0),
  totalHours: numeric("total_hours").default("0"),
  overtimeHours: numeric("overtime_hours").default("0"),
  status: timesheetStatusEnum("status").default("pending"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const schedules = pgTable("schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  date: date("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  department: text("department"),
  status: scheduleStatusEnum("status").default("draft"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const payrollRuns = pgTable("payroll_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  status: payrollStatusEnum("status").default("draft"),
  totalGross: numeric("total_gross").default("0"),
  totalNet: numeric("total_net").default("0"),
  totalHours: numeric("total_hours").default("0"),
  totalOvertimeHours: numeric("total_overtime_hours").default("0"),
  workerCount: integer("worker_count").default(0),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const payrollItems = pgTable("payroll_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payrollRunId: varchar("payroll_run_id").notNull().references(() => payrollRuns.id),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  regularHours: numeric("regular_hours").default("0"),
  overtimeHours: numeric("overtime_hours").default("0"),
  regularPay: numeric("regular_pay").default("0"),
  overtimePay: numeric("overtime_pay").default("0"),
  grossPay: numeric("gross_pay").default("0"),
  deductions: numeric("deductions").default("0"),
  netPay: numeric("net_pay").default("0"),
  payRate: numeric("pay_rate").default("0"),
  payType: text("pay_type").default("hourly"),
  checkNumber: text("check_number"),
  ytdGross: numeric("ytd_gross").default("0"),
  ytdDeductions: numeric("ytd_deductions").default("0"),
  ytdNet: numeric("ytd_net").default("0"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").default("admin"),
  companyId: varchar("company_id"),
});

export const departments = pgTable("departments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  code: text("code"),
  managerId: varchar("manager_id"),
  parentId: varchar("parent_id"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const branches = pgTable("branches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  code: text("code"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  phone: text("phone"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const accrualAccounts = pgTable("accrual_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  type: text("type").notNull().default("pto"),
  accrualRate: numeric("accrual_rate").default("0"),
  accrualFrequency: text("accrual_frequency").default("per_pay_period"),
  maxBalance: numeric("max_balance"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const accrualBalances = pgTable("accrual_balances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  accrualAccountId: varchar("accrual_account_id").notNull().references(() => accrualAccounts.id),
  balance: numeric("balance").default("0"),
  usedHours: numeric("used_hours").default("0"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const employeeContacts = pgTable("employee_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  contactType: text("contact_type").notNull().default("emergency"),
  name: text("name").notNull(),
  relationship: text("relationship"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  isPrimary: boolean("is_primary").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const payMethods = pgTable("pay_methods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  methodType: text("method_type").notNull().default("direct_deposit"),
  bankName: text("bank_name"),
  accountType: text("account_type"),
  routingNumber: text("routing_number"),
  accountNumber: text("account_number"),
  isPrimary: boolean("is_primary").default(false),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const payPeriods = pgTable("pay_periods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  frequency: text("frequency").default("biweekly"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  payDate: date("pay_date"),
  status: text("status").default("open"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const taxesDeductions = pgTable("taxes_deductions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  type: text("type").notNull().default("tax"),
  calculationType: text("calculation_type").default("percentage"),
  rate: numeric("rate").default("0"),
  maxAmount: numeric("max_amount"),
  isEmployerPaid: boolean("is_employer_paid").default(false),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const policyGroups = pgTable("policy_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const payCodes = pgTable("pay_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: text("type").default("regular"),
  rate: numeric("rate"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const holidays = pgTable("holidays", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  date: date("date").notNull(),
  isRecurring: boolean("is_recurring").default(false),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const qualifications = pgTable("qualifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  workerId: varchar("worker_id").references(() => workers.id),
  type: text("type").notNull().default("skill"),
  name: text("name").notNull(),
  description: text("description"),
  level: text("level"),
  expirationDate: date("expiration_date"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const reviews = pgTable("reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  reviewDate: date("review_date").notNull(),
  reviewerName: text("reviewer_name"),
  rating: integer("rating"),
  notes: text("notes"),
  status: text("status").default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const recurringSchedules = pgTable("recurring_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  name: text("name"),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  effectiveFrom: date("effective_from"),
  effectiveTo: date("effective_to"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const remittanceSources = pgTable("remittance_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  status: text("status").default("enabled"),
  type: text("type").notNull().default("check"),
  country: text("country").default("US"),
  currency: text("currency").default("USD"),
  lastCheckNumber: integer("last_check_number").default(0),
  lastBatchNumber: integer("last_batch_number").default(0),
  routingNumber: text("routing_number"),
  accountNumber: text("account_number"),
  institution: text("institution"),
  bankTransit: text("bank_transit"),
  bankAccount: text("bank_account"),
  verticalAlignment: numeric("vertical_alignment").default("0"),
  horizontalAlignment: numeric("horizontal_alignment").default("0"),
  signatureUrl: text("signature_url"),
  businessNumber: text("business_number"),
  immediateOrigin: text("immediate_origin"),
  immediateOriginName: text("immediate_origin_name"),
  immediateDest: text("immediate_dest"),
  immediateDestName: text("immediate_dest_name"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const remittanceAgencies = pgTable("remittance_agencies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  status: text("status").default("enabled"),
  type: text("type").notNull().default("federal"),
  country: text("country").default("US"),
  provinceState: text("province_state"),
  district: text("district"),
  agency: text("agency"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  contactWorkerId: varchar("contact_worker_id"),
  remittanceSourceId: varchar("remittance_source_id"),
  businessDayRule: text("business_day_rule").default("no"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const remittanceAgencyEvents = pgTable("remittance_agency_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agencyId: varchar("agency_id").notNull().references(() => remittanceAgencies.id),
  status: text("status").default("enabled"),
  type: text("type").default("payment"),
  frequency: text("frequency").default("quarterly"),
  dueDateDelayDays: integer("due_date_delay_days").default(0),
  effectiveDate: date("effective_date"),
  reminderDays: integer("reminder_days").default(7),
  reminderWorkerId: varchar("reminder_worker_id"),
  primaryMonth: integer("primary_month"),
  primaryDayOfMonth: integer("primary_day_of_month"),
  secondaryMonth: integer("secondary_month"),
  secondaryDayOfMonth: integer("secondary_day_of_month"),
  dayOfMonth: integer("day_of_month"),
  monthOfQuarter: integer("month_of_quarter"),
  lastProcessedDate: date("last_processed_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const payStubAccounts = pgTable("pay_stub_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  status: text("status").default("enabled"),
  type: text("type").notNull().default("earning"),
  displayOrder: integer("display_order").default(0),
  accrualAccountId: varchar("accrual_account_id"),
  debitAccount: text("debit_account"),
  creditAccount: text("credit_account"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const payStubAmendments = pgTable("pay_stub_amendments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  payStubAccountId: varchar("pay_stub_account_id"),
  status: text("status").default("active"),
  amountType: text("amount_type").default("fixed"),
  rate: numeric("rate").default("0"),
  units: numeric("units").default("0"),
  amount: numeric("amount").default("0"),
  percent: numeric("percent").default("0"),
  description: text("description"),
  publicNote: text("public_note"),
  effectiveDate: date("effective_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const payStubTransactions = pgTable("pay_stub_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payrollItemId: varchar("payroll_item_id").references(() => payrollItems.id),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  remittanceSourceId: varchar("remittance_source_id"),
  status: text("status").default("pending"),
  paymentMethod: text("payment_method").default("check"),
  transactionDate: date("transaction_date"),
  amount: numeric("amount").default("0"),
  checkNumber: text("check_number"),
  batchNumber: text("batch_number"),
  reference: text("reference"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const payPeriodSchedules = pgTable("pay_period_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull().default("biweekly"),
  anchorDate: date("anchor_date"),
  transactionDayOffset: integer("transaction_day_offset").default(3),
  semiMonthlyDay1: integer("semi_monthly_day1").default(1),
  semiMonthlyDay2: integer("semi_monthly_day2").default(15),
  annualPayPeriods: integer("annual_pay_periods"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companies).omit({ id: true, createdAt: true });
export const insertWorkerSchema = createInsertSchema(workers).omit({ id: true, createdAt: true });
export const insertTimePunchSchema = createInsertSchema(timePunches).omit({ id: true, createdAt: true });
export const insertTimeEntrySchema = createInsertSchema(timeEntries).omit({ id: true, createdAt: true });
export const insertScheduleSchema = createInsertSchema(schedules).omit({ id: true, createdAt: true });
export const insertPayrollRunSchema = createInsertSchema(payrollRuns).omit({ id: true, createdAt: true });
export const insertPayrollItemSchema = createInsertSchema(payrollItems).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).pick({ username: true, password: true });
export const insertDepartmentSchema = createInsertSchema(departments).omit({ id: true, createdAt: true });
export const insertBranchSchema = createInsertSchema(branches).omit({ id: true, createdAt: true });
export const insertAccrualAccountSchema = createInsertSchema(accrualAccounts).omit({ id: true, createdAt: true });
export const insertAccrualBalanceSchema = createInsertSchema(accrualBalances).omit({ id: true });
export const insertEmployeeContactSchema = createInsertSchema(employeeContacts).omit({ id: true, createdAt: true });
export const insertPayMethodSchema = createInsertSchema(payMethods).omit({ id: true, createdAt: true });
export const insertPayPeriodSchema = createInsertSchema(payPeriods).omit({ id: true, createdAt: true });
export const insertTaxDeductionSchema = createInsertSchema(taxesDeductions).omit({ id: true, createdAt: true });
export const insertPolicyGroupSchema = createInsertSchema(policyGroups).omit({ id: true, createdAt: true });
export const insertPayCodeSchema = createInsertSchema(payCodes).omit({ id: true, createdAt: true });
export const insertHolidaySchema = createInsertSchema(holidays).omit({ id: true, createdAt: true });
export const insertQualificationSchema = createInsertSchema(qualifications).omit({ id: true, createdAt: true });
export const insertReviewSchema = createInsertSchema(reviews).omit({ id: true, createdAt: true });
export const insertRecurringScheduleSchema = createInsertSchema(recurringSchedules).omit({ id: true, createdAt: true });
export const insertRemittanceSourceSchema = createInsertSchema(remittanceSources).omit({ id: true, createdAt: true });
export const insertRemittanceAgencySchema = createInsertSchema(remittanceAgencies).omit({ id: true, createdAt: true });
export const insertRemittanceAgencyEventSchema = createInsertSchema(remittanceAgencyEvents).omit({ id: true, createdAt: true });
export const insertPayStubAccountSchema = createInsertSchema(payStubAccounts).omit({ id: true, createdAt: true });
export const insertPayStubAmendmentSchema = createInsertSchema(payStubAmendments).omit({ id: true, createdAt: true });
export const insertPayStubTransactionSchema = createInsertSchema(payStubTransactions).omit({ id: true, createdAt: true });
export const insertPayPeriodScheduleSchema = createInsertSchema(payPeriodSchedules).omit({ id: true, createdAt: true });

export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Worker = typeof workers.$inferSelect;
export type InsertWorker = z.infer<typeof insertWorkerSchema>;
export type TimePunch = typeof timePunches.$inferSelect;
export type InsertTimePunch = z.infer<typeof insertTimePunchSchema>;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type Schedule = typeof schedules.$inferSelect;
export type InsertSchedule = z.infer<typeof insertScheduleSchema>;
export type PayrollRun = typeof payrollRuns.$inferSelect;
export type InsertPayrollRun = z.infer<typeof insertPayrollRunSchema>;
export type PayrollItem = typeof payrollItems.$inferSelect;
export type InsertPayrollItem = z.infer<typeof insertPayrollItemSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type InsertDepartment = z.infer<typeof insertDepartmentSchema>;
export type Branch = typeof branches.$inferSelect;
export type InsertBranch = z.infer<typeof insertBranchSchema>;
export type AccrualAccount = typeof accrualAccounts.$inferSelect;
export type InsertAccrualAccount = z.infer<typeof insertAccrualAccountSchema>;
export type AccrualBalance = typeof accrualBalances.$inferSelect;
export type InsertAccrualBalance = z.infer<typeof insertAccrualBalanceSchema>;
export type EmployeeContact = typeof employeeContacts.$inferSelect;
export type InsertEmployeeContact = z.infer<typeof insertEmployeeContactSchema>;
export type PayMethod = typeof payMethods.$inferSelect;
export type InsertPayMethod = z.infer<typeof insertPayMethodSchema>;
export type PayPeriod = typeof payPeriods.$inferSelect;
export type InsertPayPeriod = z.infer<typeof insertPayPeriodSchema>;
export type TaxDeduction = typeof taxesDeductions.$inferSelect;
export type InsertTaxDeduction = z.infer<typeof insertTaxDeductionSchema>;
export type PolicyGroup = typeof policyGroups.$inferSelect;
export type InsertPolicyGroup = z.infer<typeof insertPolicyGroupSchema>;
export type PayCode = typeof payCodes.$inferSelect;
export type InsertPayCode = z.infer<typeof insertPayCodeSchema>;
export type Holiday = typeof holidays.$inferSelect;
export type InsertHoliday = z.infer<typeof insertHolidaySchema>;
export type Qualification = typeof qualifications.$inferSelect;
export type InsertQualification = z.infer<typeof insertQualificationSchema>;
export type Review = typeof reviews.$inferSelect;
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type RecurringSchedule = typeof recurringSchedules.$inferSelect;
export type InsertRecurringSchedule = z.infer<typeof insertRecurringScheduleSchema>;
export type RemittanceSource = typeof remittanceSources.$inferSelect;
export type InsertRemittanceSource = z.infer<typeof insertRemittanceSourceSchema>;
export type RemittanceAgency = typeof remittanceAgencies.$inferSelect;
export type InsertRemittanceAgency = z.infer<typeof insertRemittanceAgencySchema>;
export type RemittanceAgencyEvent = typeof remittanceAgencyEvents.$inferSelect;
export type InsertRemittanceAgencyEvent = z.infer<typeof insertRemittanceAgencyEventSchema>;
export type PayStubAccount = typeof payStubAccounts.$inferSelect;
export type InsertPayStubAccount = z.infer<typeof insertPayStubAccountSchema>;
export type PayStubAmendment = typeof payStubAmendments.$inferSelect;
export type InsertPayStubAmendment = z.infer<typeof insertPayStubAmendmentSchema>;
export type PayStubTransaction = typeof payStubTransactions.$inferSelect;
export type InsertPayStubTransaction = z.infer<typeof insertPayStubTransactionSchema>;
export type PayPeriodSchedule = typeof payPeriodSchedules.$inferSelect;
export type InsertPayPeriodSchedule = z.infer<typeof insertPayPeriodScheduleSchema>;
