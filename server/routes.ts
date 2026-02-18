import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/dashboard/stats", async (_req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  app.get("/api/companies", async (_req, res) => {
    try {
      const companies = await storage.getCompanies();
      res.json(companies);
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch company" });
    }
  });

  app.post("/api/companies", async (req, res) => {
    try {
      const company = await storage.createCompany(req.body);
      res.status(201).json(company);
    } catch (error) {
      res.status(500).json({ message: "Failed to create company" });
    }
  });

  app.patch("/api/companies/:id", async (req, res) => {
    try {
      const company = await storage.updateCompany(req.params.id, req.body);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      res.json(company);
    } catch (error) {
      res.status(500).json({ message: "Failed to update company" });
    }
  });

  app.get("/api/workers", async (_req, res) => {
    try {
      const workers = await storage.getWorkers();
      res.json(workers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch workers" });
    }
  });

  app.post("/api/workers", async (req, res) => {
    try {
      const worker = await storage.createWorker(req.body);
      res.status(201).json(worker);
    } catch (error) {
      res.status(500).json({ message: "Failed to create worker" });
    }
  });

  app.patch("/api/workers/:id", async (req, res) => {
    try {
      const worker = await storage.updateWorker(req.params.id, req.body);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }
      res.json(worker);
    } catch (error) {
      res.status(500).json({ message: "Failed to update worker" });
    }
  });

  app.get("/api/time-punches", async (_req, res) => {
    try {
      const punches = await storage.getTimePunches();
      res.json(punches);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch time punches" });
    }
  });

  app.post("/api/time-punches", async (req, res) => {
    try {
      const punch = await storage.createTimePunch({
        ...req.body,
        punchTime: new Date(),
      });

      if (punch.punchType === "clock_in") {
        await storage.createTimeEntry({
          workerId: punch.workerId,
          companyId: punch.companyId,
          date: new Date().toISOString().split("T")[0],
          clockIn: new Date(),
          status: "pending",
        });
      } else if (punch.punchType === "clock_out") {
        const entries = await storage.getTimeEntries();
        const openEntry = entries.find(
          (e) => e.workerId === punch.workerId && e.clockIn && !e.clockOut
        );
        if (openEntry) {
          const company = await storage.getCompany(punch.companyId);
          const dailyOTThreshold = (company?.overtimeThreshold ?? 40) / 5;

          const clockIn = new Date(openEntry.clockIn!);
          const clockOut = new Date();
          const diffMs = clockOut.getTime() - clockIn.getTime();
          const totalHours = Math.max(0, (diffMs / (1000 * 60 * 60)) - (openEntry.breakMinutes || 0) / 60);
          const overtimeHours = Math.max(0, totalHours - dailyOTThreshold);

          await storage.updateTimeEntry(openEntry.id, {
            clockOut: clockOut,
            totalHours: totalHours.toFixed(2),
            overtimeHours: overtimeHours.toFixed(2),
          });
        }
      }

      res.status(201).json(punch);
    } catch (error) {
      res.status(500).json({ message: "Failed to create time punch" });
    }
  });

  app.get("/api/time-entries", async (_req, res) => {
    try {
      const entries = await storage.getTimeEntries();
      res.json(entries);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch time entries" });
    }
  });

  app.patch("/api/time-entries/:id", async (req, res) => {
    try {
      const entry = await storage.updateTimeEntry(req.params.id, req.body);
      if (!entry) {
        return res.status(404).json({ message: "Time entry not found" });
      }
      res.json(entry);
    } catch (error) {
      res.status(500).json({ message: "Failed to update time entry" });
    }
  });

  app.get("/api/schedules", async (_req, res) => {
    try {
      const allSchedules = await storage.getSchedules();
      res.json(allSchedules);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch schedules" });
    }
  });

  app.post("/api/schedules", async (req, res) => {
    try {
      const schedule = await storage.createSchedule(req.body);
      res.status(201).json(schedule);
    } catch (error) {
      res.status(500).json({ message: "Failed to create schedule" });
    }
  });

  app.get("/api/payroll-runs", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const runs = await storage.getPayrollRuns(companyId);
      res.json(runs);
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch payroll run" });
    }
  });

  app.get("/api/payroll-runs/:id/items", async (req, res) => {
    try {
      const items = await storage.getPayrollItems(req.params.id);
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payroll items" });
    }
  });

  app.post("/api/payroll-runs", async (req, res) => {
    try {
      const { companyId, periodStart, periodEnd } = req.body;

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const entries = await storage.getTimeEntriesByDateRange(companyId, periodStart, periodEnd);
      const companyWorkers = await storage.getWorkers(companyId);
      const activeWorkers = companyWorkers.filter(w => w.isActive);

      const overtimeMultiplier = Number(company.overtimeMultiplier || 1.5);

      const workerPayData: Array<{
        workerId: string;
        regularHours: number;
        overtimeHours: number;
        regularPay: number;
        overtimePay: number;
        grossPay: number;
        payRate: number;
        payType: string;
      }> = [];

      for (const worker of activeWorkers) {
        const workerEntries = entries.filter(e => e.workerId === worker.id);
        const totalHours = workerEntries.reduce((sum, e) => sum + Number(e.totalHours || 0), 0);
        const overtimeHours = workerEntries.reduce((sum, e) => sum + Number(e.overtimeHours || 0), 0);
        const regularHours = totalHours - overtimeHours;

        let regularPay = 0;
        let overtimePay = 0;
        let grossPay = 0;

        if (worker.payType === "salary") {
          const payFreq = company.payFrequency || "biweekly";
          let divisor = 26;
          if (payFreq === "weekly") divisor = 52;
          else if (payFreq === "semimonthly") divisor = 24;
          else if (payFreq === "monthly") divisor = 12;
          grossPay = Number(worker.payRate) / divisor;
          regularPay = grossPay;
        } else {
          const rate = Number(worker.payRate);
          regularPay = regularHours * rate;
          overtimePay = overtimeHours * rate * overtimeMultiplier;
          grossPay = regularPay + overtimePay;
        }

        if (totalHours > 0 || worker.payType === "salary") {
          workerPayData.push({
            workerId: worker.id,
            regularHours,
            overtimeHours,
            regularPay,
            overtimePay,
            grossPay,
            payRate: Number(worker.payRate),
            payType: worker.payType || "hourly",
          });
        }
      }

      const totalGross = workerPayData.reduce((sum, w) => sum + w.grossPay, 0);
      const totalHours = workerPayData.reduce((sum, w) => sum + w.regularHours + w.overtimeHours, 0);
      const totalOT = workerPayData.reduce((sum, w) => sum + w.overtimeHours, 0);

      const payrollRun = await storage.createPayrollRun({
        companyId,
        periodStart,
        periodEnd,
        status: "processed",
        totalGross: totalGross.toFixed(2),
        totalNet: totalGross.toFixed(2),
        totalHours: totalHours.toFixed(2),
        totalOvertimeHours: totalOT.toFixed(2),
        workerCount: workerPayData.length,
        processedAt: new Date(),
      });

      for (const wp of workerPayData) {
        await storage.createPayrollItem({
          payrollRunId: payrollRun.id,
          workerId: wp.workerId,
          regularHours: wp.regularHours.toFixed(2),
          overtimeHours: wp.overtimeHours.toFixed(2),
          regularPay: wp.regularPay.toFixed(2),
          overtimePay: wp.overtimePay.toFixed(2),
          grossPay: wp.grossPay.toFixed(2),
          payRate: wp.payRate.toFixed(2),
          payType: wp.payType,
        });
      }

      res.status(201).json(payrollRun);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to process payroll" });
    }
  });

  app.patch("/api/payroll-runs/:id", async (req, res) => {
    try {
      const run = await storage.updatePayrollRun(req.params.id, req.body);
      if (!run) {
        return res.status(404).json({ message: "Payroll run not found" });
      }
      res.json(run);
    } catch (error) {
      res.status(500).json({ message: "Failed to update payroll run" });
    }
  });

  return httpServer;
}
