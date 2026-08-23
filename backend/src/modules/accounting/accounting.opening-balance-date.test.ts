import { describe, expect, it, beforeAll } from 'vitest';
import { prisma } from '../../lib/prisma';
import {
  activeFinancialYearStartDate,
  voucherDateInActiveYear,
} from '../../test-helpers/financial-year';
import {
  bootstrapChartOfAccounts,
  createAccount,
  createAccountAdjustment,
  getLedgerEntries,
  searchAccountOpeningBalances,
  searchProductOpeningStock,
  updateAccountOpeningBalanceDate,
  updateProductOpeningStockDate,
  verifyLedgerIntegrity,
} from './accounting.service';
import { createProduct, createStockAdjustment } from '../products/products.service';
import { createStore } from '../stores/stores.service';
import { getStockReport } from '../stock/stock.service';

function dayKey(iso: string | Date) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('opening balance date correction', () => {
  let today: string;
  let fyStart: string;

  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    today = await voucherDateInActiveYear();
    fyStart = await activeFinancialYearStartDate();
  });

  it('moves opening balance to an earlier date and keeps ledger balances correct', async (ctx) => {
    if (fyStart >= today) {
      ctx.skip();
      return;
    }

    const expenseCat = await prisma.accountCategory.findFirstOrThrow({
      where: { isActive: true, name: 'Expenses' },
    });
    const account = await createAccount({
      categoryId: expenseCat.id,
      name: `OB Date Earlier ${Date.now()}`,
      openingBalance: 1000,
      openingBalanceSide: 'DR',
    });

    const obEntry = await prisma.ledgerEntry.findFirstOrThrow({
      where: {
        ledger: { accountId: account.id },
        isOpeningBalance: true,
        isReversal: false,
      },
    });

    const result = await updateAccountOpeningBalanceDate(obEntry.id, fyStart);
    expect(dayKey(result.openingDate)).toBe(fyStart);
    expect(result.warning).toBeUndefined();

    const report = await getLedgerEntries(account.id);
    const openingRow = report.rows.find((r) => r.type === 'Opening Balance');
    expect(openingRow).toBeTruthy();
    expect(dayKey(openingRow!.date)).toBe(fyStart);
    expect(openingRow!.balance).toBe(1000);
    expect(report.balance).toBe(1000);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('warns when opening balance date is after other transactions but recalculates correctly', async (ctx) => {
    if (fyStart >= today) {
      ctx.skip();
      return;
    }

    const bankCat = await prisma.accountCategory.findFirstOrThrow({
      where: { isActive: true, name: 'Bank' },
    });
    const account = await createAccount({
      categoryId: bankCat.id,
      name: `OB Date After Tx ${Date.now()}`,
      openingBalance: 500,
      openingBalanceSide: 'DR',
    });

    await createAccountAdjustment({
      adjustmentDate: fyStart,
      accountId: account.id,
      amount: 100,
      side: 'DR',
    });

    const obEntry = await prisma.ledgerEntry.findFirstOrThrow({
      where: {
        ledger: { accountId: account.id },
        isOpeningBalance: true,
      },
    });

    const result = await updateAccountOpeningBalanceDate(obEntry.id, today);
    expect(dayKey(result.openingDate)).toBe(today);
    expect(result.warning).toMatch(/after other existing transactions/i);

    const report = await getLedgerEntries(account.id);
    const dataRows = report.rows.filter((r) => !r.isOpeningRow && !r.isClosingRow);
    const obIdx = dataRows.findIndex((r) => r.type === 'Opening Balance');
    const adjIdx = dataRows.findIndex((r) => r.description === 'Account Adjustment');
    expect(obIdx).toBeGreaterThan(adjIdx);
    expect(report.balance).toBe(600);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('rejects opening balance date outside active financial year', async () => {
    const active = await prisma.financialYear.findFirst({ where: { status: 'ACTIVE' } });
    if (!active) throw new Error('No active financial year');
    const beforeStart = new Date(active.startDate);
    beforeStart.setDate(beforeStart.getDate() - 1);
    const outside = `${beforeStart.getFullYear()}-${String(beforeStart.getMonth() + 1).padStart(2, '0')}-${String(beforeStart.getDate()).padStart(2, '0')}`;

    const expenseCat = await prisma.accountCategory.findFirstOrThrow({
      where: { isActive: true, name: 'Expenses' },
    });
    const account = await createAccount({
      categoryId: expenseCat.id,
      name: `OB FY Reject ${Date.now()}`,
      openingBalance: 200,
      openingBalanceSide: 'DR',
    });

    const obEntry = await prisma.ledgerEntry.findFirstOrThrow({
      where: { ledger: { accountId: account.id }, isOpeningBalance: true },
    });

    await expect(updateAccountOpeningBalanceDate(obEntry.id, outside)).rejects.toThrow(
      /financial year/i,
    );
  });

  it('finds account opening balances by name', async () => {
    const expenseCat = await prisma.accountCategory.findFirstOrThrow({
      where: { isActive: true, name: 'Expenses' },
    });
    const uniqueName = `OB Search ${Date.now()}`;
    await createAccount({
      categoryId: expenseCat.id,
      name: uniqueName,
      openingBalance: 75,
      openingBalanceSide: 'DR',
    });

    const hits = await searchAccountOpeningBalances(uniqueName);
    expect(hits.some((h) => h.accountName === uniqueName)).toBe(true);
  });
});

describe('product opening stock date correction', () => {
  it('updates opening stock to an earlier date and stock report lists it first', async (ctx) => {
    const fyStart = await activeFinancialYearStartDate();
    const today = await voucherDateInActiveYear();
    if (fyStart >= today) {
      ctx.skip();
      return;
    }

    const store = await createStore(`OB Stock Date ${Date.now()}`);
    const product = await createProduct({
      name: `OB Stock Product ${Date.now()}`,
      openingStock: 50,
      openingStockRate: 10,
      openingStoreId: store.id,
    });

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { productId: product.id, isOpeningStock: true },
    });

    const result = await updateProductOpeningStockDate(movement.id, fyStart);
    expect(dayKey(result.openingDate)).toBe(fyStart);
    expect(result.warning).toBeUndefined();

    const report = await getStockReport({ productId: product.id, storeId: store.id });
    const openingRow = report.rows.find((r) => r.invoiceReference === 'Opening Stock');
    expect(openingRow).toBeTruthy();
    expect(dayKey(openingRow!.date)).toBe(fyStart);
    expect(report.rows[0].id).toBe(openingRow!.id);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('warns when opening stock date is after other stock movements', async (ctx) => {
    const fyStart = await activeFinancialYearStartDate();
    const today = await voucherDateInActiveYear();
    if (fyStart >= today) {
      ctx.skip();
      return;
    }

    const store = await createStore(`OB Stock Warn ${Date.now()}`);
    const product = await createProduct({
      name: `OB Stock Warn Product ${Date.now()}`,
      openingStock: 50,
      openingStockRate: 10,
      openingStoreId: store.id,
    });

    await createStockAdjustment({
      adjustmentDate: fyStart,
      productId: product.id,
      storeId: store.id,
      quantity: 5,
      rate: 10,
    });

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { productId: product.id, isOpeningStock: true },
    });

    const result = await updateProductOpeningStockDate(movement.id, today);
    expect(dayKey(result.openingDate)).toBe(today);
    expect(result.warning).toMatch(/after other existing transactions/i);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('rejects opening stock date outside active financial year', async () => {
    const active = await prisma.financialYear.findFirst({ where: { status: 'ACTIVE' } });
    if (!active) throw new Error('No active financial year');
    const beforeStart = new Date(active.startDate);
    beforeStart.setDate(beforeStart.getDate() - 1);
    const outside = `${beforeStart.getFullYear()}-${String(beforeStart.getMonth() + 1).padStart(2, '0')}-${String(beforeStart.getDate()).padStart(2, '0')}`;

    const store = await createStore(`OB Stock FY ${Date.now()}`);
    const product = await createProduct({
      name: `OB Stock FY Product ${Date.now()}`,
      openingStock: 20,
      openingStockRate: 5,
      openingStoreId: store.id,
    });

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { productId: product.id, isOpeningStock: true },
    });

    await expect(updateProductOpeningStockDate(movement.id, outside)).rejects.toThrow(
      /financial year/i,
    );
  });

  it('finds product opening stock by name', async () => {
    const store = await createStore(`OB Stock Search ${Date.now()}`);
    const uniqueName = `OB Stock Search Product ${Date.now()}`;
    await createProduct({
      name: uniqueName,
      openingStock: 10,
      openingStockRate: 100,
      openingStoreId: store.id,
    });

    const hits = await searchProductOpeningStock(uniqueName);
    expect(hits.some((h) => h.productName === uniqueName)).toBe(true);
  });
});
