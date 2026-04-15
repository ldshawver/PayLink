import { eq, and, desc, sql, gte, lte, isNull, or, inArray, ne } from "drizzle-orm";
import { db } from "./db";
import { getLocalDateStr, localTimeToUTC } from "./timezone-utils";
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
  timeOffRequests, schedulePreferences,
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
  receipts, shiftOffers, employeeGroupConfigs,
  payrollPaymentMethods, fundingAccounts, payrollPaymentRecords,
  shiftMarketplaceListings, shiftMarketplaceRequests, eligibilityRuleSets, scheduleAuditLogs, notificationPreferences,
  expenseCategories, expenses, expenseAttachments, contractorInvoices, contractorInvoiceAttachments,
  recurringExpenseTemplates, expenseApprovalActions, payrollReimbursementItems,
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
  type Receipt, type InsertReceipt,
  type ShiftOffer, type InsertShiftOffer,
  type TimeOffRequest, type InsertTimeOffRequest,
  type SchedulePreference, type InsertSchedulePreference,
  type PayrollPaymentMethod, type InsertPayrollPaymentMethod,
  type FundingAccount, type InsertFundingAccount,
  type PayrollPaymentRecord, type InsertPayrollPaymentRecord,
  type EmployeeGroupConfig,
  type ShiftMarketplaceListing, type InsertShiftMarketplaceListing,
  type ShiftMarketplaceRequest, type InsertShiftMarketplaceRequest,
  type EligibilityRuleSet, type InsertEligibilityRuleSet,
  type ScheduleAuditLog, type InsertScheduleAuditLog,
  type NotificationPreference, type InsertNotificationPreference,
  type ExpenseCategory, type InsertExpenseCategory,
  type Expense, type InsertExpense,
  type ExpenseAttachment, type InsertExpenseAttachment,
  type ContractorInvoice, type InsertContractorInvoice,
  type ContractorInvoiceAttachment, type InsertContractorInvoiceAttachment,
  type RecurringExpenseTemplate, type InsertRecurringExpenseTemplate,
  type ExpenseApprovalAction, type InsertExpenseApprovalAction,
  type PayrollReimbursementItem, type InsertPayrollReimbursementItem,
  customers, invoices, invoiceLineItems, invoiceTemplates, payments, savedPaymentMethods, paymentMethodConfigs,
  recurringBillingProfiles, documents, documentFolders, documentVersions,
  documentSignatureRequests, documentSigners, documentAuditLogs,
  signaturePackages, webhookEvents,
  automationRules, automationEvents, notifications, portalAccessTokens,
  documentAcls, documentRetentionPolicies, onboardingPackets, onboardingPacketSteps, invoiceApprovalWorkflows,
  deals, onboardingTemplates, onboardingTemplateTasks, customerOnboardingProjects,
  onboardingTasks, onboardingDocuments, engagementEvents, productApiKeys,
  type Customer, type InsertCustomer,
  type Invoice, type InsertInvoice,
  type InvoiceLineItem, type InsertInvoiceLineItem,
  type InvoiceTemplate, type InsertInvoiceTemplate,
  type Payment, type InsertPayment,
  type PaymentMethodConfig, type InsertPaymentMethodConfig,
  type SavedPaymentMethod, type InsertSavedPaymentMethod,
  type RecurringBillingProfile, type InsertRecurringBillingProfile,
  type Document, type InsertDocument,
  type DocumentFolder, type InsertDocumentFolder,
  type DocumentVersion, type InsertDocumentVersion,
  type DocumentSignatureRequest, type InsertDocumentSignatureRequest,
  type DocumentSigner, type InsertDocumentSigner,
  type DocumentAuditLog, type InsertDocumentAuditLog,
  type SignaturePackage, type InsertSignaturePackage,
  type WebhookEvent, type InsertWebhookEvent,
  type AutomationRule, type InsertAutomationRule,
  type AutomationEvent, type InsertAutomationEvent,
  type Notification, type InsertNotification,
  type DocumentAcl, type InsertDocumentAcl,
  type DocumentRetentionPolicy, type InsertDocumentRetentionPolicy,
  type OnboardingPacket, type InsertOnboardingPacket,
  type OnboardingPacketStep, type InsertOnboardingPacketStep,
  type InvoiceApprovalWorkflow, type InsertInvoiceApprovalWorkflow,
  type Deal, type InsertDeal,
  type OnboardingTemplate, type InsertOnboardingTemplate,
  type OnboardingTemplateTask, type InsertOnboardingTemplateTask,
  type CustomerOnboardingProject, type InsertCustomerOnboardingProject,
  type OnboardingTask, type InsertOnboardingTask,
  type OnboardingDocument, type InsertOnboardingDocument,
  type EngagementEvent, type InsertEngagementEvent,
  type ProductApiKey, type InsertProductApiKey,
  companyWebhookConfigs, integrationEvents, deviceTokens,
  type CompanyWebhookConfig, type InsertCompanyWebhookConfig,
  type IntegrationEvent, type InsertIntegrationEvent,
  type DeviceToken, type InsertDeviceToken,
  systemDocuments,
  type SystemDocument, type InsertSystemDocument,
  tradeTransactions, tradeTransactionItems, tradeAttachments, tradeAuditLogs,
  type TradeTransaction, type InsertTradeTransaction,
  type TradeTransactionItem, type InsertTradeTransactionItem,
  type TradeAttachment, type InsertTradeAttachment,
  type TradeAuditLog, type InsertTradeAuditLog,
  contractorDocuments, contractor1099Summaries,
  type ContractorDocument, type InsertContractorDocument,
  type Contractor1099Summary, type InsertContractor1099Summary,
  locations, teams, employeeManagerRelations,
  platformModules, permissionGroups, permissions, enterpriseRolePermissions,
  userCompanyAccess, userPermissionOverrides,
  payrollSummaries, achBatches, payrollTransactionRuns,
  tenantCommercialGates, tenantProvisioningAuditLogs, tenantImplementationProjects,
  type PlatformModule, type InsertPlatformModule,
  type Location, type InsertLocation,
  type Team, type InsertTeam,
  type EmployeeManagerRelation, type InsertEmployeeManagerRelation,
  type PermissionGroup, type InsertPermissionGroup,
  type Permission, type InsertPermission,
  type EnterpriseRolePermission, type InsertEnterpriseRolePermission,
  type UserCompanyAccess, type InsertUserCompanyAccess,
  type UserPermissionOverride, type InsertUserPermissionOverride,
  authorizationAuditLog,
  type AuthorizationAuditLog, type InsertAuthorizationAuditLog,
  type PayrollSummary, type InsertPayrollSummary,
  type AchBatch, type InsertAchBatch,
  type PayrollTransactionRun, type InsertPayrollTransactionRun,
  type TenantCommercialGate, type InsertTenantCommercialGate,
  type TenantProvisioningAuditLog, type InsertTenantProvisioningAuditLog,
  type TenantImplementationProject, type InsertTenantImplementationProject,
  agreementTemplates, workerAgreements, workerOnboarding, onboardingSteps, workerOnboardingDocuments, onboardingAuditLog,
  type AgreementTemplate, type InsertAgreementTemplate,
  type WorkerAgreement, type InsertWorkerAgreement,
  type WorkerOnboarding, type InsertWorkerOnboarding,
  type OnboardingStep, type InsertOnboardingStep,
  type WorkerOnboardingDocument, type InsertWorkerOnboardingDocument,
  type OnboardingAuditLogEntry, type InsertOnboardingAuditLogEntry,
  companyBranding, bizDocumentTemplates, bizDocuments, bizDocumentItems, bizDocumentAttachments, bizDocumentHistory,
  type CompanyBranding, type InsertCompanyBranding,
  type BizDocumentTemplate, type InsertBizDocumentTemplate,
  type BizDocument, type InsertBizDocument,
  type BizDocumentItem, type InsertBizDocumentItem,
  type BizDocumentAttachment, type InsertBizDocumentAttachment,
  type BizDocumentHistory, type InsertBizDocumentHistory,
  treasuryOutboundPayments,
  type TreasuryOutboundPayment, type InsertTreasuryOutboundPayment,
  inventoryItems,
  type InventoryItem, type InsertInventoryItem,
  weeklyLaborGoals, weeklyRevenueGoals,
  type WeeklyLaborGoal, type InsertWeeklyLaborGoal,
  type WeeklyRevenueGoal, type InsertWeeklyRevenueGoal,
} from "@shared/schema";

export interface IStorage {
  getCompanies(): Promise<Company[]>;
  getCompany(id: string): Promise<Company | undefined>;
  createCompany(data: InsertCompany): Promise<Company>;
  updateCompany(id: string, data: Partial<Company>): Promise<Company | undefined>;

  getWorkers(companyId?: string): Promise<Worker[]>;
  getWorker(id: string): Promise<Worker | undefined>;
  getWorkerByEmployeeNumber(employeeNumber: string): Promise<Worker | undefined>;
  getWorkerByEmployeeNumberAndPin(employeeNumber: string, pin: string): Promise<Worker | undefined>;
  createWorker(data: InsertWorker): Promise<Worker>;
  updateWorker(id: string, data: Partial<Worker>): Promise<Worker | undefined>;
  deleteWorker(id: string): Promise<void>;

  getTimePunches(companyId?: string): Promise<TimePunch[]>;
  getPendingPunches(companyId?: string): Promise<TimePunch[]>;
  convertPunchesToTimeEntries(companyId: string, startDate: string, endDate: string): Promise<{ created: number; skipped: number; entries: TimeEntry[] }>;
  getScheduleLaborSummary(companyId: string, startDate: string, endDate: string): Promise<any[]>;
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

  getReceipts(companyId?: string, costCenterId?: string, jobId?: string): Promise<Receipt[]>;
  getReceipt(id: string): Promise<Receipt | undefined>;
  createReceipt(data: InsertReceipt): Promise<Receipt>;
  updateReceipt(id: string, data: Partial<Receipt>): Promise<Receipt | undefined>;
  deleteReceipt(id: string): Promise<void>;

  getShiftOffers(companyId?: string): Promise<ShiftOffer[]>;
  getShiftOffer(id: string): Promise<ShiftOffer | undefined>;
  createShiftOffer(data: InsertShiftOffer): Promise<ShiftOffer>;
  updateShiftOffer(id: string, data: Partial<ShiftOffer>): Promise<ShiftOffer | undefined>;
  deleteShiftOffer(id: string): Promise<void>;

  getTimeOffRequests(companyId?: string, workerId?: string): Promise<TimeOffRequest[]>;
  getTimeOffRequest(id: string): Promise<TimeOffRequest | undefined>;
  createTimeOffRequest(data: InsertTimeOffRequest): Promise<TimeOffRequest>;
  updateTimeOffRequest(id: string, data: Partial<TimeOffRequest>): Promise<TimeOffRequest | undefined>;
  deleteTimeOffRequest(id: string): Promise<void>;

  getSchedulePreferences(companyId?: string, workerId?: string): Promise<SchedulePreference[]>;
  createSchedulePreference(data: InsertSchedulePreference): Promise<SchedulePreference>;
  updateSchedulePreference(id: string, data: Partial<SchedulePreference>): Promise<SchedulePreference | undefined>;
  deleteSchedulePreference(id: string): Promise<void>;

  updatePayrollItem(id: string, data: Partial<PayrollItem>): Promise<PayrollItem | undefined>;

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

  getEmployeeGroupConfigs(): Promise<EmployeeGroupConfig[]>;

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

  getPayrollPaymentMethods(companyId?: string): Promise<PayrollPaymentMethod[]>;
  createPayrollPaymentMethod(data: InsertPayrollPaymentMethod): Promise<PayrollPaymentMethod>;
  updatePayrollPaymentMethod(id: string, data: Partial<PayrollPaymentMethod>): Promise<PayrollPaymentMethod | undefined>;
  deletePayrollPaymentMethod(id: string): Promise<void>;

  getFundingAccounts(companyId?: string): Promise<FundingAccount[]>;
  createFundingAccount(data: InsertFundingAccount): Promise<FundingAccount>;
  updateFundingAccount(id: string, data: Partial<FundingAccount>): Promise<FundingAccount | undefined>;
  deleteFundingAccount(id: string): Promise<void>;

  getPayrollPaymentRecords(companyId?: string, payrollRunId?: string): Promise<PayrollPaymentRecord[]>;
  getPayrollPaymentRecord(id: string): Promise<PayrollPaymentRecord | undefined>;
  createPayrollPaymentRecord(data: InsertPayrollPaymentRecord): Promise<PayrollPaymentRecord>;
  updatePayrollPaymentRecord(id: string, data: Partial<PayrollPaymentRecord>): Promise<PayrollPaymentRecord | undefined>;
  deletePayrollPaymentRecord(id: string): Promise<void>;

  getTaxFilingSnapshots(companyId: string): Promise<any[]>;
  getTaxFilingSnapshot(id: string): Promise<any | undefined>;
  createTaxFilingSnapshot(data: any): Promise<any>;
  updateTaxFilingSnapshot(id: string, data: any): Promise<any | undefined>;
  deleteTaxFilingSnapshot(id: string): Promise<void>;

  getCustomers(companyId: string, customerType?: string): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer | undefined>;
  createCustomer(data: InsertCustomer): Promise<Customer>;
  updateCustomer(id: string, data: Partial<Customer>): Promise<Customer | undefined>;
  deleteCustomer(id: string): Promise<void>;

  getInvoiceTemplates(companyId?: string): Promise<InvoiceTemplate[]>;
  getInvoiceTemplate(id: string): Promise<InvoiceTemplate | undefined>;
  createInvoiceTemplate(data: InsertInvoiceTemplate): Promise<InvoiceTemplate>;
  updateInvoiceTemplate(id: string, data: Partial<InvoiceTemplate>): Promise<InvoiceTemplate | undefined>;
  deleteInvoiceTemplate(id: string): Promise<void>;

  getInvoices(companyId: string): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice | undefined>;
  createInvoice(data: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: string, data: Partial<Invoice>): Promise<Invoice | undefined>;
  deleteInvoice(id: string): Promise<void>;

  getInvoiceLineItems(invoiceId: string): Promise<InvoiceLineItem[]>;
  createInvoiceLineItem(data: InsertInvoiceLineItem): Promise<InvoiceLineItem>;
  updateInvoiceLineItem(id: string, data: Partial<InvoiceLineItem>): Promise<InvoiceLineItem | undefined>;
  deleteInvoiceLineItem(id: string): Promise<void>;
  deleteInvoiceLineItemsByInvoice(invoiceId: string): Promise<void>;

  getPayments(companyId: string): Promise<Payment[]>;
  getPayment(id: string): Promise<Payment | undefined>;
  createPayment(data: InsertPayment): Promise<Payment>;
  updatePayment(id: string, data: Partial<Payment>): Promise<Payment | undefined>;

  getPaymentMethodConfigs(companyId: string): Promise<PaymentMethodConfig[]>;
  createPaymentMethodConfig(data: InsertPaymentMethodConfig): Promise<PaymentMethodConfig>;
  updatePaymentMethodConfig(id: string, data: Partial<PaymentMethodConfig>): Promise<PaymentMethodConfig | undefined>;
  deletePaymentMethodConfig(id: string): Promise<void>;

  getRecurringBillingProfiles(companyId: string): Promise<RecurringBillingProfile[]>;
  getRecurringBillingProfile(id: string): Promise<RecurringBillingProfile | undefined>;
  createRecurringBillingProfile(data: InsertRecurringBillingProfile): Promise<RecurringBillingProfile>;
  updateRecurringBillingProfile(id: string, data: Partial<RecurringBillingProfile>): Promise<RecurringBillingProfile | undefined>;
  deleteRecurringBillingProfile(id: string): Promise<void>;

  getDocumentFolders(companyId: string): Promise<DocumentFolder[]>;
  getDocumentFolder(id: string): Promise<DocumentFolder | undefined>;
  createDocumentFolder(data: InsertDocumentFolder): Promise<DocumentFolder>;
  updateDocumentFolder(id: string, data: Partial<DocumentFolder>): Promise<DocumentFolder | undefined>;
  deleteDocumentFolder(id: string): Promise<void>;

  getDocuments(companyId: string): Promise<Document[]>;
  getDocument(id: string): Promise<Document | undefined>;
  createDocument(data: InsertDocument): Promise<Document>;
  updateDocument(id: string, data: Partial<Document>): Promise<Document | undefined>;
  deleteDocument(id: string): Promise<void>;

  getDocumentVersions(documentId: string): Promise<DocumentVersion[]>;
  createDocumentVersion(data: InsertDocumentVersion): Promise<DocumentVersion>;

  getDocumentSignatureRequests(companyId: string): Promise<DocumentSignatureRequest[]>;
  getDocumentSignatureRequest(id: string): Promise<DocumentSignatureRequest | undefined>;
  createDocumentSignatureRequest(data: InsertDocumentSignatureRequest): Promise<DocumentSignatureRequest>;
  updateDocumentSignatureRequest(id: string, data: Partial<DocumentSignatureRequest>): Promise<DocumentSignatureRequest | undefined>;

  getDocumentSigners(requestId: string): Promise<DocumentSigner[]>;
  createDocumentSigner(data: InsertDocumentSigner): Promise<DocumentSigner>;
  updateDocumentSigner(id: string, data: Partial<DocumentSigner>): Promise<DocumentSigner | undefined>;

  createDocumentAuditLog(data: InsertDocumentAuditLog): Promise<DocumentAuditLog>;
  getDocumentAuditLogs(documentId: string): Promise<DocumentAuditLog[]>;
  getDocumentAuditLogsByCompany(companyId: string): Promise<DocumentAuditLog[]>;

  getSignaturePackages(companyId: string): Promise<SignaturePackage[]>;
  getSignaturePackage(id: string): Promise<SignaturePackage | undefined>;
  getSignaturePackageByEnvelopeId(providerEnvelopeId: string, provider?: string): Promise<SignaturePackage | undefined>;
  createSignaturePackage(data: InsertSignaturePackage): Promise<SignaturePackage>;
  updateSignaturePackage(id: string, data: Partial<SignaturePackage>): Promise<SignaturePackage | undefined>;

  getWebhookEvents(provider?: string): Promise<WebhookEvent[]>;
  getWebhookEventsByCompany(companyId: string, provider?: string): Promise<WebhookEvent[]>;
  getWebhookEventByProviderEventId(providerEventId: string): Promise<WebhookEvent | undefined>;
  createWebhookEvent(data: InsertWebhookEvent): Promise<WebhookEvent>;
  updateWebhookEvent(id: string, data: Partial<WebhookEvent>): Promise<WebhookEvent | undefined>;

  getDocumentAcls(companyId: string): Promise<DocumentAcl[]>;
  getDocumentAcl(id: string): Promise<DocumentAcl | undefined>;
  createDocumentAcl(data: InsertDocumentAcl): Promise<DocumentAcl>;
  deleteDocumentAcl(id: string): Promise<void>;

  getDocumentRetentionPolicies(companyId: string): Promise<DocumentRetentionPolicy[]>;
  createDocumentRetentionPolicy(data: InsertDocumentRetentionPolicy): Promise<DocumentRetentionPolicy>;
  updateDocumentRetentionPolicy(id: string, data: Partial<DocumentRetentionPolicy>): Promise<DocumentRetentionPolicy | undefined>;
  deleteDocumentRetentionPolicy(id: string): Promise<void>;

  getOnboardingPackets(companyId: string): Promise<OnboardingPacket[]>;
  getOnboardingPacket(id: string): Promise<OnboardingPacket | undefined>;
  createOnboardingPacket(data: InsertOnboardingPacket): Promise<OnboardingPacket>;
  updateOnboardingPacket(id: string, data: Partial<OnboardingPacket>): Promise<OnboardingPacket | undefined>;

  getOnboardingPacketSteps(packetId: string): Promise<OnboardingPacketStep[]>;
  getOnboardingPacketStepById(id: string): Promise<OnboardingPacketStep | undefined>;
  createOnboardingPacketStep(data: InsertOnboardingPacketStep): Promise<OnboardingPacketStep>;
  updateOnboardingPacketStep(id: string, data: Partial<OnboardingPacketStep>): Promise<OnboardingPacketStep | undefined>;

  getInvoiceApprovalWorkflows(companyId: string): Promise<InvoiceApprovalWorkflow[]>;
  getInvoiceApprovalWorkflow(id: string): Promise<InvoiceApprovalWorkflow | undefined>;
  createInvoiceApprovalWorkflow(data: InsertInvoiceApprovalWorkflow): Promise<InvoiceApprovalWorkflow>;
  updateInvoiceApprovalWorkflow(id: string, data: Partial<InvoiceApprovalWorkflow>): Promise<InvoiceApprovalWorkflow | undefined>;

