import { getUncachableStripeClient } from "./stripeClient.js";
import type { Company, Worker, PayMethod } from "../shared/schema.js";

export interface TreasuryBalance {
  cash: number;
  inboundPending: number;
  outboundPending: number;
}

export interface TreasuryFinancialAccount {
  id: string;
  status: string;
  routingNumber: string | null;
  accountNumber: string | null;
  features: Record<string, string>;
  balance: TreasuryBalance | null;
}

export interface OutboundPaymentResult {
  stripeOutboundPaymentId: string;
  status: string;
  amount: number;
  currency: string;
}

function centsFromDollarString(dollarString: string): number {
  return Math.round(parseFloat(dollarString || "0") * 100);
}

export async function getOrCreateFinancialAccount(
  company: Pick<Company, "id" | "name" | "stripeFinancialAccountId">
): Promise<TreasuryFinancialAccount> {
  const stripe = await getUncachableStripeClient();

  if (company.stripeFinancialAccountId) {
    try {
      const fa = await (stripe.treasury as any).financialAccounts.retrieve(
        company.stripeFinancialAccountId,
        { expand: ["balance", "financial_addresses"] }
      );
      return mapFinancialAccount(fa);
    } catch (e: any) {
      if (e.code !== "resource_missing") throw e;
    }
  }

  const fa = await (stripe.treasury as any).financialAccounts.create({
    supported_currencies: ["usd"],
    features: {
      inbound_transfers: { ach: { requested: true } },
      outbound_transfers: { ach: { requested: true } },
      outbound_payments: { ach: { requested: true } },
      financial_addresses: { aba: { requested: true } },
    },
    metadata: {
      companyId: company.id,
      companyName: company.name || "",
    },
  }, { expand: ["balance", "financial_addresses"] });

  return mapFinancialAccount(fa);
}

export async function getFinancialAccount(
  financialAccountId: string
): Promise<TreasuryFinancialAccount> {
  const stripe = await getUncachableStripeClient();
  const fa = await (stripe.treasury as any).financialAccounts.retrieve(
    financialAccountId,
    { expand: ["balance", "financial_addresses"] }
  );
  return mapFinancialAccount(fa);
}

function mapFinancialAccount(fa: any): TreasuryFinancialAccount {
  const addr = fa.financial_addresses?.[0];
  const aba = addr?.aba;

  const featureMap: Record<string, string> = {};
  if (fa.features) {
    const featureKeys = ["inbound_transfers", "outbound_transfers", "outbound_payments", "financial_addresses"];
    for (const key of featureKeys) {
      const feature = fa.features[key];
      if (feature) {
        if (feature.ach) featureMap[`${key}.ach`] = feature.ach.status || "unknown";
        if (feature.aba) featureMap[`${key}.aba`] = feature.aba.status || "unknown";
      }
    }
  }

  let balance: TreasuryBalance | null = null;
  if (fa.balance) {
    balance = {
      cash: (fa.balance.cash?.usd ?? 0) / 100,
      inboundPending: (fa.balance.inbound_pending?.usd ?? 0) / 100,
      outboundPending: (fa.balance.outbound_pending?.usd ?? 0) / 100,
    };
  }

  return {
    id: fa.id,
    status: fa.status,
    routingNumber: aba?.routing_number ?? null,
    accountNumber: aba?.account_number ?? null,
    features: featureMap,
    balance,
  };
}

export async function createOutboundPayment(opts: {
  financialAccountId: string;
  routingNumber: string;
  accountNumber: string;
  accountType: "checking" | "savings";
  recipientName: string;
  amountCents: number;
  memo?: string;
  idempotencyKey?: string;
}): Promise<OutboundPaymentResult> {
  const stripe = await getUncachableStripeClient();

  const params: any = {
    financial_account: opts.financialAccountId,
    amount: opts.amountCents,
    currency: "usd",
    statement_descriptor: opts.memo ? opts.memo.substring(0, 22) : "PAYROLL",
    destination_payment_method_data: {
      type: "us_bank_account",
      us_bank_account: {
        routing_number: opts.routingNumber,
        account_number: opts.accountNumber,
        account_holder_type: "individual",
        account_type: opts.accountType,
      },
      billing_details: {
        name: opts.recipientName,
      },
    },
  };

  const requestOpts: any = {};
  if (opts.idempotencyKey) {
    requestOpts.idempotencyKey = opts.idempotencyKey;
  }

  const payment = await (stripe.treasury as any).outboundPayments.create(params, requestOpts);

  return {
    stripeOutboundPaymentId: payment.id,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
  };
}

export async function listOutboundPayments(
  financialAccountId: string,
  limit = 100
): Promise<any[]> {
  const stripe = await getUncachableStripeClient();
  const list = await (stripe.treasury as any).outboundPayments.list({
    financial_account: financialAccountId,
    limit,
  });
  return list.data;
}

export async function cancelOutboundPayment(
  outboundPaymentId: string
): Promise<any> {
  const stripe = await getUncachableStripeClient();
  return (stripe.treasury as any).outboundPayments.cancel(outboundPaymentId);
}

export function validatePayrollReadiness(
  workers: Array<{ worker: Worker; payMethod: PayMethod | undefined; netPay: number }>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const { worker, payMethod, netPay } of workers) {
    const name = `${worker.firstName} ${worker.lastName}`;

    if (netPay <= 0) {
      errors.push(`${name}: net pay must be greater than $0`);
      continue;
    }

    if (!payMethod) {
      errors.push(`${name}: no pay method on file`);
      continue;
    }

    if (payMethod.methodType === "direct_deposit") {
      if (!payMethod.routingNumber || payMethod.routingNumber.startsWith("*")) {
        errors.push(`${name}: routing number missing or masked (admin must re-enter)`);
      }
      if (!payMethod.accountNumber || payMethod.accountNumber.startsWith("*")) {
        errors.push(`${name}: account number missing or masked (admin must re-enter)`);
      }
    } else {
      errors.push(`${name}: pay method is not direct deposit (${payMethod.methodType})`);
    }
  }

  return { valid: errors.length === 0, errors };
}
