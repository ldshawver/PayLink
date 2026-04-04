import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2, Clock, ChevronRight, FileText, User, Building2,
  PenLine, Landmark, ClipboardCheck, AlertTriangle, Loader2, ArrowLeft
} from "lucide-react";

type PortalData = {
  onboarding: {
    id: string;
    companyId: string;
    workerId: string;
    packageKey: string;
    status: string;
    inviteEmail: string | null;
    inviteExpiresAt: string | null;
    submittedAt: string | null;
    agreementTemplateId: string | null;
  };
  steps: OnboardingStep[];
  expired: boolean;
  completed: boolean;
};

type OnboardingStep = {
  id: string;
  stepKey: string;
  stepTitle: string;
  stepType: string;
  sequence: number;
  status: string;
  isRequired: boolean;
  completedAt: string | null;
};

type AgreementTemplate = {
  id: string;
  templateName: string;
  htmlBody: string | null;
};

function stepIcon(step: OnboardingStep) {
  const icons: Record<string, React.ReactNode> = {
    personal_info: <User className="h-5 w-5" />,
    agreement_sign: <PenLine className="h-5 w-5" />,
    tax_info: <FileText className="h-5 w-5" />,
    bank_info: <Landmark className="h-5 w-5" />,
    review_complete: <ClipboardCheck className="h-5 w-5" />,
  };
  return icons[step.stepKey] || <FileText className="h-5 w-5" />;
}

// ── Step Components ───────────────────────────────────────────────────────────

function PersonalInfoStep({ onComplete, loading }: { onComplete: (data: any) => void; loading: boolean }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", address: "", city: "", state: "", zip: "" });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Please confirm your personal information below.</p>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>First Name *</Label>
          <Input data-testid="input-first-name" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Last Name *</Label>
          <Input data-testid="input-last-name" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Phone Number</Label>
        <Input data-testid="input-phone" type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
      </div>
      <div className="space-y-2">
        <Label>Street Address *</Label>
        <Input data-testid="input-address" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-1 space-y-2">
          <Label>City *</Label>
          <Input data-testid="input-city" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>State *</Label>
          <Input data-testid="input-state" maxLength={2} value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value.toUpperCase() }))} />
        </div>
        <div className="space-y-2">
          <Label>ZIP *</Label>
          <Input data-testid="input-zip" value={form.zip} onChange={e => setForm(f => ({ ...f, zip: e.target.value }))} />
        </div>
      </div>
      <Button data-testid="button-step-continue" className="w-full"
        onClick={() => onComplete(form)}
        disabled={loading || !form.firstName || !form.lastName || !form.address || !form.city || !form.state || !form.zip}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Continue <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}

function AgreementSignStep({
  templateHtml, onSign, loading,
}: { templateHtml: string | null; onSign: (name: string, sig: string) => void; loading: boolean }) {
  const [signedName, setSignedName] = useState("");
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Please read the agreement below carefully, then type your full legal name to sign.
      </p>
      <ScrollArea className="h-64 border rounded p-4 bg-background">
        {templateHtml ? (
          <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: templateHtml }} />
        ) : (
          <p className="text-muted-foreground text-center py-8">Agreement document loading…</p>
        )}
      </ScrollArea>
      <div className="space-y-2">
        <Label htmlFor="sign-name">Type your full legal name to sign *</Label>
        <Input id="sign-name" data-testid="input-signature-name"
          placeholder="e.g. Jane A. Smith"
          value={signedName}
          onChange={e => setSignedName(e.target.value)} />
      </div>
      <div className="flex items-start gap-2">
        <input type="checkbox" id="agree-checkbox" data-testid="checkbox-agree"
          className="mt-0.5 h-4 w-4 rounded border accent-primary"
          checked={agreed} onChange={e => setAgreed(e.target.checked)} />
        <label htmlFor="agree-checkbox" className="text-sm text-muted-foreground cursor-pointer">
          I have read and agree to the terms of this agreement. I understand that my typed name constitutes a legally binding electronic signature.
        </label>
      </div>
      <Button data-testid="button-sign-agreement" className="w-full"
        onClick={() => onSign(signedName, `e-signed:${signedName}:${new Date().toISOString()}`)}
        disabled={loading || !signedName.trim() || !agreed}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <PenLine className="h-4 w-4 mr-2" />}
        Sign Agreement
      </Button>
    </div>
  );
}

