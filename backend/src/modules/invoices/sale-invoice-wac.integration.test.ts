import { AccountType } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { KACHI_MAAL_CATEGORY_NAMES } from '../accounting/accounting.service';
import { createProduct } from '../products/products.service';
import { getCurrentStockBalance } from '../stock/stock.service';
import { createPurchaseInvoice } from './purchase-invoice.service';
import { createSaleInvoice } from './sale-invoice.service';
import { createStore } from '../stores/stores.service';
import { verifyLedgerIntegrity } from '../accounting/ledger-integrity';

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

async function getSalesRevenueLedgerBalance() {
  const account = await prisma.account.findFirst({
    where: { isActive: true, name: 'Sales Revenue' },
    include: { ledger: true },
  });
  return account?.ledger ? Number(account.ledger.balance) : 0;
}

describe('Sale Invoice WAC (incremental averageCost)', () => {
  let userId: number;
  let salePartyId: number;
  let purchasePartyId: number;
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
        'Sale Party WAC Test',
        AccountType.ASSET,
        `WAC-SALE-PARTY-${Date.now()}`,
      )
    ).id;

    purchasePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.INT_PURCHASE,
        'Purchase Party WAC Test',
        AccountType.LIABILITY,
        `WAC-PURCHASE-PARTY-${Date.now()}`,
      )
    ).id;

    storeId = (await createStore(`WAC Store ${Date.now()}`)).id;
  });

  it('full sale: stock=0 => product ledger balance=0 and profit posted to Sales Revenue', async () => {
    const product = await createProduct({
      name: `WAC Product Full ${Date.now()}`,
      openingStock: 50,
      openingStockRate: 280,
      openingStoreId: storeId,
      postImmediately: true,
    });

    const productId = product.id;
    const ledgerAccountId = product.accountId;
    const salesRevenueBefore = await getSalesRevenueLedgerBalance();

    await createPurchaseInvoice({
      invoiceDate,
      storeId,
      supplierAccountId: purchasePartyId,
      createdById: userId,
      billNo: `PI-WAC-FULL-${Date.now()}`,
      lines: [{ productId, quantity: 50, rate: 300 }],
    });

    const productAfterPurchase = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { averageCost: true },
    });
    expect(Number(productAfterPurchase.averageCost)).toBeCloseTo(290, 6);

    await createSaleInvoice({
      invoiceDate,
      storeId,
      customerAccountId: salePartyId,
      createdById: userId,
      billNo: `SI-WAC-FULL-${Date.now()}`,
      lines: [{ productId, quantity: 100, rate: 350 }],
    });

    expect(await getCurrentStockBalance(productId, storeId)).toBe(0);

    const productLedger = await prisma.ledger.findUnique({
      where: { accountId: ledgerAccountId },
    });
    expect(Number(productLedger?.balance ?? 0)).toBe(0);

    const salesRevenueAfter = await getSalesRevenueLedgerBalance();
    // profit = (350 - 290) * 100 = 6,000; revenue credits => ledger balance decreases by 6,000.
    expect(salesRevenueAfter - salesRevenueBefore).toBe(-6000);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('partial sale: remaining stock keeps WAC and ledger = remainingQty × averageCost', async () => {
    const product = await createProduct({
      name: `WAC Product Partial ${Date.now()}`,
      openingStock: 50,
      openingStockRate: 280,
      openingStoreId: storeId,
      postImmediately: true,
    });
    const productId = product.id;
    const ledgerAccountId = product.accountId;

    await createPurchaseInvoice({
      invoiceDate,
      storeId,
      supplierAccountId: purchasePartyId,
      createdById: userId,
      billNo: `PI-WAC-PARTIAL-${Date.now()}`,
      lines: [{ productId, quantity: 50, rate: 300 }],
    });

    await createSaleInvoice({
      invoiceDate,
      storeId,
      customerAccountId: salePartyId,
      createdById: userId,
      billNo: `SI-WAC-PARTIAL-${Date.now()}`,
      lines: [{ productId, quantity: 60, rate: 350 }],
    });

    // Remaining stock: 100 - 60 = 40
    expect(await getCurrentStockBalance(productId, storeId)).toBe(40);

    const productLedger = await prisma.ledger.findUnique({
      where: { accountId: ledgerAccountId },
    });
    // 40 × 290 = 11,600
    expect(Number(productLedger?.balance ?? 0)).toBe(11600);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('selling into negative stock: WAC reset doesn’t break cost leg math', async () => {
    const product = await createProduct({
      name: `WAC Product Negative ${Date.now()}`,
      openingStock: 50,
      openingStockRate: 280,
      openingStoreId: storeId,
      postImmediately: true,
    });
    const productId = product.id;
    const ledgerAccountId = product.accountId;

    await createPurchaseInvoice({
      invoiceDate,
      storeId,
      supplierAccountId: purchasePartyId,
      createdById: userId,
      billNo: `PI-WAC-NEG-${Date.now()}`,
      lines: [{ productId, quantity: 50, rate: 300 }],
    });

    await createSaleInvoice({
      invoiceDate,
      storeId,
      customerAccountId: salePartyId,
      createdById: userId,
      billNo: `SI-WAC-NEG-${Date.now()}`,
      lines: [{ productId, quantity: 110, rate: 350 }],
    });

    // Remaining stock: 100 - 110 = -10
    expect(await getCurrentStockBalance(productId, storeId)).toBe(-10);

    const productLedger = await prisma.ledger.findUnique({
      where: { accountId: ledgerAccountId },
    });
    // -10 × 290 = -2,900
    expect(Number(productLedger?.balance ?? 0)).toBe(-2900);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });
});

