import type { Request, Response, NextFunction } from "express";
import { redactDiagnosticText } from "./diagnostics-safety";

// API access logging (PR-E1). Writes exactly one metadata-only line per /api
// request: method, sanitized path, status, duration, request id. Response
// bodies are NEVER captured or logged — they carry bank/routing numbers, EINs,
// tax ids, names and pay amounts, and field-level redaction of bodies proved
// incomplete (prod paylink-out.log held unmasked account/routing/EIN values).
// Query strings are dropped entirely rather than redacted key-by-key.

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;
const EMAIL_SEGMENT = /[^/\s]+@[^/\s]+/g;
// Long digit runs in a path segment can be account/routing/SSN/EIN values.
const LONG_DIGIT_RUN = /\d{7,}/g;

export function sanitizeLogPath(rawUrl: unknown): string {
  let p = String(rawUrl ?? "");
  const q = p.search(/[?#]/);
  if (q !== -1) p = p.slice(0, q);
  try { p = decodeURIComponent(p); } catch { /* keep raw on malformed escapes */ }
  p = redactDiagnosticText(p);
  p = p.replace(EMAIL_SEGMENT, "[email]").replace(LONG_DIGIT_RUN, "[digits]");
  // Strip control characters so a crafted path cannot forge extra log lines.
  p = p.replace(/[\u0000-\u001f\u007f]/g, "");
  return p.length > 200 ? `${p.slice(0, 200)}…` : p;
}

export function sanitizeRequestId(raw: unknown): string {
  const id = String(raw ?? "");
  return REQUEST_ID_PATTERN.test(id) ? id : "-";
}

export function formatAccessLogLine(fields: { method: string; path: string; status: number; durationMs: number; requestId: unknown }): string {
  const method = /^[A-Z]{3,7}$/.test(fields.method) ? fields.method : "OTHER";
  return `${method} ${fields.path} ${fields.status} in ${fields.durationMs}ms rid=${sanitizeRequestId(fields.requestId)}`;
}

export function createRequestLogger(write: (line: string) => void) {
  return function requestLogger(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const path = sanitizeLogPath(req.originalUrl || req.path);
    res.on("finish", () => {
      if (!path.startsWith("/api")) return;
      write(formatAccessLogLine({
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Date.now() - start,
        requestId: (req as any).requestId,
      }));
    });
    next();
  };
}