  getAutomationRules(companyId: string): Promise<AutomationRule[]>;
  getAutomationRule(id: string): Promise<AutomationRule | undefined>;
  createAutomationRule(data: InsertAutomationRule): Promise<AutomationRule>;
  updateAutomationRule(id: string, data: Partial<AutomationRule>): Promise<AutomationRule | undefined>;
  deleteAutomationRule(id: string): Promise<void>;

  getAutomationEvents(companyId: string): Promise<AutomationEvent[]>;
  createAutomationEvent(data: InsertAutomationEvent): Promise<AutomationEvent>;

  getNotifications(companyId: string, userId?: string): Promise<Notification[]>;
  createNotification(data: InsertNotification): Promise<Notification>;
  updateNotification(id: string, data: Partial<Notification>): Promise<Notification | undefined>;

  createPortalAccessToken(data: any): Promise<any>;
  getPortalAccessTokenByToken(token: string): Promise<any>;
  revokePortalTokensForPacket(packetId: string): Promise<void>;

  getDeals(companyId: string): Promise<Deal[]>;
  getDeal(id: string): Promise<Deal | undefined>;
  createDeal(data: InsertDeal): Promise<Deal>;
  updateDeal(id: string, data: Partial<Deal>): Promise<Deal | undefined>;
  deleteDeal(id: string): Promise<void>;

  getOnboardingTemplates(companyId: string): Promise<OnboardingTemplate[]>;
  getOnboardingTemplate(id: string): Promise<OnboardingTemplate | undefined>;
  createOnboardingTemplate(data: InsertOnboardingTemplate): Promise<OnboardingTemplate>;
  updateOnboardingTemplate(id: string, data: Partial<OnboardingTemplate>): Promise<OnboardingTemplate | undefined>;
  deleteOnboardingTemplate(id: string): Promise<void>;

  getOnboardingTemplateTasks(templateId: string): Promise<OnboardingTemplateTask[]>;
  createOnboardingTemplateTask(data: InsertOnboardingTemplateTask): Promise<OnboardingTemplateTask>;
  updateOnboardingTemplateTask(id: string, data: Partial<OnboardingTemplateTask>): Promise<OnboardingTemplateTask | undefined>;
  deleteOnboardingTemplateTask(id: string): Promise<void>;

  getCustomerOnboardingProjects(companyId: string): Promise<CustomerOnboardingProject[]>;
  getCustomerOnboardingProject(id: string): Promise<CustomerOnboardingProject | undefined>;
  createCustomerOnboardingProject(data: InsertCustomerOnboardingProject): Promise<CustomerOnboardingProject>;
  updateCustomerOnboardingProject(id: string, data: Partial<CustomerOnboardingProject>): Promise<CustomerOnboardingProject | undefined>;
  deleteCustomerOnboardingProject(id: string): Promise<void>;

  getOnboardingTasks(projectId: string): Promise<OnboardingTask[]>;
  getOnboardingTask(id: string): Promise<OnboardingTask | undefined>;
  createOnboardingTask(data: InsertOnboardingTask): Promise<OnboardingTask>;
  updateOnboardingTask(id: string, data: Partial<OnboardingTask>): Promise<OnboardingTask | undefined>;
  deleteOnboardingTask(id: string): Promise<void>;

  getOnboardingDocuments(companyId: string, projectId?: string, templateId?: string): Promise<OnboardingDocument[]>;
  createOnboardingDocument(data: InsertOnboardingDocument): Promise<OnboardingDocument>;
  updateOnboardingDocument(id: string, data: Partial<OnboardingDocument>): Promise<OnboardingDocument | undefined>;
  deleteOnboardingDocument(id: string): Promise<void>;

  getEngagementEvents(companyId: string, customerId?: string): Promise<EngagementEvent[]>;
  getEngagementEvent(id: string): Promise<EngagementEvent | undefined>;
  createEngagementEvent(data: InsertEngagementEvent): Promise<EngagementEvent>;
  deleteEngagementEvent(id: string): Promise<void>;

  getProductApiKeys(companyId: string): Promise<ProductApiKey[]>;
  getProductApiKeyByKey(apiKey: string): Promise<ProductApiKey | undefined>;
  createProductApiKey(data: InsertProductApiKey): Promise<ProductApiKey>;
  updateProductApiKey(id: string, data: Partial<ProductApiKey>): Promise<ProductApiKey | undefined>;
  deleteProductApiKey(id: string): Promise<void>;

  getCompanyWebhookConfigs(companyId: string): Promise<CompanyWebhookConfig[]>;
  getCompanyWebhookConfig(id: string): Promise<CompanyWebhookConfig | undefined>;
  createCompanyWebhookConfig(data: InsertCompanyWebhookConfig): Promise<CompanyWebhookConfig>;
  updateCompanyWebhookConfig(id: string, data: Partial<CompanyWebhookConfig>): Promise<CompanyWebhookConfig | undefined>;
  deleteCompanyWebhookConfig(id: string): Promise<void>;

  getIntegrationEvents(companyId: string): Promise<IntegrationEvent[]>;
  getIntegrationEvent(id: string): Promise<IntegrationEvent | undefined>;
  createIntegrationEvent(data: InsertIntegrationEvent): Promise<IntegrationEvent>;
  updateIntegrationEvent(id: string, data: Partial<IntegrationEvent>): Promise<IntegrationEvent | undefined>;

  getDeviceTokens(userId: string): Promise<DeviceToken[]>;
  getDeviceTokensByUsers(userIds: string[]): Promise<DeviceToken[]>;
  registerDeviceToken(data: InsertDeviceToken): Promise<DeviceToken>;
  deactivateDeviceToken(userId: string, token: string): Promise<void>;

  // Trade / Non-Cash Compensation
  getTradeTransactions(companyId: string, status?: string, year?: number): Promise<TradeTransaction[]>;
  getTradeTransaction(id: string): Promise<TradeTransaction | undefined>;
  createTradeTransaction(data: InsertTradeTransaction): Promise<TradeTransaction>;
  updateTradeTransaction(id: string, data: Partial<TradeTransaction>): Promise<TradeTransaction | undefined>;
  deleteTradeTransaction(id: string): Promise<void>;
  getTradeTransactionItems(tradeTransactionId: string): Promise<TradeTransactionItem[]>;
  createTradeTransactionItem(data: InsertTradeTransactionItem): Promise<TradeTransactionItem>;
  deleteTradeTransactionItem(id: string): Promise<void>;
  getTradeAttachments(tradeTransactionId: string): Promise<TradeAttachment[]>;
  createTradeAttachment(data: InsertTradeAttachment): Promise<TradeAttachment>;
  deleteTradeAttachment(id: string): Promise<void>;
  getTradeAuditLogs(tradeTransactionId: string): Promise<TradeAuditLog[]>;
  createTradeAuditLog(data: InsertTradeAuditLog): Promise<TradeAuditLog>;
  getTradeReportingSummary(companyId: string, year: number): Promise<{ counterpartyId: string | null; counterpartyName: string; totalFairMarketValue: string; transactionCount: number }[]>;

  // Contractor documents (W-9, W-8BEN)
  getContractorDocuments(companyId: string, workerId?: string): Promise<ContractorDocument[]>;
  createContractorDocument(data: InsertContractorDocument): Promise<ContractorDocument>;
  deleteContractorDocument(id: string): Promise<void>;

  // 1099 summaries
  get1099Summaries(companyId: string, year: number): Promise<Contractor1099Summary[]>;
  get1099Summary(id: string): Promise<Contractor1099Summary | undefined>;
  get1099SummaryByWorker(companyId: string, workerId: string, year: number): Promise<Contractor1099Summary | undefined>;
  upsert1099Summary(data: InsertContractor1099Summary): Promise<Contractor1099Summary>;
  update1099Summary(id: string, data: Partial<Contractor1099Summary>): Promise<Contractor1099Summary | undefined>;
  calculate1099Summary(companyId: string, workerId: string, year: number): Promise<{ cashTotal: number; tradeTotal: number; total: number; missingW9: boolean }>;
  generateAll1099Summaries(companyId: string, year: number): Promise<Contractor1099Summary[]>;

  // Platform Modules
  getPlatformModules(): Promise<PlatformModule[]>;
  getPlatformModule(id: string): Promise<PlatformModule | undefined>;
  createPlatformModule(data: InsertPlatformModule): Promise<PlatformModule>;
  updatePlatformModule(id: string, data: Partial<PlatformModule>): Promise<PlatformModule | undefined>;

  // Org Hierarchy
  getLocations(companyId?: string): Promise<Location[]>;
  getLocation(id: string): Promise<Location | undefined>;
  createLocation(data: InsertLocation): Promise<Location>;
  updateLocation(id: string, data: Partial<Location>): Promise<Location | undefined>;
  deleteLocation(id: string): Promise<void>;

  getTeams(companyId?: string): Promise<Team[]>;
  getTeam(id: string): Promise<Team | undefined>;
  createTeam(data: InsertTeam): Promise<Team>;
  updateTeam(id: string, data: Partial<Team>): Promise<Team | undefined>;
  deleteTeam(id: string): Promise<void>;

  getEmployeeManagerRelations(companyId: string, employeeId?: string): Promise<EmployeeManagerRelation[]>;
  getDirectReports(companyId: string, managerId: string): Promise<EmployeeManagerRelation[]>;
  getDepartmentMembers(companyId: string, departmentId: string): Promise<Worker[]>;
  getManagerChain(companyId: string, employeeId: string): Promise<EmployeeManagerRelation[]>;
  createEmployeeManagerRelation(data: InsertEmployeeManagerRelation): Promise<EmployeeManagerRelation>;
  updateEmployeeManagerRelation(id: string, data: Partial<EmployeeManagerRelation>): Promise<EmployeeManagerRelation | undefined>;
  deleteEmployeeManagerRelation(id: string): Promise<void>;

  // Permission System
  getPermissionGroups(): Promise<PermissionGroup[]>;
  createPermissionGroup(data: InsertPermissionGroup): Promise<PermissionGroup>;
  updatePermissionGroup(id: string, data: Partial<PermissionGroup>): Promise<PermissionGroup | undefined>;

  getPermissions(groupId?: string): Promise<Permission[]>;
  getPermission(id: string): Promise<Permission | undefined>;
  createPermission(data: InsertPermission): Promise<Permission>;
  updatePermission(id: string, data: Partial<Permission>): Promise<Permission | undefined>;

  getEnterpriseRolePermissions(roleId?: string): Promise<EnterpriseRolePermission[]>;
  createEnterpriseRolePermission(data: InsertEnterpriseRolePermission): Promise<EnterpriseRolePermission>;
  deleteEnterpriseRolePermission(id: string): Promise<void>;
  getEffectivePermissions(userId: string, companyId: string): Promise<{ permission: Permission; scope: string; source: string }[]>;

  getUserCompanyAccess(userId?: string, companyId?: string): Promise<UserCompanyAccess[]>;
  createUserCompanyAccess(data: InsertUserCompanyAccess): Promise<UserCompanyAccess>;
  updateUserCompanyAccess(id: string, data: Partial<UserCompanyAccess>): Promise<UserCompanyAccess | undefined>;
  deleteUserCompanyAccess(id: string): Promise<void>;

  getUserPermissionOverrides(userId: string, companyId?: string): Promise<UserPermissionOverride[]>;
  createUserPermissionOverride(data: InsertUserPermissionOverride): Promise<UserPermissionOverride>;
  deleteUserPermissionOverride(id: string): Promise<void>;

