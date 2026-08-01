export const DHARAN_KG = 5;
export const MAUND_KG = 40;

export const PURCHASE_PARTY_CATEGORIES = ['Int. Purchase Party', 'Ext. Purchase Party'] as const;
export const DEBIT_ACCOUNT_CATEGORIES = [
  'Int. Purchase Party',
  'Ext. Purchase Party',
  'Sale Party',
] as const;

export type KachiMaalPreferenceRates = {
  daamiPercent: number;
  paleDariPercent: number;
  brokeryPercent: number;
  marketFeeRate: number;
};

export type KachiMaalRowInput = {
  bagCount: number;
  bhartii: number;
  dharanCount: number;
  looseKg: number;
  ratePerMaund: number;
  bardanaQty?: number | null;
  bardanaRate?: number | null;
};

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function computeKachiMaalRow(
  input: KachiMaalRowInput,
  prefs: Pick<KachiMaalPreferenceRates, 'paleDariPercent' | 'brokeryPercent'>,
) {
  const totalWeightKg =
    input.bagCount * input.bhartii + input.dharanCount * DHARAN_KG + input.looseKg;
  const ratePerKg = input.ratePerMaund / MAUND_KG;
  const amount = roundMoney(totalWeightKg * ratePerKg);

  const hasBardana =
    input.bardanaQty != null
    && input.bardanaRate != null
    && input.bardanaQty > 0
    && input.bardanaRate > 0;
  const bardanaAmount = hasBardana
    ? roundMoney(input.bardanaQty! * input.bardanaRate!)
    : null;

  const paleDari = roundMoney(amount * (prefs.paleDariPercent / 100));
  const brokery = roundMoney(amount * (prefs.brokeryPercent / 100));
  const netCreditToParty = roundMoney(amount + (bardanaAmount ?? 0) - paleDari - brokery);
  const totalMazduriPreview = roundMoney(paleDari + brokery);

  return { totalWeightKg, amount, bardanaAmount, netCreditToParty, totalMazduriPreview };
}

export function computeKachiMaalInvoiceTotals(
  rows: Array<{
    amount: number;
    totalWeightKg: number;
    bhartii: number;
    bardanaAmount?: number | null;
  }>,
  prefs: KachiMaalPreferenceRates,
  miscAmount: number,
  lowerBardanaQty?: number | null,
  lowerBardanaRate?: number | null,
) {
  let totalGoodsAmount = 0;
  let totalBardanaFromRows = 0;
  let totalPaleDari = 0;
  let totalBrokery = 0;
  let totalCalculatedBags = 0;

  for (const row of rows) {
    totalGoodsAmount += row.amount;
    totalPaleDari += row.amount * (prefs.paleDariPercent / 100);
    totalBrokery += row.amount * (prefs.brokeryPercent / 100);
    totalBardanaFromRows += row.bardanaAmount ?? 0;
    if (row.bhartii > 0) {
      totalCalculatedBags += row.totalWeightKg / row.bhartii;
    }
  }

  totalGoodsAmount = roundMoney(totalGoodsAmount);
  totalPaleDari = roundMoney(totalPaleDari);
  totalBrokery = roundMoney(totalBrokery);
  totalBardanaFromRows = roundMoney(totalBardanaFromRows);

  const marketFeeAmount = roundMoney(totalCalculatedBags * prefs.marketFeeRate);
  const profitAmount = roundMoney(totalGoodsAmount * (prefs.daamiPercent / 100));

  const lowerBardanaAmount =
    lowerBardanaQty != null
    && lowerBardanaRate != null
    && lowerBardanaQty > 0
    && lowerBardanaRate > 0
      ? roundMoney(lowerBardanaQty * lowerBardanaRate)
      : null;

  const misc = roundMoney(miscAmount);
  const totalDebitAmount = roundMoney(
    totalGoodsAmount + marketFeeAmount + misc + profitAmount,
  );

  return {
    totalGoodsAmount,
    totalBardanaFromRows,
    totalPaleDari,
    totalBrokery,
    totalCalculatedBags,
    marketFeeAmount,
    profitAmount,
    lowerBardanaAmount,
    totalDebitAmount,
  };
}

export function parseNum(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
