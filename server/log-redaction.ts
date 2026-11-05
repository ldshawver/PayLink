import util from "node:util";
import { redactDiagnosticText } from "./diagnostics-safety";

// Process-wide console redaction (PR-E2). PM2 captures stdout/stderr verbatim,
// and the retired pm2-root paylink-out.log held unmasked SSN, EIN, bank
// account and routing values. Field-name redaction at individual log sites
// proved incomplete, so every console.* call is routed through one chokepoint:
//   1. structured args (plain objects, arrays, Errors incl. pg `detail`) are
//      deep-copied with sensitive keys replaced — cycle-safe and depth-bounded;
//   2. the final formatted line is text-redacted (JSON / util.inspect key
//      forms, Postgres "Failing row contains" / "Key (col)=(value)" details,
//      SSN/EIN shapes), then passed to redactDiagnosticText for signing tokens.
// Non-sensitive context (ids, codes, table/constraint names, paths, stack
// frames) is preserved so incidents stay diagnosable.

export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY_EXACT = new Set([
  "ssn", "socialsecurity", "socialsecuritynumber", "ein", "fein", "einnumber", "federalein",
  "employerein", "companyein", "employeridentificationnumber", "tin", "itin", "taxid", "taxidnumber",
  "taxpayerid", "taxpayeridentificationnumber", "federaltaxid", "aba", "abanumber", "iban",
  "bankaccount", "micr", "micrline", "micrstring",
]);
const SENSITIVE_KEY_SUFFIX = ["accountnumber", "routingnumber", "accountno", "routingno", "ssn", "taxid"];
// Prefixed EINs (companyEin, employer_ein, ...). Bare suffix matching would hit words like "protein".
const PREFIXED_EIN = /(company|employer|federal|business|vendor|contractor|payer|payee)ein$/;
// Already-masked companions (accountNumberLast4, maskedSsn, ...) are safe to keep.
const SAFE_KEY_MARKERS = ["last4", "lastfour", "masked", "mask", "hint", "type", "verified", "status", "present"];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSensitiveLogKey(key: string): boolean {
  const k = normalizeKey(key);
  if (!k || SAFE_KEY_MARKERS.some((m) => k.includes(m))) return false;
  return SENSITIVE_KEY_EXACT.has(k) || PREFIXED_EIN.test(k) || SENSITIVE_KEY_SUFFIX.some((s) => k.endsWith(s));
}

// Key-name alternation for the text passes. Mirrors isSensitiveLogKey for the
// spellings that actually appear in payloads (camel, snake, kebab).
const KEY_ALT =
  "(?:[A-Za-z_-]*(?:[Aa]ccount|ACCOUNT)[_-]?(?:[Nn]umber|NUMBER|[Nn]o)|[A-Za-z_-]*(?:[Rr]outing|ROUTING)[_-]?(?:[Nn]umber|NUMBER|[Nn]o)" +
  "|[A-Za-z_-]*(?:ssn|SSN|Ssn)|social[_-]?security(?:[_-]?number)?|socialSecurity(?:Number)?" +
  "|ein|EIN|fein|FEIN|(?:company|employer|federal|business|vendor|contractor|payer|payee)[_-]?(?:ein|Ein|EIN)" +
  "|tin|TIN|itin|ITIN|[A-Za-z_-]*[Tt]ax[_-]?[Ii][Dd](?:[_-]?[Nn]umber)?|taxpayer[_-]?id|iban|IBAN|aba|ABA|micr(?:[_-]?line)?|bank[_-]?account|bankAccount)";

