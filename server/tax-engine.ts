/**
 * Tax Engine — server/tax-engine.ts
 *
 * Pure, deterministic tax calculation functions. No database access, no side effects.
 * All functions accept explicit inputs and return itemized TaxLine arrays.
 *
 * Federal tax data source: IRS Publication 15-T (2024)
 * California tax data source: EDD DE 44 (2024), Method B (Exact Calculation Method)
 *
 * Tax codes:
 *   fed_income_tax      – Federal income tax withholding (employee)
 *   ss_employee         – Social Security employee share (6.2%)
 *   ss_employer         – Social Security employer share (6.2%)
 *   medicare_employee   – Medicare employee share (1.45%)
 *   medicare_employer   – Medicare employer share (1.45%)
 *   additional_medicare – Additional Medicare (0.9%, employee only, high-earner)
 *   futa                – Federal Unemployment Tax (0.6%, employer only)
 *   ca_pit              – California Personal Income Tax withholding (employee)
 *   ca_sdi              – California State Disability Insurance (1.1%, employee)
 *   ca_ui               – California Unemployment Insurance (3.4%, employer)
 *   ca_ett              – California Employment Training Tax (0.1%, employer)
 */

export type FilingStatus = "single" | "married" | "head_of_household" | "married_separately";
export type PayPeriodType = "weekly" | "biweekly" | "semimonthly" | "monthly" | "quarterly" | "annual";

export interface TaxLine {
  taxCode: string;
  taxName: string;
  taxableWages: number;
  rate: number;
  amount: number;
  isEmployerPaid: boolean;
  stateCode?: string;
}

export interface TaxEngineInput {
  grossWages: number;
  preTaxDeductions: number;
  reimbursements: number;
  taxableBenefits: number;
  ytdGross: number;
  ytdFedTaxableWages: number;
  filingStatus: FilingStatus;
  w4Allowances: number;
  additionalWithholding: number;
  caFilingStatus: FilingStatus;
  caAllowances: number;
  payPeriodType: PayPeriodType;
  isContractor: boolean;
  employerCaUiRate?: number;
}

export interface TaxEngineOutput {
  lines: TaxLine[];
  employeeTaxTotal: number;
  employerTaxTotal: number;
  taxableWages: number;
  caTaxableWages: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SS_RATE = 0.062;           // 6.2%
const SS_WAGE_BASE = 168600;     // 2024
const MEDICARE_RATE = 0.0145;    // 1.45%
const ADDL_MEDICARE_RATE = 0.009; // 0.9%
const FUTA_RATE = 0.006;         // 0.6% (net of 5.4% FUTA credit)
const FUTA_WAGE_BASE = 7000;
const CA_SDI_RATE = 0.011;       // 1.1% for 2024 (no dollar cap)
const CA_UI_RATE_DEFAULT = 0.034; // 3.4% new employer rate
const CA_ETT_RATE = 0.001;       // 0.1%
const CA_UI_WAGE_BASE = 7000;
const CA_ETT_WAGE_BASE = 7000;
const FED_ALLOWANCE_VALUE = 4300; // per allowance per year, 2024
const CA_ALLOWANCE_VALUE = 4000;  // per allowance per year, 2024 DE-44

// ── Periods per year mapping ──────────────────────────────────────────────────

const PERIODS_PER_YEAR: Record<PayPeriodType, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  quarterly: 4,
  annual: 1,
};

// ── 2024 Federal Income Tax Brackets ─────────────────────────────────────────
// Source: IRS Publication 15-T (2024), Percentage Method Tables for Automated Payroll Systems
// Brackets are applied to annualized wages AFTER subtracting allowance amount.

interface Bracket { min: number; max: number; rate: number; base: number; over: number; }

