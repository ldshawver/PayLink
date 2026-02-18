import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { db } from "./db";
import {
  companies, workers, timePunches, timeEntries, schedules, payrollRuns, payrollItems, users,
  departments, branches, accrualAccounts, accrualBalances, employeeContacts, payMethods,
  payPeriods, taxesDeductions, policyGroups, payCodes, holidays, qualifications, reviews, recurringSchedules,
  remittanceSources, remittanceAgencies, remittanceAgencyEvents, payStubAccounts, payStubAmendments, payStubTransactions, payPeriodSchedules,
  type Company, type InsertCompany,
  type Worker, type InsertWorker,
  type TimePunch, type InsertTimePunch,
  type TimeEntry, type InsertTimeEntry,
  type Schedule, type InsertSchedule,
  type PayrollRun, type InsertPayrollRun,
  type PayrollItem, type InsertPayrollItem,
  type User, type InsertUser,
  type Department, type InsertDepartment,
  type Branch, type InsertBranch,
  type AccrualAccount, type InsertAccrualAccount,
  type AccrualBalance, type InsertAccrualBalance,
  type EmployeeContact, type InsertEmployeeContact,
  type PayMethod, type InsertPayMethod,
  type PayPeriod, type InsertPayPeriod,
  type TaxDeduction, type InsertTaxDeduction,
  type PolicyGroup, type InsertPolicyGroup,
  type PayCode, type InsertPayCode,
  type Holiday, type InsertHoliday,
  type Qualification, type InsertQualification,
  type Review, type InsertReview,
  type RecurringSchedule, type InsertRecurringSchedule,
  type RemittanceSource, type InsertRemittanceSource,
  type RemittanceAgency, type InsertRemittanceAgency,
  type RemittanceAgencyEvent, type InsertRemittanceAgencyEvent,
  type PayStubAccount, type InsertPayStubAccount,
  type PayStubAmendment, type InsertPayStubAmendment,
  type PayStubTransaction, type InsertPayStubTransaction,
  type PayPeriodSchedule, type InsertPayPeriodSchedule,
} from "@shared/schema";

export interface IStorage {
  getCompanies(): Promise<Company[]>;
  getCompany(id: string): Promise<Company | undefined>;
  createCompany(data: InsertCompany): Promise<Company>;
  updateCompany(id: string, data: Partial<Company>): Promise<Company | undefined>;

  getWorkers(companyId?: string): Promise<Worker[]>;
  getWorker(id: string): Promise<Worker | undefined>;
  getWorkerByEmployeeNumber(employeeNumber: string): Promise<Worker | undefined>;
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
  getSchedulesByDateRange(companyId: string, startDate: string, endDate: string): Promise<Schedule[]>;
  createSchedule(data: InsertSchedule): Promise<Schedule>;
  updateSchedule(id: string, data: Partial<Schedule>): Promise<Schedule | undefined>;
  deleteSchedule(id: string): Promise<void>;

  getPayrollRuns(companyId?: string): Promise<PayrollRun[]>;
  getPayrollRun(id: string): Promise<PayrollRun | undefined>;
  createPayrollRun(data: InsertPayrollRun): Promise<PayrollRun>;
  updatePayrollRun(id: string, data: Partial<PayrollRun>): Promise<PayrollRun | undefined>;

  getPayrollItems(payrollRunId: string): Promise<PayrollItem[]>;
  createPayrollItem(data: InsertPayrollItem): Promise<PayrollItem>;

  getDepartments(companyId?: string): Promise<Department[]>;
  createDepartment(data: InsertDepartment): Promise<Department>;
  updateDepartment(id: string, data: Partial<Department>): Promise<Department | undefined>;
  deleteDepartment(id: string): Promise<void>;

  getBranches(companyId?: string): Promise<Branch[]>;
  createBranch(data: InsertBranch): Promise<Branch>;
  updateBranch(id: string, data: Partial<Branch>): Promise<Branch | undefined>;
  deleteBranch(id: string): Promise<void>;

  getAccrualAccounts(companyId?: string): Promise<AccrualAccount[]>;
  createAccrualAccount(data: InsertAccrualAccount): Promise<AccrualAccount>;
  updateAccrualAccount(id: string, data: Partial<AccrualAccount>): Promise<AccrualAccount | undefined>;

