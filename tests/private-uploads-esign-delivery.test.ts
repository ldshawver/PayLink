/**
 * Private uploads — DocuSign / Acrobat Sign proposal delivery without public
 * document URLs. No database, no provider network calls (fetch is stubbed).
 *
 * Before: POST /api/contractor-proposals/:id/request-signature passed
 * `${baseUrl}/uploads/<pdf>` as documentUrl and the adapter fetched it back
 * over HTTP — which only worked while /uploads was anonymous, and let the
 * adapters fetch any http(s) URL server-side. Now the route reads the bytes
 * from the uploads root (readStoredUploadForDelivery) and adapters take
 * documentContent only.
 *
 * Run: npx tsx tests/private-uploads-esign-delivery.test.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readStoredUploadForDelivery } from "../server/esign/stored-document";
import { DocuSignAdapter } from "../server/esign/docusign";
import { AcrobatSignAdapter } from "../server/esign/acrobat-sign";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pu-esign-"));
  const root = path.join(tmp, "uploads");
  fs.mkdirSync(path.join(root, "signed", "co1"), { recursive: true });
  const pdf = Buffer.from("%PDF-1.4\n% proposal approval pdf\n%%EOF\n");
  fs.writeFileSync(path.join(root, "proposal-123.pdf"), pdf);
  fs.writeFileSync(path.join(root, "signed", "co1", "s.pdf"), pdf);
  fs.writeFileSync(path.join(tmp, "outside.pdf"), "OUTSIDE");
  fs.symlinkSync(path.join(tmp, "outside.pdf"), path.join(root, "link.pdf"));

  const realFetch = globalThis.fetch;
  try {
    console.log("\n— readStoredUploadForDelivery —");
    check("reads /uploads/<file> from the uploads root", (await readStoredUploadForDelivery("/uploads/proposal-123.pdf", root))?.equals(pdf) === true);
    check("reads legacy uploads/<file> form", (await readStoredUploadForDelivery("uploads/proposal-123.pdf", root))?.equals(pdf) === true);
    check("reads nested signed/<co>/ path", (await readStoredUploadForDelivery("/uploads/signed/co1/s.pdf", root)) !== null);
    check("ignores a query string", (await readStoredUploadForDelivery("/uploads/proposal-123.pdf?v=2", root)) !== null);
    check("external http URL is NOT fetched → null", (await readStoredUploadForDelivery("https://attacker.example/x.pdf", root)) === null);
    check("absolute app URL to /uploads is not fetched → null", (await readStoredUploadForDelivery("https://mypaylink.app/uploads/proposal-123.pdf", root)) === null);
    check("traversal → null", (await readStoredUploadForDelivery("/uploads/../outside.pdf", root)) === null);
    check("encoded traversal → null", (await readStoredUploadForDelivery("/uploads/%2e%2e/outside.pdf", root)) === null);
    check("symlink escape → null", (await readStoredUploadForDelivery("/uploads/link.pdf", root)) === null);
    check("OS-absolute path outside root → null", (await readStoredUploadForDelivery("/etc/passwd", root)) === null);
    check("missing file → null", (await readStoredUploadForDelivery("/uploads/missing.pdf", root)) === null);
    check("null → null", (await readStoredUploadForDelivery(null, root)) === null);

    console.log("\n— DocuSign adapter —");
    const calls: { url: string; body?: string }[] = [];
    globalThis.fetch = (async (url: any, init?: any) => {
      calls.push({ url: String(url), body: typeof init?.body === "string" ? init.body : init?.body ? "[binary]" : undefined });
      if (String(url).includes("/envelopes")) {
        return new Response(JSON.stringify({ envelopeId: "env-1", status: "sent" }), { status: 201, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ id: "x" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const docuSignConfig = { docusign: { accountId: "acct", accessToken: "tok", baseUrl: "https://demo.docusign.example/restapi" } } as any;
    const ds = await new DocuSignAdapter().createPackage({
      companyId: "co1",
      documentContent: pdf,
      documentName: "proposal.pdf",
      subject: "Sign",
      signers: [{ name: "C", email: "c@example.test", routingOrder: 1 }],
    }, docuSignConfig);
    check("DocuSign envelope created", ds.providerEnvelopeId === "env-1");
    check("DocuSign made no request to any /uploads URL", !calls.some((c) => c.url.includes("/uploads")));
    const envelope = JSON.parse(calls.find((c) => c.url.includes("/envelopes"))?.body || "{}");
    check("DocuSign envelope carries the exact PDF bytes (base64)", envelope.documents?.[0]?.documentBase64 === pdf.toString("base64"));

    console.log("\n— Acrobat Sign adapter —");
    calls.length = 0;
    globalThis.fetch = (async (url: any, init?: any) => {
      calls.push({ url: String(url), body: Buffer.isBuffer(init?.body) ? init.body.toString("latin1") : typeof init?.body === "string" ? init.body : undefined });
      if (String(url).includes("/transientDocuments")) return new Response(JSON.stringify({ transientDocumentId: "td-1" }), { status: 201, headers: { "content-type": "application/json" } });
      if (String(url).includes("/agreements")) return new Response(JSON.stringify({ id: "agr-1" }), { status: 201, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const acrobatConfig = { acrobat_sign: { baseUrl: "https://api.acrobat.example/api/rest/v6", accessToken: "tok" } } as any;
    const ac = await new AcrobatSignAdapter().createPackage({
      companyId: "co1",
      documentContent: pdf,
      documentName: "proposal.pdf",
      subject: "Sign",
      signers: [{ name: "C", email: "c@example.test", routingOrder: 1 }],
    }, acrobatConfig);
    check("Acrobat agreement created", !!ac.providerEnvelopeId);
    check("Acrobat made no request to any /uploads URL", !calls.some((c) => c.url.includes("/uploads")));
    const transient = calls.find((c) => c.url.includes("/transientDocuments"));
    check("Acrobat transient upload carries the PDF bytes", !!transient?.body?.includes(pdf.toString("latin1")));

    console.log("\n— route wiring (static) —");
    const routes = fs.readFileSync(path.join(process.cwd(), "server/routes.ts"), "utf8");
    check("proposal request-signature no longer builds a public /uploads URL", !routes.includes("documentUrl: `${baseUrl}${pdfRel.file_path}`"));
    check("no createPackage caller passes documentUrl", !/createPackage\(\{[\s\S]{0,200}documentUrl:/.test(routes));
    check("proposal flow reads the PDF via readStoredUploadForDelivery(pdfRel.file_path, resolvedUploadDir)",
      routes.includes("readStoredUploadForDelivery(pdfRel.file_path, resolvedUploadDir)") && routes.includes("documentContent: providerDocument!"));
    check("generic e-sign send reads doc.fileUrl server-side and passes bytes",
      routes.includes("readStoredUploadForDelivery(doc.fileUrl, resolvedUploadDir)") && /documentContent,\s*\n\s*documentName: doc\.fileName/.test(routes));
    check("Documenso proposal path unchanged (still reads the local file for createDocumensoDocument)",
      routes.includes("const filePath = resolveTenantFilePath(pdfRel.file_path);") && routes.includes("pdfBuffer: await fs.promises.readFile(filePath),"));
    for (const f of ["docusign.ts", "acrobat-sign.ts"]) {
      const src = fs.readFileSync(path.join(process.cwd(), "server/esign", f), "utf8");
      check(`${f}: no URL fetch / cwd file read of the document`, !src.includes("documentUrl") && !src.includes("readFileSync") && !src.includes("process.cwd()"));
    }
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