const FED_BRACKETS_SINGLE: Bracket[] = [
  { min: 0,       max: 11600,   rate: 0.10, base: 0,          over: 0 },
  { min: 11600,   max: 44725,   rate: 0.12, base: 1160.00,    over: 11600 },
  { min: 44725,   max: 95375,   rate: 0.22, base: 5135.00,    over: 44725 },
  { min: 95375,   max: 182050,  rate: 0.24, base: 16279.00,   over: 95375 },
  { min: 182050,  max: 231250,  rate: 0.32, base: 37003.00,   over: 182050 },
  { min: 231250,  max: 578125,  rate: 0.35, base: 52747.00,   over: 231250 },
  { min: 578125,  max: Infinity,rate: 0.37, base: 174238.25,  over: 578125 },
];

const FED_BRACKETS_MFJ: Bracket[] = [
  { min: 0,       max: 23200,   rate: 0.10, base: 0,          over: 0 },
  { min: 23200,   max: 89450,   rate: 0.12, base: 2320.00,    over: 23200 },
  { min: 89450,   max: 190750,  rate: 0.22, base: 10294.00,   over: 89450 },
  { min: 190750,  max: 364200,  rate: 0.24, base: 32580.00,   over: 190750 },
  { min: 364200,  max: 462500,  rate: 0.32, base: 74208.00,   over: 364200 },
  { min: 462500,  max: 693750,  rate: 0.35, base: 105664.00,  over: 462500 },
  { min: 693750,  max: Infinity,rate: 0.37, base: 186601.50,  over: 693750 },
];

const FED_BRACKETS_HOH: Bracket[] = [
  { min: 0,       max: 16550,   rate: 0.10, base: 0,          over: 0 },
  { min: 16550,   max: 63100,   rate: 0.12, base: 1655.00,    over: 16550 },
  { min: 63100,   max: 100500,  rate: 0.22, base: 7241.00,    over: 63100 },
  { min: 100500,  max: 182050,  rate: 0.24, base: 15469.00,   over: 100500 },
  { min: 182050,  max: 231250,  rate: 0.32, base: 35041.00,   over: 182050 },
  { min: 231250,  max: 578100,  rate: 0.35, base: 50785.00,   over: 231250 },
  { min: 578100,  max: Infinity,rate: 0.37, base: 172228.25,  over: 578100 },
];

// ── 2024 California PIT Brackets (DE-44 Method B) ────────────────────────────
// Applied to annualized wages AFTER subtracting standard deduction + allowances.

const CA_BRACKETS_SINGLE: Bracket[] = [
  { min: 0,       max: 10412,   rate: 0.010, base: 0,         over: 0 },
  { min: 10412,   max: 24684,   rate: 0.020, base: 104.12,    over: 10412 },
  { min: 24684,   max: 38959,   rate: 0.040, base: 389.56,    over: 24684 },
  { min: 38959,   max: 54081,   rate: 0.060, base: 960.52,    over: 38959 },
  { min: 54081,   max: 68350,   rate: 0.080, base: 1867.84,   over: 54081 },
  { min: 68350,   max: 349137,  rate: 0.093, base: 2809.36,   over: 68350 },
  { min: 349137,  max: 418961,  rate: 0.103, base: 28944.47,  over: 349137 },
  { min: 418961,  max: 698274,  rate: 0.113, base: 36136.41,  over: 418961 },
  { min: 698274,  max: Infinity,rate: 0.123, base: 67696.12,  over: 698274 },
];

const CA_BRACKETS_MFJ: Bracket[] = [
  { min: 0,       max: 20824,   rate: 0.010, base: 0,         over: 0 },
  { min: 20824,   max: 49368,   rate: 0.020, base: 208.24,    over: 20824 },
  { min: 49368,   max: 77918,   rate: 0.040, base: 779.12,    over: 49368 },
  { min: 77918,   max: 108162,  rate: 0.060, base: 1921.12,   over: 77918 },
  { min: 108162,  max: 136700,  rate: 0.080, base: 3735.76,   over: 108162 },
  { min: 136700,  max: 698274,  rate: 0.093, base: 5618.80,   over: 136700 },
  { min: 698274,  max: 837922,  rate: 0.103, base: 57888.06,  over: 698274 },
  { min: 837922,  max: 1000000, rate: 0.113, base: 72270.49,  over: 837922 },
  { min: 1000000, max: Infinity,rate: 0.123, base: 90585.81,  over: 1000000 },
];

