/** Static guards for private personnel documents (PR 4). No database. */
import fs from "node:fs";
let passed = 0, failed = 0;
const check = (n: string, ok: boolean) => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.error(`  ✗ ${n}`); } };
const store = fs.readFileSync("server/private-documents/store.ts", "utf8");
const svc = fs.readFileSync("server/private-documents/service.ts", "utf8");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const up = fs.readFileSync("server/uploads-access.ts", "utf8");
const mig = fs.readFileSync("migrations/0043_private_personnel_documents.sql", "utf8");
const block = (start: string, len = 2200) => { const i = routes.indexOf(start); return i < 0 ? "" : routes.slice(i, i + len); };

check("AES-256-GCM with additional data binding the record", /createCipheriv\("aes-256-gcm"/.test(store) && /setAAD\(aad\(b\)\)/.test(store) && /createDecipheriv\("aes-256-gcm"[\s\S]{0,120}\n\s*d\.setAAD\(aad\(b\)\)/.test(store));
check("key must be exactly 32 bytes; folder must be absolute and outside uploads/", /k\.length === 32/.test(store) && /path\.isAbsolute\(d\)/.test(store) && /dir_public/.test(store));
check("files written 0600 with exclusive create, never overwritten", /openSync\(tmp, "wx", 0o600\)/.test(store) && /refusing to overwrite/.test(store));
check("type decided from bytes, not the client name/MIME", /detectType\(args\.file\)/.test(svc) && !/originalname|mimetype/.test(svc));
check("no original file name stored, logged or returned", !/originalname/.test(svc) && !/originalname/.test(block('app.post("/api/my-onboarding/government-id/:side"')));
check("no platform bypass in private-doc access", !/isPlatformCompanyBypassRole|canAccessCompany\(/.test(svc) && /actor\.role !== "admin" && actor\.role !== "manager"/.test(svc));
check("every open attempt logged before the decision is returned", /await logAccess\(db, d, args\.actor, args\.disposition, allowed \? "allowed" : "denied"\);\s*if \(!allowed\) return notFound\(\);/.test(svc));
check("download route: no-store, nosniff, sandbox CSP, generic file name", /no-store, private/.test(block('app.get("/api/private-documents/:docId"')) && /nosniff/.test(block('app.get("/api/private-documents/:docId"')) && /sandbox/.test(block('app.get("/api/private-documents/:docId"')) && /filename: `\$\{String\(d\.document_kind\)/.test(svc));
check("contractor upload: CSRF, session-derived company + worker, size-limited memory upload", /app\.post\("\/api\/my-onboarding\/government-id\/:side", requireAuth, requireCsrfToken/.test(routes) && /PRIVATE_DOC_MAX_BYTES, files: 1/.test(routes) && /companyId: me\.companyId, workerId: me\.workerId/.test(block('app.post("/api/my-onboarding/government-id/:side"')));
check("private documents are NOT an /uploads source (no URL)", !/private_personnel_documents/.test(up));
check("0043 additive + ledger-gated + kinds/mime/size CHECKs + one active per kind", !/\b(DROP|TRUNCATE|DELETE FROM|RENAME)\b/i.test(mig.replace(/--.*$/gm, "")) && /'0043'/.test(mig) && /ck_ppd_kind/.test(mig) && /ck_ppd_mime/.test(mig) && /uq_ppd_active_kind[\s\S]{0,120}WHERE status = 'active'/.test(mig));
check("signed documents cannot be uploaded by hand", /UPLOADABLE_KINDS: readonly PrivateDocKind\[\] = \["government_id_front", "government_id_back"\]/.test(svc));
console.log(`\nprivate documents static: ${passed} passed${failed ? `, ${failed} failed` : ""}`);
process.exit(failed ? 1 : 0);