function TaxInfoStep({ onComplete, loading }: { onComplete: (data: any) => void; loading: boolean }) {
  const [form, setForm] = useState({ taxIdType: "ssn", taxId: "", businessName: "" });
  return (
    <div className="space-y-4">
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-3 text-sm text-yellow-800 dark:text-yellow-200 flex gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        Your tax information is encrypted and stored securely. It is used solely for 1099 reporting.
      </div>
      <div className="space-y-2">
        <Label>Tax ID Type</Label>
        <select data-testid="select-tax-id-type"
          className="w-full border rounded px-3 py-2 text-sm bg-background"
          value={form.taxIdType}
          onChange={e => setForm(f => ({ ...f, taxIdType: e.target.value }))}>
          <option value="ssn">SSN (Social Security Number)</option>
          <option value="ein">EIN (Employer Identification Number)</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label>{form.taxIdType === "ein" ? "EIN" : "SSN"} *</Label>
        <Input data-testid="input-tax-id" type="password"
          placeholder={form.taxIdType === "ein" ? "XX-XXXXXXX" : "XXX-XX-XXXX"}
          value={form.taxId}
          onChange={e => setForm(f => ({ ...f, taxId: e.target.value }))} />
      </div>
      {form.taxIdType === "ein" && (
        <div className="space-y-2">
          <Label>Business / LLC Name *</Label>
          <Input data-testid="input-business-name" value={form.businessName}
            onChange={e => setForm(f => ({ ...f, businessName: e.target.value }))} />
        </div>
      )}
      <Button data-testid="button-step-continue" className="w-full"
        onClick={() => onComplete({ ...form, taxId: form.taxId.replace(/\d(?=\d{4})/g, "*") })}
        disabled={loading || !form.taxId || (form.taxIdType === "ein" && !form.businessName)}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Continue <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}

function BankInfoStep({ onComplete, loading }: { onComplete: (data: any) => void; loading: boolean }) {
  const [form, setForm] = useState({ accountType: "checking", routingNumber: "", accountNumber: "", bankName: "" });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Provide your banking details for direct deposit payments.</p>
      <div className="space-y-2">
        <Label>Account Type</Label>
        <select data-testid="select-account-type"
          className="w-full border rounded px-3 py-2 text-sm bg-background"
          value={form.accountType}
          onChange={e => setForm(f => ({ ...f, accountType: e.target.value }))}>
          <option value="checking">Checking</option>
          <option value="savings">Savings</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label>Bank Name</Label>
        <Input data-testid="input-bank-name" value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} />
      </div>
      <div className="space-y-2">
        <Label>Routing Number *</Label>
        <Input data-testid="input-routing" value={form.routingNumber} onChange={e => setForm(f => ({ ...f, routingNumber: e.target.value }))} />
      </div>
      <div className="space-y-2">
        <Label>Account Number *</Label>
        <Input data-testid="input-account" type="password" value={form.accountNumber}
          onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))} />
      </div>
      <Button data-testid="button-step-continue" className="w-full"
        onClick={() => onComplete({ ...form, accountNumber: "****" + form.accountNumber.slice(-4) })}
        disabled={loading || !form.routingNumber || !form.accountNumber}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Continue <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
      <Button variant="ghost" className="w-full text-muted-foreground" data-testid="button-skip-bank"
        onClick={() => onComplete(null)}>
        Skip for now
      </Button>
    </div>
  );
}

