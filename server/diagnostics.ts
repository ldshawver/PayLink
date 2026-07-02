import type { Express, Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFileSync } from "child_process";
import AdmZip from "adm-zip";

export const DIAGNOSTIC_ROLES = new Set(["platform_owner", "super_admin", "system_admin"]);
export const LOG_TYPES = ["app", "error", "appdr", "github", "payroll", "pdf", "database", "security"] as const;
type LogType = typeof LOG_TYPES[number];

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const KEEP_ROTATIONS = 10;
const logDir = process.env.PAYLINK_LOG_DIR || path.join(process.cwd(), "storage", "logs");

export function getLogDir() { return logDir; }
export function newId(prefix = "") { return `${prefix}${crypto.randomUUID()}`; }

const secretKeys = /(password|secret|token|api[_-]?key|authorization|cookie|session|jwt|refresh|access|github_token|stripe|private[_-]?key)/i;
const piiKeys = /(ssn|social|ein|tax[_-]?id|dob|birth|address|home[_-]?address)/i;
const bankKeys = /(bank|routing|account|ach|direct[_-]?deposit|iban)/i;
const payrollKeys = /(payroll|gross|net|wage|salary|withholding|deduction|paystub|employee[_-]?pay|direct[_-]?deposit)/i;
const LUXIT_ACCESS_LOG = process.env.LUXIT_ACCESS_LOG || "/var/log/luxit-access.log";
const LUXIT_ERROR_LOG = process.env.LUXIT_ERROR_LOG || "/var/log/luxit-error.log";

export function redactSensitive(input: any): any {
  if (input == null) return input;
  if (typeof input === "string") {
    let s = input;
    s = s.replace(/Bearer\s+[A-Za-z0-9._~+\-/]+=*/gi, "Bearer [REDACTED_SECRET]");
    s = s.replace(/(ghp|github_pat|sk|rk|xox[baprs])-?[A-Za-z0-9_\-]{20,}/gi, "[REDACTED_SECRET]");
    s = s.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_PII]");
    s = s.replace(/\b\d{2}-\d{7}\b/g, "[REDACTED_PII]");
    s = s.replace(/\b(?:\d[ -]*?){13,17}\b/g, "[REDACTED_BANK]");
    s = s.replace(/\b(?:routing|account)[=: ]+\d{4,17}\b/gi, "[REDACTED_BANK]");
    s = s.replace(/\b(?:dob|date of birth)[=: ]+\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/gi, "[REDACTED_PII]");
    s = s.replace(/\b\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s+(?:gross|net|payroll|wage|salary|withholding|deduction)\b/gi, "[REDACTED_PAYROLL]");
    return s;
  }
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(redactSensitive);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(input)) {
    if (secretKeys.test(k)) out[k] = "[REDACTED_SECRET]";
    else if (bankKeys.test(k)) out[k] = "[REDACTED_BANK]";
    else if (piiKeys.test(k)) out[k] = "[REDACTED_PII]";
    else if (payrollKeys.test(k) && typeof v !== "boolean") out[k] = "[REDACTED_PAYROLL]";
    else out[k] = redactSensitive(v);
  }
  return out;
}

function safeCommand(command: string, args: string[]): { ok: boolean; output: string; error?: string } {
  try {
    return { ok: true, output: execFileSync(command, args, { encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 }) };
  } catch (e: any) {
    return { ok: false, output: "", error: String(e?.message || e) };
  }
}

function tailFile(filePath: string, lines = 500): string {
  const sudoTail = safeCommand("sudo", ["tail", "-n", String(lines), filePath]);
  if (sudoTail.ok) return redactSensitive(sudoTail.output);
  const plainTail = safeCommand("tail", ["-n", String(lines), filePath]);
  if (plainTail.ok) return redactSensitive(plainTail.output);
  try {
    if (!fs.existsSync(filePath)) return `Log file unavailable: ${filePath}`;
    return redactSensitive(fs.readFileSync(filePath, "utf8").split("\n").slice(-lines).join("\n"));
  } catch (e: any) {
    return `Log read unavailable: ${redactSensitive(e?.message || String(e))}`;
  }
}

function journalLuxit(lines = 500): string {
  const sudoJournal = safeCommand("sudo", ["journalctl", "-u", "luxit", "-n", String(lines), "--no-pager"]);
  if (sudoJournal.ok) return redactSensitive(sudoJournal.output);
  const plainJournal = safeCommand("journalctl", ["-u", "luxit", "-n", String(lines), "--no-pager"]);
  if (plainJournal.ok) return redactSensitive(plainJournal.output);
  return `journalctl unavailable: ${redactSensitive(sudoJournal.error || plainJournal.error || "unknown error")}`;
}

