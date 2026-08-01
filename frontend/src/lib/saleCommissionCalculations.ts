export {
  DHARAN_KG,
  MAUND_KG,
  PURCHASE_PARTY_CATEGORIES,
  parseNum,
  roundMoney,
} from './kachiMaalCalculations';

import { roundMoney } from './kachiMaalCalculations';

export const SALE_PARTY_CATEGORIES = ['Sale Party'] as const;

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

export function computeSaleCommissionRow(
  input: SaleCommissionRowInput,
  prefs: Pick<SaleCommissionPreferenceRates, 'daamiPercent'>,
) {
  const totalWeightKg =
    input.bagCount * input.bhartii + input.dharanCount * 5 + input.looseKg;
  const maunds = totalWeightKg / 40;
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
  const netCreditToParty = roundMoney(amount + dammiAmount + (bardanaAmount ?? 0));

  return { totalWeightKg, maunds, amount, bardanaAmount, dammiAmount, netCreditToParty };
}

function computeSettlementBardanaAmount(
  totalBagCount: number,
  qty?: number | null,
  rate?: number | null,
) {
  if (rate == null || !(rate > 0)) return null;
  const bags = qty != null && qty > 0 ? qty : totalBagCount;
  if (!(bags > 0)) return null;
  return roundMoney(bags * rate);
}

export function computeSaleCommissionInvoiceTotals(
  rows: Array<{ amount: number; dammiAmount: number; bagCount: number }>,
  prefs: SaleCommissionPreferenceRates,
  options: {
    munshianaAmount?: number;
    miscAmount?: number;
    lowerBardanaQty?: number | null;
    lowerBardanaRate?: number | null;
  },
) {
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
