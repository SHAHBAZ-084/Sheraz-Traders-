import { AccountType, InvoiceType } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
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

describe('Sale Invoice per-store stock validation', () => {
  let userId: number;
  let salePartyId: number;
  let purchasePartyId: number;
  let productId: number;
  let storeAId: number;
  let storeBId: number;
  let invoiceDate: string;
  let productName: string;

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

    productName = `SI Stock Product ${Date.now()}`;
    const product = await createProduct({ name: productName });
    productId = product.id;

    storeAId = (await createStore(`SI Stock Store A ${Date.now()}`)).id;
    storeBId = (await createStore(`SI Stock Store B ${Date.now()}`)).id;
  });

  it('rejects selling more than available at the selected store and creates no invoice/stock', async () => {
    await createPurchaseInvoice({
      invoiceDate,
      storeId: storeAId,
      supplierAccountId: purchasePartyId,
      billNo: 'PI-STOCK-OVERSELL',
      createdById: userId,
      lines: [{ productId, quantity: 5, rate: 40 }],
    });

    const invoicesBefore = await prisma.invoice.count({
      where: { type: InvoiceType.SALE_INVOICE },
    });
    const movementsBefore = await prisma.stockMovement.count({
      where: { productId, storeId: storeAId, invoiceType: InvoiceType.SALE_INVOICE },
    });

    await expect(
      createSaleInvoice({
        invoiceDate,
        storeId: storeAId,
        customerAccountId: salePartyId,
        billNo: 'SI-STOCK-OVERSELL',
        createdById: userId,
        lines: [{ productId, quantity: 6, rate: 100 }],
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/Insufficient stock/i),
    });

    const invoicesAfter = await prisma.invoice.count({
      where: { type: InvoiceType.SALE_INVOICE },
    });
    const movementsAfter = await prisma.stockMovement.count({
      where: { productId, storeId: storeAId, invoiceType: InvoiceType.SALE_INVOICE },
    });
    expect(invoicesAfter).toBe(invoicesBefore);
    expect(movementsAfter).toBe(movementsBefore);
    expect(await getCurrentStockBalance(productId, storeAId)).toBe(5);
  });

  it('blocks sale from Store B when stock only exists in Store A', async () => {
    // Store A has 10 from this purchase; Store B has never received this product.
    await createPurchaseInvoice({
      invoiceDate,
      storeId: storeAId,
      supplierAccountId: purchasePartyId,
      billNo: 'PI-STOCK-CROSS',
      createdById: userId,
      lines: [{ productId, quantity: 10, rate: 40 }],
    });

    expect(await getCurrentStockBalance(productId, storeAId)).toBeGreaterThanOrEqual(10);
    expect(await getCurrentStockBalance(productId, storeBId)).toBe(0);

    let caught: unknown;
    try {
      await createSaleInvoice({
        invoiceDate,
        storeId: storeBId,
        customerAccountId: salePartyId,
        billNo: 'SI-STOCK-CROSS',
        createdById: userId,
        lines: [{ productId, quantity: 1, rate: 100 }],
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect(caught).toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/available 0/i),
    });

    const straySale = await prisma.invoice.findFirst({
      where: { type: InvoiceType.SALE_INVOICE, billNo: 'SI-STOCK-CROSS' },
    });
    expect(straySale).toBeNull();

    const strayOut = await prisma.stockMovement.findFirst({
      where: {
        productId,
        storeId: storeBId,
        invoiceType: InvoiceType.SALE_INVOICE,
      },
    });
    expect(strayOut).toBeNull();
  });
});
