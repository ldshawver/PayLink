/**
 * Contractor onboarding — welcome email: static guards (no DB, no network).
 *   npx tsx tests/contractor-welcome-email-static.test.ts
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✓  ${name}`); }
  else { failed++; console.error(`  ✗  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`); }
}
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const svc = read("server/contractor-onboarding/welcome.ts");
const queue = read("server/contractor-onboarding/welcome-queue.ts");
const review = read("server/contractor-onboarding/review.ts");
const routes = read("server/routes.ts");
const orch = read("server/workers/orchestrator.ts");
const mig = read("migrations/0045_contractor_welcome_email.sql");
const app = read("client/src/App.tsx");

// ─── queueing is part of the one approval transaction ─────────────────────────
const approveBlock = review.slice(review.indexOf('if (input.decision === "approve")'), review.indexOf('return { ok: true as const, outcome: "verified" as const }'));
check("approval queues the welcome email inside its transaction (same tx, after 'verified')",
  /SET status = 'verified'[\s\S]*await queueWelcomeEmail\(tx, \{/.test(approveBlock));
check("queueing happens nowhere else", (review.match(/queueWelcomeEmail\(/g) || []).length === 1 && !/queueWelcomeEmail\(/.test(routes));
check("one logical message per onboarding: unique dedupe key + ON CONFLICT DO NOTHING",
  /CREATE UNIQUE INDEX IF NOT EXISTS uq_email_outbox_dedupe ON email_outbox \(dedupe_key\)/.test(mig) && /ON CONFLICT \(dedupe_key\) DO NOTHING/.test(queue));
check("the queue module is database-only (no mail, network or AI imports)", [...queue.matchAll(/from "([^"]+)"/g)].every((m) => m[1] === "drizzle-orm") && !/import\(/.test(queue) && !/notifications|nodemailer|fetch\(/.test(queue));
check("the approval route does not trigger delivery (the review path stays network-free)", !/drainWelcomeOutbox/.test(routes));

// ─── tokens ──────────────────────────────────────────────────────────────────
const tokInsert = svc.slice(svc.indexOf("INSERT INTO contractor_password_setup_tokens"), svc.indexOf("RETURNING id", svc.indexOf("INSERT INTO contractor_password_setup_tokens")));
check("only the sha256 of the token is stored", /hashSetupToken\(raw\)/.test(tokInsert) && !/\$\{raw\}/.test(tokInsert) && /CHECK \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/.test(mig));
check("token bound to purpose, company, worker, user, onboarding and outbox row",
  ["purpose", "company_id", "worker_id", "user_id", "onboarding_id", "outbox_id"].every((c) => tokInsert.includes(c)));
check("at most one pending token per (worker, purpose)", /uq_cpst_one_pending ON contractor_password_setup_tokens \(worker_id, purpose\) WHERE status = 'pending'/.test(mig));
check("issuing a token first revokes the previous pending one", /await revokePending\(tx, ob\.worker_id, "replaced"\);[\s\S]{0,400}INSERT INTO contractor_password_setup_tokens/.test(svc));
check("setup locks the token row and checks purpose, status, expiry and the user/worker/company binding",
  /token_hash = \$\{hashSetupToken\(a\.rawToken as string\)\} FOR UPDATE/.test(svc) && /t\.purpose !== SETUP_PURPOSE/.test(svc) && /t\.status !== "pending"/.test(svc)
  && /expires_at\)\.getTime\(\) <= now/.test(svc) && /u\.worker_id = \$\{t\.worker_id\} AND u\.company_id = \$\{t\.company_id\} AND w\.company_id = \$\{t\.company_id\}/.test(svc));
check("every setup failure returns the same generic answer", (svc.match(/return INVALID;|return reject\(/g) || []).length >= 7 && !/status: 40[13]/.test(svc.slice(svc.indexOf("export async function completePasswordSetup"))));
check("setup never creates an account", !/INSERT INTO users/.test(svc));

// ─── delivery ────────────────────────────────────────────────────────────────
check("rows are claimed with SKIP LOCKED", /FOR UPDATE SKIP LOCKED/.test(svc));
check("'sent' is written only after the mailer reports success", /if \(sent\) \{\s*const ok = rowsOf<any>\(await tx\.execute\(sql`\s*UPDATE email_outbox SET status = 'sent'/.test(svc)
  && (svc.match(/status = 'sent'/g) || []).length === 1);
check("a failed delivery revokes its undelivered token", /revoked_reason = 'undelivered'[\s\S]{0,120}WHERE id = \$\{p\.tokenId\}/.test(svc));
check("eligibility is re-checked at send time with the shared gate evaluator (only worker_status tolerated)",
  /await evaluateContractorGate\(tx,/.test(svc) && /TOLERATED_GATE_CODES = new Set\(\["worker_status"\]\)/.test(svc) && /onb\?\.status !== "verified"/.test(svc));
check("the outbox stores no address, body or token", !/\b(email|body|html|token|recipient)\b\s+(TEXT|VARCHAR)/i.test(mig.slice(mig.indexOf("CREATE TABLE IF NOT EXISTS email_outbox"), mig.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS uq_email_outbox_dedupe"))));

// ─── content ─────────────────────────────────────────────────────────────────
const builder = svc.slice(svc.indexOf("export function buildWelcomeEmail"), svc.indexOf("export type WelcomeMailer"));
check("the email builder takes only name, company, employee number, link, expiry and address",
  /a: \{ to: string; firstName: string; companyName: string; employeeNumber: string; link: string; expiresAt: Date \}/.test(builder));
check("the builder never references password, PIN, tax, ID, document or note fields",
  !/\b(password|pin|ssn|tin|tax_?id|government|document|review_notes|note)\b/i.test(builder.replace(/Set my password|set your password/gi, "")));
check("the message is rendered from: first name, email, employee number, company name only",
  /SELECT w\.first_name, w\.email, w\.employee_number, c\.name AS company_name/.test(svc) && !/ssn|pin_hash|tax|private_personnel_documents\.(id|storage)/i.test(svc.slice(svc.indexOf("// 2. the ONE login account"), svc.indexOf("// 3. one live link"))));
const b = (await import("../server/contractor-onboarding/welcome")).buildWelcomeEmail({ to: "a@example.test", firstName: "Ann", companyName: "Co", employeeNumber: "2613", link: "https://x.invalid/contractor-password-setup?token=t", expiresAt: new Date(Date.now() + 72 * 3600e3) });
check("built message: employee number + link, nothing else sensitive", b.text.includes("2613") && b.text.includes("token=t") && !/\bpin\b|ssn|w-9|government|password:[ \t]*\S|password is/i.test(b.text));

// ─── audit ───────────────────────────────────────────────────────────────────
const auditCalls = [...(svc + queue).matchAll(/audit\(tx, [^,]+, "([a-z_]+)", (\{[^}]*\})/g)].map((m) => m[2]);
check("audit metadata holds ids, attempt numbers and codes only", auditCalls.length >= 8 && auditCalls.every((x) => !/raw|token:|email|password|link|hashed/i.test(x)), auditCalls);

// ─── route, page, job ────────────────────────────────────────────────────────
const setupRoute = routes.slice(routes.indexOf('app.post("/api/contractor-onboarding/password-setup"'), routes.indexOf("});", routes.indexOf('app.post("/api/contractor-onboarding/password-setup"')));
check("public setup route is rate-limited and calls the service", /app\.post\("\/api\/contractor-onboarding\/password-setup", passwordSetupRateLimit,/.test(routes) && setupRoute.includes("completePasswordSetup("));
check("only that exact path is exempt from the global auth gate", routes.includes('req.path === "/contractor-onboarding/password-setup"') && !/req\.path\.startsWith\("\/contractor-onboarding/.test(routes));
check("status route is admin/manager and company-scoped", /app\.get\("\/api\/contractor-onboarding\/:id\/welcome-status", requireAuth, requireRole\("admin", "manager"\)/.test(routes));
check("client page is registered as a public route", app.includes('location === "/contractor-password-setup"'));
check("the delivery job runs only when CONTRACTOR_WELCOME_EMAIL_ENABLED=true", /if \(welcomeEmailEnabled\(\)\) scheduleJob\("ContractorWelcomeEmail"/.test(orch));

// ─── no network / AI from the service ────────────────────────────────────────
const sf = ts.createSourceFile("welcome.ts", svc, ts.ScriptTarget.Latest, true);
const imports: string[] = [];
(function walk(n: ts.Node) {
  if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) imports.push(n.moduleSpecifier.text);
  if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) imports.push(n.arguments[0].text);
  ts.forEachChild(n, walk);
})(sf);
const ALLOWED = new Set(["node:crypto", "bcrypt", "drizzle-orm", "../db", "./gate", "./invite", "./welcome-queue", "../notifications"]);
check("service imports only DB, crypto, bcrypt, the gate and the app's SMTP transport", imports.every((i) => ALLOWED.has(i)), imports);
check("no fetch / http / AI client in the service", !/\bfetch\(|https?\.request|openai|anthropic|xai/i.test(svc));

console.log(`\nwelcome static: ${passed} passed${failed ? `, ${failed} failed` : ""}`);
process.exit(failed ? 1 : 0);