  getAuthorizationAuditLogs(limit?: number): Promise<AuthorizationAuditLog[]>;
  getAuthorizationAuditLogsFiltered(opts: {
    limit?: number;
    offset?: number;
    changeType?: string;
    companyId?: string;
    actorUserId?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ rows: AuthorizationAuditLog[]; total: number }>;
  createAuthorizationAuditLog(data: InsertAuthorizationAuditLog): Promise<AuthorizationAuditLog>;

  getPayrollSummary(payrollRunId: string): Promise<PayrollSummary | undefined>;
  upsertPayrollSummary(payrollRunId: string, data: Partial<InsertPayrollSummary>): Promise<PayrollSummary>;

  getAchBatch(payrollRunId: string): Promise<AchBatch | undefined>;
  getAchBatchById(id: string): Promise<AchBatch | undefined>;
  createAchBatch(data: InsertAchBatch): Promise<AchBatch>;
  updateAchBatch(id: string, data: Partial<AchBatch>): Promise<AchBatch | undefined>;

  getPayrollTransactionRuns(payrollRunId: string): Promise<PayrollTransactionRun[]>;
  createPayrollTransactionRun(data: InsertPayrollTransactionRun): Promise<PayrollTransactionRun>;
  updatePayrollTransactionRun(id: string, data: Partial<PayrollTransactionRun>): Promise<PayrollTransactionRun | undefined>;
  deletePayrollTransactionRunsByRun(payrollRunId: string): Promise<void>;

  // Tenant Provisioning
  getTenantCommercialGates(): Promise<(TenantCommercialGate & { company: Company })[]>;
  getTenantCommercialGate(companyId: string): Promise<TenantCommercialGate | undefined>;
  upsertTenantCommercialGate(companyId: string, data: Partial<InsertTenantCommercialGate>): Promise<TenantCommercialGate>;
  getTenantProvisioningAuditLogs(companyId: string): Promise<TenantProvisioningAuditLog[]>;
  getTenantImplementationProject(companyId: string): Promise<TenantImplementationProject | undefined>;
  updateTenantImplementationProject(id: string, data: Partial<TenantImplementationProject>): Promise<TenantImplementationProject | undefined>;

  // Agreement Templates
  getAgreementTemplates(companyId?: string): Promise<AgreementTemplate[]>;
  getAgreementTemplate(id: string): Promise<AgreementTemplate | undefined>;
  createAgreementTemplate(data: InsertAgreementTemplate): Promise<AgreementTemplate>;
  updateAgreementTemplate(id: string, data: Partial<AgreementTemplate>): Promise<AgreementTemplate | undefined>;
  deleteAgreementTemplate(id: string): Promise<void>;

  // Worker Agreements
  getWorkerAgreements(companyId: string, workerId?: string): Promise<WorkerAgreement[]>;
  getWorkerAgreement(id: string): Promise<WorkerAgreement | undefined>;
  createWorkerAgreement(data: InsertWorkerAgreement): Promise<WorkerAgreement>;
  updateWorkerAgreement(id: string, data: Partial<WorkerAgreement>): Promise<WorkerAgreement | undefined>;
  deleteWorkerAgreement(id: string): Promise<void>;

  // Worker Onboarding
  getWorkerOnboardings(companyId: string): Promise<WorkerOnboarding[]>;
  getWorkerOnboarding(id: string): Promise<WorkerOnboarding | undefined>;
  getWorkerOnboardingByToken(tokenHash: string): Promise<WorkerOnboarding | undefined>;
  createWorkerOnboarding(data: InsertWorkerOnboarding): Promise<WorkerOnboarding>;
  updateWorkerOnboarding(id: string, data: Partial<WorkerOnboarding>): Promise<WorkerOnboarding | undefined>;
  deleteWorkerOnboarding(id: string): Promise<void>;

  // Onboarding Steps
  getOnboardingSteps(onboardingId: string): Promise<OnboardingStep[]>;
  getOnboardingStep(id: string): Promise<OnboardingStep | undefined>;
  createOnboardingStep(data: InsertOnboardingStep): Promise<OnboardingStep>;
  updateOnboardingStep(id: string, data: Partial<OnboardingStep>): Promise<OnboardingStep | undefined>;
  bulkCreateOnboardingSteps(steps: InsertOnboardingStep[]): Promise<OnboardingStep[]>;

  // Worker Onboarding Documents
  getWorkerOnboardingDocuments(onboardingId: string): Promise<WorkerOnboardingDocument[]>;
  createWorkerOnboardingDocument(data: InsertWorkerOnboardingDocument): Promise<WorkerOnboardingDocument>;
  updateWorkerOnboardingDocument(id: string, data: Partial<WorkerOnboardingDocument>): Promise<WorkerOnboardingDocument | undefined>;

  // Onboarding Audit Log
  getOnboardingAuditLog(onboardingId: string): Promise<OnboardingAuditLogEntry[]>;
  createOnboardingAuditLogEntry(data: InsertOnboardingAuditLogEntry): Promise<OnboardingAuditLogEntry>;

  // Company Branding
  getCompanyBranding(companyId: string): Promise<CompanyBranding | undefined>;
  upsertCompanyBranding(companyId: string, data: Partial<InsertCompanyBranding>): Promise<CompanyBranding>;

  // Biz Document Templates
  getBizDocumentTemplates(companyId?: string): Promise<BizDocumentTemplate[]>;
  getBizDocumentTemplate(id: string): Promise<BizDocumentTemplate | undefined>;
  getBizDocumentTemplateBySlug(slug: string): Promise<BizDocumentTemplate | undefined>;

  // Biz Documents
  getBizDocuments(companyId: string, filters?: { documentType?: string; status?: string; ownerEntityId?: string }): Promise<BizDocument[]>;
  getBizDocument(id: string): Promise<BizDocument | undefined>;
  createBizDocument(data: InsertBizDocument): Promise<BizDocument>;
  updateBizDocument(id: string, data: Partial<BizDocument>): Promise<BizDocument | undefined>;
  deleteBizDocument(id: string): Promise<void>;

  // Biz Document Items
  getBizDocumentItems(documentId: string): Promise<BizDocumentItem[]>;
  createBizDocumentItem(data: InsertBizDocumentItem): Promise<BizDocumentItem>;
  updateBizDocumentItem(id: string, data: Partial<BizDocumentItem>): Promise<BizDocumentItem | undefined>;
  deleteBizDocumentItem(id: string): Promise<void>;
  replaceBizDocumentItems(documentId: string, items: Omit<InsertBizDocumentItem, 'documentId'>[]): Promise<BizDocumentItem[]>;

  // Biz Document Attachments
  getBizDocumentAttachments(documentId: string): Promise<BizDocumentAttachment[]>;
  createBizDocumentAttachment(data: InsertBizDocumentAttachment): Promise<BizDocumentAttachment>;
  deleteBizDocumentAttachment(id: string): Promise<void>;

  // Biz Document History
  getBizDocumentHistory(documentId: string): Promise<BizDocumentHistory[]>;
  addBizDocumentHistory(data: InsertBizDocumentHistory): Promise<BizDocumentHistory>;

  // ── Treasury ──────────────────────────────────────────────────────────────
  getTreasuryOutboundPayments(companyId: string, payrollRunId?: string): Promise<TreasuryOutboundPayment[]>;
  getTreasuryOutboundPaymentByStripeId(stripeId: string): Promise<TreasuryOutboundPayment | undefined>;
  createTreasuryOutboundPayment(data: InsertTreasuryOutboundPayment): Promise<TreasuryOutboundPayment>;
  updateTreasuryOutboundPayment(id: string, data: Partial<TreasuryOutboundPayment>): Promise<TreasuryOutboundPayment | undefined>;
  // ── Inventory ──────────────────────────────────────────────────────────────
  getInventoryItems(companyId: string): Promise<InventoryItem[]>;
  getInventoryItem(id: string): Promise<InventoryItem | undefined>;
  createInventoryItem(data: InsertInventoryItem): Promise<InventoryItem>;
  updateInventoryItem(id: string, data: Partial<InventoryItem>): Promise<InventoryItem | undefined>;
  deleteInventoryItem(id: string): Promise<void>;
  bulkSetInventory(companyId: string, items: InsertInventoryItem[]): Promise<InventoryItem[]>;
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
  async getWorkerByEmployeeNumberAndPin(employeeNumber: string, pin: string): Promise<Worker | undefined> {
    const matches = await db.select().from(workers).where(
      and(eq(workers.employeeNumber, employeeNumber), eq(workers.pin, pin))
    );
    return matches[0];
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

  async getPendingPunches(companyId?: string): Promise<TimePunch[]> {
    if (companyId) {
      return db.select().from(timePunches)
        .where(and(eq(timePunches.companyId, companyId), eq(timePunches.approvalStatus, "pending")))
        .orderBy(desc(timePunches.punchTime));
    }
    return db.select().from(timePunches)
      .where(eq(timePunches.approvalStatus, "pending"))
      .orderBy(desc(timePunches.punchTime));
  }

  async convertPunchesToTimeEntries(companyId: string, startDate: string, endDate: string): Promise<{ created: number; skipped: number; entries: TimeEntry[] }> {
    // Load company timezone so punch-to-date grouping uses company local time, not UTC
    const companyRows = await db.select({ timezone: companies.timezone }).from(companies).where(eq(companies.id, companyId)).limit(1);
    const companyTz = companyRows[0]?.timezone || "America/New_York";

    const allPunches = await db.select().from(timePunches)
      .where(and(
        eq(timePunches.companyId, companyId),
        gte(timePunches.punchTime, new Date(startDate + "T00:00:00")),
        lte(timePunches.punchTime, new Date(endDate + "T23:59:59"))
      ))
      .orderBy(timePunches.workerId, timePunches.punchTime);

    const scheds = await db.select().from(schedules)
      .where(and(eq(schedules.companyId, companyId), gte(schedules.date, startDate), lte(schedules.date, endDate)));

    const existingEntries = await db.select().from(timeEntries)
      .where(and(eq(timeEntries.companyId, companyId), gte(timeEntries.date, startDate), lte(timeEntries.date, endDate)));

    // Group punches by worker+date using company local date (not UTC)
    const punchGroups: Record<string, typeof allPunches> = {};
    for (const p of allPunches) {
      const dateKey = getLocalDateStr(new Date(p.punchTime), companyTz);
      const key = `${p.workerId}::${dateKey}`;
      if (!punchGroups[key]) punchGroups[key] = [];
      punchGroups[key].push(p);
    }

    const created: TimeEntry[] = [];
    let skipped = 0;

    for (const [key, punches] of Object.entries(punchGroups)) {
      const [workerId, date] = key.split("::");
      // Skip if time entry already exists (from punches source or otherwise has clockIn from punches)
      const alreadyExists = existingEntries.find(e => e.workerId === workerId && e.date === date && e.source === "punches");
      if (alreadyExists) { skipped++; continue; }

      const clockInPunch = punches.find(p => p.punchType === "clock_in");
      const clockOutPunch = [...punches].reverse().find(p => p.punchType === "clock_out");
      if (!clockInPunch) { skipped++; continue; }

      const clockIn = new Date(clockInPunch.punchTime);
      const clockOut = clockOutPunch ? new Date(clockOutPunch.punchTime) : null;

      // Calculate break minutes from break_start/break_end pairs
      let breakMinutes = 0;
      const breakStarts = punches.filter(p => p.punchType === "break_start");
      const breakEnds = punches.filter(p => p.punchType === "break_end");
      for (let i = 0; i < Math.min(breakStarts.length, breakEnds.length); i++) {
        breakMinutes += (new Date(breakEnds[i].punchTime).getTime() - new Date(breakStarts[i].punchTime).getTime()) / 60000;
      }

      // Find matching schedule
      const sched = scheds.find(s => s.workerId === workerId && s.date === date);
      let scheduledStart: Date | undefined;
      let scheduledEnd: Date | undefined;
      let scheduledHours: number | undefined;
      let lateMinutes = 0;
      let earlyDepartureMinutes = 0;
      let isUnscheduled = !sched;

      if (sched) {
        scheduledStart = localTimeToUTC(date, sched.startTime, companyTz);
        scheduledEnd   = localTimeToUTC(date, sched.endTime,   companyTz);
        scheduledHours = (scheduledEnd.getTime() - scheduledStart.getTime()) / (1000 * 60 * 60);
        lateMinutes = Math.max(0, Math.round((clockIn.getTime() - scheduledStart.getTime()) / 60000));
        if (clockOut && scheduledEnd) {
          earlyDepartureMinutes = Math.max(0, Math.round((scheduledEnd.getTime() - clockOut.getTime()) / 60000));
        }
      }

      // Calculate total hours
      let totalHours = 0;
      let overtimeHours = 0;
      let doubleTimeHours = 0;
      if (clockOut) {
        const workedMs = clockOut.getTime() - clockIn.getTime() - breakMinutes * 60000;
        totalHours = Math.max(0, workedMs / (1000 * 60 * 60));
        overtimeHours = Math.max(0, totalHours - 8);
        doubleTimeHours = Math.max(0, totalHours - 12);
      }

      const entry = await db.insert(timeEntries).values({
        workerId, companyId, date, clockIn, clockOut: clockOut || undefined,
        breakMinutes: Math.round(breakMinutes),
        totalHours: totalHours.toFixed(2),
        overtimeHours: overtimeHours.toFixed(2),
        doubleTimeHours: doubleTimeHours.toFixed(2),
        status: "pending",
        source: "punches",
        scheduleId: sched?.id || undefined,
        scheduledStart: scheduledStart || undefined,
        scheduledEnd: scheduledEnd || undefined,
        scheduledHours: scheduledHours?.toFixed(2) || undefined,
        lateMinutes, earlyDepartureMinutes, isUnscheduled,
        note: isUnscheduled ? "No schedule found — unscheduled shift" : undefined,
      }).returning();
      created.push(entry[0]);
    }

    return { created: created.length, skipped, entries: created };
  }

  async getScheduleLaborSummary(companyId: string, startDate: string, endDate: string): Promise<any[]> {
    const scheds = await db.select().from(schedules)
      .where(and(eq(schedules.companyId, companyId), gte(schedules.date, startDate), lte(schedules.date, endDate)));
    const workerIds = [...new Set(scheds.map(s => s.workerId))];
    const allWorkers = workerIds.length > 0 ? await db.select().from(workers).where(inArray(workers.id, workerIds)) : [];
    const entries = await db.select().from(timeEntries)
      .where(and(eq(timeEntries.companyId, companyId), gte(timeEntries.date, startDate), lte(timeEntries.date, endDate)));

    const summary: Record<string, any> = {};
    for (const sched of scheds) {
      if (!summary[sched.workerId]) {
        const w = allWorkers.find(w => w.id === sched.workerId);
        summary[sched.workerId] = {
          workerId: sched.workerId,
          workerName: w ? `${w.firstName} ${w.lastName}` : "Unknown",
          payRate: parseFloat(w?.payRate || "0"),
          scheduledHours: 0, scheduledCost: 0,
          actualHours: 0, actualCost: 0,
          shifts: 0,
        };
      }
      const [sh, sm] = sched.startTime.split(":").map(Number);
      const [eh, em] = sched.endTime.split(":").map(Number);
      const hrs = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
      summary[sched.workerId].scheduledHours += Math.max(0, hrs);
      summary[sched.workerId].scheduledCost += Math.max(0, hrs) * summary[sched.workerId].payRate;
      summary[sched.workerId].shifts++;
    }
    for (const entry of entries) {
      if (!summary[entry.workerId]) continue;
      const hrs = parseFloat(entry.totalHours || "0");
      summary[entry.workerId].actualHours += hrs;
      summary[entry.workerId].actualCost += hrs * summary[entry.workerId].payRate;
    }
    return Object.values(summary);
  }

  async getTimeEntries(companyId?: string): Promise<TimeEntry[]> {
    if (companyId) {
      return db.select().from(timeEntries).where(eq(timeEntries.companyId, companyId)).orderBy(desc(timeEntries.date));
    }
    return db.select().from(timeEntries).orderBy(desc(timeEntries.date));
  }
  async getTimeEntriesByDateRange(companyId: string, startDate: string, endDate: string): Promise<TimeEntry[]> {
    return db.select().from(timeEntries)
      .where(and(eq(timeEntries.companyId, companyId), gte(timeEntries.date, startDate), lte(timeEntries.date, endDate), ne(timeEntries.status, "rejected")))
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
    try {
      if (companyId) {
        return await db.select().from(schedules).where(eq(schedules.companyId, companyId)).orderBy(desc(schedules.date));
      }
      return await db.select().from(schedules).orderBy(desc(schedules.date));
    } catch (e: any) {
      if (e.code === "42703" || String(e.message).includes("does not exist")) {
        const base = companyId
          ? sql`SELECT id, worker_id, company_id, date, start_time, end_time, department, status, note, created_at, NULL::varchar as job_id FROM schedules WHERE company_id = ${companyId} ORDER BY date DESC`
          : sql`SELECT id, worker_id, company_id, date, start_time, end_time, department, status, note, created_at, NULL::varchar as job_id FROM schedules ORDER BY date DESC`;
        const result = await db.execute(base);
        return result.rows.map((r: any) => ({
          id: r.id, workerId: r.worker_id, companyId: r.company_id,
          date: r.date, startTime: r.start_time, endTime: r.end_time,
          department: r.department, jobId: null, status: r.status,
          note: r.note, createdAt: r.created_at,
        })) as Schedule[];
      }
      throw e;
    }
  }
  async getSchedule(id: string): Promise<Schedule | undefined> {
    try {
      const [r] = await db.select().from(schedules).where(eq(schedules.id, id));
      return r;
    } catch (e: any) {
      if (e.code === "42703" || String(e.message).includes("does not exist")) {
        const result = await db.execute(sql`SELECT id, worker_id, company_id, date, start_time, end_time, department, status, note, created_at, NULL::varchar as job_id FROM schedules WHERE id = ${id} LIMIT 1`);
        if (result.rows.length === 0) return undefined;
        const r: any = result.rows[0];
        return { id: r.id, workerId: r.worker_id, companyId: r.company_id, date: r.date, startTime: r.start_time, endTime: r.end_time, department: r.department, jobId: null, status: r.status, note: r.note, createdAt: r.created_at } as Schedule;
      }
      throw e;
    }
  }
  async getSchedulesByDateRange(companyId: string, startDate: string, endDate: string): Promise<Schedule[]> {
    return db.select().from(schedules).where(
      and(eq(schedules.companyId, companyId), gte(schedules.date, startDate), lte(schedules.date, endDate))
    ).orderBy(schedules.date);
  }
  async createSchedule(data: InsertSchedule): Promise<Schedule> {
    try {
      const [schedule] = await db.insert(schedules).values(data).returning();
      return schedule;
    } catch (e: any) {
      if (e.code === "42703" || String(e.message).includes("does not exist")) {
        // Fallback: raw SQL without job_id column in both INSERT and RETURNING
        const result = await db.execute(sql`
          INSERT INTO schedules (id, worker_id, company_id, date, start_time, end_time, department, status, note)
          VALUES (gen_random_uuid(), ${data.workerId}, ${data.companyId}, ${data.date}, ${data.startTime}, ${data.endTime},
                  ${(data as any).department || null}, ${'draft'}, ${(data as any).note || null})
          RETURNING id, worker_id, company_id, date, start_time, end_time, department, status, note, created_at, NULL::varchar as job_id
        `);
        const r = result.rows[0] as any;
        return { id: r.id, workerId: r.worker_id, companyId: r.company_id, date: r.date, startTime: r.start_time, endTime: r.end_time, department: r.department, jobId: null, status: r.status, note: r.note, createdAt: r.created_at } as Schedule;
      }
      throw e;
    }
  }
  async updateSchedule(id: string, data: Partial<Schedule>): Promise<Schedule | undefined> {
    try {
      const [schedule] = await db.update(schedules).set(data).where(eq(schedules.id, id)).returning();
      return schedule;
    } catch (e: any) {
      if (e.code === "42703" || String(e.message).includes("does not exist")) {
        // Fallback: retry with only the core columns that have always existed,
        // dropping any newer columns (job_id, position_id, cost_center_id, note)
        // that may not yet exist on older VPS databases.
        const { jobId, positionId, costCenterId, ...rest } = data as any;
        const safeData: any = {};
        if (rest.startTime !== undefined) safeData.startTime = rest.startTime;
        if (rest.endTime !== undefined) safeData.endTime = rest.endTime;
        if (rest.department !== undefined) safeData.department = rest.department || null;
        if (rest.status !== undefined) safeData.status = rest.status;
        if (rest.note !== undefined) safeData.note = rest.note || null;
        if (Object.keys(safeData).length === 0) {
          const [s] = await db.select().from(schedules).where(eq(schedules.id, id));
          return s;
        }
        try {
          const [s] = await db.update(schedules).set(safeData).where(eq(schedules.id, id)).returning();
          return s;
        } catch (e2: any) {
          // note column also missing — drop it too
          const { note: _n, ...coreSafe } = safeData;
          if (Object.keys(coreSafe).length === 0) {
            const [s] = await db.select().from(schedules).where(eq(schedules.id, id));
            return s;
          }
          const [s] = await db.update(schedules).set(coreSafe).where(eq(schedules.id, id)).returning();
          return s;
        }
      }
      throw e;
    }
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
    if (companyId) return db.select().from(departments).where(
      or(eq(departments.companyId, companyId), isNull(departments.companyId))
    ).orderBy(departments.name);
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
    if (companyId) return db.select().from(branches).where(or(eq(branches.companyId, companyId), isNull(branches.companyId))).orderBy(branches.name);
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
    try {
      if (companyId) return await db.select().from(recurringSchedules).where(eq(recurringSchedules.companyId, companyId));
      return await db.select().from(recurringSchedules);
    } catch (e: any) {
      // Graceful fallback when job_id column hasn't been migrated yet (VPS)
      if (e.code === "42703" || String(e.message).includes("does not exist")) {
        const baseQuery = companyId
          ? sql`SELECT id, company_id, worker_id, name, day_of_week, start_time, end_time, effective_from, effective_to, is_active, created_at, NULL::varchar as job_id FROM recurring_schedules WHERE company_id = ${companyId}`
          : sql`SELECT id, company_id, worker_id, name, day_of_week, start_time, end_time, effective_from, effective_to, is_active, created_at, NULL::varchar as job_id FROM recurring_schedules`;
        const result = await db.execute(baseQuery);
        return result.rows.map((r: any) => ({
          id: r.id,
          companyId: r.company_id,
          workerId: r.worker_id,
          name: r.name,
          dayOfWeek: r.day_of_week,
          startTime: r.start_time,
          endTime: r.end_time,
          effectiveFrom: r.effective_from ?? null,
          effectiveTo: r.effective_to ?? null,
          jobId: null,
          isActive: r.is_active,
          createdAt: r.created_at,
        })) as RecurringSchedule[];
      }
      throw e;
    }
  }
  async createRecurringSchedule(data: InsertRecurringSchedule): Promise<RecurringSchedule> {
    try {
      const [r] = await db.insert(recurringSchedules).values(data).returning();
      return r;
    } catch (e: any) {
      if (e.code === "42703" || String(e.message).includes("does not exist")) {
        const { jobId, positionId, costCenterId, note, ...rest } = data as any;
        const [r] = await db.insert(recurringSchedules).values(rest).returning();
        return r;
      }
      throw e;
    }
  }
  async updateRecurringSchedule(id: string, data: Partial<RecurringSchedule>): Promise<RecurringSchedule | undefined> {
    try {
      const [r] = await db.update(recurringSchedules).set(data).where(eq(recurringSchedules.id, id)).returning();
      return r;
    } catch (e: any) {
      if (e.code === "42703" || String(e.message).includes("does not exist")) {
        // Strip newer columns that may not yet exist on older VPS databases
        const { jobId, positionId, costCenterId, note, ...rest } = data as any;
        const [r] = await db.update(recurringSchedules).set(rest).where(eq(recurringSchedules.id, id)).returning();
        return r;
      }
      throw e;
    }
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
  async getPayPeriodSchedule(id: string): Promise<PayPeriodSchedule | undefined> {
    const [r] = await db.select().from(payPeriodSchedules).where(eq(payPeriodSchedules.id, id));
    return r;
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
      return db.select().from(employeeTitles).where(
        or(eq(employeeTitles.companyId, companyId), isNull(employeeTitles.companyId))
      ).orderBy(employeeTitles.name);
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
      return db.select().from(employeeGroups).where(
        or(eq(employeeGroups.companyId, companyId), isNull(employeeGroups.companyId))
      ).orderBy(employeeGroups.name);
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
    if (companyId) return db.select().from(regularTimePolicies).where(or(eq(regularTimePolicies.companyId, companyId), isNull(regularTimePolicies.companyId))).orderBy(regularTimePolicies.name);
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
    if (companyId) return db.select().from(overtimePolicies).where(or(eq(overtimePolicies.companyId, companyId), isNull(overtimePolicies.companyId))).orderBy(overtimePolicies.name);
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
    if (companyId) return db.select().from(premiumPolicies).where(or(eq(premiumPolicies.companyId, companyId), isNull(premiumPolicies.companyId))).orderBy(premiumPolicies.name);
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
    if (companyId) return db.select().from(mealPolicies).where(or(eq(mealPolicies.companyId, companyId), isNull(mealPolicies.companyId))).orderBy(mealPolicies.name);
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
    if (companyId) return db.select().from(breakPolicies).where(or(eq(breakPolicies.companyId, companyId), isNull(breakPolicies.companyId))).orderBy(breakPolicies.name);
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
    if (companyId) return db.select().from(schedulePolicies).where(or(eq(schedulePolicies.companyId, companyId), isNull(schedulePolicies.companyId))).orderBy(schedulePolicies.name);
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
    if (companyId) return db.select().from(exceptionPolicies).where(or(eq(exceptionPolicies.companyId, companyId), isNull(exceptionPolicies.companyId))).orderBy(exceptionPolicies.name);
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
    if (companyId) return db.select().from(accrualPolicies).where(or(eq(accrualPolicies.companyId, companyId), isNull(accrualPolicies.companyId))).orderBy(accrualPolicies.name);
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
    if (companyId) return db.select().from(absencePolicies).where(or(eq(absencePolicies.companyId, companyId), isNull(absencePolicies.companyId))).orderBy(absencePolicies.name);
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
    if (companyId) return db.select().from(holidayPolicies).where(or(eq(holidayPolicies.companyId, companyId), isNull(holidayPolicies.companyId))).orderBy(holidayPolicies.name);
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
    if (companyId) return db.select().from(roundingPolicies).where(or(eq(roundingPolicies.companyId, companyId), isNull(roundingPolicies.companyId))).orderBy(roundingPolicies.name);
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
    if (companyId) return db.select().from(divisions).where(or(eq(divisions.companyId, companyId), isNull(divisions.companyId))).orderBy(divisions.name);
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
    if (companyId) return db.select().from(positions).where(or(eq(positions.companyId, companyId), isNull(positions.companyId))).orderBy(positions.title);
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
    if (companyId) return db.select().from(costCenters).where(or(eq(costCenters.companyId, companyId), isNull(costCenters.companyId))).orderBy(costCenters.name);
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
    if (companyId) {
      return db.select().from(stations).where(
        or(eq(stations.companyId, companyId), isNull(stations.companyId))
      ).orderBy(stations.stationName);
    }
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

  async getReceipts(companyId?: string, costCenterId?: string, jobId?: string): Promise<Receipt[]> {
    const conditions: any[] = [];
    if (companyId) conditions.push(eq(receipts.companyId, companyId));
    if (costCenterId) conditions.push(eq(receipts.costCenterId, costCenterId));
    if (jobId) conditions.push(eq(receipts.jobId, jobId));
    if (conditions.length > 0) return db.select().from(receipts).where(and(...conditions)).orderBy(desc(receipts.createdAt));
    return db.select().from(receipts).orderBy(desc(receipts.createdAt));
  }
  async getReceipt(id: string): Promise<Receipt | undefined> {
    const [r] = await db.select().from(receipts).where(eq(receipts.id, id));
    return r;
  }
  async createReceipt(data: InsertReceipt): Promise<Receipt> {
    const [r] = await db.insert(receipts).values(data).returning();
    return r;
  }
  async updateReceipt(id: string, data: Partial<Receipt>): Promise<Receipt | undefined> {
    const [r] = await db.update(receipts).set(data).where(eq(receipts.id, id)).returning();
    return r;
  }
  async deleteReceipt(id: string): Promise<void> {
    await db.delete(receipts).where(eq(receipts.id, id));
  }

  async getShiftOffers(companyId?: string): Promise<ShiftOffer[]> {
    return db.select().from(shiftOffers).orderBy(desc(shiftOffers.offeredAt));
  }
  async getShiftOffer(id: string): Promise<ShiftOffer | undefined> {
    const [r] = await db.select().from(shiftOffers).where(eq(shiftOffers.id, id));
    return r;
  }
  async createShiftOffer(data: InsertShiftOffer): Promise<ShiftOffer> {
    const [r] = await db.insert(shiftOffers).values(data).returning();
    return r;
  }
  async updateShiftOffer(id: string, data: Partial<ShiftOffer>): Promise<ShiftOffer | undefined> {
    const [r] = await db.update(shiftOffers).set({ ...data, updatedAt: new Date() }).where(eq(shiftOffers.id, id)).returning();
    return r;
  }
  async deleteShiftOffer(id: string): Promise<void> {
    await db.delete(shiftOffers).where(eq(shiftOffers.id, id));
  }

  async updatePayrollItem(id: string, data: Partial<PayrollItem>): Promise<PayrollItem | undefined> {
    const [r] = await db.update(payrollItems).set(data).where(eq(payrollItems.id, id)).returning();
    return r;
  }

  async getSecondaryWageGroups(companyId?: string): Promise<SecondaryWageGroup[]> {
    if (companyId) return db.select().from(secondaryWageGroups).where(or(eq(secondaryWageGroups.companyId, companyId), isNull(secondaryWageGroups.companyId))).orderBy(secondaryWageGroups.name);
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
    if (companyId) return db.select().from(currencies).where(or(eq(currencies.companyId, companyId), isNull(currencies.companyId))).orderBy(currencies.currencyCode);
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

  async getPayrollPaymentMethods(companyId?: string): Promise<PayrollPaymentMethod[]> {
    if (companyId) return db.select().from(payrollPaymentMethods).where(or(eq(payrollPaymentMethods.companyId, companyId), isNull(payrollPaymentMethods.companyId))).orderBy(payrollPaymentMethods.sortOrder);
    return db.select().from(payrollPaymentMethods).orderBy(payrollPaymentMethods.sortOrder);
  }
  async createPayrollPaymentMethod(data: InsertPayrollPaymentMethod): Promise<PayrollPaymentMethod> {
    const [r] = await db.insert(payrollPaymentMethods).values(data).returning();
    return r;
  }
  async updatePayrollPaymentMethod(id: string, data: Partial<PayrollPaymentMethod>): Promise<PayrollPaymentMethod | undefined> {
    const [r] = await db.update(payrollPaymentMethods).set({ ...data, updatedAt: new Date() }).where(eq(payrollPaymentMethods.id, id)).returning();
    return r;
  }
  async deletePayrollPaymentMethod(id: string): Promise<void> {
    await db.delete(payrollPaymentMethods).where(eq(payrollPaymentMethods.id, id));
  }

  async getFundingAccounts(companyId?: string): Promise<FundingAccount[]> {
    if (companyId) return db.select().from(fundingAccounts).where(or(eq(fundingAccounts.companyId, companyId), isNull(fundingAccounts.companyId))).orderBy(fundingAccounts.accountName);
    return db.select().from(fundingAccounts).orderBy(fundingAccounts.accountName);
  }
  async createFundingAccount(data: InsertFundingAccount): Promise<FundingAccount> {
    const [r] = await db.insert(fundingAccounts).values(data).returning();
    return r;
  }
  async updateFundingAccount(id: string, data: Partial<FundingAccount>): Promise<FundingAccount | undefined> {
    const [r] = await db.update(fundingAccounts).set({ ...data, updatedAt: new Date() }).where(eq(fundingAccounts.id, id)).returning();
    return r;
  }
  async deleteFundingAccount(id: string): Promise<void> {
    await db.delete(fundingAccounts).where(eq(fundingAccounts.id, id));
  }

  async getPayrollPaymentRecords(companyId?: string, payrollRunId?: string): Promise<PayrollPaymentRecord[]> {
    const conditions = [];
    if (companyId) conditions.push(eq(payrollPaymentRecords.companyId, companyId));
    if (payrollRunId) conditions.push(eq(payrollPaymentRecords.payrollRunId, payrollRunId));
    if (conditions.length > 0) return db.select().from(payrollPaymentRecords).where(and(...conditions)).orderBy(desc(payrollPaymentRecords.createdAt));
    return db.select().from(payrollPaymentRecords).orderBy(desc(payrollPaymentRecords.createdAt));
  }
  async getPayrollPaymentRecord(id: string): Promise<PayrollPaymentRecord | undefined> {
    const [r] = await db.select().from(payrollPaymentRecords).where(eq(payrollPaymentRecords.id, id));
    return r;
  }
  async createPayrollPaymentRecord(data: InsertPayrollPaymentRecord): Promise<PayrollPaymentRecord> {
    const [r] = await db.insert(payrollPaymentRecords).values(data).returning();
    return r;
  }
  async updatePayrollPaymentRecord(id: string, data: Partial<PayrollPaymentRecord>): Promise<PayrollPaymentRecord | undefined> {
    const [r] = await db.update(payrollPaymentRecords).set({ ...data, updatedAt: new Date() }).where(eq(payrollPaymentRecords.id, id)).returning();
    return r;
  }
  async deletePayrollPaymentRecord(id: string): Promise<void> {
    await db.delete(payrollPaymentRecords).where(eq(payrollPaymentRecords.id, id));
  }

  // Tax Filing Snapshots
  async getTaxFilingSnapshots(companyId: string): Promise<any[]> {
    const { taxFilingSnapshots } = await import("../shared/schema.js");
    return db.select().from(taxFilingSnapshots).where(eq(taxFilingSnapshots.companyId, companyId)).orderBy(desc(taxFilingSnapshots.createdAt));
  }
  async getTaxFilingSnapshot(id: string): Promise<any | undefined> {
    const { taxFilingSnapshots } = await import("../shared/schema.js");
    const [r] = await db.select().from(taxFilingSnapshots).where(eq(taxFilingSnapshots.id, id));
    return r;
  }
  async createTaxFilingSnapshot(data: any): Promise<any> {
    const { taxFilingSnapshots } = await import("../shared/schema.js");
    const [r] = await db.insert(taxFilingSnapshots).values(data).returning();
    return r;
  }
  async updateTaxFilingSnapshot(id: string, data: any): Promise<any | undefined> {
    const { taxFilingSnapshots } = await import("../shared/schema.js");
    const [r] = await db.update(taxFilingSnapshots).set({ ...data, updatedAt: new Date() }).where(eq(taxFilingSnapshots.id, id)).returning();
    return r;
  }
  async deleteTaxFilingSnapshot(id: string): Promise<void> {
    const { taxFilingSnapshots } = await import("../shared/schema.js");
    await db.delete(taxFilingSnapshots).where(eq(taxFilingSnapshots.id, id));
  }

  // Time-Off Requests
  async getTimeOffRequests(companyId?: string, workerId?: string): Promise<TimeOffRequest[]> {
    const conditions: any[] = [];
    if (companyId) conditions.push(eq(timeOffRequests.companyId, companyId));
    if (workerId) conditions.push(eq(timeOffRequests.workerId, workerId));
    if (conditions.length > 0) return db.select().from(timeOffRequests).where(and(...conditions)).orderBy(desc(timeOffRequests.createdAt));
    return db.select().from(timeOffRequests).orderBy(desc(timeOffRequests.createdAt));
  }
  async getTimeOffRequest(id: string): Promise<TimeOffRequest | undefined> {
    const [r] = await db.select().from(timeOffRequests).where(eq(timeOffRequests.id, id));
    return r;
  }
  async createTimeOffRequest(data: InsertTimeOffRequest): Promise<TimeOffRequest> {
    const [r] = await db.insert(timeOffRequests).values(data).returning();
    return r;
  }
  async updateTimeOffRequest(id: string, data: Partial<TimeOffRequest>): Promise<TimeOffRequest | undefined> {
    const [r] = await db.update(timeOffRequests).set(data).where(eq(timeOffRequests.id, id)).returning();
    return r;
  }
  async deleteTimeOffRequest(id: string): Promise<void> {
    await db.delete(timeOffRequests).where(eq(timeOffRequests.id, id));
  }

  // Schedule Preferences
  async getSchedulePreferences(companyId?: string, workerId?: string): Promise<SchedulePreference[]> {
    const conditions: any[] = [];
    if (companyId) conditions.push(eq(schedulePreferences.companyId, companyId));
    if (workerId) conditions.push(eq(schedulePreferences.workerId, workerId));
    if (conditions.length > 0) return db.select().from(schedulePreferences).where(and(...conditions)).orderBy(desc(schedulePreferences.createdAt));
    return db.select().from(schedulePreferences).orderBy(desc(schedulePreferences.createdAt));
  }
  async createSchedulePreference(data: InsertSchedulePreference): Promise<SchedulePreference> {
    const [r] = await db.insert(schedulePreferences).values(data).returning();
    return r;
  }
  async updateSchedulePreference(id: string, data: Partial<SchedulePreference>): Promise<SchedulePreference | undefined> {
    const [r] = await db.update(schedulePreferences).set(data).where(eq(schedulePreferences.id, id)).returning();
    return r;
  }
  async deleteSchedulePreference(id: string): Promise<void> {
    await db.delete(schedulePreferences).where(eq(schedulePreferences.id, id));
  }

  async getEmployeeGroupConfigs(): Promise<EmployeeGroupConfig[]> {
    return db.select().from(employeeGroupConfigs).orderBy(employeeGroupConfigs.label);
  }

  async getMarketplaceListings(companyId?: string, status?: string): Promise<ShiftMarketplaceListing[]> {
    const conditions: any[] = [];
    if (companyId) conditions.push(eq(shiftMarketplaceListings.companyId, companyId));
    if (status) conditions.push(eq(shiftMarketplaceListings.status, status));
    if (conditions.length > 0) return db.select().from(shiftMarketplaceListings).where(and(...conditions)).orderBy(desc(shiftMarketplaceListings.createdAt));
    return db.select().from(shiftMarketplaceListings).orderBy(desc(shiftMarketplaceListings.createdAt));
  }
  async getMarketplaceListing(id: string): Promise<ShiftMarketplaceListing | undefined> {
    const [r] = await db.select().from(shiftMarketplaceListings).where(eq(shiftMarketplaceListings.id, id));
    return r;
  }
  async createMarketplaceListing(data: InsertShiftMarketplaceListing): Promise<ShiftMarketplaceListing> {
    const [r] = await db.insert(shiftMarketplaceListings).values(data).returning();
    return r;
  }
  async updateMarketplaceListing(id: string, data: Partial<ShiftMarketplaceListing>): Promise<ShiftMarketplaceListing | undefined> {
    const [r] = await db.update(shiftMarketplaceListings).set({ ...data, updatedAt: new Date() }).where(eq(shiftMarketplaceListings.id, id)).returning();
    return r;
  }

  async getMarketplaceRequests(listingId?: string, workerId?: string): Promise<ShiftMarketplaceRequest[]> {
    const conditions: any[] = [];
    if (listingId) conditions.push(eq(shiftMarketplaceRequests.listingId, listingId));
    if (workerId) conditions.push(eq(shiftMarketplaceRequests.requestingWorkerId, workerId));
    if (conditions.length > 0) return db.select().from(shiftMarketplaceRequests).where(and(...conditions)).orderBy(desc(shiftMarketplaceRequests.createdAt));
    return db.select().from(shiftMarketplaceRequests).orderBy(desc(shiftMarketplaceRequests.createdAt));
  }
  async getMarketplaceRequest(id: string): Promise<ShiftMarketplaceRequest | undefined> {
    const [r] = await db.select().from(shiftMarketplaceRequests).where(eq(shiftMarketplaceRequests.id, id));
    return r;
  }
  async createMarketplaceRequest(data: InsertShiftMarketplaceRequest): Promise<ShiftMarketplaceRequest> {
    const [r] = await db.insert(shiftMarketplaceRequests).values(data).returning();
    return r;
  }
  async updateMarketplaceRequest(id: string, data: Partial<ShiftMarketplaceRequest>): Promise<ShiftMarketplaceRequest | undefined> {
    const [r] = await db.update(shiftMarketplaceRequests).set({ ...data, updatedAt: new Date() }).where(eq(shiftMarketplaceRequests.id, id)).returning();
    return r;
  }

  async getEligibilityRuleSets(companyId?: string): Promise<EligibilityRuleSet[]> {
    const conditions: any[] = [];
    if (companyId) conditions.push(or(eq(eligibilityRuleSets.companyId, companyId), isNull(eligibilityRuleSets.companyId)));
    if (conditions.length > 0) return db.select().from(eligibilityRuleSets).where(and(...conditions));
    return db.select().from(eligibilityRuleSets);
  }
  async getEligibilityRuleSet(id: string): Promise<EligibilityRuleSet | undefined> {
    const [r] = await db.select().from(eligibilityRuleSets).where(eq(eligibilityRuleSets.id, id));
    return r;
  }
  async createEligibilityRuleSet(data: InsertEligibilityRuleSet): Promise<EligibilityRuleSet> {
    const [r] = await db.insert(eligibilityRuleSets).values(data).returning();
    return r;
  }
  async updateEligibilityRuleSet(id: string, data: Partial<EligibilityRuleSet>): Promise<EligibilityRuleSet | undefined> {
    const [r] = await db.update(eligibilityRuleSets).set(data).where(eq(eligibilityRuleSets.id, id)).returning();
    return r;
  }
  async deleteEligibilityRuleSet(id: string): Promise<void> {
    await db.delete(eligibilityRuleSets).where(eq(eligibilityRuleSets.id, id));
  }

  async getScheduleAuditLogs(companyId?: string, limit?: number): Promise<ScheduleAuditLog[]> {
    const conditions: any[] = [];
    if (companyId) conditions.push(eq(scheduleAuditLogs.companyId, companyId));
    const query = conditions.length > 0
      ? db.select().from(scheduleAuditLogs).where(and(...conditions)).orderBy(desc(scheduleAuditLogs.createdAt))
      : db.select().from(scheduleAuditLogs).orderBy(desc(scheduleAuditLogs.createdAt));
    if (limit) return query.limit(limit);
    return query.limit(500);
  }
  async createScheduleAuditLog(data: InsertScheduleAuditLog): Promise<ScheduleAuditLog> {
    const [r] = await db.insert(scheduleAuditLogs).values(data).returning();
    return r;
  }

  async getNotificationPreferences(workerId: string): Promise<NotificationPreference[]> {
    return db.select().from(notificationPreferences).where(eq(notificationPreferences.workerId, workerId));
  }
  async upsertNotificationPreference(data: InsertNotificationPreference): Promise<NotificationPreference> {
    const existing = await db.select().from(notificationPreferences).where(
      and(eq(notificationPreferences.workerId, data.workerId), eq(notificationPreferences.eventType, data.eventType))
    );
    if (existing.length > 0) {
      const [r] = await db.update(notificationPreferences).set({ ...data, updatedAt: new Date() }).where(eq(notificationPreferences.id, existing[0].id)).returning();
      return r;
    }
    const [r] = await db.insert(notificationPreferences).values(data).returning();
    return r;
  }
  // ── Expense Categories ─────────────────────────────────────────────────
  async getExpenseCategories(): Promise<ExpenseCategory[]> {
    return db.select().from(expenseCategories).orderBy(expenseCategories.sortOrder);
  }
  async getExpenseCategory(id: string): Promise<ExpenseCategory | undefined> {
    const [r] = await db.select().from(expenseCategories).where(eq(expenseCategories.id, id));
    return r;
  }
  async createExpenseCategory(data: InsertExpenseCategory): Promise<ExpenseCategory> {
    const [r] = await db.insert(expenseCategories).values(data).returning();
    return r;
  }
  async updateExpenseCategory(id: string, data: Partial<ExpenseCategory>): Promise<ExpenseCategory | undefined> {
    const [r] = await db.update(expenseCategories).set(data).where(eq(expenseCategories.id, id)).returning();
    return r;
  }

  // ── Expenses ──────────────────────────────────────────────────────────
  async getExpenses(companyId?: string, submitterId?: string, status?: string): Promise<Expense[]> {
    const conds: any[] = [];
    if (companyId) conds.push(eq(expenses.companyId, companyId));
    if (submitterId) conds.push(eq(expenses.submitterId, submitterId));
    if (status) conds.push(eq(expenses.status, status));
    const q = conds.length > 0 ? db.select().from(expenses).where(and(...conds)) : db.select().from(expenses);
    return q.orderBy(desc(expenses.createdAt));
  }
  async getExpense(id: string): Promise<Expense | undefined> {
    const [r] = await db.select().from(expenses).where(eq(expenses.id, id));
    return r;
  }
  async createExpense(data: InsertExpense): Promise<Expense> {
    const [r] = await db.insert(expenses).values(data).returning();
    return r;
  }
  async updateExpense(id: string, data: Partial<Expense>): Promise<Expense | undefined> {
    const [r] = await db.update(expenses).set({ ...data, updatedAt: new Date() }).where(eq(expenses.id, id)).returning();
    return r;
  }
  async deleteExpense(id: string): Promise<void> {
    await db.delete(expenses).where(eq(expenses.id, id));
  }

  // ── Expense Attachments ───────────────────────────────────────────────
  async getExpenseAttachments(expenseId: string): Promise<ExpenseAttachment[]> {
    return db.select().from(expenseAttachments).where(eq(expenseAttachments.expenseId, expenseId));
  }
  async createExpenseAttachment(data: InsertExpenseAttachment): Promise<ExpenseAttachment> {
    const [r] = await db.insert(expenseAttachments).values(data).returning();
    return r;
  }
  async deleteExpenseAttachment(id: string): Promise<void> {
    await db.delete(expenseAttachments).where(eq(expenseAttachments.id, id));
  }

  // ── Contractor Invoices ───────────────────────────────────────────────
  async getContractorInvoices(companyId?: string, contractorId?: string, status?: string): Promise<ContractorInvoice[]> {
    const conds: any[] = [];
    if (companyId) conds.push(eq(contractorInvoices.companyId, companyId));
    if (contractorId) conds.push(eq(contractorInvoices.contractorId, contractorId));
    if (status) conds.push(eq(contractorInvoices.status, status));
    const q = conds.length > 0 ? db.select().from(contractorInvoices).where(and(...conds)) : db.select().from(contractorInvoices);
    return q.orderBy(desc(contractorInvoices.createdAt));
  }
  async getContractorInvoice(id: string): Promise<ContractorInvoice | undefined> {
    const [r] = await db.select().from(contractorInvoices).where(eq(contractorInvoices.id, id));
    return r;
  }
  async createContractorInvoice(data: InsertContractorInvoice): Promise<ContractorInvoice> {
    const [r] = await db.insert(contractorInvoices).values(data).returning();
    return r;
  }
  async updateContractorInvoice(id: string, data: Partial<ContractorInvoice>): Promise<ContractorInvoice | undefined> {
    const [r] = await db.update(contractorInvoices).set({ ...data, updatedAt: new Date() }).where(eq(contractorInvoices.id, id)).returning();
    return r;
  }

  // ── Contractor Invoice Attachments ────────────────────────────────────
  async getContractorInvoiceAttachments(invoiceId: string): Promise<ContractorInvoiceAttachment[]> {
    return db.select().from(contractorInvoiceAttachments).where(eq(contractorInvoiceAttachments.invoiceId, invoiceId));
  }
  async createContractorInvoiceAttachment(data: InsertContractorInvoiceAttachment): Promise<ContractorInvoiceAttachment> {
    const [r] = await db.insert(contractorInvoiceAttachments).values(data).returning();
    return r;
  }

  // ── Recurring Expense Templates ───────────────────────────────────────
  async getRecurringExpenseTemplates(companyId?: string): Promise<RecurringExpenseTemplate[]> {
    if (companyId) return db.select().from(recurringExpenseTemplates).where(eq(recurringExpenseTemplates.companyId, companyId));
    return db.select().from(recurringExpenseTemplates);
  }
  async getRecurringExpenseTemplate(id: string): Promise<RecurringExpenseTemplate | undefined> {
    const [r] = await db.select().from(recurringExpenseTemplates).where(eq(recurringExpenseTemplates.id, id));
    return r;
  }
  async createRecurringExpenseTemplate(data: InsertRecurringExpenseTemplate): Promise<RecurringExpenseTemplate> {
    const [r] = await db.insert(recurringExpenseTemplates).values(data).returning();
    return r;
  }
  async updateRecurringExpenseTemplate(id: string, data: Partial<RecurringExpenseTemplate>): Promise<RecurringExpenseTemplate | undefined> {
    const [r] = await db.update(recurringExpenseTemplates).set(data).where(eq(recurringExpenseTemplates.id, id)).returning();
    return r;
  }

  // ── Expense Approval Actions (immutable) ──────────────────────────────
  async getExpenseApprovalActions(objectType: string, objectId: string): Promise<ExpenseApprovalAction[]> {
    return db.select().from(expenseApprovalActions).where(
      and(eq(expenseApprovalActions.objectType, objectType), eq(expenseApprovalActions.objectId, objectId))
    ).orderBy(desc(expenseApprovalActions.createdAt));
  }
  async createExpenseApprovalAction(data: InsertExpenseApprovalAction): Promise<ExpenseApprovalAction> {
    const [r] = await db.insert(expenseApprovalActions).values(data).returning();
    return r;
  }

  // ── Payroll Reimbursement Items ───────────────────────────────────────
  async getPayrollReimbursementItems(workerId?: string, payrollRunId?: string, status?: string, expenseId?: string): Promise<PayrollReimbursementItem[]> {
    const conds: any[] = [];
    if (workerId) conds.push(eq(payrollReimbursementItems.workerId, workerId));
    if (payrollRunId) conds.push(eq(payrollReimbursementItems.payrollRunId, payrollRunId));
    if (status) conds.push(eq(payrollReimbursementItems.status, status));
    if (expenseId) conds.push(eq(payrollReimbursementItems.expenseId, expenseId));
    const q = conds.length > 0 ? db.select().from(payrollReimbursementItems).where(and(...conds)) : db.select().from(payrollReimbursementItems);
    return q.orderBy(desc(payrollReimbursementItems.createdAt));
  }
  async getPayrollReimbursementItem(id: string): Promise<PayrollReimbursementItem | undefined> {
    const [r] = await db.select().from(payrollReimbursementItems).where(eq(payrollReimbursementItems.id, id));
    return r;
  }
  async createPayrollReimbursementItem(data: InsertPayrollReimbursementItem): Promise<PayrollReimbursementItem> {
    const [r] = await db.insert(payrollReimbursementItems).values(data).returning();
    return r;
  }
  async updatePayrollReimbursementItem(id: string, data: Partial<PayrollReimbursementItem>): Promise<PayrollReimbursementItem | undefined> {
    const [r] = await db.update(payrollReimbursementItems).set(data).where(eq(payrollReimbursementItems.id, id)).returning();
    return r;
  }

  // ── System Documents ──────────────────────────────────────────────────────
  async getSystemDocuments(category?: string): Promise<SystemDocument[]> {
    const q = category
      ? db.select().from(systemDocuments).where(eq(systemDocuments.category, category))
      : db.select().from(systemDocuments);
    return q.orderBy(desc(systemDocuments.updatedAt));
  }
  async getSystemDocument(id: string): Promise<SystemDocument | undefined> {
    const [r] = await db.select().from(systemDocuments).where(eq(systemDocuments.id, id));
    return r;
  }
  async createSystemDocument(data: InsertSystemDocument): Promise<SystemDocument> {
    const [r] = await db.insert(systemDocuments).values(data).returning();
    return r;
  }
  async updateSystemDocument(id: string, data: Partial<SystemDocument>): Promise<SystemDocument | undefined> {
    const [r] = await db.update(systemDocuments).set({ ...data, updatedAt: new Date() }).where(eq(systemDocuments.id, id)).returning();
    return r;
  }
  async deleteSystemDocument(id: string): Promise<void> {
    await db.delete(systemDocuments).where(eq(systemDocuments.id, id));
  }

  // ── Customers ──────────────────────────────────────────
  async getCustomers(companyId: string, customerType?: string): Promise<Customer[]> {
    const conditions = [eq(customers.companyId, companyId)];
    if (customerType && customerType !== "all") {
      conditions.push(eq(customers.customerType, customerType));
    }
    return db.select().from(customers).where(and(...conditions)).orderBy(desc(customers.createdAt));
  }
  async getCustomer(id: string): Promise<Customer | undefined> {
    const [r] = await db.select().from(customers).where(eq(customers.id, id));
    return r;
  }
  async createCustomer(data: InsertCustomer): Promise<Customer> {
    const [r] = await db.insert(customers).values(data).returning();
    return r;
  }
  async updateCustomer(id: string, data: Partial<Customer>): Promise<Customer | undefined> {
    const [r] = await db.update(customers).set({ ...data, updatedAt: new Date() }).where(eq(customers.id, id)).returning();
    return r;
  }
  async deleteCustomer(id: string): Promise<void> {
    await db.delete(customers).where(eq(customers.id, id));
  }

  // ── Invoice Templates ──────────────────────────────────────────
  async getInvoiceTemplates(companyId?: string): Promise<InvoiceTemplate[]> {
    if (companyId) {
      return db.select().from(invoiceTemplates).where(or(eq(invoiceTemplates.companyId, companyId), isNull(invoiceTemplates.companyId))).orderBy(invoiceTemplates.name);
    }
    return db.select().from(invoiceTemplates).orderBy(invoiceTemplates.name);
  }
  async getInvoiceTemplate(id: string): Promise<InvoiceTemplate | undefined> {
    const [r] = await db.select().from(invoiceTemplates).where(eq(invoiceTemplates.id, id));
    return r;
  }
  async createInvoiceTemplate(data: InsertInvoiceTemplate): Promise<InvoiceTemplate> {
    const [r] = await db.insert(invoiceTemplates).values(data).returning();
    return r;
  }
  async updateInvoiceTemplate(id: string, data: Partial<InvoiceTemplate>): Promise<InvoiceTemplate | undefined> {
    const [r] = await db.update(invoiceTemplates).set({ ...data, updatedAt: new Date() }).where(eq(invoiceTemplates.id, id)).returning();
    return r;
  }
  async deleteInvoiceTemplate(id: string): Promise<void> {
    await db.delete(invoiceTemplates).where(eq(invoiceTemplates.id, id));
  }

  // ── Invoices ──────────────────────────────────────────
  async getInvoices(companyId: string): Promise<Invoice[]> {
    return db.select().from(invoices).where(eq(invoices.companyId, companyId)).orderBy(desc(invoices.createdAt));
  }
  async getInvoice(id: string): Promise<Invoice | undefined> {
    const [r] = await db.select().from(invoices).where(eq(invoices.id, id));
    return r;
  }
  async createInvoice(data: InsertInvoice): Promise<Invoice> {
    const [r] = await db.insert(invoices).values(data).returning();
    return r;
  }
  async updateInvoice(id: string, data: Partial<Invoice>): Promise<Invoice | undefined> {
    const [r] = await db.update(invoices).set({ ...data, updatedAt: new Date() }).where(eq(invoices.id, id)).returning();
    return r;
  }
  async deleteInvoice(id: string): Promise<void> {
    await db.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id));
    await db.delete(invoices).where(eq(invoices.id, id));
  }

  // ── Invoice Line Items ──────────────────────────────────────────
  async getInvoiceLineItems(invoiceId: string): Promise<InvoiceLineItem[]> {
    return db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId)).orderBy(invoiceLineItems.sortOrder);
  }
  async createInvoiceLineItem(data: InsertInvoiceLineItem): Promise<InvoiceLineItem> {
    const [r] = await db.insert(invoiceLineItems).values(data).returning();
    return r;
  }
  async updateInvoiceLineItem(id: string, data: Partial<InvoiceLineItem>): Promise<InvoiceLineItem | undefined> {
    const [r] = await db.update(invoiceLineItems).set(data).where(eq(invoiceLineItems.id, id)).returning();
    return r;
  }
  async deleteInvoiceLineItem(id: string): Promise<void> {
    await db.delete(invoiceLineItems).where(eq(invoiceLineItems.id, id));
  }
  async deleteInvoiceLineItemsByInvoice(invoiceId: string): Promise<void> {
    await db.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
  }

  // ── Payments ──────────────────────────────────────────
  async getPayments(companyId: string): Promise<Payment[]> {
    return db.select().from(payments).where(eq(payments.companyId, companyId)).orderBy(desc(payments.createdAt));
  }
  async getPayment(id: string): Promise<Payment | undefined> {
    const [r] = await db.select().from(payments).where(eq(payments.id, id));
    return r;
  }
  async createPayment(data: InsertPayment): Promise<Payment> {
    const [r] = await db.insert(payments).values(data).returning();
    return r;
  }
  async updatePayment(id: string, data: Partial<Payment>): Promise<Payment | undefined> {
    const [r] = await db.update(payments).set({ ...data, updatedAt: new Date() }).where(eq(payments.id, id)).returning();
    return r;
  }

  // ── Payment Method Configs ──────────────────────────────────────────
  async getPaymentMethodConfigs(companyId: string): Promise<PaymentMethodConfig[]> {
    return db.select().from(paymentMethodConfigs).where(eq(paymentMethodConfigs.companyId, companyId)).orderBy(paymentMethodConfigs.sortOrder);
  }
  async createPaymentMethodConfig(data: InsertPaymentMethodConfig): Promise<PaymentMethodConfig> {
    const [r] = await db.insert(paymentMethodConfigs).values(data).returning();
    return r;
  }
  async updatePaymentMethodConfig(id: string, data: Partial<PaymentMethodConfig>): Promise<PaymentMethodConfig | undefined> {
    const [r] = await db.update(paymentMethodConfigs).set(data).where(eq(paymentMethodConfigs.id, id)).returning();
    return r;
  }
  async deletePaymentMethodConfig(id: string): Promise<void> {
    await db.delete(paymentMethodConfigs).where(eq(paymentMethodConfigs.id, id));
  }

  // ── Recurring Billing Profiles ──────────────────────────────────────────
  async getRecurringBillingProfiles(companyId: string): Promise<RecurringBillingProfile[]> {
    return db.select().from(recurringBillingProfiles).where(eq(recurringBillingProfiles.companyId, companyId)).orderBy(desc(recurringBillingProfiles.createdAt));
  }
  async getRecurringBillingProfile(id: string): Promise<RecurringBillingProfile | undefined> {
    const [r] = await db.select().from(recurringBillingProfiles).where(eq(recurringBillingProfiles.id, id));
    return r;
  }
  async createRecurringBillingProfile(data: InsertRecurringBillingProfile): Promise<RecurringBillingProfile> {
    const [r] = await db.insert(recurringBillingProfiles).values(data).returning();
    return r;
  }
  async updateRecurringBillingProfile(id: string, data: Partial<RecurringBillingProfile>): Promise<RecurringBillingProfile | undefined> {
    const [r] = await db.update(recurringBillingProfiles).set({ ...data, updatedAt: new Date() }).where(eq(recurringBillingProfiles.id, id)).returning();
    return r;
  }
  async deleteRecurringBillingProfile(id: string): Promise<void> {
    await db.delete(recurringBillingProfiles).where(eq(recurringBillingProfiles.id, id));
  }

  // ── Document Folders ──────────────────────────────────────────
  async getDocumentFolders(companyId: string): Promise<DocumentFolder[]> {
    return db.select().from(documentFolders).where(eq(documentFolders.companyId, companyId)).orderBy(documentFolders.sortOrder);
  }
  async getDocumentFolder(id: string): Promise<DocumentFolder | undefined> {
    const [r] = await db.select().from(documentFolders).where(eq(documentFolders.id, id));
    return r;
  }
  async createDocumentFolder(data: InsertDocumentFolder): Promise<DocumentFolder> {
    const [r] = await db.insert(documentFolders).values(data).returning();
    return r;
  }
  async updateDocumentFolder(id: string, data: Partial<DocumentFolder>): Promise<DocumentFolder | undefined> {
    const [r] = await db.update(documentFolders).set(data).where(eq(documentFolders.id, id)).returning();
    return r;
  }
  async deleteDocumentFolder(id: string): Promise<void> {
    await db.delete(documentFolders).where(eq(documentFolders.id, id));
  }

  // ── Documents ──────────────────────────────────────────
  async getDocuments(companyId: string): Promise<Document[]> {
    return db.select().from(documents).where(eq(documents.companyId, companyId)).orderBy(desc(documents.createdAt));
  }
  async getDocument(id: string): Promise<Document | undefined> {
    const [r] = await db.select().from(documents).where(eq(documents.id, id));
    return r;
  }
  async createDocument(data: InsertDocument): Promise<Document> {
    const [r] = await db.insert(documents).values(data).returning();
    return r;
  }
  async updateDocument(id: string, data: Partial<Document>): Promise<Document | undefined> {
    const [r] = await db.update(documents).set({ ...data, updatedAt: new Date() }).where(eq(documents.id, id)).returning();
    return r;
  }
  async deleteDocument(id: string): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }

