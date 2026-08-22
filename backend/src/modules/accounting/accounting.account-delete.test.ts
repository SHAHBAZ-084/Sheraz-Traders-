import { VoucherType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { createStore } from '../stores/stores.service';
import { createProduct, createStockAdjustment } from '../products/products.service';
import {
  bootstrapChartOfAccounts,
  createAccount,
  createAccountAdjustment,
  createVoucher,
  softDeleteAccount,
  updateAccount,
  verifyLedgerIntegrity,
} from './accounting.service';

async function expenseCategoryId() {
  const category = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: 'Expenses' },
  });
  if (!category) throw new Error('Expenses category missing');
  return category.id;
}

async function bankCategoryId() {
  const category = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: 'Bank' },
  });
  if (!category) throw new Error('Bank category missing');
  return category.id;
}

async function counterpartyAccount(namePrefix: string) {
  return createAccount({
    categoryId: await expenseCategoryId(),
    name: `${namePrefix} ${Date.now()}`,
  });
}

describe('softDeleteAccount (hard delete when safe)', () => {
  it('hard-deletes a fresh account with no ledger activity', async () => {
    await bootstrapChartOfAccounts();
    const account = await createAccount({
      categoryId: await bankCategoryId(),
      name: `Delete Fresh ${Date.now()}`,
    });
    const id = account.id;

    await softDeleteAccount(id);

    expect(await prisma.account.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.ledger.findUnique({ where: { accountId: id } })).toBeNull();

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('hard-deletes when opening balance was fully reversed via adjustments (zero net, no vouchers)', async () => {
    await bootstrapChartOfAccounts();
    const adjustmentDate = await voucherDateInActiveYear();
    const account = await createAccount({
      categoryId: await bankCategoryId(),
      name: `Delete OB Reversed ${Date.now()}`,
      openingBalance: 1000,
      openingBalanceSide: 'DR',
    });
    expect(Number(account.ledger?.balance ?? 0)).toBe(1000);

    await createAccountAdjustment({
      adjustmentDate,
      accountId: account.id,
      amount: 1000,
      side: 'CR',
    });
    expect(Number((await prisma.ledger.findUnique({ where: { accountId: account.id } }))!.balance)).toBe(0);

    const id = account.id;
    await softDeleteAccount(id);

    expect(await prisma.account.findUnique({ where: { id } })).toBeNull();
    const obe = await prisma.account.findFirst({
      where: { name: 'Opening Balance Equity' },
      include: { ledger: true },
    });
    const orphanOffsets = await prisma.ledgerEntry.count({
      where: {
        ledgerId: obe!.ledger!.id,
        notes: { contains: `offset for ${account.name}` },
      },
    });
    expect(orphanOffsets).toBe(0);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('auto-reverses and hard-deletes an account with only a non-zero opening balance from creation', async () => {
    await bootstrapChartOfAccounts();
    const account = await createAccount({
      categoryId: await bankCategoryId(),
      name: `Delete OB Only ${Date.now()}`,
      openingBalance: 750,
      openingBalanceSide: 'DR',
    });
    expect(Number(account.ledger?.balance ?? 0)).toBe(750);

    const obeBefore = await prisma.account.findFirst({
      where: { name: 'Opening Balance Equity' },
      include: { ledger: true },
    });
    const obeBalanceBefore = Number(obeBefore!.ledger!.balance);

    const id = account.id;
    await softDeleteAccount(id);

    expect(await prisma.account.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.ledger.findUnique({ where: { accountId: id } })).toBeNull();

    const obeAfter = await prisma.ledger.findUnique({ where: { id: obeBefore!.ledger!.id } });
    expect(Number(obeAfter!.balance)).toBeCloseTo(obeBalanceBefore + 750, 2);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('auto-reverses and hard-deletes an account with only account-adjustment history (non-zero)', async () => {
    await bootstrapChartOfAccounts();
    const adjustmentDate = await voucherDateInActiveYear();
    const account = await createAccount({
      categoryId: await bankCategoryId(),
      name: `Delete Adj Only ${Date.now()}`,
    });

    await createAccountAdjustment({
      adjustmentDate,
      accountId: account.id,
      amount: 420,
      side: 'DR',
    });
    expect(Number((await prisma.ledger.findUnique({ where: { accountId: account.id } }))!.balance)).toBe(420);

    const id = account.id;
    await softDeleteAccount(id);

    expect(await prisma.account.findUnique({ where: { id } })).toBeNull();

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('auto-reverses and hard-deletes a product account with only stock-adjustment history (non-zero)', async () => {
    await bootstrapChartOfAccounts();
    const store = await createStore(`Delete Stock Adj Store ${Date.now()}`);
    const product = await createProduct({
      name: `Delete Stock Adj Product ${Date.now()}`,
      openingStock: 0,
    });
    const adjustmentDate = await voucherDateInActiveYear();

    await createStockAdjustment({
      adjustmentDate,
      productId: product.id,
      storeId: store.id,
      quantity: 25,
      rate: 100,
    });

    const ledgerBefore = await prisma.ledger.findUnique({ where: { accountId: product.accountId } });
    expect(Number(ledgerBefore!.balance)).toBe(2500);

    await softDeleteAccount(product.accountId);

    expect(await prisma.product.findUnique({ where: { id: product.id } })).toBeNull();
    expect(await prisma.account.findUnique({ where: { id: product.accountId } })).toBeNull();

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('blocks delete when opening balance is paired with a real voucher transaction', async () => {
    await bootstrapChartOfAccounts();
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!admin) throw new Error('Admin missing');

    const bank = await createAccount({
      categoryId: await bankCategoryId(),
      name: `Delete Mixed Hist ${Date.now()}`,
      openingBalance: 500,
      openingBalanceSide: 'DR',
    });
    const expense = await counterpartyAccount('Delete Mixed Exp');
    const invoiceDate = await voucherDateInActiveYear();

    await createVoucher({
      type: VoucherType.PAYMENT,
      debitAccountId: expense.id,
      creditAccountId: bank.id,
      amount: 100,
      date: invoiceDate,
      reference: `DEL-MIX-${Date.now()}`,
      createdById: admin.id,
    });

    await expect(softDeleteAccount(bank.id)).rejects.toThrow(/transaction history/i);
    expect(await prisma.account.findUnique({ where: { id: bank.id } })).toBeTruthy();
  });

  it('blocks delete when balance is zero but real vouchers posted against the account', async () => {
    await bootstrapChartOfAccounts();
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!admin) throw new Error('Admin missing');

    const bank = await createAccount({
      categoryId: await bankCategoryId(),
      name: `Delete Voucher Zero ${Date.now()}`,
    });
    const expense = await counterpartyAccount('Delete Voucher Exp');
    const invoiceDate = await voucherDateInActiveYear();

    await createVoucher({
      type: VoucherType.PAYMENT,
      debitAccountId: expense.id,
      creditAccountId: bank.id,
      amount: 400,
      date: invoiceDate,
      reference: `DEL-PAY-${Date.now()}`,
      createdById: admin.id,
    });
    await createVoucher({
      type: VoucherType.RECEIPT,
      debitAccountId: bank.id,
      creditAccountId: expense.id,
      amount: 400,
      date: invoiceDate,
      reference: `DEL-REC-${Date.now()}`,
      createdById: admin.id,
    });

    expect(Number((await prisma.ledger.findUnique({ where: { accountId: bank.id } }))!.balance)).toBe(0);

    await expect(softDeleteAccount(bank.id)).rejects.toThrow(/transaction history/i);
    expect(await prisma.account.findUnique({ where: { id: bank.id } })).toBeTruthy();
  });

  it('still allows rename via updateAccount when delete is blocked', async () => {
    await bootstrapChartOfAccounts();
    const account = await createAccount({
      categoryId: await bankCategoryId(),
      name: `Delete Edit Only ${Date.now()}`,
      openingBalance: 250,
      openingBalanceSide: 'DR',
    });

    const renamed = await updateAccount(account.id, { name: `Renamed ${Date.now()}` });
    expect(renamed.name).toMatch(/^Renamed /);
    expect(await prisma.account.findUnique({ where: { id: account.id } })).toBeTruthy();
  });

  it('blocks Inventory and product accounts with real transaction history', async () => {
    await bootstrapChartOfAccounts();

    const inventory = await prisma.account.findFirst({
      where: { name: 'Inventory', isActive: true },
    });
    if (inventory) {
      await expect(softDeleteAccount(inventory.id)).rejects.toThrow(/Inventory account cannot be deleted/i);
    }

    const store = await createStore(`Delete Block Store ${Date.now()}`);
    const product = await createProduct({
      name: `Delete Block Product ${Date.now()}`,
      openingStock: 5,
      openingStockRate: 100,
      openingStoreId: store.id,
    });
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!admin) throw new Error('Admin missing');
    const expense = await counterpartyAccount('Delete Block Exp');
    const invoiceDate = await voucherDateInActiveYear();

    await createVoucher({
      type: VoucherType.JOURNAL,
      debitAccountId: expense.id,
      creditAccountId: product.accountId,
      amount: 50,
      date: invoiceDate,
      reference: `DEL-PROD-${Date.now()}`,
      createdById: admin.id,
    });

    await expect(softDeleteAccount(product.accountId)).rejects.toThrow(/transaction history|product with transaction/i);
  });
});
