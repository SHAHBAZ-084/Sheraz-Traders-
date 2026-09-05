import { AccountType, FinancialYearStatus, InvoiceStatus, InvoiceType } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { KACHI_MAAL_CATEGORY_NAMES } from '../accounting/accounting.service';
import { getProfitLossReport } from '../accounting/profit-loss-report.service';
import { createProduct, createStockAdjustment } from '../products/products.service';
import { createPurchaseInvoice } from '../invoices/purchase-invoice.service';
import { createSaleInvoice } from '../invoices/sale-invoice.service';
import { createStore } from '../stores/stores.service';
import { verifyLedgerIntegrity } from '../accounting/ledger-integrity';

async function ensureAccountInCategory(
  categoryName: string,
  accountName: string,
  type: AccountType,
  code: string,
) {
  const category = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: categoryName },
  });
  if (!category) throw new Error(`Category missing: ${categoryName}`);

  let account = await prisma.account.findFirst({
    where: { code },
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

describe('Profit & Loss uses Product.averageCost (not purchase-only)', () => {
  let userId: number;
  let salePartyId: number;
  let purchasePartyId: number;
  let storeId: number;
  let invoiceDate: string;
  let financialYearId: number;

  beforeAll(async () => {
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;

    const fy = await prisma.financialYear.findFirst({ where: { status: FinancialYearStatus.ACTIVE } });
    if (!fy) throw new Error('No active financial year');
    financialYearId = fy.id;

    salePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
        'P&L Sale Party',
        AccountType.ASSET,
        `PL-SALE-${Date.now()}`,
      )
    ).id;

    purchasePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.PURCHASE_PARTY,
        'P&L Purchase Party',
        AccountType.LIABILITY,
        `PL-PUR-${Date.now()}`,
      )
    ).id;

    storeId = (await createStore(`P&L Store ${Date.now()}`)).id;
  });

  it('computes profit from averageCost for stock-adjustment-only products (not full sale as profit)', async () => {
    const product = await createProduct({
      name: `Pesticide PL ${Date.now()}`,
      unit: 'bag',
      createdById: userId,
      postImmediately: true,
    });

    // Stock via Stock Adjustment only — no Purchase Invoice (the pesticide pattern).
    await createStockAdjustment({
      adjustmentDate: invoiceDate,
      productId: product.id,
      storeId,
      quantity: 10,
      rate: 400,
      createdById: userId,
      postImmediately: true,
    });

    const refreshed = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(refreshed.averageCost).not.toBeNull();
    expect(Number(refreshed.averageCost)).toBeCloseTo(400, 4);

    await createSaleInvoice(
      {
        invoiceDate,
        storeId,
        customerAccountId: salePartyId,
        createdById: userId,
        lines: [{ productId: product.id, quantity: 2, rate: 550 }],
      },
      { postImmediately: true },
    );

    const report = await getProfitLossReport({
      financialYearId,
      productId: product.id,
    });

    const row = report.rows.find((r) => r.sourceType === 'SALE_INVOICE' && r.productName === product.name);
    expect(row).toBeTruthy();
    expect(row!.costUnavailable).toBe(false);
    expect(row!.quantity).toBe(2);
    expect(row!.purchasePrice).toBeCloseTo(400, 4);
    expect(row!.salePrice).toBeCloseTo(550, 4);
    // Real margin: (550-400)*2 = 300 — NOT full sale 1100
    expect(row!.profit).toBeCloseTo(300, 2);
    expect(report.netProfit).toBeCloseTo(300, 2);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('still uses averageCost correctly when purchase history exists (fertilizer pattern)', async () => {
    const product = await createProduct({
      name: `Fertilizer PL ${Date.now()}`,
      unit: 'bag',
      createdById: userId,
      postImmediately: true,
    });

    await createPurchaseInvoice(
      {
        invoiceDate,
        storeId,
        supplierAccountId: purchasePartyId,
        createdById: userId,
        lines: [{ productId: product.id, quantity: 20, rate: 1000 }],
      },
      { postImmediately: true },
    );

    await createSaleInvoice(
      {
        invoiceDate,
        storeId,
        customerAccountId: salePartyId,
        createdById: userId,
        lines: [{ productId: product.id, quantity: 5, rate: 1200 }],
      },
      { postImmediately: true },
    );

    const report = await getProfitLossReport({
      financialYearId,
      productId: product.id,
    });

    const row = report.rows.find((r) => r.sourceType === 'SALE_INVOICE');
    expect(row!.costUnavailable).toBe(false);
    expect(row!.purchasePrice).toBeCloseTo(1000, 4);
    expect(row!.profit).toBeCloseTo(1000, 2); // (1200-1000)*5
  });

  it('flags and excludes lines when product has no cost basis at all', async () => {
    const product = await createProduct({
      name: `No Cost PL ${Date.now()}`,
      unit: 'bag',
      createdById: userId,
      postImmediately: true,
    });

    // Force null averageCost and create a posted sale by temporarily giving stock via
    // adjustment then clearing averageCost + simulating orphan sale item isn't possible
    // without stock. Instead: seed a sale invoice item directly after clearing cost,
    // with a fake posted invoice for report-only coverage.
    const fy = await prisma.financialYear.findUniqueOrThrow({ where: { id: financialYearId } });
    const invoice = await prisma.invoice.create({
      data: {
        type: InvoiceType.SALE_INVOICE,
        status: InvoiceStatus.POSTED,
        reference: `SI-NOCOST-${Date.now()}`,
        invoiceDate: new Date(invoiceDate),
        storeId,
        debitAccountId: salePartyId,
        total: 500,
        financialYearId: fy.id,
        createdById: userId,
        items: {
          create: [
            {
              productId: product.id,
              label: product.name,
              quantity: 1,
              unitPrice: 500,
              total: 500,
            },
          ],
        },
      },
    });

    await prisma.product.update({
      where: { id: product.id },
      data: { averageCost: null },
    });

    const report = await getProfitLossReport({
      financialYearId,
      productId: product.id,
    });

    const row = report.rows.find((r) => r.reference === invoice.reference);
    expect(row).toBeTruthy();
    expect(row!.costUnavailable).toBe(true);
    expect(row!.purchasePrice).toBeNull();
    expect(row!.profit).toBe(0);
    expect(row!.note).toMatch(/Cost unavailable/i);
    expect(report.costUnavailableCount).toBeGreaterThanOrEqual(1);
    // Excluded from totals
    expect(report.totalSale).toBe(0);
    expect(report.netProfit).toBe(0);
  });
});
