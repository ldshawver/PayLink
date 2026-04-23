import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Landmark,
  CreditCard,
  Check,
  Clock,
  AlertCircle,
  Loader2,
  Shield,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Info,
  Printer,
} from "lucide-react";
import { InvoicePreview } from "@/components/invoice-preview";

interface InvoiceLineItem {
  id?: string;
  description: string;
  quantity?: string;
  unitPrice?: string;
  amount?: string;
}

interface InvoiceData {
  id: string;
  invoiceNumber: string;
  status: string;
  issueDate?: string;
  dueDate?: string;
  subtotal?: string;
  taxRate?: string;
  taxAmount?: string;
  totalAmount: string;
  amountPaid?: string;
  amountDue?: string;
  notes?: string;
  paymentTerms?: string;
  templateStyle?: string;
  companyName: string;
  companyAddress?: string;
  companyCity?: string;
  companyState?: string;
  companyZip?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyLogoUrl?: string;
  customerName?: string;
  customerEmail?: string;
  customerAddress?: string;
  customerCity?: string;
  customerState?: string;
  customerZip?: string;
  customerPhone?: string;
  lineItems?: InvoiceLineItem[];
}

interface PayMethodOption {
  methodType: string;
  displayName: string;
  description: string;
  feeType: string;
  feePercent: string;
  feeFlat: string;
  feeCap: string | null;
  processingTime: string;
  isRecommended: boolean;
  feePassedToCustomer: boolean;
}

function calculateFee(method: PayMethodOption, amount: number): number {
  if (!method.feePassedToCustomer) return 0;
  let fee = 0;
  if (method.feeType === "percentage") {
    fee = amount * (parseFloat(method.feePercent || "0") / 100);
  } else if (method.feeType === "flat") {
    fee = parseFloat(method.feeFlat || "0");
  } else if (method.feeType === "both") {
    fee = amount * (parseFloat(method.feePercent || "0") / 100) + parseFloat(method.feeFlat || "0");
  }
  if (method.feeCap && fee > parseFloat(method.feeCap)) {
    fee = parseFloat(method.feeCap);
  }
  return Math.round(fee * 100) / 100;
}

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function StripePaymentForm({ clientSecret, invoiceId, paymentMethodType, onSuccess, onError }: {
  clientSecret: string;
  invoiceId: string;
  paymentMethodType: string;
  onSuccess: (status: string) => void;
  onError: (msg: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: "if_required",
      });

      if (error) {
        onError(error.message || "Payment failed");
        setProcessing(false);
        return;
      }

      if (paymentIntent) {
        const confirmRes = await fetch(`/api/pay/${invoiceId}/confirm-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentIntentId: paymentIntent.id, paymentMethodType }),
        });
        const confirmData = await confirmRes.json();
        onSuccess(confirmData.status || paymentIntent.status);
      }
    } catch (err: any) {
      onError(err.message || "Payment processing error");
    }
    setProcessing(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="stripe-payment-form">
      <PaymentElement options={{ layout: "tabs" }} />

      {paymentMethodType === "ach" && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-blue-700 dark:text-blue-300">
            <p className="font-medium">ACH Bank Payment</p>
            <p>Bank payments take 2-4 business days to process. By proceeding, you authorize this payment from your bank account.</p>
          </div>
        </div>
      )}

      <Button
        type="submit"
        disabled={!stripe || !elements || processing}
        className="w-full bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white"
        data-testid="button-confirm-payment"
      >
        {processing ? (
          <><Loader2 className="h-4 w-4 animate-spin mr-2" />Processing...</>
        ) : (
          <><Shield className="h-4 w-4 mr-2" />Confirm Payment</>
        )}
      </Button>

      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Shield className="h-3 w-3" />
        <span>Secured by Stripe. Your payment details are never stored on our servers.</span>
      </div>
    </form>
  );
}

function PaymentSuccess({ status, paymentMethodType }: { status: string; paymentMethodType: string }) {
  const isProcessing = status === "processing" || (paymentMethodType === "ach" && status !== "succeeded");
  return (
    <div className="text-center py-8" data-testid="payment-success">
      {isProcessing ? (
        <>
          <div className="w-16 h-16 mx-auto mb-4 bg-yellow-100 dark:bg-yellow-950/30 rounded-full flex items-center justify-center">
            <Clock className="h-8 w-8 text-yellow-600" />
          </div>
          <h2 className="text-xl font-bold mb-2">Payment Processing</h2>
          <p className="text-muted-foreground mb-4">Your bank payment has been submitted and is being processed.</p>
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
            <Clock className="h-3 w-3 mr-1" />2-4 business days
          </Badge>
          <p className="text-xs text-muted-foreground mt-4">You'll receive a confirmation once the payment clears.</p>
        </>
      ) : (
        <>
          <div className="w-16 h-16 mx-auto mb-4 bg-green-100 dark:bg-green-950/30 rounded-full flex items-center justify-center">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold mb-2">Payment Successful</h2>
          <p className="text-muted-foreground">Your payment has been processed successfully. Thank you!</p>
        </>
      )}
    </div>
  );
}

function PrintButton({ invoice }: { invoice: InvoiceData }) {
  const handlePrint = () => {
    const root = document.getElementById("invoice-preview-root");
    if (!root) return;
    const html = root.outerHTML;
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice #${invoice.invoiceNumber}</title>
<style>body{margin:0;padding:20px;background:#f5f5f5;font-family:Arial,sans-serif}
@page{size:A4;margin:12mm}@media print{body{background:white;padding:0}}</style>
</head><body>${html}<script>window.onload=()=>{window.print();window.close();}<\/script></body></html>`);
    win.document.close();
  };

  return (
    <Button variant="outline" size="sm" onClick={handlePrint} className="flex items-center gap-1 text-xs" data-testid="button-print-invoice-public">
      <Printer className="h-3.5 w-3.5" /> Print / Save PDF
    </Button>
  );
}

