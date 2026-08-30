/**
 * Rendered check-artifact generator for the Release A verify-first MICR/logo/fractional gate.
 *
 * Faithfully replicates the production renderCheckPdf() MICR, fractional-routing and
 * bank-logo drawing (server/routes.ts) using the same pdf-lib + micrenc.ttf loading,
 * renders sample check faces to PDF, and (when Ghostscript is available) rasterizes
 * the MICR band to PNG for glyph inspection.
 *
 * Output: /tmp/paylink-check-audit/  (never committed — see artifacts/check-pdf-audit/AUDIT.md)
 * No routing/account data from any real bank is used — synthetic values only.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Pure MICR/fractional builders — imported from the production module so the
// rendered sample uses the exact same string the real renderer draws.
import { buildMicrString, buildFractionalRouting, formatCheckNumber } from "../server/check-micr.ts";

const OUT = "/tmp/paylink-check-audit";
fs.mkdirSync(OUT, { recursive: true });

// Synthetic banking values (not any real institution)
const ROUTING = "123456789";
const ACCOUNT = "1234567890";
const CHECKNUM = "1011";

async function main() {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const hv = await doc.embedFont(StandardFonts.Helvetica);
  const hvB = await doc.embedFont(StandardFonts.HelveticaBold);

  const micrPath = fs.existsSync("public/fonts/micrenc.ttf")
    ? "public/fonts/micrenc.ttf"
    : "client/public/fonts/micrenc.ttf";
  const micrFont = await doc.embedFont(fs.readFileSync(micrPath));

  const page = doc.addPage([612, 792]);
  const H = 792;
  const z1x = (inches: number) => Math.round(inches * 72);
  const z1y = (inches: number) => Math.round(H - inches * 72);

  // ── MICR line — exact production placement (x 0.50in, baseline y 3.38in, 12pt) ──
  const micrString = buildMicrString(ROUTING, ACCOUNT, CHECKNUM);
  page.drawText(micrString, { x: z1x(0.5), y: z1y(3.38), size: 12, font: micrFont, color: rgb(0, 0, 0) });

  // Label copies in Helvetica so we can see the source characters next to the glyphs
  page.drawText(`MICR source chars: ${micrString}`, { x: z1x(0.5), y: z1y(3.75), size: 8, font: hv, color: rgb(0.3, 0.3, 0.3) });
  page.drawText(`(c = transit  d = on-us  digits map 0->gid4)`, { x: z1x(0.5), y: z1y(3.95), size: 8, font: hv, color: rgb(0.3, 0.3, 0.3) });

  // ── Fractional routing — exact production placement (x 5.25in, numerator y 0.545in default) ──
  const frac = buildFractionalRouting(ROUTING, "11");
  const [fracNum, fracDen] = frac.split("\n");
  const downIn = 0.125; // production default fractionalRoutingOffsetY
  const off = -72 * downIn;
  page.drawText(fracNum, { x: z1x(5.25), y: z1y(0.42) + off, size: 7.5, font: hv, color: rgb(0.25, 0.25, 0.25) });
  page.drawLine({ start: { x: z1x(5.25), y: z1y(0.47) + off }, end: { x: z1x(5.25) + 55, y: z1y(0.47) + off }, color: rgb(0.35, 0.35, 0.35), thickness: 0.6 });
  page.drawText(fracDen, { x: z1x(5.25), y: z1y(0.57) + off, size: 7.5, font: hv, color: rgb(0.25, 0.25, 0.25) });

  // ── Bank logo box — exact production placement (x 3.45in, y 0.46in, 86x20pt) BofA vector fallback ──
  const bx = z1x(3.45), by = z1y(0.46);
  page.drawRectangle({ x: bx, y: by, width: 86, height: 20, color: rgb(0.0, 0.12, 0.40), opacity: 0.95 });
  page.drawRectangle({ x: bx + 43, y: by, width: 43, height: 20, color: rgb(0.76, 0.02, 0.08), opacity: 0.95 });
  page.drawText("Bank of America", { x: bx + 5, y: by + 6, size: 6.5, font: hvB, color: rgb(1, 1, 1) });

  // top border reference line (check-face top)
  page.drawLine({ start: { x: 0, y: z1y(0) }, end: { x: 612, y: z1y(0) }, color: rgb(0.85, 0.85, 0.85), thickness: 0.5 });
  page.drawLine({ start: { x: 0, y: z1y(3.5) }, end: { x: 612, y: z1y(3.5) }, color: rgb(0.85, 0.85, 0.85), thickness: 0.5 });

  const bytes = await doc.save();
  const pdfPath = path.join(OUT, "check-face-sample.pdf");
  fs.writeFileSync(pdfPath, bytes);
  console.log("PDF:", pdfPath);
  console.log("MICR source string:", JSON.stringify(micrString));
  console.log("fractional:", JSON.stringify(frac));

  // Rasterize with Ghostscript if present
  try {
    const png = path.join(OUT, "check-face-sample.png");
    execFileSync("gs", [
      "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=png16m", "-r300",
      `-sOutputFile=${png}`, pdfPath,
    ], { stdio: "inherit" });
    console.log("PNG:", png);
    // Crop the MICR band (bottom ~0.6in of the 3.5in check face) at 300dpi:
    // check face top=0..3.5in -> px 0..1050; MICR band ~2.9..3.5in -> px 870..1050
    const micrCrop = path.join(OUT, "micr-band-300dpi.png");
    execFileSync("gs", [
      "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=png16m", "-r600",
      "-dUseCropBox",
      `-sOutputFile=${micrCrop}`, pdfPath,
    ], { stdio: "inherit" });
    console.log("MICR hi-res PNG:", micrCrop);
  } catch (e) {
    console.warn("Ghostscript rasterization skipped:", (e as Error).message);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
