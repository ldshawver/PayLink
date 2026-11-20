/**
 * Removes PIN material from every /api JSON response.
 *
 * Worker rows are returned raw by many routes; before company-scoped sign-in
 * (migration 0031) that included the plaintext `pin`. This scrubber runs on
 * every res.json() under /api and, recursively (depth- and size-bounded,
 * cycle-safe), replaces `pin` / `pinHash` / `pin_hash` with a boolean `hasPin`
 * so the admin UI can still show whether a PIN is set. It never adds fields to
 * objects that had none of those keys.
 */
import type { Express, Request, Response, NextFunction } from "express";

const PIN_KEYS = new Set(["pin", "pinHash", "pin_hash"]);
const MAX_DEPTH = 8;
const MAX_NODES = 50_000;

export function stripCredentialFields<T>(body: T): T {
  let nodes = 0;
  const seen = new WeakMap<object, unknown>();
  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (v instanceof Date || Buffer.isBuffer(v)) return v;
    if (seen.has(v as object)) return seen.get(v as object);
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return v;
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      seen.set(v, out);
      for (const item of v) out.push(walk(item, depth + 1));
      return out;
    }
    const src = v as Record<string, unknown>;
    // Only plain objects (and class instances serialised as plain JSON) are rewritten.
    const out: Record<string, unknown> = {};
    seen.set(v as object, out);
    let hadPin = false, hasPin = false;
    for (const [k, val] of Object.entries(src)) {
      if (PIN_KEYS.has(k)) {
        hadPin = true;
        if (val !== null && val !== undefined && val !== "") hasPin = true;
        continue;
      }
      out[k] = walk(val, depth + 1);
    }
    if (hadPin && !("hasPin" in out)) out.hasPin = hasPin;
    return out;
  };
  return walk(body, 0) as T;
}

export function applyStripCredentialFields(app: Express) {
  app.use("/api", (_req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    res.json = ((body?: unknown) => originalJson(stripCredentialFields(body))) as typeof res.json;
    next();
  });
}
