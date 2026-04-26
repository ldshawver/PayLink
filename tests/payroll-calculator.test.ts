/**
 * Payroll Calculator — Unit Tests
 *
 * Run: npx tsx tests/payroll-calculator.test.ts
 *
 * CRITICAL CASE: Phillip Graves, Adiken Inc., period 2026-04-05 to 2026-04-11
 *
 *   Entry 1: 2026-04-09, payCategory = "regular",          totalHours = 4.72
 *   Entry 2: 2026-04-11, payCategory = "commission_hours", totalHours = 5.00
 *   Hourly rate: $20.00
 *
 *   Expected:
 *     regularHours      = 4.72
 *     commissionHours   = 5.00
 *     regularPay        = 94.40   (4.72 × $20)
 *     commissionHrlyPay = 100.00  (5.00 × $20)
 *     grossPay          = 194.40
 *
 *   commission_hours must NEVER inflate regularHours or regularPay.
 *   If payCategory is null/undefined, the entry must still be treated as
 *   "regular" — it must NOT silently count as commission_hours.
 */

import { calculateHourlyWorkerPay } from "../server/payroll-calculator.js";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function eq(
  name: string,
  actual: number,
  expected: number,
  tolerance = 0.001
) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    console.log(`  ✓ ${name}: ${actual}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}: expected ${expected}, got ${actual}`);
    failed++;
    failures.push(`${name}: expected ${expected}, got ${actual}`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const PHIL_ID   = "worker-phil";
const BASE_RATE = 20;

const PHIL: Parameters<typeof calculateHourlyWorkerPay>[0] = {
  id:       PHIL_ID,
  payType:  "hourly",
  payRate:  String(BASE_RATE),
};

// ── Test 1: Core case — commission_hours must not become regular pay ──────────
console.log("\nTest 1: commission_hours do NOT inflate regularHours or regularPay");
{
  const entries = [
    {
      workerId:      PHIL_ID,
      totalHours:    "4.72",
      overtimeHours: "0",
      doubleTimeHours: "0",
      payCategory:   "regular",
    },
    {
      workerId:      PHIL_ID,
      totalHours:    "5.00",
      overtimeHours: "0",
      doubleTimeHours: "0",
      payCategory:   "commission_hours",
    },
  ];

  const r = calculateHourlyWorkerPay(PHIL, entries);

  eq("regularHours",      r.regularHours,      4.72);
  eq("commissionHours",   r.commissionHours,   5.00);
  eq("regularPay",        r.regularPay,        94.40);
  eq("commissionHrlyPay", r.commissionHourlyPay, 100.00);
  eq("grossPay",          r.grossPay,          194.40);
  // Explicit safety checks
  eq("overtimeHours is 0", r.overtimeHours, 0);
  eq("regularHours is NOT 9.72 (would indicate commission counted as regular)",
     r.regularHours, 4.72);
}

// ── Test 2: null payCategory defaults to "regular" (not commission) ──────────
console.log("\nTest 2: null payCategory falls back to regular, not commission_hours");
{
  const entries = [
    {
      workerId:      PHIL_ID,
      totalHours:    "4.72",
      overtimeHours: "0",
      doubleTimeHours: "0",
      payCategory:   null,   // missing column → null
    },
  ];

  const r = calculateHourlyWorkerPay(PHIL, entries);

  eq("regularHours (null cat → regular)", r.regularHours, 4.72);
  eq("commissionHours (null cat → 0)",    r.commissionHours, 0);
  eq("regularPay (null cat → 94.40)",     r.regularPay, 94.40);
}

// ── Test 3: Only regular entry — no commission at all ────────────────────────
console.log("\nTest 3: pure regular entry");
{
  const entries = [
    {
      workerId:      PHIL_ID,
      totalHours:    "8.00",
      overtimeHours: "0",
      doubleTimeHours: "0",
      payCategory:   "regular",
    },
  ];

  const r = calculateHourlyWorkerPay(PHIL, entries);

  eq("regularHours",    r.regularHours,    8.00);
  eq("commissionHours", r.commissionHours, 0);
  eq("regularPay",      r.regularPay,      160.00);
  eq("grossPay",        r.grossPay,        160.00);
}

// ── Test 4: commission_hours with overridePayRate ────────────────────────────
console.log("\nTest 4: commission_hours with overridePayRate=$25");
{
  const entries = [
    {
      workerId:        PHIL_ID,
      totalHours:      "3.00",
      overtimeHours:   "0",
      doubleTimeHours: "0",
      payCategory:     "commission_hours",
      overridePayRate: "25",
    },
  ];

  const r = calculateHourlyWorkerPay(PHIL, entries);

  eq("regularHours (comm only → 0)",   r.regularHours,       0);
  eq("commissionHours",                r.commissionHours,    3.00);
  eq("regularPay (comm only → 0)",     r.regularPay,         0);
  eq("commissionHrlyPay (3×25=75)",    r.commissionHourlyPay, 75.00);
  eq("grossPay",                       r.grossPay,           75.00);
}

// ── Test 5: Overtime entry is NOT commission ──────────────────────────────────
console.log("\nTest 5: overtime entry stays in regular wage bucket");
{
  const entries = [
    {
      workerId:        PHIL_ID,
      totalHours:      "10.00",
      overtimeHours:   "2.00",
      doubleTimeHours: "0",
      payCategory:     "regular",
    },
  ];

  const r = calculateHourlyWorkerPay(PHIL, entries);

  eq("regularHours",  r.regularHours,  8.00);
  eq("overtimeHours", r.overtimeHours, 2.00);
  eq("regularPay (8×20=160)", r.regularPay, 160.00);
  eq("overtimePay (2×30=60)", r.overtimePay, 60.00);
  eq("grossPay",      r.grossPay,      220.00);
  eq("commissionHours stays 0", r.commissionHours, 0);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.error("\nFAILURES:");
  failures.forEach(f => console.error(`  • ${f}`));
  process.exit(1);
} else {
  console.log("All tests passed ✓");
  process.exit(0);
}
