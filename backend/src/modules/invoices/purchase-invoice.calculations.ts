/** Pure qty × rate math for Purchase Invoice — isolated from other invoice types. */

export type PurchaseInvoiceLineInput = {
  productId: number;
  quantity: number;
  rate: number;
};

export type PurchaseInvoiceLineComputed = PurchaseInvoiceLineInput & {
  lineTotal: number;
};

export type PurchaseInvoiceTotals = {
  lineCount: number;
  invoiceTotal: number;
  lines: PurchaseInvoiceLineComputed[];
};

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computePurchaseInvoiceLine(input: PurchaseInvoiceLineInput): PurchaseInvoiceLineComputed {
  const quantity = Number(input.quantity);
  const rate = Number(input.rate);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Quantity must be greater than zero');
  }
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error('Rate must be zero or greater');
  }
  return {
    productId: input.productId,
    quantity,
    rate,
    lineTotal: roundMoney(quantity * rate),
  };
}

export function computePurchaseInvoiceTotals(lines: PurchaseInvoiceLineInput[]): PurchaseInvoiceTotals {
  if (lines.length === 0) throw new Error('At least one line is required');
  const computed = lines.map(computePurchaseInvoiceLine);
  const invoiceTotal = roundMoney(computed.reduce((sum, line) => sum + line.lineTotal, 0));
  return { lineCount: computed.length, invoiceTotal, lines: computed };
}
