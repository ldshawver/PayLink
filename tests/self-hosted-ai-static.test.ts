/**
 * No production path may call OpenAI or xAI. The denylist lives only in
 * server/ai-client.ts.
 * Run: npx tsx tests/self-hosted-ai-static.test.ts
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const forbidden = /api\.openai\.com|api\.x\.ai|import\("openai"\)|from "openai"|OPENAI_API_KEY|XAI_API_KEY/;
const offenders: string[] = [];
for (const file of walk("server").concat(walk("client/src"))) {
  if (file.endsWith(`${path.sep}ai-client.ts`) || file.includes(`${path.sep}__tests__${path.sep}`)) continue;
  const text = fs.readFileSync(file, "utf8");
  if (forbidden.test(text)) offenders.push(file);
}

assert.deepEqual(offenders, [], `external AI references remain in: ${offenders.join(", ")}`);

const client = fs.readFileSync("server/ai-client.ts", "utf8");
assert.match(client, /api\.openai\.com/);
assert.match(client, /api\.x\.ai/);
assert.match(client, /aiHostIsBlocked/);

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.equal(pkg.dependencies.openai, undefined);
assert.equal(pkg.devDependencies?.openai, undefined);
assert.equal(fs.readFileSync("script/build.ts", "utf8").includes('"openai"'), false);

const routes = fs.readFileSync("server/routes.ts", "utf8");
assert.match(routes, /resolveAiAvailability\(/);
assert.match(routes, /completeChat\(/);
assert.match(routes, /app\.patch\("\/api\/platform\/ai-settings"/);
assert.match(routes, /app\.patch\("\/api\/company\/ai-settings"/);
assert.match(fs.readFileSync("server/index.ts", "utf8"), /CREATE TABLE IF NOT EXISTS ai_controls/);
assert.match(fs.readFileSync("migrations/0040_ai_controls.sql", "utf8"), /CREATE TABLE IF NOT EXISTS ai_controls/);
assert.doesNotMatch(fs.readFileSync("migrations/0040_ai_controls.sql", "utf8"), /\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);

const expenses = fs.readFileSync("client/src/pages/expenses.tsx", "utf8");
const hub = fs.readFileSync("client/src/pages/contractor-hub.tsx", "utf8");
const banner = fs.readFileSync("client/src/components/ai-status-banner.tsx", "utf8");
assert.match(expenses, /AiUnavailableNotice/);
assert.match(hub, /text-ai-unavailable/);
assert.match(banner, /data-testid="text-ai-unavailable"/);
assert.match(banner, /button-platform-ai-toggle/);
assert.match(banner, /button-company-ai-toggle/);

console.log("self-hosted AI wiring checks passed.");
