import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  CheckCircle, Lock, Upload, FileText, Shield, Clock, AlertTriangle,
  XCircle, FileUp, Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface PortalData {
  valid: boolean;
  companyName: string;
  workerName: string;
  packet: {
    id: string;
    templateName: string;
    status: string;
    dueDate: string | null;
    steps: Array<{
      id: string;
      stepName: string;
      stepType: string;
      description: string | null;
      sortOrder: number | null;
      status: string;
      taskType: string | null;
      dependenciesJson: string | null;
      docType: string | null;
      docStatus: string | null;
      required: boolean | null;
      notes: string | null;
      documentId: string | null;
      completedAt: string | null;
    }>;
  };
}

export default function PortalOnboardingPage() {
  const [location] = useLocation();
  const token = location.replace("/portal/onboarding/", "");
  const { toast } = useToast();
  const [uploadingStep, setUploadingStep] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error } = useQuery<PortalData>({
    queryKey: ["/api/portal/onboarding/validate", token],
    queryFn: async () => {
      const res = await fetch(`/api/portal/onboarding/validate?token=${token}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Invalid or expired link" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    enabled: !!token,
  });

  const updateStepMutation = useMutation({
    mutationFn: async ({ stepId, status, notes }: { stepId: string; status?: string; notes?: string }) => {
      const res = await fetch(`/api/portal/onboarding/steps/${stepId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, status, notes }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to update step" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/onboarding/validate", token] });
      toast({ title: "Step updated successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ stepId, file }: { stepId: string; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("token", token);
      formData.append("stepId", stepId);
      const res = await fetch("/api/portal/onboarding/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/onboarding/validate", token] });
      setUploadingStep(null);
      toast({ title: "Document uploaded successfully" });
    },
    onError: (e: Error) => {
      setUploadingStep(null);
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-4" />
          <p className="text-muted-foreground" data-testid="text-loading">Verifying your access...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-orange-100 dark:from-gray-900 dark:to-gray-800">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-red-500" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-error-title">Access Denied</h2>
            <p className="text-muted-foreground" data-testid="text-error-message">
              {error instanceof Error ? error.message : "This link is invalid or has expired. Please contact your HR administrator for a new link."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { packet, companyName, workerName } = data;
  const steps = packet.steps || [];
  const completedCount = steps.filter(s => s.status === "completed" || s.status === "approved").length;
  const progress = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;

  const isStepBlocked = (step: typeof steps[0]) => {
    if (!step.dependenciesJson) return false;
    try {
      const depIds: string[] = JSON.parse(step.dependenciesJson);
      return depIds.some(depId => {
        const dep = steps.find(s => s.id === depId);
        return !dep || (dep.status !== "completed" && dep.status !== "approved");
      });
    } catch { return false; }
  };

  const getStepIcon = (step: typeof steps[0]) => {
    if (step.status === "completed" || step.status === "approved") return <CheckCircle className="h-6 w-6 text-green-600" />;
    if (step.status === "rejected") return <XCircle className="h-6 w-6 text-red-600" />;
    if (step.status === "submitted") return <Clock className="h-6 w-6 text-blue-600" />;
    if (isStepBlocked(step)) return <Lock className="h-6 w-6 text-muted-foreground/40" />;
    return <div className="h-6 w-6 rounded-full border-2 border-primary/40" />;
  };

  const getStatusLabel = (step: typeof steps[0]) => {
    if (step.status === "completed" || step.status === "approved") return "Completed";
    if (step.status === "submitted") return "Submitted - Under Review";
    if (step.status === "rejected") return "Rejected - Resubmit Required";
    if (isStepBlocked(step)) return "Locked";
    return "Pending";
  };

  const handleFileUpload = (stepId: string, file: File) => {
    setUploadingStep(stepId);
    uploadMutation.mutate({ stepId, file });
  };

  const taskTypeLabel = (tt: string | null) => {
    const map: Record<string, string> = {
      document_upload: "Document Upload",
      signature: "Signature Required",
      acknowledgement: "Acknowledgement",
      manual: "Action Required",
    };
    return map[tt || "manual"] || "Action Required";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <header className="bg-white dark:bg-gray-900 border-b shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-primary" data-testid="text-company-name">{companyName}</h1>
              <p className="text-sm text-muted-foreground">Employee Onboarding Portal</p>
            </div>
            <Shield className="h-8 w-8 text-primary/30" />
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-1" data-testid="text-welcome">Welcome, {workerName}</h2>
          <p className="text-muted-foreground">{packet.templateName}</p>
          {packet.dueDate && (
            <p className="text-sm text-muted-foreground mt-1">
              Due by: {new Date(packet.dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          )}
        </div>

        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium">{completedCount} of {steps.length} steps completed</span>
              <span className="font-bold text-primary" data-testid="text-progress">{progress}%</span>
            </div>
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} data-testid="portal-progress-bar" />
            </div>
            {progress === 100 && (
              <p className="text-center text-green-600 font-medium mt-3 flex items-center justify-center gap-2" data-testid="text-all-complete">
                <CheckCircle className="h-5 w-5" /> All steps completed!
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-3">
          {steps.map((step) => {
            const blocked = isStepBlocked(step);
            const isDone = step.status === "completed" || step.status === "approved";

            return (
              <Card key={step.id} className={`transition-all ${isDone ? "opacity-75" : ""} ${blocked ? "opacity-60" : ""}`} data-testid={`portal-step-${step.id}`}>
                <CardContent className="py-4">
                  <div className="flex items-start gap-4">
                    <div className="shrink-0 mt-0.5">{getStepIcon(step)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className={`font-medium ${isDone ? "line-through text-muted-foreground" : ""}`}>{step.stepName}</h3>
                        {step.required && <span className="text-red-500 text-xs font-medium">Required</span>}
                        <Badge variant="outline" className="text-xs">{taskTypeLabel(step.taskType)}</Badge>
                      </div>
                      {step.description && <p className="text-sm text-muted-foreground mt-1">{step.description}</p>}

                      <div className="mt-2">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                          isDone ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" :
                          step.status === "submitted" ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" :
                          step.status === "rejected" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" :
                          blocked ? "bg-muted text-muted-foreground" :
                          "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                        }`} data-testid={`badge-status-${step.id}`}>{getStatusLabel(step)}</span>
                      </div>

                      {step.notes && (
                        <p className="text-xs mt-2 text-muted-foreground italic border-l-2 border-muted pl-2">{step.notes}</p>
                      )}

                      {!blocked && !isDone && step.status !== "submitted" && (
                        <div className="mt-3 space-y-2">
                          {(step.taskType === "document_upload") && (
                            <div>
                              <input
                                ref={uploadingStep === step.id ? fileInputRef : undefined}
                                type="file"
                                className="hidden"
                                data-testid={`input-file-${step.id}`}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleFileUpload(step.id, file);
                                }}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={uploadingStep === step.id}
                                data-testid={`button-upload-${step.id}`}
                                onClick={() => {
                                  const input = document.querySelector(`[data-testid="input-file-${step.id}"]`) as HTMLInputElement;
                                  input?.click();
                                }}
                              >
                                {uploadingStep === step.id ? (
                                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading...</>
                                ) : (
                                  <><Upload className="h-4 w-4 mr-2" />Upload {step.docType || "Document"}</>
                                )}
                              </Button>
                            </div>
                          )}

                          {step.taskType === "signature" && (
                            <Button
                              size="sm"
                              variant="default"
                              data-testid={`button-sign-${step.id}`}
                              onClick={() => updateStepMutation.mutate({ stepId: step.id, status: "submitted" })}
                              disabled={updateStepMutation.isPending}
                            >
                              <FileText className="h-4 w-4 mr-2" />
                              Launch Signing
                            </Button>
                          )}

                          {step.taskType === "acknowledgement" && (
                            <Button
                              size="sm"
                              variant="default"
                              data-testid={`button-acknowledge-${step.id}`}
                              onClick={() => updateStepMutation.mutate({ stepId: step.id, status: "completed" })}
                              disabled={updateStepMutation.isPending}
                            >
                              <CheckCircle className="h-4 w-4 mr-2" />
                              I Acknowledge
                            </Button>
                          )}

                          {step.taskType === "manual" && (
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid={`button-complete-${step.id}`}
                              onClick={() => updateStepMutation.mutate({ stepId: step.id, status: "completed" })}
                              disabled={updateStepMutation.isPending}
                            >
                              <CheckCircle className="h-4 w-4 mr-2" />
                              Mark Complete
                            </Button>
                          )}
                        </div>
                      )}

                      {blocked && (
                        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                          <Lock className="h-3 w-3" /> Complete prerequisite steps to unlock
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-8 text-center text-xs text-muted-foreground">
          <p>Secure onboarding portal powered by {companyName}</p>
          <p className="mt-1">If you have questions, contact your HR administrator.</p>
        </div>
      </main>
    </div>
  );
}
