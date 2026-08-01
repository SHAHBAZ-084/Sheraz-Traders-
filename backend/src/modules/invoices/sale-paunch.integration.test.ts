import { AccountType, BoriThelaMode } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import {
  ensureSalePaunchAccounts,
  getTrialBalance,
  KACHI_MAAL_CATEGORY_NAMES,
} from '../accounting/accounting.service';
import { createProduct, MAAL_KHATA_CATEGORY_NAME } from '../products/products.service';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { updateSystemPreferences } from '../preferences/preferences.service';
import { createSalePaunchInvoice } from './sale-paunch.service';

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

describe('Sale Paunch posting', () => {
  let userId: number;
  let salePartyId: number;
  let wheatMaalKhataId: number;
  let paunchRevenueId: number;
  let invoiceDate: string;

  beforeAll(async () => {
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;

    await updateSystemPreferences({ daamiPercent: 1.6, kaatPercent: 2 });

    await prisma.$transaction(async (tx) => {
      const system = await ensureSalePaunchAccounts(tx);
      paunchRevenueId = system.paunchRevenue.id;
    });

    salePartyId = (await ensureAccountInCategory(
      KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
      'Sale Party SP Test',
      AccountType.ASSET,
      'SP-PARTY-1',
    )).id;

    const wheat = await createProduct({ name: `Wheat SP Test ${Date.now()}` });
    expect(wheat.account.categoryId).toBeTruthy();
    const category = await prisma.accountCategory.findUnique({ where: { id: wheat.account.categoryId } });
    expect(category?.name).toBe(MAAL_KHATA_CATEGORY_NAME);
    wheatMaalKhataId = wheat.accountId;
  });

  it('posts balanced SALE_PAUNCH voucher with maal khata credit, paunch revenue, and sale party debit', async () => {
    const invoice = await createSalePaunchInvoice({
      invoiceDate,
      salePartyAccountId: salePartyId,
      billNo: 'SP-BILL-1',
      lines: [
        {
          maalKhataAccountId: wheatMaalKhataId,
          boriOrThelaMode: BoriThelaMode.BORI,
          bagCount: 10,
          thelaCount: 0,
          compWeightKg: 1000,
          upperRatePerMaund: 2000,
          lowerRatePerMaund: 2500,
          kanta: 400,
          dammiChecked: true,
        },
      ],
      createdById: userId,
    });

    expect(invoice.reference).toMatch(/^SP-/);
    expect(invoice.vouchers).toHaveLength(1);

    const voucher = invoice.vouchers[0]!.voucher;
    expect(voucher.type).toBe('SALE_PAUNCH');
    expect(voucher.reference).toBe('SP-BILL-1');

    const legs = await voucherLegs(voucher.id);
    expect(legs).toEqual(
      expect.arrayContaining([
        { accountId: wheatMaalKhataId, type: 'CREDIT', amount: 49_600 },
        { accountId: paunchRevenueId, type: 'CREDIT', amount: 12_900 },
        { accountId: salePartyId, type: 'DEBIT', amount: 63_293.6 },
      ]),
    );

    const totalDebit = legs.filter((leg) => leg.type === 'DEBIT').reduce((s, leg) => s + leg.amount, 0);
    const totalCredit = legs.filter((leg) => leg.type === 'CREDIT').reduce((s, leg) => s + leg.amount, 0);
    expect(totalDebit).toBe(63_293.6);
    expect(totalCredit).toBe(63_293.6);

    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);
  });

  it('credits misc and increases sale party debit (opposite of tax/bilty party credit)', async () => {
    let miscId: number;
    await prisma.$transaction(async (tx) => {
      miscId = (await ensureSalePaunchAccounts(tx)).misc.id;
    });

    const invoice = await createSalePaunchInvoice({
      invoiceDate,
      salePartyAccountId: salePartyId,
      miscAmount: 200,
      lines: [
        {
          maalKhataAccountId: wheatMaalKhataId,
          boriOrThelaMode: BoriThelaMode.BORI,
          bagCount: 10,
          thelaCount: 0,
          compWeightKg: 1000,
          upperRatePerMaund: 2000,
          lowerRatePerMaund: 2500,
          kanta: 400,
          dammiChecked: true,
        },
      ],
      createdById: userId,
    });

    const legs = await voucherLegs(invoice.vouchers[0]!.voucher.id);
    expect(legs).toEqual(
      expect.arrayContaining([
        { accountId: miscId!, type: 'CREDIT', amount: 200 },
        { accountId: salePartyId, type: 'DEBIT', amount: 63_493.6 },
      ]),
    );
    expect(legs.some((leg) => leg.accountId === salePartyId && leg.type === 'CREDIT' && leg.amount === 200)).toBe(
      false,
    );
  });
});
