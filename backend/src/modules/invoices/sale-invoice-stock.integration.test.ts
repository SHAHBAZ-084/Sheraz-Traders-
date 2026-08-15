import { AccountType, InvoiceType } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { KACHI_MAAL_CATEGORY_NAMES } from '../accounting/accounting.service';
import { createProduct } from '../products/products.service';
import { getCurrentStockBalance } from '../stock/stock.service';
import { createStore } from '../stores/stores.service';
import { createPurchaseInvoice } from './purchase-invoice.service';
import { createSaleInvoice } from './sale-invoice.service';

async function ensureAccountInCategory(
  categoryName: string,
  accountName: string,
  type: AccountType,
  code: string,
) {
  const targetCategoryName = (categoryName === 'Ext. Purchase Party' || categoryName === 'Int. Purchase Party')
    ? KACHI_MAAL_CATEGORY_NAMES.PURCHASE_PARTY
    : categoryName;

  const category = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: targetCategoryName },
  });
  if (!category) throw new Error(`Category missing: ${categoryName}`);

  let account = await prisma.account.findFirst({
    where: { code },
    include: { ledger: true, category: true },
  });
  if (!account) {
    account = await prisma.account.create({
      data: { categoryId: category.id, name: accountName, code, type },
      include: { ledger: true, category: true },
    });
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
  } else {
    if (account.categoryId !== category.id || !account.isActive) {
      await prisma.account.update({
        where: { id: account.id },
        data: { categoryId: category.id, isActive: true },
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

describe('Sale Invoice per-store stock (negative allowed)', () => {
  let userId: number;
  let salePartyId: number;
  let purchasePartyId: number;
  let productId: number;
  let storeAId: number;
  let storeBId: number;
  let invoiceDate: string;

  beforeAll(async () => {
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;

    salePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
        'Sale Party SI Stock Test',
        AccountType.ASSET,
        'SI-PARTY-STOCK',
      )
    ).id;

    purchasePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.INT_PURCHASE,
        'Purchase Party SI Stock Test',
        AccountType.LIABILITY,
        'PI-PARTY-STOCK',
      )
    ).id;

    const product = await createProduct({ name: `SI Stock Product ${Date.now()}` });
    productId = product.id;

    storeAId = (await createStore(`SI Stock Store A ${Date.now()}`)).id;
    storeBId = (await createStore(`SI Stock Store B ${Date.now()}`)).id;
  });

  it('allows selling more than available at the selected store and records negative balance', async () => {
    await createPurchaseInvoice({
      invoiceDate,
      storeId: storeAId,
      supplierAccountId: purchasePartyId,
      billNo: `PI-STOCK-OVERSELL-${Date.now()}`,
      createdById: userId,
      lines: [{ productId, quantity: 5, rate: 40 }],
    });

    const sale = await createSaleInvoice({
      invoiceDate,
      storeId: storeAId,
      customerAccountId: salePartyId,
      billNo: `SI-STOCK-OVERSELL-${Date.now()}`,
      createdById: userId,
      lines: [{ productId, quantity: 6, rate: 100 }],
    });

    expect(sale.status).toBe('POSTED');
    expect(await getCurrentStockBalance(productId, storeAId)).toBe(-1);

    const movement = await prisma.stockMovement.findFirst({
      where: {
        productId,
        storeId: storeAId,
        invoiceType: InvoiceType.SALE_INVOICE,
        invoiceId: sale.id,
      },
    });
    expect(movement).not.toBeNull();
  });

  it('allows sale from Store B even when stock only exists in Store A (per-store negative)', async () => {
    const crossProduct = await createProduct({ name: `SI Cross Store Product ${Date.now()}` });

    await createPurchaseInvoice({
      invoiceDate,
      storeId: storeAId,
      supplierAccountId: purchasePartyId,
      billNo: `PI-STOCK-CROSS-${Date.now()}`,
      createdById: userId,
      lines: [{ productId: crossProduct.id, quantity: 10, rate: 40 }],
    });

    expect(await getCurrentStockBalance(crossProduct.id, storeAId)).toBeGreaterThanOrEqual(10);
    expect(await getCurrentStockBalance(crossProduct.id, storeBId)).toBe(0);

    const sale = await createSaleInvoice({
      invoiceDate,
      storeId: storeBId,
      customerAccountId: salePartyId,
      billNo: `SI-STOCK-CROSS-${Date.now()}`,
      createdById: userId,
      lines: [{ productId: crossProduct.id, quantity: 1, rate: 100 }],
    });

    expect(sale.status).toBe('POSTED');
    expect(await getCurrentStockBalance(crossProduct.id, storeBId)).toBe(-1);
    expect(await getCurrentStockBalance(crossProduct.id, storeAId)).toBeGreaterThanOrEqual(10);
  });
});
