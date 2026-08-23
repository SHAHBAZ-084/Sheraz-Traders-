import { describe, expect, it } from 'vitest';
import {
  embeddedPaymentsFromInvoice,
  formatPaymentLinesDetail,
  invoiceRemaining,
  sumPaymentDisplayAmounts,
} from './invoicePaymentDisplay';
import type { InvoiceDetail } from './api';

describe('invoicePaymentDisplay', () => {
  it('sums multiple receipt vouchers and formats detail', () => {
    const invoice = {
      total: 50000,
      vouchers: [
        {
          voucher: {
            id: 1,
            type: 'SALE_RECEIPT',
            number: 1,
            date: '',
            amount: 20000,
            status: 'PENDING_APPROVAL',
            createdAt: '',
            debitAccount: { id: 1, name: 'Cash', code: 'C1', category: { name: 'Cash' } },
          },
        },
        {
          voucher: {
            id: 2,
            type: 'SALE_RECEIPT',
            number: 2,
            date: '',
            amount: 10000,
            status: 'POSTED',
            createdAt: '',
            debitAccount: {
              id: 2,
              name: 'Meezan Bank',
              code: 'B1',
              category: { name: 'Bank' },
            },
          },
        },
      ],
    } as unknown as InvoiceDetail;

    const lines = embeddedPaymentsFromInvoice(invoice, 'SALE_RECEIPT');
    expect(sumPaymentDisplayAmounts(lines)).toBe(30000);
    expect(formatPaymentLinesDetail(lines, (n) => String(n))).toBe(
      '20000 (Cash) + 10000 (Bank — Meezan Bank)',
    );
    expect(invoiceRemaining(50000, 30000)).toBe(20000);
  });

  it('returns empty when no payments', () => {
    const invoice = { total: 1000, vouchers: [] } as unknown as InvoiceDetail;
    expect(embeddedPaymentsFromInvoice(invoice, 'SALE_RECEIPT')).toEqual([]);
    expect(formatPaymentLinesDetail([], (n) => String(n))).toBe('0');
    expect(invoiceRemaining(1000, 0)).toBe(1000);
  });
});
