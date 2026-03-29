import fs from "fs";
import path from "path";
import { db } from "./db";
import { companies } from "@shared/schema";
import { eq } from "drizzle-orm";

const LOGO_MAPPINGS: Array<{
  sourceFile: string;
  destFile: string;
  nameMatch: string;
  altName?: string;
}> = [
  {
    sourceFile: "A1_1774752109387.png",
    destFile: "company-logo-adiken-inc.png",
    nameMatch: "adiken inc",
    altName: "a1",
  },
  {
    sourceFile: "ICON-Refined-Mind_1774752151049.png",
    destFile: "company-logo-refined-mind.png",
    nameMatch: "refined mind",
  },
  {
    sourceFile: "AP-Logo-iIcon_1774752180504.png",
    destFile: "company-logo-adiken-properties.png",
    nameMatch: "adiken properties",
  },
  {
    sourceFile: "LC-Icon-Blk-WhtGlow_1774752218121.png",
    destFile: "company-logo-lucifer-cruz.png",
    nameMatch: "lucifer cruz",
  },
];

const KNOWN_BROKEN_PLACEHOLDERS = [
  "/adiken-icon.png",
  "/rm-icon.png",
  "/ap-icon.png",
  "/lc-icon.png",
];

function isEmptyOrBroken(url: string | null): boolean {
  if (!url || url.trim() === "") return true;
  return KNOWN_BROKEN_PLACEHOLDERS.includes(url);
}

export async function seedCompanyLogos() {
  const uploadsDir = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const attachedDir = path.join(process.cwd(), "attached_assets");

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  for (const mapping of LOGO_MAPPINGS) {
    const dest = path.join(uploadsDir, mapping.destFile);
    if (!fs.existsSync(dest)) {
      const src = path.join(attachedDir, mapping.sourceFile);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`[LogoSeed] Copied ${mapping.sourceFile} → ${mapping.destFile}`);
      }
    }
  }

  const allCompanies = await db.select().from(companies);

  for (const mapping of LOGO_MAPPINGS) {
    const logoUrl = `/uploads/${mapping.destFile}`;
    const destExists = fs.existsSync(path.join(uploadsDir, mapping.destFile));
    if (!destExists) continue;

    const matched = allCompanies.filter((c) => {
      if (!c.name) return false;
      const nameLower = c.name.toLowerCase().trim();
      if (nameLower.includes(mapping.nameMatch)) return true;
      if (mapping.altName && nameLower === mapping.altName) return true;
      return false;
    });

    for (const company of matched) {
      const needsIcon = isEmptyOrBroken(company.iconUrl);
      const needsLogo = isEmptyOrBroken(company.logoUrl);

      if (needsIcon || needsLogo) {
        const updates: Record<string, string> = {};
        if (needsIcon) updates.iconUrl = logoUrl;
        if (needsLogo) updates.logoUrl = logoUrl;

        await db.update(companies).set(updates).where(eq(companies.id, company.id));
        console.log(`[LogoSeed] Updated logo for "${company.name}" → ${logoUrl}`);
      }
    }

    if (matched.length === 0) {
      console.log(`[LogoSeed] No company matched "${mapping.nameMatch}" — skipped`);
    }
  }

  console.log("[LogoSeed] Company logo seeding complete");
}
