import express, { type Express } from "express";
import fs from "fs";
import path from "path";

const API_ROUTES = new Set(["/health", "/ready"]);

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  app.use("/{*path}", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/") || API_ROUTES.has(req.path)) {
      return next();
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
