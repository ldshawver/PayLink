import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import bcrypt from "bcrypt";
import multer from "multer";
import { sendScheduleEmailNotification, sendScheduleSmsNotification } from "./notifications";
import path from "path";
import { db } from "./db";
import { sql, eq } from "drizzle-orm";
import { insertEnterpriseSchema, insertDivisionSchema, insertPositionSchema, insertCostCenterSchema, insertJobSchema, insertBranchSchema, insertRoleSchema, insertRolePermissionSchema, insertUserRoleSchema, insertCheckTemplateSchema, insertStationSchema, insertSecondaryWageGroupSchema, insertCurrencySchema, insertTimeOffRequestSchema, insertSchedulePreferenceSchema, insertShiftOfferSchema, insertDealSchema, insertOnboardingTemplateSchema, insertOnboardingTemplateTaskSchema, insertCustomerOnboardingProjectSchema, insertOnboardingTaskSchema, insertOnboardingDocumentSchema, insertEngagementEventSchema, insertProductApiKeySchema, onboardingTemplateTasks, onboardingTasks, onboardingDocuments, productApiKeys, signaturePackages, documentVersions, documents, type DocumentRetentionPolicy } from "@shared/schema";
import crypto from "crypto";
import { getESignAdapter, getSupportedProviders, AcrobatSignAdapter, type CompanyESignConfig } from "./esign";
import fs from "fs";
import { computeDispositionDate, getDefaultRetentionPolicySeedData } from "./retentionCalculator";
import { emitIntegrationEvent } from "./integrationEvents";

const isProduction = process.env.NODE_ENV === "production";

function safeErrorMessage(error: unknown, fallback: string): string {
  if (isProduction) return fallback;
  return error instanceof Error ? error.message : String(error);
}

function getAppBaseUrl(req: Request): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
  return `${proto}://${host}`;
}

async function getCompanyESignConfig(companyId: string): Promise<CompanyESignConfig | undefined> {
  const apiKeys = await storage.getProductApiKeys(companyId);
  const docusignKey = apiKeys.find(k => k.productName === "docusign" && k.isActive);
  const acrobatKey = apiKeys.find(k => k.productName === "acrobat_sign" && k.isActive);
  if (!docusignKey && !acrobatKey) return undefined;

  const config: CompanyESignConfig = {};
  if (docusignKey) {
    try {
      config.docusign = JSON.parse(docusignKey.apiKey);
    } catch { /* fall back to env vars */ }
  }
  if (acrobatKey) {
    try {
      config.acrobat_sign = JSON.parse(acrobatKey.apiKey);
    } catch { /* fall back to env vars */ }
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

const resolvedUploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, resolvedUploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|svg|webp|ico)$/i;
    if (allowed.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});
const documentUpload = multer({
  storage: uploadStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|svg|webp|pdf|doc|docx)$/i;
    if (allowed.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error("Only image and document files are allowed"));
  },
});

function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk: Buffer | string) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function getWeekStart(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() - day);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function getWeekEnd(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() + (6 - day));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    if (!roles.includes(user.role || "")) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    next();
  };
}

function blockDemoWrites(req: Request, res: Response, next: NextFunction) {
  if (req.session?.isDemo && req.method !== "GET") {
    return res.status(403).json({ message: "Demo mode is read-only. Sign up for a free trial to make changes." });
  }
  next();
}

async function getSessionCompanyId(req: Request): Promise<string | null> {
  if (!req.session?.userId) return null;
  const user = await storage.getUser(req.session.userId);
  return user?.companyId || null;
}

function enforceCompanyScope(source: "query" | "body" = "query") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const sessionCompanyId = await getSessionCompanyId(req);
    if (!sessionCompanyId) return res.status(401).json({ message: "Not authenticated" });
    const requestedCompanyId = source === "query" ? (req.query.companyId as string) : req.body?.companyId;
    if (requestedCompanyId && requestedCompanyId !== sessionCompanyId) {
      return res.status(403).json({ message: "Access denied: company mismatch" });
    }
    (req as any)._companyId = sessionCompanyId;
    next();
  };
}

async function requireActiveSubscription(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return next();
  try {
    const user = await storage.getUser(req.session.userId!);
    if (!user?.companyId) return next();
    const rows = await db.execute(sql`SELECT subscription_status, trial_end FROM companies WHERE id = ${user.companyId}`);
    if (rows.rows.length === 0) return next();
    const company = rows.rows[0] as any;
    const status = company.subscription_status;
    if (status === "trial_expired" || status === "suspended" || status === "canceled") {
      return res.status(403).json({ message: "Your subscription is inactive. Please upgrade to continue." });
    }
    if (status === "trial_active" && company.trial_end) {
      const trialEnd = new Date(company.trial_end);
      if (new Date() > trialEnd) {
        await db.execute(sql`UPDATE companies SET subscription_status = 'trial_expired', trial_used = TRUE WHERE id = ${user.companyId}`);
        return res.status(403).json({ message: "Your trial has expired. Please upgrade to continue." });
      }
    }
    next();
  } catch (_e) {
    return res.status(503).json({ message: "Unable to verify subscription status. Please try again." });
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  const publicWritePaths = ["/auth/", "/trial/signup", "/demo/login", "/demo/provision", "/analytics/event", "/billing/activate", "/webhooks/product-events", "/webhooks/esign/", "/portal/"];
  app.use("/api", (req, res, next) => {
    if (publicWritePaths.some(p => req.path.startsWith(p))) return next();
    blockDemoWrites(req, res, next);
  });
  app.use("/api", (req, res, next) => {
    if (req.method === "GET" || publicWritePaths.some(p => req.path.startsWith(p))) return next();
    requireActiveSubscription(req, res, next);
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid username or password" });
      }
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ message: "Invalid username or password" });
      }
      if (user.isActive === false) {
        return res.status(403).json({ message: "Account is disabled. Contact your administrator." });
      }
      req.session.userId = user.id;
      req.session.username = user.username;
      let workerInfo = null;
      if (user.workerId) {
        const w = await storage.getWorker(user.workerId);
        if (w) workerInfo = { id: w.id, firstName: w.firstName, lastName: w.lastName, companyId: w.companyId };
      }
      res.json({ id: user.id, username: user.username, role: user.role, companyId: user.companyId, workerId: user.workerId, worker: workerInfo });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ message: "Logout failed" });
      const isProduction = process.env.NODE_ENV === "production";
      res.clearCookie("connect.sid", {
        path: "/",
        domain: isProduction ? ".mypaylink.app" : undefined,
        sameSite: "lax",
        secure: isProduction,
      });
      const baseUrl = process.env.APP_BASE_URL
        ? process.env.APP_BASE_URL.replace(/\/+$/, "")
        : `${req.protocol}://${req.get("host")}`;
      res.json({ message: "Logged out", redirectUrl: baseUrl });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    let workerInfo = null;
    let workerType = null;
    if (user.workerId) {
      const w = await storage.getWorker(user.workerId);
      if (w) {
        workerInfo = { id: w.id, firstName: w.firstName, lastName: w.lastName, companyId: w.companyId };
        workerType = w.workerType;
      }
    }
    res.json({ id: user.id, username: user.username, role: user.role, companyId: user.companyId, workerId: user.workerId, workerType, worker: workerInfo });
  });

  app.post("/api/auth/pin-login", async (req, res) => {
    try {
      const { employeeNumber, pin } = req.body;
      if (!employeeNumber || !pin) {
        return res.status(400).json({ message: "Employee number and PIN are required" });
      }
      const worker = await storage.getWorkerByEmployeeNumber(employeeNumber);
      if (!worker || worker.pin !== pin) {
        return res.status(401).json({ message: "Invalid employee number or PIN" });
      }
      if (!worker.isActive) {
        return res.status(403).json({ message: "This employee account is inactive" });
      }
      const allUsers = await storage.getUsers();
      let user = allUsers.find(u => u.workerId === worker.id);
      if (!user) {
        const hashedPassword = await bcrypt.hash(pin, 10);
        user = await storage.createUser({
          username: employeeNumber,
          password: hashedPassword,
          role: "employee",
          companyId: worker.companyId,
          workerId: worker.id,
          isActive: true,
        });
      }
      if (user.isActive === false) {
        return res.status(403).json({ message: "Account is disabled. Contact your administrator." });
      }
      req.session.userId = user.id;
      req.session.username = user.username;
      const workerInfo = { id: worker.id, firstName: worker.firstName, lastName: worker.lastName, companyId: worker.companyId };
      res.json({ id: user.id, username: user.username, role: user.role, companyId: user.companyId, workerId: user.workerId, worker: workerInfo });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.use("/api", (req, res, next) => {
    if (req.path === "/auth/login" || req.path === "/auth/logout" || req.path === "/auth/me" || req.path === "/auth/pin-login" || req.path === "/auth/token-restore" || req.path === "/time-clock/auth" || req.path === "/time-clock/punch" || req.path === "/time-clock/punches"
      || req.path.startsWith("/pay/") || req.path === "/stripe/publishable-key" || req.path.startsWith("/payments/stripe-status/")
      || req.path === "/webhooks/product-events" || req.path.startsWith("/webhooks/esign/")
      || req.path === "/demo/provision"
      || req.path.startsWith("/portal/")) {
      return next();
    }
    requireAuth(req, res, next);
  });

  app.get("/api/payroll-summary", async (req, res) => {
    try {
      const { year, quarter, companyId } = req.query;
      const allRuns = companyId && companyId !== "all"
        ? await storage.getPayrollRuns(companyId as string)
        : await storage.getPayrollRuns();
      const processedRuns = allRuns.filter(r => r.status === "processed");

      let filteredRuns = processedRuns;
      if (year) {
        filteredRuns = filteredRuns.filter(r => {
          const d = new Date(r.periodEnd);
          return d.getFullYear() === parseInt(year as string);
        });
      }
      if (quarter && quarter !== "") {
        filteredRuns = filteredRuns.filter(r => {
          const d = new Date(r.periodEnd);
          const m = d.getMonth();
          const q = m < 3 ? "Q1" : m < 6 ? "Q2" : m < 9 ? "Q3" : "Q4";
          return q === quarter;
        });
      }

      const allWorkers = await storage.getWorkers(companyId && companyId !== "all" ? companyId as string : undefined);
      const workerMap: Record<string, typeof allWorkers[0]> = {};
      for (const w of allWorkers) workerMap[w.id] = w;

      const companyDeductionsList = await storage.getTaxesDeductions(companyId && companyId !== "all" ? companyId as string : undefined);

      const workerTotals: Record<string, {
        workerId: string; grossPay: number; regularPay: number; overtimePay: number; doubleTimePay: number;
        deductions: number; netPay: number; regularHours: number; overtimeHours: number; doubleTimeHours: number;
      }> = {};

      for (const run of filteredRuns) {
        const items = await storage.getPayrollItems(run.id);
        for (const item of items) {
          if (!workerTotals[item.workerId]) {
            workerTotals[item.workerId] = { workerId: item.workerId, grossPay: 0, regularPay: 0, overtimePay: 0, doubleTimePay: 0, deductions: 0, netPay: 0, regularHours: 0, overtimeHours: 0, doubleTimeHours: 0 };
          }
          const t = workerTotals[item.workerId];
          const gross = parseFloat(item.grossPay || "0");
          const ded = parseFloat(item.deductions || "0");
          t.grossPay += gross;
          t.regularPay += parseFloat(item.regularPay || "0");
          t.overtimePay += parseFloat(item.overtimePay || "0");
          t.doubleTimePay += parseFloat((item as any).doubleTimePay || "0");
          t.deductions += ded;
          t.netPay += Math.max(gross - ded, 0);
          t.regularHours += parseFloat(item.regularHours || "0");
          t.overtimeHours += parseFloat(item.overtimeHours || "0");
          t.doubleTimeHours += parseFloat((item as any).doubleTimeHours || "0");
        }
      }

      const findDed = (nameIncludes: string, employerPaid: boolean, deds: typeof companyDeductionsList) =>
        deds.find(d => d.name.toLowerCase().includes(nameIncludes) && d.isActive && !!d.isEmployerPaid === employerPaid && !d.isReferenceOnly);

      const enhancedTotals = Object.values(workerTotals).map(wt => {
        const worker = workerMap[wt.workerId];
        const isContractor = worker?.workerType === "contractor";
        // Contractors have no employee withholding — use employee-only deductions for tax calcs
        const deds = isContractor ? [] : companyDeductionsList.filter(d => {
          const appliesTo = d.appliesTo || "all";
          if (appliesTo === "contractor") return false;
          return true;
        });

        const fedDed = findDed("federal income", false, deds);
        const stateDed = findDed("state income", false, deds);
        const sdiDed = findDed("sdi", false, deds);
        const suiDed = findDed("sui", true, deds) || findDed("state unemployment", true, deds);
        const ettDed = findDed("ett", true, deds) || findDed("employment training", true, deds);

        const gross = wt.grossPay;
        const fedRate = fedDed ? Number(fedDed.rate || 0) / 100 : 0;
        const stateRate = stateDed ? Number(stateDed.rate || 0) / 100 : 0;
        const sdiRate = sdiDed ? Number(sdiDed.rate || 0) / 100 : 0.011;
        const suiRate = suiDed ? Number(suiDed.rate || 0) / 100 : 0.034;
        const ettRate = ettDed ? Number(ettDed.rate || 0) / 100 : 0.001;

        const ssTaxableWages = Math.min(gross, 168600);
        const futaTaxableWages = Math.min(gross, 7000);
        const suiTaxableWages = Math.min(gross, 7000);

        return {
          ...wt,
          fedWithholding: !isContractor ? gross * fedRate : 0,
          stateWithholding: !isContractor ? gross * stateRate : 0,
          sdiWithheld: !isContractor ? gross * sdiRate : 0,
          ssTaxEmployee: !isContractor ? ssTaxableWages * 0.062 : 0,
          ssTaxEmployer: !isContractor ? ssTaxableWages * 0.062 : 0,
          medicareTaxEmployee: !isContractor ? gross * 0.0145 : 0,
          medicareTaxEmployer: !isContractor ? gross * 0.0145 : 0,
          futaTaxableWages: !isContractor ? futaTaxableWages : 0,
          futaTax: !isContractor ? futaTaxableWages * 0.006 : 0,
          suiTaxableWages: !isContractor ? suiTaxableWages : 0,
          suiTax: !isContractor ? suiTaxableWages * suiRate : 0,
          ettTax: !isContractor ? suiTaxableWages * ettRate : 0,
          ssTaxableWages,
        };
      });

      const grandTotal = {
        grossPay: enhancedTotals.reduce((s, t) => s + t.grossPay, 0),
        deductions: enhancedTotals.reduce((s, t) => s + t.deductions, 0),
        netPay: enhancedTotals.reduce((s, t) => s + t.netPay, 0),
        regularHours: enhancedTotals.reduce((s, t) => s + t.regularHours, 0),
        overtimeHours: enhancedTotals.reduce((s, t) => s + t.overtimeHours, 0),
        fedWithholding: enhancedTotals.reduce((s, t) => s + t.fedWithholding, 0),
        stateWithholding: enhancedTotals.reduce((s, t) => s + t.stateWithholding, 0),
        sdiWithheld: enhancedTotals.reduce((s, t) => s + t.sdiWithheld, 0),
        ssTaxEmployee: enhancedTotals.reduce((s, t) => s + t.ssTaxEmployee, 0),
        ssTaxEmployer: enhancedTotals.reduce((s, t) => s + t.ssTaxEmployer, 0),
        medicareTaxEmployee: enhancedTotals.reduce((s, t) => s + t.medicareTaxEmployee, 0),
        medicareTaxEmployer: enhancedTotals.reduce((s, t) => s + t.medicareTaxEmployer, 0),
        futaTaxableWages: enhancedTotals.reduce((s, t) => s + t.futaTaxableWages, 0),
        futaTax: enhancedTotals.reduce((s, t) => s + t.futaTax, 0),
        suiTaxableWages: enhancedTotals.reduce((s, t) => s + t.suiTaxableWages, 0),
        suiTax: enhancedTotals.reduce((s, t) => s + t.suiTax, 0),
        ettTax: enhancedTotals.reduce((s, t) => s + t.ettTax, 0),
        ssTaxableWages: enhancedTotals.reduce((s, t) => s + t.ssTaxableWages, 0),
      };

      res.json({ workerTotals: enhancedTotals, grandTotal, runCount: filteredRuns.length });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to get payroll summary" });
    }
  });

  app.get("/api/dashboard/stats", async (_req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  app.get("/api/companies", async (_req, res) => {
    try {
      const companies = await storage.getCompanies();
      res.json(companies);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch companies" });
    }
  });

  app.get("/api/companies/:id", async (req, res) => {
    try {
      const company = await storage.getCompany(req.params.id);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      res.json(company);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch company" });
    }
  });

  app.post("/api/companies", requireRole("admin", "manager"), requireActiveSubscription, async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.enterpriseId === "") data.enterpriseId = null;
      if (data.legalEntityId === "") data.legalEntityId = null;
      const company = await storage.createCompany(data);
      try {
        const seedData = getDefaultRetentionPolicySeedData(company.id);
        for (const policy of seedData) {
          await storage.createDocumentRetentionPolicy(policy);
        }
      } catch (seedErr) {
        console.error("Failed to seed default retention policies for company", company.id, seedErr);
      }
      res.status(201).json(company);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create company" });
    }
  });

  app.patch("/api/companies/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.enterpriseId === "") data.enterpriseId = null;
      if (data.legalEntityId === "") data.legalEntityId = null;
      if (data.nextCheckNumber !== undefined) data.nextCheckNumber = parseInt(data.nextCheckNumber) || null;
      const company = await storage.updateCompany(req.params.id as string, data);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      res.json(company);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update company" });
    }
  });

  app.get("/api/workers", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      const companyId = req.query.companyId as string | undefined;
      const allWorkers = await storage.getWorkers(companyId && companyId !== "all" ? companyId : undefined);
      if (user && user.role === "employee" && user.workerId) {
        const selfWorker = allWorkers.filter(w => w.id === user.workerId);
        return res.json(selfWorker);
      }
      res.json(allWorkers);
    } catch (error) {
      console.error("Failed to fetch workers:", error);
      res.status(500).json({ message: "Failed to fetch workers" });
    }
  });

  app.post("/api/workers", requireRole("admin", "manager"), requireActiveSubscription, async (req, res) => {
    try {
      if (!req.body.companyId) return res.status(400).json({ message: "Company is required" });
      if (!req.body.firstName) return res.status(400).json({ message: "First name is required" });
      if (!req.body.lastName) return res.status(400).json({ message: "Last name is required" });
      if (req.body.contractorType && !["hourly", "invoice"].includes(req.body.contractorType)) {
        return res.status(400).json({ message: "Contractor type must be 'hourly' or 'invoice'" });
      }
      if (req.body.workerType === "employee") {
        req.body.contractorType = null;
      }
      const worker = await storage.createWorker(req.body);
      res.status(201).json(worker);
    } catch (error) {
      console.error("Failed to create worker:", error);
      res.status(500).json({ message: "Failed to create worker" });
    }
  });

  app.patch("/api/workers/:id", requireRole("admin", "manager"), requireActiveSubscription, async (req, res) => {
    try {
      const worker = await storage.updateWorker(req.params.id as string, req.body);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }
      res.json(worker);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update worker" });
    }
  });

  app.delete("/api/workers/:id", requireRole("admin"), async (req, res) => {
    try {
      const worker = await storage.getWorker(req.params.id as string);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }
      await storage.deleteWorker(req.params.id as string);
      res.json({ message: "Worker deleted successfully" });
    } catch (error) {
      console.error("Failed to delete worker:", error);
      res.status(500).json({ message: "Failed to delete worker" });
    }
  });

  app.post("/api/time-clock/auth", async (req, res) => {
    try {
      const { employeeNumber, pin } = req.body;
      if (!employeeNumber || !pin) {
        return res.status(400).json({ message: "Employee number and PIN are required" });
      }
      const worker = await storage.getWorkerByEmployeeNumber(employeeNumber);
      if (!worker || worker.pin !== pin) {
        return res.status(401).json({ message: "Invalid employee number or PIN" });
      }
      if (!worker.isActive) {
        return res.status(403).json({ message: "This employee account is inactive" });
      }
      const allUsers = await storage.getUsers();
      let user = allUsers.find(u => u.workerId === worker.id);
      if (!user) {
        const hashedPassword = await bcrypt.hash(pin, 10);
        user = await storage.createUser({
          username: employeeNumber,
          password: hashedPassword,
          role: "employee",
          companyId: worker.companyId,
          workerId: worker.id,
          isActive: true,
        });
      }
      req.session.userId = user.id;
      req.session.username = user.username;
      const company = await storage.getCompany(worker.companyId);
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ message: "Authentication failed" });
        }
        res.json({ worker, company });
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Authentication failed" });
    }
  });

  app.get("/api/time-clock/punches", async (req, res) => {
    try {
      const { workerId, employeeNumber, pin } = req.query;
      if (!workerId || !employeeNumber || !pin) {
        return res.status(400).json({ message: "workerId, employeeNumber, and pin are required" });
      }
      const worker = await storage.getWorker(workerId as string);
      if (!worker || worker.employeeNumber !== employeeNumber || worker.pin !== pin) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const allPunches = await storage.getTimePunches(worker.companyId);
      const workerPunches = allPunches
        .filter(p => p.workerId === workerId)
        .sort((a, b) => new Date(b.punchTime).getTime() - new Date(a.punchTime).getTime())
        .slice(0, 20);
      res.json(workerPunches);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch punches" });
    }
  });

  app.post("/api/time-clock/punch", async (req, res) => {
    try {
      const { workerId, companyId, punchType, employeeNumber, pin } = req.body;
      if (!workerId || !companyId || !punchType) {
        return res.status(400).json({ message: "workerId, companyId, and punchType are required" });
      }
      const worker = await storage.getWorker(workerId);
      if (!worker) return res.status(404).json({ message: "Worker not found" });
      if (employeeNumber && pin) {
        if (worker.employeeNumber !== employeeNumber || worker.pin !== pin) {
          return res.status(401).json({ message: "Invalid credentials" });
        }
      } else if (!req.session.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      if (worker.workerType === "contractor" && worker.contractorType === "invoice") {
        return res.status(400).json({ message: "Invoice-based contractors cannot clock in/out." });
      }
      let matchedStationId: string | undefined;
      if (punchType === "clock_in" && worker.companyId) {
        const companyRows = await db.execute(sql`SELECT station_enforcement_enabled FROM companies WHERE id = ${worker.companyId}`);
        const enforcementEnabled = companyRows.rows.length > 0 && (companyRows.rows[0] as any).station_enforcement_enabled === true;
        if (enforcementEnabled) {
          const allStations = await storage.getStations(worker.companyId);
          const activeStations = allStations.filter(s => s.status === "active");
          if (activeStations.length > 0) {
            const clientIp = req.ip || req.socket.remoteAddress || "";
            const matched = activeStations.find(s => {
              if (!s.ipRestriction) return false;
              const restrictions = s.ipRestriction.split(",").map(r => r.trim());
              return restrictions.some(r => {
                if (r.includes("/")) {
                  const [subnet, bits] = r.split("/");
                  const mask = ~((1 << (32 - parseInt(bits))) - 1) >>> 0;
                  const ipToNum = (ip: string) => ip.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct), 0) >>> 0;
                  return (ipToNum(clientIp) & mask) === (ipToNum(subnet) & mask);
                }
                return clientIp === r;
              });
            });
            if (!matched) {
              return res.status(403).json({ message: `Clock-in denied. Your IP address (${clientIp}) does not match any authorized station. Contact your administrator.` });
            }
            matchedStationId = matched.id;
          }
        }
      }
      const today = new Date().toISOString().split("T")[0];
      // Check if worker has a schedule for today (for unscheduled punch detection)
      let isUnscheduled = false;
      let matchingSchedule: any = null;
      let scheduledStart: Date | undefined;
      let scheduledEnd: Date | undefined;
      let scheduledHours: string | undefined;
      if (punchType === "clock_in") {
        const todaySchedules = await storage.getSchedulesByDateRange(companyId, today, today);
        const workerSchedule = todaySchedules.find(s => s.workerId === workerId);
        if (!workerSchedule) {
          isUnscheduled = true;
        } else {
          matchingSchedule = workerSchedule;
          const now = new Date();
          const [sh, sm] = workerSchedule.startTime.split(":").map(Number);
          const [eh, em] = workerSchedule.endTime.split(":").map(Number);
          scheduledStart = new Date(today + "T00:00:00");
          scheduledStart.setHours(sh, sm, 0, 0);
          scheduledEnd = new Date(today + "T00:00:00");
          scheduledEnd.setHours(eh, em, 0, 0);
          const hrs = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
          scheduledHours = Math.max(0, hrs).toFixed(2);
          // Flag as unscheduled if clocking in more than 2 hours before or after scheduled start
          const diffMin = Math.abs((now.getTime() - scheduledStart.getTime()) / 60000);
          if (diffMin > 120) isUnscheduled = true;
        }
      }

      const punchApprovalStatus = isUnscheduled ? "pending" : "approved";
      const punch = await storage.createTimePunch({
        workerId, companyId, punchType, punchTime: new Date(),
        approvalStatus: punchApprovalStatus,
        scheduleId: matchingSchedule?.id || undefined,
        stationId: matchedStationId ?? null,
      });

      if (punchType === "clock_in") {
        const allEntries = await storage.getTimeEntries();
        const staleOpenEntries = allEntries.filter(
          (e) => e.workerId === workerId && e.clockIn && !e.clockOut && e.date !== today
        );
        for (const stale of staleOpenEntries) {
          const staleClockIn = new Date(stale.clockIn!);
          const elapsed = (Date.now() - staleClockIn.getTime()) / (1000 * 60 * 60);
          const cappedHours = Math.min(elapsed, 8).toFixed(2);
          const staleClockOut = new Date(staleClockIn.getTime() + parseFloat(cappedHours) * 60 * 60 * 1000);
          await storage.updateTimeEntry(stale.id, {
            clockOut: staleClockOut, totalHours: cappedHours, overtimeHours: "0.00", doubleTimeHours: "0.00",
          });
        }
        const now = new Date();
        const lateMinutes = scheduledStart ? Math.max(0, Math.round((now.getTime() - scheduledStart.getTime()) / 60000)) : 0;
        await storage.createTimeEntry({
          workerId, companyId, date: today, clockIn: now, status: "pending",
          scheduleId: matchingSchedule?.id || undefined,
          scheduledStart: scheduledStart || undefined,
          scheduledEnd: scheduledEnd || undefined,
          scheduledHours: scheduledHours || undefined,
          lateMinutes, isUnscheduled,
          source: "punches",
          note: isUnscheduled ? "No matching schedule — unscheduled shift" : undefined,
        });
      } else if (punchType === "clock_out") {
        const entries = await storage.getTimeEntries();
        const openEntry = entries.find(e => e.workerId === workerId && e.clockIn && !e.clockOut);
        if (openEntry) {
          const clockIn = new Date(openEntry.clockIn!);
          const clockOut = new Date();
          const totalMs = clockOut.getTime() - clockIn.getTime();
          const breakMs = (openEntry.breakMinutes || 0) * 60 * 1000;
          const workedHours = Math.max(0, (totalMs - breakMs) / (1000 * 60 * 60));
          const otHours = Math.max(0, workedHours - 8);
          const dtHours = Math.max(0, workedHours - 12);
          await storage.updateTimeEntry(openEntry.id, {
            clockOut, totalHours: workedHours.toFixed(2),
            overtimeHours: otHours.toFixed(2), doubleTimeHours: dtHours.toFixed(2),
          });
        }
      }
      res.status(201).json({
        ...punch,
        warning: isUnscheduled ? "No schedule found for today — this punch requires manager approval." : undefined,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Punch failed" });
    }
  });

  app.post("/api/payroll-runs/:id/process", requireActiveSubscription, async (req, res) => {
    try {
      const run = await storage.getPayrollRun(req.params.id);
      if (!run) return res.status(404).json({ message: "Payroll run not found" });

      const company = await storage.getCompany(run.companyId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const entries = await storage.getTimeEntriesByDateRange(
        run.companyId, run.periodStart, run.periodEnd
      );
      const allWorkers = await storage.getWorkers(run.companyId);
      const activeWorkers = allWorkers.filter(w => w.isActive);

      const companyDeductions = await storage.getTaxesDeductions(run.companyId);

      // Delete existing items so reprocessing always recalculates everything from scratch
      const existingItems = await storage.getPayrollItems(run.id);
      for (const old of existingItems) {
        await storage.deletePayrollItem(old.id);
      }
      const existingYtdByWorker: Record<string, { gross: number; deductions: number; net: number }> = {};

      const allRuns = await storage.getPayrollRuns(run.companyId);
      const currentYear = new Date(run.periodStart).getFullYear();
      const priorRuns = allRuns.filter(r =>
        r.status !== "draft" && r.id !== run.id && r.periodEnd < run.periodStart &&
        new Date(r.periodEnd).getFullYear() === currentYear
      );

      for (const worker of activeWorkers) {
        let ytdGross = 0, ytdDeductions = 0, ytdNet = 0;
        for (const pr of priorRuns) {
          const priorItems = await storage.getPayrollItems(pr.id);
          const workerItem = priorItems.find(i => i.workerId === worker.id);
          if (workerItem) {
            ytdGross += parseFloat(workerItem.grossPay || "0");
            ytdDeductions += parseFloat(workerItem.deductions || "0");
            ytdNet += parseFloat(workerItem.netPay || "0");
          }
        }
        existingYtdByWorker[worker.id] = { gross: ytdGross, deductions: ytdDeductions, net: ytdNet };
      }

      let totalGross = 0, totalNet = 0, totalHours = 0, totalOT = 0;
      let checkNum = company.nextCheckNumber || 1;
      const items: any[] = [];

      const allWageGroups = await storage.getSecondaryWageGroups(run.companyId);
      const wageGroupMap: Record<string, { hourlyRate: number; overtimeRate: number }> = {};
      for (const wg of allWageGroups) {
        wageGroupMap[wg.id] = {
          hourlyRate: parseFloat(wg.hourlyRate || "0"),
          overtimeRate: parseFloat(wg.overtimeRate || "0"),
        };
      }

      // Load amendments and pay stub accounts for this pay period
      const allAmendments = await storage.getPayStubAmendments(run.companyId);
      console.log(`[PAYROLL] Run ${run.id} period: ${run.periodStart} -> ${run.periodEnd}`);
      console.log(`[PAYROLL] Total amendments for company: ${allAmendments.length}`);
      allAmendments.forEach(a => {
        const effDate = a.effectiveDate ? String(a.effectiveDate) : null;
        const pStart = String(run.periodStart);
        const pEnd = String(run.periodEnd);
        const inPeriod = !effDate || (effDate >= pStart && effDate <= pEnd);
        console.log(`[PAYROLL] Amendment ${a.id}: worker=${a.workerId} type=${(a as any).amendmentType} amount=${a.amount} status=${a.status} effectiveDate=${effDate} (type: ${typeof a.effectiveDate}) periodStart=${pStart} periodEnd=${pEnd} inPeriod=${inPeriod}`);
      });
      const periodAmendments = allAmendments.filter(a => {
        const effDate = a.effectiveDate ? String(a.effectiveDate) : null;
        return a.status === "active" &&
          (!effDate || (effDate >= String(run.periodStart) && effDate <= String(run.periodEnd)));
      });
      console.log(`[PAYROLL] Period amendments after filter: ${periodAmendments.length}`);
      const allPsAccounts = await storage.getPayStubAccounts(run.companyId);
      const psAccountMap: Record<string, string> = {};
      for (const acc of allPsAccounts) { psAccountMap[acc.id] = acc.type || "earning"; }

      for (const worker of activeWorkers) {
        const workerEntries = entries.filter(e => e.workerId === worker.id);
        let regHrs = 0, otHrs = 0, dtHrs = 0;
        for (const e of workerEntries) {
          const entryTotal = parseFloat(e.totalHours || "0");
          const entryOt = parseFloat(e.overtimeHours || "0");
          const entryDt = parseFloat((e as any).doubleTimeHours || "0");
          dtHrs += entryDt;
          otHrs += entryOt;
          regHrs += entryTotal - entryOt - entryDt;
        }

        const defaultRate = parseFloat(worker.payRate || "0");
        const otMultiplier = parseFloat(company.overtimeMultiplier || "1.5");
        const dtMultiplier = 2.0;
        let regPay = 0, otPay = 0, dtPay = 0, grossPay = 0;

        if (worker.payType === "salary") {
          let periodsPerYear = 26;
          if (company.payFrequency === "weekly") periodsPerYear = 52;
          else if (company.payFrequency === "monthly") periodsPerYear = 12;
          else if (company.payFrequency === "semimonthly") periodsPerYear = 24;
          const hourlyEquiv = defaultRate / 2080;
          regPay = defaultRate / periodsPerYear;
          otPay = otHrs * hourlyEquiv * otMultiplier;
          dtPay = dtHrs * hourlyEquiv * dtMultiplier;
          grossPay = regPay + otPay + dtPay;
        } else {
          for (const e of workerEntries) {
            const entryTotal = parseFloat(e.totalHours || "0");
            const entryOt = parseFloat(e.overtimeHours || "0");
            const entryDt = parseFloat(e.doubleTimeHours || "0");
            const entryReg = entryTotal - entryOt - entryDt;

            const wgId = e.wageGroupId;
            const wg = wgId ? wageGroupMap[wgId] : null;
            const rate = wg ? wg.hourlyRate : defaultRate;
            const otRate = wg && wg.overtimeRate > 0 ? wg.overtimeRate : rate * otMultiplier;

            regPay += entryReg * rate;
            otPay += entryOt * otRate;
            dtPay += entryDt * rate * dtMultiplier;
          }
          grossPay = regPay + otPay + dtPay;
        }

        // Apply pay stub amendments for this worker in this pay period
        const workerAmendments = periodAmendments.filter(a => a.workerId === worker.id);
        console.log(`[PAYROLL] Worker ${worker.firstName} ${worker.lastName}: ${workerAmendments.length} amendments`);
        let amendmentEarnings = 0;
        let amendmentDeductions = 0;
        for (const am of workerAmendments) {
          let amAmt = 0;
          if (am.amountType === "percentage") {
            amAmt = grossPay * (parseFloat(am.percent || "0") / 100);
          } else if (parseFloat(am.rate || "0") > 0 && parseFloat(am.units || "0") > 0) {
            amAmt = parseFloat(am.rate) * parseFloat(am.units);
          } else {
            amAmt = parseFloat(am.amount || "0");
          }
          // Use explicit amendmentType first, fall back to account type
          const accountType = am.payStubAccountId ? (psAccountMap[am.payStubAccountId] || "earning") : "earning";
          const effectiveType = (am as any).amendmentType || accountType;
          console.log(`[PAYROLL]   Amendment: amount=${amAmt} effectiveType=${effectiveType} raw_amendmentType=${(am as any).amendmentType}`);
          if (effectiveType === "deduction") {
            amendmentDeductions += amAmt;
          } else {
            amendmentEarnings += amAmt;
          }
        }
        console.log(`[PAYROLL] Worker ${worker.firstName}: earnings_adj=${amendmentEarnings} deductions_adj=${amendmentDeductions} grossBefore=${grossPay}`);
        grossPay += amendmentEarnings;

        const rate = defaultRate;

        const isContractor = worker.workerType === "contractor";
        const workerGroup = (worker as any).workerGroup || (isContractor ? "hourly_contractor" : "hourly_employee");
        const isContractorGroup = workerGroup === "hourly_contractor" || workerGroup === "invoiced_contractor";
        const isVolunteer = workerGroup === "volunteer";
        const isOwnerDist = workerGroup === "owner_distribution";

        if (isVolunteer) continue;

        const workerDeductions = (isContractor || isContractorGroup) ? [] : companyDeductions.filter(d => {
          if (!d.isActive || d.isEmployerPaid) return false;
          if (d.isReferenceOnly) return false;
          const appliesTo = d.appliesTo || "all";
          if (appliesTo === "contractor") return false;
          const nameLower = d.name.toLowerCase();
          if (nameLower.includes("se tax") || nameLower.includes("self-employment") || nameLower.includes("self employment")) return false;
          return true;
        });

        let totalDeductions = 0;
        for (const ded of workerDeductions) {
          if (ded.calculationType === "percentage") {
            const base = ded.maxAmount ? Math.min(grossPay, parseFloat(ded.maxAmount)) : grossPay;
            totalDeductions += base * (parseFloat(ded.rate || "0") / 100);
          } else {
            totalDeductions += parseFloat(ded.rate || "0");
          }
        }
        // Add amendment-based deductions (e.g. loan repayments, advances)
        totalDeductions += amendmentDeductions;

        const netPay = grossPay - totalDeductions;
        const ytd = existingYtdByWorker[worker.id] || { gross: 0, deductions: 0, net: 0 };

        totalGross += grossPay;
        totalNet += netPay;
        totalHours += regHrs + otHrs + dtHrs;
        totalOT += otHrs;

        items.push({
          payrollRunId: run.id,
          workerId: worker.id,
          regularHours: regHrs.toFixed(2),
          overtimeHours: otHrs.toFixed(2),
          doubleTimeHours: dtHrs.toFixed(2),
          regularPay: regPay.toFixed(2),
          overtimePay: otPay.toFixed(2),
          doubleTimePay: dtPay.toFixed(2),
          grossPay: grossPay.toFixed(2),
          deductions: totalDeductions.toFixed(2),
          netPay: netPay.toFixed(2),
          payRate: rate.toFixed(2),
          payType: worker.payType || "hourly",
          checkNumber: String(checkNum++),
          ytdGross: (ytd.gross + grossPay).toFixed(2),
          ytdDeductions: (ytd.deductions + totalDeductions).toFixed(2),
          ytdNet: (ytd.net + netPay).toFixed(2),
        });
      }

      for (const item of items) {
        await storage.createPayrollItem(item);
      }

      await storage.updateCompany(run.companyId, { nextCheckNumber: checkNum });

      await storage.updatePayrollRun(run.id, {
        status: "processed",
        totalGross: totalGross.toFixed(2),
        totalNet: totalNet.toFixed(2),
        totalHours: totalHours.toFixed(2),
        totalOvertimeHours: totalOT.toFixed(2),
        workerCount: activeWorkers.length,
        processedAt: new Date(),
      });

      const updatedRun = await storage.getPayrollRun(run.id);
      const finalItems = await storage.getPayrollItems(run.id);
      res.json({ run: updatedRun, items: finalItems });
    } catch (error) {
      console.error("Payroll processing error:", error);
      res.status(500).json({ message: "Failed to process payroll" });
    }
  });

  // ── NACHA ACH File Generation ─────────────────────────────────────────────
  app.get("/api/payroll-runs/:id/nacha", requireAuth, requireRole("admin", "manager"), requireActiveSubscription, async (req, res) => {
    try {
      const run = await storage.getPayrollRun(req.params.id);
      if (!run) return res.status(404).json({ message: "Payroll run not found" });
      if (!run.useDirectDeposit) return res.status(400).json({ message: "Direct deposit is disabled for this payroll run" });
      if (run.status !== "processed" && run.status !== "paid") return res.status(400).json({ message: "Payroll run must be processed before generating ACH file" });

      const company = await storage.getCompany(run.companyId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const { remittanceSources } = await import("../shared/schema.js");
      const sources = await db.select().from(remittanceSources).where(eq(remittanceSources.companyId, run.companyId));
      const source = sources.find(s => (s.type === "ach" || s.type === "direct_deposit") && s.routingNumber) || sources.find(s => s.routingNumber);
      if (!source || !source.routingNumber || !source.accountNumber) {
        return res.status(400).json({ message: "No ACH remittance source configured for this company. Please add a remittance source with a routing and account number." });
      }

      const items = await storage.getPayrollItems(run.id);
      const { payMethods } = await import("../shared/schema.js");

      type PayMethodRow = { id: string; workerId: string; methodType: string; routingNumber: string | null; accountNumber: string | null; accountType: string | null; isPrimary: boolean | null; platform: string | null };
      const allPayMethods = await db.select().from(payMethods) as PayMethodRow[];

      const workers = await storage.getWorkers(run.companyId);
      const workerMap: Record<string, typeof workers[0]> = {};
      for (const w of workers) workerMap[w.id] = w;

      const pr = (s: string, len: number) => s.substring(0, len).padEnd(len, " ");
      const pl = (s: string, len: number) => s.substring(0, len).padStart(len, "0");
      const nachaDate = (d: Date) => {
        const yy = d.getFullYear().toString().slice(-2);
        const mm = (d.getMonth() + 1).toString().padStart(2, "0");
        const dd = d.getDate().toString().padStart(2, "0");
        return `${yy}${mm}${dd}`;
      };

      const effectiveDate = run.payDate ? new Date(run.payDate + "T12:00:00") : new Date();
      const now = new Date();
      const fileDate = nachaDate(now);
      const fileTime = now.getHours().toString().padStart(2, "0") + now.getMinutes().toString().padStart(2, "0");
      const effDate = nachaDate(effectiveDate);

      const odfiRouting = (source.routingNumber || "").replace(/\D/g, "").substring(0, 9);
      const odfi8 = odfiRouting.substring(0, 8);
      const companyId10 = "1" + ((company.ein || "").replace(/\D/g, "").substring(0, 9)).padStart(9, "0");
      const companyName16 = pr(company.name || "", 16);
      const immDest = source.immediateDest || (" " + odfiRouting);
      const immDestName = pr(source.immediateDestName || source.institution || "BANK", 23);
      const immOrigin = source.immediateOrigin || companyId10;
      const immOriginName = pr(source.immediateOriginName || company.name || "", 23);

      const fileHeader =
        "1" +
        "01" +
        pl(immDest.padStart(10, " "), 10) +
        pl(immOrigin, 10) +
        fileDate +
        fileTime +
        "A" +
        "094" +
        "10" +
        "1" +
        immDestName +
        immOriginName +
        "        ";

      const entries: string[] = [];
      let entryHash = BigInt(0);
      let totalCreditCents = BigInt(0);
      let seqNum = 1;

      for (const item of items) {
        const worker = workerMap[item.workerId];
        if (!worker) continue;
        const netPay = parseFloat(item.netPay || "0");
        if (netPay <= 0) continue;

        const pm = allPayMethods.find(m =>
          m.workerId === item.workerId &&
          m.methodType === "direct_deposit" &&
          !m.platform &&
          m.routingNumber &&
          m.accountNumber
        ) || allPayMethods.find(m =>
          m.workerId === item.workerId &&
          m.methodType === "direct_deposit" &&
          m.routingNumber &&
          m.accountNumber
        );
        if (!pm || !pm.routingNumber || !pm.accountNumber) continue;

        const rdfiRouting = pm.routingNumber.replace(/\D/g, "").substring(0, 9);
        const rdfi8 = rdfiRouting.substring(0, 8);
        const checkDigit = rdfiRouting.substring(8, 9) || "0";
        const txnCode = (pm.accountType === "savings") ? "32" : "22";
        const cents = Math.round(netPay * 100);
        const dfiAccount = pr(pm.accountNumber.replace(/\D/g, ""), 17);
        const amount10 = pl(cents.toString(), 10);
        const workerName = pr(`${worker.firstName || ""} ${worker.lastName || ""}`.trim(), 22);
        const indivId = pr(worker.id.substring(0, 15), 15);
        const traceNum = odfi8 + pl(seqNum.toString(), 7);

        entryHash += BigInt(rdfi8);
        totalCreditCents += BigInt(cents);

        entries.push(
          "6" +
          txnCode +
          rdfi8 +
          checkDigit +
          dfiAccount +
          amount10 +
          indivId +
          workerName +
          "  " +
          "0" +
          traceNum
        );
        seqNum++;
      }

      if (entries.length === 0) {
        return res.status(400).json({ message: "No employees with direct deposit banking information found in this payroll run." });
      }

      const entryCount = entries.length;
      const hashStr = pl((entryHash % BigInt(10000000000)).toString(), 10);
      const totalCreditStr = pl(totalCreditCents.toString(), 12);
      const batchNum7 = "0000001";

      const batchHeader =
        "5" +
        "220" +
        companyName16 +
        "                    " +
        companyId10 +
        "PPD" +
        pr("PAYROLL", 10) +
        "      " +
        effDate +
        "   " +
        "1" +
        odfi8 +
        batchNum7;

      const batchControl =
        "8" +
        "220" +
        pl(entryCount.toString(), 6) +
        hashStr +
        "000000000000" +
        totalCreditStr +
        companyId10 +
        "                   " +
        "      " +
        odfi8 +
        batchNum7;

      const allRecords = [fileHeader, batchHeader, ...entries, batchControl];
      const totalRecords = allRecords.length + 1;
      const blockCount = Math.ceil((totalRecords) / 10);
      const paddingNeeded = blockCount * 10 - totalRecords;

      const fileControl =
        "9" +
        "000001" +
        pl(blockCount.toString(), 6) +
        pl(entryCount.toString(), 8) +
        hashStr +
        "000000000000" +
        totalCreditStr +
        " ".repeat(39);

      allRecords.push(fileControl);
      for (let i = 0; i < paddingNeeded; i++) {
        allRecords.push("9".repeat(94));
      }

      const nachaContent = allRecords.join("\r\n") + "\r\n";
      const fileName = `ACH_${company.name.replace(/\s+/g, "_")}_${run.periodEnd}.ach`;

      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(nachaContent);
    } catch (error) {
      console.error("NACHA generation error:", error);
      res.status(500).json({ message: "Failed to generate ACH file" });
    }
  });

  app.delete("/api/payroll-runs/:id", requireRole("admin"), async (req, res) => {
    try {
      const run = await storage.getPayrollRun(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Payroll run not found" });
      const items = await storage.getPayrollItems(run.id);
      for (const item of items) {
        await storage.deletePayrollItem(item.id);
      }
      await storage.deletePayrollRun(run.id);
      res.json({ message: "Payroll run deleted" });
    } catch (error) {
      console.error("Failed to delete payroll run:", error);
      res.status(500).json({ message: "Failed to delete payroll run" });
    }
  });

  // Recalculate YTD for all payroll items of a company — fixes ytd_gross/ytd_net stored values
  app.post("/api/payroll/recalculate-ytd", requireRole("admin"), async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const allRuns = (await storage.getPayrollRuns(companyId))
        .filter(r => r.status === "processed")
        .sort((a, b) => a.periodStart.localeCompare(b.periodStart));

      // Build year-scoped cumulative ytd per worker
      const ytdByWorkerYear: Record<string, number> = {};
      const ytdNetByWorkerYear: Record<string, number> = {};
      let updatedCount = 0;

      for (const run of allRuns) {
        const year = new Date(run.periodStart).getFullYear();
        const items = await storage.getPayrollItems(run.id);
        for (const item of items) {
          const key = `${item.workerId}:${year}`;
          const priorYtd = ytdByWorkerYear[key] || 0;
          const priorYtdNet = ytdNetByWorkerYear[key] || 0;
          const grossPay = parseFloat(item.grossPay || "0");
          const netPay = parseFloat(item.netPay || "0");
          const correctYtdGross = priorYtd + grossPay;
          const correctYtdNet = priorYtdNet + netPay;
          if (
            Math.abs(parseFloat(item.ytdGross || "0") - correctYtdGross) > 0.01 ||
            Math.abs(parseFloat(item.ytdNet || "0") - correctYtdNet) > 0.01
          ) {
            await storage.updatePayrollItem(item.id, {
              ytdGross: correctYtdGross.toFixed(2),
              ytdNet: correctYtdNet.toFixed(2),
            });
            updatedCount++;
          }
          ytdByWorkerYear[key] = correctYtdGross;
          ytdNetByWorkerYear[key] = correctYtdNet;
        }
      }
      res.json({ message: `YTD recalculated. ${updatedCount} payroll item(s) updated.`, updatedCount });
    } catch (error) {
      console.error("Failed to recalculate YTD:", error);
      res.status(500).json({ message: "Failed to recalculate YTD" });
    }
  });

  app.get("/api/time-punches", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      let punches = await storage.getTimePunches();
      // Employees and contractors only see their own punches
      if (user && user.role === "employee" && user.workerId) {
        punches = punches.filter(p => p.workerId === user.workerId);
      }
      res.json(punches);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch time punches" });
    }
  });

  app.post("/api/time-punches", async (req, res) => {
    try {
      if (req.session.userId) {
        const user = await storage.getUser(req.session.userId);
        if (user && user.role === "employee" && user.workerId && user.workerId !== req.body.workerId) {
          return res.status(403).json({ message: "You can only clock in/out for yourself" });
        }
      }
      if (!req.body.workerId) return res.status(400).json({ message: "workerId is required" });
      const worker = await storage.getWorker(req.body.workerId);
      if (!worker) return res.status(404).json({ message: "Worker not found" });
      if (!worker.companyId) return res.status(400).json({ message: "Worker is not assigned to a company. Please assign the worker to a company before clocking in." });
      if (worker.workerType === "contractor" && worker.contractorType === "invoice") {
        return res.status(400).json({ message: "Invoice-based contractors cannot clock in/out. They submit invoices instead." });
      }
      let matchedStationId: string | undefined;
      if (req.body.punchType === "clock_in" && worker.companyId) {
        const companyRows = await db.execute(sql`SELECT station_enforcement_enabled FROM companies WHERE id = ${worker.companyId}`);
        const enforcementEnabled = companyRows.rows.length > 0 && (companyRows.rows[0] as any).station_enforcement_enabled === true;
        if (enforcementEnabled) {
          const allStations = await storage.getStations(worker.companyId);
          const activeStations = allStations.filter(s => s.status === "active");
          if (activeStations.length > 0) {
            const clientIp = req.ip || req.socket.remoteAddress || "";
            const matched = activeStations.find(s => {
              if (!s.ipRestriction) return false;
              const restrictions = s.ipRestriction.split(",").map(r => r.trim());
              return restrictions.some(r => {
                if (r.includes("/")) {
                  const [subnet, bits] = r.split("/");
                  const mask = ~((1 << (32 - parseInt(bits))) - 1) >>> 0;
                  const ipToNum = (ip: string) => ip.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct), 0) >>> 0;
                  return (ipToNum(clientIp) & mask) === (ipToNum(subnet) & mask);
                }
                return clientIp === r;
              });
            });
            if (!matched) {
              return res.status(403).json({ message: `Clock-in denied. Your IP address (${clientIp}) does not match any authorized station. Contact your administrator.` });
            }
            matchedStationId = matched.id;
          }
        }
      }
      const punch = await storage.createTimePunch({
        workerId: worker.id,
        companyId: worker.companyId,
        punchType: req.body.punchType,
        punchTime: new Date(),
        note: req.body.note ?? null,
        scheduleId: req.body.scheduleId ?? null,
        stationId: matchedStationId ?? null,
      });

      if (punch.punchType === "clock_in") {
        const today = new Date().toISOString().split("T")[0];
        const allEntries = await storage.getTimeEntries();
        const staleOpenEntries = allEntries.filter(
          (e) => e.workerId === punch.workerId && e.clockIn && !e.clockOut && e.date !== today
        );
        for (const stale of staleOpenEntries) {
          const staleClockIn = new Date(stale.clockIn!);
          const now = new Date();
          const elapsed = (now.getTime() - staleClockIn.getTime()) / (1000 * 60 * 60);
          const cappedHours = Math.min(elapsed, 8).toFixed(2);
          const staleClockOut = new Date(staleClockIn.getTime() + parseFloat(cappedHours) * 60 * 60 * 1000);
          await storage.updateTimeEntry(stale.id, {
            clockOut: staleClockOut,
            totalHours: cappedHours,
            overtimeHours: "0.00",
            doubleTimeHours: "0.00",
          });
        }
        const entryData: any = {
          workerId: punch.workerId,
          companyId: punch.companyId,
          date: new Date().toISOString().split("T")[0],
          clockIn: new Date(),
          status: "pending",
        };
        if (req.body.wageGroupId) {
          entryData.wageGroupId = req.body.wageGroupId;
        }
        await storage.createTimeEntry(entryData);
      } else if (punch.punchType === "break_start") {
        // nothing extra needed — punch is recorded
      } else if (punch.punchType === "break_end") {
        const allPunches = await storage.getTimePunches(punch.companyId);
        const workerPunches = allPunches
          .filter(p => p.workerId === punch.workerId)
          .sort((a, b) => new Date(a.punchTime).getTime() - new Date(b.punchTime).getTime());
        const lastBreakStart = [...workerPunches].reverse().find(p => p.punchType === "break_start" && p.id !== punch.id);
        if (lastBreakStart) {
          const breakDuration = Math.round((new Date(punch.punchTime).getTime() - new Date(lastBreakStart.punchTime).getTime()) / (1000 * 60));
          const entries = await storage.getTimeEntries();
          const openEntry = entries.find(e => e.workerId === punch.workerId && e.clockIn && !e.clockOut);
          if (openEntry) {
            const currentBreak = openEntry.breakMinutes || 0;
            await storage.updateTimeEntry(openEntry.id, {
              breakMinutes: currentBreak + breakDuration,
            });
          }
        }
      } else if (punch.punchType === "clock_out") {
        const entries = await storage.getTimeEntries();
        const openEntry = entries.find(
          (e) => e.workerId === punch.workerId && e.clockIn && !e.clockOut
        );
        if (openEntry) {
          const company = await storage.getCompany(punch.companyId);
          const dailyOTThreshold = parseFloat(String(company?.overtimeThreshold ?? 8));
          const doubleTimeThreshold = 12;

          const clockIn = new Date(openEntry.clockIn!);
          const clockOut = new Date();
          const diffMs = clockOut.getTime() - clockIn.getTime();
          const totalHours = Math.max(0, (diffMs / (1000 * 60 * 60)) - (openEntry.breakMinutes || 0) / 60);

          let overtimeHours = 0;
          let doubleTimeHours = 0;
          if (totalHours > doubleTimeThreshold) {
            doubleTimeHours = totalHours - doubleTimeThreshold;
            overtimeHours = doubleTimeThreshold - dailyOTThreshold;
          } else if (totalHours > dailyOTThreshold) {
            overtimeHours = totalHours - dailyOTThreshold;
          }

          await storage.updateTimeEntry(openEntry.id, {
            clockOut: clockOut,
            totalHours: totalHours.toFixed(2),
            overtimeHours: Math.max(0, overtimeHours).toFixed(2),
            doubleTimeHours: Math.max(0, doubleTimeHours).toFixed(2),
          });
        }
      }

      res.status(201).json(punch);
    } catch (error: any) {
      console.error("Time punch error:", error);
      const msg = error?.message || "Failed to create time punch";
      res.status(500).json({ message: msg });
    }
  });

  app.patch("/api/time-punches/:id", requireAuth, async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.punchTime) data.punchTime = new Date(data.punchTime);
      const punch = await storage.updateTimePunch(req.params.id, data);
      if (!punch) {
        return res.status(404).json({ message: "Time punch not found" });
      }
      res.json(punch);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update time punch" });
    }
  });

  app.delete("/api/time-punches/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteTimePunch(req.params.id);
      res.json({ message: "Time punch deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete time punch" });
    }
  });

  app.get("/api/time-punches/pending", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.query;
      const punches = await storage.getPendingPunches(companyId as string | undefined);
      res.json(punches);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch pending punches" });
    }
  });

  app.patch("/api/time-punches/:id/approve", requireAuth, async (req, res) => {
    try {
      const { action } = req.body;
      const approvalStatus = action === "reject" ? "rejected" : "approved";
      const punch = await storage.updateTimePunch(req.params.id, {
        approvalStatus,
        approvedBy: req.session.userId || undefined,
      });
      if (!punch) return res.status(404).json({ message: "Punch not found" });
      res.json(punch);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update punch approval" });
    }
  });

  app.post("/api/time-entries/convert-from-punches", requireAuth, async (req, res) => {
    try {
      const { companyId, startDate, endDate } = req.body;
      if (!companyId || !startDate || !endDate) {
        return res.status(400).json({ message: "companyId, startDate, endDate required" });
      }
      const result = await storage.convertPunchesToTimeEntries(companyId, startDate, endDate);
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to convert punches to timesheet entries" });
    }
  });

  app.get("/api/schedule/labor-summary", requireAuth, async (req, res) => {
    try {
      const { companyId, startDate, endDate } = req.query;
      if (!companyId || !startDate || !endDate) {
        return res.status(400).json({ message: "companyId, startDate, endDate required" });
      }
      const summary = await storage.getScheduleLaborSummary(companyId as string, startDate as string, endDate as string);
      res.json(summary);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch labor summary" });
    }
  });

  app.get("/api/time-entries", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      let entries = await storage.getTimeEntries();
      // Employees and contractors only see their own entries
      if (user && user.role === "employee" && user.workerId) {
        entries = entries.filter(e => e.workerId === user.workerId);
      }
      res.json(entries);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch time entries" });
    }
  });

  app.post("/api/time-entries", requireAuth, async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.clockIn) data.clockIn = new Date(data.clockIn);
      if (data.clockOut) data.clockOut = new Date(data.clockOut);
      const entry = await storage.createTimeEntry(data);
      res.status(201).json(entry);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create time entry" });
    }
  });

  app.patch("/api/time-entries/:id", requireAuth, async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.clockIn) data.clockIn = new Date(data.clockIn);
      if (data.clockOut) data.clockOut = new Date(data.clockOut);
      const entry = await storage.updateTimeEntry(req.params.id, data);
      if (!entry) {
        return res.status(404).json({ message: "Time entry not found" });
      }
      res.json(entry);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update time entry" });
    }
  });

  app.delete("/api/time-entries/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteTimeEntry(req.params.id);
      res.json({ message: "Time entry deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete time entry" });
    }
  });

  app.get("/api/schedules", async (_req, res) => {
    try {
      const allSchedules = await storage.getSchedules();
      res.json(allSchedules);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch schedules" });
    }
  });

  app.post("/api/schedules", requireActiveSubscription, async (req, res) => {
    try {
      const { workerId, companyId, date, startTime, endTime, department, jobId, note } = req.body;
      if (!workerId || !companyId || !date || !startTime || !endTime) {
        return res.status(400).json({ message: "Employee, company, date, start time, and end time are required" });
      }
      try { await db.execute(sql`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS job_id VARCHAR`); } catch {}
      const data = {
        workerId,
        companyId,
        date,
        startTime,
        endTime,
        department: department || null,
        jobId: jobId || null,
        note: note || null,
      };
      const schedule = await storage.createSchedule(data);
      res.status(201).json(schedule);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create schedule" });
    }
  });

  app.patch("/api/schedules/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { startTime, endTime, department, jobId, note, status } = req.body;
      const updateData: any = {};
      if (startTime !== undefined) updateData.startTime = startTime;
      if (endTime !== undefined) updateData.endTime = endTime;
      if (department !== undefined) updateData.department = department || null;
      if (jobId !== undefined) updateData.jobId = jobId || null;
      if (note !== undefined) updateData.note = note || null;
      if (status !== undefined) updateData.status = status;
      const schedule = await storage.updateSchedule(req.params.id, updateData);
      if (!schedule) {
        return res.status(404).json({ message: "Schedule not found" });
      }
      res.json(schedule);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update schedule" });
    }
  });

  app.delete("/api/schedules/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteSchedule(req.params.id);
      res.json({ message: "Schedule deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete schedule" });
    }
  });

  app.post("/api/schedules/generate", async (req, res) => {
    try {
      const { companyId, startDate, endDate } = req.body;
      if (!companyId || !startDate || !endDate) {
        return res.status(400).json({ message: "companyId, startDate, endDate required" });
      }
      // Ensure job_id columns exist — safe no-op if already present, fixes VPS without migration
      try { await db.execute(sql`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS job_id VARCHAR`); } catch {}
      try { await db.execute(sql`ALTER TABLE recurring_schedules ADD COLUMN IF NOT EXISTS job_id VARCHAR`); } catch {}
      // Get ALL recurring schedules (no company filter) so we can match by worker's company too
      const allRecurring = await storage.getRecurringSchedules();
      const allWorkers = await storage.getWorkers();
      // Match recurring schedules where the recurring record's companyId matches OR the worker belongs to this company
      const activeRecurring = allRecurring.filter(r => {
        if (!r.isActive) return false;
        if (r.companyId === companyId) return true;
        const worker = allWorkers.find(w => w.id === r.workerId);
        return worker?.companyId === companyId;
      });

      // Pre-load all existing schedules for this company in the date range for duplicate checking
      const allExisting = await storage.getSchedules();
      const existingSet = new Set(
        allExisting
          .filter(s => s.companyId === companyId && s.date >= startDate && s.date <= endDate)
          .map(s => `${s.workerId}::${s.date}::${s.startTime}::${s.endTime}`)
      );

      // Build a set of valid job IDs so we don't pass a deleted job_id into the new schedule
      const allJobs = await storage.getJobs();
      const validJobIds = new Set(allJobs.map(j => j.id));

      const created: any[] = [];
      let skipped = 0;
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      for (let d = new Date(start); d <= end;) {
        const dayOfWeek = d.getDay();
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        for (const rs of activeRecurring) {
          if (rs.dayOfWeek !== dayOfWeek) continue;
          if (rs.effectiveFrom && dateStr < rs.effectiveFrom) continue;
          if (rs.effectiveTo && dateStr > rs.effectiveTo) continue;
          // Skip if an identical shift already exists for this worker on this date
          const key = `${rs.workerId}::${dateStr}::${rs.startTime}::${rs.endTime}`;
          if (existingSet.has(key)) {
            skipped++;
            continue;
          }
          // Only pass jobId if it still exists — avoids FK violation from deleted jobs
          const safeJobId = rs.jobId && validJobIds.has(rs.jobId) ? rs.jobId : null;
          try {
            const schedule = await storage.createSchedule({
              companyId,
              workerId: rs.workerId,
              date: dateStr,
              startTime: rs.startTime,
              endTime: rs.endTime,
              jobId: safeJobId,
              status: "draft",
            });
            created.push(schedule);
            existingSet.add(key); // prevent duplicates within the same generation run
          } catch (scheduleError: any) {
            console.error(`Failed to create schedule for date ${dateStr}, worker ${rs.workerId}:`, scheduleError?.message || scheduleError);
          }
        }
        d.setDate(d.getDate() + 1);
      }
      res.status(201).json({ created: created.length, skipped, templatesFound: activeRecurring.length, schedules: created });
    } catch (error) {
      console.error("Schedule generation error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to generate schedules") });
    }
  });

  // Publish schedules endpoint — marks drafts as published and sends email + SMS notifications
  app.post("/api/schedules/publish", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { companyId, startDate, endDate, scheduleIds } = req.body;

      let targetSchedules: any[] = [];

      if (scheduleIds && Array.isArray(scheduleIds) && scheduleIds.length > 0) {
        // Publish specific schedule IDs
        const all = await storage.getSchedules();
        targetSchedules = all.filter((s: any) => scheduleIds.includes(s.id) && s.status === "draft");
      } else if (companyId && startDate && endDate) {
        // Publish all drafts for a company in date range
        const all = await storage.getSchedulesByDateRange(companyId, startDate, endDate);
        targetSchedules = all.filter((s: any) => s.status === "draft");
      } else {
        return res.status(400).json({ message: "Provide scheduleIds or companyId + startDate + endDate" });
      }

      if (targetSchedules.length === 0) {
        return res.json({ published: 0, notified: 0, message: "No draft schedules found to publish" });
      }

      const approvedTimeOff = await storage.getTimeOffRequests(companyId);
      const approvedOff = approvedTimeOff.filter((r: any) => r.status === "approved");
      const conflicts: string[] = [];
      const allWorkersForCheck = await storage.getWorkers();
      for (const s of targetSchedules) {
        const schedDate = s.date;
        for (const off of approvedOff) {
          if (off.workerId === s.workerId && schedDate >= off.startDate && schedDate <= off.endDate) {
            const w = allWorkersForCheck.find((x: any) => x.id === s.workerId);
            const name = w ? `${w.firstName} ${w.lastName}` : s.workerId;
            conflicts.push(`${name} has approved time-off on ${schedDate}`);
          }
        }
      }
      if (conflicts.length > 0) {
        return res.status(409).json({
          message: "Cannot publish: employees have approved time-off during scheduled shifts",
          conflicts,
        });
      }

      // Mark all as published
      await Promise.all(targetSchedules.map((s: any) => storage.updateSchedule(s.id, { status: "published" })));

      // Group shifts by worker for notifications
      const byWorker: Record<string, { worker: any; shifts: any[] }> = {};
      const allWorkers = await storage.getWorkers();
      const allCompanies = await storage.getCompanies();

      for (const s of targetSchedules) {
        if (!byWorker[s.workerId]) {
          const worker = allWorkers.find((w: any) => w.id === s.workerId);
          if (worker) byWorker[s.workerId] = { worker, shifts: [] };
        }
        if (byWorker[s.workerId]) byWorker[s.workerId].shifts.push(s);
      }

      const scheduleViewUrl = `${getAppBaseUrl(req)}/schedule`;

      // Send notifications
      let notified = 0;
      const notificationResults: any[] = [];

      for (const { worker, shifts } of Object.values(byWorker)) {
        const company = allCompanies.find((c: any) => c.id === (shifts[0]?.companyId));
        const workerName = `${worker.firstName} ${worker.lastName}`;
        const companyName = company?.name || "Your employer";

        const email = worker.workEmail || worker.email || worker.homeEmail;
        const phone = worker.mobilePhone || worker.phone || worker.homePhone;

        const payload = {
          workerName,
          email,
          phone,
          companyName,
          shifts: shifts.map((s: any) => ({ date: s.date, startTime: s.startTime, endTime: s.endTime, department: s.department })),
          scheduleViewUrl,
        };

        const [emailResult, smsResult] = await Promise.all([
          sendScheduleEmailNotification(payload),
          sendScheduleSmsNotification(payload),
        ]);

        const sent = emailResult.sent || smsResult.sent;
        if (sent) notified++;
        notificationResults.push({ worker: workerName, email: emailResult, sms: smsResult });
      }

      console.log(`[Publish] Published ${targetSchedules.length} schedules, notified ${notified} workers`);
      res.json({ published: targetSchedules.length, notified, results: notificationResults });
    } catch (error) {
      console.error("Schedule publish error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to publish schedules") });
    }
  });

  app.get("/api/payroll-runs", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const runs = await storage.getPayrollRuns(companyId);
      res.json(runs);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch payroll runs" });
    }
  });

  app.get("/api/payroll-runs/:id", async (req, res) => {
    try {
      const run = await storage.getPayrollRun(req.params.id);
      if (!run) {
        return res.status(404).json({ message: "Payroll run not found" });
      }
      res.json(run);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch payroll run" });
    }
  });

  app.get("/api/payroll-runs/:id/items", async (req, res) => {
    try {
      const items = await storage.getPayrollItems(req.params.id);
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch payroll items" });
    }
  });

  app.post("/api/payroll-runs", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { companyId, periodStart, periodEnd } = req.body;

      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const entries = await storage.getTimeEntriesByDateRange(companyId, periodStart, periodEnd);
      const allWorkers = await storage.getWorkers(companyId);
      const activeWorkers = allWorkers.filter(w => w.isActive);
      const companyDeductions = await storage.getTaxesDeductions(companyId);

      const allSecondaryWageGroups = await storage.getSecondaryWageGroups(companyId);
      const wageGroupMap: Record<string, { hourlyRate: number; overtimeRate: number }> = {};
      for (const wg of allSecondaryWageGroups) {
        wageGroupMap[wg.id] = {
          hourlyRate: parseFloat(wg.hourlyRate || "0"),
          overtimeRate: parseFloat(wg.overtimeRate || "0"),
        };
      }

      const allRuns = await storage.getPayrollRuns(companyId);
      const runYear = new Date(periodStart).getFullYear();
      const priorRuns = allRuns.filter(r =>
        r.status !== "draft" && r.periodEnd < periodStart &&
        new Date(r.periodEnd).getFullYear() === runYear
      );
      const existingYtdByWorker: Record<string, { gross: number; deductions: number; net: number }> = {};
      for (const worker of activeWorkers) {
        let ytdGross = 0, ytdDeductions = 0, ytdNet = 0;
        for (const pr of priorRuns) {
          const priorItems = await storage.getPayrollItems(pr.id);
          const workerItem = priorItems.find(i => i.workerId === worker.id);
          if (workerItem) {
            ytdGross += parseFloat(workerItem.grossPay || "0");
            ytdDeductions += parseFloat(workerItem.deductions || "0");
            ytdNet += parseFloat(workerItem.netPay || "0");
          }
        }
        existingYtdByWorker[worker.id] = { gross: ytdGross, deductions: ytdDeductions, net: ytdNet };
      }

      const otMultiplier = Number(company.overtimeMultiplier || 1.5);
      const dtMultiplier = 2.0;
      const items: any[] = [];
      let totalGross = 0, totalNet = 0, totalHoursSum = 0, totalOT = 0;
      let checkNum = company.nextCheckNumber || 1;

      for (const worker of activeWorkers) {
        const workerEntries = entries.filter(e => e.workerId === worker.id);
        const regHrs = workerEntries.reduce((s, e) => {
          const tot = parseFloat(e.totalHours || "0");
          const ot = parseFloat(e.overtimeHours || "0");
          const dt = parseFloat((e as any).doubleTimeHours || "0");
          return s + (tot - ot - dt);
        }, 0);
        const otHrs = workerEntries.reduce((s, e) => s + parseFloat(e.overtimeHours || "0"), 0);
        const dtHrs = workerEntries.reduce((s, e) => s + parseFloat((e as any).doubleTimeHours || "0"), 0);
        const totalHrs = regHrs + otHrs + dtHrs;
        const defaultRate = parseFloat(worker.payRate || "0");

        let regPay = 0, otPay = 0, dtPay = 0, grossPay = 0;

        if (worker.payType === "salary") {
          const payFreq = company.payFrequency || "biweekly";
          let periodsPerYear = 26;
          if (payFreq === "weekly") periodsPerYear = 52;
          else if (payFreq === "semimonthly") periodsPerYear = 24;
          else if (payFreq === "monthly") periodsPerYear = 12;
          const hourlyEquiv = defaultRate / 2080;
          regPay = defaultRate / periodsPerYear;
          otPay = otHrs * hourlyEquiv * otMultiplier;
          dtPay = dtHrs * hourlyEquiv * dtMultiplier;
          grossPay = regPay + otPay + dtPay;
        } else {
          for (const e of workerEntries) {
            const entryTotal = parseFloat(e.totalHours || "0");
            const entryOt = parseFloat(e.overtimeHours || "0");
            const entryDt = parseFloat((e as any).doubleTimeHours || "0");
            const entryReg = entryTotal - entryOt - entryDt;
            const wgId = (e as any).wageGroupId;
            const wg = wgId ? wageGroupMap[wgId] : null;
            const rate = wg ? wg.hourlyRate : defaultRate;
            const otRate = wg && wg.overtimeRate > 0 ? wg.overtimeRate : rate * otMultiplier;
            regPay += entryReg * rate;
            otPay += entryOt * otRate;
            dtPay += entryDt * rate * dtMultiplier;
          }
          grossPay = regPay + otPay + dtPay;
        }

        if (totalHrs === 0 && worker.payType !== "salary") continue;

        const isContractor = worker.workerType === "contractor";
        const workerGroup2 = (worker as any).workerGroup || (isContractor ? "hourly_contractor" : "hourly_employee");
        const isContractorGroup2 = workerGroup2 === "hourly_contractor" || workerGroup2 === "invoiced_contractor";
        const isVolunteer2 = workerGroup2 === "volunteer";

        if (isVolunteer2) continue;

        const workerDeds = (isContractor || isContractorGroup2) ? [] : companyDeductions.filter(d => {
          if (!d.isActive || d.isEmployerPaid || d.isReferenceOnly) return false;
          const appliesTo = d.appliesTo || "all";
          if (appliesTo === "contractor") return false;
          const nl = d.name.toLowerCase();
          if (nl.includes("se tax") || nl.includes("self-employment") || nl.includes("self employment")) return false;
          return true;
        });

        let totalDeductions = 0;
        for (const ded of workerDeds) {
          if (ded.calculationType === "percentage") {
            const base = ded.maxAmount ? Math.min(grossPay, parseFloat(ded.maxAmount)) : grossPay;
            totalDeductions += base * (parseFloat(ded.rate || "0") / 100);
          } else {
            totalDeductions += parseFloat(ded.rate || "0");
          }
        }

        const netPay = grossPay - totalDeductions;
        const ytd = existingYtdByWorker[worker.id] || { gross: 0, deductions: 0, net: 0 };

        totalGross += grossPay;
        totalNet += netPay;
        totalHoursSum += totalHrs;
        totalOT += otHrs;

        items.push({
          workerId: worker.id,
          regularHours: regHrs.toFixed(2),
          overtimeHours: otHrs.toFixed(2),
          doubleTimeHours: dtHrs.toFixed(2),
          regularPay: regPay.toFixed(2),
          overtimePay: otPay.toFixed(2),
          doubleTimePay: dtPay.toFixed(2),
          grossPay: grossPay.toFixed(2),
          deductions: totalDeductions.toFixed(2),
          netPay: netPay.toFixed(2),
          payRate: defaultRate.toFixed(2),
          payType: worker.payType || "hourly",
          checkNumber: String(checkNum++),
          ytdGross: (ytd.gross + grossPay).toFixed(2),
          ytdDeductions: (ytd.deductions + totalDeductions).toFixed(2),
          ytdNet: (ytd.net + netPay).toFixed(2),
        });
      }

      const payrollRun = await storage.createPayrollRun({
        companyId,
        periodStart,
        periodEnd,
        status: "processed",
        totalGross: totalGross.toFixed(2),
        totalNet: totalNet.toFixed(2),
        totalHours: totalHoursSum.toFixed(2),
        totalOvertimeHours: totalOT.toFixed(2),
        workerCount: items.length,
        processedAt: new Date(),
      });

      for (const item of items) {
        await storage.createPayrollItem({ payrollRunId: payrollRun.id, ...item });
      }

      await storage.updateCompany(companyId, { nextCheckNumber: checkNum });

      res.status(201).json(payrollRun);
    } catch (error: any) {
      console.error("Payroll processing error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to process payroll") });
    }
  });

  app.patch("/api/payroll-runs/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const run = await storage.updatePayrollRun(req.params.id as string, req.body);
      if (!run) {
        return res.status(404).json({ message: "Payroll run not found" });
      }
      res.json(run);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update payroll run" });
    }
  });

  // Departments
  app.get("/api/departments", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const departments = await storage.getDepartments(companyId);
      res.json(departments);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch departments" });
    }
  });

  app.post("/api/departments", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (!data.companyId || data.companyId === "__universal__") data.companyId = null;
      const department = await storage.createDepartment(data);
      res.status(201).json(department);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create department" });
    }
  });

  app.patch("/api/departments/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (!data.companyId || data.companyId === "__universal__") data.companyId = null;
      const department = await storage.updateDepartment(req.params.id, data);
      if (!department) {
        return res.status(404).json({ message: "Department not found" });
      }
      res.json(department);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update department" });
    }
  });

  app.delete("/api/departments/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteDepartment(req.params.id);
      res.json({ message: "Department deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete department" });
    }
  });

  // Branches
  app.get("/api/branches", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const branches = await storage.getBranches(companyId);
      res.json(branches);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch branches" });
    }
  });

  app.post("/api/branches", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (!data.companyId || data.companyId === "__universal__") data.companyId = null;
      const branch = await storage.createBranch(data);
      res.status(201).json(branch);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Validation failed", errors: error.errors });
      }
      console.error(error);
      res.status(500).json({ message: "Failed to create branch" });
    }
  });

  app.patch("/api/branches/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (!data.companyId || data.companyId === "__universal__") data.companyId = null;
      const branch = await storage.updateBranch(req.params.id, data);
      if (!branch) {
        return res.status(404).json({ message: "Branch not found" });
      }
      res.json(branch);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update branch" });
    }
  });

  app.delete("/api/branches/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteBranch(req.params.id);
      res.json({ message: "Branch deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete branch" });
    }
  });

  // Enterprises
  app.get("/api/enterprises", async (_req, res) => {
    try {
      const result = await storage.getEnterprises();
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch enterprises" });
    }
  });

  app.post("/api/enterprises", requireRole("admin", "manager"), async (req, res) => {
    try {
      const parsed = insertEnterpriseSchema.parse(req.body);
      const enterprise = await storage.createEnterprise(parsed);
      res.status(201).json(enterprise);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Validation failed", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create enterprise" });
    }
  });

  app.patch("/api/enterprises/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const enterprise = await storage.updateEnterprise(req.params.id, req.body);
      if (!enterprise) {
        return res.status(404).json({ message: "Enterprise not found" });
      }
      res.json(enterprise);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update enterprise" });
    }
  });

  app.delete("/api/enterprises/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteEnterprise(req.params.id);
      res.json({ message: "Enterprise deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete enterprise" });
    }
  });

  // Divisions
  app.get("/api/divisions", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const result = await storage.getDivisions(companyId);
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch divisions" });
    }
  });

  app.post("/api/divisions", requireRole("admin", "manager"), async (req, res) => {
    try {
      const parsed = insertDivisionSchema.parse(req.body);
      const division = await storage.createDivision(parsed);
      res.status(201).json(division);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Validation failed", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create division" });
    }
  });

  app.patch("/api/divisions/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const division = await storage.updateDivision(req.params.id, req.body);
      if (!division) {
        return res.status(404).json({ message: "Division not found" });
      }
      res.json(division);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update division" });
    }
  });

  app.delete("/api/divisions/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteDivision(req.params.id);
      res.json({ message: "Division deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete division" });
    }
  });

  // Positions
  app.get("/api/positions", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const result = await storage.getPositions(companyId);
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch positions" });
    }
  });

  app.post("/api/positions", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (!data.companyId || data.companyId === "__universal__") data.companyId = null;
      if (data.departmentId === "") data.departmentId = null;
      if (data.reportsToPositionId === "") data.reportsToPositionId = null;
      if (data.salaryRangeMin === "") data.salaryRangeMin = null;
      if (data.salaryRangeMax === "") data.salaryRangeMax = null;
      if (data.description === "") data.description = null;
      const position = await storage.createPosition(data);
      res.status(201).json(position);
    } catch (error: any) {
      console.error(error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Validation failed", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create position" });
    }
  });

  app.patch("/api/positions/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.departmentId === "") data.departmentId = null;
      if (data.reportsToPositionId === "") data.reportsToPositionId = null;
      if (data.salaryRangeMin === "") data.salaryRangeMin = null;
      if (data.salaryRangeMax === "") data.salaryRangeMax = null;
      if (data.description === "") data.description = null;
      const position = await storage.updatePosition(req.params.id as string, data);
      if (!position) {
        return res.status(404).json({ message: "Position not found" });
      }
      res.json(position);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update position" });
    }
  });

  app.delete("/api/positions/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deletePosition(req.params.id);
      res.json({ message: "Position deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete position" });
    }
  });

  // Cost Centers
  app.get("/api/cost-centers", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const result = await storage.getCostCenters(companyId);
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch cost centers" });
    }
  });

  app.post("/api/cost-centers", requireRole("admin", "manager"), async (req, res) => {
    try {
      const parsed = insertCostCenterSchema.parse(req.body);
      const costCenter = await storage.createCostCenter(parsed);
      res.status(201).json(costCenter);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Validation failed", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create cost center" });
    }
  });

  app.patch("/api/cost-centers/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const costCenter = await storage.updateCostCenter(req.params.id, req.body);
      if (!costCenter) {
        return res.status(404).json({ message: "Cost center not found" });
      }
      res.json(costCenter);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update cost center" });
    }
  });

  app.delete("/api/cost-centers/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteCostCenter(req.params.id);
      res.json({ message: "Cost center deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete cost center" });
    }
  });

  // Jobs
  app.get("/api/jobs", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const result = await storage.getJobs(companyId);
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch jobs" });
    }
  });

  app.post("/api/jobs", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (!data.companyId || data.companyId === "__universal__") data.companyId = null;
      if (data.costCenterId === "") data.costCenterId = null;
      if (data.departmentId === "") data.departmentId = null;
      if (data.defaultWage === "") data.defaultWage = null;
      if (data.startDate === "") data.startDate = null;
      if (data.endDate === "") data.endDate = null;
      const job = await storage.createJob(data);
      res.status(201).json(job);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Validation failed", errors: error.errors });
      }
      console.error(error);
      res.status(500).json({ message: "Failed to create job" });
    }
  });

  app.patch("/api/jobs/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (!data.companyId || data.companyId === "__universal__") data.companyId = null;
      if (data.costCenterId === "") data.costCenterId = null;
      if (data.departmentId === "") data.departmentId = null;
      if (data.defaultWage === "") data.defaultWage = null;
      if (data.startDate === "") data.startDate = null;
      if (data.endDate === "") data.endDate = null;
      const job = await storage.updateJob(req.params.id, data);
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      res.json(job);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update job" });
    }
  });

  app.delete("/api/jobs/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteJob(req.params.id);
      res.json({ message: "Job deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete job" });
    }
  });

  // Accrual Accounts
  app.get("/api/accrual-accounts", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const accounts = await storage.getAccrualAccounts(companyId);
      res.json(accounts);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch accrual accounts" });
    }
  });

  app.post("/api/accrual-accounts", requireRole("admin"), async (req, res) => {
    try {
      const account = await storage.createAccrualAccount(req.body);
      res.status(201).json(account);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create accrual account" });
    }
  });

  app.patch("/api/accrual-accounts/:id", requireRole("admin"), async (req, res) => {
    try {
      const account = await storage.updateAccrualAccount(req.params.id, req.body);
      if (!account) {
        return res.status(404).json({ message: "Accrual account not found" });
      }
      res.json(account);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update accrual account" });
    }
  });

  app.delete("/api/accrual-accounts/:id", requireRole("admin"), async (req, res) => {
    try {
      const deleted = await storage.deleteAccrualAccount(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Accrual account not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete accrual account" });
    }
  });

  app.post("/api/accrual-accounts/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getAccrualAccounts(companyId);
      const existingNames = new Set(existing.map(e => e.name));
      const defaultAccounts = [
        { companyId, name: "Vacation", type: "vacation", accrualRate: "3.08", accrualFrequency: "per_pay_period", maxBalance: "240" },
        { companyId, name: "Sick Leave", type: "sick", accrualRate: "1.0", accrualFrequency: "per_pay_period", maxBalance: "48" },
        { companyId, name: "PTO (Paid Time Off)", type: "pto", accrualRate: "4.0", accrualFrequency: "per_pay_period", maxBalance: "320" },
        { companyId, name: "Personal Days", type: "personal", accrualRate: "1.33", accrualFrequency: "monthly", maxBalance: "16" },
        { companyId, name: "Comp Time", type: "pto", accrualRate: "0", accrualFrequency: "per_pay_period", maxBalance: "80" },
        { companyId, name: "Bereavement Leave", type: "personal", accrualRate: "0", accrualFrequency: "annually", maxBalance: "24" },
        { companyId, name: "Jury Duty", type: "personal", accrualRate: "0", accrualFrequency: "annually", maxBalance: "40" },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const acct of defaultAccounts) {
        if (existingNames.has(acct.name)) { skipped.push(acct.name); continue; }
        const item = await storage.createAccrualAccount(acct);
        created.push(item);
      }
      res.json({ message: `Created ${created.length} accrual accounts${skipped.length > 0 ? `, skipped ${skipped.length} existing` : ""}`, created, skipped });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to set up accrual accounts" });
    }
  });

  // Accrual Balances
  app.get("/api/accrual-balances", async (req, res) => {
    try {
      const workerId = req.query.workerId as string | undefined;
      const balances = await storage.getAccrualBalances(workerId);
      res.json(balances);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch accrual balances" });
    }
  });

  app.post("/api/accrual-balances", async (req, res) => {
    try {
      const balance = await storage.createAccrualBalance(req.body);
      res.status(201).json(balance);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create accrual balance" });
    }
  });

  app.patch("/api/accrual-balances/:id", async (req, res) => {
    try {
      const balance = await storage.updateAccrualBalance(req.params.id, req.body);
      if (!balance) {
        return res.status(404).json({ message: "Accrual balance not found" });
      }
      res.json(balance);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update accrual balance" });
    }
  });

  // Employee Contacts
  app.get("/api/employee-contacts", async (req, res) => {
    try {
      const workerId = req.query.workerId as string | undefined;
      const contacts = await storage.getEmployeeContacts(workerId);
      res.json(contacts);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch employee contacts" });
    }
  });

  app.post("/api/employee-contacts", async (req, res) => {
    try {
      const contact = await storage.createEmployeeContact(req.body);
      res.status(201).json(contact);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create employee contact" });
    }
  });

  app.patch("/api/employee-contacts/:id", async (req, res) => {
    try {
      const contact = await storage.updateEmployeeContact(req.params.id, req.body);
      if (!contact) {
        return res.status(404).json({ message: "Employee contact not found" });
      }
      res.json(contact);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update employee contact" });
    }
  });

  app.delete("/api/employee-contacts/:id", async (req, res) => {
    try {
      await storage.deleteEmployeeContact(req.params.id);
      res.json({ message: "Employee contact deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete employee contact" });
    }
  });

  // Pay Methods
  app.get("/api/pay-methods", async (req, res) => {
    try {
      const workerId = req.query.workerId as string | undefined;
      const methods = await storage.getPayMethods(workerId);
      res.json(methods);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch pay methods" });
    }
  });

  app.post("/api/pay-methods", async (req, res) => {
    try {
      const method = await storage.createPayMethod(req.body);
      res.status(201).json(method);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create pay method" });
    }
  });

  app.patch("/api/pay-methods/:id", async (req, res) => {
    try {
      const method = await storage.updatePayMethod(req.params.id, req.body);
      if (!method) {
        return res.status(404).json({ message: "Pay method not found" });
      }
      res.json(method);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update pay method" });
    }
  });

  app.delete("/api/pay-methods/:id", async (req, res) => {
    try {
      await storage.deletePayMethod(req.params.id);
      res.json({ message: "Pay method deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete pay method" });
    }
  });

  // Pay Periods
  app.get("/api/pay-periods", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const periods = await storage.getPayPeriods(companyId);
      res.json(periods);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch pay periods" });
    }
  });

  app.post("/api/pay-periods", async (req, res) => {
    try {
      const period = await storage.createPayPeriod(req.body);
      res.status(201).json(period);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create pay period" });
    }
  });

  app.patch("/api/pay-periods/:id", async (req, res) => {
    try {
      const period = await storage.updatePayPeriod(req.params.id, req.body);
      if (!period) {
        return res.status(404).json({ message: "Pay period not found" });
      }
      res.json(period);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update pay period" });
    }
  });

  // Taxes & Deductions
  app.get("/api/taxes-deductions", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const taxesDeductions = await storage.getTaxesDeductions(companyId);
      res.json(taxesDeductions);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch taxes and deductions" });
    }
  });

  app.post("/api/taxes-deductions", async (req, res) => {
    try {
      const taxDeduction = await storage.createTaxDeduction(req.body);
      res.status(201).json(taxDeduction);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create tax/deduction" });
    }
  });

  app.patch("/api/taxes-deductions/:id", async (req, res) => {
    try {
      const taxDeduction = await storage.updateTaxDeduction(req.params.id, req.body);
      if (!taxDeduction) {
        return res.status(404).json({ message: "Tax/deduction not found" });
      }
      res.json(taxDeduction);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update tax/deduction" });
    }
  });

  app.delete("/api/taxes-deductions/:id", async (req, res) => {
    try {
      await storage.deleteTaxDeduction(req.params.id);
      res.json({ message: "Tax/deduction deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete tax/deduction" });
    }
  });

  app.post("/api/taxes-deductions/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getTaxesDeductions(companyId);
      const existingNames = new Set(existing.map(e => e.name));
      const standardItems = [
        { companyId, name: "Federal Income Tax", type: "tax", category: "mandatory_tax", subcategory: "federal", calculationType: "percentage", rate: "22", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "employee" },
        { companyId, name: "California Personal Income Tax (PIT)", type: "tax", category: "mandatory_tax", subcategory: "state", calculationType: "percentage", rate: "5", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "employee" },
        { companyId, name: "Social Security (FICA)", type: "tax", category: "mandatory_tax", subcategory: "federal", calculationType: "percentage", rate: "6.2", maxAmount: "168600", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "employee" },
        { companyId, name: "Medicare", type: "tax", category: "mandatory_tax", subcategory: "federal", calculationType: "percentage", rate: "1.45", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "employee" },
        { companyId, name: "Additional Medicare", type: "tax", category: "mandatory_tax", subcategory: "federal", calculationType: "percentage", rate: "0.9", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "employee" },
        { companyId, name: "CA State Disability Insurance (SDI)", type: "tax", category: "mandatory_tax", subcategory: "state", calculationType: "percentage", rate: "1.1", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "employee" },
        { companyId, name: "Social Security - Employer", type: "tax", category: "mandatory_tax", subcategory: "federal", calculationType: "percentage", rate: "6.2", maxAmount: "168600", isEmployerPaid: true, isReferenceOnly: false, appliesTo: "employee" },
        { companyId, name: "Medicare - Employer", type: "tax", category: "mandatory_tax", subcategory: "federal", calculationType: "percentage", rate: "1.45", isEmployerPaid: true, isReferenceOnly: false, appliesTo: "employee" },
        { companyId, name: "FUTA (Federal Unemployment)", type: "tax", category: "mandatory_tax", subcategory: "federal", calculationType: "percentage", rate: "0.6", maxAmount: "7000", isEmployerPaid: true, isReferenceOnly: false, appliesTo: "employee" },
        { companyId, name: "CA Unemployment Insurance (SUI)", type: "tax", category: "mandatory_tax", subcategory: "state", calculationType: "percentage", rate: "3.4", maxAmount: "7000", isEmployerPaid: true, isReferenceOnly: false, appliesTo: "employee" },
        { companyId, name: "CA Employment Training Tax (ETT)", type: "tax", category: "mandatory_tax", subcategory: "state", calculationType: "percentage", rate: "0.1", maxAmount: "7000", isEmployerPaid: true, isReferenceOnly: false, appliesTo: "employee" },
        { companyId, name: "SE Tax - Social Security (Reference)", type: "tax", category: "mandatory_tax", subcategory: "self_employment", calculationType: "percentage", rate: "12.4", maxAmount: "168600", isEmployerPaid: false, isReferenceOnly: true, appliesTo: "contractor" },
        { companyId, name: "SE Tax - Medicare (Reference)", type: "tax", category: "mandatory_tax", subcategory: "self_employment", calculationType: "percentage", rate: "2.9", isEmployerPaid: false, isReferenceOnly: true, appliesTo: "contractor" },
        { companyId, name: "Child Support", type: "deduction", category: "garnishment", subcategory: "court_ordered", calculationType: "fixed", rate: "0", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "all", isActive: false },
        { companyId, name: "Wage Garnishments", type: "deduction", category: "garnishment", subcategory: "court_ordered", calculationType: "fixed", rate: "0", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "all", isActive: false },
        { companyId, name: "Tax Levies", type: "deduction", category: "garnishment", subcategory: "tax", calculationType: "fixed", rate: "0", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "all", isActive: false },
        { companyId, name: "Bankruptcy Payments", type: "deduction", category: "garnishment", subcategory: "court_ordered", calculationType: "fixed", rate: "0", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "all", isActive: false },
        { companyId, name: "Health Insurance", type: "deduction", category: "benefit_deduction", subcategory: "insurance", calculationType: "fixed", rate: "0", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "employee" },
        { companyId, name: "Dental Insurance", type: "deduction", category: "benefit_deduction", subcategory: "insurance", calculationType: "fixed", rate: "0", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "employee" },
        { companyId, name: "Vision Insurance", type: "deduction", category: "benefit_deduction", subcategory: "insurance", calculationType: "fixed", rate: "0", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "employee" },
        { companyId, name: "401(k) Retirement", type: "deduction", category: "benefit_deduction", subcategory: "retirement", calculationType: "percentage", rate: "0", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "employee" },
        { companyId, name: "HSA Contributions", type: "deduction", category: "benefit_deduction", subcategory: "health", calculationType: "fixed", rate: "0", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "employee" },
        { companyId, name: "Life Insurance", type: "deduction", category: "voluntary_deduction", subcategory: "insurance", calculationType: "fixed", rate: "0", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "employee", isActive: false },
        { companyId, name: "Charity Donations", type: "deduction", category: "voluntary_deduction", subcategory: "voluntary", calculationType: "fixed", rate: "0", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "employee", isActive: false },
        { companyId, name: "Parking", type: "deduction", category: "voluntary_deduction", subcategory: "voluntary", calculationType: "fixed", rate: "0", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "employee", isActive: false },
        { companyId, name: "Gym Membership", type: "deduction", category: "voluntary_deduction", subcategory: "voluntary", calculationType: "fixed", rate: "0", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "employee", isActive: false },
        { companyId, name: "Company Loan Repayment", type: "deduction", category: "voluntary_deduction", subcategory: "voluntary", calculationType: "fixed", rate: "0", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "employee", isActive: false },
        { companyId, name: "Union Dues", type: "deduction", category: "voluntary_deduction", subcategory: "membership", calculationType: "fixed", rate: "0", isEmployerPaid: false, isReferenceOnly: false, appliesTo: "employee", isActive: false },
      ];
      const created = [];
      const skipped = [];
      for (const item of standardItems) {
        if (existingNames.has(item.name)) {
          skipped.push(item.name);
          continue;
        }
        const result = await storage.createTaxDeduction(item as any);
        created.push(result);
      }
      res.json({ message: `Created ${created.length} items${skipped.length ? `, skipped ${skipped.length} existing` : ""}`, count: created.length, skipped: skipped.length });
    } catch (error: any) {
      console.error("Tax/deduction setup error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to set up taxes/deductions") });
    }
  });

  // Policy Groups
  app.get("/api/policy-groups", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const groups = await storage.getPolicyGroups(companyId);
      res.json(groups);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch policy groups" });
    }
  });

  app.post("/api/policy-groups", requireRole("admin"), async (req, res) => {
    try {
      const group = await storage.createPolicyGroup(req.body);
      res.status(201).json(group);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create policy group" });
    }
  });

  app.patch("/api/policy-groups/:id", requireRole("admin"), async (req, res) => {
    try {
      const group = await storage.updatePolicyGroup(req.params.id, req.body);
      if (!group) {
        return res.status(404).json({ message: "Policy group not found" });
      }
      res.json(group);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update policy group" });
    }
  });

  app.delete("/api/policy-groups/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deletePolicyGroup(req.params.id);
      res.json({ message: "Policy group deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete policy group" });
    }
  });

  app.post("/api/policy-groups/quick-setup", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getPolicyGroups();
      const existingNames = new Set(existing.map(e => e.name));
      const defaultGroups = [
        { companyId: null, name: "Full-Time Employees", description: "Policy group for full-time employees with standard benefits, overtime after 8 hrs/day, meal/break rules, and vacation accrual.", isDefault: true },
        { companyId: null, name: "Part-Time Employees", description: "Policy group for part-time employees with prorated benefits and limited overtime eligibility." },
        { companyId: null, name: "Hourly Workers", description: "Policy group for hourly workers with overtime rules, meal/break policies, and time-clock requirements." },
        { companyId: null, name: "Managers", description: "Policy group for managers/supervisors — may be exempt from overtime under CA executive exemption." },
        { companyId: null, name: "Contractors", description: "Policy group for independent contractors — no overtime, benefits, or tax withholding applies." },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const group of defaultGroups) {
        if (existingNames.has(group.name)) { skipped.push(group.name); continue; }
        const result = await storage.createPolicyGroup(group as any);
        created.push(result);
      }
      res.json({ message: `Created ${created.length} policy groups${skipped.length ? `, skipped ${skipped.length} existing` : ""}`, count: created.length, skipped: skipped.length });
    } catch (error: any) {
      console.error("Policy group setup error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to set up policy groups") });
    }
  });

  // Pay Codes
  app.get("/api/pay-codes", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const codes = await storage.getPayCodes(companyId);
      res.json(codes);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch pay codes" });
    }
  });

  app.post("/api/pay-codes", requireRole("admin"), async (req, res) => {
    try {
      const code = await storage.createPayCode(req.body);
      res.status(201).json(code);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create pay code" });
    }
  });

  app.patch("/api/pay-codes/:id", requireRole("admin"), async (req, res) => {
    try {
      const code = await storage.updatePayCode(req.params.id, req.body);
      if (!code) {
        return res.status(404).json({ message: "Pay code not found" });
      }
      res.json(code);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update pay code" });
    }
  });

  app.delete("/api/pay-codes/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deletePayCode(req.params.id);
      res.json({ message: "Pay code deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete pay code" });
    }
  });

  app.post("/api/pay-codes/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getPayCodes(companyId);
      const existingCodes = new Set(existing.map(e => e.code));
      const defaultCodes = [
        { companyId, code: "REGULAR", name: "Regular Time", type: "regular", rate: "1.0" },
        { companyId, code: "OVERTIME", name: "Overtime (1.5x)", type: "overtime", rate: "1.5" },
        { companyId, code: "DOUBLE_TIME", name: "Double Time (2x)", type: "premium", rate: "2.0" },
        { companyId, code: "VACATION", name: "Vacation", type: "vacation", rate: "1.0" },
        { companyId, code: "SICK", name: "Sick Leave", type: "sick", rate: "1.0" },
        { companyId, code: "HOLIDAY", name: "Holiday Pay", type: "holiday", rate: "1.0" },
        { companyId, code: "UNPAID_LEAVE", name: "Unpaid Leave", type: "regular", rate: "0" },
        { companyId, code: "ON_CALL", name: "On Call", type: "premium", rate: "0.5" },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const code of defaultCodes) {
        if (existingCodes.has(code.code)) { skipped.push(code.code); continue; }
        const result = await storage.createPayCode(code as any);
        created.push(result);
      }
      res.json({ message: `Created ${created.length} pay codes${skipped.length ? `, skipped ${skipped.length} existing` : ""}`, count: created.length, skipped: skipped.length });
    } catch (error: any) {
      console.error("Pay code setup error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to set up pay codes") });
    }
  });

  // Holidays
  app.get("/api/holidays", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const holidays = await storage.getHolidays(companyId);
      res.json(holidays);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch holidays" });
    }
  });

  app.post("/api/holidays", async (req, res) => {
    try {
      const holiday = await storage.createHoliday(req.body);
      res.status(201).json(holiday);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create holiday" });
    }
  });

  app.patch("/api/holidays/:id", requireRole("admin"), async (req, res) => {
    try {
      const holiday = await storage.updateHoliday(req.params.id, req.body);
      if (!holiday) {
        return res.status(404).json({ message: "Holiday not found" });
      }
      res.json(holiday);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update holiday" });
    }
  });

  app.delete("/api/holidays/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteHoliday(req.params.id);
      res.json({ message: "Holiday deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete holiday" });
    }
  });

  app.post("/api/holidays/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getHolidays(companyId);
      const existingNames = new Set(existing.map(e => e.name));
      const currentYear = new Date().getFullYear();
      const defaultHolidays = [
        { companyId, name: "New Year's Day", date: `${currentYear}-01-01`, isRecurring: true },
        { companyId, name: "Martin Luther King Jr Day", date: `${currentYear}-01-20`, isRecurring: true },
        { companyId, name: "Presidents Day", date: `${currentYear}-02-17`, isRecurring: true },
        { companyId, name: "Memorial Day", date: `${currentYear}-05-26`, isRecurring: true },
        { companyId, name: "Independence Day", date: `${currentYear}-07-04`, isRecurring: true },
        { companyId, name: "Labor Day", date: `${currentYear}-09-01`, isRecurring: true },
        { companyId, name: "Columbus Day", date: `${currentYear}-10-13`, isRecurring: true },
        { companyId, name: "Veterans Day", date: `${currentYear}-11-11`, isRecurring: true },
        { companyId, name: "Thanksgiving", date: `${currentYear}-11-27`, isRecurring: true },
        { companyId, name: "Christmas Day", date: `${currentYear}-12-25`, isRecurring: true },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const holiday of defaultHolidays) {
        if (existingNames.has(holiday.name)) { skipped.push(holiday.name); continue; }
        const result = await storage.createHoliday(holiday as any);
        created.push(result);
      }
      res.json({ message: `Created ${created.length} holidays${skipped.length ? `, skipped ${skipped.length} existing` : ""}`, count: created.length, skipped: skipped.length });
    } catch (error: any) {
      console.error("Holiday setup error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to set up holidays") });
    }
  });

  // Qualifications
  app.get("/api/qualifications", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const workerId = req.query.workerId as string | undefined;
      const qualifications = await storage.getQualifications(companyId, workerId);
      res.json(qualifications);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch qualifications" });
    }
  });

  app.post("/api/qualifications", requireRole("admin", "manager"), async (req, res) => {
    try {
      const qualification = await storage.createQualification(req.body);
      res.status(201).json(qualification);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create qualification" });
    }
  });

  app.patch("/api/qualifications/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const qualification = await storage.updateQualification(req.params.id, req.body);
      if (!qualification) {
        return res.status(404).json({ message: "Qualification not found" });
      }
      res.json(qualification);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update qualification" });
    }
  });

  app.delete("/api/qualifications/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteQualification(req.params.id);
      res.json({ message: "Qualification deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete qualification" });
    }
  });

  // Reviews
  app.get("/api/reviews", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const workerId = req.query.workerId as string | undefined;
      const reviews = await storage.getReviews(companyId, workerId);
      res.json(reviews);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch reviews" });
    }
  });

  app.post("/api/reviews", requireRole("admin", "manager"), async (req, res) => {
    try {
      const review = await storage.createReview(req.body);
      res.status(201).json(review);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create review" });
    }
  });

  app.patch("/api/reviews/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const review = await storage.updateReview(req.params.id, req.body);
      if (!review) {
        return res.status(404).json({ message: "Review not found" });
      }
      res.json(review);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update review" });
    }
  });

  app.delete("/api/reviews/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteReview(req.params.id);
      res.json({ message: "Review deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete review" });
    }
  });

  app.get("/api/kpi-groups", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const groups = await storage.getKpiGroups(companyId);
      res.json(groups);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch KPI groups" });
    }
  });

  app.post("/api/kpi-groups", requireRole("admin", "manager"), async (req, res) => {
    try {
      const group = await storage.createKpiGroup(req.body);
      res.status(201).json(group);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create KPI group" });
    }
  });

  app.patch("/api/kpi-groups/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const group = await storage.updateKpiGroup(req.params.id, req.body);
      if (!group) return res.status(404).json({ message: "KPI group not found" });
      res.json(group);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update KPI group" });
    }
  });

  app.delete("/api/kpi-groups/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteKpiGroup(req.params.id);
      res.json({ message: "KPI group deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete KPI group" });
    }
  });

  app.get("/api/qualification-groups", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const groups = await storage.getQualificationGroups(companyId);
      res.json(groups);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch qualification groups" });
    }
  });

  app.post("/api/qualification-groups", requireRole("admin", "manager"), async (req, res) => {
    try {
      const group = await storage.createQualificationGroup(req.body);
      res.status(201).json(group);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create qualification group" });
    }
  });

  app.patch("/api/qualification-groups/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const group = await storage.updateQualificationGroup(req.params.id, req.body);
      if (!group) return res.status(404).json({ message: "Qualification group not found" });
      res.json(group);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update qualification group" });
    }
  });

  app.delete("/api/qualification-groups/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteQualificationGroup(req.params.id);
      res.json({ message: "Qualification group deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete qualification group" });
    }
  });

  app.get("/api/worker-languages", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const languages = await storage.getWorkerLanguages(companyId);
      res.json(languages);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch languages" });
    }
  });

  app.post("/api/worker-languages", async (req, res) => {
    try {
      const language = await storage.createWorkerLanguage(req.body);
      res.status(201).json(language);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create language" });
    }
  });

  app.patch("/api/worker-languages/:id", async (req, res) => {
    try {
      const language = await storage.updateWorkerLanguage(req.params.id, req.body);
      if (!language) return res.status(404).json({ message: "Language not found" });
      res.json(language);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update language" });
    }
  });

  app.delete("/api/worker-languages/:id", async (req, res) => {
    try {
      await storage.deleteWorkerLanguage(req.params.id);
      res.json({ message: "Language deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete language" });
    }
  });

  app.get("/api/worker-memberships", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const memberships = await storage.getWorkerMemberships(companyId);
      res.json(memberships);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch memberships" });
    }
  });

  app.post("/api/worker-memberships", async (req, res) => {
    try {
      const membership = await storage.createWorkerMembership(req.body);
      res.status(201).json(membership);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create membership" });
    }
  });

  app.patch("/api/worker-memberships/:id", async (req, res) => {
    try {
      const membership = await storage.updateWorkerMembership(req.params.id, req.body);
      if (!membership) return res.status(404).json({ message: "Membership not found" });
      res.json(membership);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update membership" });
    }
  });

  app.delete("/api/worker-memberships/:id", async (req, res) => {
    try {
      await storage.deleteWorkerMembership(req.params.id);
      res.json({ message: "Membership deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete membership" });
    }
  });

  app.get("/api/client-ip", async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || "";
    res.json({ ip: clientIp });
  });

  app.get("/api/stations", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const items = await storage.getStations(companyId);
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch stations" });
    }
  });
  app.post("/api/stations", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.location === "") data.location = null;
      if (data.ipRestriction === "") data.ipRestriction = null;
      if (data.description === "") data.description = null;
      const parsed = insertStationSchema.parse(data);
      const item = await storage.createStation(parsed);
      res.status(201).json(item);
    } catch (error: any) {
      if (error.name === "ZodError") return res.status(400).json({ message: "Validation failed", errors: error.errors });
      console.error(error);
      res.status(500).json({ message: "Failed to create station" });
    }
  });
  app.patch("/api/stations/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.location === "") data.location = null;
      if (data.ipRestriction === "") data.ipRestriction = null;
      if (data.description === "") data.description = null;
      const item = await storage.updateStation(req.params.id as string, data);
      if (!item) return res.status(404).json({ message: "Station not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update station" });
    }
  });
  app.delete("/api/stations/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteStation(req.params.id as string);
      res.json({ message: "Station deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete station" });
    }
  });

  app.get("/api/receipts", requireAuth, async (req, res) => {
    try {
      const { companyId, costCenterId, jobId } = req.query as Record<string, string>;
      const items = await storage.getReceipts(companyId, costCenterId, jobId);
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch receipts" });
    }
  });

  app.post("/api/receipts", requireAuth, async (req, res) => {
    try {
      const item = await storage.createReceipt(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create receipt" });
    }
  });

  app.patch("/api/receipts/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const item = await storage.updateReceipt(req.params.id as string, req.body);
      if (!item) return res.status(404).json({ message: "Receipt not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update receipt" });
    }
  });

  app.delete("/api/receipts/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteReceipt(req.params.id as string);
      res.json({ message: "Receipt deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete receipt" });
    }
  });

  app.post("/api/receipts/upload", requireAuth, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const filePath = `/uploads/${req.file.filename}`;
      res.json({ filePath, url: filePath });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Upload failed" });
    }
  });

  app.post("/api/receipts/ai-scan", requireAuth, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No receipt image provided" });
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return res.status(500).json({ message: "OpenAI API key not configured" });

      const fs = await import("fs");
      const imageBuffer = fs.readFileSync(req.file.path);
      const base64Image = imageBuffer.toString("base64");
      const mimeType = req.file.mimetype || "image/jpeg";

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({ apiKey });

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a receipt data extraction assistant. Extract data from receipt images and return ONLY valid JSON with these fields:
{
  "vendor": "store/merchant name",
  "description": "brief description of purchase",
  "amount": "total amount as number (including tax)",
  "subtotal": "subtotal before tax as number",
  "taxAmount": "tax amount as number",
  "receiptDate": "date in YYYY-MM-DD format",
  "category": "one of: general, raw-materials, overhead, reimbursement, meals, travel, supplies, equipment, software, utilities, professional-services, repairs, other",
  "paymentMethod": "one of: cash, credit_card, debit_card, check, bank_transfer, other",
  "lineItems": [
    { "description": "item name", "quantity": 1, "unitPrice": 0.00, "total": 0.00 }
  ]
}
If a field cannot be determined, use null. Always return valid JSON only, no markdown formatting.`
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract all data from this receipt image." },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } }
            ]
          }
        ],
        max_tokens: 2000,
      });

      const content = response.choices[0]?.message?.content || "{}";
      const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);

      const filePath = `/uploads/${req.file.filename}`;

      res.json({
        ...parsed,
        receiptImagePath: filePath,
      });
    } catch (error: any) {
      console.error("Receipt image processing error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to process receipt image") });
    }
  });

  app.post("/api/approval-reminders/send", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const { sendApprovalReminderEmail, sendApprovalReminderSms } = await import("./notifications.js");
      const { companyId } = req.body;

      const punches = await storage.getTimePunches();
      const pendingPunches = punches.filter(p => p.approvalStatus === "pending" && (!companyId || p.companyId === companyId));

      const amendments = await storage.getPayStubAmendments();
      const pendingAmendments = amendments.filter((a: any) => (a.approvalStatus === "pending") && (!companyId || a.companyId === companyId));

      const allReceipts = await storage.getReceipts();
      const pendingExpenses = allReceipts.filter(r => r.status === "pending" && (!companyId || r.companyId === companyId));

      const users = await storage.getUsers();
      const managers = users.filter(u => (u.role === "admin" || u.role === "manager") && u.isActive);

      const results: any[] = [];
      for (const mgr of managers) {
        let mgrWorker = mgr.workerId ? await storage.getWorker(mgr.workerId) : null;
        const mgrCompany = mgrWorker?.companyId ? (await storage.getCompanies()).find(c => c.id === mgrWorker!.companyId) : null;
        if (companyId && mgrWorker?.companyId !== companyId) continue;

        const payload = {
          recipientName: mgrWorker ? `${mgrWorker.firstName} ${mgrWorker.lastName}` : mgr.username,
          email: mgrWorker?.email || null,
          phone: mgrWorker?.phone || null,
          companyName: mgrCompany?.name || "Your Company",
          pendingPunches: pendingPunches.length,
          pendingTimecards: 0,
          pendingAmendments: pendingAmendments.length,
          pendingExpenses: pendingExpenses.length,
          dashboardUrl: `${getAppBaseUrl(req)}/attendance?tab=pending-approvals`,
        };

        let emailSent = false, smsSent = false;
        try { await sendApprovalReminderEmail(payload); emailSent = true; } catch (e) { console.warn(`Reminder email failed for ${mgr.username}:`, e); }
        try { await sendApprovalReminderSms(payload); smsSent = true; } catch (e) { console.warn(`Reminder SMS failed for ${mgr.username}:`, e); }
        results.push({ user: mgr.username, emailSent, smsSent });
      }

      res.json({ message: `Reminders sent to ${results.length} manager(s)`, results });
    } catch (error) {
      console.error("Approval reminder error:", error);
      res.status(500).json({ message: "Failed to send reminders" });
    }
  });

  app.get("/api/receipts/export-pdf", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const { jsPDF } = await import("jspdf");
      const autoTable = (await import("jspdf-autotable")).default;

      const allReceipts = await storage.getReceipts();
      const companies = await storage.getCompanies();
      const workers = await storage.getWorkers();
      const jobs = await storage.getJobs();
      const costCenters = await storage.getCostCenters();

      const { companyId, status, dateFrom, dateTo, type } = req.query as Record<string, string>;
      let filtered = allReceipts;
      if (companyId && companyId !== "all") filtered = filtered.filter(r => r.companyId === companyId);
      if (status && status !== "all") filtered = filtered.filter(r => r.status === status);
      if (dateFrom) filtered = filtered.filter(r => r.receiptDate >= dateFrom);
      if (dateTo) filtered = filtered.filter(r => r.receiptDate <= dateTo);
      if (type === "reimbursement") filtered = filtered.filter(r => (r as any).isReimbursement);

      const getWorkerName = (id: string | null) => { if (!id) return "—"; const w = workers.find(w => w.id === id); return w ? `${w.firstName} ${w.lastName}` : "—"; };
      const getCompanyName = (id: string | null) => { if (!id) return "—"; return companies.find(c => c.id === id)?.name || "—"; };
      const getJobName = (id: string | null) => { if (!id) return "—"; return (jobs as any[]).find(j => j.id === id)?.name || "—"; };

      const doc = new jsPDF({ orientation: "landscape" });
      const pageWidth = doc.internal.pageSize.getWidth();

      doc.setFillColor(13, 148, 136);
      doc.rect(0, 0, pageWidth, 28, "F");
      doc.setFillColor(37, 99, 235);
      doc.rect(pageWidth * 0.6, 0, pageWidth * 0.4, 28, "F");

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("PayLink", 14, 12);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text("Expense & Receipt Report", 14, 20);

      const reportDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      doc.setFontSize(9);
      doc.text(reportDate, pageWidth - 14, 12, { align: "right" });
      const total = filtered.reduce((s, r) => s + parseFloat(r.amount?.toString() || "0"), 0);
      doc.text(`${filtered.length} receipts | Total: $${total.toFixed(2)}`, pageWidth - 14, 20, { align: "right" });

      doc.setTextColor(0, 0, 0);

      const tableData = filtered.map(r => [
        r.receiptDate,
        r.vendor || "—",
        (r.category || "general").replace(/-/g, " "),
        getCompanyName(r.companyId),
        getWorkerName(r.workerId),
        getJobName(r.jobId),
        (r as any).paymentMethod ? (r as any).paymentMethod.replace(/_/g, " ") : "—",
        `$${parseFloat(r.amount?.toString() || "0").toFixed(2)}`,
        r.status || "pending",
        (r as any).isReimbursement ? "Yes" : "No",
      ]);

      (autoTable as any)(doc, {
        startY: 34,
        head: [["Date", "Vendor", "Category", "Company", "Employee", "Job Cost", "Payment", "Amount", "Status", "Reimb."]],
        body: tableData,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [13, 148, 136], textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        columnStyles: { 7: { halign: "right" } },
        didDrawPage: (data: any) => {
          const pageH = doc.internal.pageSize.getHeight();
          doc.setFontSize(7);
          doc.setTextColor(156, 163, 175);
          doc.text(`Generated by PayLink — ${reportDate}`, 14, pageH - 8);
          doc.text(`Page ${doc.getCurrentPageInfo().pageNumber}`, pageWidth - 14, pageH - 8, { align: "right" });
        },
      });

      const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="expense-report-${new Date().toISOString().split("T")[0]}.pdf"`);
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("PDF generation error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to generate PDF") });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // EXPENSE MANAGEMENT MODULE
  // ══════════════════════════════════════════════════════════════════════════

  // ── Expense Categories ────────────────────────────────────────────────
  app.get("/api/expense-categories", requireAuth, async (_req, res) => {
    try { res.json(await storage.getExpenseCategories()); }
    catch (e) { res.status(500).json({ message: "Failed to fetch categories" }); }
  });

  app.post("/api/expense-categories", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try { res.status(201).json(await storage.createExpenseCategory(req.body)); }
    catch (e) { res.status(500).json({ message: "Failed to create category" }); }
  });

  app.patch("/api/expense-categories/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const r = await storage.updateExpenseCategory(req.params.id, req.body);
      if (!r) return res.status(404).json({ message: "Not found" });
      res.json(r);
    } catch (e) { res.status(500).json({ message: "Failed to update category" }); }
  });

  // ── Expenses CRUD ─────────────────────────────────────────────────────
  app.get("/api/expenses", requireAuth, async (req, res) => {
    try {
      const { companyId, submitterId, status } = req.query as Record<string, string>;
      const user = await storage.getUser(req.session.userId!);
      const isManager = user?.role === "admin" || user?.role === "manager";
      if (isManager) {
        res.json(await storage.getExpenses(companyId, submitterId, status));
      } else {
        res.json(await storage.getExpenses(companyId, user?.workerId || "none", status));
      }
    } catch (e) { res.status(500).json({ message: "Failed to fetch expenses" }); }
  });

  app.get("/api/expenses/:id", requireAuth, async (req, res) => {
    try {
      const r = await storage.getExpense(req.params.id);
      if (!r) return res.status(404).json({ message: "Not found" });
      const user = await storage.getUser(req.session.userId!);
      const isManager = user?.role === "admin" || user?.role === "manager";
      if (!isManager && user?.workerId !== r.submitterId) return res.status(403).json({ message: "Not authorized" });
      res.json(r);
    } catch (e) { res.status(500).json({ message: "Failed to fetch expense" }); }
  });

  app.post("/api/expenses", requireAuth, async (req, res) => {
    try {
      const data = req.body;
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.status(403).json({ message: "No linked worker" });
      data.submitterId = user.workerId;

      if (!data.amount || parseFloat(data.amount) <= 0) {
        return res.status(400).json({ message: "Positive amount required" });
      }
      if (!data.expenseDate) return res.status(400).json({ message: "Expense date required" });

      if (data.categoryId) {
        const cat = await storage.getExpenseCategory(data.categoryId);
        if (cat) {
          data.categoryName = cat.name;
          if (cat.preapprovalRequired && !data.preapprovalReference) {
            data.preapprovalStatus = "required";
          }
        }
      }

      if (data.amount && data.vendor && data.expenseDate) {
        const crypto = await import("crypto");
        data.duplicateHash = crypto.createHash("md5").update(`${data.submitterId}-${data.vendor}-${data.amount}-${data.expenseDate}`).digest("hex");
      }

      const expense = await storage.createExpense(data);

      await storage.createExpenseApprovalAction({
        objectType: "expense",
        objectId: expense.id,
        actionType: "submitted",
        actorUserId: req.session.userId,
        companyId: expense.companyId,
        newStatus: expense.status,
      });

      res.status(201).json(expense);
    } catch (e) {
      console.error("Create expense error:", e);
      res.status(500).json({ message: "Failed to create expense" });
    }
  });

  app.patch("/api/expenses/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getExpense(req.params.id);
      if (!existing) return res.status(404).json({ message: "Not found" });

      const user = await storage.getUser(req.session.userId!);
      const isOwner = user?.workerId === existing.submitterId;
      const isManager = user?.role === "admin" || user?.role === "manager";
      if (!isOwner && !isManager) return res.status(403).json({ message: "Not authorized" });

      if (existing.status === "approved" && !isManager) {
        return res.status(403).json({ message: "Cannot edit approved expense" });
      }

      const allowedFields = ["vendor", "amount", "description", "businessPurpose", "categoryId", "categoryName",
        "expenseDate", "paymentMethodUsed", "jobId", "costCenterId", "reimbursementRequested",
        "preapprovalReference", "notes", "companyId"];
      const sanitized: Record<string, any> = {};
      for (const key of allowedFields) { if (req.body[key] !== undefined) sanitized[key] = req.body[key]; }

      const r = await storage.updateExpense(req.params.id, sanitized);
      res.json(r);
    } catch (e) { res.status(500).json({ message: "Failed to update expense" }); }
  });

  app.delete("/api/expenses/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getExpense(req.params.id);
      if (!existing) return res.status(404).json({ message: "Not found" });

      const user = await storage.getUser(req.session.userId!);
      const isOwner = user?.workerId === existing.submitterId;
      if (!isOwner && user?.role !== "admin") return res.status(403).json({ message: "Not authorized" });
      if (existing.status === "approved") return res.status(403).json({ message: "Cannot delete approved expense" });

      await storage.deleteExpense(req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ message: "Failed to delete expense" }); }
  });

  // ── Expense Approval ──────────────────────────────────────────────────
  app.post("/api/expenses/:id/submit", requireAuth, async (req, res) => {
    try {
      const expense = await storage.getExpense(req.params.id);
      if (!expense) return res.status(404).json({ message: "Not found" });
      if (expense.status !== "draft") return res.status(400).json({ message: "Only draft expenses can be submitted" });

      const user = await storage.getUser(req.session.userId!);
      if (user?.workerId !== expense.submitterId) return res.status(403).json({ message: "Not your expense" });

      const updated = await storage.updateExpense(req.params.id, { status: "submitted" });
      await storage.createExpenseApprovalAction({
        objectType: "expense", objectId: req.params.id, actionType: "submitted",
        actorUserId: req.session.userId, companyId: expense.companyId,
        previousStatus: "draft", newStatus: "submitted",
      });
      res.json(updated);
    } catch (e) { res.status(500).json({ message: "Failed to submit expense" }); }
  });

  app.post("/api/expenses/:id/approve", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const expense = await storage.getExpense(req.params.id);
      if (!expense) return res.status(404).json({ message: "Not found" });
      if (expense.status !== "submitted") return res.status(400).json({ message: "Only submitted expenses can be approved" });

      const updated = await storage.updateExpense(req.params.id, {
        status: "approved",
        approvedBy: req.session.userId,
        approvedAt: new Date(),
      });

      await storage.createExpenseApprovalAction({
        objectType: "expense", objectId: req.params.id, actionType: "approved",
        actorUserId: req.session.userId, companyId: expense.companyId,
        previousStatus: "submitted", newStatus: "approved",
        notes: req.body.notes,
      });

      if (expense.reimbursementRequested) {
        await storage.createPayrollReimbursementItem({
          expenseId: expense.id,
          workerId: expense.submitterId,
          companyId: expense.companyId,
          amount: expense.amount,
          isTaxable: false,
          description: `Reimbursement: ${expense.vendor || expense.categoryName || "Expense"} - ${expense.expenseDate}`,
          status: "pending",
        });
        await storage.updateExpense(req.params.id, { reimbursementStatus: "queued" });
      }

      res.json(updated);
    } catch (e) { res.status(500).json({ message: "Failed to approve expense" }); }
  });

  app.post("/api/expenses/:id/reject", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const expense = await storage.getExpense(req.params.id);
      if (!expense) return res.status(404).json({ message: "Not found" });
      if (expense.status !== "submitted") return res.status(400).json({ message: "Only submitted expenses can be rejected" });

      const updated = await storage.updateExpense(req.params.id, {
        status: "rejected",
        rejectedBy: req.session.userId,
        rejectedAt: new Date(),
        rejectionReason: req.body.reason || null,
      });

      await storage.createExpenseApprovalAction({
        objectType: "expense", objectId: req.params.id, actionType: "rejected",
        actorUserId: req.session.userId, companyId: expense.companyId,
        previousStatus: "submitted", newStatus: "rejected",
        notes: req.body.reason,
      });

      res.json(updated);
    } catch (e) { res.status(500).json({ message: "Failed to reject expense" }); }
  });

  // ── Expense Attachments ───────────────────────────────────────────────
  app.get("/api/expenses/:id/attachments", requireAuth, async (req, res) => {
    try {
      const expense = await storage.getExpense(req.params.id);
      if (!expense) return res.status(404).json({ message: "Not found" });
      const user = await storage.getUser(req.session.userId!);
      const isManager = user?.role === "admin" || user?.role === "manager";
      if (!isManager && user?.workerId !== expense.submitterId) return res.status(403).json({ message: "Not authorized" });
      res.json(await storage.getExpenseAttachments(req.params.id));
    } catch (e) { res.status(500).json({ message: "Failed to fetch attachments" }); }
  });

  app.post("/api/expenses/:id/attachments", requireAuth, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const expense = await storage.getExpense(req.params.id);
      if (!expense) return res.status(404).json({ message: "Not found" });
      const user = await storage.getUser(req.session.userId!);
      const isManager = user?.role === "admin" || user?.role === "manager";
      if (!isManager && user?.workerId !== expense.submitterId) return res.status(403).json({ message: "Not authorized" });
      const attachment = await storage.createExpenseAttachment({
        expenseId: req.params.id,
        filePath: `/uploads/${req.file.filename}`,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
      });

      await storage.createExpenseApprovalAction({
        objectType: "expense", objectId: req.params.id, actionType: "file_uploaded",
        actorUserId: req.session?.userId, metadataJson: JSON.stringify({ fileName: req.file.originalname }),
      });

      res.status(201).json(attachment);
    } catch (e) { res.status(500).json({ message: "Failed to upload attachment" }); }
  });

  // ── AI Extraction for Expenses ────────────────────────────────────────
  app.post("/api/expenses/ai-scan", requireAuth, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const filePath = `/uploads/${req.file.filename}`;
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) return res.status(500).json({ message: "AI not configured" });

      const fs = await import("fs");
      const base64 = fs.readFileSync(req.file.path).toString("base64");
      const mimeType = req.file.mimetype || "image/jpeg";

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "Extract from this receipt/invoice: vendor name, date (YYYY-MM-DD), subtotal, tax amount, total amount, payment method, individual line items (description, quantity, unit price, total). Also suggest a category from: Office Supplies, Materials, Tools & Equipment, Travel, Lodging, Meals, Mileage, Fuel, Software & Subscriptions, Marketing & Advertising, Professional Services, Permits & Fees, Shipping & Postage, Utilities, Phone & Internet, Training & Education, Client Expense, Project Expense, Repair & Maintenance, Other. Return JSON: { vendor, date, subtotal, taxAmount, totalAmount, paymentMethod, category, lineItems: [{ description, quantity, unitPrice, total }], confidence }." },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          }],
          max_tokens: 1500,
        }),
      });

      const result: any = await response.json();
      const content = result.choices?.[0]?.message?.content || "{}";
      let extracted;
      try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        extracted = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
      } catch { extracted = { raw: content }; }

      await storage.createExpenseApprovalAction({
        objectType: "expense", objectId: "ai_scan", actionType: "ai_extraction",
        actorUserId: req.session?.userId, metadataJson: JSON.stringify({ filePath, confidence: extracted.confidence }),
      });

      res.json({ extracted, filePath });
    } catch (e) {
      console.error("AI scan error:", e);
      res.status(500).json({ message: "AI extraction failed" });
    }
  });

  // ── Expense Approval Actions (audit trail) ────────────────────────────
  app.get("/api/expenses/:id/audit", requireAuth, async (req, res) => {
    try { res.json(await storage.getExpenseApprovalActions("expense", req.params.id)); }
    catch (e) { res.status(500).json({ message: "Failed to fetch audit trail" }); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CONTRACTOR INVOICE MODULE
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/contractor-invoices", requireAuth, async (req, res) => {
    try {
      const { companyId, contractorId, status } = req.query as Record<string, string>;
      const user = await storage.getUser(req.session.userId!);
      const isManager = user?.role === "admin" || user?.role === "manager";
      if (isManager) {
        res.json(await storage.getContractorInvoices(companyId, contractorId, status));
      } else {
        res.json(await storage.getContractorInvoices(companyId, user?.workerId || "none", status));
      }
    } catch (e) { res.status(500).json({ message: "Failed to fetch invoices" }); }
  });

  app.get("/api/contractor-invoices/:id", requireAuth, async (req, res) => {
    try {
      const r = await storage.getContractorInvoice(req.params.id);
      if (!r) return res.status(404).json({ message: "Not found" });
      const user = await storage.getUser(req.session.userId!);
      const isManager = user?.role === "admin" || user?.role === "manager";
      if (!isManager && user?.workerId !== r.contractorId) return res.status(403).json({ message: "Not authorized" });
      res.json(r);
    } catch (e) { res.status(500).json({ message: "Failed to fetch invoice" }); }
  });

  app.post("/api/contractor-invoices", requireAuth, async (req, res) => {
    try {
      const data = req.body;
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.status(403).json({ message: "No linked worker" });

      const worker = await storage.getWorker(user.workerId);
      if (!worker) return res.status(404).json({ message: "Worker not found" });
      if (worker.workerType !== "contractor") return res.status(403).json({ message: "Only contractors can submit invoices" });

      data.contractorId = user.workerId;

      if (!data.amount || parseFloat(data.amount) <= 0) return res.status(400).json({ message: "Positive amount required" });
      if (!data.invoiceDate) return res.status(400).json({ message: "Invoice date required" });

      if (data.amount && data.invoiceNumber && data.invoiceDate) {
        const crypto = await import("crypto");
        data.duplicateHash = crypto.createHash("md5").update(`${data.contractorId}-${data.invoiceNumber}-${data.amount}-${data.invoiceDate}`).digest("hex");
      }

      const invoice = await storage.createContractorInvoice(data);

      await storage.createExpenseApprovalAction({
        objectType: "contractor_invoice", objectId: invoice.id, actionType: "submitted",
        actorUserId: req.session.userId, companyId: invoice.companyId,
        newStatus: invoice.status,
      });

      res.status(201).json(invoice);
    } catch (e) {
      console.error("Create invoice error:", e);
      res.status(500).json({ message: "Failed to create invoice" });
    }
  });

  app.patch("/api/contractor-invoices/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getContractorInvoice(req.params.id);
      if (!existing) return res.status(404).json({ message: "Not found" });

      const user = await storage.getUser(req.session.userId!);
      const isOwner = user?.workerId === existing.contractorId;
      const isManager = user?.role === "admin" || user?.role === "manager";
      if (!isOwner && !isManager) return res.status(403).json({ message: "Not authorized" });

      const allowedFields = ["invoiceNumber", "invoiceDate", "dueDate", "amount", "description",
        "proposalReference", "jobId", "costCenterId", "paymentTerms", "notes", "companyId"];
      const sanitized: Record<string, any> = {};
      for (const key of allowedFields) { if (req.body[key] !== undefined) sanitized[key] = req.body[key]; }

      const r = await storage.updateContractorInvoice(req.params.id, sanitized);
      res.json(r);
    } catch (e) { res.status(500).json({ message: "Failed to update invoice" }); }
  });

  app.post("/api/contractor-invoices/:id/submit", requireAuth, async (req, res) => {
    try {
      const inv = await storage.getContractorInvoice(req.params.id);
      if (!inv) return res.status(404).json({ message: "Not found" });
      if (inv.status !== "draft") return res.status(400).json({ message: "Only draft invoices can be submitted" });

      const user = await storage.getUser(req.session.userId!);
      if (user?.workerId !== inv.contractorId) return res.status(403).json({ message: "Not your invoice" });

      const updated = await storage.updateContractorInvoice(req.params.id, { status: "submitted" });
      await storage.createExpenseApprovalAction({
        objectType: "contractor_invoice", objectId: req.params.id, actionType: "submitted",
        actorUserId: req.session.userId, companyId: inv.companyId,
        previousStatus: "draft", newStatus: "submitted",
      });
      res.json(updated);
    } catch (e) { res.status(500).json({ message: "Failed to submit invoice" }); }
  });

  app.post("/api/contractor-invoices/:id/approve", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const inv = await storage.getContractorInvoice(req.params.id);
      if (!inv) return res.status(404).json({ message: "Not found" });
      if (inv.status !== "submitted") return res.status(400).json({ message: "Only submitted invoices can be approved" });

      if (!inv.proposalReference && !req.body.managerOverride) {
        return res.status(400).json({ message: "No approved proposal reference. Manager override required." });
      }

      const updated = await storage.updateContractorInvoice(req.params.id, {
        status: "approved", approvedBy: req.session.userId, approvedAt: new Date(),
      });

      await storage.createExpenseApprovalAction({
        objectType: "contractor_invoice", objectId: req.params.id, actionType: "approved",
        actorUserId: req.session.userId, companyId: inv.companyId,
        previousStatus: "submitted", newStatus: "approved",
      });

      res.json(updated);
    } catch (e) { res.status(500).json({ message: "Failed to approve invoice" }); }
  });

  app.post("/api/contractor-invoices/:id/reject", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const inv = await storage.getContractorInvoice(req.params.id);
      if (!inv) return res.status(404).json({ message: "Not found" });
      if (inv.status !== "submitted") return res.status(400).json({ message: "Only submitted invoices can be rejected" });

      const updated = await storage.updateContractorInvoice(req.params.id, {
        status: "rejected", rejectedBy: req.session.userId, rejectedAt: new Date(),
        rejectionReason: req.body.reason || null,
      });

      await storage.createExpenseApprovalAction({
        objectType: "contractor_invoice", objectId: req.params.id, actionType: "rejected",
        actorUserId: req.session.userId, companyId: inv.companyId,
        previousStatus: "submitted", newStatus: "rejected",
        notes: req.body.reason,
      });

      res.json(updated);
    } catch (e) { res.status(500).json({ message: "Failed to reject invoice" }); }
  });

  app.post("/api/contractor-invoices/:id/mark-paid", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const inv = await storage.getContractorInvoice(req.params.id);
      if (!inv) return res.status(404).json({ message: "Not found" });
      if (inv.status !== "approved") return res.status(400).json({ message: "Only approved invoices can be marked paid" });

      const updated = await storage.updateContractorInvoice(req.params.id, {
        status: "paid", paidAt: new Date(), paidAmount: req.body.paidAmount || inv.amount,
        paymentReference: req.body.paymentReference, paymentMethod: req.body.paymentMethod,
      });

      await storage.createExpenseApprovalAction({
        objectType: "contractor_invoice", objectId: req.params.id, actionType: "paid",
        actorUserId: req.session.userId, companyId: inv.companyId,
        previousStatus: "approved", newStatus: "paid",
        metadataJson: JSON.stringify({ paymentReference: req.body.paymentReference }),
      });

      res.json(updated);
    } catch (e) { res.status(500).json({ message: "Failed to mark invoice paid" }); }
  });

  // ── Contractor Invoice Attachments ────────────────────────────────────
  app.get("/api/contractor-invoices/:id/attachments", requireAuth, async (req, res) => {
    try {
      const inv = await storage.getContractorInvoice(req.params.id);
      if (!inv) return res.status(404).json({ message: "Not found" });
      const user = await storage.getUser(req.session.userId!);
      const isManager = user?.role === "admin" || user?.role === "manager";
      if (!isManager && user?.workerId !== inv.contractorId) return res.status(403).json({ message: "Not authorized" });
      res.json(await storage.getContractorInvoiceAttachments(req.params.id));
    } catch (e) { res.status(500).json({ message: "Failed" }); }
  });

  app.post("/api/contractor-invoices/:id/attachments", requireAuth, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file" });
      const inv = await storage.getContractorInvoice(req.params.id);
      if (!inv) return res.status(404).json({ message: "Not found" });
      const user = await storage.getUser(req.session.userId!);
      const isManager = user?.role === "admin" || user?.role === "manager";
      if (!isManager && user?.workerId !== inv.contractorId) return res.status(403).json({ message: "Not authorized" });
      const r = await storage.createContractorInvoiceAttachment({
        invoiceId: req.params.id, filePath: `/uploads/${req.file.filename}`,
        fileName: req.file.originalname, fileType: req.file.mimetype, fileSize: req.file.size,
      });
      res.status(201).json(r);
    } catch (e) { res.status(500).json({ message: "Failed" }); }
  });

  app.get("/api/contractor-invoices/:id/audit", requireAuth, async (req, res) => {
    try { res.json(await storage.getExpenseApprovalActions("contractor_invoice", req.params.id)); }
    catch (e) { res.status(500).json({ message: "Failed" }); }
  });

  // ── Recurring Expense Templates ───────────────────────────────────────
  app.get("/api/recurring-expenses", requireAuth, async (req, res) => {
    try { res.json(await storage.getRecurringExpenseTemplates(req.query.companyId as string)); }
    catch (e) { res.status(500).json({ message: "Failed" }); }
  });

  app.post("/api/recurring-expenses", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.status(403).json({ message: "No linked worker" });
      req.body.submitterId = user.workerId;
      res.status(201).json(await storage.createRecurringExpenseTemplate(req.body));
    } catch (e) { res.status(500).json({ message: "Failed" }); }
  });

  app.patch("/api/recurring-expenses/:id", requireAuth, async (req, res) => {
    try {
      const r = await storage.updateRecurringExpenseTemplate(req.params.id, req.body);
      if (!r) return res.status(404).json({ message: "Not found" });
      res.json(r);
    } catch (e) { res.status(500).json({ message: "Failed" }); }
  });

  // ── Payroll Reimbursement Items ───────────────────────────────────────
  app.get("/api/payroll-reimbursements", requireAuth, async (req, res) => {
    try {
      const { workerId, payrollRunId, status } = req.query as Record<string, string>;
      const user = await storage.getUser(req.session.userId!);
      const isManager = user?.role === "admin" || user?.role === "manager";
      if (isManager) {
        res.json(await storage.getPayrollReimbursementItems(workerId, payrollRunId, status));
      } else {
        res.json(await storage.getPayrollReimbursementItems(user?.workerId || "none", payrollRunId, status));
      }
    } catch (e) { res.status(500).json({ message: "Failed" }); }
  });

  app.patch("/api/payroll-reimbursements/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const r = await storage.updatePayrollReimbursementItem(req.params.id, req.body);
      if (!r) return res.status(404).json({ message: "Not found" });
      res.json(r);
    } catch (e) { res.status(500).json({ message: "Failed" }); }
  });

  // ── Accounting Export ─────────────────────────────────────────────────
  app.get("/api/expenses/export/csv", requireAuth, requireRole("admin", "manager"), requireActiveSubscription, async (req, res) => {
    try {
      const allExpenses = await storage.getExpenses(req.query.companyId as string);
      const allWorkers = await storage.getWorkers();
      const allCompanies = await storage.getCompanies();

      const rows = allExpenses.map(e => {
        const w = allWorkers.find(w => w.id === e.submitterId);
        const c = allCompanies.find(c => c.id === e.companyId);
        return [
          c?.legalName || c?.name || "", c?.name || "", e.expenseDate, e.categoryName || "",
          e.vendor || "", e.amount, e.jobId || "", e.costCenterId || "",
          w ? `${w.firstName} ${w.lastName}` : "", e.reimbursementRequested ? "Reimbursement" : "Company",
          e.status, "", "", e.id,
        ].join(",");
      });

      const csv = "Legal Entity,Company,Date,Category,Vendor,Amount,Job,Cost Center,Employee,Type,Status,Accounting Code,Reference,ID\n" + rows.join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="expenses-export-${new Date().toISOString().split("T")[0]}.csv"`);
      res.send(csv);
    } catch (e) { res.status(500).json({ message: "Failed to export" }); }
  });

  app.get("/api/contractor-invoices/export/csv", requireAuth, requireRole("admin", "manager"), requireActiveSubscription, async (req, res) => {
    try {
      const allInvs = await storage.getContractorInvoices(req.query.companyId as string);
      const allWorkers = await storage.getWorkers();
      const allCompanies = await storage.getCompanies();

      const rows = allInvs.map(inv => {
        const w = allWorkers.find(w => w.id === inv.contractorId);
        const c = allCompanies.find(c => c.id === inv.companyId);
        return [
          c?.legalName || c?.name || "", c?.name || "", inv.invoiceDate, inv.invoiceNumber || "",
          w ? `${w.firstName} ${w.lastName}` : "", inv.amount, inv.jobId || "", inv.costCenterId || "",
          inv.status, inv.is1099Reportable ? "Yes" : "No", inv.paymentReference || "", inv.id,
        ].join(",");
      });

      const csv = "Legal Entity,Company,Date,Invoice #,Contractor,Amount,Job,Cost Center,Status,1099 Reportable,Payment Ref,ID\n" + rows.join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="invoices-export-${new Date().toISOString().split("T")[0]}.csv"`);
      res.send(csv);
    } catch (e) { res.status(500).json({ message: "Failed to export" }); }
  });

  app.get("/api/shift-offers", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.query as Record<string, string>;
      const items = await storage.getShiftOffers(companyId);
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch shift offers" });
    }
  });

  app.post("/api/shift-offers", requireAuth, async (req, res) => {
    try {
      const parsed = insertShiftOfferSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });

      const schedule = (await storage.getSchedules()).find(s => s.id === parsed.data.scheduleId);
      if (!schedule) return res.status(404).json({ message: "Schedule not found" });
      const callerUser = await storage.getUser(req.session.userId!);
      const isAdminOrManager = callerUser?.role === "admin" || callerUser?.role === "manager";
      const isOwnShift = callerUser?.workerId === parsed.data.offeredByWorkerId;
      if (!isOwnShift && !isAdminOrManager) return res.status(403).json({ message: "Not authorized to offer this shift" });
      if (schedule.workerId !== parsed.data.offeredByWorkerId) return res.status(400).json({ message: "Schedule does not belong to this worker" });

      const item = await storage.createShiftOffer(parsed.data);

      try {
        const { sendShiftMarketplaceEmail, sendShiftMarketplaceSms } = await import("./notifications.js");
        const offeringWorker = await storage.getWorker(item.offeredByWorkerId);
        const offeringName = offeringWorker ? `${offeringWorker.firstName} ${offeringWorker.lastName}` : "An employee";
        const shiftDate = schedule?.date || "unknown date";
        const shiftTime = schedule ? `${schedule.startTime}–${schedule.endTime}` : "";
        const companyId = offeringWorker?.companyId;
        if (companyId) {
          const allWorkers = await storage.getWorkers();
          const eligibleWorkers = allWorkers.filter(w =>
            w.companyId === companyId && w.id !== item.offeredByWorkerId && w.isActive && w.workerType === "employee"
          );
          const subject = "New Shift Available on Marketplace";
          const bodyText = `${offeringName} has posted their shift on ${shiftDate} ${shiftTime} to the Shift Marketplace.\n\nLog in to PayLink and go to Schedule → Shift Marketplace to claim this shift.`;
          for (const w of eligibleWorkers) {
            const wEmail = w.workEmail || w.homeEmail || w.email;
            const wPhone = w.mobilePhone || w.homePhone;
            const wName = `${w.firstName} ${w.lastName}`;
            await Promise.all([
              sendShiftMarketplaceEmail({ recipientName: wName, email: wEmail, subject, bodyText }),
              sendShiftMarketplaceSms({ recipientName: wName, phone: wPhone, subject, bodyText: `PayLink: ${offeringName} posted a shift on ${shiftDate} ${shiftTime}. Log in to claim it!` }),
            ]);
          }
        }
      } catch (notifErr) {
        console.error("[Shift Offer] Notification error (non-fatal):", (notifErr as Error).message);
      }

      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create shift offer" });
    }
  });

  app.patch("/api/shift-offers/:id", requireAuth, async (req, res) => {
    try {
      const { sendShiftMarketplaceEmail, sendShiftMarketplaceSms } = await import("./notifications.js");
      const prevOffer = await storage.getShiftOffer(req.params.id as string);
      const item = await storage.updateShiftOffer(req.params.id as string, req.body);
      if (!item) return res.status(404).json({ message: "Shift offer not found" });

      const newStatus = req.body.status;

      if (newStatus === "claimed" && prevOffer && prevOffer.status !== "claimed") {
        // Notify all managers/admins for the company about this claim request
        const schedule = (await storage.getSchedules()).find(s => s.id === item.scheduleId);
        const offeringWorker = await storage.getWorker(item.offeredByWorkerId);
        const claimingWorker = item.claimedByWorkerId ? await storage.getWorker(item.claimedByWorkerId) : null;
        const allUsers = await storage.getUsers();
        const managers = allUsers.filter(u => (u.role === "admin" || u.role === "manager") &&
          (!u.companyId || u.companyId === offeringWorker?.companyId));
        const offeringName = offeringWorker ? `${offeringWorker.firstName} ${offeringWorker.lastName}` : "An employee";
        const claimingName = claimingWorker ? `${claimingWorker.firstName} ${claimingWorker.lastName}` : "Another employee";
        const shiftDate = schedule?.date || "unknown date";
        const shiftTime = schedule ? `${schedule.startTime}–${schedule.endTime}` : "";
        for (const mgr of managers) {
          const mgrWorker = mgr.workerId ? await storage.getWorker(mgr.workerId) : null;
          const mgrEmail = mgrWorker?.workEmail || mgrWorker?.homeEmail || null;
          const mgrPhone = mgrWorker?.mobilePhone || mgrWorker?.homePhone || null;
          const mgrName = mgrWorker ? `${mgrWorker.firstName} ${mgrWorker.lastName}` : mgr.username;
          const subject = `Shift Exchange Request — Approval Needed`;
          const bodyText = `${claimingName} would like to pick up a shift offered by ${offeringName}.\n\nShift: ${shiftDate} ${shiftTime}\n\nPlease log in to PayLink and go to Schedule → Shift Marketplace to approve or reject this request.`;
          await Promise.all([
            sendShiftMarketplaceEmail({ recipientName: mgrName, email: mgrEmail, subject, bodyText }),
            sendShiftMarketplaceSms({ recipientName: mgrName, phone: mgrPhone, subject, bodyText: `PayLink: ${claimingName} wants to pick up ${offeringName}'s shift on ${shiftDate} ${shiftTime}. Please log in to approve or reject.` }),
          ]);
        }
      }

      if (newStatus === "approved" && prevOffer && prevOffer.status !== "approved") {
        // Reassign the schedule to the claiming worker
        const schedule = (await storage.getSchedules()).find(s => s.id === item.scheduleId);
        if (schedule && item.claimedByWorkerId) {
          await storage.updateSchedule(schedule.id, { workerId: item.claimedByWorkerId });
        }
        // Notify both workers
        const offeringWorker = await storage.getWorker(item.offeredByWorkerId);
        const claimingWorker = item.claimedByWorkerId ? await storage.getWorker(item.claimedByWorkerId) : null;
        const shiftDate = schedule?.date || "unknown date";
        const shiftTime = schedule ? `${schedule.startTime}–${schedule.endTime}` : "";
        const note = item.notes ? `\n\nManager note: ${item.notes}` : "";
        if (offeringWorker) {
          const name = `${offeringWorker.firstName} ${offeringWorker.lastName}`;
          const email = offeringWorker.workEmail || offeringWorker.homeEmail;
          const phone = offeringWorker.mobilePhone || offeringWorker.homePhone;
          const bodyText = `Your shift on ${shiftDate} ${shiftTime} has been approved to be taken by ${claimingWorker ? `${claimingWorker.firstName} ${claimingWorker.lastName}` : "another employee"}. You are no longer scheduled for that shift.${note}`;
          await Promise.all([
            sendShiftMarketplaceEmail({ recipientName: name, email, subject: "Shift Exchange Approved", bodyText }),
            sendShiftMarketplaceSms({ recipientName: name, phone, subject: "Shift Exchange Approved", bodyText: `PayLink: Your shift on ${shiftDate} ${shiftTime} has been approved for exchange.${note}` }),
          ]);
        }
        if (claimingWorker) {
          const name = `${claimingWorker.firstName} ${claimingWorker.lastName}`;
          const email = claimingWorker.workEmail || claimingWorker.homeEmail;
          const phone = claimingWorker.mobilePhone || claimingWorker.homePhone;
          const bodyText = `Your request to pick up the shift on ${shiftDate} ${shiftTime} has been approved! This shift is now on your schedule.${note}`;
          await Promise.all([
            sendShiftMarketplaceEmail({ recipientName: name, email, subject: "Shift Exchange Approved", bodyText }),
            sendShiftMarketplaceSms({ recipientName: name, phone, subject: "Shift Exchange Approved", bodyText: `PayLink: Your request to pick up the shift on ${shiftDate} ${shiftTime} has been approved!${note}` }),
          ]);
        }
      }

      if (newStatus === "rejected" && prevOffer && prevOffer.status !== "rejected") {
        const schedule = (await storage.getSchedules()).find(s => s.id === item.scheduleId);
        const offeringWorker = await storage.getWorker(item.offeredByWorkerId);
        const claimingWorker = item.claimedByWorkerId ? await storage.getWorker(item.claimedByWorkerId) : null;
        const shiftDate = schedule?.date || "unknown date";
        const shiftTime = schedule ? `${schedule.startTime}–${schedule.endTime}` : "";
        const managerNote = req.body.managerNote ? `\n\nManager note: ${req.body.managerNote}` : "";
        // Notify offering worker — their shift stays with them
        if (offeringWorker) {
          const name = `${offeringWorker.firstName} ${offeringWorker.lastName}`;
          const email = offeringWorker.workEmail || offeringWorker.homeEmail;
          const phone = offeringWorker.mobilePhone || offeringWorker.homePhone;
          const bodyText = `Your shift exchange request for ${shiftDate} ${shiftTime} was not approved. Your shift remains on your schedule.${managerNote}`;
          await Promise.all([
            sendShiftMarketplaceEmail({ recipientName: name, email, subject: "Shift Exchange Not Approved", bodyText }),
            sendShiftMarketplaceSms({ recipientName: name, phone, subject: "Shift Exchange Not Approved", bodyText: `PayLink: Your shift exchange for ${shiftDate} ${shiftTime} was not approved. Your shift remains on your schedule.${managerNote}` }),
          ]);
        }
        // Notify claiming worker — they did not get the shift
        if (claimingWorker) {
          const name = `${claimingWorker.firstName} ${claimingWorker.lastName}`;
          const email = claimingWorker.workEmail || claimingWorker.homeEmail;
          const phone = claimingWorker.mobilePhone || claimingWorker.homePhone;
          const bodyText = `Your request to pick up the shift on ${shiftDate} ${shiftTime} was not approved.${managerNote}`;
          await Promise.all([
            sendShiftMarketplaceEmail({ recipientName: name, email, subject: "Shift Exchange Not Approved", bodyText }),
            sendShiftMarketplaceSms({ recipientName: name, phone, subject: "Shift Exchange Not Approved", bodyText: `PayLink: Your request to pick up the shift on ${shiftDate} ${shiftTime} was not approved.${managerNote}` }),
          ]);
        }
      }

      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update shift offer" });
    }
  });

  app.delete("/api/shift-offers/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteShiftOffer(req.params.id as string);
      res.json({ message: "Shift offer deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete shift offer" });
    }
  });

  app.patch("/api/payroll-items/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const item = await storage.updatePayrollItem(req.params.id as string, req.body);
      if (!item) return res.status(404).json({ message: "Payroll item not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update payroll item" });
    }
  });

  app.get("/api/secondary-wage-groups", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const items = await storage.getSecondaryWageGroups(companyId);
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch secondary wage groups" });
    }
  });
  app.post("/api/secondary-wage-groups", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.description === "") data.description = null;
      if (data.hourlyRate === "") data.hourlyRate = "0";
      if (data.overtimeRate === "") data.overtimeRate = "0";
      const parsed = insertSecondaryWageGroupSchema.parse(data);
      const item = await storage.createSecondaryWageGroup(parsed);
      res.status(201).json(item);
    } catch (error: any) {
      if (error.name === "ZodError") return res.status(400).json({ message: "Validation failed", errors: error.errors });
      console.error(error);
      res.status(500).json({ message: "Failed to create secondary wage group" });
    }
  });
  app.patch("/api/secondary-wage-groups/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.description === "") data.description = null;
      if (data.hourlyRate === "") data.hourlyRate = "0";
      if (data.overtimeRate === "") data.overtimeRate = "0";
      const item = await storage.updateSecondaryWageGroup(req.params.id as string, data);
      if (!item) return res.status(404).json({ message: "Secondary wage group not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update secondary wage group" });
    }
  });
  app.delete("/api/secondary-wage-groups/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteSecondaryWageGroup(req.params.id as string);
      res.json({ message: "Secondary wage group deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete secondary wage group" });
    }
  });

  app.get("/api/employee-wage-groups", async (req, res) => {
    try {
      const workerId = req.query.workerId as string | undefined;
      const items = await storage.getEmployeeWageGroups(workerId);
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch employee wage groups" });
    }
  });
  app.post("/api/employee-wage-groups", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { workerId, wageGroupId } = req.body;
      if (!workerId || !wageGroupId) {
        return res.status(400).json({ message: "workerId and wageGroupId are required" });
      }
      const existing = await storage.getEmployeeWageGroups(workerId);
      if (existing.some(e => e.wageGroupId === wageGroupId)) {
        return res.status(409).json({ message: "This wage group is already assigned to this employee" });
      }
      const item = await storage.createEmployeeWageGroup(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to assign wage group" });
    }
  });
  app.delete("/api/employee-wage-groups/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteEmployeeWageGroup(req.params.id as string);
      res.json({ message: "Wage group assignment removed" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to remove wage group assignment" });
    }
  });

  app.get("/api/currencies", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const items = await storage.getCurrencies(companyId);
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch currencies" });
    }
  });
  app.post("/api/currencies", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.exchangeRate === "") data.exchangeRate = "1";
      if (data.companyId === "") data.companyId = null;
      const parsed = insertCurrencySchema.parse(data);
      const item = await storage.createCurrency(parsed);
      res.status(201).json(item);
    } catch (error: any) {
      if (error.name === "ZodError") return res.status(400).json({ message: "Validation failed", errors: error.errors });
      console.error(error);
      res.status(500).json({ message: "Failed to create currency" });
    }
  });
  app.patch("/api/currencies/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.exchangeRate === "") data.exchangeRate = "1";
      if (data.companyId === "") data.companyId = null;
      const item = await storage.updateCurrency(req.params.id as string, data);
      if (!item) return res.status(404).json({ message: "Currency not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update currency" });
    }
  });
  app.delete("/api/currencies/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteCurrency(req.params.id as string);
      res.json({ message: "Currency deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete currency" });
    }
  });

  app.post("/api/import/:type", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { type } = req.params;
      const { records } = req.body;
      if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ message: "No records provided" });
      }
      let imported = 0;
      const errors: string[] = [];
      for (let i = 0; i < records.length; i++) {
        try {
          if (type === "workers") {
            await storage.createWorker(records[i]);
          } else if (type === "departments") {
            await storage.createDepartment(records[i]);
          } else if (type === "jobs") {
            await storage.createJob(records[i]);
          } else {
            return res.status(400).json({ message: `Unsupported import type: ${type}` });
          }
          imported++;
        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }
      res.json({ imported, errors, total: records.length });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Import failed" });
    }
  });

  // Recurring Schedules
  app.get("/api/recurring-schedules", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const schedules = await storage.getRecurringSchedules(companyId);
      res.json(schedules);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch recurring schedules" });
    }
  });

  app.post("/api/recurring-schedules", async (req, res) => {
    try {
      const schedule = await storage.createRecurringSchedule(req.body);
      res.status(201).json(schedule);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create recurring schedule" });
    }
  });

  app.patch("/api/recurring-schedules/:id", async (req, res) => {
    try {
      const schedule = await storage.updateRecurringSchedule(req.params.id, req.body);
      if (!schedule) {
        return res.status(404).json({ message: "Recurring schedule not found" });
      }
      res.json(schedule);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update recurring schedule" });
    }
  });

  app.delete("/api/recurring-schedules/:id", async (req, res) => {
    try {
      await storage.deleteRecurringSchedule(req.params.id);
      res.json({ message: "Recurring schedule deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete recurring schedule" });
    }
  });

  app.get("/api/remittance-sources", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const sources = await storage.getRemittanceSources(companyId);
      res.json(sources);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch remittance sources" });
    }
  });

  app.post("/api/remittance-sources", async (req, res) => {
    try {
      const source = await storage.createRemittanceSource(req.body);
      res.status(201).json(source);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create remittance source" });
    }
  });

  app.patch("/api/remittance-sources/:id", async (req, res) => {
    try {
      const source = await storage.updateRemittanceSource(req.params.id, req.body);
      if (!source) return res.status(404).json({ message: "Not found" });
      res.json(source);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update remittance source" });
    }
  });

  app.delete("/api/remittance-sources/:id", async (req, res) => {
    try {
      await storage.deleteRemittanceSource(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete remittance source" });
    }
  });

  app.get("/api/remittance-agencies", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const agencies = await storage.getRemittanceAgencies(companyId);
      res.json(agencies);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch remittance agencies" });
    }
  });

  app.post("/api/remittance-agencies", async (req, res) => {
    try {
      const agency = await storage.createRemittanceAgency(req.body);
      res.status(201).json(agency);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create remittance agency" });
    }
  });

  app.patch("/api/remittance-agencies/:id", async (req, res) => {
    try {
      const agency = await storage.updateRemittanceAgency(req.params.id, req.body);
      if (!agency) return res.status(404).json({ message: "Not found" });
      res.json(agency);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update remittance agency" });
    }
  });

  app.delete("/api/remittance-agencies/:id", async (req, res) => {
    try {
      await storage.deleteRemittanceAgency(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete remittance agency" });
    }
  });

  app.get("/api/remittance-agency-events", async (req, res) => {
    try {
      const agencyId = req.query.agencyId as string;
      if (!agencyId) return res.status(400).json({ message: "agencyId required" });
      const events = await storage.getRemittanceAgencyEvents(agencyId);
      res.json(events);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });

  app.post("/api/remittance-agency-events", async (req, res) => {
    try {
      const event = await storage.createRemittanceAgencyEvent(req.body);
      res.status(201).json(event);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create event" });
    }
  });

  app.patch("/api/remittance-agency-events/:id", async (req, res) => {
    try {
      const event = await storage.updateRemittanceAgencyEvent(req.params.id, req.body);
      if (!event) return res.status(404).json({ message: "Not found" });
      res.json(event);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update event" });
    }
  });

  app.delete("/api/remittance-agency-events/:id", async (req, res) => {
    try {
      await storage.deleteRemittanceAgencyEvent(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete event" });
    }
  });

  app.post("/api/remittance-sources/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getRemittanceSources(companyId);
      const existingNames = new Set(existing.map(e => e.name));
      const sources = [
        { companyId, name: "Company Checking Account", status: "enabled", type: "check", country: "US", currency: "USD" },
      ];
      const created = [];
      const skipped = [];
      for (const item of sources) {
        if (existingNames.has(item.name)) { skipped.push(item.name); continue; }
        const result = await storage.createRemittanceSource(item as any);
        created.push(result);
      }
      res.json({ message: `Created ${created.length} source(s)${skipped.length ? `, skipped ${skipped.length} existing` : ""}`, count: created.length, skipped: skipped.length, items: created });
    } catch (error: any) {
      console.error("Remittance source setup error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to set up remittance sources") });
    }
  });

  app.post("/api/remittance-agencies/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getRemittanceAgencies(companyId);
      const existingNames = new Set(existing.map(e => e.name));
      const sources = await storage.getRemittanceSources(companyId);
      const defaultSourceId = sources.length > 0 ? sources[0].id : null;
      const agencies = [
        { companyId, name: "Internal Revenue Service (IRS)", status: "enabled", type: "federal", country: "US", agency: "IRS", remittanceSourceId: defaultSourceId },
        { companyId, name: "California Employment Development Department (EDD)", status: "enabled", type: "state", country: "US", provinceState: "CA", agency: "EDD", remittanceSourceId: defaultSourceId },
      ];
      const created = [];
      const skipped = [];
      for (const item of agencies) {
        if (existingNames.has(item.name)) { skipped.push(item.name); continue; }
        const result = await storage.createRemittanceAgency(item as any);
        created.push(result);
      }
      res.json({ message: `Created ${created.length} agency(ies)${skipped.length ? `, skipped ${skipped.length} existing` : ""}`, count: created.length, skipped: skipped.length });
    } catch (error: any) {
      console.error("Remittance agency setup error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to set up remittance agencies") });
    }
  });

  app.get("/api/worker-documents", requireAuth, async (req, res) => {
    try {
      const workerId = req.query.workerId as string;
      if (!workerId) return res.status(400).json({ message: "workerId required" });
      const docs = await storage.getWorkerDocuments(workerId);
      res.json(docs);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  app.post("/api/worker-documents", requireAuth, documentUpload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const fileUrl = `/uploads/${req.file.filename}`;
      const { workerId, name, documentType, notes } = req.body;
      if (!workerId || !name) return res.status(400).json({ message: "workerId and name required" });
      const worker = await storage.getWorker(workerId);
      if (!worker) return res.status(404).json({ message: "Worker not found" });
      const doc = await storage.createWorkerDocument({ workerId, name, documentType: documentType || "other", fileUrl, notes: notes || null });
      res.status(201).json(doc);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  app.delete("/api/worker-documents/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteWorkerDocument(req.params.id as string);
      res.json({ message: "Document deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  app.get("/api/saved-reports", requireAuth, async (req, res) => {
    try {
      const reports = await storage.getSavedReports();
      res.json(reports);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch saved reports" });
    }
  });

  app.get("/api/saved-reports/:id", requireAuth, async (req, res) => {
    try {
      const report = await storage.getSavedReport(req.params.id as string);
      if (!report) return res.status(404).json({ message: "Report not found" });
      res.json(report);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch saved report" });
    }
  });

  app.post("/api/saved-reports", requireAuth, async (req, res) => {
    try {
      const { name, reportType, category, companyId, filters, data, headers, rowCount } = req.body;
      if (!name || !reportType || !category) {
        return res.status(400).json({ message: "Name, reportType, and category are required" });
      }
      const report = await storage.createSavedReport({
        name,
        reportType,
        category,
        companyId: companyId || null,
        filters: filters || null,
        data: typeof data === "string" ? data : JSON.stringify(data),
        headers: typeof headers === "string" ? headers : JSON.stringify(headers),
        rowCount: rowCount || 0,
        createdBy: req.session?.username || "unknown",
      });
      res.json(report);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to save report" });
    }
  });

  app.delete("/api/saved-reports/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteSavedReport(req.params.id as string);
      res.json({ message: "Report deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete report" });
    }
  });

  app.get("/api/pay-stub-accounts", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const accounts = await storage.getPayStubAccounts(companyId);
      res.json(accounts);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch pay stub accounts" });
    }
  });

  app.post("/api/pay-stub-accounts", async (req, res) => {
    try {
      const account = await storage.createPayStubAccount(req.body);
      res.status(201).json(account);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create pay stub account" });
    }
  });

  app.patch("/api/pay-stub-accounts/:id", async (req, res) => {
    try {
      const account = await storage.updatePayStubAccount(req.params.id, req.body);
      if (!account) return res.status(404).json({ message: "Not found" });
      res.json(account);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update pay stub account" });
    }
  });

  app.delete("/api/pay-stub-accounts/:id", async (req, res) => {
    try {
      await storage.deletePayStubAccount(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete pay stub account" });
    }
  });

  app.post("/api/pay-stub-accounts/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId, legalEntityId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getPayStubAccounts(companyId);
      const existingNames = new Set(existing.map(e => e.name));
      const standardAccounts = [
        { companyId, legalEntityId: legalEntityId || null, name: "Regular Wages", type: "earning", displayOrder: 1, status: "enabled" },
        { companyId, legalEntityId: legalEntityId || null, name: "Overtime", type: "earning", displayOrder: 2, status: "enabled" },
        { companyId, legalEntityId: legalEntityId || null, name: "Vacation", type: "earning", displayOrder: 3, status: "enabled" },
        { companyId, legalEntityId: legalEntityId || null, name: "Federal Income Tax", type: "tax", displayOrder: 10, status: "enabled" },
        { companyId, legalEntityId: legalEntityId || null, name: "Social Security", type: "tax", displayOrder: 11, status: "enabled" },
        { companyId, legalEntityId: legalEntityId || null, name: "Medicare", type: "tax", displayOrder: 12, status: "enabled" },
        { companyId, legalEntityId: legalEntityId || null, name: "CA Personal Income Tax", type: "tax", displayOrder: 13, status: "enabled" },
        { companyId, legalEntityId: legalEntityId || null, name: "CA State Disability Insurance", type: "tax", displayOrder: 14, status: "enabled" },
        { companyId, legalEntityId: legalEntityId || null, name: "Health Insurance", type: "deduction", displayOrder: 20, status: "enabled" },
        { companyId, legalEntityId: legalEntityId || null, name: "401k", type: "deduction", displayOrder: 21, status: "enabled" },
        { companyId, legalEntityId: legalEntityId || null, name: "Employer Social Security", type: "employer_contribution", displayOrder: 30, status: "enabled" },
        { companyId, legalEntityId: legalEntityId || null, name: "Employer Medicare", type: "employer_contribution", displayOrder: 31, status: "enabled" },
        { companyId, legalEntityId: legalEntityId || null, name: "FUTA", type: "employer_contribution", displayOrder: 32, status: "enabled" },
        { companyId, legalEntityId: legalEntityId || null, name: "CA Unemployment Insurance (SUI)", type: "employer_contribution", displayOrder: 33, status: "enabled" },
        { companyId, legalEntityId: legalEntityId || null, name: "CA Employment Training Tax (ETT)", type: "employer_contribution", displayOrder: 34, status: "enabled" },
        { companyId, legalEntityId: legalEntityId || null, name: "Employee Social Security (12.4%)", type: "employee_contribution", displayOrder: 40, status: "enabled" },
        { companyId, legalEntityId: legalEntityId || null, name: "Employee Medicare (2.9%)", type: "employee_contribution", displayOrder: 41, status: "enabled" },
      ];
      const created = [];
      const skipped = [];
      for (const item of standardAccounts) {
        if (existingNames.has(item.name)) {
          skipped.push(item.name);
          continue;
        }
        const result = await storage.createPayStubAccount(item as any);
        created.push(result);
      }
      res.json({ message: `Created ${created.length} accounts${skipped.length ? `, skipped ${skipped.length} existing` : ""}`, count: created.length, skipped: skipped.length });
    } catch (error: any) {
      console.error("Pay stub account setup error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to set up pay stub accounts") });
    }
  });

  app.get("/api/pay-stub-amendments", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const amendments = await storage.getPayStubAmendments(companyId);
      res.json(amendments);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch pay stub amendments" });
    }
  });

  app.post("/api/pay-stub-amendments", async (req, res) => {
    try {
      const body = { ...req.body };
      // Auto-fill companyId from the worker if not provided
      if ((!body.companyId || body.companyId === "") && body.workerId) {
        const w = await storage.getWorker(body.workerId);
        if (w) body.companyId = w.companyId;
      }
      if (!body.companyId || body.companyId === "") {
        return res.status(400).json({ message: "companyId is required (or select a valid worker)" });
      }
      const amendment = await storage.createPayStubAmendment(body);
      res.status(201).json(amendment);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create pay stub amendment" });
    }
  });

  app.patch("/api/pay-stub-amendments/:id", async (req, res) => {
    try {
      const body = { ...req.body };
      // Auto-fill companyId from the worker if not provided
      if ((!body.companyId || body.companyId === "") && body.workerId) {
        const w = await storage.getWorker(body.workerId);
        if (w) body.companyId = w.companyId;
      }
      const amendment = await storage.updatePayStubAmendment(req.params.id, body);
      if (!amendment) return res.status(404).json({ message: "Not found" });
      res.json(amendment);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update pay stub amendment" });
    }
  });

  app.delete("/api/pay-stub-amendments/:id", async (req, res) => {
    try {
      await storage.deletePayStubAmendment(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete pay stub amendment" });
    }
  });

  app.get("/api/pay-stub-transactions", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const transactions = await storage.getPayStubTransactions(companyId);
      res.json(transactions);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch pay stub transactions" });
    }
  });

  app.post("/api/pay-stub-transactions", async (req, res) => {
    try {
      const transaction = await storage.createPayStubTransaction(req.body);
      res.status(201).json(transaction);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create pay stub transaction" });
    }
  });

  app.patch("/api/pay-stub-transactions/:id", async (req, res) => {
    try {
      const transaction = await storage.updatePayStubTransaction(req.params.id, req.body);
      if (!transaction) return res.status(404).json({ message: "Not found" });
      res.json(transaction);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update pay stub transaction" });
    }
  });

  app.get("/api/pay-period-schedules", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const schedules = await storage.getPayPeriodSchedules(companyId);
      res.json(schedules);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch pay period schedules" });
    }
  });

  app.post("/api/pay-period-schedules", async (req, res) => {
    try {
      const schedule = await storage.createPayPeriodSchedule(req.body);
      res.status(201).json(schedule);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create pay period schedule" });
    }
  });

  app.patch("/api/pay-period-schedules/:id", async (req, res) => {
    try {
      const schedule = await storage.updatePayPeriodSchedule(req.params.id, req.body);
      if (!schedule) return res.status(404).json({ message: "Not found" });
      res.json(schedule);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update pay period schedule" });
    }
  });

  app.delete("/api/pay-period-schedules/:id", async (req, res) => {
    try {
      await storage.deletePayPeriodSchedule(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete pay period schedule" });
    }
  });

  // Employee Titles
  app.get("/api/employee-titles", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const titles = await storage.getEmployeeTitles(companyId);
      res.json(titles);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch employee titles" });
    }
  });

  app.post("/api/employee-titles", async (req, res) => {
    try {
      const data = { ...req.body };
      if (!data.companyId || data.companyId === "__universal__") data.companyId = null;
      const title = await storage.createEmployeeTitle(data);
      res.status(201).json(title);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create employee title" });
    }
  });

  app.patch("/api/employee-titles/:id", async (req, res) => {
    try {
      const data = { ...req.body };
      if (!data.companyId || data.companyId === "__universal__") data.companyId = null;
      const title = await storage.updateEmployeeTitle(req.params.id, data);
      if (!title) return res.status(404).json({ message: "Not found" });
      res.json(title);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update employee title" });
    }
  });

  app.delete("/api/employee-titles/:id", async (req, res) => {
    try {
      await storage.deleteEmployeeTitle(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete employee title" });
    }
  });

  // Employee Groups
  app.get("/api/employee-groups", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const groups = await storage.getEmployeeGroups(companyId);
      res.json(groups);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch employee groups" });
    }
  });

  app.post("/api/employee-groups", async (req, res) => {
    try {
      const group = await storage.createEmployeeGroup(req.body);
      res.status(201).json(group);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create employee group" });
    }
  });

  app.patch("/api/employee-groups/:id", async (req, res) => {
    try {
      const group = await storage.updateEmployeeGroup(req.params.id, req.body);
      if (!group) return res.status(404).json({ message: "Not found" });
      res.json(group);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update employee group" });
    }
  });

  app.delete("/api/employee-groups/:id", async (req, res) => {
    try {
      await storage.deleteEmployeeGroup(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete employee group" });
    }
  });

  app.get("/api/employee-group-configs", async (req, res) => {
    try {
      const configs = await storage.getEmployeeGroupConfigs();
      res.json(configs);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch employee group configs" });
    }
  });

  // Wage History
  app.get("/api/wage-history", async (req, res) => {
    try {
      const workerId = req.query.workerId as string | undefined;
      const entries = await storage.getWageHistory(workerId);
      res.json(entries);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch wage history" });
    }
  });

  app.post("/api/wage-history", async (req, res) => {
    try {
      const entry = await storage.createWageHistory(req.body);
      res.status(201).json(entry);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create wage history entry" });
    }
  });

  app.patch("/api/wage-history/:id", async (req, res) => {
    try {
      const entry = await storage.updateWageHistory(req.params.id, req.body);
      if (!entry) return res.status(404).json({ message: "Not found" });
      res.json(entry);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update wage history entry" });
    }
  });

  app.delete("/api/wage-history/:id", async (req, res) => {
    try {
      await storage.deleteWageHistory(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete wage history entry" });
    }
  });

  // New Hire Defaults
  app.get("/api/new-hire-defaults", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const defaults = await storage.getNewHireDefaults(companyId);
      res.json(defaults);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch new hire defaults" });
    }
  });

  app.post("/api/new-hire-defaults", async (req, res) => {
    try {
      const entry = await storage.createNewHireDefault(req.body);
      res.status(201).json(entry);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create new hire default" });
    }
  });

  app.patch("/api/new-hire-defaults/:id", async (req, res) => {
    try {
      const entry = await storage.updateNewHireDefault(req.params.id, req.body);
      if (!entry) return res.status(404).json({ message: "Not found" });
      res.json(entry);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update new hire default" });
    }
  });

  app.delete("/api/new-hire-defaults/:id", async (req, res) => {
    try {
      await storage.deleteNewHireDefault(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete new hire default" });
    }
  });

  // Pay Formulas
  app.get("/api/pay-formulas", async (_req, res) => {
    try {
      const items = await storage.getPayFormulas();
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch pay formulas" });
    }
  });

  app.post("/api/pay-formulas", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.createPayFormula(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create pay formula" });
    }
  });

  app.patch("/api/pay-formulas/:id", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.updatePayFormula(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update pay formula" });
    }
  });

  app.delete("/api/pay-formulas/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deletePayFormula(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete pay formula" });
    }
  });

  app.post("/api/pay-formulas/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getPayFormulas();
      const companyFormulas = existing.filter(f => f.companyId === companyId);
      const existingNames = new Set(companyFormulas.map(e => e.name));
      const defaultFormulas = [
        { companyId, name: "Regular Pay", payType: "pay_multiplied_by_factor", wageSourceType: "hourly_rate", accrualRate: "1.0" },
        { companyId, name: "Overtime Pay (1.5x)", payType: "pay_multiplied_by_factor", wageSourceType: "hourly_rate", accrualRate: "1.5" },
        { companyId, name: "Double Time Pay (2x)", payType: "pay_multiplied_by_factor", wageSourceType: "hourly_rate", accrualRate: "2.0" },
        { companyId, name: "Vacation Pay", payType: "pay_multiplied_by_factor", wageSourceType: "hourly_rate", accrualRate: "1.0" },
        { companyId, name: "Sick Leave Pay", payType: "pay_multiplied_by_factor", wageSourceType: "hourly_rate", accrualRate: "1.0" },
        { companyId, name: "Holiday Pay", payType: "pay_multiplied_by_factor", wageSourceType: "hourly_rate", accrualRate: "1.0" },
        { companyId, name: "Salary Pay", payType: "pay_multiplied_by_factor", wageSourceType: "annual_salary", accrualRate: "1.0" },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const formula of defaultFormulas) {
        if (existingNames.has(formula.name)) { skipped.push(formula.name); continue; }
        const result = await storage.createPayFormula(formula as any);
        created.push(result);
      }
      res.json({ message: `Created ${created.length} pay formulas${skipped.length ? `, skipped ${skipped.length} existing` : ""}`, count: created.length, skipped: skipped.length });
    } catch (error: any) {
      console.error("Pay formula setup error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to set up pay formulas") });
    }
  });

  // Contributing Pay Codes
  app.get("/api/contributing-pay-codes", async (_req, res) => {
    try {
      const items = await storage.getContributingPayCodes();
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch contributing pay codes" });
    }
  });

  app.post("/api/contributing-pay-codes", async (req, res) => {
    try {
      const item = await storage.createContributingPayCode(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create contributing pay code" });
    }
  });

  app.patch("/api/contributing-pay-codes/:id", async (req, res) => {
    try {
      const item = await storage.updateContributingPayCode(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update contributing pay code" });
    }
  });

  app.delete("/api/contributing-pay-codes/:id", async (req, res) => {
    try {
      await storage.deleteContributingPayCode(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete contributing pay code" });
    }
  });

  app.post("/api/contributing-pay-codes/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getContributingPayCodes(companyId);
      const existingNames = new Set(existing.map(e => e.name));
      const payCodes = await storage.getPayCodes(companyId);
      const codeMap = new Map(payCodes.map(pc => [pc.code, pc.id]));
      const defaultGroups = [
        { name: "Regular & Overtime", codes: ["REGULAR", "OVERTIME", "DOUBLE_TIME"] },
        { name: "All Paid Time", codes: ["REGULAR", "OVERTIME", "DOUBLE_TIME", "VACATION", "SICK", "HOLIDAY"] },
        { name: "Leave Codes", codes: ["VACATION", "SICK", "UNPAID_LEAVE"] },
        { name: "Premium Eligible", codes: ["REGULAR", "OVERTIME", "DOUBLE_TIME", "ON_CALL"] },
        { name: "OT Threshold Hours", codes: ["REGULAR", "OVERTIME", "DOUBLE_TIME"] },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const group of defaultGroups) {
        if (existingNames.has(group.name)) { skipped.push(group.name); continue; }
        const matchedIds = group.codes.map(c => codeMap.get(c)).filter(Boolean).join(",");
        if (!matchedIds) { skipped.push(group.name + " (no matching pay codes)"); continue; }
        const item = await storage.createContributingPayCode({ companyId, name: group.name, payCodeIds: matchedIds });
        created.push(item);
      }
      res.json({ message: `Created ${created.length} contributing pay codes${skipped.length > 0 ? `, skipped ${skipped.length} existing` : ""}`, created, skipped });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to set up contributing pay codes" });
    }
  });

  // Contributing Shifts
  app.get("/api/contributing-shifts", async (_req, res) => {
    try {
      const items = await storage.getContributingShifts();
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch contributing shifts" });
    }
  });

  app.post("/api/contributing-shifts", async (req, res) => {
    try {
      const item = await storage.createContributingShift(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create contributing shift" });
    }
  });

  app.patch("/api/contributing-shifts/:id", async (req, res) => {
    try {
      const item = await storage.updateContributingShift(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update contributing shift" });
    }
  });

  app.delete("/api/contributing-shifts/:id", async (req, res) => {
    try {
      await storage.deleteContributingShift(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete contributing shift" });
    }
  });

  app.post("/api/contributing-shifts/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getContributingShifts(companyId);
      const existingCodes = new Set(existing.map(e => e.shiftTypeCode));
      const defaultShifts = [
        { companyId, name: "Day Shift", shiftTypeCode: "DAY_SHIFT", contributesToOvertime: true, contributesToAccrual: true, contributesToPremium: true, contributesToCompliance: true, filterType: "date", includeHolidayType: "no_effect" },
        { companyId, name: "Night Shift", shiftTypeCode: "NIGHT_SHIFT", contributesToOvertime: true, contributesToAccrual: true, contributesToPremium: true, contributesToCompliance: true, filterType: "date", includeHolidayType: "no_effect" },
        { companyId, name: "Training Shift", shiftTypeCode: "TRAINING_SHIFT", contributesToOvertime: false, contributesToAccrual: false, contributesToPremium: false, contributesToCompliance: false, filterType: "date", includeHolidayType: "no_effect" },
        { companyId, name: "On-Call Shift", shiftTypeCode: "ON_CALL_SHIFT", contributesToOvertime: false, contributesToAccrual: false, contributesToPremium: true, contributesToCompliance: true, filterType: "date", includeHolidayType: "no_effect" },
        { companyId, name: "Holiday Shift", shiftTypeCode: "HOLIDAY_SHIFT", contributesToOvertime: false, contributesToAccrual: true, contributesToPremium: true, contributesToCompliance: true, filterType: "date", includeHolidayType: "always_on_holidays" },
        { companyId, name: "Orientation Shift", shiftTypeCode: "ORIENTATION_SHIFT", contributesToOvertime: false, contributesToAccrual: false, contributesToPremium: false, contributesToCompliance: false, filterType: "date", includeHolidayType: "no_effect" },
        { companyId, name: "Volunteer Shift", shiftTypeCode: "VOLUNTEER_SHIFT", contributesToOvertime: false, contributesToAccrual: false, contributesToPremium: false, contributesToCompliance: false, filterType: "date", includeHolidayType: "no_effect" },
        { companyId, name: "Admin Time", shiftTypeCode: "ADMIN_TIME", contributesToOvertime: true, contributesToAccrual: true, contributesToPremium: false, contributesToCompliance: true, filterType: "date", includeHolidayType: "no_effect" },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const shift of defaultShifts) {
        if (existingCodes.has(shift.shiftTypeCode)) { skipped.push(shift.name); continue; }
        const item = await storage.createContributingShift(shift);
        created.push(item);
      }
      res.json({ message: `Created ${created.length} contributing shifts${skipped.length > 0 ? `, skipped ${skipped.length} existing` : ""}`, created, skipped });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to set up contributing shifts" });
    }
  });

  // Regular Time Policies
  app.get("/api/regular-time-policies", async (_req, res) => {
    try {
      const items = await storage.getRegularTimePolicies();
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch regular time policies" });
    }
  });

  app.post("/api/regular-time-policies", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.createRegularTimePolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create regular time policy" });
    }
  });

  app.patch("/api/regular-time-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.updateRegularTimePolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update regular time policy" });
    }
  });

  app.delete("/api/regular-time-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteRegularTimePolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete regular time policy" });
    }
  });

  app.post("/api/regular-time-policies/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getRegularTimePolicies(companyId);
      const existingNames = new Set(existing.map(e => e.name));
      const defaults = [
        { companyId, name: "Regular 8hr", maxTime: "8", calculationOrder: 100 },
        { companyId, name: "Salary", maxTime: null, calculationOrder: 200 },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const item of defaults) {
        if (existingNames.has(item.name)) { skipped.push(item.name); continue; }
        const record = await storage.createRegularTimePolicy(item);
        created.push(record);
      }
      res.json({ message: `Created ${created.length} regular time policies${skipped.length > 0 ? `, skipped ${skipped.length} existing` : ""}`, created, skipped });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to set up regular time policies" });
    }
  });

  // Overtime Policies
  app.get("/api/overtime-policies", async (_req, res) => {
    try {
      const items = await storage.getOvertimePolicies();
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch overtime policies" });
    }
  });

  app.post("/api/overtime-policies", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.createOvertimePolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create overtime policy" });
    }
  });

  app.patch("/api/overtime-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.updateOvertimePolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update overtime policy" });
    }
  });

  app.delete("/api/overtime-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteOvertimePolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete overtime policy" });
    }
  });

  app.post("/api/overtime-policies/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getOvertimePolicies(companyId);
      const existingNames = new Set(existing.map(e => e.name));
      const defaults = [
        { companyId, name: "CA Daily OT 8hr 1.5x", type: "daily", triggerTime: "8", rate: "1.5" },
        { companyId, name: "CA Daily DT 12hr 2x", type: "daily", triggerTime: "12", rate: "2.0" },
        { companyId, name: "Weekly OT 40hr 1.5x", type: "weekly", triggerTime: "40", rate: "1.5" },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const item of defaults) {
        if (existingNames.has(item.name)) { skipped.push(item.name); continue; }
        const record = await storage.createOvertimePolicy(item);
        created.push(record);
      }
      res.json({ message: `Created ${created.length} overtime policies${skipped.length > 0 ? `, skipped ${skipped.length} existing` : ""}`, created, skipped });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to set up overtime policies" });
    }
  });

  // Premium Policies
  app.get("/api/premium-policies", async (_req, res) => {
    try {
      const items = await storage.getPremiumPolicies();
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch premium policies" });
    }
  });

  app.post("/api/premium-policies", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.createPremiumPolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create premium policy" });
    }
  });

  app.patch("/api/premium-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.updatePremiumPolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update premium policy" });
    }
  });

  app.delete("/api/premium-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deletePremiumPolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete premium policy" });
    }
  });

  // Meal Policies
  app.get("/api/meal-policies", async (_req, res) => {
    try {
      const items = await storage.getMealPolicies();
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch meal policies" });
    }
  });

  app.post("/api/meal-policies", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.createMealPolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create meal policy" });
    }
  });

  app.patch("/api/meal-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.updateMealPolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update meal policy" });
    }
  });

  app.delete("/api/meal-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteMealPolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete meal policy" });
    }
  });

  app.post("/api/meal-policies/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getMealPolicies(companyId);
      const existingNames = new Set(existing.map(e => e.name));
      const defaults = [
        { companyId, name: "CA 30min Meal after 5hr", type: "normal", activeAfter: "5", mealTime: "0.5" },
        { companyId, name: "Second Meal after 10hr", type: "normal", activeAfter: "10", mealTime: "0.5", includeMultipleMeals: true },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const item of defaults) {
        if (existingNames.has(item.name)) { skipped.push(item.name); continue; }
        const record = await storage.createMealPolicy(item);
        created.push(record);
      }
      res.json({ message: `Created ${created.length} meal policies${skipped.length > 0 ? `, skipped ${skipped.length} existing` : ""}`, created, skipped });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to set up meal policies" });
    }
  });

  // Break Policies
  app.get("/api/break-policies", async (_req, res) => {
    try {
      const items = await storage.getBreakPolicies();
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch break policies" });
    }
  });

  app.post("/api/break-policies", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.createBreakPolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create break policy" });
    }
  });

  app.patch("/api/break-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.updateBreakPolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update break policy" });
    }
  });

  app.delete("/api/break-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteBreakPolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete break policy" });
    }
  });

  app.post("/api/break-policies/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getBreakPolicies(companyId);
      const existingNames = new Set(existing.map(e => e.name));
      const defaults = [
        { companyId, name: "CA 10min Break after 4hr", type: "normal", activeAfter: "4", breakTime: "0.167" },
        { companyId, name: "CA Second Break after 6hr", type: "normal", activeAfter: "6", breakTime: "0.167", includeMultipleBreaks: true },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const item of defaults) {
        if (existingNames.has(item.name)) { skipped.push(item.name); continue; }
        const record = await storage.createBreakPolicy(item);
        created.push(record);
      }
      res.json({ message: `Created ${created.length} break policies${skipped.length > 0 ? `, skipped ${skipped.length} existing` : ""}`, created, skipped });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to set up break policies" });
    }
  });

  // Schedule Policies
  app.get("/api/schedule-policies", async (_req, res) => {
    try {
      const items = await storage.getSchedulePolicies();
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch schedule policies" });
    }
  });

  app.post("/api/schedule-policies", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.createSchedulePolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create schedule policy" });
    }
  });

  app.patch("/api/schedule-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.updateSchedulePolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update schedule policy" });
    }
  });

  app.delete("/api/schedule-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteSchedulePolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete schedule policy" });
    }
  });

  // Exception Policies
  app.get("/api/exception-policies", async (_req, res) => {
    try {
      const items = await storage.getExceptionPolicies();
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch exception policies" });
    }
  });

  app.post("/api/exception-policies", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.createExceptionPolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create exception policy" });
    }
  });

  app.patch("/api/exception-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.updateExceptionPolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update exception policy" });
    }
  });

  app.delete("/api/exception-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteExceptionPolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete exception policy" });
    }
  });

  // Accrual Policies
  app.get("/api/accrual-policies", async (_req, res) => {
    try {
      const items = await storage.getAccrualPolicies();
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch accrual policies" });
    }
  });

  app.post("/api/accrual-policies", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.createAccrualPolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create accrual policy" });
    }
  });

  app.patch("/api/accrual-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.updateAccrualPolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update accrual policy" });
    }
  });

  app.delete("/api/accrual-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteAccrualPolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete accrual policy" });
    }
  });

  // Accrual Policy Milestones
  app.get("/api/accrual-policy-milestones", async (req, res) => {
    try {
      const accrualPolicyId = req.query.accrualPolicyId as string;
      if (!accrualPolicyId) return res.status(400).json({ message: "accrualPolicyId required" });
      const items = await storage.getAccrualPolicyMilestones(accrualPolicyId);
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch milestones" });
    }
  });

  app.post("/api/accrual-policy-milestones", async (req, res) => {
    try {
      const item = await storage.createAccrualPolicyMilestone(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create milestone" });
    }
  });

  app.delete("/api/accrual-policy-milestones/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteAccrualPolicyMilestone(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete milestone" });
    }
  });

  // Absence Policies
  app.get("/api/absence-policies", async (_req, res) => {
    try {
      const items = await storage.getAbsencePolicies();
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch absence policies" });
    }
  });

  app.post("/api/absence-policies", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.createAbsencePolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create absence policy" });
    }
  });

  app.patch("/api/absence-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.updateAbsencePolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update absence policy" });
    }
  });

  app.delete("/api/absence-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteAbsencePolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete absence policy" });
    }
  });

  // Holiday Policies
  app.get("/api/holiday-policies", async (_req, res) => {
    try {
      const items = await storage.getHolidayPolicies();
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch holiday policies" });
    }
  });

  app.post("/api/holiday-policies", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.createHolidayPolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create holiday policy" });
    }
  });

  app.patch("/api/holiday-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.updateHolidayPolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update holiday policy" });
    }
  });

  app.delete("/api/holiday-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteHolidayPolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete holiday policy" });
    }
  });

  // Rounding Policies
  app.get("/api/rounding-policies", async (_req, res) => {
    try {
      const items = await storage.getRoundingPolicies();
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch rounding policies" });
    }
  });

  app.post("/api/rounding-policies", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.createRoundingPolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create rounding policy" });
    }
  });

  app.patch("/api/rounding-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      const item = await storage.updateRoundingPolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update rounding policy" });
    }
  });

  app.delete("/api/rounding-policies/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteRoundingPolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete rounding policy" });
    }
  });

  app.post("/api/premium-policies/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getPremiumPolicies();
      const companyItems = existing.filter(p => p.companyId === companyId);
      const existingNames = new Set(companyItems.map(e => e.name));
      const defaults = [
        { companyId, name: "Night Shift Premium (+10%)", type: "date_time", startTime: "18:00", endTime: "06:00", effectiveDays: "0,1,2,3,4,5,6" },
        { companyId, name: "Weekend Premium (+15%)", type: "date_time", effectiveDays: "0,6" },
        { companyId, name: "Holiday Premium (+50%)", type: "date_time", holidayHandling: "apply_on_holiday" },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const item of defaults) {
        if (existingNames.has(item.name)) { skipped.push(item.name); continue; }
        const result = await storage.createPremiumPolicy(item as any);
        created.push(result);
      }
      res.json({ message: `Created ${created.length} premium policies${skipped.length ? `, skipped ${skipped.length} existing` : ""}`, count: created.length, skipped: skipped.length });
    } catch (error: any) {
      console.error("Premium policy setup error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to set up premium policies") });
    }
  });

  app.post("/api/exception-policies/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getExceptionPolicies();
      const companyItems = existing.filter(p => p.companyId === companyId);
      const existingNames = new Set(companyItems.map(e => e.name));
      const defaults = [
        { companyId, name: "Late Start", exceptionType: "late_start", severity: "medium", grace: "5", watchWindow: "15" },
        { companyId, name: "Early End", exceptionType: "early_end", severity: "medium", grace: "5", watchWindow: "15" },
        { companyId, name: "Missed Punch", exceptionType: "missed_punch", severity: "high", grace: "0", watchWindow: "0", emailNotification: true },
        { companyId, name: "Unscheduled Absence", exceptionType: "unscheduled_absence", severity: "high", grace: "0", watchWindow: "0", emailNotification: true },
        { companyId, name: "Long Break", exceptionType: "long_break", severity: "low", grace: "5", watchWindow: "10" },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const item of defaults) {
        if (existingNames.has(item.name)) { skipped.push(item.name); continue; }
        const result = await storage.createExceptionPolicy(item as any);
        created.push(result);
      }
      res.json({ message: `Created ${created.length} exception policies${skipped.length ? `, skipped ${skipped.length} existing` : ""}`, count: created.length, skipped: skipped.length });
    } catch (error: any) {
      console.error("Exception policy setup error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to set up exception policies") });
    }
  });

  app.post("/api/schedule-policies/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getSchedulePolicies();
      const companyItems = existing.filter(p => p.companyId === companyId);
      const existingNames = new Set(companyItems.map(e => e.name));
      const defaults = [
        { companyId, name: "Standard Schedule", startStopWindow: "1", regularTimePolicyAction: "include", overtimePolicyAction: "include", premiumPolicyAction: "include" },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const item of defaults) {
        if (existingNames.has(item.name)) { skipped.push(item.name); continue; }
        const result = await storage.createSchedulePolicy(item as any);
        created.push(result);
      }
      res.json({ message: `Created ${created.length} schedule policies${skipped.length ? `, skipped ${skipped.length} existing` : ""}`, count: created.length, skipped: skipped.length });
    } catch (error: any) {
      console.error("Schedule policy setup error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to set up schedule policies") });
    }
  });

  app.post("/api/holiday-policies/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getHolidayPolicies();
      const companyItems = existing.filter(p => p.companyId === companyId);
      const existingNames = new Set(companyItems.map(e => e.name));
      const defaults = [
        { companyId, name: "Standard Holiday - Paid", defaultSchedule: "none", workedOnHolidayType: "paid", eligibleAfterDays: 0, minimumWorkedBeforeDays: 0, minimumWorkedAfterDays: 0 },
        { companyId, name: "Holiday Worked - OT Rate", defaultSchedule: "none", workedOnHolidayType: "overtime", eligibleAfterDays: 0, forceOverTimePolicy: true },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const item of defaults) {
        if (existingNames.has(item.name)) { skipped.push(item.name); continue; }
        const result = await storage.createHolidayPolicy(item as any);
        created.push(result);
      }
      res.json({ message: `Created ${created.length} holiday policies${skipped.length ? `, skipped ${skipped.length} existing` : ""}`, count: created.length, skipped: skipped.length });
    } catch (error: any) {
      console.error("Holiday policy setup error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to set up holiday policies") });
    }
  });

  app.post("/api/accrual-policies/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getAccrualPolicies();
      const companyItems = existing.filter(p => p.companyId === companyId);
      const existingNames = new Set(companyItems.map(e => e.name));
      const defaults = [
        { companyId, name: "Vacation Accrual", type: "standard", lengthOfServiceUnit: "years", applyFrequency: "per_pay_period", minimumEmployedDays: 90 },
        { companyId, name: "Sick Leave Accrual", type: "standard", lengthOfServiceUnit: "years", applyFrequency: "per_pay_period", minimumEmployedDays: 0 },
        { companyId, name: "PTO Accrual", type: "standard", lengthOfServiceUnit: "years", applyFrequency: "per_pay_period", minimumEmployedDays: 0 },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const item of defaults) {
        if (existingNames.has(item.name)) { skipped.push(item.name); continue; }
        const result = await storage.createAccrualPolicy(item as any);
        created.push(result);
      }
      res.json({ message: `Created ${created.length} accrual policies${skipped.length ? `, skipped ${skipped.length} existing` : ""}`, count: created.length, skipped: skipped.length });
    } catch (error: any) {
      console.error("Accrual policy setup error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to set up accrual policies") });
    }
  });

  app.post("/api/absence-policies/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getAbsencePolicies();
      const companyItems = existing.filter(p => p.companyId === companyId);
      const existingNames = new Set(companyItems.map(e => e.name));
      const defaults = [
        { companyId, name: "Vacation Use", type: "accrual_based", rateType: "multiplied_by_factor", rateFactor: "1.0" },
        { companyId, name: "Sick Leave Use", type: "accrual_based", rateType: "multiplied_by_factor", rateFactor: "1.0" },
        { companyId, name: "Personal Leave", type: "accrual_based", rateType: "multiplied_by_factor", rateFactor: "1.0" },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const item of defaults) {
        if (existingNames.has(item.name)) { skipped.push(item.name); continue; }
        const result = await storage.createAbsencePolicy(item as any);
        created.push(result);
      }
      res.json({ message: `Created ${created.length} absence policies${skipped.length ? `, skipped ${skipped.length} existing` : ""}`, count: created.length, skipped: skipped.length });
    } catch (error: any) {
      console.error("Absence policy setup error:", error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to set up absence policies") });
    }
  });

  app.post("/api/rounding-policies/quick-setup", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      const existing = await storage.getRoundingPolicies(companyId);
      const existingNames = new Set(existing.map(e => e.name));
      const defaults = [
        { companyId, name: "15min Rounding", roundType: "day_total", interval: 15, grace: 7 },
        { companyId, name: "6min Rounding", roundType: "day_total", interval: 6, grace: 3 },
      ];
      const created: any[] = [];
      const skipped: string[] = [];
      for (const item of defaults) {
        if (existingNames.has(item.name)) { skipped.push(item.name); continue; }
        const record = await storage.createRoundingPolicy(item);
        created.push(record);
      }
      res.json({ message: `Created ${created.length} rounding policies${skipped.length > 0 ? `, skipped ${skipped.length} existing` : ""}`, created, skipped });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to set up rounding policies" });
    }
  });

  app.get("/api/legal-entities", async (_req, res) => {
    try {
      const items = await storage.getLegalEntities();
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch legal entities" });
    }
  });

  app.post("/api/legal-entities", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.startDate === "") data.startDate = null;
      if (data.endDate === "") data.endDate = null;
      if (data.classificationCode === "") data.classificationCode = null;
      if (data.companyId === "") data.companyId = null;
      if (data.ein === "") data.ein = null;
      const item = await storage.createLegalEntity(data);
      res.status(201).json(item);
    } catch (error: any) {
      console.error("Legal entity creation error:", error?.message || error);
      res.status(500).json({ message: "Failed to create legal entity" });
    }
  });

  app.patch("/api/legal-entities/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.startDate === "") data.startDate = null;
      if (data.endDate === "") data.endDate = null;
      if (data.classificationCode === "") data.classificationCode = null;
      if (data.companyId === "") data.companyId = null;
      if (data.ein === "") data.ein = null;
      const item = await storage.updateLegalEntity(req.params.id, data);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update legal entity" });
    }
  });

  app.delete("/api/legal-entities/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteLegalEntity(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete legal entity" });
    }
  });

  app.get("/api/roles", async (_req, res) => {
    try {
      const items = await storage.getRoles();
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to get roles" });
    }
  });

  app.post("/api/roles", requireRole("admin"), async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const data = insertRoleSchema.parse(req.body);
      delete (data as any).isSystem;
      const item = await storage.createRole(data);
      res.status(201).json(item);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Failed to create role" });
    }
  });

  app.patch("/api/roles/:id", requireRole("admin"), async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const { isSystem, ...data } = req.body;
      const item = await storage.updateRole(req.params.id, data);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update role" });
    }
  });

  app.delete("/api/roles/:id", requireRole("admin"), async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const role = await storage.getRole(req.params.id);
      if (role?.isSystem) return res.status(400).json({ message: "Cannot delete system roles" });
      await storage.deleteRole(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete role" });
    }
  });

  app.post("/api/permission-groups/quick-setup", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });

      const RESOURCES = [
        "dashboard", "companies", "workers", "schedules", "payroll", "timesheets",
        "departments", "branches", "divisions", "positions",
        "policies", "hr", "reports", "timeclock", "settings", "permissions", "system_admin",
        "my_preferences", "my_paystubs", "my_documents", "my_reviews", "my_qualifications"
      ];

      type PD = { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport: boolean; canApprove: boolean };
      const full: PD = { canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true, canApprove: true };
      const viewOnly: PD = { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false, canApprove: false };
      const viewExport: PD = { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true, canApprove: false };
      const none: PD = { canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false, canApprove: false };

      const groupDefs = [
        { name: "System Administrator", description: "Full access to everything across the entire system", level: 1, isSystem: true,
          perms: Object.fromEntries(RESOURCES.map(r => [r, full])) },
        { name: "HR Manager", description: "Handles employee records and HR compliance", level: 2, isSystem: true,
          perms: { dashboard: viewOnly, companies: viewOnly, workers: full, schedules: viewOnly, payroll: viewOnly, timesheets: viewOnly,
            departments: viewOnly, branches: viewOnly, divisions: viewOnly, positions: viewOnly, policies: viewOnly, hr: full,
            reports: viewExport, timeclock: viewOnly, settings: none, permissions: none, system_admin: none } },
        { name: "Payroll Manager", description: "Handles payroll processing and tax configuration", level: 2, isSystem: true,
          perms: { dashboard: viewOnly, companies: viewOnly, workers: viewOnly, schedules: viewOnly, payroll: full,
            timesheets: { canView: true, canCreate: false, canEdit: true, canDelete: false, canExport: true, canApprove: true },
            departments: viewOnly, branches: viewOnly, divisions: viewOnly, positions: viewOnly, policies: viewOnly, hr: viewOnly,
            reports: viewExport, timeclock: viewOnly,
            settings: { canView: true, canCreate: false, canEdit: true, canDelete: false, canExport: false, canApprove: false },
            permissions: none, system_admin: none } },
        { name: "Department Manager", description: "Manages employees within their department", level: 3, isSystem: true,
          perms: { dashboard: viewOnly, companies: viewOnly,
            workers: { canView: true, canCreate: false, canEdit: true, canDelete: false, canExport: false, canApprove: false },
            schedules: { canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false, canApprove: true },
            payroll: viewOnly,
            timesheets: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false, canApprove: true },
            departments: viewOnly, branches: viewOnly, divisions: viewOnly, positions: viewOnly, policies: viewOnly, hr: viewOnly,
            reports: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true, canApprove: false },
            timeclock: viewOnly, settings: none, permissions: none, system_admin: none } },
        { name: "Employee", description: "Self-service access to own data", level: 5, isSystem: true,
          perms: { dashboard: viewOnly, companies: none, workers: none, schedules: viewOnly, payroll: viewOnly, timesheets: viewOnly,
            departments: none, branches: none, divisions: none, positions: none, policies: viewOnly, hr: none, reports: viewOnly,
            timeclock: { canView: true, canCreate: true, canEdit: false, canDelete: false, canExport: false, canApprove: false },
            settings: none, permissions: none, system_admin: none,
            my_preferences: { canView: true, canCreate: false, canEdit: true, canDelete: false, canExport: false, canApprove: false },
            my_paystubs: viewOnly,
            my_documents: viewOnly,
            my_reviews: viewOnly,
            my_qualifications: { canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false, canApprove: false } } },
      ];

      const created: string[] = [];
      const existing = await storage.getRoles();

      for (const def of groupDefs) {
        const existingRole = existing.find(r => r.name === def.name);
        let roleId: string;

        if (existingRole) {
          roleId = existingRole.id;
        } else {
          const { perms, ...roleData } = def;
          const role = await storage.createRole(roleData);
          roleId = role.id;
        }

        await storage.deleteRolePermissionsByRole(roleId);
        for (const resource of RESOURCES) {
          const p = (def.perms as Record<string, PD>)[resource] || none;
          await storage.createRolePermission({ roleId, resource, ...p });
        }
        created.push(def.name);
      }

      res.json({ message: `${created.length} permission groups configured`, groups: created });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to setup permission groups" });
    }
  });

  app.get("/api/role-permissions", async (req, res) => {
    try {
      const roleId = req.query.roleId as string | undefined;
      if (roleId) {
        const items = await storage.getRolePermissions(roleId);
        res.json(items);
      } else {
        const items = await storage.getAllRolePermissions();
        res.json(items);
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to get role permissions" });
    }
  });

  app.post("/api/role-permissions", requireRole("admin"), async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const data = insertRolePermissionSchema.parse(req.body);
      const item = await storage.createRolePermission(data);
      res.status(201).json(item);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Failed to create role permission" });
    }
  });

  app.patch("/api/role-permissions/:id", requireRole("admin"), async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const item = await storage.updateRolePermission(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update role permission" });
    }
  });

  app.delete("/api/role-permissions/:id", requireRole("admin"), async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.deleteRolePermission(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete role permission" });
    }
  });

  app.post("/api/role-permissions/bulk", async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const { roleId, permissions } = req.body;
      if (!roleId || !permissions) return res.status(400).json({ message: "roleId and permissions required" });
      await storage.deleteRolePermissionsByRole(roleId);
      const results = [];
      for (const perm of permissions) {
        const validated = insertRolePermissionSchema.parse({ ...perm, roleId });
        const item = await storage.createRolePermission(validated);
        results.push(item);
      }
      res.json(results);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to save role permissions" });
    }
  });

  app.get("/api/user-roles", async (req, res) => {
    try {
      const userId = req.query.userId as string | undefined;
      const items = await storage.getUserRoles(userId);
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to get user roles" });
    }
  });

  app.post("/api/user-roles", async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const data = insertUserRoleSchema.parse(req.body);
      const item = await storage.createUserRole(data);
      res.status(201).json(item);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Failed to assign role" });
    }
  });

  app.delete("/api/user-roles/:id", requireRole("admin"), async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      await storage.deleteUserRole(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to remove role assignment" });
    }
  });

  app.get("/api/users", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const allUsers = await storage.getUsers();
      res.json(allUsers.map(u => ({ id: u.id, username: u.username, role: u.role, companyId: u.companyId, workerId: u.workerId, isActive: u.isActive, createdAt: u.createdAt })));
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to get users" });
    }
  });

  app.post("/api/users", requireRole("admin"), async (req, res) => {
    try {
      const { username, password, role, companyId, workerId } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ message: "Username already exists" });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({
        username,
        password: hashedPassword,
        role: role || "employee",
        companyId: companyId || null,
        workerId: workerId || null,
        isActive: true,
      });
      res.json({ id: user.id, username: user.username, role: user.role, companyId: user.companyId, workerId: user.workerId, isActive: user.isActive });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create user account" });
    }
  });

  app.patch("/api/users/:id", requireRole("admin"), async (req, res) => {
    try {
      const { password, username, role, companyId, workerId, isActive } = req.body;
      const updateData: any = {};
      if (username !== undefined) {
        const existing = await storage.getUserByUsername(username);
        if (existing && existing.id !== req.params.id) {
          return res.status(409).json({ message: "Username already exists" });
        }
        updateData.username = username;
      }
      if (role !== undefined) updateData.role = role;
      if (companyId !== undefined) updateData.companyId = companyId || null;
      if (workerId !== undefined) updateData.workerId = workerId || null;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (password) {
        updateData.password = await bcrypt.hash(password, 10);
      }
      const user = await storage.updateUser(req.params.id, updateData);
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json({ id: user.id, username: user.username, role: user.role, companyId: user.companyId, workerId: user.workerId, isActive: user.isActive });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update user account" });
    }
  });

  app.delete("/api/users/:id", requireRole("admin"), async (req, res) => {
    try {
      const currentUser = await storage.getUser(req.session.userId!);
      if (req.params.id === currentUser?.id) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }
      await storage.deleteUser(req.params.id);
      res.json({ message: "User deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete user account" });
    }
  });

  app.post("/api/upload", requireAuth, upload.single("file"), (req: any, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const url = `/uploads/${req.file.filename}`;
    res.json({ url, filename: req.file.filename });
  });

  app.get("/api/check-templates", requireAuth, async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const templates = await storage.getCheckTemplates(companyId);
      res.json(templates);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to get check templates" });
    }
  });
  app.get("/api/check-templates/:id", requireAuth, async (req, res) => {
    try {
      const template = await storage.getCheckTemplate(req.params.id as string);
      if (!template) return res.status(404).json({ message: "Template not found" });
      res.json(template);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to get check template" });
    }
  });
  app.post("/api/check-templates", requireAuth, async (req, res) => {
    try {
      const data = { ...req.body };
      if (!data.companyId || data.companyId === "") {
        return res.status(400).json({ message: "Company is required" });
      }
      if (!data.name || data.name.trim() === "") {
        return res.status(400).json({ message: "Template name is required" });
      }
      const parsed = insertCheckTemplateSchema.parse(data);
      const template = await storage.createCheckTemplate(parsed);
      res.status(201).json(template);
    } catch (error: any) {
      console.error("Failed to create check template:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid template data: " + (error.issues?.[0]?.message || error.message) });
      }
      res.status(500).json({ message: "Failed to create check template" });
    }
  });
  app.patch("/api/check-templates/:id", requireAuth, async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.companyId === "") data.companyId = null;
      const template = await storage.updateCheckTemplate(req.params.id as string, data);
      if (!template) return res.status(404).json({ message: "Template not found" });
      res.json(template);
    } catch (error) {
      console.error("Failed to update check template:", error);
      res.status(500).json({ message: "Failed to update template" });
    }
  });
  app.delete("/api/check-templates/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteCheckTemplate(req.params.id as string);
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete template" });
    }
  });

  // ── Payroll Payment Methods ───────────────────────────────────────────────
  app.get("/api/payroll-payment-methods", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      res.json(await storage.getPayrollPaymentMethods(companyId));
    } catch (e) { res.status(500).json({ message: "Failed to fetch payment methods" }); }
  });

  app.post("/api/payroll-payment-methods", requireRole("admin", "manager"), async (req, res) => {
    try {
      res.status(201).json(await storage.createPayrollPaymentMethod(req.body));
    } catch (e) { res.status(500).json({ message: "Failed to create payment method" }); }
  });

  app.patch("/api/payroll-payment-methods/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const r = await storage.updatePayrollPaymentMethod(req.params.id, req.body);
      if (!r) return res.status(404).json({ message: "Not found" });
      res.json(r);
    } catch (e) { res.status(500).json({ message: "Failed to update payment method" }); }
  });

  app.delete("/api/payroll-payment-methods/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deletePayrollPaymentMethod(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: "Failed to delete payment method" }); }
  });

  app.post("/api/payroll-payment-methods/quick-setup", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { companyId } = req.body;
      const existing = await storage.getPayrollPaymentMethods(companyId);
      const existingCodes = new Set(existing.filter(e => !e.companyId || e.companyId === companyId).map(e => e.code));
      const defaults = [
        { code: "CASH", name: "Cash", category: "cash", isDigitalWallet: false, isBankBased: false, requiresReferenceNumber: false, requiresAccountSelection: true, sortOrder: 1 },
        { code: "CHECK", name: "Paper Check", category: "check", isDigitalWallet: false, isBankBased: true, requiresReferenceNumber: true, requiresAccountSelection: true, sortOrder: 2 },
        { code: "ACH", name: "ACH Direct Deposit", category: "ach", isDigitalWallet: false, isBankBased: true, requiresReferenceNumber: true, requiresAccountSelection: true, sortOrder: 3 },
        { code: "APPLE_PAY", name: "Apple Pay", category: "digital_wallet", isDigitalWallet: true, isBankBased: false, requiresReferenceNumber: false, requiresAccountSelection: true, sortOrder: 4 },
        { code: "CASH_APP", name: "Cash App", category: "digital_wallet", isDigitalWallet: true, isBankBased: false, requiresReferenceNumber: false, requiresAccountSelection: true, sortOrder: 5 },
        { code: "PAYPAL", name: "PayPal", category: "digital_wallet", isDigitalWallet: true, isBankBased: false, requiresReferenceNumber: false, requiresAccountSelection: true, sortOrder: 6 },
        { code: "VENMO", name: "Venmo", category: "digital_wallet", isDigitalWallet: true, isBankBased: false, requiresReferenceNumber: false, requiresAccountSelection: true, sortOrder: 7 },
        { code: "ZELLE", name: "Zelle", category: "digital_wallet", isDigitalWallet: false, isBankBased: true, requiresReferenceNumber: false, requiresAccountSelection: true, sortOrder: 8 },
      ];
      let created = 0;
      for (const d of defaults) {
        if (!existingCodes.has(d.code)) {
          await storage.createPayrollPaymentMethod({ ...d, companyId: companyId || null, active: true });
          created++;
        }
      }
      res.json({ message: `Quick setup complete. Created ${created} payment method(s).`, created });
    } catch (e) { console.error(e); res.status(500).json({ message: "Failed to run quick setup" }); }
  });

  // ── Funding Accounts ──────────────────────────────────────────────────────
  app.get("/api/funding-accounts", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      res.json(await storage.getFundingAccounts(companyId));
    } catch (e) { res.status(500).json({ message: "Failed to fetch funding accounts" }); }
  });

  app.post("/api/funding-accounts", requireRole("admin", "manager"), async (req, res) => {
    try {
      res.status(201).json(await storage.createFundingAccount(req.body));
    } catch (e) { res.status(500).json({ message: "Failed to create funding account" }); }
  });

  app.patch("/api/funding-accounts/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const r = await storage.updateFundingAccount(req.params.id, req.body);
      if (!r) return res.status(404).json({ message: "Not found" });
      res.json(r);
    } catch (e) { res.status(500).json({ message: "Failed to update funding account" }); }
  });

  app.delete("/api/funding-accounts/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteFundingAccount(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: "Failed to delete funding account" }); }
  });

  app.post("/api/funding-accounts/quick-setup", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { companyId } = req.body;
      const existing = await storage.getFundingAccounts(companyId);
      const existingNames = new Set(existing.filter(e => !e.companyId || e.companyId === companyId).map(e => e.accountName));
      const defaults = [
        { accountCode: "OC-001", accountName: "Operating Checking", accountType: "bank_checking", currency: "USD", allowForPayroll: true },
        { accountCode: "PC-001", accountName: "Payroll Checking", accountType: "bank_checking", currency: "USD", allowForPayroll: true },
        { accountCode: "CASH-001", accountName: "Petty Cash", accountType: "cash_on_hand", currency: "USD", allowForPayroll: false },
        { accountCode: "PP-001", accountName: "PayPal Wallet", accountType: "paypal_balance", currency: "USD", allowForPayroll: true },
        { accountCode: "VB-001", accountName: "Venmo Business", accountType: "venmo_balance", currency: "USD", allowForPayroll: true },
        { accountCode: "CA-001", accountName: "Cash App Business", accountType: "cash_app_balance", currency: "USD", allowForPayroll: true },
        { accountCode: "AP-001", accountName: "Apple Pay Linked Account", accountType: "apple_pay_linked", currency: "USD", allowForPayroll: true },
        { accountCode: "ZL-001", accountName: "Zelle Linked Checking", accountType: "bank_checking", currency: "USD", allowForPayroll: true },
      ];
      let created = 0;
      for (const d of defaults) {
        if (!existingNames.has(d.accountName)) {
          await storage.createFundingAccount({ ...d, companyId: companyId || null, active: true, reconciliationEnabled: false, openingBalance: "0" });
          created++;
        }
      }
      res.json({ message: `Quick setup complete. Created ${created} funding account(s).`, created });
    } catch (e) { console.error(e); res.status(500).json({ message: "Failed to run quick setup" }); }
  });

  // ── Payroll Payment Records ───────────────────────────────────────────────
  app.get("/api/payroll-payment-records", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const payrollRunId = req.query.payrollRunId as string | undefined;
      res.json(await storage.getPayrollPaymentRecords(companyId, payrollRunId));
    } catch (e) { res.status(500).json({ message: "Failed to fetch payment records" }); }
  });

  app.get("/api/payroll-payment-records/ytd-summary", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const taxYear = req.query.taxYear ? Number(req.query.taxYear) : new Date().getFullYear();
      const records = await storage.getPayrollPaymentRecords(companyId);
      const yearRecords = records.filter(r => r.taxYear === taxYear || (r.payDate && new Date(r.payDate).getFullYear() === taxYear));
      const byMethod: Record<string, { code: string; name: string; count: number; totalGross: number; totalNet: number; totalTax: number }> = {};
      const byAccount: Record<string, { name: string; count: number; totalGross: number; totalNet: number }> = {};
      for (const r of yearRecords) {
        const mc = r.paymentMethodCode || "UNKNOWN";
        if (!byMethod[mc]) byMethod[mc] = { code: mc, name: mc, count: 0, totalGross: 0, totalNet: 0, totalTax: 0 };
        byMethod[mc].count++;
        byMethod[mc].totalGross += Number(r.grossPayAmount || 0);
        byMethod[mc].totalNet += Number(r.netPayAmount || 0);
        byMethod[mc].totalTax += Number(r.employeeTaxWithheld || 0);
        const fa = r.fundingAccountId || "UNKNOWN";
        if (!byAccount[fa]) byAccount[fa] = { name: fa, count: 0, totalGross: 0, totalNet: 0 };
        byAccount[fa].count++;
        byAccount[fa].totalGross += Number(r.grossPayAmount || 0);
        byAccount[fa].totalNet += Number(r.netPayAmount || 0);
      }
      res.json({ taxYear, totalRecords: yearRecords.length, byMethod: Object.values(byMethod), byAccount: Object.values(byAccount) });
    } catch (e) { console.error(e); res.status(500).json({ message: "Failed to fetch YTD summary" }); }
  });

  app.post("/api/payroll-payment-records", requireRole("admin", "manager"), async (req, res) => {
    try {
      res.status(201).json(await storage.createPayrollPaymentRecord(req.body));
    } catch (e) { res.status(500).json({ message: "Failed to create payment record" }); }
  });

  app.patch("/api/payroll-payment-records/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const r = await storage.updatePayrollPaymentRecord(req.params.id, req.body);
      if (!r) return res.status(404).json({ message: "Not found" });
      res.json(r);
    } catch (e) { res.status(500).json({ message: "Failed to update payment record" }); }
  });

  app.delete("/api/payroll-payment-records/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deletePayrollPaymentRecord(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: "Failed to delete payment record" }); }
  });

  // ─── My Profile self-service endpoints (accessible by all authenticated users) ───

  app.get("/api/my/worker", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.json(null);
      const worker = await storage.getWorker(user.workerId);
      res.json(worker || null);
    } catch (e) { res.status(500).json({ message: "Failed to fetch worker" }); }
  });

  app.patch("/api/my/preferences", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) {
        return res.json({ message: "No linked worker — display preferences are available to employee accounts only", skipped: true });
      }
      const worker = await storage.getWorker(user.workerId);
      if (!worker) return res.status(404).json({ message: "Worker not found" });
      const existing = JSON.parse(worker.preferences || "{}");
      const merged = { ...existing, ...req.body };
      const updated = await storage.updateWorker(user.workerId, { preferences: JSON.stringify(merged) });
      res.json(updated);
    } catch (e) { res.status(500).json({ message: "Failed to save preferences" }); }
  });

  app.get("/api/my/paystubs", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.json([]);
      const { db } = await import("./db.js");
      const { payrollItems, payrollRuns } = await import("../shared/schema.js");
      const { eq } = await import("drizzle-orm");
      const rows = await db
        .select({ item: payrollItems, run: payrollRuns })
        .from(payrollItems)
        .innerJoin(payrollRuns, eq(payrollItems.payrollRunId, payrollRuns.id))
        .where(eq(payrollItems.workerId, user.workerId))
        .orderBy(payrollRuns.periodEnd);
      res.json(rows.map(r => ({ ...r.item, run: r.run })));
    } catch (e) { console.error(e); res.status(500).json({ message: "Failed to fetch paystubs" }); }
  });

  app.get("/api/my/documents", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.json([]);
      const docs = await storage.getWorkerDocuments(user.workerId);
      res.json(docs);
    } catch (e) { res.status(500).json({ message: "Failed to fetch documents" }); }
  });

  app.get("/api/my/reviews", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.json([]);
      const reviews = await storage.getReviews(undefined, user.workerId);
      res.json(reviews);
    } catch (e) { res.status(500).json({ message: "Failed to fetch reviews" }); }
  });

  app.get("/api/my/qualifications", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.json([]);
      const items = await storage.getQualifications(undefined, user.workerId);
      res.json(items);
    } catch (e) { res.status(500).json({ message: "Failed to fetch qualifications" }); }
  });

  app.post("/api/my/qualifications", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.status(400).json({ message: "No linked worker" });
      const data = { ...req.body, workerId: user.workerId };
      const item = await storage.createQualification(data);
      res.status(201).json(item);
    } catch (e) { res.status(500).json({ message: "Failed to create qualification" }); }
  });

  app.patch("/api/my/qualifications/:id", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.status(403).json({ message: "No linked worker" });
      const items = await storage.getQualifications(undefined, user.workerId);
      if (!items.find(i => i.id === req.params.id)) return res.status(403).json({ message: "Access denied" });
      const item = await storage.updateQualification(req.params.id, req.body);
      res.json(item);
    } catch (e) { res.status(500).json({ message: "Failed to update qualification" }); }
  });

  app.delete("/api/my/qualifications/:id", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.status(403).json({ message: "No linked worker" });
      const items = await storage.getQualifications(undefined, user.workerId);
      if (!items.find(i => i.id === req.params.id)) return res.status(403).json({ message: "Access denied" });
      await storage.deleteQualification(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: "Failed to delete qualification" }); }
  });

  app.get("/api/my/languages", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.json([]);
      const { db } = await import("./db.js");
      const { workerLanguages } = await import("../shared/schema.js");
      const { eq } = await import("drizzle-orm");
      const items = await db.select().from(workerLanguages).where(eq(workerLanguages.workerId, user.workerId));
      res.json(items);
    } catch (e) { res.status(500).json({ message: "Failed to fetch languages" }); }
  });

  app.post("/api/my/languages", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.status(400).json({ message: "No linked worker" });
      const data = { ...req.body, workerId: user.workerId };
      const { db } = await import("./db.js");
      const { workerLanguages } = await import("../shared/schema.js");
      const [item] = await db.insert(workerLanguages).values(data).returning();
      res.status(201).json(item);
    } catch (e) { res.status(500).json({ message: "Failed to create language" }); }
  });

  app.delete("/api/my/languages/:id", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.status(403).json({ message: "No linked worker" });
      const { db } = await import("./db.js");
      const { workerLanguages } = await import("../shared/schema.js");
      const { eq, and } = await import("drizzle-orm");
      await db.delete(workerLanguages).where(and(eq(workerLanguages.id, req.params.id), eq(workerLanguages.workerId, user.workerId)));
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: "Failed to delete language" }); }
  });

  app.get("/api/my/memberships", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.json([]);
      const { db } = await import("./db.js");
      const { workerMemberships } = await import("../shared/schema.js");
      const { eq } = await import("drizzle-orm");
      const items = await db.select().from(workerMemberships).where(eq(workerMemberships.workerId, user.workerId));
      res.json(items);
    } catch (e) { res.status(500).json({ message: "Failed to fetch memberships" }); }
  });

  app.post("/api/my/memberships", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.status(400).json({ message: "No linked worker" });
      const data = { ...req.body, workerId: user.workerId };
      const { db } = await import("./db.js");
      const { workerMemberships } = await import("../shared/schema.js");
      const [item] = await db.insert(workerMemberships).values(data).returning();
      res.status(201).json(item);
    } catch (e) { res.status(500).json({ message: "Failed to create membership" }); }
  });

  app.delete("/api/my/memberships/:id", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.status(403).json({ message: "No linked worker" });
      const { db } = await import("./db.js");
      const { workerMemberships } = await import("../shared/schema.js");
      const { eq, and } = await import("drizzle-orm");
      await db.delete(workerMemberships).where(and(eq(workerMemberships.id, req.params.id), eq(workerMemberships.workerId, user.workerId)));
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: "Failed to delete membership" }); }
  });

  // ── Time-Off Requests ──────────────────────────────────────────────────────
  app.get("/api/time-off-requests", requireAuth, async (req, res) => {
    try {
      const { companyId, workerId } = req.query as Record<string, string>;
      const items = await storage.getTimeOffRequests(companyId, workerId);
      res.json(items);
    } catch (e) { res.status(500).json({ message: "Failed to fetch time-off requests" }); }
  });

  app.get("/api/time-off-requests/:id", requireAuth, async (req, res) => {
    try {
      const item = await storage.getTimeOffRequest(req.params.id);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (e) { res.status(500).json({ message: "Failed to fetch time-off request" }); }
  });

  app.post("/api/time-off-requests", requireAuth, async (req, res) => {
    try {
      const parsed = insertTimeOffRequestSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      const item = await storage.createTimeOffRequest(parsed.data);
      res.status(201).json(item);
    } catch (e) { res.status(500).json({ message: "Failed to create time-off request" }); }
  });

  app.patch("/api/time-off-requests/:id", requireAuth, async (req, res) => {
    try {
      const item = await storage.updateTimeOffRequest(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (e) { res.status(500).json({ message: "Failed to update time-off request" }); }
  });

  app.patch("/api/time-off-requests/:id/review", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const { decision, reviewNote } = req.body;
      if (!decision) return res.status(400).json({ message: "decision is required" });
      const item = await storage.updateTimeOffRequest(req.params.id, {
        status: decision,
        reviewNote: reviewNote ?? null,
        reviewedBy: req.session.userId,
        reviewedAt: new Date(),
      });
      if (!item) return res.status(404).json({ message: "Not found" });

      try {
        const worker = await storage.getWorker(item.workerId);
        if (worker) {
          const email = worker.workEmail || worker.email || worker.homeEmail;
          const phone = worker.mobilePhone || worker.phone || worker.homePhone;
          const statusText = decision === "approved" ? "APPROVED" : "DENIED";
          const noteText = reviewNote ? `\nNote: ${reviewNote}` : "";
          const subject = `Time-Off Request ${statusText}`;
          const timeOffUrl = `${getAppBaseUrl(req)}/attendance?tab=time-off`;
          const bodyText = `Hi ${worker.firstName},\n\nYour time-off request from ${item.startDate} to ${item.endDate} has been ${statusText}.${noteText}\n\nView your requests: ${timeOffUrl}\n\nRegards,\nPayLink`;
          const { sendShiftMarketplaceEmail, sendShiftMarketplaceSms } = await import("./notifications.js");
          if (email) {
            await sendShiftMarketplaceEmail({
              recipientName: `${worker.firstName} ${worker.lastName}`,
              email,
              phone: null,
              subject,
              bodyText,
            });
          }
          if (phone) {
            await sendShiftMarketplaceSms({
              recipientName: `${worker.firstName} ${worker.lastName}`,
              email: null,
              phone,
              subject,
              bodyText: `Time-off ${item.startDate}–${item.endDate}: ${statusText}.${noteText}`,
            });
          }
        }
      } catch (notifyErr) {
        console.warn("Time-off review notification error:", notifyErr);
      }

      res.json(item);
    } catch (e) { res.status(500).json({ message: "Failed to review time-off request" }); }
  });

  app.delete("/api/time-off-requests/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteTimeOffRequest(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: "Failed to delete time-off request" }); }
  });

  // ── Schedule Preferences ───────────────────────────────────────────────────
  app.get("/api/schedule-preferences", requireAuth, async (req, res) => {
    try {
      const { companyId, workerId } = req.query as Record<string, string>;
      const items = await storage.getSchedulePreferences(companyId, workerId);
      res.json(items);
    } catch (e) { res.status(500).json({ message: "Failed to fetch schedule preferences" }); }
  });

  app.post("/api/schedule-preferences", requireAuth, async (req, res) => {
    try {
      const parsed = insertSchedulePreferenceSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      const item = await storage.createSchedulePreference(parsed.data);
      res.status(201).json(item);
    } catch (e) { res.status(500).json({ message: "Failed to create schedule preference" }); }
  });

  app.patch("/api/schedule-preferences/:id", requireAuth, async (req, res) => {
    try {
      const item = await storage.updateSchedulePreference(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (e) { res.status(500).json({ message: "Failed to update schedule preference" }); }
  });

  app.delete("/api/schedule-preferences/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteSchedulePreference(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: "Failed to delete schedule preference" }); }
  });

  app.get("/api/payroll-audit", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const issues: { severity: "error" | "warning" | "info"; category: string; message: string; entity?: string }[] = [];

      const companies = await storage.getCompanies();
      const targetCompanies = companyId ? companies.filter(c => c.id === companyId) : companies;

      for (const company of targetCompanies) {
        const legalEntities = await storage.getLegalEntities(company.id);
        if (legalEntities.length === 0) {
          issues.push({ severity: "warning", category: "Legal Entity", message: `${company.name} has no legal entity configured`, entity: company.name });
        }
        for (const le of legalEntities) {
          if (!le.ein) {
            issues.push({ severity: "error", category: "EIN Missing", message: `Legal entity "${le.name}" under ${company.name} has no EIN`, entity: le.name });
          }
        }

        const workers = await storage.getWorkers(company.id);
        for (const w of workers) {
          if (!w.ssn && w.workerType === "employee") {
            issues.push({ severity: "warning", category: "SSN Missing", message: `Employee ${w.firstName} ${w.lastName} has no SSN on file`, entity: `${w.firstName} ${w.lastName}` });
          }

          const wg = (w as any).workerGroup || "hourly_employee";
          const isContractorGroup = wg === "hourly_contractor" || wg === "invoiced_contractor";
          if (w.workerType === "contractor" && !isContractorGroup) {
            issues.push({ severity: "warning", category: "Classification Mismatch", message: `${w.firstName} ${w.lastName} is type "contractor" but group "${wg}" is not a contractor group`, entity: `${w.firstName} ${w.lastName}` });
          }
          if (w.workerType === "employee" && isContractorGroup) {
            issues.push({ severity: "warning", category: "Classification Mismatch", message: `${w.firstName} ${w.lastName} is type "employee" but group "${wg}" is a contractor group`, entity: `${w.firstName} ${w.lastName}` });
          }

          if (wg === "volunteer" && w.isActive) {
            const timeEntries = await storage.getTimeEntries(company.id);
            const volEntries = timeEntries.filter(te => te.workerId === w.id);
            if (volEntries.length > 0) {
              issues.push({ severity: "info", category: "Volunteer Time", message: `Volunteer ${w.firstName} ${w.lastName} has ${volEntries.length} time entries — ensure these are not included in taxable payroll`, entity: `${w.firstName} ${w.lastName}` });
            }
          }
        }

        const taxes = await storage.getTaxesDeductions(company.id);
        if (taxes.length === 0) {
          issues.push({ severity: "error", category: "Tax Setup", message: `${company.name} has no taxes/deductions configured`, entity: company.name });
        }

        const payrollRuns = await storage.getPayrollRuns(company.id);
        for (const run of payrollRuns) {
          if (run.status === "processed") {
            const items = await storage.getPayrollItems(run.id);
            for (const item of items) {
              const worker = workers.find(wk => wk.id === item.workerId);
              if (worker && worker.workerType === "contractor" && parseFloat(item.deductions || "0") > 0) {
                issues.push({ severity: "error", category: "Contractor Deductions", message: `Contractor ${worker.firstName} ${worker.lastName} has deductions in payroll run ${run.periodStart}–${run.periodEnd}`, entity: `${worker.firstName} ${worker.lastName}` });
              }
            }
          }
        }
      }

      const summary = {
        errors: issues.filter(i => i.severity === "error").length,
        warnings: issues.filter(i => i.severity === "warning").length,
        info: issues.filter(i => i.severity === "info").length,
        total: issues.length,
      };

      res.json({ summary, issues });
    } catch (error) {
      console.error("Payroll audit error:", error);
      res.status(500).json({ message: "Failed to run payroll audit" });
    }
  });

  // ── Shift Marketplace Listings ────────────────────────────────────────────
  app.get("/api/marketplace/listings", requireAuth, async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const status = req.query.status as string | undefined;
      const listings = await storage.getMarketplaceListings(companyId, status);
      res.json(listings);
    } catch (e) { res.status(500).json({ message: "Failed to fetch marketplace listings" }); }
  });

  app.get("/api/marketplace/listings/:id", requireAuth, async (req, res) => {
    try {
      const listing = await storage.getMarketplaceListing(req.params.id);
      if (!listing) return res.status(404).json({ message: "Not found" });
      res.json(listing);
    } catch (e) { res.status(500).json({ message: "Failed to fetch listing" }); }
  });

  app.post("/api/marketplace/listings", requireAuth, async (req, res) => {
    try {
      const data = req.body;
      if (!data.scheduleId || !data.companyId) {
        return res.status(400).json({ message: "scheduleId and companyId required" });
      }
      if (!data.employeeAcknowledgedResponsibility) {
        return res.status(400).json({ message: "Employee must acknowledge responsibility before posting" });
      }
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.status(403).json({ message: "No linked worker" });
      data.listedByWorkerId = user.workerId;
      const listing = await storage.createMarketplaceListing(data);

      await storage.createScheduleAuditLog({
        companyId: listing.companyId,
        actorUserId: req.session.userId,
        actionType: "listing_created",
        objectType: "marketplace_listing",
        objectId: listing.id,
        afterJson: JSON.stringify(listing),
      });

      res.status(201).json(listing);
    } catch (e) { res.status(500).json({ message: "Failed to create listing" }); }
  });

  app.patch("/api/marketplace/listings/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getMarketplaceListing(req.params.id);
      if (!existing) return res.status(404).json({ message: "Not found" });
      const user = await storage.getUser(req.session.userId!);
      const isOwner = user?.workerId === existing.listedByWorkerId;
      const isManager = user?.role === "admin" || user?.role === "manager";
      if (!isOwner && !isManager) return res.status(403).json({ message: "Not authorized" });
      const listing = await storage.updateMarketplaceListing(req.params.id, req.body);
      if (!listing) return res.status(404).json({ message: "Not found" });

      await storage.createScheduleAuditLog({
        companyId: listing.companyId,
        actorUserId: req.session.userId,
        actionType: req.body.status === "withdrawn" ? "listing_withdrawn" : "listing_updated",
        objectType: "marketplace_listing",
        objectId: listing.id,
        afterJson: JSON.stringify(listing),
      });

      res.json(listing);
    } catch (e) { res.status(500).json({ message: "Failed to update listing" }); }
  });

  // ── Shift Marketplace Requests ──────────────────────────────────────────
  app.get("/api/marketplace/requests", requireAuth, async (req, res) => {
    try {
      const listingId = req.query.listingId as string | undefined;
      const workerId = req.query.workerId as string | undefined;
      const requests = await storage.getMarketplaceRequests(listingId, workerId);
      res.json(requests);
    } catch (e) { res.status(500).json({ message: "Failed to fetch marketplace requests" }); }
  });

  app.post("/api/marketplace/requests", requireAuth, async (req, res) => {
    try {
      const data = req.body;
      if (!data.listingId) {
        return res.status(400).json({ message: "listingId required" });
      }
      const reqUser = await storage.getUser(req.session.userId!);
      if (!reqUser?.workerId) return res.status(403).json({ message: "No linked worker" });
      data.requestingWorkerId = reqUser.workerId;

      const listing = await storage.getMarketplaceListing(data.listingId);
      if (!listing) return res.status(404).json({ message: "Listing not found" });
      if (listing.status !== "open") return res.status(400).json({ message: "Listing is no longer open" });
      if (listing.listedByWorkerId === data.requestingWorkerId) return res.status(400).json({ message: "Cannot request your own listing" });

      const { evaluateEligibility } = await import("./eligibility.js");
      const candidate = await storage.getWorker(data.requestingWorkerId);
      const lister = await storage.getWorker(listing.listedByWorkerId);
      const schedule = await storage.getSchedule(listing.scheduleId);
      if (!candidate || !lister || !schedule) return res.status(404).json({ message: "Related data not found" });

      const candidateSchedules = (await storage.getSchedules(candidate.companyId || undefined)).filter(
        s => s.workerId === candidate.id
      );
      const candidateTimeOff = await storage.getTimeOffRequests(candidate.companyId || undefined, candidate.id);

      const weekStart = getWeekStart(schedule.date);
      const weekEnd = getWeekEnd(schedule.date);
      const weekSchedules = candidateSchedules.filter(s => s.date >= weekStart && s.date <= weekEnd);
      const weeklyHours = weekSchedules.reduce((sum, s) => {
        const [sh, sm] = s.startTime.split(":").map(Number);
        const [eh, em] = s.endTime.split(":").map(Number);
        let h = (eh * 60 + em - sh * 60 - sm) / 60;
        if (h < 0) h += 24;
        return sum + h;
      }, 0);

      let ruleSet = null;
      if (listing.eligibilityRuleSetId) {
        ruleSet = await storage.getEligibilityRuleSet(listing.eligibilityRuleSetId) ?? null;
      }

      const eligibility = evaluateEligibility({
        candidateWorker: candidate,
        listingWorker: lister,
        schedule,
        ruleSet,
        candidateSchedules,
        candidateTimeOff: candidateTimeOff.map(t => ({ startDate: t.startDate, endDate: t.endDate, status: t.status })),
        candidateWeeklyHours: weeklyHours,
      });

      if (!eligibility.eligible) {
        return res.status(403).json({
          message: "Not eligible for this shift",
          eligibility,
        });
      }

      const request = await storage.createMarketplaceRequest({
        ...data,
        eligibilitySnapshotJson: JSON.stringify(eligibility),
        status: "pending",
      });

      await storage.createScheduleAuditLog({
        companyId: listing.companyId,
        actorUserId: req.session.userId,
        actionType: "request_created",
        objectType: "marketplace_request",
        objectId: request.id,
        afterJson: JSON.stringify(request),
        metadataJson: JSON.stringify(eligibility),
      });

      res.status(201).json({ request, eligibility });
    } catch (e) {
      console.error("Marketplace request error:", e);
      res.status(500).json({ message: "Failed to create request" });
    }
  });

  app.patch("/api/marketplace/requests/:id/review", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const { decision, reviewNote } = req.body;
      if (!decision || !["approved", "denied"].includes(decision)) return res.status(400).json({ message: "decision must be 'approved' or 'denied'" });

      const request = await storage.getMarketplaceRequest(req.params.id);
      if (!request) return res.status(404).json({ message: "Not found" });
      if (request.status !== "pending") return res.status(409).json({ message: "Request already reviewed" });

      const listing = await storage.getMarketplaceListing(request.listingId);
      if (!listing) return res.status(404).json({ message: "Listing not found" });
      if (decision === "approved" && listing.status !== "open") return res.status(409).json({ message: "Listing is no longer open" });

      const updated = await storage.updateMarketplaceRequest(req.params.id, {
        status: decision,
        reviewedBy: req.session.userId,
        reviewedAt: new Date(),
        reviewNote: reviewNote ?? null,
      });

      if (decision === "approved") {
        await storage.updateMarketplaceListing(listing.id, {
          status: "filled",
          filledByWorkerId: request.requestingWorkerId,
          filledAt: new Date(),
          approvedBy: req.session.userId,
          approvedAt: new Date(),
        });

        const schedule = await storage.getSchedule(listing.scheduleId);
        if (schedule) {
          await storage.updateSchedule(listing.scheduleId, {
            workerId: request.requestingWorkerId,
          });
        }
      }

      await storage.createScheduleAuditLog({
        companyId: listing.companyId,
        actorUserId: req.session.userId,
        actionType: decision === "approved" ? "request_approved" : "request_denied",
        objectType: "marketplace_request",
        objectId: req.params.id,
        afterJson: JSON.stringify(updated),
        metadataJson: JSON.stringify({ reviewNote }),
      });

      res.json(updated);
    } catch (e) { res.status(500).json({ message: "Failed to review request" }); }
  });

  // ── Eligibility Check (preview) ─────────────────────────────────────────
  app.post("/api/marketplace/eligibility-check", requireAuth, async (req, res) => {
    try {
      const { listingId, workerId } = req.body;
      if (!listingId || !workerId) return res.status(400).json({ message: "listingId and workerId required" });

      const listing = await storage.getMarketplaceListing(listingId);
      if (!listing) return res.status(404).json({ message: "Listing not found" });

      const { evaluateEligibility } = await import("./eligibility.js");
      const candidate = await storage.getWorker(workerId);
      const lister = await storage.getWorker(listing.listedByWorkerId);
      const schedule = await storage.getSchedule(listing.scheduleId);
      if (!candidate || !lister || !schedule) return res.status(404).json({ message: "Related data not found" });

      const candidateSchedules = (await storage.getSchedules(candidate.companyId || undefined)).filter(
        s => s.workerId === candidate.id
      );
      const candidateTimeOff = await storage.getTimeOffRequests(candidate.companyId || undefined, candidate.id);

      const weekStart = getWeekStart(schedule.date);
      const weekEnd = getWeekEnd(schedule.date);
      const weekSchedules = candidateSchedules.filter(s => s.date >= weekStart && s.date <= weekEnd);
      const weeklyHours = weekSchedules.reduce((sum, s) => {
        const [sh, sm] = s.startTime.split(":").map(Number);
        const [eh, em] = s.endTime.split(":").map(Number);
        let h = (eh * 60 + em - sh * 60 - sm) / 60;
        if (h < 0) h += 24;
        return sum + h;
      }, 0);

      let ruleSet = null;
      if (listing.eligibilityRuleSetId) {
        ruleSet = await storage.getEligibilityRuleSet(listing.eligibilityRuleSetId) ?? null;
      }

      const eligibility = evaluateEligibility({
        candidateWorker: candidate,
        listingWorker: lister,
        schedule,
        ruleSet,
        candidateSchedules,
        candidateTimeOff: candidateTimeOff.map(t => ({ startDate: t.startDate, endDate: t.endDate, status: t.status })),
        candidateWeeklyHours: weeklyHours,
      });

      res.json(eligibility);
    } catch (e) { res.status(500).json({ message: "Failed to check eligibility" }); }
  });

  // ── Eligibility Rule Sets ───────────────────────────────────────────────
  app.get("/api/eligibility-rule-sets", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const sets = await storage.getEligibilityRuleSets(companyId);
      res.json(sets);
    } catch (e) { res.status(500).json({ message: "Failed to fetch eligibility rule sets" }); }
  });

  app.post("/api/eligibility-rule-sets", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const set = await storage.createEligibilityRuleSet(req.body);
      res.status(201).json(set);
    } catch (e) { res.status(500).json({ message: "Failed to create eligibility rule set" }); }
  });

  app.patch("/api/eligibility-rule-sets/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const set = await storage.updateEligibilityRuleSet(req.params.id, req.body);
      if (!set) return res.status(404).json({ message: "Not found" });
      res.json(set);
    } catch (e) { res.status(500).json({ message: "Failed to update eligibility rule set" }); }
  });

  app.delete("/api/eligibility-rule-sets/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteEligibilityRuleSet(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: "Failed to delete eligibility rule set" }); }
  });

  // ── Schedule Audit Logs ─────────────────────────────────────────────────
  app.get("/api/schedule-audit-logs", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const logs = await storage.getScheduleAuditLogs(companyId, limit);
      res.json(logs);
    } catch (e) { res.status(500).json({ message: "Failed to fetch audit logs" }); }
  });

  // ── Notification Preferences ────────────────────────────────────────────
  app.get("/api/notification-preferences/:workerId", requireAuth, async (req, res) => {
    try {
      const prefs = await storage.getNotificationPreferences(req.params.workerId);
      res.json(prefs);
    } catch (e) { res.status(500).json({ message: "Failed to fetch notification preferences" }); }
  });

  app.post("/api/notification-preferences", requireAuth, async (req, res) => {
    try {
      const pref = await storage.upsertNotificationPreference(req.body);
      res.json(pref);
    } catch (e) { res.status(500).json({ message: "Failed to save notification preference" }); }
  });

  // ── Trial Signup (public, no auth) ─────────────────────────────────────
  app.post("/api/trial/signup", async (req, res) => {
    try {
      const { companyName, firstName, lastName, email, phone, jobTitle, employeeCount, termsAccepted, password } = req.body;
      if (!companyName || !firstName || !lastName || !email) {
        return res.status(400).json({ message: "Company name, first name, last name, and email are required" });
      }
      if (!termsAccepted) {
        return res.status(400).json({ message: "You must accept the Terms of Service and Privacy Policy" });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Please provide a valid email address" });
      }

      if (password && password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }

      const existingRows = await db.execute(sql`SELECT id FROM trial_signups WHERE email = ${email} LIMIT 1`);
      if (existingRows.rows.length > 0) {
        return res.status(409).json({ message: "An account with this email already exists. Please log in instead." });
      }

      const now = new Date();
      const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const baseUsername = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
      let username = baseUsername + Math.floor(Math.random() * 1000);
      const existingUser = await db.execute(sql`SELECT id FROM users WHERE username = ${username} LIMIT 1`);
      if (existingUser.rows.length > 0) {
        username = baseUsername + Date.now().toString(36);
      }
      const tempPassword = password || ("Trial" + Math.random().toString(36).substring(2, 10) + "!");
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      let companyId: string;
      let userId: string;

      await db.execute(sql`BEGIN`);
      try {
        const companyResult = await db.execute(sql`
          INSERT INTO companies (name, subscription_status, plan_name, trial_start, trial_end, trial_used, billing_active, is_demo)
          VALUES (${companyName}, 'trial_active', 'starter', ${now}, ${trialEnd}, FALSE, FALSE, FALSE)
          RETURNING id
        `);
        companyId = companyResult.rows[0].id as string;

        const userResult = await db.execute(sql`
          INSERT INTO users (username, password, role, company_id)
          VALUES (${username}, ${hashedPassword}, 'admin', ${companyId})
          RETURNING id
        `);
        userId = userResult.rows[0].id as string;

        await db.execute(sql`
          INSERT INTO trial_signups (company_name, employee_count, first_name, last_name, job_title, email, phone, company_id, user_id, trial_start, trial_end, subscription_status, terms_accepted_at, terms_version, privacy_version, signup_ip)
          VALUES (${companyName}, ${employeeCount || null}, ${firstName}, ${lastName}, ${jobTitle || null}, ${email}, ${phone || null}, ${companyId}, ${userId}, ${now}, ${trialEnd}, 'trial_active', ${now}, '1.0', '1.0', ${req.ip || null})
        `);

        await db.execute(sql`
          INSERT INTO onboarding_progress (company_id, user_id)
          VALUES (${companyId}, ${userId})
        `);

        await db.execute(sql`
          INSERT INTO analytics_events (event_name, user_id, company_id, page_source, metadata)
          VALUES ('signup_completed', ${userId}, ${companyId}, 'signup', ${JSON.stringify({ plan: 'starter', employeeCount })})
        `);

        await db.execute(sql`COMMIT`);
      } catch (txErr) {
        await db.execute(sql`ROLLBACK`);
        throw txErr;
      }

      res.json({
        message: "Trial account created successfully",
        username,
        temporaryPassword: tempPassword,
        companyId,
        trialEnd: trialEnd.toISOString(),
        loginUrl: `${getAppBaseUrl(req)}/app`
      });
    } catch (e) {
      console.error("Trial signup error:", e);
      res.status(500).json({ message: safeErrorMessage(e, "Failed to create trial account") });
    }
  });

  // ── Trial Status Check ─────────────────────────────────────────────────
  app.get("/api/trial/status", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.companyId) return res.json({ subscriptionStatus: "active_paid", isTrial: false });

      const companyRows = await db.execute(sql`
        SELECT subscription_status, plan_name, trial_start, trial_end, trial_used, billing_active, payment_method_on_file, is_demo
        FROM companies WHERE id = ${user.companyId}
      `);
      if (companyRows.rows.length === 0) return res.json({ subscriptionStatus: "active_paid", isTrial: false });

      const company = companyRows.rows[0] as any;
      const now = new Date();
      const trialEnd = company.trial_end ? new Date(company.trial_end) : null;
      let status = company.subscription_status || "active_paid";

      if (status === "trial_active" && trialEnd && now > trialEnd) {
        status = "trial_expired";
        await db.execute(sql`UPDATE companies SET subscription_status = 'trial_expired', trial_used = TRUE WHERE id = ${user.companyId}`);
      }

      const trialSignup = await db.execute(sql`SELECT first_name, last_name FROM trial_signups WHERE company_id = ${user.companyId} LIMIT 1`);

      let daysRemaining = 0;
      if (trialEnd && status === "trial_active") {
        daysRemaining = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      }

      res.json({
        subscriptionStatus: status,
        planName: company.plan_name || "starter",
        isTrial: status === "trial_active",
        isTrialExpired: status === "trial_expired",
        isDemo: company.is_demo || false,
        trialEnd: company.trial_end,
        daysRemaining,
        billingActive: company.billing_active || false,
        paymentMethodOnFile: company.payment_method_on_file || false,
        contactName: trialSignup.rows[0] ? `${trialSignup.rows[0].first_name} ${trialSignup.rows[0].last_name}` : null,
      });
    } catch (e) {
      res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch trial status") });
    }
  });

  // ── Onboarding Progress ────────────────────────────────────────────────
  app.get("/api/onboarding/progress", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.companyId) return res.json(null);

      const rows = await db.execute(sql`
        SELECT * FROM onboarding_progress WHERE company_id = ${user.companyId} AND user_id = ${user.id} LIMIT 1
      `);
      res.json(rows.rows[0] || null);
    } catch (e) {
      res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch onboarding progress") });
    }
  });

  app.patch("/api/onboarding/progress", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.companyId) return res.status(400).json({ message: "No company associated" });

      const { step } = req.body;
      const stepQueries: Record<string, any> = {
        step_company_details: sql`UPDATE onboarding_progress SET step_company_details = TRUE WHERE company_id = ${user.companyId} AND user_id = ${user.id}`,
        step_first_employee: sql`UPDATE onboarding_progress SET step_first_employee = TRUE WHERE company_id = ${user.companyId} AND user_id = ${user.id}`,
        step_pay_schedule: sql`UPDATE onboarding_progress SET step_pay_schedule = TRUE WHERE company_id = ${user.companyId} AND user_id = ${user.id}`,
        step_payroll_config: sql`UPDATE onboarding_progress SET step_payroll_config = TRUE WHERE company_id = ${user.companyId} AND user_id = ${user.id}`,
        step_time_clock: sql`UPDATE onboarding_progress SET step_time_clock = TRUE WHERE company_id = ${user.companyId} AND user_id = ${user.id}`,
        step_payroll_preview: sql`UPDATE onboarding_progress SET step_payroll_preview = TRUE WHERE company_id = ${user.companyId} AND user_id = ${user.id}`,
        step_bank_connected: sql`UPDATE onboarding_progress SET step_bank_connected = TRUE WHERE company_id = ${user.companyId} AND user_id = ${user.id}`,
      };
      if (!stepQueries[step]) return res.status(400).json({ message: "Invalid step" });

      await db.execute(stepQueries[step]);

      const allDone = await db.execute(sql`
        SELECT * FROM onboarding_progress WHERE company_id = ${user.companyId} AND user_id = ${user.id}
        AND step_company_details = TRUE AND step_first_employee = TRUE AND step_pay_schedule = TRUE
        AND step_payroll_config = TRUE AND step_time_clock = TRUE AND step_payroll_preview = TRUE
        LIMIT 1
      `);
      if (allDone.rows.length > 0) {
        await db.execute(sql`UPDATE onboarding_progress SET completed_at = NOW() WHERE company_id = ${user.companyId} AND user_id = ${user.id}`);
      }

      res.json({ message: "Step completed", step });
    } catch (e) {
      res.status(500).json({ message: safeErrorMessage(e, "Failed to update onboarding progress") });
    }
  });

  app.post("/api/onboarding/business-info", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.companyId) return res.status(400).json({ message: "No company associated" });

      const { companyName, businessType, state, employeeCount, ein, address, city, zip, phone } = req.body;
      if (!companyName) return res.status(400).json({ message: "Company name is required" });

      await db.execute(sql`
        UPDATE companies SET
          name = ${companyName},
          entity_type = ${businessType || 'llc'},
          state = ${state || null},
          ein = ${ein || null},
          address = ${address || null},
          city = ${city || null},
          zip = ${zip || null},
          phone = ${phone || null}
        WHERE id = ${user.companyId}
      `);

      await db.execute(sql`
        UPDATE onboarding_progress SET
          step_company_details = TRUE,
          business_type = ${businessType || null},
          employee_count = ${employeeCount ? parseInt(employeeCount) : null}
        WHERE company_id = ${user.companyId} AND user_id = ${user.id}
      `);

      res.json({ message: "Business info saved" });
    } catch (e) {
      res.status(500).json({ message: safeErrorMessage(e, "Failed to save business info") });
    }
  });

  app.post("/api/onboarding/add-employees-csv", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.companyId) return res.status(400).json({ message: "No company associated" });

      const { employees } = req.body;
      if (!Array.isArray(employees) || employees.length === 0) {
        return res.status(400).json({ message: "At least one employee is required" });
      }

      const created = [];
      for (const emp of employees) {
        if (!emp.firstName || !emp.lastName) continue;
        const worker = await storage.createWorker({
          companyId: user.companyId,
          firstName: emp.firstName,
          lastName: emp.lastName,
          email: emp.email || null,
          phone: emp.phone || null,
          workerType: emp.workerType || "employee",
          payRate: emp.payRate || "0",
          payType: emp.payType || "hourly",
          jobTitle: emp.jobTitle || null,
          department: emp.department || null,
          hireDate: emp.hireDate || new Date().toISOString().split("T")[0],
          status: "active",
          isActive: true,
        });
        created.push(worker);
      }

      if (created.length > 0) {
        await db.execute(sql`
          UPDATE onboarding_progress SET step_first_employee = TRUE
          WHERE company_id = ${user.companyId} AND user_id = ${user.id}
        `);
      }

      res.json({ message: `${created.length} employee(s) added`, count: created.length });
    } catch (e) {
      res.status(500).json({ message: safeErrorMessage(e, "Failed to add employees") });
    }
  });

  app.post("/api/onboarding/bank-info", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.companyId) return res.status(400).json({ message: "No company associated" });

      const { bankName, routingNumber, accountNumber, accountType } = req.body;

      await db.execute(sql`
        INSERT INTO funding_accounts (company_id, account_name, bank_name, routing_number, account_number, account_type, is_primary, is_verified)
        VALUES (${user.companyId}, ${bankName || 'Primary Account'}, ${bankName || null}, ${routingNumber || null}, ${accountNumber || null}, ${accountType || 'checking'}, TRUE, FALSE)
        ON CONFLICT DO NOTHING
      `);

      await db.execute(sql`
        UPDATE onboarding_progress SET step_bank_connected = TRUE
        WHERE company_id = ${user.companyId} AND user_id = ${user.id}
      `);

      res.json({ message: "Bank info saved" });
    } catch (e) {
      res.status(500).json({ message: safeErrorMessage(e, "Failed to save bank info") });
    }
  });

  app.post("/api/onboarding/payroll-setup", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.companyId) return res.status(400).json({ message: "No company associated" });

      const { payFrequency, overtimeThreshold, overtimeMultiplier } = req.body;

      await db.execute(sql`
        UPDATE companies SET
          pay_frequency = ${payFrequency || 'biweekly'},
          overtime_threshold = ${overtimeThreshold ? parseInt(overtimeThreshold) : 40},
          overtime_multiplier = ${overtimeMultiplier || '1.5'}
        WHERE id = ${user.companyId}
      `);

      await db.execute(sql`
        UPDATE onboarding_progress SET step_pay_schedule = TRUE, step_payroll_config = TRUE
        WHERE company_id = ${user.companyId} AND user_id = ${user.id}
      `);

      res.json({ message: "Payroll setup saved" });
    } catch (e) {
      res.status(500).json({ message: safeErrorMessage(e, "Failed to save payroll setup") });
    }
  });

  app.get("/api/onboarding/payroll-preview", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.companyId) return res.status(400).json({ message: "No company associated" });

      const companyResult = await db.execute(sql`SELECT * FROM companies WHERE id = ${user.companyId} LIMIT 1`);
      const company = companyResult.rows[0];

      const workersResult = await db.execute(sql`
        SELECT id, first_name, last_name, pay_rate, pay_type, worker_type, job_title, department
        FROM workers WHERE company_id = ${user.companyId} AND is_active = TRUE
        ORDER BY last_name, first_name LIMIT 50
      `);

      const payFreq = (company?.pay_frequency as string) || "biweekly";
      const hoursPerPeriod: Record<string, number> = {
        weekly: 40, biweekly: 80, semimonthly: 86.67, monthly: 173.33
      };
      const periodHours = hoursPerPeriod[payFreq] || 80;

      const preview = workersResult.rows.map((w: any) => {
        const rate = parseFloat(w.pay_rate) || 0;
        const isHourly = w.pay_type === "hourly";
        const grossPay = isHourly ? rate * periodHours : rate / (payFreq === "weekly" ? 52 : payFreq === "biweekly" ? 26 : payFreq === "semimonthly" ? 24 : 12);
        const estFedTax = grossPay * 0.12;
        const estStateTax = grossPay * 0.04;
        const estFica = grossPay * 0.0765;
        const netPay = grossPay - estFedTax - estStateTax - estFica;

        return {
          id: w.id,
          name: `${w.first_name} ${w.last_name}`,
          jobTitle: w.job_title,
          department: w.department,
          payType: w.pay_type,
          payRate: rate,
          workerType: w.worker_type,
          hours: isHourly ? periodHours : null,
          grossPay: Math.round(grossPay * 100) / 100,
          federalTax: Math.round(estFedTax * 100) / 100,
          stateTax: Math.round(estStateTax * 100) / 100,
          fica: Math.round(estFica * 100) / 100,
          netPay: Math.round(netPay * 100) / 100,
        };
      });

      res.json({
        payFrequency: payFreq,
        periodHours,
        employees: preview,
        totalGross: preview.reduce((s, p) => s + p.grossPay, 0),
        totalNet: preview.reduce((s, p) => s + p.netPay, 0),
        totalTaxes: preview.reduce((s, p) => s + p.federalTax + p.stateTax + p.fica, 0),
      });
    } catch (e) {
      res.status(500).json({ message: safeErrorMessage(e, "Failed to generate payroll preview") });
    }
  });

  app.post("/api/onboarding/complete-wizard", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.companyId) return res.status(400).json({ message: "No company associated" });

      await db.execute(sql`
        UPDATE onboarding_progress SET
          onboarding_wizard_completed = TRUE,
          step_payroll_preview = TRUE,
          completed_at = NOW()
        WHERE company_id = ${user.companyId} AND user_id = ${user.id}
      `);

      res.json({ message: "Onboarding wizard completed" });
    } catch (e) {
      res.status(500).json({ message: safeErrorMessage(e, "Failed to complete wizard") });
    }
  });

  // ── Analytics Events (public for pre-auth, auth for in-app) ────────────
  app.post("/api/analytics/event", async (req, res) => {
    try {
      const { eventName, pageSource, metadata, sessionId } = req.body;
      if (!eventName || typeof eventName !== "string") return res.status(400).json({ message: "eventName is required" });
      const validEvents = ["pricing_page_view", "signup_started", "signup_completed", "trial_started", "view_demo_click", "demo_started", "subscription_activated"];
      if (!validEvents.includes(eventName)) return res.status(400).json({ message: "Invalid event name" });

      await db.execute(sql`
        INSERT INTO analytics_events (event_name, user_id, company_id, page_source, metadata, session_id, ip_address)
        VALUES (${eventName}, ${req.session?.userId || null}, ${null}, ${pageSource || null}, ${metadata ? JSON.stringify(metadata) : null}, ${sessionId || null}, ${req.ip || null})
      `);
      res.json({ message: "Event recorded" });
    } catch (e) {
      res.status(500).json({ message: "Failed to record event" });
    }
  });

  // ── Demo Login (public, creates temp demo session) ─────────────────────
  app.post("/api/demo/login", async (req, res) => {
    try {
      let demoCompanyRows = await db.execute(sql`SELECT id FROM companies WHERE is_demo = TRUE LIMIT 1`);
      let demoCompanyId: string;

      if (demoCompanyRows.rows.length === 0) {
        const result = await db.execute(sql`
          INSERT INTO companies (name, subscription_status, plan_name, is_demo, pay_frequency, overtime_threshold)
          VALUES ('Demo Company', 'active_paid', 'starter', TRUE, 'biweekly', 40)
          RETURNING id
        `);
        demoCompanyId = result.rows[0].id as string;

        const demoPass = await bcrypt.hash("demo123", 10);
        await db.execute(sql`
          INSERT INTO users (username, password, role, company_id)
          VALUES ('demo_admin', ${demoPass}, 'admin', ${demoCompanyId})
          ON CONFLICT (username) DO NOTHING
        `);

        const names = [
          { first: "Sarah", last: "Johnson", type: "employee" },
          { first: "Michael", last: "Chen", type: "employee" },
          { first: "Emily", last: "Rodriguez", type: "employee" },
          { first: "James", last: "Wilson", type: "employee" },
          { first: "Lisa", last: "Thompson", type: "contractor" },
        ];
        for (const n of names) {
          await db.execute(sql`
            INSERT INTO workers (company_id, first_name, last_name, worker_type, status, hire_date, hourly_rate, worker_group)
            VALUES (${demoCompanyId}, ${n.first}, ${n.last}, ${n.type}, 'active', '2024-01-15', '25.00', ${n.type === 'contractor' ? 'hourly_contractor' : 'hourly_employee'})
          `);
        }
      } else {
        demoCompanyId = demoCompanyRows.rows[0].id as string;
      }

      const demoUserRows = await db.execute(sql`SELECT id, username, role FROM users WHERE username = 'demo_admin' LIMIT 1`);
      if (demoUserRows.rows.length === 0) {
        return res.status(500).json({ message: "Demo environment not ready" });
      }

      const demoUser = demoUserRows.rows[0] as any;
      req.session.userId = demoUser.id;
      req.session.role = demoUser.role;
      req.session.isDemo = true;

      await db.execute(sql`
        INSERT INTO analytics_events (event_name, page_source, ip_address)
        VALUES ('demo_started', 'demo', ${req.ip || null})
      `);

      res.json({
        message: "Demo session started",
        user: { id: demoUser.id, username: demoUser.username, role: demoUser.role, companyId: demoCompanyId },
        isDemo: true,
      });
    } catch (e) {
      console.error("Demo login error:", e);
      res.status(500).json({ message: safeErrorMessage(e, "Failed to start demo") });
    }
  });

  // ── Demo Provision (public, creates fully seeded demo tenant) ─────────────
  app.post("/api/demo/provision", async (req, res) => {
    try {
      const demoPass = await bcrypt.hash("demo123", 10);
      const demoExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const demoUsername = 'demo_' + crypto.randomBytes(4).toString('hex');
      const portalToken = crypto.randomBytes(32).toString("hex");

      const result = await db.transaction(async (tx) => {
        const companyResult = await tx.execute(sql`
          INSERT INTO companies (name, subscription_status, plan_name, is_demo, pay_frequency, overtime_threshold, trial_end)
          VALUES ('Demo Company', 'active_paid', 'professional', TRUE, 'biweekly', 40, ${demoExpiration})
          RETURNING id
        `);
        const companyId = companyResult.rows[0].id as string;

        const userResult = await tx.execute(sql`
          INSERT INTO users (username, password, role, company_id)
          VALUES (${demoUsername}, ${demoPass}, 'admin', ${companyId})
          RETURNING id, username
        `);
        const adminUser = userResult.rows[0] as any;

        const workerData = [
          { first: "Sarah", last: "Johnson", type: "employee", email: "sarah@demo.paylink.app", rate: "28.00" },
          { first: "Michael", last: "Chen", type: "employee", email: "michael@demo.paylink.app", rate: "32.00" },
          { first: "Emily", last: "Rodriguez", type: "contractor", email: "emily@demo.paylink.app", rate: "45.00" },
        ];
        const workerIds: string[] = [];
        for (const w of workerData) {
          const wResult = await tx.execute(sql`
            INSERT INTO workers (company_id, first_name, last_name, worker_type, status, hire_date, pay_rate, email, worker_group)
            VALUES (${companyId}, ${w.first}, ${w.last}, ${w.type}, 'active', '2025-01-15', ${w.rate}, ${w.email}, ${w.type === 'contractor' ? 'hourly_contractor' : 'hourly_employee'})
            RETURNING id
          `);
          workerIds.push(wResult.rows[0].id as string);
        }

        const folderNames = [
          { name: "HR Documents", category: "hr", color: "#3B82F6" },
          { name: "Legal", category: "legal", color: "#8B5CF6" },
          { name: "Finance", category: "finance", color: "#10B981" },
        ];
        const folderIds: Record<string, string> = {};
        for (const f of folderNames) {
          const fResult = await tx.execute(sql`
            INSERT INTO document_folders (company_id, name, category, color)
            VALUES (${companyId}, ${f.name}, ${f.category}, ${f.color})
            RETURNING id
          `);
          folderIds[f.category] = fResult.rows[0].id as string;
        }

        const sampleDocs = [
          { title: "Offer Letter Template", fileName: "offer_letter_template.pdf", folder: "hr", isTemplate: true },
          { title: "W-4 Tax Withholding Form", fileName: "w4_template.pdf", folder: "hr", isTemplate: true },
          { title: "I-9 Employment Eligibility", fileName: "i9_template.pdf", folder: "hr", isTemplate: true },
          { title: "Non-Disclosure Agreement", fileName: "nda_template.pdf", folder: "legal", isTemplate: true },
        ];
        for (const doc of sampleDocs) {
          await tx.execute(sql`
            INSERT INTO documents (company_id, folder_id, title, file_name, file_url, is_template, status, category)
            VALUES (${companyId}, ${folderIds[doc.folder]}, ${doc.title}, ${doc.fileName}, ${'/demo/' + doc.fileName}, ${doc.isTemplate}, 'active', ${doc.folder})
          `);
        }

        const empPacketResult = await tx.execute(sql`
          INSERT INTO onboarding_packets (company_id, worker_id, template_name, status, assigned_by)
          VALUES (${companyId}, ${workerIds[0]}, 'Standard Onboarding', 'in_progress', ${adminUser.id})
          RETURNING id
        `);
        const empPacketId = empPacketResult.rows[0].id as string;

        const empSteps = [
          { name: "Offer Letter", type: "document_sign", desc: "Sign the employment offer letter" },
          { name: "W-4 Tax Withholding", type: "document_upload", desc: "Complete W-4 federal tax withholding form" },
          { name: "I-9 Verification", type: "document_upload", desc: "Complete employment eligibility verification" },
          { name: "Direct Deposit Setup", type: "document_upload", desc: "Provide banking information for direct deposit" },
          { name: "Employee Handbook", type: "document_sign", desc: "Read and sign the employee handbook" },
          { name: "Benefits Enrollment", type: "task_complete", desc: "Review and select benefit options" },
        ];
        for (let i = 0; i < empSteps.length; i++) {
          const stepStatus = i === 0 ? "completed" : (i === 1 ? "in_progress" : "pending");
          await tx.execute(sql`
            INSERT INTO onboarding_packet_steps (packet_id, step_name, step_type, description, sort_order, status, assigned_to)
            VALUES (${empPacketId}, ${empSteps[i].name}, ${empSteps[i].type}, ${empSteps[i].desc}, ${i}, ${stepStatus}, ${workerIds[0]})
          `);
        }

        const conPacketResult = await tx.execute(sql`
          INSERT INTO onboarding_packets (company_id, worker_id, template_name, status, assigned_by)
          VALUES (${companyId}, ${workerIds[2]}, 'Contractor Onboarding', 'pending', ${adminUser.id})
          RETURNING id
        `);
        const conPacketId = conPacketResult.rows[0].id as string;

        const conSteps = [
          { name: "Contractor Agreement", type: "document_sign", desc: "Sign the independent contractor agreement" },
          { name: "W-9 Form", type: "document_upload", desc: "Complete W-9 tax form" },
          { name: "NDA", type: "document_sign", desc: "Sign non-disclosure agreement" },
        ];
        for (let i = 0; i < conSteps.length; i++) {
          await tx.execute(sql`
            INSERT INTO onboarding_packet_steps (packet_id, step_name, step_type, description, sort_order, status, assigned_to)
            VALUES (${conPacketId}, ${conSteps[i].name}, ${conSteps[i].type}, ${conSteps[i].desc}, ${i}, 'pending', ${workerIds[2]})
          `);
        }

        await tx.execute(sql`
          INSERT INTO portal_access_tokens (company_id, token, token_type, expires_at)
          VALUES (${companyId}, ${portalToken}, 'onboarding_packet', ${demoExpiration})
        `);

        await tx.execute(sql`
          INSERT INTO analytics_events (event_name, page_source, ip_address)
          VALUES ('demo_provisioned', 'demo', ${req.ip || null})
        `);

        return { companyId, adminUser };
      });

      req.session.userId = result.adminUser.id;
      req.session.username = result.adminUser.username;
      req.session.isDemo = true;

      const baseUrl = getAppBaseUrl(req);

      res.json({
        message: "Demo tenant provisioned",
        companyId: result.companyId,
        loginUrl: baseUrl,
        portalUrl: `${baseUrl}/portal?token=${portalToken}`,
        expiresAt: demoExpiration.toISOString(),
        user: { id: result.adminUser.id, username: result.adminUser.username, role: "admin", companyId: result.companyId },
        isDemo: true,
      });
    } catch (e) {
      console.error("Demo provision error:", e);
      res.status(500).json({ message: safeErrorMessage(e, "Failed to provision demo") });
    }
  });

  // ── Webhook Config CRUD ───────────────────────────────────────────────
  app.get("/api/webhook-configs", requireAuth, enforceCompanyScope("query"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const configs = await storage.getCompanyWebhookConfigs(companyId);
      res.json(configs);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch webhook configs") }); }
  });

  app.post("/api/webhook-configs", requireAuth, requireRole("admin"), blockDemoWrites, enforceCompanyScope("body"), async (req, res) => {
    try {
      if (!req.body.webhookUrl) return res.status(400).json({ message: "webhookUrl is required" });
      const { isValidWebhookUrl } = await import("./integrationEvents");
      if (!isValidWebhookUrl(req.body.webhookUrl)) {
        return res.status(400).json({ message: "Webhook URL must use HTTPS and not target private/internal networks" });
      }
      const hmacSecret = req.body.hmacSecret || crypto.randomBytes(32).toString("hex");
      const config = await storage.createCompanyWebhookConfig({
        companyId: (req as any)._companyId,
        webhookUrl: req.body.webhookUrl,
        hmacSecret,
        isActive: req.body.isActive ?? true,
      });
      res.status(201).json(config);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create webhook config") }); }
  });

  app.patch("/api/webhook-configs/:id", requireAuth, requireRole("admin"), blockDemoWrites, async (req, res) => {
    try {
      const config = await storage.getCompanyWebhookConfig(req.params.id);
      if (!config) return res.status(404).json({ message: "Webhook config not found" });
      const sessionCompanyId = await getSessionCompanyId(req);
      if (config.companyId !== sessionCompanyId) return res.status(403).json({ message: "Access denied" });
      const r = await storage.updateCompanyWebhookConfig(req.params.id, req.body);
      res.json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update webhook config") }); }
  });

  app.delete("/api/webhook-configs/:id", requireAuth, requireRole("admin"), blockDemoWrites, async (req, res) => {
    try {
      const config = await storage.getCompanyWebhookConfig(req.params.id);
      if (!config) return res.status(404).json({ message: "Webhook config not found" });
      const sessionCompanyId = await getSessionCompanyId(req);
      if (config.companyId !== sessionCompanyId) return res.status(403).json({ message: "Access denied" });
      await storage.deleteCompanyWebhookConfig(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete webhook config") }); }
  });

  // ── Integration Events ───────────────────────────────────────────────
  app.get("/api/integration-events", requireAuth, enforceCompanyScope("query"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const events = await storage.getIntegrationEvents(companyId);
      res.json(events);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch integration events") }); }
  });

  app.post("/api/integration-events/:id/retry", requireAuth, requireRole("admin"), blockDemoWrites, async (req, res) => {
    try {
      const event = await storage.getIntegrationEvent(req.params.id);
      if (!event) return res.status(404).json({ message: "Event not found" });
      const sessionCompanyId = await getSessionCompanyId(req);
      if (event.companyId !== sessionCompanyId) return res.status(403).json({ message: "Access denied" });
      await storage.updateIntegrationEvent(req.params.id, { status: "pending", errorMessage: null });
      const { retryIntegrationEvent } = await import("./integrationEvents");
      retryIntegrationEvent(event).catch(() => {});
      res.json({ message: "Retry queued" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to retry event") }); }
  });

  // ── Subscription / Billing Status Update ───────────────────────────────
  app.post("/api/billing/activate", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.companyId) return res.status(400).json({ message: "No company associated" });

      await db.execute(sql`
        UPDATE companies
        SET subscription_status = 'active_paid', billing_active = TRUE, payment_method_on_file = TRUE
        WHERE id = ${user.companyId}
      `);

      await db.execute(sql`
        UPDATE trial_signups SET subscription_status = 'active_paid', billing_active = TRUE, payment_method_on_file = TRUE
        WHERE company_id = ${user.companyId}
      `);

      await db.execute(sql`
        INSERT INTO analytics_events (event_name, user_id, company_id, page_source)
        VALUES ('subscription_activated', ${user.id}, ${user.companyId}, 'billing')
      `);

      res.json({ message: "Subscription activated", subscriptionStatus: "active_paid" });
    } catch (e) {
      res.status(500).json({ message: safeErrorMessage(e, "Failed to activate billing") });
    }
  });

  app.get("/api/billing/summary", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.companyId) return res.status(400).json({ message: "No company associated" });

      const countResult = await db.execute(sql`
        SELECT COUNT(*) as count FROM workers
        WHERE company_id = ${user.companyId} AND status = 'active'
      `);
      const billableEmployeeCount = parseInt(countResult.rows[0]?.count as string) || 0;

      const companyResult = await db.execute(sql`
        SELECT subscription_status, plan_name, trial_start, trial_end, billing_active, payment_method_on_file
        FROM companies WHERE id = ${user.companyId}
      `);
      const company = companyResult.rows[0] as any;

      const basePrice = 29;
      const perEmployeePrice = 4;
      const projectedMonthly = basePrice + (billableEmployeeCount * perEmployeePrice);

      res.json({
        billableEmployeeCount,
        basePrice,
        perEmployeePrice,
        projectedMonthly,
        subscriptionStatus: company?.subscription_status || "active_paid",
        planName: company?.plan_name || "starter",
        billingActive: company?.billing_active || false,
        trialStart: company?.trial_start,
        trialEnd: company?.trial_end,
      });
    } catch (e) {
      res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch billing summary") });
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // CUSTOMERS
  // ══════════════════════════════════════════════════════════════════════
  app.get("/api/customers", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const customerType = req.query.customerType as string | undefined;
      if (!companyId) return res.status(400).json({ message: "companyId is required" });
      const rows = await storage.getCustomers(companyId, customerType);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch customers") }); }
  });

  app.get("/api/customers/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const r = await storage.getCustomer(req.params.id);
      if (!r) return res.status(404).json({ message: "Customer not found" });
      const user = await storage.getUser(req.session.userId!);
      if (user?.companyId && r.companyId !== user.companyId) return res.status(403).json({ message: "Access denied" });
      res.json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch customer") }); }
  });

  app.post("/api/customers", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      const r = await storage.createCustomer(req.body);
      res.status(201).json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create customer") }); }
  });

  app.patch("/api/customers/:id", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      const r = await storage.updateCustomer(req.params.id, req.body);
      if (!r) return res.status(404).json({ message: "Customer not found" });
      res.json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update customer") }); }
  });

  app.delete("/api/customers/:id", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      await storage.deleteCustomer(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete customer") }); }
  });

  // ══════════════════════════════════════════════════════════════════════
  // INVOICE TEMPLATES
  // ══════════════════════════════════════════════════════════════════════
  app.get("/api/invoice-templates", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const rows = await storage.getInvoiceTemplates(companyId);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch invoice templates") }); }
  });

  app.post("/api/invoice-templates", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      const r = await storage.createInvoiceTemplate(req.body);
      res.status(201).json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create invoice template") }); }
  });

  app.patch("/api/invoice-templates/:id", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      const r = await storage.updateInvoiceTemplate(req.params.id, req.body);
      if (!r) return res.status(404).json({ message: "Template not found" });
      res.json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update invoice template") }); }
  });

  app.delete("/api/invoice-templates/:id", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      await storage.deleteInvoiceTemplate(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete invoice template") }); }
  });

  // ══════════════════════════════════════════════════════════════════════
  // INVOICES
  // ══════════════════════════════════════════════════════════════════════
  app.get("/api/invoices", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      if (!companyId) return res.status(400).json({ message: "companyId is required" });
      const rows = await storage.getInvoices(companyId);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch invoices") }); }
  });

  app.get("/api/invoices/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const r = await storage.getInvoice(req.params.id);
      if (!r) return res.status(404).json({ message: "Invoice not found" });
      const user = await storage.getUser(req.session.userId!);
      if (user?.companyId && r.companyId !== user.companyId) return res.status(403).json({ message: "Access denied" });
      const lineItems = await storage.getInvoiceLineItems(req.params.id);
      res.json({ ...r, lineItems });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch invoice") }); }
  });

  app.post("/api/invoices", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      const { lineItems, ...invoiceData } = req.body;
      const invoice = await storage.createInvoice(invoiceData);
      if (lineItems && Array.isArray(lineItems)) {
        for (const item of lineItems) {
          await storage.createInvoiceLineItem({ ...item, invoiceId: invoice.id });
        }
      }
      const items = await storage.getInvoiceLineItems(invoice.id);
      res.status(201).json({ ...invoice, lineItems: items });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create invoice") }); }
  });

  app.patch("/api/invoices/:id", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      const { lineItems, ...invoiceData } = req.body;
      const r = await storage.updateInvoice(req.params.id, invoiceData);
      if (!r) return res.status(404).json({ message: "Invoice not found" });
      if (lineItems && Array.isArray(lineItems)) {
        await storage.deleteInvoiceLineItemsByInvoice(req.params.id);
        for (const item of lineItems) {
          await storage.createInvoiceLineItem({ ...item, invoiceId: req.params.id });
        }
      }
      const items = await storage.getInvoiceLineItems(req.params.id);
      res.json({ ...r, lineItems: items });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update invoice") }); }
  });

  app.delete("/api/invoices/:id", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      await storage.deleteInvoice(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete invoice") }); }
  });

  // ══════════════════════════════════════════════════════════════════════
  // PAYMENTS
  // ══════════════════════════════════════════════════════════════════════
  app.get("/api/payments", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      if (!companyId) return res.status(400).json({ message: "companyId is required" });
      const rows = await storage.getPayments(companyId);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch payments") }); }
  });

  app.post("/api/payments", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      const payment = await storage.createPayment(req.body);
      if (payment.invoiceId) {
        const invoice = await storage.getInvoice(payment.invoiceId);
        if (invoice) {
          const allPayments = await storage.getPayments(invoice.companyId);
          const invoicePayments = allPayments.filter(p => p.invoiceId === invoice.id && p.status !== "failed" && p.status !== "refunded");
          const totalPaid = invoicePayments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
          const invoiceTotal = parseFloat(invoice.totalAmount);
          const newStatus = totalPaid >= invoiceTotal ? "paid" : "partially_paid";
          await storage.updateInvoice(invoice.id, { status: newStatus, amountPaid: totalPaid.toFixed(2), amountDue: (invoiceTotal - totalPaid).toFixed(2) });
        }
      }
      res.status(201).json(payment);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create payment") }); }
  });

  // ══════════════════════════════════════════════════════════════════════
  // PAYMENT METHOD CONFIGURATIONS
  // ══════════════════════════════════════════════════════════════════════
  app.get("/api/payment-method-configs", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      if (!companyId) return res.status(400).json({ message: "companyId is required" });
      let configs = await storage.getPaymentMethodConfigs(companyId);
      if (configs.length === 0) {
        const defaults = [
          { companyId, methodType: "ach", displayName: "Bank Transfer (ACH)", description: "No fee. Takes 2–4 business days.", feeType: "flat", feePercent: "0", feeFlat: "0", isEnabled: true, isRecommended: true, processingTime: "2-4 business days", sortOrder: 0 },
          { companyId, methodType: "card", displayName: "Credit/Debit Card", description: "Instant payment. Processing fee applies.", feeType: "percentage", feePercent: "3", feeFlat: "0", isEnabled: true, isRecommended: false, processingTime: "Instant", sortOrder: 1 },
          { companyId, methodType: "instant_bank", displayName: "Instant Bank Payment", description: "Faster bank transfer. Reduced fee.", feeType: "percentage", feePercent: "1", feeFlat: "0", isEnabled: true, isRecommended: false, processingTime: "Same day", sortOrder: 2 },
          { companyId, methodType: "wire", displayName: "Wire Transfer", description: "For high-value invoices. Bank fees may apply.", feeType: "flat", feePercent: "0", feeFlat: "25", isEnabled: false, isRecommended: false, processingTime: "1-2 business days", sortOrder: 3 },
        ];
        for (const d of defaults) {
          await storage.createPaymentMethodConfig(d as any);
        }
        configs = await storage.getPaymentMethodConfigs(companyId);
      }
      res.json(configs);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch payment method configs") }); }
  });

  app.patch("/api/payment-method-configs/:id", requireAuth, requireRole("admin"), blockDemoWrites, async (req, res) => {
    try {
      const result = await storage.updatePaymentMethodConfig(req.params.id, req.body);
      res.json(result);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update payment method config") }); }
  });

  app.post("/api/payment-method-configs", requireAuth, requireRole("admin"), blockDemoWrites, async (req, res) => {
    try {
      const result = await storage.createPaymentMethodConfig(req.body);
      res.status(201).json(result);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create payment method config") }); }
  });

  app.delete("/api/payment-method-configs/:id", requireAuth, requireRole("admin"), blockDemoWrites, async (req, res) => {
    try {
      await storage.deletePaymentMethodConfig(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete payment method config") }); }
  });

  app.post("/api/payments/calculate-fee", requireAuth, async (req, res) => {
    try {
      const { companyId, methodType, amount } = req.body;
      if (!companyId || !methodType || !amount) return res.status(400).json({ message: "companyId, methodType, and amount are required" });

      const configs = await storage.getPaymentMethodConfigs(companyId);
      const config = configs.find(c => c.methodType === methodType);
      if (!config) return res.status(404).json({ message: "Payment method not found" });
      if (!config.isEnabled) return res.status(400).json({ message: "Payment method is not enabled" });

      const baseAmount = parseFloat(amount);
      let feeAmount = 0;

      if (config.feeType === "percentage") {
        feeAmount = baseAmount * (parseFloat(config.feePercent || "0") / 100);
      } else if (config.feeType === "flat") {
        feeAmount = parseFloat(config.feeFlat || "0");
      } else if (config.feeType === "both") {
        feeAmount = baseAmount * (parseFloat(config.feePercent || "0") / 100) + parseFloat(config.feeFlat || "0");
      }

      if (config.feeCap && feeAmount > parseFloat(config.feeCap)) {
        feeAmount = parseFloat(config.feeCap);
      }

      const totalCharged = baseAmount + feeAmount;
      const savings = configs
        .filter(c => c.isEnabled && c.methodType !== methodType)
        .map(c => {
          let otherFee = 0;
          if (c.feeType === "percentage") otherFee = baseAmount * (parseFloat(c.feePercent || "0") / 100);
          else if (c.feeType === "flat") otherFee = parseFloat(c.feeFlat || "0");
          else if (c.feeType === "both") otherFee = baseAmount * (parseFloat(c.feePercent || "0") / 100) + parseFloat(c.feeFlat || "0");
          if (c.feeCap && otherFee > parseFloat(c.feeCap)) otherFee = parseFloat(c.feeCap);
          return { methodType: c.methodType, displayName: c.displayName, fee: Math.round(otherFee * 100) / 100, savings: Math.round((feeAmount - otherFee) * 100) / 100 };
        })
        .filter(s => s.savings > 0);

      res.json({
        baseAmount: Math.round(baseAmount * 100) / 100,
        feeAmount: Math.round(feeAmount * 100) / 100,
        totalCharged: Math.round(totalCharged * 100) / 100,
        feePercent: config.feePercent,
        methodType: config.methodType,
        displayName: config.displayName,
        processingTime: config.processingTime,
        potentialSavings: savings,
      });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to calculate fee") }); }
  });

  // ══════════════════════════════════════════════════════════════════════
  // STRIPE PAYMENT ROUTES (Public - no auth required for customer payments)
  // ══════════════════════════════════════════════════════════════════════

  app.get("/api/stripe/publishable-key", async (_req, res) => {
    try {
      const { getStripePublishableKey } = await import('./stripeClient');
      const key = await getStripePublishableKey();
      res.json({ publishableKey: key });
    } catch (e) {
      res.status(500).json({ message: "Stripe not configured" });
    }
  });

  app.get("/api/pay/:invoiceId", async (req, res) => {
    try {
      const { invoiceId } = req.params;
      const invoiceResult = await db.execute(sql`
        SELECT i.*, c.name as company_name, c.id as company_id,
          cust.customer_name as customer_name, cust.email as customer_email
        FROM invoices i
        JOIN companies c ON i.company_id = c.id
        LEFT JOIN customers cust ON i.customer_id = cust.id
        WHERE i.id = ${invoiceId}
      `);
      const invoice = invoiceResult.rows[0];
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      if (invoice.status === "paid") return res.json({ invoice, alreadyPaid: true });

      const configs = await storage.getPaymentMethodConfigs(invoice.company_id as string);
      const enabledConfigs = configs.filter(c => c.isEnabled && (c.methodType === 'ach' || c.methodType === 'card'));

      res.json({
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoice_number,
          totalAmount: invoice.total_amount,
          status: invoice.status,
          dueDate: invoice.due_date,
          companyName: invoice.company_name,
          customerName: invoice.customer_name,
          customerEmail: invoice.customer_email,
        },
        paymentMethods: enabledConfigs.map(c => ({
          methodType: c.methodType,
          displayName: c.displayName,
          description: c.description,
          feeType: c.feeType,
          feePercent: c.feePercent,
          feeFlat: c.feeFlat,
          feeCap: c.feeCap,
          processingTime: c.processingTime,
          isRecommended: c.isRecommended,
          feePassedToCustomer: c.feePassedToCustomer,
        })),
        alreadyPaid: false,
      });
    } catch (e) {
      res.status(500).json({ message: safeErrorMessage(e, "Failed to load invoice") });
    }
  });

  app.post("/api/pay/:invoiceId/create-payment-intent", async (req, res) => {
    try {
      const { getUncachableStripeClient } = await import('./stripeClient');
      const stripe = await getUncachableStripeClient();
      const { invoiceId } = req.params;
      const { paymentMethodType, customerEmail, customerName } = req.body;

      if (!paymentMethodType || !["ach", "card"].includes(paymentMethodType)) {
        return res.status(400).json({ message: "Invalid payment method type" });
      }

      const invoiceResult = await db.execute(sql`
        SELECT i.*, c.id as company_id FROM invoices i
        JOIN companies c ON i.company_id = c.id
        WHERE i.id = ${invoiceId}
      `);
      const invoice = invoiceResult.rows[0];
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      if (invoice.status === "paid") return res.status(400).json({ message: "Invoice already paid" });

      const configs = await storage.getPaymentMethodConfigs(invoice.company_id as string);
      const config = configs.find(c => c.methodType === paymentMethodType && c.isEnabled);
      if (!config) return res.status(400).json({ message: "Payment method not available" });

      const baseAmount = parseFloat(invoice.total_amount as string);
      let feeAmount = 0;
      if (config.feePassedToCustomer) {
        if (config.feeType === "percentage") {
          feeAmount = baseAmount * (parseFloat(config.feePercent || "0") / 100);
        } else if (config.feeType === "flat") {
          feeAmount = parseFloat(config.feeFlat || "0");
        } else if (config.feeType === "both") {
          feeAmount = baseAmount * (parseFloat(config.feePercent || "0") / 100) + parseFloat(config.feeFlat || "0");
        }
        if (config.feeCap && feeAmount > parseFloat(config.feeCap)) {
          feeAmount = parseFloat(config.feeCap);
        }
      }
      const totalCharged = Math.round((baseAmount + feeAmount) * 100);

      let stripeCustomer;
      const existingCustomers = await stripe.customers.list({
        email: customerEmail,
        limit: 1,
      });
      if (existingCustomers.data.length > 0) {
        stripeCustomer = existingCustomers.data[0];
      } else {
        stripeCustomer = await stripe.customers.create({
          email: customerEmail,
          name: customerName || undefined,
          metadata: { paylink_invoice_id: invoiceId },
        });
      }

      const paymentMethodTypes: any[] = paymentMethodType === 'ach'
        ? ['us_bank_account']
        : ['card'];

      const intentParams: any = {
        amount: totalCharged,
        currency: 'usd',
        customer: stripeCustomer.id,
        payment_method_types: paymentMethodTypes,
        metadata: {
          paylink_invoice_id: invoiceId,
          paylink_company_id: invoice.company_id as string,
          payment_method_type: paymentMethodType,
          base_amount: baseAmount.toString(),
          fee_amount: feeAmount.toFixed(2),
        },
      };

      if (paymentMethodType === 'ach') {
        intentParams.payment_method_options = {
          us_bank_account: {
            financial_connections: { permissions: ['payment_method'] },
          },
        };
      }

      const paymentIntent = await stripe.paymentIntents.create(intentParams);

      await db.execute(sql`
        INSERT INTO payments (company_id, invoice_id, payment_method, amount, base_amount, fee_amount, total_charged,
          stripe_payment_intent_id, stripe_customer_id, status, mandate_accepted)
        VALUES (${invoice.company_id}, ${invoiceId}, ${paymentMethodType},
          ${baseAmount.toString()}, ${baseAmount.toString()}, ${feeAmount.toFixed(2)},
          ${(totalCharged / 100).toFixed(2)}, ${paymentIntent.id}, ${stripeCustomer.id},
          'pending', ${paymentMethodType === 'ach'})
      `);

      if (paymentMethodType === 'ach') {
        await db.execute(sql`
          UPDATE invoices SET status = 'processing' WHERE id = ${invoiceId}
        `);
      }

      res.json({
        clientSecret: paymentIntent.client_secret,
        customerId: stripeCustomer.id,
        baseAmount: Math.round(baseAmount * 100) / 100,
        feeAmount: Math.round(feeAmount * 100) / 100,
        totalCharged: totalCharged / 100,
        paymentIntentId: paymentIntent.id,
      });
    } catch (e: any) {
      console.error("Create payment intent error:", e);
      res.status(500).json({ message: safeErrorMessage(e, "Failed to create payment") });
    }
  });

  app.post("/api/pay/:invoiceId/confirm-payment", async (req, res) => {
    try {
      const { invoiceId } = req.params;
      const { paymentIntentId, paymentMethodType } = req.body;

      if (!paymentIntentId) return res.status(400).json({ message: "paymentIntentId required" });

      const { getUncachableStripeClient } = await import('./stripeClient');
      const stripe = await getUncachableStripeClient();
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

      if (pi.metadata?.paylink_invoice_id !== invoiceId) {
        return res.status(403).json({ message: "Payment intent does not match this invoice" });
      }

      let newStatus = "pending";
      if (pi.status === "succeeded") {
        newStatus = "succeeded";
      } else if (pi.status === "processing") {
        newStatus = "processing";
      } else if (pi.status === "requires_action" || pi.status === "requires_confirmation") {
        newStatus = "pending";
      } else if (pi.status === "canceled") {
        newStatus = "failed";
      }

      await db.execute(sql`
        UPDATE payments SET
          status = ${newStatus},
          processor_transaction_id = ${pi.id},
          paid_at = ${newStatus === "succeeded" ? sql`NOW()` : sql`NULL`},
          updated_at = NOW()
        WHERE stripe_payment_intent_id = ${paymentIntentId}
      `);

      if (newStatus === "succeeded") {
        await db.execute(sql`
          UPDATE invoices SET status = 'paid', paid_at = NOW(), amount_paid = total_amount WHERE id = ${invoiceId}
        `);
      } else if (newStatus === "processing") {
        await db.execute(sql`UPDATE invoices SET status = 'processing' WHERE id = ${invoiceId}`);
      } else if (newStatus === "failed") {
        await db.execute(sql`UPDATE invoices SET status = 'overdue' WHERE id = ${invoiceId}`);
      }

      res.json({ status: newStatus, paymentMethodType });
    } catch (e) {
      res.status(500).json({ message: safeErrorMessage(e, "Failed to confirm payment") });
    }
  });


  app.get("/api/payments/stripe-status/:paymentIntentId", async (req, res) => {
    try {
      const { getUncachableStripeClient } = await import('./stripeClient');
      const stripe = await getUncachableStripeClient();
      const pi = await stripe.paymentIntents.retrieve(req.params.paymentIntentId);
      res.json({ status: pi.status, amount: pi.amount, currency: pi.currency });
    } catch (e) {
      res.status(500).json({ message: safeErrorMessage(e, "Failed to check payment status") });
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // RECURRING BILLING PROFILES
  // ══════════════════════════════════════════════════════════════════════
  app.get("/api/recurring-billing", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      if (!companyId) return res.status(400).json({ message: "companyId is required" });
      const rows = await storage.getRecurringBillingProfiles(companyId);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch recurring billing") }); }
  });

  app.post("/api/recurring-billing", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      const r = await storage.createRecurringBillingProfile(req.body);
      res.status(201).json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create recurring billing") }); }
  });

  app.patch("/api/recurring-billing/:id", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      const r = await storage.updateRecurringBillingProfile(req.params.id, req.body);
      if (!r) return res.status(404).json({ message: "Profile not found" });
      res.json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update recurring billing") }); }
  });

  app.delete("/api/recurring-billing/:id", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      await storage.deleteRecurringBillingProfile(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete recurring billing") }); }
  });

  // ══════════════════════════════════════════════════════════════════════
  // DOCUMENTS
  // ══════════════════════════════════════════════════════════════════════
  app.get("/api/document-folders", requireAuth, enforceCompanyScope("query"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const rows = await storage.getDocumentFolders(companyId);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch folders") }); }
  });

  app.post("/api/document-folders", requireAuth, requireRole("admin", "manager"), blockDemoWrites, enforceCompanyScope("body"), async (req, res) => {
    try {
      const r = await storage.createDocumentFolder({ ...req.body, companyId: (req as any)._companyId });
      res.status(201).json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create folder") }); }
  });

  app.get("/api/documents", requireAuth, enforceCompanyScope("query"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const rows = await storage.getDocuments(companyId);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch documents") }); }
  });

  app.get("/api/documents/:id", requireAuth, async (req, res) => {
    try {
      const r = await storage.getDocument(req.params.id);
      if (!r) return res.status(404).json({ message: "Document not found" });
      const sessionCompanyId = await getSessionCompanyId(req);
      if (r.companyId !== sessionCompanyId) return res.status(403).json({ message: "Access denied" });
      const isDownload = req.query.download === "true";
      const user = await storage.getUser((req.session as any)?.userId);
      await storage.createDocumentAuditLog({
        documentId: req.params.id,
        companyId: r.companyId,
        action: isDownload ? "downloaded" : "viewed",
        actorId: (req.session as any)?.userId,
        actorName: user?.username || "",
        ipAddress: req.ip || "",
        details: `Document "${r.title}" ${isDownload ? "downloaded" : "viewed"}`,
      });
      res.json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch document") }); }
  });

  app.post("/api/documents", requireAuth, requireRole("admin", "manager"), blockDemoWrites, enforceCompanyScope("body"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const r = await storage.createDocument({ ...req.body, companyId });
      const user = await storage.getUser((req.session as any)?.userId);
      await storage.createDocumentAuditLog({
        documentId: r.id,
        companyId,
        action: "created",
        actorId: (req.session as any)?.userId,
        actorName: user?.username || "",
        ipAddress: req.ip || "",
        details: `Document "${r.title}" created`,
      });
      emitIntegrationEvent(r.companyId, "document.created", { documentId: r.id, title: r.title, fileName: r.fileName }).catch(() => {});
      res.status(201).json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create document") }); }
  });

  app.patch("/api/documents/:id", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      const doc = await storage.getDocument(req.params.id);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      const sessionCompanyId = await getSessionCompanyId(req);
      if (doc.companyId !== sessionCompanyId) return res.status(403).json({ message: "Access denied" });
      let effectiveLegalHold = doc.legalHold || false;
      if (!effectiveLegalHold && doc.folderId) {
        const folder = await storage.getDocumentFolder(doc.folderId);
        if (folder?.legalHold) effectiveLegalHold = true;
      }
      if (effectiveLegalHold) {
        const blockedStatuses = ["archived", "disposed", "deleted"];
        const blockedDispositionStatuses = ["disposed", "archived", "deleted", "pending_review"];
        if (req.body.status && blockedStatuses.includes(req.body.status)) {
          return res.status(403).json({ message: "Cannot archive or dispose document under legal hold" });
        }
        if (req.body.dispositionStatus && blockedDispositionStatuses.includes(req.body.dispositionStatus)) {
          return res.status(403).json({ message: "Cannot change disposition status of document under legal hold" });
        }
        if (req.body.dispositionDate !== undefined) {
          return res.status(403).json({ message: "Cannot set disposition date on document under legal hold" });
        }
      }
      const r = await storage.updateDocument(req.params.id, req.body);
      const user = await storage.getUser((req.session as any)?.userId);
      const changedFields = Object.keys(req.body);
      if (changedFields.includes("legalHold")) {
        await storage.createDocumentAuditLog({
          documentId: req.params.id,
          companyId: doc.companyId,
          action: req.body.legalHold ? "legal_hold_enabled" : "legal_hold_disabled",
          actorId: (req.session as any)?.userId,
          actorName: user?.username || "",
          ipAddress: req.ip || "",
          details: `Legal hold ${req.body.legalHold ? "enabled" : "disabled"} on "${doc.title}"`,
        });
      }
      if (changedFields.includes("folderId") && req.body.folderId !== doc.folderId) {
        await storage.createDocumentAuditLog({
          documentId: req.params.id,
          companyId: doc.companyId,
          action: "moved",
          actorId: (req.session as any)?.userId,
          actorName: user?.username || "",
          ipAddress: req.ip || "",
          details: `Document "${doc.title}" moved to folder ${req.body.folderId || "root"}`,
        });
      }
      if (!changedFields.includes("legalHold") && !changedFields.includes("folderId")) {
        await storage.createDocumentAuditLog({
          documentId: req.params.id,
          companyId: doc.companyId,
          action: "updated",
          actorId: (req.session as any)?.userId,
          actorName: user?.username || "",
          ipAddress: req.ip || "",
          details: `Document "${doc.title}" updated: ${changedFields.join(", ")}`,
        });
      }
      res.json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update document") }); }
  });

  app.delete("/api/documents/:id", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      const doc = await storage.getDocument(req.params.id);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      const sessionCompanyId = await getSessionCompanyId(req);
      if (doc.companyId !== sessionCompanyId) return res.status(403).json({ message: "Access denied" });
      if (doc.legalHold) return res.status(403).json({ message: "Cannot delete document under legal hold" });
      if (doc.folderId) {
        const folder = await storage.getDocumentFolder(doc.folderId);
        if (folder?.legalHold) return res.status(403).json({ message: "Cannot delete document in a folder under legal hold" });
      }
      const user = await storage.getUser((req.session as any)?.userId);
      await storage.createDocumentAuditLog({
        documentId: req.params.id,
        companyId: doc.companyId,
        action: "deleted",
        actorId: (req.session as any)?.userId,
        actorName: user?.username || "",
        ipAddress: req.ip || "",
        details: `Document "${doc.title}" (id: ${doc.id}) deleted permanently`,
      });
      await storage.deleteDocument(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete document") }); }
  });

  // ══════════════════════════════════════════════════════════════════════
  // DOCUMENT MANAGEMENT - EXTENDED (ACLs, Audit, Retention, Workflows)
  // ══════════════════════════════════════════════════════════════════════

  app.patch("/api/document-folders/:id", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      const r = await storage.updateDocumentFolder(req.params.id, req.body);
      if (!r) return res.status(404).json({ message: "Folder not found" });
      res.json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update folder") }); }
  });

  app.delete("/api/document-folders/:id", requireAuth, requireRole("admin"), blockDemoWrites, async (req, res) => {
    try {
      const folder = await storage.getDocumentFolder(req.params.id);
      if (!folder) return res.status(404).json({ message: "Folder not found" });
      const sessionCompanyId = await getSessionCompanyId(req);
      if (folder.companyId !== sessionCompanyId) return res.status(403).json({ message: "Access denied" });
      if (folder.legalHold) return res.status(403).json({ message: "Cannot delete folder under legal hold" });
      await storage.deleteDocumentFolder(req.params.id);
      const user = await storage.getUser((req.session as any)?.userId);
      await storage.createDocumentAuditLog({
        companyId: folder.companyId,
        action: "folder_deleted",
        actorId: (req.session as any)?.userId,
        actorName: user?.username || "",
        ipAddress: req.ip || "",
        details: `Folder "${folder.name}" deleted`,
      });
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete folder") }); }
  });

  app.get("/api/document-versions", requireAuth, async (req, res) => {
    try {
      const documentId = req.query.documentId as string;
      if (!documentId) return res.status(400).json({ message: "documentId is required" });
      const rows = await storage.getDocumentVersions(documentId);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch versions") }); }
  });

  app.post("/api/document-versions", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      if (!req.body.sha256 || typeof req.body.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(req.body.sha256)) {
        return res.status(400).json({ message: "Valid SHA-256 hash (64 hex chars) is required for document version integrity. Use the /api/documents/:id/upload endpoint for file uploads." });
      }
      const r = await storage.createDocumentVersion(req.body);
      const doc = r.documentId ? await storage.getDocument(r.documentId) : null;
      if (doc) {
        const user = await storage.getUser((req.session as any)?.userId);
        await storage.createDocumentAuditLog({
          documentId: r.documentId,
          companyId: doc.companyId,
          action: "version_created",
          actorId: (req.session as any)?.userId,
          actorName: user?.username || "",
          ipAddress: req.ip || "",
          details: `Version ${r.versionNumber} created for "${doc.title}" (sha256: ${r.sha256})`,
        });
      }
      res.status(201).json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create version") }); }
  });

  app.post("/api/documents/:id/upload", requireAuth, requireRole("admin", "manager"), blockDemoWrites, documentUpload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const fileUrl = `/uploads/${req.file.filename}`;
      const doc = await storage.getDocument(req.params.id);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      const sessionCompanyId = await getSessionCompanyId(req);
      if (doc.companyId !== sessionCompanyId) return res.status(403).json({ message: "Access denied" });
      const versions = await storage.getDocumentVersions(req.params.id);
      const newVersionNum = versions.length > 0 ? Math.max(...versions.map(v => v.versionNumber)) + 1 : 1;
      const sha256Hash = await computeFileSha256(req.file.path);
      if (!sha256Hash) return res.status(500).json({ message: "Failed to compute file integrity hash" });
      const version = await storage.createDocumentVersion({
        documentId: req.params.id,
        versionNumber: newVersionNum,
        fileName: req.file.originalname,
        fileUrl,
        fileSize: req.file.size,
        sha256: sha256Hash,
        changeNote: req.body.changeNote || "",
        uploadedBy: (req.session as any)?.username || "",
      });
      await storage.updateDocument(req.params.id, {
        fileUrl,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        currentVersionId: version.id,
      });
      const user = await storage.getUser((req.session as any)?.userId);
      await storage.createDocumentAuditLog({
        documentId: req.params.id,
        companyId: doc.companyId,
        action: "version_uploaded",
        actorId: (req.session as any)?.userId,
        actorName: user?.username || "",
        ipAddress: req.ip || "",
        details: `Version ${newVersionNum} uploaded: ${req.file.originalname}`,
      });
      emitIntegrationEvent(doc.companyId, "document.version_uploaded", { documentId: req.params.id, versionNumber: newVersionNum, fileName: req.file.originalname }).catch(() => {});
      res.status(201).json(version);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to upload document version") }); }
  });

  app.get("/api/document-audit-logs", requireAuth, enforceCompanyScope("query"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const documentId = req.query.documentId as string;
      if (documentId) {
        const rows = await storage.getDocumentAuditLogs(documentId);
        return res.json(rows);
      }
      const rows = await storage.getDocumentAuditLogsByCompany(companyId);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch audit logs") }); }
  });

  app.get("/api/document-audit-logs/export", requireAuth, requireRole("admin"), enforceCompanyScope("query"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const logs = await storage.getDocumentAuditLogsByCompany(companyId);
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : null;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : null;
      let filtered = logs;
      if (startDate) filtered = filtered.filter(l => l.createdAt && new Date(l.createdAt) >= startDate);
      if (endDate) filtered = filtered.filter(l => l.createdAt && new Date(l.createdAt) <= endDate);
      const csv = ["Timestamp,Action,Document ID,Actor,Actor ID,IP Address,Details"]
        .concat(filtered.map(l =>
          `"${l.createdAt}","${l.action}","${l.documentId || ''}","${l.actorName || ''}","${l.actorId || ''}","${l.ipAddress || ''}","${(l.details || '').replace(/"/g, '""')}"`
        )).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=document-audit-log.csv");
      res.send(csv);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to export audit logs") }); }
  });

  app.get("/api/document-acls", requireAuth, enforceCompanyScope("query"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const rows = await storage.getDocumentAcls(companyId);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch ACLs") }); }
  });

  app.post("/api/document-acls", requireAuth, requireRole("admin"), blockDemoWrites, enforceCompanyScope("body"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const r = await storage.createDocumentAcl({ ...req.body, companyId });
      const user = await storage.getUser((req.session as any)?.userId);
      await storage.createDocumentAuditLog({
        documentId: req.body.documentId || null,
        companyId,
        action: "acl_granted",
        actorId: (req.session as any)?.userId,
        actorName: user?.username || "",
        ipAddress: req.ip || "",
        details: `ACL granted: ${req.body.permission} to ${req.body.principalType}:${req.body.principalId}`,
      });
      res.status(201).json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create ACL") }); }
  });

  app.delete("/api/document-acls/:id", requireAuth, requireRole("admin"), blockDemoWrites, async (req, res) => {
    try {
      const acl = await storage.getDocumentAcl(req.params.id);
      if (!acl) return res.status(404).json({ message: "ACL not found" });
      const sessionCompanyId = await getSessionCompanyId(req);
      if (acl.companyId !== sessionCompanyId) return res.status(403).json({ message: "Access denied" });
      await storage.deleteDocumentAcl(req.params.id);
      const user = await storage.getUser((req.session as any)?.userId);
      await storage.createDocumentAuditLog({
        documentId: acl.documentId || undefined,
        companyId: acl.companyId,
        action: "acl_revoked",
        actorId: (req.session as any)?.userId,
        actorName: user?.username || "",
        ipAddress: req.ip || "",
        details: `ACL entry ${req.params.id} revoked (${acl.permission} for ${acl.principalType}:${acl.principalId})`,
      });
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete ACL") }); }
  });

  app.get("/api/document-retention-policies", requireAuth, enforceCompanyScope("query"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const rows = await storage.getDocumentRetentionPolicies(companyId);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch retention policies") }); }
  });

  app.post("/api/document-retention-policies", requireAuth, requireRole("admin"), blockDemoWrites, enforceCompanyScope("body"), async (req, res) => {
    try {
      const r = await storage.createDocumentRetentionPolicy({ ...req.body, companyId: (req as any)._companyId });
      res.status(201).json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create retention policy") }); }
  });

  app.patch("/api/document-retention-policies/:id", requireAuth, requireRole("admin"), blockDemoWrites, async (req, res) => {
    try {
      const r = await storage.updateDocumentRetentionPolicy(req.params.id, req.body);
      if (!r) return res.status(404).json({ message: "Policy not found" });
      res.json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update retention policy") }); }
  });

  app.delete("/api/document-retention-policies/:id", requireAuth, requireRole("admin"), blockDemoWrites, async (req, res) => {
    try {
      await storage.deleteDocumentRetentionPolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete retention policy") }); }
  });

  app.post("/api/document-retention-policies/seed", requireAuth, requireRole("admin"), blockDemoWrites, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const existing = await storage.getDocumentRetentionPolicies(companyId);
      const seedData = getDefaultRetentionPolicySeedData(companyId);
      const created: DocumentRetentionPolicy[] = [];
      for (const policy of seedData) {
        const alreadyExists = existing.some(e => e.documentType === policy.documentType);
        if (!alreadyExists) {
          const r = await storage.createDocumentRetentionPolicy(policy);
          created.push(r);
        }
      }
      const user = await storage.getUser((req.session as any)?.userId);
      await storage.createDocumentAuditLog({
        companyId,
        action: "retention_policies_seeded",
        actorId: (req.session as any)?.userId,
        actorName: user?.username || "",
        ipAddress: req.ip || "",
        details: `${created.length} default retention policies seeded`,
      });
      res.status(201).json({ seeded: created.length, policies: created });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to seed retention policies") }); }
  });

  app.post("/api/document-retention/disposition-review", requireAuth, requireRole("admin"), blockDemoWrites, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const allDocs = await storage.getDocuments(companyId);
      const policies = await storage.getDocumentRetentionPolicies(companyId);
      const now = new Date();
      const flagged: Array<{ documentId: string; title: string; dispositionDate: string }> = [];
      const skippedLegalHold: Array<{ documentId: string; title: string; reason: string }> = [];

      for (const doc of allDocs) {
        if (doc.dispositionStatus === "disposed" || doc.dispositionStatus === "archived") continue;

        let dispositionDate: Date | null = doc.dispositionDate ? new Date(doc.dispositionDate) : null;

        if (!dispositionDate) {
          const matchingPolicy = policies.find(p => p.documentType === doc.documentType && p.isActive);
          if (matchingPolicy) {
            const worker = doc.assignedToWorkerId ? await storage.getWorker(doc.assignedToWorkerId) : null;
            dispositionDate = computeDispositionDate(
              doc.documentType,
              worker?.hireDate || null,
              worker?.terminationDate || null,
              doc.createdAt,
              { retentionYears: matchingPolicy.retentionYears, retentionMonths: matchingPolicy.retentionMonths, retentionRule: matchingPolicy.retentionRule }
            );
          }
        }

        if (dispositionDate && dispositionDate <= now) {
          if (doc.legalHold) {
            skippedLegalHold.push({ documentId: doc.id, title: doc.title, reason: "legal_hold" });
            continue;
          }
          if (doc.folderId) {
            const folder = await storage.getDocumentFolder(doc.folderId);
            if (folder?.legalHold) {
              skippedLegalHold.push({ documentId: doc.id, title: doc.title, reason: "folder_legal_hold" });
              continue;
            }
          }

          await storage.updateDocument(doc.id, {
            dispositionDate,
            dispositionStatus: "pending_review",
          });

          await storage.createDocumentAuditLog({
            documentId: doc.id,
            companyId,
            action: "disposition_flagged",
            actorId: "system",
            actorName: "Retention Engine",
            details: `Document flagged for disposition review. Retention expired: ${dispositionDate.toISOString()}`,
          });

          flagged.push({ documentId: doc.id, title: doc.title, dispositionDate: dispositionDate.toISOString() });
        }
      }

      const user = await storage.getUser((req.session as any)?.userId);
      await storage.createDocumentAuditLog({
        companyId,
        action: "disposition_review_batch",
        actorId: (req.session as any)?.userId,
        actorName: user?.username || "",
        ipAddress: req.ip || "",
        details: `Disposition review completed: ${flagged.length} flagged, ${skippedLegalHold.length} skipped (legal hold)`,
      });

      res.json({ flagged: flagged.length, skippedLegalHold: skippedLegalHold.length, documents: flagged, skipped: skippedLegalHold });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to run disposition review") }); }
  });

  app.post("/api/documents/:id/disposition", requireAuth, requireRole("admin"), blockDemoWrites, async (req, res) => {
    try {
      const doc = await storage.getDocument(req.params.id);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      const sessionCompanyId = await getSessionCompanyId(req);
      if (doc.companyId !== sessionCompanyId) return res.status(403).json({ message: "Access denied" });
      if (doc.legalHold) return res.status(403).json({ message: "Cannot dispose document under legal hold" });
      if (doc.folderId) {
        const folder = await storage.getDocumentFolder(doc.folderId);
        if (folder?.legalHold) return res.status(403).json({ message: "Cannot dispose document in a folder under legal hold" });
      }

      const action = req.body.action;
      if (!["reviewed", "archived", "deleted"].includes(action)) {
        return res.status(400).json({ message: "Invalid disposition action. Must be one of: reviewed, archived, deleted" });
      }

      const user = await storage.getUser((req.session as any)?.userId);
      await storage.createDocumentAuditLog({
        documentId: req.params.id,
        companyId: doc.companyId,
        action: `disposition_${action}`,
        actorId: (req.session as any)?.userId,
        actorName: user?.username || "",
        ipAddress: req.ip || "",
        details: `Document "${doc.title}" (id: ${doc.id}) disposition action: ${action}`,
      });

      if (action === "deleted") {
        await storage.deleteDocument(req.params.id);
      } else {
        await storage.updateDocument(req.params.id, {
          dispositionStatus: action,
          status: action === "archived" ? "archived" : doc.status,
        });
      }

      res.json({ message: `Document disposition: ${action}` });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to process disposition") }); }
  });

  app.get("/api/document-retention/compute", requireAuth, async (req, res) => {
    try {
      const { documentType, hireDate, terminationDate, createdAt } = req.query;
      const result = computeDispositionDate(
        documentType as string,
        hireDate as string || null,
        terminationDate as string || null,
        createdAt as string || null
      );
      res.json({ documentType, dispositionDate: result ? result.toISOString() : null });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to compute disposition date") }); }
  });

  app.get("/api/onboarding-packets", requireAuth, enforceCompanyScope("query"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const rows = await storage.getOnboardingPackets(companyId);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch onboarding packets") }); }
  });

  app.post("/api/onboarding-packets", requireAuth, requireRole("admin", "manager"), blockDemoWrites, enforceCompanyScope("body"), async (req, res) => {
    try {
      const packet = await storage.createOnboardingPacket(req.body);
      emitIntegrationEvent(packet.companyId, "onboarding_packet.created", { packetId: packet.id, workerId: packet.workerId, templateName: packet.templateName }).catch(() => {});
      const templateSteps: Record<string, Array<{name: string; type: string; taskType: string; desc: string; docType?: string; deps?: number[]; required?: boolean}>> = {
        "Standard Onboarding": [
          { name: "Offer Letter", type: "document_sign", taskType: "signature", desc: "Sign the employment offer letter", docType: "Offer Letter", deps: [], required: true },
          { name: "W-4 Tax Withholding", type: "document_upload", taskType: "document_upload", desc: "Complete W-4 federal tax withholding form", docType: "W-4", deps: [0], required: true },
          { name: "I-9 Employment Verification", type: "document_upload", taskType: "document_upload", desc: "Complete employment eligibility verification", docType: "I-9", deps: [0], required: true },
          { name: "Direct Deposit Setup", type: "document_upload", taskType: "document_upload", desc: "Provide banking information for direct deposit", docType: "Direct Deposit Form", deps: [0], required: true },
          { name: "Employee Handbook Acknowledgement", type: "document_sign", taskType: "acknowledgement", desc: "Read and acknowledge the employee handbook", docType: "Employee Handbook", deps: [0], required: true },
          { name: "NDA / Confidentiality Agreement", type: "document_sign", taskType: "signature", desc: "Sign the non-disclosure agreement", docType: "NDA", deps: [0], required: true },
        ],
        "Contractor Onboarding": [
          { name: "W-9 Form", type: "document_upload", taskType: "document_upload", desc: "Complete W-9 tax form", docType: "W-9", deps: [], required: true },
          { name: "Contractor Agreement", type: "document_sign", taskType: "signature", desc: "Sign the contractor agreement", docType: "Contractor Agreement", deps: [0], required: true },
          { name: "NDA / Confidentiality Agreement", type: "document_sign", taskType: "signature", desc: "Sign non-disclosure agreement", docType: "NDA", deps: [0], required: true },
        ],
      };
      const steps = templateSteps[req.body.templateName] || templateSteps["Standard Onboarding"];
      const createdSteps = [];
      for (let i = 0; i < steps.length; i++) {
        const step = await storage.createOnboardingPacketStep({
          packetId: packet.id,
          stepName: steps[i].name,
          stepType: steps[i].type,
          description: steps[i].desc,
          sortOrder: i,
          status: "pending",
          assignedTo: req.body.workerId,
          taskType: steps[i].taskType,
          docType: steps[i].docType || null,
          required: steps[i].required !== false,
          dependenciesJson: JSON.stringify(steps[i].deps || []),
        });
        createdSteps.push(step);
      }
      for (let i = 0; i < createdSteps.length; i++) {
        const deps = steps[i].deps || [];
        if (deps.length > 0) {
          const depIds = deps.map((idx: number) => createdSteps[idx]?.id).filter(Boolean);
          await storage.updateOnboardingPacketStep(createdSteps[i].id, {
            dependenciesJson: JSON.stringify(depIds),
          });
        }
      }
      res.status(201).json(packet);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create onboarding packet") }); }
  });

  app.get("/api/onboarding-packets/:id", requireAuth, async (req, res) => {
    try {
      const packet = await storage.getOnboardingPacket(req.params.id);
      if (!packet) return res.status(404).json({ message: "Packet not found" });
      const steps = await storage.getOnboardingPacketSteps(req.params.id);
      res.json({ ...packet, steps });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch onboarding packet") }); }
  });

  app.patch("/api/onboarding-packets/:id", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      const r = await storage.updateOnboardingPacket(req.params.id, req.body);
      if (!r) return res.status(404).json({ message: "Packet not found" });
      emitIntegrationEvent(r.companyId, "onboarding_packet.updated", { packetId: r.id, status: r.status, workerId: r.workerId }).catch(() => {});
      res.json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update onboarding packet") }); }
  });

  app.get("/api/onboarding-packet-steps", requireAuth, async (req, res) => {
    try {
      const packetId = req.query.packetId as string;
      if (!packetId) return res.status(400).json({ message: "packetId is required" });
      const rows = await storage.getOnboardingPacketSteps(packetId);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch steps") }); }
  });

  app.patch("/api/onboarding-packet-steps/:id", requireAuth, blockDemoWrites, async (req, res) => {
    try {
      const existing = await storage.getOnboardingPacketStepById(req.params.id);
      if (!existing) return res.status(404).json({ message: "Step not found" });
      const packet = await storage.getOnboardingPacket(existing.packetId);
      if (!packet) return res.status(404).json({ message: "Packet not found" });
      const sessionCompanyId = await getSessionCompanyId(req);
      if (packet.companyId !== sessionCompanyId) return res.status(403).json({ message: "Access denied" });
      if (req.body.status === "completed" || req.body.status === "submitted") {
        if (existing.dependenciesJson) {
          const depIds: string[] = JSON.parse(existing.dependenciesJson);
          if (depIds.length > 0) {
            const allSteps = await storage.getOnboardingPacketSteps(existing.packetId);
            const unmetDeps = depIds.filter(depId => {
              const dep = allSteps.find(s => s.id === depId);
              return !dep || (dep.status !== "completed" && dep.status !== "approved");
            });
            if (unmetDeps.length > 0) {
              return res.status(400).json({ message: "Cannot complete this step: prerequisite steps are not yet done" });
            }
          }
        }
      }
      const allowedFields: Record<string, any> = {};
      if (req.body.status) allowedFields.status = req.body.status;
      if (req.body.docStatus) allowedFields.docStatus = req.body.docStatus;
      if (req.body.notes !== undefined) allowedFields.notes = req.body.notes;
      if (req.body.completedAt) allowedFields.completedAt = new Date(req.body.completedAt);
      if (req.body.completedBy) allowedFields.completedBy = req.body.completedBy;
      if (req.body.documentId) allowedFields.documentId = req.body.documentId;
      const r = await storage.updateOnboardingPacketStep(req.params.id, allowedFields);
      if (!r) return res.status(404).json({ message: "Step not found" });
      const allSteps = await storage.getOnboardingPacketSteps(existing.packetId);
      const completedCount = allSteps.filter(s => s.status === "completed" || s.status === "approved").length;
      if (completedCount === allSteps.length && allSteps.length > 0) {
        await storage.updateOnboardingPacket(existing.packetId, { status: "completed", completedAt: new Date() });
      } else if (completedCount > 0) {
        await storage.updateOnboardingPacket(existing.packetId, { status: "in_progress" });
      }
      res.json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update step") }); }
  });

  app.post("/api/onboarding-packets/:id/send-link", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      const packet = await storage.getOnboardingPacket(req.params.id);
      if (!packet) return res.status(404).json({ message: "Packet not found" });
      const sessionCompanyId = await getSessionCompanyId(req);
      if (packet.companyId !== sessionCompanyId) return res.status(403).json({ message: "Access denied" });
      const worker = await storage.getWorker(packet.workerId);
      if (!worker) return res.status(404).json({ message: "Worker not found" });
      const crypto = await import("crypto");
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const portalToken = await storage.createPortalAccessToken({
        companyId: packet.companyId,
        packetId: packet.id,
        workerId: packet.workerId,
        token,
        tokenType: "onboarding_packet",
        expiresAt,
      });
      const company = await storage.getCompany(packet.companyId);
      await storage.createNotification({
        companyId: packet.companyId,
        workerId: packet.workerId,
        type: "onboarding_portal_link",
        title: "Onboarding Portal Access",
        message: `Your onboarding portal is ready. Access your onboarding packet to complete required documents.`,
        actionUrl: `/portal/onboarding/${token}`,
      });
      await storage.createDocumentAuditLog({
        companyId: packet.companyId,
        action: "onboarding_portal_token_generated",
        actorName: (req as any).user?.username || "System",
        actorId: (req as any).user?.id,
        details: JSON.stringify({ packetId: packet.id, workerId: packet.workerId, workerName: worker ? `${worker.firstName} ${worker.lastName}` : "Unknown" }),
      });
      res.status(201).json({ token: portalToken.token, expiresAt, portalUrl: `/portal/onboarding/${token}` });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to send portal link") }); }
  });

  app.post("/api/onboarding-packets/:id/revoke-link", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      const packet = await storage.getOnboardingPacket(req.params.id);
      if (!packet) return res.status(404).json({ message: "Packet not found" });
      const sessionCompanyId = await getSessionCompanyId(req);
      if (packet.companyId !== sessionCompanyId) return res.status(403).json({ message: "Access denied" });
      await storage.revokePortalTokensForPacket(req.params.id);
      await storage.createDocumentAuditLog({
        companyId: packet.companyId,
        action: "onboarding_portal_token_revoked",
        actorName: (req as any).user?.username || "System",
        actorId: (req as any).user?.id,
        details: JSON.stringify({ packetId: packet.id }),
      });
      res.json({ message: "Portal links revoked" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to revoke link") }); }
  });

  app.get("/api/invoice-approval-workflows", requireAuth, enforceCompanyScope("query"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const rows = await storage.getInvoiceApprovalWorkflows(companyId);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch invoice workflows") }); }
  });

  app.post("/api/invoice-approval-workflows", requireAuth, requireRole("admin", "manager"), blockDemoWrites, documentUpload.single("file"), async (req: any, res) => {
    try {
      const sessionCompanyId = await getSessionCompanyId(req);
      if (!sessionCompanyId) return res.status(401).json({ message: "Not authenticated" });
      if (req.body.companyId && req.body.companyId !== sessionCompanyId) return res.status(403).json({ message: "Access denied" });
      let documentId = req.body.documentId;
      if (req.file) {
        const fileUrl = `/uploads/${req.file.filename}`;
        const doc = await storage.createDocument({
          companyId: sessionCompanyId,
          title: req.body.vendorName ? `Invoice - ${req.body.vendorName}` : "Invoice Upload",
          fileName: req.file.originalname,
          fileUrl,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          category: "Accounting",
          department: "Accounting",
          classification: "confidential",
          documentType: "invoice",
          createdBy: (req.session as any)?.username || "",
        });
        documentId = doc.id;
      }
      const r = await storage.createInvoiceApprovalWorkflow({
        ...req.body,
        companyId: sessionCompanyId,
        documentId,
        status: "received",
        submittedBy: (req.session as any)?.userId,
      });
      res.status(201).json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create invoice workflow") }); }
  });

  app.patch("/api/invoice-approval-workflows/:id", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      const r = await storage.updateInvoiceApprovalWorkflow(req.params.id, req.body);
      if (!r) return res.status(404).json({ message: "Workflow not found" });
      res.json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update invoice workflow") }); }
  });

  // ══════════════════════════════════════════════════════════════════════
  // AUTOMATION RULES
  // ══════════════════════════════════════════════════════════════════════
  app.get("/api/automation-rules", requireAuth, requireRole("admin", "manager"), async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      if (!companyId) return res.status(400).json({ message: "companyId is required" });
      const rows = await storage.getAutomationRules(companyId);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch automation rules") }); }
  });

  app.post("/api/automation-rules", requireAuth, requireRole("admin"), blockDemoWrites, async (req, res) => {
    try {
      const r = await storage.createAutomationRule(req.body);
      res.status(201).json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create automation rule") }); }
  });

  app.patch("/api/automation-rules/:id", requireAuth, requireRole("admin"), blockDemoWrites, async (req, res) => {
    try {
      const r = await storage.updateAutomationRule(req.params.id, req.body);
      if (!r) return res.status(404).json({ message: "Rule not found" });
      res.json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update automation rule") }); }
  });

  app.delete("/api/automation-rules/:id", requireAuth, requireRole("admin"), blockDemoWrites, async (req, res) => {
    try {
      await storage.deleteAutomationRule(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete automation rule") }); }
  });

  // ══════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ══════════════════════════════════════════════════════════════════════
  app.get("/api/notifications", requireAuth, async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      if (!companyId) return res.status(400).json({ message: "companyId is required" });
      const userId = req.query.userId as string | undefined;
      const rows = await storage.getNotifications(companyId, userId);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch notifications") }); }
  });

  app.patch("/api/notifications/:id", requireAuth, async (req, res) => {
    try {
      const r = await storage.updateNotification(req.params.id, req.body);
      if (!r) return res.status(404).json({ message: "Notification not found" });
      res.json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update notification") }); }
  });

  // ══════════════════════════════════════════════════════════════════════
  // VENDOR PORTAL (PUBLIC - no auth required, token-based)
  // ══════════════════════════════════════════════════════════════════════
  app.post("/api/portal/generate-token", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
    try {
      const { companyId, customerId, tokenType } = req.body;
      if (!companyId || !customerId) return res.status(400).json({ message: "companyId and customerId required" });
      const crypto = await import("crypto");
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const r = await storage.createPortalAccessToken({
        companyId,
        customerId,
        token,
        tokenType: tokenType || "vendor_invoice_upload",
        expiresAt,
      });
      res.status(201).json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to generate portal token") }); }
  });

  app.get("/api/portal/validate", async (req, res) => {
    try {
      const token = req.query.token as string;
      if (!token) return res.status(400).json({ message: "Token required" });
      const r = await storage.getPortalAccessTokenByToken(token);
      if (!r) return res.status(404).json({ message: "Invalid or expired token" });
      if (r.expiresAt && new Date(r.expiresAt) < new Date()) {
        return res.status(410).json({ message: "Token has expired" });
      }
      const customer = r.customerId ? await storage.getCustomer(r.customerId) : null;
      const company = await storage.getCompany(r.companyId);
      res.json({
        valid: true,
        companyName: company?.name || "Unknown",
        vendorName: customer?.customerName || "Unknown",
        customerId: r.customerId,
        companyId: r.companyId,
        tokenType: r.tokenType,
      });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to validate token") }); }
  });

  app.post("/api/portal/submit-invoice", async (req, res) => {
    try {
      const { token, ...invoiceData } = req.body;
      if (!token) return res.status(400).json({ message: "Token required" });
      const portalToken = await storage.getPortalAccessTokenByToken(token);
      if (!portalToken) return res.status(404).json({ message: "Invalid token" });
      if (portalToken.expiresAt && new Date(portalToken.expiresAt) < new Date()) {
        return res.status(410).json({ message: "Token has expired" });
      }
      const invoice = await storage.createInvoice({
        companyId: portalToken.companyId,
        customerId: portalToken.customerId || undefined,
        invoiceNumber: `VINV-${Date.now().toString(36).toUpperCase()}`,
        status: "draft",
        issueDate: new Date(),
        subtotal: invoiceData.subtotal || "0",
        total: invoiceData.total || "0",
        notes: invoiceData.notes || "",
        ...invoiceData,
      });
      if (invoiceData.lineItems && Array.isArray(invoiceData.lineItems)) {
        for (const item of invoiceData.lineItems) {
          await storage.createInvoiceLineItem({
            invoiceId: invoice.id,
            description: item.description || "",
            quantity: item.quantity || "1",
            unitPrice: item.unitPrice || "0",
            total: item.total || "0",
            taxable: item.taxable ?? false,
          });
        }
      }
      res.status(201).json({ message: "Invoice submitted successfully", invoiceId: invoice.id });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to submit invoice") }); }
  });

  // ══════════════════════════════════════════════════════════════════════
  // ONBOARDING PORTAL (PUBLIC - no auth required, token-based)
  // ══════════════════════════════════════════════════════════════════════
  app.get("/api/portal/onboarding/validate", async (req, res) => {
    try {
      const token = req.query.token as string;
      if (!token) return res.status(400).json({ message: "Token required" });
      const r = await storage.getPortalAccessTokenByToken(token);
      if (!r) return res.status(404).json({ message: "Invalid or expired token" });
      if (r.isRevoked) return res.status(403).json({ message: "Token has been revoked" });
      if (r.tokenType !== "onboarding_packet") return res.status(400).json({ message: "Invalid token type" });
      if (r.expiresAt && new Date(r.expiresAt) < new Date()) {
        return res.status(410).json({ message: "Token has expired" });
      }
      const packet = r.packetId ? await storage.getOnboardingPacket(r.packetId) : null;
      if (!packet) return res.status(404).json({ message: "Packet not found" });
      const steps = await storage.getOnboardingPacketSteps(packet.id);
      const worker = r.workerId ? await storage.getWorker(r.workerId) : null;
      const company = await storage.getCompany(r.companyId);
      await storage.createDocumentAuditLog({
        companyId: r.companyId,
        action: "onboarding_portal_accessed",
        actorName: worker ? `${worker.firstName} ${worker.lastName}` : "Portal User",
        ipAddress: req.ip || req.headers["x-forwarded-for"]?.toString() || "",
        details: JSON.stringify({ packetId: packet.id, workerId: r.workerId }),
      });
      res.json({
        valid: true,
        companyName: company?.name || "Unknown",
        workerName: worker ? `${worker.firstName} ${worker.lastName}` : "Unknown",
        packet: { ...packet, steps },
        companyId: r.companyId,
        tokenType: r.tokenType,
      });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to validate onboarding token") }); }
  });

  app.patch("/api/portal/onboarding/steps/:stepId", async (req, res) => {
    try {
      const token = req.body.token || req.query.token;
      if (!token) return res.status(400).json({ message: "Token required" });
      const portalToken = await storage.getPortalAccessTokenByToken(token as string);
      if (!portalToken) return res.status(404).json({ message: "Invalid token" });
      if (portalToken.isRevoked) return res.status(403).json({ message: "Token has been revoked" });
      if (portalToken.tokenType !== "onboarding_packet") return res.status(400).json({ message: "Invalid token type" });
      if (portalToken.expiresAt && new Date(portalToken.expiresAt) < new Date()) {
        return res.status(410).json({ message: "Token has expired" });
      }
      const step = await storage.getOnboardingPacketStepById(req.params.stepId);
      if (!step) return res.status(404).json({ message: "Step not found" });
      if (step.packetId !== portalToken.packetId) return res.status(403).json({ message: "Access denied" });
      const allowedUpdates: any = {};
      if (req.body.status === "submitted" || req.body.status === "completed") {
        if (step.dependenciesJson) {
          const depIds: string[] = JSON.parse(step.dependenciesJson);
          if (depIds.length > 0) {
            const allSteps = await storage.getOnboardingPacketSteps(step.packetId);
            const unmetDeps = depIds.filter(depId => {
              const dep = allSteps.find(s => s.id === depId);
              return !dep || (dep.status !== "completed" && dep.status !== "approved");
            });
            if (unmetDeps.length > 0) {
              return res.status(400).json({ message: "Cannot complete this step: prerequisite steps are not yet done" });
            }
          }
        }
        allowedUpdates.status = req.body.status;
        if (req.body.status === "completed") allowedUpdates.completedAt = new Date();
        allowedUpdates.docStatus = req.body.status === "submitted" ? "submitted" : "completed";
      }
      if (req.body.notes) allowedUpdates.notes = req.body.notes;
      const r = await storage.updateOnboardingPacketStep(req.params.stepId, allowedUpdates);
      const worker = portalToken.workerId ? await storage.getWorker(portalToken.workerId) : null;
      await storage.createDocumentAuditLog({
        companyId: portalToken.companyId,
        action: `onboarding_step_${req.body.status || "updated"}`,
        actorName: worker ? `${worker.firstName} ${worker.lastName}` : "Portal User",
        ipAddress: req.ip || req.headers["x-forwarded-for"]?.toString() || "",
        details: JSON.stringify({ stepId: step.id, stepName: step.stepName, packetId: step.packetId }),
      });
      const allSteps = await storage.getOnboardingPacketSteps(step.packetId);
      const completedCount = allSteps.filter(s => s.status === "completed" || s.status === "approved").length;
      if (completedCount === allSteps.length && allSteps.length > 0) {
        await storage.updateOnboardingPacket(step.packetId, { status: "completed", completedAt: new Date() });
      } else if (completedCount > 0) {
        await storage.updateOnboardingPacket(step.packetId, { status: "in_progress" });
      }
      res.json(r);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update onboarding step") }); }
  });

  app.post("/api/portal/onboarding/upload", documentUpload.single("file"), async (req: any, res) => {
    try {
      const token = req.body.token;
      if (!token) return res.status(400).json({ message: "Token required" });
      const portalToken = await storage.getPortalAccessTokenByToken(token);
      if (!portalToken) return res.status(404).json({ message: "Invalid token" });
      if (portalToken.isRevoked) return res.status(403).json({ message: "Token has been revoked" });
      if (portalToken.tokenType !== "onboarding_packet") return res.status(400).json({ message: "Invalid token type" });
      if (portalToken.expiresAt && new Date(portalToken.expiresAt) < new Date()) {
        return res.status(410).json({ message: "Token has expired" });
      }
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const stepId = req.body.stepId;
      if (!stepId) return res.status(400).json({ message: "stepId required" });
      const step = await storage.getOnboardingPacketStepById(stepId);
      if (!step) return res.status(404).json({ message: "Step not found" });
      if (step.packetId !== portalToken.packetId) return res.status(403).json({ message: "Access denied" });
      const fileUrl = `/uploads/${req.file.filename}`;
      const doc = await storage.createDocument({
        companyId: portalToken.companyId,
        title: step.stepName || req.file.originalname,
        documentType: step.docType || "Other",
        fileUrl,
        fileName: req.file.originalname,
        fileSize: req.file.size.toString(),
        mimeType: req.file.mimetype,
        status: "active",
        classification: "internal",
      });
      await storage.updateOnboardingPacketStep(stepId, {
        documentId: doc.id,
        status: "submitted",
        docStatus: "submitted",
      });
      const worker = portalToken.workerId ? await storage.getWorker(portalToken.workerId) : null;
      await storage.createDocumentAuditLog({
        companyId: portalToken.companyId,
        action: "onboarding_document_uploaded",
        actorName: worker ? `${worker.firstName} ${worker.lastName}` : "Portal User",
        ipAddress: req.ip || req.headers["x-forwarded-for"]?.toString() || "",
        details: JSON.stringify({ stepId, stepName: step.stepName, documentId: doc.id, fileName: req.file.originalname }),
      });
      res.status(201).json({ documentId: doc.id, fileUrl });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to upload document") }); }
  });

  // ── Deals (Pipeline) ──────────────────────────────────────────

  async function recalcProjectProgress(projectId: string) {
    const allTasks = await storage.getOnboardingTasks(projectId);
    const totalTasks = allTasks.length;
    const completedTasks = allTasks.filter(t => t.status === "completed").length;
    const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    let projectStatus = "in_progress";
    if (totalTasks === 0 || completedTasks === 0) projectStatus = "not_started";
    else if (completedTasks === totalTasks) projectStatus = "completed";
    await storage.updateCustomerOnboardingProject(projectId, {
      progressPercentage,
      status: projectStatus,
      ...(projectStatus === "completed" ? { completedAt: new Date() } : {}),
    });
  }

  app.get("/api/deals", requireAuth, enforceCompanyScope("query"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const deals = await storage.getDeals(companyId);
      res.json(deals);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch deals") }); }
  });

  app.get("/api/deals/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const deal = await storage.getDeal(req.params.id);
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      if (deal.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      res.json(deal);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch deal") }); }
  });

  app.post("/api/deals", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      if (req.body.customerId) {
        const customer = await storage.getCustomer(req.body.customerId);
        if (!customer || customer.companyId !== companyId) return res.status(403).json({ message: "Customer does not belong to your company" });
      }
      const data = { ...req.body, companyId };
      const deal = await storage.createDeal(data);
      res.status(201).json(deal);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create deal") }); }
  });

  app.patch("/api/deals/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const existing = await storage.getDeal(req.params.id);
      if (!existing) return res.status(404).json({ message: "Deal not found" });
      if (existing.companyId !== companyId) return res.status(403).json({ message: "Access denied" });

      const validDealStages = ["lead", "qualified", "proposal", "negotiation", "closed_won", "closed_lost"];
      if (req.body.stage && !validDealStages.includes(req.body.stage)) {
        return res.status(400).json({ message: `Invalid stage. Must be one of: ${validDealStages.join(", ")}` });
      }
      const previousStage = existing.stage;
      const newStage = req.body.stage;
      const allowedFields = ["title", "description", "stage", "productName", "value", "currency", "assignedTo", "expectedCloseDate", "lostReason", "notes"];
      const data: Record<string, any> = {};
      for (const key of allowedFields) { if (req.body[key] !== undefined) data[key] = req.body[key]; }
      if (newStage === "closed_won" && previousStage !== "closed_won") {
        data.closedAt = new Date();
      }
      if (newStage === "closed_lost" && previousStage !== "closed_lost") {
        data.closedAt = new Date();
      }

      const deal = await storage.updateDeal(req.params.id, data);

      if (newStage === "closed_won" && previousStage !== "closed_won" && deal) {
        const existingProjects = await storage.getCustomerOnboardingProjects(companyId);
        const alreadyOnboarded = existingProjects.some(p => p.dealId === deal.id);
        if (!alreadyOnboarded) {
        let templateId: string | null = null;
        if (deal.productName) {
          const templates = await storage.getOnboardingTemplates(companyId);
          const matched = templates.find(t => t.productName === deal.productName && t.isActive);
          if (matched) templateId = matched.id;
        }

        const project = await storage.createCustomerOnboardingProject({
          companyId,
          customerId: deal.customerId,
          dealId: deal.id,
          templateId,
          productName: deal.productName || undefined,
          title: `Onboarding: ${deal.title}`,
          status: "not_started",
          progressPercentage: 0,
          assignedTo: deal.assignedTo || undefined,
          createdBy: req.session?.userId || undefined,
        });

        if (templateId) {
          const templateTasks = await storage.getOnboardingTemplateTasks(templateId);
          for (const tt of templateTasks) {
            await storage.createOnboardingTask({
              projectId: project.id,
              templateTaskId: tt.id,
              title: tt.title,
              description: tt.description || undefined,
              category: tt.category || undefined,
              sortOrder: tt.sortOrder ?? 0,
              status: "pending",
              isMandatory: tt.isMandatory ?? true,
            });
          }

          const templateDocs = await storage.getOnboardingDocuments(companyId, undefined, templateId);
          for (const doc of templateDocs) {
            await storage.createOnboardingDocument({
              projectId: project.id,
              templateId: doc.templateId || undefined,
              companyId,
              title: doc.title,
              description: doc.description || undefined,
              documentType: doc.documentType,
              url: doc.url || undefined,
              fileSize: doc.fileSize ?? undefined,
              sortOrder: doc.sortOrder ?? 0,
              createdBy: req.session?.userId || undefined,
            });
          }
        }
        }
      }

      res.json(deal);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update deal") }); }
  });

  app.delete("/api/deals/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const existing = await storage.getDeal(req.params.id);
      if (!existing) return res.status(404).json({ message: "Deal not found" });
      if (existing.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      await storage.deleteDeal(req.params.id);
      res.json({ message: "Deal deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete deal") }); }
  });

  // ── Onboarding Templates ──────────────────────────────────────────

  app.get("/api/onboarding-templates", requireAuth, enforceCompanyScope("query"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const templates = await storage.getOnboardingTemplates(companyId);
      res.json(templates);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch onboarding templates") }); }
  });

  app.get("/api/onboarding-templates/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const template = await storage.getOnboardingTemplate(req.params.id);
      if (!template) return res.status(404).json({ message: "Template not found" });
      if (template.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      const tasks = await storage.getOnboardingTemplateTasks(req.params.id);
      res.json({ ...template, tasks });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch onboarding template") }); }
  });

  app.post("/api/onboarding-templates", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const { tasks, ...templateData } = req.body;
      const template = await storage.createOnboardingTemplate({ ...templateData, companyId, createdBy: req.session?.userId });
      if (tasks && Array.isArray(tasks)) {
        for (let i = 0; i < tasks.length; i++) {
          await storage.createOnboardingTemplateTask({ ...tasks[i], templateId: template.id, sortOrder: tasks[i].sortOrder ?? i });
        }
      }
      const createdTasks = await storage.getOnboardingTemplateTasks(template.id);
      res.status(201).json({ ...template, tasks: createdTasks });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create onboarding template") }); }
  });

  app.patch("/api/onboarding-templates/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const existing = await storage.getOnboardingTemplate(req.params.id);
      if (!existing) return res.status(404).json({ message: "Template not found" });
      if (existing.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      const { tasks, ...rawTemplateData } = req.body;
      const templateAllowed = ["name", "description", "productName", "isActive"];
      const templateData: Record<string, any> = {};
      for (const key of templateAllowed) { if (rawTemplateData[key] !== undefined) templateData[key] = rawTemplateData[key]; }
      const template = await storage.updateOnboardingTemplate(req.params.id, templateData);
      if (tasks && Array.isArray(tasks)) {
        const existingTasks = await storage.getOnboardingTemplateTasks(req.params.id);
        const existingTaskIds = new Set(existingTasks.map((et) => et.id));
        const incomingIds = tasks.filter((t: any) => t.id).map((t: any) => t.id);
        for (const incomingId of incomingIds) {
          if (!existingTaskIds.has(incomingId)) {
            return res.status(403).json({ message: "Task ID does not belong to this template" });
          }
        }
        for (const et of existingTasks) {
          if (!incomingIds.includes(et.id)) {
            await storage.deleteOnboardingTemplateTask(et.id);
          }
        }
        const taskFieldAllowlist = ["title", "description", "category", "sortOrder", "isMandatory", "estimatedMinutes", "resourceUrl", "resourceType"];
        for (let i = 0; i < tasks.length; i++) {
          const t = tasks[i];
          const safeFields: Record<string, any> = { sortOrder: t.sortOrder ?? i };
          for (const key of taskFieldAllowlist) { if (t[key] !== undefined) safeFields[key] = t[key]; }
          if (t.id) {
            await storage.updateOnboardingTemplateTask(t.id, safeFields);
          } else {
            await storage.createOnboardingTemplateTask({ ...safeFields, templateId: req.params.id });
          }
        }
      }
      const updatedTasks = await storage.getOnboardingTemplateTasks(req.params.id);
      res.json({ ...template, tasks: updatedTasks });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update onboarding template") }); }
  });

  app.delete("/api/onboarding-templates/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const existing = await storage.getOnboardingTemplate(req.params.id);
      if (!existing) return res.status(404).json({ message: "Template not found" });
      if (existing.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      await storage.deleteOnboardingTemplate(req.params.id);
      res.json({ message: "Template deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete onboarding template") }); }
  });

  // ── Onboarding Template Tasks ──────────────────────────────────────────

  app.get("/api/onboarding-templates/:templateId/tasks", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const template = await storage.getOnboardingTemplate(req.params.templateId);
      if (!template) return res.status(404).json({ message: "Template not found" });
      if (template.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      const tasks = await storage.getOnboardingTemplateTasks(req.params.templateId);
      res.json(tasks);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch template tasks") }); }
  });

  app.post("/api/onboarding-templates/:templateId/tasks", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const template = await storage.getOnboardingTemplate(req.params.templateId);
      if (!template) return res.status(404).json({ message: "Template not found" });
      if (template.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      const task = await storage.createOnboardingTemplateTask({ ...req.body, templateId: req.params.templateId });
      res.status(201).json(task);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create template task") }); }
  });

  app.patch("/api/onboarding-template-tasks/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const existingTask = (await db.select().from(onboardingTemplateTasks).where(eq(onboardingTemplateTasks.id, req.params.id)))[0];
      if (!existingTask) return res.status(404).json({ message: "Template task not found" });
      const template = await storage.getOnboardingTemplate(existingTask.templateId);
      if (!template || template.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      const taskAllowed = ["title", "description", "category", "sortOrder", "isMandatory", "estimatedMinutes", "resourceUrl", "resourceType"];
      const taskData: Record<string, any> = {};
      for (const key of taskAllowed) { if (req.body[key] !== undefined) taskData[key] = req.body[key]; }
      const task = await storage.updateOnboardingTemplateTask(req.params.id, taskData);
      res.json(task);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update template task") }); }
  });

  app.delete("/api/onboarding-template-tasks/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const existingTask = (await db.select().from(onboardingTemplateTasks).where(eq(onboardingTemplateTasks.id, req.params.id)))[0];
      if (!existingTask) return res.status(404).json({ message: "Template task not found" });
      const template = await storage.getOnboardingTemplate(existingTask.templateId);
      if (!template || template.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      await storage.deleteOnboardingTemplateTask(req.params.id);
      res.json({ message: "Template task deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete template task") }); }
  });

  // ── Customer Onboarding Projects ──────────────────────────────────────────

  app.get("/api/onboarding-projects", requireAuth, enforceCompanyScope("query"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const projects = await storage.getCustomerOnboardingProjects(companyId);
      res.json(projects);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch onboarding projects") }); }
  });

  app.get("/api/onboarding-projects/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const project = await storage.getCustomerOnboardingProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Onboarding project not found" });
      if (project.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      const tasks = await storage.getOnboardingTasks(req.params.id);
      const totalTasks = tasks.length;
      const completedTasks = tasks.filter(t => t.status === "completed").length;
      const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      res.json({ ...project, tasks, progressPercentage, totalTasks, completedTasks });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch onboarding project") }); }
  });

  app.post("/api/onboarding-projects", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      if (req.body.customerId) {
        const customer = await storage.getCustomer(req.body.customerId);
        if (!customer || customer.companyId !== companyId) return res.status(403).json({ message: "Customer does not belong to your company" });
      }
      if (req.body.dealId) {
        const deal = await storage.getDeal(req.body.dealId);
        if (!deal || deal.companyId !== companyId) return res.status(403).json({ message: "Deal does not belong to your company" });
      }
      if (req.body.templateId) {
        const template = await storage.getOnboardingTemplate(req.body.templateId);
        if (!template || template.companyId !== companyId) return res.status(403).json({ message: "Template does not belong to your company" });
      }
      const project = await storage.createCustomerOnboardingProject({ ...req.body, companyId, createdBy: req.session?.userId });
      res.status(201).json(project);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create onboarding project") }); }
  });

  app.patch("/api/onboarding-projects/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const existing = await storage.getCustomerOnboardingProject(req.params.id);
      if (!existing) return res.status(404).json({ message: "Onboarding project not found" });
      if (existing.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      const validProjectStatuses = ["not_started", "in_progress", "completed", "on_hold", "cancelled"];
      if (req.body.status && !validProjectStatuses.includes(req.body.status)) {
        return res.status(400).json({ message: `Invalid status. Must be one of: ${validProjectStatuses.join(", ")}` });
      }
      const projectAllowed = ["title", "status", "productName", "assignedTo", "startDate", "targetCompletionDate", "notes"];
      const projectData: Record<string, any> = {};
      for (const key of projectAllowed) { if (req.body[key] !== undefined) projectData[key] = req.body[key]; }
      const project = await storage.updateCustomerOnboardingProject(req.params.id, projectData);
      res.json(project);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update onboarding project") }); }
  });

  app.delete("/api/onboarding-projects/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const existing = await storage.getCustomerOnboardingProject(req.params.id);
      if (!existing) return res.status(404).json({ message: "Onboarding project not found" });
      if (existing.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      await storage.deleteCustomerOnboardingProject(req.params.id);
      res.json({ message: "Onboarding project deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete onboarding project") }); }
  });

  // ── Onboarding Tasks ──────────────────────────────────────────

  app.get("/api/onboarding-projects/:projectId/tasks", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const project = await storage.getCustomerOnboardingProject(req.params.projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      const tasks = await storage.getOnboardingTasks(req.params.projectId);
      res.json(tasks);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch onboarding tasks") }); }
  });

  app.post("/api/onboarding-projects/:projectId/tasks", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const project = await storage.getCustomerOnboardingProject(req.params.projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      const task = await storage.createOnboardingTask({ ...req.body, projectId: req.params.projectId });
      await recalcProjectProgress(req.params.projectId);
      res.status(201).json(task);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create onboarding task") }); }
  });

  app.patch("/api/onboarding-tasks/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const existingTask = await storage.getOnboardingTask(req.params.id);
      if (!existingTask) return res.status(404).json({ message: "Onboarding task not found" });
      const project = await storage.getCustomerOnboardingProject(existingTask.projectId);
      if (project && project.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      const validTaskStatuses = ["pending", "in_progress", "completed", "skipped", "blocked"];
      if (req.body.status && !validTaskStatuses.includes(req.body.status)) {
        return res.status(400).json({ message: `Invalid status. Must be one of: ${validTaskStatuses.join(", ")}` });
      }
      const onboardingTaskAllowed = ["title", "description", "category", "sortOrder", "status", "isMandatory", "assignedTo", "dueDate", "notes"];
      const data: Record<string, any> = {};
      for (const key of onboardingTaskAllowed) { if (req.body[key] !== undefined) data[key] = req.body[key]; }
      if (data.status === "completed" && !data.completedAt) {
        data.completedAt = new Date();
        data.completedBy = req.session?.userId;
      }
      const task = await storage.updateOnboardingTask(req.params.id, data);
      if (!task) return res.status(404).json({ message: "Onboarding task not found" });
      await recalcProjectProgress(task.projectId);
      res.json(task);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update onboarding task") }); }
  });

  app.delete("/api/onboarding-tasks/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const existingTask = await storage.getOnboardingTask(req.params.id);
      if (!existingTask) return res.status(404).json({ message: "Onboarding task not found" });
      const project = await storage.getCustomerOnboardingProject(existingTask.projectId);
      if (project && project.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      const taskProjectId = existingTask.projectId;
      await storage.deleteOnboardingTask(req.params.id);
      await recalcProjectProgress(taskProjectId);
      res.json({ message: "Onboarding task deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete onboarding task") }); }
  });

  // ── Onboarding Documents ──────────────────────────────────────────

  app.get("/api/onboarding-documents", requireAuth, enforceCompanyScope("query"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const projectId = req.query.projectId as string | undefined;
      const templateId = req.query.templateId as string | undefined;
      const docs = await storage.getOnboardingDocuments(companyId, projectId, templateId);
      res.json(docs);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch onboarding documents") }); }
  });

  app.post("/api/onboarding-documents", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      if (req.body.projectId) {
        const project = await storage.getCustomerOnboardingProject(req.body.projectId);
        if (!project || project.companyId !== companyId) return res.status(403).json({ message: "Project does not belong to your company" });
      }
      if (req.body.templateId) {
        const template = await storage.getOnboardingTemplate(req.body.templateId);
        if (!template || template.companyId !== companyId) return res.status(403).json({ message: "Template does not belong to your company" });
      }
      const doc = await storage.createOnboardingDocument({ ...req.body, companyId, createdBy: req.session?.userId });
      res.status(201).json(doc);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create onboarding document") }); }
  });

  app.patch("/api/onboarding-documents/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const existingDoc = (await db.select().from(onboardingDocuments).where(eq(onboardingDocuments.id, req.params.id)))[0];
      if (!existingDoc) return res.status(404).json({ message: "Onboarding document not found" });
      if (existingDoc.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      const docAllowed = ["title", "description", "documentType", "url", "fileSize", "sortOrder"];
      const docData: Record<string, any> = {};
      for (const key of docAllowed) { if (req.body[key] !== undefined) docData[key] = req.body[key]; }
      const doc = await storage.updateOnboardingDocument(req.params.id, docData);
      res.json(doc);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update onboarding document") }); }
  });

  app.delete("/api/onboarding-documents/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const existingDoc = (await db.select().from(onboardingDocuments).where(eq(onboardingDocuments.id, req.params.id)))[0];
      if (!existingDoc) return res.status(404).json({ message: "Onboarding document not found" });
      if (existingDoc.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      await storage.deleteOnboardingDocument(req.params.id);
      res.json({ message: "Onboarding document deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete onboarding document") }); }
  });

  // ── Engagement Events ──────────────────────────────────────────

  app.get("/api/engagement-events", requireAuth, enforceCompanyScope("query"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const customerId = req.query.customerId as string | undefined;
      const events = await storage.getEngagementEvents(companyId, customerId);
      res.json(events);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch engagement events") }); }
  });

  app.get("/api/engagement-events/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const event = await storage.getEngagementEvent(req.params.id);
      if (!event) return res.status(404).json({ message: "Engagement event not found" });
      if (event.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      res.json(event);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch engagement event") }); }
  });

  app.post("/api/engagement-events", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      if (req.body.customerId) {
        const customer = await storage.getCustomer(req.body.customerId);
        if (!customer || customer.companyId !== companyId) return res.status(403).json({ message: "Customer does not belong to your company" });
      }
      if (req.body.projectId) {
        const project = await storage.getCustomerOnboardingProject(req.body.projectId);
        if (!project || project.companyId !== companyId) return res.status(403).json({ message: "Project does not belong to your company" });
      }
      const event = await storage.createEngagementEvent({ ...req.body, companyId, eventSource: "internal" });
      res.status(201).json(event);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create engagement event") }); }
  });

  app.delete("/api/engagement-events/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const event = await storage.getEngagementEvent(req.params.id);
      if (!event) return res.status(404).json({ message: "Engagement event not found" });
      if (event.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      await storage.deleteEngagementEvent(req.params.id);
      res.json({ message: "Engagement event deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete engagement event") }); }
  });

  // ── Public Webhook for Product Events ──────────────────────────────────────────

  app.post("/api/webhooks/product-events", async (req, res) => {
    try {
      const apiKey = req.headers["x-api-key"] as string;
      if (!apiKey) return res.status(401).json({ message: "API key required" });

      const keyRecord = await storage.getProductApiKeyByKey(apiKey);
      if (!keyRecord) return res.status(401).json({ message: "Invalid API key" });
      if (!keyRecord.isActive) return res.status(403).json({ message: "API key is disabled" });

      await storage.updateProductApiKey(keyRecord.id, { lastUsedAt: new Date() });

      const { customerId, eventType, productName, metadata, description, occurredAt, projectId } = req.body;
      if (!customerId || !eventType) {
        return res.status(400).json({ message: "customerId and eventType are required" });
      }

      const customer = await storage.getCustomer(customerId);
      if (!customer || customer.companyId !== keyRecord.companyId) {
        return res.status(400).json({ message: "Customer not found or does not belong to the API key's company" });
      }

      if (projectId) {
        const project = await storage.getCustomerOnboardingProject(projectId);
        if (!project || project.companyId !== keyRecord.companyId) {
          return res.status(400).json({ message: "Project not found or does not belong to the API key's company" });
        }
      }

      const event = await storage.createEngagementEvent({
        companyId: keyRecord.companyId,
        customerId,
        eventType,
        eventSource: "webhook",
        productName: productName || keyRecord.productName,
        metadata: metadata ? (typeof metadata === "string" ? metadata : JSON.stringify(metadata)) : undefined,
        description,
        occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
        projectId: projectId || undefined,
      });

      res.status(201).json({ message: "Event recorded", eventId: event.id });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to process webhook event") }); }
  });

  // ── Product API Keys ──────────────────────────────────────────

  app.get("/api/product-api-keys", requireAuth, enforceCompanyScope("query"), async (req, res) => {
    try {
      const companyId = (req as any)._companyId;
      const keys = await storage.getProductApiKeys(companyId);
      res.json(keys);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch product API keys") }); }
  });

  app.post("/api/product-api-keys", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const apiKey = `pk_${crypto.randomBytes(32).toString("hex")}`;
      const key = await storage.createProductApiKey({
        ...req.body,
        companyId,
        apiKey,
        createdBy: req.session?.userId,
      });
      res.status(201).json(key);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to create product API key") }); }
  });

  app.patch("/api/product-api-keys/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const existingKey = (await db.select().from(productApiKeys).where(eq(productApiKeys.id, req.params.id)))[0];
      if (!existingKey) return res.status(404).json({ message: "API key not found" });
      if (existingKey.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      const keyAllowed = ["label", "isActive", "productName"];
      const keyData: Record<string, any> = {};
      for (const key of keyAllowed) { if (req.body[key] !== undefined) keyData[key] = req.body[key]; }
      const updatedKey = await storage.updateProductApiKey(req.params.id, keyData);
      res.json(updatedKey);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to update product API key") }); }
  });

  app.delete("/api/product-api-keys/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const existingKey = (await db.select().from(productApiKeys).where(eq(productApiKeys.id, req.params.id)))[0];
      if (!existingKey) return res.status(404).json({ message: "API key not found" });
      if (existingKey.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      await storage.deleteProductApiKey(req.params.id);
      res.json({ message: "API key deleted" });
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to delete product API key") }); }
  });

  // ── E-Signature Provider Routes ──────────────────────────────────────────

  app.get("/api/esign/providers", requireAuth, async (_req, res) => {
    res.json({ providers: getSupportedProviders() });
  });

  app.get("/api/signature-packages", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const packages = await storage.getSignaturePackages(companyId);
      res.json(packages);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch signature packages") }); }
  });

  app.get("/api/signature-packages/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const pkg = await storage.getSignaturePackage(req.params.id);
      if (!pkg) return res.status(404).json({ message: "Signature package not found" });
      if (pkg.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      res.json(pkg);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch signature package") }); }
  });

  app.post("/api/signature-packages", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });

      const { provider, documentId, subject, message, signers } = req.body;
      if (!provider || !documentId || !subject || !signers?.length) {
        return res.status(400).json({ message: "provider, documentId, subject, and signers are required" });
      }

      const doc = await storage.getDocument(documentId);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      if (doc.companyId !== companyId) return res.status(403).json({ message: "Access denied: document belongs to another company" });

      let adapter;
      try {
        adapter = getESignAdapter(provider);
      } catch {
        return res.status(400).json({ message: `Unsupported e-signature provider: ${provider}` });
      }
      const companyConfig = await getCompanyESignConfig(companyId);

      const baseUrl = getAppBaseUrl(req);
      const returnUrl = `${baseUrl}/documents/${documentId}`;

      const sigRequest = await storage.createDocumentSignatureRequest({
        documentId,
        companyId,
        provider,
        status: "draft",
        message: message || subject,
        createdBy: req.session?.userId,
      });

      for (let i = 0; i < signers.length; i++) {
        const signer = signers[i];
        await storage.createDocumentSigner({
          signatureRequestId: sigRequest.id,
          signerName: signer.name,
          signerEmail: signer.email,
          routingOrder: signer.routingOrder ?? (i + 1),
          status: "pending",
        });
      }

      const result = await adapter.createPackage({
        companyId,
        documentUrl: doc.fileUrl,
        documentName: doc.fileName,
        subject,
        message,
        signers: signers.map((s: { name: string; email: string; routingOrder?: number }) => ({
          name: s.name,
          email: s.email,
          routingOrder: s.routingOrder,
        })),
        returnUrl,
      }, companyConfig);

      await storage.updateDocumentSignatureRequest(sigRequest.id, {
        providerObjectId: result.providerEnvelopeId,
        status: "sent",
        sentAt: new Date(),
      });

      const pkg = await storage.createSignaturePackage({
        companyId,
        signatureRequestId: sigRequest.id,
        provider,
        providerEnvelopeId: result.providerEnvelopeId,
        status: result.status,
        documentIds: documentId,
        subject,
        message,
        sentAt: new Date(),
        createdBy: req.session?.userId,
      });

      await storage.createDocumentAuditLog({
        documentId,
        companyId,
        action: "signature_requested",
        actorId: req.session?.userId,
        actorName: req.session?.username || "system",
        details: `Signature package created via ${provider}. Envelope: ${result.providerEnvelopeId}`,
      });

      emitIntegrationEvent(companyId, "signature.requested", { packageId: pkg.id, documentId, provider, status: pkg.status }).catch(() => {});

      res.status(201).json(pkg);
    } catch (e) {
      console.error("Failed to create signature package:", e);
      res.status(500).json({ message: safeErrorMessage(e, "Failed to create signature package") });
    }
  });

  app.post("/api/signature-packages/:id/signing-url", requireAuth, async (req, res) => {
    try {
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });
      const pkg = await storage.getSignaturePackage(req.params.id);
      if (!pkg) return res.status(404).json({ message: "Signature package not found" });
      if (pkg.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
      if (!pkg.providerEnvelopeId) return res.status(400).json({ message: "Package has no provider envelope" });

      const { signerEmail, signerName } = req.body;
      if (!signerEmail || !signerName) {
        return res.status(400).json({ message: "signerEmail and signerName are required" });
      }

      const adapter = getESignAdapter(pkg.provider);
      const companyConfig = await getCompanyESignConfig(companyId);
      const baseUrl = getAppBaseUrl(req);
      const returnUrl = `${baseUrl}/signing-complete?packageId=${pkg.id}`;

      const result = await adapter.getEmbeddedSigningUrl({
        providerEnvelopeId: pkg.providerEnvelopeId,
        signerEmail,
        signerName,
        returnUrl,
      }, companyConfig);

      res.json(result);
    } catch (e) {
      console.error("Failed to get signing URL:", e);
      res.status(500).json({ message: safeErrorMessage(e, "Failed to get embedded signing URL") });
    }
  });

  app.get("/api/webhooks/esign/:provider", async (req, res) => {
    const { provider } = req.params;
    if (provider === "acrobat_sign") {
      const adapter = getESignAdapter(provider) as AcrobatSignAdapter;
      const voiResult = adapter.handleVerificationOfIntent(req.headers as Record<string, string | string[] | undefined>);
      if (voiResult) {
        res.setHeader("X-AdobeSign-ClientId", voiResult.clientId);
        return res.status(200).json({ xAdobeSignClientId: voiResult.clientId });
      }
    }
    res.status(200).json({ status: "ok" });
  });

  app.post("/api/webhooks/esign/:provider", async (req, res) => {
    const { provider } = req.params;
    try {
      let adapter;
      try {
        adapter = getESignAdapter(provider);
      } catch {
        return res.status(400).json({ message: `Unsupported e-signature provider: ${provider}` });
      }

      if (provider === "acrobat_sign") {
        const acrobatAdapter = adapter as AcrobatSignAdapter;
        const rawBodyForVoi = req.rawBody || (typeof req.body === "string" ? req.body : JSON.stringify(req.body));
        const voiEnvelopeId = acrobatAdapter.extractEnvelopeIdFromPayload(rawBodyForVoi);
        let voiCompanyConfig: CompanyESignConfig | undefined;
        if (voiEnvelopeId) {
          const voiPkg = await storage.getSignaturePackageByEnvelopeId(voiEnvelopeId, provider);
          if (voiPkg) {
            voiCompanyConfig = await getCompanyESignConfig(voiPkg.companyId);
          }
        }
        const voiResult = acrobatAdapter.handleVerificationOfIntent(
          req.headers as Record<string, string | string[] | undefined>,
          voiCompanyConfig
        );
        if (voiResult) {
          res.setHeader("X-AdobeSign-ClientId", voiResult.clientId);
          return res.status(200).json({ xAdobeSignClientId: voiResult.clientId });
        }
      }
      const rawBody = req.rawBody || (typeof req.body === "string" ? req.body : JSON.stringify(req.body));

      let webhookCompanyConfig: CompanyESignConfig | undefined;
      const preExtractedEnvelopeId = adapter.extractEnvelopeIdFromPayload(rawBody);
      if (preExtractedEnvelopeId) {
        const existingPkg = await storage.getSignaturePackageByEnvelopeId(preExtractedEnvelopeId, provider);
        if (existingPkg) {
          webhookCompanyConfig = await getCompanyESignConfig(existingPkg.companyId);
        }
      }

      const verification = await adapter.verifyWebhook(
        req.headers as Record<string, string | string[] | undefined>,
        rawBody,
        webhookCompanyConfig
      );

      if (!verification.valid) {
        console.warn(`Invalid ${provider} webhook signature`);
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      const payloadHash = crypto.createHash("sha256").update(rawBody.toString()).digest("hex").substring(0, 16);
      const signerContext = verification.signerEmail ? `_${verification.signerEmail}` : "";
      const providerEventId = verification.envelopeId
        ? `${provider}_${verification.eventType}_${verification.envelopeId}${signerContext}_${payloadHash}`
        : `${provider}_${verification.eventType}_${payloadHash}`;

      const existingEvent = await storage.getWebhookEventByProviderEventId(providerEventId);
      if (existingEvent) {
        return res.status(200).json({ message: "Event already processed" });
      }

      const webhookEvent = await storage.createWebhookEvent({
        provider,
        eventType: verification.eventType || "unknown",
        providerEventId,
        envelopeId: verification.envelopeId,
        payload: verification.rawPayload,
        status: "received",
      });

      try {
        if (verification.envelopeId) {
          const pkg = await storage.getSignaturePackageByEnvelopeId(verification.envelopeId, provider);

          if (pkg) {
            const statusMap: Record<string, string> = {
              completed: "completed",
              signed: "completed",
              declined: "declined",
              voided: "voided",
              sent: "sent",
              delivered: "delivered",
              AGREEMENT_WORKFLOW_COMPLETED: "completed",
              AGREEMENT_ACTION_COMPLETED: "signed",
            };

            const newStatus = statusMap[verification.envelopeStatus || ""]
              || statusMap[verification.eventType || ""]
              || verification.envelopeStatus
              || pkg.status;

            await storage.updateSignaturePackage(pkg.id, {
              status: newStatus,
              ...(newStatus === "completed" ? { completedAt: new Date() } : {}),
            });

            if (pkg.signatureRequestId) {
              await storage.updateDocumentSignatureRequest(pkg.signatureRequestId, {
                status: newStatus,
                ...(newStatus === "completed" ? { completedAt: new Date() } : {}),
              });

              if (verification.signerEmail) {
                const signers = await storage.getDocumentSigners(pkg.signatureRequestId);
                const matchedSigner = signers.find(s => s.signerEmail === verification.signerEmail);
                if (matchedSigner) {
                  const signerStatusMap: Record<string, string> = {
                    completed: "signed",
                    signed: "signed",
                    sent: "sent",
                    delivered: "viewed",
                    declined: "declined",
                  };
                  const newSignerStatus = signerStatusMap[verification.signerStatus || ""]
                    || signerStatusMap[verification.envelopeStatus || ""]
                    || verification.signerStatus
                    || matchedSigner.status;
                  await storage.updateDocumentSigner(matchedSigner.id, {
                    status: newSignerStatus,
                    ...(newSignerStatus === "signed" ? { signedAt: new Date() } : {}),
                  });
                }
              }
            }

            if (newStatus === "completed") {
              try {
                const pkgCompanyConfig = await getCompanyESignConfig(pkg.companyId);
                const pdfResult = await adapter.downloadFinalPdf(verification.envelopeId, pkgCompanyConfig);
                const fs = await import("fs");
                const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
                const pdfFileName = `signed_${verification.envelopeId}_${Date.now()}.pdf`;
                const pdfPath = path.join(uploadDir, pdfFileName);
                fs.writeFileSync(pdfPath, pdfResult.buffer);

                const docIds = pkg.documentIds?.split(",") || [];
                for (const docId of docIds) {
                  const doc = await storage.getDocument(docId.trim());
                  if (doc) {
                    const existingVersions = await storage.getDocumentVersions(docId.trim());
                    const nextVersion = existingVersions.length > 0
                      ? Math.max(...existingVersions.map(v => v.versionNumber)) + 1
                      : 1;

                    const version = await storage.createDocumentVersion({
                      documentId: docId.trim(),
                      versionNumber: nextVersion,
                      fileName: pdfResult.fileName,
                      fileUrl: `/uploads/${pdfFileName}`,
                      fileSize: pdfResult.buffer.length,
                      changeNote: `Signed document via ${provider} (envelope: ${verification.envelopeId})`,
                      uploadedBy: "system",
                    });

                    await storage.updateDocument(docId.trim(), {
                      currentVersionId: version.id,
                    });

                    await storage.createDocumentAuditLog({
                      documentId: docId.trim(),
                      companyId: pkg.companyId,
                      action: "signed_document_stored",
                      actorName: "system",
                      actorEmail: verification.signerEmail,
                      details: `Signed PDF stored as version ${nextVersion} via ${provider}. Envelope: ${verification.envelopeId}`,
                    });
                  }
                }
              } catch (downloadErr) {
                console.error("Failed to download/store signed PDF:", downloadErr);
              }
            }
          }
        }

        await storage.updateWebhookEvent(webhookEvent.id, {
          status: "processed",
          processedAt: new Date(),
        });
      } catch (processErr) {
        console.error("Webhook processing error:", processErr);
        await storage.updateWebhookEvent(webhookEvent.id, {
          status: "error",
          error: processErr instanceof Error ? processErr.message : String(processErr),
        });
      }

      res.status(200).json({ message: "Webhook received" });
    } catch (e) {
      console.error(`E-sign webhook error (${provider}):`, e);
      res.status(500).json({ message: "Webhook processing failed" });
    }
  });

  // ── Push Notification Device Tokens ──────────────────────────────────
  app.post("/api/device-tokens", requireAuth, async (req, res) => {
    try {
      const { token, platform } = req.body;
      if (!token) return res.status(400).json({ message: "Token is required" });
      const deviceToken = await storage.registerDeviceToken({
        userId: req.session.userId!,
        token,
        platform: platform || "web",
        isActive: true,
      });
      res.status(201).json(deviceToken);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to register device token") });
    }
  });

  app.delete("/api/device-tokens", requireAuth, async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ message: "Token is required" });
      await storage.deactivateDeviceToken(req.session.userId!, token);
      res.json({ message: "Token deactivated" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to deactivate device token") });
    }
  });

  app.get("/api/device-tokens", requireAuth, async (req, res) => {
    try {
      const tokens = await storage.getDeviceTokens(req.session.userId!);
      res.json(tokens);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to fetch device tokens") });
    }
  });

  // ── Notification Preferences (Push) ──────────────────────────────────
  app.get("/api/notification-preferences", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.json([]);
      const prefs = await storage.getNotificationPreferences(user.workerId);
      res.json(prefs);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to fetch notification preferences") });
    }
  });

  app.put("/api/notification-preferences", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.workerId) return res.status(400).json({ message: "No worker profile linked" });
      const { eventType, emailEnabled, smsEnabled, inAppEnabled, pushEnabled } = req.body;
      if (!eventType) return res.status(400).json({ message: "eventType is required" });
      const pref = await storage.upsertNotificationPreference({
        workerId: user.workerId,
        eventType,
        emailEnabled: emailEnabled ?? true,
        smsEnabled: smsEnabled ?? true,
        inAppEnabled: inAppEnabled ?? true,
        pushEnabled: pushEnabled ?? true,
      });
      res.json(pref);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to update notification preferences") });
    }
  });

  // ── Notification Dispatch ──────────────────────────────────────────
  app.post("/api/notifications/dispatch", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { title, body, type, targetUserIds, data: notifData } = req.body;
      if (!title || !type) return res.status(400).json({ message: "Title and type are required" });
      const companyId = await getSessionCompanyId(req);
      if (!companyId) return res.status(401).json({ message: "Not authenticated" });

      const dispatched: any[] = [];
      const userIds = targetUserIds || [];

      const allUsers = await storage.getUsers();
      const companyUserIds = new Set(allUsers.filter(u => u.companyId === companyId).map(u => u.id));
      const validUserIds = userIds.filter((id: string) => companyUserIds.has(id));

      for (const userId of validUserIds) {
        const notification = await storage.createNotification({
          companyId,
          userId,
          type,
          title,
          message: body || "",
          actionUrl: notifData?.actionUrl || null,
          isRead: false,
        });
        dispatched.push(notification);
      }

      const tokens = validUserIds.length > 0 ? await storage.getDeviceTokensByUsers(validUserIds) : [];

      res.json({
        dispatched: dispatched.length,
        pushTargets: tokens.length,
        message: `Dispatched ${dispatched.length} notifications to ${tokens.length} devices`,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to dispatch notifications") });
    }
  });

  // ── Biometric Auth: Issue Restore Token ──────────────────────────────
  app.post("/api/auth/issue-restore-token", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const payload = JSON.stringify({ userId, iat: Date.now(), exp: Date.now() + 30 * 24 * 60 * 60 * 1000 });
      const hmac = crypto.createHmac("sha256", process.env.SESSION_SECRET || "paylink-restore-secret");
      hmac.update(payload);
      const signature = hmac.digest("hex");
      const restoreToken = Buffer.from(payload).toString("base64") + "." + signature;
      res.json({ restoreToken });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: safeErrorMessage(error, "Failed to issue restore token") });
    }
  });

  app.post("/api/auth/token-restore", async (req, res) => {
    try {
      const { restoreToken } = req.body;
      if (!restoreToken || typeof restoreToken !== "string") {
        return res.status(400).json({ message: "Restore token required" });
      }
      const parts = restoreToken.split(".");
      if (parts.length !== 2) return res.status(401).json({ message: "Invalid token format" });
      const [payloadB64, signature] = parts;

      const hmac = crypto.createHmac("sha256", process.env.SESSION_SECRET || "paylink-restore-secret");
      hmac.update(Buffer.from(payloadB64, "base64").toString());
      const expectedSig = hmac.digest("hex");
      if (signature !== expectedSig) {
        return res.status(401).json({ message: "Invalid restore token" });
      }

      const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString());
      if (!payload.userId || !payload.exp || Date.now() > payload.exp) {
        return res.status(401).json({ message: "Token expired" });
      }

      const user = await storage.getUser(payload.userId);
      if (!user || user.isActive === false) {
        return res.status(401).json({ message: "User not found or inactive" });
      }
      req.session.userId = user.id;
      req.session.username = user.username;
      let workerInfo = null;
      if (user.workerId) {
        const w = await storage.getWorker(user.workerId);
        if (w) workerInfo = { id: w.id, firstName: w.firstName, lastName: w.lastName, companyId: w.companyId };
      }
      res.json({ id: user.id, username: user.username, role: user.role, companyId: user.companyId, workerId: user.workerId, worker: workerInfo });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: safeErrorMessage(error, "Token restore failed") });
    }
  });

  app.get("/api/webhook-events", requireRole("admin"), async (req, res) => {
    try {
      const companyId = req.session?.companyId;
      if (!companyId) return res.status(403).json({ message: "No company context" });
      const provider = req.query.provider as string | undefined;
      const events = await storage.getWebhookEventsByCompany(companyId, provider);
      res.json(events);
    } catch (e) { res.status(500).json({ message: safeErrorMessage(e, "Failed to fetch webhook events") }); }
  });

  return httpServer;
}
