import { LedgerEntryType, StockDirection } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { verifyLedgerIntegrity } from '../accounting/accounting.service';
import { createStore } from '../stores/stores.service';
import { getCurrentStockBalance } from '../stock/stock.service';
import { createProduct, createStockAdjustment } from './products.service';

describe('createStockAdjustment', () => {
  it('rejects adjustment without a store', async () => {
    const store = await createStore(`Adj No Store ${Date.now()}`);
    const product = await createProduct({
      name: `Adj No Store Product ${Date.now()}`,
      openingStock: 10,
      openingStockRate: 100,
      openingStoreId: store.id,
    });
    const adjustmentDate = await voucherDateInActiveYear();

    await expect(
      createStockAdjustment({
        adjustmentDate,
        productId: product.id,
        storeId: 0,
        quantity: 5,
        rate: 100,
      }),
    ).rejects.toThrow(/store is required/i);
  });

  it('adds stock to the selected store and posts ledger entries', async () => {
    const storeA = await createStore(`Adj Store A ${Date.now()}`);
    const storeB = await createStore(`Adj Store B ${Date.now()}`);
    const product = await createProduct({
      name: `Adj Standard Product ${Date.now()}`,
      openingStock: 10,
      openingStockRate: 100,
      openingStoreId: storeA.id,
    });
    const adjustmentDate = await voucherDateInActiveYear();

    const beforeA = await getCurrentStockBalance(product.id, storeA.id);
    const beforeB = await getCurrentStockBalance(product.id, storeB.id);
    expect(beforeA).toBe(10);
    expect(beforeB).toBe(0);

    const result = await createStockAdjustment({
      adjustmentDate,
      productId: product.id,
      storeId: storeB.id,
      quantity: 50,
      rate: 4200,
    });

    expect(result.storeId).toBe(storeB.id);
    expect(result.balance).toBe(50);

    const afterA = await getCurrentStockBalance(product.id, storeA.id);
    const afterB = await getCurrentStockBalance(product.id, storeB.id);
    expect(afterA).toBe(10);
    expect(afterB).toBe(50);

    const movement = await prisma.stockMovement.findFirst({
      where: {
        productId: product.id,
        storeId: storeB.id,
        isOpeningStock: false,
        invoiceReference: 'Stock Adjustment',
      },
      orderBy: { id: 'desc' },
    });
    expect(movement).toBeTruthy();
    expect(movement!.direction).toBe(StockDirection.IN);
    expect(Number(movement!.bags)).toBe(50);

    const ledgerEntry = await prisma.ledgerEntry.findFirst({
      where: {
        ledger: { accountId: product.accountId },
        notes: { contains: 'Stock Adjustment' },
        isOpeningBalance: false,
      },
      orderBy: { id: 'desc' },
    });
    expect(ledgerEntry).toBeTruthy();
    expect(ledgerEntry!.type).toBe(LedgerEntryType.DEBIT);
    expect(Number(ledgerEntry!.amount)).toBe(210_000);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });
});
