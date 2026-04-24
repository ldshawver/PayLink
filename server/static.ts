import express, { type Express } from "express";
import fs from "fs";
import path from "path";

const API_ROUTES = new Set(["/health", "/ready"]);

// Marketing pages served at top-level routes (e.g. /demo, /features)
const MARKETING_PAGES = [
  "demo", "features", "pricing", "security", "contact",
  "vendor-portal", "terms", "privacy", "signup", "clock",
];

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // ── React app static assets (hashed filenames, takes priority) ────────────
  app.use(express.static(distPath));

  // ── Marketing site static assets (css, js, assets, images) ───────────────
  const marketingPath = path.resolve(process.cwd(), "public-site", "public");
  if (fs.existsSync(marketingPath)) {
    app.use(express.static(marketingPath));
  }

  // ── Marketing page routes ─────────────────────────────────────────────────
  // These serve the marketing HTML files so /demo, /features, etc. work
  // even when nginx routes the request to port 8000 instead of port 3000.
  if (fs.existsSync(marketingPath)) {
    for (const page of MARKETING_PAGES) {
      const htmlFile = path.join(marketingPath, `${page}.html`);
      if (fs.existsSync(htmlFile)) {
        app.get(`/${page}`, (_req, res) => {
          res.sendFile(htmlFile);
        });
      }
    }
    // Root marketing page
    app.get("/", (_req, res, next) => {
      const indexFile = path.join(marketingPath, "index.html");
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        next();
      }
    });
  }

  // ── React SPA catch-all (app pages, login, clock-in, etc.) ───────────────
  // Exclude static asset paths so missing files return 404 instead of index.html.
  // A 200 index.html response for /fonts/micrenc.ttf would be cached by the
  // service worker's CacheFirst font strategy and permanently break font loading.
  const STATIC_ASSET_PREFIXES = ["/api/", "/uploads/", "/fonts/", "/assets/", "/icons/"];
  app.use("/{*path}", (req, res, next) => {
    if (STATIC_ASSET_PREFIXES.some(p => req.path.startsWith(p)) || API_ROUTES.has(req.path)) {
      return next();
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
