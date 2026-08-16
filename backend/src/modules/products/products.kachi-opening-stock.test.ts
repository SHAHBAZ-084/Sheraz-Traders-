import { LedgerEntryType, ProductKind, StockDirection } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import {
  OPENING_BALANCE_EQUITY_ACCOUNT_NAME,
  verifyLedgerIntegrity,
} from '../accounting/accounting.service';
import { createStore } from '../stores/stores.service';
import { getCurrentStockBalance, getStockReport } from '../stock/stock.service';
import { createProduct } from './products.service';

describe('Kachi product opening stock at creation', () => {
  it('posts weight-based stock in kg and debits product ledger by maund rate value', async () => {
    const store = await createStore(`Kachi Opening Store ${Date.now()}`);
    const product = await createProduct({
      name: `Kachi Wheat ${Date.now()}`,
      kind: ProductKind.KACHI,
      openingStoreId: store.id,
      kachiOpening: {
        bagMode: 'THELA',
        bagCount: 10,
        dharanCount: 2,
        looseKg: 10,
        bhartii: 50,
        ratePerMaund: 4000,
      },
    });

    expect(product.kind).toBe(ProductKind.KACHI);

    const expectedKg = 10 * 50 + 2 * 5 + 10; // 520
    const expectedValue = expectedKg * (4000 / 40); // 52_000

    const balance = await getCurrentStockBalance(product.id, store.id);
    expect(balance).toBe(expectedKg);

    const movement = await prisma.stockMovement.findFirst({
      where: { productId: product.id, isOpeningStock: true },
    });
    expect(movement).toBeTruthy();
    expect(Number(movement!.bags)).toBe(0);
    expect(Number(movement!.weightKg)).toBe(expectedKg);
    expect(movement!.direction).toBe(StockDirection.IN);

    const productEntries = await prisma.ledgerEntry.findMany({
      where: { ledger: { accountId: product.accountId }, isOpeningBalance: true },
    });
    expect(productEntries).toHaveLength(1);
    expect(productEntries[0].type).toBe(LedgerEntryType.DEBIT);
    expect(Number(productEntries[0].amount)).toBe(expectedValue);

    const obe = await prisma.account.findFirst({
      where: { name: OPENING_BALANCE_EQUITY_ACCOUNT_NAME },
      include: { ledger: true },
    });
    const obeOffset = await prisma.ledgerEntry.findFirst({
      where: {
        ledgerId: obe!.ledger!.id,
        isOpeningBalance: true,
        notes: { contains: product.account.name },
      },
    });
    expect(obeOffset!.type).toBe(LedgerEntryType.CREDIT);
    expect(Number(obeOffset!.amount)).toBe(expectedValue);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('stock report displays kachi balance as maund and kg (same as Kachi Maal weight format)', async () => {
    const store = await createStore(`Kachi Report Store ${Date.now()}`);
    const product = await createProduct({
      name: `Kachi Wheat Report ${Date.now()}`,
      kind: ProductKind.KACHI,
      openingStoreId: store.id,
      kachiOpening: {
        bagMode: 'THELA',
        bagCount: 0,
        dharanCount: 0,
        looseKg: 1250,
        bhartii: 50,
        ratePerMaund: 4000,
      },
    });

    const report = await getStockReport({ productId: product.id, storeId: store.id });
    expect(report.totals.netBalance).toBe(1250);
    expect(report.totals.netBalanceDisplay).toBe('31 Maund 10 Kg');
    expect(report.rows[0]?.runningBalanceDisplay).toBe('31 Maund 10 Kg');
  });

  it('rejects standard opening stock fields on kachi products', async () => {
    const store = await createStore(`Kachi Reject Store ${Date.now()}`);
    await expect(
      createProduct({
        name: `Kachi Bad Mix ${Date.now()}`,
        kind: ProductKind.KACHI,
        openingStock: 10,
        openingStockRate: 100,
        openingStoreId: store.id,
      }),
    ).rejects.toThrow(/kachiOpening weight fields/i);
  });
});
