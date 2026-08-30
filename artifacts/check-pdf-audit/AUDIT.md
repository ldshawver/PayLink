# Check PDF Rendering Audit

## Commands

- `pnpm run check`
- `npx tsx tests/paycheck-header-logo-calibration-static.test.ts`
- `npx tsx tests/contractor-trade-compensation-static.test.ts`
- `npx tsx tests/check-pdf-rendering-audit-artifacts.test.ts`
- `npx tsx tests/check-pdf-micr-font-inspection.test.ts`
- `npx tsx scripts/audit-check-pdf-rendering.ts`
- `rg -l "paycheck|print-check|MICR|contractor statement|employee earnings" tests | sort`

## Audit artifact policy

Generated PDFs, PNGs, crops, extracted text, and bbox files are written to `/tmp/paylink-check-audit/` and are not committed. This committed file records reproducible commands and source-level validation only.

## Page geometry

The production renderer creates one 8.5 x 11 inch page at 612 x 792 PDF points, split into a 252 pt check face, a 252 pt paystub panel, and a 288 pt company-copy/statement panel. The MICR clear band remains 45 pt high at the bottom of the check face.

## Coordinate results

- Check face: 0-252 pt from page top.
- First perforation boundary: 252 pt from page top.
- Upper paystub: 252-504 pt from page top.
- Second perforation boundary: 504 pt from page top.
- Lower company copy: 504-792 pt from page top.
- MICR baseline: 3.38 inches from the top of the check face, using the embedded `micrenc.ttf` E-13B font.

## Hashes

Local artifact hashes are environment-specific because PDFs include creation metadata. Hash calculation should be performed in staging from `/tmp/paylink-check-audit/manifest.sha256` after generating samples.

## Coordinate evidence

Coordinates are expressed as inches from the top-left of the 8.5 x 3.5 inch check face unless noted. The current change did not intentionally move these fields; it documents and guards the production renderer coordinates for staging comparison.

| Field | Old coordinate | New coordinate | Changed? | Source |
|---|---:|---:|---|---|
| Bank logo image | x 3.62, y 0.50, w 0.86, h 0.22 | x 3.45, y 0.46, w 1.19, h 0.28 | Yes | `page.drawImage(bankLogoImg, { x: z1x(3.45), y: z1y(0.46), width: 86, height: 20 })` |
| Bank of America vector fallback | Not present | x 3.45, y 0.46, w 1.19, h 0.28 | New fallback only | `normalizedBankName === "bank of america"` branch |
| Bank address | x centered on 4.18, y 0.66 | x centered on 4.18, y 0.66 | No | `page.drawText(bankAddress, ..., y: z1y(0.66))` |
| Fractional routing numerator | x 5.25, y 0.42 | x 5.25, y 0.545 default | Yes, +0.125in down | `fracNumY = z1y(0.42) + fractionalRoutingOffY` |
| Fractional routing rule | x 5.25, y 0.47 | x 5.25, y 0.595 default | Yes, +0.125in down | `fracLineY = z1y(0.47) + fractionalRoutingOffY` |
| Fractional routing denominator | x 5.25, y 0.57 | x 5.25, y 0.695 default | Yes, +0.125in down | `fracDenY = z1y(0.57) + fractionalRoutingOffY` |
| Check number | right edge x 7.15, y 0.35 | right edge x 7.15, y 0.35 | No | `page.drawText(cnLabel, { x: z1x(7.15) - cnWidth, y: z1y(0.35) })` |
| Check date | x 6.75, y 0.70 | x 6.75, y 0.70 | No | `page.drawText(payDate, { x: dtX1 + 2, y: z1y(0.70) })` |
| MICR baseline | x 0.50, y 3.38 | x 0.50, y 3.38 | No | `page.drawText(micrString, { x: z1x(0.50), y: z1y(3.38) })` |

Fractional routing Y-coordinate confirmation: changed in this source change. The grouped fractional ABA element now has a safe default `fractionalRoutingOffsetY` of +0.125 inches downward. The default rendered positions are numerator 0.545 inches, rule 0.595 inches, and denominator 0.695 inches from the check-face top. The numerator/rule/denominator remain grouped because the same `fractionalRoutingOffY` is added to all three baselines. Fresh rendered PDFs and physical prints are still required for visual approval.

## MICR source sequence evidence

Synthetic redacted sample before font rendering: `d0012d  c•••••0358c  ••••••6789d`. In this `micrenc.ttf` mapping, `c` is the transit symbol and `d` is the on-us symbol. The renderer formats the source as `on-us check-number on-us`, two spaces, `transit routing transit`, two spaces, `account on-us`.

Confirmations:

