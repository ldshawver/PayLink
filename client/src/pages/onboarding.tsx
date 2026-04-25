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
import { Separator } from "@/components/ui/separator";
import {
  Building2,
  Users,
  Landmark,
  Settings,
  DollarSign,
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
} from "lucide-react";

const STEPS = [
  { id: 1, label: "Business Info", icon: Building2, description: "Tell us about your company" },
  { id: 2, label: "Add Employees", icon: Users, description: "Add your team members" },
  { id: 3, label: "Bank Account", icon: Landmark, description: "Connect your funding account" },
  { id: 4, label: "Payroll Setup", icon: Settings, description: "Configure pay schedules" },
  { id: 5, label: "Payroll Preview", icon: DollarSign, description: "Review your first payroll" },
];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"
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

interface PayrollEmployee {
  id: string;
  name: string;
  jobTitle: string;
  payType: string;
  payRate: number;
  hours: number | null;
  grossPay: number;
  federalTax: number;
  stateTax: number;
  fica: number;
  netPay: number;
}

interface PayrollPreview {
  payFrequency: string;
  periodHours: number;
  employees: PayrollEmployee[];
  totalGross: number;
  totalNet: number;
  totalTaxes: number;
}

function StepIndicator({ currentStep, completedSteps }: { currentStep: number; completedSteps: Set<number> }) {
  return (
    <div className="flex items-center justify-between w-full max-w-2xl mx-auto mb-8" data-testid="onboarding-step-indicator">
      {STEPS.map((step, idx) => {
        const isActive = step.id === currentStep;
        const isDone = completedSteps.has(step.id);
        const Icon = step.icon;
        return (
          <div key={step.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                  isDone
                    ? "bg-teal-500 border-teal-500 text-white"
                    : isActive
                    ? "border-teal-500 bg-teal-500/10 text-teal-600"
                    : "border-muted-foreground/30 text-muted-foreground/50"
                }`}
                data-testid={`step-indicator-${step.id}`}
              >
                {isDone ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
              </div>
              <span className={`text-xs mt-1.5 font-medium hidden sm:block ${isActive ? "text-teal-600" : "text-muted-foreground"}`}>
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 mt-[-1rem] sm:mt-0 ${isDone ? "bg-teal-500" : "bg-muted-foreground/20"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-4 w-4 text-muted-foreground inline-block ml-1 cursor-help" />
      </TooltipTrigger>
      <TooltipContent className="max-w-[250px]">
        <p className="text-xs">{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function Step1BusinessInfo({ data, onChange, onNext, isSaving }: {
  data: any;
  onChange: (field: string, value: string) => void;
  onNext: () => void;
  isSaving: boolean;
}) {
  const isValid = data.companyName?.trim();

  return (
    <Card className="max-w-2xl mx-auto" data-testid="step-business-info">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-teal-500" />
          Business Information
        </CardTitle>
        <CardDescription>Let's start with the basics about your company</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Label htmlFor="companyName">
              Company Name <span className="text-red-500">*</span>
              <InfoTip text="Your legal business name as registered with the IRS" />
            </Label>
            <Input
              id="companyName"
              value={data.companyName || ""}
              onChange={(e) => onChange("companyName", e.target.value)}
              placeholder="Acme Corporation"
              data-testid="input-company-name"
            />
          </div>
          <div>
            <Label htmlFor="businessType">Business Type</Label>
            <Select value={data.businessType || "llc"} onValueChange={(v) => onChange("businessType", v)}>
              <SelectTrigger data-testid="select-business-type">
                <SelectValue />
              </SelectTrigger>
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
              EIN
              <InfoTip text="Employer Identification Number (XX-XXXXXXX)" />
            </Label>
            <Input
              id="ein"
              value={data.ein || ""}
              onChange={(e) => onChange("ein", e.target.value)}
              placeholder="12-3456789"
              data-testid="input-ein"
            />
          </div>
          <div>
            <Label htmlFor="state">State</Label>
            <Select value={data.state || "__none__"} onValueChange={(v) => onChange("state", v === "__none__" ? "" : v)}>
              <SelectTrigger data-testid="select-state">
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select state</SelectItem>
                {US_STATES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="employeeCount">
              Number of Employees
              <InfoTip text="Approximate headcount helps us set defaults" />
            </Label>
            <Select value={data.employeeCount || "__none__"} onValueChange={(v) => onChange("employeeCount", v === "__none__" ? "" : v)}>
              <SelectTrigger data-testid="select-employee-count">
                <SelectValue placeholder="Select range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select range</SelectItem>
                <SelectItem value="1">1-5</SelectItem>
                <SelectItem value="10">6-25</SelectItem>
                <SelectItem value="50">26-100</SelectItem>
                <SelectItem value="200">101-500</SelectItem>
                <SelectItem value="1000">500+</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="address">Street Address</Label>
            <Input
              id="address"
              value={data.address || ""}
              onChange={(e) => onChange("address", e.target.value)}
              placeholder="123 Main St"
              data-testid="input-address"
            />
          </div>
          <div>
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              value={data.city || ""}
              onChange={(e) => onChange("city", e.target.value)}
              placeholder="Austin"
              data-testid="input-city"
            />
          </div>
          <div>
            <Label htmlFor="zip">ZIP Code</Label>
            <Input
              id="zip"
              value={data.zip || ""}
              onChange={(e) => onChange("zip", e.target.value)}
              placeholder="78701"
              data-testid="input-zip"
            />
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              value={data.phone || ""}
              onChange={(e) => onChange("phone", e.target.value)}
              placeholder="(512) 555-1234"
              data-testid="input-phone"
            />
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <Button onClick={onNext} disabled={!isValid || isSaving} data-testid="button-next-step-1">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Continue
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Step2Employees({ employees, onAdd, onRemove, onChange, onNext, onBack, isSaving, onCsvUpload }: {
  employees: Employee[];
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onChange: (idx: number, field: string, value: string) => void;
  onNext: () => void;
  onBack: () => void;
  isSaving: boolean;
  onCsvUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const hasValidEmployee = employees.some((e) => e.firstName.trim() && e.lastName.trim());

  return (
    <Card className="max-w-3xl mx-auto" data-testid="step-add-employees">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-teal-500" />
          Add Employees
        </CardTitle>
        <CardDescription>Add your team members manually or upload a CSV file</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <label className="cursor-pointer">
            <input type="file" accept=".csv" className="hidden" onChange={onCsvUpload} data-testid="input-csv-upload" />
            <Badge variant="outline" className="cursor-pointer hover:bg-accent gap-1 py-1.5 px-3">
              <Upload className="h-3.5 w-3.5" />
              Upload CSV
            </Badge>
          </label>
          <span className="text-xs text-muted-foreground">Format: firstName, lastName, email, payRate, payType, jobTitle</span>
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
                  <Input
                    value={emp.firstName}
                    onChange={(e) => onChange(idx, "firstName", e.target.value)}
                    placeholder="John"
                    data-testid={`input-emp-first-${idx}`}
                  />
                </div>
                <div>
                  <Label className="text-xs">Last Name <span className="text-red-500">*</span></Label>
                  <Input
                    value={emp.lastName}
                    onChange={(e) => onChange(idx, "lastName", e.target.value)}
                    placeholder="Smith"
                    data-testid={`input-emp-last-${idx}`}
                  />
                </div>
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input
                    value={emp.email}
                    onChange={(e) => onChange(idx, "email", e.target.value)}
                    placeholder="john@company.com"
                    data-testid={`input-emp-email-${idx}`}
                  />
                </div>
                <div>
                  <Label className="text-xs">Pay Rate ($)</Label>
                  <Input
                    type="number"
                    value={emp.payRate}
                    onChange={(e) => onChange(idx, "payRate", e.target.value)}
                    placeholder="25.00"
                    data-testid={`input-emp-rate-${idx}`}
                  />
                </div>
                <div>
                  <Label className="text-xs">Pay Type</Label>
                  <Select value={emp.payType} onValueChange={(v) => onChange(idx, "payType", v)}>
                    <SelectTrigger data-testid={`select-emp-paytype-${idx}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">Hourly</SelectItem>
                      <SelectItem value="salary">Salary</SelectItem>
                      <SelectItem value="commission">Commission</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Job Title</Label>
                  <Input
                    value={emp.jobTitle}
                    onChange={(e) => onChange(idx, "jobTitle", e.target.value)}
                    placeholder="Manager"
                    data-testid={`input-emp-title-${idx}`}
                  />
                </div>
                <div>
                  <Label className="text-xs">Time Clock PIN</Label>
                  <Input
                    type="password"
                    value={emp.pin || ""}
                    onChange={(e) => onChange(idx, "pin", e.target.value)}
                    placeholder="4-digit PIN"
                    maxLength={8}
                    data-testid={`input-emp-pin-${idx}`}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <Button variant="outline" onClick={onAdd} className="w-full" data-testid="button-add-employee">
          <Plus className="h-4 w-4 mr-2" />
          Add Another Employee
        </Button>

        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={onBack} data-testid="button-back-step-2">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <Button onClick={onNext} disabled={!hasValidEmployee || isSaving} data-testid="button-next-step-2">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Continue
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Step3Bank({ data, onChange, onNext, onBack, isSaving, onSkip }: {
  data: any;
  onChange: (field: string, value: string) => void;
  onNext: () => void;
  onBack: () => void;
  isSaving: boolean;
  onSkip: () => void;
}) {
  return (
    <Card className="max-w-2xl mx-auto" data-testid="step-bank-info">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="h-5 w-5 text-teal-500" />
          Bank Account
        </CardTitle>
        <CardDescription>Connect a funding account for payroll direct deposits</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            Your bank details are stored securely and used only for payroll funding. You can update these anytime in Settings.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Label htmlFor="bankName">Bank Name</Label>
            <Input
              id="bankName"
              value={data.bankName || ""}
              onChange={(e) => onChange("bankName", e.target.value)}
              placeholder="First National Bank"
              data-testid="input-bank-name"
            />
          </div>
          <div>
            <Label htmlFor="routingNumber">
              Routing Number
              <InfoTip text="9-digit ABA routing number from your bank" />
            </Label>
            <Input
              id="routingNumber"
              value={data.routingNumber || ""}
              onChange={(e) => onChange("routingNumber", e.target.value)}
              placeholder="021000021"
              data-testid="input-routing"
            />
          </div>
          <div>
            <Label htmlFor="accountNumber">Account Number</Label>
            <Input
              id="accountNumber"
              value={data.accountNumber || ""}
              onChange={(e) => onChange("accountNumber", e.target.value)}
              placeholder="123456789"
              type="password"
              data-testid="input-account"
            />
          </div>
          <div>
            <Label htmlFor="accountType">Account Type</Label>
            <Select value={data.accountType || "checking"} onValueChange={(v) => onChange("accountType", v)}>
              <SelectTrigger data-testid="select-account-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="checking">Checking</SelectItem>
                <SelectItem value="savings">Savings</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={onBack} data-testid="button-back-step-3">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onSkip} data-testid="button-skip-bank">
              Skip for now
            </Button>
            <Button onClick={onNext} disabled={isSaving} data-testid="button-next-step-3">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Continue
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Step4PayrollSetup({ data, onChange, onNext, onBack, isSaving }: {
  data: any;
  onChange: (field: string, value: string) => void;
  onNext: () => void;
  onBack: () => void;
  isSaving: boolean;
}) {
  return (
    <Card className="max-w-2xl mx-auto" data-testid="step-payroll-setup">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-teal-500" />
          Payroll Configuration
        </CardTitle>
        <CardDescription>Set your pay schedule and overtime rules</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="payFrequency">
            Pay Frequency
            <InfoTip text="How often you pay your employees" />
          </Label>
          <Select value={data.payFrequency || "biweekly"} onValueChange={(v) => onChange("payFrequency", v)}>
            <SelectTrigger data-testid="select-pay-frequency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly (52 pay periods/year)</SelectItem>
              <SelectItem value="biweekly">Biweekly (26 pay periods/year)</SelectItem>
              <SelectItem value="semimonthly">Semimonthly (24 pay periods/year)</SelectItem>
              <SelectItem value="monthly">Monthly (12 pay periods/year)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="overtimeThreshold">
            Overtime Threshold (hours/week)
            <InfoTip text="Hours per week before overtime kicks in (FLSA default is 40)" />
          </Label>
          <Input
            id="overtimeThreshold"
            type="number"
            value={data.overtimeThreshold || "40"}
            onChange={(e) => onChange("overtimeThreshold", e.target.value)}
            data-testid="input-overtime-threshold"
          />
        </div>
        <div>
          <Label htmlFor="overtimeMultiplier">
            Overtime Multiplier
            <InfoTip text="Pay multiplier for overtime hours (1.5x is standard)" />
          </Label>
          <Select value={data.overtimeMultiplier || "1.5"} onValueChange={(v) => onChange("overtimeMultiplier", v)}>
            <SelectTrigger data-testid="select-overtime-multiplier">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1.5">1.5x (Time and a half)</SelectItem>
              <SelectItem value="2.0">2.0x (Double time)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="bg-muted/50 rounded-lg p-4 mt-2">
          <h4 className="text-sm font-medium mb-2">Tax Defaults Applied</h4>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li className="flex items-center gap-2"><Check className="h-3 w-3 text-teal-500" /> Federal income tax withholding</li>
            <li className="flex items-center gap-2"><Check className="h-3 w-3 text-teal-500" /> Social Security (6.2%) + Medicare (1.45%)</li>
            <li className="flex items-center gap-2"><Check className="h-3 w-3 text-teal-500" /> State tax auto-calculated based on company state</li>
            <li className="flex items-center gap-2"><Check className="h-3 w-3 text-teal-500" /> Federal Unemployment (FUTA) employer-side</li>
          </ul>
          <p className="text-xs text-muted-foreground mt-2">You can customize tax settings later in Payroll &gt; Tax Configuration.</p>
        </div>

        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={onBack} data-testid="button-back-step-4">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <Button onClick={onNext} disabled={isSaving} data-testid="button-next-step-4">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Continue
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Step5Preview({ onBack, onFinish, isSaving }: {
  onBack: () => void;
  onFinish: () => void;
  isSaving: boolean;
}) {
  const { data: preview, isLoading } = useQuery<PayrollPreview>({
    queryKey: ["/api/onboarding/payroll-preview"],
  });

  const freqLabel: Record<string, string> = {
    weekly: "Weekly", biweekly: "Biweekly", semimonthly: "Semimonthly", monthly: "Monthly"
  };

  if (isLoading) {
    return (
      <Card className="max-w-3xl mx-auto" data-testid="step-payroll-preview">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
        </CardContent>
      </Card>
    );
  }

  if (!preview || preview.employees.length === 0) {
    return (
      <Card className="max-w-3xl mx-auto" data-testid="step-payroll-preview">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-teal-500" />
            Payroll Preview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No employees found to preview. You can still complete setup and add employees later.</p>
          </div>
          <div className="flex justify-between pt-4">
            <Button variant="ghost" onClick={onBack} data-testid="button-back-step-5">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            <Button onClick={onFinish} disabled={isSaving} className="bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600" data-testid="button-finish-wizard">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <PartyPopper className="h-4 w-4 mr-2" />}
              Complete Setup
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  return (
    <Card className="max-w-3xl mx-auto" data-testid="step-payroll-preview">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-teal-500" />
          Payroll Preview
        </CardTitle>
        <CardDescription>
          Estimated {freqLabel[preview.payFrequency] || preview.payFrequency} payroll based on your employees and settings
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-teal-50 to-teal-100 dark:from-teal-950/30 dark:to-teal-900/20 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Total Gross</p>
            <p className="text-lg font-bold text-teal-700 dark:text-teal-300" data-testid="text-total-gross">{fmt(preview.totalGross)}</p>
          </div>
          <div className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950/30 dark:to-orange-900/20 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Total Taxes</p>
            <p className="text-lg font-bold text-orange-700 dark:text-orange-300" data-testid="text-total-taxes">{fmt(preview.totalTaxes)}</p>
          </div>
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-900/20 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Total Net</p>
            <p className="text-lg font-bold text-blue-700 dark:text-blue-300" data-testid="text-total-net">{fmt(preview.totalNet)}</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-2 font-medium">Employee</th>
                <th className="text-right py-2 font-medium">Gross</th>
                <th className="text-right py-2 font-medium">Fed Tax</th>
                <th className="text-right py-2 font-medium">State</th>
                <th className="text-right py-2 font-medium">FICA</th>
                <th className="text-right py-2 font-medium">Net Pay</th>
              </tr>
            </thead>
            <tbody>
              {preview.employees.map((emp) => (
                <tr key={emp.id} className="border-b last:border-0" data-testid={`preview-row-${emp.id}`}>
                  <td className="py-2">
                    <div className="font-medium">{emp.name}</div>
                    {emp.jobTitle && <div className="text-xs text-muted-foreground">{emp.jobTitle}</div>}
                  </td>
                  <td className="text-right py-2">{fmt(emp.grossPay)}</td>
                  <td className="text-right py-2">{fmt(emp.federalTax)}</td>
                  <td className="text-right py-2">{fmt(emp.stateTax)}</td>
                  <td className="text-right py-2">{fmt(emp.fica)}</td>
                  <td className="text-right py-2 font-medium">{fmt(emp.netPay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-muted/50 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">
            These are estimated figures based on standard tax rates. Actual payroll amounts may vary based on individual tax elections, deductions, and local regulations. You can fine-tune everything in the Payroll section.
          </p>
        </div>

        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={onBack} data-testid="button-back-step-5">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <Button onClick={onFinish} disabled={isSaving} className="bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600" data-testid="button-finish-wizard">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <PartyPopper className="h-4 w-4 mr-2" />}
            Complete Setup
          </Button>
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
  const [employees, setEmployees] = useState<Employee[]>([
    { firstName: "", lastName: "", email: "", payRate: "", payType: "hourly", workerType: "employee", jobTitle: "", pin: "" },
  ]);
  const [bankData, setBankData] = useState({
    bankName: "", routingNumber: "", accountNumber: "", accountType: "checking",
  });
  const [payrollData, setPayrollData] = useState({
    payFrequency: "biweekly", overtimeThreshold: "40", overtimeMultiplier: "1.5",
  });

  const { data: progress } = useQuery<any>({
    queryKey: ["/api/onboarding/progress"],
  });

  useEffect(() => {
    if (progress?.onboarding_wizard_completed) {
      setLocation("/app");
    }
  }, [progress, setLocation]);

  const businessMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/onboarding/business-info", businessData);
    },
    onSuccess: () => {
      setCompletedSteps((prev) => new Set([...prev, 1]));
      setCurrentStep(2);
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/progress"] });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message || "Failed to save business info", variant: "destructive" });
    },
  });

  const employeeMutation = useMutation({
    mutationFn: async () => {
      const validEmployees = employees.filter((e) => e.firstName.trim() && e.lastName.trim());
      await apiRequest("POST", "/api/onboarding/add-employees-csv", { employees: validEmployees });
    },
    onSuccess: () => {
      setCompletedSteps((prev) => new Set([...prev, 2]));
      setCurrentStep(3);
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/progress"] });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message || "Failed to add employees", variant: "destructive" });
    },
  });

  const bankMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/onboarding/bank-info", bankData);
    },
    onSuccess: () => {
      setCompletedSteps((prev) => new Set([...prev, 3]));
      setCurrentStep(4);
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/progress"] });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message || "Failed to save bank info", variant: "destructive" });
    },
  });

  const payrollMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/onboarding/payroll-setup", payrollData);
    },
    onSuccess: () => {
      setCompletedSteps((prev) => new Set([...prev, 4]));
      setCurrentStep(5);
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/progress"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/payroll-preview"] });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message || "Failed to save payroll setup", variant: "destructive" });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/onboarding/complete-wizard");
    },
    onSuccess: () => {
      toast({ title: "Setup Complete!", description: "Welcome to PayLink! Your dashboard is ready." });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/progress"] });
      setLocation("/app");
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message || "Failed to complete wizard", variant: "destructive" });
    },
  });

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").filter((l) => l.trim());
      const parsed: Employee[] = [];
      for (let i = 0; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.trim());
        if (cols.length < 2) continue;
        if (cols[0].toLowerCase() === "firstname" || cols[0].toLowerCase() === "first name") continue;
        parsed.push({
          firstName: cols[0] || "",
          lastName: cols[1] || "",
          email: cols[2] || "",
          payRate: cols[3] || "",
          payType: cols[4] || "hourly",
          workerType: "employee",
          jobTitle: cols[5] || "",
        });
      }
      if (parsed.length > 0) {
        setEmployees(parsed);
        toast({ title: "CSV Loaded", description: `${parsed.length} employee(s) imported from CSV` });
      } else {
        toast({ title: "No Data", description: "No valid rows found in CSV", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const isSaving = businessMutation.isPending || employeeMutation.isPending || bankMutation.isPending || payrollMutation.isPending || completeMutation.isPending;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Rocket className="h-6 w-6 text-teal-500" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-teal-600 to-blue-600 bg-clip-text text-transparent" data-testid="text-wizard-title">
              Welcome to PayLink
            </h1>
          </div>
          <p className="text-muted-foreground">Let's get your payroll up and running in just a few minutes</p>
        </div>

        <StepIndicator currentStep={currentStep} completedSteps={completedSteps} />

        {currentStep === 1 && (
          <Step1BusinessInfo
            data={businessData}
            onChange={(field, value) => setBusinessData((prev) => ({ ...prev, [field]: value }))}
            onNext={() => businessMutation.mutate()}
            isSaving={businessMutation.isPending}
          />
        )}

        {currentStep === 2 && (
          <Step2Employees
            employees={employees}
            onAdd={() => setEmployees((prev) => [...prev, { firstName: "", lastName: "", email: "", payRate: "", payType: "hourly", workerType: "employee", jobTitle: "", pin: "" }])}
            onRemove={(idx) => setEmployees((prev) => prev.filter((_, i) => i !== idx))}
            onChange={(idx, field, value) => setEmployees((prev) => prev.map((e, i) => (i === idx ? { ...e, [field]: value } : e)))}
            onNext={() => employeeMutation.mutate()}
            onBack={() => setCurrentStep(1)}
            isSaving={employeeMutation.isPending}
            onCsvUpload={handleCsvUpload}
          />
        )}

        {currentStep === 3 && (
          <Step3Bank
            data={bankData}
            onChange={(field, value) => setBankData((prev) => ({ ...prev, [field]: value }))}
            onNext={() => bankMutation.mutate()}
            onBack={() => setCurrentStep(2)}
            isSaving={bankMutation.isPending}
            onSkip={() => {
              setCompletedSteps((prev) => new Set([...prev, 3]));
              setCurrentStep(4);
            }}
          />
        )}

        {currentStep === 4 && (
          <Step4PayrollSetup
            data={payrollData}
            onChange={(field, value) => setPayrollData((prev) => ({ ...prev, [field]: value }))}
            onNext={() => payrollMutation.mutate()}
            onBack={() => setCurrentStep(3)}
            isSaving={payrollMutation.isPending}
          />
        )}

        {currentStep === 5 && (
          <Step5Preview
            onBack={() => setCurrentStep(4)}
            onFinish={() => completeMutation.mutate()}
            isSaving={completeMutation.isPending}
          />
        )}
      </div>
    </div>
  );
}
