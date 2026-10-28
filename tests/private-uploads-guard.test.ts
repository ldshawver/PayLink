/**
 * Private uploads — pure guard + filesystem resolution (P0: /uploads was served
 * anonymously by express.static). No database.
 *
 * Covers decideUploadAccess (tenant / company / document-level ownership,
 * tiers, most-restrictive-wins, fail closed on unknown ownership),
 * normalizeUploadRequestPath (traversal / encoding), resolveUploadFileStrict
 * (symlink escapes), uploadResponseHeaders (cache + content-type safety) and
 * the registry's branding-eligibility and source coverage.
 *
 * Run: npx tsx tests/private-uploads-guard.test.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  decideUploadAccess,
  normalizeUploadRequestPath,
  resolveUploadFileStrict,
  staffLevelFromRoles,
  uploadResponseHeaders,
  type UploadActor,
  type UploadOwner,
} from "../server/auth/upload-access-guard";
import { isBrandingImagePath, UPLOAD_OWNER_SOURCES } from "../server/auth/upload-ownership-registry";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

const owner = (o: Partial<UploadOwner>): UploadOwner => ({
  kind: "test", tier: "restricted", companyId: "coA", subjectWorkerIds: [], subjectUserIds: [], subjectVendorId: null, ...o,
});
const actor = (a: Partial<UploadActor>): UploadActor => ({
  userId: "u1", workerId: null, vendorId: null, isPlatform: false, staffLevel: "none", ...a,
});
const onlyCo = (...ids: string[]) => (id: string | null) => !!id && ids.includes(id);
const decide = (a: UploadActor | null, owners: UploadOwner[], acc = onlyCo("coA")) =>
  decideUploadAccess({ actor: a, owners, companyAccessible: acc });

async function main() {
  console.log("\n— decideUploadAccess —");
  const w9 = owner({ kind: "contractor_document", subjectWorkerIds: ["wC"], subjectUserIds: ["uUploader"] });

  let d = decide(null, [w9]);
  check("anonymous → 401 for a private file", !d.allowed && d.status === 401);
  d = decide(null, []);
  check("anonymous → 401 for an unknown file (existence not disclosed)", !d.allowed && d.status === 401);
  d = decide(actor({ staffLevel: "manager" }), []);
  check("unknown ownership fails closed even for a company admin → 404", !d.allowed && d.status === 404);
  d = decide(actor({ isPlatform: true }), []);
  check("unknown ownership fails closed even for a platform admin → 404", !d.allowed && d.status === 404);

  d = decide(actor({ staffLevel: "manager" }), [w9]);
  check("company admin/manager of the owning company → allowed", d.allowed && !d.isPublic);
  d = decide(actor({ staffLevel: "manager" }), [w9], onlyCo("coB"));
  check("admin of ANOTHER tenant → 404", !d.allowed && d.status === 404);
  d = decide(actor({ staffLevel: "supervisor" }), [w9]);
  check("supervisor cannot read a restricted (tax/HR) file", !d.allowed);
  d = decide(actor({ staffLevel: "none" }), [w9]);
  check("same-company employee who is not the subject → denied", !d.allowed && d.status === 404);
  d = decide(actor({ workerId: "wC" }), [w9]);
  check("contractor reads their own W-9", d.allowed);
  d = decide(actor({ workerId: "wOther" }), [w9]);
  check("different contractor in the same company → denied", !d.allowed);
  d = decide(actor({ workerId: "wC" }), [w9], onlyCo("coB"));
  check("subject match never crosses companies (company check first)", !d.allowed);
  d = decide(actor({ userId: "uUploader" }), [w9]);
  check("uploader user reads the file they uploaded", d.allowed);

  const vendorDoc = owner({ kind: "vendor_document", subjectVendorId: "v1" });
  check("vendor reads own vendor document", decide(actor({ vendorId: "v1" }), [vendorDoc]).allowed);
  check("other vendor denied", !decide(actor({ vendorId: "v2" }), [vendorDoc]).allowed);

  const staffDoc = owner({ kind: "company_document", tier: "staff" });
  check("supervisor reads a staff-tier company document", decide(actor({ staffLevel: "supervisor" }), [staffDoc]).allowed);
  check("plain employee cannot read a staff-tier company document", !decide(actor({}), [staffDoc]).allowed);

  check("platform org-admin reads a tenant file", decide(actor({ isPlatform: true }), [w9], () => true).allowed);
  check("non-admin platform role (isPlatform=false, no staff level) denied", !decide(actor({}), [w9], () => true).allowed);

  const logo = owner({ kind: "company_logo", tier: "branding" });
  d = decide(null, [logo]);
  check("branding-only file is public to anonymous", d.allowed && d.isPublic);
  d = decide(null, [logo, w9]);
  check("a logo column pointing at a private file does NOT make it public (anonymous 401)", !d.allowed && d.status === 401);
  d = decide(actor({}), [logo, w9]);
  check("…and does not grant a non-subject employee access", !d.allowed);
  d = decide(actor({ staffLevel: "manager" }), [logo, w9]);
  check("…owner-company admin still reads it, privately (no public cache)", d.allowed && !d.isPublic);

  const global = owner({ kind: "system_document", tier: "global", companyId: null });
  check("global system document: any signed-in user", decide(actor({}), [global], () => false).allowed);
  check("global system document: anonymous denied", !decide(null, [global]).allowed);

  // Re-referencing attack: the attacker creates their own record pointing at a victim's W-9.
  const attackerRecord = owner({ kind: "dam_document", subjectUserIds: ["uAttacker"] });
  d = decide(actor({ userId: "uAttacker" }), [w9, attackerRecord]);
  check("own record re-referencing someone else's W-9 does not unlock it (every owner must allow)", !d.allowed);
  const crossTenantAttack = owner({ kind: "dam_document", companyId: "coB", subjectUserIds: ["uAttacker"] });
  d = decide(actor({ userId: "uAttacker", staffLevel: "manager" }), [w9, crossTenantAttack], onlyCo("coB"));
  check("tenant-B admin record pointing at tenant-A file → denied", !d.allowed);

  check("staffLevelFromRoles admin → manager", staffLevelFromRoles(["admin", "tenant_admin"]) === "manager");
  check("staffLevelFromRoles supervisor", staffLevelFromRoles(["supervisor"]) === "supervisor");
  check("staffLevelFromRoles employee → none", staffLevelFromRoles(["employee"]) === "none");
  check("staffLevelFromRoles vendor → none", staffLevelFromRoles(["vendor"]) === "none");

  console.log("\n— normalizeUploadRequestPath —");
  const ok = normalizeUploadRequestPath("/abc-123.pdf");
  check("plain file", ok?.rel === "abc-123.pdf" && ok?.canonical === "/uploads/abc-123.pdf");
  check("nested signed path", normalizeUploadRequestPath("/signed/co1/x.pdf")?.canonical === "/uploads/signed/co1/x.pdf");
  for (const bad of [
    "/../etc/passwd", "/..%2fetc%2fpasswd", "/%2e%2e/secret", "/a/../../b", "/a/./b", "/a//b", "/.env",
    "/%252e%252e/x", "/a%00.pdf", "/a\\b", "/C:/x", "", "/", "/%E0%A4%A", "/.hidden/x.pdf", "/" + "a".repeat(600),
  ]) {
    check(`rejects ${JSON.stringify(bad.slice(0, 40))}`, normalizeUploadRequestPath(bad) === null);
  }

  console.log("\n— resolveUploadFileStrict (real filesystem) —");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pu-guard-"));
  const root = path.join(tmp, "uploads");
  const outside = path.join(tmp, "outside");
  fs.mkdirSync(path.join(root, "sub"), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, "a.pdf"), "A");
  fs.writeFileSync(path.join(root, "sub", "b.pdf"), "B");
  fs.writeFileSync(path.join(outside, "secret.txt"), "S");
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "escape.pdf"));
  fs.symlinkSync(outside, path.join(root, "outdir"));
  fs.symlinkSync(path.join(root, "a.pdf"), path.join(root, "inside-link.pdf"));
  const fsApi = fs.promises;
  try {
    check("regular file resolves", (await resolveUploadFileStrict(root, "a.pdf", fsApi)) === fs.realpathSync(path.join(root, "a.pdf")));
    check("nested file resolves", !!(await resolveUploadFileStrict(root, "sub/b.pdf", fsApi)));
    check("symlink to a file outside the root refused", (await resolveUploadFileStrict(root, "escape.pdf", fsApi)) === null);
    check("symlinked directory escaping the root refused", (await resolveUploadFileStrict(root, "outdir/secret.txt", fsApi)) === null);
    check("symlink that stays inside the root also refused", (await resolveUploadFileStrict(root, "inside-link.pdf", fsApi)) === null);
    check("directory is not served", (await resolveUploadFileStrict(root, "sub", fsApi)) === null);
    check("missing file → null", (await resolveUploadFileStrict(root, "nope.pdf", fsApi)) === null);
    check("traversal rel refused even if passed directly", (await resolveUploadFileStrict(root, "../outside/secret.txt", fsApi)) === null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log("\n— uploadResponseHeaders —");
  const priv = uploadResponseHeaders("w9.pdf", false);
  check("private: no-store", priv["Cache-Control"].includes("no-store") && priv["Pragma"] === "no-cache");
  check("private: nosniff + noindex + same-origin CORP", priv["X-Content-Type-Options"] === "nosniff" && !!priv["X-Robots-Tag"] && priv["Cross-Origin-Resource-Policy"] === "same-origin");
  check("pdf inline", priv["Content-Type"] === "application/pdf" && priv["Content-Disposition"].startsWith("inline"));
  const pub = uploadResponseHeaders("logo.png", true);
  check("public logo cacheable", pub["Cache-Control"].startsWith("public"));
  const html = uploadResponseHeaders("evil.html", false);
  check("html forced to download as octet-stream with sandbox CSP", html["Content-Type"] === "application/octet-stream" && html["Content-Disposition"].startsWith("attachment") && html["Content-Security-Policy"].includes("sandbox"));
  const svg = uploadResponseHeaders("logo.svg", true);
  check("svg sandboxed (no script)", svg["Content-Security-Policy"].includes("sandbox") && svg["Content-Security-Policy"].includes("default-src 'none'"));
  check("filename header sanitized", !uploadResponseHeaders('a"b\r\n.pdf', false)["Content-Disposition"].includes('"b'));

  console.log("\n— registry —");
  check("png/svg/jpg are branding-eligible", isBrandingImagePath("x.png") && isBrandingImagePath("y.SVG") && isBrandingImagePath("z.jpeg"));
  check("pdf / html / no-extension are never branding-eligible", !isBrandingImagePath("x.pdf") && !isBrandingImagePath("x.html") && !isBrandingImagePath("x"));
  const tables = new Set(UPLOAD_OWNER_SOURCES.flatMap((s) => s.tables));
  for (const t of [
    "contractor_documents", "worker_documents", "worker_onboarding_documents", "remittance_sources", "contractor_contracts",
    "contract_versions", "dam_documents", "documents", "document_versions", "document_signature_requests", "biz_document_attachments",
    "proposal_attachments", "invoice_attachments", "contractor_invoice_attachments", "receipts", "expense_attachments",
    "trade_attachments", "vendor_documents", "vendor_invoices", "feedback_tickets", "system_documents",
    "companies", "enterprises", "company_branding", "invoice_templates", "contractor_branding",
  ]) check(`registry covers ${t}`, tables.has(t));
  const brandingKinds = UPLOAD_OWNER_SOURCES.filter((s) => s.tier === "branding").map((s) => s.kind).sort();
  check("only logo sources are public branding", JSON.stringify(brandingKinds) === JSON.stringify(
    ["company_branding_logo", "company_logo", "contractor_branding_logo", "enterprise_logo", "invoice_template_logo"]));
  const kinds = UPLOAD_OWNER_SOURCES.map((s) => s.kind);
  check("source kinds are unique", new Set(kinds).size === kinds.length);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