function ReviewCompleteStep({ onComplete, loading }: { onComplete: (data: any) => void; loading: boolean }) {
  return (
    <div className="space-y-4 text-center">
      <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
      <div>
        <h3 className="text-lg font-semibold">You're almost done!</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Please review your submission and click the button below to send it to your employer for final review.
        </p>
      </div>
      <div className="bg-muted rounded p-4 text-left text-sm space-y-1">
        <p className="font-medium mb-2">What happens next?</p>
        <p>• Your employer will review your onboarding packet</p>
        <p>• You may receive an email with any follow-up requests</p>
        <p>• Once approved, you are ready to begin work</p>
      </div>
      <Button data-testid="button-submit-onboarding" className="w-full" onClick={() => onComplete({})} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ClipboardCheck className="h-4 w-4 mr-2" />}
        Submit for Review
      </Button>
    </div>
  );
}

// ── Main Portal ───────────────────────────────────────────────────────────────

export default function OnboardingPortalPage() {
  const [, params] = useRoute("/onboarding/:token");
  const token = params?.token || "";
  const { toast } = useToast();
  const [activeStepIdx, setActiveStepIdx] = useState(0);

  const { data, isLoading, isError, error } = useQuery<PortalData>({
    queryKey: ["/api/onboarding/portal", token],
    queryFn: async () => {
      const res = await fetch(`/api/onboarding/portal/${token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Error ${res.status}`);
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  // Fetch agreement template if needed
  const agreementTemplateId = data?.onboarding?.agreementTemplateId;
  const { data: templateData } = useQuery<AgreementTemplate>({
    queryKey: ["/api/agreement-templates", agreementTemplateId],
    queryFn: async () => {
      const res = await fetch(`/api/agreement-templates/${agreementTemplateId}`);
      return res.json();
    },
    enabled: !!agreementTemplateId,
  });

  const completeStep = useMutation({
    mutationFn: ({ stepId, formData }: { stepId: string; formData: any }) =>
      fetch(`/api/onboarding/portal/${token}/steps/${stepId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formData }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/portal", token] });
      setActiveStepIdx(i => i + 1);
    },
    onError: () => toast({ title: "Error saving step", variant: "destructive" }),
  });

  const signAgreement = useMutation({
    mutationFn: ({ signedByName, signatureData }: { signedByName: string; signatureData: string }) =>
      fetch(`/api/onboarding/portal/${token}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedByName, signatureData, agreementTemplateId }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/portal", token] });
    },
    onError: () => toast({ title: "Error signing agreement", variant: "destructive" }),
  });

  // Advance to first incomplete step on load
  useEffect(() => {
    if (data?.steps) {
      const firstIncomplete = data.steps.findIndex(s => s.status !== "completed");
      setActiveStepIdx(firstIncomplete === -1 ? data.steps.length - 1 : firstIncomplete);
    }
  }, [data?.steps?.map(s => s.status).join(",")]);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold">Invalid Link</h2>
            <p className="text-muted-foreground text-sm mt-2">This onboarding link is missing or invalid.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    const msg = (error as Error).message;
    const isExpired = msg.toLowerCase().includes("expir");
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
            <h2 className="text-lg font-semibold">{isExpired ? "Link Expired" : "Link Not Found"}</h2>
            <p className="text-muted-foreground text-sm">{msg}</p>
            {isExpired && <p className="text-sm text-muted-foreground">Please contact your employer to get a new invitation link.</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  const { onboarding, steps, completed } = data!;
  const completedSteps = steps.filter(s => s.status === "completed").length;
  const progress = steps.length ? Math.round((completedSteps / steps.length) * 100) : 0;

  if (completed || onboarding.status === "approved") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center space-y-4">
            <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
            <h2 className="text-xl font-bold">Onboarding Complete!</h2>
            <p className="text-muted-foreground text-sm">
              {onboarding.status === "approved"
                ? "Your onboarding has been approved. You are ready to begin."
                : "Your onboarding has been submitted and is pending review."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentStep = steps[activeStepIdx];

  async function handleStepComplete(formData: any) {
    if (!currentStep) return;
    if (currentStep.stepKey === "agreement_sign") {
      // Will be handled by sign handler
      return;
    }
    await completeStep.mutateAsync({ stepId: currentStep.id, formData });
  }

  async function handleSign(name: string, sig: string) {
    if (!currentStep) return;
    await signAgreement.mutateAsync({ signedByName: name, signatureData: sig });
    await completeStep.mutateAsync({ stepId: currentStep.id, formData: { signedByName: name } });
  }

  function renderStepContent() {
    if (!currentStep) return null;
    const loading = completeStep.isPending || signAgreement.isPending;
    switch (currentStep.stepKey) {
      case "personal_info":
        return <PersonalInfoStep onComplete={handleStepComplete} loading={loading} />;
      case "agreement_sign":
        return <AgreementSignStep templateHtml={templateData?.htmlBody || null} onSign={handleSign} loading={loading} />;
      case "tax_info":
        return <TaxInfoStep onComplete={handleStepComplete} loading={loading} />;
      case "bank_info":
        return <BankInfoStep onComplete={handleStepComplete} loading={loading} />;
      case "review_complete":
        return <ReviewCompleteStep onComplete={handleStepComplete} loading={loading} />;
      default:
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Complete this step to continue.</p>
            <Button data-testid="button-step-continue" className="w-full"
              onClick={() => handleStepComplete({})} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Mark as Complete <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        );
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Building2 className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold text-primary">PayLink</span>
          </div>
          <h1 className="text-2xl font-bold">Contractor Onboarding</h1>
          <p className="text-muted-foreground text-sm">Complete all required steps below to finish your onboarding.</p>
        </div>

        {/* Progress */}
        <Card>
          <CardContent className="py-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{completedSteps} / {steps.length} steps</span>
            </div>
            <Progress value={progress} className="h-2" />
          </CardContent>
        </Card>

        {/* Steps sidebar + content */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Steps nav */}
          <div className="sm:col-span-1 space-y-1">
            {steps.map((step, idx) => {
              const isActive = idx === activeStepIdx;
              const isDone = step.status === "completed";
              return (
                <button key={step.id}
                  data-testid={`step-nav-${step.stepKey}`}
                  className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors
                    ${isActive ? "bg-primary text-primary-foreground font-medium" : isDone ? "text-muted-foreground" : "text-foreground hover:bg-muted"}
                    ${!isDone && idx > activeStepIdx ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  onClick={() => {
                    if (isDone || idx <= activeStepIdx) setActiveStepIdx(idx);
                  }}
                  disabled={!isDone && idx > activeStepIdx}>
                  <span className="shrink-0">
                    {isDone ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : stepIcon(step)}
                  </span>
                  <span className="truncate">{step.stepTitle}</span>
                  {step.isRequired && !isDone && <span className="text-xs opacity-60 shrink-0">*</span>}
                </button>
              );
            })}
          </div>

          {/* Step content */}
          <div className="sm:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {currentStep && stepIcon(currentStep)}
                  {currentStep?.stepTitle || ""}
                </CardTitle>
                {currentStep?.isRequired && (
                  <CardDescription className="text-xs">Required step</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                {currentStep?.status === "completed" ? (
                  <div className="text-center py-6 space-y-3">
                    <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
                    <p className="text-sm text-muted-foreground">This step has been completed.</p>
                    {activeStepIdx < steps.length - 1 && (
                      <Button variant="outline" onClick={() => setActiveStepIdx(i => i + 1)}>
                        Next Step <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    )}
                  </div>
                ) : (
                  renderStepContent()
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Powered by PayLink · Secure onboarding platform · Fields marked * are required
        </p>
      </div>
    </div>
  );
}
