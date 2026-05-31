import express, { type Express } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const viteLogger = createLogger();
const MARKETING_PAGES = [
  "demo", "features", "pricing", "security", "contact",
  "vendor-portal", "terms", "privacy", "signup", "clock",
];

function resolveMarketingPath() {
  const candidates = [
    path.resolve(import.meta.dirname, "marketing-public"),
    path.resolve(process.cwd(), "public-site", "public"),
    path.resolve(import.meta.dirname, "public-site", "public"),
    path.resolve(import.meta.dirname, "..", "public-site", "public"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

export async function setupVite(server: Server, app: Express) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server, path: "/vite-hmr" },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);

  const marketingPath = resolveMarketingPath();
  if (marketingPath) {
    app.use(express.static(marketingPath, { index: false }));
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
    // public marketing homepage at / in dev mode.  Do NOT remove, reorder, or
    // replace with the React SPA catch-all.
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

  app.use("/{*path}", async (req, res, next) => {
    // Never serve HTML for API routes — they must be handled by Express API handlers or return 404.
    // Use req.originalUrl (not req.path) because Express 5 strips the wildcard prefix from
    // req.path inside app.use("/{*path}", ...), making req.path lose its leading slash and
    // causing startsWith("/api/") to silently fail (e.g. "api/app-doctor/reports" has no leading slash).
    const urlPath = req.originalUrl.split("?")[0];
    if (urlPath.startsWith("/api/")) {
      const { apiNotFoundHandler } = await import("./middleware/api-not-found.js");
      return apiNotFoundHandler(req, res);
    }

    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
