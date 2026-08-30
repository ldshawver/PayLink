/**
 * Release A — the browser check preview must not carry a second, contradictory
 * check/paystub renderer.
 *
 * Run: npx tsx tests/print-check-dead-renderer-removed-static.test.ts
 *
 * The authoritative renderer is the server PDF (GET /api/checks/:id/pdf). The
 * page renders that PDF in an <iframe>; the old React check-face / paystub
 * components (with their own MICR builder, "PAY STUB" label and a contractor
 * self-employment-tax estimate) are removed so they can't regress.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync("client/src/pages/print-check.tsx", "utf8");

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
};

console.log("=== print-check.tsx dead renderer removed (static) ===\n");

ok("preview renders the server PDF via an iframe",
  src.includes('src={`/api/checks/${item.id}/pdf?preview=1`}'));
ok("comment still records the server PDF as the sole authoritative artifact",
  src.includes("server PDF is the sole authoritative print artifact") ||
  src.includes("Server PDF is the authoritative preview"));

for (const gone of [
  "function CompanyHeader(",
  "function MicrLine(",
  "function CheckPortion(",
  "function StubSummarySection(",
  "function StubDetailSection(",
  "function StubPortion(",
  "function StandardCheck(",
  "function VoucherCheck(",
  "function ThreePartCheck(",
  "function GuidedCheckFace(",
  "function computeCheckNetPay(",
  "function numberToWords(",
  "function buildMicrString(",
  "interface CheckProps",
  "const CheckComponent =",
]) {
  ok(`removed: ${gone}`, !src.includes(gone));
}

ok("no client-side E-13B MICR character mapping remains",
  !src.includes("'c' = ⑆ transit") && !src.includes('buildMicrString(routing'));
ok("no hard-coded 'PAY STUB' heading remains",
  !src.includes("PAY STUB —") && !src.includes('"PAY STUB"') && !src.includes("PAY STUB — {company.name}"));
ok("no client-side self-employment-tax estimate remains",
  !src.includes("ssTaxCurrent") && !src.includes("totalSeTaxCurrent") && !src.includes("SS_WAGE_BASE"));

// surviving pieces still present
for (const kept of [
  "function PayrollPacketSummaryPage(",
  "function CheckValidationErrorCard(",
  "function CalibrationPanel(",
  "function CheckDiagnosticsPanel(",
  "export default function PrintCheckPage(",
  "function fmt(",
]) {
  ok(`kept: ${kept}`, src.includes(kept));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