function systemctlLuxitStatus(): string {
  const sudoStatus = safeCommand("sudo", ["systemctl", "status", "luxit", "--no-pager"]);
  if (sudoStatus.ok) return redactSensitive(sudoStatus.output);
  const plainStatus = safeCommand("systemctl", ["status", "luxit", "--no-pager"]);
  if (plainStatus.ok) return redactSensitive(plainStatus.output);
  return `systemctl status unavailable: ${redactSensitive(sudoStatus.error || plainStatus.error || "unknown error")}`;
}

function luxitLogText(source: string): string {
  if (source === "luxit-access") return tailFile(LUXIT_ACCESS_LOG);
  if (source === "journal-luxit") return journalLuxit();
  if (source === "luxit-error") return tailFile(LUXIT_ERROR_LOG);
  return tailFile(LUXIT_ERROR_LOG);
}

function luxitLogRows(source: string, query: any, limit = 200) {
  return luxitLogText(source).split("\n").filter(Boolean)
    .filter((line) => !query.search || line.toLowerCase().includes(String(query.search).toLowerCase()))
    .filter((line) => !query.correlationId || line.includes(String(query.correlationId)))
    .slice(-limit).reverse().map((line) => ({ timestamp: null, level: line.toLowerCase().includes("error") ? "error" : "info", service: source, message: line, correlationId: line.match(/(?:correlationId|correlation_id)[=: ]([A-Za-z0-9_-]+)/)?.[1] || null }));
}

