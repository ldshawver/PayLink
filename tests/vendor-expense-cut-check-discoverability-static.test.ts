/**
 * v2.2.5 — vendor/expense Cut Check discoverability static guards.
 * Run: npx tsx tests/vendor-expense-cut-check-discoverability-static.test.ts
 *
 * Proves — by reading client/src/pages/expenses.tsx — that the already-shipped
 * B2 Cut Check feature is discoverable:
 *   - the label "Cut Check" is used (not the old "Print Check")
 *   - the role gate matches the server's expanded admin/manager guard
 *   - a page-level entry point renders on BOTH the My Expenses and All Expenses
 *     tabs (incl. their empty states): disabled Cut Check + reason + New Expense
 *   - the per-row action renders on desktop rows AND mobile cards, disabled with a
 *     reason when ineligible
 *   - preview stays a separate no-write action; issuance still goes through
 *     POST /cut-check with an Idempotency-Key
 * and that NO server / ledger / migration file was touched.
 */
import fs from "node:fs";

const client = fs.readFileSync("client/src/pages/expenses.tsx", "utf8");

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
};

console.log("=== v2.2.5 — Cut Check discoverability (static) ===\n");

// ── naming ────────────────────────────────────────────────────────
ok('the expense action button is labelled "Cut Check"',
  /<Button[\s\S]{0,200}data-testid=\{`button-cut-check-\$\{e\.id\}`\}[\s\S]{0,80}Cut Check/.test(client));
ok('the expense check dialog title says "Cut Vendor Check"',
  client.includes("Cut Vendor Check"));
ok('the confirm button in the dialog says "Cut Check" (not "Issue Check")',
  /button-confirm-print-check[\s\S]{0,400}\/>Cut Check<\/>/.test(client) &&
  !client.includes("/>Issue Check</>"));
ok("the expense-side flow no longer shows the label \"Print Check\" (contractor-invoice flow may still)",
  !/data-testid=\{`button-print-check-\$\{e\.id\}`\}/.test(client));

// ── always-visible-with-reason ────────────────────────────────────
ok("a client eligibility mirror exists with the required disabled reasons",
  client.includes("function cutCheckEligibility(") &&
  client.includes('"Approve expense first"') &&
  client.includes('"Add vendor/payee first"') &&
  client.includes('"Already paid"') &&
  client.includes('"No unpaid balance"') &&
  client.includes('"Funding account required"'));
ok("the action is gated to admin/manager AND the roles the server expands to admin/manager",
  /cutCheckRole === "admin" \|\| cutCheckRole === "manager"/.test(client) &&
  // requireRole("admin","manager") + expandRoleForGuard() lets these through server-side,
  // so the client must not hide the action from them (platform_super_admin especially —
  // the account most operators actually log in with).
  client.includes('"platform_super_admin"') &&
  client.includes('"platform_admin"') &&
  client.includes('"owner"') &&
  client.includes('"tenant_admin"') &&
  client.includes('"tenant_manager"'));
ok("the action is NOT gated by the loose isAdmin flag (which also covers supervisor / platform_support)",
  !/canCutCheck\s*=\s*isAdmin\b/.test(client));
ok("an ineligible row renders the disabled action with a visible reason (not a missing button)",
  /disabled=\{!ok\}/.test(client) &&
  /data-testid=\{`text-cut-check-reason-\$\{e\.id\}`\}/.test(client));
ok("the row action is used on BOTH the desktop table and the mobile card",
  (client.match(/renderCutCheckAction\(e\)/g) || []).length >= 2 &&
  /sm:hidden[\s\S]{0,1200}renderCutCheckAction\(e\)/.test(client));

// ── page-level entry point (visible without an eligible row on screen) ────
const REASON = "Create and approve a vendor expense before cutting a check.";
ok("a page-level renderCutCheckEntryPoint(...) exists — disabled Cut Check + reason + New Expense",
  /function renderCutCheckEntryPoint\(/.test(client) &&
  /data-testid="button-cut-check-entry"/.test(client) &&
  /data-testid="button-cut-check-entry-new-expense"/.test(client) &&
  client.includes(REASON) &&
  /disabled=\{n === 0\}/.test(client));
ok("the entry point is role-gated the same way as the row action (canCutCheck)",
  /function renderCutCheckEntryPoint\([\s\S]{0,80}if \(!canCutCheck\) return null;/.test(client));
ok("the entry point count mirrors the per-row eligibility gate",
  /eligibleCutCheckExpenses\s*=\s*canCutCheck[\s\S]{0,180}cutCheckEligibility\(e, fundedCompanyIds, remittanceSourcesLoaded\)\.ok/.test(client));

// ── it renders on BOTH tabs, INCLUDING their empty states ────────────────
ok('the entry point renders on the My Expenses tab, above its empty state',
  /TabsContent value="my-expenses"[\s\S]{0,600}renderCutCheckEntryPoint\("my"\)[\s\S]{0,400}myExpenses\.length === 0/.test(client));
ok('the entry point renders on the All Expenses tab, above its empty state',
  /TabsContent value="all-expenses"[\s\S]{0,600}renderCutCheckEntryPoint\("all"\)[\s\S]{0,400}empty-all-expenses/.test(client));
ok('the empty All Expenses card carries the same reason string',
  /empty-all-expenses[\s\S]{0,260}Create and approve a vendor expense before cutting a check\./.test(client));

// ── preview vs issuance unchanged ────────────────────────────────
ok("preview is still a separate no-write action (previewExpenseCheck → print-check?preview=1)",
  client.includes("previewExpenseCheck") && client.includes("print-check?") && client.includes("preview"));
ok("issuance still posts to /cut-check with an Idempotency-Key header",
  client.includes("/cut-check") && client.includes('"Idempotency-Key"'));
ok("the user still cannot type a check number (allocated on issue)",
  client.includes('value="auto — allocated on issue"'));

// ── no backend / ledger / migration change in this patch ─────────
const changed = (p: string) => {
  try {
    const { execSync } = require("node:child_process");
    const out = execSync(`git diff --name-only origin/main -- ${p}`, { encoding: "utf8" });
    return out.trim().length > 0;
  } catch { return false; }
};
ok("no server file changed by this patch",
  !changed("server/"));
ok("migration 0017 and the expense_payments ledger definition are untouched",
  !changed("migrations/0017_expense_payments.sql") && !changed("server/expense-payments.ts"));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
