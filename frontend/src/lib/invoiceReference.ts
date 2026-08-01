/** Keep in sync with backend/src/modules/invoices/invoice-reference.ts */
export const INVOICE_TYPE_PREFIX = {
  SALE_COMMISSION: 'SC',
  SALE_PAUNCH: 'SP',
  PURCHASE_MAAL: 'PM',
  KACHI_MAAL: 'KM',
  SALE_INVOICE: 'SI',
  PURCHASE_INVOICE: 'PI',
} as const;

export type InvoiceTypeKey = keyof typeof INVOICE_TYPE_PREFIX;

export function buildInvoiceReference(type: InvoiceTypeKey, number: number): string {
  const prefix = INVOICE_TYPE_PREFIX[type];
  return `${prefix}-${String(number).padStart(5, '0')}`;
}
