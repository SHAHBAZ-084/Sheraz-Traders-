import { describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import {
  OPENING_BALANCE_EQUITY_ACCOUNT_NAME,
  createAccount,
  getTrialBalance,
  listAccounts,
} from './accounting.service';

describe('Opening Balance Equity selector visibility', () => {
  it('is hidden from selector account lists but visible in trial balance', async () => {
    const expenseCat = await prisma.accountCategory.findFirst({ where: { name: 'Expenses' } });
    if (!expenseCat) throw new Error('Expenses category missing');

    await createAccount({
      categoryId: expenseCat.id,
      name: `OBE Selector Test ${Date.now()}`,
      openingBalance: 1000,
      openingBalanceSide: 'DR',
    });

    const obe = await prisma.account.findFirst({
      where: { name: OPENING_BALANCE_EQUITY_ACCOUNT_NAME },
    });
    expect(obe).toBeTruthy();
    expect(obe!.excludeFromSelectors).toBe(true);

    const selectorAccounts = await listAccounts({ forSelectors: true });
    expect(selectorAccounts.items.some((a) => a.id === obe!.id)).toBe(false);

    const manageAccounts = await listAccounts({ forSelectors: false });
    expect(manageAccounts.items.some((a) => a.id === obe!.id)).toBe(true);

    const trialBalance = await getTrialBalance();
    const tbRow = trialBalance.accounts.find((a) => a.accountId === obe!.id);
    expect(tbRow).toBeTruthy();
    expect(trialBalance.isBalanced).toBe(true);
  });
});
