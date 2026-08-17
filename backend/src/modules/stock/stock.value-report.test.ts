import { describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { createProduct } from '../products/products.service';
import { createStore } from '../stores/stores.service';
import { createStockTransfer, getStockValueReport } from './stock.service';

describe('getStockValueReport', () => {
  it('uses ledger ending balance and prorates by store quantity', async () => {
    const user = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!user) throw new Error('Admin user required — run db:seed first');

    const storeA = await createStore(`Value Store A ${Date.now()}`);
    const storeB = await createStore(`Value Store B ${Date.now()}`);
    const product = await createProduct({
      name: `Value Report Product ${Date.now()}`,
      openingStock: 100,
      openingStockRate: 500,
      openingStoreId: storeA.id,
    });
    const date = await voucherDateInActiveYear();

    await createStockTransfer({
      transferDate: date,
      fromStoreId: storeA.id,
      toStoreId: storeB.id,
      productId: product.id,
      quantity: 40,
      createdById: user.id,
    });

    const allStores = await getStockValueReport({ date });
    expect(allStores.rows.find((row) => row.productId === product.id)?.value).toBe(50_000);

    const storeAReport = await getStockValueReport({ date, storeId: storeA.id });
    expect(storeAReport.rows.find((row) => row.productId === product.id)?.value).toBe(30_000);

    const storeBReport = await getStockValueReport({ date, storeId: storeB.id });
    expect(storeBReport.rows.find((row) => row.productId === product.id)?.value).toBe(20_000);
  });

  it('returns 0 for a store when total quantity across stores is 0', async () => {
    const store = await createStore(`Empty Value Store ${Date.now()}`);
    const product = await createProduct({
      name: `Zero Qty Value Product ${Date.now()}`,
    });
    const date = await voucherDateInActiveYear();

    const report = await getStockValueReport({ date, storeId: store.id });
    expect(report.rows.find((row) => row.productId === product.id)?.value).toBe(0);
  });
});
