/**
 * Check MICR + fractional-routing string builders — pure, no I/O.
 *
 * Extracted verbatim from server/routes.ts renderCheckPdf() so the exact E-13B
 * encoding the production renderer draws can be imported by rendered-artifact
 * regression tests and the sample generator without exposing routing/account
 * data. Behaviour is unchanged.
 */

/**
 * Zero-pad a check number to `length` digits (default 4). If the number already
 * exceeds `length` digits it is kept as-is.
 */
export function formatCheckNumber(n: string | number, length = 4): string {
  return String(n).replace(/\D/g, "").padStart(length, "0");
}

/**
 * Build the E-13B MICR line string for a business check (> 6 inches).
 *
 * micrenc.ttf ("MICR Encoding") E-13B character mapping:
 *   'c' = ⑆ transit routing delimiter
 *   'd' = ⑈ on-us symbol
 *   'b' = ⑇ amount symbol (not used in basic check layout)
 *   'a' = ⑉ dash symbol (not inserted by default)
 *
 * ANSI X9.7 business-check field order:
 *   Auxiliary On-Us   |   Transit Field   |   On-Us Field
 *   ⑈ checknum ⑈          ⑆ routing ⑆         account ⑈
 *
 * This differs from personal-check order (⑆ routing ⑆ account ⑈ check ⑈).
 */
export function buildMicrString(routing: string, account: string, checkNum: string): string {
  const T = "c"; // ⑆ transit
  const O = "d"; // ⑈ on-us
  const r = routing.replace(/\D/g, "").slice(0, 9).padStart(9, "0");
  const a = account.replace(/\D/g, "").slice(0, 17);
  const fmtChk = formatCheckNumber(checkNum);
  // Auxiliary On-Us field: ⑈ checknum ⑈ (check number only, no padding spaces)
  const auxOnUs = `${O}${fmtChk}${O}`;
  return `${auxOnUs}  ${T}${r}${T}  ${a}${O}`;
}

/**
 * Build the human-readable fractional ABA routing number for the check face.
 *
 *   Numerator   = prefix-institution  (e.g. "11-35")
 *     prefix      = ABA geographic city/state code (configured per remittance source)
 *     institution = digits 5–8 of routing, leading zeros dropped ("0035" → "35")
 *   Denominator = first 4 digits of routing, leading zeros kept ("1210")
 *
 * Example: routing 121000358, prefix "11" → "11-35\n1210" → rendered as 11-35 / 1210
 * Returns "" when the routing number is not a valid 9-digit value.
 */
export function buildFractionalRouting(routing: string, abaPrefix?: string): string {
  const r = routing.replace(/\D/g, "").padStart(9, "0");
  if (r.length < 9 || r === "000000000") return "";
  const denom = r.slice(0, 4);
  const instit = String(parseInt(r.slice(4, 8), 10));
  const num = abaPrefix ? `${abaPrefix}-${instit}` : instit;
  return `${num}\n${denom}`;
}
