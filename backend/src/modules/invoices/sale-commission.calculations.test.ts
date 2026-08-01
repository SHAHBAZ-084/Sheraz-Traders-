import { describe, expect, it } from 'vitest';
import {
  computeSaleCommissionInvoiceTotals,
  computeSaleCommissionRow,
} from './sale-commission.calculations';

describe('sale-commission.calculations', () => {
  it('matches verified sample: 6000kg @ 4275 → 641250 goods; dammi 1.6% → 10260', () => {
    const row = computeSaleCommissionRow(
      {
        bagCount: 0,
        bhartii: 0,
        dharanCount: 0,
        looseKg: 6000,
        ratePerMaund: 4275,
        dammiChecked: true,
      },
      { daamiPercent: 1.6 },
    );
    expect(row.totalWeightKg).toBe(6000);
    expect(row.amount).toBe(641_250);
    expect(row.dammiAmount).toBe(10_260);
    expect(row.netCreditToParty).toBe(651_510);
  });

  it('includes row bardana in net credit to purchase party', () => {
    const row = computeSaleCommissionRow(
      {
        bagCount: 10,
        bhartii: 100,
        dharanCount: 0,
        looseKg: 0,
        ratePerMaund: 2000,
        bardanaQty: 10,
        bardanaRate: 50,
        dammiChecked: false,
      },
      { daamiPercent: 1.6 },
    );
    // 1000kg → 25 maund × 2000 = 50000 goods + 500 bardana
    expect(row.amount).toBe(50_000);
    expect(row.bardanaAmount).toBe(500);
    expect(row.netCreditToParty).toBe(50_500);
  });

  it('stacks settlement fees on post-dammi total with dalali on pre-dammi goods', () => {
    const row = computeSaleCommissionRow(
      {
        bagCount: 551,
        bhartii: 10,
        dharanCount: 0,
        looseKg: 490,
        ratePerMaund: 4275,
        dammiChecked: true,
      },
      { daamiPercent: 1.6 },
    );
    // 551*10 + 490 = 6000kg same sample weight
    expect(row.totalWeightKg).toBe(6000);
    expect(row.amount).toBe(641_250);

    const totals = computeSaleCommissionInvoiceTotals(
      [{ amount: row.amount, dammiAmount: row.dammiAmount, bagCount: 551 }],
      {
        daamiPercent: 1.6,
        commissionPercent: 1,
        dalaliPercent: 0.5,
        sutliRate: 2,
        mazduriPerBagRate: 40,
        marketFeeRate: 1.2,
      },
      {
        munshianaAmount: 500,
        miscAmount: 100,
        lowerBardanaQty: 552,
        lowerBardanaRate: 45,
      },
    );

    expect(totals.postDammiTotal).toBe(651_510);
    expect(totals.commissionAmount).toBe(6_515.1); // 1% of post-dammi
    expect(totals.dalaliAmount).toBe(3_206.25); // 0.5% of goods only
    expect(totals.sutliAmount).toBe(1_102); // 551*2
    expect(totals.mazduriAmount).toBe(22_040); // 551*40
    expect(totals.marketFeeAmount).toBe(661.2); // 551*1.2
    expect(totals.settlementBardanaAmount).toBe(24_840); // 552*45
    expect(totals.netSalePartyDebit).toBe(710_474.55);
  });
});
