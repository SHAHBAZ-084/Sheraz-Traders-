import { describe, expect, it } from 'vitest';
import {
  bardanaAgainstInvoiceDescription,
  blendedLegDescription,
  invoiceVoucherHeaderSuffix,
  isBardanaLedgerNote,
  purchaseMaalBlendedLegDescription,
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
    expect(bardanaAgainstInvoiceDescription('SC-00007')).toBe('Bardana against SC-00007');
    expect(bardanaAgainstInvoiceDescription('  ')).toBe('Bardana');
    expect(isBardanaLedgerNote('Bardana against SC-00007')).toBe(true);
    expect(isBardanaLedgerNote('Bardana 1000 kg @ Rs 2,000/maund')).toBe(true);
    expect(isBardanaLedgerNote('6000 kg @ Rs 4,275/maund')).toBe(false);
  });

  describe('purchaseMaalBlendedLegDescription', () => {
    it('goods-only (no fees) shows matching with/without expense rates', () => {
      // 1000 kg @ 2000/maund → amount = 1000 * (2000/40) = 50,000
      const description = purchaseMaalBlendedLegDescription(
        [{ totalWeightKg: 1000, ratePerMaund: 2000, amount: 50_000, dammiAmount: 0, bardanaAmount: null }],
        { gariNo: 'abc' },
        {
          totalGoodsAmount: 50_000,
          totalDammiAmount: 0,
          totalBardanaAmount: 0,
          marketFeeAmount: 0,
          mazduriAmount: 0,
        },
      );
      expect(description).toBe(
        '1000 kg with expense = Rs 2,000/maund without expense = Rs 2,000/maund Gari#: abc',
      );
    });

    it('all-fees case matches hand-calculated with-expense rate', () => {
      // Weight-weighted goods rate:
      //   (1000*2000 + 625*1600) / 1625 = 3,000,000 / 1625 = 1846.153... → Rs 1,846.15/maund
      // Amounts: 1000*(2000/40)=50,000; 625*(1600/40)=25,000; goods=75,000
      // Dammi 1,200; Bardana 800; Market Fee 150; Mazduri 1,500
      // allIn = 75,000 + 1,200 + 800 + 150 + 1,500 = 78,650
      // with expense = (78,650 / 1625) * 40 = 1936 → Rs 1,936/maund
      const description = purchaseMaalBlendedLegDescription(
        [
          { totalWeightKg: 1000, ratePerMaund: 2000, amount: 50_000, dammiAmount: 800, bardanaAmount: 500 },
          { totalWeightKg: 625, ratePerMaund: 1600, amount: 25_000, dammiAmount: 400, bardanaAmount: 300 },
        ],
        { gariNo: 'abc' },
        {
          totalGoodsAmount: 75_000,
          totalDammiAmount: 1_200,
          totalBardanaAmount: 800,
          marketFeeAmount: 150,
          mazduriAmount: 1_500,
        },
      );
      expect(description).toBe(
        '1625 kg with expense = Rs 1,936/maund without expense = Rs 1,846.15/maund Gari#: abc',
      );
    });
  });
});