  getAccrualBalances(workerId?: string): Promise<AccrualBalance[]>;
  createAccrualBalance(data: InsertAccrualBalance): Promise<AccrualBalance>;
  updateAccrualBalance(id: string, data: Partial<AccrualBalance>): Promise<AccrualBalance | undefined>;

  getEmployeeContacts(workerId?: string): Promise<EmployeeContact[]>;
  createEmployeeContact(data: InsertEmployeeContact): Promise<EmployeeContact>;
  updateEmployeeContact(id: string, data: Partial<EmployeeContact>): Promise<EmployeeContact | undefined>;
  deleteEmployeeContact(id: string): Promise<void>;

  getPayMethods(workerId?: string): Promise<PayMethod[]>;
  createPayMethod(data: InsertPayMethod): Promise<PayMethod>;
  updatePayMethod(id: string, data: Partial<PayMethod>): Promise<PayMethod | undefined>;
  deletePayMethod(id: string): Promise<void>;

  getPayPeriods(companyId?: string): Promise<PayPeriod[]>;
  createPayPeriod(data: InsertPayPeriod): Promise<PayPeriod>;
  updatePayPeriod(id: string, data: Partial<PayPeriod>): Promise<PayPeriod | undefined>;

  getTaxesDeductions(companyId?: string): Promise<TaxDeduction[]>;
  createTaxDeduction(data: InsertTaxDeduction): Promise<TaxDeduction>;
  updateTaxDeduction(id: string, data: Partial<TaxDeduction>): Promise<TaxDeduction | undefined>;
  deleteTaxDeduction(id: string): Promise<void>;

  getPolicyGroups(companyId?: string): Promise<PolicyGroup[]>;
  createPolicyGroup(data: InsertPolicyGroup): Promise<PolicyGroup>;
  updatePolicyGroup(id: string, data: Partial<PolicyGroup>): Promise<PolicyGroup | undefined>;
  deletePolicyGroup(id: string): Promise<void>;

  getPayCodes(companyId?: string): Promise<PayCode[]>;
  createPayCode(data: InsertPayCode): Promise<PayCode>;
  updatePayCode(id: string, data: Partial<PayCode>): Promise<PayCode | undefined>;
  deletePayCode(id: string): Promise<void>;

  getHolidays(companyId?: string): Promise<Holiday[]>;
  createHoliday(data: InsertHoliday): Promise<Holiday>;
  updateHoliday(id: string, data: Partial<Holiday>): Promise<Holiday | undefined>;
  deleteHoliday(id: string): Promise<void>;

  getQualifications(companyId?: string, workerId?: string): Promise<Qualification[]>;
  createQualification(data: InsertQualification): Promise<Qualification>;
  updateQualification(id: string, data: Partial<Qualification>): Promise<Qualification | undefined>;
  deleteQualification(id: string): Promise<void>;

  getReviews(companyId?: string, workerId?: string): Promise<Review[]>;
  createReview(data: InsertReview): Promise<Review>;
  updateReview(id: string, data: Partial<Review>): Promise<Review | undefined>;
  deleteReview(id: string): Promise<void>;

  getRecurringSchedules(companyId?: string): Promise<RecurringSchedule[]>;
  createRecurringSchedule(data: InsertRecurringSchedule): Promise<RecurringSchedule>;
  updateRecurringSchedule(id: string, data: Partial<RecurringSchedule>): Promise<RecurringSchedule | undefined>;
  deleteRecurringSchedule(id: string): Promise<void>;

  getRemittanceSources(companyId?: string): Promise<RemittanceSource[]>;
  createRemittanceSource(data: InsertRemittanceSource): Promise<RemittanceSource>;
  updateRemittanceSource(id: string, data: Partial<RemittanceSource>): Promise<RemittanceSource | undefined>;
  deleteRemittanceSource(id: string): Promise<void>;

  getRemittanceAgencies(companyId?: string): Promise<RemittanceAgency[]>;
  createRemittanceAgency(data: InsertRemittanceAgency): Promise<RemittanceAgency>;
  updateRemittanceAgency(id: string, data: Partial<RemittanceAgency>): Promise<RemittanceAgency | undefined>;
  deleteRemittanceAgency(id: string): Promise<void>;