function ensureLogs() { fs.mkdirSync(logDir, { recursive: true }); }
function rotateIfNeeded(file: string) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < MAX_LOG_BYTES) return;
    for (let i = KEEP_ROTATIONS - 1; i >= 1; i--) {
      const from = `${file}.${i}`; const to = `${file}.${i + 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(file, `${file}.1`);
    const oldest = `${file}.${KEEP_ROTATIONS + 1}`;
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
  } catch (e) { console.warn("[Diagnostics] log rotation failed", e); }
}

export function writeDiagnosticLog(type: LogType, entry: Record<string, any>) {
  const safe = redactSensitive({ timestamp: new Date().toISOString(), environment: process.env.NODE_ENV || "development", ...entry });
  try {
    ensureLogs();
    const line = `${JSON.stringify(safe)}\n`;
    const primary = path.join(logDir, `${type}.log`);
    rotateIfNeeded(primary);
    fs.appendFileSync(primary, line);
    if ((safe.level === "error" || safe.level === "fatal") && type !== "error") {
      const errorFile = path.join(logDir, "error.log"); rotateIfNeeded(errorFile); fs.appendFileSync(errorFile, line);
    }
  } catch (e) { console.error("[Diagnostics] write failed", e); }
}

export function requestDiagnostics(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || newId("req_"));
  const correlationId = String(req.headers["x-correlation-id"] || requestId);
  (req as any).requestId = requestId; (req as any).correlationId = correlationId;
  res.setHeader("X-Request-Id", requestId); res.setHeader("X-Correlation-Id", correlationId);
  const started = Date.now();
  res.on("finish", () => writeDiagnosticLog(res.statusCode >= 500 ? "error" : "app", {
    level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info", service: "app", message: `${req.method} ${req.path}`,
    requestId, correlationId, tenantId: (req as any).tenantId, companyId: (req as any).resolvedCompanyId || (req as any).session?.companyId,
    userId: (req as any).session?.userId, method: req.method, path: req.path, statusCode: res.statusCode, durationMs: Date.now() - started,
  }));
  next();
}

function requireDiagnosticsRole(req: Request, res: Response, next: NextFunction) {
  const role = String((req as any).session?.role || "");
  if (!(req as any).session?.userId) return res.status(401).json({ message: "Not authenticated" });
  if (!DIAGNOSTIC_ROLES.has(role)) return res.status(403).json({ message: "Developer diagnostics require system administrator access" });
  next();
}

function readLogs(query: any, limit = 200) {
  if (["luxit-access", "luxit-error", "journal-luxit"].includes(String(query.service || ""))) return luxitLogRows(String(query.service), query, limit);
  const service = LOG_TYPES.includes(query.service) ? query.service : "error";
  const file = path.join(logDir, `${service}.log`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").slice(-1000).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    .filter((r: any) => !query.level || r.level === query.level)
    .filter((r: any) => !query.correlationId || r.correlationId === query.correlationId)
    .filter((r: any) => !query.search || JSON.stringify(r).toLowerCase().includes(String(query.search).toLowerCase()))
    .slice(-limit).reverse();
}

async function health() {
  let database = "unknown"; try { const { db } = await import("./db"); const { sql } = await import("drizzle-orm"); await db.execute(sql`SELECT 1`); database = "connected"; } catch { database = "unavailable"; }
  let storageWritable = false; try { ensureLogs(); fs.accessSync(logDir, fs.constants.W_OK); storageWritable = true; } catch {}
  return { uptimeSeconds: Math.floor(process.uptime()), environment: process.env.NODE_ENV || process.env.FLASK_ENV || "development", commitSha: process.env.PAYLINK_COMMIT || process.env.GITHUB_SHA || "unknown", database, storageWritable, githubConfigured: !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO), emailConfigured: !!(process.env.SENDGRID_API_KEY || process.env.SMTP_HOST || process.env.RESEND_API_KEY || process.env.MAIL_SERVER), queueStatus: "systemd", luxitServiceStatus: systemctlLuxitStatus().split("\n").slice(0, 12).join("\n"), diskFree: null, memory: { rss: process.memoryUsage().rss, free: os.freemem(), total: os.totalmem() } };
}

export function registerDiagnosticsRoutes(app: Express) {
  app.get("/api/admin/diagnostics/health", requireDiagnosticsRole, async (req, res) => { writeDiagnosticLog("security", { level: "info", service: "security", message: "diagnostics viewed", requestId: (req as any).requestId, userId: (req as any).session?.userId }); res.json(await health()); });
  app.get("/api/admin/diagnostics/logs", requireDiagnosticsRole, (req, res) => { writeDiagnosticLog("security", { level: "info", service: "security", message: "diagnostics logs searched", requestId: (req as any).requestId, userId: (req as any).session?.userId, metadata: { query: req.query } }); res.json({ logs: readLogs(req.query) }); });
  app.get("/api/admin/diagnostics/export", requireDiagnosticsRole, async (req, res) => {
    writeDiagnosticLog("security", { level: "warn", service: "security", message: "diagnostic bundle exported", requestId: (req as any).requestId, userId: (req as any).session?.userId });
    const zip = new AdmZip(); ensureLogs();
    zip.addFile("logs/luxit-access.log", Buffer.from(luxitLogText("luxit-access")));
    zip.addFile("logs/luxit-error.log", Buffer.from(luxitLogText("luxit-error")));
    zip.addFile("logs/journal-luxit.log", Buffer.from(luxitLogText("journal-luxit")));
    const env = { DATABASE_URL_PRESENT: !!process.env.DATABASE_URL, GITHUB_TOKEN_PRESENT: !!process.env.GITHUB_TOKEN, EMAIL_CONFIG_PRESENT: !!(process.env.SENDGRID_API_KEY || process.env.SMTP_HOST || process.env.RESEND_API_KEY || process.env.MAIL_SERVER), STORAGE_CONFIG_PRESENT: !!(process.env.UPLOAD_DIR || process.env.PAYLINK_LOG_DIR || process.env.STORAGE_PATH), FLASK_ENV: process.env.FLASK_ENV || process.env.NODE_ENV || null, PYTHON_VERSION: process.env.PYTHON_VERSION || null, GUNICORN_PRESENT: !!process.env.GUNICORN_CMD_ARGS || systemctlLuxitStatus().toLowerCase().includes("gunicorn") };
    const h = await health();
    const jsons: Record<string, any> = { "environment.json": env, "system-health.json": h, "recent-errors.json": readLogs({ service: "luxit-error" }, 100), "appdr-status.json": { repairEnabled: process.env.APP_DOCTOR_REPAIR_ENABLED !== "false" }, "github-status.json": { tokenConfigured: !!process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPO || null, baseBranch: process.env.GITHUB_BASE_BRANCH || "main" }, "versions.json": { node: process.version, python: process.env.PYTHON_VERSION || null, app: process.env.npm_package_version || "unknown" } };
    for (const [name, value] of Object.entries(jsons)) zip.addFile(`json/${name}`, Buffer.from(JSON.stringify(redactSensitive(value), null, 2)));
    res.setHeader("Content-Type", "application/zip"); res.setHeader("Content-Disposition", `attachment; filename=paylink-diagnostics-${Date.now()}.zip`); res.send(zip.toBuffer());
  });
}

export function globalErrorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  const status = err.status || err.statusCode || 500;
  const correlationId = (req as any).correlationId || newId("err_");
  (req as any).correlationId = correlationId;
  writeDiagnosticLog("error", { level: status >= 500 ? "error" : "warn", service: "app", message: err?.message || "Unhandled error", requestId: (req as any).requestId, correlationId, userId: (req as any).session?.userId, method: req.method, path: req.path, statusCode: status, errorName: err?.name, errorMessage: err?.message, stack: err?.stack });
  if (res.headersSent) return next(err);
  const role = String((req as any).session?.role || "");
  const body: any = { success: false, error: status >= 500 ? "Internal server error" : (err.message || "Bad request"), correlationId };
  if (DIAGNOSTIC_ROLES.has(role)) Object.assign(body, { route: req.path, service: "app", timestamp: new Date().toISOString() });
  res.status(status).json(body);
}