const CA_BRACKETS_HOH: Bracket[] = [
  { min: 0,       max: 20839,   rate: 0.010, base: 0,         over: 0 },
  { min: 20839,   max: 49371,   rate: 0.020, base: 208.39,    over: 20839 },
  { min: 49371,   max: 63644,   rate: 0.040, base: 779.03,    over: 49371 },
  { min: 63644,   max: 78765,   rate: 0.060, base: 1349.95,   over: 63644 },
  { min: 78765,   max: 93037,   rate: 0.080, base: 2257.21,   over: 78765 },
  { min: 93037,   max: 474824,  rate: 0.093, base: 3399.97,   over: 93037 },
  { min: 474824,  max: 569790,  rate: 0.103, base: 38892.37,  over: 474824 },
  { min: 569790,  max: 949649,  rate: 0.113, base: 48672.12,  over: 569790 },
  { min: 949649,  max: Infinity,rate: 0.123, base: 91576.60,  over: 949649 },
];

// CA standard deductions and exemption credits (DE-44 2024)
const CA_STD_DEDUCTION: Record<string, number> = {
  single: 5202,
  married_separately: 5202,
  married: 10404,
  head_of_household: 10404,
};
const CA_EXEMPTION_CREDIT: Record<string, number> = {
  single: 144,
  married_separately: 144,
  married: 288,
  head_of_household: 433,
};

// Additional Medicare thresholds (employee only)
const ADDL_MEDICARE_THRESHOLD_SINGLE = 200000;  // Single / HOH / MFS
const ADDL_MEDICARE_THRESHOLD_MFJ   = 250000;  // Married Filing Jointly

// ── Helpers ───────────────────────────────────────────────────────────────────