- No separator is inserted before each digit `2`.
- Transit symbols only surround the routing number.
- On-us symbols appear only around the check number and after the configured account number.
- No ordinary equals characters are used as visible separators.

## MICR font evidence

- Font family / renderer label: MICR E-13B via `micrenc.ttf` mapping.
- Filename: `micrenc.ttf`.
- SHA-256: `cf20632b0573f1887e9ca7d66b61d52b92f38efc3c5ef4310484b1e11d7519ed`.
- PDF embedding: required by `doc.embedFont(micrBytes)`.
- Fallback font: production throws if MICR font loading fails; Courier fallback is calibration-only.

## Region regression status

- Employee paystub/company-copy regions: source intent is unchanged except the added classification-specific company-copy heading and the grouped fractional routing check-face movement. A rendered region-level pixel comparison is still required before approval.
- Contractor output: source intent is to replace only the existing contractor stub/company-copy content and headings; the check face, header, and MICR coordinates remain unchanged. A rendered region-level comparison is still required before approval.

## Required visual artifacts not committed

Fresh Adiken Inc. and Adiken Properties PDFs, full check-face screenshots, 300-DPI MICR crops, extracted text, and coordinate reports must be generated under `/tmp/paylink-check-audit/` or CI artifacts. They are intentionally excluded from Git.

## Physical print status

Not completed in this Codex environment. Staging must print at Actual Size / 100%, with no Fit to Page and no Shrink Oversized Pages, then validate MICR and layout against the intended check stock before production deployment.

## Release A (v2.2.2) — verify-first MICR / logo / fractional evidence

Rendered-output inspection was performed on the current production renderer BEFORE
any MICR/position change (see `scripts/render-check-samples.ts` and the staging
`/api/checks/calibration-pdf` render):

- **MICR line**: `micrenc.ttf` ("MICR Encoding", SHA-256 `cf20632b…`) provides real
  distinct E-13B glyphs for the transit `c`, on-us `d` and every digit `0`–`9`, and
  has **no glyph** for `=`, `:`, `;` or `-`. `buildMicrString()` emits only `[0-9cd ]`.
  Rendered at 600 DPI the line reads `⑈<checknum>⑈  ⑆<routing>⑆  <account>⑈` with
  correct symbols and digits — **no `=` appears before `2` or anywhere else.** The
  earlier written "`=` before each 2" report is **not reproduced** by the canonical
  server renderer; the only client-side MICR path (a second React builder using a
  CSS `@font-face` stack) has been removed. **No MICR mapping or baseline change made.**
- **Bank logo**: renders at check-face x 3.45 in, y 0.46 in (top-centre, above the
  pay-to/amount rows). Tenant-uploaded logo wins; Bank of America gets a vector
  fallback only when the normalized bank name matches. Every company can now nudge
  it via `layout_config.checkLayoutCalibration.bankLogo{x,y}`. **No default change.**
- **Fractional routing**: numerator 0.545 in / rule 0.595 in / denominator 0.695 in
  from the check-face top (the +0.125 in default lowering is retained). Adjustable
  per company via `fractionalRoutingOffsetY` / `checkLayoutCalibration.fractionalRouting`.
  **No default change.**

Regression anchor: `tests/check-micr-render.test.ts` (rendered-glyph assertions on
the real font + `buildMicrString`, no bank data) is in the required CI suite.

## Release A (v2.2.2) — contractor statement separation

The contractor payment statement is now a dedicated renderer branch (Zone 2 stub
and Zone 3 detachable copy), not an employee paystub painted over with a white
rectangle. Employee wage content (earnings/deductions table, withholding, FICA,
sick/PTO, YTD, and the 15.3 % self-employment-tax reference) is **never drawn** for
a contractor, so no employee terminology can be extracted from the PDF. Every
contractor panel carries the exact heading `CONTRACTOR PAYMENT STATEMENT —
NONEMPLOYEE COMPENSATION` and the line `Not an employee wage statement. No payroll
taxes were withheld.` "Paid" is no longer hard-coded; the statement shows payer,
contractor, check/reference number, payment date, payment method, current payment
amount, documented trade/noncash amount when present, and remaining invoice
balance where available. Employee wage statements are unchanged. No tax, payroll,
invoice-ledger, schema or financial-calculation change.

## Release A (v2.2.2) — full per-element check-face position config

`check_templates.layout_config.checkLayoutCalibration` now accepts independent
`{x, y}` point offsets (clamped ±36 pt, default 0 so today's rendering is
unchanged) for: `printableArea` (global), `companyLogo`, `bankLogo`,
`fractionalRouting`, `senderAddress`, `recipientAddress`, `payee`, `date`,
`amountInWords`, `numericAmount`, `memo`, `signature`, `micr`. The BofA account
keeps its saved/default preset; every company gets the same capability.
