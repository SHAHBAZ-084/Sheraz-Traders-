import { describe, expect, it } from 'vitest';
import {
  computePurchaseInvoiceLine,
  computePurchaseInvoiceTotals,
  roundMoney,
} from './purchase-invoice.calculations';

describe('purchase-invoice.calculations', () => {
  it('computes line total as quantity × rate', () => {
    expect(computePurchaseInvoiceLine({ productId: 1, quantity: 4, rate: 250 })).toEqual({
      productId: 1,
      quantity: 4,
      rate: 250,
      lineTotal: 1000,
    });
  });

  it('sums invoice total across lines', () => {
    const totals = computePurchaseInvoiceTotals([
      { productId: 1, quantity: 1, rate: 500 },
      { productId: 2, quantity: 3, rate: 100 },
    ]);
    expect(totals.invoiceTotal).toBe(roundMoney(500 + 300));
  });

  it('rejects negative rate', () => {
    expect(() => computePurchaseInvoiceLine({ productId: 1, quantity: 1, rate: -1 })).toThrow(/Rate/);
  });
});
