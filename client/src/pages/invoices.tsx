import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus, Search, Edit, Trash2, FileText, DollarSign, Send, Eye, Loader2,
  CalendarDays, Clock, CheckCircle, AlertCircle, XCircle, Copy, Link2,
  CreditCard, Building2, Zap, ArrowRight, Settings, Info, Sparkles,
  TrendingDown, Shield, Palette, RefreshCw, Bell, Mail, MessageSquare,
  Pause, Play, MoreHorizontal, Printer,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InvoicePreview } from "@/components/invoice-preview";
import type { Invoice, Customer, Company } from "@shared/schema";

// ── Invoice Template Styles ─────────────────────────────────────────────────
const TEMPLATE_STYLES = [
  {
    key: "modern_clean",
    name: "Modern Clean",
    description: "Teal gradient header, crisp layout",
    preview: (
      <div className="w-full h-full flex flex-col text-[6px] leading-tight overflow-hidden">
        <div className="bg-gradient-to-r from-teal-500 to-blue-500 p-1.5 text-white font-bold">INVOICE</div>
        <div className="flex-1 p-1 space-y-0.5">
          <div className="bg-teal-100 h-1 w-3/4 rounded" />
          <div className="bg-gray-200 h-1 w-1/2 rounded" />
          <div className="mt-1 border-t border-teal-200 pt-0.5">
            <div className="bg-gray-100 h-1 w-full rounded" />
            <div className="bg-gray-100 h-1 w-full rounded mt-0.5" />
          </div>
          <div className="flex justify-end mt-1">
            <div className="bg-teal-500 text-white px-1 py-0.5 rounded text-[5px] font-bold">$0.00</div>
          </div>
        </div>
      </div>
    ),
  },
  {
    key: "classic",
    name: "Classic",
    description: "Navy border, professional look",
    preview: (
      <div className="w-full h-full flex flex-col text-[6px] leading-tight overflow-hidden border-l-2 border-blue-900">
        <div className="p-1.5 border-b-2 border-blue-900">
          <div className="font-bold text-blue-900">INVOICE</div>
          <div className="text-gray-500 text-[5px]">Company Name</div>
        </div>
        <div className="flex-1 p-1 space-y-0.5">
          <div className="bg-blue-900 h-1 w-3/4 rounded opacity-30" />
          <div className="bg-gray-200 h-1 w-1/2 rounded" />
          <div className="mt-1 space-y-0.5">
            <div className="bg-gray-100 h-1 w-full rounded" />
            <div className="bg-gray-100 h-1 w-full rounded" />
          </div>
          <div className="flex justify-end mt-1">
            <div className="border border-blue-900 text-blue-900 px-1 py-0.5 rounded text-[5px] font-bold">$0.00</div>
          </div>
        </div>
      </div>
    ),
  },
  {
    key: "minimal",
    name: "Minimal",
    description: "Clean white, subtle gray lines",
    preview: (
      <div className="w-full h-full flex flex-col text-[6px] leading-tight overflow-hidden">
        <div className="p-1.5">
          <div className="font-bold text-gray-800 text-[7px]">INVOICE</div>
        </div>
        <div className="h-px bg-gray-300 mx-1" />
        <div className="flex-1 p-1 space-y-0.5">
          <div className="bg-gray-200 h-1 w-2/3 rounded" />
          <div className="bg-gray-100 h-1 w-1/2 rounded" />
          <div className="mt-1 space-y-0.5">
            <div className="bg-gray-100 h-1 w-full rounded" />
            <div className="bg-gray-100 h-1 w-full rounded" />
          </div>
          <div className="h-px bg-gray-300 mt-1" />
          <div className="flex justify-end">
            <div className="text-[5px] font-bold text-gray-800">TOTAL $0.00</div>
          </div>
        </div>
      </div>
    ),
  },
  {
    key: "bold_accent",
    name: "Bold Accent",
    description: "Dark header, high contrast",
    preview: (
      <div className="w-full h-full flex flex-col text-[6px] leading-tight overflow-hidden">
        <div className="bg-gray-900 p-1.5 text-white">
          <div className="font-bold text-[7px]">INVOICE</div>
          <div className="text-gray-400 text-[5px]">Company</div>
        </div>
        <div className="flex-1 p-1 space-y-0.5">
          <div className="bg-yellow-400 h-1 w-1/3 rounded" />
          <div className="bg-gray-200 h-1 w-1/2 rounded mt-0.5" />
          <div className="mt-1 space-y-0.5">
            <div className="flex justify-between">
              <div className="bg-gray-100 h-1 w-3/5 rounded" />
              <div className="bg-gray-200 h-1 w-1/4 rounded" />
            </div>
            <div className="flex justify-between">
              <div className="bg-gray-100 h-1 w-3/5 rounded" />
              <div className="bg-gray-200 h-1 w-1/4 rounded" />
            </div>
          </div>
          <div className="flex justify-end mt-1">
            <div className="bg-gray-900 text-white px-1 py-0.5 rounded text-[5px] font-bold">$0.00</div>
          </div>
        </div>
      </div>
    ),
  },
];

type InvoiceWithItems = Invoice & { lineItems?: any[] };

interface PaymentMethodConfig {
  id: string;
  companyId: string;
  methodType: string;
  displayName: string;
  description: string | null;
  feeType: string;
  feePercent: string | null;
  feeFlat: string | null;
  feeCap: string | null;
  isEnabled: boolean | null;
  isRecommended: boolean | null;
  processingTime: string | null;
  sortOrder: number | null;
}

const methodIcons: Record<string, any> = {
  ach: Building2,
  card: CreditCard,
  instant_bank: Zap,
  wire: ArrowRight,
};

const methodColors: Record<string, string> = {
  ach: "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950",
  card: "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950",
  instant_bank: "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950",
  wire: "border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950",
};

function calculateFee(config: PaymentMethodConfig, amount: number): number {
  let fee = 0;
  if (config.feeType === "percentage") {
    fee = amount * (parseFloat(config.feePercent || "0") / 100);
  } else if (config.feeType === "flat") {
    fee = parseFloat(config.feeFlat || "0");
  } else if (config.feeType === "both") {
    fee = amount * (parseFloat(config.feePercent || "0") / 100) + parseFloat(config.feeFlat || "0");
  }
  if (config.feeCap && fee > parseFloat(config.feeCap)) {
    fee = parseFloat(config.feeCap);
  }
  return Math.round(fee * 100) / 100;
}

