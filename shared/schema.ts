import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, numeric, date, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const workerTypeEnum = pgEnum("worker_type", ["employee", "contractor"]);
export const workerStatusEnum = pgEnum("worker_status", ["active", "inactive_temporary", "leave_illness", "leave_maternity", "leave_other", "terminated"]);
export const genderEnum = pgEnum("gender", ["unspecified", "male", "female"]);
export const payFrequencyEnum = pgEnum("pay_frequency", ["weekly", "biweekly", "semimonthly", "monthly"]);
export const entityTypeEnum = pgEnum("entity_type", ["c_corp", "s_corp", "llc", "sole_prop", "nonprofit_501c3", "partnership"]);
export const punchTypeEnum = pgEnum("punch_type", ["clock_in", "clock_out", "break_start", "break_end"]);
export const scheduleStatusEnum = pgEnum("schedule_status", ["draft", "published"]);
export const timesheetStatusEnum = pgEnum("timesheet_status", ["pending", "approved", "rejected"]);
export const payrollStatusEnum = pgEnum("payroll_status", ["draft", "processed", "paid"]);
export const jobStatusEnum = pgEnum("job_status", ["active", "completed", "cancelled", "on_hold"]);

export const enterprises = pgTable("enterprises", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  website: text("website"),
  logoUrl: text("logo_url"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  enterpriseId: varchar("enterprise_id"),
  legalEntityId: varchar("legal_entity_id"),
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
  iconUrl: text("icon_url"),
  tagline: text("tagline"),
  payFrequency: payFrequencyEnum("pay_frequency").default("biweekly"),
  overtimeThreshold: integer("overtime_threshold").default(40),
  overtimeMultiplier: numeric("overtime_multiplier").default("1.5"),
  breakPolicyMinutes: integer("break_policy_minutes").default(30),
  breakAfterHours: integer("break_after_hours").default(6),
  timeRoundingMinutes: integer("time_rounding_minutes").default(15),
  createdAt: timestamp("created_at").defaultNow(),
});

