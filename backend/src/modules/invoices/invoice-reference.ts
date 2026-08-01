import { InvoiceType } from '@prisma/client';

/** Keep in sync with frontend/src/lib/invoiceReference.ts */
export const INVOICE_TYPE_PREFIX: Record<InvoiceType, string> = {
  SALE_COMMISSION: 'SC',
  SALE_PAUNCH: 'SP',
  PURCHASE_MAAL: 'PM',
  KACHI_MAAL: 'KM',
  SALE_INVOICE: 'SI',
  PURCHASE_INVOICE: 'PI',
};

export function buildInvoiceReference(type: InvoiceType, number: number): string {
  const prefix = INVOICE_TYPE_PREFIX[type];
  return `${prefix}-${String(number).padStart(5, '0')}`;
}
