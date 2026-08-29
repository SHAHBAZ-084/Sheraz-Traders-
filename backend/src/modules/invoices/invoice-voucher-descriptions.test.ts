import { InvoiceType, VoucherStatus, VoucherType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  blendedLegDescription,
  buildPendingInvoiceApprovalDescription,
  formatInvoiceProductLinesDescription,
  formatKachiMaalProductLinesDescription,
  invoiceVoucherHeaderSuffix,
  rowLegDescription,
  voucherReferenceFromBillNo,
} from './invoice-voucher-descriptions';

describe('invoice-voucher-descriptions', () => {
  it('maps bill number to voucher reference', () => {
    expect(voucherReferenceFromBillNo('  ABC-123  ')).toBe('ABC-123');
    expect(voucherReferenceFromBillNo('')).toBe('');
    expect(voucherReferenceFromBillNo(null)).toBe('');
  });

  it('builds row leg description with jins, weight, rate, and header suffix', () => {
    expect(
      rowLegDescription(
        { totalWeightKg: 420, ratePerMaund: 4000, jins: 'Cotton' },
        { tafseel: 'Grade A', gariNo: 'G-99' },
      ),
    ).toBe('Cotton 10 Maund 20 Kg @4000 — Tafseel: Grade A, Gari#: G-99');
  });

  it('builds blended leg description listing each line with + join', () => {
    const description = blendedLegDescription(
      [
        { totalWeightKg: 1000, ratePerMaund: 2000, jins: 'Wheat' },
        { totalWeightKg: 625, ratePerMaund: 1600, jins: 'Wheat' },
      ],
      { tafseel: 'Mixed', gariNo: '12' },
    );
    expect(description).toBe(
      'Wheat 25 Maund @2000+Wheat 15 Maund 25 Kg @1600 — Tafseel: Mixed, Gari#: 12',
    );
  });

  it('lists each jins separately when lines have different products', () => {
    const description = blendedLegDescription(
      [
        { totalWeightKg: 800, ratePerMaund: 2000, jins: 'Cotton' },
        { totalWeightKg: 450, ratePerMaund: 1600, jins: 'Wheat' },
      ],
      {},
    );
    expect(description).toBe('Cotton 20 Maund @2000+Wheat 11 Maund 10 Kg @1600');
  });

  it('falls back to invoice-level jins when line jins is empty', () => {
    expect(
      blendedLegDescription([{ totalWeightKg: 1250, ratePerMaund: 4000 }], {}, 'Cotton'),
    ).toBe('Cotton 31 Maund 10 Kg @4000');
  });

  it('omits header suffix when tafseel and gari are empty', () => {
    expect(invoiceVoucherHeaderSuffix({})).toBe('');
    expect(
      rowLegDescription({ totalWeightKg: 100, ratePerMaund: 500, jins: 'Wheat' }, {}),
    ).toBe('Wheat 2 Maund 20 Kg @500');
  });

  it('formats sale/purchase invoice product lines for ledger descriptions', () => {
    expect(
      formatInvoiceProductLinesDescription([
        { productName: 'Urea', quantity: 5, rate: 4550 },
        { productName: 'Dap', quantity: 6, rate: 12500 },
      ]),
    ).toBe('Urea 5@4550+Dap 6@12500');
  });

  it('formats kachi maal product lines as ProductName Maund Kg @Rate', () => {
    expect(
      formatKachiMaalProductLinesDescription([
        { productName: 'Cotton', totalWeightKg: 1250, ratePerMaund: 8500 },
        { productName: 'Wheat', totalWeightKg: 605, ratePerMaund: 3200 },
      ]),
    ).toBe('Cotton 31 Maund 10 Kg @8500+Wheat 15 Maund 5 Kg @3200');
  });

  it('builds pending approval description from product lines, notes, and receipts', () => {
    expect(
      buildPendingInvoiceApprovalDescription({
        type: InvoiceType.SALE_INVOICE,
        notes: 'Urgent delivery',
        items: [
          {
            label: 'Urea',
            quantity: 5,
            unitPrice: 4550,
            product: { name: 'Urea' },
          },
          {
            label: 'Dap',
            quantity: 6,
            unitPrice: 12500,
            product: { name: 'Dap' },
          },
        ],
        vouchers: [
          {
            voucher: {
              type: VoucherType.SALE_RECEIPT,
              status: VoucherStatus.PENDING_APPROVAL,
              amount: 20000,
              debitAccount: { name: 'Cash in Hand', category: { name: 'Cash' } },
            },
          },
        ],
      }),
    ).toBe(
      'Urea 5@4550+Dap 6@12500 — Urgent delivery — Received 20000 (Cash — Cash in Hand)',
    );
  });

  it('builds pending kachi maal description as ProductName Maund Kg @Rate', () => {
    const description = buildPendingInvoiceApprovalDescription({
      type: InvoiceType.KACHI_MAAL,
      jins: 'Cotton',
      kachiMaalLines: [{ totalWeightKg: 1250, ratePerMaund: 8500, jins: 'Cotton' }],
    });
    expect(description).toBe('Cotton 31 Maund 10 Kg @8500');
  });
});
