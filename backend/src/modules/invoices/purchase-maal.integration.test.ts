import { AccountType, BoriThelaMode } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import {
  ensureKachiMaalAccounts,
  getTrialBalance,
  KACHI_MAAL_CATEGORY_NAMES,
} from '../accounting/accounting.service';
import { createProduct, MAAL_KHATA_CATEGORY_NAME } from '../products/products.service';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { updateSystemPreferences } from '../preferences/preferences.service';
import { createPurchaseMaalInvoice } from './purchase-maal.service';

async function ensureAccountInCategory(categoryName: string, accountName: string, type: AccountType, code: string) {
  const category = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: categoryName },
  });
  if (!category) throw new Error(`Category missing: ${categoryName}`);

  let account = await prisma.account.findFirst({
    where: { isActive: true, name: accountName, categoryId: category.id },
    include: { ledger: true },
  });
  if (!account) {
    account = await prisma.account.create({
      data: { categoryId: category.id, name: accountName, code, type },
      include: { ledger: true },
    });
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
  } else if (!account.ledger) {
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
  }
  return account;
}

async function voucherLegs(voucherId: number) {
  const entries = await prisma.ledgerEntry.findMany({
    where: { voucherId, isReversal: false },
    include: { ledger: { include: { account: true } } },
    orderBy: { id: 'asc' },
  });
  return entries.map((entry) => ({
    accountId: entry.ledger.accountId,
    type: entry.type,
    amount: Number(entry.amount),
  }));
}

describe('Purchase Maal posting', () => {
  let userId: number;
  let partyAId: number;
  let commissionId: number;
  let wheatProductId: number;
  let wheatMaalKhataId: number;
  let invoiceDate: string;

  beforeAll(async () => {
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;

    await updateSystemPreferences({ daamiPercent: 1.6, mazduriPercent: 2, marketFeeRate: 2 });

    await prisma.$transaction(async (tx) => {
      const system = await ensureKachiMaalAccounts(tx);
      commissionId = system.commission.id;
    });

    partyAId = (await ensureAccountInCategory(
      KACHI_MAAL_CATEGORY_NAMES.EXT_PURCHASE,
      'Party A PM',
      AccountType.LIABILITY,
      'PM-PARTY-A',
    )).id;

    const wheat = await createProduct({ name: `Wheat PM Test ${Date.now()}` });
    expect(wheat.account.categoryId).toBeTruthy();
    const category = await prisma.accountCategory.findUnique({ where: { id: wheat.account.categoryId } });
    expect(category?.name).toBe(MAAL_KHATA_CATEGORY_NAME);
    wheatProductId = wheat.id;
    wheatMaalKhataId = wheat.accountId;
  });

  it('posts dammi to the purchase party (not Commission) and Products ledger absorbs the buyer dammi debit', async () => {
    const invoice = await createPurchaseMaalInvoice({
      invoiceDate,
      billNo: 'PM-BILL-1',
      productId: wheatProductId,
      marketFeeEnabled: false,
      mazduriEnabled: false,
      lowerBardanaMode: null,
      lowerBardanaQty: null,
      lowerBardanaRate: null,
      lines: [
        {
          partyAccountId: partyAId,
          boriOrThelaMode: BoriThelaMode.BORI,
          bagCount: 10,
          bhartii: 100,
          dharanCount: 0,
          looseKg: 0,
          ratePerMaund: 2000,
          dammiChecked: true,
        },
      ],
      createdById: userId,
    });

    expect(invoice.reference).toMatch(/^PM-/);
    expect(Number(invoice.total)).toBe(50_800);
    expect(invoice.legacyInventoryPosting).toBe(false);
    expect(invoice.productId).toBeTruthy();
    expect(invoice.debitAccountId).toBe(wheatMaalKhataId);
    expect(invoice.vouchers).toHaveLength(1);

    const voucher = invoice.vouchers[0]!.voucher;
    expect(voucher.type).toBe('PURCHASE_MAAL');
    expect(voucher.reference).toBe('PM-BILL-1');

    const legs = await voucherLegs(voucher.id);
    expect(legs).toEqual(
      expect.arrayContaining([
        { accountId: wheatMaalKhataId, type: 'DEBIT', amount: 50_800 },
        { accountId: partyAId, type: 'CREDIT', amount: 50_800 },
      ]),
    );

    const commissionCredits = legs.filter(
      (leg) => leg.type === 'CREDIT' && leg.accountId === commissionId,
    );
    expect(commissionCredits).toHaveLength(0);

    const partyCredits = legs.filter(
      (leg) => leg.type === 'CREDIT' && leg.accountId === partyAId,
    );
    expect(partyCredits).toHaveLength(1);
    expect(partyCredits[0]!.amount).toBe(50_800);

    const maalKhataDebits = legs.filter(
      (leg) => leg.type === 'DEBIT' && leg.accountId === wheatMaalKhataId,
    );
    expect(maalKhataDebits).toHaveLength(1);
    expect(maalKhataDebits[0]!.amount).toBe(50_800);

    const totalDebit = legs.filter((leg) => leg.type === 'DEBIT').reduce((s, leg) => s + leg.amount, 0);
    const totalCredit = legs.filter((leg) => leg.type === 'CREDIT').reduce((s, leg) => s + leg.amount, 0);
    expect(totalDebit).toBe(50_800);
    expect(totalCredit).toBe(50_800);

    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);
  });
});
