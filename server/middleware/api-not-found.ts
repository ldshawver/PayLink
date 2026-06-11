import type { Request, Response } from "express";

/**
 * API 404 catch-all handler.
 *
 * Returns a JSON 404 response for any /api/* path that was not matched by a
 * registered route.  Mount this AFTER all real /api routes so it only fires
 * for unregistered paths.
 *
 * This is the same logic used in server/vite.ts for the dev Vite catch-all
 * and in server/static.ts for production.  Keeping it here lets both the
 * production middleware and the integration tests share the same handler.
 *
 * Usage:
 *   app.use("/api/{*path}", apiNotFoundHandler);
 */
export function apiNotFoundHandler(req: Pick<Request, "originalUrl">, res: Response): void {
  const urlPath = req.originalUrl.split("?")[0];
  res.status(404).json({ message: "API route not found", path: urlPath });
}