  getRemittanceAgencyEvents(agencyId: string): Promise<RemittanceAgencyEvent[]>;
  createRemittanceAgencyEvent(data: InsertRemittanceAgencyEvent): Promise<RemittanceAgencyEvent>;
  updateRemittanceAgencyEvent(id: string, data: Partial<RemittanceAgencyEvent>): Promise<RemittanceAgencyEvent | undefined>;
  deleteRemittanceAgencyEvent(id: string): Promise<void>;

  getPayStubAccounts(companyId?: string): Promise<PayStubAccount[]>;
  createPayStubAccount(data: InsertPayStubAccount): Promise<PayStubAccount>;
  updatePayStubAccount(id: string, data: Partial<PayStubAccount>): Promise<PayStubAccount | undefined>;
  deletePayStubAccount(id: string): Promise<void>;

  getPayStubAmendments(companyId?: string): Promise<PayStubAmendment[]>;
  createPayStubAmendment(data: InsertPayStubAmendment): Promise<PayStubAmendment>;
  updatePayStubAmendment(id: string, data: Partial<PayStubAmendment>): Promise<PayStubAmendment | undefined>;
  deletePayStubAmendment(id: string): Promise<void>;

  getPayStubTransactions(companyId?: string): Promise<PayStubTransaction[]>;
  createPayStubTransaction(data: InsertPayStubTransaction): Promise<PayStubTransaction>;
  updatePayStubTransaction(id: string, data: Partial<PayStubTransaction>): Promise<PayStubTransaction | undefined>;

