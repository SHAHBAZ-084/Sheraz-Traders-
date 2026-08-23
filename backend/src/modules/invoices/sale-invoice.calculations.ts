/** Pure qty × rate (+ optional flat tax deduction) math for Sale Invoice. */

export type SaleInvoiceLineInput = {
  productId: number;
  quantity: number;
  rate: number;
  /** Flat tax withheld from the party for this line; 0 or omitted = no tax. */
  taxAmount?: number;
};

export type SaleInvoiceLineComputed = {
  productId: number;
  quantity: number;
  rate: number;
  /** Goods only: quantity × rate. */
  goodsTotal: number;
  taxAmount: number;
  /** Same as goodsTotal — tax is a separate party deduction, not added to the line. */
  lineTotal: number;
};

export type SaleInvoiceTotals = {
  lineCount: number;
  goodsTotal: number;
  taxTotal: number;
  /** Full sale value (sum of goods lines; tax is deducted from party receivable). */
  invoiceTotal: number;
  /** Amount debited to the sale party (invoiceTotal − taxTotal). */
  partyDebitTotal: number;
  lines: SaleInvoiceLineComputed[];
};

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeSaleInvoiceLine(input: SaleInvoiceLineInput): SaleInvoiceLineComputed {
  const quantity = Number(input.quantity);
  const rate = Number(input.rate);
  const rawTax = input.taxAmount != null ? Number(input.taxAmount) : 0;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Quantity must be greater than zero');
  }
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error('Rate must be zero or greater');
  }
  if (!Number.isFinite(rawTax) || rawTax < 0) {
    throw new Error('Tax must be zero or greater');
  }
  const goodsTotal = roundMoney(quantity * rate);
  const taxAmount = roundMoney(rawTax);
  if (taxAmount > goodsTotal) {
    throw new Error('Tax cannot exceed the line amount');
  }
  return {
    productId: input.productId,
    quantity,
    rate,
    goodsTotal,
    taxAmount,
    lineTotal: goodsTotal,
  };
}

export function computeSaleInvoiceTotals(lines: SaleInvoiceLineInput[]): SaleInvoiceTotals {
  if (lines.length === 0) throw new Error('At least one line is required');
  const computed = lines.map(computeSaleInvoiceLine);
  const goodsTotal = roundMoney(computed.reduce((sum, line) => sum + line.goodsTotal, 0));
  const taxTotal = roundMoney(computed.reduce((sum, line) => sum + line.taxAmount, 0));
  if (taxTotal > goodsTotal) {
    throw new Error('Total tax cannot exceed invoice total');
  }
  return {
    lineCount: computed.length,
    goodsTotal,
    taxTotal,
    invoiceTotal: goodsTotal,
    partyDebitTotal: roundMoney(goodsTotal - taxTotal),
    lines: computed,
  };
}
