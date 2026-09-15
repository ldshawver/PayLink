/**
 * Vendor/contractor check-face visual evidence — faithful-replica audit
 * script, same convention as scripts/render-check-samples.ts: reproduces the
 * production renderCheckPdf() vendorCheck-path geometry (server/routes.ts,
 * bank-logo/check-kind-banner/remittance-advice sections) and the real
 * server/check-micr.ts builders, without booting the app or a database.
 * No routing/account data from any real institution is used; all company,
 * bank, and payee names below are synthetic.
 *
 * Run: npx tsx scripts/render-vendor-check-samples.ts [--legacy] [--out DIR]
 * Output: check-evidence-output/<DIR>/*.pdf (gitignored — not committed).
 *
 * --legacy reproduces the pre-v2.2.7-recovery vendorCheck rendering: a fixed
 * hard-coded "VENDOR CHECK" banner, a hand-drawn Bank of America vector
 * rectangle (only when the bank name matches, no real asset), and no
 * invoice/contract reference, paid-to-date/remaining-balance, final-payment
 * marker, or line-items table. Compare `--legacy --out before` against a
 * plain run `--out after` to see the recovery's effect on identical inputs.
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const LEGACY = args.includes("--legacy");
const outIdx = args.indexOf("--out");
const OUT = outIdx >= 0 ? args[outIdx + 1] : LEGACY ? "before" : "after";
const OUT_DIR = process.env.EVIDENCE_OUT_DIR ? path.join(process.env.EVIDENCE_OUT_DIR, OUT) : path.join(process.cwd(), "check-evidence-output", OUT);
fs.mkdirSync(OUT_DIR, { recursive: true });

type LineItem = { name: string; quantity?: number | string | null; unitPrice?: number | string | null; lineTotal?: number | string | null };
type Scenario = {
  slug: string;
  companyName: string; companyAddr1: string; companyAddr2: string;
  bankName: string; bankAddress: string; bankBrandingEnabled: boolean;
  routing: string; account: string; checkNumber: string;
  checkKind: "contractor" | "vendor" | "payee";
  payeeName: string; payeeAddress: string; payeeCityStateZip: string;
  amount: number; memo: string; payDate: string;
  invoiceNumber?: string | null; contractReference?: string | null;
  originalAmount: number; priorPaidAmount: number; paidToDateAmount: number; remainingBalanceAmount: number; isFinalPayment: boolean;
  lineItems: LineItem[];
};

const SCENARIOS: Scenario[] = [
  {
    slug: "adiken-inc-partial",
    companyName: "Adiken Inc.", companyAddr1: "4820 Meridian Business Park Dr, Suite 220", companyAddr2: "Charlotte, NC 28217",
    bankName: "Bank of America", bankAddress: "100 N Tryon St, Charlotte, NC 28255", bankBrandingEnabled: true,
    routing: "021000021", account: "8873041256", checkNumber: "1042",
    checkKind: "contractor",
    payeeName: "Miguel A. Fernandez-Douglas", payeeAddress: "1108 Sycamore Ridge Ln", payeeCityStateZip: "Matthews, NC 28105",
    amount: 1500.00, memo: "Progress payment - Framing", payDate: "09/15/2026",
    invoiceNumber: "INV-1044", contractReference: "Proposal PR-2201",
    originalAmount: 2500.00, priorPaidAmount: 0, paidToDateAmount: 1500.00, remainingBalanceAmount: 1000.00, isFinalPayment: false,
    lineItems: [
      { name: "Framing labor - main structure", quantity: 30, unitPrice: 50, lineTotal: 1500 },
      { name: "Electrical rough-in", quantity: 1, unitPrice: 1000, lineTotal: 1000 },
    ],
  },
  {
    slug: "adiken-properties-final",
    companyName: "Adiken Properties", companyAddr1: "2201 Piedmont Row Dr, Suite 400", companyAddr2: "Charlotte, NC 28204",
    bankName: "Bank of America", bankAddress: "1401 Elm St, Dallas, TX 75202", bankBrandingEnabled: true,
    routing: "111000025", account: "5502187734", checkNumber: "1043",
    checkKind: "contractor",
    payeeName: "Adiken Properties Maintenance LLC", payeeAddress: "890 Grove Park Ct", payeeCityStateZip: "Charlotte, NC 28211",
    amount: 800.00, memo: "Final payment - HVAC service", payDate: "09/15/2026",
    invoiceNumber: "INV-0087", contractReference: "Contract APM-0451",
    originalAmount: 800.00, priorPaidAmount: 0, paidToDateAmount: 800.00, remainingBalanceAmount: 0, isFinalPayment: true,
    lineItems: [{ name: "HVAC seasonal service call", quantity: 1, unitPrice: 800, lineTotal: 800 }],
  },
  {
    slug: "refined-mind-vendor",
    companyName: "Refined Mind", companyAddr1: "77 Innovation Way, Floor 3", companyAddr2: "Austin, TX 78701",
    bankName: "Sunrise Community Bank", bankAddress: "500 Congress Ave, Austin, TX 78701", bankBrandingEnabled: true,
    routing: "114000093", account: "2209918845", checkNumber: "3011",
    checkKind: "vendor",
    payeeName: "Meridian Office Supply & Print Solutions, LLC", payeeAddress: "PO Box 44210", payeeCityStateZip: "Austin, TX 78744",
    amount: 450.75, memo: "Office supplies Q3", payDate: "09/15/2026",
    invoiceNumber: null, contractReference: null,
    originalAmount: 450.75, priorPaidAmount: 0, paidToDateAmount: 450.75, remainingBalanceAmount: 0, isFinalPayment: true,
    lineItems: [
      { name: "Copy paper, case (10-ream)", quantity: 12, unitPrice: 28.5, lineTotal: 342 },
      { name: "Toner cartridges, black", quantity: 3, unitPrice: 36.25, lineTotal: 108.75 },
    ],
  },
  {
    slug: "contractor-hub-suppressed-branding",
    companyName: "Contractor Hub", companyAddr1: "500 Riverwalk Blvd, Suite 100", companyAddr2: "Tampa, FL 33602",
    bankName: "Bank of America", bankAddress: "800 Water St, Tampa, FL 33602", bankBrandingEnabled: false,
    routing: "063100277", account: "7719042288", checkNumber: "2210",
    checkKind: "contractor",
    payeeName: "Lucifer Alexander Cruz-Villanueva", payeeAddress: "3390 Bayshore Terrace, Apt 12C", payeeCityStateZip: "Tampa, FL 33611",
    amount: 12345.67, memo: "Final payment - Phase 3 buildout", payDate: "09/15/2026",
    invoiceNumber: "INV-CH-0007", contractReference: "Contract CH-2026-014",
    originalAmount: 12345.67, priorPaidAmount: 0, paidToDateAmount: 12345.67, remainingBalanceAmount: 0, isFinalPayment: true,
    lineItems: [
      { name: "Phase 3 labor - buildout crew", quantity: 160, unitPrice: 62.5, lineTotal: 10000 },
      { name: "Specialty fixtures - lobby", quantity: 8, unitPrice: 180.71, lineTotal: 1445.67 },
      { name: "Equipment rental - lift", quantity: 4, unitPrice: 175, lineTotal: 700 },
      { name: "Disposal / haul-away", quantity: 1, unitPrice: 200, lineTotal: 200 },
    ],
  },
];

const BANK_LOGO_ASSETS: Record<string, string> = { "bank of america": "bank-of-america.png" };

async function main() {
  const { buildMicrString, buildFractionalRouting, formatCheckNumber } = await import("../server/check-micr.ts");
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;

  const fmtMoney = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const truncate = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);
  const normalizeBrandName = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  const micrPath = fs.existsSync("public/fonts/micrenc.ttf") ? "public/fonts/micrenc.ttf" : "client/public/fonts/micrenc.ttf";

  for (const sc of SCENARIOS) {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const hv = await doc.embedFont(StandardFonts.Helvetica);
    const hvB = await doc.embedFont(StandardFonts.HelveticaBold);
    const cour = await doc.embedFont(StandardFonts.Courier);
    const micrFont = await doc.embedFont(fs.readFileSync(micrPath));

    const page = doc.addPage([612, 792]);
    const W = 612, H = 792;
    const checkH = 252, mailH = 252;
    const lm = 40, rm = W - 40;
    const checkBot = H - checkH;
    const mailBot = checkBot - mailH;
    const z1x = (inches: number) => Math.round(inches * 72);
    const z1y = (inches: number) => Math.round(H - inches * 72);

    // ── Zone 1: check face ──────────────────────────────────────────────
    page.drawText("(no logo uploaded — text fallback)", { x: z1x(0.25), y: z1y(0.22), size: 5.5, font: hv, color: rgb(0.6, 0.6, 0.6) });
    page.drawText(sc.companyName, { x: z1x(0.68), y: z1y(0.30), size: 11, font: hvB, color: rgb(0, 0, 0) });
    page.drawText(sc.companyAddr1, { x: z1x(0.68), y: z1y(0.46), size: 9, font: hv, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(sc.companyAddr2, { x: z1x(0.68), y: z1y(0.62), size: 9, font: hv, color: rgb(0.2, 0.2, 0.2) });

    const normalizedBankName = normalizeBrandName(sc.bankName);
    if (LEGACY) {
      // Pre-recovery: fixed box at 3.45/0.46, 86x20; BoA gets a hand-drawn
      // vector rectangle, no bundled asset exists at all.
      const bx = z1x(3.45), by = z1y(0.46);
      if (sc.bankBrandingEnabled && normalizedBankName === "bank of america") {
        page.drawRectangle({ x: bx, y: by, width: 86, height: 20, color: rgb(0.0, 0.12, 0.40), opacity: 0.95 });
        page.drawRectangle({ x: bx + 43, y: by, width: 43, height: 20, color: rgb(0.76, 0.02, 0.08), opacity: 0.95 });
        page.drawText("Bank of America", { x: bx + 5, y: by + 6, size: 6.5, font: hvB, color: rgb(1, 1, 1) });
      }
      if (sc.bankName) {
        const bnW = sc.bankName.length * 5.6, bnaW = sc.bankAddress.length * 3.7;
        const bcx = z1x(4.18);
        page.drawText(sc.bankName, { x: Math.round(bcx - bnW / 2), y: z1y(0.52), size: 10, font: hvB, color: rgb(0.08, 0.08, 0.32) });
        if (sc.bankAddress) page.drawText(sc.bankAddress, { x: Math.round(bcx - bnaW / 2), y: z1y(0.66), size: 8.5, font: hv, color: rgb(0.30, 0.30, 0.30) });
      }
    } else {
      // v2.2.7: real bundled asset for a recognized brand; text-only otherwise;
      // nothing at all when bankBrandingEnabled is false.
      const assetFile = BANK_LOGO_ASSETS[normalizedBankName];
      let bankLogoImg: any = null;
      if (sc.bankBrandingEnabled && assetFile) {
        const assetPath = path.join(process.cwd(), "public", "images", "bank-logos", assetFile);
        if (fs.existsSync(assetPath)) bankLogoImg = await doc.embedPng(fs.readFileSync(assetPath));
      }
      const topIn = 0.16, wpt = 80;
      const hpt = bankLogoImg ? Math.round(wpt * (bankLogoImg.height / bankLogoImg.width)) : 24;
      const bx = z1x(3.35), by = z1y(topIn + hpt / 72);
      if (bankLogoImg) page.drawImage(bankLogoImg, { x: bx, y: by, width: wpt, height: hpt });
      const bankTextTopIn = bankLogoImg ? topIn + hpt / 72 + 0.05 : topIn + 0.10;
      if (sc.bankBrandingEnabled) {
        if (sc.bankName && !bankLogoImg) {
          const bnW = sc.bankName.length * 5.6;
          page.drawText(sc.bankName, { x: Math.round(z1x(3.35) + wpt / 2 - bnW / 2), y: z1y(bankTextTopIn), size: 10, font: hvB, color: rgb(0.08, 0.08, 0.32) });
        }
        if (sc.bankAddress) {
          const addrTopIn = sc.bankName && !bankLogoImg ? bankTextTopIn + 0.14 : bankTextTopIn;
          const bnaW = sc.bankAddress.length * 3.5;
          page.drawText(sc.bankAddress, { x: Math.round(z1x(3.35) + wpt / 2 - bnaW / 2), y: z1y(addrTopIn), size: 7.5, font: hv, color: rgb(0.30, 0.30, 0.30) });
        }
      }
    }

    // Fractional routing + MICR (unchanged in this recovery; identical both modes)
    const frac = buildFractionalRouting(sc.routing, "11");
    const [fracNum, fracDen] = frac.split("\n");
    const fracY = z1y(0.545);
    page.drawText(fracNum, { x: z1x(5.25), y: fracY + 10, size: 7.5, font: hv, color: rgb(0.25, 0.25, 0.25) });
    page.drawLine({ start: { x: z1x(5.25), y: fracY + 3 }, end: { x: z1x(5.25) + 55, y: fracY + 3 }, color: rgb(0.35, 0.35, 0.35), thickness: 0.6 });
    page.drawText(fracDen, { x: z1x(5.25), y: fracY - 8, size: 7.5, font: hv, color: rgb(0.25, 0.25, 0.25) });

    const chkNum = formatCheckNumber(sc.checkNumber);
    page.drawText(`Check No. ${chkNum}`, { x: z1x(6.0), y: z1y(0.35), size: 9, font: hvB, color: rgb(0, 0, 0) });
    page.drawText(`Date: ${sc.payDate}`, { x: z1x(6.0), y: z1y(0.70), size: 9, font: hv, color: rgb(0.2, 0.2, 0.2) });

    page.drawText(`Pay to the order of:  ${sc.payeeName}`, { x: z1x(0.5), y: z1y(1.55), size: 10, font: hvB, color: rgb(0, 0, 0) });
    page.drawText(`$${fmtMoney(sc.amount)}`, { x: z1x(6.3), y: z1y(1.55), size: 11, font: hvB, color: rgb(0, 0, 0) });
    page.drawText(sc.payeeAddress, { x: z1x(0.5), y: z1y(1.75), size: 8.5, font: hv, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(sc.payeeCityStateZip, { x: z1x(0.5), y: z1y(1.92), size: 8.5, font: hv, color: rgb(0.2, 0.2, 0.2) });

    const micrString = buildMicrString(sc.routing, sc.account, sc.checkNumber);
    page.drawText(micrString, { x: z1x(0.50), y: z1y(3.38), size: 12, font: micrFont, color: rgb(0, 0, 0) });

    page.drawLine({ start: { x: 0, y: checkBot }, end: { x: W, y: checkBot }, color: rgb(0.7, 0.7, 0.7), thickness: 0.75, dashArray: [4, 3] });
    page.drawLine({ start: { x: 0, y: mailBot }, end: { x: W, y: mailBot }, color: rgb(0.7, 0.7, 0.7), thickness: 0.75, dashArray: [4, 3] });

    // ── Zone 2: right-column check-info banner ──────────────────────────
    const psX = W / 2 + 20, psW = rm - psX;
    page.drawRectangle({ x: psX - 4, y: checkBot - 18, width: psW + 4, height: 15, color: rgb(0.08, 0.38, 0.14), opacity: 0.9 });
    const label = LEGACY ? "VENDOR CHECK" : { contractor: "CONTRACTOR CHECK", vendor: "VENDOR CHECK", payee: "PAYEE CHECK" }[sc.checkKind];
    if (LEGACY) {
      page.drawText(label, { x: psX + psW / 2 - Math.round(label.length * 3.0), y: checkBot - 14, size: 10, font: hvB, color: rgb(1, 1, 1) });
    } else {
      const fontSize = label.length > 12 ? 8.5 : 10;
      page.drawText(label, { x: psX + 4, y: checkBot - 14, size: fontSize, font: hvB, color: rgb(1, 1, 1) });
    }
    page.drawText(`Check No. ${chkNum}`, { x: rm - Math.round(`Check No. ${chkNum}`.length * 5.0), y: checkBot - 14, size: 8.5, font: hvB, color: rgb(1, 1, 1) });
    let vcY = checkBot - 36;
    if (!LEGACY && sc.isFinalPayment) { page.drawText("FINAL PAYMENT", { x: psX, y: vcY, size: 7.5, font: hvB, color: rgb(0.55, 0.05, 0.05) }); vcY -= 11; }
    page.drawText(`Amount: $${fmtMoney(sc.amount)}`, { x: psX, y: vcY, size: 9, font: hvB, color: rgb(0.05, 0.3, 0.08) }); vcY -= 14;
    if (!LEGACY) { page.drawText(`Paid to date: $${fmtMoney(sc.paidToDateAmount)}  •  Remaining: $${fmtMoney(sc.remainingBalanceAmount)}`, { x: psX, y: vcY, size: 7.3, font: hv, color: rgb(0.2, 0.2, 0.2) }); vcY -= 11; }
    page.drawText(`Memo: ${truncate(sc.memo, 52)}`, { x: psX, y: vcY, size: 8, font: hv, color: rgb(0.2, 0.2, 0.2) }); vcY -= 12;
    page.drawText(`Date: ${sc.payDate}`, { x: psX, y: vcY, size: 8, font: hv, color: rgb(0.3, 0.3, 0.3) });

    // ── Zone 3: detachable remittance advice ────────────────────────────
    const bannerY = mailBot - 14;
    page.drawRectangle({ x: lm - 4, y: bannerY - 4, width: rm - lm + 8, height: 13, color: rgb(0.93, 0.93, 0.93) });
    page.drawText("REMITTANCE ADVICE — DETACH AND RETAIN FOR YOUR RECORDS", { x: lm, y: bannerY, size: 7, font: hvB, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(`Check No. ${chkNum}`, { x: rm - 90, y: bannerY, size: 7, font: hvB, color: rgb(0.3, 0.3, 0.3) });
    let zy = bannerY - 18;
    page.drawText(`Payee:  ${sc.payeeName}`, { x: lm, y: zy, size: 9, font: hvB, color: rgb(0, 0, 0) }); zy -= 12;
    page.drawText(sc.payeeAddress, { x: lm, y: zy, size: 8, font: hv, color: rgb(0.2, 0.2, 0.2) }); zy -= 12;
    page.drawText(sc.payeeCityStateZip, { x: lm, y: zy, size: 8, font: hv, color: rgb(0.2, 0.2, 0.2) }); zy -= 14;
    if (!LEGACY) {
      if (sc.invoiceNumber) { page.drawText(`Invoice:  ${truncate(sc.invoiceNumber, 44)}`, { x: lm, y: zy, size: 8, font: hv, color: rgb(0.2, 0.2, 0.2) }); zy -= 12; }
      if (sc.contractReference) { page.drawText(`Contract: ${truncate(sc.contractReference, 44)}`, { x: lm, y: zy, size: 8, font: hv, color: rgb(0.2, 0.2, 0.2) }); zy -= 12; }
      if (sc.isFinalPayment) { page.drawText("FINAL PAYMENT", { x: lm, y: zy, size: 8, font: hvB, color: rgb(0.55, 0.05, 0.05) }); zy -= 12; }
    }
    page.drawText(`Amount:  $${fmtMoney(sc.amount)}`, { x: lm, y: zy, size: 9, font: hvB, color: rgb(0, 0, 0.5) }); zy -= 12;
    if (!LEGACY) {
      page.drawText(`Invoice total:  $${fmtMoney(sc.originalAmount)}`, { x: lm, y: zy, size: 8, font: hv, color: rgb(0.2, 0.2, 0.2) }); zy -= 12;
      page.drawText(`Paid to date:  $${fmtMoney(sc.paidToDateAmount)}`, { x: lm, y: zy, size: 8, font: hv, color: rgb(0.2, 0.2, 0.2) }); zy -= 12;
      page.drawText(`Remaining balance:  $${fmtMoney(sc.remainingBalanceAmount)}`, { x: lm, y: zy, size: 8, font: hv, color: rgb(0.2, 0.2, 0.2) }); zy -= 12;
    }
    page.drawText(`Date:    ${sc.payDate}`, { x: lm, y: zy, size: 8, font: hv, color: rgb(0.3, 0.3, 0.3) }); zy -= 12;
    page.drawText(`Memo:    ${truncate(sc.memo, 60)}`, { x: lm, y: zy, size: 8, font: hv, color: rgb(0.3, 0.3, 0.3) }); zy -= 12;

    if (!LEGACY && sc.lineItems.length > 0) {
      zy -= 4;
      const qtyX = rm - 190, unitX = rm - 120, totalX = rm - 55;
      page.drawRectangle({ x: lm - 2, y: zy - 3, width: rm - lm + 2, height: 12, color: rgb(0.88, 0.88, 0.88) });
      page.drawText("LINE ITEM", { x: lm, y: zy, size: 6.5, font: hvB, color: rgb(0, 0, 0) });
      page.drawText("QTY", { x: qtyX, y: zy, size: 6.5, font: hvB, color: rgb(0, 0, 0) });
      page.drawText("UNIT", { x: unitX, y: zy, size: 6.5, font: hvB, color: rgb(0, 0, 0) });
      page.drawText("TOTAL", { x: totalX, y: zy, size: 6.5, font: hvB, color: rgb(0, 0, 0) });
      zy -= 11;
      for (const li of sc.lineItems.slice(0, 8)) {
        if (zy < 8) break;
        page.drawText(truncate(String(li.name || ""), 40), { x: lm, y: zy, size: 6.3, font: hv, color: rgb(0.2, 0.2, 0.2) });
        if (li.quantity != null) page.drawText(String(li.quantity), { x: qtyX, y: zy, size: 6.3, font: cour, color: rgb(0.2, 0.2, 0.2) });
        if (li.unitPrice != null) page.drawText(`$${fmtMoney(Number(li.unitPrice))}`, { x: unitX, y: zy, size: 6.3, font: cour, color: rgb(0.2, 0.2, 0.2) });
        if (li.lineTotal != null) page.drawText(`$${fmtMoney(Number(li.lineTotal))}`, { x: totalX, y: zy, size: 6.3, font: cour, color: rgb(0.2, 0.2, 0.2) });
        zy -= 10;
      }
    }

    const bytes = await doc.save();
    const outPath = path.join(OUT_DIR, `${sc.slug}.pdf`);
    fs.writeFileSync(outPath, bytes);
    console.log(`${OUT}/${sc.slug}.pdf — ${micrString.length} MICR chars, ${sc.lineItems.length} line items, checkKind=${sc.checkKind}, final=${sc.isFinalPayment}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
