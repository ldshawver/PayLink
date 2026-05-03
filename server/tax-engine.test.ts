/**
 * Tax Engine Tests — server/tax-engine.test.ts
 *
 * Run with: npx tsx server/tax-engine.test.ts
 *
 * Tests cover: standard employee, Additional Medicare threshold crossing,
 * Social Security wage-base cap mid-year, contractor pass-through,
 * pre-tax 401k deduction reducing federal taxable wages,
 * CA PIT by filing status, FUTA wage-base exhaustion.
 */

import {
  calcFederalIncomeTax,
  calcSocialSecurity,
  calcMedicare,
  calcAdditionalMedicare,
  calcFUTA,
  calcCAPIT,
  calcCASDI,
  calcCAUI,
  calcCAETT,
  calcAllTaxes,
  sumTaxCode,
  sumPreTaxDeductions,
  adjustForReimbursements,
  adjustForTaxableBenefits,
  type TaxEngineInput,
} from "./tax-engine.js";

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assertClose(label: string, actual: number, expected: number, tolerance = 0.02) {
  if (Math.abs(actual - expected) <= tolerance) {
    console.log(`  ✓ ${label}: ${actual}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}: expected ${expected}, got ${actual} (diff=${(actual - expected).toFixed(4)})`);
    failed++;
  }
}

function assertEqual<T>(label: string, actual: T, expected: T) {
  if (actual === expected) {
    console.log(`  ✓ ${label}: ${actual}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}: expected ${expected}, got ${actual}`);
    failed++;
  }
}

function group(name: string, fn: () => void) {
  console.log(`\n── ${name} ──`);
  fn();
}

// ── Test Cases ────────────────────────────────────────────────────────────────

group("Federal Income Tax — biweekly single, $2,000 gross, 0 allowances", () => {
  const line = calcFederalIncomeTax(2000, 0, "single", 0, 0, "biweekly");
  // Annualized: 2000 * 26 = 52,000
  // Progressive brackets: 10% on $11,600=$1,160; 12% on $33,125=$3,975; 22% on $7,275=$1,600.50
  // Annual total = $6,735.50 / 26 = $259.06
  assertClose("amount", line.amount, 259.06, 1.00);
  assertEqual("taxCode", line.taxCode, "fed_income_tax");
  assertEqual("isEmployerPaid", line.isEmployerPaid, false);
  assertClose("taxableWages", line.taxableWages, 2000);
});

group("Federal Income Tax — married filing jointly, $3,000 gross, 2 allowances", () => {
  const line = calcFederalIncomeTax(3000, 0, "married", 2, 0, "biweekly");
  // Annualized: 3000 * 26 = 78,000; allowances: 2 * 4300 = 8600 → adj 69,400
  // 12% bracket: base=2320, rate=12% on (69400-23200)=46200 → tax=7864 / 26 = 302.46
  assertClose("amount", line.amount, 302.46, 1.00);
  assertEqual("taxCode", line.taxCode, "fed_income_tax");
});

group("Federal Income Tax — pre-tax 401k reduces taxable wages", () => {
  const grossWages = 3000;
  const preTaxDeductions = 300; // 401k contribution
  const line = calcFederalIncomeTax(grossWages, preTaxDeductions, "single", 0, 0, "biweekly");
  assertClose("taxableWages", line.taxableWages, 2700);
  // Annualized: 2700 * 26 = 70200; 22% bracket: base=5135, rate=22% on (70200-44725)=25475 → 10739.5/26=413.06
  assertClose("amount", line.amount, 413.06, 1.00);
});

group("Social Security — standard, no prior YTD", () => {
  const employeeLine = calcSocialSecurity(3000, 0, false);
  const employerLine = calcSocialSecurity(3000, 0, true);
  assertClose("employee amount", employeeLine.amount, 3000 * 0.062); // 186.00
  assertClose("employer amount", employerLine.amount, 3000 * 0.062); // 186.00
  assertEqual("employee taxCode", employeeLine.taxCode, "ss_employee");
  assertEqual("employer taxCode", employerLine.taxCode, "ss_employer");
  assertClose("taxableWages", employeeLine.taxableWages, 3000);
});

group("Social Security — wage base cap mid-year (YTD near $168,600)", () => {
  // YTD = 167,000; current gross = 3,000 → only $1,600 subject to SS
  const line = calcSocialSecurity(3000, 167000, false);
  assertClose("taxableWages (capped)", line.taxableWages, 1600, 0.01);
  assertClose("amount", line.amount, 1600 * 0.062, 0.01); // 99.20
});

group("Social Security — wage base fully exhausted", () => {
  // YTD >= 168,600 → no more SS tax
  const line = calcSocialSecurity(3000, 170000, false);
  assertEqual("taxableWages", line.taxableWages, 0);
  assertEqual("amount", line.amount, 0);
});

group("Medicare — no cap", () => {
  const line = calcMedicare(5000, false);
  assertClose("amount", line.amount, 5000 * 0.0145); // 72.50
  assertEqual("isEmployerPaid", line.isEmployerPaid, false);
});

