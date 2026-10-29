/**
 * GET /uploads/* access control over real HTTP — no database.
 *
 * Real Express + express-session, real files and symlinks on disk, the
 * production createUploadsHandler. Ownership lookup and company access are
 * injected so every branch of the boundary is exercised deterministically;
 * tests/uploads-access-db.test.ts covers the real SQL and session loader.
 *
 * Traversal probes use http.request({ path }) because fetch() and
 * http.request(urlString) normalise "%2e%2e" client-side, which would make
 * them vacuous.
 *
 * Run: npx tsx tests/uploads-access-http.test.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";
import session from "express-session";
import { createUploadsHandler, type UploadOwner } from "../server/uploads-access";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

type Actor = { id: string; companyId: string };
const USERS: Record<string, Actor> = { adminA: { id: "adminA", companyId: "coA" }, adminB: { id: "adminB", companyId: "coB" } };

const OWNERS: Record<string, UploadOwner[]> = {
  "w9-a.pdf": [{ tier: "company", companyId: "coA" }],
  "logo-a.png": [{ tier: "logo", companyId: "coA" }],
  "form.pdf": [{ tier: "signed_in", companyId: null }],
  // Logo column pointed at a private scan: stays private.
  "id-scan.png": [{ tier: "logo", companyId: "coA" }, { tier: "company", companyId: "coA" }],
  // Company B created its own record pointing at company A's file.
  "reref.pdf": [{ tier: "company", companyId: "coA" }, { tier: "company", companyId: "coB" }],
  "nested/signed.pdf": [{ tier: "company", companyId: "coA" }],
  "page.svg": [{ tier: "logo", companyId: "coA" }],
  "escape.pdf": [{ tier: "company", companyId: "coA" }],
};

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-access-"));
  const root = path.join(tmp, "uploads");
  fs.mkdirSync(path.join(root, "nested"), { recursive: true });
  for (const f of [...Object.keys(OWNERS).filter((f) => f !== "escape.pdf"), "orphan.pdf", "orphan-logo.png", "db-error.pdf"]) {
    fs.writeFileSync(path.join(root, f), `BODY:${f}`);
  }
  fs.writeFileSync(path.join(tmp, "secret.pdf"), "OUTSIDE");
  fs.symlinkSync(path.join(tmp, "secret.pdf"), path.join(root, "escape.pdf"));

  const app = express();
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.get("/login/:id", (req, res) => { req.session.userId = req.params.id; res.end("ok"); });
  app.use("/uploads", createUploadsHandler({
    uploadsDir: root,
    findOwners: async (rel) => {
      if (rel === "db-error.pdf") throw new Error("connection reset");
      return OWNERS[rel] ?? [];
    },
    loadActor: async (req) => (req.session?.userId ? USERS[req.session.userId] ?? null : null),
    canAccessCompany: async (actor, companyId) => !!companyId && (actor as Actor).companyId === companyId,
  }));
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  const get = (p: string, cookie?: string, method = "GET") => new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: p, method, headers: cookie ? { cookie } : {} }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
  const loginAs = async (id: string) => (await get(`/login/${id}`)).headers["set-cookie"]![0].split(";")[0];

  try {
    const a = await loginAs("adminA");
    const b = await loginAs("adminB");
    const ghost = await loginAs("deactivated");

    console.log("\n— anonymous —");
    let r = await get("/uploads/w9-a.pdf");
    check("anonymous W-9 → 401, no body leak", r.status === 401 && !r.body.includes("BODY"), `${r.status}`);
    check("denial is not cacheable", r.headers["cache-control"] === "no-store");
    r = await get("/uploads/form.pdf");
    check("anonymous signed-in-only document → 401", r.status === 401);
    r = await get("/uploads/nested/signed.pdf");
    check("anonymous signed contract (nested path) → 401", r.status === 401);
    r = await get("/uploads/w9-a.pdf", ghost);
    check("session whose user no longer loads → 401", r.status === 401);

    console.log("\n— authorized —");
    r = await get("/uploads/w9-a.pdf", a);
    check("owning-company admin gets the W-9", r.status === 200 && r.body === "BODY:w9-a.pdf", `${r.status}`);
    check("private file is private, no-store + nosniff", r.headers["cache-control"] === "private, no-store" && r.headers["x-content-type-options"] === "nosniff");
    check("content type from extension", String(r.headers["content-type"]).startsWith("application/pdf"));
    r = await get("/uploads/nested/signed.pdf", a);
    check("owning-company admin gets nested signed contract", r.status === 200 && r.body === "BODY:nested/signed.pdf");
    r = await get("/uploads/form.pdf", b);
    check("platform-wide document → any signed-in user", r.status === 200);
    r = await get("/uploads/w9-a.pdf", a, "HEAD");
    check("HEAD allowed for authorized user", r.status === 200);

    console.log("\n— cross-tenant / ownership —");
    r = await get("/uploads/w9-a.pdf", b);
    check("other company's admin → 404 (existence not revealed)", r.status === 404 && r.body === "Not found");
    r = await get("/uploads/reref.pdf", b);
    check("re-referencing another company's file does not unlock it", r.status === 404);
    r = await get("/uploads/reref.pdf", a);
    check("...and is also denied to company A (every owner must allow)", r.status === 404);
    r = await get("/uploads/orphan.pdf", a);
    check("file on disk with no owning record → 404", r.status === 404);
    r = await get("/uploads/orphan.pdf");
    check("unknown file, anonymous → not served (401 before any lookup)", r.status === 401);
    r = await get("/uploads/orphan-logo.png");
    check("unknown image, anonymous → 404", r.status === 404);
    r = await get("/uploads/does-not-exist.pdf", a);
    check("missing file → 404", r.status === 404);
    r = await get("/uploads/db-error.pdf", a);
    check("ownership lookup error → 503, fails closed", r.status === 503 && !r.body.includes("BODY"));

    console.log("\n— public logos —");
    r = await get("/uploads/logo-a.png");
    check("logo loads anonymously", r.status === 200 && r.body === "BODY:logo-a.png");
    check("logo is cacheable", String(r.headers["cache-control"]).startsWith("public"));
    r = await get("/uploads/id-scan.png");
    check("image referenced by a logo AND a private record stays private", r.status === 401);
    r = await get("/uploads/id-scan.png", b);
    check("...and is denied cross-company", r.status === 404);
    r = await get("/uploads/page.svg");
    check("public SVG logo is sandboxed", r.status === 200 && String(r.headers["content-security-policy"]).startsWith("sandbox"));

    console.log("\n— traversal / symlinks (raw request paths) —");
    for (const p of [
      "/uploads/../secret.pdf",
      "/uploads/%2e%2e/secret.pdf",
      "/uploads/%2E%2E%2Fsecret.pdf",
      "/uploads/nested/..%2f..%2fsecret.pdf",
      "/uploads/..%5csecret.pdf",
      "/uploads/%252e%252e/secret.pdf",
      "/uploads/w9-a.pdf%00.png",
      "/uploads/./w9-a.pdf",
      "/uploads/.hidden",
    ]) {
      r = await get(p, a);
      check(`${p} → 404 from the uploads handler`, r.status === 404 && r.body === "Not found", `${r.status} ${r.body.slice(0, 40)}`);
    }
    r = await get("/uploads/escape.pdf", a);
    check("symlink escaping the uploads root → 404 even with an owning record", r.status === 404 && r.body === "Not found");

    console.log("\n— methods —");
    r = await get("/uploads/logo-a.png", undefined, "POST");
    check("POST → 405", r.status === 405);
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

declare module "express-session" { interface SessionData { userId?: string } }

main().catch((e) => { console.error(e); process.exit(1); });