  getPayPeriodSchedules(companyId?: string): Promise<PayPeriodSchedule[]>;
  createPayPeriodSchedule(data: InsertPayPeriodSchedule): Promise<PayPeriodSchedule>;
  updatePayPeriodSchedule(id: string, data: Partial<PayPeriodSchedule>): Promise<PayPeriodSchedule | undefined>;
  deletePayPeriodSchedule(id: string): Promise<void>;

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
  async getWorkerByEmployeeNumber(employeeNumber: string): Promise<Worker | undefined> {
    const [worker] = await db.select().from(workers).where(eq(workers.employeeNumber, employeeNumber));
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
      .where(and(eq(timeEntries.companyId, companyId), gte(timeEntries.date, startDate), lte(timeEntries.date, endDate), eq(timeEntries.status, "approved")))
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
  async getSchedulesByDateRange(companyId: string, startDate: string, endDate: string): Promise<Schedule[]> {
    return db.select().from(schedules).where(
      and(eq(schedules.companyId, companyId), gte(schedules.date, startDate), lte(schedules.date, endDate))
    ).orderBy(schedules.date);
  }
  async createSchedule(data: InsertSchedule): Promise<Schedule> {
    const [schedule] = await db.insert(schedules).values(data).returning();
    return schedule;
  }
  async updateSchedule(id: string, data: Partial<Schedule>): Promise<Schedule | undefined> {
    const [schedule] = await db.update(schedules).set(data).where(eq(schedules.id, id)).returning();
    return schedule;
  }
  async deleteSchedule(id: string): Promise<void> {
    await db.delete(schedules).where(eq(schedules.id, id));
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

  async getDepartments(companyId?: string): Promise<Department[]> {
    if (companyId) return db.select().from(departments).where(eq(departments.companyId, companyId)).orderBy(departments.name);
    return db.select().from(departments).orderBy(departments.name);
  }
  async createDepartment(data: InsertDepartment): Promise<Department> {
    const [d] = await db.insert(departments).values(data).returning();
    return d;
  }
  async updateDepartment(id: string, data: Partial<Department>): Promise<Department | undefined> {
    const [d] = await db.update(departments).set(data).where(eq(departments.id, id)).returning();
    return d;
  }
  async deleteDepartment(id: string): Promise<void> {
    await db.delete(departments).where(eq(departments.id, id));
  }

  async getBranches(companyId?: string): Promise<Branch[]> {
    if (companyId) return db.select().from(branches).where(eq(branches.companyId, companyId)).orderBy(branches.name);
    return db.select().from(branches).orderBy(branches.name);
  }
  async createBranch(data: InsertBranch): Promise<Branch> {
    const [b] = await db.insert(branches).values(data).returning();
    return b;
  }
  async updateBranch(id: string, data: Partial<Branch>): Promise<Branch | undefined> {
    const [b] = await db.update(branches).set(data).where(eq(branches.id, id)).returning();
    return b;
  }
  async deleteBranch(id: string): Promise<void> {
    await db.delete(branches).where(eq(branches.id, id));
  }

  async getAccrualAccounts(companyId?: string): Promise<AccrualAccount[]> {
    if (companyId) return db.select().from(accrualAccounts).where(eq(accrualAccounts.companyId, companyId)).orderBy(accrualAccounts.name);
    return db.select().from(accrualAccounts).orderBy(accrualAccounts.name);
  }
  async createAccrualAccount(data: InsertAccrualAccount): Promise<AccrualAccount> {
    const [a] = await db.insert(accrualAccounts).values(data).returning();
    return a;
  }
  async updateAccrualAccount(id: string, data: Partial<AccrualAccount>): Promise<AccrualAccount | undefined> {
    const [a] = await db.update(accrualAccounts).set(data).where(eq(accrualAccounts.id, id)).returning();
    return a;
  }

  async getAccrualBalances(workerId?: string): Promise<AccrualBalance[]> {
    if (workerId) return db.select().from(accrualBalances).where(eq(accrualBalances.workerId, workerId));
    return db.select().from(accrualBalances);
  }
  async createAccrualBalance(data: InsertAccrualBalance): Promise<AccrualBalance> {
    const [b] = await db.insert(accrualBalances).values(data).returning();
    return b;
  }
  async updateAccrualBalance(id: string, data: Partial<AccrualBalance>): Promise<AccrualBalance | undefined> {
    const [b] = await db.update(accrualBalances).set(data).where(eq(accrualBalances.id, id)).returning();
    return b;
  }

  async getEmployeeContacts(workerId?: string): Promise<EmployeeContact[]> {
    if (workerId) return db.select().from(employeeContacts).where(eq(employeeContacts.workerId, workerId));
    return db.select().from(employeeContacts);
  }
  async createEmployeeContact(data: InsertEmployeeContact): Promise<EmployeeContact> {
    const [c] = await db.insert(employeeContacts).values(data).returning();
    return c;
  }
  async updateEmployeeContact(id: string, data: Partial<EmployeeContact>): Promise<EmployeeContact | undefined> {
    const [c] = await db.update(employeeContacts).set(data).where(eq(employeeContacts.id, id)).returning();
    return c;
  }
  async deleteEmployeeContact(id: string): Promise<void> {
    await db.delete(employeeContacts).where(eq(employeeContacts.id, id));
  }

  async getPayMethods(workerId?: string): Promise<PayMethod[]> {
    if (workerId) return db.select().from(payMethods).where(eq(payMethods.workerId, workerId));
    return db.select().from(payMethods);
  }
  async createPayMethod(data: InsertPayMethod): Promise<PayMethod> {
    const [m] = await db.insert(payMethods).values(data).returning();
    return m;
  }
  async updatePayMethod(id: string, data: Partial<PayMethod>): Promise<PayMethod | undefined> {
    const [m] = await db.update(payMethods).set(data).where(eq(payMethods.id, id)).returning();
    return m;
  }
  async deletePayMethod(id: string): Promise<void> {
    await db.delete(payMethods).where(eq(payMethods.id, id));
  }

  async getPayPeriods(companyId?: string): Promise<PayPeriod[]> {
    if (companyId) return db.select().from(payPeriods).where(eq(payPeriods.companyId, companyId)).orderBy(desc(payPeriods.startDate));
    return db.select().from(payPeriods).orderBy(desc(payPeriods.startDate));
  }
  async createPayPeriod(data: InsertPayPeriod): Promise<PayPeriod> {
    const [p] = await db.insert(payPeriods).values(data).returning();
    return p;
  }
  async updatePayPeriod(id: string, data: Partial<PayPeriod>): Promise<PayPeriod | undefined> {
    const [p] = await db.update(payPeriods).set(data).where(eq(payPeriods.id, id)).returning();
    return p;
  }

  async getTaxesDeductions(companyId?: string): Promise<TaxDeduction[]> {
    if (companyId) return db.select().from(taxesDeductions).where(eq(taxesDeductions.companyId, companyId)).orderBy(taxesDeductions.name);
    return db.select().from(taxesDeductions).orderBy(taxesDeductions.name);
  }
  async createTaxDeduction(data: InsertTaxDeduction): Promise<TaxDeduction> {
    const [t] = await db.insert(taxesDeductions).values(data).returning();
    return t;
  }
  async updateTaxDeduction(id: string, data: Partial<TaxDeduction>): Promise<TaxDeduction | undefined> {
    const [t] = await db.update(taxesDeductions).set(data).where(eq(taxesDeductions.id, id)).returning();
    return t;
  }
  async deleteTaxDeduction(id: string): Promise<void> {
    await db.delete(taxesDeductions).where(eq(taxesDeductions.id, id));
  }

  async getPolicyGroups(companyId?: string): Promise<PolicyGroup[]> {
    if (companyId) return db.select().from(policyGroups).where(eq(policyGroups.companyId, companyId)).orderBy(policyGroups.name);
    return db.select().from(policyGroups).orderBy(policyGroups.name);
  }
  async createPolicyGroup(data: InsertPolicyGroup): Promise<PolicyGroup> {
    const [p] = await db.insert(policyGroups).values(data).returning();
    return p;
  }
  async updatePolicyGroup(id: string, data: Partial<PolicyGroup>): Promise<PolicyGroup | undefined> {
    const [p] = await db.update(policyGroups).set(data).where(eq(policyGroups.id, id)).returning();
    return p;
  }
  async deletePolicyGroup(id: string): Promise<void> {
    await db.delete(policyGroups).where(eq(policyGroups.id, id));
  }

  async getPayCodes(companyId?: string): Promise<PayCode[]> {
    if (companyId) return db.select().from(payCodes).where(eq(payCodes.companyId, companyId)).orderBy(payCodes.name);
    return db.select().from(payCodes).orderBy(payCodes.name);
  }
  async createPayCode(data: InsertPayCode): Promise<PayCode> {
    const [p] = await db.insert(payCodes).values(data).returning();
    return p;
  }
  async updatePayCode(id: string, data: Partial<PayCode>): Promise<PayCode | undefined> {
    const [p] = await db.update(payCodes).set(data).where(eq(payCodes.id, id)).returning();
    return p;
  }
  async deletePayCode(id: string): Promise<void> {
    await db.delete(payCodes).where(eq(payCodes.id, id));
  }

  async getHolidays(companyId?: string): Promise<Holiday[]> {
    if (companyId) return db.select().from(holidays).where(eq(holidays.companyId, companyId)).orderBy(holidays.date);
    return db.select().from(holidays).orderBy(holidays.date);
  }
  async createHoliday(data: InsertHoliday): Promise<Holiday> {
    const [h] = await db.insert(holidays).values(data).returning();
    return h;
  }
  async updateHoliday(id: string, data: Partial<Holiday>): Promise<Holiday | undefined> {
    const [h] = await db.update(holidays).set(data).where(eq(holidays.id, id)).returning();
    return h;
  }
  async deleteHoliday(id: string): Promise<void> {
    await db.delete(holidays).where(eq(holidays.id, id));
  }

  async getQualifications(companyId?: string, workerId?: string): Promise<Qualification[]> {
    if (workerId) return db.select().from(qualifications).where(eq(qualifications.workerId, workerId)).orderBy(qualifications.name);
    if (companyId) return db.select().from(qualifications).where(eq(qualifications.companyId, companyId)).orderBy(qualifications.name);
    return db.select().from(qualifications).orderBy(qualifications.name);
  }
  async createQualification(data: InsertQualification): Promise<Qualification> {
    const [q] = await db.insert(qualifications).values(data).returning();
    return q;
  }
  async updateQualification(id: string, data: Partial<Qualification>): Promise<Qualification | undefined> {
    const [q] = await db.update(qualifications).set(data).where(eq(qualifications.id, id)).returning();
    return q;
  }
  async deleteQualification(id: string): Promise<void> {
    await db.delete(qualifications).where(eq(qualifications.id, id));
  }

  async getReviews(companyId?: string, workerId?: string): Promise<Review[]> {
    if (workerId) return db.select().from(reviews).where(eq(reviews.workerId, workerId)).orderBy(desc(reviews.reviewDate));
    if (companyId) return db.select().from(reviews).where(eq(reviews.companyId, companyId)).orderBy(desc(reviews.reviewDate));
    return db.select().from(reviews).orderBy(desc(reviews.reviewDate));
  }
  async createReview(data: InsertReview): Promise<Review> {
    const [r] = await db.insert(reviews).values(data).returning();
    return r;
  }
  async updateReview(id: string, data: Partial<Review>): Promise<Review | undefined> {
    const [r] = await db.update(reviews).set(data).where(eq(reviews.id, id)).returning();
    return r;
  }
  async deleteReview(id: string): Promise<void> {
    await db.delete(reviews).where(eq(reviews.id, id));
  }

  async getRecurringSchedules(companyId?: string): Promise<RecurringSchedule[]> {
    if (companyId) return db.select().from(recurringSchedules).where(eq(recurringSchedules.companyId, companyId));
    return db.select().from(recurringSchedules);
  }
  async createRecurringSchedule(data: InsertRecurringSchedule): Promise<RecurringSchedule> {
    const [r] = await db.insert(recurringSchedules).values(data).returning();
    return r;
  }
  async updateRecurringSchedule(id: string, data: Partial<RecurringSchedule>): Promise<RecurringSchedule | undefined> {
    const [r] = await db.update(recurringSchedules).set(data).where(eq(recurringSchedules.id, id)).returning();
    return r;
  }
  async deleteRecurringSchedule(id: string): Promise<void> {
    await db.delete(recurringSchedules).where(eq(recurringSchedules.id, id));
  }

  async getRemittanceSources(companyId?: string): Promise<RemittanceSource[]> {
    if (companyId) return db.select().from(remittanceSources).where(eq(remittanceSources.companyId, companyId)).orderBy(desc(remittanceSources.createdAt));
    return db.select().from(remittanceSources).orderBy(desc(remittanceSources.createdAt));
  }
  async createRemittanceSource(data: InsertRemittanceSource): Promise<RemittanceSource> {
    const [r] = await db.insert(remittanceSources).values(data).returning();
    return r;
  }
  async updateRemittanceSource(id: string, data: Partial<RemittanceSource>): Promise<RemittanceSource | undefined> {
    const [r] = await db.update(remittanceSources).set(data).where(eq(remittanceSources.id, id)).returning();
    return r;
  }
  async deleteRemittanceSource(id: string): Promise<void> {
    await db.delete(remittanceSources).where(eq(remittanceSources.id, id));
  }

  async getRemittanceAgencies(companyId?: string): Promise<RemittanceAgency[]> {
    if (companyId) return db.select().from(remittanceAgencies).where(eq(remittanceAgencies.companyId, companyId)).orderBy(desc(remittanceAgencies.createdAt));
    return db.select().from(remittanceAgencies).orderBy(desc(remittanceAgencies.createdAt));
  }
  async createRemittanceAgency(data: InsertRemittanceAgency): Promise<RemittanceAgency> {
    const [r] = await db.insert(remittanceAgencies).values(data).returning();
    return r;
  }
  async updateRemittanceAgency(id: string, data: Partial<RemittanceAgency>): Promise<RemittanceAgency | undefined> {
    const [r] = await db.update(remittanceAgencies).set(data).where(eq(remittanceAgencies.id, id)).returning();
    return r;
  }
  async deleteRemittanceAgency(id: string): Promise<void> {
    await db.delete(remittanceAgencies).where(eq(remittanceAgencies.id, id));
  }

  async getRemittanceAgencyEvents(agencyId: string): Promise<RemittanceAgencyEvent[]> {
    return db.select().from(remittanceAgencyEvents).where(eq(remittanceAgencyEvents.agencyId, agencyId)).orderBy(desc(remittanceAgencyEvents.createdAt));
  }
  async createRemittanceAgencyEvent(data: InsertRemittanceAgencyEvent): Promise<RemittanceAgencyEvent> {
    const [r] = await db.insert(remittanceAgencyEvents).values(data).returning();
    return r;
  }
  async updateRemittanceAgencyEvent(id: string, data: Partial<RemittanceAgencyEvent>): Promise<RemittanceAgencyEvent | undefined> {
    const [r] = await db.update(remittanceAgencyEvents).set(data).where(eq(remittanceAgencyEvents.id, id)).returning();
    return r;
  }
  async deleteRemittanceAgencyEvent(id: string): Promise<void> {
    await db.delete(remittanceAgencyEvents).where(eq(remittanceAgencyEvents.id, id));
  }

  async getPayStubAccounts(companyId?: string): Promise<PayStubAccount[]> {
    if (companyId) return db.select().from(payStubAccounts).where(eq(payStubAccounts.companyId, companyId)).orderBy(desc(payStubAccounts.createdAt));
    return db.select().from(payStubAccounts).orderBy(desc(payStubAccounts.createdAt));
  }
  async createPayStubAccount(data: InsertPayStubAccount): Promise<PayStubAccount> {
    const [r] = await db.insert(payStubAccounts).values(data).returning();
    return r;
  }
  async updatePayStubAccount(id: string, data: Partial<PayStubAccount>): Promise<PayStubAccount | undefined> {
    const [r] = await db.update(payStubAccounts).set(data).where(eq(payStubAccounts.id, id)).returning();
    return r;
  }
  async deletePayStubAccount(id: string): Promise<void> {
    await db.delete(payStubAccounts).where(eq(payStubAccounts.id, id));
  }

  async getPayStubAmendments(companyId?: string): Promise<PayStubAmendment[]> {
    if (companyId) return db.select().from(payStubAmendments).where(eq(payStubAmendments.companyId, companyId)).orderBy(desc(payStubAmendments.createdAt));
    return db.select().from(payStubAmendments).orderBy(desc(payStubAmendments.createdAt));
  }
  async createPayStubAmendment(data: InsertPayStubAmendment): Promise<PayStubAmendment> {
    const [r] = await db.insert(payStubAmendments).values(data).returning();
    return r;
  }
  async updatePayStubAmendment(id: string, data: Partial<PayStubAmendment>): Promise<PayStubAmendment | undefined> {
    const [r] = await db.update(payStubAmendments).set(data).where(eq(payStubAmendments.id, id)).returning();
    return r;
  }
  async deletePayStubAmendment(id: string): Promise<void> {
    await db.delete(payStubAmendments).where(eq(payStubAmendments.id, id));
  }

  async getPayStubTransactions(companyId?: string): Promise<PayStubTransaction[]> {
    if (companyId) return db.select().from(payStubTransactions).where(eq(payStubTransactions.companyId, companyId)).orderBy(desc(payStubTransactions.createdAt));
    return db.select().from(payStubTransactions).orderBy(desc(payStubTransactions.createdAt));
  }
  async createPayStubTransaction(data: InsertPayStubTransaction): Promise<PayStubTransaction> {
    const [r] = await db.insert(payStubTransactions).values(data).returning();
    return r;
  }
  async updatePayStubTransaction(id: string, data: Partial<PayStubTransaction>): Promise<PayStubTransaction | undefined> {
    const [r] = await db.update(payStubTransactions).set(data).where(eq(payStubTransactions.id, id)).returning();
    return r;
  }

  async getPayPeriodSchedules(companyId?: string): Promise<PayPeriodSchedule[]> {
    if (companyId) return db.select().from(payPeriodSchedules).where(eq(payPeriodSchedules.companyId, companyId)).orderBy(desc(payPeriodSchedules.createdAt));
    return db.select().from(payPeriodSchedules).orderBy(desc(payPeriodSchedules.createdAt));
  }
  async createPayPeriodSchedule(data: InsertPayPeriodSchedule): Promise<PayPeriodSchedule> {
    const [r] = await db.insert(payPeriodSchedules).values(data).returning();
    return r;
  }
  async updatePayPeriodSchedule(id: string, data: Partial<PayPeriodSchedule>): Promise<PayPeriodSchedule | undefined> {
    const [r] = await db.update(payPeriodSchedules).set(data).where(eq(payPeriodSchedules.id, id)).returning();
    return r;
  }
  async deletePayPeriodSchedule(id: string): Promise<void> {
    await db.delete(payPeriodSchedules).where(eq(payPeriodSchedules.id, id));
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
