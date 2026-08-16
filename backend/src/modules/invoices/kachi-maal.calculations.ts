export const DHARAN_KG = 5;
export const MAUND_KG = 40;
/** Thela input mode: each thela counts as 50 kg in weight entry (not used for stock report display). */
/** Common thela weight in kg (informational only — Bhartii is always user-entered). */
export const THELA_KG = 50;

export type KachiBagMode = 'BORI' | 'THELA';

export type KachiWeightInput = {
  bagCount: number;
  bagMode: KachiBagMode;
  bhartii: number;
  dharanCount: number;
  looseKg: number;
};

export function resolveKachiBhartii(_mode: KachiBagMode, bhartii: number): number {
  const n = Number(bhartii);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Total kg from bags/thela + dharan + loose — same formula as Kachi Maal row weight. */
export function computeKachiWeightKg(input: KachiWeightInput): number {
  const bhartii = resolveKachiBhartii(input.bagMode, input.bhartii);
  return (
    Math.max(0, Number(input.bagCount) || 0) * bhartii
    + Math.max(0, Number(input.dharanCount) || 0) * DHARAN_KG
    + Math.max(0, Number(input.looseKg) || 0)
  );
}

export type KachiOpeningStockInput = KachiWeightInput & { ratePerMaund: number };

/** Opening stock value for kachi products — amount only (no party deductions). */
export function computeKachiOpeningStockValue(input: KachiOpeningStockInput): {
  totalWeightKg: number;
  amount: number;
  bhartiiUsed: number;
} {
  const bhartiiUsed = resolveKachiBhartii(input.bagMode, input.bhartii);
  const totalWeightKg = computeKachiWeightKg(input);
  const ratePerKg = Math.max(0, Number(input.ratePerMaund) || 0) / MAUND_KG;
  const amount = roundMoney(totalWeightKg * ratePerKg);
  return { totalWeightKg, amount, bhartiiUsed };
}

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

export type KachiMaalRowComputed = {
  totalWeightKg: number;
  amount: number;
  paleDari: number;
  brokery: number;
  netCreditToParty: number;
  totalMazduriPreview: number;
};

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

/** Display total weight as maund + remaining kg (1 maund = MAUND_KG). Raw kg unchanged in data. */
export function formatWeightMaundKg(totalKg: number): string {
  const kg = Number(totalKg);
  if (!Number.isFinite(kg) || kg <= 0) return '0 Kg';

  const maund = Math.floor(kg / MAUND_KG);
  const remainingKg = Math.round((kg - maund * MAUND_KG) * 100) / 100;

  const formatKg = (value: number) =>
    Number.isInteger(value) ? String(value) : value.toLocaleString('en-PK', { maximumFractionDigits: 2 });

  if (maund === 0) return `${formatKg(remainingKg)} Kg`;
  if (remainingKg === 0) return `${maund} Maund`;
  return `${maund} Maund ${formatKg(remainingKg)} Kg`;
}

export function computeKachiMaalRow(
  input: KachiMaalRowInput,
  prefs: Pick<KachiMaalPreferenceRates, 'paleDariPercent' | 'brokeryPercent'>,
): KachiMaalRowComputed {
  const totalWeightKg =
    input.bagCount * input.bhartii + input.dharanCount * DHARAN_KG + input.looseKg;
  const ratePerKg = input.ratePerMaund / MAUND_KG;
  const amount = roundMoney(totalWeightKg * ratePerKg);

  const paleDari = roundMoney(amount * (prefs.paleDariPercent / 100));
  const brokery = roundMoney(amount * (prefs.brokeryPercent / 100));
  const netCreditToParty = roundMoney(amount - paleDari - brokery);
  const totalMazduriPreview = roundMoney(paleDari + brokery);

  return { totalWeightKg, amount, paleDari, brokery, netCreditToParty, totalMazduriPreview };
}

export type KachiMaalLineTotals = {
  totalGoodsAmount: number;
  totalPaleDari: number;
  totalBrokery: number;
  totalCalculatedBags: number;
};

export function computeKachiMaalLineTotals(
  rows: Array<{ amount: number; totalWeightKg: number; bhartii: number }>,
  prefs: Pick<KachiMaalPreferenceRates, 'paleDariPercent' | 'brokeryPercent'>,
): KachiMaalLineTotals {
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

  return {
    totalGoodsAmount: roundMoney(totalGoodsAmount),
    totalPaleDari: roundMoney(totalPaleDari),
    totalBrokery: roundMoney(totalBrokery),
    totalCalculatedBags,
  };
}

export type KachiMaalInvoiceTotals = KachiMaalLineTotals & {
  marketFeeAmount: number;
  profitAmount: number;
  totalDebitAmount: number;
};

export function computeKachiMaalInvoiceTotals(
  rows: Array<{
    amount: number;
    totalWeightKg: number;
    bhartii: number;
  }>,
  prefs: KachiMaalPreferenceRates,
  miscAmount: number,
): KachiMaalInvoiceTotals {
  const lineTotals = computeKachiMaalLineTotals(rows, prefs);

  const marketFeeEnabled = prefs.marketFeeEnabled ?? true;
  const marketFeeAmount = marketFeeEnabled
    ? roundMoney(lineTotals.totalCalculatedBags * prefs.marketFeeRate)
    : 0;
  const profitAmount = roundMoney(lineTotals.totalGoodsAmount * (prefs.daamiPercent / 100));
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
    totalDebitAmount,
  };
}
