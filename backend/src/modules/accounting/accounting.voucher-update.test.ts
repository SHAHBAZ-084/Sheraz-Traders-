import { LedgerEntryType, VoucherType } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import {
  activeFinancialYearStartDate,
  voucherDateInActiveYear,
} from '../../test-helpers/financial-year';
import {
  bootstrapChartOfAccounts,
  createAccountAdjustment,
  createVoucher,
  getLedgerEntries,
  searchAccountAdjustments,
  searchStockAdjustments,
  updateAccountAdjustment,
  updatePostedVoucher,
  updateStockAdjustment,
  verifyLedgerIntegrity,
} from './accounting.service';
import { createProduct, createStockAdjustment } from '../products/products.service';
import { createStore } from '../stores/stores.service';
import { updateStockAdjustment } from './accounting.service';

function dayKey(iso: string | Date) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('updatePostedVoucher', () => {
  let userId: number;
  let cashId: number;
  let partyId: number;
  let today: string;
  let fyStart: string;

  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;
    today = await voucherDateInActiveYear();
    fyStart = await activeFinancialYearStartDate();

    cashId = (
      await prisma.account.findFirstOrThrow({ where: { name: 'Cash in Hand', isActive: true } })
    ).id;
    partyId = (
      await prisma.account.findFirstOrThrow({
        where: { isActive: true, category: { name: 'Sale Party' } },
      })
    ).id;
  });

  it('updates voucher date and recalculates running balances on both ledgers', async (ctx) => {
    if (fyStart >= today) {
      ctx.skip();
      return;
    }

    const refA = `VU-DATE-A-${Date.now()}`;
    const refB = `VU-DATE-B-${Date.now()}`;

    await createVoucher({
      type: VoucherType.RECEIPT,
      debitAccountId: cashId,
      creditAccountId: partyId,
      amount: 100,
      date: today,
      reference: refA,
      createdById: userId,
    });

    const voucher = await createVoucher({
      type: VoucherType.RECEIPT,
      debitAccountId: cashId,
      creditAccountId: partyId,
      amount: 200,
      date: today,
      reference: refB,
      createdById: userId,
    });

    await updatePostedVoucher(voucher.id, userId, { date: fyStart });

    const updated = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(dayKey(updated.date)).toBe(fyStart);

    const partyReport = await getLedgerEntries(partyId);
    const rows = partyReport.rows.filter((r) => !r.isOpeningRow && !r.isClosingRow);
    const backdatedIdx = rows.findIndex((r) => r.credit === 200 && dayKey(r.date) === fyStart);
    const todayIdx = rows.findIndex((r) => r.credit === 100 && dayKey(r.date) === today);
    expect(backdatedIdx).toBeGreaterThanOrEqual(0);
    expect(todayIdx).toBeGreaterThan(backdatedIdx);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('rejects voucher date outside active financial year', async () => {
    const active = await prisma.financialYear.findFirst({ where: { status: 'ACTIVE' } });
    if (!active) throw new Error('No active financial year');
    const beforeStart = new Date(active.startDate);
    beforeStart.setDate(beforeStart.getDate() - 1);
    const outside = `${beforeStart.getFullYear()}-${String(beforeStart.getMonth() + 1).padStart(2, '0')}-${String(beforeStart.getDate()).padStart(2, '0')}`;

    const voucher = await createVoucher({
      type: VoucherType.PAYMENT,
      debitAccountId: partyId,
      creditAccountId: cashId,
      amount: 50,
      date: today,
      reference: `VU-FY-${Date.now()}`,
      createdById: userId,
    });

    await expect(updatePostedVoucher(voucher.id, userId, { date: outside })).rejects.toThrow(
      /financial year/i,
    );
  });
});

describe('adjustment descriptions and lookup', () => {
  it('saves custom description on account adjustment', async () => {
    const bankCategory = await prisma.accountCategory.findFirstOrThrow({
      where: { isActive: true, name: 'Bank' },
    });
    const account = await prisma.account.create({
      data: {
        categoryId: bankCategory.id,
        name: `Adj Desc ${Date.now()}`,
        code: `AD${Date.now()}`,
        type: 'ASSET',
      },
    });
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });

    const adjustmentDate = await voucherDateInActiveYear();
    await createAccountAdjustment({
      adjustmentDate,
      accountId: account.id,
      amount: 150,
      side: 'DR',
      description: 'Custom bank top-up',
    });

    const entry = await prisma.ledgerEntry.findFirst({
      where: { ledger: { accountId: account.id }, notes: 'Custom bank top-up' },
    });
    expect(entry).toBeTruthy();
  });

  it('finds and updates a past account adjustment date/description', async (ctx) => {
    if ((await activeFinancialYearStartDate()) >= (await voucherDateInActiveYear())) {
      ctx.skip();
      return;
    }

    const bankCategory = await prisma.accountCategory.findFirstOrThrow({
      where: { isActive: true, name: 'Bank' },
    });
    const account = await prisma.account.create({
      data: {
        categoryId: bankCategory.id,
        name: `Adj Lookup ${Date.now()}`,
        code: `AL${Date.now()}`,
        type: 'ASSET',
      },
    });
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });

    const today = await voucherDateInActiveYear();
    const fyStart = await activeFinancialYearStartDate();

    await createAccountAdjustment({
      adjustmentDate: today,
      accountId: account.id,
      amount: 90,
      side: 'DR',
      description: 'Lookup test adjustment',
    });

    const hits = await prisma.ledgerEntry.findMany({
      where: { ledger: { accountId: account.id }, notes: 'Lookup test adjustment' },
    });
    expect(hits).toHaveLength(1);

    const search = await searchAccountAdjustments(account.name);
    expect(search.some((r) => r.description === 'Lookup test adjustment')).toBe(true);

    await updateAccountAdjustment(hits[0].id, {
      adjustmentDate: fyStart,
      description: 'Lookup test updated',
    });

    const updated = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: hits[0].id } });
    expect(updated.notes).toBe('Lookup test updated');
    expect(dayKey(updated.date)).toBe(fyStart);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('finds and updates stock adjustment description', async () => {
    const store = await createStore(`Adj Stock Lookup ${Date.now()}`);
    const product = await createProduct({
      name: `Adj Stock Product ${Date.now()}`,
      openingStock: 5,
      openingStockRate: 100,
      openingStoreId: store.id,
    });
    const adjustmentDate = await voucherDateInActiveYear();

    await createStockAdjustment({
      adjustmentDate,
      productId: product.id,
      storeId: store.id,
      quantity: 3,
      rate: 200,
      description: 'Warehouse recount',
    });

    const results = await searchStockAdjustments(product.name);
    expect(results.some((r) => r.description === 'Warehouse recount')).toBe(true);

    const row = results.find((r) => r.description === 'Warehouse recount')!;
    const updated = await updateStockAdjustment(row.id, { description: 'Warehouse recount (revised)' });
    expect(updated.description).toBe('Warehouse recount (revised)');

    const movement = await prisma.stockMovement.findUniqueOrThrow({ where: { id: row.id } });
    expect(movement.description).toBe('Warehouse recount (revised)');
  });
});
