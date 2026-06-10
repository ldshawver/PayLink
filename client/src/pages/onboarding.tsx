import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Building2,
  Users,
  Landmark,
  Settings,
  Check,
  ChevronRight,
  ChevronLeft,
  Upload,
  Plus,
  Trash2,
  Info,
  Loader2,
  Rocket,
  PartyPopper,
  AlertCircle,
  Clock,
  FileText,
  ArrowRight,
  LayoutDashboard,
} from "lucide-react";

const STEPS = [
  { id: 1, key: "company",   label: "Company Setup",  icon: Building2, dbKey: "step_company_details",  description: "Legal name, address & EIN" },
  { id: 2, key: "payroll",   label: "Payroll Setup",  icon: Settings,  dbKey: "step_payroll_config",   description: "Pay frequency & overtime rules" },
  { id: 3, key: "employees", label: "Employees",      icon: Users,     dbKey: "step_first_employee",   description: "Add your team members" },
  { id: 4, key: "timeclock", label: "Time Clock",     icon: Clock,     dbKey: "step_time_clock",       description: "Configure punch-in settings" },
  { id: 5, key: "documents", label: "Documents",      icon: FileText,  dbKey: "step_payroll_preview",  description: "Upload policies & handbooks" },
  { id: 6, key: "bank",      label: "Bank Account",   icon: Landmark,  dbKey: "step_bank_connected",   description: "Payroll funding account" },
  { id: 7, key: "complete",  label: "Complete",       icon: PartyPopper, dbKey: "onboarding_wizard_completed", description: "You're all set!" },
];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

