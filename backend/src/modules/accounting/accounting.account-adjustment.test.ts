import { LedgerEntryType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear, voucherDateOutsideActiveYear } from '../../test-helpers/financial-year';
import {
  OPENING_BALANCE_EQUITY_ACCOUNT_NAME,
  createAccount,
  createAccountAdjustment,
  verifyLedgerIntegrity,
} from './accounting.service';

describe('createAccountAdjustment', () => {
  it('posts Dr adjustment on account and Cr on Opening Balance Equity', async () => {
    const bankCategory = await prisma.accountCategory.findFirst({
      where: { isActive: true, name: 'Bank' },
    });
    if (!bankCategory) throw new Error('Bank category missing');

    const account = await createAccount({
      categoryId: bankCategory.id,
      name: `Account Adj Dr ${Date.now()}`,
      openingBalance: 1000,
      openingBalanceSide: 'DR',
    });

    const beforeBalance = Number(account.ledger?.balance ?? 0);
    const adjustmentDate = await voucherDateInActiveYear();

    const result = await createAccountAdjustment({
      adjustmentDate,
      accountId: account.id,
      amount: 500,
      side: 'DR',
    });

    expect(result.balance).toBeCloseTo(beforeBalance + 500, 2);

    const entry = await prisma.ledgerEntry.findFirst({
      where: {
        ledger: { accountId: account.id },
        notes: 'Account Adjustment',
      },
      orderBy: { id: 'desc' },
    });
    expect(entry).toBeTruthy();
    expect(entry!.type).toBe(LedgerEntryType.DEBIT);
    expect(Number(entry!.amount)).toBe(500);

    const obe = await prisma.account.findFirst({
      where: { name: OPENING_BALANCE_EQUITY_ACCOUNT_NAME },
      include: { ledger: true },
    });
    const obeCredit = await prisma.ledgerEntry.findFirst({
      where: {
        ledgerId: obe!.ledger!.id,
        type: LedgerEntryType.CREDIT,
        notes: { contains: account.name },
      },
      orderBy: { id: 'desc' },
    });
    expect(obeCredit).toBeTruthy();
    expect(Number(obeCredit!.amount)).toBe(500);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('posts Cr adjustment on account and Dr on Opening Balance Equity', async () => {
    const bankCategory = await prisma.accountCategory.findFirst({
      where: { isActive: true, name: 'Bank' },
    });
    if (!bankCategory) throw new Error('Bank category missing');

    const account = await createAccount({
      categoryId: bankCategory.id,
      name: `Account Adj Cr ${Date.now()}`,
      openingBalance: 2000,
      openingBalanceSide: 'DR',
    });

    const beforeBalance = Number(account.ledger?.balance ?? 0);
    const adjustmentDate = await voucherDateInActiveYear();

    const result = await createAccountAdjustment({
      adjustmentDate,
      accountId: account.id,
      amount: 300,
      side: 'CR',
    });

    expect(result.balance).toBeCloseTo(beforeBalance - 300, 2);

    const entry = await prisma.ledgerEntry.findFirst({
      where: {
        ledger: { accountId: account.id },
        notes: 'Account Adjustment',
      },
      orderBy: { id: 'desc' },
    });
    expect(entry!.type).toBe(LedgerEntryType.CREDIT);
  });

  it('rejects Product/Maal Khata accounts', async () => {
    const productsCategory = await prisma.accountCategory.findFirst({
      where: { isActive: true, name: 'Products' },
    });
    if (!productsCategory) throw new Error('Products category missing');

    const productAccount = await prisma.account.findFirst({
      where: { categoryId: productsCategory.id, isActive: true },
      include: { ledger: true },
    });
    if (!productAccount?.ledger) throw new Error('Product account missing');

    const adjustmentDate = await voucherDateInActiveYear();

    await expect(
      createAccountAdjustment({
        adjustmentDate,
        accountId: productAccount.id,
        amount: 100,
        side: 'DR',
      }),
    ).rejects.toThrow(/stock adjustment/i);
  });

  it('rejects adjustment dated outside the active financial year', async () => {
    const bankCategory = await prisma.accountCategory.findFirst({
      where: { isActive: true, name: 'Bank' },
    });
    if (!bankCategory) throw new Error('Bank category missing');

    const account = await createAccount({
      categoryId: bankCategory.id,
      name: `Account Adj FY ${Date.now()}`,
    });

    const active = await prisma.financialYear.findFirst({
      where: { status: 'ACTIVE' },
    });
    if (!active) throw new Error('No active financial year');
    const beforeStart = new Date(active.startDate);
    beforeStart.setDate(beforeStart.getDate() - 1);
    const outsideDate = `${beforeStart.getFullYear()}-${String(beforeStart.getMonth() + 1).padStart(2, '0')}-${String(beforeStart.getDate()).padStart(2, '0')}`;

    await expect(
      createAccountAdjustment({
        adjustmentDate: outsideDate,
        accountId: account.id,
        amount: 100,
        side: 'DR',
      }),
    ).rejects.toThrow(/financial year/i);
  });
});
