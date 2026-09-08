/**
 * Release A — contractor payment statement separation + check-config static checks.
 *
 * Run: npx tsx tests/contractor-payment-statement-static.test.ts
 *
 * Guards the canonical server check renderer (server/routes.ts renderCheckPdf):
 *   - contractor statements carry the exact heading + nonemployee disclaimer
 *   - no employee wage terminology / self-employment-tax estimate on contractor output
 *   - no hard-coded "Paid" payment status
 *   - contractor Zone 2/3 is a real branch, not an employee render painted over
 *   - the full per-element check-face position offset set is configurable
 *   - MICR / fractional builders come from the shared ./check-micr module
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

console.log("=== contractor payment statement / check config (static) ===\n");

// -- exact heading + disclaimer -------------------------------------------
ok("exact contractor heading constant present",
  routes.includes('"CONTRACTOR PAYMENT STATEMENT — NONEMPLOYEE COMPENSATION"'));
ok("nonemployee disclaimer present",
  routes.includes('"Not an employee wage statement. No payroll taxes were withheld."'));
ok("statementLabel uses the contractor heading constant",
  /statementLabel\s*=\s*isContractor\s*\?\s*CONTRACTOR_STATEMENT_HEADING/.test(routes));
ok("companyCopyHeading uses the contractor heading constant",
  /companyCopyHeading\s*=\s*isContractor\s*\?\s*CONTRACTOR_STATEMENT_HEADING/.test(routes));

// -- no self-employment-tax estimate on contractor output ---------------
ok("no 'SELF-EMPLOYMENT TAX REFERENCE' block remains",
  !routes.includes("SELF-EMPLOYMENT TAX REFERENCE"));
ok("no 'Total SE Tax' / 15.3% estimate remains",
  !routes.includes("Total SE Tax") && !routes.includes("Total SE Tax 15.3%"));
ok("no contractor self-employment-tax note line remains",
  !routes.includes("responsible for self-employment tax (15.3%"));
ok("no ssSE / medSE / totSE self-employment tax math in renderer",
  !/const ssSEcur\s*=/.test(routes) && !/totSEcur\s*=\s*grossPay\s*\*\s*0\.153/.test(routes));

// -- no hard-coded "Paid" ----------------------------------------------
ok("no hard-coded 'Payment Status: Paid'",
  !routes.includes("Payment Status: Paid") && !routes.includes("`Payment Status: Paid`"));
ok("no ' • Paid' proof-of-payment suffix",
  !routes.includes(" • Paid`") && !routes.includes("• Total $${fmtMoney(totalCompensation)} • Paid"));

// -- contractor branch is real, not an overlay ------------------------
ok("Zone 3 dispatches contractor as its own branch",
  routes.includes("} else if (isContractor) {") &&
  routes.includes("ZONE 3 — CONTRACTOR PAYMENT STATEMENT"));
ok("Zone 2 renders the contractor stub instead of the employee paystub",
  /if \(!params\.vendorCheck && isContractor\) \{\s*\n\s*\/\/ Contractor payment statement/.test(routes) ||
  routes.includes("if (!params.vendorCheck && isContractor) {"));
ok("no white overlay rectangle over the contractor company-copy area",
  !routes.includes("Replace only contractor company-copy content in the existing Zone 3 area"));
ok("contractor statement shows payer / contractor / method / date fields",
  routes.includes("`Payer: ${coName}`") &&
  routes.includes("Payment Method: ${contractorPaymentMethod}") &&
  routes.includes("Payment Date: ${payDate}"));

// -- employee wage statement untouched --------------------------------
ok("employee earnings statement banner unchanged",
  routes.includes("EMPLOYEE EARNINGS STATEMENT — DETACH BEFORE CASHING"));
ok("employee withholding math still present (contractor guard, not deletion)",
  routes.includes("fedWithholding: !isContractor ? gross * fedRate : 0"));

// -- per-element check-face position offsets --------------------------
for (const key of ["printableArea", "date", "amountInWords", "numericAmount", "memo", "signature", "payee", "recipientAddress", "micr"]) {
  ok(`layout offset '${key}' is configurable via checkLayoutCalibration`,
    routes.includes(`elOffXY("${key}")`));
}
ok("company logo / bank logo / fractional routing / sender address offsets retained",
  routes.includes("companyLogoOffX") && routes.includes("bankLogoOffX") &&
  routes.includes("fractionalRoutingOffX") && routes.includes("checkFaceSenderOffX"));
ok("per-element offsets are clamped to the check-face limit",
  routes.includes("clampCheckFaceOffsetPt(o.x)") && routes.includes("clampCheckFaceOffsetPt(o.y)"));
ok("printableArea offset feeds the global gOL/gOT shift",
  routes.includes("+ printableAreaOffset.y") && routes.includes("+ printableAreaOffset.x"));
ok("MICR draw applies the micr offset",
  routes.includes("z1x(0.50) + micrOffset.x") && routes.includes("z1y(3.38) + micrOffset.y"));

// -- MICR builder sourced from shared module --------------------------
ok("MICR + fractional builders imported from ./check-micr",
  routes.includes('from "./check-micr"') &&
  routes.includes("buildMicrString") && routes.includes("buildFractionalRouting"));
ok("no inline buildMicrStr / buildFractionalRouting function definitions remain",
  !/function buildMicrStr\(/.test(routes) && !/function buildFractionalRouting\(/.test(routes));

// -- sensitive-data logging ------------------------------------------
ok("MICR source string is no longer logged (even redacted)",
  !routes.includes("MICR source string (redacted)") &&
  !routes.includes('micrString.replace(/\\d(?=\\d{4})/g'));
ok("logo embed failure logs the error class only, not the URL/path",
  routes.includes("Logo image embed failed (${cls})") &&
  !routes.includes('"[CHECK_PDF] Logo image embed failed (using text fallback):", imageErr'));
ok("purge unlink failure logs the error code only, not the file path",
  !routes.includes('"[PURGE] file_unlink_failed:", filePath'));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
