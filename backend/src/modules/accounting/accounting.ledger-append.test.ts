import { AccountType, VoucherType } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import {
  activeFinancialYearStartDate,
  voucherDateInActiveYear,
} from '../../test-helpers/financial-year';
import { createProduct } from '../products/products.service';
import { createStore } from '../stores/stores.service';
import { createSaleInvoice } from '../invoices/sale-invoice.service';
import {
  bootstrapChartOfAccounts,
  createVoucher,
  createVouchersBatch,
  ensureKachiMaalAccounts,
  KACHI_MAAL_CATEGORY_NAMES,
  ledgerBalanceApplyStats,
  resetLedgerBalanceApplyStats,
  verifyLedgerIntegrity,
} from './accounting.service';

async function ensureExpenseAccount(name: string, code: string) {
  const category = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: 'Expenses' },
  });
  if (!category) throw new Error('Expenses category missing');

  let account = await prisma.account.findFirst({
    where: { code },
    include: { ledger: true },
  });
  if (!account) {
    account = await prisma.account.create({
      data: { categoryId: category.id, name, code, type: AccountType.EXPENSE },
      include: { ledger: true },
    });
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
  }
  return account;
}

async function ensureCashAccount() {
  await bootstrapChartOfAccounts();
  const cash = await prisma.account.findFirst({
    where: { name: 'Cash in Hand', isActive: true },
    include: { ledger: true },
  });
  if (!cash?.ledger) throw new Error('Cash in Hand missing');
  return cash;
}

async function ensureSaleParty(name: string, code: string) {
  await prisma.$transaction(async (tx) => {
    await ensureKachiMaalAccounts(tx);
  });
  const category = await prisma.accountCategory.findFirstOrThrow({
    where: { isActive: true, name: KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY },
  });

  let account = await prisma.account.findFirst({ where: { code }, include: { ledger: true } });
  if (!account) {
    account = await prisma.account.create({
      data: { categoryId: category.id, name, code, type: AccountType.ASSET },
      include: { ledger: true },
    });
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
  }
  return account;
}

describe('incremental ledger balance apply on post', () => {
  let userId: number;
  let cashId: number;
  let expenseId: number;
  let today: string;
  let fyStart: string;

  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;
    cashId = (await ensureCashAccount()).id;
    expenseId = (
      await ensureExpenseAccount(`Append Perf Expense ${Date.now()}`, `APX-${Date.now()}`)
    ).id;
    today = await voucherDateInActiveYear();
    fyStart = await activeFinancialYearStartDate();
  });

  it('uses incremental apply for in-order posts and keeps integrity after a large history', async () => {
    const historyCount = 200;
    const stamp = Date.now();
    await createVouchersBatch({
      createdById: userId,
      vouchers: Array.from({ length: historyCount }, (_, i) => ({
        type: VoucherType.PAYMENT,
        debitAccountId: expenseId,
        creditAccountId: cashId,
        amount: 10 + (i % 7),
        date: today,
        reference: `APPEND-HIST-${stamp}-${i}`,
        description: `History ${i}`,
      })),
    });

    resetLedgerBalanceApplyStats();
    const t0 = Date.now();
    await createVoucher({
      type: VoucherType.PAYMENT,
      debitAccountId: expenseId,
      creditAccountId: cashId,
      amount: 55,
      date: today,
      reference: `APPEND-FAST-${Date.now()}`,
      createdById: userId,
      description: 'Fast append',
    });
    const elapsedMs = Date.now() - t0;

    expect(ledgerBalanceApplyStats.incremental).toBeGreaterThanOrEqual(2);
    expect(ledgerBalanceApplyStats.full).toBe(0);
    // Append after hundreds of entries should stay near-constant-time (not scan history).
    expect(elapsedMs).toBeLessThan(3_000);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
    expect(integrity.ledgerDrift).toEqual([]);
  }, 120_000);

  it('falls back to full recompute for a backdated voucher and stays balanced', async () => {
    if (fyStart === today) {
      // Seed a tip on "today" first so fyStart is strictly earlier.
      await createVoucher({
        type: VoucherType.PAYMENT,
        debitAccountId: expenseId,
        creditAccountId: cashId,
        amount: 1,
        date: today,
        reference: `APPEND-TIP-${Date.now()}`,
        createdById: userId,
      });
    }

    resetLedgerBalanceApplyStats();
    await createVoucher({
      type: VoucherType.PAYMENT,
      debitAccountId: expenseId,
      creditAccountId: cashId,
      amount: 33,
      date: fyStart,
      reference: `APPEND-BACKDATE-${Date.now()}`,
      createdById: userId,
      description: 'Backdated',
    });

    expect(ledgerBalanceApplyStats.full).toBeGreaterThanOrEqual(1);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
    expect(integrity.ledgerDrift).toEqual([]);
  });

  it('keeps sale invoice posts incremental with multi-product legs', async () => {
    const store = await createStore(`Append SI Store ${Date.now()}`);
    const party = await ensureSaleParty(`Append SI Party ${Date.now()}`, `ASP-${Date.now()}`);
    const p1 = await createProduct({
      name: `Append SI P1 ${Date.now()}`,
      openingStock: 50,
      openingStockRate: 100,
      openingStoreId: store.id,
    });
    const p2 = await createProduct({
      name: `Append SI P2 ${Date.now()}`,
      openingStock: 50,
      openingStockRate: 100,
      openingStoreId: store.id,
    });

    resetLedgerBalanceApplyStats();
    await createSaleInvoice({
      invoiceDate: today,
      storeId: store.id,
      customerAccountId: party.id,
      billNo: `SI-APPEND-${Date.now()}`,
      createdById: userId,
      lines: [
        { productId: p1.id, quantity: 2, rate: 150 },
        { productId: p2.id, quantity: 3, rate: 200 },
      ],
    });

    expect(ledgerBalanceApplyStats.incremental).toBeGreaterThanOrEqual(3);
    expect(ledgerBalanceApplyStats.full).toBe(0);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });
});
