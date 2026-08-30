import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const check_micr = fs.readFileSync("server/check-micr.ts", "utf8");
const gitignore = fs.readFileSync(".gitignore", "utf8");
const audit = fs.readFileSync("artifacts/check-pdf-audit/AUDIT.md", "utf8");

assert(routes.includes('type CheckStockMode = "preprinted" | "blank_security"'), "checkStockMode is explicit");
assert(routes.includes('cfg.checkStockMode === "blank_security" ? "blank_security" : "preprinted"'), "existing tenants default to preprinted stock");
assert(routes.includes("const fractionalRoutingDefaultDownIn = 0.125"), "fractional routing group has a safe downward default offset");
assert(routes.includes("Number(cfg.fractionalRoutingOffsetY ?? fractionalRoutingDefaultDownIn)"), "fractionalRoutingOffsetY is configurable per company/template");
assert(routes.includes('normalizedBankName === "bank of america"'), "Bank of America vector fallback is gated by normalized bank name");
assert(routes.includes('cfg.bankLogoUrl || cfg.bankLogo?.url'), "tenant-uploaded bank logo takes precedence");
assert(routes.includes('cfg.bankAddress || (remittanceSource as any)?.bankAddress || ""'), "bank address comes from configuration/remittance source only");
assert(routes.includes('allowBuiltInAdikenLogo'), "Adiken fallback logo is explicit and tenant-gated");
assert(routes.includes('Company Copy - Employee Paystub'), "employee company copy heading is classification-specific");
assert(routes.includes('"CONTRACTOR PAYMENT STATEMENT — NONEMPLOYEE COMPENSATION"'), "contractor statement carries the exact nonemployee-compensation heading");
assert(routes.includes('"Not an employee wage statement. No payroll taxes were withheld."'), "contractor statement carries the nonemployee disclaimer");
assert(routes.includes('CONTRACTOR_STATEMENT_HEADING} — DETACH AND RETAIN'), "detachable contractor copy carries the exact heading");
assert(routes.includes('EMPLOYEE EARNINGS STATEMENT — DETACH BEFORE CASHING'), "employee earnings statement heading is present");
assert(!routes.includes('SELF-EMPLOYMENT TAX REFERENCE') && !routes.includes('Total SE Tax'), "contractor statement carries no self-employment-tax estimate");
assert(!routes.includes('Payment Status: Paid'), "contractor statement does not hard-code a Paid status");
assert(check_micr.includes('const T = "c"; // ⑆ transit') && check_micr.includes('const O = "d"; // ⑈ on-us'), "MICR uses E-13B transit/on-us glyph mapping (server/check-micr.ts)");
assert(routes.includes('from "./check-micr"'), "renderer imports the shared MICR builder");
assert(!check_micr.includes('return `${auxOnUs}  ='), "MICR source does not use literal equals separators");
assert(gitignore.includes('artifacts/check-pdf-audit/*') && gitignore.includes('!artifacts/check-pdf-audit/AUDIT.md'), "audit binaries are ignored while AUDIT.md is kept");
assert(audit.includes('/tmp/paylink-check-audit/'), "audit file documents out-of-git artifact location");
assert(audit.includes('612 x 792 PDF points'), "audit documents page dimensions");

console.log("PASS: check PDF rendering audit/source-only artifact checks passed");
