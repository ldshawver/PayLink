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

  app.get("/api/workers", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const workers = await storage.getWorkers(companyId);
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
      const company = await storage.getCompany(worker.companyId);
      res.json({ worker, company });
    } catch (error) {
      res.status(500).json({ message: "Authentication failed" });
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
      const activeDeductions = companyDeductions.filter(d => d.isActive && !d.isEmployerPaid);

      const existingItems = await storage.getPayrollItems(run.id);
      const existingYtdByWorker: Record<string, { gross: number; deductions: number; net: number }> = {};

      const allRuns = await storage.getPayrollRuns(run.companyId);
      const priorRuns = allRuns.filter(r =>
        r.status !== "draft" && r.id !== run.id && r.periodEnd < run.periodStart
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

      for (const worker of activeWorkers) {
        const workerEntries = entries.filter(e => e.workerId === worker.id);
        let regHrs = 0, otHrs = 0;
        for (const e of workerEntries) {
          regHrs += parseFloat(e.totalHours || "0") - parseFloat(e.overtimeHours || "0");
          otHrs += parseFloat(e.overtimeHours || "0");
        }

        const rate = parseFloat(worker.payRate || "0");
        let regPay = 0, otPay = 0, grossPay = 0;

        if (worker.payType === "salary") {
          const periodDays = Math.max(1,
            (new Date(run.periodEnd).getTime() - new Date(run.periodStart).getTime()) / (1000 * 60 * 60 * 24) + 1
          );
          let periodsPerYear = 26;
          if (company.payFrequency === "weekly") periodsPerYear = 52;
          else if (company.payFrequency === "monthly") periodsPerYear = 12;
          else if (company.payFrequency === "semimonthly") periodsPerYear = 24;
          regPay = rate / periodsPerYear;
          otPay = otHrs * (rate / 2080) * parseFloat(company.overtimeMultiplier || "1.5");
          grossPay = regPay + otPay;
        } else {
          regPay = regHrs * rate;
          otPay = otHrs * rate * parseFloat(company.overtimeMultiplier || "1.5");
          grossPay = regPay + otPay;
        }

        let totalDeductions = 0;
        for (const ded of activeDeductions) {
          if (ded.calculationType === "percentage") {
            totalDeductions += grossPay * (parseFloat(ded.rate || "0") / 100);
          } else {
            totalDeductions += parseFloat(ded.rate || "0");
          }
        }

        const netPay = grossPay - totalDeductions;
        const ytd = existingYtdByWorker[worker.id] || { gross: 0, deductions: 0, net: 0 };

        totalGross += grossPay;
        totalNet += netPay;
        totalHours += regHrs + otHrs;
        totalOT += otHrs;

        const alreadyExists = existingItems.find(i => i.workerId === worker.id);
        if (!alreadyExists) {
          items.push({
            payrollRunId: run.id,
            workerId: worker.id,
            regularHours: regHrs.toFixed(2),
            overtimeHours: otHrs.toFixed(2),
            regularPay: regPay.toFixed(2),
            overtimePay: otPay.toFixed(2),
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

  app.patch("/api/schedules/:id", async (req, res) => {
    try {
      const schedule = await storage.updateSchedule(req.params.id, req.body);
      if (!schedule) {
        return res.status(404).json({ message: "Schedule not found" });
      }
      res.json(schedule);
    } catch (error) {
      res.status(500).json({ message: "Failed to update schedule" });
    }
  });

  app.delete("/api/schedules/:id", async (req, res) => {
    try {
      await storage.deleteSchedule(req.params.id);
      res.json({ message: "Schedule deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete schedule" });
    }
  });

  app.post("/api/schedules/generate", async (req, res) => {
    try {
      const { companyId, startDate, endDate } = req.body;
      if (!companyId || !startDate || !endDate) {
        return res.status(400).json({ message: "companyId, startDate, endDate required" });
      }
      const recurring = await storage.getRecurringSchedules(companyId);
      const activeRecurring = recurring.filter(r => r.isActive);
      const created: any[] = [];
      const start = new Date(startDate);
      const end = new Date(endDate);
      for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d <= end; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = d.getDay();
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        for (const rs of activeRecurring) {
          if (rs.dayOfWeek !== dayOfWeek) continue;
          if (rs.effectiveFrom && dateStr < rs.effectiveFrom) continue;
          if (rs.effectiveTo && dateStr > rs.effectiveTo) continue;
          const schedule = await storage.createSchedule({
            companyId,
            workerId: rs.workerId,
            date: dateStr,
            startTime: rs.startTime,
            endTime: rs.endTime,
            status: "draft",
          });
          created.push(schedule);
        }
      }
      res.status(201).json({ created: created.length, schedules: created });
    } catch (error) {
      res.status(500).json({ message: "Failed to generate schedules" });
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

  // Departments
  app.get("/api/departments", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const departments = await storage.getDepartments(companyId);
      res.json(departments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch departments" });
    }
  });

  app.post("/api/departments", async (req, res) => {
    try {
      const department = await storage.createDepartment(req.body);
      res.status(201).json(department);
    } catch (error) {
      res.status(500).json({ message: "Failed to create department" });
    }
  });

  app.patch("/api/departments/:id", async (req, res) => {
    try {
      const department = await storage.updateDepartment(req.params.id, req.body);
      if (!department) {
        return res.status(404).json({ message: "Department not found" });
      }
      res.json(department);
    } catch (error) {
      res.status(500).json({ message: "Failed to update department" });
    }
  });

  app.delete("/api/departments/:id", async (req, res) => {
    try {
      await storage.deleteDepartment(req.params.id);
      res.json({ message: "Department deleted" });
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch branches" });
    }
  });

  app.post("/api/branches", async (req, res) => {
    try {
      const branch = await storage.createBranch(req.body);
      res.status(201).json(branch);
    } catch (error) {
      res.status(500).json({ message: "Failed to create branch" });
    }
  });

  app.patch("/api/branches/:id", async (req, res) => {
    try {
      const branch = await storage.updateBranch(req.params.id, req.body);
      if (!branch) {
        return res.status(404).json({ message: "Branch not found" });
      }
      res.json(branch);
    } catch (error) {
      res.status(500).json({ message: "Failed to update branch" });
    }
  });

  app.delete("/api/branches/:id", async (req, res) => {
    try {
      await storage.deleteBranch(req.params.id);
      res.json({ message: "Branch deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete branch" });
    }
  });

  // Accrual Accounts
  app.get("/api/accrual-accounts", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const accounts = await storage.getAccrualAccounts(companyId);
      res.json(accounts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch accrual accounts" });
    }
  });

  app.post("/api/accrual-accounts", async (req, res) => {
    try {
      const account = await storage.createAccrualAccount(req.body);
      res.status(201).json(account);
    } catch (error) {
      res.status(500).json({ message: "Failed to create accrual account" });
    }
  });

  app.patch("/api/accrual-accounts/:id", async (req, res) => {
    try {
      const account = await storage.updateAccrualAccount(req.params.id, req.body);
      if (!account) {
        return res.status(404).json({ message: "Accrual account not found" });
      }
      res.json(account);
    } catch (error) {
      res.status(500).json({ message: "Failed to update accrual account" });
    }
  });

  app.delete("/api/accrual-accounts/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteAccrualAccount(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Accrual account not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete accrual account" });
    }
  });

  // Accrual Balances
  app.get("/api/accrual-balances", async (req, res) => {
    try {
      const workerId = req.query.workerId as string | undefined;
      const balances = await storage.getAccrualBalances(workerId);
      res.json(balances);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch accrual balances" });
    }
  });

  app.post("/api/accrual-balances", async (req, res) => {
    try {
      const balance = await storage.createAccrualBalance(req.body);
      res.status(201).json(balance);
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch employee contacts" });
    }
  });

  app.post("/api/employee-contacts", async (req, res) => {
    try {
      const contact = await storage.createEmployeeContact(req.body);
      res.status(201).json(contact);
    } catch (error) {
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
      res.status(500).json({ message: "Failed to update employee contact" });
    }
  });

  app.delete("/api/employee-contacts/:id", async (req, res) => {
    try {
      await storage.deleteEmployeeContact(req.params.id);
      res.json({ message: "Employee contact deleted" });
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch pay methods" });
    }
  });

  app.post("/api/pay-methods", async (req, res) => {
    try {
      const method = await storage.createPayMethod(req.body);
      res.status(201).json(method);
    } catch (error) {
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
      res.status(500).json({ message: "Failed to update pay method" });
    }
  });

  app.delete("/api/pay-methods/:id", async (req, res) => {
    try {
      await storage.deletePayMethod(req.params.id);
      res.json({ message: "Pay method deleted" });
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch pay periods" });
    }
  });

  app.post("/api/pay-periods", async (req, res) => {
    try {
      const period = await storage.createPayPeriod(req.body);
      res.status(201).json(period);
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch taxes and deductions" });
    }
  });

  app.post("/api/taxes-deductions", async (req, res) => {
    try {
      const taxDeduction = await storage.createTaxDeduction(req.body);
      res.status(201).json(taxDeduction);
    } catch (error) {
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
      res.status(500).json({ message: "Failed to update tax/deduction" });
    }
  });

  app.delete("/api/taxes-deductions/:id", async (req, res) => {
    try {
      await storage.deleteTaxDeduction(req.params.id);
      res.json({ message: "Tax/deduction deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete tax/deduction" });
    }
  });

  // Policy Groups
  app.get("/api/policy-groups", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const groups = await storage.getPolicyGroups(companyId);
      res.json(groups);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch policy groups" });
    }
  });

  app.post("/api/policy-groups", async (req, res) => {
    try {
      const group = await storage.createPolicyGroup(req.body);
      res.status(201).json(group);
    } catch (error) {
      res.status(500).json({ message: "Failed to create policy group" });
    }
  });

  app.patch("/api/policy-groups/:id", async (req, res) => {
    try {
      const group = await storage.updatePolicyGroup(req.params.id, req.body);
      if (!group) {
        return res.status(404).json({ message: "Policy group not found" });
      }
      res.json(group);
    } catch (error) {
      res.status(500).json({ message: "Failed to update policy group" });
    }
  });

  app.delete("/api/policy-groups/:id", async (req, res) => {
    try {
      await storage.deletePolicyGroup(req.params.id);
      res.json({ message: "Policy group deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete policy group" });
    }
  });

  // Pay Codes
  app.get("/api/pay-codes", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const codes = await storage.getPayCodes(companyId);
      res.json(codes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pay codes" });
    }
  });

  app.post("/api/pay-codes", async (req, res) => {
    try {
      const code = await storage.createPayCode(req.body);
      res.status(201).json(code);
    } catch (error) {
      res.status(500).json({ message: "Failed to create pay code" });
    }
  });

  app.patch("/api/pay-codes/:id", async (req, res) => {
    try {
      const code = await storage.updatePayCode(req.params.id, req.body);
      if (!code) {
        return res.status(404).json({ message: "Pay code not found" });
      }
      res.json(code);
    } catch (error) {
      res.status(500).json({ message: "Failed to update pay code" });
    }
  });

  app.delete("/api/pay-codes/:id", async (req, res) => {
    try {
      await storage.deletePayCode(req.params.id);
      res.json({ message: "Pay code deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete pay code" });
    }
  });

  // Holidays
  app.get("/api/holidays", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const holidays = await storage.getHolidays(companyId);
      res.json(holidays);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch holidays" });
    }
  });

  app.post("/api/holidays", async (req, res) => {
    try {
      const holiday = await storage.createHoliday(req.body);
      res.status(201).json(holiday);
    } catch (error) {
      res.status(500).json({ message: "Failed to create holiday" });
    }
  });

  app.patch("/api/holidays/:id", async (req, res) => {
    try {
      const holiday = await storage.updateHoliday(req.params.id, req.body);
      if (!holiday) {
        return res.status(404).json({ message: "Holiday not found" });
      }
      res.json(holiday);
    } catch (error) {
      res.status(500).json({ message: "Failed to update holiday" });
    }
  });

  app.delete("/api/holidays/:id", async (req, res) => {
    try {
      await storage.deleteHoliday(req.params.id);
      res.json({ message: "Holiday deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete holiday" });
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
      res.status(500).json({ message: "Failed to fetch qualifications" });
    }
  });

  app.post("/api/qualifications", async (req, res) => {
    try {
      const qualification = await storage.createQualification(req.body);
      res.status(201).json(qualification);
    } catch (error) {
      res.status(500).json({ message: "Failed to create qualification" });
    }
  });

  app.patch("/api/qualifications/:id", async (req, res) => {
    try {
      const qualification = await storage.updateQualification(req.params.id, req.body);
      if (!qualification) {
        return res.status(404).json({ message: "Qualification not found" });
      }
      res.json(qualification);
    } catch (error) {
      res.status(500).json({ message: "Failed to update qualification" });
    }
  });

  app.delete("/api/qualifications/:id", async (req, res) => {
    try {
      await storage.deleteQualification(req.params.id);
      res.json({ message: "Qualification deleted" });
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch reviews" });
    }
  });

  app.post("/api/reviews", async (req, res) => {
    try {
      const review = await storage.createReview(req.body);
      res.status(201).json(review);
    } catch (error) {
      res.status(500).json({ message: "Failed to create review" });
    }
  });

  app.patch("/api/reviews/:id", async (req, res) => {
    try {
      const review = await storage.updateReview(req.params.id, req.body);
      if (!review) {
        return res.status(404).json({ message: "Review not found" });
      }
      res.json(review);
    } catch (error) {
      res.status(500).json({ message: "Failed to update review" });
    }
  });

  app.delete("/api/reviews/:id", async (req, res) => {
    try {
      await storage.deleteReview(req.params.id);
      res.json({ message: "Review deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete review" });
    }
  });

  // Recurring Schedules
  app.get("/api/recurring-schedules", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const schedules = await storage.getRecurringSchedules(companyId);
      res.json(schedules);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch recurring schedules" });
    }
  });

  app.post("/api/recurring-schedules", async (req, res) => {
    try {
      const schedule = await storage.createRecurringSchedule(req.body);
      res.status(201).json(schedule);
    } catch (error) {
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
      res.status(500).json({ message: "Failed to update recurring schedule" });
    }
  });

  app.delete("/api/recurring-schedules/:id", async (req, res) => {
    try {
      await storage.deleteRecurringSchedule(req.params.id);
      res.json({ message: "Recurring schedule deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete recurring schedule" });
    }
  });

  app.get("/api/remittance-sources", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const sources = await storage.getRemittanceSources(companyId);
      res.json(sources);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch remittance sources" });
    }
  });

  app.post("/api/remittance-sources", async (req, res) => {
    try {
      const source = await storage.createRemittanceSource(req.body);
      res.status(201).json(source);
    } catch (error) {
      res.status(500).json({ message: "Failed to create remittance source" });
    }
  });

  app.patch("/api/remittance-sources/:id", async (req, res) => {
    try {
      const source = await storage.updateRemittanceSource(req.params.id, req.body);
      if (!source) return res.status(404).json({ message: "Not found" });
      res.json(source);
    } catch (error) {
      res.status(500).json({ message: "Failed to update remittance source" });
    }
  });

  app.delete("/api/remittance-sources/:id", async (req, res) => {
    try {
      await storage.deleteRemittanceSource(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete remittance source" });
    }
  });

  app.get("/api/remittance-agencies", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const agencies = await storage.getRemittanceAgencies(companyId);
      res.json(agencies);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch remittance agencies" });
    }
  });

  app.post("/api/remittance-agencies", async (req, res) => {
    try {
      const agency = await storage.createRemittanceAgency(req.body);
      res.status(201).json(agency);
    } catch (error) {
      res.status(500).json({ message: "Failed to create remittance agency" });
    }
  });

  app.patch("/api/remittance-agencies/:id", async (req, res) => {
    try {
      const agency = await storage.updateRemittanceAgency(req.params.id, req.body);
      if (!agency) return res.status(404).json({ message: "Not found" });
      res.json(agency);
    } catch (error) {
      res.status(500).json({ message: "Failed to update remittance agency" });
    }
  });

  app.delete("/api/remittance-agencies/:id", async (req, res) => {
    try {
      await storage.deleteRemittanceAgency(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });

  app.post("/api/remittance-agency-events", async (req, res) => {
    try {
      const event = await storage.createRemittanceAgencyEvent(req.body);
      res.status(201).json(event);
    } catch (error) {
      res.status(500).json({ message: "Failed to create event" });
    }
  });

  app.patch("/api/remittance-agency-events/:id", async (req, res) => {
    try {
      const event = await storage.updateRemittanceAgencyEvent(req.params.id, req.body);
      if (!event) return res.status(404).json({ message: "Not found" });
      res.json(event);
    } catch (error) {
      res.status(500).json({ message: "Failed to update event" });
    }
  });

  app.delete("/api/remittance-agency-events/:id", async (req, res) => {
    try {
      await storage.deleteRemittanceAgencyEvent(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete event" });
    }
  });

  app.get("/api/pay-stub-accounts", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const accounts = await storage.getPayStubAccounts(companyId);
      res.json(accounts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pay stub accounts" });
    }
  });

  app.post("/api/pay-stub-accounts", async (req, res) => {
    try {
      const account = await storage.createPayStubAccount(req.body);
      res.status(201).json(account);
    } catch (error) {
      res.status(500).json({ message: "Failed to create pay stub account" });
    }
  });

  app.patch("/api/pay-stub-accounts/:id", async (req, res) => {
    try {
      const account = await storage.updatePayStubAccount(req.params.id, req.body);
      if (!account) return res.status(404).json({ message: "Not found" });
      res.json(account);
    } catch (error) {
      res.status(500).json({ message: "Failed to update pay stub account" });
    }
  });

  app.delete("/api/pay-stub-accounts/:id", async (req, res) => {
    try {
      await storage.deletePayStubAccount(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete pay stub account" });
    }
  });

  app.get("/api/pay-stub-amendments", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const amendments = await storage.getPayStubAmendments(companyId);
      res.json(amendments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pay stub amendments" });
    }
  });

  app.post("/api/pay-stub-amendments", async (req, res) => {
    try {
      const amendment = await storage.createPayStubAmendment(req.body);
      res.status(201).json(amendment);
    } catch (error) {
      res.status(500).json({ message: "Failed to create pay stub amendment" });
    }
  });

  app.patch("/api/pay-stub-amendments/:id", async (req, res) => {
    try {
      const amendment = await storage.updatePayStubAmendment(req.params.id, req.body);
      if (!amendment) return res.status(404).json({ message: "Not found" });
      res.json(amendment);
    } catch (error) {
      res.status(500).json({ message: "Failed to update pay stub amendment" });
    }
  });

  app.delete("/api/pay-stub-amendments/:id", async (req, res) => {
    try {
      await storage.deletePayStubAmendment(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete pay stub amendment" });
    }
  });

  app.get("/api/pay-stub-transactions", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const transactions = await storage.getPayStubTransactions(companyId);
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pay stub transactions" });
    }
  });

  app.post("/api/pay-stub-transactions", async (req, res) => {
    try {
      const transaction = await storage.createPayStubTransaction(req.body);
      res.status(201).json(transaction);
    } catch (error) {
      res.status(500).json({ message: "Failed to create pay stub transaction" });
    }
  });

  app.patch("/api/pay-stub-transactions/:id", async (req, res) => {
    try {
      const transaction = await storage.updatePayStubTransaction(req.params.id, req.body);
      if (!transaction) return res.status(404).json({ message: "Not found" });
      res.json(transaction);
    } catch (error) {
      res.status(500).json({ message: "Failed to update pay stub transaction" });
    }
  });

  app.get("/api/pay-period-schedules", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const schedules = await storage.getPayPeriodSchedules(companyId);
      res.json(schedules);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pay period schedules" });
    }
  });

  app.post("/api/pay-period-schedules", async (req, res) => {
    try {
      const schedule = await storage.createPayPeriodSchedule(req.body);
      res.status(201).json(schedule);
    } catch (error) {
      res.status(500).json({ message: "Failed to create pay period schedule" });
    }
  });

  app.patch("/api/pay-period-schedules/:id", async (req, res) => {
    try {
      const schedule = await storage.updatePayPeriodSchedule(req.params.id, req.body);
      if (!schedule) return res.status(404).json({ message: "Not found" });
      res.json(schedule);
    } catch (error) {
      res.status(500).json({ message: "Failed to update pay period schedule" });
    }
  });

  app.delete("/api/pay-period-schedules/:id", async (req, res) => {
    try {
      await storage.deletePayPeriodSchedule(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch employee titles" });
    }
  });

  app.post("/api/employee-titles", async (req, res) => {
    try {
      const title = await storage.createEmployeeTitle(req.body);
      res.status(201).json(title);
    } catch (error) {
      res.status(500).json({ message: "Failed to create employee title" });
    }
  });

  app.patch("/api/employee-titles/:id", async (req, res) => {
    try {
      const title = await storage.updateEmployeeTitle(req.params.id, req.body);
      if (!title) return res.status(404).json({ message: "Not found" });
      res.json(title);
    } catch (error) {
      res.status(500).json({ message: "Failed to update employee title" });
    }
  });

  app.delete("/api/employee-titles/:id", async (req, res) => {
    try {
      await storage.deleteEmployeeTitle(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch employee groups" });
    }
  });

  app.post("/api/employee-groups", async (req, res) => {
    try {
      const group = await storage.createEmployeeGroup(req.body);
      res.status(201).json(group);
    } catch (error) {
      res.status(500).json({ message: "Failed to create employee group" });
    }
  });

  app.patch("/api/employee-groups/:id", async (req, res) => {
    try {
      const group = await storage.updateEmployeeGroup(req.params.id, req.body);
      if (!group) return res.status(404).json({ message: "Not found" });
      res.json(group);
    } catch (error) {
      res.status(500).json({ message: "Failed to update employee group" });
    }
  });

  app.delete("/api/employee-groups/:id", async (req, res) => {
    try {
      await storage.deleteEmployeeGroup(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch wage history" });
    }
  });

  app.post("/api/wage-history", async (req, res) => {
    try {
      const entry = await storage.createWageHistory(req.body);
      res.status(201).json(entry);
    } catch (error) {
      res.status(500).json({ message: "Failed to create wage history entry" });
    }
  });

  app.patch("/api/wage-history/:id", async (req, res) => {
    try {
      const entry = await storage.updateWageHistory(req.params.id, req.body);
      if (!entry) return res.status(404).json({ message: "Not found" });
      res.json(entry);
    } catch (error) {
      res.status(500).json({ message: "Failed to update wage history entry" });
    }
  });

  app.delete("/api/wage-history/:id", async (req, res) => {
    try {
      await storage.deleteWageHistory(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch new hire defaults" });
    }
  });

  app.post("/api/new-hire-defaults", async (req, res) => {
    try {
      const entry = await storage.createNewHireDefault(req.body);
      res.status(201).json(entry);
    } catch (error) {
      res.status(500).json({ message: "Failed to create new hire default" });
    }
  });

  app.patch("/api/new-hire-defaults/:id", async (req, res) => {
    try {
      const entry = await storage.updateNewHireDefault(req.params.id, req.body);
      if (!entry) return res.status(404).json({ message: "Not found" });
      res.json(entry);
    } catch (error) {
      res.status(500).json({ message: "Failed to update new hire default" });
    }
  });

  app.delete("/api/new-hire-defaults/:id", async (req, res) => {
    try {
      await storage.deleteNewHireDefault(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete new hire default" });
    }
  });

  // Pay Formulas
  app.get("/api/pay-formulas", async (_req, res) => {
    try {
      const items = await storage.getPayFormulas();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pay formulas" });
    }
  });

  app.post("/api/pay-formulas", async (req, res) => {
    try {
      const item = await storage.createPayFormula(req.body);
      res.status(201).json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to create pay formula" });
    }
  });

  app.patch("/api/pay-formulas/:id", async (req, res) => {
    try {
      const item = await storage.updatePayFormula(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to update pay formula" });
    }
  });

  app.delete("/api/pay-formulas/:id", async (req, res) => {
    try {
      await storage.deletePayFormula(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete pay formula" });
    }
  });

  // Contributing Pay Codes
  app.get("/api/contributing-pay-codes", async (_req, res) => {
    try {
      const items = await storage.getContributingPayCodes();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contributing pay codes" });
    }
  });

  app.post("/api/contributing-pay-codes", async (req, res) => {
    try {
      const item = await storage.createContributingPayCode(req.body);
      res.status(201).json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to create contributing pay code" });
    }
  });

  app.patch("/api/contributing-pay-codes/:id", async (req, res) => {
    try {
      const item = await storage.updateContributingPayCode(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to update contributing pay code" });
    }
  });

  app.delete("/api/contributing-pay-codes/:id", async (req, res) => {
    try {
      await storage.deleteContributingPayCode(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete contributing pay code" });
    }
  });

  // Contributing Shifts
  app.get("/api/contributing-shifts", async (_req, res) => {
    try {
      const items = await storage.getContributingShifts();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contributing shifts" });
    }
  });

  app.post("/api/contributing-shifts", async (req, res) => {
    try {
      const item = await storage.createContributingShift(req.body);
      res.status(201).json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to create contributing shift" });
    }
  });

  app.patch("/api/contributing-shifts/:id", async (req, res) => {
    try {
      const item = await storage.updateContributingShift(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to update contributing shift" });
    }
  });

  app.delete("/api/contributing-shifts/:id", async (req, res) => {
    try {
      await storage.deleteContributingShift(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete contributing shift" });
    }
  });

  // Regular Time Policies
  app.get("/api/regular-time-policies", async (_req, res) => {
    try {
      const items = await storage.getRegularTimePolicies();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch regular time policies" });
    }
  });

  app.post("/api/regular-time-policies", async (req, res) => {
    try {
      const item = await storage.createRegularTimePolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to create regular time policy" });
    }
  });

  app.patch("/api/regular-time-policies/:id", async (req, res) => {
    try {
      const item = await storage.updateRegularTimePolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to update regular time policy" });
    }
  });

  app.delete("/api/regular-time-policies/:id", async (req, res) => {
    try {
      await storage.deleteRegularTimePolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete regular time policy" });
    }
  });

  // Overtime Policies
  app.get("/api/overtime-policies", async (_req, res) => {
    try {
      const items = await storage.getOvertimePolicies();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch overtime policies" });
    }
  });

  app.post("/api/overtime-policies", async (req, res) => {
    try {
      const item = await storage.createOvertimePolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to create overtime policy" });
    }
  });

  app.patch("/api/overtime-policies/:id", async (req, res) => {
    try {
      const item = await storage.updateOvertimePolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to update overtime policy" });
    }
  });

  app.delete("/api/overtime-policies/:id", async (req, res) => {
    try {
      await storage.deleteOvertimePolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete overtime policy" });
    }
  });

  // Premium Policies
  app.get("/api/premium-policies", async (_req, res) => {
    try {
      const items = await storage.getPremiumPolicies();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch premium policies" });
    }
  });

  app.post("/api/premium-policies", async (req, res) => {
    try {
      const item = await storage.createPremiumPolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to create premium policy" });
    }
  });

  app.patch("/api/premium-policies/:id", async (req, res) => {
    try {
      const item = await storage.updatePremiumPolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to update premium policy" });
    }
  });

  app.delete("/api/premium-policies/:id", async (req, res) => {
    try {
      await storage.deletePremiumPolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete premium policy" });
    }
  });

  // Meal Policies
  app.get("/api/meal-policies", async (_req, res) => {
    try {
      const items = await storage.getMealPolicies();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch meal policies" });
    }
  });

  app.post("/api/meal-policies", async (req, res) => {
    try {
      const item = await storage.createMealPolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to create meal policy" });
    }
  });

  app.patch("/api/meal-policies/:id", async (req, res) => {
    try {
      const item = await storage.updateMealPolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to update meal policy" });
    }
  });

  app.delete("/api/meal-policies/:id", async (req, res) => {
    try {
      await storage.deleteMealPolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete meal policy" });
    }
  });

  // Break Policies
  app.get("/api/break-policies", async (_req, res) => {
    try {
      const items = await storage.getBreakPolicies();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch break policies" });
    }
  });

  app.post("/api/break-policies", async (req, res) => {
    try {
      const item = await storage.createBreakPolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to create break policy" });
    }
  });

  app.patch("/api/break-policies/:id", async (req, res) => {
    try {
      const item = await storage.updateBreakPolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to update break policy" });
    }
  });

  app.delete("/api/break-policies/:id", async (req, res) => {
    try {
      await storage.deleteBreakPolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete break policy" });
    }
  });

  // Schedule Policies
  app.get("/api/schedule-policies", async (_req, res) => {
    try {
      const items = await storage.getSchedulePolicies();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch schedule policies" });
    }
  });

  app.post("/api/schedule-policies", async (req, res) => {
    try {
      const item = await storage.createSchedulePolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to create schedule policy" });
    }
  });

  app.patch("/api/schedule-policies/:id", async (req, res) => {
    try {
      const item = await storage.updateSchedulePolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to update schedule policy" });
    }
  });

  app.delete("/api/schedule-policies/:id", async (req, res) => {
    try {
      await storage.deleteSchedulePolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete schedule policy" });
    }
  });

  // Exception Policies
  app.get("/api/exception-policies", async (_req, res) => {
    try {
      const items = await storage.getExceptionPolicies();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch exception policies" });
    }
  });

  app.post("/api/exception-policies", async (req, res) => {
    try {
      const item = await storage.createExceptionPolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to create exception policy" });
    }
  });

  app.patch("/api/exception-policies/:id", async (req, res) => {
    try {
      const item = await storage.updateExceptionPolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to update exception policy" });
    }
  });

  app.delete("/api/exception-policies/:id", async (req, res) => {
    try {
      await storage.deleteExceptionPolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete exception policy" });
    }
  });

  // Accrual Policies
  app.get("/api/accrual-policies", async (_req, res) => {
    try {
      const items = await storage.getAccrualPolicies();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch accrual policies" });
    }
  });

  app.post("/api/accrual-policies", async (req, res) => {
    try {
      const item = await storage.createAccrualPolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to create accrual policy" });
    }
  });

  app.patch("/api/accrual-policies/:id", async (req, res) => {
    try {
      const item = await storage.updateAccrualPolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to update accrual policy" });
    }
  });

  app.delete("/api/accrual-policies/:id", async (req, res) => {
    try {
      await storage.deleteAccrualPolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch milestones" });
    }
  });

  app.post("/api/accrual-policy-milestones", async (req, res) => {
    try {
      const item = await storage.createAccrualPolicyMilestone(req.body);
      res.status(201).json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to create milestone" });
    }
  });

  app.delete("/api/accrual-policy-milestones/:id", async (req, res) => {
    try {
      await storage.deleteAccrualPolicyMilestone(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete milestone" });
    }
  });

  // Absence Policies
  app.get("/api/absence-policies", async (_req, res) => {
    try {
      const items = await storage.getAbsencePolicies();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch absence policies" });
    }
  });

  app.post("/api/absence-policies", async (req, res) => {
    try {
      const item = await storage.createAbsencePolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to create absence policy" });
    }
  });

  app.patch("/api/absence-policies/:id", async (req, res) => {
    try {
      const item = await storage.updateAbsencePolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to update absence policy" });
    }
  });

  app.delete("/api/absence-policies/:id", async (req, res) => {
    try {
      await storage.deleteAbsencePolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete absence policy" });
    }
  });

  // Holiday Policies
  app.get("/api/holiday-policies", async (_req, res) => {
    try {
      const items = await storage.getHolidayPolicies();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch holiday policies" });
    }
  });

  app.post("/api/holiday-policies", async (req, res) => {
    try {
      const item = await storage.createHolidayPolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to create holiday policy" });
    }
  });

  app.patch("/api/holiday-policies/:id", async (req, res) => {
    try {
      const item = await storage.updateHolidayPolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to update holiday policy" });
    }
  });

  app.delete("/api/holiday-policies/:id", async (req, res) => {
    try {
      await storage.deleteHolidayPolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete holiday policy" });
    }
  });

  // Rounding Policies
  app.get("/api/rounding-policies", async (_req, res) => {
    try {
      const items = await storage.getRoundingPolicies();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch rounding policies" });
    }
  });

  app.post("/api/rounding-policies", async (req, res) => {
    try {
      const item = await storage.createRoundingPolicy(req.body);
      res.status(201).json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to create rounding policy" });
    }
  });

  app.patch("/api/rounding-policies/:id", async (req, res) => {
    try {
      const item = await storage.updateRoundingPolicy(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to update rounding policy" });
    }
  });

  app.delete("/api/rounding-policies/:id", async (req, res) => {
    try {
      await storage.deleteRoundingPolicy(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete rounding policy" });
    }
  });

  app.get("/api/legal-entities", async (_req, res) => {
    try {
      const items = await storage.getLegalEntities();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch legal entities" });
    }
  });

  app.post("/api/legal-entities", async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.startDate === "") data.startDate = null;
      if (data.endDate === "") data.endDate = null;
      if (data.classificationCode === "") data.classificationCode = null;
      const item = await storage.createLegalEntity(data);
      res.status(201).json(item);
    } catch (error: any) {
      console.error("Legal entity creation error:", error?.message || error);
      res.status(500).json({ message: "Failed to create legal entity" });
    }
  });

  app.patch("/api/legal-entities/:id", async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.startDate === "") data.startDate = null;
      if (data.endDate === "") data.endDate = null;
      if (data.classificationCode === "") data.classificationCode = null;
      const item = await storage.updateLegalEntity(req.params.id, data);
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to update legal entity" });
    }
  });

  app.delete("/api/legal-entities/:id", async (req, res) => {
    try {
      await storage.deleteLegalEntity(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete legal entity" });
    }
  });

  return httpServer;
}
