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
  ein: text("ein"),
  entityType: entityTypeEnum("entity_type").default("llc"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  phone: text("phone"),
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
  payRate: numeric("pay_rate").default("0"),
  payType: text("pay_type").default("hourly"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").default("admin"),
  companyId: varchar("company_id"),
});

export const insertCompanySchema = createInsertSchema(companies).omit({ id: true, createdAt: true });
export const insertWorkerSchema = createInsertSchema(workers).omit({ id: true, createdAt: true });
export const insertTimePunchSchema = createInsertSchema(timePunches).omit({ id: true, createdAt: true });
export const insertTimeEntrySchema = createInsertSchema(timeEntries).omit({ id: true, createdAt: true });
export const insertScheduleSchema = createInsertSchema(schedules).omit({ id: true, createdAt: true });
export const insertPayrollRunSchema = createInsertSchema(payrollRuns).omit({ id: true, createdAt: true });
export const insertPayrollItemSchema = createInsertSchema(payrollItems).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).pick({ username: true, password: true });

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
