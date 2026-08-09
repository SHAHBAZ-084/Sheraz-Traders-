import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import {
  FY_CHANGE_PASSWORD,
  changeFinancialYear,
  createVoucher,
  getTrialBalance,
} from './accounting.service';
import { verifyLedgerIntegrity } from './ledger-integrity';

describe('trial balance and FY change', () => {
  let userId: number;

  beforeAll(async () => {
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;
  });

  it('keeps trial balance balanced before and after FY change for live and closed years', async () => {
    const beforeLive = await getTrialBalance();
    expect(beforeLive.isBalanced).toBe(true);
    expect(beforeLive.scope).toBe('live');

    const integrityBefore = await verifyLedgerIntegrity();
    expect(integrityBefore.ok).toBe(true);

    const result = await changeFinancialYear(userId, FY_CHANGE_PASSWORD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const afterLive = await getTrialBalance();
    expect(afterLive.isBalanced).toBe(true);
    expect(afterLive.scope).toBe('live');
    expect(afterLive.totalDebit).toBeCloseTo(beforeLive.totalDebit, 2);
    expect(afterLive.totalCredit).toBeCloseTo(beforeLive.totalCredit, 2);

    const closedTb = await getTrialBalance({ financialYearId: result.closedYear.id });
    expect(closedTb.scope).toBe('closing_snapshot');
    expect(closedTb.isBalanced).toBe(true);
    expect(closedTb.totalDebit).toBeCloseTo(beforeLive.totalDebit, 2);
    expect(closedTb.totalCredit).toBeCloseTo(beforeLive.totalCredit, 2);

    const activeTb = await getTrialBalance({ financialYearId: result.newYear.id });
    expect(activeTb.scope).toBe('live');
    expect(activeTb.isBalanced).toBe(true);

    const integrityAfter = await verifyLedgerIntegrity();
    expect(integrityAfter.ok).toBe(true);
  });

  it('remains balanced after posting a voucher in the new financial year', async () => {
    const cash = await prisma.account.findFirst({
      where: { name: 'Cash in Hand', isActive: true },
      include: { ledger: true },
    });
    const expense = await prisma.account.findFirst({
      where: { isActive: true, type: 'EXPENSE' },
      include: { ledger: true },
    });
    if (!cash?.ledger || !expense?.ledger) throw new Error('Need cash and expense accounts');

    const voucherDate = await voucherDateInActiveYear();
    await createVoucher({
      type: 'PAYMENT',
      debitAccountId: expense.id,
      creditAccountId: cash.id,
      amount: 250,
      date: voucherDate,
      description: 'FY trial balance integrity test',
      reference: 'TB-FY-TEST',
      createdById: userId,
      postImmediately: true,
    });

    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);

    const report = await verifyLedgerIntegrity();
    expect(report.ok).toBe(true);
  });
});