  // ── Document Versions ──────────────────────────────────────────
  async getDocumentVersions(documentId: string): Promise<DocumentVersion[]> {
    return db.select().from(documentVersions).where(eq(documentVersions.documentId, documentId)).orderBy(desc(documentVersions.versionNumber));
  }
  async createDocumentVersion(data: InsertDocumentVersion): Promise<DocumentVersion> {
    const [r] = await db.insert(documentVersions).values(data).returning();
    return r;
  }

  // ── Document Signature Requests ──────────────────────────────────────────
  async getDocumentSignatureRequests(companyId: string): Promise<DocumentSignatureRequest[]> {
    return db.select().from(documentSignatureRequests).where(eq(documentSignatureRequests.companyId, companyId)).orderBy(desc(documentSignatureRequests.createdAt));
  }
  async getDocumentSignatureRequest(id: string): Promise<DocumentSignatureRequest | undefined> {
    const [r] = await db.select().from(documentSignatureRequests).where(eq(documentSignatureRequests.id, id));
    return r;
  }
  async createDocumentSignatureRequest(data: InsertDocumentSignatureRequest): Promise<DocumentSignatureRequest> {
    const [r] = await db.insert(documentSignatureRequests).values(data).returning();
    return r;
  }
  async updateDocumentSignatureRequest(id: string, data: Partial<DocumentSignatureRequest>): Promise<DocumentSignatureRequest | undefined> {
    const [r] = await db.update(documentSignatureRequests).set({ ...data, updatedAt: new Date() }).where(eq(documentSignatureRequests.id, id)).returning();
    return r;
  }

