/**
 * Proof-of-payment documents for contractor-invoice and vendor/expense payments.
 *
 * Every completed payment — check, cash, ACH, trade/barter, rent credit, or
 * other — can render two copies:
 *   - the payee copy   ("Contractor Payment Statement — Nonemployee Compensation"
 *                        for a contractor; "Vendor Payment Receipt" for a vendor)
 *   - the company copy  ("Company Payment Receipt — Company Copy")
 *
 * These are ACCOUNTING documents, not the check face. They are deliberately free
 * of any employee-payroll language: no "paystub", no wages / FICA / withholding /
 * PTO / sick leave / benefits. A contractor is paid nonemployee compensation.
 *
 * Pure renderer: the caller loads + authorizes the records and passes plain data
 * in; this module has no DB and no Express, so the wording is unit-testable.
 */
import type { DocStyle, PdfLike } from "./contractor-pdf-style";
import { renderDocHeader } from "./contractor-pdf-style";

export const CONTRACTOR_PAYMENT_STATEMENT_HEADING = "CONTRACTOR PAYMENT STATEMENT — NONEMPLOYEE COMPENSATION";
export const CONTRACTOR_PAYMENT_STATEMENT_DISCLAIMER =
  "This is a record of nonemployee compensation paid to an independent contractor. It is not an employee wage statement. No payroll taxes were withheld.";
export const VENDOR_PAYMENT_RECEIPT_HEADING = "VENDOR PAYMENT RECEIPT";
export const COMPANY_PAYMENT_RECEIPT_HEADING = "COMPANY PAYMENT RECEIPT — COMPANY COPY";

/** Language that must never appear on a contractor / vendor payment document. */
export const FORBIDDEN_PAYMENT_DOC_TERMS = [
  "paystub", "pay stub", "payroll tax", "fica", "withholding", "withheld tax",
  "pto", "sick leave", "employee benefit", "employee wage", "net pay",
] as const;

export type PaymentDocCopy = "payee" | "company";
export type PayeeKind = "contractor" | "vendor";

export interface PaymentDocLineItem {
  name: string;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
  lineTotal?: number | string | null;
}

export interface PaymentDocInput {
  copy: PaymentDocCopy;
  payeeKind: PayeeKind;
  style: DocStyle;
  company: { name: string; addressLines: string[] };
  payee: { name: string; addressLines: string[] };
  reference: {
    /** e.g. "Payment on Invoice #1042" */
    documentNumberLabel: string;
    /** proposal title / invoice description */
    title?: string | null;
    /** contract / proposal reference */
    contractReference?: string | null;
    invoiceNumber?: string | null;
    lineItems?: PaymentDocLineItem[];
  };
  payment: {
    paymentId: string;
    method: string;
    methodLabel: string;
    amountPaid: number;
    paymentDate: string; // already formatted
    checkNumber?: string | null;
    referenceNumber?: string | null;
    description?: string | null;
    /** approved fair-market trade/barter value backing a trade_credit payment */
    tradeValuation?: number | null;
  };
  balances: {
    approvedAmount: number;
    amountPaidToDate: number;
    remainingBalance: number;
  };
}

const money = (v: number) => `$${(Number.isFinite(v) ? v : 0).toFixed(2)}`;

function docHeading(input: PaymentDocInput): string {
  if (input.copy === "company") return COMPANY_PAYMENT_RECEIPT_HEADING;
  return input.payeeKind === "contractor" ? CONTRACTOR_PAYMENT_STATEMENT_HEADING : VENDOR_PAYMENT_RECEIPT_HEADING;
}

/**
 * Render both-copy-capable payment document. Returns PDF bytes. Uses jspdf via a
 * dynamic import so this module stays out of the test-time dependency graph.
 */
