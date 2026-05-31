import type { Request, Response, NextFunction, Express } from "express";

/**
 * API JSON-only guard middleware.
 *
 * Ensures every /api/* response carries Content-Type: application/json.
 * Sets the header as the default early in the pipeline so handlers that
 * forget res.json() still produce a parseable response.  Logs a warning
 * on "finish" whenever a non-JSON content-type is detected so the problem
 * surfaces in logs immediately without silently returning HTML to clients.
 *
 * Mounted with:
 *   applyApiJsonGuard(app)     — registers app.use("/api", ...) on the given app
 *   apiJsonGuardMiddleware      — raw middleware for use in app.use("/api", fn)
 */
export function apiJsonGuardMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader("Content-Type", "application/json");
  res.on("finish", () => {
    const ct = res.getHeader("Content-Type");
    const ctStr = Array.isArray(ct) ? ct[0] : String(ct ?? "");
    if (!ctStr.includes("application/json")) {
      console.warn(
        `[API JSON guard] Non-JSON response sent for ${req.method} ${req.originalUrl} — ` +
        `Content-Type: ${ctStr || "(none)"}, status: ${res.statusCode}. ` +
        `This likely means an unregistered route fell through to a non-API handler.`
      );
    }
  });
  next();
}

export function applyApiJsonGuard(app: Express): void {
  app.use("/api", apiJsonGuardMiddleware);
}
