/**
 * Contractor onboarding PR 2 — static guards for the setup invitation.
 * No DB, no network.
 */
import fs from "node:fs";
import { buildSetupInviteEmail, escapeHtml, SETUP_INVITE_TTL_MS } from "../server/contractor-onboarding/invite";

let passed = 0, failed = 0;
const check = (n: string, ok: boolean) => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.error(`  ✗ ${n}`); } };
const routes = fs.readFileSync("server/routes.ts", "utf8");
const svc = fs.readFileSync("server/contractor-onboarding/invite.ts", "utf8");
const idb = fs.readFileSync("server/identity/identity-db.ts", "utf8");
const at = (needle: string) => { const i = routes.indexOf(needle); return i < 0 ? "" : routes.slice(i, routes.indexOf("\n  });", i)); };
const send = at('app.post("/api/contractor-onboarding/:id/invite",');
const accept = at('app.post("/api/account-invites/accept",');

check("send route: requireAuth + requireRole(\"admin\") + CSRF + demo-write block", /requireAuth, requireRole\("admin"\), requireCsrfToken, blockDemoWrites/.test(send));
check("send route: company from the session user only", /resolveTenantCompanyId\(actingUser\)/.test(send) && !/req\.body/.test(send));
check("send route: production base URL only from APP_BASE_URL (never the Host header)", /process\.env\.NODE_ENV === "production" \? null : getAppBaseUrl\(req\)/.test(send));
check("send route: unknown company/record → 404 (non-revealing)", /status\(404\)/.test(send));
check("service: row lock + sending claim inside one transaction", /db\.transaction[\s\S]*FROM worker_onboarding o[\s\S]{0,200}FOR UPDATE`[\s\S]*status = 'invite_sending'/.test(svc));
// The state read must be a separate statement AFTER the lock: a subquery inside a
// waiting SELECT … FOR UPDATE keeps its pre-wait snapshot (READ COMMITTED EPQ).
check("service: send state is read after the lock, not in the locking statement", !/max\(i\.last_sent_at\)[\s\S]{0,600}FOR UPDATE/.test(svc) && /FOR UPDATE`\)\);\s*if \(!locked\)/.test(svc));
check("service: email sent only after the claim transaction", svc.indexOf("await mailer(email)") > svc.indexOf("if (\"done\" in claim)"));
check("service: failed send revokes the undelivered invite", /status = 'revoked'[\s\S]{0,120}AND status = 'pending'`\);\s*\n\s*await tx\.execute\(sql`UPDATE worker_onboarding SET status = 'invite_failed'/.test(svc));
check("service: never logs (no console.*)", !/console\./.test(svc));
check("service: audit JSON holds no email/name/token", !/JSON\.stringify\(\{[^}]*(email|first_name|rawToken|link)/.test(svc));
check("accept: real transaction (no BEGIN/COMMIT over the pool) in identity-db", !/sql`(BEGIN|COMMIT|ROLLBACK)`/.test(idb) && /return await db\.transaction\(async \(tx\) =>/.test(idb));
check("accept: invite re-checked FOR UPDATE and unexpired inside the transaction", /status = 'pending' AND expires_at > NOW\(\) FOR UPDATE/.test(idb));
check("accept route: contractor step completed via the in-transaction hook", /acceptInviteWithUser\([\s\S]{0,120}async \(tx, accepted\)/.test(accept) && /completeContractorAccountSetupStep\(tx,/.test(accept));
check("accept route: session regenerated before sign-in", /req\.session\.regenerate\(/.test(accept));
const m = buildSetupInviteEmail({ to: "a@b.test", firstName: "<b>x</b>", companyName: "Acme & Co", link: "https://app.test/accept-invite?token=abc", expiresAt: new Date(Date.now() + SETUP_INVITE_TTL_MS) });
check("email: HTML escapes name and company", m.html.includes("&lt;b&gt;x&lt;/b&gt;") && m.html.includes("Acme &amp; Co") && !m.html.includes("<b>x</b>"));
check("email: no password / PIN wording, link present, 7-day expiry stated", !/password:|\bPIN\b/i.test(m.text) && m.text.includes("accept-invite?token=abc") && /expires in 7 days/.test(m.text));
check("escapeHtml covers quotes", escapeHtml(`"'`) === "&quot;&#39;");

console.log(`\ncontractor onboarding invite static: ${passed} passed${failed ? `, ${failed} failed` : ""}`);
if (failed) process.exit(1);
