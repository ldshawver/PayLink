import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import bcrypt from "bcrypt";
import multer from "multer";
import { sendScheduleEmailNotification, sendScheduleSmsNotification } from "./notifications";
import path from "path";
import { insertEnterpriseSchema, insertDivisionSchema, insertPositionSchema, insertCostCenterSchema, insertJobSchema, insertBranchSchema, insertRoleSchema, insertRolePermissionSchema, insertUserRoleSchema, insertCheckTemplateSchema, insertStationSchema, insertSecondaryWageGroupSchema, insertCurrencySchema } from "@shared/schema";

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(process.cwd(), "uploads")),
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

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
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out" });
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
    if (user.workerId) {
      const w = await storage.getWorker(user.workerId);
      if (w) workerInfo = { id: w.id, firstName: w.firstName, lastName: w.lastName, companyId: w.companyId };
    }
    res.json({ id: user.id, username: user.username, role: user.role, companyId: user.companyId, workerId: user.workerId, worker: workerInfo });
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
    if (req.path === "/auth/login" || req.path === "/auth/logout" || req.path === "/auth/me" || req.path === "/auth/pin-login" || req.path === "/time-clock/auth" || req.path === "/time-clock/punch" || req.path === "/time-clock/punches") {
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

  app.post("/api/companies", requireRole("admin", "manager"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.enterpriseId === "") data.enterpriseId = null;
      if (data.legalEntityId === "") data.legalEntityId = null;
      const company = await storage.createCompany(data);
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

  app.get("/api/workers", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const workers = await storage.getWorkers(companyId);
      res.json(workers);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch workers" });
    }
  });

  app.post("/api/workers", requireRole("admin", "manager"), async (req, res) => {
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

  app.patch("/api/workers/:id", requireRole("admin", "manager"), async (req, res) => {
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
      // Station enforcement: if company has active stations, require stationId for clock_in
      if (punchType === "clock_in" && worker.companyId) {
        const allStations = await storage.getStations(worker.companyId);
        const activeStations = allStations.filter(s => s.status === "active");
        if (activeStations.length > 0 && !req.body.stationId) {
          return res.status(400).json({ message: "A station must be selected to clock in. Please select an active station." });
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

  app.post("/api/payroll-runs/:id/process", async (req, res) => {
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

      const existingItems = await storage.getPayrollItems(run.id);
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
      let checkNum = 1001;
      const items: any[] = [];

      const allWageGroups = await storage.getSecondaryWageGroups(run.companyId);
      const wageGroupMap: Record<string, { hourlyRate: number; overtimeRate: number }> = {};
      for (const wg of allWageGroups) {
        wageGroupMap[wg.id] = {
          hourlyRate: parseFloat(wg.hourlyRate || "0"),
          overtimeRate: parseFloat(wg.overtimeRate || "0"),
        };
      }

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

        const rate = defaultRate;

        const isContractor = worker.workerType === "contractor";
        // Contractors have NO withholding deductions — SE tax is informational only on their stub.
        // Only employees have deductions applied.
        const workerDeductions = isContractor ? [] : companyDeductions.filter(d => {
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

        const netPay = grossPay - totalDeductions;
        const ytd = existingYtdByWorker[worker.id] || { gross: 0, deductions: 0, net: 0 };

        totalGross += grossPay;
        totalNet += netPay;
        totalHours += regHrs + otHrs + dtHrs;
        totalOT += otHrs;

        const alreadyExists = existingItems.find(i => i.workerId === worker.id);
        if (!alreadyExists) {
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
      }

      for (const item of items) {
        await storage.createPayrollItem(item);
      }

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

  app.get("/api/time-punches", async (_req, res) => {
    try {
      const punches = await storage.getTimePunches();
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
      const worker = await storage.getWorker(req.body.workerId);
      if (worker && worker.workerType === "contractor" && worker.contractorType === "invoice") {
        return res.status(400).json({ message: "Invoice-based contractors cannot clock in/out. They submit invoices instead." });
      }
      // Station enforcement: if company has active stations, require stationId for clock_in
      if (req.body.punchType === "clock_in" && worker?.companyId) {
        const allStations = await storage.getStations(worker.companyId);
        const activeStations = allStations.filter(s => s.status === "active");
        if (activeStations.length > 0 && !req.body.stationId) {
          return res.status(400).json({ message: "A station must be selected to clock in. Please select an active station." });
        }
      }
      const punch = await storage.createTimePunch({
        ...req.body,
        punchTime: new Date(),
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
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create time punch" });
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

  app.get("/api/time-entries", async (_req, res) => {
    try {
      const entries = await storage.getTimeEntries();
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

  app.post("/api/schedules", async (req, res) => {
    try {
      const { workerId, companyId, date, startTime, endTime, department, jobId, note } = req.body;
      if (!workerId || !companyId || !date || !startTime || !endTime) {
        return res.status(400).json({ message: "Employee, company, date, start time, and end time are required" });
      }
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
      res.status(500).json({ message: `Failed to generate schedules: ${error instanceof Error ? error.message : String(error)}` });
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

      // Determine base URL for schedule view link
      const proto = req.headers["x-forwarded-proto"] || "http";
      const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
      const scheduleViewUrl = `${proto}://${host}/schedule`;

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
      res.status(500).json({ message: `Failed to publish schedules: ${error instanceof Error ? error.message : String(error)}` });
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
      let checkNum = 1001;

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
        // Contractors have NO withholding deductions — SE tax is informational only on their stub.
        const workerDeds = isContractor ? [] : companyDeductions.filter(d => {
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

      res.status(201).json(payrollRun);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to process payroll" });
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
      res.status(500).json({ message: error.message || "Failed to set up taxes/deductions" });
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
      res.status(500).json({ message: error.message || "Failed to set up policy groups" });
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
      res.status(500).json({ message: error.message || "Failed to set up pay codes" });
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
      res.status(500).json({ message: error.message || "Failed to set up holidays" });
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

  app.patch("/api/receipts/:id", requireAuth, async (req, res) => {
    try {
      const item = await storage.updateReceipt(req.params.id as string, req.body);
      if (!item) return res.status(404).json({ message: "Receipt not found" });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update receipt" });
    }
  });

  app.delete("/api/receipts/:id", requireAuth, async (req, res) => {
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
      const url = `/uploads/${req.file.filename}`;
      res.json({ url });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Upload failed" });
    }
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
      const item = await storage.createShiftOffer(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create shift offer" });
    }
  });

  app.patch("/api/shift-offers/:id", requireAuth, async (req, res) => {
    try {
      const item = await storage.updateShiftOffer(req.params.id as string, req.body);
      if (!item) return res.status(404).json({ message: "Shift offer not found" });
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
      res.status(500).json({ message: error.message || "Failed to set up remittance sources" });
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
      res.status(500).json({ message: error.message || "Failed to set up remittance agencies" });
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
      res.status(500).json({ message: error.message || "Failed to set up pay stub accounts" });
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
      const amendment = await storage.createPayStubAmendment(req.body);
      res.status(201).json(amendment);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create pay stub amendment" });
    }
  });

  app.patch("/api/pay-stub-amendments/:id", async (req, res) => {
    try {
      const amendment = await storage.updatePayStubAmendment(req.params.id, req.body);
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
      res.status(500).json({ message: error.message || "Failed to set up pay formulas" });
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
      res.status(500).json({ message: error.message || "Failed to set up premium policies" });
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
      res.status(500).json({ message: error.message || "Failed to set up exception policies" });
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
      res.status(500).json({ message: error.message || "Failed to set up schedule policies" });
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
      res.status(500).json({ message: error.message || "Failed to set up holiday policies" });
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
      res.status(500).json({ message: error.message || "Failed to set up accrual policies" });
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
      res.status(500).json({ message: error.message || "Failed to set up absence policies" });
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
        "policies", "hr", "reports", "timeclock", "settings", "permissions", "system_admin"
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
            settings: none, permissions: none, system_admin: none } },
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

  return httpServer;
}
