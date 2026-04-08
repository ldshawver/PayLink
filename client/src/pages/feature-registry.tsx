import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, ExternalLink } from "lucide-react";

type FeatureEntry = {
  id: string;
  module: string;
  feature: string;
  layer: "platform" | "tenant" | "employee";
  deptOwner: string;
  visibility: string;
  editRights: string;
  approvalRights: string;
  auditRequired: boolean;
  scope: "platform-wide" | "per-tenant" | "per-worker";
  dependencies: string;
};

const FEATURES: FeatureEntry[] = [
  // ── Platform Console ───────────────────────────────────────────────────────
  { id: "p01", module: "Sales & Licensing", feature: "Deal Pipeline", layer: "platform", deptOwner: "Sales / CSM", visibility: "Platform Admins only", editRights: "Admin + CSM", approvalRights: "CSM Lead", auditRequired: true, scope: "platform-wide", dependencies: "CRM" },
  { id: "p02", module: "Sales & Licensing", feature: "License Requests", layer: "platform", deptOwner: "Legal / IT", visibility: "Platform Admins only", editRights: "Admin only", approvalRights: "Platform Owner", auditRequired: true, scope: "platform-wide", dependencies: "Deal Pipeline" },
  { id: "p03", module: "Sales & Licensing", feature: "Agreements — Templates", layer: "platform", deptOwner: "Legal", visibility: "Platform Admins only", editRights: "Admin only", approvalRights: "Legal Team", auditRequired: true, scope: "platform-wide", dependencies: "License Requests" },
  { id: "p04", module: "Sales & Licensing", feature: "Agreements — Signed", layer: "platform", deptOwner: "Legal", visibility: "Platform Admins only", editRights: "Read-only", approvalRights: "Legal Team", auditRequired: true, scope: "platform-wide", dependencies: "Agreements Templates" },
  { id: "p05", module: "Customer Success", feature: "Onboarding Projects", layer: "platform", deptOwner: "Customer Success", visibility: "Platform Admins + CS Team", editRights: "CS Lead + Admin", approvalRights: "CS Lead", auditRequired: true, scope: "per-tenant", dependencies: "Deal Pipeline" },
  { id: "p06", module: "Customer Success", feature: "Onboarding Templates", layer: "platform", deptOwner: "Customer Success", visibility: "Platform Admins only", editRights: "Admin only", approvalRights: "None", auditRequired: false, scope: "platform-wide", dependencies: "Onboarding Projects" },
  { id: "p07", module: "Customer Success", feature: "Engagement Feed", layer: "platform", deptOwner: "Customer Success", visibility: "Platform Admins + CS Team", editRights: "CS Team", approvalRights: "None", auditRequired: false, scope: "platform-wide", dependencies: "Onboarding Projects" },
  { id: "p08", module: "Customer Success", feature: "Contractor Onboarding", layer: "platform", deptOwner: "Operations", visibility: "Platform Admins only", editRights: "Admin", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "Agreements" },
  { id: "p09", module: "Platform Admin", feature: "Provisioning & Tenant Setup", layer: "platform", deptOwner: "Engineering / DevOps", visibility: "Platform Admins only", editRights: "Admin only", approvalRights: "Platform Owner", auditRequired: true, scope: "platform-wide", dependencies: "License Requests" },
  { id: "p10", module: "Platform Admin", feature: "Permissions (Platform-level)", layer: "platform", deptOwner: "Security", visibility: "Platform Admins only", editRights: "Admin only", approvalRights: "Platform Owner", auditRequired: true, scope: "platform-wide", dependencies: "Provisioning" },
  { id: "p11", module: "Platform Admin", feature: "Platform Audit Log", layer: "platform", deptOwner: "Security / Legal", visibility: "Admin + Auditor", editRights: "Read-only", approvalRights: "None", auditRequired: true, scope: "platform-wide", dependencies: "All modules" },
  { id: "p12", module: "Platform Admin", feature: "Platform Billing", layer: "platform", deptOwner: "Finance", visibility: "Platform Admins only", editRights: "Admin only", approvalRights: "Platform Owner", auditRequired: true, scope: "platform-wide", dependencies: "Stripe" },
  { id: "p13", module: "Platform Admin", feature: "Feature Registry", layer: "platform", deptOwner: "Product", visibility: "Platform Admins only", editRights: "Product team", approvalRights: "Product Owner", auditRequired: false, scope: "platform-wide", dependencies: "None" },

  // ── Tenant App ─────────────────────────────────────────────────────────────
  { id: "t01", module: "Home", feature: "Dashboard", layer: "tenant", deptOwner: "All / HR", visibility: "All users", editRights: "None (read-only)", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "All modules" },
  { id: "t02", module: "Home", feature: "Messages / Message Center", layer: "tenant", deptOwner: "HR / Management", visibility: "All users (send: Admin/Manager)", editRights: "Admin + Manager (broadcast)", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "Workers, SMTP, Twilio" },
  { id: "t03", module: "My Work", feature: "Timesheet", layer: "tenant", deptOwner: "HR / Operations", visibility: "All (own records)", editRights: "Manager (team), Admin", approvalRights: "Manager", auditRequired: true, scope: "per-tenant", dependencies: "Time Clock, Schedules" },
  { id: "t04", module: "My Work", feature: "Time Punches", layer: "tenant", deptOwner: "Operations", visibility: "All (own), Manager (team)", editRights: "Manager + Admin", approvalRights: "Manager", auditRequired: true, scope: "per-tenant", dependencies: "Stations, Schedules" },
  { id: "t05", module: "My Work", feature: "Accrual Balances", layer: "tenant", deptOwner: "HR", visibility: "All (own)", editRights: "Admin only", approvalRights: "Manager", auditRequired: false, scope: "per-tenant", dependencies: "Accrual Policies" },
  { id: "t06", module: "My Work", feature: "Accruals (Admin)", layer: "tenant", deptOwner: "HR", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "Admin", auditRequired: false, scope: "per-tenant", dependencies: "Accrual Policies" },
  { id: "t07", module: "My Work", feature: "Pending Approvals", layer: "tenant", deptOwner: "HR / Management", visibility: "Admin + Manager", editRights: "Admin + Manager", approvalRights: "Manager", auditRequired: true, scope: "per-tenant", dependencies: "Attendance" },
  { id: "t08", module: "My Work", feature: "Time Off", layer: "tenant", deptOwner: "HR", visibility: "All (own), Manager (team)", editRights: "Self (request), Manager (approve)", approvalRights: "Manager", auditRequired: false, scope: "per-tenant", dependencies: "Absence Policies" },
  { id: "t09", module: "My Work", feature: "Schedule Preferences", layer: "tenant", deptOwner: "Operations", visibility: "All (own)", editRights: "Self", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "Schedule" },
  { id: "t10", module: "My Work", feature: "Expenses & Invoices", layer: "tenant", deptOwner: "Finance", visibility: "All (own), Admin/Manager (team)", editRights: "Self (submit), Admin/Manager (approve)", approvalRights: "Manager", auditRequired: false, scope: "per-tenant", dependencies: "Workers" },
  { id: "t11", module: "My Work", feature: "Schedule", layer: "tenant", deptOwner: "Operations", visibility: "All (own), Manager (team)", editRights: "Manager", approvalRights: "Manager", auditRequired: false, scope: "per-tenant", dependencies: "Departments, Positions" },
  { id: "t12", module: "My Work", feature: "Shift Marketplace", layer: "tenant", deptOwner: "Operations", visibility: "All", editRights: "Admin + Manager (publish)", approvalRights: "Manager", auditRequired: false, scope: "per-tenant", dependencies: "Schedule" },
  { id: "t13", module: "Workforce", feature: "Employee Directory", layer: "tenant", deptOwner: "HR", visibility: "Admin + Manager", editRights: "Admin + Manager", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "None" },
  { id: "t14", module: "Workforce", feature: "User Accounts", layer: "tenant", deptOwner: "IT / HR", visibility: "Admin only", editRights: "Admin only", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "Workers" },
  { id: "t15", module: "Workforce", feature: "Wages & Pay Methods", layer: "tenant", deptOwner: "Finance / HR", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "Workers" },
  { id: "t16", module: "Workforce", feature: "Employee Groups", layer: "tenant", deptOwner: "HR", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "Workers" },
  { id: "t17", module: "Workforce", feature: "New Hire Defaults", layer: "tenant", deptOwner: "HR", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "None" },
  { id: "t18", module: "HR", feature: "Performance Reviews", layer: "tenant", deptOwner: "HR", visibility: "Admin/Manager + own", editRights: "Admin + Manager", approvalRights: "Manager", auditRequired: false, scope: "per-tenant", dependencies: "Workers, KPI Groups" },
  { id: "t19", module: "HR", feature: "Qualifications & Skills", layer: "tenant", deptOwner: "HR", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "Workers" },
  { id: "t20", module: "HR", feature: "Education & Licenses", layer: "tenant", deptOwner: "HR", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "Workers" },
  { id: "t21", module: "Payroll", feature: "Process Payroll", layer: "tenant", deptOwner: "Finance / HR", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "Workers, Pay Periods, Taxes" },
  { id: "t22", module: "Payroll", feature: "Pay Stubs", layer: "tenant", deptOwner: "Finance", visibility: "Admin/Manager (all), Employee (own)", editRights: "Admin only", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "Payroll Runs" },
  { id: "t23", module: "Payroll", feature: "Pay Stub Amendments", layer: "tenant", deptOwner: "Finance", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "Payroll" },
  { id: "t24", module: "Payroll", feature: "Taxes & Deductions", layer: "tenant", deptOwner: "Finance", visibility: "Admin only", editRights: "Admin", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "Payroll" },
  { id: "t25", module: "Payroll", feature: "Remittance Agencies", layer: "tenant", deptOwner: "Finance", visibility: "Admin only", editRights: "Admin", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "Payroll" },
  { id: "t26", module: "Payroll", feature: "Payroll Audit", layer: "tenant", deptOwner: "Finance / Audit", visibility: "Admin + Manager", editRights: "Read-only", approvalRights: "None", auditRequired: true, scope: "per-tenant", dependencies: "Payroll Runs" },
  { id: "t27", module: "Payroll", feature: "Stripe Treasury", layer: "tenant", deptOwner: "Finance", visibility: "Admin only", editRights: "Admin", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "Stripe" },
  { id: "t28", module: "Policies & Rules", feature: "Policy Groups", layer: "tenant", deptOwner: "HR / Operations", visibility: "Admin only", editRights: "Admin", approvalRights: "Admin", auditRequired: false, scope: "per-tenant", dependencies: "None" },
  { id: "t29", module: "Policies & Rules", feature: "Pay Codes & Formulas", layer: "tenant", deptOwner: "Finance", visibility: "Admin only", editRights: "Admin", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "Policy Groups" },
  { id: "t30", module: "Policies & Rules", feature: "Overtime Policies", layer: "tenant", deptOwner: "HR / Operations", visibility: "Admin only", editRights: "Admin", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "Policy Groups" },
  { id: "t31", module: "Policies & Rules", feature: "Accrual & Absence Policies", layer: "tenant", deptOwner: "HR", visibility: "Admin only", editRights: "Admin", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "Policy Groups" },
  { id: "t32", module: "Policies & Rules", feature: "Meal & Break Policies", layer: "tenant", deptOwner: "Operations / Legal", visibility: "Admin only", editRights: "Admin", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "Policy Groups" },
  { id: "t33", module: "Finance", feature: "Invoicing (Business)", layer: "tenant", deptOwner: "Finance / Sales", visibility: "Admin + Manager", editRights: "Admin + Manager", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "Customers" },
  { id: "t34", module: "Finance", feature: "Invoices & Proposals (Biz-Docs)", layer: "tenant", deptOwner: "Finance", visibility: "Admin + Manager", editRights: "Admin + Manager", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "Customers, Workers" },
  { id: "t35", module: "Finance", feature: "Contractor Hub", layer: "tenant", deptOwner: "Finance / Operations", visibility: "Admin/Manager + Contractor (own)", editRights: "Contractor (proposals), Admin (payments)", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "Workers, Contractors" },
  { id: "t36", module: "Finance", feature: "Trade Compensation", layer: "tenant", deptOwner: "Finance", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "Workers, Payroll" },
  { id: "t37", module: "Finance", feature: "Customers & Vendors", layer: "tenant", deptOwner: "Sales / Admin", visibility: "Admin + Manager", editRights: "Admin + Manager", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "None" },
  { id: "t38", module: "Reports", feature: "Payroll Reports", layer: "tenant", deptOwner: "Finance", visibility: "Admin + Manager", editRights: "None (read-only)", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "Payroll" },
  { id: "t39", module: "Reports", feature: "HR & Employee Reports", layer: "tenant", deptOwner: "HR", visibility: "Admin + Manager", editRights: "None (read-only)", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "Workers, HR" },
  { id: "t40", module: "Reports", feature: "Timesheet Reports", layer: "tenant", deptOwner: "Operations", visibility: "Admin + Manager", editRights: "None (read-only)", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "Attendance" },
  { id: "t41", module: "Organization", feature: "Company Information", layer: "tenant", deptOwner: "Admin", visibility: "Admin + Manager (view)", editRights: "Admin", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "None" },
  { id: "t42", module: "Organization", feature: "Departments / Divisions / Branches", layer: "tenant", deptOwner: "Admin", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "Company" },
  { id: "t43", module: "Organization", feature: "Stations & Cost Centers", layer: "tenant", deptOwner: "Operations / Finance", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "Company" },
  { id: "t44", module: "Documents & Compliance", feature: "Company Documents", layer: "tenant", deptOwner: "Legal / HR", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "None" },
  { id: "t45", module: "Documents & Compliance", feature: "Document E-Signatures", layer: "tenant", deptOwner: "Legal", visibility: "Admin + Manager + Signers", editRights: "Admin", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "Company Documents" },
  { id: "t46", module: "Documents & Compliance", feature: "Retention Policies", layer: "tenant", deptOwner: "Legal", visibility: "Admin only", editRights: "Admin", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "Company Documents" },
  { id: "t47", module: "System Admin", feature: "Settings", layer: "tenant", deptOwner: "IT / Admin", visibility: "Admin only", editRights: "Admin", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "None" },
  { id: "t48", module: "System Admin", feature: "Alert Templates", layer: "tenant", deptOwner: "IT / HR", visibility: "Admin only", editRights: "Admin", approvalRights: "None", auditRequired: false, scope: "per-tenant", dependencies: "Notifications" },
  { id: "t49", module: "System Admin", feature: "Automation Engine", layer: "tenant", deptOwner: "IT / Operations", visibility: "Admin only", editRights: "Admin", approvalRights: "Admin", auditRequired: true, scope: "per-tenant", dependencies: "All modules" },

  // ── Employee Portal ────────────────────────────────────────────────────────
  { id: "e01", module: "Employee Portal", feature: "My Profile", layer: "employee", deptOwner: "HR / Self", visibility: "Self only", editRights: "Self", approvalRights: "None", auditRequired: false, scope: "per-worker", dependencies: "Workers" },
  { id: "e02", module: "Employee Portal", feature: "Personal Schedule", layer: "employee", deptOwner: "Operations", visibility: "Self only", editRights: "None (read-only)", approvalRights: "Manager", auditRequired: false, scope: "per-worker", dependencies: "Schedule" },
  { id: "e03", module: "Employee Portal", feature: "Personal Punches / Clock In-Out", layer: "employee", deptOwner: "Operations", visibility: "Self only", editRights: "None (Manager adjusts)", approvalRights: "Manager", auditRequired: true, scope: "per-worker", dependencies: "Stations, Schedules" },
  { id: "e04", module: "Employee Portal", feature: "Personal Timesheets", layer: "employee", deptOwner: "HR", visibility: "Self only", editRights: "None (read-only)", approvalRights: "Manager", auditRequired: false, scope: "per-worker", dependencies: "Attendance" },
  { id: "e05", module: "Employee Portal", feature: "Time Off Requests", layer: "employee", deptOwner: "HR", visibility: "Self only", editRights: "Self (submit only)", approvalRights: "Manager", auditRequired: false, scope: "per-worker", dependencies: "Absence Policies" },
  { id: "e06", module: "Employee Portal", feature: "Pay Stubs (Personal)", layer: "employee", deptOwner: "Finance", visibility: "Self only", editRights: "None (read-only)", approvalRights: "None", auditRequired: false, scope: "per-worker", dependencies: "Payroll" },
  { id: "e07", module: "Employee Portal", feature: "Personal Documents", layer: "employee", deptOwner: "HR / Legal", visibility: "Self + Admin/HR", editRights: "Self (acknowledge), Admin (assign)", approvalRights: "Admin", auditRequired: false, scope: "per-worker", dependencies: "Company Documents" },
  { id: "e08", module: "Employee Portal", feature: "Notifications", layer: "employee", deptOwner: "IT / HR", visibility: "Self only", editRights: "Self (preferences)", approvalRights: "None", auditRequired: false, scope: "per-worker", dependencies: "Alert Templates" },
  { id: "e09", module: "Employee Portal", feature: "Messages (Personal)", layer: "employee", deptOwner: "HR / Management", visibility: "Self only", editRights: "Self (reply only)", approvalRights: "None", auditRequired: false, scope: "per-worker", dependencies: "Staff Messages" },
  { id: "e10", module: "Employee Portal", feature: "Expense Submission", layer: "employee", deptOwner: "Finance", visibility: "Self only", editRights: "Self (submit)", approvalRights: "Manager", auditRequired: false, scope: "per-worker", dependencies: "Expenses" },
  { id: "e11", module: "Employee Portal", feature: "Shift Marketplace (Personal)", layer: "employee", deptOwner: "Operations", visibility: "Self — available shifts", editRights: "Self (request shifts)", approvalRights: "Manager", auditRequired: false, scope: "per-worker", dependencies: "Schedule" },
];

