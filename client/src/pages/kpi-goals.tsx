import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Target,
  DollarSign,
  BarChart3,
  PlusCircle,
  Trash2,
  RefreshCw,
  Pencil,
  Check,
  X,
} from "lucide-react";
import type { CostCenter, Job } from "@shared/schema";

function getThisWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const d = new Date(now);
  d.setDate(now.getDate() - day);
  return d.toISOString().split("T")[0];
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

interface GoalFormState {
  weekStart: string;
  targetAmount: string;
  autoRecur: boolean;
  costCenterId: string;
  jobId: string;
}

function GoalSection({
  goalType,
  title,
  icon: Icon,
  costCenters,
  jobs,
}: {
  goalType: "labor" | "revenue";
  title: string;
  icon: any;
  costCenters: CostCenter[];
  jobs: Job[];
}) {
  const { toast } = useToast();
  const endpoint = goalType === "labor" ? "/api/kpi/labor-goals" : "/api/kpi/revenue-goals";

  const { data: goals, isLoading, refetch } = useQuery<any[]>({ queryKey: [endpoint] });

  const [form, setForm] = useState<GoalFormState>({
    weekStart: getThisWeekStart(),
    targetAmount: "",
    autoRecur: false,
    costCenterId: "",
    jobId: "",
  });

  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<GoalFormState>({
    weekStart: "",
    targetAmount: "",
    autoRecur: false,
    costCenterId: "",
    jobId: "",
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", endpoint, {
      weekStart: form.weekStart,
      targetAmount: form.targetAmount,
      autoRecur: form.autoRecur,
      costCenterId: form.costCenterId || null,
      jobId: form.jobId || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      queryClient.invalidateQueries({ queryKey: [goalType === "labor" ? "/api/kpi/labor-cost-summary" : "/api/kpi/financial-summary"] });
      setForm({ weekStart: getThisWeekStart(), targetAmount: "", autoRecur: false, costCenterId: "", jobId: "" });
      toast({ title: "Goal saved successfully" });
    },
    onError: () => toast({ title: "Error", description: "Failed to save goal", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `${endpoint}/${id}`, {
      weekStart: editForm.weekStart,
      targetAmount: editForm.targetAmount,
      autoRecur: editForm.autoRecur,
      costCenterId: editForm.costCenterId || null,
      jobId: editForm.jobId || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      queryClient.invalidateQueries({ queryKey: [goalType === "labor" ? "/api/kpi/labor-cost-summary" : "/api/kpi/financial-summary"] });
      setEditId(null);
      toast({ title: "Goal updated successfully" });
    },
    onError: () => toast({ title: "Error", description: "Failed to update goal", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `${endpoint}/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      toast({ title: "Goal deleted" });
    },
    onError: () => toast({ title: "Error", description: "Failed to delete goal", variant: "destructive" }),
  });

  function startEdit(g: any) {
    setEditId(g.id);
    setEditForm({
      weekStart: g.weekStart || g.week_start || "",
      targetAmount: String(parseFloat(g.targetAmount || g.target_amount || "0")),
      autoRecur: g.autoRecur ?? g.auto_recur ?? false,
      costCenterId: g.costCenterId || g.cost_center_id || "",
      jobId: g.jobId || g.job_id || "",
    });
  }

  return (
    <Card data-testid={`card-${goalType}-goals`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Icon className="h-5 w-5 text-teal-accent" />
            {title}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => refetch()}
            data-testid={`button-${goalType}-goals-refresh`}
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-md border p-4 space-y-4 bg-muted/20">
          <p className="text-sm font-semibold">Add New Goal</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Week Starting</Label>
              <Input
                type="date"
                value={form.weekStart}
                onChange={(e) => setForm(f => ({ ...f, weekStart: e.target.value }))}
                data-testid={`input-${goalType}-week-start`}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Target Amount ($)</Label>
              <Input
                type="number"
                min="0"
                step="100"
                placeholder="e.g. 10000"
                value={form.targetAmount}
                onChange={(e) => setForm(f => ({ ...f, targetAmount: e.target.value }))}
                data-testid={`input-${goalType}-target-amount`}
              />
            </div>
            {costCenters.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Cost Center (optional)</Label>
                <Select
                  value={form.costCenterId}
                  onValueChange={(v) => setForm(f => ({ ...f, costCenterId: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger data-testid={`select-${goalType}-cost-center`}>
                    <SelectValue placeholder="All Cost Centers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">All Cost Centers</SelectItem>
                    {costCenters.map(cc => (
                      <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {jobs.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Job (optional)</Label>
                <Select
                  value={form.jobId}
                  onValueChange={(v) => setForm(f => ({ ...f, jobId: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger data-testid={`select-${goalType}-job`}>
                    <SelectValue placeholder="All Jobs" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">All Jobs</SelectItem>
                    {jobs.map(j => (
                      <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id={`${goalType}-auto-recur`}
              checked={form.autoRecur}
              onCheckedChange={(v) => setForm(f => ({ ...f, autoRecur: v }))}
              data-testid={`switch-${goalType}-auto-recur`}
            />
            <Label htmlFor={`${goalType}-auto-recur`} className="text-sm cursor-pointer">
              Auto-recur this goal every week
            </Label>
          </div>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !form.targetAmount}
            data-testid={`button-save-${goalType}-goal`}
          >
            <PlusCircle className="h-4 w-4 mr-2" />
            Save Goal
          </Button>
        </div>

        <div>
          <p className="text-sm font-semibold mb-2">Existing Goals</p>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : (goals || []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4 border rounded-md">
              No goals configured yet. Add your first goal above.
            </p>
          ) : (
            <div className="space-y-2">
              {(goals || []).map((g: any) => {
                const ccName = costCenters.find(cc => cc.id === (g.costCenterId || g.cost_center_id))?.name;
                const jobName = jobs.find(j => j.id === (g.jobId || g.job_id))?.name;
                const isEditing = editId === g.id;

                if (isEditing) {
                  return (
                    <div
                      key={g.id}
                      className="flex flex-col gap-3 px-4 py-3 rounded-md border bg-muted/20"
                      data-testid={`row-edit-${goalType}-goal-${g.id}`}
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Week Starting</Label>
                          <Input
                            type="date"
                            value={editForm.weekStart}
                            onChange={(e) => setEditForm(f => ({ ...f, weekStart: e.target.value }))}
                            data-testid={`input-edit-${goalType}-week-start-${g.id}`}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Target Amount ($)</Label>
                          <Input
                            type="number"
                            min="0"
                            step="100"
                            value={editForm.targetAmount}
                            onChange={(e) => setEditForm(f => ({ ...f, targetAmount: e.target.value }))}
                            data-testid={`input-edit-${goalType}-target-${g.id}`}
                          />
                        </div>
                        {costCenters.length > 0 && (
                          <div className="space-y-1">
                            <Label className="text-xs">Cost Center</Label>
                            <Select
                              value={editForm.costCenterId || "__none__"}
                              onValueChange={(v) => setEditForm(f => ({ ...f, costCenterId: v === "__none__" ? "" : v }))}
                            >
                              <SelectTrigger data-testid={`select-edit-${goalType}-cost-center-${g.id}`}>
                                <SelectValue placeholder="All Cost Centers" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">All Cost Centers</SelectItem>
                                {costCenters.map(cc => (
                                  <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        {jobs.length > 0 && (
                          <div className="space-y-1">
                            <Label className="text-xs">Job</Label>
                            <Select
                              value={editForm.jobId || "__none__"}
                              onValueChange={(v) => setEditForm(f => ({ ...f, jobId: v === "__none__" ? "" : v }))}
                            >
                              <SelectTrigger data-testid={`select-edit-${goalType}-job-${g.id}`}>
                                <SelectValue placeholder="All Jobs" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">All Jobs</SelectItem>
                                {jobs.map(j => (
                                  <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <Switch
                          id={`edit-${goalType}-auto-recur-${g.id}`}
                          checked={editForm.autoRecur}
                          onCheckedChange={(v) => setEditForm(f => ({ ...f, autoRecur: v }))}
                          data-testid={`switch-edit-${goalType}-auto-recur-${g.id}`}
                        />
                        <Label htmlFor={`edit-${goalType}-auto-recur-${g.id}`} className="text-xs cursor-pointer">Auto-recur</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => updateMutation.mutate(g.id)}
                          disabled={updateMutation.isPending}
                          data-testid={`button-update-${goalType}-goal-${g.id}`}
                        >
                          <Check className="h-4 w-4 mr-1" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditId(null)}
                          data-testid={`button-cancel-edit-${goalType}-goal-${g.id}`}
                        >
                          <X className="h-4 w-4 mr-1" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={g.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 rounded-md border bg-card"
                    data-testid={`row-${goalType}-goal-${g.id}`}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-semibold">{formatCurrency(parseFloat(g.targetAmount || g.target_amount || "0"))}</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs text-muted-foreground">Week of {g.weekStart || g.week_start}</span>
                        {ccName && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{ccName}</Badge>}
                        {jobName && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{jobName}</Badge>}
                        {(g.autoRecur || g.auto_recur) && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Auto-recur</Badge>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => startEdit(g)}
                        data-testid={`button-edit-${goalType}-goal-${g.id}`}
                        title="Edit goal"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                        onClick={() => deleteMutation.mutate(g.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-${goalType}-goal-${g.id}`}
                        title="Delete goal"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function KpiGoalsPage() {
  const { data: costCenters } = useQuery<CostCenter[]>({ queryKey: ["/api/cost-centers"] });
  const { data: jobs } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Target className="h-6 w-6 text-blue-accent" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-kpi-goals-title">KPI Goal Configuration</h1>
          <p className="text-sm text-muted-foreground">Manage weekly labor budget and revenue goals for KPI tracking</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GoalSection
          goalType="labor"
          title="Weekly Labor Budget Goals"
          icon={BarChart3}
          costCenters={costCenters || []}
          jobs={jobs || []}
        />
        <GoalSection
          goalType="revenue"
          title="Weekly Revenue Goals"
          icon={DollarSign}
          costCenters={costCenters || []}
          jobs={jobs || []}
        />
      </div>
    </div>
  );
}
