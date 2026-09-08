import fs from "node:fs";
import path from "node:path";

export const MAX_DIAGNOSTIC_LOG_BYTES = 256 * 1024;
export const MAX_DIAGNOSTIC_LOG_LINES = 1000;
export const DIAGNOSTIC_FILE_MODE = 0o600;
export const DIAGNOSTIC_DIR_MODE = 0o700;

// Covered tokenized public routes: /sign/contracts/, /api/signing/contracts/, /api/onboarding/portal/, /portal/validate
//
// The two /sign/ patterns use a strict token-safe character class ([A-Za-z0-9_-]{8,}) rather than
// "any non-slash character" — real tokens (crypto.randomBytes(...).toString("base64url") for
// MyPayLink, Documenso's own opaque tokens) are always plain alphanumeric/-/_. This is deliberate:
// SENSITIVE_JSON_FIELD_PATTERN below already masks these same URLs when they appear as named JSON
// fields, producing a short "…"-containing value (e.g. …VFnO…P9) that the strict class does NOT
// match — so a value already masked by the field-based pass is never re-matched and mangled here.
// This pattern still catches the same URLs when they appear bare (not as a JSON field), e.g. in a
// plain log message string.
const TOKENIZED_PATH_PATTERNS: RegExp[] = [
  /(\/sign\/contracts\/)[A-Za-z0-9_-]{8,}/gi,
  // Documenso's own direct signing path (e.g. https://document.luxit.app/sign/{token}) — distinct
  // from MyPayLink's /sign/contracts/{token} scheme above; the negative lookahead avoids
  // re-processing that already-redacted segment.
  /(\/sign\/)(?!contracts\/)[A-Za-z0-9_-]{8,}/gi,
  /(\/api\/signing\/contracts\/)[^/?#\s]+/gi,
  /(\/api\/onboarding\/portal\/)[^/?#\s]+/gi,
  /(\/onboarding\/portal\/)[^/?#\s]+/gi,
  /(\/magic-link\/)[^/?#\s]+/gi,
  /(\/reset(?:-password)?\/)[^/?#\s]+/gi,
  /(\/invite\/)[^/?#\s]+/gi,
  /(\/portal\/validate\?[^\s]*?token=)[^&#\s]+/gi,
];
const SECRET_ASSIGNMENT_PATTERN = /([?&\s;](?:token|session|jwt|password|secret|key|code|invite|reset)=)[^&#\s;]+/gi;

// Structured-log (JSON body) redaction: mask signing URLs / signing tokens by field name,
// independent of which path/domain they appear under, so a Documenso or MyPayLink signing link
// embedded in a logged response body is never written to PM2 output in full. Deliberately excludes
// id-only fields (recipientId, documenso_recipient_id, ...) — those are not secrets.
const SENSITIVE_JSON_FIELD_PATTERN =
  /"(signingUrl|signing_url|myPayLinkSigningUrl|documensoSigningUrl|documenso_signing_url|signingProviderUrl|token|signingToken|documensoToken|recipientToken)"\s*:\s*"([^"]*)"/gi;

function maskSensitiveValue(value: string): string {
  if (!value) return value;
  try {
    const u = new URL(value);
    const parts = u.pathname.split("/");
    const last = parts[parts.length - 1] || "";
    parts[parts.length - 1] = last.length > 6 ? `${last.slice(0, 4)}…${last.slice(-2)}` : "***";
    return `${u.origin}${parts.join("/")}`;
  } catch {
    return value.length > 6 ? `${value.slice(0, 3)}…${value.slice(-2)}` : "***";
  }
}

/**
 * Scoped redaction for contractor-document response bodies before they reach
 * the request logger. A contractor W-9 / compliance document's `fileName` can
 * carry a real person's name and its `fileUrl` is an internal storage path —
 * neither belongs in PM2 output. Deep-walks the value and replaces only those
 * two keys; every other field (ids, documentType, source, timestamps) is kept.
 * Intentionally narrow — not a change to the general logging pipeline.
 */
const CONTRACTOR_DOC_REDACT_KEYS = new Set(["fileName", "file_name", "fileUrl", "file_url"]);
export function redactContractorDocumentLogBody(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(redactContractorDocumentLogBody);
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = CONTRACTOR_DOC_REDACT_KEYS.has(k) && typeof v === "string" && v.length > 0
        ? "[redacted]"
        : redactContractorDocumentLogBody(v);
    }
    return out;
  }
  return input;
}

export function redactDiagnosticText(input: unknown): string {
  let output = String(input ?? "");
  // Field-based masking runs first, producing a nicely shortened value (…VFnO…P9-style) for named
  // JSON fields. It must run before the path patterns below, whose strict token-safe character
  // class is specifically chosen to skip that already-masked, "…"-containing value afterward.
  output = output.replace(SENSITIVE_JSON_FIELD_PATTERN, (_match, key: string, value: string) => `"${key}":"${maskSensitiveValue(value)}"`);
  for (const pattern of TOKENIZED_PATH_PATTERNS) output = output.replace(pattern, "$1[REDACTED]");
  output = output.replace(SECRET_ASSIGNMENT_PATTERN, "$1[REDACTED]");
  return output;
}

export function ensurePrivateDiagnosticsPath(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: DIAGNOSTIC_DIR_MODE });
  fs.chmodSync(dir, DIAGNOSTIC_DIR_MODE);
}

export function appendPrivateDiagnosticLog(filePath: string, line: string): void {
  ensurePrivateDiagnosticsPath(path.dirname(filePath));
  fs.appendFileSync(filePath, `${redactDiagnosticText(line)}\n`, { mode: DIAGNOSTIC_FILE_MODE });
  fs.chmodSync(filePath, DIAGNOSTIC_FILE_MODE);
}

export function readBoundedLogTail(filePath: string, maxBytes = MAX_DIAGNOSTIC_LOG_BYTES, maxLines = MAX_DIAGNOSTIC_LOG_LINES): string {
  const stat = fs.statSync(filePath);
  const bytesToRead = Math.min(stat.size, maxBytes);
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    fs.readSync(fd, buffer, 0, bytesToRead, Math.max(0, stat.size - bytesToRead));
    return redactDiagnosticText(buffer.toString("utf8").split(/\r?\n/).slice(-maxLines).join("\n"));
  } finally {
    fs.closeSync(fd);
  }
}
