import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { db } from "./db";
import {
  companies, workers, timePunches, timeEntries, schedules, payrollRuns, payrollItems, users,
  type Company, type InsertCompany,
  type Worker, type InsertWorker,
  type TimePunch, type InsertTimePunch,
  type TimeEntry, type InsertTimeEntry,
  type Schedule, type InsertSchedule,
  type PayrollRun, type InsertPayrollRun,
  type PayrollItem, type InsertPayrollItem,
  type User, type InsertUser,
} from "@shared/schema";

export interface IStorage {
  getCompanies(): Promise<Company[]>;
  getCompany(id: string): Promise<Company | undefined>;
  createCompany(data: InsertCompany): Promise<Company>;
  updateCompany(id: string, data: Partial<Company>): Promise<Company | undefined>;

  getWorkers(companyId?: string): Promise<Worker[]>;
  getWorker(id: string): Promise<Worker | undefined>;
  createWorker(data: InsertWorker): Promise<Worker>;
  updateWorker(id: string, data: Partial<Worker>): Promise<Worker | undefined>;

  getTimePunches(companyId?: string): Promise<TimePunch[]>;
  createTimePunch(data: InsertTimePunch): Promise<TimePunch>;

  getTimeEntries(companyId?: string): Promise<TimeEntry[]>;
  getTimeEntriesByDateRange(companyId: string, startDate: string, endDate: string): Promise<TimeEntry[]>;
  getTimeEntry(id: string): Promise<TimeEntry | undefined>;
  createTimeEntry(data: InsertTimeEntry): Promise<TimeEntry>;
  updateTimeEntry(id: string, data: Partial<TimeEntry>): Promise<TimeEntry | undefined>;

  getSchedules(companyId?: string): Promise<Schedule[]>;
  createSchedule(data: InsertSchedule): Promise<Schedule>;

  getPayrollRuns(companyId?: string): Promise<PayrollRun[]>;
  getPayrollRun(id: string): Promise<PayrollRun | undefined>;
  createPayrollRun(data: InsertPayrollRun): Promise<PayrollRun>;
  updatePayrollRun(id: string, data: Partial<PayrollRun>): Promise<PayrollRun | undefined>;

  getPayrollItems(payrollRunId: string): Promise<PayrollItem[]>;
  createPayrollItem(data: InsertPayrollItem): Promise<PayrollItem>;

  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  getDashboardStats(): Promise<{
    totalEmployees: number;
    totalContractors: number;
    activeToday: number;
    pendingTimesheets: number;
    totalHoursThisWeek: number;
    overtimeHoursThisWeek: number;
  }>;
}

export class DatabaseStorage implements IStorage {
  async getCompanies(): Promise<Company[]> {
    return db.select().from(companies).orderBy(desc(companies.createdAt));
  }

  async getCompany(id: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company;
  }

  async createCompany(data: InsertCompany): Promise<Company> {
    const [company] = await db.insert(companies).values(data).returning();
    return company;
  }

  async updateCompany(id: string, data: Partial<Company>): Promise<Company | undefined> {
    const [company] = await db.update(companies).set(data).where(eq(companies.id, id)).returning();
    return company;
  }

  async getWorkers(companyId?: string): Promise<Worker[]> {
    if (companyId) {
      return db.select().from(workers).where(eq(workers.companyId, companyId)).orderBy(desc(workers.createdAt));
    }
    return db.select().from(workers).orderBy(desc(workers.createdAt));
  }

  async getWorker(id: string): Promise<Worker | undefined> {
    const [worker] = await db.select().from(workers).where(eq(workers.id, id));
    return worker;
  }

  async createWorker(data: InsertWorker): Promise<Worker> {
    const [worker] = await db.insert(workers).values(data).returning();
    return worker;
  }

  async updateWorker(id: string, data: Partial<Worker>): Promise<Worker | undefined> {
    const [worker] = await db.update(workers).set(data).where(eq(workers.id, id)).returning();
    return worker;
  }

  async getTimePunches(companyId?: string): Promise<TimePunch[]> {
    if (companyId) {
      return db.select().from(timePunches).where(eq(timePunches.companyId, companyId)).orderBy(desc(timePunches.punchTime));
    }
    return db.select().from(timePunches).orderBy(desc(timePunches.punchTime));
  }