group("Additional Medicare — threshold not yet crossed", () => {
  // Single threshold $200K; YTD=150K, gross=10K → still below threshold
  const line = calcAdditionalMedicare(10000, 150000, "single");
  assertEqual("amount", line.amount, 0);
  assertEqual("taxableWages", line.taxableWages, 0);
});

group("Additional Medicare — threshold crossed this period", () => {
  // Single threshold $200K; YTD=195K, gross=10K → 5K crosses threshold
  const line = calcAdditionalMedicare(10000, 195000, "single");
  assertClose("taxableWages", line.taxableWages, 5000, 0.01);
  assertClose("amount", line.amount, 5000 * 0.009, 0.01); // 45.00
});

group("Additional Medicare — already above threshold", () => {
  // Single; YTD=210K, gross=5K → all 5K subject
  const line = calcAdditionalMedicare(5000, 210000, "single");
  assertClose("taxableWages", line.taxableWages, 5000, 0.01);
  assertClose("amount", line.amount, 5000 * 0.009, 0.01); // 45.00
});

group("Additional Medicare — MFJ higher threshold ($250K)", () => {
  // MFJ; YTD=248K, gross=5K → 3K crosses threshold
  const line = calcAdditionalMedicare(5000, 248000, "married");
  assertClose("taxableWages", line.taxableWages, 3000, 0.01);
  assertClose("amount", line.amount, 3000 * 0.009, 0.01); // 27.00
});

group("FUTA — standard new employer rate (0.6%)", () => {
  const line = calcFUTA(3000, 0);
  assertClose("taxableWages", line.taxableWages, 3000, 0.01); // under $7K
  assertClose("amount", line.amount, 3000 * 0.006, 0.01); // 18.00
  assertEqual("isEmployerPaid", line.isEmployerPaid, true);
});

group("FUTA — wage base exhaustion", () => {
  // YTD = 6,500; gross = 1,000 → only 500 subject to FUTA
  const line = calcFUTA(1000, 6500);
  assertClose("taxableWages", line.taxableWages, 500, 0.01);
  assertClose("amount", line.amount, 500 * 0.006, 0.01); // 3.00
});

group("FUTA — fully exhausted", () => {
  const line = calcFUTA(3000, 8000);
  assertEqual("taxableWages", line.taxableWages, 0);
  assertEqual("amount", line.amount, 0);
});

group("CA PIT — single filer, $2,000 gross", () => {
  const line = calcCAPIT(2000, 0, "single", 0, "biweekly");
  // Annualized: 52,000 - std deduction 5,202 = 46,798
  // CA bracket: 6th bracket (8% on 54,081-68,350): 46,798 < 54,081, so 6th bracket (8%)
  // Actually: bracket [38959-54081]: base=960.52, rate=6% on (46798-38959)=7839 → tax = 960.52 + 470.34 = 1430.86
  // Minus exemption credit 144 → 1286.86 / 26 = 49.50
  assertClose("amount", line.amount, 49.50, 2.00);
  assertEqual("taxCode", line.taxCode, "ca_pit");
  assertEqual("stateCode", line.stateCode, "CA");
  assertEqual("isEmployerPaid", line.isEmployerPaid, false);
});

group("CA PIT — married (HOH) vs single produces different amounts", () => {
  const single = calcCAPIT(3000, 0, "single", 0, "biweekly");
  const hoh = calcCAPIT(3000, 0, "head_of_household", 0, "biweekly");
  const married = calcCAPIT(3000, 0, "married", 0, "biweekly");
  // Married/HOH should have lower withholding than single at same income
  if (married.amount < single.amount) {
    console.log(`  ✓ married (${married.amount}) < single (${single.amount})`);
    passed++;
  } else {
    console.error(`  ✗ married (${married.amount}) should be < single (${single.amount})`);
    failed++;
  }
  if (hoh.amount < single.amount) {
    console.log(`  ✓ HOH (${hoh.amount}) < single (${single.amount})`);
    passed++;
  } else {
    console.error(`  ✗ HOH (${hoh.amount}) should be < single (${single.amount})`);
    failed++;
  }
});

group("CA SDI — 1.1% no cap", () => {
  const line = calcCASDI(5000);
  assertClose("amount", line.amount, 5000 * 0.011); // 55.00
  assertEqual("taxCode", line.taxCode, "ca_sdi");
  assertEqual("stateCode", line.stateCode, "CA");
});

group("CA UI — employer, wage base cap", () => {
  const line = calcCAUI(3000, 5000);
  // Remaining base: 7000-5000=2000; min(3000,2000)=2000
  assertClose("taxableWages", line.taxableWages, 2000, 0.01);
  assertClose("amount", line.amount, 2000 * 0.034, 0.01); // 68.00
  assertEqual("isEmployerPaid", line.isEmployerPaid, true);
});

