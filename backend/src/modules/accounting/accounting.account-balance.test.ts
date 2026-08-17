import { describe, expect, it } from 'vitest';
import { bootstrapChartOfAccounts, createAccount, getAccountBalancesAsOf } from './accounting.service';
import { createProduct, createProductCategory } from '../products/products.service';

function todayIsoDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('getAccountBalancesAsOf pagination totals', () => {
  it('returns identical grand totals on every page and full category group totals', async () => {
    await bootstrapChartOfAccounts();

    const expenseCat = await import('../../lib/prisma').then(({ prisma }) =>
      prisma.accountCategory.findFirst({ where: { name: 'Expenses' } }),
    );
    if (!expenseCat) throw new Error('Expenses category missing');

    const stamp = Date.now();
    for (const amount of [10000, 20000, 30000, 40000, 50000]) {
      await createAccount({
        categoryId: expenseCat.id,
        name: `AB Paginate ${stamp} ${amount}`,
        openingBalance: amount,
        openingBalanceSide: 'DR',
      });
    }

    const date = todayIsoDate();
    const full = await getAccountBalancesAsOf({ date, categoryId: expenseCat.id, side: 'both' });
    const page1 = await getAccountBalancesAsOf({
      date,
      categoryId: expenseCat.id,
      side: 'both',
      limit: 2,
      offset: 0,
    });
    const page2 = await getAccountBalancesAsOf({
      date,
      categoryId: expenseCat.id,
      side: 'both',
      limit: 2,
      offset: 2,
    });

    expect(full.totalCount).toBeGreaterThanOrEqual(5);
    expect(page1.accounts).toHaveLength(2);
    expect(page2.accounts).toHaveLength(2);

    expect(page1.totalDebit).toBeCloseTo(full.totalDebit, 2);
    expect(page2.totalDebit).toBeCloseTo(full.totalDebit, 2);
    expect(page1.totalCredit).toBe(full.totalCredit);
    expect(page2.totalCredit).toBe(full.totalCredit);

    const pageSliceDebit = page1.accounts.reduce((sum, row) => sum + row.debit, 0);
    expect(pageSliceDebit).toBeLessThanOrEqual(full.totalDebit);
    if (full.totalCount > 2) {
      expect(pageSliceDebit).toBeLessThan(full.totalDebit);
    }

    const allGroups = await getAccountBalancesAsOf({ date, side: 'both' });
    const expenseGroup = allGroups.groups.find((g) => g.categoryId === expenseCat.id);
    expect(expenseGroup).toBeTruthy();
    expect(expenseGroup!.totalDebit).toBeCloseTo(full.totalDebit, 2);
    expect(expenseGroup!.totalCredit).toBe(full.totalCredit);
  });

  it('restricts balances to product ledger accounts in the selected product category', async () => {
    await bootstrapChartOfAccounts();

    const stamp = Date.now();
    const fertilizer = await createProductCategory(`Fertilizer AB ${stamp}`);
    const pesticide = await createProductCategory(`Pesticide AB ${stamp}`);

    const fertProduct = await createProduct({
      name: `Fert Product AB ${stamp}`,
      categoryId: fertilizer.id,
    });
    const pestProduct = await createProduct({
      name: `Pest Product AB ${stamp}`,
      categoryId: pesticide.id,
    });

    const { prisma } = await import('../../lib/prisma');
    const fertAccount = await prisma.account.findFirst({
      where: { id: fertProduct.accountId },
    });
    const pestAccount = await prisma.account.findFirst({
      where: { id: pestProduct.accountId },
    });
    if (!fertAccount || !pestAccount) {
      throw new Error('Product ledger accounts missing');
    }

    const date = todayIsoDate();
    const filtered = await getAccountBalancesAsOf({
      date,
      productCategoryId: fertilizer.id,
      side: 'both',
    });
    const accountIds = filtered.accounts.map((row) => row.accountId);

    expect(accountIds).toContain(fertAccount.id);
    expect(accountIds).not.toContain(pestAccount.id);
    expect(filtered.productCategoryId).toBe(fertilizer.id);
    expect(filtered.totalCount).toBe(filtered.accounts.length);
    expect(filtered.totalDebit + filtered.totalCredit).toBeGreaterThanOrEqual(0);
  });

  it('rejects using account category and product category filters together', async () => {
    await bootstrapChartOfAccounts();
    const expenseCat = await import('../../lib/prisma').then(({ prisma }) =>
      prisma.accountCategory.findFirst({ where: { name: 'Expenses' } }),
    );
    const productCat = await createProductCategory(`Reject Both ${Date.now()}`);
    if (!expenseCat) throw new Error('Expenses category missing');

    await expect(
      getAccountBalancesAsOf({
        date: todayIsoDate(),
        categoryId: expenseCat.id,
        productCategoryId: productCat.id,
        side: 'both',
      }),
    ).rejects.toThrow(/not both/i);
  });
});
