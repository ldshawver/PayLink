# Check PDF Rendering Audit

## Commands

- `pnpm run check`
- `npx tsx tests/paycheck-header-logo-calibration-static.test.ts`
- `npx tsx tests/contractor-trade-compensation-static.test.ts`
- `npx tsx tests/check-pdf-rendering-audit-artifacts.test.ts`
- `npx tsx tests/check-pdf-micr-font-inspection.test.ts`
- `npx tsx scripts/audit-check-pdf-rendering.ts`
- `npx tsx scripts/render-vendor-check-samples.ts` (vendorCheck path: bank logo/kind-banner/remittance-advice visual evidence; `--legacy` reproduces the pre-v2.2.7-recovery rendering for comparison)
- `npx tsx tests/check-pdf-remote-image-ssrf.test.ts`
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
| Bank logo image | x 3.62, y 0.50, w 0.86, h 0.22 | x 3.35, y 0.16, w 80pt, h = 80pt × asset aspect ratio | Yes | `page.drawImage(bankLogoImg, { x: bankLogoX, y: bankLogoY, width: bankLogoWpt, height: bankLogoHpt })` |
| Bank of America bundled asset (v2.2.7) | Not present | same box as bank logo image (never distorted — height derives from the real asset's aspect ratio) | New, replaces the old hand-drawn vector rectangle | `BANK_LOGO_ASSETS["bank of america"] → public/images/bank-logos/bank-of-america.png`, loaded from disk via `loadBundledBankLogoBytes()` — never fetched over the network |
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

**Generated 2026-09-16, final regeneration at source SHA `9dc5c079020701f9cf41a2bcaf3661d1fe0c1198`** (this PR's head, which includes the SSRF-bypass and total-timeout fixes below plus this evidence tooling): `scripts/render-vendor-check-samples.ts --out after` (current candidate) and `--legacy --out before` (pre-recovery, for comparison), covering all 5 requested entities — Adiken Inc., Adiken Properties, Refined Mind, Contractor Hub (payee Lucifer Alexander Cruz-Villanueva), and a new `adiken-inc-dba-lucifer-cruz` scenario (Adiken Inc. issuing with `companies.dba = "Lucifer Cruz"` set, same company/bank account, different payee — see the DBA finding below). For each of the 5 scenarios: full-page screenshot at 150 DPI (`check-evidence-output/after/full-page-150dpi/`) and a 300-DPI crop of the MICR clear band (`check-evidence-output/after/micr-crop-300dpi/`), plus `check-evidence-output/after/manifest.json` (issuer/DBA/payee/amount per scenario, source SHA, generation timestamp). The prior session's evidence at the same source SHA (before this tooling addition, 4 scenarios, no manifest) is preserved separately, unmodified, at `check-evidence-output/historical-51d22e2/`. All of `check-evidence-output/` remains gitignored, not committed — reproducible from the script and this doc. MICR crops confirm clean E-13B glyphs with no `=` at 300 DPI for all 5 scenarios; full-page screenshots confirm no clipping/overlap and correct dynamic check-kind banners.

**DBA finding (pre-existing, not introduced or fixed by this PR)**: `companies.dba` is fetched and threaded into the `company` object passed to `renderCheckPdf()` in both check-PDF entry points (`server/routes.ts` ~11540, ~12684 — unchanged by this PR's diff, present since PR #112), but `renderCheckPdf()` itself only reads `company?.name` for the printed issuer name (`coName` at ~23602) — `dba` is never drawn. The `adiken-inc-dba-lucifer-cruz` scenario reproduces this faithfully: the check face prints "Adiken Inc.", never "Lucifer Cruz". A separate, unrelated legacy page, `client/src/pages/print-expense-check.tsx` (routed at `/app/print-expense-check`, no in-app link found pointing to it), does render `DBA: {company.dba}` — a pre-existing divergence between two independent check-rendering implementations, out of scope for this PR to fix.

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

## Recovered check-printing work (v2.2.7 → reconciled onto post-v2.2.12 main)

Ported from an uncommitted v2.2.6-era working tree (preservation commit
`b243687` on `fix/v2.2.7-check-1099-repair`, never merged) and reconciled onto
current `main` (post PR #154). Scope: check-face rendering only — no change to
authorization, tenant scoping, the payment ledger, idempotency, check-number
allocation, or the separate `payment-documents.ts` proof-document path.

- **Bank logo replaced, not just repositioned**: the old hand-drawn "Bank of
  America" vector rectangle (a synthetic substitute logo) is removed entirely.
  Recognized bank brands (currently only Bank of America) now render the real,
  repo-committed asset at `public/images/bank-logos/bank-of-america.png`,
  loaded from disk (`loadBundledBankLogoBytes()`), never fetched over the
  network and never distorted (height derives from the asset's own aspect
  ratio). Logo box moved to x 3.35in / y 0.16in (top-left) so the taller real
  logo and the bank name/address block below it don't collide. Priority order:
  (1) tenant-configured upload/remote logo, (2) the bundled approved asset for
  a recognized brand, (3) bank name/address as text only — no synthetic mark.
- **Adiken hard-coded logo fallback removed**: `isAdikenTenant` /
  `allowBuiltInAdikenLogo` and the blue "A" placeholder rectangle are gone.
  No tenant — Adiken included — gets a hard-coded vector logo; a company with
  no uploaded logo and not a recognized bank brand renders text-only (or, in
  calibration mode only, a generic "LOGO" placeholder box for position
  verification).
- **Dynamic check-kind banner**: the right-column banner on a `vendorCheck`
  (invoice/expense) check now reads "CONTRACTOR CHECK", "VENDOR CHECK", or
  "PAYEE CHECK" based on `vendorCheck.checkKind`, set by the caller
  (`buildContractorInvoiceCheckPdf` → `"contractor"`, `renderExpenseCheckPdf`
  → `"vendor"`) — never hard-coded "VENDOR CHECK" for a contractor payment.
- **Paid-to-date / remaining balance / final-payment marker**: both check
  builders now derive `originalAmount`, `paidToDateAmount`,
  `remainingBalanceAmount`, and `isFinalPayment` from the same canonical
  ledger sums the existing `/document` (proof-document) endpoints already use
  (`SUM(contractor_payments.amount) WHERE status <> 'void'` /
  `SUM(expense_payments.amount) WHERE status <> 'void'`), not a separate or
  invented computation. Rendered in the Zone 2 vendor-check panel and, with
  more room, on the Zone 3 detachable remittance-advice stub alongside
  invoice/contract reference and a line-items table (from the invoice's/
  expense's own `line_items` column via the existing `parsePaymentDocLineItems`
  parser). Preview renders (no payment written yet) add the previewed amount
  to the current ledger sum; issued/replayed/reprinted checks use the ledger
  sum as-is (it already includes that payment) — same convention the
  proof-document endpoints already use.
- **Remote logo fetch hardened against SSRF**: `fetchRemoteImageBytes` (used
  for a tenant's uploaded/remote company or bank logo URL) now: rejects any
  scheme but `http`/`https`; resolves every hostname — the initial URL and
  each of up to 3 redirect hops — and rejects loopback, RFC1918 private,
  link-local (including the `169.254.169.254` cloud-metadata address), and
  other non-public ranges; caps the response at 5MB; and bounds total
  wall-clock time across all hops to 15s (8s per hop). Local `/uploads/...`
  paths are untouched (still a plain filesystem read, no network fetch).

  **2026-09-16 review correction — the mechanism above was fixed twice more before merge, both found during this session's focused re-review, neither found by the automated review bot (unavailable, usage limit):**
  1. **Critical: the original `lookup`-hook design was a live SSRF bypass, closed.** The initial recovery validated the resolved address only via a custom `dns.lookup` passed as the `lookup` option to `http.get()`/`https.get()`. Verified live (local loopback test server, no external network) that Node's own connection logic recognizes a hostname that already looks like an IP — including encodings `net.isIP()` itself does not recognize, such as bare-decimal (`http://2130706433/`, equal to `127.0.0.1`) or hex (`http://0x7f000001/`) — and connects straight to it **without ever invoking `lookup`**. A tenant-configured (or attacker-supplied, or a malicious redirect's) logo URL spelling a blocked address in any of these forms sailed through completely unfiltered, including the exact `169.254.169.254` cloud-metadata address the hardening's own commit message named as blocked. Confirmed exploitable end-to-end against a local test server before the fix (fetched real bytes from `127.0.0.1`, a decimal-encoded loopback, and a hex-encoded loopback); confirmed blocked after. Fixed by resolving and validating the hostname explicitly in application code *before* opening any connection, then connecting directly to that already-validated literal address (`Host`/TLS `servername` still carry the original hostname for correct virtual-hosting/SNI/cert checks) — this also strengthens the DNS-rebinding protection, since there is now exactly one resolution per hop, not a `lookup` hook that some inputs never reach. New regression test in `tests/check-pdf-remote-image-ssrf.test.ts` (loopback-only, no external network) proves all four encodings are now blocked before a socket is opened.
  2. **The 15s total-timeout was not actually enforced as a wall-clock cutoff.** It was checked only once, at the start of each hop; a single non-redirecting response trickling data slowly enough to keep resetting the 8s *idle* socket timeout (which the per-hop `timeout` option is) could run indefinitely. Fixed with an explicit deadline timer that destroys the request at the wall-clock cutoff regardless of ongoing activity. Verified live: a synthetic slow-drip server (1 byte/500ms, forever) is now aborted at the deadline (~2000ms in the test) instead of hanging.

  Both fixes verified with real sockets (loopback for the bypass regression; the developer's own public IP, reachable only from itself, for the redirect-chain/size-cap/timeout behavioral checks — not committed as tests, since a non-loopback address is not portable to CI runners behind NAT). `pnpm test:required` 101/101, `pnpm check`/`pnpm build` clean, `route-inventory:check`/`storage-scope-trace:check` current after these changes.
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
