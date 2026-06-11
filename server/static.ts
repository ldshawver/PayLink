import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "fs";
import path from "path";

const API_ROUTES = new Set(["/health", "/ready"]);

// Marketing pages served at top-level routes (e.g. /demo, /features)
const MARKETING_PAGES = [
  "demo", "features", "pricing", "security", "contact",
  "vendor-portal", "terms", "privacy", "signup", "clock",
];

const APP_EXACT_ROUTES = new Set([
  "/login",
  "/clock-in",
  "/time-clock",
  "/signing-complete",
]);

const APP_ROUTE_PREFIXES = [
  "/app",
  "/platform",
];

function resolveMarketingPath() {
  const candidates = [
    path.resolve(__dirname, "public"),
    path.resolve(__dirname, "marketing-public"),
    path.resolve(process.cwd(), "public-site", "public"),
    path.resolve(__dirname, "public-site", "public"),
    path.resolve(__dirname, "..", "public-site", "public"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  function sendAppShell(req: Request, res: Response) {
    const appShell = path.resolve(distPath, "app.html");
    const shellPath = fs.existsSync(appShell) ? appShell : path.resolve(distPath, "index.html");
    const headers: Record<string, string> = {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    };
    if (req.path === "/login") {
      headers["Clear-Site-Data"] = '"cache", "storage"';
    }
    res.sendFile(shellPath, { headers });
  }

  // App routes must win before the marketing static handler. Otherwise /login
  // can fall through to the public marketing index and the real login UI never loads.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (APP_EXACT_ROUTES.has(req.path) || APP_ROUTE_PREFIXES.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
      return sendAppShell(req, res);
    }
    next();
  });

  // ── Marketing site static assets (css, js, assets, images) ───────────────
  const marketingPath = resolveMarketingPath();
  if (marketingPath) {
    app.use(express.static(marketingPath));
  }

  // ── Marketing page routes ─────────────────────────────────────────────────
  // These serve the marketing HTML files so /demo, /features, etc. work
  // even when nginx routes the request to port 8000 instead of port 3000.
  if (marketingPath) {
    for (const page of MARKETING_PAGES) {
      const htmlFile = path.join(marketingPath, `${page}.html`);
      if (fs.existsSync(htmlFile)) {
        app.get(`/${page}`, (_req, res) => {
          res.sendFile(htmlFile);
        });
      }
    }
    // ── MARKETING HOMEPAGE LOCK ─────────────────────────────────────────────
    // PROTECTED: This serves public-site/public/index.html as the approved
    // public marketing homepage at /.  Do NOT remove, reorder above the
    // APP_EXACT_ROUTES guard, or replace with sendAppShell / redirect to /login.
    // Required hero: time punch card visual + Clock In modal (Employee Number + PIN).
    // See: docs/marketing-page-lock.md
    app.get("/", (_req, res, next) => {
      const indexFile = path.join(marketingPath, "index.html");
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        next();
      }
    });
  }

  // ── React app static assets (hashed filenames) ────────────────────────────
  // index.html is the approved public marketing homepage. The React app shell
  // is preserved as app.html and used by the SPA catch-all below.
  app.use(express.static(distPath, {
    setHeaders(res, filePath) {
      if (filePath.endsWith("sw.js") || filePath.endsWith("app.html") || filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      }
    },
  }));

  // ── React SPA catch-all (app pages, login, clock-in, etc.) ───────────────
  // Exclude static asset paths so missing files return 404 instead of index.html.
  // A 200 index.html response for /fonts/micrenc.ttf would be cached by the
  // service worker's CacheFirst font strategy and permanently break font loading.
  const STATIC_ASSET_PREFIXES = ["/api/", "/uploads/", "/fonts/", "/assets/", "/icons/"];
  app.use("/{*path}", (req, res, next) => {
    if (STATIC_ASSET_PREFIXES.some(p => req.path.startsWith(p)) || API_ROUTES.has(req.path)) {
      return next();
    }
    sendAppShell(req as Request, res);
  });
}
