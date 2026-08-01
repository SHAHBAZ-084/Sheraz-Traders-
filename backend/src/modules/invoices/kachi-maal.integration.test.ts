import { AccountType, BoriThelaMode } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import {
  cancelVoucher,
  createVoucher,
  ensureKachiMaalAccounts,
  getLedgerEntries,
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

function entriesPerAccount(legs: { accountId: number }[]) {
  const counts = new Map<number, number>();
  for (const leg of legs) {
    counts.set(leg.accountId, (counts.get(leg.accountId) ?? 0) + 1);
  }
  return counts;
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
        bardanaQty: null,
        bardanaRate: null,
      },
      prefs,
    );

    expect(row.totalWeightKg).toBe(1000);
    expect(row.amount).toBe(50_000);
    expect(row.bardanaAmount).toBeNull();
    expect(row.netCreditToParty).toBe(49_500);

    const totals = computeKachiMaalInvoiceTotals(
      [{ ...row, bhartii: 100, bardanaAmount: null }],
      prefs,
      0,
      null,
      null,
    );

    expect(totals.totalPaleDari).toBe(425);
    expect(totals.totalBrokery).toBe(75);
    expect(totals.marketFeeAmount).toBe(0);
    expect(totals.profitAmount).toBe(800);
    expect(totals.totalDebitAmount).toBe(50_800);
    expect(totals.lowerBardanaAmount).toBeNull();
  });

  it('posts one KACHI voucher with five merged ledger entries; debits = credits = 50,800; trial balance balanced', async () => {
    const invoice = await createKachiMaalInvoice({
      invoiceDate,
      billNo: 'KM-BILL-1',
      debitAccountId: traderXId,
      miscAmount: 0,
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
          bardanaQty: null,
          bardanaRate: null,
        },
      ],
      createdById: userId,
    });

    expect(invoice.status).toBe('POSTED');
    expect(Number(invoice.total)).toBe(50_800);
    expect(invoice.vouchers).toHaveLength(1);

    const voucher = invoice.vouchers[0]!.voucher;
    expect(voucher.type).toBe('KACHI');
    expect(voucher.reference).toBe('KM-BILL-1');
    expect(voucher.debitAccountId).toBeNull();
    expect(voucher.creditAccountId).toBeNull();
    expect(Number(voucher.amount)).toBe(50_800);

    const legs = await voucherLegs(voucher.id);
    expect(legs).toHaveLength(5);

    expect(legs).toEqual(
      expect.arrayContaining([
        { accountId: traderXId, type: 'DEBIT', amount: 50_800 },
        { accountId: partyAId, type: 'CREDIT', amount: 49_500 },
        { accountId: mazduriId, type: 'CREDIT', amount: 425 },
        { accountId: brokerId, type: 'CREDIT', amount: 75 },
        { accountId: commissionId, type: 'CREDIT', amount: 800 },
      ]),
    );

    const perAccount = entriesPerAccount(legs);
    expect(perAccount.get(traderXId)).toBe(1);
    expect(perAccount.get(partyAId)).toBe(1);
    expect(perAccount.get(mazduriId)).toBe(1);
    expect(perAccount.get(brokerId)).toBe(1);
    expect(perAccount.get(commissionId)).toBe(1);

    const totalDebit = legs.filter((leg) => leg.type === 'DEBIT').reduce((sum, leg) => sum + leg.amount, 0);
    const totalCredit = legs.filter((leg) => leg.type === 'CREDIT').reduce((sum, leg) => sum + leg.amount, 0);
    expect(totalDebit).toBe(50_800);
    expect(totalCredit).toBe(50_800);

    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);

    const partyLedger = await getLedgerEntries(partyAId);
    const voucherNo = String(voucher.number);
    const partyVoucherRows = partyLedger.rows.filter(
      (row) => row.type === 'Kachi' && row.voucherNo === voucherNo,
    );
    expect(partyVoucherRows).toHaveLength(1);
    expect(partyVoucherRows.every((row) => row.ref === 'KM-BILL-1')).toBe(true);
  });
});

