import { describe, expect, it } from 'vitest';
import {
  computeKachiMaalInvoiceTotals,
  computeKachiMaalRow,
  DHARAN_KG,
  MAUND_KG,
} from './kachi-maal.calculations';

const prefs = {
  daamiPercent: 2,
  paleDariPercent: 1,
  brokeryPercent: 0.5,
  marketFeeRate: 2,
};

describe('Kachi Maal calculations', () => {
  it('computes row weight and amount', () => {
    // 10 bags × 40 kg + 2 dharan × 5 kg + 10 loose = 420 kg
    // rate 4000/maund → 100/kg → amount 42000
    const row = computeKachiMaalRow(
      {
        bagCount: 10,
        bhartii: 40,
        dharanCount: 2,
        looseKg: 10,
        ratePerMaund: 4000,
      },
      prefs,
    );

    expect(row.totalWeightKg).toBe(10 * 40 + 2 * DHARAN_KG + 10);
    expect(row.totalWeightKg).toBe(420);
    expect(row.amount).toBe(420 * (4000 / MAUND_KG));
    expect(row.amount).toBe(42000);
    expect(row.netCreditToParty).toBe(41_370);
    expect(row.totalMazduriPreview).toBe(42000 * 0.015);
  });

  it('invoice totals and debit/credit balance for multi-row example', () => {
    const rows = [
      computeKachiMaalRow(
        { bagCount: 10, bhartii: 40, dharanCount: 0, looseKg: 0, ratePerMaund: 4000 },
        prefs,
      ),
      computeKachiMaalRow(
        {
          bagCount: 5,
          bhartii: 50,
          dharanCount: 1,
          looseKg: 0,
          ratePerMaund: 5000,
        },
        prefs,
      ),
    ].map((r, i) => ({
      ...r,
      bhartii: i === 0 ? 40 : 50,
    }));

    const totals = computeKachiMaalInvoiceTotals(rows, prefs, 100);

    const goods = rows.reduce((s, r) => s + r.amount, 0);
    expect(totals.totalGoodsAmount).toBe(goods);
    expect(totals.totalPaleDari).toBe(Math.round(goods * 0.01 * 100) / 100);
    expect(totals.totalBrokery).toBe(Math.round(goods * 0.005 * 100) / 100);
    expect(totals.profitAmount).toBe(Math.round(goods * 0.02 * 100) / 100);

    const debits = totals.totalDebitAmount;
    const credits =
      totals.totalGoodsAmount
      + totals.marketFeeAmount
      + 100
      + totals.profitAmount;

    expect(debits).toBe(credits);
  });
});
