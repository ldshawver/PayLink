/**
 * Payroll Calculator Regression Tests
 *
 * Uses Node.js built-in assert module — no test framework required.
 * Run with:  npx tsx server/payroll-calculator.test.ts
 *
 * Exit code 0 = all tests pass.
 * Exit code 1 = one or more tests failed.
 */

import assert from "node:assert/strict";
import { calculateWorkerPay, calculateHourlyWorkerPay, type CalcTimeEntry, type CalcWorker } from "./payroll-calculator.js";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

function near(a: number, b: number, msg?: string) {
  assert.ok(Math.abs(a - b) < 0.01, `${msg ?? ""} expected ${b} got ${a}`);
}

// ── Helper factories ──────────────────────────────────────────────────────────

function hourlyWorker(id = "w1", rate = 20): CalcWorker {
  return { id, payType: "hourly", payRate: rate };
}

function salaryWorker(id = "w1", annual = 52000): CalcWorker {
  return { id, payType: "salary", payRate: annual };
}

function entry(
  workerId: string,
  total: number,
  ot = 0,
  dt = 0,
  cat = "regular",
  override?: number,
  tips?: number
): CalcTimeEntry {
  return {
    workerId,
    totalHours: total,
    overtimeHours: ot,
    doubleTimeHours: dt,
    payCategory: cat,
    overridePayRate: override ?? null,
    tipsAmount: tips ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 1 — regular
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[1] regular");

test("regular hours pay = hours × rate", () => {
  const r = calculateWorkerPay(hourlyWorker("w1", 20), [entry("w1", 40)]);
  near(r.regularHours, 40);
  near(r.regularPay, 800);
  near(r.grossPay, 800);
});

test("regular: zero hours → zero pay", () => {
  const r = calculateWorkerPay(hourlyWorker("w1", 25), []);
  near(r.grossPay, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 2 — overtime
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[2] overtime");

test("overtime pay = OT hrs × rate × 1.5", () => {
  const r = calculateWorkerPay(
    hourlyWorker("w1", 20),
    [entry("w1", 45, 5)] // 40 regular + 5 OT
  );
  near(r.regularHours, 40);
  near(r.overtimeHours, 5);
  near(r.regularPay, 800);
  near(r.overtimePay, 150); // 5 × 20 × 1.5
  near(r.grossPay, 950);
});

test("overtime: custom multiplier applied", () => {
  const r = calculateWorkerPay(
    hourlyWorker("w1", 20),
    [entry("w1", 42, 2)],
    { overtimeMultiplier: 2.0 }
  );
  near(r.overtimePay, 80); // 2 × 20 × 2.0
});

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 3 — double_time
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[3] double_time");

test("double-time pay = DT hrs × rate × 2.0", () => {
  const r = calculateWorkerPay(
    hourlyWorker("w1", 20),
    [entry("w1", 48, 8, 4)] // 36 reg + 8 OT + 4 DT (capped: 40-ot-dt logic)
  );
  // reg = 48 - 8 - 4 = 36; ot = 8; dt = 4
  near(r.regularHours, 36);
  near(r.overtimeHours, 8);
  near(r.doubleTimeHours, 4);
  near(r.doubleTimePay, 160); // 4 × 20 × 2.0
});

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 4 — commission_hours
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[4] commission_hours");

test("commission_hours: NEVER inflates regularHours", () => {
  const entries: CalcTimeEntry[] = [
    entry("w1", 40),                    // 40 regular
    entry("w1", 5, 0, 0, "commission_hours"), // 5 commission hrs
  ];
  const r = calculateWorkerPay(hourlyWorker("w1", 20), entries);
  near(r.regularHours, 40, "regularHours");
  near(r.commissionHours, 5, "commissionHours");
  near(r.regularPay, 800, "regularPay");
  near(r.commissionHourlyPay, 100, "commissionHourlyPay"); // 5 × 20
  near(r.grossPay, 900, "grossPay");
});

test("commission_hours with override rate", () => {
  const entries: CalcTimeEntry[] = [
    entry("w1", 40),
    { workerId: "w1", totalHours: 4, overtimeHours: 0, payCategory: "commission_hours", overridePayRate: 30 },
  ];
  const r = calculateWorkerPay(hourlyWorker("w1", 20), entries);
  near(r.commissionHourlyPay, 120); // 4 × 30
});

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 5 — commission_pay
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[5] commission_pay");

test("commission_pay from additions is included in grossPay", () => {
  const r = calculateWorkerPay(
    hourlyWorker("w1", 20),
    [entry("w1", 40)],
    { commissionPay: 500 }
  );
  near(r.commissionPay, 500);
  near(r.grossPay, 800 + 500);
});

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 6 — salary
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[6] salary");

test("salary base = annualSalary / periodsPerYear", () => {
  const r = calculateWorkerPay(
    salaryWorker("w1", 52000),
    [],
    { periodsPerYear: 26 }
  );
  near(r.salaryPay, 2000); // 52000 / 26
  near(r.grossPay, 2000);
  near(r.regularPay, 0);   // salary workers don't use regularPay
});

test("salary with OT add-on", () => {
  // $52000/yr → $25/hr equiv, 5 OT hrs at 1.5×
  const r = calculateWorkerPay(
    salaryWorker("w1", 52000),
    [entry("w1", 45, 5)],
    { periodsPerYear: 26, overtimeMultiplier: 1.5 }
  );
  // hourlyEquiv = 52000 / 2080 = 25; otPay = 5 × 25 × 1.5 = 187.50
  near(r.salaryPay, 2000);
  near(r.overtimePay, 187.5);
  near(r.grossPay, 2187.5);
});

test("salary: different periodsPerYear (semi-monthly = 24)", () => {
  const r = calculateWorkerPay(
    salaryWorker("w1", 60000),
    [],
    { periodsPerYear: 24 }
  );
  near(r.salaryPay, 2500); // 60000 / 24
});

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 7 — bonus
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[7] bonus");

test("bonus included in grossPay for hourly worker", () => {
  const r = calculateWorkerPay(
    hourlyWorker("w1", 20),
    [entry("w1", 40)],
    { bonusPay: 250 }
  );
  near(r.bonusPay, 250);
  near(r.grossPay, 800 + 250);
});

test("bonus included in grossPay for salary worker", () => {
  const r = calculateWorkerPay(
    salaryWorker("w1", 52000),
    [],
    { periodsPerYear: 26, bonusPay: 1000 }
  );
  near(r.bonusPay, 1000);
  near(r.grossPay, 2000 + 1000);
});

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 8 — tips
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[8] tips");

test("tips from time entry tipsAmount", () => {
  const e: CalcTimeEntry = { workerId: "w1", totalHours: 8, overtimeHours: 0, tipsAmount: 120 };
  const r = calculateWorkerPay(hourlyWorker("w1", 15), [e]);
  near(r.tipsPay, 120);
  near(r.grossPay, 120 + 120); // 8hrs×15 + 120 tips
});

test("tips from additions.tipsPay overrides entry sum", () => {
  const e: CalcTimeEntry = { workerId: "w1", totalHours: 8, overtimeHours: 0, tipsAmount: 100 };
  const r = calculateWorkerPay(hourlyWorker("w1", 15), [e], { tipsPay: 200 });
  near(r.tipsPay, 200); // override wins
});

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 9 — reimbursements
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[9] reimbursements");

test("reimbursements are NOT included in grossPay", () => {
  const r = calculateWorkerPay(
    hourlyWorker("w1", 20),
    [entry("w1", 40)],
    { reimburseAmount: 150 }
  );
  near(r.reimburseAmount, 150);
  near(r.grossPay, 800); // reimbursements are non-taxable pass-through
});

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 10 — PTO
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[10] PTO");

test("PTO hours generate pay for hourly worker", () => {
  const entries: CalcTimeEntry[] = [
    entry("w1", 32),                     // 32 regular
    entry("w1", 8, 0, 0, "pto"),          // 8 PTO
  ];
  const r = calculateWorkerPay(hourlyWorker("w1", 20), entries);
  near(r.ptoHours, 8);
  near(r.ptoPay, 160); // 8 × 20
  near(r.grossPay, 32 * 20 + 160);
});

test("PTO does NOT count toward OT threshold", () => {
  // 40 regular + 8 PTO = 48 total hours, but OT threshold is on regular only
  const entries: CalcTimeEntry[] = [
    entry("w1", 40),
    entry("w1", 8, 0, 0, "pto"),
  ];
  const r = calculateWorkerPay(hourlyWorker("w1", 20), entries);
  near(r.regularHours, 40);
  near(r.overtimeHours, 0);   // PTO hours don't trigger OT
  near(r.ptoHours, 8);
});

test("PTO hours tracked but no extra pay for salary worker", () => {
  const entries: CalcTimeEntry[] = [
    entry("w1", 32),
    entry("w1", 8, 0, 0, "pto"),
  ];
  const r = calculateWorkerPay(salaryWorker("w1", 52000), entries, { periodsPerYear: 26 });
  near(r.ptoHours, 8);
  near(r.ptoPay, 0);           // salary worker: no incremental PTO pay
  near(r.salaryPay, 2000);     // full salary still paid
});

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 11 — sick
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[11] sick");

test("sick hours generate pay for hourly worker", () => {
  const entries: CalcTimeEntry[] = [
    entry("w1", 38),
    entry("w1", 2, 0, 0, "sick"),
  ];
  const r = calculateWorkerPay(hourlyWorker("w1", 20), entries);
  near(r.sickHours, 2);
  near(r.sickPay, 40); // 2 × 20
  near(r.grossPay, 38 * 20 + 40);
});

test("sick hours tracked only for salary worker", () => {
  const r = calculateWorkerPay(
    salaryWorker("w1", 52000),
    [entry("w1", 3, 0, 0, "sick")],
    { periodsPerYear: 26 }
  );
  near(r.sickHours, 3);
  near(r.sickPay, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 12 — holiday
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[12] holiday");

test("holiday hours generate pay for hourly worker", () => {
  const entries: CalcTimeEntry[] = [
    entry("w1", 32),
    entry("w1", 8, 0, 0, "holiday"),
  ];
  const r = calculateWorkerPay(hourlyWorker("w1", 20), entries);
  near(r.holidayHours, 8);
  near(r.holidayPay, 160);
  near(r.grossPay, 32 * 20 + 160);
});

test("holiday hours tracked only for salary worker", () => {
  const r = calculateWorkerPay(
    salaryWorker("w1", 52000),
    [entry("w1", 8, 0, 0, "holiday")],
    { periodsPerYear: 26 }
  );
  near(r.holidayHours, 8);
  near(r.holidayPay, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 13 — unpaid
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[13] unpaid");

test("unpaid hours tracked, no pay for hourly worker", () => {
  const r = calculateWorkerPay(
    hourlyWorker("w1", 20),
    [entry("w1", 4, 0, 0, "unpaid")],
  );
  near(r.unpaidHours, 4);
  near(r.grossPay, 0); // hourly: no hours = no pay
});

test("unpaid hours deducted from salary worker gross", () => {
  // $52000/yr → $25/hr equiv, 8 unpaid hours → deduct 8 × 25 = 200
  const r = calculateWorkerPay(
    salaryWorker("w1", 52000),
    [entry("w1", 8, 0, 0, "unpaid")],
    { periodsPerYear: 26 }
  );
  near(r.unpaidHours, 8);
  near(r.unpaidDeduction, 200); // 8 × (52000/2080)
  near(r.grossPay, 2000 - 200);
});

test("salary unpaid: gross never goes below zero", () => {
  // Extreme case: more unpaid hours than salary covers
  const r = calculateWorkerPay(
    salaryWorker("w1", 1000),
    [entry("w1", 1000, 0, 0, "unpaid")],
    { periodsPerYear: 52 }
  );
  near(r.grossPay, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 14 — special_event
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[14] special_event");

test("special_event hours × rate included in grossPay", () => {
  const entries: CalcTimeEntry[] = [
    entry("w1", 40),
    entry("w1", 4, 0, 0, "special_event"),
  ];
  const r = calculateWorkerPay(hourlyWorker("w1", 20), entries);
  near(r.specialEventHours, 4);
  near(r.specialEventPay, 80);  // 4 × 20
  near(r.grossPay, 800 + 80);
});

test("special_event: override rate applied", () => {
  const entries: CalcTimeEntry[] = [
    { workerId: "w1", totalHours: 3, overtimeHours: 0, payCategory: "special_event", overridePayRate: 50 },
  ];
  const r = calculateWorkerPay(hourlyWorker("w1", 20), entries);
  near(r.specialEventPay, 150); // 3 × 50
});

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 15 — volunteer
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[15] volunteer");

test("volunteer hours tracked, no pay generated", () => {
  const r = calculateWorkerPay(
    hourlyWorker("w1", 20),
    [entry("w1", 8, 0, 0, "volunteer")],
  );
  near(r.volunteerHours, 8);
  near(r.grossPay, 0); // volunteer = no pay
});

// ─────────────────────────────────────────────────────────────────────────────
// WAGE GROUPS
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[WG] wage groups");

test("wage group overrides default rate", () => {
  const entries: CalcTimeEntry[] = [
    { workerId: "w1", totalHours: 8, overtimeHours: 0, wageGroupId: "wg1" },
  ];
  const r = calculateWorkerPay(hourlyWorker("w1", 20), entries, {
    wageGroups: { wg1: { hourlyRate: 30, overtimeRate: 0 } },
  });
  near(r.regularPay, 240); // 8 × 30 (not 8 × 20)
});

test("wage group OT rate used when > 0", () => {
  const entries: CalcTimeEntry[] = [
    { workerId: "w1", totalHours: 45, overtimeHours: 5, wageGroupId: "wg1" },
  ];
  const r = calculateWorkerPay(hourlyWorker("w1", 20), entries, {
    wageGroups: { wg1: { hourlyRate: 30, overtimeRate: 40 } },
  });
  near(r.overtimePay, 200); // 5 × 40 (explicit OT rate, not 30 × 1.5)
});

test("per-entry override rate takes precedence over wage group and default", () => {
  const entries: CalcTimeEntry[] = [
    { workerId: "w1", totalHours: 8, overtimeHours: 0, overridePayRate: 99, wageGroupId: "wg1" },
  ];
  const r = calculateWorkerPay(hourlyWorker("w1", 20), entries, {
    wageGroups: { wg1: { hourlyRate: 30, overtimeRate: 0 } },
  });
  near(r.regularPay, 792); // 8 × 99
});

// ─────────────────────────────────────────────────────────────────────────────
// EARNING ADJUSTMENTS (amendment pass-through)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ADJ] earning adjustments");

test("earningAdjustments added to grossPay", () => {
  const r = calculateWorkerPay(
    hourlyWorker("w1", 20),
    [entry("w1", 40)],
    { earningAdjustments: 100 }
  );
  near(r.grossPay, 800 + 100);
});

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-CATEGORY COMBINATION
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[COMBO] multi-category combination");

test("all categories combined (hourly worker)", () => {
  const entries: CalcTimeEntry[] = [
    entry("w1", 40, 0, 0, "regular"),          // 40 reg
    entry("w1", 5, 5, 0, "overtime"),           // 5 OT (already counted as OT in entry)
    entry("w1", 3, 0, 0, "commission_hours"),   // 3 comm hrs
    entry("w1", 8, 0, 0, "pto"),               // 8 PTO
    entry("w1", 4, 0, 0, "sick"),              // 4 sick
    entry("w1", 8, 0, 0, "holiday"),           // 8 holiday
    entry("w1", 2, 0, 0, "volunteer"),         // 2 volunteer
    entry("w1", 3, 0, 0, "special_event"),     // 3 special event
    { workerId: "w1", totalHours: 2, overtimeHours: 0, payCategory: "unpaid" }, // 2 unpaid
  ];

  const r = calculateWorkerPay(hourlyWorker("w1", 20), entries, {
    commissionPay: 300,
    bonusPay: 150,
    tipsPay: 80,
    reimburseAmount: 200,  // non-taxable, excluded from grossPay
    earningAdjustments: 50,
  });

  near(r.regularHours, 40);       // only regular entry
  near(r.overtimeHours, 5);
  near(r.commissionHours, 3);
  near(r.volunteerHours, 2);
  near(r.specialEventHours, 3);
  near(r.ptoHours, 8);
  near(r.sickHours, 4);
  near(r.holidayHours, 8);
  near(r.unpaidHours, 2);

  near(r.regularPay, 800);           // 40 × 20
  near(r.overtimePay, 150);          // 5 × 20 × 1.5
  near(r.commissionHourlyPay, 60);   // 3 × 20
  near(r.specialEventPay, 60);       // 3 × 20
  near(r.ptoPay, 160);               // 8 × 20
  near(r.sickPay, 80);               // 4 × 20
  near(r.holidayPay, 160);           // 8 × 20
  near(r.volunteerHours, 2);
  near(r.commissionPay, 300);
  near(r.bonusPay, 150);
  near(r.tipsPay, 80);
  near(r.reimburseAmount, 200);

  const expectedGross =
    800   // regular
    + 150 // OT
    + 60  // commission_hours
    + 60  // special_event
    + 160 // PTO
    + 80  // sick
    + 160 // holiday
    + 300 // commission_pay
    + 150 // bonus
    + 80  // tips
    + 50; // earningAdj
  near(r.grossPay, expectedGross);
  // Reimbursements NOT in gross
  assert.ok(Math.abs(r.grossPay - (expectedGross + 200)) > 0.01, "reimburse must not be in grossPay");
});

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-COMPANY YTD ISOLATION
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[MC] multi-company isolation");

test("same person working at two companies produces independent results", () => {
  // Person P works at Company A as worker W_A and Company B as worker W_B.
  // Pay calculations must be completely independent.
  const workerA: CalcWorker = { id: "wA", payType: "hourly", payRate: 20 };
  const workerB: CalcWorker = { id: "wB", payType: "salary", payRate: 60000 };

  const entriesA: CalcTimeEntry[] = [entry("wA", 40, 8)]; // 32 reg + 8 OT
  const entriesB: CalcTimeEntry[] = [];

  const resultA = calculateWorkerPay(workerA, entriesA);
  const resultB = calculateWorkerPay(workerB, entriesB, { periodsPerYear: 26 });

  // Company A: hourly with OT
  near(resultA.regularPay, 640);  // 32 × 20
  near(resultA.overtimePay, 240); // 8 × 20 × 1.5
  near(resultA.grossPay, 880);

  // Company B: salary only
  near(resultB.salaryPay, 2307.69, "company B salary");
  near(resultB.grossPay, 2307.69, "company B gross");

  // Verify results are completely independent
  assert.notEqual(resultA.grossPay, resultB.grossPay);
  assert.equal(resultA.salaryPay, 0);
  assert.equal(resultB.regularPay, 0);
});

test("worker entries are scoped: only entries matching worker.id are used", () => {
  // If two workers' entries are accidentally mixed, each calculator call
  // must only process its own worker's entries.
  const entries: CalcTimeEntry[] = [
    entry("wA", 40),  // belongs to worker A
    entry("wB", 30),  // belongs to worker B
  ];
  const rA = calculateWorkerPay({ id: "wA", payType: "hourly", payRate: 20 }, entries);
  const rB = calculateWorkerPay({ id: "wB", payType: "hourly", payRate: 25 }, entries);

  near(rA.regularHours, 40);
  near(rA.grossPay, 800);

  near(rB.regularHours, 30);
  near(rB.grossPay, 750);
});

// ─────────────────────────────────────────────────────────────────────────────
// BACKWARD COMPAT: calculateHourlyWorkerPay still works
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[COMPAT] backward compatibility");

test("deprecated calculateHourlyWorkerPay still returns correct results", () => {
  const r = calculateHourlyWorkerPay(
    hourlyWorker("w1", 20),
    [entry("w1", 40, 5)],
    { overtimeMultiplier: 1.5 }
  );
  near(r.regularPay, 700); // 35 × 20
  near(r.overtimePay, 150); // 5 × 30
  near(r.grossPay, 850);
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`  Tests passed: ${passed}`);
console.log(`  Tests failed: ${failed}`);
console.log(`${"─".repeat(60)}\n`);

if (failed > 0) {
  process.exit(1);
}
