import { AccountType, InvoiceStatus } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import {
  bootstrapChartOfAccounts,
  KACHI_MAAL_CATEGORY_NAMES,
} from '../accounting/accounting.service';
import { createPurchaseInvoice } from '../invoices/purchase-invoice.service';
import { createSaleInvoice } from '../invoices/sale-invoice.service';
import { createStore } from '../stores/stores.service';
import { createProduct } from './products.service';
import { backfillNullProductAverageCosts } from './backfill-product-average-cost';

async function ensureAccountInCategory(
  categoryName: string,
  accountName: string,
  type: AccountType,
  code: string,
) {
  const targetCategoryName =
    categoryName === 'Ext. Purchase Party' || categoryName === 'Int. Purchase Party'
      ? KACHI_MAAL_CATEGORY_NAMES.PURCHASE_PARTY
      : categoryName;

  const category = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: targetCategoryName },
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

describe('Automatic Product.averageCost backfill', () => {
  let invoiceDate: string;
  let storeId: number;
  let purchasePartyId: number;
  let salePartyId: number;
  let adminId: number;

  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    invoiceDate = await voucherDateInActiveYear();
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!admin) throw new Error('Seed admin first');
    adminId = admin.id;

    storeId = (await createStore(`AvgCost Backfill Store ${Date.now()}`)).id;
    purchasePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.INT_PURCHASE,
        `AvgCost PP ${Date.now()}`,
        AccountType.LIABILITY,
        `AC-PP-${Date.now()}`,
      )
    ).id;
    salePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
        `AvgCost SP ${Date.now()}`,
        AccountType.ASSET,
        `AC-SP-${Date.now()}`,
      )
    ).id;
  });

  it('fills null averageCost from purchase history, is idempotent, and leaves ledgers untouched', async () => {
    const product = await createProduct({ name: `Legacy Null Avg ${Date.now()}` });

    await createPurchaseInvoice({
      invoiceDate,
      storeId,
      supplierAccountId: purchasePartyId,
      createdById: adminId,
      lines: [{ productId: product.id, quantity: 10, rate: 100 }],
    });
    await createPurchaseInvoice({
      invoiceDate,
      storeId,
      supplierAccountId: purchasePartyId,
      createdById: adminId,
      lines: [{ productId: product.id, quantity: 10, rate: 200 }],
    });

    // Simulate pre-fix shop DB: history exists but averageCost was never stored.
    await prisma.product.update({
      where: { id: product.id },
      data: { averageCost: null },
    });

    const ledgerBefore = await prisma.ledger.findUniqueOrThrow({
      where: { accountId: product.accountId },
    });
    const stockBefore = await prisma.stockMovement.count({ where: { productId: product.id } });
    const vouchersBefore = await prisma.voucher.count();

    const first = await backfillNullProductAverageCosts(prisma);
    expect(first.updates.some((u) => u.productId === product.id)).toBe(true);

    const afterFirst = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(Number(afterFirst.averageCost)).toBeCloseTo(150, 6);

    const second = await backfillNullProductAverageCosts(prisma);
    expect(second.updates.some((u) => u.productId === product.id)).toBe(false);
    expect(second.updated).toBe(0);

    const afterSecond = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(Number(afterSecond.averageCost)).toBeCloseTo(150, 6);

    const ledgerAfter = await prisma.ledger.findUniqueOrThrow({
      where: { accountId: product.accountId },
    });
    expect(Number(ledgerAfter.balance)).toBe(Number(ledgerBefore.balance));
    expect(await prisma.stockMovement.count({ where: { productId: product.id } })).toBe(stockBefore);
    expect(await prisma.voucher.count()).toBe(vouchersBefore);

    // Sale after backfill uses the restored WAC for profit (no "not initialized" block).
    const sale = await createSaleInvoice({
      invoiceDate,
      storeId,
      customerAccountId: salePartyId,
      createdById: adminId,
      lines: [{ productId: product.id, quantity: 2, rate: 300 }],
    });
    expect(sale.status).toBe(InvoiceStatus.POSTED);
  });

  it('leaves genuine zero-history products as null', async () => {
    const bare = await createProduct({ name: `No History Avg ${Date.now()}` });
    expect(bare.averageCost).toBeNull();

    const result = await backfillNullProductAverageCosts(prisma);
    const stillNull = await prisma.product.findUniqueOrThrow({ where: { id: bare.id } });
    expect(stillNull.averageCost).toBeNull();
    expect(result.needsHistory.some((r) => r.productId === bare.id)).toBe(true);
  });
});
