/**
 * Contractor PDF styling — pure helpers + DB resolver for proposal/invoice PDFs.
 *
 * Style variants supported (mapped from contractor_templates.layout_variant):
 *   - 'modern'  : dual-color split header bar, totals filled with primary color
 *   - 'classic' : single solid header strip + centered company name, framed totals box
 *   - 'minimal' : no header fill — name in primary color with thin colored rule, plain totals
 *
 * All three variants honor contractor_branding.primary_color and secondary_color
 * when present, and fall back to PayLink defaults otherwise.
 */
import { db } from "./db";
import { sql } from "drizzle-orm";

export type StyleVariant = "modern" | "classic" | "minimal";
export type Rgb = [number, number, number];

export interface DocStyle {
  variant: StyleVariant;
  primaryRgb: Rgb;
  secondaryRgb: Rgb;
  businessName: string | null;
  footerText: string | null;
  /** Absolute or app-relative path to the contractor's logo (from contractor_branding.logo_path). Null when no logo uploaded. */
  logoPath: string | null;
}

const DEFAULT_PRIMARY: Rgb = [13, 148, 136];
const DEFAULT_SECONDARY: Rgb = [37, 99, 235];

export function hexToRgb(hex: string | null | undefined, fallback: Rgb): Rgb {
  if (!hex) return fallback;
  const m = String(hex).replace("#", "").trim().match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return fallback;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

export function normalizeVariant(input: string | null | undefined): StyleVariant {
  const v = String(input || "").toLowerCase();
  if (v === "classic" || v === "minimal" || v === "modern") return v;
  return "modern";
}

/**
 * Resolve a document's style by joining the linked template's layout_variant and
 * the contractor's branding colors. Both inputs are optional; sensible defaults
 * are returned when records are missing. Pure-DB read — never throws on missing
 * rows.
 */
export async function resolveDocStyle(
  templateId: string | null | undefined,
  contractorWorkerId: string | null | undefined,
  companyId?: string | null,
): Promise<DocStyle> {
  let variant: StyleVariant = "modern";
  let businessName: string | null = null;
  let footerText: string | null = null;
  let primaryHex: string | null = null;
  let secondaryHex: string | null = null;
  let logoPath: string | null = null;

  if (templateId) {
    try {
      // Tenant-scoped lookup: only resolve global templates OR templates owned
      // by the same tenant. Cross-tenant template IDs silently fall back to
      // defaults rather than leaking another tenant's style.
      const t = companyId
        ? await db.execute(
            sql`SELECT layout_variant FROM contractor_templates
                WHERE id = ${templateId}
                  AND (is_global = TRUE OR company_id = ${companyId})
                LIMIT 1`,
          )
        : await db.execute(
            sql`SELECT layout_variant FROM contractor_templates
                WHERE id = ${templateId} AND is_global = TRUE LIMIT 1`,
          );
      const row = t.rows[0] as { layout_variant?: string } | undefined;
      variant = normalizeVariant(row?.layout_variant);
    } catch {
      /* leave default */
    }
  }
  if (contractorWorkerId) {
    try {
      const b = await db.execute(
        sql`SELECT business_name, primary_color, secondary_color, footer_text, logo_path
            FROM contractor_branding WHERE worker_id = ${contractorWorkerId} LIMIT 1`,
      );
      const br = b.rows[0] as
        | { business_name?: string; primary_color?: string; secondary_color?: string; footer_text?: string; logo_path?: string }
        | undefined;
      if (br) {
        businessName = br.business_name || null;
        primaryHex = br.primary_color || null;
        secondaryHex = br.secondary_color || null;
        footerText = br.footer_text || null;
        logoPath = br.logo_path || null;
      }
    } catch {
      /* leave defaults */
    }
  }

  return {
    variant,
    primaryRgb: hexToRgb(primaryHex, DEFAULT_PRIMARY),
    secondaryRgb: hexToRgb(secondaryHex, DEFAULT_SECONDARY),
    businessName,
    footerText,
    logoPath,
  };
}

/**
 * Minimal jsPDF surface used by header/totals helpers. Typed against the public
 * jsPDF API (no `any`) so the helpers stay testable without pulling jspdf as a
 * test-time dep.
 */
export interface PdfLike {
  setFillColor: (r: number, g: number, b: number) => void;
  setTextColor: (r: number, g: number, b: number) => void;
  setDrawColor: (r: number, g: number, b: number) => void;
  setLineWidth: (w: number) => void;
  setFontSize: (n: number) => void;
  setFont: (family: string, style?: string) => void;
  rect: (x: number, y: number, w: number, h: number, style?: string) => void;
  line: (x1: number, y1: number, x2: number, y2: number) => void;
  text: (text: string | string[], x: number, y: number, opts?: { align?: "left" | "center" | "right" | "justify" }, transform?: unknown) => void;
}

/**
 * Render the document header for the chosen variant. Returns the Y coordinate
 * where body content should start.
 */
export function renderDocHeader(
  doc: PdfLike,
  pageWidth: number,
  style: DocStyle,
  opts: { displayName: string; documentTypeLabel: string; documentNumberLabel: string; dateLabel: string },
): number {
  const [pr, pg, pb] = style.primaryRgb;
  const [sr, sg, sb] = style.secondaryRgb;
  const { displayName, documentTypeLabel, documentNumberLabel, dateLabel } = opts;

  if (style.variant === "modern") {
    doc.setFillColor(pr, pg, pb);
    doc.rect(0, 0, pageWidth, 28, "F");
    doc.setFillColor(sr, sg, sb);
    doc.rect(pageWidth * 0.6, 0, pageWidth * 0.4, 28, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text(displayName, 14, 12);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(documentTypeLabel, 14, 20);
    doc.setFontSize(9);
    doc.text(dateLabel, pageWidth - 14, 12, { align: "right" });
    doc.text(documentNumberLabel, pageWidth - 14, 20, { align: "right" });
    doc.setTextColor(0, 0, 0);
    return 38;
  }

  if (style.variant === "classic") {
    doc.setFillColor(pr, pg, pb);
    doc.rect(0, 0, pageWidth, 14, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(documentTypeLabel.toUpperCase(), pageWidth / 2, 9, { align: "center" });
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text(displayName, pageWidth / 2, 26, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 80);
    doc.text(`${documentNumberLabel}    ${dateLabel}`, pageWidth / 2, 32, { align: "center" });
    doc.setDrawColor(pr, pg, pb);
    doc.setLineWidth(0.3);
    doc.line(14, 36, pageWidth - 14, 36);
    doc.setTextColor(0, 0, 0);
    return 44;
  }

  // minimal
  doc.setTextColor(pr, pg, pb);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(displayName, 14, 16);
  doc.setTextColor(120, 120, 120);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(documentTypeLabel, 14, 22);
  doc.setFontSize(9);
  doc.text(`${documentNumberLabel}  ·  ${dateLabel}`, pageWidth - 14, 16, { align: "right" });
  doc.setDrawColor(pr, pg, pb);
  doc.setLineWidth(0.3);
  doc.line(14, 26, pageWidth - 14, 26);
  doc.setTextColor(0, 0, 0);
  return 34;
}

/**
 * Render a totals block (subtotal/discount/tax/total) styled per variant.
 * Returns updated Y coordinate.
 */
export function renderTotalsBlock(
  doc: PdfLike,
  pageWidth: number,
  y: number,
  style: DocStyle,
  totals: { subtotal?: number; discount?: number; tax?: number; total: number; totalLabel?: string },
): number {
  const [pr, pg, pb] = style.primaryRgb;
  const totalLabel = totals.totalLabel || "Total";
  let cursor = y;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0, 0, 0);
  if (totals.subtotal && totals.subtotal > 0) {
    doc.text(`Subtotal: $${totals.subtotal.toFixed(2)}`, pageWidth - 14, cursor, { align: "right" });
    cursor += 6;
  }
  if (totals.discount && totals.discount > 0) {
    doc.text(`Discount: -$${totals.discount.toFixed(2)}`, pageWidth - 14, cursor, { align: "right" });
    cursor += 6;
  }
  if (totals.tax && totals.tax > 0) {
    doc.text(`Tax: $${totals.tax.toFixed(2)}`, pageWidth - 14, cursor, { align: "right" });
    cursor += 6;
  }

  if (style.variant === "modern") {
    // Filled box on right
    const boxW = 70;
    const boxX = pageWidth - 14 - boxW;
    doc.setFillColor(pr, pg, pb);
    doc.rect(boxX, cursor, boxW, 10, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`${totalLabel}: $${totals.total.toFixed(2)}`, pageWidth - 17, cursor + 7, { align: "right" });
    doc.setTextColor(0, 0, 0);
    return cursor + 16;
  }

  if (style.variant === "classic") {
    // Bordered framed totals box
    const boxW = 80;
    const boxX = pageWidth - 14 - boxW;
    doc.setDrawColor(pr, pg, pb);
    doc.setLineWidth(0.5);
    doc.rect(boxX, cursor, boxW, 10);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`${totalLabel}: $${totals.total.toFixed(2)}`, pageWidth - 17, cursor + 7, { align: "right" });
    return cursor + 16;
  }

  // minimal — plain right-aligned total in primary color
  doc.setTextColor(pr, pg, pb);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text(`${totalLabel}  $${totals.total.toFixed(2)}`, pageWidth - 14, cursor + 5, { align: "right" });
  doc.setTextColor(0, 0, 0);
  return cursor + 12;
}
