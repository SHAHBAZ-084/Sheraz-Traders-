import { describe, expect, it } from 'vitest';
import {
  computePurchaseMaalInvoiceTotals,
  computePurchaseMaalRow,
  splitMazduriByParty,
} from './purchase-maal.calculations';

describe('Purchase Maal calculations', () => {
  const prefs = { daamiPercent: 1.6, mazduriPercent: 2, marketFeeRate: 2 };

  it('computes row with dammi add-on and full net to party', () => {
    const row = computePurchaseMaalRow(
      {
        bagCount: 10,
        bhartii: 100,
        dharanCount: 0,
        looseKg: 0,
        ratePerMaund: 2000,
        dammiChecked: true,
      },
      prefs,
    );

    expect(row.amount).toBe(50_000);
    expect(row.dammiAmount).toBe(800);
    expect(row.netCreditToParty).toBe(50_800);
  });

  it('buyer total = goods + dammi + market fee when enabled', () => {
    const row = computePurchaseMaalRow(
      {
        bagCount: 10,
        bhartii: 100,
        dharanCount: 0,
        looseKg: 0,
        ratePerMaund: 2000,
        dammiChecked: true,
      },
      prefs,
    );

    const totals = computePurchaseMaalInvoiceTotals(
      [{ ...row, bhartii: 100 }],
      prefs,
      { marketFeeEnabled: true, mazduriEnabled: false },
    );

    expect(totals.totalGoodsAmount).toBe(50_000);
    expect(totals.totalDammiAmount).toBe(800);
    expect(totals.marketFeeAmount).toBe(20);
    expect(totals.mazduriAmount).toBe(0);
    expect(totals.totalDebitAmount).toBe(50_820);
  });

  it('splits mazduri proportionally by party goods share', () => {
    const shares = splitMazduriByParty(
      [
        { partyAccountId: 1, amount: 50_000 },
        { partyAccountId: 2, amount: 25_000 },
      ],
      1500,
      75_000,
    );

    expect(shares.get(1)).toBe(1000);
    expect(shares.get(2)).toBe(500);
  });
});
