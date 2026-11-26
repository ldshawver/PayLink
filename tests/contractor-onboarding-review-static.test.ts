/**
 * Static guards for ADI + the review queue (PR 7). No database, no network.
 *
 * The "no AI / no network" guard is syntax-aware (TypeScript AST), not a text
 * search: user-facing words such as "AI" in guidance strings are fine, while
 * imports, dynamic imports, require(), SDK construction, network calls, AI
 * endpoints (literal or constructed) and AI API-key reads are rejected. A
 * self-test runs the guard over fixtures first, so a guard that silently stops
 * seeing anything fails this file.
 */
import fs from "node:fs";
import ts from "typescript";

let passed = 0, failed = 0;
const check = (n: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ✓ ${n}`); }
  else { failed++; console.error(`  ✗ ${n}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`); }
};

// ─── the guard ────────────────────────────────────────────────────────────────
/** Package/module names of AI SDKs and network clients. Matched against module specifiers only. */
const AI_MODULE = /(^|[\/@-])(openai|anthropic|anthropic-ai|xai|x-ai|grok|groq|ai-sdk|langchain|cohere|mistral(ai)?|ollama|replicate|huggingface|google\/generative-ai|google\/genai|google-cloud\/vertexai|together-ai|perplexity|deepseek)([\/@-]|$)|^ai$|^ai\//i;
const NET_MODULE = /^(node:)?(http|https|http2|net|tls|dgram|dns)$|^(undici|axios|node-fetch|got|ky|superagent|request|ws|isomorphic-fetch|cross-fetch)(\/|$)/i;
/** Hostnames / provider tokens inside string or template text (code strings, not prose — see literalIsEndpoint). */
const AI_HOST = /(api\.openai\.com|openai\.azure\.com|api\.x\.ai|\bx\.ai\b|api\.anthropic\.com|generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com|api\.groq\.com|api\.mistral\.ai|api\.cohere\.(ai|com)|api\.together\.xyz|api\.perplexity\.ai|api\.deepseek\.com|bedrock-runtime)/i;
const NET_GLOBAL = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]);
const AI_CTOR = /^(OpenAI|AzureOpenAI|Anthropic|AnthropicBedrock|AnthropicVertex|XAI|Grok|Groq|GoogleGenerativeAI|GoogleGenAI|VertexAI|Mistral|MistralClient|CohereClient|Ollama|Replicate|HfInference)$/;
const AI_ENV = /(OPENAI|ANTHROPIC|XAI|GROK|GROQ|GEMINI|GOOGLE_AI|MISTRAL|COHERE|AI_API|LLM)/i;
/** Method chains that only exist on AI SDK clients. */
const AI_CALL = /\.(chat\.completions\.create|completions\.create|responses\.create|messages\.create|embeddings\.create|generateContent|generateText|streamText)$/;

export interface GuardOptions {
  /** Module specifiers this file may import. Anything else is a violation. */
  allowImports: RegExp;
  /** When true, fetch() is allowed but only with a relative "/api/…" first argument (client code). */
  allowRelativeApiFetch?: boolean;
}

/** Returns human-readable violations; empty means the source is clean. */
export function scanForAiOrNetwork(fileName: string, text: string, opts: GuardOptions): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const at = (n: ts.Node) => `${fileName}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const checkModule = (spec: string, n: ts.Node, how: string) => {
    if (AI_MODULE.test(spec)) out.push(`${at(n)} ${how} of AI module "${spec}"`);
    else if (NET_MODULE.test(spec)) out.push(`${at(n)} ${how} of network module "${spec}"`);
    else if (!opts.allowImports.test(spec)) out.push(`${at(n)} ${how} of non-allowlisted module "${spec}"`);
  };
  const textOf = (n: ts.Node): string | null =>
    ts.isStringLiteralLike(n) ? n.text
    : ts.isTemplateExpression(n) ? n.head.text + n.templateSpans.map((s) => "${}" + s.literal.text).join("")
    : null;
  /** A string that is itself an endpoint (scheme or AI host). Prose like "ask an AI" has neither. */
  const literalIsEndpoint = (s: string) => /^\s*(https?|wss?):\/\//i.test(s) || /(https?|wss?):\/\//i.test(s) || AI_HOST.test(s);
  const calleeName = (e: ts.Expression): string => {
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e)) return `${calleeName(e.expression)}.${e.name.text}`;
    if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression)) return `${calleeName(e.expression)}.${e.argumentExpression.text}`;
    if (ts.isParenthesizedExpression(e)) return calleeName(e.expression);
    return "?";
  };
  const visit = (n: ts.Node): void => {
    // import … from "x" / export … from "x" / import x = require("x")
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteralLike(n.moduleSpecifier)) {
      if (!(ts.isImportDeclaration(n) && n.importClause?.isTypeOnly)) checkModule(n.moduleSpecifier.text, n, "import");
    }
    if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      const e = n.moduleReference.expression;
      if (ts.isStringLiteralLike(e)) checkModule(e.text, n, "require"); else out.push(`${at(n)} require of a computed module`);
    }
    if (ts.isCallExpression(n)) {
      const name = calleeName(n.expression);
      // import("x") / require("x") — computed specifiers are rejected outright
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword || name === "require" || name.endsWith(".require") || name === "module.require") {
        const a = n.arguments[0];
        if (a && ts.isStringLiteralLike(a)) checkModule(a.text, n, n.expression.kind === ts.SyntaxKind.ImportKeyword ? "dynamic import" : "require");
        else out.push(`${at(n)} ${n.expression.kind === ts.SyntaxKind.ImportKeyword ? "dynamic import" : "require"} of a computed module`);
      }
      const last = name.split(".").pop()!;
      if (NET_GLOBAL.has(last) && (name === last || /^(globalThis|window|self|global)\./.test(name))) {
        const a = n.arguments[0];
        const s = a ? textOf(a) : null;
        const relativeApi = !!opts.allowRelativeApiFetch && last === "fetch" && s !== null && /^\/api\//.test(s) && !literalIsEndpoint(s);
        if (!relativeApi) out.push(`${at(n)} network call ${name}()`);
      }
      if (AI_CALL.test("." + name.split(".").slice(1).join("."))) out.push(`${at(n)} AI SDK call ${name}()`);
    }
    if (ts.isNewExpression(n)) {
      const name = calleeName(n.expression); const last = name.split(".").pop()!;
      if (AI_CTOR.test(last)) out.push(`${at(n)} AI client construction new ${name}()`);
      if (NET_GLOBAL.has(last)) out.push(`${at(n)} network client new ${name}()`);
    }
    // bare reference to fetch etc. (e.g. const f = globalThis.fetch; f(url))
    if (ts.isPropertyAccessExpression(n) && NET_GLOBAL.has(n.name.text) && /^(globalThis|window|self|global)$/.test(n.expression.getText(sf))
      && !(ts.isCallExpression(n.parent) && n.parent.expression === n)) out.push(`${at(n)} reference to ${n.getText(sf)}`);
    // AI API keys from the environment
    if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && /^process\.env$/.test(n.expression.getText(sf))) {
      const key = ts.isPropertyAccessExpression(n) ? n.name.text : ts.isStringLiteralLike(n.argumentExpression) ? n.argumentExpression.text : "?";
      if (AI_ENV.test(key)) out.push(`${at(n)} reads AI credential process.env.${key}`);
    }
    // literal or constructed endpoints: any string/template piece with a URL scheme or an AI host
    const s = ts.isStringLiteralLike(n) ? n.text : ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) ? n.text : null;
    if (s !== null && !(n.parent && (ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent) || ts.isExternalModuleReference(n.parent)))) {
      if (literalIsEndpoint(s)) out.push(`${at(n)} network endpoint in string "${s.slice(0, 60)}"`);
    }
    // "api." + "openai.com" style concatenation: join adjacent literal pieces
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken && !(ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
      const parts: string[] = [];
      const flat = (e: ts.Expression) => { if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) { flat(e.left); flat(e.right); } else parts.push(textOf(e) ?? "${}"); };
      flat(n);
      const joined = parts.join("");
      if (literalIsEndpoint(joined) && !parts.some(literalIsEndpoint)) out.push(`${at(n)} constructed endpoint "${joined.slice(0, 60)}"`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

// ─── self-test: the guard sees what it must and ignores prose ────────────────
const SERVER_ALLOW = /^(drizzle-orm|bcrypt|\.\/create|\.\/adi|\.\.\/db)$/;
const CLIENT_ALLOW = /^(react|@tanstack\/react-query|lucide-react|@\/lib\/queryClient|@\/hooks\/[\w-]+|@\/components\/ui\/[\w-]+|\.\/[\w-]+)$/;
const harmless = `
import { sql } from "drizzle-orm";
// ADI is not an AI model; it never calls OpenAI or xAI.
/** No AI here. */
export function f(add: (...a: unknown[]) => void) {
  add("review_w9", "review", "w9", "The W-9 needs a person to review it.", "ADI does not read tax values. No AI reviews this — AI is not used.");
  add("x", "info", null, "AI-free check", \`Ask a person, not an AI (\${1} item).\`);
  const label = "Open AI-free guidance"; const t = { title: "AI" }; return [label, t, sql\`SELECT 1\`];
}`;
check("self-test: guidance text containing \"AI\" (strings, templates, comments) is allowed",
  scanForAiOrNetwork("fixture.ts", harmless, { allowImports: SERVER_ALLOW }).length === 0, scanForAiOrNetwork("fixture.ts", harmless, { allowImports: SERVER_ALLOW }));
const forbidden: [string, string][] = [
  ["static import of openai", `import OpenAI from "openai";`],
  ["named import of the Anthropic SDK", `import { Anthropic } from "@anthropic-ai/sdk";`],
  ["Vercel ai package", `import { generateText } from "ai";`],
  ["xAI provider package", `import { xai } from "@ai-sdk/xai";`],
  ["re-export from an AI module", `export { default } from "openai";`],
  ["dynamic import", `export async function g() { const m = await import("openai"); return m; }`],
  ["computed dynamic import", `export async function g(p: string) { return import(p); }`],
  ["require()", `const OpenAI = require("openai");`],
  ["import = require", `import OpenAI = require("openai");`],
  ["network module import", `import https from "node:https";`],
  ["axios import", `import axios from "axios";`],
  ["non-allowlisted module", `import { thing } from "../ai/helper";`],
  ["SDK construction", `declare const OpenAI: any; const c = new OpenAI({ apiKey: "k" });`],
  ["SDK call chain", `declare const c: any; c.chat.completions.create({ model: "m" });`],
  ["Anthropic messages call", `declare const c: any; c.messages.create({});`],
  ["fetch to an AI endpoint", `fetch("https://api.x.ai/v1/chat/completions", { method: "POST" });`],
  ["globalThis.fetch", `declare const u: string; globalThis.fetch(u);`],
  ["aliased fetch reference", `const f = globalThis.fetch; f("x");`],
  ["XMLHttpRequest", `const x = new XMLHttpRequest();`],
  ["bare host without scheme", `const host = "api.openai.com";`],
  ["template-built endpoint", `declare const h: string; const u = \`https://\${h}/v1/messages\`;`],
  ["concatenated endpoint", `const u = "api." + "openai" + ".com";`],
  ["AI credential from env", `const k = process.env.OPENAI_API_KEY;`],
  ["AI credential via element access", `const k = process.env["XAI_API_KEY"];`],
];
for (const [label, src] of forbidden) {
  const v = scanForAiOrNetwork("fixture.ts", src, { allowImports: SERVER_ALLOW });
  check(`self-test: rejects ${label}`, v.length > 0, src);
}
check("self-test (client mode): relative /api fetch allowed, absolute fetch rejected",
  scanForAiOrNetwork("c.tsx", `fetch(\`/api/contractor-onboarding/\${id}/review\`, {});`, { allowImports: CLIENT_ALLOW, allowRelativeApiFetch: true }).length === 0
  && scanForAiOrNetwork("c.tsx", `fetch("https://api.openai.com/v1");`, { allowImports: CLIENT_ALLOW, allowRelativeApiFetch: true }).length > 0
  && scanForAiOrNetwork("c.tsx", `declare const u: string; fetch(u);`, { allowImports: CLIENT_ALLOW, allowRelativeApiFetch: true }).length > 0);

// ─── the real review workflow files ──────────────────────────────────────────
const read = (p: string) => fs.readFileSync(p, "utf8");
const adi = read("server/contractor-onboarding/adi.ts");
const rev = read("server/contractor-onboarding/review.ts");
const ui = read("client/src/components/contractor-onboarding/review-queue.tsx");
const routes = read("server/routes.ts");
for (const [file, src, opts] of [
  ["server/contractor-onboarding/adi.ts", adi, { allowImports: /^(drizzle-orm|\.\/create)$/ }],
  ["server/contractor-onboarding/review.ts", rev, { allowImports: SERVER_ALLOW }],
  ["client/src/components/contractor-onboarding/review-queue.tsx", ui, { allowImports: CLIENT_ALLOW, allowRelativeApiFetch: true }],
] as const) {
  const v = scanForAiOrNetwork(file, src, opts);
  check(`${file}: no AI client, no AI endpoint, no network call (AST)`, v.length === 0, v);
}

// The review routes' handlers: no AI/network either (the route bodies only).
const routeBlock = routes.slice(routes.indexOf('app.get("/api/contractor-onboarding/review-queue"'), routes.indexOf("// PR 6 — verified completion."));
check("review routes found in routes.ts", routeBlock.length > 200 && routeBlock.includes("/review\""));
check("review route handlers: no AI/network calls (AST)", scanForAiOrNetwork("routes-review-block.ts", routeBlock, { allowImports: /^$/ }).length === 0, scanForAiOrNetwork("routes-review-block.ts", routeBlock, { allowImports: /^$/ }));

// ─── ADI reads structured fields only ────────────────────────────────────────
const adiSf = ts.createSourceFile("adi.ts", adi, ts.ScriptTarget.Latest, true);
const sqlText: string[] = []; const idents = new Set<string>();
(function walk(n: ts.Node) {
  if (ts.isTaggedTemplateExpression(n) && n.tag.getText(adiSf) === "sql") {
    const t = n.template; sqlText.push(ts.isNoSubstitutionTemplateLiteral(t) ? t.text : t.head.text + t.templateSpans.map((s) => " $ " + s.literal.text).join(""));
  }
  if (ts.isIdentifier(n)) idents.add(n.text);
  ts.forEachChild(n, walk);
})(adiSf);
const allSql = sqlText.join("\n");
check("ADI SQL found (guard is looking at real queries)", sqlText.length >= 6 && /FROM worker_onboarding/.test(allSql));
check("ADI SQL never selects document contents, keys, tax or SSN columns",
  !/\b(ssn|tax_id|tin|ein|metadata_json|data_json|storage_key|storage_path|ciphertext\w*|enc_key_id|enc_iv|enc_tag|file_path|original_filename|account_number|routing_number|birth_date)\b/i.test(allSql), allSql);
check("ADI never calls document readers or decryption",
  !["readAndOpen", "openPrivateDocument", "downloadPdf", "createDecipheriv", "decrypt", "decryptBuffer", "readFile", "readFileSync"].some((i) => idents.has(i)));
check("findings are built from fixed text (no interpolated personal values)", (() => {
  let bad = false;
  (function walk(n: ts.Node) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "add")
      for (const a of n.arguments.slice(3)) if (!ts.isStringLiteralLike(a)) bad = true;
    ts.forEachChild(n, walk);
  })(adiSf);
  return !bad;
})());

