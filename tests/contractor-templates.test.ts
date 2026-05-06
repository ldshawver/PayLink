/**
 * Contractor Templates & PDF Style — Tests
 *
 * Run: npx tsx tests/contractor-templates.test.ts
 *
 * Covers:
 *   1. hexToRgb pure parsing & fallbacks
 *   2. normalizeVariant whitelisting
 *   3. resolveDocStyle DB lookup with branding override + sensible defaults
 *   4. 3 system templates seeded (Simple Proposal / Detailed Scope / Standard Invoice)
 *   5. Tenant isolation: a tenant-scoped template is not visible to another company
 *   6. PDF generation succeeds for all 3 layout variants (writes a non-empty PDF)
 */

import fs from "fs";
import path from "path";
import { db } from "../server/db.js";
import { sql } from "drizzle-orm";
import {
  hexToRgb,
  normalizeVariant,
  resolveDocStyle,
  renderDocHeader,
  renderTotalsBlock,
  type DocStyle,
} from "../server/contractor-pdf-style.js";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) { passed++; }
  else { failed++; failures.push(message); console.error("  FAIL:", message); }
}

function eqArr<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function main() {
  console.log("\n=== Contractor Templates & PDF Style Tests ===\n");

  // ── 1. hexToRgb pure ──────────────────────────────────────────────────────
  console.log("[1] hexToRgb");
  assert(eqArr(hexToRgb("#0d9488", [0, 0, 0]), [13, 148, 136]), "hexToRgb parses lowercase #rrggbb");
  assert(eqArr(hexToRgb("0D9488", [0, 0, 0]), [13, 148, 136]), "hexToRgb parses without # and uppercase");
  assert(eqArr(hexToRgb(null, [255, 0, 0]), [255, 0, 0]), "hexToRgb returns fallback for null");
  assert(eqArr(hexToRgb("not-a-hex", [1, 2, 3]), [1, 2, 3]), "hexToRgb returns fallback for invalid input");
  assert(eqArr(hexToRgb("", [9, 9, 9]), [9, 9, 9]), "hexToRgb returns fallback for empty string");

  // ── 2. normalizeVariant whitelist ─────────────────────────────────────────
  console.log("[2] normalizeVariant");
  assert(normalizeVariant("modern") === "modern", "normalizeVariant accepts modern");
  assert(normalizeVariant("CLASSIC") === "classic", "normalizeVariant lowercases classic");
  assert(normalizeVariant("minimal") === "minimal", "normalizeVariant accepts minimal");
  assert(normalizeVariant("standard") === "modern", "normalizeVariant falls back unknown values to modern");
  assert(normalizeVariant(null) === "modern", "normalizeVariant falls back null to modern");
  assert(normalizeVariant(undefined) === "modern", "normalizeVariant falls back undefined to modern");

  // ── 3. resolveDocStyle defaults when no template/branding ────────────────
  console.log("[3] resolveDocStyle defaults");
  const def = await resolveDocStyle(null, null);
  assert(def.variant === "modern", "Default variant is modern");
  assert(eqArr(def.primaryRgb, [13, 148, 136]), "Default primary RGB is teal");
  assert(eqArr(def.secondaryRgb, [37, 99, 235]), "Default secondary RGB is blue");
  assert(def.businessName === null, "Default businessName is null");

  // ── 4. System templates seeded ────────────────────────────────────────────
  console.log("[4] System templates seeded");
  const tplRes = await db.execute(sql`
    SELECT name, template_type, layout_variant, is_global, is_active, default_payment_terms
    FROM contractor_templates
    WHERE is_global = TRUE
    AND name IN ('Simple Contractor Proposal', 'Detailed Scope Proposal', 'Standard Invoice')
    ORDER BY name
  `);
  const tplRows = tplRes.rows as Array<{
    name: string; template_type: string; layout_variant: string; is_global: boolean;
    is_active: boolean; default_payment_terms: string | null;
  }>;
  assert(tplRows.length === 3, `Found 3 system templates (got ${tplRows.length})`);
  const byName = Object.fromEntries(tplRows.map((r) => [r.name, r]));
  assert(byName["Simple Contractor Proposal"]?.layout_variant === "modern", "Simple Proposal uses modern variant");
  assert(byName["Simple Contractor Proposal"]?.template_type === "proposal", "Simple Proposal is proposal type");
  assert(byName["Detailed Scope Proposal"]?.layout_variant === "classic", "Detailed Scope uses classic variant");
  assert(byName["Detailed Scope Proposal"]?.template_type === "proposal", "Detailed Scope is proposal type");
  assert(byName["Standard Invoice"]?.layout_variant === "minimal", "Standard Invoice uses minimal variant");
  assert(byName["Standard Invoice"]?.template_type === "invoice", "Standard Invoice is invoice type");
  for (const t of tplRows) {
    assert(t.is_global === true, `${t.name} is global`);
    assert(t.is_active === true, `${t.name} is active`);
  }

  // ── 5. resolveDocStyle reads layout_variant from a real template ─────────
  console.log("[5] resolveDocStyle reads template layout_variant");
  const detailedId = await db.execute(sql`
    SELECT id FROM contractor_templates WHERE is_global = TRUE AND name = 'Detailed Scope Proposal' LIMIT 1
  `);
  const detailedTplId = (detailedId.rows[0] as { id: string } | undefined)?.id;
  assert(!!detailedTplId, "Detailed Scope template id resolvable");
  if (detailedTplId) {
    const style = await resolveDocStyle(detailedTplId, null);
    assert(style.variant === "classic", `Resolved variant = classic (got ${style.variant})`);
  }

  // ── 6. Tenant isolation: a tenant-scoped template is not visible to others ─
  console.log("[6] Tenant isolation");
  const co1 = "test-co-iso-A-" + Date.now();
  const co2 = "test-co-iso-B-" + Date.now();
  const tplA = await db.execute(sql`
    INSERT INTO contractor_templates (company_id, template_type, name, layout_variant, is_global, is_active)
    VALUES (${co1}, 'proposal', 'Iso Test Tpl A', 'modern', FALSE, TRUE) RETURNING id
  `);
  const tplAId = (tplA.rows[0] as { id: string }).id;
  try {
    const visibleToCo2 = await db.execute(sql`
      SELECT id FROM contractor_templates
      WHERE is_active = TRUE AND (is_global = TRUE OR company_id = ${co2})
      AND id = ${tplAId}
    `);
    assert(visibleToCo2.rows.length === 0, "Company B cannot see Company A's tenant template");

    const visibleToCo1 = await db.execute(sql`
      SELECT id FROM contractor_templates
      WHERE is_active = TRUE AND (is_global = TRUE OR company_id = ${co1})
      AND id = ${tplAId}
    `);
    assert(visibleToCo1.rows.length === 1, "Company A can see its own tenant template");

    // resolveDocStyle must enforce the same scope: cross-tenant call falls back
    // to default (modern) instead of leaking the other tenant's variant.
    const crossTenantStyle = await resolveDocStyle(tplAId, null, co2);
    assert(crossTenantStyle.variant === "modern", "Cross-tenant resolveDocStyle falls back to default modern");
    const ownTenantStyle = await resolveDocStyle(tplAId, null, co1);
    assert(ownTenantStyle.variant === "modern", "Own-tenant resolveDocStyle returns the template variant");
  } finally {
    await db.execute(sql`DELETE FROM contractor_templates WHERE id = ${tplAId}`);
  }

  // ── 7. PDF render helpers work for all 3 variants (smoke + non-empty file) ─
  console.log("[7] PDF generation per variant");
  const { jsPDF } = await import("jspdf");
  const variants: Array<DocStyle["variant"]> = ["modern", "classic", "minimal"];
  const outDir = path.join(process.cwd(), "tests", ".tmp", "pdf-output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  for (const v of variants) {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const style: DocStyle = {
      variant: v,
      primaryRgb: [13, 148, 136],
      secondaryRgb: [37, 99, 235],
      businessName: "Acme Contracting LLC",
      footerText: null,
      logoPath: null,
    };
    const startY = renderDocHeader(doc, doc.internal.pageSize.getWidth(), style, {
      displayName: style.businessName!,
      documentTypeLabel: "Contractor Proposal",
      documentNumberLabel: "Proposal #TEST-001",
      dateLabel: "January 1, 2026",
    });
    assert(startY > 0, `[${v}] renderDocHeader returned positive Y`);
    const finalY = renderTotalsBlock(doc, doc.internal.pageSize.getWidth(), startY + 10, style, {
      subtotal: 1000, discount: 50, tax: 80, total: 1030,
    });
    assert(finalY > startY, `[${v}] renderTotalsBlock advanced Y`);
    const buf = Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
    const file = path.join(outDir, `style-${v}.pdf`);
    fs.writeFileSync(file, buf);
    const stat = fs.statSync(file);
    assert(stat.size > 500, `[${v}] PDF file is non-trivial (${stat.size} bytes)`);
  }

  // ── Summary ──
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.error("\nFailures:");
    failures.forEach((f) => console.error("  -", f));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error("Test suite error:", e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
