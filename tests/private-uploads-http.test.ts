/**
 * Private uploads — HTTP level, no database.
 *
 * Boots a real Express app with express-session and the production handler +
 * session→actor loader (server/auth/upload-route.ts), over a real temporary
 * uploads directory with real files and symlinks. Ownership facts come from an
 * in-memory map standing in for the registry (the registry's SQL is exercised
 * end-to-end by tests/private-uploads-db.test.ts).
 *
 * Also asserts statically that server/index.ts no longer serves /uploads via
 * express.static and that registerRoutes mounts the guarded handler.
 *
 * Run: npx tsx tests/private-uploads-http.test.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";
import session from "express-session";
import { createUploadsHandler, createSessionActorLoader } from "../server/auth/upload-route";
import type { UploadOwner } from "../server/auth/upload-access-guard";
import { expandRoleForGuard } from "../server/routes";
import { isPlatformOrgAdminRole, isPlatformCompanyBypassRole } from "../server/auth/org-ownership-guard";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

type FixtureUser = { id: string; role: string; companyId: string | null; workerId: string | null; isActive: boolean; vendorId?: string };

const USERS: Record<string, FixtureUser> = {
  adminA: { id: "adminA", role: "admin", companyId: "coA", workerId: null, isActive: true },
  tenantAdminA: { id: "tenantAdminA", role: "tenant_admin", companyId: "coA", workerId: null, isActive: true },
  supervisorA: { id: "supervisorA", role: "supervisor", companyId: "coA", workerId: null, isActive: true },
  adminB: { id: "adminB", role: "admin", companyId: "coB", workerId: null, isActive: true },
  adminA2: { id: "adminA2", role: "admin", companyId: "coA2", workerId: null, isActive: true }, // sibling company, same enterprise
  contractorA: { id: "contractorA", role: "contractor", companyId: "coA", workerId: "wContractorA", isActive: true },
  contractorA_other: { id: "contractorA_other", role: "contractor", companyId: "coA", workerId: "wContractorA2", isActive: true },
  employeeA: { id: "employeeA", role: "employee", companyId: "coA", workerId: "wEmployeeA", isActive: true },
  employeeA_other: { id: "employeeA_other", role: "employee", companyId: "coA", workerId: "wEmployeeA2", isActive: true },
  vendorA: { id: "vendorA", role: "vendor", companyId: "coA", workerId: null, isActive: true, vendorId: "vendor1" },
  vendorA_other: { id: "vendorA_other", role: "vendor", companyId: "coA", workerId: null, isActive: true, vendorId: "vendor2" },
  platformAdmin: { id: "platformAdmin", role: "platform_super_admin", companyId: null, workerId: null, isActive: true },
  platformSupport: { id: "platformSupport", role: "platform_support", companyId: null, workerId: null, isActive: true },
  mfaPending: { id: "mfaPending", role: "admin", companyId: "coA", workerId: null, isActive: true },
};

const o = (x: Partial<UploadOwner>): UploadOwner => ({
  kind: "x", tier: "restricted", companyId: "coA", subjectWorkerIds: [], subjectUserIds: [], subjectVendorId: null, ...x,
});

// canonical reference → owner records (stands in for the DB registry)
const OWNERS: Record<string, UploadOwner[]> = {
  "/uploads/w9-contractorA.pdf": [o({ kind: "contractor_document", subjectWorkerIds: ["wContractorA"] })],
  "/uploads/workerdoc-employeeA.pdf": [o({ kind: "worker_document", subjectWorkerIds: ["wEmployeeA"] })],
  "/uploads/company-handbook.pdf": [o({ kind: "company_document", tier: "staff" })],
  "/uploads/vendor1-invoice.pdf": [o({ kind: "vendor_invoice", subjectVendorId: "vendor1" })],
  "/uploads/signed/coA/agreement.pdf": [o({ kind: "contract_signed_pdf", subjectWorkerIds: ["wContractorA"] })],
  "/uploads/coB-payroll.pdf": [o({ kind: "dam_document", companyId: "coB" })],
  "/uploads/coA2-doc.pdf": [o({ kind: "dam_document", companyId: "coA2" })],
  "/uploads/logo-coA.png": [o({ kind: "company_logo", tier: "branding" })],
  "/uploads/contractor-logo.svg": [o({ kind: "contractor_branding_logo", tier: "branding" })],
  // a logo column pointed at a private image (e.g. a photo-ID scan): private wins
  "/uploads/photo-id.png": [o({ kind: "company_logo", tier: "branding" }), o({ kind: "worker_document", subjectWorkerIds: ["wEmployeeA"] })],
  // attacker (employeeA_other) created their own record pointing at employeeA's file
  "/uploads/rereferenced.pdf": [
    o({ kind: "worker_document", subjectWorkerIds: ["wEmployeeA"] }),
    o({ kind: "dam_document", subjectUserIds: ["employeeA_other"] }),
  ],
  "/uploads/escape.pdf": [o({ kind: "dam_document" })],          // symlink to a file outside the root
  "/uploads/linked-logo.png": [o({ kind: "company_logo", tier: "branding" })], // symlink, even if "public"
  "/uploads/system-form.pdf": [o({ kind: "system_document", tier: "global", companyId: null })],
  "/uploads/active-html.html": [o({ kind: "dam_document" })],
};
let ownerLookupThrows = false;
let ownerLookups = 0;

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pu-http-"));
  const root = path.join(tmp, "uploads");
  fs.mkdirSync(path.join(root, "signed", "coA"), { recursive: true });
  for (const ref of Object.keys(OWNERS)) {
    const rel = ref.replace(/^\/uploads\//, "");
    if (rel === "escape.pdf" || rel === "linked-logo.png") continue;
    fs.writeFileSync(path.join(root, rel), `BODY:${rel}`);
  }
  fs.writeFileSync(path.join(root, "orphan.pdf"), "ORPHAN — on disk, referenced by nothing");
  fs.writeFileSync(path.join(root, "orphan.png"), "ORPHAN IMAGE");
  fs.writeFileSync(path.join(tmp, "outside-secret.pdf"), "OUTSIDE SECRET");
  fs.symlinkSync(path.join(tmp, "outside-secret.pdf"), path.join(root, "escape.pdf"));
  fs.symlinkSync(path.join(root, "logo-coA.png"), path.join(root, "linked-logo.png"));

  const app = express();
  app.use(session({ secret: "pu-http-test", resave: false, saveUninitialized: false, cookie: { maxAge: 60_000 } }));
  app.post("/login/:who", (req, res) => {
    const u = USERS[req.params.who];
    (req.session as any).userId = u.id;
    if (u.id === "mfaPending") (req.session as any).mfaEnrollmentRequired = true;
    if (req.query.shortLived) req.session.cookie.maxAge = 400;
    req.session.save(() => res.json({ ok: true }));
  });
  app.post("/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
  app.use("/uploads", createUploadsHandler({
    uploadsDir: root,
    resolveOwners: async (ref) => {
      ownerLookups++;
      if (ownerLookupThrows) throw new Error("db down");
      return OWNERS[ref.canonical] ?? [];
    },
    loadActor: createSessionActorLoader({
      getUser: async (id) => Object.values(USERS).find((u) => u.id === id) ?? null,
      resolveVendorId: async (id) => Object.values(USERS).find((u) => u.id === id)?.vendorId ?? null,
      canAccessStoredCompany: async (user, companyId) => {
        const u = USERS[user.id];
        if (isPlatformCompanyBypassRole(u.role)) return true;
        if (!companyId) return false;
        return u.companyId === companyId;
      },
      expandRoleForGuard,
      isPlatformOrgAdminRole,
    }),
  }));

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  const login = async (who: string, qs = ""): Promise<string> => {
    const res = await fetch(`${base}/login/${who}${qs}`, { method: "POST" });
    return (res.headers.get("set-cookie") || "").split(";")[0];
  };
  const get = (p: string, cookie?: string, method = "GET") =>
    new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      // Options form, not a URL string: a URL string would be WHATWG-normalized
      // ("/uploads/%2e%2e/x" → "/x") and never reach the handler as sent.
      const u = new URL(base);
      const req = http.request({ hostname: u.hostname, port: u.port, path: p, method, headers: cookie ? { cookie } : {} }, (res) => {
        let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
      });
      req.on("error", reject); req.end();
    });

  try {
    const s: Record<string, string> = {};
    for (const who of Object.keys(USERS)) s[who] = await login(who);

    console.log("\n1. Anonymous access to private documents (the original exposure)");
    for (const p of ["/uploads/w9-contractorA.pdf", "/uploads/workerdoc-employeeA.pdf", "/uploads/signed/coA/agreement.pdf", "/uploads/vendor1-invoice.pdf", "/uploads/coB-payroll.pdf"]) {
      const r = await get(p);
      check(`anonymous GET ${p} → 401, body not leaked`, r.status === 401 && !r.body.includes("BODY:"), `${r.status}`);
    }
    const lookupsBefore = ownerLookups;
    await get("/uploads/w9-contractorA.pdf");
    check("anonymous non-image probe does no ownership/DB work", ownerLookups === lookupsBefore);
    const nx = await get("/uploads/does-not-exist.pdf");
    check("anonymous: nonexistent file also 401 (no existence oracle)", nx.status === 401);
    const deny = await get("/uploads/w9-contractorA.pdf");
    check("denial response is no-store", String(deny.headers["cache-control"]).includes("no-store"));

    console.log("\n2. Authorized users download permitted documents");
    let r = await get("/uploads/w9-contractorA.pdf", s.adminA);
    check("company admin downloads contractor W-9", r.status === 200 && r.body === "BODY:w9-contractorA.pdf", `${r.status}`);
    check("private download is no-store + nosniff", String(r.headers["cache-control"]).includes("no-store") && r.headers["x-content-type-options"] === "nosniff");
    check("pdf served as application/pdf inline", r.headers["content-type"] === "application/pdf" && String(r.headers["content-disposition"]).startsWith("inline"));
    r = await get("/uploads/w9-contractorA.pdf", s.tenantAdminA);
    check("tenant_admin (aliased to admin) downloads W-9", r.status === 200);
    r = await get("/uploads/signed/coA/agreement.pdf", s.adminA);
    check("signed contract in nested signed/<co>/ path downloads for admin", r.status === 200);
    r = await get("/uploads/company-handbook.pdf", s.supervisorA);
    check("supervisor downloads staff-tier company document", r.status === 200);
    r = await get("/uploads/system-form.pdf", s.employeeA);
    check("any signed-in user downloads a global system document", r.status === 200);
    r = await get("/uploads/w9-contractorA.pdf", s.adminA, "HEAD");
    check("HEAD works for an authorized user (no body)", r.status === 200 && r.body === "" && r.headers["content-length"] === String("BODY:w9-contractorA.pdf".length));

    console.log("\n3. Cross-tenant access denied");
    r = await get("/uploads/w9-contractorA.pdf", s.adminB);
    check("tenant-B admin → 404 for tenant-A W-9", r.status === 404 && !r.body.includes("BODY:"));
    r = await get("/uploads/coB-payroll.pdf", s.adminA);
    check("tenant-A admin → 404 for tenant-B file", r.status === 404);
    r = await get("/uploads/coB-payroll.pdf", s.contractorA);
    check("tenant-A contractor → 404 for tenant-B file", r.status === 404);

    console.log("\n4. Cross-company access denied");
    r = await get("/uploads/coA2-doc.pdf", s.adminA);
    check("admin of company A → 404 for sibling company A2 without a grant", r.status === 404);
    r = await get("/uploads/w9-contractorA.pdf", s.adminA2);
    check("admin of company A2 → 404 for company A W-9", r.status === 404);

    console.log("\n5. Contractor / worker / vendor / role permissions");
    r = await get("/uploads/w9-contractorA.pdf", s.contractorA);
    check("contractor downloads own W-9", r.status === 200);
    r = await get("/uploads/w9-contractorA.pdf", s.contractorA_other);
    check("other contractor in same company → 404", r.status === 404);
    r = await get("/uploads/signed/coA/agreement.pdf", s.contractorA);
    check("contractor downloads own signed agreement", r.status === 200);
    r = await get("/uploads/workerdoc-employeeA.pdf", s.employeeA);
    check("employee downloads own worker document", r.status === 200);
    r = await get("/uploads/workerdoc-employeeA.pdf", s.employeeA_other);
    check("other employee in same company → 404", r.status === 404);
    r = await get("/uploads/w9-contractorA.pdf", s.employeeA);
    check("employee cannot read a contractor's W-9", r.status === 404);
    r = await get("/uploads/w9-contractorA.pdf", s.supervisorA);
    check("supervisor cannot read a restricted tax document", r.status === 404);
    r = await get("/uploads/company-handbook.pdf", s.employeeA);
    check("plain employee cannot read staff-tier company document (same tenant is not enough)", r.status === 404);
    r = await get("/uploads/vendor1-invoice.pdf", s.vendorA);
    check("vendor downloads own invoice", r.status === 200);
    r = await get("/uploads/vendor1-invoice.pdf", s.vendorA_other);
    check("other vendor of same payer → 404", r.status === 404);
    r = await get("/uploads/w9-contractorA.pdf", s.vendorA);
    check("vendor cannot read contractor W-9", r.status === 404);
    r = await get("/uploads/rereferenced.pdf", s.employeeA_other);
    check("own record re-referencing another worker's file does not unlock it", r.status === 404);
    r = await get("/uploads/rereferenced.pdf", s.employeeA);
    check("…and the true subject is not granted via the attacker's record either (both owners must allow)", r.status === 404);
    r = await get("/uploads/coB-payroll.pdf", s.platformAdmin);
    check("platform super admin (org-admin role) reads tenant file", r.status === 200);
    r = await get("/uploads/coB-payroll.pdf", s.platformSupport);
    check("platform_support gets no broad file bypass → 404", r.status === 404);

    console.log("\n6. Expired and revoked sessions");
    const shortLived = await login("adminA", "?shortLived=1");
    r = await get("/uploads/w9-contractorA.pdf", shortLived);
    check("short-lived session works before expiry", r.status === 200);
    await new Promise((res) => setTimeout(res, 700));
    r = await get("/uploads/w9-contractorA.pdf", shortLived);
    check("expired session → 401", r.status === 401, `${r.status}`);
    const toLogout = await login("adminA");
    await fetch(`${base}/logout`, { method: "POST", headers: { cookie: toLogout } });
    r = await get("/uploads/w9-contractorA.pdf", toLogout);
    check("destroyed (logged-out) session → 401", r.status === 401);
    USERS.adminA.isActive = false;
    r = await get("/uploads/w9-contractorA.pdf", s.adminA);
    check("deactivated user's live session → 401 on next request", r.status === 401);
    USERS.adminA.isActive = true;
    r = await get("/uploads/w9-contractorA.pdf", s.mfaPending);
    check("MFA-enrollment-pending session cannot download", r.status === 401);
    r = await get("/uploads/w9-contractorA.pdf", "connect.sid=s%3Aforged.signature");
    check("forged session cookie → 401", r.status === 401);

    console.log("\n7. Path traversal and symlink escapes");
    for (const p of [
      "/uploads/..%2f..%2fetc%2fpasswd", "/uploads/%2e%2e/outside-secret.pdf", "/uploads/signed/..%2f..%2foutside-secret.pdf",
      "/uploads/%252e%252e%252foutside-secret.pdf", "/uploads/..%5coutside-secret.pdf", "/uploads/w9-contractorA.pdf%00.png",
      "/uploads/.%2e/outside-secret.pdf",
    ]) {
      r = await get(p, s.platformAdmin);
      // body "Not found" = rejected by the uploads handler itself (not Express's fallthrough 404)
      check(`traversal ${p} → 404 by the uploads handler, even for platform admin`, r.status === 404 && r.body === "Not found", `${r.status} ${r.body.slice(0, 40)}`);
    }
    r = await get("/uploads/escape.pdf", s.adminA);
    check("DB-referenced symlink pointing outside the root → 404", r.status === 404 && !r.body.includes("SECRET"));
    r = await get("/uploads/linked-logo.png");
    check("symlink under a public logo reference → 404", r.status === 404);

    console.log("\n8. Unknown ownership fails closed");
    r = await get("/uploads/orphan.pdf", s.adminA);
    check("unreferenced file on disk → 404 for company admin", r.status === 404 && !r.body.includes("ORPHAN"));
    r = await get("/uploads/orphan.pdf", s.platformAdmin);
    check("unreferenced file on disk → 404 for platform admin", r.status === 404);
    r = await get("/uploads/orphan.png");
    check("unreferenced image → 401 anonymously (images are not public by extension)", r.status === 401 && !r.body.includes("ORPHAN"));
    ownerLookupThrows = true;
    r = await get("/uploads/logo-coA.png");
    check("ownership lookup failure → 503, never served", r.status === 503 && !r.body.includes("BODY:"));
    r = await get("/uploads/w9-contractorA.pdf", s.adminA);
    check("ownership lookup failure for signed-in admin → 503", r.status === 503);
    ownerLookupThrows = false;

    console.log("\n9. Public email logos remain accessible");
    r = await get("/uploads/logo-coA.png");
    check("company logo served anonymously (email clients)", r.status === 200 && r.body === "BODY:logo-coA.png");
    check("public logo is cacheable, image/png, nosniff", String(r.headers["cache-control"]).startsWith("public") && r.headers["content-type"] === "image/png" && r.headers["x-content-type-options"] === "nosniff");
    r = await get("/uploads/contractor-logo.svg");
    check("contractor SVG logo served with script-free sandbox CSP", r.status === 200 && String(r.headers["content-security-policy"]).includes("sandbox"));
    r = await get("/uploads/logo-coA.png", s.adminB);
    check("public logo also served to signed-in users of other tenants", r.status === 200);

    console.log("\n10. Public assets cannot expose private files");
    r = await get("/uploads/photo-id.png");
    check("image referenced by a logo column AND a private record → 401 anonymously", r.status === 401 && !r.body.includes("BODY:"));
    r = await get("/uploads/photo-id.png", s.employeeA_other);
    check("…and 404 for a non-subject employee", r.status === 404);
    r = await get("/uploads/photo-id.png", s.employeeA);
    check("…subject can still read it, privately (no-store)", r.status === 200 && String(r.headers["cache-control"]).includes("no-store"));
    r = await get("/uploads/active-html.html", s.adminA);
    check("authorized HTML upload forced to attachment octet-stream (no stored XSS)", r.status === 200 && r.headers["content-type"] === "application/octet-stream" && String(r.headers["content-disposition"]).startsWith("attachment"));

    console.log("\nMethod handling");
    r = await get("/uploads/logo-coA.png", undefined, "DELETE");
    check("non-GET/HEAD → 405", r.status === 405);

    console.log("\nStatic wiring");
    const indexSrc = fs.readFileSync(path.join(process.cwd(), "server/index.ts"), "utf8");
    check("server/index.ts no longer mounts express.static for /uploads",
      !/app\.use\(\s*["']\/uploads["']\s*,\s*express\.static/.test(indexSrc) && !/express\.static\(\s*uploadsDir/.test(indexSrc));
    const routesSrc = fs.readFileSync(path.join(process.cwd(), "server/routes.ts"), "utf8");
    check("registerRoutes mounts the guarded /uploads handler with the DB registry",
      /app\.use\("\/uploads",\s*createUploadsHandler\(/.test(routesSrc) && routesSrc.includes("resolveUploadOwners((q) => db.execute(q), ref)"));
    check("no other express.static mount of an uploads directory anywhere in server/",
      !fs.readdirSync(path.join(process.cwd(), "server")).filter((f) => f.endsWith(".ts")).some((f) =>
        /express\.static\([^)]*upload/i.test(fs.readFileSync(path.join(process.cwd(), "server", f), "utf8"))));
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
