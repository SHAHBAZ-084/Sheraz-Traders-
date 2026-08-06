export const DHARAN_KG = 5;
export const MAUND_KG = 40;

export const PURCHASE_PARTY_CATEGORIES = ['Purchase Party'] as const;
export const DEBIT_ACCOUNT_CATEGORIES = [
  'Purchase Party',
  'Sale Party',
] as const;

export type KachiMaalPreferenceRates = {
  daamiPercent: number;
  paleDariPercent: number;
  brokeryPercent: number;
  marketFeeRate: number;
  marketFeeEnabled?: boolean;
};

export type KachiMaalRowInput = {
  bagCount: number;
  bhartii: number;
  dharanCount: number;
  looseKg: number;
  ratePerMaund: number;
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

  const paleDari = roundMoney(amount * (prefs.paleDariPercent / 100));
  const brokery = roundMoney(amount * (prefs.brokeryPercent / 100));
  const netCreditToParty = roundMoney(amount - paleDari - brokery);
  const totalMazduriPreview = roundMoney(paleDari + brokery);

  return { totalWeightKg, amount, netCreditToParty, totalMazduriPreview };
}

export function computeKachiMaalInvoiceTotals(
  rows: Array<{
    amount: number;
    totalWeightKg: number;
    bhartii: number;
  }>,
  prefs: KachiMaalPreferenceRates,
  miscAmount: number,
) {
  let totalGoodsAmount = 0;
  let totalPaleDari = 0;
  let totalBrokery = 0;
  let totalCalculatedBags = 0;

  for (const row of rows) {
    totalGoodsAmount += row.amount;
    totalPaleDari += row.amount * (prefs.paleDariPercent / 100);
    totalBrokery += row.amount * (prefs.brokeryPercent / 100);
    if (row.bhartii > 0) {
      totalCalculatedBags += row.totalWeightKg / row.bhartii;
    }
  }

  totalGoodsAmount = roundMoney(totalGoodsAmount);
  totalPaleDari = roundMoney(totalPaleDari);
  totalBrokery = roundMoney(totalBrokery);

  const marketFeeEnabled = prefs.marketFeeEnabled ?? true;
  const marketFeeAmount = marketFeeEnabled
    ? roundMoney(totalCalculatedBags * prefs.marketFeeRate)
    : 0;
  const profitAmount = roundMoney(totalGoodsAmount * (prefs.daamiPercent / 100));

  const misc = roundMoney(miscAmount);
  const totalDebitAmount = roundMoney(
    totalGoodsAmount + marketFeeAmount + misc + profitAmount,
  );

  return {
    totalGoodsAmount,
    totalPaleDari,
    totalBrokery,
    totalCalculatedBags,
    marketFeeAmount,
    profitAmount,
    totalDebitAmount,
  };
}

export function parseNum(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
