import { InvoiceType, Prisma } from '@prisma/client';

/** Keep in sync with frontend/src/lib/invoiceReference.ts */
export const INVOICE_TYPE_PREFIX: Record<InvoiceType, string> = {
  KACHI_MAAL: 'KM',
  SALE_INVOICE: 'SI',
  PURCHASE_INVOICE: 'PI',
  STOCK_TRANSFER: 'TR',
  OPENING_STOCK: 'OS',
};

export function buildInvoiceReference(type: InvoiceType, number: number): string {
  const prefix = INVOICE_TYPE_PREFIX[type];
  return `${prefix}-${String(number).padStart(5, '0')}`;
}

/** Sequential reference per invoice type within a financial year (resets when FY changes). */
export async function nextInvoiceReferenceInTx(
  tx: Prisma.TransactionClient,
  type: InvoiceType,
  financialYearId: number,
): Promise<string> {
  const count = await tx.invoice.count({ where: { type, financialYearId } });
  return buildInvoiceReference(type, count + 1);
}
