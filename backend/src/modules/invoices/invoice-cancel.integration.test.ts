import { AccountType, InvoiceStatus, InvoiceType, StockDirection, VoucherStatus } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { KACHI_MAAL_CATEGORY_NAMES } from '../accounting/accounting.service';
import { createProduct } from '../products/products.service';
import { getCurrentStockBalance } from '../stock/stock.service';
import { createStore } from '../stores/stores.service';
import { cancelInvoice } from './invoices.service';
import { createPurchaseInvoice } from './purchase-invoice.service';
import { createSaleInvoice } from './sale-invoice.service';

async function ledgerBalance(accountId: number) {
  const ledger = await prisma.ledger.findUniqueOrThrow({ where: { accountId } });
  return Number(ledger.balance);
}

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

describe('Invoice cancellation', () => {
  let userId: number;
  let salePartyId: number;
  let purchasePartyId: number;
  let productId: number;
  let storeId: number;
  let invoiceDate: string;

  beforeAll(async () => {
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;

    salePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
        `Cancel SI Party ${Date.now()}`,
        AccountType.ASSET,
        `CX-SP-${Date.now()}`,
      )
    ).id;
    purchasePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.INT_PURCHASE,
        `Cancel PI Party ${Date.now()}`,
        AccountType.LIABILITY,
        `CX-PP-${Date.now()}`,
      )
    ).id;

    productId = (await createProduct({ name: `Cancel Stock Product ${Date.now()}` })).id;
    storeId = (await createStore(`Cancel Stock Store ${Date.now()}`)).id;
  });

  it('cancels Sale Invoice: reverses linked voucher ledger and restores store stock', async () => {
    await createPurchaseInvoice({
      invoiceDate,
      storeId,
      supplierAccountId: purchasePartyId,
      createdById: userId,
      lines: [{ productId, quantity: 10, rate: 40 }],
    });

    const salePartyBefore = await ledgerBalance(salePartyId);
    const stockBeforeSale = await getCurrentStockBalance(productId, storeId);

    const sale = await createSaleInvoice({
      invoiceDate,
      storeId,
      customerAccountId: salePartyId,
      createdById: userId,
      lines: [{ productId, quantity: 4, rate: 100 }],
    });

    expect(sale.status).toBe(InvoiceStatus.POSTED);
    expect(await getCurrentStockBalance(productId, storeId)).toBe(stockBeforeSale - 4);
    expect(await ledgerBalance(salePartyId)).toBe(salePartyBefore + 400);

    const cancelled = await cancelInvoice(sale.id, userId);
    expect(cancelled.status).toBe(InvoiceStatus.CANCELLED);

    const links = await prisma.invoiceVoucher.findMany({ where: { invoiceId: sale.id } });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const voucher = await prisma.voucher.findUniqueOrThrow({ where: { id: link.voucherId } });
      expect(voucher.status).toBe(VoucherStatus.CANCELLED);
    }

    expect(await ledgerBalance(salePartyId)).toBe(salePartyBefore);
    expect(await getCurrentStockBalance(productId, storeId)).toBe(stockBeforeSale);

    const reversals = await prisma.stockMovement.findMany({
      where: {
        invoiceId: sale.id,
        invoiceType: InvoiceType.SALE_INVOICE,
        description: { startsWith: 'Reversal —' },
      },
    });
    expect(reversals.some((m) => m.direction === StockDirection.IN)).toBe(true);

    await expect(cancelInvoice(sale.id, userId)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('cancels Purchase Invoice: reverses voucher and removes store stock', async () => {
    const product = await createProduct({ name: `Cancel PI Product ${Date.now()}` });
    const store = await createStore(`Cancel PI Store ${Date.now()}`);
    const stockBefore = await getCurrentStockBalance(product.id, store.id);

    const purchase = await createPurchaseInvoice({
      invoiceDate,
      storeId: store.id,
      supplierAccountId: purchasePartyId,
      createdById: userId,
      lines: [{ productId: product.id, quantity: 6, rate: 50 }],
    });

    expect(await getCurrentStockBalance(product.id, store.id)).toBe(stockBefore + 6);

    await cancelInvoice(purchase.id, userId);
    expect(await getCurrentStockBalance(product.id, store.id)).toBe(stockBefore);

    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: purchase.id } });
    expect(inv.status).toBe(InvoiceStatus.CANCELLED);
  });
});