// ─── review service + routes: security shape ─────────────────────────────────
check("approval re-assesses under a row lock inside the transaction", /FOR UPDATE`\)\);[\s\S]{0,200}assessOnboarding\(tx, companyId, onboardingId\)/.test(rev));
check("approval requires no blocking findings, both human confirmations and the exact phrase",
  /if \(!a\.ready\) return[\s\S]{0,300}not_ready/.test(rev) && /!input\.confirmIdVerified \|\| !input\.confirmW9Reviewed/.test(rev)
  && /input\.confirmationPhrase !== APPROVAL_PHRASE/.test(rev) && /export const APPROVAL_PHRASE = "APPROVE ONBOARDING"/.test(rev)
  && ui.includes('const APPROVAL_PHRASE = "APPROVE ONBOARDING"'));
check("approval and request-changes both require a reviewer note", (rev.match(/const note = validNote\(b\.note\);\s*if \(!note\) return \{ ok: false/g) || []).length === 2);
check("approve route requires recent authentication before the service runs",
  /parsed\.value\.decision === "approve"[\s\S]{0,200}reauthenticateReviewer\(actingUser\.id[\s\S]{0,400}reauth_required[\s\S]{0,200}reviewOnboarding\(/.test(routeBlock)
  && /bcrypt\.compare\(password, u\.password\)/.test(rev) && /REAUTH_MAX_FAILURES/.test(rev));
check("audit never stores the reviewer's note or the password", /audit\("changes_requested", \{ step: input\.step \}\)/.test(rev) && !/audit\([^)]*(note|password)/i.test(rev));
check("password is never logged", !/console\.\w+\([^)]*(currentPassword|password)/i.test(routeBlock + rev));
check("approval does not activate the worker or touch bid eligibility (PR 9)", !/UPDATE workers|bid_eligib|is_active\s*=/.test(rev));
check("review route: admin + CSRF + demo block; queue/assessment: admin or manager",
  /app\.post\("\/api\/contractor-onboarding\/:id\/review", requireAuth, requireRole\("admin"\), requireCsrfToken, blockDemoWrites/.test(routes)
  && /app\.get\("\/api\/contractor-onboarding\/review-queue", requireAuth, requireRole\("admin", "manager"\)/.test(routes)
  && /app\.get\("\/api\/contractor-onboarding\/:id\/assessment", requireAuth, requireRole\("admin", "manager"\)/.test(routes));
check("legacy /api/worker-onboarding write routes refuse contractor packages", [
  'app.patch("/api/worker-onboarding/:id",', 'app.delete("/api/worker-onboarding/:id",', 'app.post("/api/worker-onboarding/:id/regenerate-token",',
  'app.post("/api/worker-onboarding/:id/review",', 'app.patch("/api/worker-onboarding/:id/steps/:stepId",',
].every((h) => { const i = routes.indexOf(h); return i > 0 && /isContractorOnboarding\(req\.params\.id\)/.test(routes.slice(i, i + 500)); }));
check("queue rows carry counts only — no findings, contact, email or document fields",
  /out\.push\(\{ onboardingId: r\.id, workerId: r\.worker_id, firstName: r\.first_name, lastName: r\.last_name, employeeNumber: r\.employee_number,\s*status: a\.status, ready: a\.ready, verified: a\.verified, counts: a\.counts \}\)/.test(rev));

console.log(`\nreview static: ${passed} passed${failed ? `, ${failed} failed` : ""}`);
process.exit(failed ? 1 : 0);
