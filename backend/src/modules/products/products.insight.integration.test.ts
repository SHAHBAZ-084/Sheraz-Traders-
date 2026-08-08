import { AccountType } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { KACHI_MAAL_CATEGORY_NAMES } from '../accounting/accounting.service';
import { createPurchaseInvoice } from '../invoices/purchase-invoice.service';
import { createStore } from '../stores/stores.service';
import { createProduct, getProductInsight } from './products.service';

async function ensurePurchasePartyAccount(name: string, code: string) {
  const category = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: KACHI_MAAL_CATEGORY_NAMES.INT_PURCHASE },
  });
  if (!category) throw new Error('Purchase party category missing');

  let account = await prisma.account.findFirst({
    where: { isActive: true, code },
    include: { ledger: true },
  });
  if (!account) {
    account = await prisma.account.create({
      data: { categoryId: category.id, name, code, type: AccountType.LIABILITY },
      include: { ledger: true },
    });
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
  }
  return account;
}

describe('Product insight (average purchase rate + store stock)', () => {
  let userId: number;
  let purchasePartyId: number;
  let invoiceDate: string;

  beforeAll(async () => {
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;

    purchasePartyId = (
      await ensurePurchasePartyAccount('Purchase Party Insight Test', 'PI-INSIGHT-PARTY')
    ).id;
  });

  it('returns null averageRate and 0 stock for a product with no purchase history', async () => {
    const product = await createProduct({ name: `Insight No History ${Date.now()}` });
    const store = await createStore(`Insight Store Empty ${Date.now()}`);

    const insight = await getProductInsight(product.id, store.id);

    expect(insight.averageRate).toBeNull();
    expect(insight.storeStock).toBe(0);
    expect(insight.storeName).toBe(store.name);
  });

  it('computes a quantity-weighted average purchase rate, not a plain average', async () => {
    const product = await createProduct({ name: `Insight Weighted ${Date.now()}` });
    const store = await createStore(`Insight Store Weighted ${Date.now()}`);

    // 10kg at 100 and 1000kg at 105 must weight toward 105, not average to 102.5.
    await createPurchaseInvoice({
      invoiceDate,
      storeId: store.id,
      supplierAccountId: purchasePartyId,
      billNo: `PI-INSIGHT-A-${Date.now()}`,
      createdById: userId,
      lines: [{ productId: product.id, quantity: 10, rate: 100 }],
    });
    await createPurchaseInvoice({
      invoiceDate,
      storeId: store.id,
      supplierAccountId: purchasePartyId,
      billNo: `PI-INSIGHT-B-${Date.now()}`,
      createdById: userId,
      lines: [{ productId: product.id, quantity: 1000, rate: 105 }],
    });

    const insight = await getProductInsight(product.id, store.id);

    const expectedAverage = (10 * 100 + 1000 * 105) / (10 + 1000);
    expect(insight.averageRate).toBeCloseTo(expectedAverage, 6);
    expect(insight.averageRate).not.toBeCloseTo(102.5, 6);
    expect(insight.storeStock).toBe(1010);
  });

  it('scopes stock to the requested store only, not the sum across all stores', async () => {
    const product = await createProduct({ name: `Insight Store Scoped ${Date.now()}` });
    const storeA = await createStore(`Insight Store A ${Date.now()}`);
    const storeB = await createStore(`Insight Store B ${Date.now()}`);

    await createPurchaseInvoice({
      invoiceDate,
      storeId: storeA.id,
      supplierAccountId: purchasePartyId,
      billNo: `PI-INSIGHT-SCOPE-A-${Date.now()}`,
      createdById: userId,
      lines: [{ productId: product.id, quantity: 50, rate: 20 }],
    });
    await createPurchaseInvoice({
      invoiceDate,
      storeId: storeB.id,
      supplierAccountId: purchasePartyId,
      billNo: `PI-INSIGHT-SCOPE-B-${Date.now()}`,
      createdById: userId,
      lines: [{ productId: product.id, quantity: 30, rate: 20 }],
    });

    const insightA = await getProductInsight(product.id, storeA.id);
    const insightB = await getProductInsight(product.id, storeB.id);

    expect(insightA.storeStock).toBe(50);
    expect(insightB.storeStock).toBe(30);
    // Average rate is not store-scoped (it's a purchase-history-wide figure), so both should match.
    expect(insightA.averageRate).toBeCloseTo(20, 6);
    expect(insightB.averageRate).toBeCloseTo(20, 6);
  });

  it('rejects an unknown store id', async () => {
    const product = await createProduct({ name: `Insight Bad Store ${Date.now()}` });
    await expect(getProductInsight(product.id, 999999999)).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
  });
});
