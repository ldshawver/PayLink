import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, numeric, date, pgEnum, serial, jsonb } from "drizzle-orm/pg-core";
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
  subscriptionStatus: text("subscription_status").default("active_paid"),
  planName: text("plan_name").default("starter"),
  trialStart: timestamp("trial_start"),
  trialEnd: timestamp("trial_end"),
  trialUsed: boolean("trial_used").default(false),
  billingActive: boolean("billing_active").default(false),
  paymentMethodOnFile: boolean("payment_method_on_file").default(false),
  isDemo: boolean("is_demo").default(false),
  nextCheckNumber: integer("next_check_number").default(1),
  stationEnforcementEnabled: boolean("station_enforcement_enabled").default(false),
  timezone: text("timezone").default("America/New_York"),
  timezoneConfirmed: boolean("timezone_confirmed").default(false),
  clockInGraceMinutes: integer("clock_in_grace_minutes").default(10),
  notifyMgrOnViolations: boolean("notify_mgr_on_violations").default(true),
  stripeFinancialAccountId: text("stripe_financial_account_id"),
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
  workerGroup: text("worker_group").default("hourly_employee"),
  compensationType: text("compensation_type").default("hourly"), // hourly | salary | commission | hybrid
  createdAt: timestamp("created_at").defaultNow(),
});

