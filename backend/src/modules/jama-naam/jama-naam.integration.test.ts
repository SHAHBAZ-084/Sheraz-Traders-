import { AccountType } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { KACHI_MAAL_CATEGORY_NAMES } from '../accounting/accounting.service';
import { createProduct } from '../products/products.service';
import { getCurrentStockBalance } from '../stock/stock.service';
import { createStore } from '../stores/stores.service';
import {
  createJamaNaamEntry,
  listJamaNaamEntries,
  settleJamaNaamEntry,
} from './jama-naam.service';

async function ensureAccountInCategory(
  categoryName: string,
  accountName: string,
  type: AccountType,
  code: string,
) {
  let category = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: categoryName },
  });
  if (!category) {
    category = await prisma.accountCategory.create({
      data: { name: categoryName, isActive: true },
    });
  }

  let account = await prisma.account.findFirst({
    where: { code },
    include: { ledger: true, category: true },
  });
  if (!account) {
    account = await prisma.account.create({
      data: { categoryId: category.id, name: accountName, code, type },
      include: { ledger: true, category: true },
    });
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
  } else {
    if (account.categoryId !== category.id || !account.isActive) {
      await prisma.account.update({
        where: { id: account.id },
        data: { categoryId: category.id, isActive: true },
      });
      account = await prisma.account.findUniqueOrThrow({
        where: { id: account.id },
        include: { ledger: true, category: true },
      });
    }
    if (!account.ledger) {
      await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
    }
  }
  return account;
}

async function ledgerBalance(accountId: number) {
  const ledger = await prisma.ledger.findUnique({ where: { accountId } });
  return ledger ? Number(ledger.balance) : 0;
}

describe('Jama Naam register (isolated from stock and ledger)', () => {
  let partyId: number;
  let productId: number;
  let storeId: number;
  let entryDate: string;

  beforeAll(async () => {
    entryDate = new Date().toISOString().slice(0, 10);

    partyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
        'Sale Party Jama Naam Test',
        AccountType.ASSET,
        'JN-PARTY-TEST',
      )
    ).id;

    productId = (await createProduct({ name: `Jama Naam Product ${Date.now()}` })).id;
    storeId = (await createStore(`Jama Naam Store ${Date.now()}`)).id;
  });

  it('creates product entries without changing stock or ledger balances', async () => {
    const stockBefore = await getCurrentStockBalance(productId, storeId);
    const ledgerBefore = await ledgerBalance(partyId);

    const created = await createJamaNaamEntry({
      partyId,
      productId,
      quantity: 12,
      direction: 'JAMA',
      date: entryDate,
      notes: 'Test borrow',
    });

    expect(created.productName).toBeTruthy();
    expect(created.quantity).toBe(12);
    expect(created.amount).toBeNull();

    expect(await getCurrentStockBalance(productId, storeId)).toBe(stockBefore);
    expect(await ledgerBalance(partyId)).toBe(ledgerBefore);

    await settleJamaNaamEntry(created.id);
  });

  it('creates amount-only entries without changing ledger balances', async () => {
    const ledgerBefore = await ledgerBalance(partyId);

    const created = await createJamaNaamEntry({
      partyId,
      amount: 5000,
      direction: 'NAAM',
      date: entryDate,
      notes: 'Borrowed cash',
    });

    expect(created.productId).toBeNull();
    expect(created.productName).toBeNull();
    expect(created.quantity).toBeNull();
    expect(created.amount).toBe(5000);

    expect(await ledgerBalance(partyId)).toBe(ledgerBefore);

    const listed = await listJamaNaamEntries();
    expect(listed.some((row) => row.id === created.id)).toBe(true);

    await settleJamaNaamEntry(created.id);
  });

  it('rejects entries with neither product line nor amount', async () => {
    await expect(
      createJamaNaamEntry({
        partyId,
        direction: 'JAMA',
        date: entryDate,
      }),
    ).rejects.toThrow('Enter product with quantity, or an amount');
  });
});