  async createTimePunch(data: InsertTimePunch): Promise<TimePunch> {
    const [punch] = await db.insert(timePunches).values(data).returning();
    return punch;
  }

  async getTimeEntries(companyId?: string): Promise<TimeEntry[]> {
    if (companyId) {
      return db.select().from(timeEntries).where(eq(timeEntries.companyId, companyId)).orderBy(desc(timeEntries.date));
    }
    return db.select().from(timeEntries).orderBy(desc(timeEntries.date));
  }

  async getTimeEntriesByDateRange(companyId: string, startDate: string, endDate: string): Promise<TimeEntry[]> {
    return db.select().from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          gte(timeEntries.date, startDate),
          lte(timeEntries.date, endDate),
          eq(timeEntries.status, "approved")
        )
      )
      .orderBy(desc(timeEntries.date));
  }

  async getTimeEntry(id: string): Promise<TimeEntry | undefined> {
    const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, id));
    return entry;
  }

  async createTimeEntry(data: InsertTimeEntry): Promise<TimeEntry> {
    const [entry] = await db.insert(timeEntries).values(data).returning();
    return entry;
  }

  async updateTimeEntry(id: string, data: Partial<TimeEntry>): Promise<TimeEntry | undefined> {
    const [entry] = await db.update(timeEntries).set(data).where(eq(timeEntries.id, id)).returning();
    return entry;
  }

  async getSchedules(companyId?: string): Promise<Schedule[]> {
    if (companyId) {
      return db.select().from(schedules).where(eq(schedules.companyId, companyId)).orderBy(desc(schedules.date));
    }
    return db.select().from(schedules).orderBy(desc(schedules.date));
  }

  async createSchedule(data: InsertSchedule): Promise<Schedule> {
    const [schedule] = await db.insert(schedules).values(data).returning();
    return schedule;
  }

  async getPayrollRuns(companyId?: string): Promise<PayrollRun[]> {
    if (companyId) {
      return db.select().from(payrollRuns).where(eq(payrollRuns.companyId, companyId)).orderBy(desc(payrollRuns.createdAt));
    }
    return db.select().from(payrollRuns).orderBy(desc(payrollRuns.createdAt));
  }

  async getPayrollRun(id: string): Promise<PayrollRun | undefined> {
    const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, id));
    return run;
  }

  async createPayrollRun(data: InsertPayrollRun): Promise<PayrollRun> {
    const [run] = await db.insert(payrollRuns).values(data).returning();
    return run;
  }

  async updatePayrollRun(id: string, data: Partial<PayrollRun>): Promise<PayrollRun | undefined> {
    const [run] = await db.update(payrollRuns).set(data).where(eq(payrollRuns.id, id)).returning();
    return run;
  }

  async getPayrollItems(payrollRunId: string): Promise<PayrollItem[]> {
    return db.select().from(payrollItems).where(eq(payrollItems.payrollRunId, payrollRunId));
  }

  async createPayrollItem(data: InsertPayrollItem): Promise<PayrollItem> {
    const [item] = await db.insert(payrollItems).values(data).returning();
    return item;
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(data: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  }

  async getDashboardStats() {
    const allWorkers = await db.select().from(workers);
    const activeWorkers = allWorkers.filter(w => w.isActive);
    const totalEmployees = activeWorkers.filter(w => w.workerType === "employee").length;
    const totalContractors = activeWorkers.filter(w => w.workerType === "contractor").length;

    const today = new Date().toISOString().split("T")[0];
    const todayEntries = await db.select().from(timeEntries).where(eq(timeEntries.date, today));
    const activeToday = new Set(todayEntries.map(e => e.workerId)).size;

    const allEntries = await db.select().from(timeEntries);
    const pendingTimesheets = allEntries.filter(e => e.status === "pending").length;

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const weekEntries = allEntries.filter(e => new Date(e.date) >= startOfWeek);
    const totalHoursThisWeek = weekEntries.reduce((sum, e) => sum + Number(e.totalHours || 0), 0);
    const overtimeHoursThisWeek = weekEntries.reduce((sum, e) => sum + Number(e.overtimeHours || 0), 0);

    return {
      totalEmployees,
      totalContractors,
      activeToday,
      pendingTimesheets,
      totalHoursThisWeek,
      overtimeHoursThisWeek,
    };
  }
}

export const storage = new DatabaseStorage();
