import { describe, expect, it } from 'vitest';
import { salePurchaseInvoiceLabel } from './salePurchaseInvoiceLabels';

describe('salePurchaseInvoiceLabels', () => {
  it('uses Urdu for specified field labels', () => {
    expect(salePurchaseInvoiceLabel('date')).toBe('تاریخ');
    expect(salePurchaseInvoiceLabel('invoiceNo')).toBe('انوائس نمبر');
    expect(salePurchaseInvoiceLabel('billNo')).toBe('بل نمبر');
    expect(salePurchaseInvoiceLabel('store')).toBe('اسٹور');
    expect(salePurchaseInvoiceLabel('qty')).toBe('تعداد');
    expect(salePurchaseInvoiceLabel('rate')).toBe('ریٹ');
    expect(salePurchaseInvoiceLabel('mazduri')).toBe('مزدوری');
  });

  it('keeps specified fields in English', () => {
    expect(salePurchaseInvoiceLabel('header')).toBe('Header');
    expect(salePurchaseInvoiceLabel('addExistingProduct')).toBe('Add existing product');
    expect(salePurchaseInvoiceLabel('category')).toBe('Category');
    expect(salePurchaseInvoiceLabel('product')).toBe('Product');
    expect(salePurchaseInvoiceLabel('addMazduri')).toBe('Add Mazduri');
    expect(salePurchaseInvoiceLabel('party')).toBe('Party');
    expect(salePurchaseInvoiceLabel('salePartyCategory')).toBe('Sale party category');
    expect(salePurchaseInvoiceLabel('purchasePartyCategory')).toBe('Purchase party category');
    expect(salePurchaseInvoiceLabel('previewGrid')).toBe('Preview Grid');
    expect(salePurchaseInvoiceLabel('addToGrid')).toBe('Add to grid');
    expect(salePurchaseInvoiceLabel('save')).toBe('Save');
  });
});
