import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { db } from "./db";
import {
  companies, workers, timePunches, timeEntries, schedules, payrollRuns, payrollItems, users,
  departments, branches, accrualAccounts, accrualBalances, employeeContacts, payMethods,
  payPeriods, taxesDeductions, policyGroups, payCodes, holidays, qualifications, reviews, recurringSchedules,
  remittanceSources, remittanceAgencies, remittanceAgencyEvents, payStubAccounts, payStubAmendments, payStubTransactions, payPeriodSchedules,
  employeeTitles, employeeGroups, wageHistory, newHireDefaults,
  payFormulas, contributingPayCodes, contributingShifts,
  regularTimePolicies, overtimePolicies, premiumPolicies,
  mealPolicies, breakPolicies, schedulePolicies,
  exceptionPolicies, accrualPolicies, accrualPolicyMilestones,
  absencePolicies, holidayPolicies, roundingPolicies,
  legalEntities,
  enterprises, divisions, positions, costCenters, jobs,
  roles, rolePermissions, userRoles, checkTemplates,
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
  type EmployeeTitle, type InsertEmployeeTitle,
  type EmployeeGroup, type InsertEmployeeGroup,
  type WageHistory, type InsertWageHistory,
  type NewHireDefault, type InsertNewHireDefault,
  type PayFormula, type InsertPayFormula,
  type ContributingPayCode, type InsertContributingPayCode,
  type ContributingShift, type InsertContributingShift,
  type RegularTimePolicy, type InsertRegularTimePolicy,
  type OvertimePolicy, type InsertOvertimePolicy,
  type PremiumPolicy, type InsertPremiumPolicy,
  type MealPolicy, type InsertMealPolicy,
  type BreakPolicy, type InsertBreakPolicy,
  type SchedulePolicy, type InsertSchedulePolicy,
  type ExceptionPolicy, type InsertExceptionPolicy,
  type AccrualPolicy, type InsertAccrualPolicy,
  type AccrualPolicyMilestone, type InsertAccrualPolicyMilestone,
  type AbsencePolicy, type InsertAbsencePolicy,
  type HolidayPolicy, type InsertHolidayPolicy,
  type RoundingPolicy, type InsertRoundingPolicy,
  type LegalEntity, type InsertLegalEntity,
  type Enterprise, type InsertEnterprise,
  type Division, type InsertDivision,
  type Position, type InsertPosition,
  type CostCenter, type InsertCostCenter,
  type Job, type InsertJob,
  type CheckTemplate, type InsertCheckTemplate,
  type Role, type InsertRole,
  type RolePermission, type InsertRolePermission,
  type UserRole, type InsertUserRole,
  workerDocuments, savedReports,
  kpiGroups, qualificationGroups, workerLanguages, workerMemberships,
  stations, secondaryWageGroups, currencies, employeeWageGroups,
  type WorkerDocument, type InsertWorkerDocument,
  type SavedReport, type InsertSavedReport,
  type Station, type InsertStation,
  type SecondaryWageGroup, type InsertSecondaryWageGroup,
  type Currency, type InsertCurrency,
  type EmployeeWageGroup, type InsertEmployeeWageGroup,
  type KpiGroup, type InsertKpiGroup,
  type QualificationGroup, type InsertQualificationGroup,
  type WorkerLanguage, type InsertWorkerLanguage,
  type WorkerMembership, type InsertWorkerMembership,
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
  deleteWorker(id: string): Promise<void>;

  getTimePunches(companyId?: string): Promise<TimePunch[]>;
  createTimePunch(data: InsertTimePunch): Promise<TimePunch>;
  updateTimePunch(id: string, data: Partial<TimePunch>): Promise<TimePunch | undefined>;
  deleteTimePunch(id: string): Promise<void>;

  getTimeEntries(companyId?: string): Promise<TimeEntry[]>;
  getTimeEntriesByDateRange(companyId: string, startDate: string, endDate: string): Promise<TimeEntry[]>;
  getTimeEntry(id: string): Promise<TimeEntry | undefined>;
  createTimeEntry(data: InsertTimeEntry): Promise<TimeEntry>;
  updateTimeEntry(id: string, data: Partial<TimeEntry>): Promise<TimeEntry | undefined>;
  deleteTimeEntry(id: string): Promise<void>;

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
  deletePayrollItem(id: string): Promise<void>;
  deletePayrollRun(id: string): Promise<void>;

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

  getEmployeeTitles(companyId?: string): Promise<EmployeeTitle[]>;
  createEmployeeTitle(data: InsertEmployeeTitle): Promise<EmployeeTitle>;
  updateEmployeeTitle(id: string, data: Partial<EmployeeTitle>): Promise<EmployeeTitle | undefined>;
  deleteEmployeeTitle(id: string): Promise<void>;

  getEmployeeGroups(companyId?: string): Promise<EmployeeGroup[]>;
  createEmployeeGroup(data: InsertEmployeeGroup): Promise<EmployeeGroup>;
  updateEmployeeGroup(id: string, data: Partial<EmployeeGroup>): Promise<EmployeeGroup | undefined>;
  deleteEmployeeGroup(id: string): Promise<void>;

  getWageHistory(workerId?: string): Promise<WageHistory[]>;
  createWageHistory(data: InsertWageHistory): Promise<WageHistory>;
  updateWageHistory(id: string, data: Partial<WageHistory>): Promise<WageHistory | undefined>;
  deleteWageHistory(id: string): Promise<void>;

  getNewHireDefaults(companyId?: string): Promise<NewHireDefault[]>;
  createNewHireDefault(data: InsertNewHireDefault): Promise<NewHireDefault>;
  updateNewHireDefault(id: string, data: Partial<NewHireDefault>): Promise<NewHireDefault | undefined>;
  deleteNewHireDefault(id: string): Promise<void>;

  getPayFormulas(companyId?: string): Promise<PayFormula[]>;
  createPayFormula(data: InsertPayFormula): Promise<PayFormula>;
  updatePayFormula(id: string, data: Partial<PayFormula>): Promise<PayFormula | undefined>;
  deletePayFormula(id: string): Promise<void>;

  getContributingPayCodes(companyId?: string): Promise<ContributingPayCode[]>;
  createContributingPayCode(data: InsertContributingPayCode): Promise<ContributingPayCode>;
  updateContributingPayCode(id: string, data: Partial<ContributingPayCode>): Promise<ContributingPayCode | undefined>;
  deleteContributingPayCode(id: string): Promise<void>;

  getContributingShifts(companyId?: string): Promise<ContributingShift[]>;
  createContributingShift(data: InsertContributingShift): Promise<ContributingShift>;
  updateContributingShift(id: string, data: Partial<ContributingShift>): Promise<ContributingShift | undefined>;
  deleteContributingShift(id: string): Promise<void>;

  getRegularTimePolicies(companyId?: string): Promise<RegularTimePolicy[]>;
  createRegularTimePolicy(data: InsertRegularTimePolicy): Promise<RegularTimePolicy>;
  updateRegularTimePolicy(id: string, data: Partial<RegularTimePolicy>): Promise<RegularTimePolicy | undefined>;
  deleteRegularTimePolicy(id: string): Promise<void>;

  getOvertimePolicies(companyId?: string): Promise<OvertimePolicy[]>;
  createOvertimePolicy(data: InsertOvertimePolicy): Promise<OvertimePolicy>;
  updateOvertimePolicy(id: string, data: Partial<OvertimePolicy>): Promise<OvertimePolicy | undefined>;
  deleteOvertimePolicy(id: string): Promise<void>;

  getPremiumPolicies(companyId?: string): Promise<PremiumPolicy[]>;
  createPremiumPolicy(data: InsertPremiumPolicy): Promise<PremiumPolicy>;
  updatePremiumPolicy(id: string, data: Partial<PremiumPolicy>): Promise<PremiumPolicy | undefined>;
  deletePremiumPolicy(id: string): Promise<void>;

  getMealPolicies(companyId?: string): Promise<MealPolicy[]>;
  createMealPolicy(data: InsertMealPolicy): Promise<MealPolicy>;
  updateMealPolicy(id: string, data: Partial<MealPolicy>): Promise<MealPolicy | undefined>;
  deleteMealPolicy(id: string): Promise<void>;

  getBreakPolicies(companyId?: string): Promise<BreakPolicy[]>;
  createBreakPolicy(data: InsertBreakPolicy): Promise<BreakPolicy>;
  updateBreakPolicy(id: string, data: Partial<BreakPolicy>): Promise<BreakPolicy | undefined>;
  deleteBreakPolicy(id: string): Promise<void>;

  getSchedulePolicies(companyId?: string): Promise<SchedulePolicy[]>;
  createSchedulePolicy(data: InsertSchedulePolicy): Promise<SchedulePolicy>;
  updateSchedulePolicy(id: string, data: Partial<SchedulePolicy>): Promise<SchedulePolicy | undefined>;
  deleteSchedulePolicy(id: string): Promise<void>;

  getExceptionPolicies(companyId?: string): Promise<ExceptionPolicy[]>;
  createExceptionPolicy(data: InsertExceptionPolicy): Promise<ExceptionPolicy>;
  updateExceptionPolicy(id: string, data: Partial<ExceptionPolicy>): Promise<ExceptionPolicy | undefined>;
  deleteExceptionPolicy(id: string): Promise<void>;

  getAccrualPolicies(companyId?: string): Promise<AccrualPolicy[]>;
  createAccrualPolicy(data: InsertAccrualPolicy): Promise<AccrualPolicy>;
  updateAccrualPolicy(id: string, data: Partial<AccrualPolicy>): Promise<AccrualPolicy | undefined>;
  deleteAccrualPolicy(id: string): Promise<void>;

  getAccrualPolicyMilestones(accrualPolicyId: string): Promise<AccrualPolicyMilestone[]>;
  createAccrualPolicyMilestone(data: InsertAccrualPolicyMilestone): Promise<AccrualPolicyMilestone>;
  deleteAccrualPolicyMilestone(id: string): Promise<void>;

  getAbsencePolicies(companyId?: string): Promise<AbsencePolicy[]>;
  createAbsencePolicy(data: InsertAbsencePolicy): Promise<AbsencePolicy>;
  updateAbsencePolicy(id: string, data: Partial<AbsencePolicy>): Promise<AbsencePolicy | undefined>;
  deleteAbsencePolicy(id: string): Promise<void>;

  getHolidayPolicies(companyId?: string): Promise<HolidayPolicy[]>;
  createHolidayPolicy(data: InsertHolidayPolicy): Promise<HolidayPolicy>;
  updateHolidayPolicy(id: string, data: Partial<HolidayPolicy>): Promise<HolidayPolicy | undefined>;
  deleteHolidayPolicy(id: string): Promise<void>;

  getRoundingPolicies(companyId?: string): Promise<RoundingPolicy[]>;
  createRoundingPolicy(data: InsertRoundingPolicy): Promise<RoundingPolicy>;
  updateRoundingPolicy(id: string, data: Partial<RoundingPolicy>): Promise<RoundingPolicy | undefined>;
  deleteRoundingPolicy(id: string): Promise<void>;

  getEnterprises(): Promise<Enterprise[]>;
  createEnterprise(data: InsertEnterprise): Promise<Enterprise>;
  updateEnterprise(id: string, data: Partial<Enterprise>): Promise<Enterprise | undefined>;
  deleteEnterprise(id: string): Promise<void>;

  getDivisions(companyId?: string): Promise<Division[]>;
  createDivision(data: InsertDivision): Promise<Division>;
  updateDivision(id: string, data: Partial<Division>): Promise<Division | undefined>;
  deleteDivision(id: string): Promise<void>;

  getPositions(companyId?: string): Promise<Position[]>;
  createPosition(data: InsertPosition): Promise<Position>;
  updatePosition(id: string, data: Partial<Position>): Promise<Position | undefined>;
  deletePosition(id: string): Promise<void>;

  getCostCenters(companyId?: string): Promise<CostCenter[]>;
  createCostCenter(data: InsertCostCenter): Promise<CostCenter>;
  updateCostCenter(id: string, data: Partial<CostCenter>): Promise<CostCenter | undefined>;
  deleteCostCenter(id: string): Promise<void>;

  getJobs(companyId?: string): Promise<Job[]>;
  createJob(data: InsertJob): Promise<Job>;
  updateJob(id: string, data: Partial<Job>): Promise<Job | undefined>;
  deleteJob(id: string): Promise<void>;

  getUsers(): Promise<User[]>;
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;

  getRoles(): Promise<Role[]>;
  getRole(id: string): Promise<Role | undefined>;
  createRole(data: InsertRole): Promise<Role>;
  updateRole(id: string, data: Partial<Role>): Promise<Role | undefined>;
  deleteRole(id: string): Promise<void>;

  getRolePermissions(roleId: string): Promise<RolePermission[]>;
  getAllRolePermissions(): Promise<RolePermission[]>;
  createRolePermission(data: InsertRolePermission): Promise<RolePermission>;
  updateRolePermission(id: string, data: Partial<RolePermission>): Promise<RolePermission | undefined>;
  deleteRolePermission(id: string): Promise<void>;
  deleteRolePermissionsByRole(roleId: string): Promise<void>;

  getCheckTemplates(companyId?: string): Promise<CheckTemplate[]>;
  getCheckTemplate(id: string): Promise<CheckTemplate | undefined>;
  createCheckTemplate(data: InsertCheckTemplate): Promise<CheckTemplate>;
  updateCheckTemplate(id: string, data: Partial<CheckTemplate>): Promise<CheckTemplate | undefined>;
  deleteCheckTemplate(id: string): Promise<void>;

  getUserRoles(userId?: string): Promise<UserRole[]>;
  createUserRole(data: InsertUserRole): Promise<UserRole>;
  deleteUserRole(id: string): Promise<void>;

  getWorkerDocuments(workerId: string): Promise<WorkerDocument[]>;
  createWorkerDocument(data: InsertWorkerDocument): Promise<WorkerDocument>;
  deleteWorkerDocument(id: string): Promise<void>;

  getKpiGroups(companyId?: string): Promise<KpiGroup[]>;
  createKpiGroup(data: InsertKpiGroup): Promise<KpiGroup>;
  updateKpiGroup(id: string, data: Partial<KpiGroup>): Promise<KpiGroup | undefined>;
  deleteKpiGroup(id: string): Promise<void>;

  getQualificationGroups(companyId?: string): Promise<QualificationGroup[]>;
  createQualificationGroup(data: InsertQualificationGroup): Promise<QualificationGroup>;
  updateQualificationGroup(id: string, data: Partial<QualificationGroup>): Promise<QualificationGroup | undefined>;
  deleteQualificationGroup(id: string): Promise<void>;

  getWorkerLanguages(companyId?: string): Promise<WorkerLanguage[]>;
  createWorkerLanguage(data: InsertWorkerLanguage): Promise<WorkerLanguage>;
  updateWorkerLanguage(id: string, data: Partial<WorkerLanguage>): Promise<WorkerLanguage | undefined>;
  deleteWorkerLanguage(id: string): Promise<void>;

  getWorkerMemberships(companyId?: string): Promise<WorkerMembership[]>;
  createWorkerMembership(data: InsertWorkerMembership): Promise<WorkerMembership>;
  updateWorkerMembership(id: string, data: Partial<WorkerMembership>): Promise<WorkerMembership | undefined>;
  deleteWorkerMembership(id: string): Promise<void>;

  getStations(companyId?: string): Promise<Station[]>;
  createStation(data: InsertStation): Promise<Station>;
  updateStation(id: string, data: Partial<Station>): Promise<Station | undefined>;
  deleteStation(id: string): Promise<void>;

  getSecondaryWageGroups(companyId?: string): Promise<SecondaryWageGroup[]>;
  createSecondaryWageGroup(data: InsertSecondaryWageGroup): Promise<SecondaryWageGroup>;
  updateSecondaryWageGroup(id: string, data: Partial<SecondaryWageGroup>): Promise<SecondaryWageGroup | undefined>;
  deleteSecondaryWageGroup(id: string): Promise<void>;

  getCurrencies(companyId?: string): Promise<Currency[]>;
  createCurrency(data: InsertCurrency): Promise<Currency>;
  updateCurrency(id: string, data: Partial<Currency>): Promise<Currency | undefined>;
  deleteCurrency(id: string): Promise<void>;

  getEmployeeWageGroups(workerId?: string): Promise<EmployeeWageGroup[]>;
  createEmployeeWageGroup(data: InsertEmployeeWageGroup): Promise<EmployeeWageGroup>;
  deleteEmployeeWageGroup(id: string): Promise<void>;

  getSavedReports(): Promise<SavedReport[]>;
  getSavedReport(id: string): Promise<SavedReport | undefined>;
  createSavedReport(data: InsertSavedReport): Promise<SavedReport>;
  deleteSavedReport(id: string): Promise<void>;

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
  async deleteWorker(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(timePunches).where(eq(timePunches.workerId, id));
      await tx.delete(timeEntries).where(eq(timeEntries.workerId, id));
      await tx.delete(schedules).where(eq(schedules.workerId, id));
      await tx.delete(payStubTransactions).where(eq(payStubTransactions.workerId, id));
      await tx.delete(payrollItems).where(eq(payrollItems.workerId, id));
      await tx.delete(employeeContacts).where(eq(employeeContacts.workerId, id));
      await tx.delete(payMethods).where(eq(payMethods.workerId, id));
      await tx.delete(accrualBalances).where(eq(accrualBalances.workerId, id));
      await tx.delete(qualifications).where(eq(qualifications.workerId, id));
      await tx.delete(reviews).where(eq(reviews.workerId, id));
      await tx.delete(recurringSchedules).where(eq(recurringSchedules.workerId, id));
      await tx.delete(workerDocuments).where(eq(workerDocuments.workerId, id));
      await tx.delete(payStubAmendments).where(eq(payStubAmendments.workerId, id));
      await tx.delete(wageHistory).where(eq(wageHistory.workerId, id));
      await tx.delete(workerLanguages).where(eq(workerLanguages.workerId, id));
      await tx.delete(workerMemberships).where(eq(workerMemberships.workerId, id));
      await tx.delete(employeeWageGroups).where(eq(employeeWageGroups.workerId, id));
      await tx.delete(workers).where(eq(workers.id, id));
    });
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
  async updateTimePunch(id: string, data: Partial<TimePunch>): Promise<TimePunch | undefined> {
    const [punch] = await db.update(timePunches).set(data).where(eq(timePunches.id, id)).returning();
    return punch;
  }
  async deleteTimePunch(id: string): Promise<void> {
    await db.delete(timePunches).where(eq(timePunches.id, id));
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
  async deleteTimeEntry(id: string): Promise<void> {
    await db.delete(timeEntries).where(eq(timeEntries.id, id));
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
  async deletePayrollItem(id: string): Promise<void> {
    await db.delete(payrollItems).where(eq(payrollItems.id, id));
  }
  async deletePayrollRun(id: string): Promise<void> {
    await db.delete(payrollRuns).where(eq(payrollRuns.id, id));
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
  async deleteAccrualAccount(id: string): Promise<boolean> {
    const [a] = await db.delete(accrualAccounts).where(eq(accrualAccounts.id, id)).returning();
    return !!a;
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

  async getUsers(): Promise<User[]> {
    return db.select().from(users);
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
  async updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return user;
  }
  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
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

  async getEmployeeTitles(companyId?: string): Promise<EmployeeTitle[]> {
    if (companyId) {
      return db.select().from(employeeTitles).where(eq(employeeTitles.companyId, companyId)).orderBy(employeeTitles.name);
    }
    return db.select().from(employeeTitles).orderBy(employeeTitles.name);
  }
  async createEmployeeTitle(data: InsertEmployeeTitle): Promise<EmployeeTitle> {
    const [title] = await db.insert(employeeTitles).values(data).returning();
    return title;
  }
  async updateEmployeeTitle(id: string, data: Partial<EmployeeTitle>): Promise<EmployeeTitle | undefined> {
    const [title] = await db.update(employeeTitles).set(data).where(eq(employeeTitles.id, id)).returning();
    return title;
  }
  async deleteEmployeeTitle(id: string): Promise<void> {
    await db.delete(employeeTitles).where(eq(employeeTitles.id, id));
  }

  async getEmployeeGroups(companyId?: string): Promise<EmployeeGroup[]> {
    if (companyId) {
      return db.select().from(employeeGroups).where(eq(employeeGroups.companyId, companyId)).orderBy(employeeGroups.name);
    }
    return db.select().from(employeeGroups).orderBy(employeeGroups.name);
  }
  async createEmployeeGroup(data: InsertEmployeeGroup): Promise<EmployeeGroup> {
    const [group] = await db.insert(employeeGroups).values(data).returning();
    return group;
  }
  async updateEmployeeGroup(id: string, data: Partial<EmployeeGroup>): Promise<EmployeeGroup | undefined> {
    const [group] = await db.update(employeeGroups).set(data).where(eq(employeeGroups.id, id)).returning();
    return group;
  }
  async deleteEmployeeGroup(id: string): Promise<void> {
    await db.delete(employeeGroups).where(eq(employeeGroups.id, id));
  }

  async getWageHistory(workerId?: string): Promise<WageHistory[]> {
    if (workerId) {
      return db.select().from(wageHistory).where(eq(wageHistory.workerId, workerId)).orderBy(desc(wageHistory.effectiveDate));
    }
    return db.select().from(wageHistory).orderBy(desc(wageHistory.effectiveDate));
  }
  async createWageHistory(data: InsertWageHistory): Promise<WageHistory> {
    const [entry] = await db.insert(wageHistory).values(data).returning();
    return entry;
  }
  async updateWageHistory(id: string, data: Partial<WageHistory>): Promise<WageHistory | undefined> {
    const [entry] = await db.update(wageHistory).set(data).where(eq(wageHistory.id, id)).returning();
    return entry;
  }
  async deleteWageHistory(id: string): Promise<void> {
    await db.delete(wageHistory).where(eq(wageHistory.id, id));
  }

  async getNewHireDefaults(companyId?: string): Promise<NewHireDefault[]> {
    if (companyId) {
      return db.select().from(newHireDefaults).where(eq(newHireDefaults.companyId, companyId)).orderBy(newHireDefaults.displayOrder);
    }
    return db.select().from(newHireDefaults).orderBy(newHireDefaults.displayOrder);
  }
  async createNewHireDefault(data: InsertNewHireDefault): Promise<NewHireDefault> {
    const [entry] = await db.insert(newHireDefaults).values(data).returning();
    return entry;
  }
  async updateNewHireDefault(id: string, data: Partial<NewHireDefault>): Promise<NewHireDefault | undefined> {
    const [entry] = await db.update(newHireDefaults).set(data).where(eq(newHireDefaults.id, id)).returning();
    return entry;
  }
  async deleteNewHireDefault(id: string): Promise<void> {
    await db.delete(newHireDefaults).where(eq(newHireDefaults.id, id));
  }

  async getPayFormulas(companyId?: string): Promise<PayFormula[]> {
    if (companyId) return db.select().from(payFormulas).where(eq(payFormulas.companyId, companyId)).orderBy(payFormulas.name);
    return db.select().from(payFormulas).orderBy(payFormulas.name);
  }
  async createPayFormula(data: InsertPayFormula): Promise<PayFormula> {
    const [r] = await db.insert(payFormulas).values(data).returning();
    return r;
  }
  async updatePayFormula(id: string, data: Partial<PayFormula>): Promise<PayFormula | undefined> {
    const [r] = await db.update(payFormulas).set(data).where(eq(payFormulas.id, id)).returning();
    return r;
  }
  async deletePayFormula(id: string): Promise<void> {
    await db.delete(payFormulas).where(eq(payFormulas.id, id));
  }

  async getContributingPayCodes(companyId?: string): Promise<ContributingPayCode[]> {
    if (companyId) return db.select().from(contributingPayCodes).where(eq(contributingPayCodes.companyId, companyId)).orderBy(contributingPayCodes.name);
    return db.select().from(contributingPayCodes).orderBy(contributingPayCodes.name);
  }
  async createContributingPayCode(data: InsertContributingPayCode): Promise<ContributingPayCode> {
    const [r] = await db.insert(contributingPayCodes).values(data).returning();
    return r;
  }
  async updateContributingPayCode(id: string, data: Partial<ContributingPayCode>): Promise<ContributingPayCode | undefined> {
    const [r] = await db.update(contributingPayCodes).set(data).where(eq(contributingPayCodes.id, id)).returning();
    return r;
  }
  async deleteContributingPayCode(id: string): Promise<void> {
    await db.delete(contributingPayCodes).where(eq(contributingPayCodes.id, id));
  }

  async getContributingShifts(companyId?: string): Promise<ContributingShift[]> {
    if (companyId) return db.select().from(contributingShifts).where(eq(contributingShifts.companyId, companyId)).orderBy(contributingShifts.name);
    return db.select().from(contributingShifts).orderBy(contributingShifts.name);
  }
  async createContributingShift(data: InsertContributingShift): Promise<ContributingShift> {
    const [r] = await db.insert(contributingShifts).values(data).returning();
    return r;
  }
  async updateContributingShift(id: string, data: Partial<ContributingShift>): Promise<ContributingShift | undefined> {
    const [r] = await db.update(contributingShifts).set(data).where(eq(contributingShifts.id, id)).returning();
    return r;
  }
  async deleteContributingShift(id: string): Promise<void> {
    await db.delete(contributingShifts).where(eq(contributingShifts.id, id));
  }

  async getRegularTimePolicies(companyId?: string): Promise<RegularTimePolicy[]> {
    if (companyId) return db.select().from(regularTimePolicies).where(eq(regularTimePolicies.companyId, companyId)).orderBy(regularTimePolicies.name);
    return db.select().from(regularTimePolicies).orderBy(regularTimePolicies.name);
  }
  async createRegularTimePolicy(data: InsertRegularTimePolicy): Promise<RegularTimePolicy> {
    const [r] = await db.insert(regularTimePolicies).values(data).returning();
    return r;
  }
  async updateRegularTimePolicy(id: string, data: Partial<RegularTimePolicy>): Promise<RegularTimePolicy | undefined> {
    const [r] = await db.update(regularTimePolicies).set(data).where(eq(regularTimePolicies.id, id)).returning();
    return r;
  }
  async deleteRegularTimePolicy(id: string): Promise<void> {
    await db.delete(regularTimePolicies).where(eq(regularTimePolicies.id, id));
  }

  async getOvertimePolicies(companyId?: string): Promise<OvertimePolicy[]> {
    if (companyId) return db.select().from(overtimePolicies).where(eq(overtimePolicies.companyId, companyId)).orderBy(overtimePolicies.name);
    return db.select().from(overtimePolicies).orderBy(overtimePolicies.name);
  }
  async createOvertimePolicy(data: InsertOvertimePolicy): Promise<OvertimePolicy> {
    const [r] = await db.insert(overtimePolicies).values(data).returning();
    return r;
  }
  async updateOvertimePolicy(id: string, data: Partial<OvertimePolicy>): Promise<OvertimePolicy | undefined> {
    const [r] = await db.update(overtimePolicies).set(data).where(eq(overtimePolicies.id, id)).returning();
    return r;
  }
  async deleteOvertimePolicy(id: string): Promise<void> {
    await db.delete(overtimePolicies).where(eq(overtimePolicies.id, id));
  }

  async getPremiumPolicies(companyId?: string): Promise<PremiumPolicy[]> {
    if (companyId) return db.select().from(premiumPolicies).where(eq(premiumPolicies.companyId, companyId)).orderBy(premiumPolicies.name);
    return db.select().from(premiumPolicies).orderBy(premiumPolicies.name);
  }
  async createPremiumPolicy(data: InsertPremiumPolicy): Promise<PremiumPolicy> {
    const [r] = await db.insert(premiumPolicies).values(data).returning();
    return r;
  }
  async updatePremiumPolicy(id: string, data: Partial<PremiumPolicy>): Promise<PremiumPolicy | undefined> {
    const [r] = await db.update(premiumPolicies).set(data).where(eq(premiumPolicies.id, id)).returning();
    return r;
  }
  async deletePremiumPolicy(id: string): Promise<void> {
    await db.delete(premiumPolicies).where(eq(premiumPolicies.id, id));
  }

  async getMealPolicies(companyId?: string): Promise<MealPolicy[]> {
    if (companyId) return db.select().from(mealPolicies).where(eq(mealPolicies.companyId, companyId)).orderBy(mealPolicies.name);
    return db.select().from(mealPolicies).orderBy(mealPolicies.name);
  }
  async createMealPolicy(data: InsertMealPolicy): Promise<MealPolicy> {
    const [r] = await db.insert(mealPolicies).values(data).returning();
    return r;
  }
  async updateMealPolicy(id: string, data: Partial<MealPolicy>): Promise<MealPolicy | undefined> {
    const [r] = await db.update(mealPolicies).set(data).where(eq(mealPolicies.id, id)).returning();
    return r;
  }
  async deleteMealPolicy(id: string): Promise<void> {
    await db.delete(mealPolicies).where(eq(mealPolicies.id, id));
  }

  async getBreakPolicies(companyId?: string): Promise<BreakPolicy[]> {
    if (companyId) return db.select().from(breakPolicies).where(eq(breakPolicies.companyId, companyId)).orderBy(breakPolicies.name);
    return db.select().from(breakPolicies).orderBy(breakPolicies.name);
  }
  async createBreakPolicy(data: InsertBreakPolicy): Promise<BreakPolicy> {
    const [r] = await db.insert(breakPolicies).values(data).returning();
    return r;
  }
  async updateBreakPolicy(id: string, data: Partial<BreakPolicy>): Promise<BreakPolicy | undefined> {
    const [r] = await db.update(breakPolicies).set(data).where(eq(breakPolicies.id, id)).returning();
    return r;
  }
  async deleteBreakPolicy(id: string): Promise<void> {
    await db.delete(breakPolicies).where(eq(breakPolicies.id, id));
  }

  async getSchedulePolicies(companyId?: string): Promise<SchedulePolicy[]> {
    if (companyId) return db.select().from(schedulePolicies).where(eq(schedulePolicies.companyId, companyId)).orderBy(schedulePolicies.name);
    return db.select().from(schedulePolicies).orderBy(schedulePolicies.name);
  }
  async createSchedulePolicy(data: InsertSchedulePolicy): Promise<SchedulePolicy> {
    const [r] = await db.insert(schedulePolicies).values(data).returning();
    return r;
  }
  async updateSchedulePolicy(id: string, data: Partial<SchedulePolicy>): Promise<SchedulePolicy | undefined> {
    const [r] = await db.update(schedulePolicies).set(data).where(eq(schedulePolicies.id, id)).returning();
    return r;
  }
  async deleteSchedulePolicy(id: string): Promise<void> {
    await db.delete(schedulePolicies).where(eq(schedulePolicies.id, id));
  }

  async getExceptionPolicies(companyId?: string): Promise<ExceptionPolicy[]> {
    if (companyId) return db.select().from(exceptionPolicies).where(eq(exceptionPolicies.companyId, companyId)).orderBy(exceptionPolicies.name);
    return db.select().from(exceptionPolicies).orderBy(exceptionPolicies.name);
  }
  async createExceptionPolicy(data: InsertExceptionPolicy): Promise<ExceptionPolicy> {
    const [r] = await db.insert(exceptionPolicies).values(data).returning();
    return r;
  }
  async updateExceptionPolicy(id: string, data: Partial<ExceptionPolicy>): Promise<ExceptionPolicy | undefined> {
    const [r] = await db.update(exceptionPolicies).set(data).where(eq(exceptionPolicies.id, id)).returning();
    return r;
  }
  async deleteExceptionPolicy(id: string): Promise<void> {
    await db.delete(exceptionPolicies).where(eq(exceptionPolicies.id, id));
  }

  async getAccrualPolicies(companyId?: string): Promise<AccrualPolicy[]> {
    if (companyId) return db.select().from(accrualPolicies).where(eq(accrualPolicies.companyId, companyId)).orderBy(accrualPolicies.name);
    return db.select().from(accrualPolicies).orderBy(accrualPolicies.name);
  }
  async createAccrualPolicy(data: InsertAccrualPolicy): Promise<AccrualPolicy> {
    const [r] = await db.insert(accrualPolicies).values(data).returning();
    return r;
  }
  async updateAccrualPolicy(id: string, data: Partial<AccrualPolicy>): Promise<AccrualPolicy | undefined> {
    const [r] = await db.update(accrualPolicies).set(data).where(eq(accrualPolicies.id, id)).returning();
    return r;
  }
  async deleteAccrualPolicy(id: string): Promise<void> {
    await db.delete(accrualPolicies).where(eq(accrualPolicies.id, id));
  }

  async getAccrualPolicyMilestones(accrualPolicyId: string): Promise<AccrualPolicyMilestone[]> {
    return db.select().from(accrualPolicyMilestones).where(eq(accrualPolicyMilestones.accrualPolicyId, accrualPolicyId));
  }
  async createAccrualPolicyMilestone(data: InsertAccrualPolicyMilestone): Promise<AccrualPolicyMilestone> {
    const [r] = await db.insert(accrualPolicyMilestones).values(data).returning();
    return r;
  }
  async deleteAccrualPolicyMilestone(id: string): Promise<void> {
    await db.delete(accrualPolicyMilestones).where(eq(accrualPolicyMilestones.id, id));
  }

  async getAbsencePolicies(companyId?: string): Promise<AbsencePolicy[]> {
    if (companyId) return db.select().from(absencePolicies).where(eq(absencePolicies.companyId, companyId)).orderBy(absencePolicies.name);
    return db.select().from(absencePolicies).orderBy(absencePolicies.name);
  }
  async createAbsencePolicy(data: InsertAbsencePolicy): Promise<AbsencePolicy> {
    const [r] = await db.insert(absencePolicies).values(data).returning();
    return r;
  }
  async updateAbsencePolicy(id: string, data: Partial<AbsencePolicy>): Promise<AbsencePolicy | undefined> {
    const [r] = await db.update(absencePolicies).set(data).where(eq(absencePolicies.id, id)).returning();
    return r;
  }
  async deleteAbsencePolicy(id: string): Promise<void> {
    await db.delete(absencePolicies).where(eq(absencePolicies.id, id));
  }

  async getHolidayPolicies(companyId?: string): Promise<HolidayPolicy[]> {
    if (companyId) return db.select().from(holidayPolicies).where(eq(holidayPolicies.companyId, companyId)).orderBy(holidayPolicies.name);
    return db.select().from(holidayPolicies).orderBy(holidayPolicies.name);
  }
  async createHolidayPolicy(data: InsertHolidayPolicy): Promise<HolidayPolicy> {
    const [r] = await db.insert(holidayPolicies).values(data).returning();
    return r;
  }
  async updateHolidayPolicy(id: string, data: Partial<HolidayPolicy>): Promise<HolidayPolicy | undefined> {
    const [r] = await db.update(holidayPolicies).set(data).where(eq(holidayPolicies.id, id)).returning();
    return r;
  }
  async deleteHolidayPolicy(id: string): Promise<void> {
    await db.delete(holidayPolicies).where(eq(holidayPolicies.id, id));
  }

  async getRoundingPolicies(companyId?: string): Promise<RoundingPolicy[]> {
    if (companyId) return db.select().from(roundingPolicies).where(eq(roundingPolicies.companyId, companyId)).orderBy(roundingPolicies.name);
    return db.select().from(roundingPolicies).orderBy(roundingPolicies.name);
  }
  async createRoundingPolicy(data: InsertRoundingPolicy): Promise<RoundingPolicy> {
    const [r] = await db.insert(roundingPolicies).values(data).returning();
    return r;
  }
  async updateRoundingPolicy(id: string, data: Partial<RoundingPolicy>): Promise<RoundingPolicy | undefined> {
    const [r] = await db.update(roundingPolicies).set(data).where(eq(roundingPolicies.id, id)).returning();
    return r;
  }
  async deleteRoundingPolicy(id: string): Promise<void> {
    await db.delete(roundingPolicies).where(eq(roundingPolicies.id, id));
  }

  async getLegalEntities(companyId?: string): Promise<LegalEntity[]> {
    if (companyId) return db.select().from(legalEntities).where(eq(legalEntities.companyId, companyId)).orderBy(legalEntities.legalName);
    return db.select().from(legalEntities).orderBy(legalEntities.legalName);
  }
  async createLegalEntity(data: InsertLegalEntity): Promise<LegalEntity> {
    const [r] = await db.insert(legalEntities).values(data).returning();
    return r;
  }
  async updateLegalEntity(id: string, data: Partial<LegalEntity>): Promise<LegalEntity | undefined> {
    const [r] = await db.update(legalEntities).set(data).where(eq(legalEntities.id, id)).returning();
    return r;
  }
  async deleteLegalEntity(id: string): Promise<void> {
    await db.delete(legalEntities).where(eq(legalEntities.id, id));
  }

  async getEnterprises(): Promise<Enterprise[]> {
    return db.select().from(enterprises).orderBy(enterprises.name);
  }
  async createEnterprise(data: InsertEnterprise): Promise<Enterprise> {
    const [r] = await db.insert(enterprises).values(data).returning();
    return r;
  }
  async updateEnterprise(id: string, data: Partial<Enterprise>): Promise<Enterprise | undefined> {
    const [r] = await db.update(enterprises).set(data).where(eq(enterprises.id, id)).returning();
    return r;
  }
  async deleteEnterprise(id: string): Promise<void> {
    await db.delete(enterprises).where(eq(enterprises.id, id));
  }

  async getDivisions(companyId?: string): Promise<Division[]> {
    if (companyId) return db.select().from(divisions).where(eq(divisions.companyId, companyId)).orderBy(divisions.name);
    return db.select().from(divisions).orderBy(divisions.name);
  }
  async createDivision(data: InsertDivision): Promise<Division> {
    const [r] = await db.insert(divisions).values(data).returning();
    return r;
  }
  async updateDivision(id: string, data: Partial<Division>): Promise<Division | undefined> {
    const [r] = await db.update(divisions).set(data).where(eq(divisions.id, id)).returning();
    return r;
  }
  async deleteDivision(id: string): Promise<void> {
    await db.delete(divisions).where(eq(divisions.id, id));
  }

  async getPositions(companyId?: string): Promise<Position[]> {
    if (companyId) return db.select().from(positions).where(eq(positions.companyId, companyId)).orderBy(positions.title);
    return db.select().from(positions).orderBy(positions.title);
  }
  async createPosition(data: InsertPosition): Promise<Position> {
    const [r] = await db.insert(positions).values(data).returning();
    return r;
  }
  async updatePosition(id: string, data: Partial<Position>): Promise<Position | undefined> {
    const [r] = await db.update(positions).set(data).where(eq(positions.id, id)).returning();
    return r;
  }
  async deletePosition(id: string): Promise<void> {
    await db.delete(positions).where(eq(positions.id, id));
  }

  async getCostCenters(companyId?: string): Promise<CostCenter[]> {
    if (companyId) return db.select().from(costCenters).where(eq(costCenters.companyId, companyId)).orderBy(costCenters.name);
    return db.select().from(costCenters).orderBy(costCenters.name);
  }
  async createCostCenter(data: InsertCostCenter): Promise<CostCenter> {
    const [r] = await db.insert(costCenters).values(data).returning();
    return r;
  }
  async updateCostCenter(id: string, data: Partial<CostCenter>): Promise<CostCenter | undefined> {
    const [r] = await db.update(costCenters).set(data).where(eq(costCenters.id, id)).returning();
    return r;
  }
  async deleteCostCenter(id: string): Promise<void> {
    await db.delete(costCenters).where(eq(costCenters.id, id));
  }

  async getJobs(companyId?: string): Promise<Job[]> {
    if (companyId) return db.select().from(jobs).where(eq(jobs.companyId, companyId)).orderBy(jobs.name);
    return db.select().from(jobs).orderBy(jobs.name);
  }
  async createJob(data: InsertJob): Promise<Job> {
    const [r] = await db.insert(jobs).values(data).returning();
    return r;
  }
  async updateJob(id: string, data: Partial<Job>): Promise<Job | undefined> {
    const [r] = await db.update(jobs).set(data).where(eq(jobs.id, id)).returning();
    return r;
  }
  async deleteJob(id: string): Promise<void> {
    await db.delete(jobs).where(eq(jobs.id, id));
  }

  async getRoles(): Promise<Role[]> {
    return db.select().from(roles).orderBy(roles.level);
  }
  async getRole(id: string): Promise<Role | undefined> {
    const [r] = await db.select().from(roles).where(eq(roles.id, id));
    return r;
  }
  async createRole(data: InsertRole): Promise<Role> {
    const [r] = await db.insert(roles).values(data).returning();
    return r;
  }
  async updateRole(id: string, data: Partial<Role>): Promise<Role | undefined> {
    const [r] = await db.update(roles).set(data).where(eq(roles.id, id)).returning();
    return r;
  }
  async deleteRole(id: string): Promise<void> {
    await db.delete(roles).where(eq(roles.id, id));
  }

  async getRolePermissions(roleId: string): Promise<RolePermission[]> {
    return db.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId)).orderBy(rolePermissions.resource);
  }
  async getAllRolePermissions(): Promise<RolePermission[]> {
    return db.select().from(rolePermissions).orderBy(rolePermissions.resource);
  }
  async createRolePermission(data: InsertRolePermission): Promise<RolePermission> {
    const [r] = await db.insert(rolePermissions).values(data).returning();
    return r;
  }
  async updateRolePermission(id: string, data: Partial<RolePermission>): Promise<RolePermission | undefined> {
    const [r] = await db.update(rolePermissions).set(data).where(eq(rolePermissions.id, id)).returning();
    return r;
  }
  async deleteRolePermission(id: string): Promise<void> {
    await db.delete(rolePermissions).where(eq(rolePermissions.id, id));
  }
  async deleteRolePermissionsByRole(roleId: string): Promise<void> {
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  }

  async getUserRoles(userId?: string): Promise<UserRole[]> {
    if (userId) return db.select().from(userRoles).where(eq(userRoles.userId, userId));
    return db.select().from(userRoles);
  }
  async createUserRole(data: InsertUserRole): Promise<UserRole> {
    const [r] = await db.insert(userRoles).values(data).returning();
    return r;
  }
  async deleteUserRole(id: string): Promise<void> {
    await db.delete(userRoles).where(eq(userRoles.id, id));
  }

  async getCheckTemplates(companyId?: string): Promise<CheckTemplate[]> {
    if (companyId) return db.select().from(checkTemplates).where(eq(checkTemplates.companyId, companyId)).orderBy(checkTemplates.name);
    return db.select().from(checkTemplates).orderBy(checkTemplates.name);
  }
  async getCheckTemplate(id: string): Promise<CheckTemplate | undefined> {
    const [r] = await db.select().from(checkTemplates).where(eq(checkTemplates.id, id));
    return r;
  }
  async createCheckTemplate(data: InsertCheckTemplate): Promise<CheckTemplate> {
    const [r] = await db.insert(checkTemplates).values(data).returning();
    return r;
  }
  async updateCheckTemplate(id: string, data: Partial<CheckTemplate>): Promise<CheckTemplate | undefined> {
    const [r] = await db.update(checkTemplates).set(data).where(eq(checkTemplates.id, id)).returning();
    return r;
  }
  async deleteCheckTemplate(id: string): Promise<void> {
    await db.delete(checkTemplates).where(eq(checkTemplates.id, id));
  }

  async getWorkerDocuments(workerId: string): Promise<WorkerDocument[]> {
    return db.select().from(workerDocuments).where(eq(workerDocuments.workerId, workerId)).orderBy(desc(workerDocuments.uploadedAt));
  }
  async createWorkerDocument(data: InsertWorkerDocument): Promise<WorkerDocument> {
    const [r] = await db.insert(workerDocuments).values(data).returning();
    return r;
  }
  async deleteWorkerDocument(id: string): Promise<void> {
    await db.delete(workerDocuments).where(eq(workerDocuments.id, id));
  }

  async getKpiGroups(companyId?: string): Promise<KpiGroup[]> {
    if (companyId) return db.select().from(kpiGroups).where(eq(kpiGroups.companyId, companyId)).orderBy(kpiGroups.name);
    return db.select().from(kpiGroups).orderBy(kpiGroups.name);
  }
  async createKpiGroup(data: InsertKpiGroup): Promise<KpiGroup> {
    const [r] = await db.insert(kpiGroups).values(data).returning();
    return r;
  }
  async updateKpiGroup(id: string, data: Partial<KpiGroup>): Promise<KpiGroup | undefined> {
    const [r] = await db.update(kpiGroups).set(data).where(eq(kpiGroups.id, id)).returning();
    return r;
  }
  async deleteKpiGroup(id: string): Promise<void> {
    await db.delete(kpiGroups).where(eq(kpiGroups.id, id));
  }

  async getQualificationGroups(companyId?: string): Promise<QualificationGroup[]> {
    if (companyId) return db.select().from(qualificationGroups).where(eq(qualificationGroups.companyId, companyId)).orderBy(qualificationGroups.name);
    return db.select().from(qualificationGroups).orderBy(qualificationGroups.name);
  }
  async createQualificationGroup(data: InsertQualificationGroup): Promise<QualificationGroup> {
    const [r] = await db.insert(qualificationGroups).values(data).returning();
    return r;
  }
  async updateQualificationGroup(id: string, data: Partial<QualificationGroup>): Promise<QualificationGroup | undefined> {
    const [r] = await db.update(qualificationGroups).set(data).where(eq(qualificationGroups.id, id)).returning();
    return r;
  }
  async deleteQualificationGroup(id: string): Promise<void> {
    await db.delete(qualificationGroups).where(eq(qualificationGroups.id, id));
  }

  async getWorkerLanguages(companyId?: string): Promise<WorkerLanguage[]> {
    if (companyId) return db.select().from(workerLanguages).where(eq(workerLanguages.companyId, companyId)).orderBy(workerLanguages.language);
    return db.select().from(workerLanguages).orderBy(workerLanguages.language);
  }
  async createWorkerLanguage(data: InsertWorkerLanguage): Promise<WorkerLanguage> {
    const [r] = await db.insert(workerLanguages).values(data).returning();
    return r;
  }
  async updateWorkerLanguage(id: string, data: Partial<WorkerLanguage>): Promise<WorkerLanguage | undefined> {
    const [r] = await db.update(workerLanguages).set(data).where(eq(workerLanguages.id, id)).returning();
    return r;
  }
  async deleteWorkerLanguage(id: string): Promise<void> {
    await db.delete(workerLanguages).where(eq(workerLanguages.id, id));
  }

  async getWorkerMemberships(companyId?: string): Promise<WorkerMembership[]> {
    if (companyId) return db.select().from(workerMemberships).where(eq(workerMemberships.companyId, companyId)).orderBy(workerMemberships.organization);
    return db.select().from(workerMemberships).orderBy(workerMemberships.organization);
  }
  async createWorkerMembership(data: InsertWorkerMembership): Promise<WorkerMembership> {
    const [r] = await db.insert(workerMemberships).values(data).returning();
    return r;
  }
  async updateWorkerMembership(id: string, data: Partial<WorkerMembership>): Promise<WorkerMembership | undefined> {
    const [r] = await db.update(workerMemberships).set(data).where(eq(workerMemberships.id, id)).returning();
    return r;
  }
  async deleteWorkerMembership(id: string): Promise<void> {
    await db.delete(workerMemberships).where(eq(workerMemberships.id, id));
  }

  async getSavedReports(): Promise<SavedReport[]> {
    return db.select({
      id: savedReports.id,
      companyId: savedReports.companyId,
      name: savedReports.name,
      reportType: savedReports.reportType,
      category: savedReports.category,
      filters: savedReports.filters,
      data: sql<string>`null`.as("data"),
      headers: sql<string>`null`.as("headers"),
      rowCount: savedReports.rowCount,
      createdAt: savedReports.createdAt,
      createdBy: savedReports.createdBy,
    }).from(savedReports).orderBy(desc(savedReports.createdAt));
  }
  async getSavedReport(id: string): Promise<SavedReport | undefined> {
    const [r] = await db.select().from(savedReports).where(eq(savedReports.id, id));
    return r;
  }
  async createSavedReport(data: InsertSavedReport): Promise<SavedReport> {
    const [r] = await db.insert(savedReports).values(data).returning();
    return r;
  }
  async deleteSavedReport(id: string): Promise<void> {
    await db.delete(savedReports).where(eq(savedReports.id, id));
  }

  async getStations(companyId?: string): Promise<Station[]> {
    if (companyId) return db.select().from(stations).where(eq(stations.companyId, companyId)).orderBy(stations.stationName);
    return db.select().from(stations).orderBy(stations.stationName);
  }
  async createStation(data: InsertStation): Promise<Station> {
    const [r] = await db.insert(stations).values(data).returning();
    return r;
  }
  async updateStation(id: string, data: Partial<Station>): Promise<Station | undefined> {
    const [r] = await db.update(stations).set(data).where(eq(stations.id, id)).returning();
    return r;
  }
  async deleteStation(id: string): Promise<void> {
    await db.delete(stations).where(eq(stations.id, id));
  }

  async getSecondaryWageGroups(companyId?: string): Promise<SecondaryWageGroup[]> {
    if (companyId) return db.select().from(secondaryWageGroups).where(eq(secondaryWageGroups.companyId, companyId)).orderBy(secondaryWageGroups.name);
    return db.select().from(secondaryWageGroups).orderBy(secondaryWageGroups.name);
  }
  async createSecondaryWageGroup(data: InsertSecondaryWageGroup): Promise<SecondaryWageGroup> {
    const [r] = await db.insert(secondaryWageGroups).values(data).returning();
    return r;
  }
  async updateSecondaryWageGroup(id: string, data: Partial<SecondaryWageGroup>): Promise<SecondaryWageGroup | undefined> {
    const [r] = await db.update(secondaryWageGroups).set(data).where(eq(secondaryWageGroups.id, id)).returning();
    return r;
  }
  async deleteSecondaryWageGroup(id: string): Promise<void> {
    await db.delete(secondaryWageGroups).where(eq(secondaryWageGroups.id, id));
  }

  async getCurrencies(companyId?: string): Promise<Currency[]> {
    if (companyId) return db.select().from(currencies).where(eq(currencies.companyId, companyId)).orderBy(currencies.currencyCode);
    return db.select().from(currencies).orderBy(currencies.currencyCode);
  }
  async createCurrency(data: InsertCurrency): Promise<Currency> {
    const [r] = await db.insert(currencies).values(data).returning();
    return r;
  }
  async updateCurrency(id: string, data: Partial<Currency>): Promise<Currency | undefined> {
    const [r] = await db.update(currencies).set(data).where(eq(currencies.id, id)).returning();
    return r;
  }
  async deleteCurrency(id: string): Promise<void> {
    await db.delete(currencies).where(eq(currencies.id, id));
  }

  async getEmployeeWageGroups(workerId?: string): Promise<EmployeeWageGroup[]> {
    if (workerId) return db.select().from(employeeWageGroups).where(eq(employeeWageGroups.workerId, workerId));
    return db.select().from(employeeWageGroups);
  }
  async createEmployeeWageGroup(data: InsertEmployeeWageGroup): Promise<EmployeeWageGroup> {
    const [r] = await db.insert(employeeWageGroups).values(data).returning();
    return r;
  }
  async deleteEmployeeWageGroup(id: string): Promise<void> {
    await db.delete(employeeWageGroups).where(eq(employeeWageGroups.id, id));
  }
}

export const storage = new DatabaseStorage();
