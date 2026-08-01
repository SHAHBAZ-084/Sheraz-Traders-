import { roundMoney } from './kachiMaalCalculations';

export {
  MAUND_KG,
  parseNum,
  roundMoney,
} from './kachiMaalCalculations';

export const MAAL_KHATA_CATEGORIES = ['Maal Khata'] as const;
export const SALE_PARTY_CATEGORIES = ['Sale Party'] as const;

export type SalePaunchPreferenceRates = {
  daamiPercent: number;
};

export type SalePaunchRowInput = {
  /** Bori count — stock tracking only, not used in weight/amount calc. */
  bagCount?: number;
  /** Thela count — stock tracking only, not used in weight/amount calc. */
  thelaCount?: number;
  /** Computer weight in kg (single entry shared by upper & lower). */
  compWeightKg: number;
  /** Upper-section kaat deducted from computer weight. */
  kaatKg?: number;
  /** Lower-section kaat deducted from computer weight (independent of upper). */
  lowerKaatKg?: number;
  upperRatePerMaund: number;
  lowerRatePerMaund?: number;
  kanta?: number;
  bardanaQty?: number | null;
  bardanaRate?: number | null;
  dammiChecked?: boolean;
};

function roundWeightKg(value: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number.isInteger(n) ? n : roundMoney(n);
}

export function computeSalePaunchRow(
  input: SalePaunchRowInput,
  prefs: Pick<SalePaunchPreferenceRates, 'daamiPercent'>,
) {
  const totalWeightKg = roundWeightKg(Math.max(0, input.compWeightKg));
  const kaatKg = roundWeightKg(Math.max(0, input.kaatKg ?? 0));
  const netWeightKg = roundWeightKg(Math.max(0, totalWeightKg - kaatKg));
  const maunds = netWeightKg / 40;
  const upperAmount = roundMoney(maunds * input.upperRatePerMaund);
  const kanta = roundMoney(Math.max(0, input.kanta ?? 0));
  const netUpperAmount = roundMoney(Math.max(0, upperAmount - kanta));
  const dammiAmount = input.dammiChecked
    ? roundMoney(netUpperAmount * (prefs.daamiPercent / 100))
    : 0;

  const lowerKaatKg = roundWeightKg(Math.max(0, input.lowerKaatKg ?? 0));
  const lowerNetWeightKg = roundWeightKg(Math.max(0, totalWeightKg - lowerKaatKg));
  const lowerMaunds = lowerNetWeightKg / 40;
  const lowerRate = input.lowerRatePerMaund ?? 0;
  const lowerAmount = lowerRate > 0 ? roundMoney(lowerMaunds * lowerRate) : 0;
  const rowRevenue = lowerRate > 0 ? roundMoney(lowerAmount - upperAmount) : 0;

  const hasBardana =
    input.bardanaQty != null
    && input.bardanaRate != null
    && input.bardanaQty > 0
    && input.bardanaRate > 0;
  const bardanaAmount = hasBardana
    ? roundMoney(input.bardanaQty! * input.bardanaRate!)
    : null;

  return {
    totalWeightKg,
    kaatKg,
    netWeightKg,
    maunds,
    upperAmount,
    kanta,
    netUpperAmount,
    dammiAmount,
    lowerKaatKg,
    lowerNetWeightKg,
    lowerMaunds,
    lowerAmount,
    rowRevenue,
    bardanaAmount,
  };
}

export function computeSalePaunchInvoiceTotals(
  rows: Array<{
    totalWeightKg: number;
    kaatKg: number;
    netWeightKg: number;
    lowerKaatKg: number;
    lowerNetWeightKg: number;
    upperAmount: number;
    kanta: number;
    netUpperAmount: number;
    lowerAmount: number;
    rowRevenue: number;
    dammiAmount: number;
    bardanaAmount: number | null;
  }>,
  options: {
    taxAmount?: number;
    biltyKirayaAmount?: number;
    miscAmount?: number;
    lowerBardanaQty?: number | null;
    lowerBardanaRate?: number | null;
  },
) {
  let totalWeightKg = 0;
  let totalKaatKg = 0;
  let totalNetWeightKg = 0;
  let totalLowerKaatKg = 0;
  let totalLowerNetWeightKg = 0;
  let totalUpperAmount = 0;
  let totalKanta = 0;
  let totalNetUpperAmount = 0;
  let totalLowerAmount = 0;
  let totalRowRevenue = 0;
  let totalDammiAmount = 0;
  let totalRowBardanaAmount = 0;

  for (const row of rows) {
    totalWeightKg += row.totalWeightKg;
    totalKaatKg += row.kaatKg;
    totalNetWeightKg += row.netWeightKg;
    totalLowerKaatKg += row.lowerKaatKg;
    totalLowerNetWeightKg += row.lowerNetWeightKg;
    totalUpperAmount += row.upperAmount;
    totalKanta += row.kanta;
    totalNetUpperAmount += row.netUpperAmount;
    totalLowerAmount += row.lowerAmount;
    totalRowRevenue += row.rowRevenue;
    totalDammiAmount += row.dammiAmount;
    totalRowBardanaAmount += row.bardanaAmount ?? 0;
  }

  totalWeightKg = roundWeightKg(totalWeightKg);
  totalKaatKg = roundWeightKg(totalKaatKg);
  totalNetWeightKg = roundWeightKg(totalNetWeightKg);
  totalLowerKaatKg = roundWeightKg(totalLowerKaatKg);
  totalLowerNetWeightKg = roundWeightKg(totalLowerNetWeightKg);
  totalUpperAmount = roundMoney(totalUpperAmount);
  totalKanta = roundMoney(totalKanta);
  totalNetUpperAmount = roundMoney(totalNetUpperAmount);
  totalLowerAmount = roundMoney(totalLowerAmount);
  totalRowRevenue = roundMoney(totalRowRevenue);
  totalDammiAmount = roundMoney(totalDammiAmount);
  totalRowBardanaAmount = roundMoney(totalRowBardanaAmount);

  const lowerBardanaAmount =
    options.lowerBardanaQty != null
    && options.lowerBardanaRate != null
    && options.lowerBardanaQty > 0
    && options.lowerBardanaRate > 0
      ? roundMoney(options.lowerBardanaQty * options.lowerBardanaRate)
      : null;
  const taxAmount = roundMoney(Math.max(0, options.taxAmount ?? 0));
  const biltyKirayaAmount = roundMoney(Math.max(0, options.biltyKirayaAmount ?? 0));
  const miscAmount = roundMoney(Math.max(0, options.miscAmount ?? 0));

  const upperNetTotal = roundMoney(totalNetUpperAmount + totalDammiAmount);
  const baseLowerNetTotal = roundMoney(
    totalLowerAmount
    + totalDammiAmount
    + totalRowBardanaAmount
    - (lowerBardanaAmount ?? 0)
    - taxAmount
    - biltyKirayaAmount,
  );
  const lowerNetTotal = roundMoney(baseLowerNetTotal + miscAmount);
  const paunchRevenueDifference = roundMoney(baseLowerNetTotal - upperNetTotal);

  return {
    totalWeightKg,
    totalKaatKg,
    totalNetWeightKg,
    totalLowerKaatKg,
    totalLowerNetWeightKg,
    totalUpperAmount,
    totalKanta,
    totalNetUpperAmount,
    totalLowerAmount,
    totalRowRevenue,
    totalDammiAmount,
    totalRowBardanaAmount,
    lowerBardanaAmount,
    upperNetTotal,
    lowerNetTotal,
    paunchRevenueDifference,
  };
}
