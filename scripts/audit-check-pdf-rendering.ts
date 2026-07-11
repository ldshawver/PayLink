import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const outDir = "/tmp/paylink-check-audit";
fs.mkdirSync(outDir, { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  outputDirectory: outDir,
  committedArtifacts: false,
  pageSizePoints: { width: 612, height: 792 },
  sections: {
    checkFace: { top: 0, bottom: 252 },
    upperPaystub: { top: 252, bottom: 504 },
    lowerCompanyCopy: { top: 504, bottom: 792 },
    micrBaselineFromCheckTopInches: 3.38,
  },
  physicalPrintStatus: "blocked: requires staging printer and intended check stock",
};
const reportPath = path.join(outDir, "coordinate-report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const hash = crypto.createHash("sha256").update(fs.readFileSync(reportPath)).digest("hex");
fs.writeFileSync(path.join(outDir, "manifest.sha256"), `${hash}  coordinate-report.json\n`);
console.log(`Audit report written to ${reportPath}`);
console.log(`SHA256 ${hash}  coordinate-report.json`);
