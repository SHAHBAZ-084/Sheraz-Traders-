import { LedgerEntryType, VoucherType } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import {
  activeFinancialYearStartDate,
  voucherDateInActiveYear,
} from '../../test-helpers/financial-year';
import { createProduct } from '../products/products.service';
import { createStore } from '../stores/stores.service';
import { createSaleInvoice } from '../invoices/sale-invoice.service';
import { createPurchaseInvoice } from '../invoices/purchase-invoice.service';
import {
  bootstrapChartOfAccounts,
  createAccount,
  createAccountAdjustment,
  createVoucher,
  ensureKachiMaalAccounts,
  getLedgerEntries,
  KACHI_MAAL_CATEGORY_NAMES,
  verifyLedgerIntegrity,
} from './accounting.service';

function dayKey(iso: string | Date) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
      data: { categoryId: category.id, name, code, type: 'ASSET' },
      include: { ledger: true },
    });
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
  }
  return account;
}

async function ensurePurchaseParty(name: string, code: string) {
  await prisma.$transaction(async (tx) => {
    await ensureKachiMaalAccounts(tx);
  });
  const category = await prisma.accountCategory.findFirstOrThrow({
    where: { isActive: true, name: KACHI_MAAL_CATEGORY_NAMES.PURCHASE_PARTY },
  });
  let account = await prisma.account.findFirst({ where: { code }, include: { ledger: true } });
  if (!account) {
    account = await prisma.account.create({
      data: { categoryId: category.id, name, code, type: 'LIABILITY' },
      include: { ledger: true },
    });
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
  }
  return account;
}

describe('LedgerEntry.date for backdated postings', () => {
  let userId: number;
  let today: string;
  let fyStart: string;

  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;
    today = await voucherDateInActiveYear();
    fyStart = await activeFinancialYearStartDate();
  });

  afterAll(async () => {
    // leave DB for other suites
  });

  it('stores voucher date on ledger entries and sorts backdated sale invoices correctly', async (ctx) => {
    if (fyStart >= today) {
      ctx.skip();
      return;
    }

    const store = await createStore(`LE Date Store ${Date.now()}`);
    const party = await ensureSaleParty(`LE Date Party ${Date.now()}`, `LDP-${Date.now()}`);
    const product = await createProduct({
      name: `LE Date Product ${Date.now()}`,
      openingStock: 100,
      openingStockRate: 50,
      openingStoreId: store.id,
    });

    // Later voucher first (today), then backdated invoice
    await createVoucher({
      type: VoucherType.RECEIPT,
      debitAccountId: (await prisma.account.findFirstOrThrow({
        where: { name: 'Cash in Hand', isActive: true },
      })).id,
      creditAccountId: party.id,
      amount: 10,
      date: today,
      reference: `LE-DATE-RCPT-${Date.now()}`,
      createdById: userId,
      description: 'Today receipt',
    });

    await createSaleInvoice({
      invoiceDate: fyStart,
      storeId: store.id,
      customerAccountId: party.id,
      billNo: `SI-LE-DATE-${Date.now()}`,
      createdById: userId,
      lines: [{ productId: product.id, quantity: 1, rate: 80 }],
    });

    const partyEntries = await prisma.ledgerEntry.findMany({
      where: { ledger: { accountId: party.id }, isReversal: false },
      include: { voucher: { select: { date: true, type: true } } },
      orderBy: { id: 'asc' },
    });

    const saleEntry = partyEntries.find((e) => e.voucher?.type === VoucherType.SALE_INVOICE);
    expect(saleEntry).toBeTruthy();
    expect(dayKey(saleEntry!.date)).toBe(fyStart);

    const report = await getLedgerEntries(party.id);
    const nonOpening = report.rows.filter((r) => !r.isOpeningRow && !r.isClosingRow);
    const saleRowIndex = nonOpening.findIndex((r) => dayKey(r.date) === fyStart && r.debit > 0);
    const todayRowIndex = nonOpening.findIndex((r) => dayKey(r.date) === today);
    expect(saleRowIndex).toBeGreaterThanOrEqual(0);
    expect(todayRowIndex).toBeGreaterThanOrEqual(0);
    expect(saleRowIndex).toBeLessThan(todayRowIndex);

    // Date-range filter must include the backdated invoice by its entered date
    const filtered = await getLedgerEntries(party.id, fyStart, fyStart);
    expect(filtered.rows.some((r) => dayKey(r.date) === fyStart && r.debit > 0)).toBe(true);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('stores entered date on account adjustments (not creation timestamp)', async (ctx) => {
    if (fyStart >= today) {
      ctx.skip();
      return;
    }

    const bankCategory = await prisma.accountCategory.findFirst({
      where: { isActive: true, name: 'Bank' },
    });
    if (!bankCategory) throw new Error('Bank category missing');

    const account = await createAccount({
      categoryId: bankCategory.id,
      name: `LE Date Adj ${Date.now()}`,
      openingBalance: 1000,
      openingBalanceSide: 'DR',
    });

    await createAccountAdjustment({
      adjustmentDate: fyStart,
      accountId: account.id,
      amount: 250,
      side: 'DR',
    });

    const entry = await prisma.ledgerEntry.findFirst({
      where: {
        ledger: { accountId: account.id },
        notes: 'Account Adjustment',
      },
      orderBy: { id: 'desc' },
    });
    expect(entry).toBeTruthy();
    expect(entry!.isOpeningBalance).toBe(false);
    expect(entry!.type).toBe(LedgerEntryType.DEBIT);
    expect(dayKey(entry!.date)).toBe(fyStart);
    // Prove date is independent of insert timestamp for backdated adjustments
    expect(dayKey(entry!.createdAt)).not.toBe(fyStart);

    const report = await getLedgerEntries(account.id, fyStart, fyStart);
    expect(report.rows.some((r) => r.description.includes('Account Adjustment') && r.debit === 250)).toBe(
      true,
    );
  });

  it('stores purchase invoice voucher date on ledger entries', async (ctx) => {
    if (fyStart >= today) {
      ctx.skip();
      return;
    }

    const store = await createStore(`LE Date PI Store ${Date.now()}`);
    const party = await ensurePurchaseParty(`LE Date PI Party ${Date.now()}`, `LPP-${Date.now()}`);
    const product = await createProduct({
      name: `LE Date PI Product ${Date.now()}`,
      openingStock: 0,
      openingStoreId: store.id,
    });

    await createPurchaseInvoice({
      invoiceDate: fyStart,
      storeId: store.id,
      supplierAccountId: party.id,
      billNo: `PI-LE-DATE-${Date.now()}`,
      createdById: userId,
      lines: [{ productId: product.id, quantity: 2, rate: 40 }],
    });

    const entry = await prisma.ledgerEntry.findFirst({
      where: {
        ledger: { accountId: party.id },
        voucher: { type: VoucherType.PURCHASE_INVOICE },
        isReversal: false,
      },
      orderBy: { id: 'desc' },
    });
    expect(entry).toBeTruthy();
    expect(dayKey(entry!.date)).toBe(fyStart);
  });
});
