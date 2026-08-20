import { describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import {
  OPENING_BALANCE_EQUITY_ACCOUNT_NAME,
  SALES_REVENUE_ACCOUNT_NAME,
  createAccount,
  ensureSalesRevenueAccount,
  getAccountBalancesAsOf,
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

    const date = new Date();
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const allGroups = await getAccountBalancesAsOf({ date: iso, side: 'both' });
    expect(allGroups.accounts.some((a) => a.accountId === obe!.id)).toBe(false);

    const equityCategory = await getAccountBalancesAsOf({
      date: iso,
      categoryId: obe!.categoryId,
      side: 'both',
    });
    expect(equityCategory.accounts.some((a) => a.accountId === obe!.id)).toBe(false);

    const trialBalance = await getTrialBalance();
    const tbRow = trialBalance.accounts.find((a) => a.accountId === obe!.id);
    expect(tbRow).toBeTruthy();
    expect(trialBalance.isBalanced).toBe(true);
  });
});

describe('Sales Revenue selector visibility', () => {
  it('is selectable in voucher lists, manage lists, and account balance report', async () => {
    const salesRevenue = await prisma.$transaction((tx) => ensureSalesRevenueAccount(tx));
    expect(salesRevenue.excludeFromSelectors).toBe(false);

    const selectorAccounts = await listAccounts({ forSelectors: true });
    expect(selectorAccounts.items.some((a) => a.id === salesRevenue.id)).toBe(true);

    const manageAccounts = await listAccounts({ forSelectors: false });
    expect(manageAccounts.items.some((a) => a.id === salesRevenue.id)).toBe(true);

    const date = new Date();
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const balances = await getAccountBalancesAsOf({
      date: iso,
      categoryId: salesRevenue.categoryId,
      side: 'both',
    });
    expect(balances.accounts.some((a) => a.accountId === salesRevenue.id)).toBe(true);
  });
});
