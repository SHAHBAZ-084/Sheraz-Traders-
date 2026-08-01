export const DHARAN_KG = 5;
export const MAUND_KG = 40;

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

export type PurchaseMaalRowComputed = {
  totalWeightKg: number;
  amount: number;
  bardanaAmount: number | null;
  dammiAmount: number;
  netCreditToParty: number;
};

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function computePurchaseMaalRow(
  input: PurchaseMaalRowInput,
  prefs: Pick<PurchaseMaalPreferenceRates, 'daamiPercent'>,
): PurchaseMaalRowComputed {
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

  const dammiAmount = input.dammiChecked
    ? roundMoney(amount * (prefs.daamiPercent / 100))
    : 0;
  const netCreditToParty = roundMoney(amount + (bardanaAmount ?? 0) + dammiAmount);

  return { totalWeightKg, amount, bardanaAmount, dammiAmount, netCreditToParty };
}

export function computeLowerBardanaAmount(qty?: number | null, rate?: number | null) {
  if (qty == null || rate == null || qty <= 0 || rate <= 0) return null;
  return roundMoney(qty * rate);
}

export type PurchaseMaalInvoiceTotals = {
  totalGoodsAmount: number;
  totalDammiAmount: number;
  totalCalculatedBags: number;
  marketFeeAmount: number;
  mazduriAmount: number;
  lowerBardanaAmount: number | null;
  totalDebitAmount: number;
};

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
): PurchaseMaalInvoiceTotals {
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
  const lowerBardanaAmount = computeLowerBardanaAmount(
    options.lowerBardanaQty,
    options.lowerBardanaRate,
  );

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

export function splitMazduriByParty(
  lines: Array<{ partyAccountId: number; amount: number }>,
  totalMazduri: number,
  totalGoods: number,
) {
  const shares = new Map<number, number>();
  if (totalMazduri <= 0 || totalGoods <= 0) return shares;

  const partyGoods = new Map<number, number>();
  for (const line of lines) {
    partyGoods.set(
      line.partyAccountId,
      roundMoney((partyGoods.get(line.partyAccountId) ?? 0) + line.amount),
    );
  }

  const parties = [...partyGoods.entries()];
  let allocated = 0;
  for (let i = 0; i < parties.length; i += 1) {
    const [partyId, goods] = parties[i]!;
    let share: number;
    if (i === parties.length - 1) {
      share = roundMoney(totalMazduri - allocated);
    } else {
      share = roundMoney((totalMazduri * goods) / totalGoods);
      allocated = roundMoney(allocated + share);
    }
    if (share > 0) shares.set(partyId, share);
  }
  return shares;
}
