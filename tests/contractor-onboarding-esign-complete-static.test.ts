/** Static guards for verified Documenso completion (PR 6). No database. */
import fs from "node:fs";
let passed = 0, failed = 0;
const check = (n: string, ok: boolean) => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.error(`  ✗ ${n}`); } };
const svc = fs.readFileSync("server/contractor-onboarding/esign-complete.ts", "utf8");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const mig = fs.readFileSync("migrations/0035_contractor_onboarding_esign_events.sql", "utf8");
const order = (...needles: string[]) => { let at = -1; for (const n of needles) { const i = svc.indexOf(n, at + 1); if (i < 0 || i < at) return false; at = i; } return true; };
check("webhook: secret → readiness → JSON → freshness → replay record, in that order",
  order("verifyWebhookSecret(args.headers, args.rawBody)", "completionTablesReady()", "JSON.parse(args.rawBody", "WEBHOOK_MAX_AGE_MS", "INSERT INTO contractor_onboarding_esign_events"));
check("payload content is never used to decide completion (only event name + document id)", !/parsed\??\.payload\??\.(recipients|status|templateId)/.test(svc));
check("completion re-reads Documenso and checks document, status, template, recipient, PDF", order("client.get(claim.documenso_document_id)", "document_mismatch", '!== "COMPLETED"', "template_mismatch", "recipient_mismatch", "client.downloadPdf", '"%PDF-"'));
check("signed PDF stored in the private store before the step completes", order("storePrivateDocument(", "status = 'completed', completed_at = NOW()", "UPDATE onboarding_steps SET status = 'completed'"));
check("exactly-once claim ('completing') and finish only while holding it", /SET status = 'completing'/.test(svc) && /WHERE id = \$\{claim\.id\} AND status = 'completing' RETURNING id/.test(svc));
check("events table stores no payload", !/payload/i.test(mig.replace(/--.*$/gm, "")) && /uq_coee_body/.test(mig) && /'0035'/.test(mig) && !/\b(DROP|TRUNCATE|DELETE FROM|RENAME)\b/i.test(mig.replace(/--.*$/gm, "")));
check("webhook path is public by EXACT match only", /req\.path === "\/webhooks\/documenso\/onboarding"/.test(routes) && !/startsWith\("\/webhooks\/documenso\//.test(routes));
check("refresh route: admin + CSRF + company from acting user", /app\.post\("\/api\/contractor-onboarding\/:id\/esign\/:kind\/refresh", requireAuth, requireRole\("admin"\), requireCsrfToken, blockDemoWrites/.test(routes));
check("logs interpolate only kind, reason and HTTP status", (svc.match(/console\.(?:warn|error|log)\(`[^`]*`\)/g) || []).every((line) => (line.match(/\$\{([^}]*)\}/g) || []).every((v) => /^\$\{(kind|reason|e\?\.status \?\? "n\/a")\}$/.test(v))) && (svc.match(/console\./g) || []).length === 3);
console.log(`\ne-sign completion static: ${passed} passed${failed ? `, ${failed} failed` : ""}`);
process.exit(failed ? 1 : 0);
