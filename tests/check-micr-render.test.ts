/**
 * Release A — rendered-artifact regression check for the E-13B MICR line.
 *
 * Run: npx tsx tests/check-micr-render.test.ts
 *
 * Verifies the rendered glyphs, not just the source string:
 *   - micrenc.ttf provides real (non-.notdef) glyphs for the transit 'c',
 *     on-us 'd' and every digit, and NO glyph for '=' / ':' / ';'
 *   - buildMicrString() output selects only real glyphs when laid out with
 *     the production font, so no '=' or substitute character can appear
 *   - the string embeds into a pdf-lib PDF with the MICR font
 * No routing/account data from any real institution is used.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { buildMicrString, buildFractionalRouting } from "../server/check-micr.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

console.log("=== E-13B MICR rendered-glyph regression ===\n");

const fontPath = fs.existsSync("public/fonts/micrenc.ttf") ? "public/fonts/micrenc.ttf" : "client/public/fonts/micrenc.ttf";
const fontBytes = fs.readFileSync(fontPath);
ok("MICR font SHA-256 matches the reviewed E-13B asset",
  crypto.createHash("sha256").update(fontBytes).digest("hex") ===
  "cf20632b0573f1887e9ca7d66b61d52b92f38efc3c5ef4310484b1e11d7519ed");

// -- string builder ---------------------------------------------------
const micr = buildMicrString("021000021", "9876543210", "1011");
ok("business-check field order: auxOnUs / transit / on-us",
  micr === "d1011d  c021000021c  9876543210d", micr);
ok("no literal '=' in the MICR string", !micr.includes("="));
ok("only maps to E-13B chars (0-9, c, d, space)", /^[0-9cd ]+$/.test(micr));

// -- font glyph coverage (@pdf-lib/fontkit) --------------------------
const fk = (await import("@pdf-lib/fontkit")).default as any;
const font = fk.create(fontBytes);
const gid = (ch: string) => font.glyphForCodePoint(ch.codePointAt(0)!).id;
ok("transit 'c' has a real glyph", font.hasGlyphForCodePoint("c".codePointAt(0)!) && gid("c") !== 0);
ok("on-us 'd' has a real glyph", font.hasGlyphForCodePoint("d".codePointAt(0)!) && gid("d") !== 0);
ok("all digits 0-9 have real distinct glyphs", (() => {
  const ids = "0123456789".split("").map(gid);
  return ids.every((i) => i !== 0) && new Set(ids).size === 10;
})());
ok("'c' and 'd' are distinct glyphs from each other and from digits", (() => {
  const set = new Set(["c", "d", ...("0123456789".split(""))].map(gid));
  return set.size === 12 && !set.has(0);
})());
for (const bad of ["=", ":", ";", "-"]) {
  ok(`'${bad}' has NO glyph in micrenc.ttf (cannot appear in the MICR line)`,
    !font.hasGlyphForCodePoint(bad.codePointAt(0)!));
}

// -- every glyph the laid-out MICR line selects is real -------------
const run = font.layout(micr);
ok("layout of the MICR line contains no .notdef glyph",
  run.glyphs.every((g: any) => g.id !== 0));
ok("layout glyph count matches the source string length",
  run.glyphs.length === micr.length);

// -- embeds into a PDF with the MICR font ---------------------------
const { PDFDocument, rgb } = await import("pdf-lib");
const doc = await PDFDocument.create();
doc.registerFontkit(fk);
const embedded = await doc.embedFont(fontBytes);
const page = doc.addPage([300, 40]);
page.drawText(micr, { x: 4, y: 14, size: 12, font: embedded, color: rgb(0, 0, 0) });
const bytes = await doc.save();
ok("rendered PDF is non-empty and is a PDF", bytes.length > 400 && Buffer.from(bytes.slice(0, 5)).toString() === "%PDF-");
ok("MICR font width table is computed for the drawn string (no fallback)",
  embedded.widthOfTextAtSize(micr, 12) > 0);

// -- fractional routing --------------------------------------------
ok("fractional routing is FF-IIII / DDDD", buildFractionalRouting("121000358", "11") === "11-35\n1210");
ok("fractional routing rejects an invalid routing number", buildFractionalRouting("000000000") === "");

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
