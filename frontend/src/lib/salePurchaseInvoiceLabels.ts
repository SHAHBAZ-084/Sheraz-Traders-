/**
 * Display labels for Sale Invoice and Purchase Invoice forms.
 * English keys per product spec stay in English; field labels use Urdu where specified.
 */
export const SALE_PURCHASE_INVOICE_LABELS = {
  header: 'Header',
  date: 'تاریخ',
  invoiceNo: 'انوائس نمبر',
  billNo: 'بل نمبر',
  store: 'اسٹور',
  addExistingProduct: 'Add existing product',
  category: 'Category',
  product: 'Product',
  qty: 'تعداد',
  rate: 'ریٹ',
  addMazduri: 'Add Mazduri',
  mazduri: 'مزدوری',
  party: 'Party',
  salePartyCategory: 'Sale party category',
  purchasePartyCategory: 'Purchase party category',
  previewGrid: 'Preview Grid',
  addToGrid: 'Add to grid',
  save: 'Save',
  minimize: 'Minimize',
  close: 'Close',
} as const;

export type SalePurchaseInvoiceLabelKey = keyof typeof SALE_PURCHASE_INVOICE_LABELS;

export function salePurchaseInvoiceLabel(key: SalePurchaseInvoiceLabelKey): string {
  return SALE_PURCHASE_INVOICE_LABELS[key];
}
