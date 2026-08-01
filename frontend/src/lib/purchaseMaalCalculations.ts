export {
  DEBIT_ACCOUNT_CATEGORIES,
  DHARAN_KG,
  MAUND_KG,
  PURCHASE_PARTY_CATEGORIES,
  parseNum,
} from './kachiMaalCalculations';

import { roundMoney } from './kachiMaalCalculations';
export { roundMoney };

export type PurchaseMaalPreferenceRates = {
  daamiPercent: number;
  mazduriPercent: number;
  marketFeeRate: number;
};

export type PurchaseMaalRowInput = {
  bagCount: number;
  bhartii: number;
  dharanCount: number;
  looseKg: number;
  ratePerMaund: number;
  bardanaQty?: number | null;
  bardanaRate?: number | null;
  dammiChecked?: boolean;
};

export function computePurchaseMaalRow(
  input: PurchaseMaalRowInput,
  prefs: Pick<PurchaseMaalPreferenceRates, 'daamiPercent'>,
) {
  const totalWeightKg =
    input.bagCount * input.bhartii + input.dharanCount * 5 + input.looseKg;
  const ratePerKg = input.ratePerMaund / 40;
  const amount = roundMoney(totalWeightKg * ratePerKg);

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
  const netCreditToParty = roundMoney(amount + (bardanaAmount ?? 0) + dammiAmount);

  return { totalWeightKg, amount, bardanaAmount, dammiAmount, netCreditToParty };
}

export function computePurchaseMaalInvoiceTotals(
  rows: Array<{
    amount: number;
    totalWeightKg: number;
    bhartii: number;
    dammiAmount: number;
  }>,
  prefs: PurchaseMaalPreferenceRates,
  options: {
    marketFeeEnabled: boolean;
    mazduriEnabled: boolean;
    lowerBardanaQty?: number | null;
    lowerBardanaRate?: number | null;
  },
) {
  let totalGoodsAmount = 0;
  let totalDammiAmount = 0;
  let totalCalculatedBags = 0;

  for (const row of rows) {
    totalGoodsAmount += row.amount;
    totalDammiAmount += row.dammiAmount;
    if (row.bhartii > 0) {
      totalCalculatedBags += row.totalWeightKg / row.bhartii;
    }
  }

  totalGoodsAmount = roundMoney(totalGoodsAmount);
  totalDammiAmount = roundMoney(totalDammiAmount);

  const marketFeeAmount = options.marketFeeEnabled
    ? roundMoney(totalCalculatedBags * prefs.marketFeeRate)
    : 0;
  const mazduriAmount = options.mazduriEnabled
    ? roundMoney(totalGoodsAmount * (prefs.mazduriPercent / 100))
    : 0;

  const lowerBardanaAmount =
    options.lowerBardanaQty != null
    && options.lowerBardanaRate != null
    && options.lowerBardanaQty > 0
    && options.lowerBardanaRate > 0
      ? roundMoney(options.lowerBardanaQty * options.lowerBardanaRate)
      : null;

  const totalDebitAmount = roundMoney(
    totalGoodsAmount + totalDammiAmount + marketFeeAmount,
  );

  return {
    totalGoodsAmount,
    totalDammiAmount,
    totalCalculatedBags,
    marketFeeAmount,
    mazduriAmount,
    lowerBardanaAmount,
    totalDebitAmount,
  };
}
