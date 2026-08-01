import { describe, expect, it } from 'vitest';
import { computeSaleInvoiceLine, computeSaleInvoiceTotals, roundMoney } from './sale-invoice.calculations';

describe('sale-invoice.calculations', () => {
  it('computes line total as quantity × rate', () => {
    expect(computeSaleInvoiceLine({ productId: 1, quantity: 3, rate: 150 })).toEqual({
      productId: 1,
      quantity: 3,
      rate: 150,
      lineTotal: 450,
    });
  });

  it('sums invoice total across lines', () => {
    const totals = computeSaleInvoiceTotals([
      { productId: 1, quantity: 2, rate: 100 },
      { productId: 2, quantity: 1.5, rate: 80 },
    ]);
    expect(totals.invoiceTotal).toBe(roundMoney(200 + 120));
    expect(totals.lineCount).toBe(2);
  });

  it('rejects non-positive quantity', () => {
    expect(() => computeSaleInvoiceLine({ productId: 1, quantity: 0, rate: 10 })).toThrow(/Quantity/);
  });
});
