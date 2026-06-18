import assert from "node:assert/strict";
import fs from "node:fs";

const schedulePage = fs.readFileSync(new URL("./schedule.tsx", import.meta.url), "utf8");

function includesAll(snippets: string[]) {
  for (const snippet of snippets) assert.ok(schedulePage.includes(snippet), `Missing workflow snippet: ${snippet}`);
}

includesAll([
  'data-testid="button-copy-published-week"',
  'Copy Published Week',
  'data-testid="input-copy-source-week"',
  'data-testid="input-copy-target-week"',
  'data-testid="copy-week-target-warning"',
  'data-testid="select-copy-week-mode"',
  'data-testid="button-confirm-copy-week"',
  'Copy as Draft',
  'Copied ${data.copiedCount} shifts to draft schedule',
  'queryClient.invalidateQueries({ queryKey: ["/api/schedules"] })',
]);

assert.ok(schedulePage.includes('apiRequest("POST", "/api/schedules/copy-week"'), "UI posts to copy-week endpoint");
const copyMutationBlock = schedulePage.slice(schedulePage.indexOf("const copyWeekMutation"), schedulePage.indexOf("const publishMutation"));
assert.ok(!/sendSchedule|notify|notified/i.test(copyMutationBlock), "copy workflow must not notify employees");
assert.ok(schedulePage.includes('apiRequest("PATCH", `/api/schedules/${id}`'), "existing draft shifts remain editable through schedule edit workflow");
assert.ok(schedulePage.includes('apiRequest("POST", "/api/schedules/publish"'), "copied drafts can later use existing publish workflow");

console.log("Schedule copy-week frontend workflow coverage passed");
