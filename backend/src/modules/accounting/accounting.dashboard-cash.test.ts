import { describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import {
  bootstrapChartOfAccounts,
  createAccount,
  getDashboardSummary,
} from './accounting.service';

describe('getDashboardSummary cashBalance', () => {
  it('sums only Cash category ledgers and ignores Bank accounts', async () => {
    await bootstrapChartOfAccounts();

    const cashCategory = await prisma.accountCategory.findFirst({ where: { isActive: true, name: 'Cash' } });
    const bankCategory = await prisma.accountCategory.findFirst({ where: { isActive: true, name: 'Bank' } });
    if (!cashCategory || !bankCategory) throw new Error('Cash/Bank categories missing');

    const stamp = Date.now();
    await createAccount({
      categoryId: bankCategory.id,
      name: `Dash Bank ${stamp}`,
      openingBalance: 88_000,
      openingBalanceSide: 'DR',
    });

    const cashAccounts = await prisma.account.findMany({
      where: { categoryId: cashCategory.id, isActive: true },
      include: { ledger: true },
    });
    const expectedCash = cashAccounts.reduce((sum, a) => sum + Number(a.ledger?.balance ?? 0), 0);
    const summary = await getDashboardSummary();
    expect(summary.cashBalance).toBe(expectedCash);
    expect(summary.cashBalance).not.toBe(expectedCash + 88_000);
  });
});
