import { AccountType } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import {
  cancelVoucher,
  createVoucher,
  ensureKachiMaalAccounts,
  getTrialBalance,
  KACHI_MAAL_CATEGORY_NAMES,
  previewNextVoucherNumber,
} from '../accounting/accounting.service';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { updateSystemPreferences } from '../preferences/preferences.service';
import {
  computeKachiMaalInvoiceTotals,
  computeKachiMaalRow,
} from './kachi-maal.calculations';
import { createKachiMaalInvoice } from './kachi-maal.service';

async function ensureAccountInCategory(categoryName: string, accountName: string, type: AccountType, code: string) {
  const targetCategoryName = (categoryName === 'Ext. Purchase Party' || categoryName === 'Int. Purchase Party')
    ? KACHI_MAAL_CATEGORY_NAMES.PURCHASE_PARTY
    : categoryName;

  const category = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: targetCategoryName },
  });
  if (!category) throw new Error(`Category missing: ${categoryName}`);

  let account = await prisma.account.findFirst({
    where: { isActive: true, code },
    include: { ledger: true, category: true },
  });
  if (!account) {
    account = await prisma.account.create({
      data: { categoryId: category.id, name: accountName, code, type },
      include: { ledger: true, category: true },
    });
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
  } else {
    if (account.categoryId !== category.id) {
      await prisma.account.update({
        where: { id: account.id },
        data: { categoryId: category.id },
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

async function snapshotBalances(accountIds: number[]) {
  const balances = new Map<number, number>();
  for (const accountId of accountIds) {
    balances.set(accountId, await ledgerBalance(accountId));
  }
  return balances;
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

describe('Kachi Maal Test 1 — minimal case', () => {
  let userId: number;
  let partyAId: number;
  let traderXId: number;
  let mazduriId: number;
  let brokerId: number;
  let commissionId: number;
  let invoiceDate: string;

  const prefs = {
    daamiPercent: 1.6,
    paleDariPercent: 0.85,
    brokeryPercent: 0.15,
    marketFeeRate: 0,
  };

  beforeAll(async () => {
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;

    await updateSystemPreferences(prefs);

    await prisma.$transaction(async (tx) => {
      const system = await ensureKachiMaalAccounts(tx);
      mazduriId = system.mazduri.id;
      brokerId = system.broker.id;
      commissionId = system.commission.id;
    });

    const partyA = await ensureAccountInCategory(
      KACHI_MAAL_CATEGORY_NAMES.EXT_PURCHASE,
      'Party A',
      AccountType.LIABILITY,
      'KM-PARTY-A',
    );
    partyAId = partyA.id;

    const traderX = await ensureAccountInCategory(
      KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
      'Trader X',
      AccountType.ASSET,
      'KM-TRADER-X',
    );
    traderXId = traderX.id;
  });

  it('computes row and invoice totals exactly', () => {
    const row = computeKachiMaalRow(
      {
        bagCount: 10,
        bhartii: 100,
        dharanCount: 0,
        looseKg: 0,
        ratePerMaund: 2000,
      },
      prefs,
    );

    expect(row.totalWeightKg).toBe(1000);
    expect(row.amount).toBe(50_000);
    expect(row.netCreditToParty).toBe(49_500);

    const totals = computeKachiMaalInvoiceTotals(
      [{ ...row, bhartii: 100 }],
      prefs,
      0,
    );

    expect(totals.totalPaleDari).toBe(425);
    expect(totals.totalBrokery).toBe(75);
    expect(totals.marketFeeAmount).toBe(0);
    expect(totals.profitAmount).toBe(800);
    expect(totals.totalDebitAmount).toBe(50_800);
  });

  it('posts one KACHI voucher with merged ledger entries', async () => {
    const tbBefore = await getTrialBalance();
    const imbalanceBefore = tbBefore.totalDebit - tbBefore.totalCredit;

    const invoice = await createKachiMaalInvoice({
      invoiceDate,
      billNo: 'KM-BILL-1',
      debitAccountId: traderXId,
      miscAmount: 0,
      lines: [
        {
          partyAccountId: partyAId,
          bagCount: 10,
          bhartii: 100,
          dharanCount: 0,
          looseKg: 0,
          ratePerMaund: 2000,
        },
      ],
      createdById: userId,
    });

    expect(invoice.status).toBe('POSTED');
    expect(Number(invoice.total)).toBe(50_800);
    expect(invoice.vouchers).toHaveLength(1);

    const voucher = invoice.vouchers[0]!.voucher;
    expect(voucher.type).toBe('KACHI');

    const legs = await voucherLegs(voucher.id);
    expect(legs).toEqual(
      expect.arrayContaining([
        { accountId: traderXId, type: 'DEBIT', amount: 50_800 },
        { accountId: partyAId, type: 'CREDIT', amount: 49_500 },
        { accountId: mazduriId, type: 'CREDIT', amount: 425 },
        { accountId: brokerId, type: 'CREDIT', amount: 75 },
        { accountId: commissionId, type: 'CREDIT', amount: 800 },
      ]),
    );

    const tb = await getTrialBalance();
    expect(tb.totalDebit - tb.totalCredit).toBeCloseTo(imbalanceBefore, 2);
  });
});

describe('Kachi Maal Test 2 — full case (two parties, market fee, misc)', () => {
  let userId: number;
  let partyAId: number;
  let partyBId: number;
  let traderXId: number;
  let mazduriId: number;
  let brokerId: number;
  let marketFeeId: number;
  let miscId: number;
  let commissionId: number;
  let invoiceDate: string;

  const prefs = {
    daamiPercent: 1.6,
    paleDariPercent: 0.85,
    brokeryPercent: 0.15,
    marketFeeRate: 2,
  };

  beforeAll(async () => {
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;

    await updateSystemPreferences(prefs);

    await prisma.$transaction(async (tx) => {
      const system = await ensureKachiMaalAccounts(tx);
      mazduriId = system.mazduri.id;
      brokerId = system.broker.id;
      marketFeeId = system.marketFee.id;
      miscId = system.misc.id;
      commissionId = system.commission.id;
    });

    partyAId = (await ensureAccountInCategory(
      KACHI_MAAL_CATEGORY_NAMES.EXT_PURCHASE,
      'Party A',
      AccountType.LIABILITY,
      'KM-PARTY-A',
    )).id;

    partyBId = (await ensureAccountInCategory(
      KACHI_MAAL_CATEGORY_NAMES.EXT_PURCHASE,
      'Party B',
      AccountType.LIABILITY,
      'KM-PARTY-B',
    )).id;

    traderXId = (await ensureAccountInCategory(
      KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
      'Trader X',
      AccountType.ASSET,
      'KM-TRADER-X',
    )).id;
  });

  it('computes two-row invoice totals exactly', () => {
    const row1 = computeKachiMaalRow(
      {
        bagCount: 10,
        bhartii: 100,
        dharanCount: 0,
        looseKg: 0,
        ratePerMaund: 2000,
      },
      prefs,
    );
    const row2 = computeKachiMaalRow(
      {
        bagCount: 5,
        bhartii: 120,
        dharanCount: 2,
        looseKg: 15,
        ratePerMaund: 1600,
      },
      prefs,
    );

    expect(row1.totalWeightKg).toBe(1000);
    expect(row1.amount).toBe(50_000);
    expect(row1.netCreditToParty).toBe(49_500);

    expect(row2.totalWeightKg).toBe(625);
    expect(row2.amount).toBe(25_000);
    expect(row2.netCreditToParty).toBe(24_750);

    const totals = computeKachiMaalInvoiceTotals(
      [
        { ...row1, bhartii: 100 },
        { ...row2, bhartii: 120 },
      ],
      prefs,
      200,
    );

    expect(totals.totalGoodsAmount).toBe(75_000);
    expect(totals.totalPaleDari).toBe(637.5);
    expect(totals.totalBrokery).toBe(112.5);
    expect(totals.totalCalculatedBags).toBeCloseTo(15.208333, 4);
    expect(totals.marketFeeAmount).toBe(30.42);
    expect(totals.profitAmount).toBe(1200);
    expect(totals.totalDebitAmount).toBe(76_430.42);
  });

  it('posts one KACHI voucher with merged ledger entries', async () => {
    const tbBefore = await getTrialBalance();
    const imbalanceBefore = tbBefore.totalDebit - tbBefore.totalCredit;

    const invoice = await createKachiMaalInvoice({
      invoiceDate,
      billNo: 'KM-BILL-2',
      debitAccountId: traderXId,
      miscAmount: 200,
      lines: [
        {
          partyAccountId: partyAId,
          bagCount: 10,
          bhartii: 100,
          dharanCount: 0,
          looseKg: 0,
          ratePerMaund: 2000,
        },
        {
          partyAccountId: partyBId,
          bagCount: 5,
          bhartii: 120,
          dharanCount: 2,
          looseKg: 15,
          ratePerMaund: 1600,
        },
      ],
      createdById: userId,
    });

    expect(invoice.status).toBe('POSTED');
    expect(Number(invoice.total)).toBe(76_430.42);
    expect(invoice.vouchers).toHaveLength(1);

    const voucher = invoice.vouchers[0]!.voucher;
    expect(voucher.type).toBe('KACHI');
    expect(voucher.reference).toBe('KM-BILL-2');

    const legs = await voucherLegs(voucher.id);
    expect(legs).toEqual(
      expect.arrayContaining([
        { accountId: traderXId, type: 'DEBIT', amount: 76_430.42 },
        { accountId: partyAId, type: 'CREDIT', amount: 49_500 },
        { accountId: partyBId, type: 'CREDIT', amount: 24_750 },
        { accountId: mazduriId, type: 'CREDIT', amount: 637.5 },
        { accountId: brokerId, type: 'CREDIT', amount: 112.5 },
        { accountId: marketFeeId, type: 'CREDIT', amount: 30.42 },
        { accountId: miscId, type: 'CREDIT', amount: 200 },
        { accountId: commissionId, type: 'CREDIT', amount: 1200 },
      ]),
    );

    const totalDebit = legs.filter((leg) => leg.type === 'DEBIT').reduce((sum, leg) => sum + leg.amount, 0);
    const totalCredit = legs.filter((leg) => leg.type === 'CREDIT').reduce((sum, leg) => sum + leg.amount, 0);
    expect(totalDebit).toBe(76_430.42);
    expect(totalCredit).toBe(76_430.42);

    const tb = await getTrialBalance();
    expect(tb.totalDebit - tb.totalCredit).toBeCloseTo(imbalanceBefore, 2);
  });
});

describe('Kachi Maal voucher numbering and cancel', () => {
  let userId: number;
  let partyAId: number;
  let traderXId: number;
  let cashId: number;
  let bankId: number;
  let mazduriId: number;
  let brokerId: number;
  let marketFeeId: number;
  let miscId: number;
  let commissionId: number;
  let invoiceDate: string;

  beforeAll(async () => {
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;

    await updateSystemPreferences({
      daamiPercent: 1.6,
      paleDariPercent: 0.85,
      brokeryPercent: 0.15,
      marketFeeRate: 2,
    });

    await prisma.$transaction(async (tx) => {
      const system = await ensureKachiMaalAccounts(tx);
      mazduriId = system.mazduri.id;
      brokerId = system.broker.id;
      marketFeeId = system.marketFee.id;
      miscId = system.misc.id;
      commissionId = system.commission.id;
    });

    partyAId = (await ensureAccountInCategory(
      KACHI_MAAL_CATEGORY_NAMES.EXT_PURCHASE,
      'Party A',
      AccountType.LIABILITY,
      'KM-PARTY-A',
    )).id;

    traderXId = (await ensureAccountInCategory(
      KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
      'Trader X',
      AccountType.ASSET,
      'KM-TRADER-X',
    )).id;

    const cash = await prisma.account.findFirst({ where: { name: 'Cash in Hand', isActive: true } });
    if (!cash) throw new Error('Cash in Hand account missing');
    cashId = cash.id;

    const bankCat = await prisma.accountCategory.findFirst({ where: { name: 'Bank' } });
    if (!bankCat) throw new Error('Bank category missing');
    let bank = await prisma.account.findFirst({ where: { categoryId: bankCat.id, isActive: true } });
    if (!bank) {
      bank = await prisma.account.create({
        data: { categoryId: bankCat.id, name: 'Test Bank Kachi', code: 'BNK-KM', type: AccountType.ASSET },
      });
      await prisma.ledger.create({ data: { accountId: bank.id, balance: 0 } });
    }
    bankId = bank.id;
  });

  it('uses an independent KACHI sequence that does not affect Journal numbering', async () => {
    const preview = await previewNextVoucherNumber('JOURNAL');

    const invoice = await createKachiMaalInvoice({
      invoiceDate,
      debitAccountId: traderXId,
      miscAmount: 0,
      lines: [
        {
          partyAccountId: partyAId,
          bagCount: 10,
          bhartii: 100,
          dharanCount: 0,
          looseKg: 0,
          ratePerMaund: 2000,
        },
      ],
      createdById: userId,
    });

    const kachiVoucher = invoice.vouchers[0]!.voucher;
    expect(kachiVoucher.type).toBe('KACHI');
    expect(kachiVoucher.number).toBeGreaterThan(0);

    const journal = await createVoucher({
      type: 'JOURNAL',
      debitAccountId: cashId,
      creditAccountId: bankId,
      amount: 100,
      date: invoiceDate,
      createdById: userId,
      reference: 'KM-NUM-JRN',
    });

    expect(journal.number).toBe(preview.number);
  });

  it('cancelling a Kachi Maal voucher reverses every leg and restores all affected balances', async () => {
    const trackedAccounts = [
      partyAId,
      traderXId,
      mazduriId,
      brokerId,
      marketFeeId,
      miscId,
      commissionId,
    ];
    const before = await snapshotBalances(trackedAccounts);

    const tbBeforePost = await getTrialBalance();
    const imbalanceBefore = tbBeforePost.totalDebit - tbBeforePost.totalCredit;

    const invoice = await createKachiMaalInvoice({
      invoiceDate,
      debitAccountId: traderXId,
      miscAmount: 200,
      lines: [
        {
          partyAccountId: partyAId,
          bagCount: 10,
          bhartii: 100,
          dharanCount: 0,
          looseKg: 0,
          ratePerMaund: 2000,
        },
      ],
      createdById: userId,
    });

    const voucherId = invoice.vouchers[0]!.voucher.id;
    const legsBeforeCancel = await voucherLegs(voucherId);
    expect(legsBeforeCancel.length).toBeGreaterThan(0);

    const tbAfterPost = await getTrialBalance();
    expect(tbAfterPost.totalDebit - tbAfterPost.totalCredit).toBeCloseTo(imbalanceBefore, 2);

    await cancelVoucher(voucherId, userId);

    const after = await snapshotBalances(trackedAccounts);
    for (const accountId of trackedAccounts) {
      expect(after.get(accountId)).toBeCloseTo(before.get(accountId)!, 2);
    }

    const reversalCount = await prisma.ledgerEntry.count({
      where: { voucherId, isReversal: true },
    });
    expect(reversalCount).toBe(legsBeforeCancel.length);

    const tbAfterCancel = await getTrialBalance();
    expect(tbAfterCancel.totalDebit - tbAfterCancel.totalCredit).toBeCloseTo(imbalanceBefore, 2);
  });
});
