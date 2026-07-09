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
const MAX_READ_BYTES = 512 * 1024;
const DEFAULT_MAX_EXPORT_BYTES = 50 * 1024 * 1024;
const logDir = process.env.PAYLINK_LOG_DIR || path.join(process.cwd(), "storage", "logs");
const serviceName = process.env.PAYLINK_SYSTEMD_SERVICE || process.env.PM2_PROCESS_NAME || "paylink";
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

export function getLogDir() { return logDir; }
export function newId(prefix = "") { return `${prefix}${crypto.randomUUID()}`; }

const secretKeys = /(password|secret|token|api[_-]?key|authorization|cookie|session|jwt|refresh|access|github_token|stripe|private[_-]?key|key)$/i;
const piiKeys = /(ssn|social|ein|tax[_-]?id|dob|birth|address|home[_-]?address)/i;
const bankKeys = /(bank|routing|account|ach|direct[_-]?deposit|iban)/i;
const payrollKeys = /(payroll|gross|net|wage|salary|withholding|deduction|paystub|employee[_-]?pay|direct[_-]?deposit)/i;

export function redactSensitive(input: any): any {
  if (input == null) return input;
  if (typeof input === "string") {
    let s = input;
    s = s.replace(/\b(?:authorization:\s*)?Bearer\s+[A-Za-z0-9._~+\-/]+=*/gi, "Bearer [REDACTED_SECRET]");
    s = s.replace(/\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/gi, "[REDACTED_SECRET]");
    s = s.replace(/\b(token|session|jwt|password|api[_-]?key|key|secret|access[_-]?token|refresh[_-]?token)=([^\s&?#]+)/gi, (_m, key) => `${key}=[REDACTED_SECRET]`);
    s = s.replace(/([?&](?:token|session|jwt|password|api[_-]?key|key|secret|access[_-]?token|refresh[_-]?token)=)[^\s&#]+/gi, "$1[REDACTED_SECRET]");
    s = s.replace(/https?:\/\/[^\s"']*(?:reset|sign|signing|invite|magic-link)[^\s"']*/gi, "[REDACTED_SECRET_LINK]");
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

function readLastBytes(filePath: string, maxBytes = MAX_READ_BYTES): string {
  try {
    if (!fs.existsSync(filePath)) return "";
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const length = stat.size - start;
    const fd = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      return redactSensitive(buffer.toString("utf8"));
    } finally {
      fs.closeSync(fd);
    }
  } catch (e: any) {
    return `Log read unavailable: ${redactSensitive(e?.message || String(e))}`;
  }
}

function safeCommand(command: string, args: string[]): string {
  try { return redactSensitive(execFileSync(command, args, { encoding: "utf8", timeout: 5000, maxBuffer: MAX_READ_BYTES })); }
  catch (e: any) { return `Command unavailable: ${redactSensitive(e?.message || String(e))}`; }
}

function serviceStatus() { return safeCommand("systemctl", ["status", serviceName, "--no-pager"]); }
function serviceJournal() { return safeCommand("journalctl", ["-u", serviceName, "-n", "500", "--no-pager"]); }

function diagnosticsRateLimit(name: string, limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).session?.userId || "anonymous";
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${name}:${userId}:${ip}`;
    const now = Date.now();
    const current = rateLimitBuckets.get(key);
    if (!current || current.resetAt <= now) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > limit) {
      res.setHeader("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
      return res.status(429).json({ message: "Diagnostics rate limit exceeded" });
    }
    next();
  };
}

function getMaxExportBytes() {
  const raw = Number(process.env.DIAGNOSTICS_MAX_ZIP_BYTES || DEFAULT_MAX_EXPORT_BYTES);
  return Number.isFinite(raw) && raw > 1024 * 1024 ? raw : DEFAULT_MAX_EXPORT_BYTES;
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

async function getRequestUser(req: Request): Promise<any | null> {
  if ((req as any).user) return (req as any).user;
  const userId = (req as any).session?.userId;
  if (!userId) return null;
  try { const { storage } = await import("./storage"); return await storage.getUser(userId); } catch { return null; }
}

async function requireDiagnosticsRole(req: Request, res: Response, next: NextFunction) {
  const user = await getRequestUser(req);
  if (!user) return res.status(401).json({ message: "Not authenticated" });
  if (!DIAGNOSTIC_ROLES.has(String(user.role || ""))) return res.status(403).json({ message: "Developer diagnostics require system administrator access" });
  (req as any).diagnosticsUser = user;
  next();
}

function parseLogRows(text: string, source: string, query: any, limit = 200) {
  return text.split("\n").filter(Boolean)
    .filter((line) => !query.search || line.toLowerCase().includes(String(query.search).toLowerCase()))
    .filter((line) => !query.correlationId || line.includes(String(query.correlationId)))
    .slice(-limit).reverse().map((line) => {
      try { return { ...JSON.parse(line), source }; }
      catch { return { timestamp: null, level: line.toLowerCase().includes("error") ? "error" : "info", service: source, message: line, correlationId: line.match(/(?:correlationId|correlation_id)[=: ]([A-Za-z0-9_-]+)/)?.[1] || null }; }
    });
}

function readLogs(query: any, limit = 200) {
  if (query.service === "journal") return parseLogRows(serviceJournal(), "journal", query, limit);
  const service = LOG_TYPES.includes(query.service) ? query.service : "error";
  return parseLogRows(readLastBytes(path.join(logDir, `${service}.log`)), service, query, limit)
    .filter((r: any) => !query.level || r.level === query.level)
    .slice(0, limit);
}

async function health() {
  let database = "unknown"; try { const { db } = await import("./db"); const { sql } = await import("drizzle-orm"); await db.execute(sql`SELECT 1`); database = "connected"; } catch { database = "unavailable"; }
  let storageWritable = false; try { ensureLogs(); fs.accessSync(logDir, fs.constants.W_OK); storageWritable = true; } catch {}
  return { uptimeSeconds: Math.floor(process.uptime()), environment: process.env.NODE_ENV || "development", version: process.env.PAYLINK_VERSION || process.env.npm_package_version || "unknown", commitSha: process.env.PAYLINK_COMMIT || process.env.GITHUB_SHA || "unknown", buildTime: process.env.PAYLINK_BUILD_TIME || process.env.BUILD_TIME || null, nodeVersion: process.version, pm2Process: process.env.PM2_PROCESS_NAME || serviceName, database, storageWritable, githubConfigured: !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO), emailConfigured: !!(process.env.SENDGRID_API_KEY || process.env.SMTP_HOST || process.env.RESEND_API_KEY), queueStatus: "in-process", serviceName, serviceStatus: serviceStatus().split("\n").slice(0, 12).join("\n"), diskFree: null, memory: { rss: process.memoryUsage().rss, free: os.freemem(), total: os.totalmem() } };
}

export function registerDiagnosticsRoutes(app: Express) {
  app.get("/api/admin/diagnostics/health", diagnosticsRateLimit("diagnostics-health", 60, 60_000), requireDiagnosticsRole, async (req, res) => { const user = (req as any).diagnosticsUser; writeDiagnosticLog("security", { level: "info", service: "security", message: "diagnostics viewed", requestId: (req as any).requestId, userId: user?.id }); res.json(await health()); });
  app.get("/api/admin/diagnostics/logs", diagnosticsRateLimit("diagnostics-logs", 30, 60_000), requireDiagnosticsRole, (req, res) => { const user = (req as any).diagnosticsUser; writeDiagnosticLog("security", { level: "info", service: "security", message: "diagnostics logs searched", requestId: (req as any).requestId, userId: user?.id, metadata: { query: req.query } }); res.json({ logs: readLogs(req.query) }); });
  app.get("/api/admin/diagnostics/export", diagnosticsRateLimit("diagnostics-export", 5, 60 * 60_000), requireDiagnosticsRole, async (req, res) => {
    const user = (req as any).diagnosticsUser;
    const maxExportBytes = getMaxExportBytes();
    let remainingBytes = maxExportBytes;
    const contents: string[] = [];
    const zip = new AdmZip(); ensureLogs();
    const addTextFile = (name: string, text: string) => {
      const safeText = String(redactSensitive(text || ""));
      let body = safeText;
      const bytes = Buffer.byteLength(body);
      if (bytes > remainingBytes) {
        const keep = Math.max(0, remainingBytes - 256);
        body = Buffer.from(body).subarray(0, keep).toString("utf8") + "\n[TRUNCATED: diagnostics export size limit reached]\n";
        remainingBytes = 0;
      } else {
        remainingBytes -= bytes;
      }
      zip.addFile(name, Buffer.from(body));
      contents.push(name);
    };
    for (const type of LOG_TYPES) addTextFile(`logs/${type}.log`, readLastBytes(path.join(logDir, `${type}.log`)));
    addTextFile("logs/journal.log", serviceJournal());
    const env = { NODE_ENV: process.env.NODE_ENV || "development", DATABASE_URL_PRESENT: !!process.env.DATABASE_URL, GITHUB_TOKEN_PRESENT: !!process.env.GITHUB_TOKEN, EMAIL_PROVIDER_PRESENT: !!(process.env.SENDGRID_API_KEY || process.env.SMTP_HOST || process.env.RESEND_API_KEY), STORAGE_CONFIG_PRESENT: !!(process.env.UPLOAD_DIR || process.env.PAYLINK_LOG_DIR) };
    const h = await health();
    const jsons: Record<string, any> = { "environment.json": env, "system-health.json": h, "recent-errors.json": readLogs({ service: "error" }, 100), "appdr-status.json": { repairEnabled: process.env.APP_DOCTOR_REPAIR_ENABLED !== "false" }, "github-status.json": { tokenConfigured: !!process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPO || null, baseBranch: process.env.GITHUB_BASE_BRANCH || "main" }, "versions.json": { node: process.version, app: process.env.npm_package_version || "unknown", commit: h.commitSha, buildTime: h.buildTime } };
    for (const [name, value] of Object.entries(jsons)) addTextFile(`json/${name}`, JSON.stringify(redactSensitive(value), null, 2));
    const buffer = zip.toBuffer();
    writeDiagnosticLog("security", { level: "warn", service: "security", message: "diagnostic bundle exported", requestId: (req as any).requestId, correlationId: (req as any).correlationId, userId: user?.id, tenantId: (req as any).tenantId, companyId: user?.companyId || (req as any).resolvedCompanyId, metadata: { role: user?.role, timestamp: new Date().toISOString(), ip: req.ip || req.socket.remoteAddress, userAgent: req.get("user-agent"), exportContents: contents, maxExportBytes, zipBytes: buffer.length } });
    res.setHeader("Content-Type", "application/zip"); res.setHeader("Content-Disposition", `attachment; filename=mypaylink-diagnostics-${Date.now()}.zip`); res.send(buffer);
  });
}

export async function globalErrorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  const status = err.status || err.statusCode || 500;
  const correlationId = (req as any).correlationId || newId("err_");
  (req as any).correlationId = correlationId;
  writeDiagnosticLog("error", { level: status >= 500 ? "error" : "warn", service: "app", message: err?.message || "Unhandled error", requestId: (req as any).requestId, correlationId, userId: (req as any).session?.userId, method: req.method, path: req.path, statusCode: status, errorName: err?.name, errorMessage: err?.message, stack: err?.stack });
  if (res.headersSent) return next(err);
  const user = await getRequestUser(req);
  const body: any = { success: false, error: status >= 500 ? "Internal server error" : (err.message || "Bad request"), correlationId };
  if (user && DIAGNOSTIC_ROLES.has(String(user.role || ""))) Object.assign(body, { route: req.path, service: "app", timestamp: new Date().toISOString() });
  res.status(status).json(body);
}