const TEXT_PATTERNS: Array<[RegExp, string | ((...m: string[]) => string)]> = [
  // JSON: "accountNumber":"123" | "ein": 123456789 | "ssn":null is left alone.
  [new RegExp(`("${KEY_ALT}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|-?\\d[\\d.eE+-]*)`, "g"), (_m, k, v) => (v === '""' ? `${k}""` : `${k}"${REDACTED}"`)],
  // util.inspect: accountNumber: '123' | ein: 123456789 | 'tax-id': "x"
  [new RegExp(`(\\b${KEY_ALT}'?\\s*:\\s*)('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*"|\`[^\`]*\`|-?\\d[\\d.eE+-]*)`, "g"), (_m, k, v) => (/^(''|""|``)$/.test(v) ? `${k}${v}` : `${k}'${REDACTED}'`)],
  // Free text: ssn=123..., routing number: 990000011, EIN 00-1230000
  [new RegExp(`(\\b(?:ssn|ein|fein|tin|itin|tax[ _-]?id|routing(?:[ _-]?(?:number|no))?|account[ _-]?(?:number|no)|bank[ _-]?account(?:[ _-]?number)?)\\b\\s*[=:#]?\\s*)[0-9][0-9 -]{3,}[0-9]`, "gi"), `$1${REDACTED}`],
  // Generic key=value / key: value (query strings, ad-hoc interpolation). Uses
  // the same classifier as structured args, so prefixed names (worker_ssn,
  // companyEin, employer_ein) and percent-encoded values are caught too.
  [/(?<![A-Za-z0-9_-])([A-Za-z][A-Za-z0-9_-]*)(\s*[=:]\s*)([^\s&,;"'`<>()[\]{}]+)/g, (m, key, sep, value) =>
    isSensitiveLogKey(key) && !/^(?:null|undefined|\[REDACTED\])$/.test(value) ? `${key}${sep}${REDACTED}` : m],
  // Postgres error detail: full row values and unique-key values.
  [/(Failing row contains )\((?:[^()]|\([^()]*\))*\)/g, `$1(${REDACTED})`],
  // Unique/FK key values: kept when every key column is an id (diagnostic, not sensitive).
  [/(Key \(([^)]*)\)=)(\((?:[^()]|\([^()]*\))*\))/g, (_m, prefix, cols, value) =>
    cols.split(",").every((c: string) => /^\s*(?:id|[a-z0-9_]*_id)\s*$/.test(c)) ? `${prefix}${value}` : `${prefix}(${REDACTED})`],
  // Shapes: SSN 123-45-6789 / 123 45 6789, EIN 00-1230000.
  [/\b\d{3}-\d{2}-\d{4}\b/g, REDACTED],
  [/\b\d{3} \d{2} \d{4}\b/g, REDACTED],
  [/\b\d{2}-\d{7}\b/g, REDACTED],
];

export function redactLogText(input: unknown): string {
  let output = String(input ?? "");
  for (const [pattern, replacement] of TEXT_PATTERNS) {
    output = output.replace(pattern, replacement as any);
  }
  return redactDiagnosticText(output);
}

const MAX_DEPTH = 8;

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep, cycle-safe copy of a log argument with sensitive keys masked. Errors
 * stay Errors (name/message/stack/code/detail/cause preserved, text-redacted)
 * so console output keeps its stack trace. Class instances other than Error
 * are passed through untouched; the final formatted line is text-redacted.
 */
export function redactLogValue(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "string") return redactLogText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";

  if (value instanceof Error) {
    seen.add(value);
    const copy = new Error(redactLogText(value.message));
    copy.name = value.name;
    copy.stack = redactLogText(value.stack ?? "");
    for (const key of Object.keys(value)) {
      (copy as any)[key] = isSensitiveLogKey(key) ? REDACTED : redactLogValue((value as any)[key], depth + 1, seen);
    }
    if ((value as any).cause !== undefined) (copy as any).cause = redactLogValue((value as any).cause, depth + 1, seen);
    return copy;
  }

  if (Array.isArray(value)) {
    seen.add(value);
    return value.map((item) => redactLogValue(item, depth + 1, seen));
  }

  if (!isPlainObject(value)) return value;

  seen.add(value);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = isSensitiveLogKey(key) && item !== null && item !== undefined && item !== "" ? REDACTED : redactLogValue(item, depth + 1, seen);
  }
  return out;
}

export function formatRedactedLogLine(args: unknown[]): string {
  return redactLogText(util.format(...args.map((arg) => redactLogValue(arg))));
}

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug", "trace", "dir"] as const;
let installed = false;

/**
 * Route every console.* call through redaction. Idempotent. Each method
 * still writes to its original stream (stdout for log/info/debug, stderr for
 * warn/error/trace) so PM2's out/error log split is unchanged.
 */
export function installConsoleRedaction(target: Console = console): void {
  if (target === console && installed) return;
  const originalLog = target.log.bind(target);
  for (const method of CONSOLE_METHODS) {
    const original = (target as any)[method].bind(target);
    (target as any)[method] = (...args: unknown[]) => {
      let line: string;
      try {
        line = method === "dir"
          ? redactLogText(util.inspect(redactLogValue(args[0]), args[1] as util.InspectOptions))
          : formatRedactedLogLine(args);
      } catch {
        line = "[log-redaction] log line dropped: redaction failed";
      }
      return method === "dir" ? originalLog(line) : original(line);
    };
  }
  if (target === console) installed = true;
}

/**
 * Node's default fatal-exception printer writes straight to stderr, bypassing
 * console. Replace it with a redacted equivalent that keeps the default
 * semantics: log, then exit with code 1 (PM2 restarts the process). Unhandled
 * rejections reach here too under Node's default --unhandled-rejections=throw.
 */
export function installFatalExceptionRedaction(): void {
  process.on("uncaughtException", (err, origin) => {
    try {
      console.error(`[fatal] ${origin}:`, err);
    } finally {
      process.exit(1);
    }
  });
}
