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
// v2.2.7: the hand-drawn "Bank of America" vector rectangle was replaced by a
// real, repo-committed logo asset (public/images/bank-logos/) embedded from
// disk — never a synthetic vector substitute, never fetched over the network.
assert(routes.includes("const BANK_LOGO_ASSETS: Record<string, string> = {"), "recognized bank brands map to a real bundled logo asset");
assert(routes.includes('"bank of america": "bank-of-america.png"'), "Bank of America maps to the approved bundled asset");
assert(routes.includes("function loadBundledBankLogoBytes("), "bundled bank logo is loaded from disk, never fetched remotely");
assert(!routes.includes('page.drawText("Bank of America", { x: bx + 5'), "no hand-drawn vector substitute for a real bank logo remains");
assert(routes.includes('cfg.bankLogoUrl || cfg.bankLogo?.url'), "tenant-uploaded bank logo takes precedence");
assert(routes.includes('cfg.bankAddress || (remittanceSource as any)?.bankAddress || ""'), "bank address comes from configuration/remittance source only");
// v2.2.7: the Adiken-only hard-coded vector logo escape hatch was removed
// entirely — no tenant, Adiken included, gets a synthetic logo fallback.
assert(!routes.includes("allowBuiltInAdikenLogo") && !routes.includes("isAdikenTenant"), "no tenant-specific hard-coded logo fallback remains");
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
