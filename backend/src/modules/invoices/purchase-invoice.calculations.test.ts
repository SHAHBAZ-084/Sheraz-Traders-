import { describe, expect, it } from 'vitest';
import {
  computePurchaseInvoiceLine,
  computePurchaseInvoiceTotals,
  roundMoney,
} from './purchase-invoice.calculations';

describe('purchase-invoice.calculations', () => {
  it('computes goods total as quantity × rate with no Mazduri', () => {
    expect(computePurchaseInvoiceLine({ productId: 1, quantity: 4, rate: 250 })).toEqual({
      productId: 1,
      quantity: 4,
      rate: 250,
      goodsTotal: 1000,
      mazduriAmount: 0,
      lineTotal: 1000,
    });
  });

  it('adds flat Mazduri to product line total without multiplying by qty', () => {
    expect(
      computePurchaseInvoiceLine({ productId: 1, quantity: 200, rate: 4000, mazduriAmount: 5000 }),
    ).toEqual({
      productId: 1,
      quantity: 200,
      rate: 4000,
      goodsTotal: 800_000,
      mazduriAmount: 5000,
      lineTotal: 805_000,
    });
  });

  it('sums invoice goods, mazduri, and grand total across lines', () => {
    const totals = computePurchaseInvoiceTotals([
      { productId: 1, quantity: 1, rate: 500, mazduriAmount: 50 },
      { productId: 2, quantity: 3, rate: 100 },
    ]);
    expect(totals.goodsTotal).toBe(roundMoney(500 + 300));
    expect(totals.mazduriTotal).toBe(50);
    expect(totals.invoiceTotal).toBe(roundMoney(500 + 300 + 50));
  });

  it('rejects negative rate', () => {
    expect(() => computePurchaseInvoiceLine({ productId: 1, quantity: 1, rate: -1 })).toThrow(/Rate/);
  });

  it('rejects negative Mazduri', () => {
    expect(() =>
      computePurchaseInvoiceLine({ productId: 1, quantity: 1, rate: 1, mazduriAmount: -1 }),
    ).toThrow(/Mazduri/);
  });
});