export async function renderPaymentDocumentPdf(input: PaymentDocInput): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const heading = docHeading(input);

  let y = renderDocHeader(doc as unknown as PdfLike, pageWidth, input.style, {
    displayName: input.company.name || "PayLink",
    documentTypeLabel: heading,
    documentNumberLabel: input.reference.documentNumberLabel,
    dateLabel: input.payment.paymentDate,
  });

  // ── Parties ────────────────────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("Payer (Company)", 14, y);
  doc.text(input.payeeKind === "contractor" ? "Payee (Contractor)" : "Payee (Vendor)", pageWidth / 2, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  const payerLines = [input.company.name, ...input.company.addressLines].filter(Boolean);
  const payeeLines = [input.payee.name, ...input.payee.addressLines].filter(Boolean);
  const partyRows = Math.max(payerLines.length, payeeLines.length);
  for (let i = 0; i < partyRows; i++) {
    if (payerLines[i]) doc.text(String(payerLines[i]), 14, y);
    if (payeeLines[i]) doc.text(String(payeeLines[i]), pageWidth / 2, y);
    y += 4.5;
  }
  y += 4;
  doc.setTextColor(0, 0, 0);

  // ── What this payment is for ───────────────────────────────────────────────
  const refBits = [
    input.reference.title ? `For: ${input.reference.title}` : "",
    input.reference.invoiceNumber ? `Invoice #: ${input.reference.invoiceNumber}` : "",
    input.reference.contractReference ? `Contract / Proposal ref: ${input.reference.contractReference}` : "",
  ].filter(Boolean);
  if (refBits.length) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 80);
    for (const line of refBits) { doc.text(line, 14, y); y += 4.5; }
    y += 3;
    doc.setTextColor(0, 0, 0);
  }

  // ── Line items (if the approved proposal/invoice carried them) ─────────────
  const items = (input.reference.lineItems || []).filter((li) => li && (li.name || li.lineTotal != null));
  if (items.length) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Approved Line Items", 14, y);
    y += 3;
    autoTable(doc, {
      startY: y,
      head: [["Description", "Qty", "Unit", "Amount"]],
      body: items.map((li) => [
        String(li.name || ""),
        String(li.quantity ?? "1"),
        money(parseFloat(String(li.unitPrice ?? "0")) || 0),
        money(parseFloat(String(li.lineTotal ?? "0")) || 0),
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: input.style.primaryRgb, textColor: [255, 255, 255], fontStyle: "bold" },
      margin: { left: 14, right: 14 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ── Payment detail ────────────────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Payment", 14, y);
  y += 3;
  const paymentRows: Array<[string, string]> = [
    ["Payment method", input.payment.methodLabel],
    ...(input.payment.method === "check" && input.payment.checkNumber ? [["Check number", String(input.payment.checkNumber)]] as Array<[string, string]> : []),
    ...(input.payment.method !== "check" && input.payment.referenceNumber ? [["Reference", String(input.payment.referenceNumber)]] as Array<[string, string]> : []),
    ...(input.payment.description ? [["Description", String(input.payment.description)]] as Array<[string, string]> : []),
    ...(input.payment.method === "trade_credit" && input.payment.tradeValuation != null
      ? [["Approved trade / barter value (fair market value)", money(input.payment.tradeValuation)]] as Array<[string, string]>
      : []),
    ["Payment date", input.payment.paymentDate],
    ["Amount paid", money(input.payment.amountPaid)],
  ];
  autoTable(doc, {
    startY: y,
    body: paymentRows,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 1.2 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 78 } },
    margin: { left: 14, right: 14 },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // ── Balance summary ───────────────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    body: [
      ["Approved amount", money(input.balances.approvedAmount)],
      ["Total paid to date", money(input.balances.amountPaidToDate)],
      ["Remaining balance", money(input.balances.remainingBalance)],
    ],
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 1.2 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 78 }, 1: { halign: "right", cellWidth: 40 } },
    margin: { left: 14, right: 14 },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // ── Copy label + contractor disclaimer ────────────────────────────────────
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110, 110, 110);
  if (input.copy === "company") {
    doc.text("COMPANY COPY — retain for your records.", 14, y);
    y += 4;
  } else if (input.payeeKind === "contractor") {
    const lines = doc.splitTextToSize(CONTRACTOR_PAYMENT_STATEMENT_DISCLAIMER, pageWidth - 28) as string[];
    doc.text(lines, 14, y);
    y += lines.length * 4;
  } else {
    doc.text("Vendor payment receipt — retain for your records.", 14, y);
    y += 4;
  }
  doc.setTextColor(150, 150, 150);
  doc.text(`Document ref: ${input.payment.paymentId}`, 14, y + 2);

  return doc.output("arraybuffer") as unknown as Uint8Array;
}