group("CA ETT — employer, wage base cap", () => {
  const line = calcCAETT(3000, 7000);
  // YTD already at cap → 0
  assertEqual("taxableWages", line.taxableWages, 0);
  assertEqual("amount", line.amount, 0);
});

group("Contractor pass-through — calcAllTaxes returns empty lines", () => {
  const input: TaxEngineInput = {
    grossWages: 5000,
    preTaxDeductions: 0,
    reimbursements: 0,
    taxableBenefits: 0,
    ytdGross: 0,
    ytdFedTaxableWages: 0,
    filingStatus: "single",
    w4Allowances: 0,
    additionalWithholding: 0,
    caFilingStatus: "single",
    caAllowances: 0,
    payPeriodType: "biweekly",
    isContractor: true,
  };
  const result = calcAllTaxes(input, true);
  assertEqual("lines length (contractor)", result.lines.length, 0);
  assertEqual("employeeTaxTotal", result.employeeTaxTotal, 0);
  assertEqual("employerTaxTotal", result.employerTaxTotal, 0);
});

group("calcAllTaxes — standard employee, all federal + CA lines present", () => {
  const input: TaxEngineInput = {
    grossWages: 3000,
    preTaxDeductions: 300,
    reimbursements: 0,
    taxableBenefits: 0,
    ytdGross: 0,
    ytdFedTaxableWages: 0,
    filingStatus: "single",
    w4Allowances: 0,
    additionalWithholding: 0,
    caFilingStatus: "single",
    caAllowances: 0,
    payPeriodType: "biweekly",
    isContractor: false,
  };
  const result = calcAllTaxes(input, true);
  const expectedCodes = ["fed_income_tax", "ss_employee", "ss_employer", "medicare_employee", "medicare_employer", "additional_medicare", "futa", "ca_pit", "ca_sdi", "ca_ui", "ca_ett"];
  for (const code of expectedCodes) {
    const line = result.lines.find(l => l.taxCode === code);
    if (line) {
      console.log(`  ✓ ${code}: $${line.amount}`);
      passed++;
    } else {
      console.error(`  ✗ Missing tax code: ${code}`);
      failed++;
    }
  }
  // Employee total = sum of non-employer lines
  const empTotal = result.lines.filter(l => !l.isEmployerPaid).reduce((s, l) => s + l.amount, 0);
  assertClose("employeeTaxTotal", result.employeeTaxTotal, empTotal);
  // Employer total
  const erTotal = result.lines.filter(l => l.isEmployerPaid).reduce((s, l) => s + l.amount, 0);
  assertClose("employerTaxTotal", result.employerTaxTotal, erTotal);
});

group("calcAllTaxes — Additional Medicare threshold crossing", () => {
  const input: TaxEngineInput = {
    grossWages: 10000,
    preTaxDeductions: 0,
    reimbursements: 0,
    taxableBenefits: 0,
    ytdGross: 195000,
    ytdFedTaxableWages: 195000,
    filingStatus: "single",
    w4Allowances: 0,
    additionalWithholding: 0,
    caFilingStatus: "single",
    caAllowances: 0,
    payPeriodType: "biweekly",
    isContractor: false,
  };
  const result = calcAllTaxes(input, false); // no CA
  const addlMedicare = sumTaxCode(result.lines, "additional_medicare");
  assertClose("additional_medicare amount", addlMedicare, 5000 * 0.009, 0.01); // 5K above $200K threshold
});

group("sumPreTaxDeductions — correctly sums pre_tax only", () => {
  const deductions = [
    { amount: 300, deductionTiming: "pre_tax" },
    { amount: 200, deductionTiming: "post_tax" },
    { amount: 100, deductionTiming: "pre_tax" },
    { amount: 50, deductionTiming: null },
  ];
  const total = sumPreTaxDeductions(deductions);
  assertEqual("pre-tax total", total, 400);
});

group("adjustForReimbursements — subtracts from taxable wages", () => {
  const result = adjustForReimbursements(3000, 150);
  assertEqual("result", result, 2850);
});

group("adjustForTaxableBenefits — adds to taxable wages", () => {
  const result = adjustForTaxableBenefits(3000, 500);
  assertEqual("result", result, 3500);
});

group("sumTaxCode utility", () => {
  const input: TaxEngineInput = {
    grossWages: 4000, preTaxDeductions: 0, reimbursements: 0, taxableBenefits: 0,
    ytdGross: 0, ytdFedTaxableWages: 0, filingStatus: "single", w4Allowances: 0,
    additionalWithholding: 0, caFilingStatus: "single", caAllowances: 0,
    payPeriodType: "biweekly", isContractor: false,
  };
  const result = calcAllTaxes(input, false);
  const ssTaxEmployee = sumTaxCode(result.lines, "ss_employee");
  assertClose("ss_employee via sumTaxCode", ssTaxEmployee, 4000 * 0.062, 0.01);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"=".repeat(50)}`);
console.log(`Passed: ${passed}  Failed: ${failed}  Total: ${passed + failed}`);
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("\nAll tests passed ✓");
}
