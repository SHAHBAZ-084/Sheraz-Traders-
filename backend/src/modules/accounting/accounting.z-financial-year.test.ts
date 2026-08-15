import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import {
  FY_CHANGE_PASSWORD,
  cancelVoucher,
  changeFinancialYear,
  getActiveFinancialYear,
  getActiveFinancialYearId,
  listFinancialYears,
} from './accounting.service';
import { getNextSaleInvoiceReference } from '../invoices/sale-invoice.service';
import { previewNextVoucherNumber } from './accounting.service';
import { AppError } from '../../utils/helpers';

describe('financial year change', () => {
  let userId: number;
  let sampleAccountId: number;
  let balanceBefore: number;

  beforeAll(async () => {
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;

    const account = await prisma.account.findFirst({
      where: { isActive: true },
      include: { ledger: true },
    });
    if (!account?.ledger) throw new Error('Need an account with ledger');
    sampleAccountId = account.id;
    balanceBefore = Number(account.ledger.balance);
  });

  it('rejects wrong password silently', async () => {
    const result = await changeFinancialYear(userId, 'wrong');
    expect(result.ok).toBe(false);
  });

  it('changes FY without altering live ledger balances and resets counters', async () => {
    const activeBefore = await getActiveFinancialYear();
    const voucherPreviewBefore = await previewNextVoucherNumber('PAYMENT');
    const invoiceRefBefore = await getNextSaleInvoiceReference();

    const result = await changeFinancialYear(userId, FY_CHANGE_PASSWORD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const activeAfter = await getActiveFinancialYear();
    expect(activeAfter.id).not.toBe(activeBefore.id);
    expect(activeAfter.isActive).toBe(true);

    const years = await listFinancialYears();
    const closed = years.find((y) => y.id === result.closedYear.id);
    expect(closed?.isActive).toBe(false);

    const snapshot = await prisma.financialYearClosingBalance.findUnique({
      where: {
        financialYearId_accountId: {
          financialYearId: result.closedYear.id,
          accountId: sampleAccountId,
        },
      },
    });
    expect(snapshot).toBeTruthy();

    const ledgerAfter = await prisma.ledger.findUnique({ where: { accountId: sampleAccountId } });
    expect(Number(ledgerAfter?.balance ?? 0)).toBeCloseTo(balanceBefore, 2);

    const voucherPreviewAfter = await previewNextVoucherNumber('PAYMENT');
    expect(voucherPreviewAfter.number).toBe(1);

    const invoiceRefAfter = await getNextSaleInvoiceReference();
    expect(invoiceRefAfter).toMatch(/SI-00001$/);

    const activeFyId = await getActiveFinancialYearId(prisma);
    const voucherDate = await voucherDateInActiveYear();
    expect(activeFyId).toBe(activeAfter.id);
    expect(voucherDate).toBeTruthy();

    const closedYearVoucher = await prisma.voucher.findFirst({
      where: { financialYearId: result.closedYear.id, status: 'ACTIVE' },
      select: { id: true },
    });
    if (closedYearVoucher) {
      await expect(cancelVoucher(closedYearVoucher.id, userId)).rejects.toSatisfy(
        (err: unknown) => err instanceof AppError && err.statusCode === 403,
      );
    }
  });
});
