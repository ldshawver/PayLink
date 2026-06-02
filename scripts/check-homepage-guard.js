#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Homepage integrity guard — fails if the approved marketing homepage is missing
// required elements. Run via: node scripts/check-homepage-guard.js
// Add to CI to prevent accidental replacement of the marketing homepage.
//
// PayLink serves TWO homepage layers:
//   1. public-site/public/index.html  — static HTML served at / by Express
//   2. client/src/pages/marketing-home.tsx — React fallback (if static missing)
// Both must contain the required elements.
// -----------------------------------------------------------------------------

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

let passed = 0;
let failed = 0;

function check(description, condition) {
  if (condition) {
    console.log(`  ✓  ${description}`);
    passed++;
  } else {
    console.error(`  ✗  FAIL: ${description}`);
    failed++;
  }
}

// ── 1. Static marketing homepage (public-site/public/index.html) ─────────────
console.log("\n[1] Static homepage (public-site/public/index.html)");
const staticPath = resolve(ROOT, "public-site/public/index.html");
check("public-site/public/index.html exists", existsSync(staticPath));

if (existsSync(staticPath)) {
  const html = readFileSync(staticPath, "utf8");

  check(
    "Has PayLink nav logo (PayLink branding)",
    html.includes("PayLink") && !html.toLowerCase().includes("alavont")
  );
  check(
    "Has no Alavont Holdings contamination",
    !html.toLowerCase().includes("alavont")
  );
  check(
    "Has marketing headline (h1)",
    /<h1[^>]*>[\s\S]*?<\/h1>/.test(html)
  );
  check(
    "Has time punch card / clock machine visual (.clock-machine or punch-hero)",
    html.includes("clock-machine") || html.includes("punch-hero")
  );
  check(
    "Has Clock In button in punch card",
    html.includes("Clock In") || html.includes("btnClockIn")
  );
  check(
    "Has clock-in modal (#punchModal)",
    html.includes("punchModal") || html.includes("clock-modal")
  );
  check(
    "Modal has employee number field",
    html.includes("punchEmpNum") || html.includes("employee-number") || html.includes("Employee Number")
  );
  check(
    "Modal has PIN field",
    html.includes("punchPin") || html.includes("PIN") || html.includes("pin")
  );
  check(
    "Modal employee clock-in does NOT replace homepage (modal is overlay)",
    (html.includes("punch-modal-overlay") || html.includes("modal") || html.includes("dialog")) &&
    !html.includes('window.location = "/clock-in"')
  );
  check(
    "Has /login or app.html?route=/login link for admins",
    html.includes("/login") || html.includes("route=%2Flogin")
  );
  check(
    "Has marketing sections below hero (features or footer)",
    html.includes("features") || html.includes("footer")
  );
  check(
    "Has PayLink footer copyright",
    html.includes("PayLink") && (html.includes("All rights reserved") || html.includes("footer"))
  );
}

// ── 2. React marketing-home.tsx (fallback layer) ─────────────────────────────
console.log("\n[2] React marketing homepage (client/src/pages/marketing-home.tsx)");
const homePath = resolve(ROOT, "client/src/pages/marketing-home.tsx");
check("marketing-home.tsx exists", existsSync(homePath));

if (existsSync(homePath)) {
  const src = readFileSync(homePath, "utf8");

  check(
    "Has approved lock comment header",
    src.includes("APPROVED MYPAYLINK MARKETING HOMEPAGE")
  );
  check(
    "Has marketing headline (h1)",
    /<h1[\s\S]*?<\/h1>/.test(src)
  );
  check(
    "Has time punch card visual (data-testid=time-punch-card)",
    src.includes('data-testid="time-punch-card"')
  );
  check(
    "Has Clock In button on hero",
    src.includes('data-testid="button-hero-clock-in"') ||
    src.includes('data-testid="button-punch-card-clock-in"')
  );
  check(
    "Has Clock In modal (data-testid=modal-clock-in)",
    src.includes('data-testid="modal-clock-in"')
  );
  check(
    "Has employee number field in modal",
    src.includes('data-testid="input-modal-employee-number"')
  );
  check(
    "Has PIN field in modal",
    src.includes('data-testid="input-modal-pin"')
  );
  check(
    "Clock In opens modal (not hard-navigate to /clock-in)",
    !src.includes('onClick={() => setLocation("/clock-in")}')
  );
  check(
    "Has features section",
    src.includes('id="features"')
  );
  check(
    "Has separate /login link",
    src.includes('setLocation("/login")')
  );
}

// ── 3. App.tsx routing check ──────────────────────────────────────────────────
console.log("\n[3] App.tsx routing");
const appPath = resolve(ROOT, "client/src/App.tsx");
check("App.tsx exists", existsSync(appPath));

if (existsSync(appPath)) {
  const appSrc = readFileSync(appPath, "utf8");
  check(
    "App.tsx imports MarketingHomePage",
    appSrc.includes("MarketingHomePage")
  );
  check(
    "App.tsx mounts MarketingHomePage at root (React fallback)",
    appSrc.includes("<MarketingHomePage")
  );
  check(
    "App.tsx has separate /login route",
    appSrc.includes('"/login"') || appSrc.includes("'/login'")
  );
  check(
    "App.tsx has separate /clock-in route",
    appSrc.includes('"/clock-in"') || appSrc.includes("'/clock-in'")
  );
}

// ── 4. server/vite.ts static serving check ───────────────────────────────────
console.log("\n[4] server/vite.ts static marketing site routing");
const vitePath = resolve(ROOT, "server/vite.ts");
check("server/vite.ts exists", existsSync(vitePath));

if (existsSync(vitePath)) {
  const viteSrc = readFileSync(vitePath, "utf8");
  check(
    "vite.ts serves static marketing site at /",
    viteSrc.includes("public-site") || viteSrc.includes("marketing-public")
  );
  check(
    "vite.ts sendFile index.html for root /",
    viteSrc.includes("sendFile") && viteSrc.includes("index.html")
  );
}

// ── 5. Lock docs ──────────────────────────────────────────────────────────────
console.log("\n[5] Lock documentation");
const lockPath = resolve(ROOT, "docs/marketing-homepage-lock.md");
check("docs/marketing-homepage-lock.md exists", existsSync(lockPath));

const guardrailPath = resolve(ROOT, "docs/project-scope-guardrails.md");
check("docs/project-scope-guardrails.md exists", existsSync(guardrailPath));

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("");
console.log(`Homepage guard: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error("");
  console.error("HOMEPAGE GUARD FAILED — the approved marketing homepage is incomplete or contaminated.");
  console.error("See docs/marketing-homepage-lock.md for required elements.");
  process.exit(1);
} else {
  console.log("All homepage integrity checks passed.");
  process.exit(0);
}
