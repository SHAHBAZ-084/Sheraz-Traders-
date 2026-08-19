import { AccountType, VoucherType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { createProduct } from '../products/products.service';
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

  it('blocks delete when balance is non-zero', async () => {
    await bootstrapChartOfAccounts();
    const account = await createAccount({
      categoryId: await bankCategoryId(),
      name: `Delete NonZero ${Date.now()}`,
      openingBalance: 500,
      openingBalanceSide: 'DR',
    });

    await expect(softDeleteAccount(account.id)).rejects.toThrow(/non-zero balance/i);
    expect(await prisma.account.findUnique({ where: { id: account.id } })).toBeTruthy();
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

    await expect(softDeleteAccount(account.id)).rejects.toThrow(/non-zero balance/i);

    const renamed = await updateAccount(account.id, { name: `Renamed ${Date.now()}` });
    expect(renamed.name).toMatch(/^Renamed /);
  });

  it('blocks Inventory and Maal-Khata-linked accounts', async () => {
    await bootstrapChartOfAccounts();

    const inventory = await prisma.account.findFirst({
      where: { name: 'Inventory', isActive: true },
    });
    if (inventory) {
      await expect(softDeleteAccount(inventory.id)).rejects.toThrow(/Inventory account cannot be deleted/i);
    }

    const product = await createProduct({ name: `Delete Block Product ${Date.now()}` });
    await expect(softDeleteAccount(product.accountId)).rejects.toThrow(/product/i);
  });
});
