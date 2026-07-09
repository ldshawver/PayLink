export type ContractorTradeCompensationInput = {
  grossCompensation: number;
  tradeCredits?: Array<{ totalValue?: number | string | null; approvedAt?: Date | string | null }>;
  otherNonCashCredits?: number;
  allowOverCredit?: boolean;
};

export type ContractorTradeSettlement = {
  totalCompensation: number;
  totalTradeCredit: number;
  otherNonCashCredits: number;
  paidByTradeGoods: number;
  paidByCheck: number;
  remainingBalance: number;
};

const money = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export function calculateContractorTradeSettlement(input: ContractorTradeCompensationInput): ContractorTradeSettlement {
  const totalCompensation = money(input.grossCompensation);
  const totalTradeCredit = money((input.tradeCredits || []).reduce((sum, credit) => sum + money(credit.totalValue), 0));
  const otherNonCashCredits = money(input.otherNonCashCredits || 0);
  const totalCredits = money(totalTradeCredit + otherNonCashCredits);

  if (!input.allowOverCredit && totalCredits > totalCompensation) {
    throw new Error("Trade credit cannot exceed gross contractor compensation without explicit over-credit approval.");
  }

  const paidByCheck = money(Math.max(totalCompensation - totalCredits, 0));
  if (paidByCheck < 0) throw new Error("Contractor check amount cannot be negative.");

  return {
    totalCompensation,
    totalTradeCredit,
    otherNonCashCredits,
    paidByTradeGoods: totalTradeCredit,
    paidByCheck,
    remainingBalance: money(totalCompensation - totalCredits - paidByCheck),
  };
}

export function assertContractorTradeCreditsPrintable(input: ContractorTradeCompensationInput): ContractorTradeSettlement {
  const unapproved = (input.tradeCredits || []).filter((credit) => money(credit.totalValue) > 0 && !credit.approvedAt);
  if (unapproved.length > 0) {
    throw new Error("Trade credit must be approved before contractor check printing.");
  }
  return calculateContractorTradeSettlement(input);
}
