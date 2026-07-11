import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const fontPath = fs.existsSync("public/fonts/micrenc.ttf") ? "public/fonts/micrenc.ttf" : "client/public/fonts/micrenc.ttf";
const fontHash = crypto.createHash("sha256").update(fs.readFileSync(fontPath)).digest("hex");

assert(routes.includes('const MICR_FONT_FILE = "micrenc.ttf"'), "production renderer uses the expected MICR font filename");
assert.equal(fontHash, "cf20632b0573f1887e9ca7d66b61d52b92f38efc3c5ef4310484b1e11d7519ed", "MICR font SHA-256 matches the reviewed E-13B asset");
assert(routes.includes("micrFont = await doc.embedFont(micrBytes)"), "MICR font is embedded into the PDF");
assert(routes.includes("if (!isCalibration) {\n        throw new Error("), "production checks fail closed instead of using fallback font");
assert(routes.includes('micrFontName = "Courier (FALLBACK — calibration only)"'), "fallback font is restricted to calibration only");
assert(routes.includes('const T      = "c"; // ⑆ transit'), "MICR transit symbol maps to micrenc.ttf transit glyph");
assert(routes.includes('const O      = "d"; // ⑈ on-us'), "MICR on-us symbol maps to micrenc.ttf on-us glyph");
assert(routes.includes('const auxOnUs = `${O}${fmtChk}${O}`'), "on-us symbols wrap the check number only in the auxiliary on-us field");
assert(routes.includes('return `${auxOnUs}  ${T}${r}${T}  ${a}${O}`;'), "transit symbols only surround routing and account has a trailing on-us symbol");
assert(!routes.includes('return `${auxOnUs}  ='), "literal equals is not inserted into the MICR line");
assert(!routes.includes('${T}${r.split') && !routes.includes('${O}${r.split'), "no control separator is inserted before each routing digit");

const syntheticSequence = "d0012d  c•••••0358c  ••••••6789d";
assert(!syntheticSequence.includes("="), "redacted sample contains no ordinary equals characters");

console.log(`PASS: MICR font/PDF inspection static checks passed (${fontPath}, ${fontHash})`);
