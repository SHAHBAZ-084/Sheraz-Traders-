import { AccountType, InvoiceType, StockDirection } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { KACHI_MAAL_CATEGORY_NAMES } from '../accounting/accounting.service';
import { createSaleInvoice } from '../invoices/sale-invoice.service';
import { createStore } from '../stores/stores.service';
import { getCurrentStockBalance } from '../stock/stock.service';
import { createProduct } from './products.service';

async function ensureSalePartyAccount(name: string, code: string) {
  const category = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY },
  });
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
  it('seeds stock without purchase invoice or ledger entries', async () => {
    const store = await createStore(`Opening Stock Store ${Date.now()}`);
    const product = await createProduct({
      name: `Opening Stock Product ${Date.now()}`,
      openingStock: 50,
      openingStoreId: store.id,
    });

    const balance = await getCurrentStockBalance(product.id, store.id);
    expect(balance).toBe(50);

    const movement = await prisma.stockMovement.findFirst({
      where: { productId: product.id, isOpeningStock: true },
    });
    expect(movement).toBeTruthy();
    expect(movement!.invoiceType).toBe(InvoiceType.OPENING_STOCK);
    expect(movement!.direction).toBe(StockDirection.IN);
    expect(Number(movement!.bags)).toBe(50);

    const purchaseCount = await prisma.invoice.count({
      where: { type: InvoiceType.PURCHASE_INVOICE, items: { some: { productId: product.id } } },
    });
    expect(purchaseCount).toBe(0);

    const ledgerEntries = await prisma.ledgerEntry.count({
      where: { ledger: { accountId: product.accountId } },
    });
    expect(ledgerEntries).toBe(0);
    expect(Number(product.account.ledger?.balance ?? 0)).toBe(0);
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
  });

  it('integrates with later sale invoice stock deduction', async () => {
    const store = await createStore(`Opening Stock Sale Store ${Date.now()}`);
    const product = await createProduct({
      name: `Opening Stock Sale ${Date.now()}`,
      openingStock: 50,
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