describe('Kachi Maal Test 2 — full case (two parties, bardana, market fee, misc, lower bardana)', () => {
  let userId: number;
  let partyAId: number;
  let partyBId: number;
  let traderXId: number;
  let boriId: number;
  let thelaId: number;
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
      boriId = system.bori.id;
      thelaId = system.thela.id;
      mazduriId = system.mazduri.id;
      brokerId = system.broker.id;
      marketFeeId = system.marketFee.id;
      miscId = system.misc.id;
      commissionId = system.commission.id;
    });

    const partyA = await ensureAccountInCategory(
      KACHI_MAAL_CATEGORY_NAMES.EXT_PURCHASE,
      'Party A',
      AccountType.LIABILITY,
      'KM-PARTY-A',
    );
    partyAId = partyA.id;

    const partyB = await ensureAccountInCategory(
      KACHI_MAAL_CATEGORY_NAMES.EXT_PURCHASE,
      'Party B',
      AccountType.LIABILITY,
      'KM-PARTY-B',
    );
    partyBId = partyB.id;

    const traderX = await ensureAccountInCategory(
      KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
      'Trader X',
      AccountType.ASSET,
      'KM-TRADER-X',
    );
    traderXId = traderX.id;
  });

  it('computes two-row invoice totals exactly', () => {
    const row1 = computeKachiMaalRow(
      {
        bagCount: 10,
        bhartii: 100,
        dharanCount: 0,
        looseKg: 0,
        ratePerMaund: 2000,
        bardanaQty: 10,
        bardanaRate: 10,
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
        bardanaQty: null,
        bardanaRate: null,
      },
      prefs,
    );

    expect(row1.totalWeightKg).toBe(1000);
    expect(row1.amount).toBe(50_000);
    expect(row1.bardanaAmount).toBe(100);
    expect(row1.netCreditToParty).toBe(49_600);

    expect(row2.totalWeightKg).toBe(625);
    expect(row2.amount).toBe(25_000);
    expect(row2.bardanaAmount).toBeNull();
    expect(row2.netCreditToParty).toBe(24_750);

    const totals = computeKachiMaalInvoiceTotals(
      [
        { ...row1, bhartii: 100, bardanaAmount: row1.bardanaAmount },
        { ...row2, bhartii: 120, bardanaAmount: null },
      ],
      prefs,
      200,
      5,
      10,
    );

    expect(totals.totalGoodsAmount).toBe(75_000);
    expect(totals.totalPaleDari).toBe(637.5);
    expect(totals.totalBrokery).toBe(112.5);
    expect(totals.totalCalculatedBags).toBeCloseTo(15.208333, 4);
    expect(totals.marketFeeAmount).toBe(30.42);
    expect(totals.profitAmount).toBe(1200);
    expect(totals.lowerBardanaAmount).toBe(50);
    expect(totals.totalDebitAmount).toBe(76_430.42);
  });

  it('posts one KACHI voucher with twelve merged ledger entries; all legs sum to 76,580.42; trial balance balanced', async () => {
    const invoice = await createKachiMaalInvoice({
      invoiceDate,
      billNo: 'KM-BILL-2',
      debitAccountId: traderXId,
      miscAmount: 200,
      lowerBardanaMode: BoriThelaMode.THELA,
      lowerBardanaQty: 5,
      lowerBardanaRate: 10,
      lines: [
        {
          partyAccountId: partyAId,
          boriOrThelaMode: BoriThelaMode.BORI,
          bagCount: 10,
          bhartii: 100,
          dharanCount: 0,
          looseKg: 0,
          ratePerMaund: 2000,
          bardanaQty: 10,
          bardanaRate: 10,
        },
        {
          partyAccountId: partyBId,
          boriOrThelaMode: BoriThelaMode.THELA,
          bagCount: 5,
          bhartii: 120,
          dharanCount: 2,
          looseKg: 15,
          ratePerMaund: 1600,
          bardanaQty: null,
          bardanaRate: null,
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
    expect(legs).toHaveLength(12);

    expect(legs).toEqual(
      expect.arrayContaining([
        { accountId: traderXId, type: 'DEBIT', amount: 76_430.42 },
        { accountId: traderXId, type: 'DEBIT', amount: 50 },
        { accountId: partyAId, type: 'CREDIT', amount: 49_500 },
        { accountId: partyAId, type: 'CREDIT', amount: 100 },
        { accountId: partyBId, type: 'CREDIT', amount: 24_750 },
        { accountId: boriId, type: 'DEBIT', amount: 100 },
        { accountId: mazduriId, type: 'CREDIT', amount: 637.5 },
        { accountId: brokerId, type: 'CREDIT', amount: 112.5 },
        { accountId: marketFeeId, type: 'CREDIT', amount: 30.42 },
        { accountId: miscId, type: 'CREDIT', amount: 200 },
        { accountId: commissionId, type: 'CREDIT', amount: 1200 },
        { accountId: thelaId, type: 'CREDIT', amount: 50 },
      ]),
    );

    const perAccount = entriesPerAccount(legs);
    expect(perAccount.get(traderXId)).toBe(2);
    expect(perAccount.get(partyAId)).toBe(2);
    expect(perAccount.get(partyBId)).toBe(1);
    expect(perAccount.get(boriId)).toBe(1);
    expect(perAccount.get(thelaId)).toBe(1);
    expect(perAccount.get(mazduriId)).toBe(1);
    expect(perAccount.get(brokerId)).toBe(1);
    expect(perAccount.get(marketFeeId)).toBe(1);
    expect(perAccount.get(miscId)).toBe(1);
    expect(perAccount.get(commissionId)).toBe(1);

    const partyALedger = await getLedgerEntries(partyAId);
    const voucherNo = String(voucher.number);
    const partyAVoucherRows = partyALedger.rows.filter(
      (row) => row.voucherNo === voucherNo && (row.type === 'Kachi' || row.type === 'Bardana'),
    );
    expect(partyAVoucherRows).toHaveLength(2);
    expect(partyAVoucherRows.some((row) => row.type === 'Kachi')).toBe(true);
    expect(partyAVoucherRows.some((row) => row.type === 'Bardana')).toBe(true);
    expect(
      partyAVoucherRows.find((row) => row.type === 'Bardana')?.description,
    ).toMatch(/^Bardana against KM-/);
    expect(partyAVoucherRows.every((row) => row.ref === 'KM-BILL-2')).toBe(true);

    const totalDebit = legs.filter((leg) => leg.type === 'DEBIT').reduce((sum, leg) => sum + leg.amount, 0);
    const totalCredit = legs.filter((leg) => leg.type === 'CREDIT').reduce((sum, leg) => sum + leg.amount, 0);
    expect(totalDebit).toBe(76_580.42);
    expect(totalCredit).toBe(76_580.42);

    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);
  });
});

describe('Kachi Maal voucher numbering and cancel', () => {
  let userId: number;
  let partyAId: number;
  let traderXId: number;
  let cashId: number;
  let bankId: number;
  let boriId: number;
  let thelaId: number;
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
      boriId = system.bori.id;
      thelaId = system.thela.id;
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
    const preview = await previewNextVoucherNumber();

    const invoice = await createKachiMaalInvoice({
      invoiceDate,
      debitAccountId: traderXId,
      miscAmount: 0,
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
          bardanaQty: null,
          bardanaRate: null,
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
      boriId,
      thelaId,
      mazduriId,
      brokerId,
      marketFeeId,
      miscId,
      commissionId,
    ];
    const before = await snapshotBalances(trackedAccounts);

    const invoice = await createKachiMaalInvoice({
      invoiceDate,
      debitAccountId: traderXId,
      miscAmount: 200,
      lowerBardanaMode: BoriThelaMode.THELA,
      lowerBardanaQty: 5,
      lowerBardanaRate: 10,
      lines: [
        {
          partyAccountId: partyAId,
          boriOrThelaMode: BoriThelaMode.BORI,
          bagCount: 10,
          bhartii: 100,
          dharanCount: 0,
          looseKg: 0,
          ratePerMaund: 2000,
          bardanaQty: 10,
          bardanaRate: 10,
        },
      ],
      createdById: userId,
    });

    const voucherId = invoice.vouchers[0]!.voucher.id;
    const legsBeforeCancel = await voucherLegs(voucherId);
    expect(legsBeforeCancel.length).toBeGreaterThan(0);

    const tbAfterPost = await getTrialBalance();
    expect(tbAfterPost.isBalanced).toBe(true);

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
    expect(tbAfterCancel.isBalanced).toBe(true);
  });
});
