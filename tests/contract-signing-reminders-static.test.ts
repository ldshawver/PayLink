/**
 * Static regression checks for persistent contract signing reminders.
 * Run: npx tsx tests/contract-signing-reminders-static.test.ts
 */
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const scheduler = fs.readFileSync("server/contractor-scheduler.ts", "utf8");

function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

ok("reminder config persists to contractor_reminders", routes.includes("reminder_type = 'signing_request_config'") && routes.includes("INSERT INTO contractor_reminders"));
ok("reminder GET returns persisted last/next dates", routes.includes("nextReminderSendDate: row?.scheduled_at") && routes.includes("lastReminderSentDate: row?.sent_at"));
ok("send-now logs reminder delivery", routes.includes("contractor_reminder_logs") && routes.includes("contract_signing_reminder"));
ok("send-now reports partial failure for retry handling", routes.includes("res.status(result.failures.length ? 207 : 200)") && routes.includes("retryCount"));
ok("scheduler processes configured signing reminders", scheduler.includes("Configured contract signing reminders") && scheduler.includes("signing_request_config"));
ok("scheduler skips terminal contract statuses", scheduler.includes("cc.status NOT IN ('fully_signed','completed','void','terminated')"));
ok("scheduler advances next send date", scheduler.includes("scheduled_at = ${nextAt}") && scheduler.includes("frequencyDays"));

console.log("\nContract signing reminder persistence and scheduler checks passed.");
