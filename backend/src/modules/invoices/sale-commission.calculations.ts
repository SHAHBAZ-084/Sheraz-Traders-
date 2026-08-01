export const DHARAN_KG = 5;
export const MAUND_KG = 40;

export type SaleCommissionPreferenceRates = {
  daamiPercent: number;
  commissionPercent: number;
  dalaliPercent: number;
  sutliRate: number;
  mazduriPerBagRate: number;
  marketFeeRate: number;
};

export type SaleCommissionRowInput = {
  bagCount: number;
  bhartii: number;
  dharanCount: number;
  looseKg: number;
  ratePerMaund: number;
  bardanaQty?: number | null;
  bardanaRate?: number | null;
  dammiChecked?: boolean;
};

export type SaleCommissionRowComputed = {
  totalWeightKg: number;
  maunds: number;
  amount: number;
  bardanaAmount: number | null;
  dammiAmount: number;
  netCreditToParty: number;
};

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function computeSaleCommissionRow(
  input: SaleCommissionRowInput,
  prefs: Pick<SaleCommissionPreferenceRates, 'daamiPercent'>,
): SaleCommissionRowComputed {
  const totalWeightKg =
    input.bagCount * input.bhartii + input.dharanCount * DHARAN_KG + input.looseKg;
  const maunds = totalWeightKg / MAUND_KG;
  const amount = roundMoney(maunds * input.ratePerMaund);

  const hasBardana =
    input.bardanaQty != null
    && input.bardanaRate != null
    && input.bardanaQty > 0
    && input.bardanaRate > 0;
  const bardanaAmount = hasBardana
    ? roundMoney(input.bardanaQty! * input.bardanaRate!)
    : null;

  const dammiAmount = input.dammiChecked
    ? roundMoney(amount * (prefs.daamiPercent / 100))
    : 0;
  // Goods + dammi + row bardana owed to the purchase party (bardana posts separately to Bardana A/c)
  const netCreditToParty = roundMoney(amount + dammiAmount + (bardanaAmount ?? 0));

  return { totalWeightKg, maunds, amount, bardanaAmount, dammiAmount, netCreditToParty };
}

export function computeSettlementBardanaAmount(
  totalBagCount: number,
  qty?: number | null,
  rate?: number | null,
) {
  if (rate == null || !(rate > 0)) return null;
  const bags = qty != null && qty > 0 ? qty : totalBagCount;
  if (!(bags > 0)) return null;
  return roundMoney(bags * rate);
}

export type SaleCommissionInvoiceTotals = {
  totalGoodsAmount: number;
  totalDammiAmount: number;
  postDammiTotal: number;
  totalBagCount: number;
  commissionAmount: number;
  dalaliAmount: number;
  sutliAmount: number;
  mazduriAmount: number;
  marketFeeAmount: number;
  munshianaAmount: number;
  miscAmount: number;
  settlementBardanaAmount: number | null;
  netSalePartyDebit: number;
};

export function computeSaleCommissionInvoiceTotals(
  rows: Array<{ amount: number; dammiAmount: number; bagCount: number }>,
  prefs: SaleCommissionPreferenceRates,
  options: {
    munshianaAmount?: number;
    miscAmount?: number;
    lowerBardanaQty?: number | null;
    lowerBardanaRate?: number | null;
  },
): SaleCommissionInvoiceTotals {
  let totalGoodsAmount = 0;
  let totalDammiAmount = 0;
  let totalBagCount = 0;

  for (const row of rows) {
    totalGoodsAmount += row.amount;
    totalDammiAmount += row.dammiAmount;
    totalBagCount += row.bagCount;
  }

  totalGoodsAmount = roundMoney(totalGoodsAmount);
  totalDammiAmount = roundMoney(totalDammiAmount);
  totalBagCount = roundMoney(totalBagCount);
  const postDammiTotal = roundMoney(totalGoodsAmount + totalDammiAmount);

  const commissionAmount = roundMoney(postDammiTotal * (prefs.commissionPercent / 100));
  const dalaliAmount = roundMoney(totalGoodsAmount * (prefs.dalaliPercent / 100));
  const sutliAmount = roundMoney(totalBagCount * prefs.sutliRate);
  const mazduriAmount = roundMoney(totalBagCount * prefs.mazduriPerBagRate);
  const marketFeeAmount = roundMoney(totalBagCount * prefs.marketFeeRate);
  const munshianaAmount = roundMoney(options.munshianaAmount ?? 0);
  const miscAmount = roundMoney(options.miscAmount ?? 0);
  const settlementBardanaAmount = computeSettlementBardanaAmount(
    totalBagCount,
    options.lowerBardanaQty,
    options.lowerBardanaRate,
  );

  const netSalePartyDebit = roundMoney(
    postDammiTotal
      + commissionAmount
      + dalaliAmount
      + sutliAmount
      + mazduriAmount
      + marketFeeAmount
      + munshianaAmount
      + miscAmount
      + (settlementBardanaAmount ?? 0),
  );

  return {
    totalGoodsAmount,
    totalDammiAmount,
    postDammiTotal,
    totalBagCount,
    commissionAmount,
    dalaliAmount,
    sutliAmount,
    mazduriAmount,
    marketFeeAmount,
    munshianaAmount,
    miscAmount,
    settlementBardanaAmount,
    netSalePartyDebit,
  };
}