  // ── Document Signers ──────────────────────────────────────────
  async getDocumentSigners(requestId: string): Promise<DocumentSigner[]> {
    return db.select().from(documentSigners).where(eq(documentSigners.signatureRequestId, requestId)).orderBy(documentSigners.sortOrder);
  }
  async createDocumentSigner(data: InsertDocumentSigner): Promise<DocumentSigner> {
    const [r] = await db.insert(documentSigners).values(data).returning();
    return r;
  }
  async updateDocumentSigner(id: string, data: Partial<DocumentSigner>): Promise<DocumentSigner | undefined> {
    const [r] = await db.update(documentSigners).set(data).where(eq(documentSigners.id, id)).returning();
    return r;
  }

  // ── Document Audit Logs ──────────────────────────────────────────
  async createDocumentAuditLog(data: InsertDocumentAuditLog): Promise<DocumentAuditLog> {
    const [r] = await db.insert(documentAuditLogs).values(data).returning();
    return r;
  }
  async getDocumentAuditLogs(documentId: string): Promise<DocumentAuditLog[]> {
    return db.select().from(documentAuditLogs).where(eq(documentAuditLogs.documentId, documentId)).orderBy(desc(documentAuditLogs.createdAt));
  }

  // ── Signature Packages ──────────────────────────────────────────
  async getSignaturePackages(companyId: string): Promise<SignaturePackage[]> {
    return db.select().from(signaturePackages).where(eq(signaturePackages.companyId, companyId)).orderBy(desc(signaturePackages.createdAt));
  }
  async getSignaturePackage(id: string): Promise<SignaturePackage | undefined> {
    const [r] = await db.select().from(signaturePackages).where(eq(signaturePackages.id, id));
    return r;
  }
  async getSignaturePackageByEnvelopeId(providerEnvelopeId: string, provider?: string): Promise<SignaturePackage | undefined> {
    const conditions = [eq(signaturePackages.providerEnvelopeId, providerEnvelopeId)];
    if (provider) {
      conditions.push(eq(signaturePackages.provider, provider));
    }
    const [r] = await db.select().from(signaturePackages).where(and(...conditions));
    return r;
  }
  async createSignaturePackage(data: InsertSignaturePackage): Promise<SignaturePackage> {
    const [r] = await db.insert(signaturePackages).values(data).returning();
    return r;
  }
  async updateSignaturePackage(id: string, data: Partial<SignaturePackage>): Promise<SignaturePackage | undefined> {
    const [r] = await db.update(signaturePackages).set({ ...data, updatedAt: new Date() }).where(eq(signaturePackages.id, id)).returning();
    return r;
  }

  // ── Webhook Events ──────────────────────────────────────────
  async getWebhookEvents(provider?: string): Promise<WebhookEvent[]> {
    if (provider) {
      return db.select().from(webhookEvents).where(eq(webhookEvents.provider, provider)).orderBy(desc(webhookEvents.createdAt));
    }
    return db.select().from(webhookEvents).orderBy(desc(webhookEvents.createdAt));
  }
  async getWebhookEventsByCompany(companyId: string, provider?: string): Promise<WebhookEvent[]> {
    const companyEnvelopeIds = await db
      .select({ providerEnvelopeId: signaturePackages.providerEnvelopeId })
      .from(signaturePackages)
      .where(eq(signaturePackages.companyId, companyId));
    const envelopeIds = companyEnvelopeIds.map(r => r.providerEnvelopeId).filter(Boolean) as string[];
    if (envelopeIds.length === 0) return [];
    const conditions = [inArray(webhookEvents.envelopeId, envelopeIds)];
    if (provider) {
      conditions.push(eq(webhookEvents.provider, provider));
    }
    return db.select().from(webhookEvents).where(and(...conditions)).orderBy(desc(webhookEvents.createdAt));
  }
  async getWebhookEventByProviderEventId(providerEventId: string): Promise<WebhookEvent | undefined> {
    const [r] = await db.select().from(webhookEvents).where(eq(webhookEvents.providerEventId, providerEventId));
    return r;
  }
  async createWebhookEvent(data: InsertWebhookEvent): Promise<WebhookEvent> {
    const [r] = await db.insert(webhookEvents).values(data).returning();
    return r;
  }
  async updateWebhookEvent(id: string, data: Partial<WebhookEvent>): Promise<WebhookEvent | undefined> {
    const [r] = await db.update(webhookEvents).set(data).where(eq(webhookEvents.id, id)).returning();
    return r;
  }

  // ── Automation Rules ──────────────────────────────────────────
  async getAutomationRules(companyId: string): Promise<AutomationRule[]> {
    return db.select().from(automationRules).where(eq(automationRules.companyId, companyId)).orderBy(desc(automationRules.createdAt));
  }
  async getAutomationRule(id: string): Promise<AutomationRule | undefined> {
    const [r] = await db.select().from(automationRules).where(eq(automationRules.id, id));
    return r;
  }
  async createAutomationRule(data: InsertAutomationRule): Promise<AutomationRule> {
    const [r] = await db.insert(automationRules).values(data).returning();
    return r;
  }
  async updateAutomationRule(id: string, data: Partial<AutomationRule>): Promise<AutomationRule | undefined> {
    const [r] = await db.update(automationRules).set({ ...data, updatedAt: new Date() }).where(eq(automationRules.id, id)).returning();
    return r;
  }
  async deleteAutomationRule(id: string): Promise<void> {
    await db.delete(automationRules).where(eq(automationRules.id, id));
  }

  // ── Automation Events ──────────────────────────────────────────
  async getAutomationEvents(companyId: string): Promise<AutomationEvent[]> {
    return db.select().from(automationEvents).where(eq(automationEvents.companyId, companyId)).orderBy(desc(automationEvents.createdAt));
  }
  async createAutomationEvent(data: InsertAutomationEvent): Promise<AutomationEvent> {
    const [r] = await db.insert(automationEvents).values(data).returning();
    return r;
  }

  // ── Notifications ──────────────────────────────────────────
  async getNotifications(companyId: string, userId?: string): Promise<Notification[]> {
    const conds = [eq(notifications.companyId, companyId)];
    if (userId) conds.push(eq(notifications.userId, userId));
    return db.select().from(notifications).where(and(...conds)).orderBy(desc(notifications.createdAt));
  }
  async createNotification(data: InsertNotification): Promise<Notification> {
    const [r] = await db.insert(notifications).values(data).returning();
    return r;
  }
  async updateNotification(id: string, data: Partial<Notification>): Promise<Notification | undefined> {
    const [r] = await db.update(notifications).set(data).where(eq(notifications.id, id)).returning();
    return r;
  }

  async createPortalAccessToken(data: any): Promise<any> {
    const [r] = await db.insert(portalAccessTokens).values(data).returning();
    return r;
  }
  async getPortalAccessTokenByToken(token: string): Promise<any> {
    const [r] = await db.select().from(portalAccessTokens).where(eq(portalAccessTokens.token, token));
    return r;
  }
  async revokePortalTokensForPacket(packetId: string): Promise<void> {
    await db.update(portalAccessTokens).set({ isRevoked: true }).where(eq(portalAccessTokens.packetId, packetId));
  }

  async getDocumentAuditLogsByCompany(companyId: string): Promise<DocumentAuditLog[]> {
    return db.select().from(documentAuditLogs).where(eq(documentAuditLogs.companyId, companyId)).orderBy(desc(documentAuditLogs.createdAt));
  }