export const timePunches = pgTable("time_punches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  punchType: punchTypeEnum("punch_type").notNull(),
  punchTime: timestamp("punch_time").notNull().defaultNow(),
  note: text("note"),
  approvalStatus: text("approval_status").default("approved"),
  approvedBy: varchar("approved_by"),
  scheduleId: varchar("schedule_id"),
  stationId: varchar("station_id"),
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
  scheduleId: varchar("schedule_id"),
  scheduledStart: timestamp("scheduled_start"),
  scheduledEnd: timestamp("scheduled_end"),
  scheduledHours: numeric("scheduled_hours"),
  lateMinutes: integer("late_minutes").default(0),
  earlyDepartureMinutes: integer("early_departure_minutes").default(0),
  isUnscheduled: boolean("is_unscheduled").default(false),
  source: text("source").default("manual"),
  tipsAmount: numeric("tips_amount").default("0"),
  payCategory: text("pay_category").default("regular"), // regular | commission_hours | volunteer | special_event
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
  jobId: varchar("job_id").references(() => jobs.id),
  positionId: varchar("position_id"),
  costCenterId: varchar("cost_center_id"),
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
  payDate: date("pay_date"),
  useDirectDeposit: boolean("use_direct_deposit").default(true),
  isLocked: boolean("is_locked").default(false),
  fundingAccountId: varchar("funding_account_id"),
  achBatchId: varchar("ach_batch_id"),
  payrollSummaryId: varchar("payroll_summary_id"),
  createdAt: timestamp("created_at").defaultNow(),
  approvedAt: timestamp("approved_at"),
  approvedBy: varchar("approved_by"),
  achStatus: text("ach_status"),
  achSubmittedAt: timestamp("ach_submitted_at"),
  achSettledAt: timestamp("ach_settled_at"),
  lockedAt: timestamp("locked_at"),
  lockedBy: varchar("locked_by"),
  totalDeductions: numeric("total_deductions").default("0"),
  totalEmployerTaxes: numeric("total_employer_taxes").default("0"),
  totalReimbursements: numeric("total_reimbursements").default("0"),
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
  paymentMethod: text("payment_method"),
  paymentPlatform: text("payment_platform"),
  payMethodId: varchar("pay_method_id"),
  commissionPay: numeric("commission_pay").default("0"),
  commissionHours: numeric("commission_hours").default("0"),
  commissionHourlyPay: numeric("commission_hourly_pay").default("0"),
  volunteerHours: numeric("volunteer_hours").default("0"),
  specialEventHours: numeric("special_event_hours").default("0"),
  specialEventPay: numeric("special_event_pay").default("0"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").default("admin"),
  companyId: varchar("company_id"),
  workerId: varchar("worker_id"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const divisions = pgTable("divisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const departments = pgTable("departments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
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
  companyId: varchar("company_id").references(() => companies.id),
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
  companyId: varchar("company_id").references(() => companies.id),
  departmentId: varchar("department_id"),
  title: text("title").notNull(),
  description: text("description"),
  reportsToPositionId: varchar("reports_to_position_id"),
  salaryRangeMin: numeric("salary_range_min"),
  salaryRangeMax: numeric("salary_range_max"),
  isActive: boolean("is_active").default(true),
  isVolunteer: boolean("is_volunteer").default(false),
  payType: text("pay_type"),
  isTipped: boolean("is_tipped").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const costCenters = pgTable("cost_centers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  name: text("name").notNull(),
  code: text("code"),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  costCenterId: varchar("cost_center_id"),
  departmentId: varchar("department_id"),
  name: text("name").notNull(),
  description: text("description"),
  payType: text("pay_type").default("hourly"),
  defaultWage: numeric("default_wage"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  status: jobStatusEnum("status").default("active"),
  isSpecialEvent: boolean("is_special_event").default(false),
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
  platform: text("platform"),
  handle: text("handle"),
  stripeBankAccountId: text("stripe_bank_account_id"),
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
  remittanceAgencyId: varchar("remittance_agency_id"),
  effectiveDate: date("effective_date"),
  expiryDate: date("expiry_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const policyGroups = pgTable("policy_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
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
  department: text("department"),
  jobId: varchar("job_id").references(() => jobs.id),
  positionId: varchar("position_id"),
  costCenterId: varchar("cost_center_id"),
  note: text("note"),
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
  calibrationConfig: jsonb("calibration_config").$type<{
    globalTop?: number;
    globalLeft?: number;
    dateTop?: number;
    amountWordsTop?: number;
    memoTop?: number;
    signatureTop?: number;
  } | null>().default(null),
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
  amendmentType: text("amendment_type").default("earning"),
  status: text("status").default("active"),
  amountType: text("amount_type").default("fixed"),
  rate: numeric("rate").default("0"),
  units: numeric("units").default("0"),
  amount: numeric("amount").default("0"),
  percent: numeric("percent").default("0"),
  description: text("description"),
  publicNote: text("public_note"),
  effectiveDate: date("effective_date"),
  endDate: date("end_date"),
  isRecurring: boolean("is_recurring").default(false),
  appliedPayrollRunId: varchar("applied_payroll_run_id"),
  appliedAt: timestamp("applied_at"),
  approvalStatus: text("approval_status").default("pending"),
  approvedBy: varchar("approved_by"),
  approvedAt: timestamp("approved_at"),
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
  companyId: varchar("company_id").references(() => companies.id),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const employeeGroups = pgTable("employee_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
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
  companyId: varchar("company_id").references(() => companies.id),
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
  companyId: varchar("company_id").references(() => companies.id),
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
  companyId: varchar("company_id").references(() => companies.id),
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
  companyId: varchar("company_id").references(() => companies.id),
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
  companyId: varchar("company_id").references(() => companies.id),
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
  companyId: varchar("company_id").references(() => companies.id),
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
  companyId: varchar("company_id").references(() => companies.id),
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
  companyId: varchar("company_id").references(() => companies.id),
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
  companyId: varchar("company_id").references(() => companies.id),
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
  companyId: varchar("company_id").references(() => companies.id),
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
  companyId: varchar("company_id").references(() => companies.id),
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
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
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
  capabilities: text("capabilities"),
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
  canConfigure: boolean("can_configure").default(false),
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
  companyId: varchar("company_id").references(() => companies.id),
  stationName: text("station_name").notNull(),
  location: text("location"),
  ipRestriction: text("ip_restriction"),
  description: text("description"),
  status: text("status").default("active"),
  requiresSchedule: boolean("requires_schedule").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const secondaryWageGroups = pgTable("secondary_wage_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
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

export const receipts = pgTable("receipts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  workerId: varchar("worker_id").references(() => workers.id),
  costCenterId: varchar("cost_center_id"),
  jobId: varchar("job_id"),
  vendor: text("vendor"),
  description: text("description"),
  amount: numeric("amount").notNull().default("0"),
  receiptDate: text("receipt_date").notNull(),
  category: text("category").default("general"),
  receiptImagePath: text("receipt_image_path"),
  status: text("status").default("pending"),
  approvedBy: varchar("approved_by"),
  notes: text("notes"),
  includeInJobCost: boolean("include_in_job_cost").default(false),
  checkNumber: text("check_number"),
  paymentMethod: text("payment_method"),
  taxAmount: numeric("tax_amount"),
  subtotal: numeric("subtotal"),
  lineItems: text("line_items"),
  isReimbursement: boolean("is_reimbursement").default(false),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const shiftOffers = pgTable("shift_offers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scheduleId: varchar("schedule_id").notNull().references(() => schedules.id),
  offeredByWorkerId: varchar("offered_by_worker_id").notNull().references(() => workers.id),
  status: text("status").default("open"),
  claimedByWorkerId: varchar("claimed_by_worker_id").references(() => workers.id),
  approvedBy: varchar("approved_by"),
  notes: text("notes"),
  managerNote: text("manager_note"),
  offeredAt: timestamp("offered_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const employeeGroupConfigs = pgTable("employee_group_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupKey: text("group_key").notNull().unique(),
  label: text("label").notNull(),
  taxForm: text("tax_form").notNull().default("W-2"),
  payrollTaxesWithheld: boolean("payroll_taxes_withheld").notNull().default(true),
  employerTaxesApply: boolean("employer_taxes_apply").notNull().default(true),
  timeTracking: text("time_tracking").notNull().default("required"),
  overtimeEligible: boolean("overtime_eligible").notNull().default(true),
  invoiceWorkflow: boolean("invoice_workflow").notNull().default(false),
  distributions: boolean("distributions").notNull().default(false),
  volunteerEligible: boolean("volunteer_eligible").notNull().default(false),
  payrollEnabled: boolean("payroll_enabled").notNull().default(true),
  yearEndDocType: text("year_end_doc_type").notNull().default("W-2"),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEmployeeGroupConfigSchema = createInsertSchema(employeeGroupConfigs).omit({ id: true, createdAt: true });
export type EmployeeGroupConfig = typeof employeeGroupConfigs.$inferSelect;
export type InsertEmployeeGroupConfig = z.infer<typeof insertEmployeeGroupConfigSchema>;

export const insertStationSchema = createInsertSchema(stations).omit({ id: true, createdAt: true });
export const insertSecondaryWageGroupSchema = createInsertSchema(secondaryWageGroups).omit({ id: true, createdAt: true });
export const insertCurrencySchema = createInsertSchema(currencies).omit({ id: true, createdAt: true });
export const insertEmployeeWageGroupSchema = createInsertSchema(employeeWageGroups).omit({ id: true, createdAt: true });
export const insertReceiptSchema = createInsertSchema(receipts).omit({ id: true, createdAt: true });
export const insertShiftOfferSchema = createInsertSchema(shiftOffers).omit({ id: true, offeredAt: true, updatedAt: true });

export type Station = typeof stations.$inferSelect;
export type InsertStation = z.infer<typeof insertStationSchema>;
export type SecondaryWageGroup = typeof secondaryWageGroups.$inferSelect;
export type InsertSecondaryWageGroup = z.infer<typeof insertSecondaryWageGroupSchema>;
export type Currency = typeof currencies.$inferSelect;
export type InsertCurrency = z.infer<typeof insertCurrencySchema>;
export type EmployeeWageGroup = typeof employeeWageGroups.$inferSelect;
export type InsertEmployeeWageGroup = z.infer<typeof insertEmployeeWageGroupSchema>;
export type Receipt = typeof receipts.$inferSelect;
export type InsertReceipt = z.infer<typeof insertReceiptSchema>;
export type ShiftOffer = typeof shiftOffers.$inferSelect;
export type InsertShiftOffer = z.infer<typeof insertShiftOfferSchema>;

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

// ── Payroll Payment Methods (company-level lookup) ──────────────────────────
export const payrollPaymentMethods = pgTable("payroll_payment_methods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category").default("other"),
  isDigitalWallet: boolean("is_digital_wallet").default(false),
  isBankBased: boolean("is_bank_based").default(false),
  requiresReferenceNumber: boolean("requires_reference_number").default(false),
  requiresAccountSelection: boolean("requires_account_selection").default(true),
  active: boolean("active").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPayrollPaymentMethodSchema = createInsertSchema(payrollPaymentMethods).omit({ id: true, createdAt: true, updatedAt: true });
export type PayrollPaymentMethod = typeof payrollPaymentMethods.$inferSelect;
export type InsertPayrollPaymentMethod = z.infer<typeof insertPayrollPaymentMethodSchema>;

// ── Funding Accounts (company bank/wallet accounts used to fund payroll) ─────
export const fundingAccounts = pgTable("funding_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  accountCode: text("account_code"),
  accountName: text("account_name").notNull(),
  accountType: text("account_type").default("bank_checking"),
  institutionName: text("institution_name"),
  maskedIdentifier: text("masked_identifier"),
  currency: text("currency").default("USD"),
  active: boolean("active").default(true),
  allowForPayroll: boolean("allow_for_payroll").default(true),
  isDefault: boolean("is_default").default(false),
  reconciliationEnabled: boolean("reconciliation_enabled").default(false),
  openingBalance: numeric("opening_balance").default("0"),
  currentBalance: numeric("current_balance"),
  notes: text("notes"),
  remittanceSourceId: varchar("remittance_source_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFundingAccountSchema = createInsertSchema(fundingAccounts).omit({ id: true, createdAt: true, updatedAt: true });
export type FundingAccount = typeof fundingAccounts.$inferSelect;
export type InsertFundingAccount = z.infer<typeof insertFundingAccountSchema>;

// ── Payroll Payment Records (actual disbursement tracking) ───────────────────
export const payrollPaymentRecords = pgTable("payroll_payment_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  payrollRunId: varchar("payroll_run_id").references(() => payrollRuns.id),
  payrollItemId: varchar("payroll_item_id").references(() => payrollItems.id),
  workerId: varchar("worker_id").references(() => workers.id),
  payDate: date("pay_date"),
  payPeriodStart: date("pay_period_start"),
  payPeriodEnd: date("pay_period_end"),
  taxYear: integer("tax_year"),
  grossPayAmount: numeric("gross_pay_amount").default("0"),
  taxableWagesAmount: numeric("taxable_wages_amount").default("0"),
  employeeTaxWithheld: numeric("employee_tax_withheld").default("0"),
  employerTaxAmount: numeric("employer_tax_amount").default("0"),
  netPayAmount: numeric("net_pay_amount").default("0"),
  paymentMethodId: varchar("payment_method_id").references(() => payrollPaymentMethods.id),
  fundingAccountId: varchar("funding_account_id").references(() => fundingAccounts.id),
  paymentMethodCode: text("payment_method_code"),
  status: text("status").default("pending"),
  paymentReference: text("payment_reference"),
  externalTransactionId: text("external_transaction_id"),
  checkNumber: text("check_number"),
  memo: text("memo"),
  initiatedAt: timestamp("initiated_at"),
  paidAt: timestamp("paid_at"),
  clearedAt: timestamp("cleared_at"),
  voidedAt: timestamp("voided_at"),
  createdBy: varchar("created_by"),
  updatedBy: varchar("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPayrollPaymentRecordSchema = createInsertSchema(payrollPaymentRecords).omit({ id: true, createdAt: true, updatedAt: true });
export type PayrollPaymentRecord = typeof payrollPaymentRecords.$inferSelect;
export type InsertPayrollPaymentRecord = z.infer<typeof insertPayrollPaymentRecordSchema>;

// ── Time-Off Requests ──────────────────────────────────────────────────────
export const timeOffRequests = pgTable("time_off_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  requestType: text("request_type").notNull().default("vacation"),
  startDate: date("start_date").notNull(),
  startTime: text("start_time"),
  endDate: date("end_date").notNull(),
  endTime: text("end_time"),
  totalDays: numeric("total_days"),
  reason: text("reason"),
  status: text("status").notNull().default("pending"),
  reviewedBy: varchar("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTimeOffRequestSchema = createInsertSchema(timeOffRequests).omit({ id: true, createdAt: true, reviewedAt: true });
export type TimeOffRequest = typeof timeOffRequests.$inferSelect;
export type InsertTimeOffRequest = z.infer<typeof insertTimeOffRequestSchema>;

// ── Schedule Preferences ───────────────────────────────────────────────────
export const schedulePreferences = pgTable("schedule_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  preferenceType: text("preference_type").notNull().default("day_off"),
  dayOfWeek: integer("day_of_week"),
  shiftTime: text("shift_time"),
  preferNotToWork: boolean("prefer_not_to_work").notNull().default(false),
  importance: integer("importance").notNull().default(3),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSchedulePreferenceSchema = createInsertSchema(schedulePreferences).omit({ id: true, createdAt: true });
export type SchedulePreference = typeof schedulePreferences.$inferSelect;
export type InsertSchedulePreference = z.infer<typeof insertSchedulePreferenceSchema>;

// ── Shift Marketplace Listings ────────────────────────────────────────────
export const shiftMarketplaceListings = pgTable("shift_marketplace_listings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scheduleId: varchar("schedule_id").notNull().references(() => schedules.id),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  listedByWorkerId: varchar("listed_by_worker_id").notNull().references(() => workers.id),
  listingType: text("listing_type").notNull().default("offer"),
  reason: text("reason"),
  urgency: text("urgency").notNull().default("normal"),
  emergencyCoverage: boolean("emergency_coverage").notNull().default(false),
  employeeAcknowledgedResponsibility: boolean("employee_acknowledged_responsibility").notNull().default(false),
  eligibilityRuleSetId: varchar("eligibility_rule_set_id"),
  status: text("status").notNull().default("open"),
  expiresAt: timestamp("expires_at"),
  filledByWorkerId: varchar("filled_by_worker_id"),
  filledAt: timestamp("filled_at"),
  approvedBy: varchar("approved_by"),
  approvedAt: timestamp("approved_at"),
  withdrawnAt: timestamp("withdrawn_at"),
  withdrawnReason: text("withdrawn_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertShiftMarketplaceListingSchema = createInsertSchema(shiftMarketplaceListings).omit({ id: true, createdAt: true, updatedAt: true, filledAt: true, approvedAt: true, withdrawnAt: true });
export type ShiftMarketplaceListing = typeof shiftMarketplaceListings.$inferSelect;
export type InsertShiftMarketplaceListing = z.infer<typeof insertShiftMarketplaceListingSchema>;

// ── Shift Marketplace Requests ────────────────────────────────────────────
export const shiftMarketplaceRequests = pgTable("shift_marketplace_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  listingId: varchar("listing_id").notNull().references(() => shiftMarketplaceListings.id),
  requestingWorkerId: varchar("requesting_worker_id").notNull().references(() => workers.id),
  requestType: text("request_type").notNull().default("pickup"),
  proposedShiftId: varchar("proposed_shift_id"),
  note: text("note"),
  eligibilitySnapshotJson: text("eligibility_snapshot_json"),
  conflictSnapshotJson: text("conflict_snapshot_json"),
  status: text("status").notNull().default("pending"),
  reviewedBy: varchar("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertShiftMarketplaceRequestSchema = createInsertSchema(shiftMarketplaceRequests).omit({ id: true, createdAt: true, updatedAt: true, reviewedAt: true });
export type ShiftMarketplaceRequest = typeof shiftMarketplaceRequests.$inferSelect;
export type InsertShiftMarketplaceRequest = z.infer<typeof insertShiftMarketplaceRequestSchema>;

// ── Eligibility Rule Sets ─────────────────────────────────────────────────
export const eligibilityRuleSets = pgTable("eligibility_rule_sets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  name: text("name").notNull(),
  description: text("description"),
  requireSameCompany: boolean("require_same_company").notNull().default(true),
  requireSameDepartment: boolean("require_same_department").notNull().default(true),
  requireSameBranch: boolean("require_same_branch").notNull().default(true),
  requireSameEmployeeGroup: boolean("require_same_employee_group").notNull().default(true),
  requireSamePosition: boolean("require_same_position").notNull().default(false),
  requireNoScheduleConflict: boolean("require_no_schedule_conflict").notNull().default(true),
  requireNoLeaveConflict: boolean("require_no_leave_conflict").notNull().default(true),
  requireActiveStatus: boolean("require_active_status").notNull().default(true),
  maxWeeklyHours: numeric("max_weekly_hours"),
  minRestHours: numeric("min_rest_hours"),
  requireCertifications: boolean("require_certifications").notNull().default(false),
  allowOvertimePickup: boolean("allow_overtime_pickup").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEligibilityRuleSetSchema = createInsertSchema(eligibilityRuleSets).omit({ id: true, createdAt: true });
export type EligibilityRuleSet = typeof eligibilityRuleSets.$inferSelect;
export type InsertEligibilityRuleSet = z.infer<typeof insertEligibilityRuleSetSchema>;

// ── Schedule Audit Logs ───────────────────────────────────────────────────
export const scheduleAuditLogs = pgTable("schedule_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  actorUserId: varchar("actor_user_id"),
  actorWorkerId: varchar("actor_worker_id"),
  actionType: text("action_type").notNull(),
  objectType: text("object_type").notNull(),
  objectId: varchar("object_id"),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  metadataJson: text("metadata_json"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertScheduleAuditLogSchema = createInsertSchema(scheduleAuditLogs).omit({ id: true, createdAt: true });
export type ScheduleAuditLog = typeof scheduleAuditLogs.$inferSelect;
export type InsertScheduleAuditLog = z.infer<typeof insertScheduleAuditLogSchema>;

// ── Notification Preferences ──────────────────────────────────────────────
export const notificationPreferences = pgTable("notification_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  eventType: text("event_type").notNull(),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  smsEnabled: boolean("sms_enabled").notNull().default(true),
  inAppEnabled: boolean("in_app_enabled").notNull().default(true),
  pushEnabled: boolean("push_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertNotificationPreferenceSchema = createInsertSchema(notificationPreferences).omit({ id: true, createdAt: true, updatedAt: true });
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreference = z.infer<typeof insertNotificationPreferenceSchema>;

// ── Expense Categories ───────────────────────────────────────────────────
export const expenseCategories = pgTable("expense_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  accountingCode: text("accounting_code"),
  payrollReimbursementCode: text("payroll_reimbursement_code"),
  reimbursableDefault: boolean("reimbursable_default").notNull().default(false),
  receiptRequired: boolean("receipt_required").notNull().default(true),
  preapprovalRequired: boolean("preapproval_required").notNull().default(false),
  projectRequired: boolean("project_required").notNull().default(false),
  costCenterRequired: boolean("cost_center_required").notNull().default(false),
  allowedWorkerGroups: text("allowed_worker_groups"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertExpenseCategorySchema = createInsertSchema(expenseCategories).omit({ id: true, createdAt: true });
export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type InsertExpenseCategory = z.infer<typeof insertExpenseCategorySchema>;

// ── Expenses ─────────────────────────────────────────────────────────────
export const expenses = pgTable("expenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  submitterId: varchar("submitter_id").notNull().references(() => workers.id),
  categoryId: varchar("category_id"),
  categoryName: text("category_name"),
  expenseDate: text("expense_date").notNull(),
  amount: numeric("amount").notNull(),
  taxAmount: numeric("tax_amount"),
  subtotal: numeric("subtotal"),
  vendor: text("vendor"),
  description: text("description"),
  businessPurpose: text("business_purpose"),
  reimbursementRequested: boolean("reimbursement_requested").notNull().default(false),
  paymentMethodUsed: text("payment_method_used"),
  projectId: varchar("project_id"),
  jobId: varchar("job_id"),
  costCenterId: varchar("cost_center_id"),
  preapprovalStatus: text("preapproval_status"),
  preapprovalReference: text("preapproval_reference"),
  status: text("status").notNull().default("draft"),
  approvedBy: varchar("approved_by"),
  approvedAt: timestamp("approved_at"),
  rejectedBy: varchar("rejected_by"),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  reimbursementStatus: text("reimbursement_status"),
  payrollRunId: varchar("payroll_run_id"),
  exportStatus: text("export_status").default("pending"),
  exportedAt: timestamp("exported_at"),
  lineItems: text("line_items"),
  aiExtractedJson: text("ai_extracted_json"),
  aiConfidenceScore: numeric("ai_confidence_score"),
  duplicateHash: text("duplicate_hash"),
  recurringTemplateId: varchar("recurring_template_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertExpenseSchema = createInsertSchema(expenses).omit({ id: true, createdAt: true, updatedAt: true });
export type Expense = typeof expenses.$inferSelect;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;

// ── Expense Attachments ──────────────────────────────────────────────────
export const expenseAttachments = pgTable("expense_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  expenseId: varchar("expense_id").notNull(),
  filePath: text("file_path").notNull(),
  fileName: text("file_name"),
  fileType: text("file_type"),
  fileSize: integer("file_size"),
  isReceipt: boolean("is_receipt").notNull().default(true),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

export const insertExpenseAttachmentSchema = createInsertSchema(expenseAttachments).omit({ id: true, uploadedAt: true });
export type ExpenseAttachment = typeof expenseAttachments.$inferSelect;
export type InsertExpenseAttachment = z.infer<typeof insertExpenseAttachmentSchema>;

// ── Contractor Invoices ──────────────────────────────────────────────────
export const contractorInvoices = pgTable("contractor_invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  contractorId: varchar("contractor_id").notNull().references(() => workers.id),
  invoiceNumber: text("invoice_number"),
  title: text("title"),
  invoiceType: text("invoice_type").default("standard"), // deposit | progress | final | time_and_materials | change_order | standard
  invoiceDate: text("invoice_date").notNull(),
  dueDate: text("due_date"),
  amount: numeric("amount").notNull(),
  taxAmount: numeric("tax_amount"),
  discountAmount: numeric("discount_amount"),
  amountPaid: numeric("amount_paid").default("0"),
  balanceDue: numeric("balance_due"),
  reminderEnabled: boolean("reminder_enabled").default(true),
  lastReminderSentAt: timestamp("last_reminder_sent_at"),
  nextReminderAt: timestamp("next_reminder_at"),
  description: text("description"),
  proposalId: varchar("proposal_id"),
  contractId: varchar("contract_id"),
  proposalReference: text("proposal_reference"),
  projectId: varchar("project_id"),
  jobId: varchar("job_id"),
  costCenterId: varchar("cost_center_id"),
  approvedBudget: numeric("approved_budget"),
  approvedHours: numeric("approved_hours"),
  approvedTerms: text("approved_terms"),
  tradeComponent: text("trade_component"),
  paymentTerms: text("payment_terms"),
  status: text("status").notNull().default("draft"),
  approvedBy: varchar("approved_by"),
  approvedAt: timestamp("approved_at"),
  rejectedBy: varchar("rejected_by"),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  paidAt: timestamp("paid_at"),
  paidAmount: numeric("paid_amount"),
  paymentReference: text("payment_reference"),
  paymentMethod: text("payment_method"),
  exportStatus: text("export_status").default("pending"),
  exportedAt: timestamp("exported_at"),
  is1099Reportable: boolean("is_1099_reportable").notNull().default(true),
  lineItems: text("line_items"),
  aiExtractedJson: text("ai_extracted_json"),
  aiConfidenceScore: numeric("ai_confidence_score"),
  duplicateHash: text("duplicate_hash"),
  notes: text("notes"),
  isArchived: boolean("is_archived").default(false),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertContractorInvoiceSchema = createInsertSchema(contractorInvoices).omit({ id: true, createdAt: true, updatedAt: true });
export type ContractorInvoice = typeof contractorInvoices.$inferSelect;
export type InsertContractorInvoice = z.infer<typeof insertContractorInvoiceSchema>;

// ── Contractor Invoice Attachments ───────────────────────────────────────
export const contractorInvoiceAttachments = pgTable("contractor_invoice_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull(),
  filePath: text("file_path").notNull(),
  fileName: text("file_name"),
  fileType: text("file_type"),
  fileSize: integer("file_size"),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

export const insertContractorInvoiceAttachmentSchema = createInsertSchema(contractorInvoiceAttachments).omit({ id: true, uploadedAt: true });
export type ContractorInvoiceAttachment = typeof contractorInvoiceAttachments.$inferSelect;
export type InsertContractorInvoiceAttachment = z.infer<typeof insertContractorInvoiceAttachmentSchema>;

// ── Contractor Proposals ──────────────────────────────────────────────────
export const contractorProposals = pgTable("contractor_proposals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  contractorId: varchar("contractor_id").notNull().references(() => workers.id),
  proposalNumber: text("proposal_number"),
  title: text("title"),
  description: text("description"),
  // ── Enhanced proposal fields ──
  scopeOfWork: text("scope_of_work"),
  assumptions: text("assumptions"),
  exclusions: text("exclusions"),
  allowances: text("allowances"),
  materials: text("materials"),
  warrantyNotes: text("warranty_notes"),
  scheduleNotes: text("schedule_notes"),
  internalNotes: text("internal_notes"),
  clientMessage: text("client_message"),
  estimatorName: text("estimator_name"),
  // ── Versioning ──
  version: integer("version").default(1),
  revisionOfId: varchar("revision_of_id"),
  parentProposalId: varchar("parent_proposal_id"),
  isChangeOrder: boolean("is_change_order").default(false),
  // ── Dates ──
  issueDate: text("issue_date").notNull(),
  expirationDate: text("expiration_date"),
  sentAt: timestamp("sent_at"),
  viewedAt: timestamp("viewed_at"),
  declinedAt: timestamp("declined_at"),
  // ── Financials ──
  subtotal: numeric("subtotal"),
  taxAmount: numeric("tax_amount"),
  discountAmount: numeric("discount_amount"),
  amount: numeric("amount"),
  currency: text("currency").default("USD"),
  // ── Terms ──
  paymentTerms: text("payment_terms"),
  changeOrderTerms: text("change_order_terms"),
  notes: text("notes"),
  terms: text("terms"),
  // ── Approval / Signature capture ──
  approvalName: text("approval_name"),
  approvalEmail: text("approval_email"),
  approvalAt: timestamp("approval_at"),
  approvalIp: text("approval_ip"),
  approvalMethod: text("approval_method"),
  approvalNotes: text("approval_notes"),
  // ── AI ──
  aiGeneratedSummary: text("ai_generated_summary"),
  // ── Legacy / status ──
  lineItems: text("line_items"),
  status: text("status").notNull().default("draft"),
  submittedAt: timestamp("submitted_at"),
  reviewedByUserId: varchar("reviewed_by_user_id"),
  reviewedAt: timestamp("reviewed_at"),
  rejectionReason: text("rejection_reason"),
  convertedToInvoiceId: varchar("converted_to_invoice_id"),
  convertedToContractId: varchar("converted_to_contract_id"),
  jobId: varchar("job_id"),
  costCenterId: varchar("cost_center_id"),
  // ── Extended fields (added via migration) ──
  workType: text("work_type"),
  estimatedHours: numeric("estimated_hours"),
  estimatedLaborBudget: numeric("estimated_labor_budget"),
  paymentType: text("payment_type").default("monetary"), // monetary | trade | hybrid
  tradeOffered: text("trade_offered"),
  tradeValue: numeric("trade_value"),
  tradeTerms: text("trade_terms"),
  templateId: varchar("template_id"),
  brandingId: varchar("branding_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertContractorProposalSchema = createInsertSchema(contractorProposals).omit({ id: true, createdAt: true, updatedAt: true });
export type ContractorProposal = typeof contractorProposals.$inferSelect;
export type InsertContractorProposal = z.infer<typeof insertContractorProposalSchema>;

// ── Proposal Line Items ────────────────────────────────────────────────────
export const proposalLineItems = pgTable("proposal_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  proposalId: varchar("proposal_id").notNull(),
  sortOrder: integer("sort_order").default(0),
  category: text("category"),
  name: text("name").notNull(),
  description: text("description"),
  quantity: numeric("quantity").default("1"),
  unit: text("unit"),
  unitPrice: numeric("unit_price").default("0"),
  cost: numeric("cost"),
  markupPercent: numeric("markup_percent"),
  taxable: boolean("taxable").default(false),
  optional: boolean("optional").default(false),
  selected: boolean("selected").default(true),
  lineTotal: numeric("line_total").default("0"),
  aiGenerated: boolean("ai_generated").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertProposalLineItemSchema = createInsertSchema(proposalLineItems).omit({ id: true, createdAt: true, updatedAt: true });
export type ProposalLineItem = typeof proposalLineItems.$inferSelect;
export type InsertProposalLineItem = z.infer<typeof insertProposalLineItemSchema>;

// ── Proposal Attachments ──────────────────────────────────────────────────
export const proposalAttachments = pgTable("proposal_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  proposalId: varchar("proposal_id").notNull(),
  filePath: text("file_path").notNull(),
  fileName: text("file_name"),
  fileType: text("file_type"),
  fileSize: integer("file_size"),
  attachmentType: text("attachment_type").default("supporting_doc"), // blueprint | site_photo | vendor_quote | supporting_doc | signed_approval | change_order_backup
  aiSummary: text("ai_summary"),
  uploadedByWorkerId: varchar("uploaded_by_worker_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertProposalAttachmentSchema = createInsertSchema(proposalAttachments).omit({ id: true, createdAt: true });
export type ProposalAttachment = typeof proposalAttachments.$inferSelect;
export type InsertProposalAttachment = z.infer<typeof insertProposalAttachmentSchema>;

// ── Proposal Approval Events (audit log) ─────────────────────────────────
export const proposalApprovalEvents = pgTable("proposal_approval_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  proposalId: varchar("proposal_id").notNull(),
  eventType: text("event_type").notNull(), // created | submitted | viewed | approved | declined | revision_requested | superseded | expired | sent
  oldStatus: text("old_status"),
  newStatus: text("new_status"),
  actorUserId: varchar("actor_user_id"),
  actorName: text("actor_name"),
  actorEmail: text("actor_email"),
  notes: text("notes"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertProposalApprovalEventSchema = createInsertSchema(proposalApprovalEvents).omit({ id: true, createdAt: true });
export type ProposalApprovalEvent = typeof proposalApprovalEvents.$inferSelect;
export type InsertProposalApprovalEvent = z.infer<typeof insertProposalApprovalEventSchema>;

// ── Extended fields for contractor_proposals (added via migration) ────────
// workType, estimatedHours, estimatedLaborBudget, paymentType, tradeOffered,
// tradeValue, tradeTerms, templateId, brandingId are added via ALTER TABLE below
// (Drizzle columns declared in contractorProposals table extension below)

// ── Proposal Versions (immutable snapshots per revision) ──────────────────
export const proposalVersions = pgTable("proposal_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  proposalId: varchar("proposal_id").notNull(),
  version: integer("version").notNull(),
  snapshotJson: text("snapshot_json").notNull(), // full JSON snapshot of proposal + line items
  changeNotes: text("change_notes"),
  createdByUserId: varchar("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertProposalVersionSchema = createInsertSchema(proposalVersions).omit({ id: true, createdAt: true });
export type ProposalVersion = typeof proposalVersions.$inferSelect;
export type InsertProposalVersion = z.infer<typeof insertProposalVersionSchema>;

// ── Proposal Negotiations (counter-offer records) ─────────────────────────
export const proposalNegotiations = pgTable("proposal_negotiations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  proposalId: varchar("proposal_id").notNull(),
  initiatedByWorkerId: varchar("initiated_by_worker_id"),
  initiatedByUserId: varchar("initiated_by_user_id"),
  direction: text("direction").notNull().default("company_to_contractor"), // contractor_to_company | company_to_contractor
  status: text("status").notNull().default("pending"), // pending | accepted | rejected | superseded
  proposedAmount: numeric("proposed_amount"),
  proposedTerms: text("proposed_terms"),
  counterNotes: text("counter_notes"),
  respondedAt: timestamp("responded_at"),
  respondedByUserId: varchar("responded_by_user_id"),
  responseNotes: text("response_notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertProposalNegotiationSchema = createInsertSchema(proposalNegotiations).omit({ id: true, createdAt: true });
export type ProposalNegotiation = typeof proposalNegotiations.$inferSelect;
export type InsertProposalNegotiation = z.infer<typeof insertProposalNegotiationSchema>;

// ── Contractor Contracts ──────────────────────────────────────────────────
export const contractorContracts = pgTable("contractor_contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  contractorId: varchar("contractor_id").notNull().references(() => workers.id),
  proposalId: varchar("proposal_id"),
  contractNumber: text("contract_number"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"), // draft | sent | partially_signed | fully_signed | active | completed | terminated | void
  contractType: text("contract_type").default("service"), // service | fixed_price | time_and_materials | retainer | subcontract
  startDate: text("start_date"),
  endDate: text("end_date"),
  totalValue: numeric("total_value"),
  currency: text("currency").default("USD"),
  paymentType: text("payment_type").default("monetary"), // monetary | trade | hybrid
  tradeDetails: text("trade_details"),
  tradeValue: numeric("trade_value"),
  paymentTerms: text("payment_terms"),
  scopeOfWork: text("scope_of_work"),
  specialTerms: text("special_terms"),
  governingLaw: text("governing_law"),
  confidentiality: boolean("confidentiality").default(false),
  nonCompete: boolean("non_compete").default(false),
  bodyHtml: text("body_html"),
  bodyMarkdown: text("body_markdown"),
  signedPdfPath: text("signed_pdf_path"),
  templateId: varchar("template_id"),
  sentAt: timestamp("sent_at"),
  fullySignedAt: timestamp("fully_signed_at"),
  voidedAt: timestamp("voided_at"),
  voidReason: text("void_reason"),
  createdByUserId: varchar("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertContractorContractSchema = createInsertSchema(contractorContracts).omit({ id: true, createdAt: true, updatedAt: true });
export type ContractorContract = typeof contractorContracts.$inferSelect;
export type InsertContractorContract = z.infer<typeof insertContractorContractSchema>;

// ── Contract Signers ──────────────────────────────────────────────────────
export const contractSigners = pgTable("contract_signers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull(),
  signerType: text("signer_type").notNull().default("worker"), // worker | user | external
  workerId: varchar("worker_id"),
  userId: varchar("user_id"),
  name: text("name").notNull(),
  email: text("email"),
  role: text("role").default("contractor"), // contractor | company_rep | witness | notary
  order: integer("order").default(1),
  status: text("status").notNull().default("pending"), // pending | signed | declined | voided
  signedAt: timestamp("signed_at"),
  signatureData: text("signature_data"), // base64 or path
  ipAddress: text("ip_address"),
  reminderSentAt: timestamp("reminder_sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertContractSignerSchema = createInsertSchema(contractSigners).omit({ id: true, createdAt: true });
export type ContractSigner = typeof contractSigners.$inferSelect;
export type InsertContractSigner = z.infer<typeof insertContractSignerSchema>;

// ── Contract Versions (immutable signed snapshots) ────────────────────────
export const contractVersions = pgTable("contract_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull(),
  version: integer("version").notNull(),
  snapshotHtml: text("snapshot_html"),
  snapshotJson: text("snapshot_json"),
  pdfPath: text("pdf_path"),
  reason: text("reason"),
  createdByUserId: varchar("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertContractVersionSchema = createInsertSchema(contractVersions).omit({ id: true, createdAt: true });
export type ContractVersion = typeof contractVersions.$inferSelect;
export type InsertContractVersion = z.infer<typeof insertContractVersionSchema>;

// ── DAM Documents (Document Asset Management) ─────────────────────────────
export const damDocuments = pgTable("dam_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id"),
  workerId: varchar("worker_id"),
  ownerType: text("owner_type").notNull().default("worker"), // worker | company | platform
  documentType: text("document_type").notNull().default("general"), // proposal | contract | invoice | attachment | template | certificate | insurance | license | general
  title: text("title").notNull(),
  description: text("description"),
  filePath: text("file_path").notNull(),
  fileName: text("file_name"),
  fileType: text("file_type"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  tags: text("tags"), // comma-separated
  isArchived: boolean("is_archived").default(false),
  isPublic: boolean("is_public").default(false),
  expiresAt: timestamp("expires_at"),
  linkedEntityType: text("linked_entity_type"), // proposal | contract | invoice
  linkedEntityId: varchar("linked_entity_id"),
  uploadedByUserId: varchar("uploaded_by_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDamDocumentSchema = createInsertSchema(damDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type DamDocument = typeof damDocuments.$inferSelect;
export type InsertDamDocument = z.infer<typeof insertDamDocumentSchema>;

// ── DAM Document Access Log ───────────────────────────────────────────────
export const damDocumentAccessLogs = pgTable("dam_document_access_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull(),
  accessedByUserId: varchar("accessed_by_user_id"),
  accessedByWorkerId: varchar("accessed_by_worker_id"),
  action: text("action").notNull().default("view"), // view | download | share | print
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDamDocumentAccessLogSchema = createInsertSchema(damDocumentAccessLogs).omit({ id: true, createdAt: true });
export type DamDocumentAccessLog = typeof damDocumentAccessLogs.$inferSelect;
export type InsertDamDocumentAccessLog = z.infer<typeof insertDamDocumentAccessLogSchema>;

// ── Contractor Templates (proposal/invoice/contract templates) ────────────
export const contractorTemplates = pgTable("contractor_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id"),
  templateType: text("template_type").notNull().default("proposal"), // proposal | invoice | contract
  name: text("name").notNull(),
  description: text("description"),
  industry: text("industry"),
  bodyJson: text("body_json"), // JSON template structure
  defaultPaymentTerms: text("default_payment_terms"),
  defaultScopeTemplate: text("default_scope_template"),
  defaultAssumptions: text("default_assumptions"),
  defaultExclusions: text("default_exclusions"),
  defaultWarranty: text("default_warranty"),
  isGlobal: boolean("is_global").default(false), // platform-wide template
  isActive: boolean("is_active").default(true),
  usageCount: integer("usage_count").default(0),
  createdByUserId: varchar("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertContractorTemplateSchema = createInsertSchema(contractorTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type ContractorTemplate = typeof contractorTemplates.$inferSelect;
export type InsertContractorTemplate = z.infer<typeof insertContractorTemplateSchema>;

// ── Contractor Branding (per-contractor brand settings) ───────────────────
export const contractorBranding = pgTable("contractor_branding", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().unique(),
  businessName: text("business_name"),
  tagline: text("tagline"),
  logoPath: text("logo_path"),
  primaryColor: text("primary_color").default("#0f766e"),
  secondaryColor: text("secondary_color").default("#64748b"),
  fontFamily: text("font_family").default("Inter"),
  coverNote: text("cover_note"),
  signatureText: text("signature_text"),
  websiteUrl: text("website_url"),
  licenseNumber: text("license_number"),
  insuranceInfo: text("insurance_info"),
  footerText: text("footer_text"),
  showLogo: boolean("show_logo").default(true),
  showLicenseNumber: boolean("show_license_number").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertContractorBrandingSchema = createInsertSchema(contractorBranding).omit({ id: true, createdAt: true, updatedAt: true });
export type ContractorBranding = typeof contractorBranding.$inferSelect;
export type InsertContractorBranding = z.infer<typeof insertContractorBrandingSchema>;

// ── Contractor In-App Notifications ──────────────────────────────────────
export const contractorNotifications = pgTable("contractor_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id"),
  userId: varchar("user_id"),
  companyId: varchar("company_id"),
  notificationType: text("notification_type").notNull(), // proposal_approved | proposal_rejected | proposal_revision_requested | contract_signed | invoice_paid | invoice_overdue | reminder | general
  title: text("title").notNull(),
  body: text("body"),
  entityType: text("entity_type"), // proposal | contract | invoice | dam_document
  entityId: varchar("entity_id"),
  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),
  actionUrl: text("action_url"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertContractorNotificationSchema = createInsertSchema(contractorNotifications).omit({ id: true, createdAt: true });
export type ContractorNotification = typeof contractorNotifications.$inferSelect;
export type InsertContractorNotification = z.infer<typeof insertContractorNotificationSchema>;

// ── Contractor Reminders (scheduled follow-ups) ───────────────────────────
export const contractorReminders = pgTable("contractor_reminders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id"),
  userId: varchar("user_id"),
  companyId: varchar("company_id"),
  entityType: text("entity_type").notNull(), // proposal | contract | invoice | general
  entityId: varchar("entity_id"),
  reminderType: text("reminder_type").notNull().default("follow_up"), // follow_up | payment | expiry | signature | custom
  title: text("title").notNull(),
  notes: text("notes"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  channel: text("channel").default("in_app"), // in_app | email | sms | all
  status: text("status").notNull().default("pending"), // pending | sent | dismissed | completed
  sentAt: timestamp("sent_at"),
  dismissedAt: timestamp("dismissed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertContractorReminderSchema = createInsertSchema(contractorReminders).omit({ id: true, createdAt: true, updatedAt: true });
export type ContractorReminder = typeof contractorReminders.$inferSelect;
export type InsertContractorReminder = z.infer<typeof insertContractorReminderSchema>;

// ── Contractor Payments (invoice payments) ────────────────────────────────
export const contractorPayments = pgTable("contractor_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull(),
  companyId: varchar("company_id"),
  contractorId: varchar("contractor_id"),
  amount: numeric("amount").notNull(),
  paymentMethod: text("payment_method"),
  paymentProvider: text("payment_provider"),
  externalPaymentId: text("external_payment_id"),
  status: text("status").notNull().default("completed"),
  paidAt: timestamp("paid_at").defaultNow(),
  referenceNumber: text("reference_number"),
  notes: text("notes"),
  recordedByUserId: varchar("recorded_by_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertContractorPaymentSchema = createInsertSchema(contractorPayments).omit({ id: true, createdAt: true });
export type ContractorPayment = typeof contractorPayments.$inferSelect;
export type InsertContractorPayment = z.infer<typeof insertContractorPaymentSchema>;

// ── Contractor Reminder Logs ──────────────────────────────────────────────
export const contractorReminderLogs = pgTable("contractor_reminder_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entityType: text("entity_type").notNull(), // proposal | invoice
  entityId: varchar("entity_id").notNull(),
  channel: text("channel").notNull(), // email | sms
  recipient: text("recipient"),
  templateKey: text("template_key"),
  subject: text("subject"),
  body: text("body"),
  status: text("status").notNull().default("sent"), // sent | failed | skipped
  sentAt: timestamp("sent_at").defaultNow(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertContractorReminderLogSchema = createInsertSchema(contractorReminderLogs).omit({ id: true, createdAt: true });
export type ContractorReminderLog = typeof contractorReminderLogs.$inferSelect;
export type InsertContractorReminderLog = z.infer<typeof insertContractorReminderLogSchema>;

// ── Recurring Expense Templates ──────────────────────────────────────────
export const recurringExpenseTemplates = pgTable("recurring_expense_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  submitterId: varchar("submitter_id").notNull().references(() => workers.id),
  categoryId: varchar("category_id"),
  categoryName: text("category_name"),
  vendor: text("vendor"),
  description: text("description"),
  amount: numeric("amount").notNull(),
  reimbursementRequested: boolean("reimbursement_requested").notNull().default(false),
  projectId: varchar("project_id"),
  jobId: varchar("job_id"),
  costCenterId: varchar("cost_center_id"),
  frequency: text("frequency").notNull().default("monthly"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  nextDueDate: text("next_due_date"),
  isActive: boolean("is_active").notNull().default(true),
  lastGeneratedAt: timestamp("last_generated_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRecurringExpenseTemplateSchema = createInsertSchema(recurringExpenseTemplates).omit({ id: true, createdAt: true });
export type RecurringExpenseTemplate = typeof recurringExpenseTemplates.$inferSelect;
export type InsertRecurringExpenseTemplate = z.infer<typeof insertRecurringExpenseTemplateSchema>;

// ── Expense Approval Actions (immutable audit log) ───────────────────────
export const expenseApprovalActions = pgTable("expense_approval_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  objectType: text("object_type").notNull(),
  objectId: varchar("object_id").notNull(),
  actionType: text("action_type").notNull(),
  actorUserId: varchar("actor_user_id"),
  actorWorkerId: varchar("actor_worker_id"),
  companyId: varchar("company_id"),
  previousStatus: text("previous_status"),
  newStatus: text("new_status"),
  notes: text("notes"),
  metadataJson: text("metadata_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertExpenseApprovalActionSchema = createInsertSchema(expenseApprovalActions).omit({ id: true, createdAt: true });
export type ExpenseApprovalAction = typeof expenseApprovalActions.$inferSelect;
export type InsertExpenseApprovalAction = z.infer<typeof insertExpenseApprovalActionSchema>;

// ── Payroll Reimbursement Items ──────────────────────────────────────────
export const payrollReimbursementItems = pgTable("payroll_reimbursement_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  expenseId: varchar("expense_id").notNull(),
  payrollRunId: varchar("payroll_run_id"),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  companyId: varchar("company_id").references(() => companies.id),
  amount: numeric("amount").notNull(),
  isTaxable: boolean("is_taxable").notNull().default(false),
  description: text("description"),
  status: text("status").notNull().default("pending"),
  includedInPayrollAt: timestamp("included_in_payroll_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPayrollReimbursementItemSchema = createInsertSchema(payrollReimbursementItems).omit({ id: true, createdAt: true });
export type PayrollReimbursementItem = typeof payrollReimbursementItems.$inferSelect;
export type InsertPayrollReimbursementItem = z.infer<typeof insertPayrollReimbursementItemSchema>;

// ── Trial Signups ──────────────────────────────────────────
export const trialSignups = pgTable("trial_signups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyName: text("company_name").notNull(),
  employeeCount: integer("employee_count"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  jobTitle: text("job_title"),
  email: text("email").notNull(),
  phone: text("phone"),
  companyId: varchar("company_id"),
  userId: varchar("user_id"),
  trialStart: timestamp("trial_start").defaultNow(),
  trialEnd: timestamp("trial_end"),
  subscriptionStatus: text("subscription_status").default("trial_active"),
  billingActive: boolean("billing_active").default(false),
  paymentMethodOnFile: boolean("payment_method_on_file").default(false),
  termsAcceptedAt: timestamp("terms_accepted_at"),
  termsVersion: text("terms_version").default("1.0"),
  privacyVersion: text("privacy_version").default("1.0"),
  signupIp: text("signup_ip"),
  canceledAt: timestamp("canceled_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTrialSignupSchema = createInsertSchema(trialSignups).omit({ id: true, createdAt: true });
export type TrialSignup = typeof trialSignups.$inferSelect;
export type InsertTrialSignup = z.infer<typeof insertTrialSignupSchema>;

// ── Analytics Events ──────────────────────────────────────────
export const analyticsEvents = pgTable("analytics_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventName: text("event_name").notNull(),
  userId: varchar("user_id"),
  companyId: varchar("company_id"),
  pageSource: text("page_source"),
  metadata: text("metadata"),
  sessionId: text("session_id"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAnalyticsEventSchema = createInsertSchema(analyticsEvents).omit({ id: true, createdAt: true });
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type InsertAnalyticsEvent = z.infer<typeof insertAnalyticsEventSchema>;

// ── Onboarding Progress ──────────────────────────────────────────
export const onboardingProgress = pgTable("onboarding_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  userId: varchar("user_id").notNull(),
  stepCompanyDetails: boolean("step_company_details").default(false),
  stepFirstEmployee: boolean("step_first_employee").default(false),
  stepPaySchedule: boolean("step_pay_schedule").default(false),
  stepPayrollConfig: boolean("step_payroll_config").default(false),
  stepTimeClock: boolean("step_time_clock").default(false),
  stepPayrollPreview: boolean("step_payroll_preview").default(false),
  stepBankConnected: boolean("step_bank_connected").default(false),
  onboardingWizardCompleted: boolean("onboarding_wizard_completed").default(false),
  businessType: text("business_type"),
  employeeCount: integer("employee_count"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOnboardingProgressSchema = createInsertSchema(onboardingProgress).omit({ id: true, createdAt: true });
export type OnboardingProgress = typeof onboardingProgress.$inferSelect;
export type InsertOnboardingProgress = z.infer<typeof insertOnboardingProgressSchema>;

// ── Customers ──────────────────────────────────────────
export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  customerType: text("customer_type").default("customer"),
  customerName: text("customer_name").notNull(),
  businessName: text("business_name"),
  email: text("email"),
  phone: text("phone"),
  billingContactName: text("billing_contact_name"),
  billingEmail: text("billing_email"),
  billingAddress: text("billing_address"),
  billingCity: text("billing_city"),
  billingState: text("billing_state"),
  billingZip: text("billing_zip"),
  billingCountry: text("billing_country"),
  taxId: text("tax_id"),
  defaultPaymentTerms: text("default_payment_terms").default("net_30"),
  notes: text("notes"),
  status: text("status").default("active"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, createdAt: true, updatedAt: true });
export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;

// ── Invoice Templates ──────────────────────────────────────────
export const invoiceTemplates = pgTable("invoice_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  name: text("name").notNull(),
  description: text("description"),
  layoutKey: text("layout_key").notNull().default("modern_clean"),
  logoUrl: text("logo_url"),
  brandColor: text("brand_color").default("#0d9488"),
  headerText: text("header_text"),
  footerText: text("footer_text"),
  paymentInstructions: text("payment_instructions"),
  termsAndConditions: text("terms_and_conditions"),
  isDefault: boolean("is_default").default(false),
  isSystem: boolean("is_system").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertInvoiceTemplateSchema = createInsertSchema(invoiceTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InvoiceTemplate = typeof invoiceTemplates.$inferSelect;
export type InsertInvoiceTemplate = z.infer<typeof insertInvoiceTemplateSchema>;

// ── Invoices ──────────────────────────────────────────
export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  customerId: varchar("customer_id").references(() => customers.id),
  templateId: varchar("template_id").references(() => invoiceTemplates.id),
  invoiceNumber: text("invoice_number").notNull(),
  status: text("status").notNull().default("draft"),
  issueDate: date("issue_date").notNull(),
  dueDate: date("due_date").notNull(),
  subtotal: numeric("subtotal").default("0"),
  taxRate: numeric("tax_rate").default("0"),
  taxAmount: numeric("tax_amount").default("0"),
  discountAmount: numeric("discount_amount").default("0"),
  discountType: text("discount_type").default("fixed"),
  totalAmount: numeric("total_amount").default("0"),
  amountPaid: numeric("amount_paid").default("0"),
  amountDue: numeric("amount_due").default("0"),
  currency: text("currency").default("USD"),
  notes: text("notes"),
  internalNotes: text("internal_notes"),
  paymentTerms: text("payment_terms").default("net_30"),
  recurringBillingId: varchar("recurring_billing_id"),
  sentAt: timestamp("sent_at"),
  viewedAt: timestamp("viewed_at"),
  paidAt: timestamp("paid_at"),
  voidedAt: timestamp("voided_at"),
  templateStyle: text("template_style").default("modern_clean"),
  reminderEnabled: boolean("reminder_enabled").default(false),
  reminderFrequencyDays: integer("reminder_frequency_days").default(7),
  lastReminderSentAt: timestamp("last_reminder_sent_at"),
  nextReminderAt: timestamp("next_reminder_at"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true, updatedAt: true });
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;

// ── Invoice Line Items ──────────────────────────────────────────
export const invoiceLineItems = pgTable("invoice_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id),
  description: text("description").notNull(),
  quantity: numeric("quantity").default("1"),
  unitPrice: numeric("unit_price").default("0"),
  amount: numeric("amount").default("0"),
  taxable: boolean("taxable").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertInvoiceLineItemSchema = createInsertSchema(invoiceLineItems).omit({ id: true, createdAt: true });
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type InsertInvoiceLineItem = z.infer<typeof insertInvoiceLineItemSchema>;

// ── Payments ──────────────────────────────────────────
export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  invoiceId: varchar("invoice_id").references(() => invoices.id),
  customerId: varchar("customer_id").references(() => customers.id),
  paymentMethod: text("payment_method").notNull(),
  amount: numeric("amount").notNull(),
  processorFee: numeric("processor_fee").default("0"),
  netAmount: numeric("net_amount").default("0"),
  paymentFeeCharged: numeric("payment_fee_charged").default("0"),
  baseAmount: numeric("base_amount").default("0"),
  feeAmount: numeric("fee_amount").default("0"),
  totalCharged: numeric("total_charged").default("0"),
  processorTransactionId: text("processor_transaction_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeCustomerId: text("stripe_customer_id"),
  status: text("status").notNull().default("pending"),
  paidAt: timestamp("paid_at"),
  failedAt: timestamp("failed_at"),
  failureReason: text("failure_reason"),
  receiptUrl: text("receipt_url"),
  notes: text("notes"),
  mandateAccepted: boolean("mandate_accepted").default(false),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true, createdAt: true, updatedAt: true });
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;

// ── Payment Method Configurations ──────────────────────────────────
export const paymentMethodConfigs = pgTable("payment_method_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  methodType: text("method_type").notNull(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  feeType: text("fee_type").notNull().default("percentage"),
  feePercent: numeric("fee_percent").default("0"),
  feeFlat: numeric("fee_flat").default("0"),
  feeCap: numeric("fee_cap"),
  isEnabled: boolean("is_enabled").default(true),
  isRecommended: boolean("is_recommended").default(false),
  feePassedToCustomer: boolean("fee_passed_to_customer").default(true),
  processingTime: text("processing_time"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPaymentMethodConfigSchema = createInsertSchema(paymentMethodConfigs).omit({ id: true, createdAt: true });
export type PaymentMethodConfig = typeof paymentMethodConfigs.$inferSelect;
export type InsertPaymentMethodConfig = z.infer<typeof insertPaymentMethodConfigSchema>;

// ── Saved Payment Methods ──────────────────────────────────────────
export const savedPaymentMethods = pgTable("saved_payment_methods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  methodType: text("method_type").notNull(),
  last4: text("last_4"),
  brand: text("brand"),
  bankName: text("bank_name"),
  expiryMonth: integer("expiry_month"),
  expiryYear: integer("expiry_year"),
  processorToken: text("processor_token"),
  isDefault: boolean("is_default").default(false),
  isAutoPay: boolean("is_auto_pay").default(false),
  status: text("status").default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSavedPaymentMethodSchema = createInsertSchema(savedPaymentMethods).omit({ id: true, createdAt: true, updatedAt: true });
export type SavedPaymentMethod = typeof savedPaymentMethods.$inferSelect;
export type InsertSavedPaymentMethod = z.infer<typeof insertSavedPaymentMethodSchema>;

// ── Recurring Billing Profiles ──────────────────────────────────────────
export const recurringBillingProfiles = pgTable("recurring_billing_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  templateId: varchar("template_id").references(() => invoiceTemplates.id),
  name: text("name").notNull(),
  frequency: text("frequency").notNull().default("monthly"),
  customIntervalDays: integer("custom_interval_days"),
  amount: numeric("amount").notNull(),
  currency: text("currency").default("USD"),
  lineItems: text("line_items"),
  taxRate: numeric("tax_rate").default("0"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  nextInvoiceDate: date("next_invoice_date"),
  trialEndDate: date("trial_end_date"),
  autoPayEnabled: boolean("auto_pay_enabled").default(false),
  retryOnFailure: boolean("retry_on_failure").default(true),
  maxRetries: integer("max_retries").default(3),
  status: text("status").notNull().default("active"),
  canceledAt: timestamp("canceled_at"),
  notes: text("notes"),
  // Invoice date & due date settings
  dueDays: integer("due_days").default(30),
  // Notification settings
  notifyEmail: boolean("notify_email").default(true),
  notifySms: boolean("notify_sms").default(false),
  notifyDaysBefore: integer("notify_days_before").default(7),
  reminderFrequencyDays: integer("reminder_frequency_days").default(0),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertRecurringBillingProfileSchema = createInsertSchema(recurringBillingProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export type RecurringBillingProfile = typeof recurringBillingProfiles.$inferSelect;
export type InsertRecurringBillingProfile = z.infer<typeof insertRecurringBillingProfileSchema>;

// ── Document Folders ──────────────────────────────────────────
export const documentFolders = pgTable("document_folders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  parentId: varchar("parent_id"),
  category: text("category"),
  color: text("color"),
  sortOrder: integer("sort_order").default(0),
  createdBy: varchar("created_by"),
  legalHold: boolean("legal_hold").default(false),
  retentionPolicyId: varchar("retention_policy_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDocumentFolderSchema = createInsertSchema(documentFolders).omit({ id: true, createdAt: true });
export type DocumentFolder = typeof documentFolders.$inferSelect;
export type InsertDocumentFolder = z.infer<typeof insertDocumentFolderSchema>;

// ── Documents ──────────────────────────────────────────
export const documents = pgTable("documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  folderId: varchar("folder_id").references(() => documentFolders.id),
  title: text("title").notNull(),
  description: text("description"),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  tags: text("tags"),
  category: text("category"),
  status: text("status").default("active"),
  isTemplate: boolean("is_template").default(false),
  templateMergeTags: text("template_merge_tags"),
  expiresAt: timestamp("expires_at"),
  assignedToWorkerId: varchar("assigned_to_worker_id"),
  assignedToCustomerId: varchar("assigned_to_customer_id"),
  currentVersionId: varchar("current_version_id"),
  accessLevel: text("access_level").default("company"),
  classification: text("classification").default("internal"),
  documentType: text("document_type"),
  department: text("department"),
  owner: text("owner"),
  effectiveDate: timestamp("effective_date"),
  retentionPolicyId: varchar("retention_policy_id"),
  dispositionDate: timestamp("disposition_date"),
  dispositionStatus: text("disposition_status"),
  legalHold: boolean("legal_hold").default(false),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true, createdAt: true, updatedAt: true });
export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;

// ── Document Versions ──────────────────────────────────────────
export const documentVersions = pgTable("document_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull().references(() => documents.id),
  versionNumber: integer("version_number").notNull().default(1),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"),
  sha256: text("sha256").notNull(),
  changeNote: text("change_note"),
  uploadedBy: varchar("uploaded_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDocumentVersionSchema = createInsertSchema(documentVersions).omit({ id: true, createdAt: true });
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type InsertDocumentVersion = z.infer<typeof insertDocumentVersionSchema>;

// ── Document Signature Requests ──────────────────────────────────────────
export const documentSignatureRequests = pgTable("document_signature_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull().references(() => documents.id),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  provider: text("provider"),
  providerObjectId: text("provider_object_id"),
  status: text("status").notNull().default("draft"),
  sentAt: timestamp("sent_at"),
  completedAt: timestamp("completed_at"),
  expiresAt: timestamp("expires_at"),
  message: text("message"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDocumentSignatureRequestSchema = createInsertSchema(documentSignatureRequests).omit({ id: true, createdAt: true, updatedAt: true });
export type DocumentSignatureRequest = typeof documentSignatureRequests.$inferSelect;
export type InsertDocumentSignatureRequest = z.infer<typeof insertDocumentSignatureRequestSchema>;

// ── Document Signers ──────────────────────────────────────────
export const documentSigners = pgTable("document_signers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  signatureRequestId: varchar("signature_request_id").notNull().references(() => documentSignatureRequests.id),
  signerName: text("signer_name").notNull(),
  signerEmail: text("signer_email").notNull(),
  status: text("status").notNull().default("pending"),
  routingOrder: integer("routing_order").default(1),
  signedAt: timestamp("signed_at"),
  ipAddress: text("ip_address"),
  signatureData: text("signature_data"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDocumentSignerSchema = createInsertSchema(documentSigners).omit({ id: true, createdAt: true });
export type DocumentSigner = typeof documentSigners.$inferSelect;
export type InsertDocumentSigner = z.infer<typeof insertDocumentSignerSchema>;

// ── Signature Packages ──────────────────────────────────────────
export const signaturePackages = pgTable("signature_packages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  signatureRequestId: varchar("signature_request_id").references(() => documentSignatureRequests.id),
  provider: text("provider").notNull(),
  providerEnvelopeId: text("provider_envelope_id"),
  status: text("status").notNull().default("created"),
  documentIds: text("document_ids"),
  subject: text("subject"),
  message: text("message"),
  metadata: text("metadata"),
  sentAt: timestamp("sent_at"),
  completedAt: timestamp("completed_at"),
  expiresAt: timestamp("expires_at"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSignaturePackageSchema = createInsertSchema(signaturePackages).omit({ id: true, createdAt: true, updatedAt: true });
export type SignaturePackage = typeof signaturePackages.$inferSelect;
export type InsertSignaturePackage = z.infer<typeof insertSignaturePackageSchema>;

// ── Webhook Events ──────────────────────────────────────────
export const webhookEvents = pgTable("webhook_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull(),
  eventType: text("event_type").notNull(),
  providerEventId: text("provider_event_id"),
  envelopeId: text("envelope_id"),
  payload: text("payload"),
  status: text("status").notNull().default("received"),
  processedAt: timestamp("processed_at"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWebhookEventSchema = createInsertSchema(webhookEvents).omit({ id: true, createdAt: true });
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type InsertWebhookEvent = z.infer<typeof insertWebhookEventSchema>;

// ── Document Audit Log ──────────────────────────────────────────
export const documentAuditLogs = pgTable("document_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").references(() => documents.id, { onDelete: "set null" }),
  signatureRequestId: varchar("signature_request_id"),
  companyId: varchar("company_id").notNull(),
  action: text("action").notNull(),
  actorName: text("actor_name"),
  actorEmail: text("actor_email"),
  actorId: varchar("actor_id"),
  ipAddress: text("ip_address"),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDocumentAuditLogSchema = createInsertSchema(documentAuditLogs).omit({ id: true, createdAt: true });
export type DocumentAuditLog = typeof documentAuditLogs.$inferSelect;
export type InsertDocumentAuditLog = z.infer<typeof insertDocumentAuditLogSchema>;

// ── Automation Rules ──────────────────────────────────────────
export const automationRules = pgTable("automation_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  description: text("description"),
  triggerType: text("trigger_type").notNull(),
  triggerConfig: text("trigger_config"),
  actionType: text("action_type").notNull(),
  actionConfig: text("action_config"),
  isEnabled: boolean("is_enabled").default(true),
  isSystem: boolean("is_system").default(false),
  category: text("category"),
  lastTriggeredAt: timestamp("last_triggered_at"),
  triggerCount: integer("trigger_count").default(0),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAutomationRuleSchema = createInsertSchema(automationRules).omit({ id: true, createdAt: true, updatedAt: true });
export type AutomationRule = typeof automationRules.$inferSelect;
export type InsertAutomationRule = z.infer<typeof insertAutomationRuleSchema>;

// ── Automation Events ──────────────────────────────────────────
export const automationEvents = pgTable("automation_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ruleId: varchar("rule_id").notNull().references(() => automationRules.id),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  triggerType: text("trigger_type").notNull(),
  actionType: text("action_type").notNull(),
  status: text("status").notNull().default("completed"),
  triggerData: text("trigger_data"),
  actionResult: text("action_result"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAutomationEventSchema = createInsertSchema(automationEvents).omit({ id: true, createdAt: true });
export type AutomationEvent = typeof automationEvents.$inferSelect;
export type InsertAutomationEvent = z.infer<typeof insertAutomationEventSchema>;

// ── Notifications ──────────────────────────────────────────
export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  userId: varchar("user_id"),
  workerId: varchar("worker_id"),
  customerId: varchar("customer_id"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message"),
  actionUrl: text("action_url"),
  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

// ── Portal Access Tokens ──────────────────────────────────────────
export const portalAccessTokens = pgTable("portal_access_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  customerId: varchar("customer_id").references(() => customers.id),
  invoiceId: varchar("invoice_id").references(() => invoices.id),
  documentId: varchar("document_id").references(() => documents.id),
  signatureRequestId: varchar("signature_request_id"),
  packetId: varchar("packet_id"),
  workerId: varchar("worker_id"),
  token: text("token").notNull(),
  tokenType: text("token_type").notNull(),
  expiresAt: timestamp("expires_at"),
  usedAt: timestamp("used_at"),
  isRevoked: boolean("is_revoked").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Document ACLs ──────────────────────────────────────────
export const documentAcls = pgTable("document_acls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  documentId: varchar("document_id"),
  folderId: varchar("folder_id"),
  principalType: text("principal_type").notNull(),
  principalId: varchar("principal_id").notNull(),
  permission: text("permission").notNull(),
  inherited: boolean("inherited").default(false),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDocumentAclSchema = createInsertSchema(documentAcls).omit({ id: true, createdAt: true });
export type DocumentAcl = typeof documentAcls.$inferSelect;
export type InsertDocumentAcl = z.infer<typeof insertDocumentAclSchema>;

// ── Document Retention Policies ──────────────────────────────────────────
export const documentRetentionPolicies = pgTable("document_retention_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  description: text("description"),
  documentType: text("document_type"),
  retentionYears: integer("retention_years"),
  retentionMonths: integer("retention_months"),
  retentionRule: text("retention_rule"),
  dispositionAction: text("disposition_action").default("archive"),
  isActive: boolean("is_active").default(true),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDocumentRetentionPolicySchema = createInsertSchema(documentRetentionPolicies).omit({ id: true, createdAt: true, updatedAt: true });
export type DocumentRetentionPolicy = typeof documentRetentionPolicies.$inferSelect;
export type InsertDocumentRetentionPolicy = z.infer<typeof insertDocumentRetentionPolicySchema>;

// ── Onboarding Packets ──────────────────────────────────────────
export const onboardingPackets = pgTable("onboarding_packets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  workerId: varchar("worker_id").notNull(),
  templateName: text("template_name").notNull(),
  status: text("status").notNull().default("pending"),
  assignedBy: varchar("assigned_by"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  dueDate: timestamp("due_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOnboardingPacketSchema = createInsertSchema(onboardingPackets).omit({ id: true, createdAt: true, updatedAt: true });
export type OnboardingPacket = typeof onboardingPackets.$inferSelect;
export type InsertOnboardingPacket = z.infer<typeof insertOnboardingPacketSchema>;

// ── Onboarding Packet Steps ──────────────────────────────────────────
export const onboardingPacketSteps = pgTable("onboarding_packet_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  packetId: varchar("packet_id").notNull().references(() => onboardingPackets.id),
  stepName: text("step_name").notNull(),
  stepType: text("step_type").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").default(0),
  status: text("status").notNull().default("pending"),
  assignedTo: varchar("assigned_to"),
  documentId: varchar("document_id"),
  completedAt: timestamp("completed_at"),
  completedBy: varchar("completed_by"),
  notes: text("notes"),
  taskType: text("task_type").default("manual"),
  dependenciesJson: text("dependencies_json"),
  docType: text("doc_type"),
  docStatus: text("doc_status").default("pending"),
  required: boolean("required").default(true),
  signaturePackageId: varchar("signature_package_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOnboardingPacketStepSchema = createInsertSchema(onboardingPacketSteps).omit({ id: true, createdAt: true });
export type OnboardingPacketStep = typeof onboardingPacketSteps.$inferSelect;
export type InsertOnboardingPacketStep = z.infer<typeof insertOnboardingPacketStepSchema>;

// ── Invoice Approval Workflows ──────────────────────────────────────────
export const invoiceApprovalWorkflows = pgTable("invoice_approval_workflows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  documentId: varchar("document_id"),
  vendorName: text("vendor_name"),
  invoiceNumber: text("invoice_number"),
  invoiceDate: timestamp("invoice_date"),
  totalAmount: text("total_amount"),
  extractedData: text("extracted_data"),
  status: text("status").notNull().default("received"),
  currentApproverId: varchar("current_approver_id"),
  approvalChain: text("approval_chain"),
  submittedBy: varchar("submitted_by"),
  approvedAt: timestamp("approved_at"),
  approvedBy: varchar("approved_by"),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertInvoiceApprovalWorkflowSchema = createInsertSchema(invoiceApprovalWorkflows).omit({ id: true, createdAt: true, updatedAt: true });
export type InvoiceApprovalWorkflow = typeof invoiceApprovalWorkflows.$inferSelect;
export type InsertInvoiceApprovalWorkflow = z.infer<typeof insertInvoiceApprovalWorkflowSchema>;

// ── Deals (Pipeline) ──────────────────────────────────────────
export const deals = pgTable("deals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  title: text("title").notNull(),
  description: text("description"),
  stage: text("stage").notNull().default("lead"),
  productName: text("product_name"),
  value: numeric("value").default("0"),
  currency: text("currency").default("USD"),
  assignedTo: varchar("assigned_to"),
  expectedCloseDate: date("expected_close_date"),
  closedAt: timestamp("closed_at"),
  lostReason: text("lost_reason"),
  notes: text("notes"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDealSchema = createInsertSchema(deals).omit({ id: true, createdAt: true, updatedAt: true });
export type Deal = typeof deals.$inferSelect;
export type InsertDeal = z.infer<typeof insertDealSchema>;

// ── Onboarding Templates ──────────────────────────────────────────
export const onboardingTemplates = pgTable("onboarding_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  description: text("description"),
  productName: text("product_name"),
  isActive: boolean("is_active").default(true),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOnboardingTemplateSchema = createInsertSchema(onboardingTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type OnboardingTemplate = typeof onboardingTemplates.$inferSelect;
export type InsertOnboardingTemplate = z.infer<typeof insertOnboardingTemplateSchema>;

// ── Onboarding Template Tasks ──────────────────────────────────────────
export const onboardingTemplateTasks = pgTable("onboarding_template_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => onboardingTemplates.id),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category"),
  sortOrder: integer("sort_order").default(0),
  isMandatory: boolean("is_mandatory").default(true),
  estimatedMinutes: integer("estimated_minutes"),
  resourceUrl: text("resource_url"),
  resourceType: text("resource_type"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOnboardingTemplateTaskSchema = createInsertSchema(onboardingTemplateTasks).omit({ id: true, createdAt: true });
export type OnboardingTemplateTask = typeof onboardingTemplateTasks.$inferSelect;
export type InsertOnboardingTemplateTask = z.infer<typeof insertOnboardingTemplateTaskSchema>;

// ── Customer Onboarding Projects ──────────────────────────────────────────
export const customerOnboardingProjects = pgTable("customer_onboarding_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  dealId: varchar("deal_id").references(() => deals.id),
  templateId: varchar("template_id").references(() => onboardingTemplates.id),
  productName: text("product_name"),
  title: text("title").notNull(),
  status: text("status").notNull().default("not_started"),
  progressPercentage: integer("progress_percentage").default(0),
  assignedTo: varchar("assigned_to"),
  startDate: date("start_date"),
  targetCompletionDate: date("target_completion_date"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCustomerOnboardingProjectSchema = createInsertSchema(customerOnboardingProjects).omit({ id: true, createdAt: true, updatedAt: true });
export type CustomerOnboardingProject = typeof customerOnboardingProjects.$inferSelect;
export type InsertCustomerOnboardingProject = z.infer<typeof insertCustomerOnboardingProjectSchema>;

// ── Onboarding Tasks ──────────────────────────────────────────
export const onboardingTasks = pgTable("onboarding_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => customerOnboardingProjects.id),
  templateTaskId: varchar("template_task_id").references(() => onboardingTemplateTasks.id),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category"),
  sortOrder: integer("sort_order").default(0),
  status: text("status").notNull().default("pending"),
  isMandatory: boolean("is_mandatory").default(true),
  assignedTo: varchar("assigned_to"),
  dueDate: date("due_date"),
  completedAt: timestamp("completed_at"),
  completedBy: varchar("completed_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOnboardingTaskSchema = createInsertSchema(onboardingTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type OnboardingTask = typeof onboardingTasks.$inferSelect;
export type InsertOnboardingTask = z.infer<typeof insertOnboardingTaskSchema>;

// ── Onboarding Documents ──────────────────────────────────────────
export const onboardingDocuments = pgTable("onboarding_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => customerOnboardingProjects.id),
  templateId: varchar("template_id").references(() => onboardingTemplates.id),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  title: text("title").notNull(),
  description: text("description"),
  documentType: text("document_type").notNull().default("document"),
  url: text("url"),
  fileSize: integer("file_size"),
  sortOrder: integer("sort_order").default(0),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOnboardingDocumentSchema = createInsertSchema(onboardingDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type OnboardingDocument = typeof onboardingDocuments.$inferSelect;
export type InsertOnboardingDocument = z.infer<typeof insertOnboardingDocumentSchema>;

// ── Engagement Events ──────────────────────────────────────────
export const engagementEvents = pgTable("engagement_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  projectId: varchar("project_id").references(() => customerOnboardingProjects.id),
  eventType: text("event_type").notNull(),
  eventSource: text("event_source").notNull().default("internal"),
  productName: text("product_name"),
  metadata: text("metadata"),
  description: text("description"),
  occurredAt: timestamp("occurred_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEngagementEventSchema = createInsertSchema(engagementEvents).omit({ id: true, createdAt: true });
export type EngagementEvent = typeof engagementEvents.$inferSelect;
export type InsertEngagementEvent = z.infer<typeof insertEngagementEventSchema>;

// ── Product API Keys ──────────────────────────────────────────
export const productApiKeys = pgTable("product_api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  productName: text("product_name").notNull(),
  apiKey: text("api_key").notNull(),
  label: text("label"),
  isActive: boolean("is_active").default(true),
  lastUsedAt: timestamp("last_used_at"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertProductApiKeySchema = createInsertSchema(productApiKeys).omit({ id: true, createdAt: true });
export type ProductApiKey = typeof productApiKeys.$inferSelect;
export type InsertProductApiKey = z.infer<typeof insertProductApiKeySchema>;

// ── Device Tokens (Push Notifications) ──────────────────────────────────
export const deviceTokens = pgTable("device_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  token: text("token").notNull(),
  platform: text("platform").notNull().default("web"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDeviceTokenSchema = createInsertSchema(deviceTokens).omit({ id: true, createdAt: true, updatedAt: true });
export type DeviceToken = typeof deviceTokens.$inferSelect;
export type InsertDeviceToken = z.infer<typeof insertDeviceTokenSchema>;

// ── Company Webhook Config ──────────────────────────────────────────
export const companyWebhookConfigs = pgTable("company_webhook_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  webhookUrl: text("webhook_url").notNull(),
  hmacSecret: text("hmac_secret").notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCompanyWebhookConfigSchema = createInsertSchema(companyWebhookConfigs).omit({ id: true, createdAt: true, updatedAt: true });
export type CompanyWebhookConfig = typeof companyWebhookConfigs.$inferSelect;
export type InsertCompanyWebhookConfig = z.infer<typeof insertCompanyWebhookConfigSchema>;

// ── Integration Events ──────────────────────────────────────────
export const integrationEvents = pgTable("integration_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  eventType: text("event_type").notNull(),
  payload: text("payload"),
  status: text("status").notNull().default("pending"),
  destinationUrl: text("destination_url"),
  attempts: integer("attempts").default(0),
  lastAttemptAt: timestamp("last_attempt_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertIntegrationEventSchema = createInsertSchema(integrationEvents).omit({ id: true, createdAt: true });
export type IntegrationEvent = typeof integrationEvents.$inferSelect;
export type InsertIntegrationEvent = z.infer<typeof insertIntegrationEventSchema>;

// ── License Requests ────────────────────────────────────────────
export const licenseRequests = pgTable("license_requests", {
  id: serial("id").primaryKey(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email").notNull(),
  phone: text("phone"),
  company: text("company"),
  employees: text("employees"),
  interest: text("interest"),
  message: text("message"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  sourcePage: text("source_page"),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLicenseRequestSchema = createInsertSchema(licenseRequests).omit({ id: true, createdAt: true });
export type LicenseRequest = typeof licenseRequests.$inferSelect;
export type InsertLicenseRequest = z.infer<typeof insertLicenseRequestSchema>;

// ── Staff Messages ──────────────────────────────────────────────────────────
export const staffMessages = pgTable("staff_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  senderId: varchar("sender_id").references(() => workers.id),
  senderName: text("sender_name"),                      // persisted display name; populated at send time
  senderUserId: varchar("sender_user_id"),              // user account id for senderless (admin) senders
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  scope: text("scope").notNull().default("one"),        // 'one' | 'company' | 'sitewide'
  recipientWorkerId: varchar("recipient_worker_id").references(() => workers.id),
  deliveryChannel: text("delivery_channel").notNull().default("app"),  // 'app' | 'email' | 'sms' | 'both'
  parentMessageId: varchar("parent_message_id"),        // set on replies
  isReply: boolean("is_reply").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertStaffMessageSchema = createInsertSchema(staffMessages).omit({ id: true, createdAt: true });
export type StaffMessage = typeof staffMessages.$inferSelect;
export type InsertStaffMessage = z.infer<typeof insertStaffMessageSchema>;

// ── Staff Message Recipients ────────────────────────────────────────────────
export const staffMessageRecipients = pgTable("staff_message_recipients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").notNull().references(() => staffMessages.id),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  readAt: timestamp("read_at"),
  deliveredAt: timestamp("delivered_at").defaultNow(),
});

export const insertStaffMessageRecipientSchema = createInsertSchema(staffMessageRecipients).omit({ id: true });
export type StaffMessageRecipient = typeof staffMessageRecipients.$inferSelect;
export type InsertStaffMessageRecipient = z.infer<typeof insertStaffMessageRecipientSchema>;

// ── System Documents ─────────────────────────────────────────────────────────
export const systemDocuments = pgTable("system_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  version: text("version").notNull().default("1.0"),
  category: text("category").notNull().default("General"),
  fileUrl: text("file_url"),
  description: text("description"),
  effectiveDate: date("effective_date"),
  changeLog: text("change_log"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSystemDocumentSchema = createInsertSchema(systemDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type SystemDocument = typeof systemDocuments.$inferSelect;
export type InsertSystemDocument = z.infer<typeof insertSystemDocumentSchema>;

// ── Trade / Non-Cash Compensation ──────────────────────────────────────────
export const tradeTransactions = pgTable("trade_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  title: text("title").notNull(),
  transactionType: text("transaction_type").notNull().default("services"), // goods | services | mixed
  counterpartyType: text("counterparty_type").notNull().default("manual"), // contractor | vendor | customer | manual
  counterpartyId: varchar("counterparty_id"),
  counterpartyName: text("counterparty_name").notNull(),
  description: text("description"),
  fairMarketValue: numeric("fair_market_value", { precision: 12, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("draft"), // draft | pending_review | approved | rejected | completed | cancelled
  isReportable: boolean("is_reportable").notNull().default(false),
  taxYear: integer("tax_year"),
  reportingNotes: text("reporting_notes"),
  reviewedBy: varchar("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  createdBy: varchar("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertTradeTransactionSchema = createInsertSchema(tradeTransactions).omit({ id: true, createdAt: true, updatedAt: true });
export type TradeTransaction = typeof tradeTransactions.$inferSelect;
export type InsertTradeTransaction = z.infer<typeof insertTradeTransactionSchema>;

export const tradeTransactionItems = pgTable("trade_transaction_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeTransactionId: varchar("trade_transaction_id").notNull(),
  description: text("description").notNull(),
  itemType: text("item_type").notNull().default("services"), // goods | services | other
  direction: text("direction").notNull().default("given"), // given | received
  fairMarketValue: numeric("fair_market_value", { precision: 12, scale: 2 }).notNull().default("0"),
  quantity: numeric("quantity", { precision: 10, scale: 4 }).notNull().default("1"),
  unit: text("unit"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertTradeTransactionItemSchema = createInsertSchema(tradeTransactionItems).omit({ id: true, createdAt: true });
export type TradeTransactionItem = typeof tradeTransactionItems.$inferSelect;
export type InsertTradeTransactionItem = z.infer<typeof insertTradeTransactionItemSchema>;

export const tradeAttachments = pgTable("trade_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeTransactionId: varchar("trade_transaction_id").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  uploadedBy: varchar("uploaded_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertTradeAttachmentSchema = createInsertSchema(tradeAttachments).omit({ id: true, createdAt: true });
export type TradeAttachment = typeof tradeAttachments.$inferSelect;
export type InsertTradeAttachment = z.infer<typeof insertTradeAttachmentSchema>;

export const tradeAuditLogs = pgTable("trade_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeTransactionId: varchar("trade_transaction_id").notNull(),
  companyId: varchar("company_id").notNull(),
  userId: varchar("user_id").notNull(),
  action: text("action").notNull(), // created | updated | submitted | approved | rejected | completed | cancelled | attachment_added
  oldStatus: text("old_status"),
  newStatus: text("new_status"),
  note: text("note"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertTradeAuditLogSchema = createInsertSchema(tradeAuditLogs).omit({ id: true, createdAt: true });
export type TradeAuditLog = typeof tradeAuditLogs.$inferSelect;
export type InsertTradeAuditLog = z.infer<typeof insertTradeAuditLogSchema>;

// ── Contractor Documents (W-9, W-8BEN, etc.) ─────────────────────────────
export const contractorDocuments = pgTable("contractor_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  workerId: varchar("worker_id").notNull(),
  documentType: text("document_type").notNull().default("w9"), // w9 | w8ben | other
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  notes: text("notes"),
  uploadedBy: varchar("uploaded_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertContractorDocumentSchema = createInsertSchema(contractorDocuments).omit({ id: true, createdAt: true });
export type ContractorDocument = typeof contractorDocuments.$inferSelect;
export type InsertContractorDocument = z.infer<typeof insertContractorDocumentSchema>;

// ── Authorization Audit Log ────────────────────────────────────────────────
export const authorizationAuditLog = pgTable("authorization_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  actorUserId: varchar("actor_user_id").notNull(),
  targetUserId: varchar("target_user_id"),
  targetRoleId: varchar("target_role_id"),
  targetResource: text("target_resource"),
  changeType: text("change_type").notNull(),
  beforeValue: text("before_value"),
  afterValue: text("after_value"),
  note: text("note"),
  companyId: varchar("company_id"),
  tenantId: varchar("tenant_id"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertAuthorizationAuditLogSchema = createInsertSchema(authorizationAuditLog).omit({ id: true, createdAt: true });
export type AuthorizationAuditLog = typeof authorizationAuditLog.$inferSelect;
export type InsertAuthorizationAuditLog = z.infer<typeof insertAuthorizationAuditLogSchema>;

// ── Contractor 1099 Summaries ─────────────────────────────────────────────
export const contractor1099Summaries = pgTable("contractor_1099_summaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  workerId: varchar("worker_id").notNull(),
  taxYear: integer("tax_year").notNull(),
  cashTotal: numeric("cash_total", { precision: 12, scale: 2 }).notNull().default("0"),
  tradeTotal: numeric("trade_total", { precision: 12, scale: 2 }).notNull().default("0"),
  totalCompensation: numeric("total_compensation", { precision: 12, scale: 2 }).notNull().default("0"),
  meetsThreshold: boolean("meets_threshold").notNull().default(false),
  threshold: numeric("threshold", { precision: 12, scale: 2 }).notNull().default("600"),
  missingW9: boolean("missing_w9").notNull().default(true),
  status: text("status").notNull().default("draft"), // draft | ready | filed
  filedAt: timestamp("filed_at"),
  notes: text("notes"),
  lastCalculatedAt: timestamp("last_calculated_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertContractor1099SummarySchema = createInsertSchema(contractor1099Summaries).omit({ id: true, createdAt: true, updatedAt: true });
export type Contractor1099Summary = typeof contractor1099Summaries.$inferSelect;
export type InsertContractor1099Summary = z.infer<typeof insertContractor1099SummarySchema>;

// ── Org Hierarchy Extensions ──────────────────────────────────────────────────

export const locations = pgTable("locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  legalEntityId: varchar("legal_entity_id").references(() => legalEntities.id),
  name: text("name").notNull(),
  code: text("code"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  country: text("country").default("US"),
  phone: text("phone"),
  timezone: text("timezone").default("America/Los_Angeles"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const teams = pgTable("teams", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  departmentId: varchar("department_id").references(() => departments.id),
  locationId: varchar("location_id").references(() => locations.id),
  name: text("name").notNull(),
  description: text("description"),
  leadWorkerId: varchar("lead_worker_id"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const employeeManagerRelations = pgTable("employee_manager_relations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  employeeId: varchar("employee_id").notNull().references(() => workers.id),
  managerId: varchar("manager_id").notNull().references(() => workers.id),
  relationshipType: text("relationship_type").notNull().default("primary"),
  effectiveDate: date("effective_date"),
  endDate: date("end_date"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Permission Schema ─────────────────────────────────────────────────────────

export const permissionScopeEnum = pgEnum("permission_scope", [
  "self",
  "direct_reports",
  "department",
  "location",
  "legal_entity",
  "entire_tenant",
]);

export const platformModules = pgTable("platform_modules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  isEnabled: boolean("is_enabled").default(true),
  isCoreModule: boolean("is_core_module").default(false),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const permissionGroups = pgTable("permission_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  moduleId: varchar("module_id").references(() => platformModules.id),
  name: text("name").notNull().unique(),
  description: text("description"),
  module: text("module").notNull(),
  displayOrder: integer("display_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const permissions = pgTable("permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  permissionGroupId: varchar("permission_group_id").notNull().references(() => permissionGroups.id),
  moduleId: varchar("module_id").references(() => platformModules.id),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  description: text("description"),
  scope: permissionScopeEnum("scope").notNull().default("self"),
  isCustomerFacing: boolean("is_customer_facing").default(false),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const enterpriseRolePermissions = pgTable("enterprise_role_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roleId: varchar("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: varchar("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  scope: permissionScopeEnum("scope").notNull().default("self"),
  isGranted: boolean("is_granted").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userCompanyAccess = pgTable("user_company_access", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  roleId: varchar("role_id").notNull().references(() => roles.id),
  isActive: boolean("is_active").default(true),
  grantedAt: timestamp("granted_at").defaultNow(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userPermissionOverrides = pgTable("user_permission_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  permissionId: varchar("permission_id").notNull().references(() => permissions.id),
  scope: permissionScopeEnum("scope").notNull().default("self"),
  isGranted: boolean("is_granted").notNull(),
  reason: text("reason"),
  grantedBy: varchar("granted_by").references(() => users.id),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPlatformModuleSchema = createInsertSchema(platformModules).omit({ id: true, createdAt: true });
export const insertLocationSchema = createInsertSchema(locations).omit({ id: true, createdAt: true });
export const insertTeamSchema = createInsertSchema(teams).omit({ id: true, createdAt: true });
export const insertEmployeeManagerRelationSchema = createInsertSchema(employeeManagerRelations).omit({ id: true, createdAt: true });
export const insertPermissionGroupSchema = createInsertSchema(permissionGroups).omit({ id: true, createdAt: true });
export const insertPermissionSchema = createInsertSchema(permissions).omit({ id: true, createdAt: true });
export const insertEnterpriseRolePermissionSchema = createInsertSchema(enterpriseRolePermissions).omit({ id: true, createdAt: true });
export const insertUserCompanyAccessSchema = createInsertSchema(userCompanyAccess).omit({ id: true, createdAt: true });
export const insertUserPermissionOverrideSchema = createInsertSchema(userPermissionOverrides).omit({ id: true, createdAt: true });

export type PlatformModule = typeof platformModules.$inferSelect;
export type InsertPlatformModule = z.infer<typeof insertPlatformModuleSchema>;
export type Location = typeof locations.$inferSelect;
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Team = typeof teams.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type EmployeeManagerRelation = typeof employeeManagerRelations.$inferSelect;
export type InsertEmployeeManagerRelation = z.infer<typeof insertEmployeeManagerRelationSchema>;
export type PermissionGroup = typeof permissionGroups.$inferSelect;
export type InsertPermissionGroup = z.infer<typeof insertPermissionGroupSchema>;
export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type EnterpriseRolePermission = typeof enterpriseRolePermissions.$inferSelect;
export type InsertEnterpriseRolePermission = z.infer<typeof insertEnterpriseRolePermissionSchema>;
export type UserCompanyAccess = typeof userCompanyAccess.$inferSelect;
export type InsertUserCompanyAccess = z.infer<typeof insertUserCompanyAccessSchema>;
export type UserPermissionOverride = typeof userPermissionOverrides.$inferSelect;
export type InsertUserPermissionOverride = z.infer<typeof insertUserPermissionOverrideSchema>;

// ── Payroll Summaries ─────────────────────────────────────────────────────────
export const payrollSummaries = pgTable("payroll_summaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payrollRunId: varchar("payroll_run_id").notNull().references(() => payrollRuns.id),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  totalGross: numeric("total_gross").default("0"),
  totalDeductions: numeric("total_deductions").default("0"),
  totalNet: numeric("total_net").default("0"),
  totalEmployerTaxes: numeric("total_employer_taxes").default("0"),
  totalReimbursements: numeric("total_reimbursements").default("0"),
  totalFundingRequired: numeric("total_funding_required").default("0"),
  achCount: integer("ach_count").default(0),
  achAmount: numeric("ach_amount").default("0"),
  checkCount: integer("check_count").default(0),
  checkAmount: numeric("check_amount").default("0"),
  cashCount: integer("cash_count").default(0),
  cashAmount: numeric("cash_amount").default("0"),
  tradeCount: integer("trade_count").default(0),
  tradeAmount: numeric("trade_amount").default("0"),
  otherCount: integer("other_count").default(0),
  otherAmount: numeric("other_amount").default("0"),
  workerCount: integer("worker_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ── Tenant Provisioning ───────────────────────────────────────────────────────

export const tenantLifecycleStateEnum = pgEnum("tenant_lifecycle_state", [
  "pending_activation",
  "active",
  "grace_period",
  "suspended",
  "reactivated",
  "cancelled",
]);

export const tenantCommercialGates = pgTable("tenant_commercial_gates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  agreementStatus: text("agreement_status").notNull().default("pending"), // pending | signed
  implementationFeeStatus: text("implementation_fee_status").notNull().default("pending"), // pending | paid
  subscriptionStatus: text("subscription_status").notNull().default("pending"), // pending | active
  paymentMethodStatus: text("payment_method_status").notNull().default("pending"), // pending | verified
  lifecycleState: tenantLifecycleStateEnum("lifecycle_state").notNull().default("pending_activation"),
  selectedTemplate: text("selected_template"), // template key
  provisionedAt: timestamp("provisioned_at"),
  suspendedAt: timestamp("suspended_at"),
  cancelledAt: timestamp("cancelled_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPayrollSummarySchema = createInsertSchema(payrollSummaries).omit({ id: true, createdAt: true, updatedAt: true });
export type PayrollSummary = typeof payrollSummaries.$inferSelect;
export type InsertPayrollSummary = z.infer<typeof insertPayrollSummarySchema>;

// ── ACH Batches ───────────────────────────────────────────────────────────────
export const achBatches = pgTable("ach_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payrollRunId: varchar("payroll_run_id").notNull().references(() => payrollRuns.id),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  batchId: text("batch_id"),
  status: text("status").default("submitted"),
  submittedAt: timestamp("submitted_at"),
  settledAt: timestamp("settled_at"),
  settlementStatus: text("settlement_status"),
  batchFile: text("batch_file"),
  entryCount: integer("entry_count").default(0),
  totalAmount: numeric("total_amount").default("0"),
  failureCode: text("failure_code"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAchBatchSchema = createInsertSchema(achBatches).omit({ id: true, createdAt: true, updatedAt: true });
export type AchBatch = typeof achBatches.$inferSelect;
export type InsertAchBatch = z.infer<typeof insertAchBatchSchema>;

// ── Payroll Transaction Runs ──────────────────────────────────────────────────
export const payrollTransactionRuns = pgTable("payroll_transaction_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payrollRunId: varchar("payroll_run_id").notNull().references(() => payrollRuns.id),
  payrollItemId: varchar("payroll_item_id").references(() => payrollItems.id),
  workerId: varchar("worker_id").notNull().references(() => workers.id),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  paymentMethod: text("payment_method").default("check"),
  netPay: numeric("net_pay").default("0"),
  payDate: date("pay_date"),
  status: text("status").default("approved"),
  fundingAccountId: varchar("funding_account_id"),
  checkNumber: text("check_number"),
  achBatchId: varchar("ach_batch_id"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPayrollTransactionRunSchema = createInsertSchema(payrollTransactionRuns).omit({ id: true, createdAt: true, updatedAt: true });
export type PayrollTransactionRun = typeof payrollTransactionRuns.$inferSelect;
export type InsertPayrollTransactionRun = z.infer<typeof insertPayrollTransactionRunSchema>;

export const tenantProvisioningAuditLogs = pgTable("tenant_provisioning_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  eventType: text("event_type").notNull(),
  step: text("step"),
  status: text("status").notNull().default("success"), // success | failed | skipped
  details: text("details"),
  triggeredBy: text("triggered_by").default("system"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const tenantImplementationProjects = pgTable("tenant_implementation_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  templateKey: text("template_key").notNull(),
  templateName: text("template_name").notNull(),
  status: text("status").notNull().default("in_progress"), // in_progress | completed | on_hold
  completedSteps: integer("completed_steps").notNull().default(0),
  totalSteps: integer("total_steps").notNull().default(0),
  checklistItems: text("checklist_items"), // JSON array
  internalTasks: text("internal_tasks"), // JSON array
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTenantCommercialGateSchema = createInsertSchema(tenantCommercialGates).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTenantProvisioningAuditLogSchema = createInsertSchema(tenantProvisioningAuditLogs).omit({ id: true, createdAt: true });
export const insertTenantImplementationProjectSchema = createInsertSchema(tenantImplementationProjects).omit({ id: true, createdAt: true });

export type TenantCommercialGate = typeof tenantCommercialGates.$inferSelect;
export type InsertTenantCommercialGate = z.infer<typeof insertTenantCommercialGateSchema>;
export type TenantProvisioningAuditLog = typeof tenantProvisioningAuditLogs.$inferSelect;
export type InsertTenantProvisioningAuditLog = z.infer<typeof insertTenantProvisioningAuditLogSchema>;
export type TenantImplementationProject = typeof tenantImplementationProjects.$inferSelect;
export type InsertTenantImplementationProject = z.infer<typeof insertTenantImplementationProjectSchema>;

// ── Agreement Templates ─────────────────────────────────────────────────────
export const agreementTemplates = pgTable("agreement_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "cascade" }),
  templateKey: text("template_key").notNull(),
  templateName: text("template_name").notNull(),
  workerType: text("worker_type").notNull().default("contractor"),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("draft"),
  htmlBody: text("html_body").notNull(),
  plainTextBody: text("plain_text_body"),
  schemaJson: text("schema_json"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAgreementTemplateSchema = createInsertSchema(agreementTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type AgreementTemplate = typeof agreementTemplates.$inferSelect;
export type InsertAgreementTemplate = z.infer<typeof insertAgreementTemplateSchema>;

// ── Worker Agreements ───────────────────────────────────────────────────────
export const workerAgreements = pgTable("worker_agreements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
  onboardingId: varchar("onboarding_id"),
  templateId: varchar("template_id").references(() => agreementTemplates.id),
  templateVersion: integer("template_version").notNull().default(1),
  renderedHtml: text("rendered_html").notNull(),
  status: text("status").notNull().default("pending_signature"),
  signatureProvider: text("signature_provider").default("internal"),
  signedAt: timestamp("signed_at"),
  signedByName: text("signed_by_name"),
  signedByWorkerId: varchar("signed_by_worker_id"),
  voidedAt: timestamp("voided_at"),
  voidReason: text("void_reason"),
  mergeData: text("merge_data"),
  sentAt: timestamp("sent_at"),
  viewedAt: timestamp("viewed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWorkerAgreementSchema = createInsertSchema(workerAgreements).omit({ id: true, createdAt: true, updatedAt: true });
export type WorkerAgreement = typeof workerAgreements.$inferSelect;
export type InsertWorkerAgreement = z.infer<typeof insertWorkerAgreementSchema>;

// ── Worker Onboarding ───────────────────────────────────────────────────────
export const workerOnboarding = pgTable("worker_onboarding", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
  workerType: text("worker_type").notNull().default("contractor"),
  packageKey: text("package_key").notNull().default("contractor_standard"),
  status: text("status").notNull().default("draft"),
  inviteTokenHash: text("invite_token_hash"),
  inviteExpiresAt: timestamp("invite_expires_at"),
  startedAt: timestamp("started_at"),
  submittedAt: timestamp("submitted_at"),
  approvedAt: timestamp("approved_at"),
  approvedBy: varchar("approved_by"),
  completionPercent: integer("completion_percent").default(0),
  currentStepKey: text("current_step_key"),
  managerNotes: text("manager_notes"),
  managerData: text("manager_data"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWorkerOnboardingSchema = createInsertSchema(workerOnboarding).omit({ id: true, createdAt: true, updatedAt: true });
export type WorkerOnboarding = typeof workerOnboarding.$inferSelect;
export type InsertWorkerOnboarding = z.infer<typeof insertWorkerOnboardingSchema>;

// ── Onboarding Steps ────────────────────────────────────────────────────────
export const onboardingSteps = pgTable("onboarding_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  onboardingId: varchar("onboarding_id").notNull().references(() => workerOnboarding.id, { onDelete: "cascade" }),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
  stepKey: text("step_key").notNull(),
  stepType: text("step_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  sequence: integer("sequence").notNull().default(0),
  required: boolean("required").default(true),
  status: text("status").notNull().default("not_started"),
  assignedToRole: text("assigned_to_role").notNull().default("worker"),
  dependsOnStepKeys: text("depends_on_step_keys"),
  dataJson: text("data_json"),
  reviewNotes: text("review_notes"),
  submittedAt: timestamp("submitted_at"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: varchar("reviewed_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOnboardingStepSchema = createInsertSchema(onboardingSteps).omit({ id: true, createdAt: true, updatedAt: true });
export type OnboardingStep = typeof onboardingSteps.$inferSelect;
export type InsertOnboardingStep = z.infer<typeof insertOnboardingStepSchema>;

// ── Worker Onboarding Documents ─────────────────────────────────────────────
export const workerOnboardingDocuments = pgTable("worker_onboarding_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
  onboardingId: varchar("onboarding_id").notNull().references(() => workerOnboarding.id, { onDelete: "cascade" }),
  stepId: varchar("step_id").references(() => onboardingSteps.id),
  documentType: text("document_type").notNull(),
  fileUrl: text("file_url"),
  storageKey: text("storage_key"),
  mimeType: text("mime_type"),
  documentStatus: text("document_status").notNull().default("uploaded"),
  templateId: varchar("template_id"),
  workerAgreementId: varchar("worker_agreement_id"),
  signatureCompletedAt: timestamp("signature_completed_at"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: varchar("reviewed_by"),
  metadataJson: text("metadata_json"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWorkerOnboardingDocumentSchema = createInsertSchema(workerOnboardingDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type WorkerOnboardingDocument = typeof workerOnboardingDocuments.$inferSelect;
export type InsertWorkerOnboardingDocument = z.infer<typeof insertWorkerOnboardingDocumentSchema>;

// ── Onboarding Audit Log ────────────────────────────────────────────────────
export const onboardingAuditLog = pgTable("onboarding_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
  onboardingId: varchar("onboarding_id").notNull().references(() => workerOnboarding.id, { onDelete: "cascade" }),
  stepId: varchar("step_id"),
  actorUserId: varchar("actor_user_id"),
  actorType: text("actor_type").notNull().default("system"),
  eventType: text("event_type").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOnboardingAuditLogSchema = createInsertSchema(onboardingAuditLog).omit({ id: true, createdAt: true });
export type OnboardingAuditLogEntry = typeof onboardingAuditLog.$inferSelect;
export type InsertOnboardingAuditLogEntry = z.infer<typeof insertOnboardingAuditLogSchema>;

// ── Tax Filing Snapshots (persisted tax wizard calculations) ────────────────
export const taxFilingSnapshots = pgTable("tax_filing_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  legalEntityId: varchar("legal_entity_id"),
  taxYear: integer("tax_year").notNull(),
  taxPeriod: text("tax_period"),
  formType: text("form_type").notNull(),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  status: text("status").default("draft"),
  generatedDataJson: text("generated_data_json"),
  generatedAt: timestamp("generated_at"),
  generatedByUserId: varchar("generated_by_user_id"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedByUserId: varchar("reviewed_by_user_id"),
  approvedAt: timestamp("approved_at"),
  approvedByUserId: varchar("approved_by_user_id"),
  filedAt: timestamp("filed_at"),
  filedByUserId: varchar("filed_by_user_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTaxFilingSnapshotSchema = createInsertSchema(taxFilingSnapshots).omit({ id: true, createdAt: true, updatedAt: true });
export type TaxFilingSnapshot = typeof taxFilingSnapshots.$inferSelect;
export type InsertTaxFilingSnapshot = z.infer<typeof insertTaxFilingSnapshotSchema>;

// ══════════════════════════════════════════════════════════════════════════════
// UNIFIED BILLING DOCUMENTS MODULE (Invoices + Proposals)
// ══════════════════════════════════════════════════════════════════════════════

// ── Company Branding Profiles ─────────────────────────────────────────────────
export const companyBranding = pgTable("company_branding", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  logoPath: text("logo_path"),
  logoUrl: text("logo_url"),
  legalName: text("legal_name"),
  dbaName: text("dba_name"),
  billingAddress: text("billing_address"),
  billingCity: text("billing_city"),
  billingState: text("billing_state"),
  billingZip: text("billing_zip"),
  billingCountry: text("billing_country").default("US"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  taxId: text("tax_id"),
  accentColor: text("accent_color").default("#0d9488"),
  footerText: text("footer_text"),
  defaultPaymentInstructions: text("default_payment_instructions"),
  defaultInvoiceTerms: text("default_invoice_terms").default("Payment due within 30 days."),
  defaultProposalTerms: text("default_proposal_terms"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCompanyBrandingSchema = createInsertSchema(companyBranding).omit({ id: true, createdAt: true, updatedAt: true });
export type CompanyBranding = typeof companyBranding.$inferSelect;
export type InsertCompanyBranding = z.infer<typeof insertCompanyBrandingSchema>;

// ── Biz Document Templates ────────────────────────────────────────────────────
export const bizDocumentTemplates = pgTable("biz_document_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id), // null = system template
  documentType: text("document_type").notNull().default("invoice"), // invoice | proposal
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").default(true),
  isActive: boolean("is_active").default(true),
  previewColor: text("preview_color").default("#0d9488"),
  config: text("config"), // JSON
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBizDocumentTemplateSchema = createInsertSchema(bizDocumentTemplates).omit({ id: true, createdAt: true });
export type BizDocumentTemplate = typeof bizDocumentTemplates.$inferSelect;
export type InsertBizDocumentTemplate = z.infer<typeof insertBizDocumentTemplateSchema>;

// ── Biz Documents (unified invoices + proposals) ───────────────────────────────
export const bizDocuments = pgTable("biz_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  documentType: text("document_type").notNull().default("invoice"), // invoice | proposal | estimate | quote | credit_memo
  documentNumber: text("document_number"),
  status: text("status").notNull().default("draft"),
  // Ownership / authorship
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  ownerEntityType: text("owner_entity_type").default("company"), // company | contractor
  ownerEntityId: varchar("owner_entity_id"), // workerId for contractor-owned docs
  submittedByUserId: varchar("submitted_by_user_id").references(() => users.id),
  // Assignment target
  assignedToEntityType: text("assigned_to_entity_type"), // client | contractor | department
  assignedToEntityId: varchar("assigned_to_entity_id"),
  assignedToName: text("assigned_to_name"),
  assignedToEmail: text("assigned_to_email"),
  // Template + branding
  templateId: varchar("template_id").references(() => bizDocumentTemplates.id),
  templateSlug: text("template_slug").default("modern_clean"),
  // Dates
  issueDate: date("issue_date"),
  dueDate: date("due_date"),
  expirationDate: date("expiration_date"),
  servicePeriodStart: date("service_period_start"),
  servicePeriodEnd: date("service_period_end"),
  // Financials
  subtotal: numeric("subtotal").default("0"),
  taxRate: numeric("tax_rate").default("0"),
  taxTotal: numeric("tax_total").default("0"),
  discountTotal: numeric("discount_total").default("0"),
  total: numeric("total").default("0"),
  currency: text("currency").default("USD"),
  // References
  poNumber: text("po_number"),
  internalReference: text("internal_reference"),
  title: text("title"),
  notes: text("notes"),
  terms: text("terms"),
  paymentInstructions: text("payment_instructions"),
  // Reviewer actions
  reviewedByUserId: varchar("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  rejectionReason: text("rejection_reason"),
  revisionNotes: text("revision_notes"),
  // Payment
  paidAt: timestamp("paid_at"),
  paidAmount: numeric("paid_amount"),
  paymentReference: text("payment_reference"),
  // Conversion (proposal → invoice)
  convertedFromId: varchar("converted_from_id"),
  convertedToId: varchar("converted_to_id"),
  // Metadata
  metadata: text("metadata"), // JSON
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBizDocumentSchema = createInsertSchema(bizDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type BizDocument = typeof bizDocuments.$inferSelect;
export type InsertBizDocument = z.infer<typeof insertBizDocumentSchema>;

// ── Biz Document Line Items ───────────────────────────────────────────────────
export const bizDocumentItems = pgTable("biz_document_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull().references(() => bizDocuments.id),
  description: text("description").notNull(),
  quantity: numeric("quantity").default("1"),
  unitPrice: numeric("unit_price").default("0"),
  amount: numeric("amount").default("0"),
  taxable: boolean("taxable").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBizDocumentItemSchema = createInsertSchema(bizDocumentItems).omit({ id: true, createdAt: true });
export type BizDocumentItem = typeof bizDocumentItems.$inferSelect;
export type InsertBizDocumentItem = z.infer<typeof insertBizDocumentItemSchema>;

// ── Biz Document Attachments ──────────────────────────────────────────────────
export const bizDocumentAttachments = pgTable("biz_document_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull().references(() => bizDocuments.id),
  filePath: text("file_path").notNull(),
  fileName: text("file_name"),
  fileType: text("file_type"),
  fileSize: integer("file_size"),
  uploadedByUserId: varchar("uploaded_by_user_id").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

export const insertBizDocumentAttachmentSchema = createInsertSchema(bizDocumentAttachments).omit({ id: true, uploadedAt: true });
export type BizDocumentAttachment = typeof bizDocumentAttachments.$inferSelect;
export type InsertBizDocumentAttachment = z.infer<typeof insertBizDocumentAttachmentSchema>;

// ── Notification Templates (admin-editable) ───────────────────────────────────
export const notificationTemplates = pgTable("notification_templates", {
  id: serial("id").primaryKey(),
  eventType: varchar("event_type", { length: 100 }).notNull().unique(),
  label: varchar("label", { length: 200 }).notNull(),
  description: text("description"),
  emailEnabled: boolean("email_enabled").default(true).notNull(),
  smsEnabled: boolean("sms_enabled").default(true).notNull(),
  emailSubject: varchar("email_subject", { length: 300 }).notNull(),
  emailBody: text("email_body").notNull(),
  smsBody: text("sms_body").notNull(),
  variables: jsonb("variables").$type<string[]>().default([]),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: varchar("updated_by", { length: 100 }),
});

export const insertNotificationTemplateSchema = createInsertSchema(notificationTemplates).omit({ id: true, updatedAt: true });
export type NotificationTemplate = typeof notificationTemplates.$inferSelect;
export type InsertNotificationTemplate = z.infer<typeof insertNotificationTemplateSchema>;

// ── Biz Document Status History ───────────────────────────────────────────────
export const bizDocumentHistory = pgTable("biz_document_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull().references(() => bizDocuments.id),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  changedByUserId: varchar("changed_by_user_id").references(() => users.id),
  changedByName: text("changed_by_name"),
  changedAt: timestamp("changed_at").defaultNow(),
  note: text("note"),
});

export const insertBizDocumentHistorySchema = createInsertSchema(bizDocumentHistory).omit({ id: true, changedAt: true });
export type BizDocumentHistory = typeof bizDocumentHistory.$inferSelect;
export type InsertBizDocumentHistory = z.infer<typeof insertBizDocumentHistorySchema>;

// ── Check Print Audit Logs ─────────────────────────────────────────────────────
export const checkPrintAuditLogs = pgTable("check_print_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payrollRunId: varchar("payroll_run_id").references(() => payrollRuns.id),
  companyId: varchar("company_id").references(() => companies.id),
  initiatedByUserId: varchar("initiated_by_user_id").references(() => users.id),
  checkCount: integer("check_count").default(0),
  totalAmount: numeric("total_amount"),
  fundingAccountId: varchar("funding_account_id"),
  micrValidation: text("micr_validation"),
  validationErrors: jsonb("validation_errors").$type<Array<{ workerId: string; workerName: string; errors: string[] }>>().default([]),
  printBlocked: boolean("print_blocked").default(false),
  templateId: varchar("template_id"),
  renderEngine: text("render_engine").default("browser-print"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCheckPrintAuditLogSchema = createInsertSchema(checkPrintAuditLogs).omit({ id: true, createdAt: true });
export type CheckPrintAuditLog = typeof checkPrintAuditLogs.$inferSelect;
export type InsertCheckPrintAuditLog = z.infer<typeof insertCheckPrintAuditLogSchema>;

// ── Stripe Treasury Outbound Payments ─────────────────────────────────────────
export const treasuryOutboundPayments = pgTable("treasury_outbound_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  payrollRunId: varchar("payroll_run_id").references(() => payrollRuns.id),
  workerId: varchar("worker_id").references(() => workers.id),
  stripeOutboundPaymentId: text("stripe_outbound_payment_id").unique(),
  stripeFinancialAccountId: text("stripe_financial_account_id"),
  amount: integer("amount").notNull(),
  currency: text("currency").default("usd"),
  status: text("status").notNull().default("pending"),
  recipientName: text("recipient_name"),
  routingNumber: text("routing_number"),
  accountNumber: text("account_number"),
  memo: text("memo"),
  errorMessage: text("error_message"),
  stripeRawStatus: text("stripe_raw_status"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTreasuryOutboundPaymentSchema = createInsertSchema(treasuryOutboundPayments).omit({ id: true, createdAt: true, updatedAt: true });
export type TreasuryOutboundPayment = typeof treasuryOutboundPayments.$inferSelect;
export type InsertTreasuryOutboundPayment = z.infer<typeof insertTreasuryOutboundPaymentSchema>;

// ── Weekly KPI Goals ──────────────────────────────────────────────────────────
export const weeklyLaborGoals = pgTable("weekly_labor_goals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  costCenterId: varchar("cost_center_id"),
  jobId: varchar("job_id"),
  weekStart: date("week_start").notNull(),
  targetAmount: numeric("target_amount").notNull().default("0"),
  autoRecur: boolean("auto_recur").default(false),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWeeklyLaborGoalSchema = createInsertSchema(weeklyLaborGoals).omit({ id: true, createdAt: true });
export type WeeklyLaborGoal = typeof weeklyLaborGoals.$inferSelect;
export type InsertWeeklyLaborGoal = z.infer<typeof insertWeeklyLaborGoalSchema>;

export const weeklyRevenueGoals = pgTable("weekly_revenue_goals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  costCenterId: varchar("cost_center_id"),
  jobId: varchar("job_id"),
  weekStart: date("week_start").notNull(),
  targetAmount: numeric("target_amount").notNull().default("0"),
  autoRecur: boolean("auto_recur").default(false),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWeeklyRevenueGoalSchema = createInsertSchema(weeklyRevenueGoals).omit({ id: true, createdAt: true });
export type WeeklyRevenueGoal = typeof weeklyRevenueGoals.$inferSelect;
export type InsertWeeklyRevenueGoal = z.infer<typeof insertWeeklyRevenueGoalSchema>;

// ── Inventory Items ────────────────────────────────────────────────────────────
export const inventoryItems = pgTable("inventory_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  quantity: numeric("quantity").notNull().default("0"),
  unit: text("unit"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;

export const smtpConfig = pgTable("smtp_config", {
  id: serial("id").primaryKey(),
  host: text("host"),
  port: integer("port").default(587),
  username: text("username"),
  passwordHash: text("password_hash"),
  hasPassword: boolean("has_password").default(false),
  tlsMode: text("tls_mode").default("starttls"),
  fromName: text("from_name"),
  fromEmail: text("from_email"),
  isConfigured: boolean("is_configured").default(false),
  lastTestedAt: timestamp("last_tested_at"),
  lastTestResult: text("last_test_result"),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: text("updated_by"),
});

export const insertSmtpConfigSchema = createInsertSchema(smtpConfig).omit({ id: true, updatedAt: true });
export type SmtpConfig = typeof smtpConfig.$inferSelect;
export type InsertSmtpConfig = z.infer<typeof insertSmtpConfigSchema>;

export const smsConfig = pgTable("sms_config", {
  id: serial("id").primaryKey(),
  provider: text("provider").default("twilio"),
  accountSid: text("account_sid"),
  hasAuthToken: boolean("has_auth_token").default(false),
  authTokenHash: text("auth_token_hash"),
  fromNumber: text("from_number"),
  messagingServiceSid: text("messaging_service_sid"),
  isConfigured: boolean("is_configured").default(false),
  lastTestedAt: timestamp("last_tested_at"),
  lastTestResult: text("last_test_result"),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: text("updated_by"),
});

export const insertSmsConfigSchema = createInsertSchema(smsConfig).omit({ id: true, updatedAt: true });
export type SmsConfig = typeof smsConfig.$inferSelect;
export type InsertSmsConfig = z.infer<typeof insertSmsConfigSchema>;

// ── Feature Registry ──────────────────────────────────────────────────────────
// Canonical list of all product features, managed by platform admins.
export const featureRegistry = pgTable("feature_registry", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  featureKey: text("feature_key").notNull().unique(),
  module: text("module").notNull(),
  featureName: text("feature_name").notNull(),
  layer: text("layer").notNull(), // "platform" | "tenant" | "employee"
  tier: text("tier").notNull().default("all"), // "starter" | "professional" | "enterprise" | "all"
  description: text("description"),
  defaultOn: boolean("default_on").notNull().default(true),
  isBeta: boolean("is_beta").notNull().default(false),
  billingImpact: boolean("billing_impact").notNull().default(false),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertFeatureRegistrySchema = createInsertSchema(featureRegistry).omit({ id: true, createdAt: true });
export type FeatureRegistry = typeof featureRegistry.$inferSelect;
export type InsertFeatureRegistry = z.infer<typeof insertFeatureRegistrySchema>;

// Per-tenant feature overrides (enables/disables a feature for a specific company).
export const featureOverrides = pgTable("feature_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  featureKey: text("feature_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  expiresAt: timestamp("expires_at"),
  notes: text("notes"),
  enabledBy: varchar("enabled_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFeatureOverridesSchema = createInsertSchema(featureOverrides).omit({ id: true, createdAt: true, updatedAt: true });
export type FeatureOverride = typeof featureOverrides.$inferSelect;
export type InsertFeatureOverride = z.infer<typeof insertFeatureOverridesSchema>;

// Audit log for all feature activation/deactivation events.
export const featureActivationLog = pgTable("feature_activation_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id"),
  companyName: text("company_name"),
  featureKey: text("feature_key").notNull(),
  action: text("action").notNull(), // "enabled" | "disabled" | "expiry_updated"
  performedBy: varchar("performed_by"),
  performedByName: text("performed_by_name"),
  notes: text("notes"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertFeatureActivationLogSchema = createInsertSchema(featureActivationLog).omit({ id: true, createdAt: true });
export type FeatureActivationLog = typeof featureActivationLog.$inferSelect;
export type InsertFeatureActivationLog = z.infer<typeof insertFeatureActivationLogSchema>;

// ── Earning Types ─────────────────────────────────────────────────────────────
export const earningTypes = pgTable("earning_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  code: text("code").notNull(),   // commission | hourly | salary | bonus
  label: text("label").notNull(),
  isTaxable: boolean("is_taxable").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertEarningTypeSchema = createInsertSchema(earningTypes).omit({ id: true, createdAt: true });
export type EarningType = typeof earningTypes.$inferSelect;
export type InsertEarningType = z.infer<typeof insertEarningTypeSchema>;

// ── Commissions ───────────────────────────────────────────────────────────────
export const commissions = pgTable("commissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  workerId: varchar("worker_id").notNull(),
  amount: numeric("amount").notNull(),
  description: text("description"),
  sourceType: text("source_type").default("manual"), // manual | order | deal
  sourceId: varchar("source_id"),
  earnedDate: date("earned_date").notNull(),
  status: text("status").default("pending"),  // pending | approved | paid
  payrollRunId: varchar("payroll_run_id"),     // set when marked paid
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertCommissionSchema = createInsertSchema(commissions).omit({ id: true, createdAt: true });
export type Commission = typeof commissions.$inferSelect;
export type InsertCommission = z.infer<typeof insertCommissionSchema>;

// ── Pay Stub Line Items ───────────────────────────────────────────────────────
export const payStubLineItems = pgTable("pay_stub_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payrollItemId: varchar("payroll_item_id").notNull(),
  earningTypeId: varchar("earning_type_id"),
  description: text("description"),
  amount: numeric("amount").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertPayStubLineItemSchema = createInsertSchema(payStubLineItems).omit({ id: true, createdAt: true });
export type PayStubLineItem = typeof payStubLineItems.$inferSelect;
export type InsertPayStubLineItem = z.infer<typeof insertPayStubLineItemSchema>;
