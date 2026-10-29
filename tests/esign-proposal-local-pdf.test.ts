/**
 * DocuSign / Acrobat Sign proposal delivery must not depend on anonymous /uploads.
 *
 * POST /api/contractor-proposals/:id/request-signature used to pass
 * `${baseUrl}/uploads/<pdf>` to the adapter, which fetched the private approval
 * PDF back over public HTTP. It now passes the stored "/uploads/<pdf>" path,
 * which both adapters read from disk. fetch is stubbed; no network, no DB.
 *
 * Run: npx tsx tests/esign-proposal-local-pdf.test.ts
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DocuSignAdapter } from "../server/esign/docusign";
import { AcrobatSignAdapter } from "../server/esign/acrobat-sign";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

async function main() {
  const uploads = path.join(process.cwd(), "uploads");
  const createdDir = !fs.existsSync(uploads);
  fs.mkdirSync(uploads, { recursive: true });
  const name = `esign-test-${crypto.randomBytes(4).toString("hex")}.pdf`;
  const pdf = Buffer.from(`%PDF-1.4\n% ${name}\n%%EOF\n`);
  fs.writeFileSync(path.join(uploads, name), pdf);
  const storedPath = `/uploads/${name}`;

  const realFetch = globalThis.fetch;
  const calls: { url: string; body: string }[] = [];
  try {
    console.log("\n— route wiring —");
    const routes = fs.readFileSync(path.join(process.cwd(), "server/routes.ts"), "utf8");
    check("proposal request-signature no longer passes a public /uploads URL", !routes.includes("documentUrl: `${baseUrl}${pdfRel.file_path}`"));
    check("proposal request-signature passes the stored path", routes.includes("documentUrl: pdfRel.file_path,"));
    check("Documenso branch unchanged", routes.includes("const filePath = resolveTenantFilePath(pdfRel.file_path);"));

    console.log("\n— DocuSign adapter —");
    globalThis.fetch = (async (url: any, init?: any) => {
      calls.push({ url: String(url), body: typeof init?.body === "string" ? init.body : "" });
      return new Response(JSON.stringify({ envelopeId: "env-1", status: "sent" }), { status: 201, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const ds = await new DocuSignAdapter().createPackage({
      companyId: "co1", documentUrl: storedPath, documentName: "proposal.pdf", subject: "Sign",
      signers: [{ name: "C", email: "c@example.test", routingOrder: 1 }],
    }, { docusign: { accountId: "acct", accessToken: "tok", baseUrl: "https://demo.docusign.example/restapi" } } as any);
    check("envelope created", ds.providerEnvelopeId === "env-1");
    check("no request to any /uploads URL", !calls.some((c) => c.url.includes("/uploads")));
    const envelope = JSON.parse(calls.find((c) => c.url.includes("/envelopes"))?.body || "{}");
    check("envelope carries the stored PDF bytes", envelope.documents?.[0]?.documentBase64 === pdf.toString("base64"));

    console.log("\n— Acrobat Sign adapter —");
    calls.length = 0;
    globalThis.fetch = (async (url: any, init?: any) => {
      calls.push({ url: String(url), body: Buffer.isBuffer(init?.body) ? init.body.toString("latin1") : typeof init?.body === "string" ? init.body : "" });
      if (String(url).includes("/transientDocuments")) return new Response(JSON.stringify({ transientDocumentId: "td-1" }), { status: 201, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ id: "agr-1" }), { status: 201, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const ac = await new AcrobatSignAdapter().createPackage({
      companyId: "co1", documentUrl: storedPath, documentName: "proposal.pdf", subject: "Sign",
      signers: [{ name: "C", email: "c@example.test", routingOrder: 1 }],
    }, { acrobat_sign: { baseUrl: "https://api.acrobat.example/api/rest/v6", accessToken: "tok" } } as any);
    check("agreement created", !!ac.providerEnvelopeId);
    check("no request to any /uploads URL", !calls.some((c) => c.url.includes("/uploads")));
    check("transient upload carries the stored PDF bytes", !!calls.find((c) => c.url.includes("/transientDocuments"))?.body.includes(pdf.toString("latin1")));
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(path.join(uploads, name), { force: true });
    if (createdDir) fs.rmSync(uploads, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
