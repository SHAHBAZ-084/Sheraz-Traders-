import { describe, expect, it } from 'vitest';
import {
  blendedLegDescription,
  formatInvoiceProductLinesDescription,
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
    ).toBe('Cotton 10 Maund 20 Kg @ Rs 4,000/maund — Tafseel: Grade A, Gari#: G-99');
  });

  it('builds blended leg description with jins on lines', () => {
    const description = blendedLegDescription(
      [
        { totalWeightKg: 1000, ratePerMaund: 2000, jins: 'Wheat' },
        { totalWeightKg: 625, ratePerMaund: 1600, jins: 'Wheat' },
      ],
      { tafseel: 'Mixed', gariNo: '12' },
    );
    expect(description).toContain('Wheat 40 Maund 25 Kg @ Rs');
    expect(description).toContain('Tafseel: Mixed, Gari#: 12');
    expect(description).not.toContain('Bill#');
  });

  it('lists each jins separately when lines have different products', () => {
    const description = blendedLegDescription(
      [
        { totalWeightKg: 800, ratePerMaund: 2000, jins: 'Cotton' },
        { totalWeightKg: 450, ratePerMaund: 1600, jins: 'Wheat' },
      ],
      {},
    );
    expect(description).toContain('Cotton 20 Maund + Wheat 11 Maund 10 Kg @ Rs');
  });

  it('falls back to invoice-level jins when line jins is empty', () => {
    expect(
      blendedLegDescription([{ totalWeightKg: 1250, ratePerMaund: 4000 }], {}, 'Cotton'),
    ).toBe('Cotton 31 Maund 10 Kg @ Rs 4,000/maund');
  });

  it('omits header suffix when tafseel and gari are empty', () => {
    expect(invoiceVoucherHeaderSuffix({})).toBe('');
    expect(
      rowLegDescription({ totalWeightKg: 100, ratePerMaund: 500, jins: 'Wheat' }, {}),
    ).toBe('Wheat 2 Maund 20 Kg @ Rs 500/maund');
  });

  it('formats sale/purchase invoice product lines for ledger descriptions', () => {
    expect(
      formatInvoiceProductLinesDescription([
        { productName: 'Urea', quantity: 5, rate: 4550 },
        { productName: 'Dap', quantity: 6, rate: 12500 },
      ]),
    ).toBe('Urea 5@4550+Dap 6@12500');
  });
});
