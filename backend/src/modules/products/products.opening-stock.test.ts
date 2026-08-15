import { AccountType, InvoiceType, LedgerEntryType, StockDirection } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import {
  KACHI_MAAL_CATEGORY_NAMES,
  OPENING_BALANCE_EQUITY_ACCOUNT_NAME,
  ensureKachiMaalAccounts,
  getTrialBalance,
  listAccounts,
  verifyLedgerIntegrity,
} from '../accounting/accounting.service';
import { createSaleInvoice } from '../invoices/sale-invoice.service';
import { createStore } from '../stores/stores.service';
import { getCurrentStockBalance } from '../stock/stock.service';
import { createProduct } from './products.service';

async function ensureSalePartyAccount(name: string, code: string) {
  let category = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY },
  });
  if (!category) {
    await prisma.$transaction(async (tx) => {
      await ensureKachiMaalAccounts(tx);
    });
    category = await prisma.accountCategory.findFirst({
      where: { isActive: true, name: KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY },
    });
  }
  if (!category) throw new Error('Sale party category missing');

  let account = await prisma.account.findFirst({
    where: { code },
    include: { ledger: true },
  });
  if (!account) {
    account = await prisma.account.create({
      data: { categoryId: category.id, name, code, type: AccountType.ASSET },
      include: { ledger: true },
    });
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
  }
  return account;
}

describe('Product opening stock at creation', () => {
  it('seeds stock and posts Debit product ledger / Credit Opening Balance Equity', async () => {
    const store = await createStore(`Opening Stock Store ${Date.now()}`);
    const product = await createProduct({
      name: `Opening Stock Product ${Date.now()}`,
      openingStock: 100,
      openingStockRate: 500,
      openingStoreId: store.id,
    });

    const balance = await getCurrentStockBalance(product.id, store.id);
    expect(balance).toBe(100);

    const movement = await prisma.stockMovement.findFirst({
      where: { productId: product.id, isOpeningStock: true },
    });
    expect(movement).toBeTruthy();
    expect(movement!.invoiceType).toBe(InvoiceType.OPENING_STOCK);
    expect(movement!.direction).toBe(StockDirection.IN);
    expect(Number(movement!.bags)).toBe(100);

    const purchaseCount = await prisma.invoice.count({
      where: { type: InvoiceType.PURCHASE_INVOICE, items: { some: { productId: product.id } } },
    });
    expect(purchaseCount).toBe(0);

    const productEntries = await prisma.ledgerEntry.findMany({
      where: { ledger: { accountId: product.accountId }, isOpeningBalance: true },
    });
    expect(productEntries).toHaveLength(1);
    expect(productEntries[0].type).toBe(LedgerEntryType.DEBIT);
    expect(Number(productEntries[0].amount)).toBe(50_000);
    expect(productEntries[0].notes).toBe('Opening Stock');
    expect(Number(product.account.ledger?.balance ?? 0)).toBe(50_000);

    const obe = await prisma.account.findFirst({
      where: { name: OPENING_BALANCE_EQUITY_ACCOUNT_NAME },
      include: { ledger: true },
    });
    expect(obe).toBeTruthy();
    expect(obe!.excludeFromSelectors).toBe(true);

    const obeOffset = await prisma.ledgerEntry.findFirst({
      where: {
        ledgerId: obe!.ledger!.id,
        isOpeningBalance: true,
        notes: { contains: product.account.name },
      },
    });
    expect(obeOffset).toBeTruthy();
    expect(obeOffset!.type).toBe(LedgerEntryType.CREDIT);
    expect(Number(obeOffset!.amount)).toBe(50_000);

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);

    const trialBalance = await getTrialBalance();
    const tbObe = trialBalance.accounts.find((a) => a.accountId === obe!.id);
    expect(tbObe).toBeTruthy();
    expect(trialBalance.isBalanced).toBe(true);

    const selectorAccounts = await listAccounts({ forSelectors: true });
    expect(selectorAccounts.items.some((a) => a.id === obe!.id)).toBe(false);
  });

  it('rejects quantity without rate (and vice versa)', async () => {
    const store = await createStore(`Opening Stock Pair Store ${Date.now()}`);
    await expect(
      createProduct({
        name: `Opening Stock Qty Only ${Date.now()}`,
        openingStock: 10,
        openingStoreId: store.id,
      }),
    ).rejects.toThrow(/quantity and rate must both be provided together/i);

    await expect(
      createProduct({
        name: `Opening Stock Rate Only ${Date.now()}`,
        openingStockRate: 100,
        openingStoreId: store.id,
      }),
    ).rejects.toThrow(/quantity and rate must both be provided together/i);
  });

  it('starts at zero when opening stock is omitted', async () => {
    const store = await createStore(`No Opening Stock Store ${Date.now()}`);
    const product = await createProduct({ name: `No Opening Stock ${Date.now()}` });

    const balance = await getCurrentStockBalance(product.id, store.id);
    expect(balance).toBe(0);

    const openingMovement = await prisma.stockMovement.findFirst({
      where: { productId: product.id, isOpeningStock: true },
    });
    expect(openingMovement).toBeNull();

    const ledgerEntries = await prisma.ledgerEntry.count({
      where: { ledger: { accountId: product.accountId } },
    });
    expect(ledgerEntries).toBe(0);
    expect(Number(product.account.ledger?.balance ?? 0)).toBe(0);
  });

  it('integrates with later sale invoice stock deduction', async () => {
    const store = await createStore(`Opening Stock Sale Store ${Date.now()}`);
    const product = await createProduct({
      name: `Opening Stock Sale ${Date.now()}`,
      openingStock: 50,
      openingStockRate: 100,
      openingStoreId: store.id,
    });

    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');

    const party = await ensureSalePartyAccount(
      `Opening Stock Sale Party ${Date.now()}`,
      `OS-SP-${Date.now()}`,
    );

    const invoiceDate = await voucherDateInActiveYear();
    await createSaleInvoice({
      invoiceDate,
      storeId: store.id,
      customerAccountId: party.id,
      billNo: `SI-OPEN-STOCK-${Date.now()}`,
      createdById: user.id,
      lines: [{ productId: product.id, quantity: 20, rate: 100 }],
    });

    const balance = await getCurrentStockBalance(product.id, store.id);
    expect(balance).toBe(30);
  });
});