  async getDocumentAcls(companyId: string): Promise<DocumentAcl[]> {
    return db.select().from(documentAcls).where(eq(documentAcls.companyId, companyId));
  }
  async getDocumentAcl(id: string): Promise<DocumentAcl | undefined> {
    const [r] = await db.select().from(documentAcls).where(eq(documentAcls.id, id));
    return r;
  }
  async createDocumentAcl(data: InsertDocumentAcl): Promise<DocumentAcl> {
    const [r] = await db.insert(documentAcls).values(data).returning();
    return r;
  }
  async deleteDocumentAcl(id: string): Promise<void> {
    await db.delete(documentAcls).where(eq(documentAcls.id, id));
  }

  async getDocumentRetentionPolicies(companyId: string): Promise<DocumentRetentionPolicy[]> {
    return db.select().from(documentRetentionPolicies).where(eq(documentRetentionPolicies.companyId, companyId)).orderBy(desc(documentRetentionPolicies.createdAt));
  }
  async createDocumentRetentionPolicy(data: InsertDocumentRetentionPolicy): Promise<DocumentRetentionPolicy> {
    const [r] = await db.insert(documentRetentionPolicies).values(data).returning();
    return r;
  }
  async updateDocumentRetentionPolicy(id: string, data: Partial<DocumentRetentionPolicy>): Promise<DocumentRetentionPolicy | undefined> {
    const [r] = await db.update(documentRetentionPolicies).set({ ...data, updatedAt: new Date() }).where(eq(documentRetentionPolicies.id, id)).returning();
    return r;
  }
  async deleteDocumentRetentionPolicy(id: string): Promise<void> {
    await db.delete(documentRetentionPolicies).where(eq(documentRetentionPolicies.id, id));
  }

  async getOnboardingPackets(companyId: string): Promise<OnboardingPacket[]> {
    return db.select().from(onboardingPackets).where(eq(onboardingPackets.companyId, companyId)).orderBy(desc(onboardingPackets.createdAt));
  }
  async getOnboardingPacket(id: string): Promise<OnboardingPacket | undefined> {
    const [r] = await db.select().from(onboardingPackets).where(eq(onboardingPackets.id, id));
    return r;
  }
  async createOnboardingPacket(data: InsertOnboardingPacket): Promise<OnboardingPacket> {
    const [r] = await db.insert(onboardingPackets).values(data).returning();
    return r;
  }
  async updateOnboardingPacket(id: string, data: Partial<OnboardingPacket>): Promise<OnboardingPacket | undefined> {
    const [r] = await db.update(onboardingPackets).set({ ...data, updatedAt: new Date() }).where(eq(onboardingPackets.id, id)).returning();
    return r;
  }

  async getOnboardingPacketSteps(packetId: string): Promise<OnboardingPacketStep[]> {
    return db.select().from(onboardingPacketSteps).where(eq(onboardingPacketSteps.packetId, packetId)).orderBy(onboardingPacketSteps.sortOrder);
  }
  async getOnboardingPacketStepById(id: string): Promise<OnboardingPacketStep | undefined> {
    const [r] = await db.select().from(onboardingPacketSteps).where(eq(onboardingPacketSteps.id, id));
    return r;
  }
  async createOnboardingPacketStep(data: InsertOnboardingPacketStep): Promise<OnboardingPacketStep> {
    const [r] = await db.insert(onboardingPacketSteps).values(data).returning();
    return r;
  }
  async updateOnboardingPacketStep(id: string, data: Partial<OnboardingPacketStep>): Promise<OnboardingPacketStep | undefined> {
    const [r] = await db.update(onboardingPacketSteps).set(data).where(eq(onboardingPacketSteps.id, id)).returning();
    return r;
  }

  async getInvoiceApprovalWorkflows(companyId: string): Promise<InvoiceApprovalWorkflow[]> {
    return db.select().from(invoiceApprovalWorkflows).where(eq(invoiceApprovalWorkflows.companyId, companyId)).orderBy(desc(invoiceApprovalWorkflows.createdAt));
  }
  async getInvoiceApprovalWorkflow(id: string): Promise<InvoiceApprovalWorkflow | undefined> {
    const [r] = await db.select().from(invoiceApprovalWorkflows).where(eq(invoiceApprovalWorkflows.id, id));
    return r;
  }
  async createInvoiceApprovalWorkflow(data: InsertInvoiceApprovalWorkflow): Promise<InvoiceApprovalWorkflow> {
    const [r] = await db.insert(invoiceApprovalWorkflows).values(data).returning();
    return r;
  }
  async updateInvoiceApprovalWorkflow(id: string, data: Partial<InvoiceApprovalWorkflow>): Promise<InvoiceApprovalWorkflow | undefined> {
    const [r] = await db.update(invoiceApprovalWorkflows).set({ ...data, updatedAt: new Date() }).where(eq(invoiceApprovalWorkflows.id, id)).returning();
    return r;
  }

  async getDeals(companyId: string): Promise<Deal[]> {
    return db.select().from(deals).where(eq(deals.companyId, companyId)).orderBy(desc(deals.createdAt));
  }
  async getDeal(id: string): Promise<Deal | undefined> {
    const [r] = await db.select().from(deals).where(eq(deals.id, id));
    return r;
  }
  async createDeal(data: InsertDeal): Promise<Deal> {
    const [r] = await db.insert(deals).values(data).returning();
    return r;
  }
  async updateDeal(id: string, data: Partial<Deal>): Promise<Deal | undefined> {
    const [r] = await db.update(deals).set({ ...data, updatedAt: new Date() }).where(eq(deals.id, id)).returning();
    return r;
  }
  async deleteDeal(id: string): Promise<void> {
    await db.update(customerOnboardingProjects).set({ dealId: null }).where(eq(customerOnboardingProjects.dealId, id));
    await db.delete(deals).where(eq(deals.id, id));
  }

  async getOnboardingTemplates(companyId: string): Promise<OnboardingTemplate[]> {
    return db.select().from(onboardingTemplates).where(eq(onboardingTemplates.companyId, companyId)).orderBy(desc(onboardingTemplates.createdAt));
  }
  async getOnboardingTemplate(id: string): Promise<OnboardingTemplate | undefined> {
    const [r] = await db.select().from(onboardingTemplates).where(eq(onboardingTemplates.id, id));
    return r;
  }
  async createOnboardingTemplate(data: InsertOnboardingTemplate): Promise<OnboardingTemplate> {
    const [r] = await db.insert(onboardingTemplates).values(data).returning();
    return r;
  }
  async updateOnboardingTemplate(id: string, data: Partial<OnboardingTemplate>): Promise<OnboardingTemplate | undefined> {
    const [r] = await db.update(onboardingTemplates).set({ ...data, updatedAt: new Date() }).where(eq(onboardingTemplates.id, id)).returning();
    return r;
  }
  async deleteOnboardingTemplate(id: string): Promise<void> {
    const templateTasks = await db.select().from(onboardingTemplateTasks).where(eq(onboardingTemplateTasks.templateId, id));
    for (const tt of templateTasks) {
      await db.update(onboardingTasks).set({ templateTaskId: null }).where(eq(onboardingTasks.templateTaskId, tt.id));
    }
    await db.delete(onboardingTemplateTasks).where(eq(onboardingTemplateTasks.templateId, id));
    await db.update(customerOnboardingProjects).set({ templateId: null }).where(eq(customerOnboardingProjects.templateId, id));
    await db.update(onboardingDocuments).set({ templateId: null }).where(eq(onboardingDocuments.templateId, id));
    await db.delete(onboardingTemplates).where(eq(onboardingTemplates.id, id));
  }

  async getOnboardingTemplateTasks(templateId: string): Promise<OnboardingTemplateTask[]> {
    return db.select().from(onboardingTemplateTasks).where(eq(onboardingTemplateTasks.templateId, templateId)).orderBy(onboardingTemplateTasks.sortOrder);
  }
  async createOnboardingTemplateTask(data: InsertOnboardingTemplateTask): Promise<OnboardingTemplateTask> {
    const [r] = await db.insert(onboardingTemplateTasks).values(data).returning();
    return r;
  }
  async updateOnboardingTemplateTask(id: string, data: Partial<OnboardingTemplateTask>): Promise<OnboardingTemplateTask | undefined> {
    const [r] = await db.update(onboardingTemplateTasks).set(data).where(eq(onboardingTemplateTasks.id, id)).returning();
    return r;
  }
  async deleteOnboardingTemplateTask(id: string): Promise<void> {
    await db.update(onboardingTasks).set({ templateTaskId: null }).where(eq(onboardingTasks.templateTaskId, id));
    await db.delete(onboardingTemplateTasks).where(eq(onboardingTemplateTasks.id, id));
  }

  async getCustomerOnboardingProjects(companyId: string): Promise<CustomerOnboardingProject[]> {
    return db.select().from(customerOnboardingProjects).where(eq(customerOnboardingProjects.companyId, companyId)).orderBy(desc(customerOnboardingProjects.createdAt));
  }
  async getCustomerOnboardingProject(id: string): Promise<CustomerOnboardingProject | undefined> {
    const [r] = await db.select().from(customerOnboardingProjects).where(eq(customerOnboardingProjects.id, id));
    return r;
  }
  async createCustomerOnboardingProject(data: InsertCustomerOnboardingProject): Promise<CustomerOnboardingProject> {
    const [r] = await db.insert(customerOnboardingProjects).values(data).returning();
    return r;
  }
  async updateCustomerOnboardingProject(id: string, data: Partial<CustomerOnboardingProject>): Promise<CustomerOnboardingProject | undefined> {
    const [r] = await db.update(customerOnboardingProjects).set({ ...data, updatedAt: new Date() }).where(eq(customerOnboardingProjects.id, id)).returning();
    return r;
  }
  async deleteCustomerOnboardingProject(id: string): Promise<void> {
    await db.delete(onboardingTasks).where(eq(onboardingTasks.projectId, id));
    await db.delete(onboardingDocuments).where(eq(onboardingDocuments.projectId, id));
    await db.update(engagementEvents).set({ projectId: null }).where(eq(engagementEvents.projectId, id));
    await db.delete(customerOnboardingProjects).where(eq(customerOnboardingProjects.id, id));
  }

  async getOnboardingTasks(projectId: string): Promise<OnboardingTask[]> {
    return db.select().from(onboardingTasks).where(eq(onboardingTasks.projectId, projectId)).orderBy(onboardingTasks.sortOrder);
  }
  async getOnboardingTask(id: string): Promise<OnboardingTask | undefined> {
    const [r] = await db.select().from(onboardingTasks).where(eq(onboardingTasks.id, id));
    return r;
  }
  async createOnboardingTask(data: InsertOnboardingTask): Promise<OnboardingTask> {
    const [r] = await db.insert(onboardingTasks).values(data).returning();
    return r;
  }
  async updateOnboardingTask(id: string, data: Partial<OnboardingTask>): Promise<OnboardingTask | undefined> {
    const [r] = await db.update(onboardingTasks).set({ ...data, updatedAt: new Date() }).where(eq(onboardingTasks.id, id)).returning();
    return r;
  }
  async deleteOnboardingTask(id: string): Promise<void> {
    await db.delete(onboardingTasks).where(eq(onboardingTasks.id, id));
  }

  async getOnboardingDocuments(companyId: string, projectId?: string, templateId?: string): Promise<OnboardingDocument[]> {
    if (projectId) {
      return db.select().from(onboardingDocuments).where(and(eq(onboardingDocuments.companyId, companyId), eq(onboardingDocuments.projectId, projectId))).orderBy(onboardingDocuments.sortOrder);
    }
    if (templateId) {
      return db.select().from(onboardingDocuments).where(and(eq(onboardingDocuments.companyId, companyId), eq(onboardingDocuments.templateId, templateId))).orderBy(onboardingDocuments.sortOrder);
    }
    return db.select().from(onboardingDocuments).where(eq(onboardingDocuments.companyId, companyId)).orderBy(onboardingDocuments.sortOrder);
  }
  async createOnboardingDocument(data: InsertOnboardingDocument): Promise<OnboardingDocument> {
    const [r] = await db.insert(onboardingDocuments).values(data).returning();
    return r;
  }
  async updateOnboardingDocument(id: string, data: Partial<OnboardingDocument>): Promise<OnboardingDocument | undefined> {
    const [r] = await db.update(onboardingDocuments).set({ ...data, updatedAt: new Date() }).where(eq(onboardingDocuments.id, id)).returning();
    return r;
  }
  async deleteOnboardingDocument(id: string): Promise<void> {
    await db.delete(onboardingDocuments).where(eq(onboardingDocuments.id, id));
  }

  async getEngagementEvents(companyId: string, customerId?: string): Promise<EngagementEvent[]> {
    if (customerId) {
      return db.select().from(engagementEvents).where(and(eq(engagementEvents.companyId, companyId), eq(engagementEvents.customerId, customerId))).orderBy(desc(engagementEvents.createdAt));
    }
    return db.select().from(engagementEvents).where(eq(engagementEvents.companyId, companyId)).orderBy(desc(engagementEvents.createdAt));
  }
  async getEngagementEvent(id: string): Promise<EngagementEvent | undefined> {
    const [r] = await db.select().from(engagementEvents).where(eq(engagementEvents.id, id));
    return r;
  }
  async createEngagementEvent(data: InsertEngagementEvent): Promise<EngagementEvent> {
    const [r] = await db.insert(engagementEvents).values(data).returning();
    return r;
  }
  async deleteEngagementEvent(id: string): Promise<void> {
    await db.delete(engagementEvents).where(eq(engagementEvents.id, id));
  }

  async getProductApiKeys(companyId: string): Promise<ProductApiKey[]> {
    return db.select().from(productApiKeys).where(eq(productApiKeys.companyId, companyId)).orderBy(desc(productApiKeys.createdAt));
  }
  async getProductApiKeyByKey(apiKey: string): Promise<ProductApiKey | undefined> {
    const [r] = await db.select().from(productApiKeys).where(eq(productApiKeys.apiKey, apiKey));
    return r;
  }
  async createProductApiKey(data: InsertProductApiKey): Promise<ProductApiKey> {
    const [r] = await db.insert(productApiKeys).values(data).returning();
    return r;
  }
  async updateProductApiKey(id: string, data: Partial<ProductApiKey>): Promise<ProductApiKey | undefined> {
    const [r] = await db.update(productApiKeys).set(data).where(eq(productApiKeys.id, id)).returning();
    return r;
  }
  async deleteProductApiKey(id: string): Promise<void> {
    await db.delete(productApiKeys).where(eq(productApiKeys.id, id));
  }

  async getCompanyWebhookConfigs(companyId: string): Promise<CompanyWebhookConfig[]> {
    return db.select().from(companyWebhookConfigs).where(eq(companyWebhookConfigs.companyId, companyId)).orderBy(desc(companyWebhookConfigs.createdAt));
  }
  async getCompanyWebhookConfig(id: string): Promise<CompanyWebhookConfig | undefined> {
    const [r] = await db.select().from(companyWebhookConfigs).where(eq(companyWebhookConfigs.id, id));
    return r;
  }
  async createCompanyWebhookConfig(data: InsertCompanyWebhookConfig): Promise<CompanyWebhookConfig> {
    const [r] = await db.insert(companyWebhookConfigs).values(data).returning();
    return r;
  }
  async updateCompanyWebhookConfig(id: string, data: Partial<CompanyWebhookConfig>): Promise<CompanyWebhookConfig | undefined> {
    const [r] = await db.update(companyWebhookConfigs).set({ ...data, updatedAt: new Date() }).where(eq(companyWebhookConfigs.id, id)).returning();
    return r;
  }
  async deleteCompanyWebhookConfig(id: string): Promise<void> {
    await db.delete(companyWebhookConfigs).where(eq(companyWebhookConfigs.id, id));
  }

  async getIntegrationEvents(companyId: string): Promise<IntegrationEvent[]> {
    return db.select().from(integrationEvents).where(eq(integrationEvents.companyId, companyId)).orderBy(desc(integrationEvents.createdAt));
  }
  async getIntegrationEvent(id: string): Promise<IntegrationEvent | undefined> {
    const [r] = await db.select().from(integrationEvents).where(eq(integrationEvents.id, id));
    return r;
  }
  async createIntegrationEvent(data: InsertIntegrationEvent): Promise<IntegrationEvent> {
    const [r] = await db.insert(integrationEvents).values(data).returning();
    return r;
  }
  async updateIntegrationEvent(id: string, data: Partial<IntegrationEvent>): Promise<IntegrationEvent | undefined> {
    const [r] = await db.update(integrationEvents).set(data).where(eq(integrationEvents.id, id)).returning();
    return r;
  }

