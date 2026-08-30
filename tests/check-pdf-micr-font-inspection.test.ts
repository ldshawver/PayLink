import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const checkMicr = fs.readFileSync("server/check-micr.ts", "utf8");
const fontPath = fs.existsSync("public/fonts/micrenc.ttf") ? "public/fonts/micrenc.ttf" : "client/public/fonts/micrenc.ttf";
const fontHash = crypto.createHash("sha256").update(fs.readFileSync(fontPath)).digest("hex");

assert(routes.includes('const MICR_FONT_FILE = "micrenc.ttf"'), "production renderer uses the expected MICR font filename");
assert.equal(fontHash, "cf20632b0573f1887e9ca7d66b61d52b92f38efc3c5ef4310484b1e11d7519ed", "MICR font SHA-256 matches the reviewed E-13B asset");
assert(routes.includes("micrFont = await doc.embedFont(micrBytes)"), "MICR font is embedded into the PDF");
assert(routes.includes("if (!isCalibration) {\n        throw new Error("), "production checks fail closed instead of using fallback font");
assert(routes.includes('micrFontName = "Courier (FALLBACK — calibration only)"'), "fallback font is restricted to calibration only");

// The E-13B string builder now lives in server/check-micr.ts (imported by the renderer
// and by the rendered-glyph regression test in tests/check-micr-render.test.ts).
assert(routes.includes('from "./check-micr"'), "renderer imports the shared MICR builder");
assert(checkMicr.includes('const T = "c"; // ⑆ transit'), "MICR transit symbol maps to micrenc.ttf transit glyph");
assert(checkMicr.includes('const O = "d"; // ⑈ on-us'), "MICR on-us symbol maps to micrenc.ttf on-us glyph");
assert(checkMicr.includes('const auxOnUs = `${O}${fmtChk}${O}`'), "on-us symbols wrap the check number only in the auxiliary on-us field");
assert(checkMicr.includes('return `${auxOnUs}  ${T}${r}${T}  ${a}${O}`;'), "transit symbols only surround routing and account has a trailing on-us symbol");
assert(!checkMicr.includes('return `${auxOnUs}  ='), "literal equals is not inserted into the MICR line");
assert(!checkMicr.includes('${T}${r.split') && !checkMicr.includes('${O}${r.split'), "no control separator is inserted before each routing digit");

// MICR strings/routing/account are not logged (even redacted).
assert(!routes.includes("MICR source string (redacted)"), "MICR source string is not logged");

const syntheticSequence = "d0012d  c•••••0358c  ••••••6789d";
assert(!syntheticSequence.includes("="), "redacted sample contains no ordinary equals characters");

console.log(`PASS: MICR font/PDF inspection static checks passed (${fontPath}, ${fontHash})`);