function applyBrackets(annualWages: number, brackets: Bracket[]): number {
  if (annualWages <= 0) return 0;
  for (const b of brackets) {
    if (annualWages <= b.max) {
      return b.base + b.rate * (annualWages - b.over);
    }
  }
  return 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function periodsFromType(type: PayPeriodType): number {
  return PERIODS_PER_YEAR[type] ?? 26;
}

// ── Individual Tax Calculators ────────────────────────────────────────────────

/**
 * Federal income tax withholding using 2024 IRS Publication 15-T
 * annualized percentage method with old-style W-4 allowances.
 */
export function calcFederalIncomeTax(
  grossWages: number,
  preTaxDeductions: number,
  filingStatus: FilingStatus,
  w4Allowances: number,
  additionalWithholding: number,
  payPeriodType: PayPeriodType,
): TaxLine {
  const periods = periodsFromType(payPeriodType);
  const taxableWages = Math.max(0, grossWages - preTaxDeductions);

  // Annualize
  const annual = taxableWages * periods;

  // Subtract allowance amount
  const allowanceReduction = w4Allowances * FED_ALLOWANCE_VALUE;
  const adjAnnual = Math.max(0, annual - allowanceReduction);

  // Select bracket table
  let brackets: Bracket[];
  if (filingStatus === "married") {
    brackets = FED_BRACKETS_MFJ;
  } else if (filingStatus === "head_of_household") {
    brackets = FED_BRACKETS_HOH;
  } else {
    brackets = FED_BRACKETS_SINGLE;
  }

  const annualTax = applyBrackets(adjAnnual, brackets);
  const perPeriodTax = annualTax / periods;
  const withAdditional = perPeriodTax + additionalWithholding;

  return {
    taxCode: "fed_income_tax",
    taxName: "Federal Income Tax",
    taxableWages: round2(taxableWages),
    rate: 0,
    amount: round2(Math.max(0, withAdditional)),
    isEmployerPaid: false,
  };
}

/**
 * Social Security — 6.2% up to $168,600 wage base.
 * Call once for employee share (isEmployer=false) and once for employer share.
 */
export function calcSocialSecurity(
  grossWages: number,
  ytdGross: number,
  isEmployer: boolean,
): TaxLine {
  const remainingBase = Math.max(0, SS_WAGE_BASE - ytdGross);
  const taxableWages = Math.min(grossWages, remainingBase);
  const amount = taxableWages * SS_RATE;

  return {
    taxCode: isEmployer ? "ss_employer" : "ss_employee",
    taxName: isEmployer ? "Social Security (Employer)" : "Social Security (Employee)",
    taxableWages: round2(taxableWages),
    rate: SS_RATE,
    amount: round2(amount),
    isEmployerPaid: isEmployer,
  };
}

/**
 * Medicare — 1.45%, no wage base cap.
 */
export function calcMedicare(grossWages: number, isEmployer: boolean): TaxLine {
  const amount = grossWages * MEDICARE_RATE;
  return {
    taxCode: isEmployer ? "medicare_employer" : "medicare_employee",
    taxName: isEmployer ? "Medicare (Employer)" : "Medicare (Employee)",
    taxableWages: round2(grossWages),
    rate: MEDICARE_RATE,
    amount: round2(amount),
    isEmployerPaid: isEmployer,
  };
}

/**
 * Additional Medicare — 0.9% employee-only on wages above threshold.
 * Threshold: $200k single/HOH/MFS, $250k MFJ.
 * Uses YTD to determine if threshold has been crossed.
 */
export function calcAdditionalMedicare(
  grossWages: number,
  ytdGross: number,
  filingStatus: FilingStatus,
): TaxLine {
  const threshold = filingStatus === "married"
    ? ADDL_MEDICARE_THRESHOLD_MFJ
    : ADDL_MEDICARE_THRESHOLD_SINGLE;

  const ytdAfter = ytdGross + grossWages;
  const ytdBefore = ytdGross;

  let taxableWages = 0;
  if (ytdAfter > threshold) {
    if (ytdBefore >= threshold) {
      taxableWages = grossWages;
    } else {
      taxableWages = ytdAfter - threshold;
    }
  }

  const amount = taxableWages * ADDL_MEDICARE_RATE;
  return {
    taxCode: "additional_medicare",
    taxName: "Additional Medicare (Employee)",
    taxableWages: round2(taxableWages),
    rate: ADDL_MEDICARE_RATE,
    amount: round2(amount),
    isEmployerPaid: false,
  };
}

/**
 * FUTA — 0.6% (net of 5.4% normal SUTA credit) up to $7,000 wage base.
 * Employer only.
 */
export function calcFUTA(grossWages: number, ytdGross: number): TaxLine {
  const remainingBase = Math.max(0, FUTA_WAGE_BASE - ytdGross);
  const taxableWages = Math.min(grossWages, remainingBase);
  const amount = taxableWages * FUTA_RATE;

  return {
    taxCode: "futa",
    taxName: "Federal Unemployment Tax (FUTA)",
    taxableWages: round2(taxableWages),
    rate: FUTA_RATE,
    amount: round2(amount),
    isEmployerPaid: true,
  };
}

/**
 * California PIT withholding using DE-44 (2024) Method B (Exact Calculation).
 * Uses annualized wages with filing-status-specific standard deduction and
 * exemption credits. CA allowance = $4,000/year (2024).
 */
export function calcCAPIT(
  grossWages: number,
  preTaxDeductions: number,
  filingStatus: FilingStatus,
  caAllowances: number,
  payPeriodType: PayPeriodType,
): TaxLine {
  const periods = periodsFromType(payPeriodType);
  const taxableWages = Math.max(0, grossWages - preTaxDeductions);

  const annual = taxableWages * periods;

  const fsKey = filingStatus === "married"
    ? "married"
    : filingStatus === "head_of_household"
      ? "head_of_household"
      : filingStatus === "married_separately"
        ? "married_separately"
        : "single";

  const stdDeduction = CA_STD_DEDUCTION[fsKey] ?? CA_STD_DEDUCTION["single"];
  const exemptionCredit = CA_EXEMPTION_CREDIT[fsKey] ?? CA_EXEMPTION_CREDIT["single"];
  const allowanceReduction = caAllowances * CA_ALLOWANCE_VALUE;

  const adjAnnual = Math.max(0, annual - stdDeduction - allowanceReduction);

  let brackets: Bracket[];
  if (fsKey === "married") {
    brackets = CA_BRACKETS_MFJ;
  } else if (fsKey === "head_of_household") {
    brackets = CA_BRACKETS_HOH;
  } else {
    brackets = CA_BRACKETS_SINGLE;
  }

  const annualTax = Math.max(0, applyBrackets(adjAnnual, brackets) - exemptionCredit);
  const perPeriodTax = annualTax / periods;

  return {
    taxCode: "ca_pit",
    taxName: "CA Personal Income Tax",
    taxableWages: round2(taxableWages),
    rate: 0,
    amount: round2(Math.max(0, perPeriodTax)),
    isEmployerPaid: false,
    stateCode: "CA",
  };
}

/**
 * California SDI — 1.1% employee share, no dollar cap for 2024.
 */
export function calcCASDI(grossWages: number): TaxLine {
  const amount = grossWages * CA_SDI_RATE;
  return {
    taxCode: "ca_sdi",
    taxName: "CA State Disability Insurance (SDI)",
    taxableWages: round2(grossWages),
    rate: CA_SDI_RATE,
    amount: round2(amount),
    isEmployerPaid: false,
    stateCode: "CA",
  };
}

/**
 * California UI — employer only, up to $7,000 wage base.
 * Rate defaults to 3.4% (new employer rate). Companies can override via employerCaUiRate.
 */
export function calcCAUI(
  grossWages: number,
  ytdGross: number,
  employerCaUiRate = CA_UI_RATE_DEFAULT,
): TaxLine {
  const remainingBase = Math.max(0, CA_UI_WAGE_BASE - ytdGross);
  const taxableWages = Math.min(grossWages, remainingBase);
  const amount = taxableWages * employerCaUiRate;

  return {
    taxCode: "ca_ui",
    taxName: "CA Unemployment Insurance (UI)",
    taxableWages: round2(taxableWages),
    rate: employerCaUiRate,
    amount: round2(amount),
    isEmployerPaid: true,
    stateCode: "CA",
  };
}

/**
 * California ETT — 0.1% employer only, up to $7,000 wage base.
 */
export function calcCAETT(grossWages: number, ytdGross: number): TaxLine {
  const remainingBase = Math.max(0, CA_ETT_WAGE_BASE - ytdGross);
  const taxableWages = Math.min(grossWages, remainingBase);
  const amount = taxableWages * CA_ETT_RATE;

  return {
    taxCode: "ca_ett",
    taxName: "CA Employment Training Tax (ETT)",
    taxableWages: round2(taxableWages),
    rate: CA_ETT_RATE,
    amount: round2(amount),
    isEmployerPaid: true,
    stateCode: "CA",
  };
}

// ── Wage adjustment helpers ───────────────────────────────────────────────────

/**
 * Pre-tax deductions reduce taxable wages before bracket calculation.
 * Post-tax deductions only reduce net pay — not taxable wages.
 */
export function sumPreTaxDeductions(
  deductions: Array<{ amount: number; deductionTiming: string | null }>
): number {
  return deductions
    .filter(d => d.deductionTiming === "pre_tax")
    .reduce((s, d) => s + d.amount, 0);
}

/**
 * Reimbursements are non-taxable — they do not affect taxable wages.
 * They pass through as gross pay additions but are excluded from tax bases.
 */
export function adjustForReimbursements(grossWages: number, reimbursements: number): number {
  return Math.max(0, grossWages - reimbursements);
}

/**
 * Taxable benefits (e.g. imputed income for group-term life over $50K)
 * are added to taxable wages before withholding.
 */
export function adjustForTaxableBenefits(taxableWages: number, benefits: number): number {
  return taxableWages + benefits;
}

// ── Main Engine Entry Point ───────────────────────────────────────────────────

/**
 * Calculate all taxes for one worker in one pay period.
 * Returns an array of TaxLine objects plus summary totals.
 *
 * isCA: When true, California state taxes are calculated.
 *       When false (e.g. non-CA workers), only federal taxes are returned.
 */
export function calcAllTaxes(input: TaxEngineInput, isCA = true): TaxEngineOutput {
  const {
    grossWages,
    preTaxDeductions,
    reimbursements,
    taxableBenefits,
    ytdGross,
    filingStatus,
    w4Allowances,
    additionalWithholding,
    caFilingStatus,
    caAllowances,
    payPeriodType,
    isContractor,
    employerCaUiRate,
  } = input;

  // Contractors don't have employer/employee taxes withheld
  if (isContractor) {
    return { lines: [], employeeTaxTotal: 0, employerTaxTotal: 0, taxableWages: grossWages, caTaxableWages: grossWages };
  }

  // Reimbursements and taxable benefits adjust the taxable wage base
  const taxableBase = adjustForTaxableBenefits(
    adjustForReimbursements(grossWages, reimbursements),
    taxableBenefits,
  );

  const lines: TaxLine[] = [];

  // ── Federal taxes ──────────────────────────────────────────────────────────
  const fedIT = calcFederalIncomeTax(
    taxableBase, preTaxDeductions, filingStatus, w4Allowances, additionalWithholding, payPeriodType,
  );
  lines.push(fedIT);

  const ssEmployee = calcSocialSecurity(taxableBase, ytdGross, false);
  lines.push(ssEmployee);

  const ssEmployer = calcSocialSecurity(taxableBase, ytdGross, true);
  lines.push(ssEmployer);

  const medicareEmployee = calcMedicare(taxableBase, false);
  lines.push(medicareEmployee);

  const medicareEmployer = calcMedicare(taxableBase, true);
  lines.push(medicareEmployer);

  const addlMedicare = calcAdditionalMedicare(taxableBase, ytdGross, filingStatus);
  lines.push(addlMedicare);

  const futa = calcFUTA(taxableBase, ytdGross);
  lines.push(futa);

  // ── California state taxes ─────────────────────────────────────────────────
  if (isCA) {
    const caPit = calcCAPIT(taxableBase, preTaxDeductions, caFilingStatus, caAllowances, payPeriodType);
    lines.push(caPit);

    const caSdi = calcCASDI(taxableBase);
    lines.push(caSdi);

    const caUi = calcCAUI(taxableBase, ytdGross, employerCaUiRate);
    lines.push(caUi);

    const caEtt = calcCAETT(taxableBase, ytdGross);
    lines.push(caEtt);
  }

  const employeeTaxTotal = round2(
    lines.filter(l => !l.isEmployerPaid).reduce((s, l) => s + l.amount, 0)
  );
  const employerTaxTotal = round2(
    lines.filter(l => l.isEmployerPaid).reduce((s, l) => s + l.amount, 0)
  );

  return {
    lines,
    employeeTaxTotal,
    employerTaxTotal,
    taxableWages: round2(taxableBase),
    caTaxableWages: round2(taxableBase),
  };
}

// ── Utility: sum a specific tax code from a set of lines ─────────────────────

export function sumTaxCode(lines: TaxLine[], taxCode: string): number {
  return round2(lines.filter(l => l.taxCode === taxCode).reduce((s, l) => s + l.amount, 0));
}

// ── Engine version string ─────────────────────────────────────────────────────
export const TAX_ENGINE_VERSION = "1.0.0";

// ── Period helpers (exported for route use) ───────────────────────────────────

export function payPeriodTypeFromSchedule(
  scheduleType: string | null | undefined,
): PayPeriodType {
  const t = (scheduleType || "").toLowerCase();
  if (t === "weekly") return "weekly";
  if (t === "biweekly" || t === "bi_weekly") return "biweekly";
  if (t === "semimonthly" || t === "semi_monthly") return "semimonthly";
  if (t === "monthly") return "monthly";
  return "biweekly";
}
