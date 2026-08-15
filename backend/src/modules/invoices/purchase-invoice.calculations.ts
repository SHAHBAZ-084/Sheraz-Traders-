/** Pure qty × rate (+ optional flat Mazduri) math for Purchase Invoice. */

export type PurchaseInvoiceLineInput = {
  productId: number;
  quantity: number;
  rate: number;
  /** Flat labor fee for the line; 0 or omitted = no Mazduri. */
  mazduriAmount?: number;
};

export type PurchaseInvoiceLineComputed = {
  productId: number;
  quantity: number;
  rate: number;
  /** Goods only: quantity × rate. */
  goodsTotal: number;
  mazduriAmount: number;
  /** Product debit: goodsTotal + mazduriAmount. */
  lineTotal: number;
};

export type PurchaseInvoiceTotals = {
  lineCount: number;
  goodsTotal: number;
  mazduriTotal: number;
  /** Full voucher / invoice total (goods + mazduri). */
  invoiceTotal: number;
  lines: PurchaseInvoiceLineComputed[];
};

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computePurchaseInvoiceLine(input: PurchaseInvoiceLineInput): PurchaseInvoiceLineComputed {
  const quantity = Number(input.quantity);
  const rate = Number(input.rate);
  const rawMazduri = input.mazduriAmount != null ? Number(input.mazduriAmount) : 0;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Quantity must be greater than zero');
  }
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error('Rate must be zero or greater');
  }
  if (!Number.isFinite(rawMazduri) || rawMazduri < 0) {
    throw new Error('Mazduri must be zero or greater');
  }
  const goodsTotal = roundMoney(quantity * rate);
  const mazduriAmount = roundMoney(rawMazduri);
  return {
    productId: input.productId,
    quantity,
    rate,
    goodsTotal,
    mazduriAmount,
    lineTotal: roundMoney(goodsTotal + mazduriAmount),
  };
}

export function computePurchaseInvoiceTotals(lines: PurchaseInvoiceLineInput[]): PurchaseInvoiceTotals {
  if (lines.length === 0) throw new Error('At least one line is required');
  const computed = lines.map(computePurchaseInvoiceLine);
  const goodsTotal = roundMoney(computed.reduce((sum, line) => sum + line.goodsTotal, 0));
  const mazduriTotal = roundMoney(computed.reduce((sum, line) => sum + line.mazduriAmount, 0));
  return {
    lineCount: computed.length,
    goodsTotal,
    mazduriTotal,
    invoiceTotal: roundMoney(goodsTotal + mazduriTotal),
    lines: computed,
  };
}
