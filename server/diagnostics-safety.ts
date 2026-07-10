import fs from "node:fs";
import path from "node:path";

export const MAX_DIAGNOSTIC_LOG_BYTES = 256 * 1024;
export const MAX_DIAGNOSTIC_LOG_LINES = 1000;
export const DIAGNOSTIC_FILE_MODE = 0o600;
export const DIAGNOSTIC_DIR_MODE = 0o700;

// Covered tokenized public routes: /sign/contracts/, /api/signing/contracts/, /api/onboarding/portal/, /portal/validate
const TOKENIZED_PATH_PATTERNS: RegExp[] = [
  /(\/sign\/contracts\/)[^/?#\s]+/gi,
  /(\/api\/signing\/contracts\/)[^/?#\s]+/gi,
  /(\/api\/onboarding\/portal\/)[^/?#\s]+/gi,
  /(\/onboarding\/portal\/)[^/?#\s]+/gi,
  /(\/magic-link\/)[^/?#\s]+/gi,
  /(\/reset(?:-password)?\/)[^/?#\s]+/gi,
  /(\/invite\/)[^/?#\s]+/gi,
  /(\/portal\/validate\?[^\s]*?token=)[^&#\s]+/gi,
];
const SECRET_ASSIGNMENT_PATTERN = /([?&\s;](?:token|session|jwt|password|secret|key|code|invite|reset)=)[^&#\s;]+/gi;

export function redactDiagnosticText(input: unknown): string {
  let output = String(input ?? "");
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