function RecordPaymentDialog({ invoice, companyId, open, onOpenChange }: {
  invoice: Invoice;
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [selectedMethod, setSelectedMethod] = useState("");
  const [amount, setAmount] = useState(invoice.amountDue || invoice.totalAmount || "0");
  const [notes, setNotes] = useState("");

  const amountDue = parseFloat(invoice.amountDue || invoice.totalAmount || "0");

  const { data: configs = [] } = useQuery<PaymentMethodConfig[]>({
    queryKey: [`/api/payment-method-configs?companyId=${companyId}`],
    enabled: !!companyId && open,
  });

  const enabledConfigs = configs.filter(c => c.isEnabled);

  useEffect(() => {
    if (enabledConfigs.length > 0 && !selectedMethod) {
      const recommended = enabledConfigs.find(c => c.isRecommended);
      setSelectedMethod(recommended?.methodType || enabledConfigs[0].methodType);
    }
  }, [enabledConfigs, selectedMethod]);

  const selectedConfig = enabledConfigs.find(c => c.methodType === selectedMethod);
  const baseAmount = parseFloat(amount) || 0;
  const feeAmount = selectedConfig ? calculateFee(selectedConfig, baseAmount) : 0;
  const totalCharged = baseAmount + feeAmount;

  const lowestFeeMethod = enabledConfigs.reduce<PaymentMethodConfig | null>((lowest, c) => {
    const f = calculateFee(c, baseAmount);
    if (!lowest) return c;
    return f < calculateFee(lowest, baseAmount) ? c : lowest;
  }, null);

  const savingsAmount = selectedConfig && lowestFeeMethod && selectedMethod !== lowestFeeMethod.methodType
    ? feeAmount - calculateFee(lowestFeeMethod, baseAmount)
    : 0;

  const paymentMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/payments", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/invoices?companyId=${companyId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/payments?companyId=${companyId}`] });
      toast({ title: "Payment recorded successfully" });
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = () => {
    paymentMutation.mutate({
      companyId,
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      paymentMethod: selectedMethod,
      amount: baseAmount.toFixed(2),
      baseAmount: baseAmount.toFixed(2),
      feeAmount: feeAmount.toFixed(2),
      totalCharged: totalCharged.toFixed(2),
      paymentFeeCharged: feeAmount.toFixed(2),
      netAmount: baseAmount.toFixed(2),
      status: "completed",
      paidAt: new Date().toISOString(),
      notes,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-teal-500" />
            Record Payment — {invoice.invoiceNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <span className="text-sm text-muted-foreground">Amount Due</span>
            <span className="text-lg font-bold" data-testid="text-payment-amount-due">${amountDue.toFixed(2)}</span>
          </div>

          <div>
            <Label className="text-sm font-semibold mb-2 block">Payment Amount</Label>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              data-testid="input-payment-amount"
            />
          </div>

          <div>
            <Label className="text-sm font-semibold mb-3 block">Choose Payment Method</Label>
            <div className="space-y-2">
              {enabledConfigs.map(config => {
                const Icon = methodIcons[config.methodType] || DollarSign;
                const fee = calculateFee(config, baseAmount);
                const isSelected = selectedMethod === config.methodType;
                const colorClass = methodColors[config.methodType] || "";

                return (
                  <div
                    key={config.methodType}
                    className={`relative p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      isSelected
                        ? `ring-2 ring-teal-500 border-teal-500 ${colorClass}`
                        : `border-border hover:border-muted-foreground/30 ${colorClass}`
                    }`}
                    onClick={() => setSelectedMethod(config.methodType)}
                    data-testid={`payment-method-${config.methodType}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                          isSelected ? "bg-teal-500 text-white" : "bg-background border"
                        }`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{config.displayName}</span>
                            {config.isRecommended && (
                              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px] px-1.5 py-0">
                                <Sparkles className="h-3 w-3 mr-0.5" /> Recommended
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{config.description}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        {fee === 0 ? (
                          <span className="text-sm font-bold text-emerald-600">FREE</span>
                        ) : (
                          <div>
                            <span className="text-sm font-bold">${fee.toFixed(2)}</span>
                            <span className="text-xs text-muted-foreground block">
                              {config.feeType === "percentage" ? `${config.feePercent}% fee` : "flat fee"}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {config.processingTime && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {config.processingTime}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {savingsAmount > 0 && lowestFeeMethod && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800" data-testid="savings-hint">
              <TrendingDown className="h-4 w-4 text-emerald-600 flex-shrink-0" />
              <span className="text-sm text-emerald-700 dark:text-emerald-400">
                Save ${savingsAmount.toFixed(2)} by paying with {lowestFeeMethod.displayName}
              </span>
            </div>
          )}

          <div className="border-t pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Invoice Amount</span>
              <span>${baseAmount.toFixed(2)}</span>
            </div>
            {feeAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Processing Fee ({selectedConfig?.displayName})</span>
                <span className="text-amber-600">+${feeAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold pt-1 border-t">
              <span>Total Charged</span>
              <span data-testid="text-total-charged">${totalCharged.toFixed(2)}</span>
            </div>
          </div>

          <div>
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Payment reference, memo..."
              data-testid="input-payment-notes"
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Shield className="h-3 w-3" />
            All fees are disclosed before payment confirmation. No hidden charges.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-payment">Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedMethod || baseAmount <= 0 || paymentMutation.isPending}
            data-testid="button-confirm-payment"
          >
            {paymentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
            Confirm Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentMethodSettings({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const { data: configs = [], isLoading } = useQuery<PaymentMethodConfig[]>({
    queryKey: [`/api/payment-method-configs?companyId=${companyId}`],
    enabled: !!companyId,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/payment-method-configs/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/payment-method-configs?companyId=${companyId}`] });
      toast({ title: "Payment method updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Payment Method Configuration</h3>
      </div>
      <p className="text-sm text-muted-foreground">Configure which payment methods are available to your customers and set fee structures for each method.</p>

      <div className="space-y-3">
        {configs.map(config => {
          const Icon = methodIcons[config.methodType] || DollarSign;
          return (
            <Card key={config.id} data-testid={`config-method-${config.methodType}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-teal-500 to-blue-500 flex items-center justify-center text-white flex-shrink-0">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{config.displayName}</span>
                        {config.isRecommended && (
                          <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">Recommended</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{config.description}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-shrink-0 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Fee %</Label>
                      <Input
                        type="number"
                        step="0.1"
                        className="w-20 h-8 text-sm"
                        value={config.feePercent || "0"}
                        onChange={e => updateMutation.mutate({ id: config.id, data: { feePercent: e.target.value } })}
                        data-testid={`input-fee-percent-${config.methodType}`}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Flat $</Label>
                      <Input
                        type="number"
                        step="0.01"
                        className="w-20 h-8 text-sm"
                        value={config.feeFlat || "0"}
                        onChange={e => updateMutation.mutate({ id: config.id, data: { feeFlat: e.target.value } })}
                        data-testid={`input-fee-flat-${config.methodType}`}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger>
                          <Label className="text-xs text-muted-foreground cursor-help flex items-center gap-1">
                            Enabled <Info className="h-3 w-3" />
                          </Label>
                        </TooltipTrigger>
                        <TooltipContent>Toggle this payment method on or off for customers</TooltipContent>
                      </Tooltip>
                      <Switch
                        checked={config.isEnabled ?? true}
                        onCheckedChange={checked => updateMutation.mutate({ id: config.id, data: { isEnabled: checked } })}
                        data-testid={`switch-enabled-${config.methodType}`}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger>
                          <Label className="text-xs text-muted-foreground cursor-help flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                          </Label>
                        </TooltipTrigger>
                        <TooltipContent>Mark as recommended method</TooltipContent>
                      </Tooltip>
                      <Switch
                        checked={config.isRecommended ?? false}
                        onCheckedChange={checked => updateMutation.mutate({ id: config.id, data: { isRecommended: checked } })}
                        data-testid={`switch-recommended-${config.methodType}`}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-dashed">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Fee Disclosure</p>
              <p>All fees are transparently shown to customers before they confirm payment. Customers see the invoice amount, processing fee, and total charged in a clear breakdown.</p>
              <p>ACH is set as the recommended low-cost option by default. Adjust fees and recommendations to match your business needs.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InvoiceForm({ invoice, customers, companyId, companies = [], onSave, onCancel }: {
  invoice?: InvoiceWithItems;
  customers: Customer[];
  companyId: string;
  companies?: Company[];
  onSave: (data: any) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    customerId: invoice?.customerId || "",
    invoiceNumber: invoice?.invoiceNumber || `INV-${Date.now().toString(36).toUpperCase()}`,
    status: invoice?.status || "draft",
    issueDate: invoice?.issueDate || new Date().toISOString().split("T")[0],
    dueDate: invoice?.dueDate || "",
    notes: invoice?.notes || "",
    paymentTerms: invoice?.paymentTerms || "net_30",
    templateStyle: (invoice as any)?.templateStyle || "modern_clean",
    selectedCompanyId: invoice?.companyId || companyId || "",
  });

  const [lineItems, setLineItems] = useState<Array<{ description: string; quantity: string; unitPrice: string; taxable: boolean }>>(
    invoice?.lineItems?.map((li: any) => ({
      description: li.description || "",
      quantity: String(li.quantity || "1"),
      unitPrice: String(li.unitPrice || "0"),
      taxable: li.taxable !== false,
    })) || [{ description: "", quantity: "1", unitPrice: "0", taxable: true }]
  );

  const addLine = () => setLineItems([...lineItems, { description: "", quantity: "1", unitPrice: "0", taxable: true }]);
  const removeLine = (i: number) => setLineItems(lineItems.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: string, value: any) => {
    const updated = [...lineItems];
    updated[i] = { ...updated[i], [field]: value };
    setLineItems(updated);
  };

  const subtotal = lineItems.reduce((sum, li) => sum + (parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0), 0);
  const total = subtotal;

  const handleSave = () => {
    const effectiveCompanyId = form.selectedCompanyId || companyId;
    onSave({
      customerId: form.customerId,
      invoiceNumber: form.invoiceNumber,
      status: form.status,
      issueDate: form.issueDate,
      dueDate: form.dueDate,
      notes: form.notes,
      paymentTerms: form.paymentTerms,
      templateStyle: form.templateStyle,
      companyId: effectiveCompanyId,
      subtotal: subtotal.toFixed(2),
      taxAmount: "0",
      totalAmount: total.toFixed(2),
      amountDue: total.toFixed(2),
      lineItems: lineItems.filter(li => li.description).map((li, i) => ({
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        amount: ((parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0)).toFixed(2),
        taxable: li.taxable,
        sortOrder: i,
      })),
    });
  };

  return (
    <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-2">

      {/* Template Style Picker */}
      <div>
        <Label className="flex items-center gap-1.5 mb-2"><Palette className="h-4 w-4" /> Template Style</Label>
        <div className="grid grid-cols-4 gap-2">
          {TEMPLATE_STYLES.map(tpl => (
            <button
              key={tpl.key}
              type="button"
              onClick={() => setForm({ ...form, templateStyle: tpl.key })}
              data-testid={`button-template-${tpl.key}`}
              className={`rounded-lg border-2 p-0 overflow-hidden transition-all cursor-pointer text-left ${
                form.templateStyle === tpl.key
                  ? "border-teal-500 shadow-md shadow-teal-200 dark:shadow-teal-900/30"
                  : "border-muted hover:border-muted-foreground/40"
              }`}
            >
              <div className="h-20 w-full bg-white dark:bg-gray-50">{tpl.preview}</div>
              <div className="px-1.5 py-1 bg-background border-t">
                <div className="text-xs font-semibold truncate">{tpl.name}</div>
                <div className="text-[10px] text-muted-foreground truncate leading-tight">{tpl.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Company selector — shown when admin has no assigned company */}
      {companies.length > 0 && (
        <div>
          <Label>Company *</Label>
          <Select value={form.selectedCompanyId} onValueChange={v => setForm({ ...form, selectedCompanyId: v })}>
            <SelectTrigger data-testid="select-invoice-company">
              <SelectValue placeholder="Select company" />
            </SelectTrigger>
            <SelectContent>
              {companies.map(c => (
                <SelectItem key={c.id} value={c.id} data-testid={`option-company-${c.id}`}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>Customer *</Label>
          <Select value={form.customerId} onValueChange={v => setForm({ ...form, customerId: v })}>
            <SelectTrigger data-testid="select-invoice-customer">
              <SelectValue placeholder="Select customer" />
            </SelectTrigger>
            <SelectContent>
              {customers.map(c => (
                <SelectItem key={c.id} value={c.id} data-testid={`option-customer-${c.id}`}>{c.customerName}{c.businessName ? ` (${c.businessName})` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Invoice Number *</Label>
          <Input data-testid="input-invoice-number" value={form.invoiceNumber} onChange={e => setForm({ ...form, invoiceNumber: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <Label>Issue Date</Label>
          <Input data-testid="input-issue-date" type="date" value={form.issueDate} onChange={e => setForm({ ...form, issueDate: e.target.value })} />
        </div>
        <div>
          <Label>Due Date</Label>
          <Input data-testid="input-due-date" type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} />
        </div>
        <div>
          <Label>Status</Label>
          <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
            <SelectTrigger data-testid="select-invoice-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft" data-testid="option-draft">Draft</SelectItem>
              <SelectItem value="sent" data-testid="option-sent">Sent</SelectItem>
              <SelectItem value="viewed" data-testid="option-viewed">Viewed</SelectItem>
              <SelectItem value="paid" data-testid="option-paid">Paid</SelectItem>
              <SelectItem value="overdue" data-testid="option-overdue">Overdue</SelectItem>
              <SelectItem value="cancelled" data-testid="option-cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">Line Items</Label>
          <Button variant="outline" size="sm" onClick={addLine} data-testid="button-add-line">
            <Plus className="h-3 w-3 mr-1" /> Add Line
          </Button>
        </div>
        <div className="space-y-2">
          {lineItems.map((li, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-5">
                {i === 0 && <Label className="text-xs">Description</Label>}
                <Input placeholder="Description" value={li.description} onChange={e => updateLine(i, "description", e.target.value)}
                  data-testid={`input-line-desc-${i}`} />
              </div>
              <div className="col-span-2">
                {i === 0 && <Label className="text-xs">Qty</Label>}
                <Input type="number" value={li.quantity} onChange={e => updateLine(i, "quantity", e.target.value)}
                  data-testid={`input-line-qty-${i}`} />
              </div>
              <div className="col-span-2">
                {i === 0 && <Label className="text-xs">Price</Label>}
                <Input type="number" step="0.01" value={li.unitPrice} onChange={e => updateLine(i, "unitPrice", e.target.value)}
                  data-testid={`input-line-price-${i}`} />
              </div>
              <div className="col-span-2 flex items-center gap-1">
                {i === 0 && <Label className="text-xs block mb-1">Taxable</Label>}
                <input type="checkbox" checked={li.taxable} onChange={e => updateLine(i, "taxable", e.target.checked)}
                  data-testid={`input-line-taxable-${i}`} className="h-4 w-4" />
              </div>
              <div className="col-span-1">
                {lineItems.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeLine(i)} data-testid={`button-remove-line-${i}`}>
                    <Trash2 className="h-3 w-3 text-red-500" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <div className="text-right space-y-1 text-sm">
            <div>Subtotal: <span className="font-medium" data-testid="text-subtotal">${subtotal.toFixed(2)}</span></div>
            <div className="text-base font-bold">Total: <span data-testid="text-total">${total.toFixed(2)}</span></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>Notes</Label>
          <Textarea data-testid="input-invoice-notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
        </div>
        <div>
          <Label>Payment Terms</Label>
          <Select value={form.paymentTerms} onValueChange={v => setForm({ ...form, paymentTerms: v })}>
            <SelectTrigger data-testid="select-payment-terms">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="due_on_receipt" data-testid="option-terms-receipt">Due on Receipt</SelectItem>
              <SelectItem value="net_15" data-testid="option-terms-15">Net 15</SelectItem>
              <SelectItem value="net_30" data-testid="option-terms-30">Net 30</SelectItem>
              <SelectItem value="net_60" data-testid="option-terms-60">Net 60</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} data-testid="button-cancel-invoice">Cancel</Button>
        <Button
          onClick={handleSave}
          disabled={!form.invoiceNumber || !form.dueDate || !(form.selectedCompanyId || companyId)}
          data-testid="button-save-invoice"
        >
          {invoice?.id ? "Update" : "Create"} Invoice
        </Button>
      </DialogFooter>
    </div>
  );
}

// ── Recurring Billing Tab ──────────────────────────────────────────────────

const FREQ_OPTIONS = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-Weekly (every 2 weeks)" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semiannual", label: "Semi-Annual" },
  { value: "annual", label: "Annual" },
  { value: "custom", label: "Custom interval" },
];

const REMINDER_OPTIONS = [
  { value: "0", label: "No reminders" },
  { value: "1", label: "Every day" },
  { value: "3", label: "Every 3 days" },
  { value: "7", label: "Weekly" },
  { value: "14", label: "Every 2 weeks" },
];

type RecurProfile = {
  id: string; name: string; customerId: string; frequency: string;
  customIntervalDays: number | null; amount: string; taxRate: string;
  startDate: string; endDate: string | null; nextInvoiceDate: string | null;
  dueDays: number; notifyEmail: boolean; notifySms: boolean;
  notifyDaysBefore: number; reminderFrequencyDays: number;
  status: string; notes: string | null; companyId: string;
};

const emptyProfile = (): Partial<RecurProfile> => ({
  name: "", customerId: "", frequency: "monthly", customIntervalDays: null,
  amount: "", taxRate: "0", startDate: new Date().toISOString().split("T")[0],
  endDate: null, dueDays: 30, notifyEmail: true, notifySms: false,
  notifyDaysBefore: 7, reminderFrequencyDays: 0, status: "active", notes: "",
});

function RecurringBillingTab({ companyId, customers }: { companyId: string; customers: Customer[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecurProfile | null>(null);
  const [form, setForm] = useState<Partial<RecurProfile>>(emptyProfile());

  const { data: profiles = [], isLoading } = useQuery<RecurProfile[]>({
    queryKey: [`/api/recurring-billing?companyId=${companyId}`],
    enabled: !!companyId,
  });

  const openCreate = () => { setEditing(null); setForm(emptyProfile()); setOpen(true); };
  const openEdit = (p: RecurProfile) => { setEditing(p); setForm({ ...p }); setOpen(true); };

  const saveMutation = useMutation({
    mutationFn: async (data: Partial<RecurProfile>) => {
      if (editing) {
        await apiRequest("PATCH", `/api/recurring-billing/${editing.id}`, data);
      } else {
        await apiRequest("POST", "/api/recurring-billing", { ...data, companyId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/recurring-billing?companyId=${companyId}`] });
      setOpen(false);
      toast({ title: editing ? "Profile updated" : "Recurring profile created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/recurring-billing/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/recurring-billing?companyId=${companyId}`] });
      toast({ title: "Profile deleted" });
    },
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/recurring-billing/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/recurring-billing?companyId=${companyId}`] }),
  });

  const handleSave = () => {
    if (!form.name) return toast({ title: "Profile name is required", variant: "destructive" });
    if (!form.customerId) return toast({ title: "Customer is required", variant: "destructive" });
    if (!form.startDate) return toast({ title: "Start date is required", variant: "destructive" });
    if (!form.amount || isNaN(parseFloat(form.amount as string))) return toast({ title: "Amount is required", variant: "destructive" });
    saveMutation.mutate(form);
  };

  const getCustomerName = (id: string) => customers.find(c => c.id === id)?.name || id;

  const freqLabel = (p: RecurProfile) => {
    const opt = FREQ_OPTIONS.find(o => o.value === p.frequency);
    if (p.frequency === "custom" && p.customIntervalDays) return `Every ${p.customIntervalDays} days`;
    return opt?.label || p.frequency;
  };

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">Recurring Billing</h3>
          <p className="text-sm text-muted-foreground">Automatically generate invoices on a schedule</p>
        </div>
        <Button onClick={openCreate} data-testid="button-create-recurring">
          <Plus className="h-4 w-4 mr-2" /> New Profile
        </Button>
      </div>

      {profiles.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <RefreshCw className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-lg font-medium">No recurring profiles yet</p>
            <p className="text-muted-foreground mt-1 text-sm">Set up automatic recurring invoices for your customers</p>
            <Button className="mt-4" onClick={openCreate} data-testid="button-setup-recurring">
              <Plus className="h-4 w-4 mr-2" /> Create Recurring Profile
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {profiles.map(p => (
            <Card key={p.id} data-testid={`card-recurring-${p.id}`} className={p.status === "paused" ? "opacity-60" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-teal-500 to-blue-500 flex items-center justify-center text-white shrink-0">
                      <RefreshCw className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{p.name}</div>
                      <div className="text-sm text-muted-foreground">{getCustomerName(p.customerId)}</div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><RefreshCw className="h-3 w-3" />{freqLabel(p)}</span>
                        <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />Starts {p.startDate}</span>
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Net {p.dueDays} days</span>
                        {p.notifyEmail && <span className="flex items-center gap-1 text-teal-600"><Mail className="h-3 w-3" />Email</span>}
                        {p.notifySms && <span className="flex items-center gap-1 text-blue-600"><MessageSquare className="h-3 w-3" />SMS</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <div className="font-bold text-lg">${parseFloat(p.amount).toFixed(2)}</div>
                      <Badge variant={p.status === "active" ? "default" : "secondary"} className="text-xs">
                        {p.status === "active" ? "Active" : "Paused"}
                      </Badge>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-recurring-menu-${p.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(p)}><Edit className="h-4 w-4 mr-2" />Edit</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toggleStatus.mutate({ id: p.id, status: p.status === "active" ? "paused" : "active" })}>
                          {p.status === "active" ? <><Pause className="h-4 w-4 mr-2" />Pause</> : <><Play className="h-4 w-4 mr-2" />Resume</>}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-red-600" onClick={() => { if (confirm("Delete this recurring profile?")) deleteMutation.mutate(p.id); }}>
                          <Trash2 className="h-4 w-4 mr-2" />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Recurring Profile" : "New Recurring Profile"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-1">

            {/* Basic info */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />Profile Details
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2 space-y-1">
                  <Label>Profile Name</Label>
                  <Input value={form.name || ""} onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Monthly Retainer — Acme Corp" data-testid="input-recurring-name" />
                </div>
                <div className="space-y-1">
                  <Label>Customer</Label>
                  <Select value={form.customerId || ""} onValueChange={v => setForm({ ...form, customerId: v })}>
                    <SelectTrigger data-testid="select-recurring-customer"><SelectValue placeholder="Select customer" /></SelectTrigger>
                    <SelectContent>
                      {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Amount ($)</Label>
                  <Input type="number" step="0.01" min="0" value={form.amount || ""}
                    onChange={e => setForm({ ...form, amount: e.target.value })}
                    placeholder="0.00" data-testid="input-recurring-amount" />
                </div>
                <div className="space-y-1">
                  <Label>Tax Rate (%)</Label>
                  <Input type="number" step="0.01" min="0" max="100" value={form.taxRate || "0"}
                    onChange={e => setForm({ ...form, taxRate: e.target.value })} data-testid="input-recurring-tax" />
                </div>
              </div>
            </div>

            {/* Schedule */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />Schedule
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Frequency</Label>
                  <Select value={form.frequency || "monthly"} onValueChange={v => setForm({ ...form, frequency: v })}>
                    <SelectTrigger data-testid="select-recurring-frequency"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FREQ_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {form.frequency === "custom" && (
                  <div className="space-y-1">
                    <Label>Every X Days</Label>
                    <Input type="number" min="1" value={form.customIntervalDays || ""}
                      onChange={e => setForm({ ...form, customIntervalDays: parseInt(e.target.value) || null })}
                      placeholder="e.g. 45" data-testid="input-recurring-custom-days" />
                  </div>
                )}
                <div className="space-y-1">
                  <Label>First Invoice Date</Label>
                  <Input type="date" value={form.startDate || ""}
                    onChange={e => setForm({ ...form, startDate: e.target.value })} data-testid="input-recurring-start" />
                </div>
                <div className="space-y-1">
                  <Label>End Date <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Input type="date" value={form.endDate || ""}
                    onChange={e => setForm({ ...form, endDate: e.target.value || null })} data-testid="input-recurring-end" />
                </div>
                <div className="space-y-1">
                  <Label>Due Days <span className="text-muted-foreground text-xs">(net terms)</span></Label>
                  <Select value={String(form.dueDays ?? 30)} onValueChange={v => setForm({ ...form, dueDays: parseInt(v) })}>
                    <SelectTrigger data-testid="select-recurring-due-days"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Due on Receipt</SelectItem>
                      <SelectItem value="7">Net 7</SelectItem>
                      <SelectItem value="15">Net 15</SelectItem>
                      <SelectItem value="30">Net 30</SelectItem>
                      <SelectItem value="45">Net 45</SelectItem>
                      <SelectItem value="60">Net 60</SelectItem>
                      <SelectItem value="90">Net 90</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Notifications */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5" />Notifications
              </h4>
              <div className="rounded-md border p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Email notifications</p>
                      <p className="text-xs text-muted-foreground">Send invoice to customer by email</p>
                    </div>
                  </div>
                  <Switch checked={!!form.notifyEmail} onCheckedChange={v => setForm({ ...form, notifyEmail: v })} data-testid="switch-notify-email" />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">SMS notifications</p>
                      <p className="text-xs text-muted-foreground">Text message alert when invoice is issued</p>
                    </div>
                  </div>
                  <Switch checked={!!form.notifySms} onCheckedChange={v => setForm({ ...form, notifySms: v })} data-testid="switch-notify-sms" />
                </div>
                {(form.notifyEmail || form.notifySms) && (
                  <div className="pt-2 border-t space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Notify how many days before due?</Label>
                        <Select value={String(form.notifyDaysBefore ?? 7)} onValueChange={v => setForm({ ...form, notifyDaysBefore: parseInt(v) })}>
                          <SelectTrigger data-testid="select-notify-days"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">On due date</SelectItem>
                            <SelectItem value="1">1 day before</SelectItem>
                            <SelectItem value="3">3 days before</SelectItem>
                            <SelectItem value="7">7 days before</SelectItem>
                            <SelectItem value="14">14 days before</SelectItem>
                            <SelectItem value="30">30 days before</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>Reminder frequency</Label>
                        <Select value={String(form.reminderFrequencyDays ?? 0)} onValueChange={v => setForm({ ...form, reminderFrequencyDays: parseInt(v) })}>
                          <SelectTrigger data-testid="select-reminder-freq"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {REMINDER_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1">
              <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })}
                rows={2} placeholder="Internal notes about this recurring billing..." data-testid="input-recurring-notes" />
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-recurring">
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {editing ? "Save Changes" : "Create Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Invoice Preview Dialog ──────────────────────────────────────────────────
function InvoicePreviewDialog({ invoiceId, companyId, open, onOpenChange, onSend }: {
  invoiceId: string;
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend?: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [invoiceFull, setInvoiceFull] = useState<any>(null);

  useEffect(() => {
    if (!open || !invoiceId) return;
    setLoading(true);
    fetch(`/api/invoices/${invoiceId}/full`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { setInvoiceFull(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [open, invoiceId]);

  const handlePrint = () => {
    const root = document.getElementById("invoice-preview-root");
    if (!root) return;
    const html = root.outerHTML;
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice</title>
<style>body{margin:0;padding:20px;background:#f5f5f5;font-family:Arial,sans-serif}
@page{size:A4;margin:12mm}@media print{body{background:white;padding:0}}</style>
</head><body>${html}<script>window.onload=()=>{window.print();window.close();}<\/script></body></html>`);
    win.document.close();
  };

  const payLink = invoiceFull ? `${window.location.origin}/pay/${invoiceId}` : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-teal-600" />
              {invoiceFull ? `Invoice #${invoiceFull.invoiceNumber}` : "Invoice Preview"}
            </DialogTitle>
            <div className="flex items-center gap-2 mr-8">
              <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-invoice">
                <Printer className="h-4 w-4 mr-1" /> Print / PDF
              </Button>
              {invoiceFull && (
                <Button variant="outline" size="sm" onClick={() => {
                  navigator.clipboard.writeText(payLink);
                  toast({ title: "Payment link copied!" });
                }} data-testid="button-copy-link-preview">
                  <Link2 className="h-4 w-4 mr-1" /> Copy Pay Link
                </Button>
              )}
              {onSend && invoiceFull?.status === "draft" && (
                <Button size="sm" className="bg-teal-600 hover:bg-teal-700 text-white" onClick={() => { onOpenChange(false); onSend(); }} data-testid="button-send-from-preview">
                  <Send className="h-4 w-4 mr-1" /> Send Invoice
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
            </div>
          ) : invoiceFull ? (
            <InvoicePreview invoice={invoiceFull} />
          ) : (
            <p className="text-center text-muted-foreground py-10">Failed to load invoice</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Send Invoice Dialog ─────────────────────────────────────────────────────
function SendInvoiceDialog({ invoice, companyId, open, onOpenChange }: {
  invoice: Invoice | null;
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [sendEmail, setSendEmail] = useState(true);
  const [customMessage, setCustomMessage] = useState("");

  const sendMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/invoices/${invoice?.id}/send`, data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/invoices?companyId=${companyId}`] });
      const emailNote = data?.emailSent ? " Email sent to customer." : sendEmail ? " (Email could not be sent — check SMTP settings.)" : "";
      toast({ title: `Invoice marked as sent.${emailNote}` });
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!invoice) return null;
  const payLink = `${window.location.origin}/pay/${invoice.id}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-teal-600" /> Send Invoice #{invoice.invoiceNumber}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 rounded-lg p-3">
            <p className="text-sm font-medium text-teal-800 dark:text-teal-200">Payment Link</p>
            <p className="text-xs text-teal-600 dark:text-teal-400 break-all mt-1">{payLink}</p>
            <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={() => {
              navigator.clipboard.writeText(payLink);
              toast({ title: "Payment link copied!" });
            }}>
              <Link2 className="h-3 w-3 mr-1" /> Copy Link
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Email Customer</p>
              <p className="text-xs text-muted-foreground">Send the invoice + pay link by email</p>
            </div>
            <Switch checked={sendEmail} onCheckedChange={setSendEmail} data-testid="switch-send-email-invoice" />
          </div>

          {sendEmail && (
            <div>
              <Label htmlFor="custom-message" className="text-sm">Custom Message (optional)</Label>
              <Textarea
                id="custom-message"
                placeholder="Add a personal note to your customer…"
                value={customMessage}
                onChange={e => setCustomMessage(e.target.value)}
                className="mt-1 h-24 text-sm"
                data-testid="textarea-custom-message"
              />
            </div>
          )}

          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-start gap-2">
            <Info className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Sending will mark this invoice as <strong>Sent</strong> and it will be visible to your customer at the payment link above. Email requires SMTP to be configured in Settings.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => sendMutation.mutate({ sendEmail, customMessage: customMessage || undefined })}
            disabled={sendMutation.isPending}
            className="bg-teal-600 hover:bg-teal-700 text-white"
            data-testid="button-confirm-send-invoice"
          >
            {sendMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending…</> : <><Send className="h-4 w-4 mr-2" />Send Invoice</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Status config ──────────────────────────────────────────────────────────
const statusConfig: Record<string, { icon: any; color: string }> = {
  draft: { icon: FileText, color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  sent: { icon: Send, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  viewed: { icon: Eye, color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  paid: { icon: CheckCircle, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  partially_paid: { icon: Clock, color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  overdue: { icon: AlertCircle, color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  cancelled: { icon: XCircle, color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500" },
};

export default function InvoicesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const search_params = useSearch();
  const [, setLocation] = useLocation();
  const urlTab = new URLSearchParams(search_params).get("tab") || "invoices";
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InvoiceWithItems | undefined>();
  const [activeTab, setActiveTab] = useState(urlTab);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [adminCompanyId, setAdminCompanyId] = useState<string>("");
  const [previewInvoiceId, setPreviewInvoiceId] = useState<string | null>(null);
  const [sendInvoice, setSendInvoice] = useState<Invoice | null>(null);

  // Keep tab in sync with URL when the user navigates via the sidebar
  useEffect(() => {
    setActiveTab(urlTab);
  }, [urlTab]);

  const userCompanyId = user?.companyId;
  const isAdminWithoutCompany = user?.role === "admin" && !userCompanyId;

  // For admins without an assigned company, fetch all companies and let them pick
  const { data: allCompanies = [] } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
    enabled: isAdminWithoutCompany,
  });

  // Effective company ID for queries — user's own, or admin's selected company
  const companyId = userCompanyId || adminCompanyId || allCompanies[0]?.id || "";

  // Auto-select first company for admin
  useEffect(() => {
    if (isAdminWithoutCompany && allCompanies.length > 0 && !adminCompanyId) {
      setAdminCompanyId(allCompanies[0].id);
    }
  }, [isAdminWithoutCompany, allCompanies, adminCompanyId]);

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: [`/api/invoices?companyId=${companyId}`],
    enabled: !!companyId,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: [`/api/customers?companyId=${companyId}`],
    enabled: !!companyId,
  });

  const invalidateInvoices = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/invoices?companyId=${companyId}`] });
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/invoices", data),
    onSuccess: () => {
      invalidateInvoices();
      toast({ title: "Invoice created" });
      setDialogOpen(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/invoices/${id}`, data),
    onSuccess: () => {
      invalidateInvoices();
      toast({ title: "Invoice updated" });
      setDialogOpen(false);
      setEditing(undefined);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/invoices/${id}`),
    onSuccess: () => {
      invalidateInvoices();
      toast({ title: "Invoice deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleEdit = async (invoice: Invoice) => {
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, { credentials: "include" });
      const full = await res.json();
      setEditing(full);
      setDialogOpen(true);
    } catch {
      setEditing(invoice);
      setDialogOpen(true);
    }
  };

  const handleDuplicate = async (invoice: Invoice) => {
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, { credentials: "include" });
      const full = await res.json();
      setEditing({
        ...full,
        id: undefined as any,
        invoiceNumber: `INV-${Date.now().toString(36).toUpperCase()}`,
        status: "draft",
        amountPaid: "0",
      });
      setDialogOpen(true);
    } catch {
      toast({ title: "Error duplicating", variant: "destructive" });
    }
  };

  const filtered = invoices.filter(inv => {
    const matchesSearch = !search ||
      inv.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
      (inv.customerId && customers.find(c => c.id === inv.customerId)?.customerName.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = statusFilter === "all" || inv.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const customerMap = Object.fromEntries(customers.map(c => [c.id, c]));

  const stats = {
    total: invoices.length,
    outstanding: invoices.filter(i => ["sent", "viewed", "overdue"].includes(i.status)).reduce((s, i) => s + parseFloat(i.totalAmount || "0"), 0),
    paid: invoices.filter(i => i.status === "paid").reduce((s, i) => s + parseFloat(i.totalAmount || "0"), 0),
    overdue: invoices.filter(i => i.status === "overdue").length,
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Invoicing</h1>
          <p className="text-muted-foreground">Create and manage invoices with multiple payment methods</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdminWithoutCompany && allCompanies.length > 0 && (
            <Select value={adminCompanyId} onValueChange={setAdminCompanyId}>
              <SelectTrigger className="w-[200px]" data-testid="select-admin-company">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {allCompanies.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button onClick={() => { setEditing(undefined); setDialogOpen(true); }} data-testid="button-create-invoice" className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-2" /> New Invoice
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Total Invoices</div>
          <div className="text-2xl font-bold mt-1" data-testid="text-total-invoices">{stats.total}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Outstanding</div>
          <div className="text-2xl font-bold mt-1 text-amber-600" data-testid="text-outstanding">${stats.outstanding.toFixed(2)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Paid</div>
          <div className="text-2xl font-bold mt-1 text-emerald-600" data-testid="text-paid">${stats.paid.toFixed(2)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Overdue</div>
          <div className="text-2xl font-bold mt-1 text-red-600" data-testid="text-overdue">{stats.overdue}</div>
        </CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={tab => { setActiveTab(tab); setLocation(`/app/invoices?tab=${tab}`); }}>
        <TabsList>
          <TabsTrigger value="invoices" data-testid="tab-invoices">Invoices</TabsTrigger>
          <TabsTrigger value="recurring" data-testid="tab-recurring">Recurring</TabsTrigger>
          <TabsTrigger value="payments" data-testid="tab-payments">Payments</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-payment-settings">
            <Settings className="h-4 w-4 mr-1" /> Payment Methods
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search invoices..." value={search} onChange={e => setSearch(e.target.value)}
                className="pl-10" data-testid="input-search-invoices" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-40" data-testid="select-invoice-filter">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="option-filter-all">All</SelectItem>
                <SelectItem value="draft" data-testid="option-filter-draft">Draft</SelectItem>
                <SelectItem value="sent" data-testid="option-filter-sent">Sent</SelectItem>
                <SelectItem value="paid" data-testid="option-filter-paid">Paid</SelectItem>
                <SelectItem value="overdue" data-testid="option-filter-overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">No invoices found</p>
                <Button variant="outline" className="mt-4" onClick={() => { setEditing(undefined); setDialogOpen(true); }}
                  data-testid="button-create-first-invoice">
                  <Plus className="h-4 w-4 mr-2" /> Create your first invoice
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filtered.map(invoice => {
                const sc = statusConfig[invoice.status] || statusConfig.draft;
                const StatusIcon = sc.icon;
                const customer = customerMap[invoice.customerId || ""];
                const canRecordPayment = invoice.status !== "paid" && invoice.status !== "cancelled";
                return (
                  <Card key={invoice.id} className="hover:shadow-md transition-shadow" data-testid={`card-invoice-${invoice.id}`}>
                    <CardContent className="p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-teal-500 to-blue-500 flex items-center justify-center text-white shrink-0">
                            <FileText className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold" data-testid={`text-invoice-number-${invoice.id}`}>{invoice.invoiceNumber}</span>
                              <Badge className={sc.color}>
                                <StatusIcon className="h-3 w-3 mr-1" />
                                {invoice.status}
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground flex items-center gap-3 mt-1 flex-wrap">
                              {customer && <span>{customer.customerName}</span>}
                              {invoice.dueDate && (
                                <span className="flex items-center gap-1">
                                  <CalendarDays className="h-3 w-3" /> Due {new Date(invoice.dueDate).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 justify-between sm:justify-end">
                          <div className="text-left sm:text-right">
                            <div className="font-bold text-lg" data-testid={`text-invoice-total-${invoice.id}`}>${parseFloat(invoice.totalAmount || "0").toFixed(2)}</div>
                            {parseFloat(invoice.amountPaid || "0") > 0 && parseFloat(invoice.amountPaid || "0") < parseFloat(invoice.totalAmount || "0") && (
                              <div className="text-xs text-muted-foreground">Paid: ${parseFloat(invoice.amountPaid || "0").toFixed(2)}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {canRecordPayment && (
                              <Button variant="outline" size="sm" onClick={() => setPaymentInvoice(invoice)}
                                className="text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:border-emerald-800 dark:hover:bg-emerald-950"
                                data-testid={`button-record-payment-${invoice.id}`}>
                                <DollarSign className="h-4 w-4 mr-1" /> Pay
                              </Button>
                            )}
                            {invoice.status === "draft" && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="outline" size="sm"
                                    className="text-teal-600 border-teal-200 hover:bg-teal-50 dark:border-teal-800 dark:hover:bg-teal-950"
                                    onClick={() => setSendInvoice(invoice)}
                                    data-testid={`button-send-invoice-${invoice.id}`}>
                                    <Send className="h-4 w-4 mr-1" /> Send
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Send Invoice to Customer</TooltipContent>
                              </Tooltip>
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" onClick={() => setPreviewInvoiceId(invoice.id)}
                                  data-testid={`button-preview-invoice-${invoice.id}`}>
                                  <Eye className="h-4 w-4 text-blue-500" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Preview Invoice</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" onClick={() => {
                                  const payUrl = `${window.location.origin}/pay/${invoice.id}`;
                                  navigator.clipboard.writeText(payUrl);
                                  toast({ title: "Payment Link Copied", description: "Share this link with your customer to collect payment" });
                                }} data-testid={`button-copy-pay-link-${invoice.id}`}>
                                  <Link2 className="h-4 w-4 text-teal-600" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Copy Payment Link</TooltipContent>
                            </Tooltip>
                            <Button variant="ghost" size="sm" onClick={() => handleEdit(invoice)} data-testid={`button-edit-invoice-${invoice.id}`}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDuplicate(invoice)} data-testid={`button-duplicate-${invoice.id}`}>
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => {
                              if (confirm("Delete this invoice?")) deleteMutation.mutate(invoice.id);
                            }} data-testid={`button-delete-invoice-${invoice.id}`}>
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="recurring">
          <RecurringBillingTab companyId={companyId} customers={customers || []} />
        </TabsContent>

        <TabsContent value="payments">
          <PaymentsTab companyId={companyId || ""} />
        </TabsContent>

        <TabsContent value="settings">
          <PaymentMethodSettings companyId={companyId || ""} />
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit Invoice" : "New Invoice"}</DialogTitle>
          </DialogHeader>
          <InvoiceForm
            invoice={editing}
            customers={customers}
            companyId={companyId || ""}
            companies={isAdminWithoutCompany ? allCompanies : []}
            onSave={data => {
              if (editing?.id) {
                updateMutation.mutate({ id: editing.id, data });
              } else {
                createMutation.mutate(data);
              }
            }}
            onCancel={() => { setDialogOpen(false); setEditing(undefined); }}
          />
        </DialogContent>
      </Dialog>

      {paymentInvoice && (
        <RecordPaymentDialog
          invoice={paymentInvoice}
          companyId={companyId || ""}
          open={!!paymentInvoice}
          onOpenChange={open => { if (!open) setPaymentInvoice(null); }}
        />
      )}

      {previewInvoiceId && (
        <InvoicePreviewDialog
          invoiceId={previewInvoiceId}
          companyId={companyId || ""}
          open={!!previewInvoiceId}
          onOpenChange={open => { if (!open) setPreviewInvoiceId(null); }}
          onSend={() => {
            const inv = invoices.find(i => i.id === previewInvoiceId);
            if (inv) setSendInvoice(inv);
          }}
        />
      )}

      <SendInvoiceDialog
        invoice={sendInvoice}
        companyId={companyId || ""}
        open={!!sendInvoice}
        onOpenChange={open => { if (!open) setSendInvoice(null); }}
      />
    </div>
  );
}

function PaymentsTab({ companyId }: { companyId: string }) {
  const { data: payments = [], isLoading } = useQuery<any[]>({
    queryKey: [`/api/payments?companyId=${companyId}`],
    enabled: !!companyId,
  });

  const methodLabels: Record<string, string> = {
    ach: "ACH Bank Transfer",
    card: "Credit/Debit Card",
    instant_bank: "Instant Bank",
    wire: "Wire Transfer",
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  if (payments.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <DollarSign className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-lg font-medium">No Payments Yet</p>
          <p className="text-muted-foreground mt-1">Payments will appear here when invoices are paid</p>
        </CardContent>
      </Card>
    );
  }

  const totalFeeRevenue = payments
    .filter((p: any) => p.status === "completed")
    .reduce((sum: number, p: any) => sum + parseFloat(p.feeAmount || p.paymentFeeCharged || "0"), 0);

  return (
    <div className="space-y-4">
      {totalFeeRevenue > 0 && (
        <Card className="border-teal-200 dark:border-teal-800">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-teal-500" />
              <span className="text-sm font-medium">Fee Revenue Collected</span>
            </div>
            <span className="text-lg font-bold text-teal-600" data-testid="text-fee-revenue">${totalFeeRevenue.toFixed(2)}</span>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {payments.map((p: any) => {
          const Icon = methodIcons[p.paymentMethod] || DollarSign;
          const feeAmt = parseFloat(p.feeAmount || p.paymentFeeCharged || "0");
          return (
            <Card key={p.id} data-testid={`card-payment-${p.id}`}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-teal-500 to-blue-500 flex items-center justify-center text-white">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-medium">${parseFloat(p.amount).toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <span>{methodLabels[p.paymentMethod] || p.paymentMethod}</span>
                      <span>-</span>
                      <span>{new Date(p.createdAt).toLocaleDateString()}</span>
                      {feeAmt > 0 && (
                        <>
                          <span>-</span>
                          <span className="text-amber-600">Fee: ${feeAmt.toFixed(2)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <Badge className={p.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-700"}>
                  {p.status}
                </Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