  async getDeviceTokens(userId: string): Promise<DeviceToken[]> {
    return db.select().from(deviceTokens).where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.isActive, true)));
  }
  async getDeviceTokensByUsers(userIds: string[]): Promise<DeviceToken[]> {
    if (userIds.length === 0) return [];
    return db.select().from(deviceTokens).where(and(inArray(deviceTokens.userId, userIds), eq(deviceTokens.isActive, true)));
  }
  async registerDeviceToken(data: InsertDeviceToken): Promise<DeviceToken> {
    const existing = await db.select().from(deviceTokens).where(
      and(eq(deviceTokens.userId, data.userId), eq(deviceTokens.token, data.token))
    );
    if (existing.length > 0) {
      const [r] = await db.update(deviceTokens).set({ isActive: true, platform: data.platform, updatedAt: new Date() }).where(eq(deviceTokens.id, existing[0].id)).returning();
      return r;
    }
    const [r] = await db.insert(deviceTokens).values(data).returning();
    return r;
  }
  async deactivateDeviceToken(userId: string, token: string): Promise<void> {
    await db.update(deviceTokens).set({ isActive: false, updatedAt: new Date() }).where(
      and(eq(deviceTokens.userId, userId), eq(deviceTokens.token, token))
    );
  }

  // ── Trade / Non-Cash Compensation ─────────────────────────────────────────
  async getTradeTransactions(companyId: string, status?: string, year?: number): Promise<TradeTransaction[]> {
    const conditions = [eq(tradeTransactions.companyId, companyId)];
    if (status) conditions.push(eq(tradeTransactions.status, status));
    if (year) conditions.push(eq(tradeTransactions.taxYear, year));
    return db.select().from(tradeTransactions).where(and(...conditions)).orderBy(desc(tradeTransactions.createdAt));
  }
  async getTradeTransaction(id: string): Promise<TradeTransaction | undefined> {
    const [r] = await db.select().from(tradeTransactions).where(eq(tradeTransactions.id, id));
    return r;
  }
  async createTradeTransaction(data: InsertTradeTransaction): Promise<TradeTransaction> {
    const [r] = await db.insert(tradeTransactions).values(data).returning();
    return r;
  }
  async updateTradeTransaction(id: string, data: Partial<TradeTransaction>): Promise<TradeTransaction | undefined> {
    const [r] = await db.update(tradeTransactions).set({ ...data, updatedAt: new Date() }).where(eq(tradeTransactions.id, id)).returning();
    return r;
  }
  async deleteTradeTransaction(id: string): Promise<void> {
    await db.delete(tradeAuditLogs).where(eq(tradeAuditLogs.tradeTransactionId, id));
    await db.delete(tradeAttachments).where(eq(tradeAttachments.tradeTransactionId, id));
    await db.delete(tradeTransactionItems).where(eq(tradeTransactionItems.tradeTransactionId, id));
    await db.delete(tradeTransactions).where(eq(tradeTransactions.id, id));
  }
  async getTradeTransactionItems(tradeTransactionId: string): Promise<TradeTransactionItem[]> {
    return db.select().from(tradeTransactionItems).where(eq(tradeTransactionItems.tradeTransactionId, tradeTransactionId)).orderBy(tradeTransactionItems.createdAt);
  }
  async createTradeTransactionItem(data: InsertTradeTransactionItem): Promise<TradeTransactionItem> {
    const [r] = await db.insert(tradeTransactionItems).values(data).returning();
    return r;
  }
  async deleteTradeTransactionItem(id: string): Promise<void> {
    await db.delete(tradeTransactionItems).where(eq(tradeTransactionItems.id, id));
  }
  async getTradeAttachments(tradeTransactionId: string): Promise<TradeAttachment[]> {
    return db.select().from(tradeAttachments).where(eq(tradeAttachments.tradeTransactionId, tradeTransactionId)).orderBy(desc(tradeAttachments.createdAt));
  }
  async createTradeAttachment(data: InsertTradeAttachment): Promise<TradeAttachment> {
    const [r] = await db.insert(tradeAttachments).values(data).returning();
    return r;
  }
  async deleteTradeAttachment(id: string): Promise<void> {
    await db.delete(tradeAttachments).where(eq(tradeAttachments.id, id));
  }
  async getTradeAuditLogs(tradeTransactionId: string): Promise<TradeAuditLog[]> {
    return db.select().from(tradeAuditLogs).where(eq(tradeAuditLogs.tradeTransactionId, tradeTransactionId)).orderBy(desc(tradeAuditLogs.createdAt));
  }
  async createTradeAuditLog(data: InsertTradeAuditLog): Promise<TradeAuditLog> {
    const [r] = await db.insert(tradeAuditLogs).values(data).returning();
    return r;
  }
  async getTradeReportingSummary(companyId: string, year: number): Promise<{ counterpartyId: string | null; counterpartyName: string; totalFairMarketValue: string; transactionCount: number }[]> {
    const rows = await db.select().from(tradeTransactions).where(
      and(
        eq(tradeTransactions.companyId, companyId),
        eq(tradeTransactions.taxYear, year),
        eq(tradeTransactions.isReportable, true),
        inArray(tradeTransactions.status, ["approved", "completed"])
      )
    );
    const map = new Map<string, { counterpartyId: string | null; counterpartyName: string; total: number; count: number }>();
    for (const row of rows) {
      const key = row.counterpartyId || row.counterpartyName;
      const existing = map.get(key);
      if (existing) {
        existing.total += parseFloat(row.fairMarketValue);
        existing.count++;
      } else {
        map.set(key, { counterpartyId: row.counterpartyId, counterpartyName: row.counterpartyName, total: parseFloat(row.fairMarketValue), count: 1 });
      }
    }
    return Array.from(map.values()).map(v => ({ counterpartyId: v.counterpartyId, counterpartyName: v.counterpartyName, totalFairMarketValue: v.total.toFixed(2), transactionCount: v.count })).sort((a, b) => parseFloat(b.totalFairMarketValue) - parseFloat(a.totalFairMarketValue));
  }

  // ── Contractor Documents ───────────────────────────────────────────────────
  async getContractorDocuments(companyId: string, workerId?: string): Promise<ContractorDocument[]> {
    const conds = [eq(contractorDocuments.companyId, companyId)];
    if (workerId) conds.push(eq(contractorDocuments.workerId, workerId));
    return db.select().from(contractorDocuments).where(and(...conds)).orderBy(desc(contractorDocuments.createdAt));
  }
  async createContractorDocument(data: InsertContractorDocument): Promise<ContractorDocument> {
    const [r] = await db.insert(contractorDocuments).values(data).returning();
    return r;
  }
  async deleteContractorDocument(id: string): Promise<void> {
    await db.delete(contractorDocuments).where(eq(contractorDocuments.id, id));
  }

  // ── 1099 Summaries ─────────────────────────────────────────────────────────
  async get1099Summaries(companyId: string, year: number): Promise<Contractor1099Summary[]> {
    return db.select().from(contractor1099Summaries).where(and(eq(contractor1099Summaries.companyId, companyId), eq(contractor1099Summaries.taxYear, year))).orderBy(desc(contractor1099Summaries.totalCompensation));
  }
  async get1099Summary(id: string): Promise<Contractor1099Summary | undefined> {
    const [r] = await db.select().from(contractor1099Summaries).where(eq(contractor1099Summaries.id, id));
    return r;
  }
  async get1099SummaryByWorker(companyId: string, workerId: string, year: number): Promise<Contractor1099Summary | undefined> {
    const [r] = await db.select().from(contractor1099Summaries).where(and(eq(contractor1099Summaries.companyId, companyId), eq(contractor1099Summaries.workerId, workerId), eq(contractor1099Summaries.taxYear, year)));
    return r;
  }
  async upsert1099Summary(data: InsertContractor1099Summary): Promise<Contractor1099Summary> {
    const existing = await this.get1099SummaryByWorker(data.companyId, data.workerId, data.taxYear as number);
    if (existing) {
      const [r] = await db.update(contractor1099Summaries).set({ ...data, updatedAt: new Date() }).where(eq(contractor1099Summaries.id, existing.id)).returning();
      return r;
    }
    const [r] = await db.insert(contractor1099Summaries).values(data).returning();
    return r;
  }
  async update1099Summary(id: string, data: Partial<Contractor1099Summary>): Promise<Contractor1099Summary | undefined> {
    const [r] = await db.update(contractor1099Summaries).set({ ...data, updatedAt: new Date() }).where(eq(contractor1099Summaries.id, id)).returning();
    return r;
  }

  async calculate1099Summary(companyId: string, workerId: string, year: number): Promise<{ cashTotal: number; tradeTotal: number; total: number; missingW9: boolean }> {
    const invoiceRows = await db.select().from(contractorInvoices).where(
      and(
        eq(contractorInvoices.companyId, companyId),
        eq(contractorInvoices.contractorId, workerId),
        eq(contractorInvoices.is1099Reportable, true),
        eq(contractorInvoices.status, "paid")
      )
    );
    const cashTotal = invoiceRows
      .filter(inv => inv.invoiceDate && inv.invoiceDate.startsWith(String(year)))
      .reduce((sum, inv) => sum + parseFloat(inv.paidAmount || inv.amount), 0);

    const tradeRows = await db.select().from(tradeTransactions).where(
      and(
        eq(tradeTransactions.companyId, companyId),
        eq(tradeTransactions.counterpartyId, workerId),
        eq(tradeTransactions.isReportable, true),
        inArray(tradeTransactions.status, ["approved", "completed"])
      )
    );
    const tradeTotal = tradeRows
      .filter(t => t.taxYear === year)
      .reduce((sum, t) => sum + parseFloat(t.fairMarketValue), 0);

    const docs = await this.getContractorDocuments(companyId, workerId);
    const hasW9 = docs.some(d => d.documentType === "w9");

    return { cashTotal, tradeTotal, total: cashTotal + tradeTotal, missingW9: !hasW9 };
  }

  async generateAll1099Summaries(companyId: string, year: number): Promise<Contractor1099Summary[]> {
    const companyWorkers = await db.select().from(workers).where(
      and(eq(workers.companyId, companyId), eq(workers.workerType, "contractor" as any))
    );

    const results: Contractor1099Summary[] = [];
    for (const worker of companyWorkers) {
      const calc = await this.calculate1099Summary(companyId, worker.id, year);
      const summary = await this.upsert1099Summary({
        companyId,
        workerId: worker.id,
        taxYear: year,
        cashTotal: calc.cashTotal.toFixed(2),
        tradeTotal: calc.tradeTotal.toFixed(2),
        totalCompensation: calc.total.toFixed(2),
        meetsThreshold: calc.total >= 600,
        threshold: "600",
        missingW9: calc.missingW9,
        status: calc.total >= 600 ? "ready" : "draft",
        lastCalculatedAt: new Date(),
      });
      results.push(summary);
    }
    return results.sort((a, b) => parseFloat(b.totalCompensation) - parseFloat(a.totalCompensation));
  }


  // ── Platform Modules ─────────────────────────────────────────────────────
  async getPlatformModules(): Promise<PlatformModule[]> {
    return db.select().from(platformModules).orderBy(platformModules.displayOrder);
  }
  async getPlatformModule(id: string): Promise<PlatformModule | undefined> {
    const [r] = await db.select().from(platformModules).where(eq(platformModules.id, id));
    return r;
  }
  async createPlatformModule(data: InsertPlatformModule): Promise<PlatformModule> {
    const [r] = await db.insert(platformModules).values(data).returning();
    return r;
  }
  async updatePlatformModule(id: string, data: Partial<PlatformModule>): Promise<PlatformModule | undefined> {
    const [r] = await db.update(platformModules).set(data).where(eq(platformModules.id, id)).returning();
    return r;
  }

  // ── Org Hierarchy ──────────────────────────────────────────────────────────
  async getLocations(companyId?: string): Promise<Location[]> {
    if (companyId) return db.select().from(locations).where(eq(locations.companyId, companyId)).orderBy(locations.name);
    return db.select().from(locations).orderBy(locations.name);
  }
  async getLocation(id: string): Promise<Location | undefined> {
    const [r] = await db.select().from(locations).where(eq(locations.id, id));
    return r;
  }
  async createLocation(data: InsertLocation): Promise<Location> {
    const [r] = await db.insert(locations).values(data).returning();
    return r;
  }
  async updateLocation(id: string, data: Partial<Location>): Promise<Location | undefined> {
    const [r] = await db.update(locations).set(data).where(eq(locations.id, id)).returning();
    return r;
  }
  async deleteLocation(id: string): Promise<void> {
    await db.delete(locations).where(eq(locations.id, id));
  }

  async getTeams(companyId?: string): Promise<Team[]> {
    if (companyId) return db.select().from(teams).where(eq(teams.companyId, companyId)).orderBy(teams.name);
    return db.select().from(teams).orderBy(teams.name);
  }
  async getTeam(id: string): Promise<Team | undefined> {
    const [r] = await db.select().from(teams).where(eq(teams.id, id));
    return r;
  }
  async createTeam(data: InsertTeam): Promise<Team> {
    const [r] = await db.insert(teams).values(data).returning();
    return r;
  }
  async updateTeam(id: string, data: Partial<Team>): Promise<Team | undefined> {
    const [r] = await db.update(teams).set(data).where(eq(teams.id, id)).returning();
    return r;
  }
  async deleteTeam(id: string): Promise<void> {
    await db.delete(teams).where(eq(teams.id, id));
  }

  async getEmployeeManagerRelations(companyId: string, employeeId?: string): Promise<EmployeeManagerRelation[]> {
    if (employeeId) {
      return db.select().from(employeeManagerRelations)
        .where(and(eq(employeeManagerRelations.companyId, companyId), eq(employeeManagerRelations.employeeId, employeeId)));
    }
    return db.select().from(employeeManagerRelations).where(eq(employeeManagerRelations.companyId, companyId));
  }
  async getDirectReports(companyId: string, managerId: string): Promise<EmployeeManagerRelation[]> {
    return db.select().from(employeeManagerRelations)
      .where(and(
        eq(employeeManagerRelations.companyId, companyId),
        eq(employeeManagerRelations.managerId, managerId),
        eq(employeeManagerRelations.isActive, true)
      ));
  }
  async getDepartmentMembers(companyId: string, departmentId: string): Promise<Worker[]> {
    return db.select().from(workers)
      .where(and(
        eq(workers.companyId, companyId),
        eq(workers.departmentId, departmentId),
        eq(workers.isActive, true)
      ))
      .orderBy(workers.lastName, workers.firstName);
  }
  async getManagerChain(companyId: string, employeeId: string): Promise<EmployeeManagerRelation[]> {
    const chain: EmployeeManagerRelation[] = [];
    let currentId = employeeId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const [rel] = await db.select().from(employeeManagerRelations)
        .where(and(
          eq(employeeManagerRelations.companyId, companyId),
          eq(employeeManagerRelations.employeeId, currentId),
          eq(employeeManagerRelations.relationshipType, "primary"),
          eq(employeeManagerRelations.isActive, true)
        ));
      if (!rel) break;
      chain.push(rel);
      currentId = rel.managerId;
    }
    return chain;
  }
  async createEmployeeManagerRelation(data: InsertEmployeeManagerRelation): Promise<EmployeeManagerRelation> {
    const [r] = await db.insert(employeeManagerRelations).values(data).returning();
    return r;
  }
  async updateEmployeeManagerRelation(id: string, data: Partial<EmployeeManagerRelation>): Promise<EmployeeManagerRelation | undefined> {
    const [r] = await db.update(employeeManagerRelations).set(data).where(eq(employeeManagerRelations.id, id)).returning();
    return r;
  }
  async deleteEmployeeManagerRelation(id: string): Promise<void> {
    await db.delete(employeeManagerRelations).where(eq(employeeManagerRelations.id, id));
  }

  // ── Permission System ─────────────────────────────────────────────────────
  async getPermissionGroups(): Promise<PermissionGroup[]> {
    return db.select().from(permissionGroups).orderBy(permissionGroups.displayOrder, permissionGroups.name);
  }
  async createPermissionGroup(data: InsertPermissionGroup): Promise<PermissionGroup> {
    const [r] = await db.insert(permissionGroups).values(data).returning();
    return r;
  }
  async updatePermissionGroup(id: string, data: Partial<PermissionGroup>): Promise<PermissionGroup | undefined> {
    const [r] = await db.update(permissionGroups).set(data).where(eq(permissionGroups.id, id)).returning();
    return r;
  }

  async getPermissions(groupId?: string): Promise<Permission[]> {
    if (groupId) {
      return db.select().from(permissions).where(eq(permissions.permissionGroupId, groupId)).orderBy(permissions.name);
    }
    return db.select().from(permissions).orderBy(permissions.name);
  }
  async getPermission(id: string): Promise<Permission | undefined> {
    const [r] = await db.select().from(permissions).where(eq(permissions.id, id));
    return r;
  }
  async createPermission(data: InsertPermission): Promise<Permission> {
    const [r] = await db.insert(permissions).values(data).returning();
    return r;
  }
  async updatePermission(id: string, data: Partial<Permission>): Promise<Permission | undefined> {
    const [r] = await db.update(permissions).set(data).where(eq(permissions.id, id)).returning();
    return r;
  }

  async getEnterpriseRolePermissions(roleId?: string): Promise<EnterpriseRolePermission[]> {
    if (roleId) return db.select().from(enterpriseRolePermissions).where(eq(enterpriseRolePermissions.roleId, roleId));
    return db.select().from(enterpriseRolePermissions);
  }
  async createEnterpriseRolePermission(data: InsertEnterpriseRolePermission): Promise<EnterpriseRolePermission> {
    const [r] = await db.insert(enterpriseRolePermissions).values(data).returning();
    return r;
  }
  async deleteEnterpriseRolePermission(id: string): Promise<void> {
    await db.delete(enterpriseRolePermissions).where(eq(enterpriseRolePermissions.id, id));
  }
  async getEffectivePermissions(userId: string, companyId: string): Promise<{ permission: Permission; scope: string; source: string }[]> {
    const userAccessList = await db.select().from(userCompanyAccess)
      .where(and(eq(userCompanyAccess.userId, userId), eq(userCompanyAccess.companyId, companyId), eq(userCompanyAccess.isActive, true)));
    const roleIds = userAccessList.map(a => a.roleId);
    const result: { permission: Permission; scope: string; source: string }[] = [];
    if (roleIds.length > 0) {
      const rolePerms = await db.select().from(enterpriseRolePermissions)
        .where(and(inArray(enterpriseRolePermissions.roleId, roleIds), eq(enterpriseRolePermissions.isGranted, true)));
      for (const rp of rolePerms) {
        const perm = await this.getPermission(rp.permissionId);
        if (perm) result.push({ permission: perm, scope: rp.scope, source: "role" });
      }
    }
    const overrides = await db.select().from(userPermissionOverrides)
      .where(and(eq(userPermissionOverrides.userId, userId), eq(userPermissionOverrides.companyId, companyId)));
    for (const ov of overrides) {
      if (!ov.isGranted) {
        const idx = result.findIndex(r => r.permission.id === ov.permissionId);
        if (idx !== -1) result.splice(idx, 1);
      } else {
        const perm = await this.getPermission(ov.permissionId);
        if (perm) result.push({ permission: perm, scope: ov.scope, source: "override" });
      }
    }
    return result;
  }

  async getUserCompanyAccess(userId?: string, companyId?: string): Promise<UserCompanyAccess[]> {
    if (userId && companyId) {
      return db.select().from(userCompanyAccess)
        .where(and(eq(userCompanyAccess.userId, userId), eq(userCompanyAccess.companyId, companyId)));
    }
    if (userId) return db.select().from(userCompanyAccess).where(eq(userCompanyAccess.userId, userId));
    if (companyId) return db.select().from(userCompanyAccess).where(eq(userCompanyAccess.companyId, companyId));
    return db.select().from(userCompanyAccess);
  }
  async createUserCompanyAccess(data: InsertUserCompanyAccess): Promise<UserCompanyAccess> {
    const [r] = await db.insert(userCompanyAccess).values(data).returning();
    return r;
  }
  async updateUserCompanyAccess(id: string, data: Partial<UserCompanyAccess>): Promise<UserCompanyAccess | undefined> {
    const [r] = await db.update(userCompanyAccess).set(data).where(eq(userCompanyAccess.id, id)).returning();
    return r;
  }
  async deleteUserCompanyAccess(id: string): Promise<void> {
    await db.delete(userCompanyAccess).where(eq(userCompanyAccess.id, id));
  }

  async getUserPermissionOverrides(userId: string, companyId?: string): Promise<UserPermissionOverride[]> {
    if (companyId) {
      return db.select().from(userPermissionOverrides)
        .where(and(eq(userPermissionOverrides.userId, userId), eq(userPermissionOverrides.companyId, companyId)));
    }
    return db.select().from(userPermissionOverrides).where(eq(userPermissionOverrides.userId, userId));
  }
  async createUserPermissionOverride(data: InsertUserPermissionOverride): Promise<UserPermissionOverride> {
    const [r] = await db.insert(userPermissionOverrides).values(data).returning();
    return r;
  }
  async deleteUserPermissionOverride(id: string): Promise<void> {
    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.id, id));
  }

  async getAuthorizationAuditLogs(limit = 100): Promise<AuthorizationAuditLog[]> {
    return db
      .select()
      .from(authorizationAuditLog)
      .orderBy(desc(authorizationAuditLog.createdAt))
      .limit(limit);
  }

  async getAuthorizationAuditLogsFiltered(opts: {
    limit?: number;
    offset?: number;
    changeType?: string;
    companyId?: string;
    actorUserId?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ rows: AuthorizationAuditLog[]; total: number }> {
    const { sql: drizzleSql } = await import("drizzle-orm");
    const conditions: any[] = [];
    if (opts.changeType) conditions.push(eq(authorizationAuditLog.changeType, opts.changeType));
    if (opts.companyId) conditions.push(eq(authorizationAuditLog.companyId, opts.companyId));
    if (opts.actorUserId) conditions.push(eq(authorizationAuditLog.actorUserId, opts.actorUserId));
    if (opts.fromDate) conditions.push(sql`${authorizationAuditLog.createdAt} >= ${opts.fromDate}::timestamptz`);
    if (opts.toDate) conditions.push(sql`${authorizationAuditLog.createdAt} <= ${opts.toDate}::timestamptz`);

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(authorizationAuditLog)
      .where(where);
    const total = Number(countRow?.count ?? 0);

    const rows = await db
      .select()
      .from(authorizationAuditLog)
      .where(where)
      .orderBy(desc(authorizationAuditLog.createdAt))
      .limit(opts.limit ?? 50)
      .offset(opts.offset ?? 0);

    return { rows, total };
  }

  async createAuthorizationAuditLog(data: InsertAuthorizationAuditLog): Promise<AuthorizationAuditLog> {
    const [row] = await db.insert(authorizationAuditLog).values(data).returning();
    return row;
  }

  async getPayrollSummary(payrollRunId: string): Promise<PayrollSummary | undefined> {
    const [r] = await db.select().from(payrollSummaries).where(eq(payrollSummaries.payrollRunId, payrollRunId));
    return r;
  }

  async upsertPayrollSummary(payrollRunId: string, data: Partial<InsertPayrollSummary>): Promise<PayrollSummary> {
    const existing = await this.getPayrollSummary(payrollRunId);
    if (existing) {
      const [r] = await db.update(payrollSummaries).set({ ...data, updatedAt: new Date() }).where(eq(payrollSummaries.payrollRunId, payrollRunId)).returning();
      return r;
    }
    const [r] = await db.insert(payrollSummaries).values({ payrollRunId, ...data } as InsertPayrollSummary).returning();
    return r;
  }

  async getAchBatch(payrollRunId: string): Promise<AchBatch | undefined> {
    const [r] = await db.select().from(achBatches).where(eq(achBatches.payrollRunId, payrollRunId)).orderBy(desc(achBatches.createdAt));
    return r;
  }

  async getAchBatchById(id: string): Promise<AchBatch | undefined> {
    const [r] = await db.select().from(achBatches).where(eq(achBatches.id, id));
    return r;
  }

  async createAchBatch(data: InsertAchBatch): Promise<AchBatch> {
    const [r] = await db.insert(achBatches).values(data).returning();
    return r;
  }

  async updateAchBatch(id: string, data: Partial<AchBatch>): Promise<AchBatch | undefined> {
    const [r] = await db.update(achBatches).set({ ...data, updatedAt: new Date() }).where(eq(achBatches.id, id)).returning();
    return r;
  }

  async getPayrollTransactionRuns(payrollRunId: string): Promise<PayrollTransactionRun[]> {
    return db.select().from(payrollTransactionRuns).where(eq(payrollTransactionRuns.payrollRunId, payrollRunId));
  }

  async createPayrollTransactionRun(data: InsertPayrollTransactionRun): Promise<PayrollTransactionRun> {
    const [r] = await db.insert(payrollTransactionRuns).values(data).returning();
    return r;
  }

  async updatePayrollTransactionRun(id: string, data: Partial<PayrollTransactionRun>): Promise<PayrollTransactionRun | undefined> {
    const [r] = await db.update(payrollTransactionRuns).set({ ...data, updatedAt: new Date() }).where(eq(payrollTransactionRuns.id, id)).returning();
    return r;
  }

  async deletePayrollTransactionRunsByRun(payrollRunId: string): Promise<void> {
    await db.delete(payrollTransactionRuns).where(eq(payrollTransactionRuns.payrollRunId, payrollRunId));
  }

  async getTenantCommercialGates(): Promise<(TenantCommercialGate & { company: Company })[]> {
    const gates = await db.select().from(tenantCommercialGates).orderBy(desc(tenantCommercialGates.createdAt));
    const result: (TenantCommercialGate & { company: Company })[] = [];
    for (const gate of gates) {
      const [company] = await db.select().from(companies).where(eq(companies.id, gate.companyId));
      if (company) result.push({ ...gate, company });
    }
    return result;
  }

  async getTenantCommercialGate(companyId: string): Promise<TenantCommercialGate | undefined> {
    const [gate] = await db.select().from(tenantCommercialGates).where(eq(tenantCommercialGates.companyId, companyId));
    return gate;
  }

  async upsertTenantCommercialGate(companyId: string, data: Partial<InsertTenantCommercialGate>): Promise<TenantCommercialGate> {
    const existing = await this.getTenantCommercialGate(companyId);
    if (existing) {
      const [updated] = await db.update(tenantCommercialGates)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(tenantCommercialGates.companyId, companyId))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(tenantCommercialGates)
        .values({ companyId, ...data })
        .returning();
      return created;
    }
  }

  async getTenantProvisioningAuditLogs(companyId: string): Promise<TenantProvisioningAuditLog[]> {
    return db.select().from(tenantProvisioningAuditLogs)
      .where(eq(tenantProvisioningAuditLogs.companyId, companyId))
      .orderBy(desc(tenantProvisioningAuditLogs.createdAt));
  }

  async getTenantImplementationProject(companyId: string): Promise<TenantImplementationProject | undefined> {
    const [project] = await db.select().from(tenantImplementationProjects)
      .where(eq(tenantImplementationProjects.companyId, companyId));
    return project;
  }

  async updateTenantImplementationProject(id: string, data: Partial<TenantImplementationProject>): Promise<TenantImplementationProject | undefined> {
    const [updated] = await db.update(tenantImplementationProjects)
      .set(data)
      .where(eq(tenantImplementationProjects.id, id))
      .returning();
    return updated;
  }

  // ── Agreement Templates ───────────────────────────────────────────────────
  async getAgreementTemplates(companyId?: string): Promise<AgreementTemplate[]> {
    if (companyId) {
      return db.select().from(agreementTemplates)
        .where(or(eq(agreementTemplates.companyId, companyId), isNull(agreementTemplates.companyId)))
        .orderBy(desc(agreementTemplates.createdAt));
    }
    return db.select().from(agreementTemplates).orderBy(desc(agreementTemplates.createdAt));
  }
  async getAgreementTemplate(id: string): Promise<AgreementTemplate | undefined> {
    const [t] = await db.select().from(agreementTemplates).where(eq(agreementTemplates.id, id));
    return t;
  }
  async createAgreementTemplate(data: InsertAgreementTemplate): Promise<AgreementTemplate> {
    const [t] = await db.insert(agreementTemplates).values(data).returning();
    return t;
  }
  async updateAgreementTemplate(id: string, data: Partial<AgreementTemplate>): Promise<AgreementTemplate | undefined> {
    const [t] = await db.update(agreementTemplates).set({ ...data, updatedAt: new Date() }).where(eq(agreementTemplates.id, id)).returning();
    return t;
  }
  async deleteAgreementTemplate(id: string): Promise<void> {
    await db.delete(agreementTemplates).where(eq(agreementTemplates.id, id));
  }

  // ── Worker Agreements ─────────────────────────────────────────────────────
  async getWorkerAgreements(companyId: string, workerId?: string): Promise<WorkerAgreement[]> {
    if (workerId) {
      return db.select().from(workerAgreements)
        .where(and(eq(workerAgreements.companyId, companyId), eq(workerAgreements.workerId, workerId)))
        .orderBy(desc(workerAgreements.createdAt));
    }
    return db.select().from(workerAgreements).where(eq(workerAgreements.companyId, companyId)).orderBy(desc(workerAgreements.createdAt));
  }
  async getWorkerAgreement(id: string): Promise<WorkerAgreement | undefined> {
    const [a] = await db.select().from(workerAgreements).where(eq(workerAgreements.id, id));
    return a;
  }
  async createWorkerAgreement(data: InsertWorkerAgreement): Promise<WorkerAgreement> {
    const [a] = await db.insert(workerAgreements).values(data).returning();
    return a;
  }
  async updateWorkerAgreement(id: string, data: Partial<WorkerAgreement>): Promise<WorkerAgreement | undefined> {
    const [a] = await db.update(workerAgreements).set({ ...data, updatedAt: new Date() }).where(eq(workerAgreements.id, id)).returning();
    return a;
  }
  async deleteWorkerAgreement(id: string): Promise<void> {
    await db.delete(workerAgreements).where(eq(workerAgreements.id, id));
  }

  // ── Worker Onboarding ─────────────────────────────────────────────────────
  async getWorkerOnboardings(companyId: string): Promise<WorkerOnboarding[]> {
    return db.select().from(workerOnboarding).where(eq(workerOnboarding.companyId, companyId)).orderBy(desc(workerOnboarding.createdAt));
  }
  async getWorkerOnboarding(id: string): Promise<WorkerOnboarding | undefined> {
    const [o] = await db.select().from(workerOnboarding).where(eq(workerOnboarding.id, id));
    return o;
  }
  async getWorkerOnboardingByToken(tokenHash: string): Promise<WorkerOnboarding | undefined> {
    const [o] = await db.select().from(workerOnboarding).where(eq(workerOnboarding.inviteTokenHash, tokenHash));
    return o;
  }
  async createWorkerOnboarding(data: InsertWorkerOnboarding): Promise<WorkerOnboarding> {
    const [o] = await db.insert(workerOnboarding).values(data).returning();
    return o;
  }
  async updateWorkerOnboarding(id: string, data: Partial<WorkerOnboarding>): Promise<WorkerOnboarding | undefined> {
    const [o] = await db.update(workerOnboarding).set({ ...data, updatedAt: new Date() }).where(eq(workerOnboarding.id, id)).returning();
    return o;
  }
  async deleteWorkerOnboarding(id: string): Promise<void> {
    await db.delete(workerOnboarding).where(eq(workerOnboarding.id, id));
  }

  // ── Onboarding Steps ──────────────────────────────────────────────────────
  async getOnboardingSteps(onboardingId: string): Promise<OnboardingStep[]> {
    return db.select().from(onboardingSteps).where(eq(onboardingSteps.onboardingId, onboardingId)).orderBy(onboardingSteps.sequence);
  }
  async getOnboardingStep(id: string): Promise<OnboardingStep | undefined> {
    const [s] = await db.select().from(onboardingSteps).where(eq(onboardingSteps.id, id));
    return s;
  }
  async createOnboardingStep(data: InsertOnboardingStep): Promise<OnboardingStep> {
    const [s] = await db.insert(onboardingSteps).values(data).returning();
    return s;
  }
  async updateOnboardingStep(id: string, data: Partial<OnboardingStep>): Promise<OnboardingStep | undefined> {
    const [s] = await db.update(onboardingSteps).set({ ...data, updatedAt: new Date() }).where(eq(onboardingSteps.id, id)).returning();
    return s;
  }
  async bulkCreateOnboardingSteps(steps: InsertOnboardingStep[]): Promise<OnboardingStep[]> {
    if (!steps.length) return [];
    return db.insert(onboardingSteps).values(steps).returning();
  }

  // ── Worker Onboarding Documents ───────────────────────────────────────────
  async getWorkerOnboardingDocuments(onboardingId: string): Promise<WorkerOnboardingDocument[]> {
    return db.select().from(workerOnboardingDocuments).where(eq(workerOnboardingDocuments.onboardingId, onboardingId)).orderBy(desc(workerOnboardingDocuments.createdAt));
  }
  async createWorkerOnboardingDocument(data: InsertWorkerOnboardingDocument): Promise<WorkerOnboardingDocument> {
    const [d] = await db.insert(workerOnboardingDocuments).values(data).returning();
    return d;
  }
  async updateWorkerOnboardingDocument(id: string, data: Partial<WorkerOnboardingDocument>): Promise<WorkerOnboardingDocument | undefined> {
    const [d] = await db.update(workerOnboardingDocuments).set({ ...data, updatedAt: new Date() }).where(eq(workerOnboardingDocuments.id, id)).returning();
    return d;
  }

  // ── Onboarding Audit Log ──────────────────────────────────────────────────
  async getOnboardingAuditLog(onboardingId: string): Promise<OnboardingAuditLogEntry[]> {
    return db.select().from(onboardingAuditLog).where(eq(onboardingAuditLog.onboardingId, onboardingId)).orderBy(desc(onboardingAuditLog.createdAt));
  }
  async createOnboardingAuditLogEntry(data: InsertOnboardingAuditLogEntry): Promise<OnboardingAuditLogEntry> {
    const [e] = await db.insert(onboardingAuditLog).values(data).returning();
    return e;
  }

  // ── Company Branding ───────────────────────────────────────────────────────
  async getCompanyBranding(companyId: string): Promise<CompanyBranding | undefined> {
    const [b] = await db.select().from(companyBranding).where(eq(companyBranding.companyId, companyId));
    return b;
  }
  async upsertCompanyBranding(companyId: string, data: Partial<InsertCompanyBranding>): Promise<CompanyBranding> {
    const existing = await this.getCompanyBranding(companyId);
    if (existing) {
      const [b] = await db.update(companyBranding).set({ ...data, updatedAt: new Date() }).where(eq(companyBranding.companyId, companyId)).returning();
      return b;
    } else {
      const [b] = await db.insert(companyBranding).values({ ...data, companyId }).returning();
      return b;
    }
  }

  // ── Biz Document Templates ─────────────────────────────────────────────────
  async getBizDocumentTemplates(companyId?: string): Promise<BizDocumentTemplate[]> {
    if (companyId) {
      return db.select().from(bizDocumentTemplates).where(
        or(eq(bizDocumentTemplates.isSystem, true), eq(bizDocumentTemplates.companyId, companyId))
      ).orderBy(bizDocumentTemplates.name);
    }
    return db.select().from(bizDocumentTemplates).where(eq(bizDocumentTemplates.isSystem, true)).orderBy(bizDocumentTemplates.name);
  }
  async getBizDocumentTemplate(id: string): Promise<BizDocumentTemplate | undefined> {
    const [t] = await db.select().from(bizDocumentTemplates).where(eq(bizDocumentTemplates.id, id));
    return t;
  }
  async getBizDocumentTemplateBySlug(slug: string): Promise<BizDocumentTemplate | undefined> {
    const [t] = await db.select().from(bizDocumentTemplates).where(eq(bizDocumentTemplates.slug, slug));
    return t;
  }

  // ── Biz Documents ──────────────────────────────────────────────────────────
  async getBizDocuments(companyId: string, filters?: { documentType?: string; status?: string; ownerEntityId?: string }): Promise<BizDocument[]> {
    const conditions = [eq(bizDocuments.companyId, companyId)];
    if (filters?.documentType) conditions.push(eq(bizDocuments.documentType, filters.documentType));
    if (filters?.status) conditions.push(eq(bizDocuments.status, filters.status));
    if (filters?.ownerEntityId) conditions.push(eq(bizDocuments.ownerEntityId, filters.ownerEntityId));
    return db.select().from(bizDocuments).where(and(...conditions)).orderBy(desc(bizDocuments.createdAt));
  }
  async getBizDocument(id: string): Promise<BizDocument | undefined> {
    const [d] = await db.select().from(bizDocuments).where(eq(bizDocuments.id, id));
    return d;
  }
  async createBizDocument(data: InsertBizDocument): Promise<BizDocument> {
    const [d] = await db.insert(bizDocuments).values(data).returning();
    return d;
  }
  async updateBizDocument(id: string, data: Partial<BizDocument>): Promise<BizDocument | undefined> {
    const [d] = await db.update(bizDocuments).set({ ...data, updatedAt: new Date() }).where(eq(bizDocuments.id, id)).returning();
    return d;
  }
  async deleteBizDocument(id: string): Promise<void> {
    await db.delete(bizDocuments).where(eq(bizDocuments.id, id));
  }

  // ── Biz Document Items ─────────────────────────────────────────────────────
  async getBizDocumentItems(documentId: string): Promise<BizDocumentItem[]> {
    return db.select().from(bizDocumentItems).where(eq(bizDocumentItems.documentId, documentId)).orderBy(bizDocumentItems.sortOrder);
  }
  async createBizDocumentItem(data: InsertBizDocumentItem): Promise<BizDocumentItem> {
    const [i] = await db.insert(bizDocumentItems).values(data).returning();
    return i;
  }
  async updateBizDocumentItem(id: string, data: Partial<BizDocumentItem>): Promise<BizDocumentItem | undefined> {
    const [i] = await db.update(bizDocumentItems).set(data).where(eq(bizDocumentItems.id, id)).returning();
    return i;
  }
  async deleteBizDocumentItem(id: string): Promise<void> {
    await db.delete(bizDocumentItems).where(eq(bizDocumentItems.id, id));
  }
  async replaceBizDocumentItems(documentId: string, items: Omit<InsertBizDocumentItem, 'documentId'>[]): Promise<BizDocumentItem[]> {
    await db.delete(bizDocumentItems).where(eq(bizDocumentItems.documentId, documentId));
    if (!items.length) return [];
    const rows = items.map((item, idx) => ({ ...item, documentId, sortOrder: idx }));
    return db.insert(bizDocumentItems).values(rows).returning();
  }

  // ── Biz Document Attachments ───────────────────────────────────────────────
  async getBizDocumentAttachments(documentId: string): Promise<BizDocumentAttachment[]> {
    return db.select().from(bizDocumentAttachments).where(eq(bizDocumentAttachments.documentId, documentId)).orderBy(desc(bizDocumentAttachments.uploadedAt));
  }
  async createBizDocumentAttachment(data: InsertBizDocumentAttachment): Promise<BizDocumentAttachment> {
    const [a] = await db.insert(bizDocumentAttachments).values(data).returning();
    return a;
  }
  async deleteBizDocumentAttachment(id: string): Promise<void> {
    await db.delete(bizDocumentAttachments).where(eq(bizDocumentAttachments.id, id));
  }

  // ── Biz Document History ───────────────────────────────────────────────────
  async getBizDocumentHistory(documentId: string): Promise<BizDocumentHistory[]> {
    return db.select().from(bizDocumentHistory).where(eq(bizDocumentHistory.documentId, documentId)).orderBy(desc(bizDocumentHistory.changedAt));
  }
  async addBizDocumentHistory(data: InsertBizDocumentHistory): Promise<BizDocumentHistory> {
    const [h] = await db.insert(bizDocumentHistory).values(data).returning();
    return h;
  }

  // ── Treasury ──────────────────────────────────────────────────────────────
  async getTreasuryOutboundPayments(companyId: string, payrollRunId?: string): Promise<TreasuryOutboundPayment[]> {
    const conditions = [eq(treasuryOutboundPayments.companyId, companyId)];
    if (payrollRunId) conditions.push(eq(treasuryOutboundPayments.payrollRunId, payrollRunId));
    return db.select().from(treasuryOutboundPayments).where(and(...conditions)).orderBy(desc(treasuryOutboundPayments.createdAt));
  }
  async getTreasuryOutboundPaymentByStripeId(stripeId: string): Promise<TreasuryOutboundPayment | undefined> {
    const [r] = await db.select().from(treasuryOutboundPayments).where(eq(treasuryOutboundPayments.stripeOutboundPaymentId, stripeId));
    return r;
  }
  async createTreasuryOutboundPayment(data: InsertTreasuryOutboundPayment): Promise<TreasuryOutboundPayment> {
    const [r] = await db.insert(treasuryOutboundPayments).values(data).returning();
    return r;
  }
  async updateTreasuryOutboundPayment(id: string, data: Partial<TreasuryOutboundPayment>): Promise<TreasuryOutboundPayment | undefined> {
    const [r] = await db.update(treasuryOutboundPayments).set({ ...data, updatedAt: new Date() }).where(eq(treasuryOutboundPayments.id, id)).returning();
    return r;
  }

  // ── Inventory ──────────────────────────────────────────────────────────────
  async getInventoryItems(companyId: string): Promise<InventoryItem[]> {
    return db.select().from(inventoryItems).where(eq(inventoryItems.companyId, companyId)).orderBy(inventoryItems.name);
  }
  async getInventoryItem(id: string): Promise<InventoryItem | undefined> {
    const [r] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id));
    return r;
  }
  async createInventoryItem(data: InsertInventoryItem): Promise<InventoryItem> {
    const [r] = await db.insert(inventoryItems).values(data).returning();
    return r;
  }
  async updateInventoryItem(id: string, data: Partial<InventoryItem>): Promise<InventoryItem | undefined> {
    const [r] = await db.update(inventoryItems).set({ ...data, updatedAt: new Date() }).where(eq(inventoryItems.id, id)).returning();
    return r;
  }
  async deleteInventoryItem(id: string): Promise<void> {
    await db.delete(inventoryItems).where(eq(inventoryItems.id, id));
  }
  async bulkSetInventory(companyId: string, items: InsertInventoryItem[]): Promise<InventoryItem[]> {
    await db.delete(inventoryItems).where(eq(inventoryItems.companyId, companyId));
    if (!items.length) return [];
    return db.insert(inventoryItems).values(items.map(i => ({ ...i, companyId }))).returning();
  }

  // ── Weekly Labor Goals ────────────────────────────────────────────────────────
  async getWeeklyLaborGoals(companyId: string): Promise<WeeklyLaborGoal[]> {
    return db.select().from(weeklyLaborGoals).where(eq(weeklyLaborGoals.companyId, companyId)).orderBy(desc(weeklyLaborGoals.weekStart));
  }
  async getWeeklyLaborGoal(id: string): Promise<WeeklyLaborGoal | undefined> {
    const [r] = await db.select().from(weeklyLaborGoals).where(eq(weeklyLaborGoals.id, id));
    return r;
  }
  async createWeeklyLaborGoal(data: InsertWeeklyLaborGoal): Promise<WeeklyLaborGoal> {
    const [r] = await db.insert(weeklyLaborGoals).values(data).returning();
    return r;
  }
  async updateWeeklyLaborGoal(id: string, data: Partial<WeeklyLaborGoal>): Promise<WeeklyLaborGoal | undefined> {
    const [r] = await db.update(weeklyLaborGoals).set(data).where(eq(weeklyLaborGoals.id, id)).returning();
    return r;
  }
  async deleteWeeklyLaborGoal(id: string): Promise<void> {
    await db.delete(weeklyLaborGoals).where(eq(weeklyLaborGoals.id, id));
  }

  // ── Weekly Revenue Goals ──────────────────────────────────────────────────────
  async getWeeklyRevenueGoals(companyId: string): Promise<WeeklyRevenueGoal[]> {
    return db.select().from(weeklyRevenueGoals).where(eq(weeklyRevenueGoals.companyId, companyId)).orderBy(desc(weeklyRevenueGoals.weekStart));
  }
  async getWeeklyRevenueGoal(id: string): Promise<WeeklyRevenueGoal | undefined> {
    const [r] = await db.select().from(weeklyRevenueGoals).where(eq(weeklyRevenueGoals.id, id));
    return r;
  }
  async createWeeklyRevenueGoal(data: InsertWeeklyRevenueGoal): Promise<WeeklyRevenueGoal> {
    const [r] = await db.insert(weeklyRevenueGoals).values(data).returning();
    return r;
  }
  async updateWeeklyRevenueGoal(id: string, data: Partial<WeeklyRevenueGoal>): Promise<WeeklyRevenueGoal | undefined> {
    const [r] = await db.update(weeklyRevenueGoals).set(data).where(eq(weeklyRevenueGoals.id, id)).returning();
    return r;
  }
  async deleteWeeklyRevenueGoal(id: string): Promise<void> {
    await db.delete(weeklyRevenueGoals).where(eq(weeklyRevenueGoals.id, id));
  }
}

export const storage = new DatabaseStorage();
