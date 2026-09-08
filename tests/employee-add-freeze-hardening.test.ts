/**
 * Employee-add freeze hardening.
 *
 * A user reported the MyPayLink web app freezing when adding an employee. The
 * add-employee code path has no render loop of its own, but two throw-in-render
 * paths inside the Add/Edit Employee modal (which had no local error boundary)
 * would unmount the whole app shell and read as a freeze:
 *
 *   1. a lookup query resolving to a NON-ARRAY body -> `.map is not a function`
 *   2. a lookup row with a blank/null `id` -> Radix `<Select.Item value="">` throw
 *
 * plus a server path that loaded every worker in every tenant to pick the next
 * employee number (`storage.getWorkers()` with no company scope, then
 * `Math.max(...arr)` — a RangeError risk on a large set).
 *
 * This file pairs REAL behavioural coverage of the pure guards with static
 * wiring checks that the client and server actually use them.
 *
 * Run: npx tsx tests/employee-add-freeze-hardening.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { asList, selectableOptions } from "../client/src/lib/employee-lookup-guards";

let pass = 0;
let fail = 0;
function ok(name: string, result: boolean, detail?: string) {
  if (result) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ── asList: never hand a non-array to `.map()` ──────────────────────────────
console.log("asList");
ok("passes an array through unchanged", (() => { const a = [1, 2]; return asList(a) === a; })());
ok("turns an error-object body into []", Array.isArray(asList({ message: "Forbidden" })) && asList({ message: "x" }).length === 0);
ok("turns a { rows: [...] } envelope into []", asList({ rows: [{ id: "a" }] }).length === 0);
ok("turns null / undefined into []", asList(null).length === 0 && asList(undefined).length === 0);
ok("turns a string into []", asList("[]").length === 0);

// ── selectableOptions: only real string ids reach <SelectItem value> ────────
console.log("\nselectableOptions");
{
  const rows = [
    { id: "c1", name: "Alpha" },
    { id: "", name: "blank id" },
    { id: null, name: "null id" },
    { id: undefined, name: "missing id" },
    { id: 42, name: "numeric id" },
    null,
    { id: "c2", name: "Bravo" },
  ];
  const out = selectableOptions<{ id: string; name: string }>(rows);
  ok("drops blank / null / undefined / numeric ids and null entries", out.length === 2, JSON.stringify(out));
  ok("keeps the valid rows in order", out[0].id === "c1" && out[1].id === "c2");
  ok("every surviving id is a non-empty string", out.every(o => typeof o.id === "string" && o.id.length > 0));
}
ok("non-array input yields []", selectableOptions({ message: "err" }).length === 0);

// ── client wiring: employee.tsx actually uses the guards + a local boundary ─
console.log("\nclient wiring (client/src/pages/employee.tsx)");
const emp = fs.readFileSync("client/src/pages/employee.tsx", "utf8");
ok("imports the guards", /import \{ asList, selectableOptions \} from "@\/lib\/employee-lookup-guards"/.test(emp));
ok("workers list goes through asList", /const workers = asList<Worker>\(workersQuery\.data\)/.test(emp));
for (const q of ["companiesQuery", "branchesQuery", "departmentsQuery", "titlesQuery", "groupsQuery", "policyGroupsQuery", "payPeriodSchedulesQuery"]) {
  ok(`${q} feeds selectableOptions`, new RegExp(`selectableOptions<[A-Za-z]+>\\(${q}\\.data\\)`).test(emp));
}
{
  // The EmployeeTab block (the Add/Edit dialog) must not fall back to the raw
  // `Query.data || []` pattern for its Select sources. Other tab components in
  // this file are out of scope for this hotfix.
  const tab = emp.slice(emp.indexOf("function EmployeeTab()"), emp.indexOf("function EmployeeContactsTab()"));
  ok("EmployeeTab uses no raw `Query.data || []` for a Select source",
    !/const (companies|branches|deptList|titlesList|groupsList|policyGroupsList|payPeriodSchedulesList) = [a-zA-Z]+Query\.data \|\| \[\];/.test(tab));
}
ok("defines EmployeeDialogBoundary", /class EmployeeDialogBoundary extends Component/.test(emp));
ok("wraps the Add Employee form in the boundary",
  /<EmployeeDialogBoundary onClose=\{[^}]*setAddOpen\(false\)[\s\S]*?renderForm\(false\)[\s\S]*?<\/EmployeeDialogBoundary>/.test(emp));
ok("wraps the Edit Employee form in the boundary",
  /<EmployeeDialogBoundary onClose=\{[^}]*setEditOpen\(false\)[\s\S]*?renderForm\(true\)[\s\S]*?<\/EmployeeDialogBoundary>/.test(emp));
ok("the boundary exposes a working Close control", /data-testid="button-employee-dialog-error-close"/.test(emp));

// ── server wiring: employee-number generation is company-scoped ─────────────
console.log("\nserver wiring (server/routes.ts — POST /api/workers)");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const postWorkers = routes.slice(routes.indexOf('app.post("/api/workers"'), routes.indexOf('app.patch("/api/workers/:id"'));
ok("employee-number generation scopes getWorkers to the target company",
  /storage\.getWorkers\(req\.body\.companyId\)/.test(postWorkers));
ok("no unbounded storage.getWorkers() in the create path",
  !/storage\.getWorkers\(\)\s*;/.test(postWorkers) && !/await storage\.getWorkers\(\)\s*\n/.test(postWorkers));
ok("uses reduce (not a variadic Math.max spread) for the highest number",
  /companyWorkers\.reduce\(/.test(postWorkers) && !/Math\.max\(\.\.\.\w/.test(postWorkers));
ok("still falls back to 1001 for the first employee", /1001/.test(postWorkers));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
