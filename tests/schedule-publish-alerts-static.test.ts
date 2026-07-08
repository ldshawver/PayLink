import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const publishStart = routes.indexOf('app.post("/api/schedules/publish"');
assert.notEqual(publishStart, -1, "schedule publish route exists");
const publishEnd = routes.indexOf('app.get("/api/payroll-runs"', publishStart);
const block = routes.slice(publishStart, publishEnd);

assert.match(block, /scheduleCompanyIds = Array\.from\(new Set\(targetSchedules\.map/, "publish route derives company scope from target schedules");
assert.match(block, /Cannot publish schedules across multiple companies in one request/, "publish route rejects mixed-company scheduleIds");
assert.match(block, /Schedule company does not match requested company/, "publish route rejects companyId mismatches");
assert.match(block, /evaluateScheduleAccess\([\s\S]*targetCompanyId: publishCompanyId/, "publish route authorizes access to the publish company");
assert.match(block, /storage\.getTimeOffRequests\(publishCompanyId\)/, "time-off conflict lookup is scoped to publish company");
assert.match(block, /storage\.getWorkers\(publishCompanyId\)/, "worker lookup is scoped to publish company");
assert.match(block, /storage\.getUsersByCompany\(schedCoId\)/, "linked user lookup is scoped to publish company");
assert.match(block, /storage\.updateSchedule\(s\.id, \{ status: "published" \}\)/, "publish route marks draft schedules published");
assert.match(block, /storage\.getNotificationPreferences\(worker\.id\)/, "publish route loads worker notification preferences by affected worker");
assert.match(block, /eventType === "schedule_published"/, "publish route uses schedule_published preference row");
assert.match(block, /pref\?\.emailEnabled !== false/, "email alerts default on and respect disabled preferences");
assert.match(block, /pref\?\.smsEnabled !== false/, "SMS alerts default on and respect disabled preferences");
assert.match(block, /sendScheduleEmailNotification\(payload\)/, "publish route sends transactional schedule email alerts");
assert.match(block, /sendScheduleSmsNotification\(payload\)/, "publish route sends transactional schedule SMS alerts");
assert.match(block, /return \{ sent: false, error: emailEnabled \? "No email address" : "Email schedule alerts disabled" \}/, "missing/disabled email is recorded as a result");
assert.match(block, /return \{ sent: false, error: smsEnabled \? "No phone number" : "SMS schedule alerts disabled" \}/, "missing/disabled SMS is recorded as a result");
assert.match(block, /catch \(err: any\)[\s\S]*Email schedule alert failed/, "unexpected email sender exceptions are converted to failed results");
assert.match(block, /catch \(err: any\)[\s\S]*SMS schedule alert failed/, "unexpected SMS sender exceptions are converted to failed results");
assert.match(block, /storage\.createNotification\([\s\S]*companyId: scheduleCompanyId[\s\S]*workerId: worker\.id[\s\S]*actionUrl: "\/app\/schedule"/, "publish route records each worker notification attempt/result with app schedule URL and publish company");
assert.doesNotMatch(block, /accountSid|authToken|TWILIO_AUTH_TOKEN|TWILIO_ACCOUNT_SID|twilio credentials/i, "notification payload does not store Twilio credentials or secrets");
assert.match(block, /catch \(notifErr\)[\s\S]*Failed to record schedule notification attempt/, "notification attempt recording failures are swallowed and logged");
assert.doesNotMatch(block, /campaign/i, "publish alerting does not add campaign behavior");

console.log("Schedule publish alert static checks passed.");
