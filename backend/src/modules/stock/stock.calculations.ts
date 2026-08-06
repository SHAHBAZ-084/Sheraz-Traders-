/** Aligns with purchase-maal / kachi dharan weight. */
export const STOCK_DHARAN_KG = 5;

/**
 * Stock tracking starts when this feature ships.
 * Invoices saved before this are not backfilled into StockMovement.
 */
export const STOCK_TRACKING_STARTED_AT = new Date('2026-07-30T00:00:00.000Z');

function roundWeightKg(value: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number.isInteger(n) ? n : Math.round(n * 100) / 100;
}

export type StockInRowInput = {
  wholeBags: number;
  dharanCount: number;
  looseKg: number;
  bhartii: number;
  carriedRemainderKg: number;
};

export type StockInRowResult = {
  bagsIn: number;
  newRemainderKg: number;
  newFullBagsFromLoose: number;
  looseKgTotal: number;
};

/** Purchase to Maal stock IN — whole bags trusted; loose converts via bhartii + carried remainder. */
export function computeStockInFromRow(input: StockInRowInput): StockInRowResult {
  const wholeBags = Math.max(0, Number(input.wholeBags) || 0);
  const bhartii = Number(input.bhartii);
  const carried = Math.max(0, roundWeightKg(input.carriedRemainderKg));
  const looseKgTotal = roundWeightKg(
    Math.max(0, Number(input.dharanCount) || 0) * STOCK_DHARAN_KG
    + Math.max(0, Number(input.looseKg) || 0),
  );

  if (!(bhartii > 0)) {
    return {
      bagsIn: wholeBags,
      newRemainderKg: carried,
      newFullBagsFromLoose: 0,
      looseKgTotal,
    };
  }

  const pooled = roundWeightKg(carried + looseKgTotal);
  const newFullBagsFromLoose = Math.floor((pooled + 1e-9) / bhartii);
  const newRemainderKg = roundWeightKg(pooled - newFullBagsFromLoose * bhartii);

  return {
    bagsIn: wholeBags + newFullBagsFromLoose,
    newRemainderKg: Math.max(0, newRemainderKg),
    newFullBagsFromLoose,
    looseKgTotal,
  };
}

/** Stock OUT — direct bag count. */
export function computeStockOutBags(bagCount: number): number {
  const bags = Number(bagCount);
  return Math.max(0, Number.isFinite(bags) ? bags : 0);
}
