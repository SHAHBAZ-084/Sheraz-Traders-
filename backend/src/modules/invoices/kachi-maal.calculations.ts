export const DHARAN_KG = 5;
export const MAUND_KG = 40;

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

export type KachiMaalRowComputed = {
  totalWeightKg: number;
  amount: number;
  bardanaAmount: number | null;
  paleDari: number;
  brokery: number;
  netCreditToParty: number;
  totalMazduriPreview: number;
};

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function computeKachiMaalRow(
  input: KachiMaalRowInput,
  prefs: Pick<KachiMaalPreferenceRates, 'paleDariPercent' | 'brokeryPercent'>,
): KachiMaalRowComputed {
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

  return { totalWeightKg, amount, bardanaAmount, paleDari, brokery, netCreditToParty, totalMazduriPreview };
}

export type KachiMaalLineTotals = {
  totalGoodsAmount: number;
  totalBardanaFromRows: number;
  totalPaleDari: number;
  totalBrokery: number;
  totalCalculatedBags: number;
};

export function computeKachiMaalLineTotals(
  rows: Array<{ amount: number; totalWeightKg: number; bhartii: number }>,
  prefs: Pick<KachiMaalPreferenceRates, 'paleDariPercent' | 'brokeryPercent'>,
): KachiMaalLineTotals {
  let totalGoodsAmount = 0;
  let totalBardanaFromRows = 0;
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

  return {
    totalGoodsAmount: roundMoney(totalGoodsAmount),
    totalBardanaFromRows: roundMoney(totalBardanaFromRows),
    totalPaleDari: roundMoney(totalPaleDari),
    totalBrokery: roundMoney(totalBrokery),
    totalCalculatedBags,
  };
}

export function computeLowerBardanaAmount(qty?: number | null, rate?: number | null) {
  if (qty == null || rate == null || qty <= 0 || rate <= 0) return null;
  return roundMoney(qty * rate);
}

export type KachiMaalInvoiceTotals = KachiMaalLineTotals & {
  marketFeeAmount: number;
  profitAmount: number;
  lowerBardanaAmount: number | null;
  totalDebitAmount: number;
};

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
): KachiMaalInvoiceTotals {
  const lineTotals = computeKachiMaalLineTotals(rows, prefs);
  let totalBardanaFromRows = 0;
  for (const row of rows) {
    totalBardanaFromRows += row.bardanaAmount ?? 0;
  }
  lineTotals.totalBardanaFromRows = roundMoney(totalBardanaFromRows);

  const marketFeeAmount = roundMoney(lineTotals.totalCalculatedBags * prefs.marketFeeRate);
  const profitAmount = roundMoney(lineTotals.totalGoodsAmount * (prefs.daamiPercent / 100));
  const lowerBardanaAmount = computeLowerBardanaAmount(lowerBardanaQty, lowerBardanaRate);
  const misc = roundMoney(miscAmount);

  const totalDebitAmount = roundMoney(
    lineTotals.totalGoodsAmount
      + marketFeeAmount
      + misc
      + profitAmount,
  );

  return {
    ...lineTotals,
    marketFeeAmount,
    profitAmount,
    lowerBardanaAmount,
    totalDebitAmount,
  };
}
