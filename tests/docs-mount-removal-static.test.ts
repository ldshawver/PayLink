import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync("server/index.ts", "utf8");

assert.doesNotMatch(
  source,
  /app\.use\(["']\/docs["']\s*,\s*express\.static\s*\(/,
  "production must not expose the repository docs directory through express.static",
);

assert.match(
  source,
  /app\.use\(["']\/docs["']\s*,\s*\(_req, res\)\s*=>\s*res\.status\(404\)\.type\(["']text\/plain["']\)\.send\(["']Not found["']\)\)/,
  "/docs must terminate with a 404 instead of falling through to the SPA",
);

console.log("PASS: /docs production mount removed and namespace fails closed");