interface Employee {
  firstName: string;
  lastName: string;
  email: string;
  payRate: string;
  payType: string;
  workerType: string;
  jobTitle: string;
  pin: string;
}

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3.5 w-3.5 text-muted-foreground inline-block ml-1 cursor-help align-middle" />
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px]">
        <p className="text-xs">{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function StepSidebar({ currentStep, completedSteps }: { currentStep: number; completedSteps: Set<number> }) {
  return (
    <nav className="w-56 shrink-0 hidden md:block" data-testid="onboarding-sidebar">
      <ol className="space-y-1">
        {STEPS.map((step) => {
          const isActive = step.id === currentStep;
          const isDone = completedSteps.has(step.id);
          const Icon = step.icon;
          return (
            <li key={step.id} data-testid={`sidebar-step-${step.id}`}>
              <div
                className={`flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                  isActive
                    ? "bg-teal-500/10 border border-teal-500/30"
                    : isDone
                    ? "opacity-70"
                    : "opacity-40"
                }`}
              >
                <div
                  className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold border-2 ${
                    isDone
                      ? "bg-teal-500 border-teal-500 text-white"
                      : isActive
                      ? "border-teal-500 text-teal-600"
                      : "border-muted-foreground/40 text-muted-foreground"
                  }`}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3 w-3" />}
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-medium leading-tight ${isActive ? "text-teal-700 dark:text-teal-300" : "text-foreground"}`}>
                    {step.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{step.description}</p>
                </div>
              </div>
              {step.id < STEPS.length && (
                <div className="ml-6 w-0.5 h-2 bg-muted-foreground/20 mx-[11px]" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function MobileProgress({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) {
  const pct = Math.round(((currentStep - 1) / (totalSteps - 1)) * 100);
  const step = STEPS[currentStep - 1];
  const Icon = step.icon;
  return (
    <div className="md:hidden mb-6" data-testid="onboarding-mobile-progress">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-teal-500" />
          <span className="text-sm font-medium">{step.label}</span>
        </div>
        <span className="text-xs text-muted-foreground">Step {currentStep} of {totalSteps}</span>
      </div>
      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-teal-500 to-blue-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Step1CompanySetup({ data, onChange, onNext, isSaving }: {
  data: any; onChange: (f: string, v: string) => void; onNext: () => void; isSaving: boolean;
}) {
  const isValid = data.companyName?.trim();
  return (
    <Card data-testid="step-company-setup">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-teal-500" />
          Company Setup
        </CardTitle>
        <CardDescription>Tell us about your business</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Label htmlFor="companyName">
              Company Name <span className="text-red-500">*</span>
              <InfoTip text="Your legal business name as registered with the IRS" />
            </Label>
            <Input id="companyName" value={data.companyName || ""} onChange={(e) => onChange("companyName", e.target.value)}
              placeholder="Acme Corporation" data-testid="input-company-name" />
          </div>
          <div>
            <Label>Business Type</Label>
            <Select value={data.businessType || "llc"} onValueChange={(v) => onChange("businessType", v)}>
              <SelectTrigger data-testid="select-business-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sole_proprietorship">Sole Proprietorship</SelectItem>
                <SelectItem value="llc">LLC</SelectItem>
                <SelectItem value="s_corp">S-Corp</SelectItem>
                <SelectItem value="c_corp">C-Corp</SelectItem>
                <SelectItem value="partnership">Partnership</SelectItem>
                <SelectItem value="nonprofit">Nonprofit</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="ein">
              EIN <InfoTip text="Employer Identification Number (XX-XXXXXXX)" />
            </Label>
            <Input id="ein" value={data.ein || ""} onChange={(e) => onChange("ein", e.target.value)}
              placeholder="12-3456789" data-testid="input-ein" />
          </div>
          <div>
            <Label>State</Label>
            <Select value={data.state || "__none__"} onValueChange={(v) => onChange("state", v === "__none__" ? "" : v)}>
              <SelectTrigger data-testid="select-state"><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select state</SelectItem>
                {US_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>
              Number of Employees <InfoTip text="Approximate headcount helps us configure defaults" />
            </Label>
            <Select value={data.employeeCount || "__none__"} onValueChange={(v) => onChange("employeeCount", v === "__none__" ? "" : v)}>
              <SelectTrigger data-testid="select-employee-count"><SelectValue placeholder="Select range" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select range</SelectItem>
                <SelectItem value="1">1–5</SelectItem>
                <SelectItem value="10">6–25</SelectItem>
                <SelectItem value="50">26–100</SelectItem>
                <SelectItem value="200">101–500</SelectItem>
                <SelectItem value="1000">500+</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="address">Street Address</Label>
            <Input id="address" value={data.address || ""} onChange={(e) => onChange("address", e.target.value)}
              placeholder="123 Main St" data-testid="input-address" />
          </div>
          <div>
            <Label htmlFor="city">City</Label>
            <Input id="city" value={data.city || ""} onChange={(e) => onChange("city", e.target.value)}
              placeholder="Austin" data-testid="input-city" />
          </div>
          <div>
            <Label htmlFor="zip">ZIP Code</Label>
            <Input id="zip" value={data.zip || ""} onChange={(e) => onChange("zip", e.target.value)}
              placeholder="78701" data-testid="input-zip" />
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={data.phone || ""} onChange={(e) => onChange("phone", e.target.value)}
              placeholder="(512) 555-1234" data-testid="input-phone" />
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <Button onClick={onNext} disabled={!isValid || isSaving} data-testid="button-next-step-1">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Continue <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Step2PayrollSetup({ data, onChange, onNext, onBack, isSaving }: {
  data: any; onChange: (f: string, v: string) => void; onNext: () => void; onBack: () => void; isSaving: boolean;
}) {
  return (
    <Card data-testid="step-payroll-setup">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-teal-500" />
          Payroll Setup
        </CardTitle>
        <CardDescription>Configure pay schedules and overtime rules</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <Label>Pay Frequency <InfoTip text="How often you run payroll for your employees" /></Label>
          <Select value={data.payFrequency || "biweekly"} onValueChange={(v) => onChange("payFrequency", v)}>
            <SelectTrigger data-testid="select-pay-frequency"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly — 52 pay periods / year</SelectItem>
              <SelectItem value="biweekly">Biweekly — 26 pay periods / year</SelectItem>
              <SelectItem value="semimonthly">Semimonthly — 24 pay periods / year</SelectItem>
              <SelectItem value="monthly">Monthly — 12 pay periods / year</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="overtimeThreshold">
              Overtime Threshold (hrs/week) <InfoTip text="FLSA standard is 40 hours per week" />
            </Label>
            <Input id="overtimeThreshold" type="number" value={data.overtimeThreshold || "40"}
              onChange={(e) => onChange("overtimeThreshold", e.target.value)}
              data-testid="input-overtime-threshold" />
          </div>
          <div>
            <Label>Overtime Multiplier <InfoTip text="1.5× is standard time-and-a-half" /></Label>
            <Select value={data.overtimeMultiplier || "1.5"} onValueChange={(v) => onChange("overtimeMultiplier", v)}>
              <SelectTrigger data-testid="select-overtime-multiplier"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1.5">1.5× — Time and a half</SelectItem>
                <SelectItem value="2.0">2.0× — Double time</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="bg-muted/50 rounded-lg p-4">
          <p className="text-xs font-medium mb-2 text-foreground">Tax defaults applied automatically</p>
          <ul className="text-xs text-muted-foreground space-y-1.5">
            <li className="flex items-center gap-2"><Check className="h-3 w-3 text-teal-500 shrink-0" /> Federal income tax withholding</li>
            <li className="flex items-center gap-2"><Check className="h-3 w-3 text-teal-500 shrink-0" /> Social Security (6.2%) + Medicare (1.45%)</li>
            <li className="flex items-center gap-2"><Check className="h-3 w-3 text-teal-500 shrink-0" /> State tax auto-calculated from company state</li>
            <li className="flex items-center gap-2"><Check className="h-3 w-3 text-teal-500 shrink-0" /> FUTA employer-side contribution</li>
          </ul>
        </div>
        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={onBack} data-testid="button-back-step-2">
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Button onClick={onNext} disabled={isSaving} data-testid="button-next-step-2">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Continue <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Step3Employees({ employees, onAdd, onRemove, onChange, onNext, onBack, isSaving, onCsvUpload }: {
  employees: Employee[];
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onChange: (idx: number, field: string, value: string) => void;
  onNext: () => void;
  onBack: () => void;
  isSaving: boolean;
  onCsvUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const hasValid = employees.some((e) => e.firstName.trim() && e.lastName.trim());
  return (
    <Card data-testid="step-employees">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-teal-500" />
          Employees
        </CardTitle>
        <CardDescription>Add your team members manually or upload a CSV</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <label className="cursor-pointer">
            <input type="file" accept=".csv" className="hidden" onChange={onCsvUpload} data-testid="input-csv-upload" />
            <Badge variant="outline" className="cursor-pointer hover:bg-accent gap-1.5 py-1.5 px-3">
              <Upload className="h-3.5 w-3.5" /> Upload CSV
            </Badge>
          </label>
          <span className="text-xs text-muted-foreground">firstName, lastName, email, payRate, payType, jobTitle</span>
        </div>

        <div className="space-y-3">
          {employees.map((emp, idx) => (
            <div key={idx} className="border rounded-lg p-3 space-y-3" data-testid={`employee-row-${idx}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Employee {idx + 1}</span>
                {employees.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => onRemove(idx)} data-testid={`button-remove-employee-${idx}`}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">First Name <span className="text-red-500">*</span></Label>
                  <Input value={emp.firstName} onChange={(e) => onChange(idx, "firstName", e.target.value)}
                    placeholder="John" data-testid={`input-emp-first-${idx}`} />
                </div>
                <div>
                  <Label className="text-xs">Last Name <span className="text-red-500">*</span></Label>
                  <Input value={emp.lastName} onChange={(e) => onChange(idx, "lastName", e.target.value)}
                    placeholder="Smith" data-testid={`input-emp-last-${idx}`} />
                </div>
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input value={emp.email} onChange={(e) => onChange(idx, "email", e.target.value)}
                    placeholder="john@company.com" data-testid={`input-emp-email-${idx}`} />
                </div>
                <div>
                  <Label className="text-xs">Pay Rate ($)</Label>
                  <Input type="number" value={emp.payRate} onChange={(e) => onChange(idx, "payRate", e.target.value)}
                    placeholder="25.00" data-testid={`input-emp-rate-${idx}`} />
                </div>
                <div>
                  <Label className="text-xs">Pay Type</Label>
                  <Select value={emp.payType} onValueChange={(v) => onChange(idx, "payType", v)}>
                    <SelectTrigger data-testid={`select-emp-paytype-${idx}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">Hourly</SelectItem>
                      <SelectItem value="salary">Salary</SelectItem>
                      <SelectItem value="commission">Commission</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Job Title</Label>
                  <Input value={emp.jobTitle} onChange={(e) => onChange(idx, "jobTitle", e.target.value)}
                    placeholder="Manager" data-testid={`input-emp-title-${idx}`} />
                </div>
                <div>
                  <Label className="text-xs">Time Clock PIN</Label>
                  <Input type="password" value={emp.pin || ""} onChange={(e) => onChange(idx, "pin", e.target.value)}
                    placeholder="4-digit PIN" maxLength={8} data-testid={`input-emp-pin-${idx}`} />
                </div>
              </div>
            </div>
          ))}
        </div>

        <Button variant="outline" onClick={onAdd} className="w-full" data-testid="button-add-employee">
          <Plus className="h-4 w-4 mr-2" /> Add Another Employee
        </Button>

        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={onBack} data-testid="button-back-step-3">
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Button onClick={onNext} disabled={!hasValid || isSaving} data-testid="button-next-step-3">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Continue <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Step4Timeclock({ prefs, onChange, onNext, onBack, isSaving }: {
  prefs: { enabled: boolean; requirePin: boolean; roundMinutes: string };
  onChange: (field: string, value: any) => void;
  onNext: () => void;
  onBack: () => void;
  isSaving: boolean;
}) {
  return (
    <Card data-testid="step-timeclock">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-teal-500" />
          Time Clock
        </CardTitle>
        <CardDescription>Configure how employees punch in and out</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">Enable Time Clock</p>
            <p className="text-xs text-muted-foreground mt-0.5">Let employees punch in/out from any device or kiosk station</p>
          </div>
          <Switch
            checked={prefs.enabled}
            onCheckedChange={(v) => onChange("enabled", v)}
            data-testid="switch-timeclock-enabled"
          />
        </div>

        {prefs.enabled && (
          <div className="space-y-4 pl-1">
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium">Require PIN to Punch In</p>
                <p className="text-xs text-muted-foreground mt-0.5">Employees enter a 4–8 digit PIN at the time clock kiosk</p>
              </div>
              <Switch
                checked={prefs.requirePin}
                onCheckedChange={(v) => onChange("requirePin", v)}
                data-testid="switch-require-pin"
              />
            </div>
            <div>
              <Label>
                Time Rounding <InfoTip text="Round punch times to the nearest interval for cleaner records" />
              </Label>
              <Select value={prefs.roundMinutes} onValueChange={(v) => onChange("roundMinutes", v)}>
                <SelectTrigger data-testid="select-round-minutes"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">No rounding (exact punch time)</SelectItem>
                  <SelectItem value="5">Round to nearest 5 minutes</SelectItem>
                  <SelectItem value="15">Round to nearest 15 minutes</SelectItem>
                  <SelectItem value="30">Round to nearest 30 minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="bg-muted/50 rounded-lg p-4">
          <p className="text-xs font-medium mb-2 text-foreground">What you can do with Time Clock</p>
          <ul className="text-xs text-muted-foreground space-y-1.5">
            <li className="flex items-center gap-2"><Check className="h-3 w-3 text-teal-500 shrink-0" /> Kiosk mode on a shared tablet or PC</li>
            <li className="flex items-center gap-2"><Check className="h-3 w-3 text-teal-500 shrink-0" /> Mobile punch-in via the PayLink app</li>
            <li className="flex items-center gap-2"><Check className="h-3 w-3 text-teal-500 shrink-0" /> Automatic time entry creation for payroll</li>
            <li className="flex items-center gap-2"><Check className="h-3 w-3 text-teal-500 shrink-0" /> Break tracking and overtime alerts</li>
          </ul>
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={onBack} data-testid="button-back-step-4">
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Button onClick={onNext} disabled={isSaving} data-testid="button-next-step-4">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Continue <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Step5Documents({ onNext, onBack, isSaving }: {
  onNext: () => void; onBack: () => void; isSaving: boolean;
}) {
  const [, setLocation] = useLocation();
  return (
    <Card data-testid="step-documents">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-teal-500" />
          Documents
        </CardTitle>
        <CardDescription>Upload company policies, handbooks, and onboarding materials</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { title: "Employee Handbook", desc: "Policies, code of conduct, benefits overview" },
            { title: "Offer Letter Template", desc: "Standard offer letter for new hires" },
            { title: "W-4 / I-9 Forms", desc: "Federal tax and work eligibility forms" },
            { title: "Direct Deposit Form", desc: "Bank info authorization for employees" },
          ].map((doc) => (
            <div key={doc.title} className="flex items-start gap-3 rounded-lg border p-3 bg-muted/30">
              <FileText className="h-4 w-4 text-teal-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">{doc.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{doc.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            You can upload and manage all company documents from <strong>HR → Documents</strong> at any time. 
            Documents can be sent for e-signature and attached to onboarding packets.
          </p>
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={onBack} data-testid="button-back-step-5">
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { onNext(); setTimeout(() => setLocation("/app/documents"), 100); }}
              data-testid="button-upload-documents">
              <Upload className="h-4 w-4 mr-2" /> Upload Now
            </Button>
            <Button onClick={onNext} disabled={isSaving} data-testid="button-skip-documents">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Skip for Now <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Step6Bank({ data, onChange, onNext, onBack, isSaving, onSkip }: {
  data: any; onChange: (f: string, v: string) => void; onNext: () => void;
  onBack: () => void; isSaving: boolean; onSkip: () => void;
}) {
  return (
    <Card data-testid="step-bank-account">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="h-5 w-5 text-teal-500" />
          Bank Account
        </CardTitle>
        <CardDescription>Connect a funding account for payroll direct deposits</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            Bank details are stored securely and used only for payroll funding. You can update them anytime in Settings → Banking.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Label htmlFor="bankName">Bank Name</Label>
            <Input id="bankName" value={data.bankName || ""} onChange={(e) => onChange("bankName", e.target.value)}
              placeholder="First National Bank" data-testid="input-bank-name" />
          </div>
          <div>
            <Label htmlFor="routingNumber">
              Routing Number <InfoTip text="9-digit ABA routing number on your checks" />
            </Label>
            <Input id="routingNumber" value={data.routingNumber || ""} onChange={(e) => onChange("routingNumber", e.target.value)}
              placeholder="021000021" data-testid="input-routing" />
          </div>
          <div>
            <Label htmlFor="accountNumber">Account Number</Label>
            <Input id="accountNumber" type="password" value={data.accountNumber || ""}
              onChange={(e) => onChange("accountNumber", e.target.value)}
              placeholder="123456789" data-testid="input-account" />
          </div>
          <div>
            <Label>Account Type</Label>
            <Select value={data.accountType || "checking"} onValueChange={(v) => onChange("accountType", v)}>
              <SelectTrigger data-testid="select-account-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="checking">Checking</SelectItem>
                <SelectItem value="savings">Savings</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={onBack} data-testid="button-back-step-6">
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onSkip} data-testid="button-skip-bank">
              Skip for Now
            </Button>
            <Button onClick={onNext} disabled={isSaving} data-testid="button-next-step-6">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Continue <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Step7Complete({ onFinish, isSaving }: { onFinish: () => void; isSaving: boolean }) {
  const [, setLocation] = useLocation();
  return (
    <Card data-testid="step-complete">
      <CardContent className="pt-8 pb-8">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-teal-400 to-blue-500 flex items-center justify-center shadow-lg">
              <PartyPopper className="h-10 w-10 text-white" />
            </div>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground" data-testid="text-complete-title">You're all set!</h2>
            <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
              PayLink is configured and ready. Your team can start tracking time and you can run your first payroll.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 text-left max-w-xl mx-auto">
            {[
              { icon: Clock, label: "Time Clock", desc: "Employees can punch in now", path: "/app/time-clock" },
              { icon: Users, label: "Employees", desc: "View and manage your team", path: "/app/workers" },
              { icon: Settings, label: "Payroll", desc: "Run your first payroll", path: "/app/payroll" },
            ].map(({ icon: Icon, label, desc, path }) => (
              <button
                key={label}
                onClick={() => { onFinish(); setTimeout(() => setLocation(path), 100); }}
                className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent transition-colors text-left"
                data-testid={`link-complete-${label.toLowerCase().replace(/\s/g, "-")}`}
              >
                <Icon className="h-4 w-4 text-teal-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground ml-auto mt-0.5 shrink-0" />
              </button>
            ))}
          </div>

          <div className="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              onClick={onFinish}
              disabled={isSaving}
              className="bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white"
              data-testid="button-go-to-dashboard"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <LayoutDashboard className="h-4 w-4 mr-2" />}
              Go to Dashboard
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function OnboardingWizard() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const [businessData, setBusinessData] = useState({
    companyName: "", businessType: "llc", ein: "", state: "", employeeCount: "",
    address: "", city: "", zip: "", phone: "",
  });
  const [payrollData, setPayrollData] = useState({
    payFrequency: "biweekly", overtimeThreshold: "40", overtimeMultiplier: "1.5",
  });
  const [employees, setEmployees] = useState<Employee[]>([
    { firstName: "", lastName: "", email: "", payRate: "", payType: "hourly", workerType: "employee", jobTitle: "", pin: "" },
  ]);
  const [timeclockPrefs, setTimeclockPrefs] = useState({
    enabled: true, requirePin: true, roundMinutes: "1",
  });
  const [bankData, setBankData] = useState({
    bankName: "", routingNumber: "", accountNumber: "", accountType: "checking",
  });

  const { data: progress } = useQuery<any>({
    queryKey: ["/api/onboarding/progress"],
  });

  useEffect(() => {
    if (progress?.onboarding_wizard_completed) {
      setLocation("/app");
    }
  }, [progress, setLocation]);

  const markStep = (stepNum: number) => {
    setCompletedSteps((prev) => new Set([...prev, stepNum]));
    setCurrentStep(stepNum + 1);
    queryClient.invalidateQueries({ queryKey: ["/api/onboarding/progress"] });
  };

  const businessMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/onboarding/business-info", businessData),
    onSuccess: () => markStep(1),
    onError: (e: any) => toast({ title: "Error", description: e.message || "Failed to save company info", variant: "destructive" }),
  });

  const payrollMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/onboarding/payroll-setup", payrollData),
    onSuccess: () => markStep(2),
    onError: (e: any) => toast({ title: "Error", description: e.message || "Failed to save payroll setup", variant: "destructive" }),
  });

  const employeeMutation = useMutation({
    mutationFn: () => {
      const valid = employees.filter((e) => e.firstName.trim() && e.lastName.trim());
      return apiRequest("POST", "/api/onboarding/add-employees-csv", { employees: valid });
    },
    onSuccess: () => markStep(3),
    onError: (e: any) => toast({ title: "Error", description: e.message || "Failed to add employees", variant: "destructive" }),
  });

  const timeclockMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/onboarding/progress", { step: "step_time_clock" }),
    onSuccess: () => markStep(4),
    onError: (e: any) => toast({ title: "Error", description: e.message || "Failed to save time clock settings", variant: "destructive" }),
  });

  const documentsMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/onboarding/progress", { step: "step_payroll_preview" }),
    onSuccess: () => markStep(5),
    onError: (e: any) => toast({ title: "Error", description: e.message || "Failed to save documents step", variant: "destructive" }),
  });

  const bankMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/onboarding/bank-info", bankData),
    onSuccess: () => markStep(6),
    onError: (e: any) => toast({ title: "Error", description: e.message || "Failed to save bank info", variant: "destructive" }),
  });

  const completeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/onboarding/complete-wizard"),
    onSuccess: () => {
      toast({ title: "Setup Complete!", description: "Welcome to PayLink!" });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/progress"] });
      setLocation("/app");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message || "Failed to complete wizard", variant: "destructive" }),
  });

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").filter((l) => l.trim());
      const parsed: Employee[] = [];
      for (const line of lines) {
        const cols = line.split(",").map((c) => c.trim());
        if (cols.length < 2) continue;
        if (cols[0].toLowerCase() === "firstname" || cols[0].toLowerCase() === "first name") continue;
        parsed.push({
          firstName: cols[0] || "", lastName: cols[1] || "", email: cols[2] || "",
          payRate: cols[3] || "", payType: cols[4] || "hourly",
          workerType: "employee", jobTitle: cols[5] || "", pin: "",
        });
      }
      if (parsed.length > 0) {
        setEmployees(parsed);
        toast({ title: "CSV Loaded", description: `${parsed.length} employee(s) imported` });
      } else {
        toast({ title: "No Data", description: "No valid rows found in CSV", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const isSaving =
    businessMutation.isPending || payrollMutation.isPending || employeeMutation.isPending ||
    timeclockMutation.isPending || documentsMutation.isPending || bankMutation.isPending || completeMutation.isPending;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Rocket className="h-6 w-6 text-teal-500" />
            <h1
              className="text-2xl font-bold bg-gradient-to-r from-teal-600 to-blue-600 bg-clip-text text-transparent"
              data-testid="text-wizard-title"
            >
              Welcome to PayLink
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">Get your payroll up and running in minutes</p>
        </div>

        <MobileProgress currentStep={currentStep} totalSteps={STEPS.length} />

        <div className="flex gap-8 items-start">
          <StepSidebar currentStep={currentStep} completedSteps={completedSteps} />

          <div className="flex-1 min-w-0">
            {currentStep === 1 && (
              <Step1CompanySetup
                data={businessData}
                onChange={(f, v) => setBusinessData((p) => ({ ...p, [f]: v }))}
                onNext={() => businessMutation.mutate()}
                isSaving={businessMutation.isPending}
              />
            )}
            {currentStep === 2 && (
              <Step2PayrollSetup
                data={payrollData}
                onChange={(f, v) => setPayrollData((p) => ({ ...p, [f]: v }))}
                onNext={() => payrollMutation.mutate()}
                onBack={() => setCurrentStep(1)}
                isSaving={payrollMutation.isPending}
              />
            )}
            {currentStep === 3 && (
              <Step3Employees
                employees={employees}
                onAdd={() => setEmployees((p) => [...p, { firstName: "", lastName: "", email: "", payRate: "", payType: "hourly", workerType: "employee", jobTitle: "", pin: "" }])}
                onRemove={(idx) => setEmployees((p) => p.filter((_, i) => i !== idx))}
                onChange={(idx, f, v) => setEmployees((p) => p.map((e, i) => (i === idx ? { ...e, [f]: v } : e)))}
                onNext={() => employeeMutation.mutate()}
                onBack={() => setCurrentStep(2)}
                isSaving={employeeMutation.isPending}
                onCsvUpload={handleCsvUpload}
              />
            )}
            {currentStep === 4 && (
              <Step4Timeclock
                prefs={timeclockPrefs}
                onChange={(f, v) => setTimeclockPrefs((p) => ({ ...p, [f]: v }))}
                onNext={() => timeclockMutation.mutate()}
                onBack={() => setCurrentStep(3)}
                isSaving={timeclockMutation.isPending}
              />
            )}
            {currentStep === 5 && (
              <Step5Documents
                onNext={() => documentsMutation.mutate()}
                onBack={() => setCurrentStep(4)}
                isSaving={documentsMutation.isPending}
              />
            )}
            {currentStep === 6 && (
              <Step6Bank
                data={bankData}
                onChange={(f, v) => setBankData((p) => ({ ...p, [f]: v }))}
                onNext={() => bankMutation.mutate()}
                onBack={() => setCurrentStep(5)}
                isSaving={bankMutation.isPending}
                onSkip={() => { setCompletedSteps((p) => new Set([...p, 6])); setCurrentStep(7); }}
              />
            )}
            {currentStep === 7 && (
              <Step7Complete
                onFinish={() => completeMutation.mutate()}
                isSaving={completeMutation.isPending}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
