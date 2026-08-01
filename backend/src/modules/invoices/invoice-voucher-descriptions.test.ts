import { describe, expect, it } from 'vitest';
import {
  bardanaAgainstInvoiceDescription,
  blendedLegDescription,
  invoiceVoucherHeaderSuffix,
  isBardanaLedgerNote,
  rowLegDescription,
  voucherReferenceFromBillNo,
} from './invoice-voucher-descriptions';

describe('invoice-voucher-descriptions', () => {
  it('maps bill number to voucher reference', () => {
    expect(voucherReferenceFromBillNo('  ABC-123  ')).toBe('ABC-123');
    expect(voucherReferenceFromBillNo('')).toBe('');
    expect(voucherReferenceFromBillNo(null)).toBe('');
  });

  it('builds row leg description with weight, rate, and header suffix', () => {
    expect(
      rowLegDescription(
        { totalWeightKg: 420, ratePerMaund: 4000 },
        { tafseel: 'Wheat', gariNo: 'G-99' },
      ),
    ).toBe('420 kg @ Rs 4,000/maund — Tafseel: Wheat, Gari#: G-99');
  });

  it('builds blended leg description across multiple rows', () => {
    const description = blendedLegDescription(
      [
        { totalWeightKg: 1000, ratePerMaund: 2000 },
        { totalWeightKg: 625, ratePerMaund: 1600 },
      ],
      { tafseel: 'Mixed', gariNo: '12' },
      'Wheat',
    );
    expect(description).toContain('Wheat 1625 kg @ Rs');
    expect(description).toContain('Tafseel: Mixed, Gari#: 12');
    expect(description).not.toContain('Bill#');
  });

  it('omits header suffix when tafseel and gari are empty', () => {
    expect(invoiceVoucherHeaderSuffix({})).toBe('');
    expect(rowLegDescription({ totalWeightKg: 100, ratePerMaund: 500 }, {})).toBe(
      '100 kg @ Rs 500/maund',
    );
  });

  it('builds bardana-against-invoice description', () => {
    expect(bardanaAgainstInvoiceDescription('KM-00007')).toBe('Bardana against KM-00007');
    expect(bardanaAgainstInvoiceDescription('  ')).toBe('Bardana');
    expect(isBardanaLedgerNote('Bardana against KM-00007')).toBe(true);
    expect(isBardanaLedgerNote('Bardana 1000 kg @ Rs 2,000/maund')).toBe(true);
    expect(isBardanaLedgerNote('6000 kg @ Rs 4,275/maund')).toBe(false);
  });
});
