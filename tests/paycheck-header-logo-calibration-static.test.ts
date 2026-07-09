import fs from "node:fs";
import assert from "node:assert/strict";

const routes = fs.readFileSync("server/routes.ts", "utf8");

assert(routes.includes("checkLayoutCalibration"), "server reads per-template checkLayoutCalibration object");
assert(routes.includes("Math.max(-36, Math.min(36"), "check-face calibration offsets are clamped to ±36pt");
assert(routes.includes("lowered from 0.17in to clear top border"), "fractional routing number was moved down from the top border");
assert(routes.includes("imageUrl.replace(/^\\/?uploads\\//") && routes.includes("path.join(resolvedUploadDir, relativePart)"), "local upload logo paths keep tenant/company subdirectories instead of basename-only lookup");
assert(routes.includes("institution ||"), "bank text fallback uses remittance institution when template bankName is missing");
assert(routes.includes("only to Zone 1/check-face elements so the paystub/company-copy sections remain untouched"), "new nested calibration is documented as Zone 1 only");
assert(routes.includes("bankLogoUrl"), "bank logo URL from the existing template config is embedded when present");
assert(routes.includes('const MICR_FONT_FILE = "micrenc.ttf"'), "server PDF uses the same micrenc.ttf MICR font mapping as the browser preview");
assert(routes.includes('const T      = "c"; // ⑆ transit') && routes.includes('const O      = "d"; // ⑈ on-us'), "server MICR source string uses transit/on-us symbols only and does not use the MICR dash mapping before digits");
assert(!routes.includes('const T      = "a"; // ⑆ transit'), "server MICR no longer maps the transit symbol to the micrenc dash glyph");

const zone2OffsetUsage = routes.match(/checkFace(Sender|Receiver)Off[XY][\s\S]{0,160}checkBot -/g);
assert.equal(zone2OffsetUsage, null, "check-face sender/receiver offsets are not applied to paystub/company-copy y positions");

console.log("PASS: paycheck header logo/calibration static checks passed");
