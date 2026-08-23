import { AccountType } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import {
  bootstrapChartOfAccounts,
  KACHI_MAAL_CATEGORY_NAMES,
  verifyLedgerIntegrity,
} from '../accounting/accounting.service';
import { createSaleInvoice } from '../invoices/sale-invoice.service';
import { createStore } from '../stores/stores.service';
import {
  approveStockAdjustment,
  createProduct,
  createStockAdjustment,
} from '../products/products.service';

async function ensureSaleParty(name: string, code: string) {
  const category = await prisma.accountCategory.findFirstOrThrow({
    where: { isActive: true, name: KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY },
  });
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

describe('Stock adjustment averageCost and sale unblocking', () => {
  let userId: number;
  let salePartyId: number;
  let invoiceDate: string;

  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;
    salePartyId = (
      await ensureSaleParty(`Adj WAC Sale Party ${Date.now()}`, `AWAC-SP-${Date.now()}`)
    ).id;
  });

  it('sets averageCost on approve and allows sale without purchase/opening stock', async () => {
    const store = await createStore(`Adj WAC Store ${Date.now()}`);
    const product = await createProduct({
      name: `Adj WAC Product ${Date.now()}`,
      // no opening stock
    });

    const before = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { averageCost: true },
    });
    expect(before.averageCost).toBeNull();

    const pending = await createStockAdjustment({
      adjustmentDate: invoiceDate,
      productId: product.id,
      storeId: store.id,
      quantity: 40,
      rate: 250,
      createdById: userId,
      postImmediately: false,
    });
    expect(pending.pendingApproval).toBe(true);

    const mid = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { averageCost: true },
    });
    expect(mid.averageCost).toBeNull();

    await approveStockAdjustment(pending.id!, userId);

    const after = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { averageCost: true },
    });
    expect(Number(after.averageCost)).toBeCloseTo(250, 6);

    const invoice = await createSaleInvoice(
      {
        invoiceDate,
        storeId: store.id,
        customerAccountId: salePartyId,
        createdById: userId,
        lines: [{ productId: product.id, quantity: 5, rate: 300 }],
      },
      { postImmediately: true },
    );
    expect(invoice.id).toBeTruthy();

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('uses pending stock adjustment rate provisionally when averageCost is still null', async () => {
    const store = await createStore(`Adj Prov Store ${Date.now()}`);
    const product = await createProduct({
      name: `Adj Prov Product ${Date.now()}`,
      // No opening stock / purchase — only a pending stock adjustment supplies a rate.
    });

    const pending = await createStockAdjustment({
      adjustmentDate: invoiceDate,
      productId: product.id,
      storeId: store.id,
      quantity: 10,
      rate: 175,
      createdById: userId,
      postImmediately: false,
    });
    expect(pending.pendingApproval).toBe(true);

    const productState = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { averageCost: true },
    });
    expect(productState.averageCost).toBeNull();

    const invoice = await createSaleInvoice(
      {
        invoiceDate,
        storeId: store.id,
        customerAccountId: salePartyId,
        createdById: userId,
        lines: [{ productId: product.id, quantity: 2, rate: 200 }],
      },
      { postImmediately: true },
    );
    expect(invoice.id).toBeTruthy();

    const costLeg = await prisma.ledgerEntry.findFirst({
      where: {
        ledger: { accountId: product.accountId },
        voucher: { type: 'SALE_INVOICE' },
        notes: { contains: `pending Stock Adjustment #${pending.id}` },
      },
    });
    expect(costLeg).toBeTruthy();
    expect(Number(costLeg!.amount)).toBeCloseTo(350, 2); // 2 × 175

    const integrity = await verifyLedgerIntegrity();
    expect(integrity.ok).toBe(true);
  });

  it('gives an actionable error when there is no cost basis and no pending adjustment', async () => {
    const store = await createStore(`Adj Err Store ${Date.now()}`);
    const product = await createProduct({
      name: `Adj Err Product ${Date.now()}`,
    });

    await expect(
      createSaleInvoice(
        {
          invoiceDate,
          storeId: store.id,
          customerAccountId: salePartyId,
          createdById: userId,
          lines: [{ productId: product.id, quantity: 1, rate: 50 }],
        },
        { postImmediately: true },
      ),
    ).rejects.toThrow(/has no recorded cost/i);
  });
});