export const legalEntities = pgTable("legal_entities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id"),
  status: text("status").default("active"),
  type: text("type").default("corporation"),
  classificationCode: text("classification_code"),
  legalName: text("legal_name").notNull(),
  tradeName: text("trade_name"),
  ein: text("ein"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  country: text("country").default("US"),
  phone: text("phone"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const workers = pgTable("workers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  firstName: text("first_name").notNull(),
  middleName: text("middle_name"),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  workerType: workerTypeEnum("worker_type").notNull().default("employee"),
  status: workerStatusEnum("status").default("active"),
  jobTitle: text("job_title"),
  department: text("department"),
  payRate: numeric("pay_rate").notNull().default("0"),
  payType: text("pay_type").default("hourly"),
  hireDate: date("hire_date"),
  terminationDate: date("termination_date"),
  birthDate: date("birth_date"),
  isActive: boolean("is_active").default(true),
  isShareholder: boolean("is_shareholder").default(false),
  gender: genderEnum("gender").default("unspecified"),
  address: text("address"),
  address2: text("address_2"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  country: text("country").default("US"),
  ssn: text("ssn"),
  ethnicity: text("ethnicity"),
  employeeNumber: text("employee_number"),
  pin: text("pin"),
  currency: text("currency").default("USD"),
  workPhone: text("work_phone"),
  workPhoneExt: text("work_phone_ext"),
  homePhone: text("home_phone"),
  mobilePhone: text("mobile_phone"),
  fax: text("fax"),
  workEmail: text("work_email"),
  homeEmail: text("home_email"),
  note: text("note"),
  preferences: text("preferences"),
  tags: text("tags"),
  defaultBranchId: varchar("default_branch_id"),
  defaultDepartmentId: varchar("default_department_id"),
  policyGroupId: varchar("policy_group_id"),
  payPeriodScheduleId: varchar("pay_period_schedule_id"),
  groupId: varchar("group_id"),
  titleId: varchar("title_id"),
  positionId: varchar("position_id"),
  costCenterId: varchar("cost_center_id"),
  managerId: varchar("manager_id"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  contractorType: text("contractor_type").default("hourly"),
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
  doubleTimeHours: numeric("double_time_hours").default("0"),
  wageGroupId: varchar("wage_group_id"),
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
  doubleTimeHours: numeric("double_time_hours").default("0"),
  regularPay: numeric("regular_pay").default("0"),
  overtimePay: numeric("overtime_pay").default("0"),
  doubleTimePay: numeric("double_time_pay").default("0"),
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

export const divisions = pgTable("divisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const departments = pgTable("departments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  divisionId: varchar("division_id"),
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
  divisionId: varchar("division_id"),
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

export const positions = pgTable("positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  departmentId: varchar("department_id"),
  title: text("title").notNull(),
  description: text("description"),
  reportsToPositionId: varchar("reports_to_position_id"),
  salaryRangeMin: numeric("salary_range_min"),
  salaryRangeMax: numeric("salary_range_max"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const costCenters = pgTable("cost_centers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  code: text("code"),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  costCenterId: varchar("cost_center_id"),
  departmentId: varchar("department_id"),
  name: text("name").notNull(),
  description: text("description"),
  payType: text("pay_type").default("hourly"),
  defaultWage: numeric("default_wage"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  status: jobStatusEnum("status").default("active"),
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
  remittanceSourceId: varchar("remittance_source_id"),
  priority: integer("priority").default(1),
  amountType: text("amount_type").default("remainder"),
  amountValue: numeric("amount_value"),
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
  category: text("category").default("mandatory_tax"),
  subcategory: text("subcategory"),
  calculationType: text("calculation_type").default("percentage"),
  rate: numeric("rate").default("0"),
  maxAmount: numeric("max_amount"),
  isEmployerPaid: boolean("is_employer_paid").default(false),
  isReferenceOnly: boolean("is_reference_only").default(false),
  appliesTo: text("applies_to").default("all"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const policyGroups = pgTable("policy_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").default(false),
  regularTimePolicyId: varchar("regular_time_policy_id"),
  overtimePolicyId: varchar("overtime_policy_id"),
  premiumPolicyId: varchar("premium_policy_id"),
  mealPolicyId: varchar("meal_policy_id"),
  breakPolicyId: varchar("break_policy_id"),
  schedulePolicyId: varchar("schedule_policy_id"),
  exceptionPolicyId: varchar("exception_policy_id"),
  accrualPolicyId: varchar("accrual_policy_id"),
  absencePolicyId: varchar("absence_policy_id"),
  holidayPolicyId: varchar("holiday_policy_id"),
  roundingPolicyId: varchar("rounding_policy_id"),
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
  legalEntityId: varchar("legal_entity_id").references(() => legalEntities.id),
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

export const employeeTitles = pgTable("employee_titles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const employeeGroups = pgTable("employee_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  parentId: varchar("parent_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const wageHistory = pgTable("wage_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  wageType: text("wage_type").notNull().default("hourly"),
  wage: numeric("wage").notNull().default("0"),
  effectiveDate: date("effective_date").notNull(),
  averageHoursPerWeek: numeric("average_hours_per_week").default("40"),
  laborBurdenPercent: numeric("labor_burden_percent").default("0"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const newHireDefaults = pgTable("new_hire_defaults", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  displayOrder: integer("display_order").default(0),
  defaultWorkerType: text("default_worker_type").default("employee"),
  defaultPayType: text("default_pay_type").default("hourly"),
  defaultDepartment: text("default_department"),
  defaultBranchId: varchar("default_branch_id"),
  defaultPolicyGroupId: varchar("default_policy_group_id"),
  defaultPayPeriodScheduleId: varchar("default_pay_period_schedule_id"),
  defaultCurrency: text("default_currency").default("USD"),
  defaultCountry: text("default_country").default("US"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const payFormulas = pgTable("pay_formulas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  payType: text("pay_type").default("pay_multiplied_by_factor"),
  accrualAccountId: varchar("accrual_account_id"),
  accrualRate: numeric("accrual_rate").default("1.0"),
  wageSourceType: text("wage_source_type").default("hourly_rate"),
  wageSourceContributingShiftId: varchar("wage_source_contributing_shift_id"),
  wageGroup: text("wage_group"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const contributingPayCodes = pgTable("contributing_pay_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  payCodeIds: text("pay_code_ids"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const contributingShifts = pgTable("contributing_shifts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  shiftTypeCode: text("shift_type_code"),
  contributingPayCodeId: varchar("contributing_pay_code_id"),
  contributesToOvertime: boolean("contributes_to_overtime").default(true),
  contributesToAccrual: boolean("contributes_to_accrual").default(true),
  contributesToPremium: boolean("contributes_to_premium").default(true),
  contributesToCompliance: boolean("contributes_to_compliance").default(true),
  filterType: text("filter_type").default("date"),
  includeHolidayType: text("include_holiday_type").default("no_effect"),
  sunFilter: boolean("sun_filter").default(true),
  monFilter: boolean("mon_filter").default(true),
  tueFilter: boolean("tue_filter").default(true),
  wedFilter: boolean("wed_filter").default(true),
  thuFilter: boolean("thu_filter").default(true),
  friFilter: boolean("fri_filter").default(true),
  satFilter: boolean("sat_filter").default(true),
  startDate: date("start_date"),
  endDate: date("end_date"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  branchIds: text("branch_ids"),
  departmentIds: text("department_ids"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const regularTimePolicies = pgTable("regular_time_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  calculationOrder: integer("calculation_order").default(9999),
  contributingShiftId: varchar("contributing_shift_id"),
  payCodeId: varchar("pay_code_id"),
  payFormulaId: varchar("pay_formula_id"),
  maxTime: numeric("max_time"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const overtimePolicies = pgTable("overtime_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  type: text("type").default("daily"),
  triggerTime: numeric("trigger_time").default("8"),
  rate: numeric("rate").default("1.5"),
  payCodeId: varchar("pay_code_id"),
  payFormulaId: varchar("pay_formula_id"),
  contributingShiftId: varchar("contributing_shift_id"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const premiumPolicies = pgTable("premium_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  type: text("type").default("date_time"),
  payCodeId: varchar("pay_code_id"),
  payFormulaId: varchar("pay_formula_id"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  dailyTriggerHours: numeric("daily_trigger_hours"),
  weeklyTriggerHours: numeric("weekly_trigger_hours"),
  effectiveDays: text("effective_days"),
  holidayHandling: text("holiday_handling").default("no_effect"),
  branchIds: text("branch_ids"),
  departmentIds: text("department_ids"),
  minimumTime: numeric("minimum_time"),
  maximumTime: numeric("maximum_time"),
  includePartialPunches: boolean("include_partial_punches").default(false),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const mealPolicies = pgTable("meal_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  type: text("type").default("normal"),
  activeAfter: numeric("active_after").default("5"),
  mealTime: numeric("meal_time").default("0.5"),
  payCodeId: varchar("pay_code_id"),
  payFormulaId: varchar("pay_formula_id"),
  startWindow: numeric("start_window"),
  windowLength: numeric("window_length"),
  autoDetectBy: text("auto_detect_by").default("time_window"),
  minPunchTime: numeric("min_punch_time"),
  maxPunchTime: numeric("max_punch_time"),
  includeMultipleMeals: boolean("include_multiple_meals").default(false),
  allocationType: text("allocation_type").default("proportional"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const breakPolicies = pgTable("break_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  type: text("type").default("normal"),
  activeAfter: numeric("active_after").default("4"),
  breakTime: numeric("break_time").default("0.25"),
  payCodeId: varchar("pay_code_id"),
  payFormulaId: varchar("pay_formula_id"),
  startWindow: numeric("start_window"),
  windowLength: numeric("window_length"),
  autoDetectBy: text("auto_detect_by").default("time_window"),
  minPunchTime: numeric("min_punch_time"),
  maxPunchTime: numeric("max_punch_time"),
  includeMultipleBreaks: boolean("include_multiple_breaks").default(false),
  allocationType: text("allocation_type").default("proportional"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const schedulePolicies = pgTable("schedule_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  mealPolicyId: varchar("meal_policy_id"),
  breakPolicyIds: text("break_policy_ids"),
  regularTimePolicyAction: text("regular_time_policy_action").default("include"),
  regularTimePolicyIds: text("regular_time_policy_ids"),
  overtimePolicyAction: text("overtime_policy_action").default("include"),
  overtimePolicyIds: text("overtime_policy_ids"),
  premiumPolicyAction: text("premium_policy_action").default("include"),
  premiumPolicyIds: text("premium_policy_ids"),
  fullShiftAbsencePolicyId: varchar("full_shift_absence_policy_id"),
  partialShiftAbsencePolicyId: varchar("partial_shift_absence_policy_id"),
  startStopWindow: numeric("start_stop_window").default("1"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const exceptionPolicies = pgTable("exception_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  exceptionType: text("exception_type").default("missed_punch"),
  severity: text("severity").default("medium"),
  grace: numeric("grace").default("0"),
  watchWindow: numeric("watch_window").default("0"),
  emailNotification: boolean("email_notification").default(false),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const accrualPolicies = pgTable("accrual_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  type: text("type").default("standard"),
  accrualAccountId: varchar("accrual_account_id"),
  contributingShiftId: varchar("contributing_shift_id"),
  lengthOfServiceUnit: text("length_of_service_unit").default("years"),
  applyFrequency: text("apply_frequency").default("per_pay_period"),
  milestoneRolloverHireDate: boolean("milestone_rollover_hire_date").default(false),
  minimumEmployedDays: integer("minimum_employed_days").default(0),
  enableOpeningBalance: boolean("enable_opening_balance").default(false),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const accrualPolicyMilestones = pgTable("accrual_policy_milestones", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accrualPolicyId: varchar("accrual_policy_id").notNull().references(() => accrualPolicies.id),
  lengthOfService: numeric("length_of_service").default("0"),
  accrualRate: numeric("accrual_rate").default("0"),
  maxBalance: numeric("max_balance"),
  annualMaxBalance: numeric("annual_max_balance"),
  rolloverTime: numeric("rollover_time"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const absencePolicies = pgTable("absence_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  type: text("type").default("accrual_based"),
  payCodeId: varchar("pay_code_id"),
  payFormulaId: varchar("pay_formula_id"),
  accrualAccountId: varchar("accrual_account_id"),
  rateType: text("rate_type").default("multiplied_by_factor"),
  rateFactor: numeric("rate_factor").default("1.0"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const holidayPolicies = pgTable("holiday_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  defaultSchedule: text("default_schedule").default("none"),
  eligibleAfterDays: integer("eligible_after_days").default(0),
  minimumWorkedBeforeDays: integer("minimum_worked_before_days").default(0),
  minimumWorkedAfterDays: integer("minimum_worked_after_days").default(0),
  workedOnHolidayType: text("worked_on_holiday_type").default("paid"),
  absencePolicyId: varchar("absence_policy_id"),
  averageTimeMethod: text("average_time_method").default("daily"),
  averageTimeDays: integer("average_time_days").default(30),
  forceOverTimePolicy: boolean("force_over_time_policy").default(false),
  contributingShiftIds: text("contributing_shift_ids"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const roundingPolicies = pgTable("rounding_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  roundType: text("round_type").default("day_total"),
  punchType: text("punch_type"),
  interval: integer("interval_minutes").default(15),
  grace: integer("grace_minutes").default(3),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEnterpriseSchema = createInsertSchema(enterprises).omit({ id: true, createdAt: true });
export const insertCompanySchema = createInsertSchema(companies).omit({ id: true, createdAt: true });
export const insertDivisionSchema = createInsertSchema(divisions).omit({ id: true, createdAt: true });
export const insertPositionSchema = createInsertSchema(positions).omit({ id: true, createdAt: true });
export const insertCostCenterSchema = createInsertSchema(costCenters).omit({ id: true, createdAt: true });
export const insertJobSchema = createInsertSchema(jobs).omit({ id: true, createdAt: true });
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
export const insertEmployeeTitleSchema = createInsertSchema(employeeTitles).omit({ id: true, createdAt: true });
export const insertEmployeeGroupSchema = createInsertSchema(employeeGroups).omit({ id: true, createdAt: true });
export const insertWageHistorySchema = createInsertSchema(wageHistory).omit({ id: true, createdAt: true });
export const insertNewHireDefaultsSchema = createInsertSchema(newHireDefaults).omit({ id: true, createdAt: true });
export const insertPayFormulaSchema = createInsertSchema(payFormulas).omit({ id: true, createdAt: true });
export const insertContributingPayCodeSchema = createInsertSchema(contributingPayCodes).omit({ id: true, createdAt: true });
export const insertContributingShiftSchema = createInsertSchema(contributingShifts).omit({ id: true, createdAt: true });
export const insertRegularTimePolicySchema = createInsertSchema(regularTimePolicies).omit({ id: true, createdAt: true });
export const insertOvertimePolicySchema = createInsertSchema(overtimePolicies).omit({ id: true, createdAt: true });
export const insertPremiumPolicySchema = createInsertSchema(premiumPolicies).omit({ id: true, createdAt: true });
export const insertMealPolicySchema = createInsertSchema(mealPolicies).omit({ id: true, createdAt: true });
export const insertBreakPolicySchema = createInsertSchema(breakPolicies).omit({ id: true, createdAt: true });
export const insertSchedulePolicySchema = createInsertSchema(schedulePolicies).omit({ id: true, createdAt: true });
export const insertExceptionPolicySchema = createInsertSchema(exceptionPolicies).omit({ id: true, createdAt: true });
export const insertAccrualPolicySchema = createInsertSchema(accrualPolicies).omit({ id: true, createdAt: true });
export const insertAccrualPolicyMilestoneSchema = createInsertSchema(accrualPolicyMilestones).omit({ id: true, createdAt: true });
export const insertAbsencePolicySchema = createInsertSchema(absencePolicies).omit({ id: true, createdAt: true });
export const insertHolidayPolicySchema = createInsertSchema(holidayPolicies).omit({ id: true, createdAt: true });
export const insertRoundingPolicySchema = createInsertSchema(roundingPolicies).omit({ id: true, createdAt: true });
export const insertLegalEntitySchema = createInsertSchema(legalEntities).omit({ id: true, createdAt: true });

export const checkTemplates = pgTable("check_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  name: text("name").notNull(),
  templateType: text("template_type").default("standard"),
  layoutConfig: text("layout_config").default("{}"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCheckTemplateSchema = createInsertSchema(checkTemplates).omit({ id: true, createdAt: true });

export const workerDocuments = pgTable("worker_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").references(() => workers.id).notNull(),
  name: text("name").notNull(),
  documentType: text("document_type").default("other"),
  fileUrl: text("file_url").notNull(),
  notes: text("notes"),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

export const insertWorkerDocumentSchema = createInsertSchema(workerDocuments).omit({ id: true, uploadedAt: true });

export const roleScopeEnum = pgEnum("role_scope", ["enterprise", "company", "department", "branch"]);

export const roles = pgTable("roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  level: integer("level").notNull().default(5),
  isSystem: boolean("is_system").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const rolePermissions = pgTable("role_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roleId: varchar("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  resource: text("resource").notNull(),
  canView: boolean("can_view").default(false),
  canCreate: boolean("can_create").default(false),
  canEdit: boolean("can_edit").default(false),
  canDelete: boolean("can_delete").default(false),
  canExport: boolean("can_export").default(false),
  canApprove: boolean("can_approve").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userRoles = pgTable("user_roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: varchar("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  scopeType: roleScopeEnum("scope_type").default("company"),
  scopeId: varchar("scope_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRoleSchema = createInsertSchema(roles).omit({ id: true, createdAt: true });
export const insertRolePermissionSchema = createInsertSchema(rolePermissions).omit({ id: true, createdAt: true });
export const insertUserRoleSchema = createInsertSchema(userRoles).omit({ id: true, createdAt: true });

export type Role = typeof roles.$inferSelect;
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;
export type UserRole = typeof userRoles.$inferSelect;
export type InsertUserRole = z.infer<typeof insertUserRoleSchema>;

export type Enterprise = typeof enterprises.$inferSelect;
export type InsertEnterprise = z.infer<typeof insertEnterpriseSchema>;
export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Division = typeof divisions.$inferSelect;
export type InsertDivision = z.infer<typeof insertDivisionSchema>;
export type Position = typeof positions.$inferSelect;
export type InsertPosition = z.infer<typeof insertPositionSchema>;
export type CostCenter = typeof costCenters.$inferSelect;
export type InsertCostCenter = z.infer<typeof insertCostCenterSchema>;
export type Job = typeof jobs.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
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
export type EmployeeTitle = typeof employeeTitles.$inferSelect;
export type InsertEmployeeTitle = z.infer<typeof insertEmployeeTitleSchema>;
export type EmployeeGroup = typeof employeeGroups.$inferSelect;
export type InsertEmployeeGroup = z.infer<typeof insertEmployeeGroupSchema>;
export type WageHistory = typeof wageHistory.$inferSelect;
export type InsertWageHistory = z.infer<typeof insertWageHistorySchema>;
export type NewHireDefault = typeof newHireDefaults.$inferSelect;
export type InsertNewHireDefault = z.infer<typeof insertNewHireDefaultsSchema>;
export type PayFormula = typeof payFormulas.$inferSelect;
export type InsertPayFormula = z.infer<typeof insertPayFormulaSchema>;
export type ContributingPayCode = typeof contributingPayCodes.$inferSelect;
export type InsertContributingPayCode = z.infer<typeof insertContributingPayCodeSchema>;
export type ContributingShift = typeof contributingShifts.$inferSelect;
export type InsertContributingShift = z.infer<typeof insertContributingShiftSchema>;
export type RegularTimePolicy = typeof regularTimePolicies.$inferSelect;
export type InsertRegularTimePolicy = z.infer<typeof insertRegularTimePolicySchema>;
export type OvertimePolicy = typeof overtimePolicies.$inferSelect;
export type InsertOvertimePolicy = z.infer<typeof insertOvertimePolicySchema>;
export type PremiumPolicy = typeof premiumPolicies.$inferSelect;
export type InsertPremiumPolicy = z.infer<typeof insertPremiumPolicySchema>;
export type MealPolicy = typeof mealPolicies.$inferSelect;
export type InsertMealPolicy = z.infer<typeof insertMealPolicySchema>;
export type BreakPolicy = typeof breakPolicies.$inferSelect;
export type InsertBreakPolicy = z.infer<typeof insertBreakPolicySchema>;
export type SchedulePolicy = typeof schedulePolicies.$inferSelect;
export type InsertSchedulePolicy = z.infer<typeof insertSchedulePolicySchema>;
export type ExceptionPolicy = typeof exceptionPolicies.$inferSelect;
export type InsertExceptionPolicy = z.infer<typeof insertExceptionPolicySchema>;
export type AccrualPolicy = typeof accrualPolicies.$inferSelect;
export type InsertAccrualPolicy = z.infer<typeof insertAccrualPolicySchema>;
export type AccrualPolicyMilestone = typeof accrualPolicyMilestones.$inferSelect;
export type InsertAccrualPolicyMilestone = z.infer<typeof insertAccrualPolicyMilestoneSchema>;
export type AbsencePolicy = typeof absencePolicies.$inferSelect;
export type InsertAbsencePolicy = z.infer<typeof insertAbsencePolicySchema>;
export type HolidayPolicy = typeof holidayPolicies.$inferSelect;
export type InsertHolidayPolicy = z.infer<typeof insertHolidayPolicySchema>;
export type RoundingPolicy = typeof roundingPolicies.$inferSelect;
export type InsertRoundingPolicy = z.infer<typeof insertRoundingPolicySchema>;
export type LegalEntity = typeof legalEntities.$inferSelect;
export type InsertLegalEntity = z.infer<typeof insertLegalEntitySchema>;
export type CheckTemplate = typeof checkTemplates.$inferSelect;
export type InsertCheckTemplate = z.infer<typeof insertCheckTemplateSchema>;
export type WorkerDocument = typeof workerDocuments.$inferSelect;
export type InsertWorkerDocument = z.infer<typeof insertWorkerDocumentSchema>;

export const kpiGroups = pgTable("kpi_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const qualificationGroups = pgTable("qualification_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const workerLanguages = pgTable("worker_languages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  workerId: varchar("worker_id").references(() => workers.id),
  language: text("language").notNull(),
  proficiency: text("proficiency").default("basic"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const workerMemberships = pgTable("worker_memberships", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  workerId: varchar("worker_id").references(() => workers.id),
  organization: text("organization").notNull(),
  membershipNumber: text("membership_number"),
  startDate: date("start_date"),
  expirationDate: date("expiration_date"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertKpiGroupSchema = createInsertSchema(kpiGroups).omit({ id: true, createdAt: true });
export const insertQualificationGroupSchema = createInsertSchema(qualificationGroups).omit({ id: true, createdAt: true });
export const insertWorkerLanguageSchema = createInsertSchema(workerLanguages).omit({ id: true, createdAt: true });
export const insertWorkerMembershipSchema = createInsertSchema(workerMemberships).omit({ id: true, createdAt: true });

export type KpiGroup = typeof kpiGroups.$inferSelect;
export type InsertKpiGroup = z.infer<typeof insertKpiGroupSchema>;
export type QualificationGroup = typeof qualificationGroups.$inferSelect;
export type InsertQualificationGroup = z.infer<typeof insertQualificationGroupSchema>;
export type WorkerLanguage = typeof workerLanguages.$inferSelect;
export type InsertWorkerLanguage = z.infer<typeof insertWorkerLanguageSchema>;
export type WorkerMembership = typeof workerMemberships.$inferSelect;
export type InsertWorkerMembership = z.infer<typeof insertWorkerMembershipSchema>;

export const stations = pgTable("stations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  stationName: text("station_name").notNull(),
  location: text("location"),
  ipRestriction: text("ip_restriction"),
  description: text("description"),
  status: text("status").default("active"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const secondaryWageGroups = pgTable("secondary_wage_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  hourlyRate: numeric("hourly_rate").default("0"),
  overtimeRate: numeric("overtime_rate").default("0"),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const currencies = pgTable("currencies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id"),
  currencyCode: text("currency_code").notNull(),
  currencyName: text("currency_name").notNull(),
  symbol: text("symbol").default("$"),
  exchangeRate: numeric("exchange_rate").default("1"),
  isBaseCurrency: boolean("is_base_currency").default(false),
  status: text("status").default("active"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const employeeWageGroups = pgTable("employee_wage_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  wageGroupId: varchar("wage_group_id").notNull().references(() => secondaryWageGroups.id),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertStationSchema = createInsertSchema(stations).omit({ id: true, createdAt: true });
export const insertSecondaryWageGroupSchema = createInsertSchema(secondaryWageGroups).omit({ id: true, createdAt: true });
export const insertCurrencySchema = createInsertSchema(currencies).omit({ id: true, createdAt: true });
export const insertEmployeeWageGroupSchema = createInsertSchema(employeeWageGroups).omit({ id: true, createdAt: true });

export type Station = typeof stations.$inferSelect;
export type InsertStation = z.infer<typeof insertStationSchema>;
export type SecondaryWageGroup = typeof secondaryWageGroups.$inferSelect;
export type InsertSecondaryWageGroup = z.infer<typeof insertSecondaryWageGroupSchema>;
export type Currency = typeof currencies.$inferSelect;
export type InsertCurrency = z.infer<typeof insertCurrencySchema>;
export type EmployeeWageGroup = typeof employeeWageGroups.$inferSelect;
export type InsertEmployeeWageGroup = z.infer<typeof insertEmployeeWageGroupSchema>;

export const savedReports = pgTable("saved_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id"),
  name: varchar("name").notNull(),
  reportType: varchar("report_type").notNull(),
  category: varchar("category").notNull(),
  filters: text("filters"),
  data: text("data"),
  headers: text("headers"),
  rowCount: integer("row_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: varchar("created_by"),
});

export const insertSavedReportSchema = createInsertSchema(savedReports).omit({ id: true, createdAt: true });
export type SavedReport = typeof savedReports.$inferSelect;
export type InsertSavedReport = z.infer<typeof insertSavedReportSchema>;