export default function PayInvoicePage() {
  const [location] = useLocation();
  const invoiceId = location.split("/pay/")[1]?.split("/")[0] || "";

  const [loading, setLoading] = useState(true);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PayMethodOption[]>([]);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerName, setCustomerName] = useState("");

  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [creatingIntent, setCreatingIntent] = useState(false);

  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const [showPayForm, setShowPayForm] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [invoiceRes, keyRes] = await Promise.all([
          fetch(`/api/pay/${invoiceId}`),
          fetch("/api/stripe/publishable-key"),
        ]);

        if (!invoiceRes.ok) {
          const errData = await invoiceRes.json();
          setError(errData.message || "Invoice not found");
          setLoading(false);
          return;
        }

        const invoiceData = await invoiceRes.json();
        if (invoiceData.alreadyPaid) {
          setAlreadyPaid(true);
          setInvoice(invoiceData.invoice || null);
          setLoading(false);
          return;
        }

        setInvoice(invoiceData.invoice);
        setPaymentMethods(invoiceData.paymentMethods || []);
        setCustomerEmail(invoiceData.invoice.customerEmail || "");
        setCustomerName(invoiceData.invoice.customerName || "");

        if (keyRes.ok) {
          const keyData = await keyRes.json();
          setStripePromise(loadStripe(keyData.publishableKey));
        }

        setLoading(false);
      } catch (err: any) {
        setError(err.message || "Failed to load invoice");
        setLoading(false);
      }
    })();
  }, [invoiceId]);

  const handleCreatePaymentIntent = async () => {
    if (!selectedMethod || !customerEmail) return;
    setCreatingIntent(true);
    setPaymentError(null);
    try {
      const res = await fetch(`/api/pay/${invoiceId}/create-payment-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethodType: selectedMethod, customerEmail, customerName }),
      });
      if (!res.ok) {
        const errData = await res.json();
        setPaymentError(errData.message || "Failed to initiate payment");
        setCreatingIntent(false);
        return;
      }
      const data = await res.json();
      setClientSecret(data.clientSecret);
    } catch (err: any) {
      setPaymentError(err.message || "Failed to create payment");
    }
    setCreatingIntent(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-6 text-center">
            <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-bold mb-2">Error</h2>
            <p className="text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (alreadyPaid) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 py-8 px-4">
        <div className="max-w-2xl mx-auto space-y-4">
          <Card>
            <CardContent className="pt-6 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <h2 className="text-lg font-bold mb-2">Invoice Paid</h2>
              <p className="text-muted-foreground">This invoice has been paid. Thank you!</p>
            </CardContent>
          </Card>
          {invoice && (
            <div>
              <div className="flex justify-end mb-2">
                <PrintButton invoice={invoice} />
              </div>
              <InvoicePreview invoice={invoice} />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!invoice) return null;

  const amount = parseFloat(invoice.totalAmount);
  const selectedConfig = paymentMethods.find((m) => m.methodType === selectedMethod);
  const fee = selectedConfig ? calculateFee(selectedConfig, amount) : 0;
  const total = amount + fee;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 py-6 sm:py-8 px-3 sm:px-4">
      <div className="max-w-2xl mx-auto space-y-4">

        {/* Invoice Document */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Invoice</p>
            <PrintButton invoice={invoice} />
          </div>
          <InvoicePreview invoice={invoice} />
        </div>

        {/* Payment Section */}
        {paymentStatus ? (
          <Card>
            <CardContent className="pt-6">
              <PaymentSuccess status={paymentStatus} paymentMethodType={selectedMethod || "card"} />
            </CardContent>
          </Card>
        ) : paymentMethods.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground text-sm">
              Online payment is not available for this invoice. Please contact {invoice.companyName} directly.
            </CardContent>
          </Card>
        ) : (
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">Payment</p>
            {!clientSecret ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Choose Payment Method</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    {paymentMethods.map((method) => {
                      const methodFee = calculateFee(method, amount);
                      const methodTotal = amount + methodFee;
                      const isSelected = selectedMethod === method.methodType;
                      const Icon = method.methodType === "ach" ? Landmark : CreditCard;

                      return (
                        <button
                          key={method.methodType}
                          onClick={() => setSelectedMethod(method.methodType)}
                          className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                            isSelected
                              ? "border-teal-500 bg-teal-500/5"
                              : "border-border hover:border-teal-500/50 hover:bg-accent/50"
                          }`}
                          data-testid={`method-${method.methodType}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                isSelected ? "bg-teal-500 text-white" : "bg-muted text-muted-foreground"
                              }`}>
                                <Icon className="h-5 w-5" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{method.displayName}</span>
                                  {method.isRecommended && (
                                    <Badge variant="secondary" className="text-[10px] py-0 px-1.5 bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                                      Recommended
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs text-muted-foreground">
                                    <Clock className="h-3 w-3 inline mr-1" />
                                    {method.processingTime || "Instant"}
                                  </span>
                                  {methodFee > 0 && <span className="text-xs text-orange-600">+{fmt(methodFee)} fee</span>}
                                  {methodFee === 0 && <span className="text-xs text-green-600">No fee</span>}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold">{fmt(methodTotal)}</p>
                              {isSelected && <Check className="h-4 w-4 text-teal-500 ml-auto mt-1" />}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {selectedMethod && (
                    <>
                      <div className="border-t pt-4 space-y-3">
                        <div>
                          <Label htmlFor="payerEmail">Email <span className="text-red-500">*</span></Label>
                          <Input
                            id="payerEmail"
                            type="email"
                            value={customerEmail}
                            onChange={(e) => setCustomerEmail(e.target.value)}
                            placeholder="your@email.com"
                            data-testid="input-payer-email"
                          />
                        </div>
                        <div>
                          <Label htmlFor="payerName">Name</Label>
                          <Input
                            id="payerName"
                            value={customerName}
                            onChange={(e) => setCustomerName(e.target.value)}
                            placeholder="Your name"
                            data-testid="input-payer-name"
                          />
                        </div>
                      </div>

                      {fee > 0 && (
                        <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                          <div className="flex justify-between text-sm"><span>Invoice Amount</span><span>{fmt(amount)}</span></div>
                          <div className="flex justify-between text-sm text-orange-600"><span>Processing Fee</span><span>+{fmt(fee)}</span></div>
                          <div className="flex justify-between font-semibold border-t pt-1"><span>Total</span><span>{fmt(total)}</span></div>
                        </div>
                      )}

                      {selectedMethod === "ach" && (
                        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                            Bank payments take 2-4 business days to process. Your invoice will show as "processing" until the transfer completes.
                          </p>
                        </div>
                      )}

                      {paymentError && (
                        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
                          <XCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-red-700 dark:text-red-300">{paymentError}</p>
                        </div>
                      )}

                      <Button
                        onClick={handleCreatePaymentIntent}
                        disabled={!customerEmail || creatingIntent}
                        className="w-full bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white"
                        data-testid="button-proceed-to-pay"
                      >
                        {creatingIntent ? (
                          <><Loader2 className="h-4 w-4 animate-spin mr-2" />Setting up payment...</>
                        ) : (
                          <>Proceed to Pay {fmt(total)}</>
                        )}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setClientSecret(null)} data-testid="button-back-method">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                      <CardTitle className="text-base">Complete Payment</CardTitle>
                      <CardDescription>
                        {selectedMethod === "ach" ? "Bank Account Payment" : "Card Payment"} — {fmt(total)}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {stripePromise && (
                    <Elements
                      stripe={stripePromise}
                      options={{
                        clientSecret,
                        appearance: {
                          theme: "stripe",
                          variables: { colorPrimary: "#0d9488", borderRadius: "8px" },
                        },
                      }}
                    >
                      <StripePaymentForm
                        clientSecret={clientSecret}
                        invoiceId={invoiceId!}
                        paymentMethodType={selectedMethod || "card"}
                        onSuccess={(status) => setPaymentStatus(status)}
                        onError={(msg) => setPaymentError(msg)}
                      />
                    </Elements>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground mt-6">
          Powered by PayLink &middot; Payments processed by Stripe
        </p>
      </div>
    </div>
  );
}
