import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, DollarSign, User, Calendar, GripVertical, Loader2, CheckCircle2 } from "lucide-react";
import type { Deal, DealStage } from "@/lib/onboarding-types";
import { DEAL_STAGES } from "@/lib/onboarding-types";
import type { Customer } from "@shared/schema";

interface DealFormData {
  customerId: string;
  title: string;
  value: number;
  stage: DealStage;
  product: string;
  assignedTo: string;
  notes: string;
  expectedCloseDate: string;
}

function DealForm({ deal, customers, onSave, onCancel }: {
  deal?: Deal;
  customers: Customer[];
  onSave: (data: DealFormData) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    customerId: deal?.customerId?.toString() || "",
    title: deal?.title || "",
    value: deal?.value?.toString() || "0",
    stage: deal?.stage || "lead" as DealStage,
    product: deal?.product || "MyPayLink",
    assignedTo: deal?.assignedTo || "",
    notes: deal?.notes || "",
    expectedCloseDate: deal?.expectedCloseDate || "",
  });

  return (
    <div className="space-y-4">
      <div>
        <Label>Customer *</Label>
        <Select value={form.customerId} onValueChange={v => setForm({ ...form, customerId: v })}>
          <SelectTrigger data-testid="select-deal-customer">
            <SelectValue placeholder="Select customer" />
          </SelectTrigger>
          <SelectContent>
            {customers.map(c => (
              <SelectItem key={c.id} value={c.id.toString()} data-testid={`option-customer-${c.id}`}>
                {c.customerName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Deal Title *</Label>
        <Input data-testid="input-deal-title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Value ($)</Label>
          <Input data-testid="input-deal-value" type="number" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} />
        </div>
        <div>
          <Label>Stage</Label>
          <Select value={form.stage} onValueChange={v => setForm({ ...form, stage: v as DealStage })}>
            <SelectTrigger data-testid="select-deal-stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEAL_STAGES.map(s => (
                <SelectItem key={s.value} value={s.value} data-testid={`option-stage-${s.value}`}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Product</Label>
          <Select value={form.product} onValueChange={v => setForm({ ...form, product: v })}>
            <SelectTrigger data-testid="select-deal-product">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MyPayLink">MyPayLink</SelectItem>
              <SelectItem value="PayLink HR">PayLink HR</SelectItem>
              <SelectItem value="PayLink Payroll">PayLink Payroll</SelectItem>
              <SelectItem value="PayLink Time">PayLink Time</SelectItem>
              <SelectItem value="PayLink Schedule">PayLink Schedule</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Assigned To</Label>
          <Input data-testid="input-deal-assigned" value={form.assignedTo} onChange={e => setForm({ ...form, assignedTo: e.target.value })} />
        </div>
      </div>
      <div>
        <Label>Expected Close Date</Label>
        <Input data-testid="input-deal-close-date" type="date" value={form.expectedCloseDate} onChange={e => setForm({ ...form, expectedCloseDate: e.target.value })} />
      </div>
      <div>
        <Label>Notes</Label>
        <Textarea data-testid="input-deal-notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} data-testid="button-cancel-deal">Cancel</Button>
        <Button
          onClick={() => onSave({ ...form, customerId: form.customerId, value: parseFloat(form.value) || 0 })}
          disabled={!form.title || !form.customerId}
          data-testid="button-save-deal"
        >
          {deal ? "Update" : "Create"} Deal
        </Button>
      </DialogFooter>
    </div>
  );
}

function DealCard({ deal, onEdit, onDragStart }: {
  deal: Deal;
  onEdit: (deal: Deal) => void;
  onDragStart: (e: React.DragEvent, dealId: number) => void;
}) {
  return (
    <Card
      className="cursor-grab hover:shadow-md transition-shadow mb-2 active:cursor-grabbing"
      draggable
      onDragStart={(e) => onDragStart(e, deal.id)}
      onClick={() => onEdit(deal)}
      data-testid={`card-deal-${deal.id}`}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm truncate" data-testid={`text-deal-title-${deal.id}`}>{deal.title}</p>
            <p className="text-xs text-muted-foreground truncate mt-0.5" data-testid={`text-deal-customer-${deal.id}`}>{deal.customerName}</p>
          </div>
          <GripVertical className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400" data-testid={`text-deal-value-${deal.id}`}>
            ${deal.value.toLocaleString()}
          </span>
          <Badge variant="outline" className="text-xs">{deal.product}</Badge>
        </div>
        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
          {deal.assignedTo && (
            <span className="flex items-center gap-1"><User className="h-3 w-3" />{deal.assignedTo}</span>
          )}
          {deal.expectedCloseDate && (
            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{deal.expectedCloseDate}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StageColumn({ stage, deals, onEdit, onDrop, onDragStart, onDragOver, isDropTarget }: {
  stage: typeof DEAL_STAGES[number];
  deals: Deal[];
  onEdit: (deal: Deal) => void;
  onDrop: (e: React.DragEvent, stage: DealStage) => void;
  onDragStart: (e: React.DragEvent, dealId: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  isDropTarget: boolean;
}) {
  const stageValue = deals.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="min-w-[200px]" data-testid={`column-${stage.value}`}>
      <div className="mb-3">
        <div className="flex items-center justify-between">
          <Badge className={stage.color} data-testid={`badge-stage-${stage.value}`}>
            {stage.label}
          </Badge>
          <span className="text-xs text-muted-foreground" data-testid={`count-stage-${stage.value}`}>{deals.length}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">${stageValue.toLocaleString()}</p>
      </div>
      <div
        className={`space-y-2 min-h-[200px] rounded-lg p-2 transition-colors ${
          isDropTarget ? "bg-primary/10 ring-2 ring-primary/30" : "bg-muted/30"
        }`}
        onDragOver={onDragOver}
        onDrop={(e) => onDrop(e, stage.value)}
        data-testid={`dropzone-${stage.value}`}
      >
        {deals.map(deal => (
          <DealCard
            key={deal.id}
            deal={deal}
            onEdit={onEdit}
            onDragStart={onDragStart}
          />
        ))}
        {deals.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">No deals</p>
        )}
      </div>
    </div>
  );
}

export default function DealPipelinePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | undefined>();
  const [confirmWon, setConfirmWon] = useState<Deal | null>(null);
  const [draggedDealId, setDraggedDealId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<DealStage | null>(null);

  const companyId = user?.companyId;

  const { data: deals = [], isLoading } = useQuery<Deal[]>({
    queryKey: [`/api/deals?companyId=${companyId}`],
    enabled: !!companyId,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: [`/api/customers?companyId=${companyId}`],
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: (data: DealFormData) => apiRequest("POST", "/api/deals", { ...data, companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith?.("/api/deals") });
      toast({ title: "Deal created" });
      setDialogOpen(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<DealFormData> }) => apiRequest("PATCH", `/api/deals/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith?.("/api/deals") });
      toast({ title: "Deal updated" });
      setDialogOpen(false);
      setEditing(undefined);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleDragStart = useCallback((e: React.DragEvent, dealId: number) => {
    e.dataTransfer.setData("text/plain", dealId.toString());
    e.dataTransfer.effectAllowed = "move";
    setDraggedDealId(dealId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const target = (e.currentTarget as HTMLElement).closest("[data-testid^='dropzone-']");
    if (target) {
      const stageValue = target.getAttribute("data-testid")?.replace("dropzone-", "") as DealStage;
      setDropTarget(stageValue);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, newStage: DealStage) => {
    e.preventDefault();
    const dealId = parseInt(e.dataTransfer.getData("text/plain"));
    setDraggedDealId(null);
    setDropTarget(null);

    if (!dealId) return;

    const deal = deals.find(d => d.id === dealId);
    if (!deal || deal.stage === newStage) return;

    if (newStage === "closed_won") {
      setConfirmWon(deal);
      return;
    }

    updateMutation.mutate({ id: dealId, data: { stage: newStage } });
  }, [deals, updateMutation]);

  const handleDragEnd = useCallback(() => {
    setDraggedDealId(null);
    setDropTarget(null);
  }, []);

  const confirmClosedWon = () => {
    if (confirmWon) {
      updateMutation.mutate({ id: confirmWon.id, data: { stage: "closed_won" as DealStage } });
      setConfirmWon(null);
    }
  };

  const stageDeals = (stage: DealStage) => deals.filter(d => d.stage === stage);

  const totalValue = deals.reduce((sum, d) => sum + d.value, 0);
  const wonValue = deals.filter(d => d.stage === "closed_won").reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="p-6 space-y-6" onDragEnd={handleDragEnd}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Deal Pipeline</h1>
          <p className="text-muted-foreground">Track and manage deals through your sales pipeline</p>
        </div>
        <Button onClick={() => { setEditing(undefined); setDialogOpen(true); }} data-testid="button-add-deal">
          <Plus className="h-4 w-4 mr-2" /> New Deal
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-total-deals">{deals.length}</div>
              <div className="text-xs text-muted-foreground">Total Deals</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-pipeline-value">${totalValue.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Pipeline Value</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-teal-600" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-won-value">${wonValue.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Won Value</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-6 gap-3 overflow-x-auto" data-testid="kanban-board">
          {DEAL_STAGES.map(stage => (
            <StageColumn
              key={stage.value}
              stage={stage}
              deals={stageDeals(stage.value)}
              onEdit={(d) => { setEditing(d); setDialogOpen(true); }}
              onDrop={handleDrop}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              isDropTarget={dropTarget === stage.value}
            />
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Deal" : "New Deal"}</DialogTitle>
          </DialogHeader>
          <DealForm
            deal={editing}
            customers={customers}
            onSave={data => {
              if (editing) {
                updateMutation.mutate({ id: editing.id, data });
              } else {
                createMutation.mutate(data);
              }
            }}
            onCancel={() => { setDialogOpen(false); setEditing(undefined); }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmWon} onOpenChange={() => setConfirmWon(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              Confirm Closed Won
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Mark <strong>{confirmWon?.title}</strong> as Closed Won? This will move the deal to the final stage.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmWon(null)} data-testid="button-cancel-won">Cancel</Button>
            <Button onClick={confirmClosedWon} className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-confirm-won">
              <CheckCircle2 className="h-4 w-4 mr-2" /> Confirm Won
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