const LAYER_CONFIG = {
  platform: { label: "Platform Console", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300", dot: "bg-amber-500" },
  tenant:   { label: "Tenant App",       color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",   dot: "bg-blue-500" },
  employee: { label: "Employee Portal",  color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300", dot: "bg-green-500" },
};

const SCOPE_CONFIG = {
  "platform-wide": "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "per-tenant":    "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  "per-worker":    "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
};

export default function FeatureRegistryPage() {
  const [search, setSearch] = useState("");
  const [layerFilter, setLayerFilter] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");

  const allModules = Array.from(new Set(FEATURES.map(f => f.module))).sort();

  const filtered = FEATURES.filter(f => {
    const matchSearch = !search || [f.module, f.feature, f.deptOwner, f.visibility, f.editRights, f.dependencies]
      .some(v => v.toLowerCase().includes(search.toLowerCase()));
    const matchLayer = layerFilter === "all" || f.layer === layerFilter;
    const matchModule = moduleFilter === "all" || f.module === moduleFilter;
    return matchSearch && matchLayer && matchModule;
  });

  const counts = {
    platform: FEATURES.filter(f => f.layer === "platform").length,
    tenant: FEATURES.filter(f => f.layer === "tenant").length,
    employee: FEATURES.filter(f => f.layer === "employee").length,
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-lg font-semibold">Feature Registry</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {FEATURES.length} features across 3 product layers — governance, ownership, and access control matrix
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(counts).map(([layer, count]) => {
              const cfg = LAYER_CONFIG[layer as keyof typeof LAYER_CONFIG];
              return (
                <span key={layer} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.color}`}>
                  <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                  {cfg.label}: {count}
                </span>
              );
            })}
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mt-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search features, owners, dependencies..." className="pl-8 h-8 text-sm" data-testid="input-registry-search" />
          </div>
          <Select value={layerFilter} onValueChange={setLayerFilter}>
            <SelectTrigger className="h-8 w-40 text-sm" data-testid="select-layer-filter"><SelectValue placeholder="All Layers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Layers</SelectItem>
              <SelectItem value="platform">Platform Console</SelectItem>
              <SelectItem value="tenant">Tenant App</SelectItem>
              <SelectItem value="employee">Employee Portal</SelectItem>
            </SelectContent>
          </Select>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="h-8 w-48 text-sm" data-testid="select-module-filter"><SelectValue placeholder="All Modules" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Modules</SelectItem>
              {allModules.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs min-w-[1200px]">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
            <tr>
              <th className="text-left p-3 font-semibold text-muted-foreground w-32">Module</th>
              <th className="text-left p-3 font-semibold text-muted-foreground w-48">Feature</th>
              <th className="text-left p-3 font-semibold text-muted-foreground w-32">Layer</th>
              <th className="text-left p-3 font-semibold text-muted-foreground w-32">Dept Owner</th>
              <th className="text-left p-3 font-semibold text-muted-foreground w-36">Visibility</th>
              <th className="text-left p-3 font-semibold text-muted-foreground w-36">Edit Rights</th>
              <th className="text-left p-3 font-semibold text-muted-foreground w-28">Approval Rights</th>
              <th className="text-center p-3 font-semibold text-muted-foreground w-20">Audit Req.</th>
              <th className="text-left p-3 font-semibold text-muted-foreground w-28">Scope</th>
              <th className="text-left p-3 font-semibold text-muted-foreground">Dependencies</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="text-center py-10 text-muted-foreground">No features match your filter</td></tr>
            )}
            {filtered.map(f => {
              const layerCfg = LAYER_CONFIG[f.layer];
              const scopeClass = SCOPE_CONFIG[f.scope];
              return (
                <tr key={f.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-feature-${f.id}`}>
                  <td className="p-3 font-medium text-foreground">{f.module}</td>
                  <td className="p-3 text-foreground font-medium">{f.feature}</td>
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${layerCfg.color}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${layerCfg.dot}`} />
                      {layerCfg.label}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground">{f.deptOwner}</td>
                  <td className="p-3 text-muted-foreground">{f.visibility}</td>
                  <td className="p-3 text-muted-foreground">{f.editRights}</td>
                  <td className="p-3 text-muted-foreground">{f.approvalRights}</td>
                  <td className="p-3 text-center">
                    {f.auditRequired ? (
                      <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700">✓</span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs ${scopeClass}`}>
                      {f.scope}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground">{f.dependencies}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-6 py-2 border-t bg-muted/20 flex items-center justify-between text-xs text-muted-foreground shrink-0">
        <span>Showing {filtered.length} of {FEATURES.length} features</span>
        <span>Last updated: {new Date().toLocaleDateString()}</span>
      </div>
    </div>
  );
}
